// Envía la hoja de vida + tratamiento de datos ya armados (ambos con los datos del candidato
// plasmados) a FirmaCloud para que el candidato los firme. Disparado hoy al completar el paso 6
// (Consentimiento) — integración "mínima" para poder probar el flujo real: el checkbox de
// Consentimiento se mantiene tal cual (no se reemplaza todavía, ver claude/plan.md), y además de
// la notificación interna que ya se mandaba, ahora también se dispara este envío a FirmaCloud.
const repo = require('../repositories/candidatoFormulario.repository');
const { generarHojaVidaPdf } = require('./hojaVidaPdfService');
const { generarTratamientoDatosPdf } = require('./tratamientoDatosPdfService');

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

module.exports = { enviarAFirmaCloud };
