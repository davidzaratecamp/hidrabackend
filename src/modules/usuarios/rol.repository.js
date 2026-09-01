'use strict';

/** Repositorio de roles y permisos. Solo lectura: el catálogo se administra por seed/migración. */

function crearRolRepositorio({ db }) {
  async function listarRoles({ soloActivos = true } = {}) {
    const [filas] = await db.query(
      `SELECT r.id, r.codigo, r.nombre, r.descripcion, r.activo,
              COUNT(rp.permiso_id) AS total_permisos
         FROM roles r
         LEFT JOIN rol_permisos rp ON rp.rol_id = r.id
        ${soloActivos ? 'WHERE r.activo = TRUE' : ''}
        GROUP BY r.id
        ORDER BY r.id`
    );
    return filas;
  }

  async function listarPermisos() {
    const [filas] = await db.query(
      'SELECT id, codigo, nombre, descripcion, modulo FROM permisos ORDER BY modulo, codigo'
    );
    return filas;
  }

  async function permisosDeRol(rolId) {
    const [filas] = await db.query(
      `SELECT p.codigo, p.nombre, p.modulo
         FROM rol_permisos rp
         JOIN permisos p ON p.id = rp.permiso_id
        WHERE rp.rol_id = ?
        ORDER BY p.modulo, p.codigo`,
      [rolId]
    );
    return filas;
  }

  /**
   * Traduce códigos de rol a ids, ignorando los inactivos.
   * Devolver menos ids que códigos recibidos es la señal de que alguno no existe.
   */
  async function idsPorCodigos(codigos) {
    if (codigos.length === 0) return [];
    const [filas] = await db.query(
      `SELECT id, codigo FROM roles
        WHERE activo = TRUE AND codigo IN (${codigos.map(() => '?').join(', ')})`,
      codigos
    );
    return filas;
  }

  return { listarRoles, listarPermisos, permisosDeRol, idsPorCodigos };
}

module.exports = { crearRolRepositorio };
