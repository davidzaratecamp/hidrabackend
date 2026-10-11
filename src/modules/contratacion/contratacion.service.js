'use strict';

/**
 * Contratación en el Gestor Técnico (RRHH).
 *
 * Fase 5 (Hydra → Gestor): Selección arma un lote con candidatos aprobados; se
 * guarda junto con su envío pendiente (outbox) en una sola transacción, y el
 * despachador lo entrega a Gestor con reintentos.
 *
 * Fase 6 (Gestor → Hydra): Gestor avisa cuando RRHH registró a un candidato como
 * empleado (→ estado "contratado") o lo descartó (→ nota en el expediente).
 *
 * Contrato completo: `conexionhydra.md` §5 en el repo de Gestor.
 */

const { randomUUID } = require('node:crypto');
const { HttpError } = require('../../shared/errors/HttpError');
const { nombreCompleto } = require('../../shared/utils/nombreCompleto');
const {
  motivoNoElegible,
  construirCandidatoPayload,
  generarLoteExternoId,
  decidirResultadoEnvio,
  estadoLocalPorResultado,
} = require('./contratacion.reglas');

// Estados locales en los que el candidato ya no admite reenviar ni cancelar.
const ESTADOS_CERRADOS = ['registrado'];

function crearContratacionServicio({ contratacionRepo, estadoServicio, gestor, uow, config, logger, despachoInmediato = true }) {
  const politica = config.gestor.despacho;

  // --------------------------------------------------------------- consultas --

  async function listarElegibles() {
    const filas = await contratacionRepo.candidatosAprobadosNoEnviados();
    return filas.map((f) => ({
      id: f.id,
      nombre: nombreCompleto(f),
      numeroDocumento: f.numero_documento,
      cliente: f.cliente,
      cargo: f.cargo,
      fechaDecision: f.fecha_decision,
      elegible: motivoNoElegible(f) === null,
      motivoNoElegible: motivoNoElegible(f),
    }));
  }

  async function detalleLote(loteId) {
    const lote = await contratacionRepo.buscarLote(loteId);
    if (!lote) throw HttpError.noEncontrado('El lote no existe');
    const [candidatos, envios] = await Promise.all([
      contratacionRepo.candidatosDeLote(loteId),
      contratacionRepo.enviosDeLote(loteId),
    ]);
    return {
      ...lote,
      candidatos: candidatos.map((c) => ({ ...c, nombre: nombreCompleto(c) })),
      envios,
    };
  }

  // ----------------------------------------------------- Fase 5: envío -------

  function programarDespacho() {
    if (!despachoInmediato || !gestor) return;
    // Fuera del request: la respuesta a Selección no espera a Gestor. Si falla,
    // el despachador periódico lo reintenta.
    setImmediate(() => {
      despacharPendientes().catch((error) => logger.error({ err: error }, 'Falló el despacho inmediato a Gestor'));
    });
  }

  async function enviarLote({ nombre, fechaIngresoSugerida, candidatoIds }, usuario) {
    const ids = [...new Set(candidatoIds)];

    const loteId = await uow.ejecutar(async ({ contratacionRepo: repo }) => {
      const candidatos = [];
      const problemas = [];
      for (const id of ids) {
        const datos = await repo.datosParaEnvio(id);
        if (!datos) {
          problemas.push({ candidatoId: id, motivo: 'El candidato no existe' });
          continue;
        }
        const motivo = motivoNoElegible(datos);
        if (motivo) problemas.push({ candidatoId: id, nombre: nombreCompleto(datos), motivo });
        else candidatos.push(datos);
      }
      if (problemas.length > 0) {
        throw HttpError.conflicto('Hay candidatos que no se pueden enviar a contratación', {
          codigo: 'CANDIDATOS_NO_ELEGIBLES',
          detalles: problemas,
        });
      }

      const id = await repo.crearLote({ nombre, fechaIngresoSugerida, creadoPorId: usuario.id });
      const loteExternoId = generarLoteExternoId(id, new Date().toISOString(), randomUUID());
      await repo.fijarLoteExternoId(id, loteExternoId);
      // La PK de contratacion_candidatos es el candidato: si otra petición lo
      // envió en paralelo, este INSERT choca y la transacción completa se revierte.
      await repo.registrarCandidatos(id, candidatos.map((c) => c.id));

      await repo.encolarEnvio({
        tipo: 'lote',
        loteId: id,
        metodo: 'POST',
        ruta: '/lotes',
        payload: {
          lote_externo_id: loteExternoId,
          nombre,
          fecha_ingreso_sugerida: fechaIngresoSugerida ?? null,
          candidatos: candidatos.map((c) => construirCandidatoPayload(c, 1)),
        },
        idempotencyKey: randomUUID(),
        enviadoPorId: usuario.id,
      });
      return id;
    });

    programarDespacho();
    return detalleLote(loteId);
  }

  /** Candidato ya enviado y todavía abierto en Gestor, bloqueado. */
  async function contratacionAbierta(repo, candidatoId) {
    const actual = await repo.contratacionDe(candidatoId, { paraActualizar: true });
    if (!actual) throw HttpError.noEncontrado('El candidato no fue enviado a contratación');
    if (ESTADOS_CERRADOS.includes(actual.estado)) {
      throw HttpError.conflicto('El candidato ya fue registrado como empleado en Gestor', {
        codigo: 'YA_REGISTRADO',
      });
    }
    return actual;
  }

  /**
   * Reenvía los datos actuales del candidato (versión + 1). Gestor actualiza solo
   * lo que RRHH no haya editado a mano, y si el candidato estaba cancelado lo
   * vuelve a poner en proceso.
   */
  async function reenviarCandidato(candidatoId, usuario) {
    await uow.ejecutar(async ({ contratacionRepo: repo }) => {
      const actual = await contratacionAbierta(repo, candidatoId);
      const datos = await repo.datosParaEnvio(candidatoId);
      const version = actual.version + 1;

      await repo.actualizarCandidato(candidatoId, { version, estado: 'en_cola', detalle: null });
      await repo.encolarEnvio({
        tipo: 'actualizacion',
        loteId: actual.lote_id,
        candidatoId,
        metodo: 'PUT',
        ruta: `/candidatos/${candidatoId}`,
        payload: construirCandidatoPayload(datos, version),
        idempotencyKey: randomUUID(),
        enviadoPorId: usuario.id,
      });
    });
    programarDespacho();
    return contratacionRepo.contratacionDe(candidatoId);
  }

  /** El candidato desistió: Gestor lo saca del lote de RRHH. */
  async function cancelarCandidato(candidatoId, { motivo }, usuario) {
    await uow.ejecutar(async ({ contratacionRepo: repo }) => {
      const actual = await contratacionAbierta(repo, candidatoId);
      if (actual.estado === 'cancelado') {
        throw HttpError.conflicto('El candidato ya está cancelado', { codigo: 'YA_CANCELADO' });
      }
      await repo.actualizarCandidato(candidatoId, { estado: 'cancelado', detalle: motivo });
      await repo.encolarEnvio({
        tipo: 'cancelacion',
        loteId: actual.lote_id,
        candidatoId,
        metodo: 'POST',
        ruta: `/candidatos/${candidatoId}/cancelar`,
        payload: { motivo },
        idempotencyKey: randomUUID(),
        enviadoPorId: usuario.id,
      });
    });
    programarDespacho();
    return contratacionRepo.contratacionDe(candidatoId);
  }

  async function reintentarEnvio(envioId) {
    const envio = await contratacionRepo.buscarEnvio(envioId);
    if (!envio) throw HttpError.noEncontrado('El envío no existe');
    if (!(await contratacionRepo.reintentarEnvio(envioId))) {
      throw HttpError.conflicto(`Solo se puede reintentar un envío fallido (este está "${envio.estado}")`, {
        codigo: 'ENVIO_NO_REINTENTABLE',
      });
    }
    programarDespacho();
    return { id: envioId, estado: 'pendiente' };
  }

  // ------------------------------------------------------------ despachador --

  /** Refleja en los candidatos lo que respondió Gestor. */
  async function aplicarRespuesta(repo, envio, respuesta, decision) {
    if (decision.estado === 'enviado') {
      if (envio.tipo === 'cancelacion') return; // ya se marcó 'cancelado' al encolar
      // `POST /lotes` responde `candidatos[]`; `PUT /candidatos/:id`, `candidato`.
      const resultados = respuesta.cuerpo?.candidatos ?? (respuesta.cuerpo?.candidato ? [respuesta.cuerpo.candidato] : []);
      for (const r of resultados) {
        const actual = await repo.contratacionDe(r.hydra_candidato_id);
        if (!actual) continue;
        const cambio = estadoLocalPorResultado(r.resultado, actual.estado);
        if (cambio) await repo.actualizarCandidato(r.hydra_candidato_id, cambio);
      }
      return;
    }

    if (decision.estado === 'fallido') {
      const detalle = `Gestor rechazó el envío: ${respuesta.error ?? 'sin detalle'}`.slice(0, 255);
      if (envio.tipo === 'lote') {
        await repo.actualizarCandidatosDeLote(envio.lote_id, 'en_cola', { estado: 'error', detalle });
      } else {
        await repo.actualizarCandidato(envio.candidato_id, { estado: 'error', detalle });
      }
    }
  }

  async function despacharUno() {
    return uow.ejecutar(async ({ contratacionRepo: repo }) => {
      const envio = await repo.siguienteEnvioParaDespacho();
      if (!envio) return null;

      // La fila queda bloqueada mientras dura la llamada (con timeout): nadie más
      // la toma, y el resultado se guarda en la misma transacción.
      const respuesta = await gestor.enviar({
        metodo: envio.metodo,
        ruta: envio.ruta,
        payload: envio.payload,
        idempotencyKey: envio.idempotency_key,
        timeoutMs: politica.timeoutMs,
      });
      const decision = decidirResultadoEnvio(
        { status: respuesta.status, codigo: respuesta.codigo, intentosPrevios: envio.intentos },
        politica
      );
      await repo.registrarResultadoEnvio(envio.id, { ...decision, error: respuesta.error });
      await aplicarRespuesta(repo, envio, respuesta, decision);

      return { id: envio.id, tipo: envio.tipo, estado: decision.estado, error: respuesta.error };
    });
  }

  let despachando = false;

  /** Sin Gestor configurado no envía nada: los envíos esperan como 'pendiente'. */
  async function despacharPendientes() {
    if (!gestor || despachando) return [];
    despachando = true;
    try {
      const procesados = [];
      for (let i = 0; i < politica.enviosPorCorrida; i += 1) {
        const resultado = await despacharUno();
        if (!resultado) break;
        procesados.push(resultado);
        logger[resultado.estado === 'enviado' ? 'info' : 'warn'](resultado, 'Envío a Gestor procesado');
      }
      return procesados;
    } finally {
      despachando = false;
    }
  }

  /** Despachador periódico (lo arranca server.js). Devuelve la función para detenerlo. */
  function iniciarDespachador() {
    if (!gestor || politica.intervaloMs <= 0) {
      logger.warn('Despachador hacia Gestor desactivado (sin configuración o intervalo 0)');
      return () => {};
    }
    const temporizador = setInterval(() => {
      despacharPendientes().catch((error) => logger.error({ err: error }, 'Falló el despacho periódico a Gestor'));
    }, politica.intervaloMs);
    temporizador.unref();
    programarDespacho();
    return () => clearInterval(temporizador);
  }

  // -------------------------------------------- Fase 6: avisos de Gestor -----

  /**
   * RRHH registró al candidato como empleado → "contratado". Idempotente: si ya
   * está contratado responde igual, porque Gestor reintenta con la misma clave
   * ante cualquier corte de red.
   */
  async function recibirContratacion({ hydra_candidato_id: candidatoId, users_company_id: usersCompanyId }) {
    return uow.ejecutar(async ({ contratacionRepo: repo, candidatoRepo }) => {
      const contratacion = await repo.contratacionDe(candidatoId, { paraActualizar: true });
      const candidato = await candidatoRepo.buscarPorId(candidatoId);
      if (!contratacion || !candidato) {
        throw HttpError.noEncontrado('Hydra no tiene ese candidato en un lote de contratación');
      }

      if (candidato.estado !== 'contratado') {
        if (candidato.estado !== 'aprobado_final') {
          throw new HttpError(
            422,
            `El candidato está en "${candidato.estado}" y no puede pasar a contratado`,
            { codigo: 'ESTADO_NO_PERMITE_CONTRATAR' }
          );
        }
        await estadoServicio.cambiar({
          repo: candidatoRepo,
          candidato,
          codigoDestino: 'contratado',
          usuarioId: null,
          motivo: `Registrado como empleado en Gestor Técnico (empleado #${usersCompanyId}, lote ${contratacion.lote_externo_id})`,
        });
      }

      await repo.actualizarCandidato(candidatoId, { estado: 'registrado', detalle: null, usersCompanyId });
      return { candidatoId, estado: 'contratado', usersCompanyId };
    });
  }

  /**
   * RRHH descartó al candidato. No cambia su estado en Hydra (decisión abierta 3
   * de conexionhydra.md §11): queda como nota en la contratación.
   */
  async function recibirDescarte({ hydra_candidato_id: candidatoId, motivo }) {
    return uow.ejecutar(async ({ contratacionRepo: repo }) => {
      const contratacion = await repo.contratacionDe(candidatoId, { paraActualizar: true });
      if (!contratacion) throw HttpError.noEncontrado('Hydra no tiene ese candidato en un lote de contratación');
      if (contratacion.estado === 'registrado') {
        throw new HttpError(422, 'El candidato ya figura como registrado', { codigo: 'YA_REGISTRADO' });
      }
      await repo.actualizarCandidato(candidatoId, {
        estado: 'descartado',
        detalle: `Descartado por RRHH: ${motivo}`.slice(0, 255),
      });
      return { candidatoId, estado: 'descartado' };
    });
  }

  return {
    listarElegibles,
    listarLotes: () => contratacionRepo.listarLotes(),
    detalleLote,
    enviarLote,
    reenviarCandidato,
    cancelarCandidato,
    reintentarEnvio,
    despacharPendientes,
    iniciarDespachador,
    recibirContratacion,
    recibirDescarte,
  };
}

module.exports = { crearContratacionServicio };
