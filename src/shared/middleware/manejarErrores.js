'use strict';

/**
 * Manejador central de errores. El sistema viejo no tenía ninguno: cada handler
 * hacía su propio try/catch y respondía a su manera.
 *
 * Reglas:
 *   - Un `HttpError` es intencional: su mensaje se muestra tal cual.
 *   - Cualquier otra excepción es un fallo no previsto: se registra completa y
 *     se responde con un mensaje genérico. Nunca se filtra `error.message` de un
 *     error de base de datos al cliente, como sí ocurría en `seleccion.controller`.
 */

const { HttpError } = require('../errors/HttpError');
const logger = require('../../config/logger');
const config = require('../../config/env');

/** Traduce errores conocidos de MySQL a errores de negocio legibles. */
function traducirErrorMysql(error) {
  switch (error.code) {
    case 'ER_DUP_ENTRY':
      return HttpError.conflicto('Ya existe un registro con esos datos', {
        codigo: 'REGISTRO_DUPLICADO',
        causa: error,
      });
    case 'ER_NO_REFERENCED_ROW':
    case 'ER_NO_REFERENCED_ROW_2':
      return HttpError.peticionInvalida('Referencia a un registro que no existe', {
        codigo: 'REFERENCIA_INVALIDA',
        causa: error,
      });
    case 'ER_ROW_IS_REFERENCED':
    case 'ER_ROW_IS_REFERENCED_2':
      return HttpError.conflicto('No se puede eliminar: hay registros que dependen de este', {
        codigo: 'REFERENCIA_EN_USO',
        causa: error,
      });
    case 'ER_CHECK_CONSTRAINT_VIOLATED':
      return HttpError.peticionInvalida('Los datos no cumplen una regla de la base de datos', {
        codigo: 'RESTRICCION_VIOLADA',
        causa: error,
      });
    case 'ER_DATA_TOO_LONG':
      return HttpError.peticionInvalida('Uno de los valores excede la longitud permitida', {
        codigo: 'VALOR_MUY_LARGO',
        causa: error,
      });
    default:
      return null;
  }
}

// Express identifica el manejador de errores por su aridad de 4 argumentos:
// `_next` debe declararse aunque no se use.
function manejarErrores(error, req, res, _next) {
  const httpError =
    error instanceof HttpError ? error : traducirErrorMysql(error) ?? null;

  if (httpError) {
    // 5xx sigue siendo un fallo nuestro aunque venga tipado.
    const nivel = httpError.estado >= 500 ? 'error' : 'warn';
    logger[nivel](
      { err: httpError.cause ?? httpError, estado: httpError.estado, ruta: req.originalUrl },
      httpError.message
    );

    const cuerpo = {
      ok: false,
      error: { codigo: httpError.codigo, mensaje: httpError.message },
    };
    if (httpError.detalles !== undefined) cuerpo.error.detalles = httpError.detalles;
    return res.status(httpError.estado).json(cuerpo);
  }

  logger.error(
    { err: error, ruta: req.originalUrl, metodo: req.method },
    'Error no controlado'
  );

  const cuerpo = {
    ok: false,
    error: { codigo: 'ERROR_INTERNO', mensaje: 'Error interno del servidor' },
  };
  // Fuera de producción se devuelve el detalle para no tener que ir al log.
  if (!config.esProduccion) {
    cuerpo.error.detalles = { mensaje: error.message, stack: error.stack };
  }
  return res.status(500).json(cuerpo);
}

module.exports = { manejarErrores };
