// Helpers genéricos y reutilizables para llenar plantillas PDF de celdas fijas con
// contenido de longitud variable ("fit" de tamaño de fuente + wrap). Compartidos por
// hojaVidaPdfService.js y tratamientoDatosPdfService.js — sin estado, sin conocimiento de
// ningún documento en particular.
const { rgb } = require('pdf-lib');
const { OPS } = require('pdfjs-dist/legacy/build/pdf.js');

function widthOf(font, text, size) {
  return font.widthOfTextAtSize(text, size);
}

// Reduce el tamaño de fuente hasta que el texto quepa en maxWidth en una sola línea.
// Si ni al tamaño mínimo cabe, trunca con "…".
function fitSingleLine(font, text, maxWidth, { startSize = 9, minSize = 6 } = {}) {
  let size = startSize;
  while (size > minSize && widthOf(font, text, size) > maxWidth) size -= 0.5;
  if (widthOf(font, text, size) <= maxWidth) return { text, size };

  let truncated = text;
  while (truncated.length > 1 && widthOf(font, truncated + '…', minSize) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return { text: truncated + '…', size: minSize };
}

// Envuelve texto en líneas que quepan en maxWidth a un tamaño de fuente dado.
function wrapLines(font, text, maxWidth, size) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word;
    if (widthOf(font, attempt, size) <= maxWidth) {
      current = attempt;
    } else {
      if (current) lines.push(current);
      if (widthOf(font, word, size) > maxWidth) {
        let piece = '';
        for (const ch of word) {
          if (widthOf(font, piece + ch, size) <= maxWidth) piece += ch;
          else { lines.push(piece); piece = ch; }
        }
        current = piece;
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Dibuja un bloque de texto libre dentro de una caja de ancho/alto fijos: intenta con
// startSize, reduce fuente si el wrap no cabe en maxHeight, y si ni al tamaño mínimo cabe,
// trunca la última línea visible con "…".
function drawTextBox(page, font, text, { x, y, maxWidth, maxHeight, startSize = 9, minSize = 6.5, lineGap = 1.15, color = rgb(0.15, 0.15, 0.15) }) {
  if (!text) return;
  let size = startSize;
  let lines;
  for (;;) {
    lines = wrapLines(font, text, maxWidth, size);
    const blockHeight = lines.length * size * lineGap;
    if (blockHeight <= maxHeight || size <= minSize) break;
    size -= 0.5;
  }
  const maxLines = Math.max(1, Math.floor(maxHeight / (size * lineGap)));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = fitSingleLine(font, last + '…', maxWidth, { startSize: size, minSize: size }).text;
  }
  let cursorY = y;
  for (const line of lines) {
    page.drawText(line, { x, y: cursorY, size, font, color });
    cursorY -= size * lineGap;
  }
}

function drawFit(page, font, text, { x, y, maxWidth, startSize = 9, minSize = 6, color = rgb(0.15, 0.15, 0.15) }) {
  if (text === null || text === undefined || text === '') return;
  const { text: fitted, size } = fitSingleLine(font, String(text), maxWidth, { startSize, minSize });
  page.drawText(fitted, { x, y, size, font, color });
}

// Marca la casilla SI/NO correspondiente con un óvalo rojo alrededor del texto impreso.
function marcarSiNo(page, valor, casillas) {
  const esSi = String(valor).toLowerCase() === 'si' || valor === true || valor === 1;
  const target = esSi ? casillas.si : casillas.no;
  if (!target) return;
  const padX = 3, padY = 2;
  page.drawEllipse({
    x: target.x + target.w / 2,
    y: target.y + target.h / 2,
    xScale: target.w / 2 + padX,
    yScale: target.h / 2 + padY,
    borderColor: rgb(0.8, 0, 0),
    borderWidth: 1.2
  });
}

function fmtFecha(d) {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  // timeZone: 'UTC' — MySQL entrega fechas sin hora (DATE) como medianoche UTC; sin fijar la
  // zona acá, toLocaleDateString las formatea en la zona horaria del servidor, y en zonas
  // detrás de UTC (Bogotá, UTC-5) el día se corre uno hacia atrás (ej. 2025-08-15 salía
  // "14/08/2025"). Fijar UTC en ambos lados (interpretación y formato) evita el corrimiento.
  return date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

function nombreCompleto(c) {
  return [c.primer_nombre, c.segundo_nombre, c.primer_apellido, c.segundo_apellido].filter(Boolean).join(' ');
}

// ── Detección dinámica de bordes de tabla ───────────────────────────────────────────────────
// Mismo patrón de escaneo que usa FirmaCloud (getOperatorList + filtro de trazos delgados) para
// ubicar dónde firmar en sus módulos de RRHH/Reclutamiento, reimplementado aquí como código
// propio de este servicio: en vez de coordenadas fijas para el borde de cada celda (que se
// desalinean si la plantilla cambia de diseño, o que terminan copiando la posición CENTRADA de
// un encabezado de columna en vez del borde real de la celda), se leen los trazos vectoriales
// reales de la tabla en cada generación de PDF.
async function getTableBorders(pdfjsPage) {
  const opList = await pdfjsPage.getOperatorList();
  const THIN = 1.0; // pt — grosor típico de una línea de borde de tabla
  const horizLines = [];
  const vertLines = [];
  for (let i = 0; i < opList.fnArray.length; i++) {
    if (opList.fnArray[i] !== OPS.constructPath) continue;
    const bbox = opList.argsArray[i][2]; // [minX, maxX, minY, maxY]
    if (!bbox) continue;
    const [minX, maxX, minY, maxY] = bbox;
    const w = maxX - minX, h = maxY - minY;
    if (h <= THIN && w > 15) horizLines.push({ minX, maxX, y: (minY + maxY) / 2 });
    else if (w <= THIN && h > 6) vertLines.push({ minY, maxY, x: (minX + maxX) / 2 });
  }
  return { horizLines, vertLines };
}

// Bordes verticales que cruzan una fila (rango Y) de una tabla, de izquierda a derecha — ej.
// [180.43, 336.87, 506.62, 587.62] para una fila con 3 columnas de datos (4 bordes delimitan 3
// celdas), o solo 2 bordes si esa fila en particular viene con columnas fusionadas en una sola
// celda. `minX` descarta bordes a la izquierda de ese punto (ej. el borde exterior de una
// columna de etiquetas que no interesa).
function getRowColumnBorders(vertLines, rowY, minX = 0) {
  return vertLines
    .filter(v => v.minY <= rowY + 2 && v.maxY >= rowY - 2 && v.x >= minX)
    .map(v => v.x)
    .sort((a, b) => a - b);
}

module.exports = {
  fitSingleLine, wrapLines, drawTextBox, drawFit, marcarSiNo, fmtFecha, nombreCompleto,
  getTableBorders, getRowColumnBorders
};
