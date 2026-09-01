'use strict';

/**
 * Adaptador entre el esquema normalizado nuevo y la forma plana que esperan los
 * servicios de PDF.
 *
 * Los servicios de estampado tienen coordenadas calibradas a mano contra las
 * plantillas oficiales, y varias de esas posiciones costaron rondas de ajuste
 * (celdas que se desbordaban a la fila de abajo, valores escritos fuera del
 * recuadro). Reescribirlos para que lean el modelo nuevo sería reintroducir ese
 * riesgo sin ganar nada: en vez de eso se traduce la entrada.
 *
 * Aquí se reconstruyen los campos que el esquema nuevo dejó de almacenar por ser
 * derivados: el tiempo laborado y el día/mes del consentimiento.
 */

/** Diferencia entre dos fechas en años y meses. Antes eran columnas guardadas. */
function tiempoLaborado(fechaInicio, fechaRetiro) {
  if (!fechaInicio) return { anos: null, meses: null };
  const inicio = new Date(fechaInicio);
  const fin = fechaRetiro ? new Date(fechaRetiro) : new Date();
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
    return { anos: null, meses: null };
  }

  let meses = (fin.getFullYear() - inicio.getFullYear()) * 12 + (fin.getMonth() - inicio.getMonth());
  if (fin.getDate() < inicio.getDate()) meses -= 1;
  if (meses < 0) meses = 0;

  return { anos: Math.floor(meses / 12), meses: meses % 12 };
}

function textoTiempo(fechaInicio, fechaRetiro) {
  const { anos, meses } = tiempoLaborado(fechaInicio, fechaRetiro);
  if (anos === null) return null;
  const partes = [];
  if (anos > 0) partes.push(`${anos} ${anos === 1 ? 'año' : 'años'}`);
  if (meses > 0) partes.push(`${meses} ${meses === 1 ? 'mes' : 'meses'}`);
  return partes.length > 0 ? partes.join(' ') : '0 meses';
}

/** Extrae día y mes de la fecha de consentimiento (antes, tres columnas sueltas). */
function partesFecha(fecha) {
  if (!fecha) return { dia: null, mes: null, ano: null };
  // El driver devuelve DATE como 'YYYY-MM-DD': se parte el texto en vez de
  // construir un Date, que aplicaría zona horaria y podría correr un día.
  const [ano, mes, dia] = String(fecha).slice(0, 10).split('-').map(Number);
  return { dia, mes, ano };
}

function metaPorPlazo(metas, plazo) {
  return metas?.find((m) => m.plazo === plazo)?.descripcion ?? null;
}

function nivelHerramienta(conocimientos, codigo) {
  return conocimientos?.find((c) => c.codigo === codigo)?.nivel ?? null;
}

/**
 * @param {object} c Resultado de `formularioRepo.obtenerCompleto()`.
 * @returns Objeto plano con los nombres de campo que usan los servicios de PDF.
 */
function aFormaPdf(c) {
  const consentimiento = partesFecha(c.fecha_consentimiento);

  return {
    // Identidad
    primer_nombre: c.primer_nombre,
    segundo_nombre: c.segundo_nombre,
    primer_apellido: c.primer_apellido,
    segundo_apellido: c.segundo_apellido,
    tipo_documento: c.tipo_documento,
    numero_documento: c.numero_documento,
    nacionalidad: c.nacionalidad,
    edad: c.edad,
    fecha_nacimiento: c.fecha_nacimiento,

    // Contacto (el esquema viejo los llamaba `numero_celular` y `email_personal`)
    numero_celular: c.celular,
    email_personal: c.email,
    direccion_residencial: c.direccion_residencial,
    barrio: c.barrio,

    // Proceso
    cargo: c.cargo,
    cliente: c.cliente,
    fuente_reclutamiento: c.fuente_reclutamiento,
    fecha_envio_email: c.fecha_envio_email,

    // Datos personales
    estado_civil: c.estado_civil,
    genero: c.genero,
    grupo_sanguineo: c.grupo_sanguineo,
    eps: c.eps,
    afp: c.afp,
    talla_camisa: c.talla_camisa,
    aspiracion_salarial: c.aspiracion_salarial,
    nombre_emergencia: c.nombre_emergencia,
    numero_emergencia: c.numero_emergencia,
    parentesco_emergencia: c.parentesco_emergencia,

    // Perfil
    genograma: c.genograma,
    fortalezas: c.fortalezas,
    aspectos_mejorar: c.aspectos_mejorar,
    competencias_laborales: c.competencias_laborales,
    expectativa_laboral: c.expectativa_laboral,
    estado_salud_actual: c.estado_salud_actual,
    autoevaluacion: c.autoevaluacion,

    // Metas: tres columnas del formato oficial, reconstruidas desde las filas
    metas_corto_plazo: metaPorPlazo(c.metas, 'corto'),
    metas_mediano_plazo: metaPorPlazo(c.metas, 'mediano'),
    metas_largo_plazo: metaPorPlazo(c.metas, 'largo'),

    // Conocimientos informáticos, idem
    conocimiento_excel: nivelHerramienta(c.conocimientos, 'excel'),
    conocimiento_powerpoint: nivelHerramienta(c.conocimientos, 'powerpoint'),
    conocimiento_word: nivelHerramienta(c.conocimientos, 'word'),

    // Reintegros Asiste ING
    ha_trabajado_asiste: c.ha_trabajado_asiste,
    ha_estado_proceso_formativo_asiste: c.ha_estado_proceso_formativo_asiste,
    experiencia_comercial_certificada: c.experiencia_comercial_certificada,
    experiencia_comercial_no_certificada: c.experiencia_comercial_no_certificada,
    primer_empleo_formal: c.primer_empleo_formal,
    campana_asiste: c.campana_asiste,
    fecha_inicio_asiste: c.fecha_inicio_asiste,
    fecha_retiro_asiste: c.fecha_retiro_asiste,
    motivo_retiro_asiste: c.motivo_retiro_asiste,
    tiempo_laborado_asiste: textoTiempo(c.fecha_inicio_asiste, c.fecha_retiro_asiste),

    // Consentimiento
    ciudad_consentimiento: c.ciudad_consentimiento,
    dia_consentimiento: consentimiento.dia,
    mes_consentimiento: consentimiento.mes,
    ano_consentimiento: consentimiento.ano,

    // Colecciones
    estudios: c.estudios ?? [],
    experiencia: (c.experiencia ?? []).map((e) => {
      const t = tiempoLaborado(e.fecha_inicio, e.fecha_retiro);
      return { ...e, tiempo_laborado_anos: t.anos, tiempo_laborado_meses: t.meses };
    }),
  };
}

module.exports = { aFormaPdf, tiempoLaborado, textoTiempo, partesFecha };
