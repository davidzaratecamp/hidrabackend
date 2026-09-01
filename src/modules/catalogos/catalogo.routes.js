'use strict';

/**
 * Catálogos.
 *
 * Es público a propósito: el formulario que llena el candidato por link con
 * token necesita los desplegables (EPS, AFP, ciudades, niveles de estudio) sin
 * tener sesión. No expone dato sensible alguno, solo listas de opciones.
 */

const { Router } = require('express');
const { ok } = require('../../shared/utils/respuesta');
const { limitePublico } = require('../../shared/middleware/seguridad');

function crearCatalogoRutas({ catalogoRepo }) {
  const router = Router();
  router.use(limitePublico());

  router.get('/', async (_req, res) => ok(res, await catalogoRepo.listarTodo()));

  router.get('/estados-candidato', async (_req, res) =>
    ok(res, await catalogoRepo.listarEstadosCandidato())
  );

  return router;
}

module.exports = { crearCatalogoRutas };
