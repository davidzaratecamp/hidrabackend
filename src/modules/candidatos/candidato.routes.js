'use strict';

const { Router } = require('express');
const { validar } = require('../../shared/middleware/validar');
const { requierePermiso } = require('../../shared/middleware/autorizar');
const esquema = require('./candidato.schema');

function crearCandidatoRutas({ candidatoControlador, autenticar }) {
  const router = Router();
  router.use(autenticar);

  router.get(
    '/',
    requierePermiso('ver_candidatos'),
    validar({ query: esquema.listar }),
    candidatoControlador.listar
  );

  router.get('/resumen-estados', requierePermiso('ver_candidatos'), candidatoControlador.resumenEstados);

  router.post(
    '/',
    requierePermiso('crear_candidatos'),
    validar({ body: esquema.crear }),
    candidatoControlador.crear
  );

  // Antes de '/:id' para que la ruta literal no se interprete como un id.
  router.post(
    '/reasignar-cartera',
    requierePermiso('reasignar_candidatos'),
    validar({ body: esquema.reasignarCartera }),
    candidatoControlador.reasignarCartera
  );

  router.get(
    '/:id',
    requierePermiso('ver_candidatos'),
    validar({ params: esquema.parametrosId }),
    candidatoControlador.obtener
  );

  router.patch(
    '/:id',
    requierePermiso('editar_candidatos'),
    validar({ params: esquema.parametrosId, body: esquema.actualizar }),
    candidatoControlador.actualizar
  );

  router.get(
    '/:id/transiciones',
    requierePermiso('ver_candidatos'),
    validar({ params: esquema.parametrosId }),
    candidatoControlador.transiciones
  );

  router.post(
    '/:id/estado',
    requierePermiso('editar_candidatos', 'editar_estados_candidatos'),
    validar({ params: esquema.parametrosId, body: esquema.cambiarEstado }),
    candidatoControlador.cambiarEstado
  );

  router.post(
    '/:id/reasignar',
    requierePermiso('reasignar_candidatos'),
    validar({ params: esquema.parametrosId, body: esquema.reasignar }),
    candidatoControlador.reasignar
  );

  router.post(
    '/:id/enviar-formulario',
    requierePermiso('reenviar_emails'),
    validar({ params: esquema.parametrosId }),
    candidatoControlador.enviarFormulario
  );

  router.get(
    '/:id/formulario',
    requierePermiso('ver_candidatos'),
    validar({ params: esquema.parametrosId }),
    candidatoControlador.formulario
  );

  return router;
}

module.exports = { crearCandidatoRutas };
