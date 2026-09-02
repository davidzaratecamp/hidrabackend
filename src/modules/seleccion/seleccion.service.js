'use strict';

/**
 * Proceso de selección: citación, asistencia, evaluación y decisión final.
 *
 * Correcciones respecto al sistema viejo:
 *   - Citar crea una CITACIÓN, no fija una columna suelta. Ya no es posible
 *     quedar en estado 'citado' sin citación (ni al revés). Desde la migración
 *     009 la citación no lleva fecha de entrevista: citar es marcar que se citó.
 *   - El total de la evaluación lo calcula el servidor. Antes lo mandaba el
 *     cliente y se guardaba sin recalcular: se podía enviar total=100 con los
 *     cinco criterios en cero.
 *   - Todas las operaciones comprueban la visibilidad del candidato. Las de
 *     selección eran las únicas del backend que hacían `WHERE id = ?` a secas.
 */

const { HttpError } = require('../../shared/errors/HttpError');
const { citarEnTransaccion } = require('./citar');

/** Porcentaje mínimo para aprobar la entrevista. */
const UMBRAL_APROBACION = 71;

/**
 * La calificación de 5 criterios (saludo/perfilamiento/producto/objeciones/
 * cierre) es una rúbrica de venta telefónica: solo aplica a cargos "Agente"
 * (decisión de negocio, 2026-08-31) — "Agente", "Agente Plus", "Agente Call
 * Center", cualquier campaña. Se compara por texto, no por catálogo cerrado,
 * para que un cargo "Agente ..." nuevo quede cubierto sin tocar código.
 */
const esCargoAgente = (candidato) => /agente/i.test(candidato.cargo ?? '');

function crearSeleccionServicio({
  seleccionRepo,
  candidatoRepo,
  catalogoRepo,
  candidatoServicio,
  estadoServicio,
  uow,
}) {
  return {
    UMBRAL_APROBACION,

    /**
     * Cita al candidato. El estado pasa a 'citado' en la misma operación.
     *
     * Ya no lleva fecha de entrevista (migración 009): citar es marcar que se
     * citó, y `created_at` de la citación registra cuándo se hizo.
     */
    async citar(candidatoId, usuario) {
      const candidato = await candidatoServicio.obtenerAccesible(candidatoId, usuario);

      // Un candidato ya citado no se vuelve a citar: sin fecha que cambiar, una
      // segunda citación solo produciría dos filas pendientes y la asistencia
      // dejaría de saber cuál resolver. Es la misma regla que el frontend aplica
      // ocultando el botón, comprobada también aquí.
      if (await seleccionRepo.citacionPendiente(candidatoId)) {
        throw HttpError.conflicto('Ese candidato ya está citado', {
          codigo: 'YA_CITADO',
        });
      }

      const citacionId = await uow.ejecutar(async (repos) =>
        citarEnTransaccion(repos, {
          candidato,
          usuarioId: usuario.id,
          motivo: 'Candidato citado',
          estadoServicio,
        })
      );

      return { citacionId, candidato: await candidatoRepo.buscarPorId(candidatoId) };
    },

    async agenda(filtros, usuario) {
      const visibilidad = require('../candidatos/visibilidad').filtroSql(usuario);
      const { items, total } = await seleccionRepo.agenda({ ...filtros, visibilidad });
      return { items, total, pagina: filtros.pagina, porPagina: filtros.porPagina };
    },

    /**
     * Registra asistencia. Asistió → 'entrevistado'; no asistió → 'no_asistio'
     * y el motivo es obligatorio.
     */
    async marcarAsistencia(candidatoId, { asistio, motivoInasistencia, detalle, observaciones }, usuario) {
      const candidato = await candidatoServicio.obtenerAccesible(candidatoId, usuario);

      const citacion = await seleccionRepo.citacionPendiente(candidatoId);
      if (!citacion) {
        throw HttpError.conflicto('El candidato no tiene una citación pendiente', {
          codigo: 'SIN_CITACION_PENDIENTE',
        });
      }

      let motivoId = null;
      if (asistio === 'no_asistio') {
        if (!motivoInasistencia) {
          throw HttpError.peticionInvalida('Debes indicar el motivo de la inasistencia', {
            codigo: 'MOTIVO_REQUERIDO',
          });
        }
        motivoId = await catalogoRepo.idPorCodigo('motivos_inasistencia', motivoInasistencia);
        if (!motivoId) {
          throw HttpError.peticionInvalida(`Motivo inválido: ${motivoInasistencia}`, {
            codigo: 'CATALOGO_INVALIDO',
          });
        }
      }

      const destino = asistio === 'asistio' ? 'entrevistado' : 'no_asistio';

      await uow.ejecutar(async (repos) => {
        const actualizada = await repos.seleccionRepo.registrarAsistencia(citacion.id, {
          asistio,
          motivoId,
          detalle,
          observaciones,
          registradoPorId: usuario.id,
        });
        if (!actualizada) {
          throw HttpError.conflicto('Esa citación ya fue resuelta', { codigo: 'CITACION_RESUELTA' });
        }
        await estadoServicio.cambiar({
          repo: repos.candidatoRepo,
          candidato,
          codigoDestino: destino,
          usuarioId: usuario.id,
          motivo: asistio === 'asistio' ? 'Asistió a la entrevista' : `No asistió: ${motivoInasistencia}`,
        });
      });

      return { citacionId: citacion.id, asistio, estado: destino };
    },

    /**
     * Seguimiento antes de la entrevista: registra si el candidato respondió
     * la llamada y/o el mensaje de WhatsApp/Global de confirmación. Ambos
     * canales son independientes y opcionales — se puede guardar el resultado
     * de uno sin conocer todavía el del otro.
     */
    async registrarSeguimiento(candidatoId, { llamada, whatsapp }, usuario) {
      await candidatoServicio.obtenerAccesible(candidatoId, usuario);

      const citacion = await seleccionRepo.citacionPendiente(candidatoId);
      if (!citacion) {
        throw HttpError.conflicto('El candidato no tiene una citación pendiente', {
          codigo: 'SIN_CITACION_PENDIENTE',
        });
      }

      const actualizada = await seleccionRepo.registrarSeguimiento(citacion.id, { llamada, whatsapp });
      if (!actualizada) {
        throw HttpError.conflicto('Esa citación ya fue resuelta', { codigo: 'CITACION_RESUELTA' });
      }

      const fresca = await seleccionRepo.citacionPendiente(candidatoId);
      return {
        citacionId: fresca.id,
        llamada: fresca.seguimiento_llamada,
        whatsapp: fresca.seguimiento_whatsapp,
      };
    },

    /** Estado actual del seguimiento de la citación pendiente del candidato. */
    async seguimientoActual(candidatoId, usuario) {
      await candidatoServicio.obtenerAccesible(candidatoId, usuario);
      const citacion = await seleccionRepo.citacionPendiente(candidatoId);
      if (!citacion) return null;
      return {
        citacionId: citacion.id,
        llamada: citacion.seguimiento_llamada,
        whatsapp: citacion.seguimiento_whatsapp,
      };
    },

    async criterios() {
      return seleccionRepo.criteriosActivos();
    },

    /**
     * Guarda la evaluación. El cliente manda SOLO los puntajes por criterio;
     * el total y la aprobación los calcula el servidor.
     */
    async evaluar(candidatoId, { puntajes, razonRechazo }, usuario) {
      const candidato = await candidatoServicio.obtenerAccesible(candidatoId, usuario);

      if (candidato.estado !== 'entrevistado') {
        throw HttpError.conflicto(
          `Solo se puede evaluar a un candidato entrevistado (está en "${candidato.estado}")`,
          { codigo: 'ESTADO_NO_EVALUABLE' }
        );
      }

      if (!esCargoAgente(candidato)) {
        throw HttpError.conflicto(
          `La evaluación de entrevista solo aplica a candidatos con cargo Agente (este es "${candidato.cargo}"); pasa directo a decisión final`,
          { codigo: 'EVALUACION_NO_APLICA' }
        );
      }

      const criterios = await seleccionRepo.criteriosActivos();
      const porCodigo = new Map(criterios.map((c) => [c.codigo, c]));

      const faltantes = criterios.filter((c) => !(c.codigo in puntajes));
      if (faltantes.length > 0) {
        throw HttpError.peticionInvalida('Faltan criterios por calificar', {
          codigo: 'CRITERIOS_INCOMPLETOS',
          detalles: { faltantes: faltantes.map((c) => c.codigo) },
        });
      }

      const filas = [];
      let total = 0;
      let maximo = 0;
      for (const [codigo, valor] of Object.entries(puntajes)) {
        const criterio = porCodigo.get(codigo);
        if (!criterio) {
          throw HttpError.peticionInvalida(`Criterio desconocido: ${codigo}`, {
            codigo: 'CRITERIO_INVALIDO',
          });
        }
        if (valor < 0 || valor > Number(criterio.puntaje_maximo)) {
          throw HttpError.peticionInvalida(
            `"${criterio.nombre}" debe estar entre 0 y ${criterio.puntaje_maximo}`,
            { codigo: 'PUNTAJE_FUERA_DE_RANGO' }
          );
        }
        filas.push({ criterioId: criterio.id, puntaje: valor });
        total += Number(valor);
        maximo += Number(criterio.puntaje_maximo);
      }

      const porcentaje = maximo > 0 ? (100 * total) / maximo : 0;
      const aprobado = porcentaje >= UMBRAL_APROBACION;

      if (!aprobado && !razonRechazo) {
        throw HttpError.peticionInvalida(
          `El puntaje (${porcentaje.toFixed(2)}%) está por debajo del ${UMBRAL_APROBACION}%: debes indicar la razón del rechazo`,
          { codigo: 'RAZON_RECHAZO_REQUERIDA' }
        );
      }

      const citacion = await seleccionRepo.citacionesDe(candidatoId);
      const ultimaAsistida = citacion.find((c) => c.asistio === 'asistio');

      const evaluacionId = await uow.ejecutar(async (repos) => {
        const id = await repos.seleccionRepo.crearEvaluacion({
          candidatoId,
          citacionId: ultimaAsistida?.id ?? null,
          evaluadorId: usuario.id,
          aprobado,
          razonRechazo: aprobado ? null : razonRechazo,
        });
        await repos.seleccionRepo.guardarPuntajes(id, filas);
        await estadoServicio.cambiar({
          repo: repos.candidatoRepo,
          candidato,
          codigoDestino: aprobado ? 'aprobado' : 'rechazado',
          usuarioId: usuario.id,
          motivo: aprobado
            ? `Aprobó la evaluación con ${porcentaje.toFixed(2)}%`
            : razonRechazo,
        });
        return id;
      });

      const evaluacion = await seleccionRepo.evaluacionConTotal(evaluacionId);
      return { ...evaluacion, umbral: UMBRAL_APROBACION, detalle: await seleccionRepo.puntajesDe(evaluacionId) };
    },

    /** Decisión final del psicólogo, posterior e independiente del puntaje. */
    async decidir(candidatoId, { aprobacion, razon }, usuario) {
      const candidato = await candidatoServicio.obtenerAccesible(candidatoId, usuario);

      // Un Agente no puede saltarse la evaluación por este atajo: la
      // transición 'entrevistado' -> decisión final existe en el grafo para
      // los cargos que no evalúan, no para dejar la calificación opcional.
      if (candidato.estado === 'entrevistado' && esCargoAgente(candidato)) {
        throw HttpError.conflicto(
          'Este candidato es Agente: debe pasar por la evaluación de entrevista antes de la decisión final',
          { codigo: 'EVALUACION_REQUERIDA' }
        );
      }

      if (!aprobacion && !razon) {
        throw HttpError.peticionInvalida('Rechazar exige indicar la razón', {
          codigo: 'RAZON_REQUERIDA',
        });
      }

      await uow.ejecutar(async (repos) => {
        await repos.seleccionRepo.guardarDecisionFinal({
          candidatoId,
          aprobacion,
          razon,
          psicologoId: usuario.id,
        });
        await estadoServicio.cambiar({
          repo: repos.candidatoRepo,
          candidato,
          codigoDestino: aprobacion ? 'aprobado_final' : 'rechazado_final',
          usuarioId: usuario.id,
          motivo: razon ?? 'Decisión final del área de selección',
        });
      });

      return seleccionRepo.decisionFinalDe(candidatoId);
    },

    /** Expediente de selección completo de un candidato. */
    async expediente(candidatoId, usuario) {
      await candidatoServicio.obtenerAccesible(candidatoId, usuario);
      const [citaciones, evaluaciones, decision] = await Promise.all([
        seleccionRepo.citacionesDe(candidatoId),
        seleccionRepo.evaluacionesDe(candidatoId),
        seleccionRepo.decisionFinalDe(candidatoId),
      ]);
      return { citaciones, evaluaciones, decisionFinal: decision };
    },
  };
}

module.exports = { crearSeleccionServicio, UMBRAL_APROBACION };
