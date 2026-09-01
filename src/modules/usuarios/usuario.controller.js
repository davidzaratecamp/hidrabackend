'use strict';

/**
 * Controlador de usuarios.
 *
 * Su única responsabilidad es traducir HTTP ↔ servicio. No valida (lo hizo el
 * middleware), no consulta la base, no decide reglas. Los errores se propagan:
 * Express 5 reenvía las promesas rechazadas al manejador central, así que aquí
 * no hace falta un try/catch por handler.
 */

const { ok, creado, sinContenido, paginado } = require('../../shared/utils/respuesta');

function crearUsuarioControlador({ usuarioServicio }) {
  return {
    async listar(req, res) {
      const { items, total, pagina, porPagina } = await usuarioServicio.listar(req.query);
      return paginado(res, items, { pagina, porPagina, total });
    },

    async obtener(req, res) {
      return ok(res, await usuarioServicio.obtener(req.params.id));
    },

    async crear(req, res) {
      return creado(res, await usuarioServicio.crear(req.body, req.usuario));
    },

    async actualizar(req, res) {
      return ok(res, await usuarioServicio.actualizar(req.params.id, req.body, req.usuario));
    },

    async desactivar(req, res) {
      await usuarioServicio.desactivar(req.params.id, req.usuario);
      return sinContenido(res);
    },

    async reactivar(req, res) {
      return ok(res, await usuarioServicio.reactivar(req.params.id));
    },

    async reclutadores(_req, res) {
      return ok(res, await usuarioServicio.reclutadoresActivos());
    },

    async resumenRoles(_req, res) {
      return ok(res, await usuarioServicio.resumenRoles());
    },

    async listarRoles(_req, res) {
      return ok(res, await usuarioServicio.listarRoles());
    },

    async listarPermisos(_req, res) {
      return ok(res, await usuarioServicio.listarPermisos());
    },
  };
}

module.exports = { crearUsuarioControlador };
