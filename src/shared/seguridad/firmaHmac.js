'use strict';

/**
 * Firma HMAC de las peticiones entre Hydra y el Gestor Técnico.
 *
 *   X-Signature: sha256=<hex(HMAC_SHA256(secreto, `${timestamp}.${cuerpoCrudo}`))>
 *
 * Es el MISMO algoritmo que `utils/firmaHydra.js` del repo de Gestor: si uno de
 * los dos cambia, la integración deja de funcionar en ambos sentidos. El
 * timestamp va dentro de lo firmado para que una petición capturada no se pueda
 * reenviar con otro `X-Timestamp`.
 */

const { createHmac, timingSafeEqual } = require('node:crypto');

const PREFIJO = 'sha256=';

function firmar(secreto, timestamp, cuerpo = '') {
  const hmac = createHmac('sha256', secreto);
  hmac.update(`${timestamp}.`);
  hmac.update(Buffer.isBuffer(cuerpo) ? cuerpo : String(cuerpo));
  return PREFIJO + hmac.digest('hex');
}

/** Comparación en tiempo constante: `===` filtra por tiempos cuánto coincide. */
function igualesSeguro(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function firmaValida(secreto, timestamp, cuerpo, firmaRecibida) {
  return igualesSeguro(firmar(secreto, timestamp, cuerpo), firmaRecibida);
}

/** `ahoraSegundos` se recibe por parámetro para poder probarlo sin reloj. */
function timestampVigente(timestamp, ahoraSegundos, toleranciaSegundos) {
  if (!/^\d{1,12}$/.test(String(timestamp ?? ''))) return false;
  return Math.abs(ahoraSegundos - Number(timestamp)) <= toleranciaSegundos;
}

module.exports = { firmar, firmaValida, igualesSeguro, timestampVigente };
