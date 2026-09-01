'use strict';

/**
 * Fila del Excel "BASE RECLUTAMIENTO" para el archivo histórico
 * (`hyd_candidatos`, esquema viejo). Reusa la estructura de encabezados de
 * `reportes/excel.js` (idéntica: es el mismo documento oficial) con un
 * mapeo de fila propio, porque el esquema viejo tiene otros nombres de
 * columna y otros valores (`'si'`/`'no'` en vez de booleanos, por ejemplo).
 *
 * Réplica de `filaCandidatoExcel` (`controllers/seleccion.controller.js`,
 * borrado en la reestructuración), con una sola diferencia deliberada:
 *
 *   FECHA -> sale de `created_at` (fecha de registro en "Nuevo candidato"),
 *            no de `fecha_citacion_entrevista`. Esa columna nunca tuvo quien
 *            la escribiera de forma confiable en el sistema viejo y salía
 *            vacía para casi todos los candidatos (decisión de negocio,
 *            2026-09-01).
 *
 * CITADO se deja igual que el original: `'Sí'` fijo en todas las filas. Es
 * un bug ya documentado del sistema viejo, pero corregirlo sería inventar un
 * dato que el archivo histórico no tiene forma confiable de dar — al
 * contrario que en `reportes/excel.js` (esquema nuevo), donde sí existe una
 * columna real (`candidatos.citado`) para reemplazarlo.
 */

const { nombreCompleto } = require('../../shared/utils/nombreCompleto');
const { construirWorkbook, enviarWorkbook } = require('../reportes/excel');
const {
  siNoTexto, siNoBooleano, textoAntecedente, textoAsistencia, textoEstadoGestion,
} = require('./historico.presentacion');

/** `created_at` llega como `Date` (TIMESTAMP, sin `dateStrings` en el pool). */
function fechaCorta(valor) {
  if (!valor) return '';
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return '';
  const dos = (n) => String(n).padStart(2, '0');
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function filaHistorico(c) {
  const llamada = siNoTexto(c.contacto_llamada);
  const whatsapp = siNoTexto(c.contacto_whatsapp);

  return [
    fechaCorta(c.created_at),
    c.reclutador_nombre || '',
    c.cliente || '',
    c.cargo || '',
    nombreCompleto(c),
    c.tipo_documento || '',
    c.numero_documento || '',
    c.edad ?? '',
    c.email_personal || '',
    llamada,
    whatsapp,
    '', // PERFIL: el esquema viejo no tiene esta columna.
    'Sí', // CITADO: ver nota arriba.
    textoEstadoGestion(c),
    llamada,
    whatsapp,
    textoAsistencia(c.asistio_citacion),
    c.motivo_inasistencia || '',
    textoAntecedente(c.antecedentes_adres),
    textoAntecedente(c.antecedentes_pol),
    textoAntecedente(c.antecedentes_comp),
    textoAntecedente(c.antecedentes_procu),
    siNoBooleano(c.aprobacion_final),
    c.aprobacion_final_razon || '',
  ];
}

function construirWorkbookHistorico(candidatos) {
  return construirWorkbook(candidatos, { nombreHoja: 'Histórico', filaFn: filaHistorico });
}

module.exports = { construirWorkbookHistorico, enviarWorkbook };
