'use strict';

/**
 * Formulario del candidato: emisión del link, los 6 pasos y el cierre.
 *
 * Reglas heredadas que se conservan:
 *   - El token rota en cada envío: solo el último link sirve.
 *   - Una vez completado el paso 6 el formulario queda cerrado hasta que el
 *     reclutador reenvíe el correo.
 *   - Completar el paso 6 avanza el estado y dispara la firma electrónica.
 *
 * Lo que cambia: el correo y la firma se registran SIEMPRE, salgan bien o mal.
 * En el sistema viejo un envío fallido devolvía éxito y no dejaba rastro.
 */

const { randomUUID } = require('node:crypto');
const { HttpError } = require('../../shared/errors/HttpError');
const { separarNombreCompleto, nombreCompleto } = require('../../shared/utils/nombreCompleto');
const plantillas = require('../integraciones/email/plantillas');

const DIAS_VIGENCIA_TOKEN = 30;
const PASOS_TOTALES = 6;

function crearFormularioServicio({
  formularioRepo,
  candidatoRepo,
  catalogoRepo,
  candidatoServicio,
  estadoServicio,
  documentosServicio,
  email,
  firma,
  uow,
  config,
  logger,
}) {
  /**
   * Valida el token y devuelve el candidato.
   *
   * Un token sirve si existe, no está revocado, no se ha usado y no venció.
   * Los cuatro casos responden 404 con el mismo mensaje: distinguirlos permitiría
   * sondear qué tokens existen.
   */
  async function exigirTokenVigente(token) {
    const fila = await formularioRepo.buscarToken(token);
    if (!fila || fila.revocado_en || fila.usado_en || !fila.vigente) {
      throw HttpError.noEncontrado('El enlace no es válido o ya venció', {
        codigo: 'TOKEN_INVALIDO',
      });
    }
    return fila;
  }

  /** Guarda un paso dentro de una transacción y lo marca como completado. */
  async function ejecutarPaso(token, paso, trabajo) {
    const info = await exigirTokenVigente(token);
    await uow.ejecutar(async (repos) => {
      await trabajo(repos, info.candidato_id);
      await repos.formularioRepo.marcarPaso(info.candidato_id, paso);
    });
    const completados = await formularioRepo.pasosCompletados(info.candidato_id);
    return { paso, completados: completados.length, total: PASOS_TOTALES };
  }

  /** Resuelve un código de catálogo a id, o null si no se envió. */
  async function idOpcional(catalogo, codigo) {
    if (codigo === undefined || codigo === null) return null;
    const id = await catalogoRepo.idPorCodigo(catalogo, codigo);
    if (!id) {
      throw HttpError.peticionInvalida(`Valor inválido para ${catalogo}: ${codigo}`, {
        codigo: 'CATALOGO_INVALIDO',
      });
    }
    return id;
  }

  return {
    /** Emite un token nuevo, revoca los anteriores y manda el correo. */
    async enviarFormulario(candidatoId, usuario) {
      const candidato = await candidatoServicio.obtenerAccesible(candidatoId, usuario);

      if (!candidato.email) {
        throw HttpError.peticionInvalida(
          'El candidato no tiene correo registrado; agrégalo antes de enviarle el formulario',
          { codigo: 'SIN_EMAIL' }
        );
      }

      const token = randomUUID();
      await uow.ejecutar(async (repos) => {
        await repos.formularioRepo.revocarTokensVigentes(candidatoId);
        await repos.formularioRepo.emitirToken({
          candidatoId,
          token,
          diasVigencia: DIAS_VIGENCIA_TOKEN,
          enviadoPorId: usuario.id,
        });
      });

      const link = `${config.servidor.urlFrontend}/candidato/formulario/${token}`;
      const mensaje = plantillas.formularioCandidato({
        candidato,
        link,
        diasVigencia: DIAS_VIGENCIA_TOKEN,
      });

      let enviado = true;
      let errorEnvio = null;
      try {
        await email.enviar({ para: candidato.email, ...mensaje });
      } catch (error) {
        enviado = false;
        errorEnvio = error.message;
      }

      await formularioRepo.registrarEnvioEmail({
        candidatoId,
        destinatario: candidato.email,
        tipo: 'formularios',
        estado: enviado ? 'enviado' : 'fallido',
        error: errorEnvio,
        enviadoPorId: usuario.id,
      });

      // Un fallo de correo NO invalida el token: el link ya existe y se puede
      // compartir a mano. Pero el llamador se entera de que no salió.
      if (!enviado) {
        throw HttpError.servicioExterno(
          'El formulario se generó pero no se pudo enviar el correo',
          { codigo: 'EMAIL_FALLIDO', detalles: { link, error: errorEnvio } }
        );
      }

      // El estado solo avanza si la transición es legal desde donde esté.
      await uow.ejecutar(async ({ candidatoRepo: repo }) =>
        estadoServicio.avanzarSiSePuede({
          repo,
          candidato,
          codigoDestino: 'formularios_enviados',
          usuarioId: usuario.id,
          motivo: 'Formulario enviado al candidato',
        })
      );

      return { enviado: true, destinatario: candidato.email, expiraEnDias: DIAS_VIGENCIA_TOKEN };
    },

    /**
     * Datos que ve el candidato al abrir el link. Público.
     *
     * Incluye los campos que YA capturó el reclutador en "Nuevo candidato"
     * (nombre, documento, celular): el paso "Datos básicos" los pre-llena con
     * esto, en vez de pedírselos de nuevo al candidato (así se hacía en la
     * interfaz anterior, con `validarToken` devolviendo el candidato completo).
     * No es un riesgo de exposición: el token es el mismo secreto que ya le da
     * acceso a leer y corregir estos datos.
     */
    async abrirFormulario(token) {
      const info = await exigirTokenVigente(token);
      const [completados, respuestas] = await Promise.all([
        formularioRepo.pasosCompletados(info.candidato_id),
        // Lo que ya diligenció en un envío anterior: el token rota en cada
        // reenvío, pero los datos son del candidato, no del token. Sin esto,
        // reabrir un paso ya completado lo mostraba en blanco y guardarlo de
        // nuevo pisaba con NULL lo que ya había escrito.
        formularioRepo.obtenerRespuestasGuardadas(info.candidato_id),
      ]);
      return {
        respuestas,
        candidato: {
          primerNombre: info.primer_nombre,
          primerApellido: info.primer_apellido,
          nombreCompleto: nombreCompleto(info),
          numeroDocumento: info.numero_documento,
          celular: info.celular,
          edad: info.edad,
          // Bloque "DATOS BÁSICOS" de la plantilla de hoja de vida: cargo y
          // fuente los define quien registra al candidato, así que aquí son
          // de solo lectura. La "fecha de entrevista" impresa en la plantilla
          // usa la fecha de envío del correo (mismo criterio que
          // `hojaVidaPdfService.js`, desde que citar dejó de pedir fecha/hora).
          cargo: info.cargo,
          fuenteReclutamiento: info.fuente_reclutamiento,
          fechaEnvioEmail: info.enviado_en,
          // Bloque "DATOS PERSONALES": correo y nacionalidad también son de
          // solo lectura. El correo es al que se le mandó este mismo link
          // (cambiarlo aquí no actualiza nada, no hay a dónde escribirlo); la
          // nacionalidad se deriva del tipo de documento, nunca la escribe el
          // candidato.
          email: info.email,
          nacionalidad: info.nacionalidad,
        },
        progreso: { completados: completados.length, total: PASOS_TOTALES, pasos: completados },
        expiraEn: info.expira_en,
      };
    },

    // ---------------------------------------------------------------- pasos --
    async guardarHojaVida(token, datos) {
      return ejecutarPaso(token, 'hoja_vida', async (repos, candidatoId) => {
        await repos.formularioRepo.guardarDatosBasicos(candidatoId, {
          aspiracionSalarial: datos.aspiracionSalarial,
        });
      });
    },

    async guardarDatosBasicos(token, datos) {
      const ids = {
        estadoCivilId: await idOpcional('estados_civiles', datos.estadoCivil),
        generoId: await idOpcional('generos', datos.genero),
        grupoSanguineoId: await idOpcional('grupos_sanguineos', datos.grupoSanguineo),
        epsId: await idOpcional('eps', datos.eps),
        afpId: await idOpcional('afp', datos.afp),
        tallaCamisaId: await idOpcional('tallas_camisa', datos.tallaCamisa),
        parentescoEmergenciaId: await idOpcional('parentescos', datos.parentescoEmergencia),
      };

      return ejecutarPaso(token, 'datos_basicos', async (repos, candidatoId) => {
        await repos.formularioRepo.guardarDatosBasicos(candidatoId, {
          ...ids,
          fechaNacimiento: datos.fechaNacimiento ?? null,
          direccionResidencial: datos.direccionResidencial ?? null,
          barrio: datos.barrio ?? null,
          nombreEmergencia: datos.nombreEmergencia ?? null,
          numeroEmergencia: datos.numeroEmergencia ?? null,
        });

        // Lo que el candidato corrige aquí se refleja en su ficha.
        const nombre = datos.nombreCompleto ? separarNombreCompleto(datos.nombreCompleto) : {};
        await repos.formularioRepo.sincronizarIdentidad(candidatoId, {
          ...nombre,
          numeroDocumento: datos.numeroDocumento,
          celular: datos.celular,
          edad: datos.edad,
        });
      });
    },

    async guardarEstudios(token, { estudios }) {
      // Bachillerato es obligatorio en el formato oficial.
      const tieneBachillerato = estudios.some((e) => e.nivel === 'bachillerato');
      if (!tieneBachillerato) {
        throw HttpError.peticionInvalida('Debes registrar al menos el bachillerato', {
          codigo: 'BACHILLERATO_REQUERIDO',
        });
      }

      const resueltos = [];
      for (const e of estudios) {
        const nivelEstudiosId = await idOpcional('niveles_estudios', e.nivel);
        resueltos.push({ ...e, nivelEstudiosId });
      }

      return ejecutarPaso(token, 'estudios', async (repos, candidatoId) => {
        await repos.formularioRepo.reemplazarEstudios(candidatoId, resueltos);
      });
    },

    async guardarExperiencia(token, { experiencias, resumen }) {
      const campanaAsisteId = resumen?.campanaAsiste
        ? await catalogoRepo.idCliente(resumen.campanaAsiste)
        : null;

      return ejecutarPaso(token, 'experiencia', async (repos, candidatoId) => {
        await repos.formularioRepo.reemplazarExperiencias(candidatoId, experiencias ?? []);
        await repos.formularioRepo.guardarExperienciaResumen(candidatoId, {
          ...(resumen ?? {}),
          campanaAsisteId,
        });
      });
    },

    async guardarPersonal(token, datos) {
      const conocimientos = [];
      for (const c of datos.conocimientos ?? []) {
        const herramientaId = await idOpcional('herramientas_informaticas', c.herramienta);
        conocimientos.push({ herramientaId, nivel: c.nivel });
      }

      return ejecutarPaso(token, 'personal', async (repos, candidatoId) => {
        await repos.formularioRepo.guardarPersonal(candidatoId, datos);
        await repos.formularioRepo.reemplazarMetas(candidatoId, datos.metas ?? {});
        await repos.formularioRepo.reemplazarConocimientos(candidatoId, conocimientos);
        // Estas 3 preguntas viven en la misma fila que llena "Experiencia
        // laboral" (candidato_experiencia_resumen), porque la plantilla las
        // imprime junto a la autoevaluación, no junto a la experiencia. El
        // guardado es parcial (ver comentario en el repositorio): no toca los
        // otros 6 campos que ya dejó guardados el paso "experiencia".
        await repos.formularioRepo.guardarExperienciaResumen(candidatoId, {
          experienciaComercialCertificada: datos.experienciaComercialCertificada,
          experienciaComercialNoCertificada: datos.experienciaComercialNoCertificada,
          primerEmpleoFormal: datos.primerEmpleoFormal,
        });
      });
    },

    /**
     * Paso final. Cierra el formulario, avanza el estado, avisa al reclutador y
     * envía los documentos a firmar.
     */
    async guardarConsentimiento(token, datos) {
      const info = await exigirTokenVigente(token);
      const candidatoId = info.candidato_id;

      const completados = await formularioRepo.pasosCompletados(candidatoId);
      const faltantes = ['hoja_vida', 'datos_basicos', 'estudios', 'experiencia', 'personal']
        .filter((p) => !completados.includes(p));
      if (faltantes.length > 0) {
        throw HttpError.peticionInvalida('Debes completar los pasos anteriores', {
          codigo: 'PASOS_INCOMPLETOS',
          detalles: { faltantes },
        });
      }

      const ciudadId = await idOpcional('ciudades', datos.ciudad);
      const candidato = await candidatoRepo.buscarPorId(candidatoId);

      // Consentimiento, cierre del token, avance de estado: un solo hecho.
      await uow.ejecutar(async (repos) => {
        await repos.formularioRepo.guardarConsentimiento(candidatoId, {
          ciudadId,
          fecha: datos.fecha,
        });
        await repos.formularioRepo.marcarPaso(candidatoId, 'consentimiento');
        await repos.formularioRepo.marcarTokenUsado(info.id);
        await estadoServicio.avanzarSiSePuede({
          repo: repos.candidatoRepo,
          candidato,
          codigoDestino: 'formularios_completados',
          usuarioId: null,
          motivo: 'El candidato completó el formulario',
        });
      });

      // Lo que sigue son efectos externos: si fallan, el formulario YA quedó
      // guardado. Se reportan en la respuesta en vez de tumbar la petición.
      const resultado = {
        completado: true,
        notificacion: await notificarReclutador(candidato),
        firma: await enviarAFirmar(candidatoId, candidato),
      };
      return resultado;
    },

    /** Estado de la firma en el proveedor. */
    async estadoFirma(candidatoId, usuario) {
      await candidatoServicio.obtenerAccesible(candidatoId, usuario);
      const registro = await formularioRepo.buscarFirma(candidatoId);
      if (!registro) {
        throw HttpError.noEncontrado('Este candidato no tiene documentos enviados a firma');
      }
      const remoto = await firma.consultarEstado(registro.referencia_externa);
      return { ...registro, proveedor: remoto };
    },

    /** Descarga por proxy: Hydra no guarda copia de los documentos firmados. */
    async descargarDocumentoFirmado(candidatoId, tipo, usuario) {
      await candidatoServicio.obtenerAccesible(candidatoId, usuario);
      const registro = await formularioRepo.buscarFirma(candidatoId);
      if (!registro) {
        throw HttpError.noEncontrado('Este candidato no tiene documentos enviados a firma');
      }
      return firma.descargar(registro.referencia_externa, tipo);
    },

    /** Expuesto para pruebas y para reintentar un envío a firma que falló. */
    async reenviarAFirmar(candidatoId, usuario) {
      const candidato = await candidatoServicio.obtenerAccesible(candidatoId, usuario);
      return enviarAFirmar(candidatoId, candidato);
    },

    /**
     * Segunda firma (Selección/Administrador) sobre la hoja de vida ya firmada
     * por el candidato. `firmadoPor` sale del usuario autenticado de esta misma
     * sesión, nunca de lo que mande el cliente — mismo criterio que el total de
     * la evaluación de entrevista (`seleccion.service.js`), que tampoco se
     * confía al cliente.
     */
    async firmarHojaVida(candidatoId, { signatureDataUrl, signatureMode }, usuario) {
      await candidatoServicio.obtenerAccesible(candidatoId, usuario);
      const registro = await formularioRepo.buscarFirma(candidatoId);
      if (!registro) {
        throw HttpError.noEncontrado('Este candidato no tiene documentos enviados a firma');
      }
      return firma.firmarPsicologo({
        referencia: registro.referencia_externa,
        signatureDataUrl,
        signatureMode,
        firmadoPor: usuario.nombreCompleto,
      });
    },

    /**
     * Lo que el candidato llenó en sus 6 pasos, para el perfil del reclutador.
     * Reusa la misma consulta que arma el PDF (`obtenerCompleto`): ya trae
     * estudios[]/experiencia[] normalizados (todos los niveles, todos los
     * empleos), no la versión aplanada de un solo nivel/empleo que mostraba
     * la interfaz anterior.
     */
    async completo(candidatoId, usuario) {
      await candidatoServicio.obtenerAccesible(candidatoId, usuario);
      const datos = await formularioRepo.obtenerCompleto(candidatoId);
      if (!datos) throw HttpError.noEncontrado('Candidato no encontrado');
      return datos;
    },
  };

  // ------------------------------------------------------- efectos externos --

  async function notificarReclutador(candidato) {
    // `reclutador_email` viene del LEFT JOIN a usuarios en el repositorio.
    const destino = candidato?.reclutador_email ?? null;
    if (!destino) return { enviado: false, motivo: 'sin_destinatario' };

    const mensaje = plantillas.notificacionCompletado({ candidato });
    try {
      await email.enviar({ para: destino, ...mensaje });
      await formularioRepo.registrarEnvioEmail({
        candidatoId: candidato.id,
        destinatario: destino,
        tipo: 'notificacion_completado',
        estado: 'enviado',
      });
      return { enviado: true };
    } catch (error) {
      logger.warn({ err: error, candidatoId: candidato.id }, 'No se pudo notificar al reclutador');
      await formularioRepo.registrarEnvioEmail({
        candidatoId: candidato.id,
        destinatario: destino,
        tipo: 'notificacion_completado',
        estado: 'fallido',
        error: error.message,
      });
      return { enviado: false, motivo: error.message };
    }
  }

  async function enviarAFirmar(candidatoId, candidato) {
    try {
      const { cvPdf, tratamientoPdf } = await documentosServicio.generarParaCandidato(candidatoId);

      const { referencia, estado, firmarUrl } = await firma.enviar({
        nombreCandidato: nombreCompleto(candidato),
        emailCandidato: candidato.email ?? '',
        referenciaInterna: candidatoId,
        cvPdf,
        tratamientoPdf,
      });

      await formularioRepo.registrarFirma({
        candidatoId,
        proveedor: firma.nombre.startsWith('firmacloud') ? 'firmacloud' : firma.nombre,
        referenciaExterna: referencia,
        estado,
      });

      // `firmarUrl`: el candidato se redirige a firmar en la misma sesión, sin
      // depender de que revise su correo (interfaz anterior). El correo se
      // sigue enviando igual, como respaldo si cierra la pestaña antes.
      return {
        enviado: true, referencia, firmarUrl,
        bytesCv: cvPdf.length, bytesTratamiento: tratamientoPdf.length,
      };
    } catch (error) {
      // Nunca revierte el consentimiento: el candidato ya cumplió su parte.
      logger.error({ err: error, candidatoId }, 'Falló el envío a firma electrónica');
      return { enviado: false, motivo: error.message };
    }
  }
}

module.exports = { crearFormularioServicio, DIAS_VIGENCIA_TOKEN };
