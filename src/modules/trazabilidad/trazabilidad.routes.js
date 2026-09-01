'use strict';

/**
 * Trazabilidad.
 *
 * `/mia`     -> cualquier usuario ve su propia gestión
 * `/reclutador/:id` -> requiere ver_perfiles_completos (selección y administración)
 * `/equipo`  -> comparativa de todos los reclutadores
 * `/global`  -> totales del sistema
 */

const { Router } = require('express');
const { z } = require('zod');
const { validar } = require('../../shared/middleware/validar');
const { requierePermiso } = require('../../shared/middleware/autorizar');
const { ok } = require('../../shared/utils/respuesta');
const { HttpError } = require('../../shared/errors/HttpError');

const consulta = z.object({
  actividad: z.coerce.number().int().min(0).max(50).default(10),
});

function crearTrazabilidadRutas({ trazabilidadRepo, autenticar }) {
  const router = Router();
  router.use(autenticar);

  /** Panel completo de un reclutador. */
  async function panel(reclutadorId, { actividad }) {
    const [resumen, porEstado, porCargo, embudo, resultadosAgentes, serie, reciente] = await Promise.all([
      trazabilidadRepo.resumen(reclutadorId),
      trazabilidadRepo.porEstado(reclutadorId),
      trazabilidadRepo.porCargo(reclutadorId),
      trazabilidadRepo.embudoConversion(reclutadorId),
      trazabilidadRepo.resultadosAgentes(reclutadorId),
      trazabilidadRepo.serieMensual(reclutadorId),
      actividad > 0
        ? trazabilidadRepo.actividadReciente(reclutadorId, actividad)
        : Promise.resolve([]),
    ]);
    return {
      reclutadorId, resumen, porEstado, porCargo, embudo, resultadosAgentes, serie,
      actividadReciente: reciente,
    };
  }

  router.get(
    '/mia',
    requierePermiso('ver_dashboard'),
    validar({ query: consulta }),
    async (req, res) => ok(res, await panel(req.usuario.id, req.query))
  );

  router.get(
    '/reclutador/:id',
    requierePermiso('ver_perfiles_completos'),
    validar({ params: z.object({ id: z.coerce.number().int().positive() }), query: consulta }),
    async (req, res) => ok(res, await panel(req.params.id, req.query))
  );

  router.get('/equipo', requierePermiso('ver_perfiles_completos'), async (_req, res) =>
    ok(res, await trazabilidadRepo.equipo())
  );

  router.get('/global', requierePermiso('ver_estadisticas'), async (req, res) => {
    // Los totales globales solo tienen sentido para quien ve a todos; un
    // reclutador vería cifras que no corresponden a su cartera.
    if (!req.usuario.permisos.includes('ver_perfiles_completos')) {
      throw HttpError.prohibido('No tienes acceso a las métricas globales');
    }
    return ok(res, await trazabilidadRepo.totalesGlobales());
  });

  return router;
}

module.exports = { crearTrazabilidadRutas };
