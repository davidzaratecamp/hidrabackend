'use strict';

/**
 * Contratación en el Gestor Técnico (RRHH).
 *
 * Fase 5 (Hydra → Gestor): Contratación (rol de la migración 020) arma un lote
 * con candidatos aprobados; se
 * guarda junto con su envío pendiente (outbox) en una sola transacción, y el
 * despachador lo entrega a Gestor con reintentos.
 *
 * Fase 6 (Gestor → Hydra): Gestor avisa cuando RRHH registró a un candidato como
 * empleado (→ estado "contratado") o lo descartó (→ nota en el expediente).
 *
 * Documentos (migración 021): después del lote van, cada uno en su envío, la
 * hoja de vida y el tratamiento de datos firmados (obligatorios) y los soportes
 * de antecedentes que tenga cargados. Si falta algún antecedente, Contratación
 * deja una nota para RRHH.
 *
 * Exámenes médicos (migración 022): SST, en Gestor, marca asistencia y
 * resultado; cada marca llega aquí. Si no asistió, selección decide si da
 * continuidad; si no aprobó, el candidato pasa a `no_apto_examenes`.
 *
 * Contrato completo: `conexionhydra.md` §5 y §16 en el repo de Gestor.
 */

const { randomUUID } = require('node:crypto');
const { HttpError } = require('../../shared/errors/HttpError');
const { nombreCompleto } = require('../../shared/utils/nombreCompleto');
const {
  motivoNoElegible,
  antecedentesFaltantes,
  motivoFaltaNota,
  notaParaEnviar,
  documentosAEnviar,
  construirCandidatoPayload,
  generarLoteExternoId,
  decidirResultadoEnvio,
  estadoLocalPorResultado,
  EXAMEN_POR_EVENTO_SST,
  motivoNoDecideContinuidad,
  efectoDecisionContinuidad,
  ESTADOS_CIERRE_EXAMENES,
} = require('./contratacion.reglas');

// Estados locales en los que el candidato ya no admite reenviar ni cancelar.
const ESTADOS_CERRADOS = ['registrado'];

function crearContratacionServicio({
  contratacionRepo, documentosContratacion, estadoServicio, gestor, uow, config, logger, despachoInmediato = true,
}) {
  const politica = config.gestor.despacho;

  // --------------------------------------------------------------- consultas --

  async function listarElegibles() {
    const filas = await documentosContratacion.completar(await contratacionRepo.candidatosAprobadosNoEnviados());
    return filas.map((f) => ({
      id: f.id,
      nombre: nombreCompleto(f),
      numeroDocumento: f.numero_documento,
      cliente: f.cliente,
      cargo: f.cargo,
      fechaDecision: f.fecha_decision,
      elegible: motivoNoElegible(f) === null,
      motivoNoElegible: motivoNoElegible(f),
      antecedentesFaltantes: antecedentesFaltantes(f.antecedentes),
    }));
  }

  async function detalleLote(loteId) {
    const lote = await contratacionRepo.buscarLote(loteId);
    if (!lote) throw HttpError.noEncontrado('El lote no existe');
    const [candidatos, envios] = await Promise.all([
      contratacionRepo.candidatosDeLote(loteId),
      contratacionRepo.enviosDeLote(loteId),
    ]);
    const examenes = await contratacionRepo.examenesDe(candidatos.map((c) => c.candidato_id));
    return {
      ...lote,
      candidatos: candidatos.map((c) => ({
        ...c,
        nombre: nombreCompleto(c),
        examenes: examenes.filter((e) => e.candidato_id === c.candidato_id),
      })),
      envios,
    };
  }

  /** Pantalla de exámenes médicos de selección: quién espera decisión y la traza de cada uno. */
  async function listarExamenes() {
    const candidatos = await contratacionRepo.candidatosConExamen();
    const examenes = await contratacionRepo.examenesDe(candidatos.map((c) => c.candidato_id));
    return candidatos.map((c) => ({
      ...c,
      nombre: nombreCompleto(c),
      decisionPendiente: motivoNoDecideContinuidad({ examenEstado: c.examen_estado, estadoLocal: c.estado }) === null,
      examenes: examenes.filter((e) => e.candidato_id === c.candidato_id),
    }));
  }

  /**
   * Selección decide sobre un candidato que no asistió a los exámenes. Queda en
   * la traza y se avisa a Gestor por el outbox. No continuar lo saca del
   * proceso aquí (`no_continua_examenes`) y en Gestor.
   */
  async function decidirContinuidad(candidatoId, { continuar, nota }, usuario) {
    await uow.ejecutar(async ({ contratacionRepo: repo, candidatoRepo }) => {
      const actual = await repo.contratacionDe(candidatoId, { paraActualizar: true });
      if (!actual) throw HttpError.noEncontrado('El candidato no fue enviado a contratación');
      const motivo = motivoNoDecideContinuidad({ examenEstado: actual.examen_estado, estadoLocal: actual.estado });
      if (motivo) throw HttpError.conflicto(motivo, { codigo: 'SIN_DECISION_PENDIENTE' });

      const efecto = efectoDecisionContinuidad(continuar);
      const notaLimpia = nota?.trim() || null;
      await repo.registrarExamen({
        candidatoId,
        evento: efecto.evento,
        nota: notaLimpia,
        origen: 'hydra',
        marcadoPor: usuario.nombreCompleto ?? null,
        marcadoEn: new Date(),
        usuarioId: usuario.id,
      });

      const cambios = { examenEstado: efecto.examenEstado };
      if (efecto.estadoLocal) {
        cambios.estado = efecto.estadoLocal;
        cambios.detalle = `No continúa: no asistió a exámenes médicos${notaLimpia ? ` (${notaLimpia})` : ''}`.slice(0, 255);
      }
      await repo.actualizarCandidato(candidatoId, cambios);

      if (efecto.estadoHydra) {
        const candidato = await candidatoRepo.buscarPorId(candidatoId);
        if (candidato && candidato.estado === 'aprobado_final') {
          await estadoServicio.cambiar({
            repo: candidatoRepo,
            candidato,
            codigoDestino: efecto.estadoHydra,
            usuarioId: usuario.id,
            motivo: `No asistió a los exámenes médicos y selección no dio continuidad${notaLimpia ? `: ${notaLimpia}` : ''}`,
          });
        }
      }

      await repo.encolarEnvio({
        tipo: 'continuidad',
        loteId: actual.lote_id,
        candidatoId,
        metodo: 'POST',
        ruta: `/candidatos/${candidatoId}/examenes/continuidad`,
        payload: {
          continuar,
          nota: notaLimpia,
          decidido_por: usuario.nombreCompleto?.slice(0, 150) ?? null,
        },
        idempotencyKey: randomUUID(),
        enviadoPorId: usuario.id,
      });
    });
    programarDespacho();
    return (await listarExamenes()).find((c) => c.candidato_id === Number(candidatoId)) ?? null;
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

  /** Un envío `documento` por archivo, encolado después del lote o de la actualización. */
  async function encolarDocumentos(repo, { loteId, candidatoId, antecedentes, enviadoPorId }) {
    for (const documento of documentosAEnviar(antecedentes)) {
      await repo.encolarEnvio({
        tipo: 'documento',
        loteId,
        candidatoId,
        metodo: 'PUT',
        ruta: `/candidatos/${candidatoId}/documentos/${documento.tipo}`,
        payload: documento,
        idempotencyKey: randomUUID(),
        enviadoPorId,
      });
    }
  }

  async function enviarLote({ nombre, fechaIngresoSugerida, candidatoIds, notasAntecedentes = {} }, usuario) {
    const ids = [...new Set(candidatoIds)];

    // Fuera de la transacción: consultar a FirmaCloud puede tardar, y no debe
    // hacerse con filas bloqueadas. Una firma completa no se deshace, así que el
    // resultado sigue valiendo dentro de la transacción.
    const previos = (await Promise.all(ids.map((id) => contratacionRepo.datosParaEnvio(id)))).filter(Boolean);
    await documentosContratacion.completar(previos);
    const previoDe = new Map(previos.map((p) => [p.id, p]));

    const loteId = await uow.ejecutar(async ({ contratacionRepo: repo }) => {
      const candidatos = [];
      const problemas = [];
      for (const id of ids) {
        const datos = await repo.datosParaEnvio(id);
        if (!datos) {
          problemas.push({ candidatoId: id, motivo: 'El candidato no existe' });
          continue;
        }
        const previo = previoDe.get(id);
        datos.firma_estado = previo?.firma_estado ?? datos.firma_estado;
        datos.antecedentes = previo?.antecedentes ?? [];
        const faltantes = antecedentesFaltantes(datos.antecedentes);
        const nota = notasAntecedentes[String(id)];

        const motivo = motivoNoElegible(datos) ?? motivoFaltaNota(faltantes, nota);
        if (motivo) problemas.push({ candidatoId: id, nombre: nombreCompleto(datos), motivo });
        else candidatos.push({ datos, faltantes, nota: notaParaEnviar(faltantes, nota) });
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
      await repo.registrarCandidatos(id, candidatos.map((c) => ({ id: c.datos.id, nota: c.nota })));

      await repo.encolarEnvio({
        tipo: 'lote',
        loteId: id,
        metodo: 'POST',
        ruta: '/lotes',
        payload: {
          lote_externo_id: loteExternoId,
          nombre,
          fecha_ingreso_sugerida: fechaIngresoSugerida ?? null,
          candidatos: candidatos.map((c) => construirCandidatoPayload(c.datos, 1, c)),
        },
        idempotencyKey: randomUUID(),
        enviadoPorId: usuario.id,
      });
      for (const c of candidatos) {
        await encolarDocumentos(repo, {
          loteId: id, candidatoId: c.datos.id, antecedentes: c.datos.antecedentes, enviadoPorId: usuario.id,
        });
      }
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
    if (ESTADOS_CIERRE_EXAMENES.includes(actual.estado_hydra)) {
      throw HttpError.conflicto('El candidato salió del proceso por los exámenes médicos', {
        codigo: 'CERRADO_POR_EXAMENES',
      });
    }
    return actual;
  }

  /**
   * Reenvía los datos actuales del candidato (versión + 1) y sus documentos. Gestor
   * actualiza solo lo que RRHH no haya editado a mano, y si el candidato estaba
   * cancelado lo vuelve a poner en proceso. Así llegan también los antecedentes
   * cargados después del envío; la nota es la que se dejó al enviar.
   */
  async function reenviarCandidato(candidatoId, usuario) {
    await uow.ejecutar(async ({ contratacionRepo: repo }) => {
      const actual = await contratacionAbierta(repo, candidatoId);
      const datos = await repo.datosParaEnvio(candidatoId);
      const antecedentes = await repo.antecedentesDe([candidatoId]);
      const faltantes = antecedentesFaltantes(antecedentes);
      const version = actual.version + 1;

      await repo.actualizarCandidato(candidatoId, { version, estado: 'en_cola', detalle: null });
      await repo.encolarEnvio({
        tipo: 'actualizacion',
        loteId: actual.lote_id,
        candidatoId,
        metodo: 'PUT',
        ruta: `/candidatos/${candidatoId}`,
        payload: construirCandidatoPayload(datos, version, { faltantes, nota: actual.nota_antecedentes }),
        idempotencyKey: randomUUID(),
        enviadoPorId: usuario.id,
      });
      await encolarDocumentos(repo, { loteId: actual.lote_id, candidatoId, antecedentes, enviadoPorId: usuario.id });
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
    // Un documento no cambia el estado del candidato: su avance y sus fallos se
    // ven en los envíos del lote, con "Reintentar".
    if (envio.tipo === 'documento') return;

    if (decision.estado === 'enviado') {
      // Ya se reflejaron al encolar: 'cancelado' o la decisión sobre el examen.
      if (envio.tipo === 'cancelacion' || envio.tipo === 'continuidad') return;
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
      } else if (envio.tipo === 'continuidad') {
        // La decisión ya quedó en la traza; el fallo se ve en los envíos del lote,
        // con "Reintentar" (p. ej. SST ya había vuelto a marcar asistencia).
        return;
      } else {
        await repo.actualizarCandidato(envio.candidato_id, { estado: 'error', detalle });
      }
    }
  }

  /**
   * Los envíos `documento` guardan solo la referencia: el archivo se lee aquí.
   * Si no se pudo conseguir, se responde como lo haría el transporte, para que
   * la misma política decida: permanente → 422 (fallido); FirmaCloud caído →
   * sin respuesta (reintento).
   */
  async function enviarAGestor(repo, envio) {
    let payload = envio.payload;
    if (envio.tipo === 'documento') {
      const preparado = await documentosContratacion.cuerpoDocumento(repo, envio);
      if (preparado.error) {
        return preparado.permanente
          ? { status: 422, codigo: 'DOCUMENTO_NO_DISPONIBLE', cuerpo: null, error: preparado.error }
          : { status: null, codigo: null, cuerpo: null, error: preparado.error };
      }
      payload = preparado.cuerpo;
    }
    return gestor.enviar({
      metodo: envio.metodo,
      ruta: envio.ruta,
      payload,
      idempotencyKey: envio.idempotency_key,
      timeoutMs: politica.timeoutMs,
    });
  }

  async function despacharUno() {
    return uow.ejecutar(async ({ contratacionRepo: repo }) => {
      const envio = await repo.siguienteEnvioParaDespacho();
      if (!envio) return null;

      // La fila queda bloqueada mientras dura la llamada (con timeout): nadie más
      // la toma, y el resultado se guarda en la misma transacción.
      const respuesta = await enviarAGestor(repo, envio);
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
   * SST marcó un examen en Gestor. Idempotente por la Idempotency-Key de Gestor:
   * un reintento no duplica la marca. "No aprobó" saca al candidato del proceso
   * (`no_apto_examenes`, con la nota de SST en el historial).
   */
  async function recibirExamen({ hydra_candidato_id: candidatoId, evento, nota, marcado_por: marcadoPor, marcado_en: marcadoEn }, idempotencyKey) {
    return uow.ejecutar(async ({ contratacionRepo: repo, candidatoRepo }) => {
      const contratacion = await repo.contratacionDe(candidatoId, { paraActualizar: true });
      if (!contratacion) throw HttpError.noEncontrado('Hydra no tiene ese candidato en un lote de contratación');
      if (await repo.examenPorClave(idempotencyKey)) {
        return { candidatoId, evento, duplicado: true };
      }

      await repo.registrarExamen({
        candidatoId,
        evento,
        nota: nota ?? null,
        origen: 'gestor',
        marcadoPor: marcadoPor ?? null,
        marcadoEn: marcadoEn ? new Date(marcadoEn) : new Date(),
        idempotencyKey,
      });

      const cambios = { examenEstado: EXAMEN_POR_EVENTO_SST[evento] };
      if (evento === 'no_aprobado') {
        cambios.estado = 'descartado';
        cambios.detalle = `No aprobó los exámenes médicos (SST): ${nota ?? ''}`.slice(0, 255);
        const candidato = await candidatoRepo.buscarPorId(candidatoId);
        if (candidato && candidato.estado === 'aprobado_final') {
          await estadoServicio.cambiar({
            repo: candidatoRepo,
            candidato,
            codigoDestino: 'no_apto_examenes',
            usuarioId: null,
            motivo: `SST (Gestor Técnico): no aprobó los exámenes médicos. ${nota ?? ''}`.trim(),
          });
        }
      }
      await repo.actualizarCandidato(candidatoId, cambios);
      return { candidatoId, evento, examenEstado: cambios.examenEstado };
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
    listarExamenes,
    decidirContinuidad,
    recibirExamen,
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
