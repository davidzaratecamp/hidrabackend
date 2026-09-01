'use strict';

/**
 * Citar a un candidato, dentro de una transacción ya abierta.
 *
 * Vive en su propio archivo, y no como método de un servicio, porque hay DOS
 * caminos que citan y ninguno puede depender del otro:
 *
 *   - Selección, desde la agenda de entrevistas.
 *   - El registro del candidato, cuando la reclutadora marca Citado = Sí en el
 *     formulario (decisión de negocio, 2026-08-30).
 *
 * `seleccion.service` ya depende de `candidato.service` (para la visibilidad),
 * así que si el registro llamara al servicio de selección tendríamos un ciclo.
 * Esta función no depende de ninguno de los dos: recibe los repositorios de la
 * transacción y hace el par indivisible —crear la citación y mover el estado—
 * que es justo donde el sistema viejo dejaba las contradicciones, con `estado` y
 * `citado_gestion` contándose historias distintas.
 *
 * Desde la migración 009 la citación NO lleva fecha de entrevista: citar es
 * marcar que se citó, y `created_at` registra cuándo.
 *
 * @param {object} repos Repositorios enlazados a la transacción en curso.
 * @param {object} opciones
 * @param {object} opciones.candidato Fila del candidato, con su `estado` actual.
 * @param {number} opciones.usuarioId Quién cita.
 * @param {string} opciones.motivo Queda en el historial de estado.
 * @param {object} opciones.estadoServicio
 * @returns {Promise<number>} Id de la citación creada.
 */
async function citarEnTransaccion(repos, { candidato, usuarioId, motivo, estadoServicio }) {
  const citacionId = await repos.seleccionRepo.crearCitacion({
    candidatoId: candidato.id,
    agendadoPorId: usuarioId,
  });

  // `avanzarSiSePuede` y no `cambiar`: si el candidato ya venía de un estado que
  // no permite ir a 'citado', la citación queda registrada sin retroceder ni
  // romper el embudo.
  await estadoServicio.avanzarSiSePuede({
    repo: repos.candidatoRepo,
    candidato,
    codigoDestino: 'citado',
    usuarioId,
    motivo,
  });

  return citacionId;
}

module.exports = { citarEnTransaccion };
