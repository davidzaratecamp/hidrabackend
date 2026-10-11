'use strict';

/**
 * Autenticación de las llamadas que hace el Gestor Técnico a Hydra (avisos de
 * contratado/descartado). Máquina a máquina: no hay usuario ni JWT, sino API key
 * + firma HMAC + timestamp, el mismo esquema que Gestor exige a Hydra.
 *
 * Requiere `req.rawBody` (Buffer), que `app.js` guarda solo para las rutas de
 * `/api/integraciones/`: la firma se calcula sobre los bytes exactos recibidos.
 *
 * Todos los rechazos responden igual (401) para no dar pistas a quien prueba
 * claves; el motivo real va al log.
 */

const { HttpError } = require('../../../shared/errors/HttpError');
const { firmaValida, igualesSeguro, timestampVigente } = require('../../../shared/seguridad/firmaHmac');

function crearAutenticarGestor({ config, logger }) {
  const rechazo = (motivo, req) => {
    logger.warn({ motivo, ruta: req.originalUrl, ip: req.ip }, 'Petición de Gestor rechazada');
    return HttpError.noAutenticado('Credenciales o firma inválidas', { codigo: 'FIRMA_INVALIDA' });
  };

  return function autenticarGestor(req, _res, next) {
    if (!config.entrada.configurado) {
      return next(
        new HttpError(503, 'La integración con Gestor no está configurada en este servidor', {
          codigo: 'INTEGRACION_NO_CONFIGURADA',
        })
      );
    }

    if (!igualesSeguro(config.entrada.apiKey, req.get('x-api-key'))) {
      return next(rechazo('api key', req));
    }

    const timestamp = req.get('x-timestamp');
    if (!timestampVigente(timestamp, Math.floor(Date.now() / 1000), config.toleranciaTimestampSegundos)) {
      return next(rechazo('timestamp fuera de ventana', req));
    }

    if (!firmaValida(config.entrada.secreto, timestamp, req.rawBody ?? Buffer.alloc(0), req.get('x-signature'))) {
      return next(rechazo('firma', req));
    }

    return next();
  };
}

module.exports = { crearAutenticarGestor };
