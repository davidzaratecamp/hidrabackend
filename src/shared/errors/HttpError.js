'use strict';

/**
 * Error de negocio con significado HTTP.
 *
 * Es el único tipo de error que las capas de servicio lanzan a propósito.
 * Cualquier otra excepción que llegue al manejador central se trata como fallo
 * inesperado y se enmascara antes de responder.
 *
 * En el sistema viejo cada controller inventaba su formato: `{ error }` en tres
 * de ellos y `{ ok, message }` en otro, y `seleccion.controller` devolvía
 * `error.message` crudo al cliente mientras `candidato.controller` lo enmascaraba.
 */
class HttpError extends Error {
  /**
   * @param {number} estado Código HTTP.
   * @param {string} mensaje Texto seguro para mostrar al usuario final.
   * @param {object} [opciones]
   * @param {string} [opciones.codigo] Código estable para que el frontend ramifique.
   * @param {unknown} [opciones.detalles] Información adicional (p. ej. errores de validación).
   * @param {Error}  [opciones.causa] Error subyacente; se registra, nunca se expone.
   */
  constructor(estado, mensaje, { codigo, detalles, causa } = {}) {
    super(mensaje);
    this.name = 'HttpError';
    this.estado = estado;
    this.codigo = codigo ?? codigoPorDefecto(estado);
    if (detalles !== undefined) this.detalles = detalles;
    if (causa !== undefined) this.cause = causa;
    Error.captureStackTrace?.(this, HttpError);
  }

  static peticionInvalida(mensaje, opciones) {
    return new HttpError(400, mensaje, opciones);
  }

  static noAutenticado(mensaje = 'No has iniciado sesión', opciones) {
    return new HttpError(401, mensaje, opciones);
  }

  static prohibido(mensaje = 'No tienes permiso para realizar esta acción', opciones) {
    return new HttpError(403, mensaje, opciones);
  }

  static noEncontrado(mensaje = 'Recurso no encontrado', opciones) {
    return new HttpError(404, mensaje, opciones);
  }

  static conflicto(mensaje, opciones) {
    return new HttpError(409, mensaje, opciones);
  }

  static demasiadasPeticiones(mensaje = 'Demasiadas peticiones', opciones) {
    return new HttpError(429, mensaje, opciones);
  }

  static interno(mensaje = 'Error interno del servidor', opciones) {
    return new HttpError(500, mensaje, opciones);
  }

  static servicioExterno(mensaje, opciones) {
    return new HttpError(502, mensaje, opciones);
  }
}

const CODIGOS = {
  400: 'PETICION_INVALIDA',
  401: 'NO_AUTENTICADO',
  403: 'PROHIBIDO',
  404: 'NO_ENCONTRADO',
  409: 'CONFLICTO',
  422: 'ENTIDAD_NO_PROCESABLE',
  429: 'DEMASIADAS_PETICIONES',
  500: 'ERROR_INTERNO',
  502: 'SERVICIO_EXTERNO',
};

function codigoPorDefecto(estado) {
  return CODIGOS[estado] ?? 'ERROR';
}

module.exports = { HttpError };
