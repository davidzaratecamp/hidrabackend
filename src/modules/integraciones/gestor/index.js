'use strict';

/**
 * Gestor Técnico (RRHH): puerto + adaptadores, mismo patrón que nómina y
 * FirmaCloud.
 *
 * Solo transporta: firma la petición, la envía y devuelve lo que pasó. Nunca
 * lanza por una respuesta HTTP —ni siquiera por un 500—, porque quien decide si
 * reintentar es el despachador del outbox (`contratacion.service.js`), no el
 * transporte.
 */

const { firmar } = require('../../../shared/seguridad/firmaHmac');

/**
 * @returns {{ nombre: string, enviar: (envio: {metodo: string, ruta: string, payload: object, idempotencyKey: string})
 *   => Promise<{ status: number|null, codigo: string|null, cuerpo: object|null, error: string|null }> }}
 */
function crearGestorHttp({ config }) {
  if (!config.configurado) {
    throw new Error('El adaptador de Gestor requiere GESTOR_API_URL, GESTOR_API_KEY y GESTOR_HMAC_SECRET');
  }

  return {
    nombre: 'gestor-http',

    async enviar({ metodo, ruta, payload, idempotencyKey, timeoutMs }) {
      const cuerpo = JSON.stringify(payload);
      const timestamp = String(Math.floor(Date.now() / 1000));
      try {
        const respuesta = await fetch(`${config.url}${ruta}`, {
          method: metodo,
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': config.apiKey,
            'X-Timestamp': timestamp,
            'X-Signature': firmar(config.secreto, timestamp, cuerpo),
            'Idempotency-Key': idempotencyKey,
          },
          body: cuerpo,
          signal: AbortSignal.timeout(timeoutMs),
        });

        let json = null;
        try {
          json = await respuesta.json();
        } catch {
          // Cuerpo vacío o no JSON: basta con el status.
        }
        // Gestor responde `{ success, codigo, message, detalles }` en los errores.
        const codigo = json?.codigo ?? null;
        const detalle = Array.isArray(json?.detalles) ? ` (${json.detalles.slice(0, 3).join('; ')})` : '';
        return {
          status: respuesta.status,
          codigo,
          cuerpo: json,
          error: respuesta.ok
            ? null
            : `HTTP ${respuesta.status}${codigo ? ` ${codigo}` : ''}${json?.message ? `: ${json.message}` : ''}${detalle}`,
        };
      } catch (error) {
        // Red caída, DNS, conexión rechazada o timeout.
        return {
          status: null,
          codigo: null,
          cuerpo: null,
          error: `Sin respuesta de Gestor: ${error.cause?.code ?? error.name}`,
        };
      }
    },
  };
}

/**
 * Adaptador en memoria: para desarrollo sin Gestor y para las pruebas. Registra
 * lo que se habría enviado y responde lo que se le programe.
 */
function crearGestorMemoria({ logger, responder } = {}) {
  const enviados = [];
  return {
    nombre: 'gestor-memoria',
    enviados,
    async enviar(envio) {
      enviados.push(envio);
      logger?.info({ ruta: envio.ruta, metodo: envio.metodo }, 'Gestor en memoria: envío registrado (no sale nada real)');
      if (responder) return responder(envio);
      return { status: 200, codigo: null, cuerpo: { success: true, candidatos: [] }, error: null };
    },
  };
}

module.exports = { crearGestorHttp, crearGestorMemoria };
