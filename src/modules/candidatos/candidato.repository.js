'use strict';

/** Repositorio de candidatos: todo el SQL del módulo. */

const { contiene, identificadorSeguro } = require('../../shared/utils/sql');

const ORDEN_PERMITIDO = ['created_at', 'updated_at', 'primer_apellido'];

const SELECT_BASE = `
  SELECT c.id, c.primer_nombre, c.segundo_nombre, c.primer_apellido, c.segundo_apellido,
         c.numero_documento, c.edad, c.email, c.celular,
         c.contacto_llamada, c.contacto_whatsapp,
         c.observaciones_generales, c.perfil, c.citado, c.reclutador_id,
         c.created_at, c.updated_at,
         td.codigo AS tipo_documento, td.nacionalidad,
         cl.codigo AS cliente, ca.codigo AS cargo,
         ci.codigo AS ciudad, fr.codigo AS fuente_reclutamiento,
         tl.codigo AS tipificacion_llamada, eg.codigo AS estado_gestion,
         ec.codigo AS estado, ec.nombre AS estado_nombre, ec.etapa AS estado_etapa,
         u.nombre_completo AS reclutador_nombre, u.email AS reclutador_email,
         -- Progreso del formulario del candidato: la columna "N/6" que el
         -- listado viejo pintaba como barra. Es un COUNT sobre una tabla
         -- indexada por candidato, no una consulta por fila del listado.
         (SELECT COUNT(*) FROM candidato_formulario_pasos p
           WHERE p.candidato_id = c.id) AS pasos_completados,
         -- Evaluación y decisión final: las columnas de las pantallas de
         -- perfiles aprobados y rechazados del sistema viejo.
         ev.total AS evaluacion_total, ev.total_maximo AS evaluacion_maximo,
         ev.porcentaje AS evaluacion_porcentaje,
         eva.aprobado AS evaluacion_aprobado, eva.razon_rechazo AS evaluacion_razon,
         eva.created_at AS fecha_evaluacion,
         df.aprobacion AS decision_aprobacion, df.razon AS decision_razon,
         df.created_at AS fecha_decision, psi.nombre_completo AS decision_psicologo
    FROM candidatos c
    JOIN tipos_documento td   ON td.id = c.tipo_documento_id
    JOIN clientes cl          ON cl.id = c.cliente_id
    JOIN cargos ca            ON ca.id = c.cargo_id
    JOIN estados_candidato ec ON ec.id = c.estado_id
    LEFT JOIN ciudades ci     ON ci.id = c.ciudad_id
    LEFT JOIN fuentes_reclutamiento fr ON fr.id = c.fuente_reclutamiento_id
    LEFT JOIN tipificaciones_llamada tl ON tl.id = c.tipificacion_llamada_id
    LEFT JOIN estados_gestion_reclutamiento eg ON eg.id = c.estado_gestion_id
    LEFT JOIN usuarios u      ON u.id = c.reclutador_id
    -- Última evaluación del candidato: la tabla es 1:N porque se puede reevaluar.
    LEFT JOIN candidato_evaluaciones eva
           ON eva.id = (SELECT e.id FROM candidato_evaluaciones e
                         WHERE e.candidato_id = c.id
                         ORDER BY e.created_at DESC, e.id DESC LIMIT 1)
    LEFT JOIN v_evaluacion_totales ev ON ev.evaluacion_id = eva.id
    LEFT JOIN candidato_decision_final df ON df.candidato_id = c.id
    LEFT JOIN usuarios psi    ON psi.id = df.psicologo_id
`;

function crearCandidatoRepositorio({ db }) {
  async function crear(datos) {
    const [res] = await db.query(
      `INSERT INTO candidatos
         (primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
          tipo_documento_id, numero_documento, edad, email, celular,
          contacto_llamada, contacto_whatsapp,
          cliente_id, cargo_id, ciudad_id, fuente_reclutamiento_id,
          tipificacion_llamada_id, estado_gestion_id, observaciones_generales,
          perfil, citado, estado_id, reclutador_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        datos.primerNombre, datos.segundoNombre, datos.primerApellido, datos.segundoApellido,
        datos.tipoDocumentoId, datos.numeroDocumento, datos.edad, datos.email, datos.celular,
        datos.contactoLlamada, datos.contactoWhatsapp,
        datos.clienteId, datos.cargoId, datos.ciudadId, datos.fuenteReclutamientoId,
        datos.tipificacionLlamadaId, datos.estadoGestionId, datos.observacionesGenerales,
        datos.perfil, datos.citado, datos.estadoId, datos.reclutadorId,
      ]
    );
    return res.insertId;
  }

  async function buscarPorId(id) {
    const [filas] = await db.query(`${SELECT_BASE} WHERE c.id = ?`, [id]);
    return filas[0] ?? null;
  }

  async function existeDocumento(numeroDocumento, exceptoId = null) {
    if (!numeroDocumento) return false;
    const [filas] = await db.query(
      `SELECT 1 FROM candidatos WHERE numero_documento = ? ${exceptoId ? 'AND id <> ?' : ''} LIMIT 1`,
      exceptoId ? [numeroDocumento, exceptoId] : [numeroDocumento]
    );
    return filas.length > 0;
  }

  /**
   * @param {object} filtros
   * @param {{sql: string|null, params: unknown[]}} filtros.visibilidad Filtro por dueño ya resuelto.
   */
  async function listar({ pagina, porPagina, busqueda, estado, cliente, agentes, visibilidad, ordenarPor, direccion }) {
    const condiciones = [];
    const params = [];

    if (visibilidad.sql) {
      condiciones.push(visibilidad.sql);
      params.push(...visibilidad.params);
    }
    if (estado) {
      condiciones.push('ec.codigo = ?');
      params.push(estado);
    }
    if (cliente) {
      condiciones.push('cl.codigo = ?');
      params.push(cliente);
    }
    if (agentes) {
      condiciones.push('ca.codigo LIKE ?');
      params.push('%agente%');
    }
    if (busqueda) {
      condiciones.push(
        `(c.primer_nombre LIKE ? ESCAPE '\\\\' OR c.primer_apellido LIKE ? ESCAPE '\\\\'
          OR c.numero_documento LIKE ? ESCAPE '\\\\' OR c.email LIKE ? ESCAPE '\\\\'
          OR c.celular LIKE ? ESCAPE '\\\\')`
      );
      const p = contiene(busqueda);
      params.push(p, p, p, p, p);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const columna = identificadorSeguro(ordenarPor, ORDEN_PERMITIDO);
    const sentido = direccion === 'asc' ? 'ASC' : 'DESC';

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
         FROM candidatos c
         JOIN clientes cl ON cl.id = c.cliente_id
         JOIN cargos ca ON ca.id = c.cargo_id
         JOIN estados_candidato ec ON ec.id = c.estado_id
         ${where}`,
      params
    );

    const [items] = await db.query(
      `${SELECT_BASE} ${where} ORDER BY c.${columna} ${sentido}, c.id DESC LIMIT ? OFFSET ?`,
      [...params, porPagina, (pagina - 1) * porPagina]
    );

    return { items, total };
  }

  /** Conteo por estado, respetando la visibilidad. Alimenta las pestañas del frontend. */
  async function resumenPorEstado({ visibilidad }) {
    // El filtro por dueño va en el ON del LEFT JOIN, no en el WHERE: así los
    // estados sin candidatos siguen apareciendo con total 0 y el frontend puede
    // pintar todas las pestañas.
    const [filas] = await db.query(
      `SELECT ec.codigo AS estado, ec.nombre, ec.etapa, COUNT(c.id) AS total
         FROM estados_candidato ec
         LEFT JOIN candidatos c
                ON c.estado_id = ec.id
               ${visibilidad.sql ? `AND ${visibilidad.sql}` : ''}
        WHERE ec.activo = TRUE
        GROUP BY ec.id, ec.codigo, ec.nombre, ec.etapa, ec.orden
        ORDER BY ec.orden`,
      visibilidad.params
    );
    return filas;
  }

  async function actualizar(id, campos) {
    const columnas = {
      primerNombre: 'primer_nombre', segundoNombre: 'segundo_nombre',
      primerApellido: 'primer_apellido', segundoApellido: 'segundo_apellido',
      tipoDocumentoId: 'tipo_documento_id', numeroDocumento: 'numero_documento',
      edad: 'edad', email: 'email', celular: 'celular',
      contactoLlamada: 'contacto_llamada', contactoWhatsapp: 'contacto_whatsapp',
      clienteId: 'cliente_id', cargoId: 'cargo_id', ciudadId: 'ciudad_id',
      fuenteReclutamientoId: 'fuente_reclutamiento_id',
      tipificacionLlamadaId: 'tipificacion_llamada_id',
      estadoGestionId: 'estado_gestion_id',
      observacionesGenerales: 'observaciones_generales',
      perfil: 'perfil', citado: 'citado',
      reclutadorId: 'reclutador_id',
    };

    const sets = [];
    const valores = [];
    for (const [clave, columna] of Object.entries(columnas)) {
      if (campos[clave] !== undefined) {
        sets.push(`${columna} = ?`);
        valores.push(campos[clave]);
      }
    }
    if (sets.length === 0) return false;

    const [res] = await db.query(
      `UPDATE candidatos SET ${sets.join(', ')} WHERE id = ?`,
      [...valores, id]
    );
    return res.affectedRows > 0;
  }

  async function actualizarEstado(id, estadoId) {
    const [res] = await db.query('UPDATE candidatos SET estado_id = ? WHERE id = ?', [estadoId, id]);
    return res.affectedRows > 0;
  }

  async function registrarHistorial({ candidatoId, estadoAnteriorId, estadoNuevoId, usuarioId, motivo }) {
    await db.query(
      `INSERT INTO candidato_estado_historial
         (candidato_id, estado_anterior_id, estado_nuevo_id, usuario_id, motivo)
       VALUES (?,?,?,?,?)`,
      [candidatoId, estadoAnteriorId, estadoNuevoId, usuarioId ?? null, motivo ?? null]
    );
  }

  async function historial(candidatoId) {
    const [filas] = await db.query(
      `SELECT h.id, h.motivo, h.created_at,
              ea.codigo AS estado_anterior, en.codigo AS estado_nuevo,
              u.nombre_completo AS usuario
         FROM candidato_estado_historial h
         JOIN estados_candidato en ON en.id = h.estado_nuevo_id
         LEFT JOIN estados_candidato ea ON ea.id = h.estado_anterior_id
         LEFT JOIN usuarios u ON u.id = h.usuario_id
        WHERE h.candidato_id = ?
        ORDER BY h.created_at, h.id`,
      [candidatoId]
    );
    return filas;
  }

  async function registrarAsignacion({ candidatoId, anteriorId, nuevoId, asignadoPorId, motivo }) {
    await db.query(
      `INSERT INTO candidato_asignaciones
         (candidato_id, reclutador_anterior_id, reclutador_nuevo_id, asignado_por_id, motivo)
       VALUES (?,?,?,?,?)`,
      [candidatoId, anteriorId ?? null, nuevoId ?? null, asignadoPorId ?? null, motivo ?? null]
    );
  }

  /**
   * Reasigna en bloque todos los candidatos de un reclutador a otro.
   *
   * Se usa antes de dar de baja a alguien, para que su cartera no quede
   * huérfana. Devuelve los ids afectados para poder dejar la traza individual.
   */
  async function idsDeReclutador(reclutadorId) {
    const [filas] = await db.query(
      'SELECT id FROM candidatos WHERE reclutador_id = ?',
      [reclutadorId]
    );
    return filas.map((f) => f.id);
  }

  async function reasignarTodos(origenId, destinoId) {
    const [res] = await db.query(
      'UPDATE candidatos SET reclutador_id = ? WHERE reclutador_id = ?',
      [destinoId, origenId]
    );
    return res.affectedRows;
  }

  /** Pasos del formulario ya completados. Sustituye 12 columnas del esquema viejo. */
  async function pasosCompletados(candidatoId) {
    const [filas] = await db.query(
      'SELECT paso, completado_en FROM candidato_formulario_pasos WHERE candidato_id = ?',
      [candidatoId]
    );
    return filas;
  }

  return {
    crear, buscarPorId, existeDocumento, listar, resumenPorEstado,
    actualizar, actualizarEstado, registrarHistorial, historial,
    registrarAsignacion, pasosCompletados, idsDeReclutador, reasignarTodos,
  };
}

/** Carga el grafo de estados y transiciones. Separado porque es catálogo, no candidato. */
function crearEstadoRepositorio({ db }) {
  return {
    async cargarGrafo() {
      const [estados] = await db.query(
        'SELECT id, codigo, nombre, etapa, es_terminal FROM estados_candidato'
      );
      const [aristas] = await db.query(
        `SELECT o.codigo AS origen, d.codigo AS destino, t.requiere_motivo
           FROM estado_transiciones t
           JOIN estados_candidato o ON o.id = t.estado_origen_id
           JOIN estados_candidato d ON d.id = t.estado_destino_id`
      );

      const porCodigo = new Map(estados.map((e) => [e.codigo, e]));
      const transiciones = new Map();
      for (const a of aristas) {
        if (!transiciones.has(a.origen)) transiciones.set(a.origen, new Map());
        transiciones.get(a.origen).set(a.destino, { requiereMotivo: Boolean(a.requiere_motivo) });
      }
      return { porCodigo, transiciones };
    },
  };
}

module.exports = { crearCandidatoRepositorio, crearEstadoRepositorio };
