// Envía la hoja de vida + tratamiento de datos ya armados (ambos con los datos del candidato
// plasmados) a FirmaCloud para que el candidato los firme. Disparado hoy al completar el paso 6
// (Consentimiento) — integración "mínima" para poder probar el flujo real: el checkbox de
// Consentimiento se mantiene tal cual (no se reemplaza todavía, ver claude/plan.md), y además de
// la notificación interna que ya se mandaba, ahora también se dispara este envío a FirmaCloud.
//
// También expone consultarEstadoFirma/descargarDocumento — usados por el perfil de candidato
// (reclutador) para ver/descargar los 2 documentos ya firmados, consultando directamente a
// FirmaCloud con la misma X-Api-Key (Hydra nunca guarda copia de los PDFs firmados, FirmaCloud
// sigue siendo la única fuente de verdad de esos archivos).
const repo = require('../repositories/candidatoFormulario.repository');
const { generarHojaVidaPdf } = require('./hojaVidaPdfService');
const { generarTratamientoDatosPdf } = require('./tratamientoDatosPdfService');
const HttpError = require('../utils/httpError');

async function enviarAFirmaCloud(candidatoId) {
  const candidato = await repo.obtenerCandidatoConFormulario('c.id = ?', [candidatoId]);
  if (!candidato) throw new Error(`Candidato ${candidatoId} no encontrado`);

  const [cvBuffer, tratamientoBuffer] = await Promise.all([
    generarHojaVidaPdf(candidato),
    generarTratamientoDatosPdf(candidato),
  ]);

  const nombreCompleto = [candidato.primer_nombre, candidato.segundo_nombre, candidato.primer_apellido, candidato.segundo_apellido]
    .filter(Boolean).join(' ');

  const form = new FormData();
  form.append('cvFile', new Blob([cvBuffer], { type: 'application/pdf' }), 'hoja-de-vida.pdf');
  form.append('tratamientoFile', new Blob([tratamientoBuffer], { type: 'application/pdf' }), 'tratamiento-de-datos.pdf');
  form.append('candidateName', nombreCompleto);
  form.append('sendChannel', 'email');
  form.append('candidateEmail', candidato.email_personal || '');
  form.append('hydraReferenceId', String(candidatoId));

  const res = await fetch(`${process.env.FIRMACLOUD_API_URL}/reclutamiento/send`, {
    method: 'POST',
    headers: { 'X-Api-Key': process.env.FIRMACLOUD_API_KEY },
    body: form,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `FirmaCloud respondió ${res.status}`);
  }

  await repo.guardarFirmaCloudId(candidatoId, data.id);
  return data; // { id, token, firmarUrl, status, message }
}

// Estado de firma de un candidato para el perfil del reclutador. `whereClause`/`params` traen
// el chequeo de dueño ya armado por el controller (mismo patrón que
// candidatoFormularioService.obtenerPerfilConFormulario) — nunca se resuelve solo por
// candidatoId, así un reclutador no puede consultar el estado de un candidato ajeno.
async function consultarEstadoFirma(whereClause, params) {
  const candidato = await repo.obtenerCandidatoParaFirma(whereClause, params);
  if (!candidato) throw new HttpError(404, 'Candidato no encontrado o no tienes acceso a este candidato');
  if (!candidato.firmacloud_signature_id) return { enviado: false };

  const res = await fetch(`${process.env.FIRMACLOUD_API_URL}/reclutamiento/${candidato.firmacloud_signature_id}`, {
    headers: { 'X-Api-Key': process.env.FIRMACLOUD_API_KEY },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Errores 4xx de FirmaCloud (ej. id inexistente) se propagan tal cual; un 5xx de su lado se
    // traduce a 502 (error del proxy, no del candidato/reclutador).
    throw new HttpError(res.status < 500 ? res.status : 502, data?.error || `FirmaCloud respondió ${res.status}`);
  }

  return { enviado: true, ...data };
}

const DOCUMENTO_POR_TIPO = {
  cv: { path: 'cv', nombreBase: 'hoja-de-vida' },
  tratamiento: { path: 'tratamiento', nombreBase: 'tratamiento-de-datos' },
};

// Descarga (proxy) uno de los 2 documentos firmados directamente desde FirmaCloud — Hydra no
// guarda copia local, solo reenvía los bytes. `tipo` es 'cv' o 'tratamiento'.
async function descargarDocumento(whereClause, params, tipo) {
  const config = DOCUMENTO_POR_TIPO[tipo];
  if (!config) throw new HttpError(400, `Tipo de documento inválido: ${tipo}`);

  const candidato = await repo.obtenerCandidatoParaFirma(whereClause, params);
  if (!candidato) throw new HttpError(404, 'Candidato no encontrado o no tienes acceso a este candidato');
  if (!candidato.firmacloud_signature_id) {
    throw new HttpError(404, 'Este candidato todavía no se envió a FirmaCloud para firma');
  }

  const res = await fetch(
    `${process.env.FIRMACLOUD_API_URL}/reclutamiento/${candidato.firmacloud_signature_id}/download/${config.path}`,
    { headers: { 'X-Api-Key': process.env.FIRMACLOUD_API_KEY } }
  );
  if (!res.ok) {
    // Ej. 400 "Documento aún no firmado" (candidato lo tiene pendiente) o 404 (id inexistente)
    // — se propagan tal cual; un 5xx de FirmaCloud se traduce a 502.
    const data = await res.json().catch(() => ({}));
    throw new HttpError(res.status < 500 ? res.status : 502, data?.error || `FirmaCloud respondió ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType: 'application/pdf', filename: `${config.nombreBase}-${candidato.id}.pdf` };
}

module.exports = { enviarAFirmaCloud, consultarEstadoFirma, descargarDocumento };
