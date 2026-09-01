// Llena plantilla/AUTORIZACIÓN TRATAMIENTO DE DATOS -BOG 1111.pdf ("AUTORIZACIÓN PARA EL
// TRATAMIENTO DE DATOS PERSONALES...", v2.0, GH-RL-F-03) con los datos del candidato, para
// generar el segundo PDF que se envía a FirmaCloud a firmar (junto con la hoja de vida,
// ver hojaVidaPdfService.js). Documento de 5 páginas, en su mayoría texto legal fijo — solo
// tiene 6 espacios en blanco reales (nombre/tipo doc/número doc en página 1, y
// ciudad/día/mes en página 5) más la línea de firma.
//
// El texto ancla que FirmaCloud va a detectar para estampar la firma es la palabra "FIRMA"
// (única en todo el documento, verificado) — la línea en blanco arriba de esa palabra se
// deja intacta.
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { drawFit } = require('./pdfFillHelpers');

const TEMPLATE_PATH = path.join(__dirname, '..', '..', '..', '..', 'plantilla', 'AUTORIZACIÓN TRATAMIENTO DE DATOS -BOG 1111.pdf');

// candidato: mismo objeto que ya devuelve
// candidatoFormulario.repository.obtenerCandidatoConFormulario (comparte varios campos con
// hojaVidaPdfService.js: nombreCompleto, tipo_documento, numero_documento).
async function generarTratamientoDatosPdf(candidato) {
  const bytes = fs.readFileSync(TEMPLATE_PATH);
  const pdfDoc = await PDFDocument.load(bytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pages = pdfDoc.getPages();
  const p1 = pages[0];
  const p5 = pages[4];

  const nombre = [candidato.primer_nombre, candidato.segundo_nombre, candidato.primer_apellido, candidato.segundo_apellido]
    .filter(Boolean).join(' ');

  // ── PÁGINA 1 — "Yo [nombre] mayor de edad, Identificado (a) con [tipo doc] No.
  // [número doc] domiciliado (a) en esta ciudad." ────────────────────────────────
  drawFit(p1, font, nombre, { x: 100, y: 552.14, maxWidth: 225, startSize: 9, minSize: 6.5 });
  drawFit(p1, font, candidato.tipo_documento, { x: 100, y: 538.31, maxWidth: 72, startSize: 8.5, minSize: 6 });
  drawFit(p1, font, candidato.numero_documento, { x: 210, y: 538.31, maxWidth: 95, startSize: 8.5, minSize: 6 });

  // ── PÁGINA 5 — "...en la ciudad de [ciudad] el día [día] del mes de [mes] del año
  // 2026." + firma. El año queda como texto fijo de la plantilla (impreso "2026"). ──
  drawFit(p5, font, candidato.ciudad_consentimiento, { x: 318, y: 197.57, maxWidth: 92, startSize: 8.5, minSize: 6 });
  drawFit(p5, font, candidato.dia_consentimiento, { x: 464, y: 197.57, maxWidth: 20, startSize: 8.5, minSize: 6 });
  drawFit(p5, font, nombreMes(candidato.mes_consentimiento), { x: 95, y: 183.74, maxWidth: 92, startSize: 8.5, minSize: 6 });

  // Nombre trabajador / Documento — debajo de la línea de firma.
  drawFit(p5, font, nombre, { x: 177, y: 114.97, maxWidth: 220, startSize: 9, minSize: 6.5 });
  drawFit(p5, font, candidato.numero_documento, { x: 141, y: 101.15, maxWidth: 150, startSize: 9, minSize: 6.5 });

  // La línea en blanco arriba de "FIRMA" (y≈142.63, x≈78) se deja SIN TOCAR — es el ancla
  // que FirmaCloud detecta (busca el texto "FIRMA" y la línea inmediatamente encima).

  return Buffer.from(await pdfDoc.save());
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function nombreMes(mesNumero) {
  const n = Number(mesNumero);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? MESES[n - 1] : mesNumero;
}

module.exports = { generarTratamientoDatosPdf, TEMPLATE_PATH };
