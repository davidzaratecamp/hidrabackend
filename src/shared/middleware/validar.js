'use strict';

/**
 * Validación de entrada con Zod.
 *
 * Sustituye los `if (!campo) return res.status(400)` repetidos decenas de veces
 * en los controllers viejos. Al validar en el middleware, el controller recibe
 * datos ya normalizados y con el tipo correcto, y nunca tiene que comprobarlos.
 *
 * El objeto validado REEMPLAZA al original, así que un campo no declarado en el
 * esquema no llega al servicio: previene el asignado masivo de propiedades.
 */

const { HttpError } = require('../errors/HttpError');

const PARTES = ['body', 'params', 'query'];

/**
 * @param {{body?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny}} esquemas
 */
function validar(esquemas) {
  return (req, _res, next) => {
    const errores = [];

    for (const parte of PARTES) {
      const esquema = esquemas[parte];
      if (!esquema) continue;

      const resultado = esquema.safeParse(req[parte]);
      if (!resultado.success) {
        for (const issue of resultado.error.issues) {
          errores.push({
            campo: [parte, ...issue.path].join('.'),
            mensaje: issue.message,
          });
        }
        continue;
      }

      // `req.query` es solo-lectura en Express 5: se define de nuevo en vez de asignar.
      Object.defineProperty(req, parte, {
        value: resultado.data,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }

    if (errores.length > 0) {
      return next(
        HttpError.peticionInvalida('Los datos enviados no son válidos', {
          codigo: 'VALIDACION',
          detalles: errores,
        })
      );
    }

    return next();
  };
}

module.exports = { validar };
