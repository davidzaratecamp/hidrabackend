'use strict';

/**
 * Rutas de autenticación.
 *
 * No hay endpoint de logout: el JWT es sin estado, así que el `logout` del
 * sistema viejo era una función que no hacía nada. El cliente descarta el token.
 * Si en algún momento se necesita revocación real, el lugar es una lista de
 * `jti` invalidados, no un endpoint vacío.
 */

const { Router } = require('express');
const { validar } = require('../../shared/middleware/validar');
const { limiteAutenticacion } = require('../../shared/middleware/seguridad');
const esquema = require('./auth.schema');

function crearAuthRutas({ authControlador, autenticar }) {
  const router = Router();

  router.post(
    '/login',
    limiteAutenticacion(),
    validar({ body: esquema.login }),
    authControlador.login
  );

  router.get('/perfil', autenticar, authControlador.perfil);

  router.post(
    '/cambiar-password',
    autenticar,
    limiteAutenticacion(),
    validar({ body: esquema.cambiarPassword }),
    authControlador.cambiarPassword
  );

  return router;
}

module.exports = { crearAuthRutas };
