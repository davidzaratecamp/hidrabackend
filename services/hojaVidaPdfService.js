// Llena plantilla/hojavida.pdf ("FORMATO HOJA DE VIDA" v3.0, GH-RYS-F-04) con los datos
// normalizados del candidato (hyd_candidatos + las 6 tablas hyd_candidato_*), para
// generar el PDF que se envía a FirmaCloud a firmar. Módulo propio de este servicio
// (candidatos/formulario) — no depende de ningún otro módulo de hidrabackend.
//
// Estrategia: la información del candidato es de longitud VARIABLE (nombres largos,
// correos largos, funciones/motivos de longitud libre, textos de la página 2) sobre una
// plantilla de celdas de tamaño FIJO (es un formato impreso, no una página que fluye). Por
// eso cada valor se dibuja con "fit": se reduce el tamaño de fuente hasta que quepa en el
// ancho/alto disponible, y si aun al tamaño mínimo no cabe, se recorta con "…" — nunca se
// deja que el texto se salga de su celda ni pise la celda vecina. Coordenadas calibradas
// extrayendo la posición real de cada etiqueta impresa con pdfjs-dist y verificadas
// renderizando el PDF resultante.
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { drawTextBox, drawFit, marcarSiNo, fmtFecha, nombreCompleto } = require('../utils/pdfFillHelpers');

const TEMPLATE_PATH = path.join(__dirname, '..', 'plantilla', 'hojavida.pdf');

// Los 4 niveles posibles de hyd_candidato_estudios.nivel_estudios calzan exacto con las 4
// filas fijas de la tabla "INFORMACIÓN ACADEMICA" impresas en la plantilla.
const NIVEL_ROWS = {
  bachillerato: 417.5,
  tecnico_tecnologo: 398.48,
  profesional_u_otros: 378.45,
  conocimientos_informaticos: 359.02
};

// candidato: el objeto que devuelve candidatoFormulario.repository.obtenerCandidatoConFormulario
// (hyd_candidatos aplanado + estudios[] + experiencia[]).
async function generarHojaVidaPdf(candidato) {
  const bytes = fs.readFileSync(TEMPLATE_PATH);
  const pdfDoc = await PDFDocument.load(bytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const [p1, p2] = pdfDoc.getPages();

  // ── DATOS BÁSICOS ── filas angostas (22pt) → valor a la DERECHA de la etiqueta, no
  // debajo (no hay espacio vertical suficiente en estas 2 filas específicas).
  drawFit(p1, font, fmtFecha(candidato.fecha_citacion_entrevista), { x: 108, y: 681.56, maxWidth: 225 });
  drawFit(p1, font, candidato.fuente_reclutamiento, { x: 402, y: 676.4, maxWidth: 190 });
  drawFit(p1, font, candidato.cargo, { x: 108, y: 659.16, maxWidth: 225 });
  drawFit(p1, font, candidato.aspiracion_salarial, { x: 419, y: 659.16, maxWidth: 173 });

  // ── DATOS PERSONALES ───────────────────────────────────────────────────────
  drawFit(p1, font, nombreCompleto(candidato), { x: 30, y: 609, maxWidth: 250 });
  drawFit(p1, font, candidato.numero_documento, { x: 291, y: 609, maxWidth: 90 });
  drawFit(p1, font, candidato.nacionalidad, { x: 390, y: 609, maxWidth: 110 });
  drawFit(p1, font, candidato.numero_celular, { x: 508, y: 609, maxWidth: 82 });

  drawFit(p1, font, candidato.email_personal, { x: 30, y: 573, maxWidth: 205 });
  drawFit(p1, font, candidato.eps, { x: 245, y: 573, maxWidth: 88 });
  drawFit(p1, font, candidato.afp, { x: 342, y: 573, maxWidth: 78 });
  drawFit(p1, font, candidato.edad, { x: 428, y: 573, maxWidth: 72 });
  drawFit(p1, font, candidato.grupo_sanguineo, { x: 508, y: 573, maxWidth: 82 });

  drawFit(p1, font, candidato.direccion_residencial, { x: 30, y: 534, maxWidth: 205 });
  drawFit(p1, font, candidato.barrio, { x: 245, y: 534, maxWidth: 88 });
  drawFit(p1, font, candidato.estado_civil, { x: 342, y: 534, maxWidth: 78 });
  drawFit(p1, font, candidato.talla_camisa, { x: 428, y: 534, maxWidth: 72 });

  // ── CONTACTO DE EMERGENCIA ─────────────────────────────────────────────────
  drawFit(p1, font, candidato.parentesco_emergencia, { x: 30, y: 475, maxWidth: 220 });
  drawFit(p1, font, candidato.nombre_emergencia, { x: 265, y: 475, maxWidth: 195 });
  drawFit(p1, font, candidato.numero_emergencia, { x: 470, y: 475, maxWidth: 115 });

  // ── INFORMACIÓN ACADÉMICA (4 filas fijas por nivel, 1:N variable en BD) ────
  const estudios = Array.isArray(candidato.estudios) ? candidato.estudios : [];
  for (const fila of estudios) {
    const y = NIVEL_ROWS[fila.nivel_estudios];
    if (y === undefined) continue; // nivel desconocido: no debería pasar, se ignora sin tronar
    if (fila.nivel_estudios === 'conocimientos_informaticos') {
      drawFit(p1, font, fila.descripcion, { x: 225, y, maxWidth: 365, startSize: 8.5, minSize: 6 });
    } else {
      drawFit(p1, font, fila.nombre_institucion, { x: 225, y, maxWidth: 160, startSize: 8.5, minSize: 6 });
      drawFit(p1, font, fila.titulo_obtenido, { x: 393, y, maxWidth: 115, startSize: 8.5, minSize: 6 });
      drawFit(p1, font, fila.ano_finalizacion, { x: 512, y, maxWidth: 78, startSize: 8.5, minSize: 6 });
    }
  }

  // ── EXPERIENCIA LABORAL — última/actual empresa (orden 1) ──────────────────
  const empresaActual = (candidato.experiencia || []).find((e) => e.orden === 1) || candidato.experiencia?.[0];
  if (empresaActual) {
    drawFit(p1, font, empresaActual.nombre_empresa, { x: 120, y: 301.54, maxWidth: 172 });
    drawFit(p1, font, empresaActual.cargo_desempenado, { x: 382, y: 301.54, maxWidth: 82 });
    drawFit(p1, font, empresaActual.salario, { x: 513, y: 301.54, maxWidth: 78 });
    drawTextBox(p1, font, empresaActual.funciones, { x: 30, y: 264, maxWidth: 555, maxHeight: 24, startSize: 8, minSize: 6.5 });
    drawFit(p1, font, fmtFecha(empresaActual.fecha_inicio), { x: 87, y: 243.45, maxWidth: 108, startSize: 8 });
    drawFit(p1, font, fmtFecha(empresaActual.fecha_retiro), { x: 228, y: 238.3, maxWidth: 110, startSize: 8 });
    const tiempo = [empresaActual.tiempo_laborado_anos ? `${empresaActual.tiempo_laborado_anos}a` : null,
      empresaActual.tiempo_laborado_meses ? `${empresaActual.tiempo_laborado_meses}m` : null].filter(Boolean).join(' ');
    drawFit(p1, font, tiempo, { x: 384, y: 238.3, maxWidth: 84, startSize: 8, minSize: 6 });
    drawFit(p1, font, empresaActual.motivo_retiro, { x: 502, y: 233.14, maxWidth: 90, startSize: 7, minSize: 5.5 });
  }

  // ── ANTERIOR EMPLEO (orden 2) — hoy el formulario de Hydra solo captura la empresa
  // actual (orden 1); esta sección queda lista para cuando exista ese dato, sin tronar
  // si no viene (ver claude/plan.md: "ANTERIOR EMPLEO" pendiente de decidir con negocio). ──
  const empresaAnterior = (candidato.experiencia || []).find((e) => e.orden === 2);
  if (empresaAnterior) {
    drawFit(p1, font, empresaAnterior.nombre_empresa, { x: 128, y: 205.2, maxWidth: 160 });
    drawFit(p1, font, empresaAnterior.cargo_desempenado, { x: 386, y: 205.2, maxWidth: 78 });
    drawFit(p1, font, empresaAnterior.salario, { x: 513, y: 205.2, maxWidth: 78 });
    drawTextBox(p1, font, empresaAnterior.funciones, { x: 30, y: 175, maxWidth: 555, maxHeight: 24, startSize: 8, minSize: 6.5 });
  }

  // ── INFORMACIÓN REINTEGROS ─────────────────────────────────────────────────
  marcarSiNo(p1, candidato.ha_trabajado_asiste, {
    si: { x: 206.14, y: 96.5, w: 14, h: 10 },
    no: { x: 260.93, y: 96.5, w: 18, h: 10 }
  });
  marcarSiNo(p1, candidato.ha_estado_proceso_formativo_asiste, {
    no: { x: 470.97, y: 96.5, w: 18, h: 10 },
    si: { x: 543.64, y: 96.5, w: 14, h: 10 }
  });
  if (String(candidato.ha_trabajado_asiste).toLowerCase() === 'si') {
    drawFit(p1, font, candidato.campana_asiste, { x: 270, y: 73.37, maxWidth: 320, startSize: 8.5 });
    drawFit(p1, font, fmtFecha(candidato.fecha_inicio_asiste), { x: 87, y: 55.92, maxWidth: 90, startSize: 7.5 });
    drawFit(p1, font, fmtFecha(candidato.fecha_retiro_asiste), { x: 213, y: 50.77, maxWidth: 95, startSize: 7.5 });
    drawFit(p1, font, candidato.tiempo_laborado_asiste, { x: 381, y: 50.77, maxWidth: 82, startSize: 7.5, minSize: 6 });
    drawFit(p1, font, candidato.motivo_retiro_asiste, { x: 467, y: 38, maxWidth: 110, startSize: 7, minSize: 6 });
  }

  // ── FIRMA DEL CANDIDATO ────────────────────────────────────────────────────
  // La línea de firma se deja SIN TOCAR — FirmaCloud detecta el texto "FIRMA DEL
  // CANDIDATO" y estampa ahí. Solo se escribe el número de documento en su propio blanco.
  drawFit(p1, font, candidato.numero_documento, { x: 432, y: 22, maxWidth: 82, startSize: 8 });

  // ═══════════════════════ PÁGINA 2 — INFORME DE SELECCIÓN ═══════════════════
  drawTextBox(p2, font, candidato.genograma, { x: 20, y: 630, maxWidth: 570, maxHeight: 100, startSize: 9, minSize: 7 });

  drawTextBox(p2, font, candidato.fortalezas, { x: 20, y: 492, maxWidth: 300, maxHeight: 78, startSize: 8.5, minSize: 6.5 });
  drawTextBox(p2, font, candidato.aspectos_mejorar, { x: 345, y: 492, maxWidth: 210, maxHeight: 78, startSize: 8.5, minSize: 6.5 });

  drawTextBox(p2, font, candidato.competencias_laborales, { x: 20, y: 378, maxWidth: 300, maxHeight: 100, startSize: 8.5, minSize: 6.5 });
  drawFit(p2, font, candidato.metas_corto_plazo, { x: 400, y: 371.53, maxWidth: 155, startSize: 8 });
  drawFit(p2, font, candidato.metas_mediano_plazo, { x: 415, y: 344.27, maxWidth: 140, startSize: 8 });
  drawFit(p2, font, candidato.metas_largo_plazo, { x: 400, y: 317, maxWidth: 155, startSize: 8 });

  drawTextBox(p2, font, candidato.estado_salud_actual, { x: 20, y: 276, maxWidth: 305, maxHeight: 34, startSize: 8.5, minSize: 6.5 });
  drawFit(p2, fontBold, candidato.autoevaluacion, { x: 505, y: 271.78, maxWidth: 30, startSize: 10 });

  marcarSiNo(p2, candidato.experiencia_comercial_certificada, {
    si: { x: 324.81, y: 229.7, w: 57.82, h: 10 },
    no: { x: 394.92, y: 229.7, w: 57.82, h: 10 }
  });
  marcarSiNo(p2, candidato.experiencia_comercial_no_certificada, {
    si: { x: 326.55, y: 211.1, w: 57.82, h: 10 },
    no: { x: 396.66, y: 211.1, w: 57.82, h: 10 }
  });
  marcarSiNo(p2, candidato.primer_empleo_formal, {
    si: { x: 325.69, y: 192.5, w: 59.89, h: 10 },
    no: { x: 395.8, y: 192.5, w: 59.89, h: 10 }
  });

  // CARGO AGENTES / CONCEPTO FINAL SELECCIÓN / PSICÓLOGO se dejan en blanco a propósito:
  // son campos de uso interno del equipo de selección, posteriores a la firma del candidato.

  return Buffer.from(await pdfDoc.save());
}

module.exports = { generarHojaVidaPdf, TEMPLATE_PATH };
