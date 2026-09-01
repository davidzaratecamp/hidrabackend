'use strict';

const { ok, sinContenido } = require('../../shared/utils/respuesta');

function crearAuthControlador({ authServicio }) {
  return {
    async login(req, res) {
      return ok(res, await authServicio.login(req.body));
    },

    async perfil(req, res) {
      return ok(res, await authServicio.perfil(req.usuario));
    },

    async cambiarPassword(req, res) {
      await authServicio.cambiarPassword(req.usuario.id, req.body);
      return sinContenido(res);
    },
  };
}

module.exports = { crearAuthControlador };
