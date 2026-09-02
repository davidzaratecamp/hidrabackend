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

const seguimiento = z
  .object({
    // Ambos opcionales e independientes: se puede registrar el resultado de
    // un solo canal sin tocar el otro (ver seleccion.repository.js::registrarSeguimiento).
    llamada: z.boolean().optional(),
    whatsapp: z.boolean().optional(),
  })
  .refine((d) => d.llamada !== undefined || d.whatsapp !== undefined, {
    message: 'Debes indicar el resultado de al menos un canal',
  });

const decidir = z.object({
  aprobacion: z.boolean(),
  razon: z.string().trim().min(3).max(2000).optional(),
});

const aprobarEntrevista = z.object({
  aprobacion: z.boolean(),
  razon: z.string().trim().min(3).max(2000).optional(),
});

const citarFormacion = z.object({
  citado: z.boolean(),
  razon: z.string().trim().min(3).max(2000).optional(),
});

const aprobarJefeInmediato = z.object({
  aprobacion: z.boolean(),
  razon: z.string().trim().min(3).max(2000).optional(),
});

const aprobarPruebaTecnica = z.object({
  aprobacion: z.boolean(),
  razon: z.string().trim().min(3).max(2000).optional(),
});

const registrarContratacion = z.object({
  contratado: z.boolean(),
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

  router.get(
    '/candidatos/:id/seguimiento',
    requierePermiso('ver_candidatos'),
    validar({ params }),
    async (req, res) =>
      ok(res, await seleccionServicio.seguimientoActual(req.params.id, req.usuario))
  );

  router.post(
    '/candidatos/:id/seguimiento',
    requierePermiso('registrar_asistencia'),
    validar({ params, body: seguimiento }),
    async (req, res) =>
      ok(res, await seleccionServicio.registrarSeguimiento(req.params.id, req.body, req.usuario))
  );

  router.post(
    '/candidatos/:id/evaluacion',
    requierePermiso('evaluar_candidatos'),
    validar({ params, body: evaluar }),
    async (req, res) => creado(res, await seleccionServicio.evaluar(req.params.id, req.body, req.usuario))
  );

  router.post(
    // Paso previo e informativo a la decisión final, para Agente y Staff (ver
    // seleccion.service.js::aprobarEntrevista). Mismo permiso que "Decidir":
    // lo hace el mismo actor, un paso antes.
    '/candidatos/:id/aprobacion-entrevista',
    requierePermiso('tomar_decision_final'),
    validar({ params, body: aprobarEntrevista }),
    async (req, res) =>
      ok(res, await seleccionServicio.aprobarEntrevista(req.params.id, req.body, req.usuario))
  );

  router.post(
    // Paso previo e informativo a la decisión final, solo Staff (ver
    // seleccion.service.js::aprobarJefeInmediato).
    '/candidatos/:id/aprobacion-jefe-inmediato',
    requierePermiso('tomar_decision_final'),
    validar({ params, body: aprobarJefeInmediato }),
    async (req, res) =>
      ok(res, await seleccionServicio.aprobarJefeInmediato(req.params.id, req.body, req.usuario))
  );

  router.post(
    // Paso previo e informativo a la decisión final, solo Staff (ver
    // seleccion.service.js::aprobarPruebaTecnica).
    '/candidatos/:id/aprobacion-prueba-tecnica',
    requierePermiso('tomar_decision_final'),
    validar({ params, body: aprobarPruebaTecnica }),
    async (req, res) =>
      ok(res, await seleccionServicio.aprobarPruebaTecnica(req.params.id, req.body, req.usuario))
  );

  router.post(
    '/candidatos/:id/decision-final',
    requierePermiso('tomar_decision_final'),
    validar({ params, body: decidir }),
    async (req, res) => ok(res, await seleccionServicio.decidir(req.params.id, req.body, req.usuario))
  );

  router.post(
    // Paso posterior e informativo a la decisión final aprobada, solo cargo
    // Agente (ver seleccion.service.js::citarFormacion). Mismo permiso que
    // "Decidir".
    '/candidatos/:id/citacion-formacion',
    requierePermiso('tomar_decision_final'),
    validar({ params, body: citarFormacion }),
    async (req, res) =>
      ok(res, await seleccionServicio.citarFormacion(req.params.id, req.body, req.usuario))
  );

  router.post(
    // Paso posterior e informativo a la decisión final aprobada, solo Staff
    // (ver seleccion.service.js::registrarContratacion). Contraparte de
    // "citar a formación" para Agente.
    '/candidatos/:id/contratacion',
    requierePermiso('tomar_decision_final'),
    validar({ params, body: registrarContratacion }),
    async (req, res) =>
      ok(res, await seleccionServicio.registrarContratacion(req.params.id, req.body, req.usuario))
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
