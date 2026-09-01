'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { validar } = require('../../shared/middleware/validar');
const { requierePermiso } = require('../../shared/middleware/autorizar');
const { ok, creado, paginado } = require('../../shared/utils/respuesta');

const params = z.object({ id: z.coerce.number().int().positive() });

const asistencia = z
  .object({
    asistio: z.enum(['asistio', 'no_asistio']),
    motivoInasistencia: z.string().trim().min(1).max(60).optional(),
    detalle: z.string().trim().max(255).optional(),
    observaciones: z.string().trim().max(2000).optional(),
  })
  .refine(
    (d) => d.asistio === 'asistio' || Boolean(d.motivoInasistencia),
    { message: 'Debes indicar el motivo de la inasistencia', path: ['motivoInasistencia'] }
  );

const evaluar = z.object({
  // Mapa criterio -> puntaje. El TOTAL no se acepta del cliente: lo calcula el
  // servidor sumando estos valores.
  puntajes: z.record(z.string().min(1), z.coerce.number().min(0).max(100)),
  razonRechazo: z.string().trim().min(3).max(2000).optional(),
});

const decidir = z.object({
  aprobacion: z.boolean(),
  razon: z.string().trim().min(3).max(2000).optional(),
});

const listarAgenda = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  asistio: z.enum(['pendiente', 'asistio', 'no_asistio']).optional(),
});

function crearSeleccionRutas({ seleccionServicio, autenticar }) {
  const router = Router();
  router.use(autenticar);

  router.get(
    '/agenda',
    requierePermiso('ver_candidatos'),
    validar({ query: listarAgenda }),
    async (req, res) => {
      const { items, total, pagina, porPagina } = await seleccionServicio.agenda(
        req.query,
        req.usuario
      );
      return paginado(res, items, { pagina, porPagina, total });
    }
  );

  router.get('/criterios', requierePermiso('ver_candidatos'), async (_req, res) =>
    ok(res, await seleccionServicio.criterios())
  );

  router.post(
    // Citar no lleva cuerpo desde la migración 009: no hay fecha que enviar.
    '/candidatos/:id/citacion',
    requierePermiso('agendar_entrevistas'),
    validar({ params }),
    async (req, res) => creado(res, await seleccionServicio.citar(req.params.id, req.usuario))
  );

  router.post(
    '/candidatos/:id/asistencia',
    requierePermiso('registrar_asistencia'),
    validar({ params, body: asistencia }),
    async (req, res) =>
      ok(res, await seleccionServicio.marcarAsistencia(req.params.id, req.body, req.usuario))
  );

  router.post(
    '/candidatos/:id/evaluacion',
    requierePermiso('evaluar_candidatos'),
    validar({ params, body: evaluar }),
    async (req, res) => creado(res, await seleccionServicio.evaluar(req.params.id, req.body, req.usuario))
  );

  router.post(
    '/candidatos/:id/decision-final',
    requierePermiso('tomar_decision_final'),
    validar({ params, body: decidir }),
    async (req, res) => ok(res, await seleccionServicio.decidir(req.params.id, req.body, req.usuario))
  );

  router.get(
    '/candidatos/:id/expediente',
    requierePermiso('ver_candidatos'),
    validar({ params }),
    async (req, res) => ok(res, await seleccionServicio.expediente(req.params.id, req.usuario))
  );

  return router;
}

module.exports = { crearSeleccionRutas };
