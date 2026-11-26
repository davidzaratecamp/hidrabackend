'use strict';

/**
 * Excel "BASE RECLUTAMIENTO" del archivo histórico: reusa los encabezados de
 * `reportes/excel.js`, así que su fila tiene que tener exactamente una celda
 * por columna y en el mismo orden. Hasta 2026-11-26 faltaba TELÉFONO y todo
 * lo que seguía a CORREO salía corrido una columna a la izquierda.
 */

const { construirWorkbookHistorico } = require('../../src/modules/historico/historico.excel');

/** Encabezado de cada columna: el de la fila 2 si es un grupo, si no el de la fila 1. */
function encabezados(hoja) {
  const columnas = {};
  for (let col = 1; col <= hoja.columnCount; col += 1) {
    const grupo = hoja.getRow(1).getCell(col).value;
    const sub = hoja.getRow(2).getCell(col).value;
    columnas[sub && sub !== grupo ? `${grupo}/${sub}` : grupo] = col;
  }
  return columnas;
}

describe('Excel del histórico', () => {
  const candidato = {
    created_at: new Date(2026, 7, 20),
    reclutador_nombre: 'Analista Uno',
    cliente: 'Hogar',
    cargo: 'Agente',
    primer_nombre: 'Ana',
    primer_apellido: 'Pérez',
    tipo_documento: 'CC',
    numero_documento: '1012345678',
    edad: 30,
    email_personal: 'ana@correo.com',
    numero_celular: '3001234567',
    contacto_llamada: 'si',
    contacto_whatsapp: 'no',
    aprobacion_final: 1,
    aprobacion_final_razon: 'Cumple',
  };

  const hoja = construirWorkbookHistorico([candidato]).getWorksheet('Histórico');
  const col = encabezados(hoja);
  const fila = hoja.getRow(3);

  it('emite una celda por columna de encabezado', () => {
    expect(fila.cellCount).toBe(hoja.columnCount);
  });

  it('cada dato queda bajo su encabezado', () => {
    expect(fila.getCell(col.CORREO).value).toBe('ana@correo.com');
    expect(fila.getCell(col['TELÉFONO']).value).toBe('3001234567');
    expect(fila.getCell(col['CONTACTO/LLAMADA']).value).toBe('Sí');
    expect(fila.getCell(col['CONTACTO/WHATSAPP']).value).toBe('No');
    expect(fila.getCell(col.PERFIL).value).toBe('');
    expect(fila.getCell(col.EXPERIENCIA).value).toBe('');
    expect(fila.getCell(col.CITADO).value).toBe('Sí');
    expect(fila.getCell(col['¿POR QUÉ NO APROBÓ?']).value).toBe('Cumple');
  });
});
