'use strict';

/**
 * Reportes: exportaciones a Excel, estadísticas y analíticas.
 *
 * TODAS aplican el filtro de visibilidad. En el sistema viejo los dos exports
 * eran de los endpoints que no lo hacían: cualquier reclutador podía descargar
 * un .xlsx con la base completa y los datos personales de candidatos ajenos.
 */

const { Router } = require('express');
const { z } = require('zod');
const { validar } = require('../../shared/middleware/validar');
const { requierePermiso } = require('../../shared/middleware/autorizar');
const { ok } = require('../../shared/utils/respuesta');
const { filtroSql } = require('../candidatos/visibilidad');
const { construirWorkbook, enviarWorkbook, filaTodos } = require('./excel');

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');

const rango = z
  .object({ desde: fecha, hasta: fecha })
  .refine((r) => r.desde <= r.hasta, {
    message: 'La fecha inicial no puede ser posterior a la final',
    path: ['desde'],
  });

const rangoOpcional = z
  .object({ desde: fecha.optional(), hasta: fecha.optional() })
  .refine((r) => !r.desde || !r.hasta || r.desde <= r.hasta, {
    message: 'La fecha inicial no puede ser posterior a la final',
    path: ['desde'],
  });

function crearReportesRutas({ reportesRepo, autenticar }) {
  const router = Router();
  router.use(autenticar);

  const sello = () => new Date().toISOString().slice(0, 10);

  // ------------------------------------------------------------- Excel -----
  /**
   * Todos los candidatos, sin filtrar por citación ni decisión — botón
   * "Descargar Excel" de la pantalla Candidatos. Sin rango, los últimos 100
   * registrados; con alguna fecha, todos los del rango (por fecha de
   * registro, no de citación).
   */
  router.get(
    '/todos.xlsx',
    requierePermiso('generar_reportes_seleccion'),
    validar({ query: rangoOpcional }),
    async (req, res) => {
      const candidatos = await reportesRepo.candidatosTodos({
        ...req.query,
        visibilidad: filtroSql(req.usuario),
      });
      const workbook = construirWorkbook(candidatos, { nombreHoja: 'Candidatos', filaFn: filaTodos });
      return enviarWorkbook(res, workbook, `candidatos-${sello()}.xlsx`);
    }
  );

  router.get(
    '/citados.xlsx',
    requierePermiso('generar_reportes_seleccion'),
    // El rango es obligatorio en el reporte oficial de citados.
    validar({ query: rango }),
    async (req, res) => {
      const candidatos = await reportesRepo.candidatosCitados({
        ...req.query,
        visibilidad: filtroSql(req.usuario),
      });
      const workbook = construirWorkbook(candidatos, { nombreHoja: 'Citados' });
      return enviarWorkbook(res, workbook, `citados-${req.query.desde}-a-${req.query.hasta}.xlsx`);
    }
  );

  router.get(
    '/aprobados.xlsx',
    requierePermiso('generar_reportes_seleccion'),
    validar({ query: rangoOpcional }),
    async (req, res) => {
      const candidatos = await reportesRepo.candidatosAprobados({
        ...req.query,
        visibilidad: filtroSql(req.usuario),
      });
      const workbook = construirWorkbook(candidatos, { nombreHoja: 'Aprobados' });
      return enviarWorkbook(res, workbook, `aprobados-${sello()}.xlsx`);
    }
  );

  // ------------------------------------------------------ estadísticas -----
  router.get('/estadisticas', requierePermiso('ver_estadisticas'), async (req, res) =>
    ok(res, await reportesRepo.estadisticasSeleccion({ visibilidad: filtroSql(req.usuario) }))
  );

  router.get('/estadisticas/evaluacion', requierePermiso('ver_estadisticas'), async (req, res) =>
    ok(res, await reportesRepo.estadisticasEvaluacion({ visibilidad: filtroSql(req.usuario) }))
  );

  /**
   * Panel del dashboard de Selección: cola de trabajo, resultados de Agente,
   * promedio por criterio y evaluaciones por día — las cuatro cifras que
   * responden "qué hay que hacer" y "cómo está yendo la evaluación", nada de
   * lo que ya cubre `/trazabilidad` (que es sobre REGISTRO de candidatos,
   * algo que Selección no hace). Gateado por `evaluar_candidatos`, exclusivo
   * de Selección y Administrador — Reclutamiento tiene `ver_estadisticas`
   * pero no debe ver la cola de evaluación ajena.
   */
  router.get('/panel-seleccion', requierePermiso('evaluar_candidatos'), async (req, res) => {
    const visibilidad = filtroSql(req.usuario);
    const [cola, resultadosAgentes, evaluacion, serie] = await Promise.all([
      reportesRepo.colaSeleccion({ visibilidad }),
      reportesRepo.resultadosAgenteGlobal({ visibilidad }),
      reportesRepo.estadisticasEvaluacion({ visibilidad }),
      reportesRepo.evaluacionesPorDia({ visibilidad }),
    ]);
    return ok(res, { cola, resultadosAgentes, evaluacion, serie });
  });

  // -------------------------------------------------------- analíticas -----
  router.get(
    '/analytics/estados-tiempo',
    requierePermiso('ver_estadisticas'),
    validar({ query: z.object({ dias: z.coerce.number().int().min(7).max(365).default(30) }) }),
    async (req, res) =>
      ok(
        res,
        await reportesRepo.estadosEnTiempo({
          dias: req.query.dias,
          visibilidad: filtroSql(req.usuario),
        })
      )
  );

  router.get('/analytics/clientes', requierePermiso('ver_estadisticas'), async (req, res) =>
    ok(res, await reportesRepo.porCliente({ visibilidad: filtroSql(req.usuario) }))
  );

  router.get(
    '/analytics/cargos',
    requierePermiso('ver_estadisticas'),
    validar({ query: z.object({ limite: z.coerce.number().int().min(1).max(50).default(10) }) }),
    async (req, res) =>
      ok(
        res,
        await reportesRepo.porCargo({
          limite: req.query.limite,
          visibilidad: filtroSql(req.usuario),
        })
      )
  );

  router.get('/analytics/progreso', requierePermiso('ver_estadisticas'), async (req, res) =>
    ok(res, await reportesRepo.progresoFormularios({ visibilidad: filtroSql(req.usuario) }))
  );

  return router;
}

module.exports = { crearReportesRutas };
