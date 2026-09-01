'use strict';

/**
 * Construcción del Excel oficial "BASE RECLUTAMIENTO".
 *
 * Portado de `seleccion.controller.js`, donde vivía embebido en el controller
 * junto a ~200 líneas de armado de encabezados. El formato de columnas se
 * conserva exacto: es un documento oficial que se comparte fuera del sistema.
 *
 * Tres columnas mejoran respecto al original:
 *   CITADO  -> ya no se emite 'Sí' fijo para todas las filas: sale de lo que
 *              diligenció la reclutadora al registrar y, si no lo tocó, de si el
 *              candidato tiene realmente una citación.
 *   FECHA   -> sale de `candidato_citaciones`, que sí tiene quien la escriba.
 *              La columna equivalente del esquema viejo se quedó sin escritor y
 *              por eso el export salía vacío. Desde la migración 009 es la fecha
 *              EN QUE se citó, no la de la entrevista: citar ya no lleva fecha.
 *   PERFIL  -> se captura en el registro desde la migración 007; antes esta
 *              columna se emitía siempre en blanco porque nadie la escribía.
 */

const ExcelJS = require('exceljs');
const { nombreCompleto } = require('../../shared/utils/nombreCompleto');

/** Estructura de encabezados: grupos de 1 columna se fusionan verticalmente. */
const GRUPOS = [
  { label: 'FECHA' },
  { label: 'ANALISTA' },
  { label: 'CAMPAÑA' },
  { label: 'CARGO' },
  { label: 'NOMBRE' },
  { label: 'TIPO DE DOC' },
  { label: 'DOCUMENTO' },
  { label: 'EDAD' },
  { label: 'CORREO' },
  { label: 'CONTACTO', sub: ['LLAMADA', 'WHATSAPP'] },
  { label: 'PERFIL' },
  { label: 'CITADO' },
  { label: 'ESTADO GESTIÓN RECLUTAMIENTO' },
  { label: 'SEGUIMIENTO ASISTENCIA', sub: ['LLAMADA', 'GLOBAL/WA'] },
  { label: 'ASISTE ENTREVISTA' },
  { label: 'MOTIVO INASISTENCIA' },
  { label: 'ANTECEDENTES', sub: ['ADRES', 'POL', 'COMP', 'PROCU'] },
  { label: 'APROBADO' },
  { label: '¿POR QUÉ NO APROBÓ?' },
];

const siNo = (valor) => (valor === true ? 'Sí' : valor === false ? 'No' : '');

const textoAntecedente = (valor) =>
  ({ aprobado: 'Aprobado', no_aprobado: 'No aprobado' })[valor] ?? '';

const textoAsistencia = (valor) =>
  ({ asistio: 'Asistió', no_asistio: 'No asistió' })[valor] ?? 'Pendiente';

/**
 * Texto de la columna "ESTADO GESTIÓN RECLUTAMIENTO".
 *
 * Mantiene la prioridad del original: si ya hay evaluación pero nadie decidió,
 * eso pesa más que el estado.
 */
function textoEstadoGestion(c) {
  if (c.evaluacion_total !== null && c.aprobacion_final === null) {
    return 'Pendiente Decisión Final';
  }
  return c.estado_nombre || c.estado || '';
}

/**
 * Formatea a DD/MM/AAAA lo que devuelva el driver.
 *
 * Hay que aceptar los dos tipos: `dateStrings` del pool cubre DATE y DATETIME,
 * que llegan como 'AAAA-MM-DD HH:MM:SS' sin corrimiento de zona, pero NO cubre
 * TIMESTAMP —que es el tipo de `created_at`, de donde ahora sale la columna
 * FECHA—, y ese llega como Date de JS. Con `String(fecha)` a secas salía
 * "Sun Aug 30 2026 …" y la celda quedaba vacía.
 */
function fechaCorta(valor) {
  if (!valor) return '';

  if (valor instanceof Date) {
    const dos = (n) => String(n).padStart(2, '0');
    return `${dos(valor.getDate())}/${dos(valor.getMonth() + 1)}/${valor.getFullYear()}`;
  }

  const [anio, mes, dia] = String(valor).slice(0, 10).split('-');
  return dia ? `${dia}/${mes}/${anio}` : '';
}

function filaBase(c, fechaValor) {
  const llamada = siNo(c.contacto_llamada);
  const whatsapp = siNo(c.contacto_whatsapp);

  return [
    fechaCorta(fechaValor),
    c.reclutador || '',
    c.cliente || '',
    c.cargo || '',
    nombreCompleto(c),
    c.tipo_documento || '',
    c.numero_documento || '',
    c.edad ?? '',
    c.email || '',
    llamada,
    whatsapp,
    // PERFIL y CITADO se capturan desde 2026-08-30 en el registro (migración 007).
    c.perfil || '',
    // Manda lo que diligenció la reclutadora al registrar; si no lo tocó, se
    // cae a si tiene citación. Los dos caminos coinciden desde la migración
    // 009 —marcar Citado = Sí crea la citación—, pero el respaldo cubre a los
    // candidatos que citó Selección después del registro.
    c.citado === null || c.citado === undefined ? (c.fecha_citado ? 'Sí' : 'No') : siNo(c.citado),
    c.estado_gestion || textoEstadoGestion(c),
    // SEGUIMIENTO ASISTENCIA reutiliza el contacto inicial: es el único dato de
    // seguimiento que el sistema captura hoy.
    llamada,
    whatsapp,
    textoAsistencia(c.asistio),
    c.motivo_inasistencia || '',
    textoAntecedente(c.antecedente_adres),
    textoAntecedente(c.antecedente_policia),
    textoAntecedente(c.antecedente_comparendos),
    textoAntecedente(c.antecedente_procuraduria),
    siNo(c.aprobacion_final),
    c.aprobacion_final_razon || '',
  ];
}

/** FECHA = fecha en que se citó. Usada por los reportes "citados"/"aprobados". */
function fila(c) {
  return filaBase(c, c.fecha_citado);
}

/**
 * FECHA = fecha de REGISTRO (`created_at`), no de citación. La usa el reporte
 * "todos" de la pantalla Candidatos: ahí la mayoría de las filas ni siquiera
 * tienen una citación todavía, así que `fecha_citado` saldría vacío para casi
 * todas (decisión de negocio, 2026-09-01).
 */
function filaTodos(c) {
  return filaBase(c, c.created_at);
}

function construirWorkbook(candidatos, { nombreHoja = 'Selección', filaFn = fila } = {}) {
  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet(nombreHoja);

  const fila1 = hoja.getRow(1);
  const fila2 = hoja.getRow(2);
  let columna = 1;

  for (const grupo of GRUPOS) {
    const ancho = grupo.sub ? grupo.sub.length : 1;
    const inicio = columna;
    const fin = columna + ancho - 1;

    fila1.getCell(inicio).value = grupo.label;
    if (ancho > 1) {
      hoja.mergeCells(1, inicio, 1, fin);
      grupo.sub.forEach((sub, i) => {
        fila2.getCell(inicio + i).value = sub;
      });
    } else {
      hoja.mergeCells(1, inicio, 2, inicio);
    }
    hoja.getColumn(inicio).width = Math.max(grupo.label.length, 12);
    columna = fin + 1;
  }

  const totalColumnas = columna - 1;
  for (const filaEncabezado of [fila1, fila2]) {
    for (let i = 1; i <= totalColumnas; i += 1) {
      const celda = filaEncabezado.getCell(i);
      celda.font = { bold: true };
      celda.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      celda.border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' },
      };
    }
  }
  fila1.height = 20;
  fila2.height = 18;

  for (const candidato of candidatos) hoja.addRow(filaFn(candidato));

  return workbook;
}

/** Escribe el workbook en la respuesta como descarga. */
async function enviarWorkbook(res, workbook, nombreArchivo) {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  // Nombre generado por el servidor, nunca con datos del usuario dentro.
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
  await workbook.xlsx.write(res);
  return res.end();
}

module.exports = { construirWorkbook, enviarWorkbook, GRUPOS, filaTodos };
