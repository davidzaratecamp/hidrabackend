'use strict';

/**
 * Autenticación por JWT.
 *
 * Es una fábrica, no un módulo con dependencias fijas: recibe el verificador de
 * tokens y el repositorio de usuarios desde fuera (inversión de dependencias).
 * Eso permite probarlo con dobles, sin base de datos ni claves reales.
 *
 * Se sigue consultando la base en cada petición, igual que el sistema viejo,
 * porque es lo que hace efectivo el bloqueo inmediato de un usuario desactivado.
 * La diferencia es que ahora es UNA consulta que ya trae roles y permisos, y que
 * nunca carga el hash de la contraseña a memoria.
 */

const { HttpError } = require('../errors/HttpError');

const ESQUEMA_BEARER = /^Bearer (.+)$/i;

function extraerToken(req) {
  const cabecera = req.get('authorization');
  if (!cabecera) return null;
  const coincidencia = ESQUEMA_BEARER.exec(cabecera.trim());
  return coincidencia ? coincidencia[1].trim() : null;
}

/**
 * @param {object} deps
 * @param {{verificar: (token: string) => {sub: number}}} deps.servicioToken
 * @param {{obtenerContextoAutenticacion: (id: number) => Promise<object|null>}} deps.usuarioRepo
 */
function crearAutenticar({ servicioToken, usuarioRepo }) {
  return async function autenticar(req, _res, next) {
    const token = extraerToken(req);
    if (!token) {
      return next(HttpError.noAutenticado('Falta el token de autenticación'));
    }

    let payload;
    try {
      payload = servicioToken.verificar(token);
    } catch (error) {
      const expirado = error.name === 'TokenExpiredError';
      return next(
        HttpError.noAutenticado(expirado ? 'Tu sesión expiró' : 'Token inválido', {
          codigo: expirado ? 'TOKEN_EXPIRADO' : 'TOKEN_INVALIDO',
          causa: error,
        })
      );
    }

    const usuario = await usuarioRepo.obtenerContextoAutenticacion(payload.sub);
    if (!usuario) {
      return next(
        HttpError.noAutenticado('Tu usuario ya no está activo', {
          codigo: 'USUARIO_INACTIVO',
        })
      );
    }

    req.usuario = usuario;
    return next();
  };
}

/**
 * Variante para rutas que se comportan distinto con o sin sesión, pero que no la
 * exigen. Un token inválido se ignora en silencio en vez de romper la petición.
 */
function crearAutenticarOpcional({ servicioToken, usuarioRepo }) {
  return async function autenticarOpcional(req, _res, next) {
    const token = extraerToken(req);
    if (!token) return next();

    try {
      const payload = servicioToken.verificar(token);
      const usuario = await usuarioRepo.obtenerContextoAutenticacion(payload.sub);
      if (usuario) req.usuario = usuario;
    } catch {
      // Sin sesión: la ruta decide qué hacer.
    }
    return next();
  };
}

module.exports = { crearAutenticar, crearAutenticarOpcional, extraerToken };
