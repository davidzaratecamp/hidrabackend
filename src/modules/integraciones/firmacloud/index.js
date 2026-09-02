'use strict';

/**
 * Firma electrónica: puerto + adaptadores.
 *
 * Contrato del puerto:
 *   enviar({ candidato, nombreCandidato, emailCandidato, cvPdf, tratamientoPdf })
 *     -> { referencia, firmarUrl }
 *   consultarEstado(referencia) -> { estado, ... }
 *   descargar(referencia, tipo)  -> { contenido: Buffer, mimeType }
 *
 * `firmarUrl` es lo que permite redirigir al candidato a firmar EN LA MISMA
 * sesión al terminar el formulario (interfaz anterior), en vez de dejarlo
 * solo con el aviso de que le llegó un correo.
 *
 * Nota de acoplamiento heredada: el proveedor ancla la firma buscando los textos
 * "FIRMA DEL CANDIDATO" y "FIRMA" dentro de los PDF. Por eso las plantillas de
 * `plantilla/` no se pueden alterar en esas líneas.
 */

const { HttpError } = require('../../../shared/errors/HttpError');

const TIPOS = Object.freeze(['cv', 'tratamiento']);

function crearFirmaCloudHttp({ config, logger }) {
  if (!config.configurado) {
    throw new Error('El adaptador de FirmaCloud requiere FIRMACLOUD_API_URL y FIRMACLOUD_API_KEY');
  }

  async function pedir(ruta, opciones = {}) {
    const respuesta = await fetch(`${config.url}${ruta}`, {
      ...opciones,
      headers: { 'X-Api-Key': config.apiKey, ...(opciones.headers ?? {}) },
    });

    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => '');
      logger.error(
        { ruta, estado: respuesta.status, detalle: detalle.slice(0, 500) },
        'FirmaCloud respondió con error'
      );
      throw HttpError.servicioExterno('El servicio de firma electrónica no está disponible', {
        codigo: 'FIRMACLOUD_ERROR',
        detalles: { estadoProveedor: respuesta.status },
      });
    }
    return respuesta;
  }

  return {
    nombre: 'firmacloud-http',

    async enviar({ nombreCandidato, emailCandidato, referenciaInterna, cvPdf, tratamientoPdf }) {
      const form = new FormData();
      form.append('cvFile', new Blob([cvPdf], { type: 'application/pdf' }), 'hoja-de-vida.pdf');
      form.append(
        'tratamientoFile',
        new Blob([tratamientoPdf], { type: 'application/pdf' }),
        'tratamiento-datos.pdf'
      );
      form.append('candidateName', nombreCandidato);
      form.append('candidateEmail', emailCandidato);
      form.append('sendChannel', 'email');
      form.append('hydraReferenceId', String(referenciaInterna));

      const respuesta = await pedir('/reclutamiento/send', { method: 'POST', body: form });
      const datos = await respuesta.json();
      return {
        referencia: datos.signatureId ?? datos.id,
        estado: datos.status ?? 'enviado',
        firmarUrl: datos.firmarUrl ?? null,
      };
    },

    async consultarEstado(referencia) {
      const respuesta = await pedir(`/reclutamiento/${encodeURIComponent(referencia)}`);
      return respuesta.json();
    },

    async descargar(referencia, tipo) {
      if (!TIPOS.includes(tipo)) {
        throw HttpError.peticionInvalida(`Tipo de documento inválido: ${tipo}`);
      }
      const respuesta = await pedir(
        `/reclutamiento/${encodeURIComponent(referencia)}/download/${tipo}`
      );
      const contenido = Buffer.from(await respuesta.arrayBuffer());
      return { contenido, mimeType: respuesta.headers.get('content-type') ?? 'application/pdf' };
    },

    /**
     * Segunda firma (Selección/Administrador) sobre la hoja de vida ya firmada
     * por el candidato — estampa sobre el campo "PSICÓLOGO" de la plantilla.
     * `firmadoPor` es el nombre del usuario de Hydra que firma, para el registro
     * de auditoría del lado de FirmaCloud (nunca viaja como identidad de auth:
     * Hydra sigue llamando con la misma API key de sistema que el resto de este
     * puerto).
     */
    async firmarPsicologo({ referencia, signatureDataUrl, signatureMode, firmadoPor }) {
      const respuesta = await pedir(`/reclutamiento/${encodeURIComponent(referencia)}/firmar-psicologo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureDataUrl, signatureMode, firmadoPor }),
      });
      return respuesta.json();
    },
  };
}

/**
 * Adaptador de memoria. Conserva los PDF recibidos, lo que permite que las
 * pruebas verifiquen que el estampado se hizo de verdad (que el PDF pesa lo
 * esperado y contiene los datos del candidato) sin llamar al proveedor real.
 */
function crearFirmaCloudMemoria({ logger } = {}) {
  const envios = [];
  let fallarProximo = null;

  return {
    nombre: 'firmacloud-memoria',
    envios,

    hacerFallarProximo(mensaje = 'Fallo simulado de FirmaCloud') {
      fallarProximo = mensaje;
    },

    async enviar({ nombreCandidato, emailCandidato, referenciaInterna, cvPdf, tratamientoPdf }) {
      if (fallarProximo) {
        const mensaje = fallarProximo;
        fallarProximo = null;
        throw HttpError.servicioExterno(mensaje, { codigo: 'FIRMACLOUD_ERROR' });
      }
      const referencia = `memoria-${referenciaInterna}-${envios.length + 1}`;
      const firmarUrl = `https://firmacloud.memoria.test/firmar/${referencia}`;
      envios.push({ referencia, nombreCandidato, emailCandidato, cvPdf, tratamientoPdf, firmarUrl });
      logger?.debug({ referencia, bytesCv: cvPdf.length }, 'Envío capturado por FirmaCloud de memoria');
      return { referencia, estado: 'enviado', firmarUrl };
    },

    async consultarEstado(referencia) {
      const envio = envios.find((e) => e.referencia === referencia);
      if (!envio) throw HttpError.noEncontrado('Firma no encontrada');
      return { referencia, estado: 'pendiente_de_firma' };
    },

    async descargar(referencia, tipo) {
      const envio = envios.find((e) => e.referencia === referencia);
      if (!envio) throw HttpError.noEncontrado('Firma no encontrada');
      return {
        contenido: tipo === 'cv' ? envio.cvPdf : envio.tratamientoPdf,
        mimeType: 'application/pdf',
      };
    },

    async firmarPsicologo({ referencia, signatureDataUrl, signatureMode, firmadoPor }) {
      const envio = envios.find((e) => e.referencia === referencia);
      if (!envio) throw HttpError.noEncontrado('Firma no encontrada');
      envio.psicologoFirmado = true;
      envio.psicologoFirmadoEn = new Date().toISOString();
      envio.psicologoFirmadoPor = firmadoPor ?? null;
      envio.psicologoSignatureMode = signatureMode;
      envio.psicologoSignatureDataUrl = signatureDataUrl;
      return { ok: true, message: 'Hoja de vida firmada' };
    },

    ultimoDe(nombreCandidato) {
      return [...envios].reverse().find((e) => e.nombreCandidato === nombreCandidato) ?? null;
    },

    limpiar() {
      envios.length = 0;
      fallarProximo = null;
    },
  };
}

module.exports = { crearFirmaCloudHttp, crearFirmaCloudMemoria, TIPOS };
