'use strict';

/**
 * Reglas puras del rol Formación (migración 019). Sin base de datos: se prueban
 * con objetos planos (tests/unidad/formacion.reglas.test.js).
 *
 * Quién está "en formación":
 *   - Agente: aprobado en decisión final y citado a formación (migración 015).
 *   - Staff: aprobado en decisión final y marcado como contratación (016).
 * Mientras no se haya enviado a contratación, Formación marca la asistencia
 * (solo Agente) y si está activo o de baja. Una vez enviado, los datos quedan
 * congelados: para deshacer está "cancelar" sobre el lote.
 */

const { esCargoAgente } = require('../contratacion/contratacion.reglas');

function enFormacion(datos) {
  if (datos.estado !== 'aprobado_final') return false;
  return esCargoAgente(datos) ? datos.citado_formacion === true : datos.contratacion === true;
}

/** Motivo por el que no se pueden tocar los datos de formación, o null. */
function motivoNoEditable(datos) {
  if (!enFormacion(datos)) {
    return 'El candidato no está en formación (debe estar aprobado en decisión final y citado a formación o marcado como contratación)';
  }
  if (datos.contratacion_lote_id) return 'El candidato ya fue enviado a contratación';
  return null;
}

/** ¿Se puede marcar la asistencia? Devuelve el motivo si no. */
function motivoNoAsistencia(datos) {
  const motivo = motivoNoEditable(datos);
  if (motivo) return motivo;
  if (!esCargoAgente(datos)) return 'La asistencia a formación solo se marca a candidatos Agente';
  return null;
}

/** ¿Se puede pasar a este estado (activo/baja)? Devuelve el motivo si no. */
function motivoNoEstado(datos, estado) {
  const motivo = motivoNoEditable(datos);
  if (motivo) return motivo;
  if (estado === 'activo' && esCargoAgente(datos) && datos.asistio_formacion !== true) {
    return 'Para marcar activo a un Agente primero debe tener la asistencia a formación en "Sí"';
  }
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

module.exports = { enFormacion, motivoNoEditable, motivoNoAsistencia, motivoNoEstado, debeLimpiarActivo };
