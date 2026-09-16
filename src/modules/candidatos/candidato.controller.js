'use strict';

const { ok, creado, paginado } = require('../../shared/utils/respuesta');
const { HttpError } = require('../../shared/errors/HttpError');
const { enviarWorkbook } = require('../reportes/excel');

function crearCandidatoControlador({ candidatoServicio, formularioServicio }) {
  return {
    async listar(req, res) {
      const { items, total, pagina, porPagina } = await candidatoServicio.listar(
        req.query,
        req.usuario
      );
      return paginado(res, items, { pagina, porPagina, total });
    },

    async resumenEstados(req, res) {
      return ok(res, await candidatoServicio.resumenEstados(req.usuario, req.query));
    },

    async obtener(req, res) {
      return ok(res, await candidatoServicio.obtener(req.params.id, req.usuario));
    },

    async crear(req, res) {
      return creado(res, await candidatoServicio.crear(req.body, req.usuario));
    },

    async actualizar(req, res) {
      return ok(res, await candidatoServicio.actualizar(req.params.id, req.body, req.usuario));
    },

    async cambiarEstado(req, res) {
      return ok(res, await candidatoServicio.cambiarEstado(req.params.id, req.body, req.usuario));
    },

    async transiciones(req, res) {
      return ok(res, await candidatoServicio.transicionesDisponibles(req.params.id, req.usuario));
    },

    async reasignarCartera(req, res) {
      return ok(res, await candidatoServicio.reasignarCartera(req.body, req.usuario));
    },

    /** Plantilla .xlsx para la carga masiva: encabezados + hoja de referencia de catálogos. */
    async plantillaImportacion(req, res) {
      const workbook = await candidatoServicio.construirPlantillaImportacion();
      return enviarWorkbook(res, workbook, 'plantilla-candidatos.xlsx');
    },

    /** Carga masiva de candidatos desde un .xlsx. Todo o nada, ver candidato.service.js. */
    async importarExcel(req, res) {
      if (!req.file) {
        throw HttpError.peticionInvalida('Debes adjuntar un archivo .xlsx', {
          codigo: 'ARCHIVO_REQUERIDO',
        });
      }
      return ok(res, await candidatoServicio.importarExcel(req.file.buffer, req.usuario));
    },

    async reasignar(req, res) {
      return ok(res, await candidatoServicio.reasignar(req.params.id, req.body, req.usuario));
    },

    /** Emite un token nuevo y envía el correo con el link del formulario. */
    async enviarFormulario(req, res) {
      return ok(res, await formularioServicio.enviarFormulario(req.params.id, req.usuario));
    },

    /** Lo que el candidato llenó en sus 6 pasos (hoja de vida, estudios, experiencia, etc.). */
    async formulario(req, res) {
      return ok(res, await formularioServicio.completo(req.params.id, req.usuario));
    },
  };
}

module.exports = { crearCandidatoControlador };
