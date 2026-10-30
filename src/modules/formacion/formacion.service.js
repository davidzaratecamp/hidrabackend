'use strict';

/**
 * Formación y cola de Contratación (migraciones 019 y 020): paso previo al
 * envío a contratación (módulo `contratacion`).
 *
 *   - Formación: Agentes citados a formación. Asistió Sí/No (razón si No) y
 *     activo/baja (razón si baja).
 *   - Contratación: Staff marcados como contratación (solo activo/baja, lo
 *     marca Contratación) y Agentes que pasaron la formación.
 *
 * Todo es informativo: no cambia el estado del candidato en el embudo. Lo que sí
 * cambia es la elegibilidad para enviar a contratación (`motivoNoElegible`).
 */

const { HttpError } = require('../../shared/errors/HttpError');
const { nombreCompleto } = require('../../shared/utils/nombreCompleto');
const { esCargoAgente, motivoNoElegible, antecedentesFaltantes } = require('../contratacion/contratacion.reglas');
const {
  enFormacion,
  porContratar,
  motivoNoAsistencia,
  motivoNoEstado,
  motivoNoEstadoStaff,
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
    // Al enviar, quien tenga faltantes debe llevar una nota para RRHH (migración 021).
    antecedentesFaltantes: antecedentesFaltantes(f.antecedentes ?? []),
  };
}

function crearFormacionServicio({ formacionRepo, documentosContratacion, uow }) {
  /** Firma real (FirmaCloud) y antecedentes de cada fila, para `aVista`. */
  async function vistas(filas) {
    await documentosContratacion.completar(filas);
    return filas.map(aVista);
  }

  async function cargarParaEditar(repo, candidatoId) {
    const datos = await repo.buscar(candidatoId, { paraActualizar: true });
    if (!datos) throw HttpError.noEncontrado('El candidato no existe');
    return datos;
  }

  /** Activo/baja: el mismo dato para Agentes (Formación) y Staff (Contratación). */
  async function guardarEstado(candidatoId, { estado, razon }, usuario, motivoNo) {
    if (estado === 'baja' && !razon) {
      throw HttpError.peticionInvalida('Dar de baja exige indicar la razón', { codigo: 'RAZON_REQUERIDA' });
    }
    await uow.ejecutar(async ({ formacionRepo: repo }) => {
      const datos = await cargarParaEditar(repo, candidatoId);
      const motivo = motivoNo(datos, estado);
      if (motivo) throw HttpError.conflicto(motivo, { codigo: 'FORMACION_NO_APLICA' });

      await repo.guardarEstado({ candidatoId, estado, razon, usuarioId: usuario.id });
    });
    return (await vistas([await formacionRepo.buscar(candidatoId)]))[0];
  }

  return {
    /** Agentes en formación, todavía sin enviar a contratación (rol Formación). */
    async listar() {
      const filas = await formacionRepo.pendientesDeEnviar();
      return vistas(filas.filter(enFormacion));
    },

    /** Staff y Agentes que pasaron la formación, sin enviar todavía (rol Contratación). */
    async listarPorContratar() {
      const filas = await formacionRepo.pendientesDeEnviar();
      return vistas(filas.filter(porContratar));
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
      return (await vistas([await formacionRepo.buscar(candidatoId)]))[0];
    },

    /** Activo/baja de un Agente en formación (rol Formación). */
    registrarEstado: (candidatoId, datos, usuario) => guardarEstado(candidatoId, datos, usuario, motivoNoEstado),

    /** Activo/baja de un Staff que pasa a contratación (rol Contratación). */
    registrarEstadoStaff: (candidatoId, datos, usuario) =>
      guardarEstado(candidatoId, datos, usuario, motivoNoEstadoStaff),
  };
}

module.exports = { crearFormacionServicio };
