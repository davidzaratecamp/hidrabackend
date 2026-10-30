'use strict';

/**
 * Reglas puras de la integración con el Gestor Técnico (contratación en RRHH).
 *
 * Sin base de datos ni red: todo lo que se decide aquí se puede probar con
 * objetos planos (tests/unidad/contratacion.reglas.test.js). El contrato de la
 * API está en `conexionhydra.md` §5 del repo de Gestor.
 */

/** Mismo criterio de negocio que `seleccion.service.js`. */
const esCargoAgente = (candidato) => /agente/i.test(candidato.cargo ?? '');

/** Estado de FirmaCloud (`status`) cuando el candidato ya firmó los dos documentos. */
const FIRMA_COMPLETA = 'signed';
/** Marca local: FirmaCloud no respondió y no se sabe si firmó. */
const FIRMA_SIN_CONSULTA = 'sin_consulta';

/**
 * Documentos firmados que viajan a Gestor (migración 021). Obligatorios: sin
 * ellos no se puede enviar. `firma` es el tipo que entiende FirmaCloud.
 */
const DOCUMENTOS_FIRMADOS = Object.freeze([
  Object.freeze({ tipo: 'hoja_vida_firmada', firma: 'cv', nombre: 'Hoja de vida firmada' }),
  Object.freeze({ tipo: 'tratamiento_datos_firmado', firma: 'tratamiento', nombre: 'Tratamiento de datos firmado' }),
]);

const MAX_NOTA_ANTECEDENTES = 500;

/**
 * ¿Se puede enviar este candidato a contratación? Devuelve el motivo si no.
 *
 * Elegible (decisión abierta 1 de conexionhydra.md §11, con la recomendación,
 * y rol Formación desde la migración 019):
 *   - aprobado en decisión final, y
 *   - Agente: citado a formación (`candidato_citacion_formacion.citado`) y con
 *     asistencia a formación (`candidato_formacion.asistio`);
 *     Staff: marcado como contratado (`candidato_contratacion.contratado`), y
 *   - activo en formación (`candidato_formacion.estado`, no de baja), y
 *   - con número de documento (Gestor identifica al empleado por él), y
 *   - con la hoja de vida y el tratamiento de datos firmados por el candidato
 *     en FirmaCloud (migración 021; `firma_estado` lo completa
 *     `contratacion.documentos.js` antes de llamar aquí), y
 *   - que no haya sido enviado antes (un candidato vive en un solo lote; para
 *     reenviar datos o deshacer está "reenviar" sobre el lote original).
 *
 * Los antecedentes no bloquean: si falta alguno se pide una nota al enviar
 * (`motivoFaltaNota`).
 */
function motivoNoElegible(datos) {
  if (datos.estado !== 'aprobado_final') {
    return `No está aprobado en decisión final (está en "${datos.estado}")`;
  }
  if (esCargoAgente(datos)) {
    if (datos.citado_formacion !== true) return 'Es Agente y no tiene registrada la citación a formación';
    if (datos.asistio_formacion === false) return 'No asistió a formación';
    if (datos.asistio_formacion !== true) return 'Falta marcar la asistencia a formación';
  } else if (datos.contratacion !== true) {
    return 'Es Staff y no tiene registrada la contratación';
  }
  // Agente: lo marca Formación; Staff: Contratación (migración 020).
  if (datos.estado_formacion === 'baja') return 'Está de baja';
  if (datos.estado_formacion !== 'activo') return 'Falta marcarlo como activo';
  if (!datos.numero_documento) return 'No tiene número de documento';
  if (datos.contratacion_lote_id) return 'Ya fue enviado a contratación en otro lote';
  if (!datos.firma_referencia) {
    return 'No tiene la hoja de vida y el tratamiento de datos enviados a firma';
  }
  if (datos.firma_estado === FIRMA_SIN_CONSULTA) {
    return 'No se pudo confirmar la firma en FirmaCloud; intenta de nuevo en unos minutos';
  }
  if (datos.firma_estado !== FIRMA_COMPLETA) {
    return 'No ha firmado la hoja de vida y el tratamiento de datos';
  }
  return null;
}

/**
 * ¿Hay que preguntarle a FirmaCloud si ya firmó? Solo si es lo único que falta
 * para ser elegible: así no se consulta a quien igual no se puede enviar. Un
 * "signed" se guarda en `candidato_firmas` y no se vuelve a consultar.
 */
function debeConsultarFirma(datos) {
  if (!datos.firma_referencia || datos.firma_estado === FIRMA_COMPLETA) return false;
  return motivoNoElegible({ ...datos, firma_estado: FIRMA_COMPLETA }) === null;
}

/**
 * Antecedentes sin soporte cargado. `antecedentes` es una fila por tipo activo
 * de `tipos_antecedente`, con `documento_id` nulo si no tiene soporte.
 */
function antecedentesFaltantes(antecedentes) {
  return antecedentes.filter((a) => !a.documento_id).map((a) => a.nombre);
}

/** Si falta algún antecedente, la nota para RRHH es obligatoria; si no, no se pide. */
function motivoFaltaNota(faltantes, nota) {
  if (faltantes.length === 0) return null;
  if (typeof nota === 'string' && nota.trim() !== '') return null;
  return `Le faltan antecedentes (${faltantes.join(', ')}): escribe una nota para RRHH`;
}

/** Nota que se guarda y viaja: solo cuando faltan antecedentes. */
function notaParaEnviar(faltantes, nota) {
  if (faltantes.length === 0 || typeof nota !== 'string') return null;
  const limpia = nota.trim();
  return limpia === '' ? null : limpia.slice(0, MAX_NOTA_ANTECEDENTES);
}

/**
 * Envíos de documentos de un candidato, en el orden en que los verá RRHH:
 * primero los firmados, después los antecedentes con soporte. Lo que se guarda
 * en el outbox es solo la referencia; el archivo se lee al despachar.
 *
 * Los firmados van sin `documento_id`: el despachador usa la copia ya guardada
 * o la descarga de FirmaCloud la primera vez (migración 021).
 */
function documentosAEnviar(antecedentes) {
  const firmados = DOCUMENTOS_FIRMADOS.map((d) => ({
    tipo: d.tipo,
    nombre: d.nombre,
    origen: 'firma',
    firma: d.firma,
    documento_id: null,
  }));
  const soportes = antecedentes
    .filter((a) => a.documento_id)
    .map((a) => ({
      tipo: `antecedente_${a.codigo}`,
      nombre: a.nombre,
      origen: 'antecedente',
      documento_id: a.documento_id,
    }));
  return [...firmados, ...soportes];
}

const vacioANull = (valor) => (valor === undefined || valor === '' ? null : valor);

/**
 * Hydra guarda las fechas de auditoría como hora local del servidor
 * ('AAAA-MM-DD HH:MM:SS', ver `dateStrings` en config/db.js); el contrato pide
 * instantes en UTC ISO-8601.
 */
function instanteIso(valor) {
  if (!valor) return null;
  const fecha = new Date(String(valor).replace(' ', 'T'));
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

/**
 * Un candidato con la forma que espera Gestor en `POST /lotes` y
 * `PUT /candidatos/:id`. Los catálogos viajan por CÓDIGO: los IDs de Hydra no
 * significan nada en Gestor.
 *
 * `documentos` avisa qué antecedentes faltan y la nota de Contratación; los
 * archivos llegan después, cada uno en su propio envío.
 */
function construirCandidatoPayload(datos, version, { faltantes = [], nota = null } = {}) {
  return {
    hydra_candidato_id: datos.id,
    version,
    identificacion: { tipo: datos.tipo_documento, numero: datos.numero_documento },
    nombres: {
      primer_nombre: datos.primer_nombre,
      segundo_nombre: vacioANull(datos.segundo_nombre),
      primer_apellido: datos.primer_apellido,
      segundo_apellido: vacioANull(datos.segundo_apellido),
    },
    contacto: { email: vacioANull(datos.email), celular: vacioANull(datos.celular) },
    personal: {
      fecha_nacimiento: vacioANull(datos.fecha_nacimiento),
      genero: vacioANull(datos.genero),
      estado_civil: vacioANull(datos.estado_civil),
      grupo_sanguineo: vacioANull(datos.grupo_sanguineo),
    },
    seguridad_social: { eps: vacioANull(datos.eps), afp: vacioANull(datos.afp) },
    direccion: { direccion: vacioANull(datos.direccion_residencial), barrio: vacioANull(datos.barrio) },
    contacto_emergencia: {
      nombre: vacioANull(datos.nombre_emergencia),
      telefono: vacioANull(datos.numero_emergencia),
      parentesco: vacioANull(datos.parentesco_emergencia),
    },
    dotacion: { talla_camisa: vacioANull(datos.talla_camisa) },
    proceso: {
      cliente: datos.cliente,
      cargo: datos.cargo,
      aprobado_final_en: instanteIso(datos.fecha_decision),
    },
    consentimiento: {
      fecha: vacioANull(datos.fecha_consentimiento),
      ciudad: vacioANull(datos.ciudad_consentimiento),
    },
    documentos: {
      firmados: DOCUMENTOS_FIRMADOS.map((d) => d.tipo),
      antecedentes_faltantes: faltantes,
      nota_antecedentes: notaParaEnviar(faltantes, nota),
    },
  };
}

/**
 * Identificador del lote para Gestor: legible y único aunque dos bases de Hydra
 * (local y producción) generen el mismo `id`.
 */
function generarLoteExternoId(loteId, fechaIso, aleatorio) {
  return `HYD-${fechaIso.slice(0, 10).replaceAll('-', '')}-${loteId}-${aleatorio.slice(0, 8)}`;
}

// Códigos de Gestor que SÍ ameritan reintento aunque vengan con 4xx/409.
const CODIGOS_REINTENTABLES = ['PETICION_CONCURRENTE'];
const ESTADOS_4XX_REINTENTABLES = [408, 429];

/**
 * Política de reintentos del outbox hacia Gestor. Distinta de la de Gestor hacia
 * Hydra en un punto: aquí un 409 NO es éxito. Gestor responde 409 `LOTE_CERRADO`
 * cuando el lote ya está registrado o cancelado, y eso hay que mostrarlo.
 *
 *   2xx ......................... enviado
 *   503, 5xx, 408, 429, sin red . reintento con espera 1, 2, 4… min (tope)
 *   409 PETICION_CONCURRENTE .... reintento
 *   otro 4xx .................... fallido (firma, payload o regla: reintentar no lo arregla)
 *   máximo de intentos .......... fallido
 */
function decidirResultadoEnvio({ status, codigo = null, intentosPrevios }, politica) {
  const intentos = intentosPrevios + 1;
  if (status !== null && status >= 200 && status < 300) {
    return { estado: 'enviado', intentos, esperaMinutos: null };
  }

  const reintentable =
    status === null ||
    status >= 500 ||
    ESTADOS_4XX_REINTENTABLES.includes(status) ||
    CODIGOS_REINTENTABLES.includes(codigo);

  if (!reintentable || intentos >= politica.maxIntentos) {
    return { estado: 'fallido', intentos, esperaMinutos: null };
  }
  return {
    estado: 'pendiente',
    intentos,
    esperaMinutos: Math.min(2 ** (intentos - 1), politica.backoffMaximoMinutos),
  };
}

/**
 * Traduce el `resultado` que devuelve Gestor por candidato a nuestro estado local.
 * `null` = no cambia nada (p. ej. `sin_cambios` sobre uno ya recibido).
 */
function estadoLocalPorResultado(resultado, estadoActual) {
  switch (resultado) {
    case 'creado':
    case 'actualizado':
      return { estado: 'recibido', detalle: null };
    case 'reintegro_detectado':
      return {
        estado: 'recibido',
        detalle: 'La cédula ya existe como empleado en Gestor (reintegro): RRHH debe gestionarlo',
      };
    case 'ya_registrado':
      return { estado: 'registrado', detalle: null };
    case 'en_otro_lote':
      return { estado: 'error', detalle: 'Gestor ya tiene a este candidato en otro lote' };
    case 'sin_cambios':
      return estadoActual === 'en_cola' ? { estado: 'recibido', detalle: null } : null;
    default:
      return null;
  }
}

// ---------------------------------------------- exámenes médicos (022) -----

/** Lo que SST marca en Gestor y el estado de examen que deja. */
const EXAMEN_POR_EVENTO_SST = {
  asistio: 'asistio',
  no_asistio: 'no_asistio',
  aprobado: 'aprobado',
  no_aprobado: 'no_aprobado',
};

const MAX_NOTA_EXAMEN = 1000;

/**
 * Estados de Hydra en los que los exámenes médicos cerraron el proceso: SST
 * dio "no apto" o selección no dio continuidad. Ya no se reenvía ni se cancela:
 * reenviar lo reabriría en Gestor sin pasar por la decisión.
 */
const ESTADOS_CIERRE_EXAMENES = Object.freeze(['no_apto_examenes', 'no_continua_examenes']);

/**
 * Selección solo decide sobre un "no asistió" y mientras el candidato siga en
 * proceso en Gestor. Devuelve el motivo por el que no puede, o null.
 */
function motivoNoDecideContinuidad({ examenEstado, estadoLocal }) {
  if (['registrado', 'descartado', 'cancelado'].includes(estadoLocal)) {
    return 'El candidato ya no está en proceso de contratación';
  }
  if (examenEstado !== 'no_asistio') {
    return 'No hay una inasistencia a exámenes médicos pendiente de decisión';
  }
  return null;
}

/**
 * Efecto en Hydra de una decisión de selección: continuar deja el examen
 * "reagendado" (SST vuelve a marcar asistencia); no continuar lo saca del
 * proceso aquí y en Gestor.
 */
function efectoDecisionContinuidad(continuar) {
  return continuar
    ? { evento: 'continuidad', examenEstado: 'reagendado', estadoLocal: null, estadoHydra: null }
    : { evento: 'no_continuidad', examenEstado: 'no_asistio', estadoLocal: 'cancelado', estadoHydra: 'no_continua_examenes' };
}

module.exports = {
  FIRMA_COMPLETA,
  FIRMA_SIN_CONSULTA,
  DOCUMENTOS_FIRMADOS,
  MAX_NOTA_ANTECEDENTES,
  esCargoAgente,
  motivoNoElegible,
  debeConsultarFirma,
  antecedentesFaltantes,
  motivoFaltaNota,
  notaParaEnviar,
  documentosAEnviar,
  construirCandidatoPayload,
  generarLoteExternoId,
  decidirResultadoEnvio,
  estadoLocalPorResultado,
  instanteIso,
  EXAMEN_POR_EVENTO_SST,
  MAX_NOTA_EXAMEN,
  ESTADOS_CIERRE_EXAMENES,
  motivoNoDecideContinuidad,
  efectoDecisionContinuidad,
};
