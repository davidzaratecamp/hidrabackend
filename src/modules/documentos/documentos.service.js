'use strict';

/**
 * Generación de los dos documentos oficiales del candidato.
 *
 * Los PDF nunca se persisten: se generan en memoria y se envían al proveedor de
 * firma, que es quien conserva los firmados. Aquí solo queda la referencia.
 */

const { aFormaPdf } = require('./candidatoPdf.mapper');
const { HttpError } = require('../../shared/errors/HttpError');

/**
 * Los servicios de PDF se cargan la primera vez que se generan documentos, no al
 * arrancar.
 *
 * `pdfjs-dist` intenta cargar el módulo `canvas` al importarse y, como no está
 * instalado, imprime dos avisos de "Cannot polyfill DOMMatrix / Path2D". No son
 * un problema —solo se necesita canvas para RENDERIZAR un PDF a imagen, y aquí
 * únicamente se leen los trazos vectoriales de la plantilla— pero ensuciaban
 * cada arranque del servidor.
 *
 * `canvas` está ausente a propósito: lo eliminó `npm audit fix` porque arrastraba
 * una vulnerabilidad crítica de `tar`.
 *
 * Efecto secundario útil: el arranque no paga el coste de cargar pdfjs.
 */
let generadores = null;

function cargarGeneradores() {
  generadores ??= {
    generarHojaVidaPdf: require('./pdf/hojaVidaPdfService').generarHojaVidaPdf,
    generarTratamientoDatosPdf:
      require('./pdf/tratamientoDatosPdfService').generarTratamientoDatosPdf,
  };
  return generadores;
}

function crearDocumentosServicio({ formularioRepo, logger }) {
  return {
    /**
     * Genera hoja de vida y autorización de tratamiento de datos.
     * @returns {Promise<{cvPdf: Buffer, tratamientoPdf: Buffer, datos: object}>}
     */
    async generarParaCandidato(candidatoId) {
      const completo = await formularioRepo.obtenerCompleto(candidatoId);
      if (!completo) throw HttpError.noEncontrado('Candidato no encontrado');

      const datos = aFormaPdf(completo);
      const { generarHojaVidaPdf, generarTratamientoDatosPdf } = cargarGeneradores();

      const [cvPdf, tratamientoPdf] = await Promise.all([
        generarHojaVidaPdf(datos),
        generarTratamientoDatosPdf(datos),
      ]);

      logger.debug(
        { candidatoId, bytesCv: cvPdf.length, bytesTratamiento: tratamientoPdf.length },
        'Documentos generados'
      );

      return { cvPdf: Buffer.from(cvPdf), tratamientoPdf: Buffer.from(tratamientoPdf), datos };
    },
  };
}

module.exports = { crearDocumentosServicio };
