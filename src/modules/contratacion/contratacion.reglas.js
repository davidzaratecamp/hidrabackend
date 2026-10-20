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
 *   - que no haya sido enviado antes (un candidato vive en un solo lote; para
 *     reenviar datos o deshacer está "reenviar" sobre el lote original).
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
  return null;
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
 */
function construirCandidatoPayload(datos, version) {
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

module.exports = {
  esCargoAgente,
  motivoNoElegible,
  construirCandidatoPayload,
  generarLoteExternoId,
  decidirResultadoEnvio,
  estadoLocalPorResultado,
  instanteIso,
};
