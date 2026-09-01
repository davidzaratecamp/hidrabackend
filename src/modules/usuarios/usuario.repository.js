'use strict';

/**
 * Repositorio de usuarios: el ÚNICO lugar del módulo con SQL.
 *
 * Es una fábrica que recibe el ejecutor de consultas (`db`). Puede ser el pool o
 * una conexión dentro de una transacción: ambos exponen `query`, así que el
 * repositorio funciona igual con cualquiera de los dos.
 */

const { contiene, identificadorSeguro } = require('../../shared/utils/sql');

const CAMPOS_PUBLICOS = `
  u.id, u.nombre_completo, u.email, u.numero_documento,
  u.activo, u.ultimo_acceso, u.created_at, u.updated_at
`;

const ORDEN_PERMITIDO = ['nombre_completo', 'email', 'created_at', 'ultimo_acceso'];

function crearUsuarioRepositorio({ db }) {
  /**
   * Contexto de autenticación: usuario activo con sus roles y permisos efectivos.
   *
   * Una sola ida a la base por petición, y sin traer `password_hash` — el
   * sistema viejo hacía `SELECT *` y cargaba el hash a memoria en cada request.
   */
  async function obtenerContextoAutenticacion(id) {
    const [filas] = await db.query(
      `SELECT ${CAMPOS_PUBLICOS},
              COALESCE(
                (SELECT JSON_ARRAYAGG(r.codigo)
                   FROM usuario_roles ur
                   JOIN roles r ON r.id = ur.rol_id AND r.activo = TRUE
                  WHERE ur.usuario_id = u.id), JSON_ARRAY()
              ) AS roles,
              COALESCE(
                (SELECT JSON_ARRAYAGG(vp.permiso_codigo)
                   FROM v_usuario_permisos vp
                  WHERE vp.usuario_id = u.id), JSON_ARRAY()
              ) AS permisos
         FROM usuarios u
        WHERE u.id = ? AND u.activo = TRUE`,
      [id]
    );

    if (filas.length === 0) return null;
    return normalizarContexto(filas[0]);
  }

  /** Incluye el hash. Uso exclusivo del servicio de autenticación. */
  async function buscarCredencialesPorEmail(email) {
    const [filas] = await db.query(
      `SELECT id, nombre_completo, email, password_hash, activo
         FROM usuarios
        WHERE email = ?
        LIMIT 1`,
      [email]
    );
    return filas[0] ?? null;
  }

  async function obtenerHashPassword(id) {
    const [filas] = await db.query(
      'SELECT password_hash FROM usuarios WHERE id = ? AND activo = TRUE LIMIT 1',
      [id]
    );
    return filas[0]?.password_hash ?? null;
  }

  async function buscarPorId(id) {
    const [filas] = await db.query(
      `SELECT ${CAMPOS_PUBLICOS},
              COALESCE(
                (SELECT JSON_ARRAYAGG(JSON_OBJECT('codigo', r.codigo, 'nombre', r.nombre))
                   FROM usuario_roles ur
                   JOIN roles r ON r.id = ur.rol_id
                  WHERE ur.usuario_id = u.id), JSON_ARRAY()
              ) AS roles
         FROM usuarios u
        WHERE u.id = ?`,
      [id]
    );
    if (filas.length === 0) return null;
    return { ...filas[0], roles: parsearJson(filas[0].roles) };
  }

  async function existeEmail(email, exceptoId = null) {
    const [filas] = await db.query(
      `SELECT 1 FROM usuarios WHERE email = ? ${exceptoId ? 'AND id <> ?' : ''} LIMIT 1`,
      exceptoId ? [email, exceptoId] : [email]
    );
    return filas.length > 0;
  }

  async function listar({ pagina, porPagina, busqueda, rol, activo, ordenarPor, direccion }) {
    const condiciones = [];
    const parametros = [];

    if (busqueda) {
      condiciones.push(
        "(u.nombre_completo LIKE ? ESCAPE '\\\\' OR u.email LIKE ? ESCAPE '\\\\' OR u.numero_documento LIKE ? ESCAPE '\\\\')"
      );
      const patron = contiene(busqueda);
      parametros.push(patron, patron, patron);
    }
    if (rol) {
      condiciones.push(
        'EXISTS (SELECT 1 FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id WHERE ur.usuario_id = u.id AND r.codigo = ?)'
      );
      parametros.push(rol);
    }
    if (activo !== undefined) {
      condiciones.push('u.activo = ?');
      parametros.push(activo);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const columna = identificadorSeguro(ordenarPor, ORDEN_PERMITIDO);
    const sentido = direccion === 'asc' ? 'ASC' : 'DESC';

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM usuarios u ${where}`,
      parametros
    );

    const [filas] = await db.query(
      `SELECT ${CAMPOS_PUBLICOS},
              COALESCE(
                (SELECT JSON_ARRAYAGG(JSON_OBJECT('codigo', r.codigo, 'nombre', r.nombre))
                   FROM usuario_roles ur
                   JOIN roles r ON r.id = ur.rol_id
                  WHERE ur.usuario_id = u.id), JSON_ARRAY()
              ) AS roles,
              -- "Candidatos asignados" de la pantalla vieja de reclutadores:
              -- cuántos tiene cada uno en su cartera ahora mismo.
              (SELECT COUNT(*) FROM candidatos c WHERE c.reclutador_id = u.id) AS cartera
         FROM usuarios u
         ${where}
        ORDER BY u.${columna} ${sentido}, u.id DESC
        LIMIT ? OFFSET ?`,
      [...parametros, porPagina, (pagina - 1) * porPagina]
    );

    return {
      items: filas.map((f) => ({ ...f, roles: parsearJson(f.roles), cartera: Number(f.cartera) })),
      total,
    };
  }

  /**
   * Usuarios activos con el rol de reclutamiento, con su carga actual.
   *
   * Alimenta el desplegable de reasignación. Incluye el conteo de cartera para
   * que quien reasigna vea a quién le está cargando trabajo, algo que el
   * `reclutadores-activos` del sistema viejo no daba.
   */
  /**
   * Conteo de usuarios por rol, para las tarjetas de la pantalla de usuarios.
   *
   * Sale del servidor y no de la lista ya cargada porque el listado es paginado:
   * contar en el cliente daría el total de la página en curso, no el real. Es la
   * misma razón por la que las pestañas de candidatos usan `resumen-estados`.
   *
   * El LEFT JOIN mantiene en el resultado los roles sin ningún usuario, para que
   * la tarjeta exista marcando cero en vez de desaparecer.
   */
  async function resumenPorRol() {
    const [porRol] = await db.query(
      `SELECT r.codigo, r.nombre,
              SUM(CASE WHEN u.activo THEN 1 ELSE 0 END) AS activos,
              COUNT(u.id) AS total
         FROM roles r
         LEFT JOIN usuario_roles ur ON ur.rol_id = r.id
         LEFT JOIN usuarios u ON u.id = ur.usuario_id
        WHERE r.activo = TRUE
        GROUP BY r.id, r.codigo, r.nombre
        ORDER BY r.id`
    );

    const [[totales]] = await db.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN activo THEN 1 ELSE 0 END) AS activos
         FROM usuarios`
    );

    return {
      total: Number(totales.total),
      activos: Number(totales.activos),
      // Un usuario con dos roles cuenta en las dos tarjetas: son cortes, no una
      // partición. Por eso la suma de las tarjetas puede superar el total.
      porRol: porRol.map((f) => ({
        codigo: f.codigo,
        nombre: f.nombre,
        activos: Number(f.activos),
        total: Number(f.total),
      })),
    };
  }

  async function reclutadoresActivos() {
    const [filas] = await db.query(
      `SELECT u.id, u.nombre_completo, u.email,
              (SELECT COUNT(*) FROM candidatos c WHERE c.reclutador_id = u.id) AS cartera
         FROM usuarios u
         JOIN usuario_roles ur ON ur.usuario_id = u.id
         JOIN roles r ON r.id = ur.rol_id AND r.codigo = 'reclutamiento'
        WHERE u.activo = TRUE
        GROUP BY u.id, u.nombre_completo, u.email
        ORDER BY u.nombre_completo`
    );
    return filas.map((f) => ({
      id: f.id,
      nombreCompleto: f.nombre_completo,
      email: f.email,
      cartera: Number(f.cartera),
    }));
  }

  async function esReclutadorActivo(id) {
    const [filas] = await db.query(
      `SELECT 1 FROM usuarios u
         JOIN usuario_roles ur ON ur.usuario_id = u.id
         JOIN roles r ON r.id = ur.rol_id AND r.codigo = 'reclutamiento'
        WHERE u.id = ? AND u.activo = TRUE LIMIT 1`,
      [id]
    );
    return filas.length > 0;
  }

  async function crear({ nombreCompleto, email, passwordHash, numeroDocumento }) {
    const [resultado] = await db.query(
      `INSERT INTO usuarios (nombre_completo, email, password_hash, numero_documento)
       VALUES (?, ?, ?, ?)`,
      [nombreCompleto, email, passwordHash, numeroDocumento ?? null]
    );
    return resultado.insertId;
  }

  async function actualizar(id, campos) {
    const columnas = {
      nombreCompleto: 'nombre_completo',
      email: 'email',
      numeroDocumento: 'numero_documento',
      activo: 'activo',
    };

    const asignaciones = [];
    const valores = [];
    for (const [clave, columna] of Object.entries(columnas)) {
      if (campos[clave] !== undefined) {
        asignaciones.push(`${columna} = ?`);
        valores.push(campos[clave]);
      }
    }
    if (asignaciones.length === 0) return false;

    const [resultado] = await db.query(
      `UPDATE usuarios SET ${asignaciones.join(', ')} WHERE id = ?`,
      [...valores, id]
    );
    return resultado.affectedRows > 0;
  }

  async function actualizarPassword(id, passwordHash) {
    const [resultado] = await db.query(
      'UPDATE usuarios SET password_hash = ? WHERE id = ?',
      [passwordHash, id]
    );
    return resultado.affectedRows > 0;
  }

  async function registrarUltimoAcceso(id) {
    await db.query('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?', [id]);
  }

  /** Baja lógica: un usuario nunca se borra, se desactiva. */
  async function desactivar(id) {
    const [resultado] = await db.query(
      'UPDATE usuarios SET activo = FALSE WHERE id = ? AND activo = TRUE',
      [id]
    );
    return resultado.affectedRows > 0;
  }

  /** Reemplaza el conjunto de roles del usuario. Debe correr en transacción. */
  async function reemplazarRoles(usuarioId, rolIds, asignadoPorId = null) {
    await db.query('DELETE FROM usuario_roles WHERE usuario_id = ?', [usuarioId]);
    if (rolIds.length === 0) return;

    await db.query(
      `INSERT INTO usuario_roles (usuario_id, rol_id, asignado_por_id) VALUES ${rolIds
        .map(() => '(?, ?, ?)')
        .join(', ')}`,
      rolIds.flatMap((rolId) => [usuarioId, rolId, asignadoPorId])
    );
  }

  return {
    obtenerContextoAutenticacion,
    buscarCredencialesPorEmail,
    obtenerHashPassword,
    buscarPorId,
    existeEmail,
    listar,
    crear,
    actualizar,
    actualizarPassword,
    registrarUltimoAcceso,
    desactivar,
    reemplazarRoles,
    resumenPorRol,
    reclutadoresActivos,
    esReclutadorActivo,
  };
}

/** MySQL devuelve JSON_ARRAYAGG como string o como array según el driver/versión. */
function parsearJson(valor) {
  if (Array.isArray(valor)) return valor;
  if (typeof valor === 'string') return JSON.parse(valor);
  return [];
}

function normalizarContexto(fila) {
  return {
    id: fila.id,
    nombreCompleto: fila.nombre_completo,
    email: fila.email,
    numeroDocumento: fila.numero_documento,
    roles: parsearJson(fila.roles),
    permisos: parsearJson(fila.permisos),
  };
}

module.exports = { crearUsuarioRepositorio };
