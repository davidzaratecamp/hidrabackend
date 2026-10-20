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

/**
 * Formación y cola de Contratación (migraciones 019 y 020). Las dos colas viven
 * aquí porque comparten los datos (`candidato_formacion`); el permiso va por
 * ruta. El envío de lotes a RRHH vive en `/api/contratacion`.
 */
function crearFormacionRutas({ formacionServicio, autenticar }) {
  const router = Router();
  router.use(autenticar);

  // Rol Formación: Agentes en formación.
  const formacion = requierePermiso('gestionar_formacion');

  router.get('/candidatos', formacion, async (_req, res) => ok(res, await formacionServicio.listar()));

  router.put('/candidatos/:id/asistencia', formacion, validar({ params, body: asistencia }), async (req, res) =>
    ok(res, await formacionServicio.registrarAsistencia(req.params.id, req.body, req.usuario))
  );

  router.put('/candidatos/:id/estado', formacion, validar({ params, body: estado }), async (req, res) =>
    ok(res, await formacionServicio.registrarEstado(req.params.id, req.body, req.usuario))
  );

  // Rol Contratación: Staff y Agentes que pasaron la formación, por enviar a RRHH.
  const contratacion = requierePermiso('enviar_contratacion');

  router.get('/por-contratar', contratacion, async (_req, res) =>
    ok(res, await formacionServicio.listarPorContratar())
  );

  router.put('/por-contratar/:id/estado', contratacion, validar({ params, body: estado }), async (req, res) =>
    ok(res, await formacionServicio.registrarEstadoStaff(req.params.id, req.body, req.usuario))
  );

  return router;
}

module.exports = { crearFormacionRutas };
