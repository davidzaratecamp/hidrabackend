'use strict';

/**
 * Traducciones de los valores crudos del archivo histórico (`hyd_candidatos`)
 * a texto legible.
 *
 * Un solo lugar para esta lógica: antes vivía duplicada entre el listado
 * (`historico.repository.js`) y el Excel "BASE RECLUTAMIENTO"
 * (`historico.excel.js`), con riesgo real de que ambos divergieran — la vista
 * en pantalla y el Excel descargado deben decir exactamente lo mismo para el
 * mismo candidato.
 */

const siNoTexto = (valor) => (valor === 'si' ? 'Sí' : valor === 'no' ? 'No' : '');

// `aprobacion_final` es TINYINT(1): el pool ya lo convierte a boolean real
// (ver `convertirTipos` en `config/db.js`), no llega como 1/0.
const siNoBooleano = (valor) => (valor === true ? 'Sí' : valor === false ? 'No' : '');

const textoAntecedente = (valor) =>
  ({ aprobado: 'Aprobado', no_aprobado: 'No aprobado' })[valor] ?? '';

const textoAsistencia = (valor) =>
  ({ asistio: 'Asistió', no_asistio: 'No asistió' })[valor] ?? 'Pendiente';

/**
 * "ESTADO GESTIÓN RECLUTAMIENTO" del documento oficial.
 *
 * Misma prioridad que el sistema viejo: si ya hay evaluación pero nadie
 * decidió, eso pesa más que el estado.
 */
function textoEstadoGestion(c) {
  if (c.evaluacion_total !== null && c.aprobacion_final === null) {
    return 'Pendiente Decisión Final';
  }
  const mapa = {
    citado: 'Citado', no_asistio: 'No asistió', entrevistado: 'Entrevistado',
    aprobado_final: 'Aprobado Final', rechazado_final: 'Rechazado Final',
    rechazado: 'Rechazado', contratado: 'Contratado',
  };
  return mapa[c.estado] || c.estado || '';
}

module.exports = { siNoTexto, siNoBooleano, textoAntecedente, textoAsistencia, textoEstadoGestion };
