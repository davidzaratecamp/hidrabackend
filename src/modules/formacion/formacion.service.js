'use strict';

/**
 * Rol Formación (migración 019): seguimiento de los candidatos que pasan a
 * formación y paso previo al envío a contratación (módulo `contratacion`).
 *
 *   - Agente (citado a formación): asistió Sí/No (razón si No) y activo/baja
 *     (razón si baja).
 *   - Staff (marcado como contratación): solo activo/baja.
 *
 * Todo es informativo: no cambia el estado del candidato en el embudo. Lo que sí
 * cambia es la elegibilidad para enviar a contratación (`motivoNoElegible`).
 */

const { HttpError } = require('../../shared/errors/HttpError');
const { nombreCompleto } = require('../../shared/utils/nombreCompleto');
const { esCargoAgente, motivoNoElegible } = require('../contratacion/contratacion.reglas');
const {
  enFormacion,
  motivoNoAsistencia,
  motivoNoEstado,
  debeLimpiarActivo,
} = require('./formacion.reglas');

function aVista(f) {
  const agente = esCargoAgente(f);
  const motivo = motivoNoElegible(f);
  return {
    id: f.id,
    nombre: nombreCompleto(f),
    numeroDocumento: f.numero_documento,
    cliente: f.cliente,
    cargo: f.cargo,
    tipo: agente ? 'agente' : 'staff',
    // Cuándo pasó a formación: citación (Agente) o contratación (Staff).
    fechaIngresoFormacion: agente ? f.fecha_citacion_formacion : f.fecha_contratacion,
    fechaDecision: f.fecha_decision,
    asistencia: agente
      ? {
          asistio: f.asistio_formacion ?? null,
          razon: f.razon_inasistencia ?? null,
          usuario: f.asistencia_usuario ?? null,
          fecha: f.asistencia_en ?? null,
        }
      : null,
    formacion: {
      estado: f.estado_formacion ?? null,
      razon: f.razon_baja ?? null,
      usuario: f.estado_usuario ?? null,
      fecha: f.estado_en ?? null,
    },
    elegible: motivo === null,
    motivoNoElegible: motivo,
  };
}

function crearFormacionServicio({ formacionRepo, uow }) {
  async function cargarParaEditar(repo, candidatoId) {
    const datos = await repo.buscar(candidatoId, { paraActualizar: true });
    if (!datos) throw HttpError.noEncontrado('El candidato no existe');
    return datos;
  }

  return {
    /** Candidatos en formación, todavía sin enviar a contratación. */
    async listar() {
      const filas = await formacionRepo.pendientesDeEnviar();
      return filas.filter(enFormacion).map(aVista);
    },

    async registrarAsistencia(candidatoId, { asistio, razon }, usuario) {
      if (!asistio && !razon) {
        throw HttpError.peticionInvalida('Si no asistió debes indicar la razón', { codigo: 'RAZON_REQUERIDA' });
      }
      await uow.ejecutar(async ({ formacionRepo: repo }) => {
        const datos = await cargarParaEditar(repo, candidatoId);
        const motivo = motivoNoAsistencia(datos);
        if (motivo) throw HttpError.conflicto(motivo, { codigo: 'FORMACION_NO_APLICA' });

        await repo.guardarAsistencia({ candidatoId, asistio, razon, usuarioId: usuario.id });
        if (debeLimpiarActivo(asistio, datos.estado_formacion)) await repo.limpiarEstado(candidatoId);
      });
      return aVista(await formacionRepo.buscar(candidatoId));
    },

    async registrarEstado(candidatoId, { estado, razon }, usuario) {
      if (estado === 'baja' && !razon) {
        throw HttpError.peticionInvalida('Dar de baja exige indicar la razón', { codigo: 'RAZON_REQUERIDA' });
      }
      await uow.ejecutar(async ({ formacionRepo: repo }) => {
        const datos = await cargarParaEditar(repo, candidatoId);
        const motivo = motivoNoEstado(datos, estado);
        if (motivo) throw HttpError.conflicto(motivo, { codigo: 'FORMACION_NO_APLICA' });

        await repo.guardarEstado({ candidatoId, estado, razon, usuarioId: usuario.id });
      });
      return aVista(await formacionRepo.buscar(candidatoId));
    },
  };
}

module.exports = { crearFormacionServicio };
