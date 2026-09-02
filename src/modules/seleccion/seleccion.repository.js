'use strict';

/** Repositorio de citaciones, evaluaciones y decisión final. */

/**
 * El driver devuelve DECIMAL como string, a propósito: convertirlo a número en
 * el pool arriesgaría precisión en columnas de dinero (salario, aspiración
 * salarial), donde un redondeo silencioso sí importa.
 *
 * Los puntajes no tienen ese problema —están acotados entre 0 y 100— y el
 * cliente hace aritmética y comparaciones con ellos, así que se convierten aquí
 * en vez de obligar a cada consumidor a acordarse.
 */
function aNumero(valor) {
  return valor === null || valor === undefined ? null : Number(valor);
}

function normalizarPuntajes(fila) {
  if (!fila) return fila;
  const copia = { ...fila };
  for (const campo of ['total', 'total_maximo', 'porcentaje', 'puntaje', 'puntaje_maximo']) {
    if (campo in copia) copia[campo] = aNumero(copia[campo]);
  }
  return copia;
}

function crearSeleccionRepositorio({ db }) {
  // ------------------------------------------------------------ citaciones --
  // Citar ya no lleva fecha de entrevista (migración 009): `created_at` guarda
  // la fecha en que se citó, y es la que ordena y filtra en toda la agenda.
  async function crearCitacion({ candidatoId, agendadoPorId }) {
    const [res] = await db.query(
      `INSERT INTO candidato_citaciones (candidato_id, agendado_por_id) VALUES (?,?)`,
      [candidatoId, agendadoPorId]
    );
    return res.insertId;
  }

  /** Citación vigente: la más reciente que sigue pendiente de resolver. */
  async function citacionPendiente(candidatoId) {
    const [filas] = await db.query(
      `SELECT * FROM candidato_citaciones
        WHERE candidato_id = ? AND asistio = 'pendiente'
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [candidatoId]
    );
    return filas[0] ?? null;
  }

  async function citacionesDe(candidatoId) {
    const [filas] = await db.query(
      `SELECT c.id, c.created_at AS fecha_citado, c.asistio, c.fecha_asistencia, c.observaciones,
              c.seguimiento_llamada, c.seguimiento_whatsapp,
              mi.nombre AS motivo_inasistencia, c.motivo_inasistencia_detalle,
              ag.nombre_completo AS agendado_por, rg.nombre_completo AS registrado_por
         FROM candidato_citaciones c
         LEFT JOIN motivos_inasistencia mi ON mi.id = c.motivo_inasistencia_id
         LEFT JOIN usuarios ag ON ag.id = c.agendado_por_id
         LEFT JOIN usuarios rg ON rg.id = c.registrado_por_id
        WHERE c.candidato_id = ?
        ORDER BY c.created_at DESC, c.id DESC`,
      [candidatoId]
    );
    return filas;
  }

  async function registrarAsistencia(citacionId, { asistio, motivoId, detalle, observaciones, registradoPorId }) {
    const [res] = await db.query(
      `UPDATE candidato_citaciones
          SET asistio = ?, fecha_asistencia = NOW(), motivo_inasistencia_id = ?,
              motivo_inasistencia_detalle = ?, observaciones = ?, registrado_por_id = ?
        WHERE id = ? AND asistio = 'pendiente'`,
      [asistio, motivoId ?? null, detalle ?? null, observaciones ?? null, registradoPorId, citacionId]
    );
    return res.affectedRows > 0;
  }

  /**
   * Seguimiento antes de la entrevista: si el candidato respondió la llamada
   * y/o el mensaje de WhatsApp/Global de confirmación.
   *
   * `llamada`/`whatsapp` son independientes entre sí y opcionales: se puede
   * registrar el resultado de un solo canal sin tocar el otro (COALESCE deja
   * intacto el que no se manda). Solo aplica mientras la citación sigue
   * pendiente, igual que `registrarAsistencia`.
   */
  async function registrarSeguimiento(citacionId, { llamada, whatsapp }) {
    const [res] = await db.query(
      `UPDATE candidato_citaciones
          SET seguimiento_llamada = COALESCE(?, seguimiento_llamada),
              seguimiento_whatsapp = COALESCE(?, seguimiento_whatsapp)
        WHERE id = ? AND asistio = 'pendiente'`,
      [llamada ?? null, whatsapp ?? null, citacionId]
    );
    return res.affectedRows > 0;
  }

  /** Agenda: candidatos con citación, respetando la visibilidad del solicitante. */
  async function agenda({ desde, hasta, asistio, visibilidad, pagina, porPagina }) {
    const condiciones = ['1 = 1'];
    const params = [];

    if (visibilidad.sql) {
      condiciones.push(visibilidad.sql);
      params.push(...visibilidad.params);
    }
    if (desde) { condiciones.push('ci.created_at >= ?'); params.push(`${desde} 00:00:00`); }
    if (hasta) { condiciones.push('ci.created_at <= ?'); params.push(`${hasta} 23:59:59`); }
    if (asistio) { condiciones.push('ci.asistio = ?'); params.push(asistio); }

    const where = `WHERE ${condiciones.join(' AND ')}`;

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM candidato_citaciones ci
         JOIN candidatos c ON c.id = ci.candidato_id ${where}`,
      params
    );

    const [items] = await db.query(
      `SELECT ci.id AS citacion_id, ci.created_at AS fecha_citado, ci.asistio, ci.fecha_asistencia,
              ci.seguimiento_llamada, ci.seguimiento_whatsapp,
              c.id AS candidato_id, c.primer_nombre, c.primer_apellido,
              c.numero_documento, c.celular, c.email,
              cl.codigo AS cliente, ca.codigo AS cargo,
              ec.codigo AS estado, ec.nombre AS estado_nombre,
              u.nombre_completo AS reclutador,
              -- Columna "Evaluación" de la pantalla vieja de selección: el
              -- puntaje de la entrevista, para no tener que abrir cada perfil.
              ev.total AS evaluacion_total, ev.total_maximo AS evaluacion_maximo,
              ev.porcentaje AS evaluacion_porcentaje, eva.aprobado AS evaluacion_aprobado
         FROM candidato_citaciones ci
         JOIN candidatos c ON c.id = ci.candidato_id
         JOIN clientes cl ON cl.id = c.cliente_id
         JOIN cargos ca ON ca.id = c.cargo_id
         JOIN estados_candidato ec ON ec.id = c.estado_id
         LEFT JOIN usuarios u ON u.id = c.reclutador_id
         -- Evaluación de ESTA citación, no la última del candidato: si se le
         -- reagendó y evaluó dos veces, cada fila debe mostrar la suya.
         LEFT JOIN candidato_evaluaciones eva ON eva.citacion_id = ci.id
         LEFT JOIN v_evaluacion_totales ev ON ev.evaluacion_id = eva.id
         ${where}
        ORDER BY ci.created_at DESC, ci.id DESC
        LIMIT ? OFFSET ?`,
      [...params, porPagina, (pagina - 1) * porPagina]
    );

    return { items, total };
  }

  // ---------------------------------------------------------- evaluaciones --
  async function crearEvaluacion({ candidatoId, citacionId, evaluadorId, aprobado, razonRechazo }) {
    const [res] = await db.query(
      `INSERT INTO candidato_evaluaciones
         (candidato_id, citacion_id, evaluador_id, aprobado, razon_rechazo)
       VALUES (?,?,?,?,?)`,
      [candidatoId, citacionId ?? null, evaluadorId, aprobado, razonRechazo ?? null]
    );
    return res.insertId;
  }

  async function guardarPuntajes(evaluacionId, puntajes) {
    await db.query(
      `INSERT INTO evaluacion_puntajes (evaluacion_id, criterio_id, puntaje)
       VALUES ${puntajes.map(() => '(?,?,?)').join(', ')}`,
      puntajes.flatMap((p) => [evaluacionId, p.criterioId, p.puntaje])
    );
  }

  /** Criterios activos, con su puntaje máximo. Son datos, no columnas. */
  async function criteriosActivos() {
    const [filas] = await db.query(
      'SELECT id, codigo, nombre, puntaje_maximo FROM criterios_evaluacion WHERE activo = TRUE ORDER BY orden'
    );
    return filas.map(normalizarPuntajes);
  }

  /** El total sale de la vista: es la suma de los puntajes, no un dato guardado. */
  async function evaluacionConTotal(evaluacionId) {
    const [filas] = await db.query(
      `SELECT e.id, e.candidato_id, e.aprobado, e.razon_rechazo, e.created_at,
              t.total, t.total_maximo, t.porcentaje,
              u.nombre_completo AS evaluador
         FROM candidato_evaluaciones e
         LEFT JOIN v_evaluacion_totales t ON t.evaluacion_id = e.id
         LEFT JOIN usuarios u ON u.id = e.evaluador_id
        WHERE e.id = ?`,
      [evaluacionId]
    );
    return normalizarPuntajes(filas[0]) ?? null;
  }

  async function evaluacionesDe(candidatoId) {
    const [filas] = await db.query(
      `SELECT e.id, e.aprobado, e.razon_rechazo, e.created_at,
              t.total, t.total_maximo, t.porcentaje,
              u.nombre_completo AS evaluador
         FROM candidato_evaluaciones e
         LEFT JOIN v_evaluacion_totales t ON t.evaluacion_id = e.id
         LEFT JOIN usuarios u ON u.id = e.evaluador_id
        WHERE e.candidato_id = ?
        ORDER BY e.created_at DESC`,
      [candidatoId]
    );
    return filas.map(normalizarPuntajes);
  }

  async function puntajesDe(evaluacionId) {
    const [filas] = await db.query(
      `SELECT c.codigo, c.nombre, p.puntaje, c.puntaje_maximo
         FROM evaluacion_puntajes p
         JOIN criterios_evaluacion c ON c.id = p.criterio_id
        WHERE p.evaluacion_id = ? ORDER BY c.orden`,
      [evaluacionId]
    );
    return filas.map(normalizarPuntajes);
  }

  // -------------------------------------------------------- decisión final --
  async function guardarDecisionFinal({ candidatoId, aprobacion, razon, psicologoId }) {
    await db.query(
      `INSERT INTO candidato_decision_final (candidato_id, aprobacion, razon, psicologo_id)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE
         aprobacion = VALUES(aprobacion), razon = VALUES(razon),
         psicologo_id = VALUES(psicologo_id)`,
      [candidatoId, aprobacion, razon ?? null, psicologoId]
    );
  }

  async function decisionFinalDe(candidatoId) {
    const [filas] = await db.query(
      `SELECT d.aprobacion, d.razon, d.created_at, d.updated_at,
              u.nombre_completo AS psicologo
         FROM candidato_decision_final d
         LEFT JOIN usuarios u ON u.id = d.psicologo_id
        WHERE d.candidato_id = ?`,
      [candidatoId]
    );
    return filas[0] ?? null;
  }

  return {
    crearCitacion, citacionPendiente, citacionesDe, registrarAsistencia, registrarSeguimiento, agenda,
    crearEvaluacion, guardarPuntajes, criteriosActivos, evaluacionConTotal,
    evaluacionesDe, puntajesDe,
    guardarDecisionFinal, decisionFinalDe,
  };
}

module.exports = { crearSeleccionRepositorio };
