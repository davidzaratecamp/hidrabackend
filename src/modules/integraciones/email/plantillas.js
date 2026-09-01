'use strict';

/**
 * Plantillas de correo.
 *
 * Separadas del adaptador: el HTML es contenido, el envío es infraestructura.
 * En el sistema viejo ambos estaban mezclados dentro de `email.service.js`.
 */

const { nombreCompleto } = require('../../../shared/utils/nombreCompleto');

/** Escapa el HTML: los datos del candidato son entrada de usuario. */
function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

const MARCO = (contenido) => `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:#0f766e;color:#fff;padding:20px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px">ASISTE ING</h1>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:24px;border-radius:0 0 8px 8px">
    ${contenido}
  </div>
</div>`;

function formularioCandidato({ candidato, link, diasVigencia }) {
  const nombre = esc(candidato.primer_nombre ?? '');
  return {
    asunto: 'Completa tu hoja de vida — ASISTE ING',
    html: MARCO(`
      <p>Hola <strong>${nombre}</strong>,</p>
      <p>Gracias por tu interés en trabajar con nosotros. Para continuar con el proceso,
         completa tu hoja de vida en el siguiente enlace:</p>
      <p style="text-align:center;margin:28px 0">
        <a href="${esc(link)}"
           style="background:#0f766e;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block">
          Completar mi hoja de vida
        </a>
      </p>
      <p style="font-size:13px;color:#6b7280">
        El enlace vence en ${diasVigencia} días y es de un solo uso.
        Si recibes un correo nuevo con otro enlace, el anterior deja de funcionar.
      </p>`),
    texto: `Hola ${candidato.primer_nombre ?? ''}, completa tu hoja de vida aquí: ${link} (vence en ${diasVigencia} días)`,
  };
}

function notificacionCompletado({ candidato }) {
  const nombre = esc(nombreCompleto(candidato));
  return {
    asunto: `Formulario completado: ${nombre}`,
    html: MARCO(`
      <p>El candidato <strong>${nombre}</strong> completó su hoja de vida.</p>
      <ul style="line-height:1.8">
        <li><strong>Documento:</strong> ${esc(candidato.numero_documento ?? 'sin registrar')}</li>
        <li><strong>Celular:</strong> ${esc(candidato.celular ?? '')}</li>
        <li><strong>Campaña:</strong> ${esc(candidato.cliente ?? '')}</li>
        <li><strong>Cargo:</strong> ${esc(candidato.cargo ?? '')}</li>
      </ul>
      <p>Ya puedes agendarle la entrevista.</p>`),
    texto: `El candidato ${nombre} completó su hoja de vida.`,
  };
}

module.exports = { formularioCandidato, notificacionCompletado };
