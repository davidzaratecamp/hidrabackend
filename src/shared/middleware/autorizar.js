'use strict';

/**
 * Autorización por permisos y por roles.
 *
 * Un solo lugar. El sistema viejo tenía dos sistemas paralelos que divergieron:
 * `verificarRol`/`verificarPermiso` en el middleware compartido, y
 * `verificarRolSeleccion`/`verificarRolLectura` redefinidos dentro de
 * `seleccion.routes.js`. Esa duplicación es la causa directa de que las rutas de
 * selección fueran las únicas del backend sin filtro por dueño.
 *
 * Además, varios controllers volvían a comprobar el rol a mano dentro del
 * handler (`if (req.usuario.rol !== 'administrador')`), repitiendo lo que la
 * ruta ya había garantizado.
 *
 * Estos middlewares deciden si se puede ENTRAR al endpoint. La visibilidad de
 * cada fila (qué candidatos ve un usuario) es una regla de negocio y vive en la
 * capa de servicio, no aquí.
 */

const { HttpError } = require('../errors/HttpError');

function exigirSesion(req) {
  if (!req.usuario) {
    throw HttpError.noAutenticado('Necesitas iniciar sesión');
  }
}

/**
 * Exige permisos. Por defecto basta con tener uno ('alguno'); con
 * `modo: 'todos'` se exigen todos.
 *
 * Los permisos de un usuario son la unión de los de todos sus roles, así que
 * esto funciona igual para un usuario con un rol o con varios.
 */
function requierePermiso(...permisos) {
  const { modo, lista } = normalizarArgumentos(permisos);

  return function verificarPermiso(req, _res, next) {
    exigirSesion(req);

    const tiene = (p) => req.usuario.permisos.includes(p);
    const autorizado = modo === 'todos' ? lista.every(tiene) : lista.some(tiene);

    if (!autorizado) {
      return next(
        HttpError.prohibido('No tienes permiso para realizar esta acción', {
          codigo: 'PERMISO_INSUFICIENTE',
          detalles: { requeridos: lista, modo },
        })
      );
    }
    return next();
  };
}

/**
 * Exige pertenecer a alguno de los roles indicados.
 *
 * Se prefiere `requierePermiso`: los permisos son datos y se ajustan sin tocar
 * código. Esto queda para los casos donde la regla es realmente sobre el rol.
 */
function requiereRol(...roles) {
  const { lista } = normalizarArgumentos(roles);

  return function verificarRol(req, _res, next) {
    exigirSesion(req);

    if (!lista.some((rol) => req.usuario.roles.includes(rol))) {
      return next(
        HttpError.prohibido('Tu rol no tiene acceso a este recurso', {
          codigo: 'ROL_INSUFICIENTE',
          detalles: { requeridos: lista },
        })
      );
    }
    return next();
  };
}

function normalizarArgumentos(args) {
  const ultimo = args.at(-1);
  if (ultimo && typeof ultimo === 'object' && !Array.isArray(ultimo)) {
    return { modo: ultimo.modo ?? 'alguno', lista: args.slice(0, -1).flat() };
  }
  return { modo: 'alguno', lista: args.flat() };
}

module.exports = { requierePermiso, requiereRol };
