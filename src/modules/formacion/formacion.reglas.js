'use strict';

/**
 * Reglas puras de Formación y de la cola de Contratación (migraciones 019 y
 * 020). Sin base de datos: se prueban con objetos planos
 * (tests/unidad/formacion.reglas.test.js).
 *
 * Desde la 020 hay dos colas sobre los mismos datos (`candidato_formacion`):
 *   - Formación: solo Agentes, aprobados en decisión final y citados a
 *     formación (migración 015). Marca asistencia y activo/baja.
 *   - Contratación: quienes se van a contratar. Staff aprobado en decisión
 *     final y marcado como contratación (016), al que Contratación marca
 *     activo/baja, y Agentes que pasaron la formación (asistieron y activos).
 * Una vez enviado a contratación, los datos quedan congelados: para deshacer
 * está "cancelar" sobre el lote.
 */

const { esCargoAgente } = require('../contratacion/contratacion.reglas');

/** Agente en formación: la cola del rol Formación. */
function enFormacion(datos) {
  return datos.estado === 'aprobado_final' && esCargoAgente(datos) && datos.citado_formacion === true;
}

/** Staff que pasa a contratación: Contratación marca su activo/baja. */
function esStaffPorContratar(datos) {
  return datos.estado === 'aprobado_final' && !esCargoAgente(datos) && datos.contratacion === true;
}

/** Cola del rol Contratación: Staff marcados como contratación y Agentes que pasaron la formación. */
function porContratar(datos) {
  if (esStaffPorContratar(datos)) return true;
  return enFormacion(datos) && datos.asistio_formacion === true && datos.estado_formacion === 'activo';
}

/** Motivo por el que Formación no puede tocar los datos, o null. */
function motivoNoEditable(datos) {
  if (!enFormacion(datos)) {
    return 'El candidato no está en formación (debe ser Agente, aprobado en decisión final y citado a formación)';
  }
  if (datos.contratacion_lote_id) return 'El candidato ya fue enviado a contratación';
  return null;
}

/** ¿Se puede marcar la asistencia? Devuelve el motivo si no. */
function motivoNoAsistencia(datos) {
  return motivoNoEditable(datos);
}

/** ¿Formación puede pasar a este Agente a activo/baja? Devuelve el motivo si no. */
function motivoNoEstado(datos, estado) {
  const motivo = motivoNoEditable(datos);
  if (motivo) return motivo;
  if (estado === 'activo' && datos.asistio_formacion !== true) {
    return 'Para marcar activo a un Agente primero debe tener la asistencia a formación en "Sí"';
  }
  return null;
}

/** ¿Contratación puede pasar a este Staff a activo/baja? Devuelve el motivo si no. */
function motivoNoEstadoStaff(datos) {
  if (!esStaffPorContratar(datos)) {
    return 'El candidato no es Staff marcado como contratación (los Agentes los marca Formación)';
  }
  if (datos.contratacion_lote_id) return 'El candidato ya fue enviado a contratación';
  return null;
}

/**
 * Al marcar "No asistió" a un Agente que estaba activo, el activo deja de tener
 * sentido: se borra para que no quede un estado contradictorio. Una baja se
 * conserva (es compatible con no haber asistido).
 */
function debeLimpiarActivo(asistio, estadoActual) {
  return asistio === false && estadoActual === 'activo';
}

module.exports = {
  enFormacion,
  esStaffPorContratar,
  porContratar,
  motivoNoEditable,
  motivoNoAsistencia,
  motivoNoEstado,
  motivoNoEstadoStaff,
  debeLimpiarActivo,
};
