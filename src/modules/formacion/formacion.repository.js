'use strict';

/** Repositorio del rol Formación: todo el SQL del módulo. */

const { ULTIMA_FIRMA } = require('../contratacion/contratacion.repository');

// Los alias de elegibilidad (estado, cargo, citado_formacion, contratacion,
// asistio_formacion, estado_formacion, contratacion_lote_id, firma_*) son los
// mismos que usa `contratacion.repository.js`, para aplicar `motivoNoElegible`
// tal cual.
const SELECT_FORMACION = `
  SELECT c.id, c.primer_nombre, c.segundo_nombre, c.primer_apellido, c.segundo_apellido,
         c.numero_documento,
         cl.nombre AS cliente, ca.nombre AS cargo, ec.codigo AS estado,
         df.created_at AS fecha_decision,
         cf.citado AS citado_formacion, cf.created_at AS fecha_citacion_formacion,
         ctr.contratado AS contratacion, ctr.created_at AS fecha_contratacion,
         fo.asistio AS asistio_formacion, fo.razon_inasistencia, fo.asistencia_en,
         ua.nombre_completo AS asistencia_usuario,
         fo.estado AS estado_formacion, fo.razon_baja, fo.estado_en,
         ue.nombre_completo AS estado_usuario,
         cc.lote_id AS contratacion_lote_id,
         fi.id AS firma_id, fi.referencia_externa AS firma_referencia, fi.estado AS firma_estado
    FROM candidatos c
    JOIN clientes cl          ON cl.id = c.cliente_id
    JOIN cargos ca            ON ca.id = c.cargo_id
    JOIN estados_candidato ec ON ec.id = c.estado_id
    LEFT JOIN candidato_decision_final df     ON df.candidato_id = c.id
    LEFT JOIN candidato_citacion_formacion cf ON cf.candidato_id = c.id
    LEFT JOIN candidato_contratacion ctr      ON ctr.candidato_id = c.id
    LEFT JOIN candidato_formacion fo          ON fo.candidato_id = c.id
    LEFT JOIN usuarios ua                     ON ua.id = fo.asistencia_usuario_id
    LEFT JOIN usuarios ue                     ON ue.id = fo.estado_usuario_id
    LEFT JOIN contratacion_candidatos cc      ON cc.candidato_id = c.id
    LEFT JOIN candidato_firmas fi             ON fi.id = ${ULTIMA_FIRMA}
`;

function crearFormacionRepositorio({ db }) {
  /**
   * Aprobados finales con citación a formación o contratación, todavía sin
   * enviar a contratación. El filtro fino (Agente → citación, Staff →
   * contratación) lo aplica `enFormacion` sobre cada fila, para no tener la
   * regla en dos lugares.
   */
  async function pendientesDeEnviar() {
    const [filas] = await db.query(
      `${SELECT_FORMACION}
       WHERE ec.codigo = 'aprobado_final'
         AND (cf.citado = TRUE OR ctr.contratado = TRUE)
         AND cc.candidato_id IS NULL
       ORDER BY COALESCE(cf.created_at, ctr.created_at) DESC, c.id DESC`
    );
    return filas;
  }

  async function buscar(candidatoId, { paraActualizar = false } = {}) {
    const [filas] = await db.query(
      `${SELECT_FORMACION} WHERE c.id = ? ${paraActualizar ? 'FOR UPDATE OF c' : ''}`,
      [candidatoId]
    );
    return filas[0] ?? null;
  }

  async function guardarAsistencia({ candidatoId, asistio, razon, usuarioId }) {
    await db.query(
      `INSERT INTO candidato_formacion
         (candidato_id, asistio, razon_inasistencia, asistencia_usuario_id, asistencia_en)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         asistio = VALUES(asistio), razon_inasistencia = VALUES(razon_inasistencia),
         asistencia_usuario_id = VALUES(asistencia_usuario_id), asistencia_en = CURRENT_TIMESTAMP`,
      [candidatoId, asistio, asistio ? null : razon, usuarioId]
    );
  }

  async function guardarEstado({ candidatoId, estado, razon, usuarioId }) {
    await db.query(
      `INSERT INTO candidato_formacion
         (candidato_id, estado, razon_baja, estado_usuario_id, estado_en)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         estado = VALUES(estado), razon_baja = VALUES(razon_baja),
         estado_usuario_id = VALUES(estado_usuario_id), estado_en = CURRENT_TIMESTAMP`,
      [candidatoId, estado, estado === 'baja' ? razon : null, usuarioId]
    );
  }

  async function limpiarEstado(candidatoId) {
    await db.query(
      `UPDATE candidato_formacion
          SET estado = NULL, razon_baja = NULL, estado_usuario_id = NULL, estado_en = NULL
        WHERE candidato_id = ?`,
      [candidatoId]
    );
  }

  return { pendientesDeEnviar, buscar, guardarAsistencia, guardarEstado, limpiarEstado };
}

module.exports = { crearFormacionRepositorio };
