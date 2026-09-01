'use strict';

/**
 * Middlewares de seguridad de borde.
 *
 * Nada de esto existía en el sistema viejo: sin helmet, sin límite de peticiones
 * (ni siquiera en el login), sin handler 404, y con la lista de orígenes de CORS
 * y la IP de producción escritas directamente en `index.js`.
 */

const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { randomUUID } = require('node:crypto');

const config = require('../../config/env');
const { HttpError } = require('../errors/HttpError');

/** Cabeceras de seguridad. */
function cabecerasSeguras() {
  return helmet({
    // La API no sirve HTML propio; la CSP la aplica el frontend.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  });
}

/** CORS con lista blanca por configuración, no por constante en el código. */
function corsConfigurado() {
  const permitidos = new Set(config.servidor.origenesCors);
  return cors({
    origin(origen, callback) {
      // Sin `Origin`: peticiones del propio servidor, curl o health checks.
      if (!origen) return callback(null, true);
      if (permitidos.has(origen)) return callback(null, true);
      return callback(HttpError.prohibido(`Origen no permitido por CORS: ${origen}`));
    },
    credentials: true,
    maxAge: 86400,
  });
}

const mensajeLimite = {
  ok: false,
  error: {
    codigo: 'DEMASIADAS_PETICIONES',
    mensaje: 'Demasiadas peticiones. Espera un momento e inténtalo de nuevo.',
  },
};

/** Límite general de la API. */
function limiteGeneral() {
  return rateLimit({
    windowMs: config.limites.ventanaMs,
    max: config.limites.maxPeticiones,
    standardHeaders: true,
    legacyHeaders: false,
    message: mensajeLimite,
    // En pruebas estorbaría.
    skip: () => config.esPrueba,
  });
}

/**
 * Límite estricto para el login y otros endpoints sensibles a fuerza bruta.
 * `skipSuccessfulRequests` hace que solo cuenten los intentos fallidos, así que
 * un usuario legítimo no se autobloquea.
 */
function limiteAutenticacion() {
  return rateLimit({
    windowMs: config.limites.ventanaMs,
    max: config.limites.maxLogin,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: mensajeLimite,
    skip: () => config.esPrueba,
  });
}

/**
 * Límite para los endpoints públicos por token del formulario del candidato.
 * Son las únicas rutas sin autenticación que escriben en la base.
 */
function limitePublico() {
  return rateLimit({
    windowMs: config.limites.ventanaMs,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: mensajeLimite,
    skip: () => config.esPrueba,
  });
}

/** Identificador de petición, para poder seguir una petición entre líneas de log. */
function identificadorPeticion() {
  return function asignarId(req, res, next) {
    req.id = req.get('x-request-id') ?? randomUUID();
    res.set('x-request-id', req.id);
    next();
  };
}

/** Cierra el enrutador: cualquier ruta no declarada responde 404 con el sobre estándar. */
function rutaNoEncontrada() {
  return function noEncontrado(req, _res, next) {
    next(
      HttpError.noEncontrado(`Ruta no encontrada: ${req.method} ${req.originalUrl}`, {
        codigo: 'RUTA_NO_ENCONTRADA',
      })
    );
  };
}

module.exports = {
  cabecerasSeguras,
  corsConfigurado,
  limiteGeneral,
  limiteAutenticacion,
  limitePublico,
  identificadorPeticion,
  rutaNoEncontrada,
};
