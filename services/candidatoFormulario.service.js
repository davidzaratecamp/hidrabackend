// Servicio del módulo "candidatos/formulario" (piloto de arquitectura en capas, ver
// claude/plan.md): validación y reglas de negocio de los 6 pasos del formulario emailado
// al candidato. No conoce SQL - todo el acceso a datos pasa por
// repositories/candidatoFormulario.repository.js.
const repo = require('../repositories/candidatoFormulario.repository');
const emailService = require('./email.service');
const HttpError = require('../utils/httpError');
const { separarNombreCompleto } = require('../utils/nombreCompleto.util');

async function obtenerFormularioPorToken(token) {
  const candidato = await repo.obtenerCandidatoConFormulario(
    'c.token_acceso = ? AND c.fecha_vencimiento_token > NOW()',
    [token]
  );
  if (!candidato) throw new HttpError(404, 'Token inválido o expirado');
  return candidato;
}

// whereClause/params ya vienen armados por el controller según el rol de quien pide el
// perfil (control de acceso de "lo anterior", sin tocar) - este servicio solo compone el
// candidato con los datos normalizados de las tablas nuevas.
async function obtenerPerfilConFormulario(whereClause, params) {
  const candidato = await repo.obtenerCandidatoConFormulario(whereClause, params);
  if (!candidato) throw new HttpError(404, 'Candidato no encontrado o no tienes acceso a este candidato');
  return candidato;
}

// Candado de acceso: token vigente y formulario aún no completado del todo.
async function verificarAccesoFormulario(token) {
  const estado = await repo.obtenerEstadoAccesoToken(token);
  if (!estado) throw new HttpError(404, 'Token inválido o expirado');
  if (estado.formulario_consentimiento_completado) {
    throw new HttpError(
      403,
      'Los formularios ya fueron completados. Si necesitas hacer cambios, solicita al reclutador que reenvíe el acceso.'
    );
  }
}

// ── Paso 1: Hoja de vida ────────────────────────────────────────────────────────────────
async function actualizarHojaVida(token, body) {
  const { aspiracion_salarial } = body;
  if (!aspiracion_salarial) {
    throw new HttpError(400, 'Aspiración salarial es requerida');
  }

  await verificarAccesoFormulario(token);

  const results = await repo.upsertAspiracionSalarial(token, aspiracion_salarial);
  if (results.affectedRows === 0) throw new HttpError(404, 'Token inválido o expirado');

  await repo.marcarHojaVidaCompletada(token);
  return { message: 'Hoja de vida actualizada exitosamente' };
}

// ── Paso 2: Datos básicos ───────────────────────────────────────────────────────────────
async function actualizarDatosBasicos(token, body) {
  const {
    nombre_completo, tipo_documento, numero_documento, numero_celular, edad,
    estado_civil, direccion_residencial, barrio, talla_camisa,
    grupo_sanguineo, eps, afp,
    nombre_emergencia, numero_emergencia, parentesco_emergencia
  } = body;

  if (!nombre_completo || !tipo_documento || !numero_documento || !numero_celular || !edad ||
      !estado_civil || !direccion_residencial || !barrio || !talla_camisa ||
      !grupo_sanguineo || !eps || !afp ||
      !nombre_emergencia || !numero_emergencia || !parentesco_emergencia) {
    throw new HttpError(400, 'Todos los campos requeridos deben completarse');
  }

  const nombreSeparado = separarNombreCompleto(nombre_completo);
  if (!nombreSeparado) {
    throw new HttpError(400, 'El nombre completo debe incluir al menos nombre y apellido');
  }
  const { primer_nombre, segundo_nombre, primer_apellido, segundo_apellido } = nombreSeparado;
  const nacionalidad = tipo_documento === 'CC' ? 'Colombiano' : 'Venezolano';

  await verificarAccesoFormulario(token);

  const candidatoId = await repo.resolverCandidatoIdPorToken(token);
  if (!candidatoId) throw new HttpError(404, 'Token inválido o expirado');

  // Mismo chequeo de duplicados que ya usan crearCandidato/editarCandidato, pero solo por
  // cédula (el correo no se toca desde este paso).
  const tieneDuplicado = await repo.existeOtroCandidatoConDocumento(candidatoId, numero_documento);
  if (tieneDuplicado) {
    throw new HttpError(400, 'Ya existe otro candidato con este número de documento');
  }

  await repo.upsertDatosBasicos(candidatoId, {
    estado_civil, direccion_residencial, barrio, talla_camisa,
    grupo_sanguineo, eps, afp, nombre_emergencia, numero_emergencia, parentesco_emergencia
  });

  await repo.sincronizarCandidatoDesdeDatosBasicos(candidatoId, {
    primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
    tipo_documento, numero_documento, nacionalidad, numero_celular, edad
  });

  return { message: 'Datos básicos actualizados exitosamente' };
}

// ── Paso 3: Estudios (1:N, hasta 4 filas fijas por nivel) ──────────────────────────────
const NIVEL_ESTUDIOS_TEXTO_LIBRE = 'conocimientos_informaticos';
const NIVELES_ESTUDIOS_VALIDOS = ['bachillerato', 'tecnico_tecnologo', 'profesional_u_otros', NIVEL_ESTUDIOS_TEXTO_LIBRE];

async function actualizarEstudios(token, body) {
  const estudios = Array.isArray(body.estudios) ? body.estudios : [];

  const filasConDatos = estudios.filter((e) =>
    e && (e.nombre_institucion || e.titulo_obtenido || e.ano_finalizacion || e.descripcion)
  );

  if (filasConDatos.length === 0) {
    throw new HttpError(400, 'Completa al menos un nivel de estudios');
  }

  for (const fila of filasConDatos) {
    if (!NIVELES_ESTUDIOS_VALIDOS.includes(fila.nivel_estudios)) {
      throw new HttpError(400, `Nivel de estudios inválido: ${fila.nivel_estudios}`);
    }
    if (fila.nivel_estudios === NIVEL_ESTUDIOS_TEXTO_LIBRE) {
      if (!fila.descripcion) {
        throw new HttpError(400, 'Completa la descripción de Conocimientos Informáticos');
      }
      if (fila.descripcion.length > 500) {
        throw new HttpError(400, 'Conocimientos Informáticos no puede superar 500 caracteres');
      }
    } else if (!fila.nombre_institucion || !fila.titulo_obtenido || !fila.ano_finalizacion) {
      throw new HttpError(400, 'Cada nivel de estudios que completes debe tener institución, título y año');
    }
  }
  const nivelesRepetidos = new Set(filasConDatos.map((f) => f.nivel_estudios));
  if (nivelesRepetidos.size !== filasConDatos.length) {
    throw new HttpError(400, 'No repitas el mismo nivel de estudios');
  }

  await verificarAccesoFormulario(token);

  let totalAfectadas = 0;
  for (const fila of filasConDatos) {
    const esTextoLibre = fila.nivel_estudios === NIVEL_ESTUDIOS_TEXTO_LIBRE;
    const results = await repo.upsertEstudioFila(token, {
      nivel_estudios: fila.nivel_estudios,
      descripcion: esTextoLibre ? fila.descripcion : null,
      titulo_obtenido: esTextoLibre ? null : fila.titulo_obtenido,
      nombre_institucion: esTextoLibre ? null : fila.nombre_institucion,
      ano_finalizacion: esTextoLibre ? null : fila.ano_finalizacion
    });
    totalAfectadas += results.affectedRows;
  }

  if (totalAfectadas === 0) {
    throw new HttpError(404, 'Token inválido o expirado');
  }

  await repo.marcarEstudiosCompletados(token);
  return { message: 'Estudios actualizados exitosamente' };
}

// ── Paso 4: Experiencia laboral (última/actual empresa) + reintegros Asiste ING ────────
async function actualizarExperiencia(token, body) {
  const {
    nombre_empresa, cargo_desempenado, salario_experiencia, funciones,
    fecha_inicio_experiencia, fecha_retiro_experiencia,
    tiempo_laborado_anos, tiempo_laborado_meses, motivo_retiro,
    ha_trabajado_asiste, ha_estado_proceso_formativo_asiste,
    campana_asiste, fecha_inicio_asiste, fecha_retiro_asiste,
    tiempo_laborado_asiste, motivo_retiro_asiste
  } = body;

  if (!nombre_empresa || !cargo_desempenado || !salario_experiencia || !funciones ||
      !fecha_inicio_experiencia || !fecha_retiro_experiencia ||
      tiempo_laborado_anos === undefined || tiempo_laborado_meses === undefined ||
      !motivo_retiro || !ha_trabajado_asiste || !ha_estado_proceso_formativo_asiste) {
    throw new HttpError(400, 'Todos los campos son requeridos');
  }

  await verificarAccesoFormulario(token);

  const resultsExperiencia = await repo.upsertExperiencia(token, {
    nombre_empresa, cargo_desempenado, salario_experiencia, funciones,
    fecha_inicio_experiencia, fecha_retiro_experiencia,
    tiempo_laborado_anos, tiempo_laborado_meses, motivo_retiro
  });
  if (resultsExperiencia.affectedRows === 0) throw new HttpError(404, 'Token inválido o expirado');

  await repo.upsertExperienciaResumenReintegros(token, {
    ha_trabajado_asiste, ha_estado_proceso_formativo_asiste,
    campana_asiste, fecha_inicio_asiste, fecha_retiro_asiste,
    tiempo_laborado_asiste, motivo_retiro_asiste
  });

  await repo.marcarExperienciaCompletada(token);
  return { message: 'Experiencia actualizada exitosamente' };
}

// ── Paso 5: Personal (genograma, metas, autoevaluación) + 3 preguntas de experiencia ───
async function actualizarPersonal(token, body) {
  const {
    genograma, fortalezas, aspectos_mejorar, competencias_laborales,
    metas_corto_plazo, metas_mediano_plazo, metas_largo_plazo, estado_salud_actual,
    conocimiento_excel, conocimiento_powerpoint, conocimiento_word, autoevaluacion,
    experiencia_comercial_certificada, experiencia_comercial_no_certificada, primer_empleo_formal
  } = body;

  if (!genograma || !fortalezas || !aspectos_mejorar || !competencias_laborales ||
      !metas_corto_plazo || !metas_mediano_plazo || !metas_largo_plazo || !estado_salud_actual ||
      !conocimiento_excel || !conocimiento_powerpoint || !conocimiento_word || !autoevaluacion ||
      !experiencia_comercial_certificada || !experiencia_comercial_no_certificada || !primer_empleo_formal) {
    throw new HttpError(400, 'Todos los campos son requeridos');
  }

  await verificarAccesoFormulario(token);

  const resultsPersonal = await repo.upsertPersonal(token, {
    genograma, fortalezas, aspectos_mejorar, competencias_laborales,
    metas_corto_plazo, metas_mediano_plazo, metas_largo_plazo, estado_salud_actual,
    conocimiento_excel, conocimiento_powerpoint, conocimiento_word, autoevaluacion
  });
  if (resultsPersonal.affectedRows === 0) throw new HttpError(404, 'Token inválido o expirado');

  // Upsert parcial: no pisa ha_trabajado_asiste ni el resto de "Información Reintegros"
  // que ya haya guardado el paso de Experiencia (ver repo).
  await repo.upsertExperienciaResumenComercial(token, {
    experiencia_comercial_certificada, experiencia_comercial_no_certificada, primer_empleo_formal
  });

  await repo.marcarPersonalCompletado(token);
  return { message: 'Información personal actualizada exitosamente' };
}

// ── Paso 6: Consentimiento ──────────────────────────────────────────────────────────────
async function actualizarConsentimiento(token, body) {
  const { ciudad_consentimiento, dia_consentimiento, mes_consentimiento, ano_consentimiento } = body;

  if (!ciudad_consentimiento || !dia_consentimiento || !mes_consentimiento || !ano_consentimiento) {
    throw new HttpError(400, 'Todos los campos son requeridos');
  }

  await verificarAccesoFormulario(token);

  const results = await repo.upsertConsentimiento(token, {
    ciudad_consentimiento, dia_consentimiento, mes_consentimiento, ano_consentimiento
  });
  if (results.affectedRows === 0) throw new HttpError(404, 'Token inválido o expirado');

  await repo.finalizarConsentimiento(token);

  // Fire-and-forget: no bloquea la respuesta, igual que el comportamiento original (el
  // controller ya respondía antes de esperar el email).
  repo.obtenerCandidatoPorToken(token)
    .then((candidatoResults) => {
      if (candidatoResults.length > 0) {
        return emailService.enviarNotificacionCompletado(candidatoResults[0]);
      }
    })
    .catch(() => {});

  return { message: 'Consentimiento registrado y proceso completado exitosamente' };
}

module.exports = {
  obtenerFormularioPorToken,
  obtenerPerfilConFormulario,
  actualizarHojaVida,
  actualizarDatosBasicos,
  actualizarEstudios,
  actualizarExperiencia,
  actualizarPersonal,
  actualizarConsentimiento
};
