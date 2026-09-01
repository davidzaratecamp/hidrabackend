'use strict';

/**
 * Máquina de estados del candidato.
 *
 * En el sistema viejo NO existía: `PUT /cambiar-estado/:id` aceptaba cualquier
 * estado desde cualquier otro, con solo comprobar que el destino estuviera en un
 * array. Además el avance vivía repartido en cuatro columnas paralelas
 * (`estado`, `citado_gestion`, `asistio_citacion`, `aprobacion_final`) que podían
 * contradecirse entre sí.
 *
 * Aquí hay un único punto de cambio de estado, que:
 *   1. valida la transición contra la tabla `estado_transiciones`,
 *   2. exige motivo cuando la transición lo requiere,
 *   3. escribe SIEMPRE la fila de historial.
 *
 * El grafo se cachea en memoria porque es un catálogo que cambia por migración,
 * no en caliente.
 */

const { HttpError } = require('../../shared/errors/HttpError');

function crearEstadoServicio({ estadoRepo }) {
  let cache = null;

  async function grafo() {
    if (!cache) cache = await estadoRepo.cargarGrafo();
    return cache;
  }

  return {
    /** Invalida la caché. Útil en pruebas y tras una migración de catálogo. */
    invalidarCache() {
      cache = null;
    },

    async estadoPorCodigo(codigo) {
      const { porCodigo } = await grafo();
      const estado = porCodigo.get(codigo);
      if (!estado) {
        throw HttpError.peticionInvalida(`Estado desconocido: ${codigo}`, {
          codigo: 'ESTADO_INVALIDO',
        });
      }
      return estado;
    },

    async transicionesDesde(codigo) {
      const { transiciones } = await grafo();
      return [...(transiciones.get(codigo)?.keys() ?? [])];
    },

    /**
     * Valida que el paso sea legal. No toca la base: es una función pura sobre
     * el grafo, y por eso se puede probar sin datos.
     */
    async validarTransicion(codigoOrigen, codigoDestino, { motivo } = {}) {
      if (codigoOrigen === codigoDestino) {
        throw HttpError.conflicto(`El candidato ya está en estado "${codigoDestino}"`, {
          codigo: 'ESTADO_SIN_CAMBIO',
        });
      }

      const { transiciones } = await grafo();
      const destinos = transiciones.get(codigoOrigen);
      const regla = destinos?.get(codigoDestino);

      if (!regla) {
        throw HttpError.conflicto(
          `No se puede pasar de "${codigoOrigen}" a "${codigoDestino}"`,
          {
            codigo: 'TRANSICION_INVALIDA',
            detalles: { desde: codigoOrigen, hacia: codigoDestino, permitidos: [...(destinos?.keys() ?? [])] },
          }
        );
      }

      if (regla.requiereMotivo && !String(motivo ?? '').trim()) {
        throw HttpError.peticionInvalida(
          `Pasar a "${codigoDestino}" requiere indicar un motivo`,
          { codigo: 'MOTIVO_REQUERIDO' }
        );
      }

      return regla;
    },

    /**
     * Cambia el estado y deja la traza. Debe recibir un repositorio enlazado a
     * la transacción en curso, para que estado e historial se guarden juntos.
     */
    async cambiar({ repo, candidato, codigoDestino, usuarioId, motivo }) {
      await this.validarTransicion(candidato.estado, codigoDestino, { motivo });

      const destino = await this.estadoPorCodigo(codigoDestino);
      const origen = await this.estadoPorCodigo(candidato.estado);

      await repo.actualizarEstado(candidato.id, destino.id);
      await repo.registrarHistorial({
        candidatoId: candidato.id,
        estadoAnteriorId: origen.id,
        estadoNuevoId: destino.id,
        usuarioId,
        motivo: motivo ?? null,
      });

      return destino;
    },

    /**
     * Avanza solo si la transición es legal; si no, deja el estado como está.
     *
     * Se usa en los avances automáticos del embudo (completar el formulario,
     * marcar asistencia), donde el candidato puede venir de estados distintos y
     * no se quiere retroceder uno más avanzado. El sistema viejo resolvía esto
     * con un `CASE WHEN estado IN (...)` incrustado en el UPDATE.
     */
    async avanzarSiSePuede({ repo, candidato, codigoDestino, usuarioId, motivo }) {
      const { transiciones } = await grafo();
      if (!transiciones.get(candidato.estado)?.has(codigoDestino)) return null;
      return this.cambiar({ repo, candidato, codigoDestino, usuarioId, motivo });
    },
  };
}

module.exports = { crearEstadoServicio };
