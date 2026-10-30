'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { validar } = require('../../shared/middleware/validar');
const { requierePermiso } = require('../../shared/middleware/autorizar');
const { ok, creado } = require('../../shared/utils/respuesta');
const { MAX_NOTA_ANTECEDENTES, MAX_NOTA_EXAMEN } = require('./contratacion.reglas');

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const id = z.object({ id: z.coerce.number().int().positive() });

const enviarLote = z.object({
  nombre: z.string().trim().min(3).max(150),
  fechaIngresoSugerida: z.string().regex(FECHA, 'Formato AAAA-MM-DD').optional(),
  // Mismo tope que acepta Gestor por lote.
  candidatoIds: z.array(z.coerce.number().int().positive()).min(1).max(200),
  // { [candidatoId]: nota } para los que tienen antecedentes sin cargar
  // (migración 021). Si falta y le faltan antecedentes, el servicio responde 409.
  notasAntecedentes: z
    .record(z.string().regex(/^\d+$/), z.string().trim().max(MAX_NOTA_ANTECEDENTES))
    .optional(),
});

const cancelar = z.object({
  motivo: z.string().trim().min(3).max(255),
});

const continuidad = z.object({
  continuar: z.boolean(),
  nota: z.string().trim().max(MAX_NOTA_EXAMEN).optional(),
});

/**
 * Exámenes médicos de SST (migración 022): selección ve las marcas que llegan
 * de Gestor y decide la continuidad de quien no asistió. Se monta antes que
 * `/api/contratacion`, porque selección no tiene `enviar_contratacion`.
 */
function crearExamenesContratacionRutas({ contratacionServicio, autenticar }) {
  const router = Router();
  router.use(autenticar, requierePermiso('decidir_continuidad_examenes'));

  router.get('/', async (_req, res) => ok(res, await contratacionServicio.listarExamenes()));

  router.post('/candidatos/:id/continuidad', validar({ params: id, body: continuidad }), async (req, res) =>
    ok(res, await contratacionServicio.decidirContinuidad(req.params.id, req.body, req.usuario))
  );

  return router;
}

/**
 * Rutas del rol Contratación (migración 020) y Administrador: enviar a RRHH y
 * seguir el estado en Gestor. La lista "por contratar" está en `/api/formacion`.
 */
function crearContratacionRutas({ contratacionServicio, autenticar }) {
  const router = Router();
  router.use(autenticar, requierePermiso('enviar_contratacion'));

  router.get('/elegibles', async (_req, res) => ok(res, await contratacionServicio.listarElegibles()));

  router.get('/lotes', async (_req, res) => ok(res, await contratacionServicio.listarLotes()));

  router.post('/lotes', validar({ body: enviarLote }), async (req, res) =>
    creado(res, await contratacionServicio.enviarLote(req.body, req.usuario))
  );

  router.get('/lotes/:id', validar({ params: id }), async (req, res) =>
    ok(res, await contratacionServicio.detalleLote(req.params.id))
  );

  router.post('/candidatos/:id/reenviar', validar({ params: id }), async (req, res) =>
    ok(res, await contratacionServicio.reenviarCandidato(req.params.id, req.usuario))
  );

  router.post('/candidatos/:id/cancelar', validar({ params: id, body: cancelar }), async (req, res) =>
    ok(res, await contratacionServicio.cancelarCandidato(req.params.id, req.body, req.usuario))
  );

  router.post('/envios/:id/reintentar', validar({ params: id }), async (req, res) =>
    ok(res, await contratacionServicio.reintentarEnvio(req.params.id))
  );

  return router;
}

// ----------------------------------------------------------------------------
// Entrada desde Gestor (máquina a máquina, firma HMAC). Contrato: conexionhydra.md §5.2.
// ----------------------------------------------------------------------------

const contratacion = z.object({
  hydra_candidato_id: z.number().int().positive(),
  users_company_id: z.number().int().positive(),
  fecha_ingreso: z.string().regex(FECHA).nullable().optional(),
  lote_externo_id: z.string().max(64).optional(),
});

const examen = z.object({
  hydra_candidato_id: z.number().int().positive(),
  evento: z.enum(['asistio', 'no_asistio', 'aprobado', 'no_aprobado']),
  descripcion: z.string().max(150).optional(),
  nota: z.string().max(1000).nullable().optional(),
  marcado_por: z.string().max(150).nullable().optional(),
  marcado_en: z.string().datetime({ offset: true }).optional(),
  lote_externo_id: z.string().max(64).optional(),
});

const descarte = z.object({
  hydra_candidato_id: z.number().int().positive(),
  motivo: z.string().trim().min(1).max(255),
  lote_externo_id: z.string().max(64).optional(),
});

function crearIntegracionGestorRutas({ contratacionServicio, autenticarGestor }) {
  const router = Router();
  router.use(autenticarGestor);

  router.post('/contrataciones', validar({ body: contratacion }), async (req, res) =>
    ok(res, await contratacionServicio.recibirContratacion(req.body))
  );

  router.post('/descartes', validar({ body: descarte }), async (req, res) =>
    ok(res, await contratacionServicio.recibirDescarte(req.body))
  );

  router.post('/examenes', validar({ body: examen }), async (req, res) =>
    ok(res, await contratacionServicio.recibirExamen(req.body, req.get('Idempotency-Key') ?? null))
  );

  return router;
}

module.exports = { crearContratacionRutas, crearExamenesContratacionRutas, crearIntegracionGestorRutas };
