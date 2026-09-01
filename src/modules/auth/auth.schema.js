'use strict';

const { z } = require('zod');
const { campos } = require('../usuarios/usuario.schema');

const login = z.object({
  email: campos.email,
  // En el login no se aplica la política de robustez: se valida contra el hash,
  // y exigir formato aquí solo daría pistas sobre la política a un atacante.
  password: z.string().min(1, 'La contraseña es obligatoria').max(128),
});

const cambiarPassword = z.object({
  passwordActual: z.string().min(1, 'Debes indicar tu contraseña actual').max(128),
  passwordNueva: campos.password,
});

module.exports = { login, cambiarPassword };
