'use strict';

/**
 * Regla de visibilidad de candidatos. UNA sola definición.
 *
 * En el sistema viejo esta regla estaba escrita a mano unas 15 veces, cada
 * endpoint armando su propio par `esAdmin ? queryA : queryB`. El resultado fue
 * que varios endpoints se la saltaron: `getCandidatosCitados`,
 * `getCandidatosAprobados`, `getCandidatosRechazados` y los dos exports a Excel
 * devolvían la base completa con datos personales a cualquier reclutador, y las
 * mutaciones de selección hacían `WHERE id = ?` sin comprobar pertenencia.
 *
 * Al ser una función, se aplica igual en listados, detalle, exportaciones y
 * mutaciones, y se puede probar sola.
 */

const PERMISO_VER_TODO = 'ver_candidatos_todos';

/**
 * ¿Este usuario ve candidatos ajenos?
 *
 * Se decide por permiso y no por rol: así, dar visibilidad total a un rol nuevo
 * es marcar una casilla en `rol_permisos`, no tocar código.
 *
 * Permiso separado de `ver_perfiles_completos` (decisión de negocio,
 * 2026-09-02): todos los roles ven el listado completo, pero
 * `ver_perfiles_completos` sigue controlando aparte quién ve valoración
 * psicológica/evaluación en histórico y trazabilidad — no todo el que ve el
 * listado debe ver esos datos.
 */
function veTodos(usuario) {
  return usuario.permisos.includes(PERMISO_VER_TODO);
}

/**
 * Fragmento SQL de filtrado, para componer en el WHERE de cualquier consulta.
 *
 * @param {{id: number, permisos: string[]}} usuario
 * @param {string} [alias] Alias de la tabla candidatos en la consulta.
 * @returns {{sql: string|null, params: unknown[]}}
 */
function filtroSql(usuario, alias = 'c') {
  if (veTodos(usuario)) return { sql: null, params: [] };
  return { sql: `${alias}.reclutador_id = ?`, params: [usuario.id] };
}

/**
 * ¿Puede este usuario tocar este candidato?
 *
 * Se usa en las mutaciones, donde no basta con filtrar el listado: hay que
 * comprobar la fila concreta antes de escribir.
 */
function puedeAcceder(usuario, candidato) {
  return veTodos(usuario) || candidato.reclutador_id === usuario.id;
}

module.exports = { veTodos, filtroSql, puedeAcceder, PERMISO_VER_TODO };
