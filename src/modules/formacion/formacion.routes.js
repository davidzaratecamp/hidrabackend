'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { validar } = require('../../shared/middleware/validar');
const { requierePermiso } = require('../../shared/middleware/autorizar');
const { ok } = require('../../shared/utils/respuesta');

const params = z.object({ id: z.coerce.number().int().positive() });

const asistencia = z.object({
  asistio: z.boolean(),
  razon: z.string().trim().min(3).max(2000).optional(),
});

const estado = z.object({
  estado: z.enum(['activo', 'baja']),
  razon: z.string().trim().min(3).max(2000).optional(),
});

/** Rol Formación (migración 019). El envío a contratación vive en `/api/contratacion`. */
function crearFormacionRutas({ formacionServicio, autenticar }) {
  const router = Router();
  router.use(autenticar, requierePermiso('gestionar_formacion'));

  router.get('/candidatos', async (_req, res) => ok(res, await formacionServicio.listar()));

  router.put('/candidatos/:id/asistencia', validar({ params, body: asistencia }), async (req, res) =>
    ok(res, await formacionServicio.registrarAsistencia(req.params.id, req.body, req.usuario))
  );

  router.put('/candidatos/:id/estado', validar({ params, body: estado }), async (req, res) =>
    ok(res, await formacionServicio.registrarEstado(req.params.id, req.body, req.usuario))
  );

  return router;
}

module.exports = { crearFormacionRutas };
