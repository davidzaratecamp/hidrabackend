'use strict';

/**
 * Rutas de usuarios. Solo declaración: método, ruta, middlewares y handler.
 *
 * Todas usan el middleware compartido de autorización. El sistema viejo mezclaba
 * `verificarRol('administrador')` en las rutas con comprobaciones de rol
 * repetidas dentro de los propios controllers.
 */

const { Router } = require('express');
const { validar } = require('../../shared/middleware/validar');
const { requierePermiso } = require('../../shared/middleware/autorizar');
const esquema = require('./usuario.schema');

function crearUsuarioRutas({ usuarioControlador, autenticar }) {
  const router = Router();

  // Toda la gestión de usuarios exige sesión.
  router.use(autenticar);

  router.get(
    '/',
    requierePermiso('ver_usuarios'),
    validar({ query: esquema.listar }),
    usuarioControlador.listar
  );

  router.post(
    '/',
    requierePermiso('crear_usuarios'),
    validar({ body: esquema.crear }),
    usuarioControlador.crear
  );

  // Antes de '/:id': si no, 'reclutadores' se interpretaría como un id.
  router.get(
    '/reclutadores',
    requierePermiso('reasignar_candidatos', 'ver_usuarios'),
    usuarioControlador.reclutadores
  );

  // Igual que arriba: ruta literal antes del parámetro.
  router.get('/resumen-roles', requierePermiso('ver_usuarios'), usuarioControlador.resumenRoles);

  router.get(
    '/:id',
    requierePermiso('ver_usuarios'),
    validar({ params: esquema.parametrosId }),
    usuarioControlador.obtener
  );

  router.patch(
    '/:id',
    requierePermiso('editar_usuarios'),
    validar({ params: esquema.parametrosId, body: esquema.actualizar }),
    usuarioControlador.actualizar
  );

  router.delete(
    '/:id',
    requierePermiso('eliminar_usuarios'),
    validar({ params: esquema.parametrosId }),
    usuarioControlador.desactivar
  );

  router.post(
    '/:id/reactivar',
    requierePermiso('editar_usuarios'),
    validar({ params: esquema.parametrosId }),
    usuarioControlador.reactivar
  );

  return router;
}

/** Catálogo de roles y permisos. Lectura para quien pueda ver usuarios. */
function crearRolRutas({ usuarioControlador, autenticar }) {
  const router = Router();
  router.use(autenticar, requierePermiso('ver_usuarios'));
  router.get('/', usuarioControlador.listarRoles);
  router.get('/permisos', usuarioControlador.listarPermisos);
  return router;
}

module.exports = { crearUsuarioRutas, crearRolRutas };
