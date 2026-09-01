'use strict';

/**
 * Consulta del archivo histórico: los candidatos del sistema anterior.
 *
 * Es una vista de CONSULTA, no de gestión: no hay POST, PATCH ni DELETE. Sirve
 * para que una reclutadora responda preguntas del tipo "¿esta persona ya se
 * había presentado?", "¿quién la gestionó?", "¿en qué quedó?".
 *
 *   GET /api/historico/candidatos      -> listado paginado, buscable
 *   GET /api/historico/candidatos/:id  -> ficha completa
 *   GET /api/historico/filtros         -> valores para los desplegables
 *
 * Dos decisiones deliberadas:
 *
 *   - NO se filtra por dueño. En el sistema nuevo un reclutador solo ve su
 *     cartera; aquí ve el archivo completo, porque el objetivo es precisamente
 *     consultar candidatos que gestionó otra persona. Basta `ver_candidatos`,
 *     que tienen los tres roles.
 *   - El bloque `seleccion` de la ficha (evaluación de la entrevista,
 *     antecedentes y decisión final) solo se entrega a quien tiene
 *     `ver_perfiles_completos`, igual que en el sistema nuevo: son datos de
 *     valoración psicológica, no información de contacto.
 */

const { Router } = require('express');
const { validar } = require('../../shared/middleware/validar');
const { requierePermiso } = require('../../shared/middleware/autorizar');
const { ok, paginado } = require('../../shared/utils/respuesta');
const { HttpError } = require('../../shared/errors/HttpError');
const esquema = require('./historico.schema');
const { construirWorkbookHistorico, enviarWorkbook } = require('./historico.excel');
const { CAMPOS_PERFIL_COMPLETO } = require('./historico.repository');

/** Quita del listado la valoración psicológica a quien no tiene el permiso. */
function ocultarPerfilCompleto(item) {
  const visible = { ...item };
  for (const campo of CAMPOS_PERFIL_COMPLETO) delete visible[campo];
  return visible;
}

function crearHistoricoRutas({ historicoRepo, autenticar }) {
  const router = Router();
  router.use(autenticar);

  /**
   * Sin base histórica configurada el módulo existe pero no puede responder.
   * Se dice explícitamente en vez de devolver una lista vacía, que se leería
   * como "no hay candidatos antiguos" y es una respuesta falsa.
   */
  router.use((_req, _res, next) => {
    if (!historicoRepo) {
      return next(
        HttpError.servicioExterno('La base histórica no está disponible en este momento', {
          codigo: 'HISTORICO_NO_DISPONIBLE',
        })
      );
    }
    return next();
  });

  router.get(
    '/candidatos',
    requierePermiso('ver_candidatos'),
    validar({ query: esquema.listar }),
    async (req, res) => {
      const { pagina, porPagina, q, ...filtros } = req.query;
      const { items, total } = await historicoRepo.listar({
        ...filtros,
        pagina,
        porPagina,
        busqueda: q,
      });
      const visibles = req.usuario.permisos.includes('ver_perfiles_completos')
        ? items
        : items.map(ocultarPerfilCompleto);
      return paginado(res, visibles, { pagina, porPagina, total });
    }
  );

  router.get('/filtros', requierePermiso('ver_candidatos'), async (_req, res) =>
    ok(res, await historicoRepo.filtrosDisponibles())
  );

  /**
   * Excel oficial "BASE RECLUTAMIENTO" del archivo histórico. Sin rango trae
   * los últimos 100 candidatos registrados; con `desde`/`hasta` (alguno de
   * los dos basta) trae todos los del rango, sin tope.
   */
  router.get(
    '/base-reclutamiento.xlsx',
    requierePermiso('generar_reportes_seleccion'),
    validar({ query: esquema.baseReclutamiento }),
    async (req, res) => {
      const candidatos = await historicoRepo.candidatosBaseReclutamiento(req.query);
      const workbook = construirWorkbookHistorico(candidatos);
      const sello = new Date().toISOString().slice(0, 10);
      return enviarWorkbook(res, workbook, `historico-base-reclutamiento-${sello}.xlsx`);
    }
  );

  router.get(
    '/candidatos/:id',
    requierePermiso('ver_candidatos'),
    validar({ params: esquema.parametrosId }),
    async (req, res) => {
      const candidato = await historicoRepo.obtenerPorId(req.params.id);
      if (!candidato) {
        throw HttpError.noEncontrado('Ese candidato no existe en el archivo histórico');
      }

      if (!req.usuario.permisos.includes('ver_perfiles_completos')) {
        const { seleccion: _oculto, ...visible } = candidato;
        return ok(res, visible);
      }
      return ok(res, candidato);
    }
  );

  return router;
}

module.exports = { crearHistoricoRutas };
