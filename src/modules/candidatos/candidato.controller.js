'use strict';

const { ok, creado, paginado } = require('../../shared/utils/respuesta');

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
      return ok(res, await candidatoServicio.resumenEstados(req.usuario));
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
