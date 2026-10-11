'use strict';

/** Repositorio de la integración con Gestor: todo el SQL del módulo. */

// Todo lo que se envía de un candidato, con los catálogos por CÓDIGO. Las
// banderas de elegibilidad (citado a formación / contratación / asistencia y
// activo en formación) vienen de las tablas informativas de las migraciones
// 015, 016 y 019.
const SELECT_DATOS = `
  SELECT c.id, c.primer_nombre, c.segundo_nombre, c.primer_apellido, c.segundo_apellido,
         c.numero_documento, c.email, c.celular,
         td.codigo AS tipo_documento, cl.codigo AS cliente, ca.codigo AS cargo,
         ec.codigo AS estado,
         db.fecha_nacimiento, db.direccion_residencial, db.barrio,
         db.nombre_emergencia, db.numero_emergencia,
         ge.codigo AS genero, ecv.codigo AS estado_civil, gs.codigo AS grupo_sanguineo,
         e.codigo AS eps, a.codigo AS afp, pa.codigo AS parentesco_emergencia,
         tc.codigo AS talla_camisa,
         cons.fecha AS fecha_consentimiento, cons.ciudad AS ciudad_consentimiento,
         df.created_at AS fecha_decision,
         cf.citado AS citado_formacion, ctr.contratado AS contratacion,
         fo.asistio AS asistio_formacion, fo.estado AS estado_formacion,
         cc.lote_id AS contratacion_lote_id
    FROM candidatos c
    JOIN tipos_documento td   ON td.id = c.tipo_documento_id
    JOIN clientes cl          ON cl.id = c.cliente_id
    JOIN cargos ca            ON ca.id = c.cargo_id
    JOIN estados_candidato ec ON ec.id = c.estado_id
    LEFT JOIN candidato_datos_basicos db ON db.candidato_id = c.id
    LEFT JOIN generos ge          ON ge.id = db.genero_id
    LEFT JOIN estados_civiles ecv ON ecv.id = db.estado_civil_id
    LEFT JOIN grupos_sanguineos gs ON gs.id = db.grupo_sanguineo_id
    LEFT JOIN eps e               ON e.id = db.eps_id
    LEFT JOIN afp a               ON a.id = db.afp_id
    LEFT JOIN parentescos pa      ON pa.id = db.parentesco_emergencia_id
    LEFT JOIN tallas_camisa tc    ON tc.id = db.talla_camisa_id
    LEFT JOIN candidato_consentimiento cons ON cons.candidato_id = c.id
    LEFT JOIN candidato_decision_final df   ON df.candidato_id = c.id
    LEFT JOIN candidato_citacion_formacion cf ON cf.candidato_id = c.id
    LEFT JOIN candidato_contratacion ctr    ON ctr.candidato_id = c.id
    LEFT JOIN candidato_formacion fo        ON fo.candidato_id = c.id
    LEFT JOIN contratacion_candidatos cc    ON cc.candidato_id = c.id
`;

function crearContratacionRepositorio({ db }) {
  // ------------------------------------------------------------ candidatos ----
  async function datosParaEnvio(candidatoId) {
    const [filas] = await db.query(`${SELECT_DATOS} WHERE c.id = ?`, [candidatoId]);
    return filas[0] ?? null;
  }

  /**
   * Candidatos que hoy se pueden enviar. El filtro grueso va en SQL (aprobados
   * finales nunca enviados); la regla fina —Agente vs. Staff— la aplica
   * `motivoNoElegible` sobre cada fila, para no tener la regla en dos lugares.
   */
  async function candidatosAprobadosNoEnviados() {
    const [filas] = await db.query(
      `${SELECT_DATOS}
       WHERE ec.codigo = 'aprobado_final' AND cc.candidato_id IS NULL
       ORDER BY df.created_at DESC, c.id DESC`
    );
    return filas;
  }

  async function contratacionDe(candidatoId, { paraActualizar = false } = {}) {
    const [filas] = await db.query(
      `SELECT cc.*, l.lote_externo_id
         FROM contratacion_candidatos cc
         JOIN contratacion_lotes l ON l.id = cc.lote_id
        WHERE cc.candidato_id = ? ${paraActualizar ? 'FOR UPDATE' : ''}`,
      [candidatoId]
    );
    return filas[0] ?? null;
  }

  async function registrarCandidatos(loteId, candidatoIds) {
    if (candidatoIds.length === 0) return;
    await db.query(
      'INSERT INTO contratacion_candidatos (candidato_id, lote_id) VALUES ?',
      [candidatoIds.map((id) => [id, loteId])]
    );
  }

  async function actualizarCandidato(candidatoId, { estado, detalle, version, usersCompanyId }) {
    const sets = [];
    const params = [];
    if (estado !== undefined) { sets.push('estado = ?'); params.push(estado); }
    if (detalle !== undefined) { sets.push('detalle = ?'); params.push(detalle); }
    if (version !== undefined) { sets.push('version = ?'); params.push(version); }
    if (usersCompanyId !== undefined) { sets.push('users_company_id = ?'); params.push(usersCompanyId); }
    if (sets.length === 0) return;
    await db.query(`UPDATE contratacion_candidatos SET ${sets.join(', ')} WHERE candidato_id = ?`, [
      ...params,
      candidatoId,
    ]);
  }

  /** Cambia en bloque los candidatos de un lote que estén en `deEstado`. */
  async function actualizarCandidatosDeLote(loteId, deEstado, { estado, detalle }) {
    await db.query(
      'UPDATE contratacion_candidatos SET estado = ?, detalle = ? WHERE lote_id = ? AND estado = ?',
      [estado, detalle ?? null, loteId, deEstado]
    );
  }

  // ----------------------------------------------------------------- lotes ----
  async function crearLote({ nombre, fechaIngresoSugerida, creadoPorId }) {
    // El id externo depende del id: se inserta con un marcador único y se fija después.
    const [res] = await db.query(
      `INSERT INTO contratacion_lotes (lote_externo_id, nombre, fecha_ingreso_sugerida, creado_por_id)
       VALUES (UUID(), ?, ?, ?)`,
      [nombre, fechaIngresoSugerida ?? null, creadoPorId ?? null]
    );
    return res.insertId;
  }

  async function fijarLoteExternoId(loteId, loteExternoId) {
    await db.query('UPDATE contratacion_lotes SET lote_externo_id = ? WHERE id = ?', [loteExternoId, loteId]);
  }

  async function buscarLote(loteId) {
    const [filas] = await db.query(
      `SELECT l.*, u.nombre_completo AS creado_por
         FROM contratacion_lotes l
         LEFT JOIN usuarios u ON u.id = l.creado_por_id
        WHERE l.id = ?`,
      [loteId]
    );
    return filas[0] ?? null;
  }

  async function listarLotes() {
    const [filas] = await db.query(
      `SELECT l.id, l.lote_externo_id, l.nombre, l.fecha_ingreso_sugerida, l.created_at,
              u.nombre_completo AS creado_por,
              COUNT(cc.candidato_id) AS total,
              COALESCE(SUM(cc.estado = 'en_cola'), 0)    AS en_cola,
              COALESCE(SUM(cc.estado = 'recibido'), 0)   AS recibidos,
              COALESCE(SUM(cc.estado = 'registrado'), 0) AS registrados,
              COALESCE(SUM(cc.estado IN ('descartado', 'cancelado')), 0) AS fuera_del_lote,
              COALESCE(SUM(cc.estado = 'error'), 0)      AS con_error,
              (SELECT COUNT(*) FROM contratacion_envios en
                WHERE en.lote_id = l.id AND en.estado = 'fallido') AS envios_fallidos
         FROM contratacion_lotes l
         LEFT JOIN usuarios u ON u.id = l.creado_por_id
         LEFT JOIN contratacion_candidatos cc ON cc.lote_id = l.id
        GROUP BY l.id
        ORDER BY l.created_at DESC, l.id DESC`
    );
    return filas.map((f) => ({
      ...f,
      total: Number(f.total),
      en_cola: Number(f.en_cola),
      recibidos: Number(f.recibidos),
      registrados: Number(f.registrados),
      fuera_del_lote: Number(f.fuera_del_lote),
      con_error: Number(f.con_error),
      envios_fallidos: Number(f.envios_fallidos),
    }));
  }

  async function candidatosDeLote(loteId) {
    const [filas] = await db.query(
      `SELECT cc.candidato_id, cc.version, cc.estado, cc.detalle, cc.users_company_id, cc.updated_at,
              c.primer_nombre, c.segundo_nombre, c.primer_apellido, c.segundo_apellido,
              c.numero_documento, ca.codigo AS cargo, ec.codigo AS estado_hydra
         FROM contratacion_candidatos cc
         JOIN candidatos c ON c.id = cc.candidato_id
         JOIN cargos ca ON ca.id = c.cargo_id
         JOIN estados_candidato ec ON ec.id = c.estado_id
        WHERE cc.lote_id = ?
        ORDER BY c.primer_apellido, c.primer_nombre`,
      [loteId]
    );
    return filas;
  }

  // ---------------------------------------------------------------- outbox ----
  async function encolarEnvio({ tipo, loteId, candidatoId, metodo, ruta, payload, idempotencyKey, enviadoPorId }) {
    const [res] = await db.query(
      `INSERT INTO contratacion_envios
         (tipo, lote_id, candidato_id, metodo, ruta, payload, idempotency_key, proximo_intento, enviado_por_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [tipo, loteId, candidatoId ?? null, metodo, ruta, JSON.stringify(payload), idempotencyKey, enviadoPorId ?? null]
    );
    return res.insertId;
  }

  /**
   * Siguiente envío vencido, bloqueado. SKIP LOCKED: dos procesos (o dos
   * corridas solapadas) nunca toman la misma fila. Requiere MySQL 8+.
   */
  async function siguienteEnvioParaDespacho() {
    const [filas] = await db.query(
      `SELECT * FROM contratacion_envios
        WHERE estado = 'pendiente' AND proximo_intento <= NOW()
        ORDER BY proximo_intento, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED`
    );
    return filas[0] ?? null;
  }

  async function registrarResultadoEnvio(id, { estado, intentos, esperaMinutos, error }) {
    await db.query(
      `UPDATE contratacion_envios
          SET estado = ?, intentos = ?, ultimo_error = ?,
              proximo_intento = IF(? IS NULL, proximo_intento, NOW() + INTERVAL ? MINUTE)
        WHERE id = ?`,
      [estado, intentos, error ? String(error).slice(0, 500) : null, esperaMinutos, esperaMinutos ?? 0, id]
    );
  }

  async function enviosDeLote(loteId) {
    const [filas] = await db.query(
      `SELECT en.id, en.tipo, en.candidato_id, en.metodo, en.ruta, en.estado, en.intentos,
              en.proximo_intento, en.ultimo_error, en.created_at, en.updated_at,
              u.nombre_completo AS enviado_por
         FROM contratacion_envios en
         LEFT JOIN usuarios u ON u.id = en.enviado_por_id
        WHERE en.lote_id = ?
        ORDER BY en.created_at, en.id`,
      [loteId]
    );
    return filas;
  }

  async function buscarEnvio(id) {
    const [filas] = await db.query('SELECT id, estado, lote_id FROM contratacion_envios WHERE id = ?', [id]);
    return filas[0] ?? null;
  }

  async function reintentarEnvio(id) {
    const [res] = await db.query(
      `UPDATE contratacion_envios SET estado = 'pendiente', intentos = 0, proximo_intento = NOW()
        WHERE id = ? AND estado = 'fallido'`,
      [id]
    );
    return res.affectedRows > 0;
  }

  return {
    datosParaEnvio,
    candidatosAprobadosNoEnviados,
    contratacionDe,
    registrarCandidatos,
    actualizarCandidato,
    actualizarCandidatosDeLote,
    crearLote,
    fijarLoteExternoId,
    buscarLote,
    listarLotes,
    candidatosDeLote,
    encolarEnvio,
    siguienteEnvioParaDespacho,
    registrarResultadoEnvio,
    enviosDeLote,
    buscarEnvio,
    reintentarEnvio,
  };
}

module.exports = { crearContratacionRepositorio };
