'use strict';

/**
 * Configuración común de las pruebas.
 *
 * Se fija antes de que `src/config/env.js` lea `process.env`, de modo que las
 * pruebas nunca puedan apuntar por accidente a la base de desarrollo ni salir a
 * las integraciones externas.
 */

process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.TEST_DB_NAME ?? 'ReclutamientoNuevo';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';

// Secreto propio de las pruebas: no se toma el de desarrollo.
process.env.JWT_SECRET =
  process.env.TEST_JWT_SECRET ?? 'secreto-solo-para-pruebas-con-longitud-suficiente';

// bcrypt con el mínimo de rondas permitido: las pruebas hashean muchas veces.
process.env.BCRYPT_ROUNDS = '10';

process.env.FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
