'use strict';

/**
 * Lectura del Excel de importación masiva de candidatos.
 *
 * Separado de `candidato.service.js` a propósito: esto es "cómo leer un
 * archivo", no una regla de negocio — mismo criterio que `seleccion/citar.js`,
 * que vive aparte porque es un concern distinto al del servicio que lo usa.
 *
 * Las columnas son EXACTAMENTE los campos del formulario "Nuevo Candidato"
 * (`hidrafrontend/.../CandidatoCampos.jsx` modo "crear"): quien llena el
 * Excel no tiene por qué poder crear nada que el formulario manual no
 * permita, ni al revés.
 */

const ExcelJS = require('exceljs');

const COLUMNAS = [
  { encabezado: 'CAMPAÑA', campo: 'cliente' },
  { encabezado: 'CARGO', campo: 'cargo' },
  { encabezado: 'NOMBRE', campo: 'nombreCompleto' },
  { encabezado: 'TIPO DE DOCUMENTO', campo: 'tipoDocumento' },
  { encabezado: 'DOCUMENTO', campo: 'numeroDocumento' },
  { encabezado: 'EDAD', campo: 'edad' },
  { encabezado: 'CORREO', campo: 'email' },
  { encabezado: 'CELULAR', campo: 'celular' },
  { encabezado: 'CONTACTO LLAMADA', campo: 'contactoLlamada', siNo: true },
  { encabezado: 'CONTACTO WHATSAPP', campo: 'contactoWhatsapp', siNo: true },
  { encabezado: 'PERFIL', campo: 'perfil' },
  { encabezado: 'CITADO', campo: 'citado', siNo: true },
  { encabezado: 'ESTADO GESTIÓN RECLUTAMIENTO', campo: 'estadoGestion' },
  { encabezado: 'FUENTE DE RECLUTAMIENTO', campo: 'fuenteReclutamiento' },
];

// Todas las columnas son obligatorias (decisión de negocio, 2026-09-15): los
// mismos campos que ahora exige `candidato.schema.js::crear` en el formulario
// manual. ESTADO GESTIÓN RECLUTAMIENTO queda afuera a propósito: solo aplica
// cuando CITADO = No (lo valida el `superRefine` del esquema, fila por fila,
// con un mensaje que dice exactamente en cuál falta).
const OBLIGATORIAS = COLUMNAS.filter((c) => c.encabezado !== 'ESTADO GESTIÓN RECLUTAMIENTO').map(
  (c) => c.encabezado
);

const ENCABEZADO_POR_CAMPO = new Map(COLUMNAS.map((c) => [c.campo, c.encabezado]));

/** Etiqueta legible para un error de campo (cae al nombre del campo si no está mapeado). */
function etiquetaDe(campo) {
  return ENCABEZADO_POR_CAMPO.get(campo) ?? campo;
}

/**
 * Extrae el texto plano de un valor de celda de ExcelJS.
 *
 * `celda.value` no siempre es un string: Excel auto-convierte un correo o una
 * URL tecleados en un hipervínculo (`{ text, hyperlink }`), y una celda con
 * formato mixto llega como texto enriquecido (`{ richText: [...] }`) o como
 * fórmula (`{ formula, result }`). Sin esto, `String(valor)` de un correo
 * "linkificado" da literalmente "[object Object]" — el dato SÍ estaba bien
 * escrito en el Excel, se perdía al leerlo.
 */
function textoPlano(valor) {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) return String(valor);
  if (typeof valor === 'object') {
    if (typeof valor.text === 'string') return valor.text; // hipervínculo
    if (Array.isArray(valor.richText)) return valor.richText.map((r) => r.text).join('');
    if ('result' in valor) return textoPlano(valor.result); // fórmula
    return '';
  }
  return String(valor);
}

function normalizarTexto(valor) {
  const texto = textoPlano(valor).trim();
  return texto === '' ? undefined : texto;
}

/** "Sí"/"No" (con o sin tilde, cualquier mayúscula) -> boolean. Vacío -> undefined. */
function siNoABooleano(valor, nombreColumna, errores) {
  const texto = normalizarTexto(valor);
  if (texto === undefined) return undefined;

  const normalizado = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  if (normalizado === 'si') return true;
  if (normalizado === 'no') return false;

  errores.push(`${nombreColumna}: debe ser "Sí" o "No" (se encontró "${texto}")`);
  return undefined;
}

/**
 * Lee el primer worksheet del buffer.
 *
 * @returns {Promise<{ fila: number, datos: object, errores: string[] }[]>}
 *   Una entrada por fila con datos (filas totalmente vacías se omiten). El
 *   número de fila es el real de Excel (empezando en 2, justo después del
 *   encabezado), para que el mensaje de error señale la fila que el usuario
 *   ve al abrir su archivo.
 */
async function parsearWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const hoja = workbook.worksheets[0];
  if (!hoja) throw new Error('El archivo no tiene ninguna hoja de cálculo');

  const columnaPorEncabezado = new Map();
  hoja.getRow(1).eachCell((celda) => {
    const texto = normalizarTexto(celda.value)?.toUpperCase();
    if (texto) columnaPorEncabezado.set(texto, celda.col);
  });

  const faltantes = OBLIGATORIAS.filter((h) => !columnaPorEncabezado.has(h));
  if (faltantes.length > 0) {
    throw new Error(`Al archivo le faltan columnas obligatorias: ${faltantes.join(', ')}`);
  }

  const filas = [];
  hoja.eachRow((row, numeroFila) => {
    if (numeroFila === 1) return;

    const errores = [];
    const datos = {};
    let vacia = true;

    for (const { encabezado, campo, siNo } of COLUMNAS) {
      const columna = columnaPorEncabezado.get(encabezado);
      if (!columna) continue;

      const crudo = row.getCell(columna).value;
      const valor = siNo ? siNoABooleano(crudo, encabezado, errores) : normalizarTexto(crudo);
      if (valor !== undefined) {
        vacia = false;
        datos[campo] = valor;
      }
    }

    if (vacia && errores.length === 0) return;
    filas.push({ fila: numeroFila, datos, errores });
  });

  return filas;
}

module.exports = { parsearWorkbook, COLUMNAS, etiquetaDe };
