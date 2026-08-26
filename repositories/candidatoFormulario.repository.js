// Repositorio del módulo "candidatos/formulario" (piloto de arquitectura en capas, ver
// claude/plan.md). Único lugar que conoce SQL de las 6 tablas hyd_candidato_* (datos
// básicos, estudios, experiencia, resumen de experiencia, personal, consentimiento) y de
// los puntos donde ese formulario sincroniza/marca progreso sobre hyd_candidatos. El resto
// del backend (CRUD de "Nuevo/Editar Candidato", selección, etc.) sigue con SQL inline en
// sus controllers, sin tocar - este módulo es el piloto, no un refactor global.

function queryAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    global.db.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
}

// SELECT compartido por validarToken y getPerfilCompleto: trae el candidato de
// hyd_candidatos con LEFT JOIN a las 4 tablas 1:1 del formulario emailado (datos básicos,
// resumen de experiencia, personal, consentimiento), aplanadas sobre el mismo objeto -
// mantiene el shape de respuesta que ya consume el frontend (antes venía de un solo
// `SELECT * FROM hyd_candidatos`). Estudios y experiencia son 1:N reales desde la
// migración 002, así que se traen aparte como arrays; ver comentario en el caller.
async function obtenerCandidatoConFormulario(whereClause, params) {
  const rows = await queryAsync(
    `SELECT c.*,
        u.nombre_completo as nombre_reclutador,
        db.estado_civil, db.aspiracion_salarial, db.direccion_residencial, db.barrio, db.talla_camisa,
        db.genero, db.fecha_nacimiento, db.grupo_sanguineo, db.eps, db.afp,
        db.nombre_emergencia, db.numero_emergencia, db.parentesco_emergencia,
        er.ha_trabajado_asiste, er.experiencia_comercial_certificada, er.experiencia_comercial_no_certificada,
        er.primer_empleo_formal, er.ha_estado_proceso_formativo_asiste, er.campana_asiste,
        er.fecha_inicio_asiste, er.fecha_retiro_asiste, er.tiempo_laborado_asiste, er.motivo_retiro_asiste,
        p.fortalezas, p.aspectos_mejorar, p.competencias_laborales, p.conocimiento_excel,
        p.conocimiento_powerpoint, p.conocimiento_word, p.autoevaluacion, p.genograma,
        p.metas_corto_plazo, p.metas_mediano_plazo, p.metas_largo_plazo, p.expectativa_laboral,
        p.estado_salud_actual, p.tratamiento_psicologico_actual, p.tratamiento_psicologico_detalle,
        cons.ciudad_consentimiento, cons.dia_consentimiento, cons.mes_consentimiento, cons.ano_consentimiento
     FROM hyd_candidatos c
     LEFT JOIN hyd_usuarios u ON u.id = c.reclutador_id
     LEFT JOIN hyd_candidato_datos_basicos db ON db.candidato_id = c.id
     LEFT JOIN hyd_candidato_experiencia_resumen er ON er.candidato_id = c.id
     LEFT JOIN hyd_candidato_personal p ON p.candidato_id = c.id
     LEFT JOIN hyd_candidato_consentimiento cons ON cons.candidato_id = c.id
     WHERE ${whereClause}`,
    params
  );

  if (rows.length === 0) return null;
  const candidato = rows[0];

  const [estudios, experiencia] = await Promise.all([
    queryAsync(
      'SELECT nivel_estudios, descripcion, nombre_institucion, titulo_obtenido, ano_finalizacion FROM hyd_candidato_estudios WHERE candidato_id = ?',
      [candidato.id]
    ),
    queryAsync(
      `SELECT orden, nombre_empresa, cargo_desempenado, salario, funciones, fecha_inicio, fecha_retiro,
              tiempo_laborado_anos, tiempo_laborado_meses, motivo_retiro
       FROM hyd_candidato_experiencia WHERE candidato_id = ? ORDER BY orden`,
      [candidato.id]
    )
  ]);

  // Compatibilidad con el frontend actual (todavía no actualizado a 1:N, ver
  // claude/plan.md): además del array completo, se expone el primer registro de cada
  // uno aplanado con los mismos nombres de columna que tenía hyd_candidatos antes de
  // la migración 002, para que HojaVida.jsx/Estudios.jsx/Experiencia.jsx sigan
  // funcionando sin cambios.
  const empresaActual = experiencia[0] || {};

  return {
    ...candidato,
    ...(estudios[0] || {}),
    nombre_empresa: empresaActual.nombre_empresa ?? null,
    cargo_desempenado: empresaActual.cargo_desempenado ?? null,
    salario_experiencia: empresaActual.salario ?? null,
    funciones: empresaActual.funciones ?? null,
    fecha_inicio_experiencia: empresaActual.fecha_inicio ?? null,
    fecha_retiro_experiencia: empresaActual.fecha_retiro ?? null,
    tiempo_laborado_anos: empresaActual.tiempo_laborado_anos ?? null,
    tiempo_laborado_meses: empresaActual.tiempo_laborado_meses ?? null,
    motivo_retiro: empresaActual.motivo_retiro ?? null,
    estudios,
    experiencia
  };
}

// Núcleo del "candado" de acceso al formulario: token vigente + si ya se completó todo.
async function obtenerEstadoAccesoToken(token) {
  const rows = await queryAsync(
    `SELECT formulario_consentimiento_completado FROM hyd_candidatos
     WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()`,
    [token]
  );
  return rows[0] || null;
}

async function resolverCandidatoIdPorToken(token) {
  const rows = await queryAsync(
    'SELECT id FROM hyd_candidatos WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()',
    [token]
  );
  return rows[0] ? rows[0].id : null;
}

async function existeOtroCandidatoConDocumento(candidatoId, numeroDocumento) {
  const rows = await queryAsync(
    `SELECT id FROM hyd_candidatos
     WHERE id != ? AND numero_documento = ? AND numero_documento IS NOT NULL AND numero_documento != ''`,
    [candidatoId, numeroDocumento]
  );
  return rows.length > 0;
}

async function obtenerCandidatoPorToken(token) {
  return queryAsync('SELECT * FROM hyd_candidatos WHERE token_acceso = ?', [token]);
}

// ── Paso 1: Hoja de vida ────────────────────────────────────────────────────────────────
// INSERT ... SELECT resuelve token -> candidato_id sin una consulta aparte; si el token no
// calza (inválido/expirado), el SELECT no devuelve filas y el INSERT no inserta nada
// (affectedRows === 0), igual que un UPDATE que no matchea ninguna fila.
async function upsertAspiracionSalarial(token, aspiracionSalarial) {
  return queryAsync(
    `INSERT INTO hyd_candidato_datos_basicos (candidato_id, aspiracion_salarial)
     SELECT id, ? FROM hyd_candidatos WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()
     ON DUPLICATE KEY UPDATE aspiracion_salarial = VALUES(aspiracion_salarial)`,
    [aspiracionSalarial, token]
  );
}

async function marcarHojaVidaCompletada(token) {
  return queryAsync(
    `UPDATE hyd_candidatos
     SET formulario_hoja_vida_completado = TRUE, fecha_completado_hoja_vida = NOW(), updated_at = NOW()
     WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()`,
    [token]
  );
}

// ── Paso 2: Datos básicos ───────────────────────────────────────────────────────────────
async function upsertDatosBasicos(candidatoId, datos) {
  const {
    estado_civil, direccion_residencial, barrio, talla_camisa,
    grupo_sanguineo, eps, afp,
    nombre_emergencia, numero_emergencia, parentesco_emergencia
  } = datos;

  return queryAsync(
    `INSERT INTO hyd_candidato_datos_basicos
      (candidato_id, estado_civil, direccion_residencial, barrio, talla_camisa,
       grupo_sanguineo, eps, afp,
       nombre_emergencia, numero_emergencia, parentesco_emergencia)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       estado_civil = VALUES(estado_civil), direccion_residencial = VALUES(direccion_residencial),
       barrio = VALUES(barrio), talla_camisa = VALUES(talla_camisa),
       grupo_sanguineo = VALUES(grupo_sanguineo), eps = VALUES(eps), afp = VALUES(afp),
       nombre_emergencia = VALUES(nombre_emergencia), numero_emergencia = VALUES(numero_emergencia),
       parentesco_emergencia = VALUES(parentesco_emergencia)`,
    [candidatoId, estado_civil, direccion_residencial, barrio, talla_camisa,
     grupo_sanguineo, eps, afp,
     nombre_emergencia, numero_emergencia, parentesco_emergencia]
  );
}

// Campos compartidos con hyd_candidatos (nombre, documento, celular, edad) que el
// candidato puede corregir en este paso - se sincronizan de vuelta (decisión del usuario,
// 2026-08-18, ver claude/plan.md). Marca el paso completado en la misma sentencia.
async function sincronizarCandidatoDesdeDatosBasicos(candidatoId, datos) {
  const {
    primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
    tipo_documento, numero_documento, nacionalidad, numero_celular, edad
  } = datos;

  return queryAsync(
    `UPDATE hyd_candidatos
     SET primer_nombre = ?, segundo_nombre = ?, primer_apellido = ?, segundo_apellido = ?,
         tipo_documento = ?, numero_documento = ?, nacionalidad = ?, numero_celular = ?, edad = ?,
         formulario_datos_basicos_completado = TRUE, fecha_completado_datos_basicos = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
     tipo_documento, numero_documento, nacionalidad, numero_celular, edad, candidatoId]
  );
}

// ── Paso 3: Estudios (1:N, hasta 4 filas fijas por nivel) ──────────────────────────────
async function upsertEstudioFila(token, fila) {
  const { nivel_estudios, descripcion, titulo_obtenido, nombre_institucion, ano_finalizacion } = fila;

  return queryAsync(
    `INSERT INTO hyd_candidato_estudios
      (candidato_id, nivel_estudios, descripcion, titulo_obtenido, nombre_institucion, ano_finalizacion)
     SELECT id, ?, ?, ?, ?, ?
     FROM hyd_candidatos WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()
     ON DUPLICATE KEY UPDATE
       descripcion = VALUES(descripcion),
       titulo_obtenido = VALUES(titulo_obtenido), nombre_institucion = VALUES(nombre_institucion),
       ano_finalizacion = VALUES(ano_finalizacion)`,
    [nivel_estudios, descripcion, titulo_obtenido, nombre_institucion, ano_finalizacion, token]
  );
}

async function marcarEstudiosCompletados(token) {
  return queryAsync(
    `UPDATE hyd_candidatos
     SET formulario_estudios_completado = TRUE, fecha_completado_estudios = NOW(), updated_at = NOW()
     WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()`,
    [token]
  );
}

// ── Paso 4: Experiencia laboral (empresa actual = orden 1) + reintegros Asiste ING ─────
async function upsertExperiencia(token, datos) {
  const {
    nombre_empresa, cargo_desempenado, salario_experiencia, funciones,
    fecha_inicio_experiencia, fecha_retiro_experiencia,
    tiempo_laborado_anos, tiempo_laborado_meses, motivo_retiro
  } = datos;

  return queryAsync(
    `INSERT INTO hyd_candidato_experiencia
      (candidato_id, orden, nombre_empresa, cargo_desempenado, salario, funciones,
       fecha_inicio, fecha_retiro, tiempo_laborado_anos, tiempo_laborado_meses, motivo_retiro)
     SELECT id, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?
     FROM hyd_candidatos WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()
     ON DUPLICATE KEY UPDATE
       nombre_empresa = VALUES(nombre_empresa), cargo_desempenado = VALUES(cargo_desempenado),
       salario = VALUES(salario), funciones = VALUES(funciones),
       fecha_inicio = VALUES(fecha_inicio), fecha_retiro = VALUES(fecha_retiro),
       tiempo_laborado_anos = VALUES(tiempo_laborado_anos), tiempo_laborado_meses = VALUES(tiempo_laborado_meses),
       motivo_retiro = VALUES(motivo_retiro)`,
    [nombre_empresa, cargo_desempenado, salario_experiencia, funciones,
     fecha_inicio_experiencia, fecha_retiro_experiencia,
     tiempo_laborado_anos, tiempo_laborado_meses, motivo_retiro, token]
  );
}

async function upsertExperienciaResumenReintegros(token, datos) {
  const {
    ha_trabajado_asiste, ha_estado_proceso_formativo_asiste,
    campana_asiste, fecha_inicio_asiste, fecha_retiro_asiste,
    tiempo_laborado_asiste, motivo_retiro_asiste
  } = datos;

  return queryAsync(
    `INSERT INTO hyd_candidato_experiencia_resumen
      (candidato_id, ha_trabajado_asiste, ha_estado_proceso_formativo_asiste,
       campana_asiste, fecha_inicio_asiste, fecha_retiro_asiste,
       tiempo_laborado_asiste, motivo_retiro_asiste)
     SELECT id, ?, ?, ?, ?, ?, ?, ?
     FROM hyd_candidatos WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()
     ON DUPLICATE KEY UPDATE
       ha_trabajado_asiste = VALUES(ha_trabajado_asiste),
       ha_estado_proceso_formativo_asiste = VALUES(ha_estado_proceso_formativo_asiste),
       campana_asiste = VALUES(campana_asiste), fecha_inicio_asiste = VALUES(fecha_inicio_asiste),
       fecha_retiro_asiste = VALUES(fecha_retiro_asiste),
       tiempo_laborado_asiste = VALUES(tiempo_laborado_asiste),
       motivo_retiro_asiste = VALUES(motivo_retiro_asiste)`,
    [ha_trabajado_asiste, ha_estado_proceso_formativo_asiste,
     campana_asiste || null, fecha_inicio_asiste || null, fecha_retiro_asiste || null,
     tiempo_laborado_asiste || null, motivo_retiro_asiste || null, token]
  );
}

async function marcarExperienciaCompletada(token) {
  return queryAsync(
    `UPDATE hyd_candidatos
     SET formulario_experiencia_completado = TRUE, fecha_completado_experiencia = NOW(), updated_at = NOW()
     WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()`,
    [token]
  );
}

// ── Paso 5: Personal (genograma, metas, autoevaluación) + 3 preguntas de experiencia ───
// comercial (viven en hyd_candidato_experiencia_resumen, no en hyd_candidato_personal -
// el Excel las pone junto a la autoevaluación, no en el bloque de "Experiencia Laboral").
async function upsertPersonal(token, datos) {
  const {
    genograma, fortalezas, aspectos_mejorar, competencias_laborales,
    metas_corto_plazo, metas_mediano_plazo, metas_largo_plazo, estado_salud_actual,
    conocimiento_excel, conocimiento_powerpoint, conocimiento_word, autoevaluacion
  } = datos;

  return queryAsync(
    `INSERT INTO hyd_candidato_personal
      (candidato_id, genograma, fortalezas, aspectos_mejorar, competencias_laborales,
       metas_corto_plazo, metas_mediano_plazo, metas_largo_plazo, estado_salud_actual,
       conocimiento_excel, conocimiento_powerpoint, conocimiento_word, autoevaluacion)
     SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     FROM hyd_candidatos WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()
     ON DUPLICATE KEY UPDATE
       genograma = VALUES(genograma),
       fortalezas = VALUES(fortalezas), aspectos_mejorar = VALUES(aspectos_mejorar),
       competencias_laborales = VALUES(competencias_laborales),
       metas_corto_plazo = VALUES(metas_corto_plazo), metas_mediano_plazo = VALUES(metas_mediano_plazo),
       metas_largo_plazo = VALUES(metas_largo_plazo), estado_salud_actual = VALUES(estado_salud_actual),
       conocimiento_excel = VALUES(conocimiento_excel),
       conocimiento_powerpoint = VALUES(conocimiento_powerpoint),
       conocimiento_word = VALUES(conocimiento_word), autoevaluacion = VALUES(autoevaluacion)`,
    [genograma, fortalezas, aspectos_mejorar, competencias_laborales,
     metas_corto_plazo, metas_mediano_plazo, metas_largo_plazo, estado_salud_actual,
     conocimiento_excel, conocimiento_powerpoint, conocimiento_word, autoevaluacion, token]
  );
}

// Upsert parcial: solo toca estas 3 columnas, sin pisar ha_trabajado_asiste ni el resto de
// "Información Reintegros" que ya haya guardado el paso de Experiencia.
async function upsertExperienciaResumenComercial(token, datos) {
  const { experiencia_comercial_certificada, experiencia_comercial_no_certificada, primer_empleo_formal } = datos;

  return queryAsync(
    `INSERT INTO hyd_candidato_experiencia_resumen
      (candidato_id, experiencia_comercial_certificada, experiencia_comercial_no_certificada, primer_empleo_formal)
     SELECT id, ?, ?, ?
     FROM hyd_candidatos WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()
     ON DUPLICATE KEY UPDATE
       experiencia_comercial_certificada = VALUES(experiencia_comercial_certificada),
       experiencia_comercial_no_certificada = VALUES(experiencia_comercial_no_certificada),
       primer_empleo_formal = VALUES(primer_empleo_formal)`,
    [experiencia_comercial_certificada, experiencia_comercial_no_certificada, primer_empleo_formal, token]
  );
}

async function marcarPersonalCompletado(token) {
  return queryAsync(
    `UPDATE hyd_candidatos
     SET formulario_personal_completado = TRUE, fecha_completado_personal = NOW(), updated_at = NOW()
     WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()`,
    [token]
  );
}

// ── Paso 6: Consentimiento ──────────────────────────────────────────────────────────────
async function upsertConsentimiento(token, datos) {
  const { ciudad_consentimiento, dia_consentimiento, mes_consentimiento, ano_consentimiento } = datos;

  return queryAsync(
    `INSERT INTO hyd_candidato_consentimiento
      (candidato_id, ciudad_consentimiento, dia_consentimiento, mes_consentimiento, ano_consentimiento)
     SELECT id, ?, ?, ?, ?
     FROM hyd_candidatos WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()
     ON DUPLICATE KEY UPDATE
       ciudad_consentimiento = VALUES(ciudad_consentimiento), dia_consentimiento = VALUES(dia_consentimiento),
       mes_consentimiento = VALUES(mes_consentimiento), ano_consentimiento = VALUES(ano_consentimiento)`,
    [ciudad_consentimiento, dia_consentimiento, mes_consentimiento, ano_consentimiento, token]
  );
}

// consentimiento_aceptado, formulario_consentimiento_completado, la transición de estado
// (el "candado" del flujo) se quedan sobre hyd_candidatos, sin cambios - no son datos del
// formulario en sí, ver comentario de alcance en la migración 002.
async function finalizarConsentimiento(token) {
  return queryAsync(
    `UPDATE hyd_candidatos
     SET
       consentimiento_aceptado = TRUE,
       formulario_consentimiento_completado = TRUE,
       fecha_completado_consentimiento = NOW(),
       estado = CASE
         WHEN estado IN ('aprobado_final', 'rechazado_final', 'contratado') THEN estado
         ELSE 'formularios_completados'
       END,
       updated_at = NOW()
     WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()`,
    [token]
  );
}

// Guarda el id que devuelve FirmaCloud al recibir la hoja de vida + tratamiento de datos
// (POST /api/reclutamiento/send), para poder correlacionar y consultar el estado después.
async function guardarFirmaCloudId(candidatoId, firmacloudId) {
  return queryAsync(
    'UPDATE hyd_candidatos SET firmacloud_signature_id = ? WHERE id = ?',
    [firmacloudId, candidatoId]
  );
}

// SELECT liviano (sin los JOIN de obtenerCandidatoConFormulario) usado solo para resolver el
// `firmacloud_signature_id` de un candidato antes de consultar/descargar sus documentos
// firmados — reutiliza el mismo whereClause con chequeo de dueño (reclutador_id) que ya arma
// el controller para getPerfilCompleto.
async function obtenerCandidatoParaFirma(whereClause, params) {
  const rows = await queryAsync(
    `SELECT id, firmacloud_signature_id, reclutador_id FROM hyd_candidatos WHERE ${whereClause}`,
    params
  );
  return rows[0] || null;
}

module.exports = {
  obtenerCandidatoConFormulario,
  obtenerEstadoAccesoToken,
  resolverCandidatoIdPorToken,
  existeOtroCandidatoConDocumento,
  obtenerCandidatoPorToken,
  guardarFirmaCloudId,
  obtenerCandidatoParaFirma,
  upsertAspiracionSalarial,
  marcarHojaVidaCompletada,
  upsertDatosBasicos,
  sincronizarCandidatoDesdeDatosBasicos,
  upsertEstudioFila,
  marcarEstudiosCompletados,
  upsertExperiencia,
  upsertExperienciaResumenReintegros,
  marcarExperienciaCompletada,
  upsertPersonal,
  upsertExperienciaResumenComercial,
  marcarPersonalCompletado,
  upsertConsentimiento,
  finalizarConsentimiento
};
