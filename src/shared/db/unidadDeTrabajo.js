'use strict';

/**
 * Unidad de trabajo.
 *
 * Un servicio que necesita escribir en varias tablas de forma atómica no debería
 * tener que saber de conexiones ni de commit/rollback. Pide una unidad de
 * trabajo, recibe los repositorios ya enlazados a la misma transacción, y si
 * algo falla se deshace todo.
 *
 * Los repositorios son fábricas que reciben `{ db }`, y tanto el pool como una
 * conexión transaccional exponen la misma interfaz: por eso el mismo repositorio
 * sirve dentro y fuera de una transacción.
 *
 * @example
 *   await uow.ejecutar(async ({ usuarioRepo }) => {
 *     const id = await usuarioRepo.crear(datos);
 *     await usuarioRepo.reemplazarRoles(id, rolIds);
 *     return id;
 *   });
 */
function crearUnidadDeTrabajo({ conTransaccion, fabricas }) {
  return {
    /**
     * @template T
     * @param {(repos: Record<string, object>) => Promise<T>} trabajo
     * @returns {Promise<T>}
     */
    async ejecutar(trabajo) {
      return conTransaccion(async (conexion) => {
        const repos = {};
        for (const [nombre, fabrica] of Object.entries(fabricas)) {
          repos[nombre] = fabrica({ db: conexion });
        }
        return trabajo(repos);
      });
    },
  };
}

module.exports = { crearUnidadDeTrabajo };
