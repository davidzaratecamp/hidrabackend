'use strict';

/**
 * Verificación de antecedentes: ADRES, Policía, Comparendos y Procuraduría.
 *
 * Las cuatro se consultan MANUALMENTE fuera del sistema; aquí solo se registra
 * el resultado y se adjunta el soporte. No hay integración con terceros.
 *
 * En el esquema viejo esto eran 17 columnas repetidas en `hyd_candidatos`; ahora
 * son cuatro filas, y agregar una quinta verificación es un INSERT en el catálogo.
 */

const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { HttpError } = require('../../shared/errors/HttpError');
const { borrarArchivos } = require('../../shared/middleware/subirArchivo');
const { nombreCompleto } = require('../../shared/utils/nombreCompleto');

// Tamaño carta en puntos, con margen, para las páginas que alojan una imagen.
const PAGINA = { ancho: 612, alto: 792, margen: 36 };

function crearAntecedentesServicio({ antecedentesRepo, candidatoServicio, config, logger }) {
  async function leerArchivo(documento) {
    const rutaAbsoluta = path.resolve(config.archivos.directorio, documento.ruta_archivo);
    // Defensa en profundidad: aunque la ruta sale de la base, se confirma que
    // no escapa del directorio de subidas.
    if (!rutaAbsoluta.startsWith(path.resolve(config.archivos.directorio))) {
      throw HttpError.noEncontrado('Documento no encontrado');
    }

    try {
      return await fs.promises.readFile(rutaAbsoluta);
    } catch (error) {
      logger.error(
        { err: error, documentoId: documento.id ?? documento.documento_id },
        'El archivo está en la base pero no en disco'
      );
      throw HttpError.noEncontrado('El archivo ya no está disponible');
    }
  }

  /** Agrega al PDF unificado las páginas de un soporte (PDF) o una página con la imagen. */
  async function anexar(unificado, documento, contenido) {
    if (documento.mime_type === 'application/pdf') {
      const origen = await PDFDocument.load(contenido, { ignoreEncryption: true });
      const paginas = await unificado.copyPages(origen, origen.getPageIndices());
      paginas.forEach((p) => unificado.addPage(p));
      return;
    }

    const imagen =
      documento.mime_type === 'image/png'
        ? await unificado.embedPng(contenido)
        : await unificado.embedJpg(contenido);
    const escala = Math.min(
      1,
      (PAGINA.ancho - 2 * PAGINA.margen) / imagen.width,
      (PAGINA.alto - 2 * PAGINA.margen) / imagen.height
    );
    const { width, height } = imagen.scale(escala);
    unificado.addPage([PAGINA.ancho, PAGINA.alto]).drawImage(imagen, {
      x: (PAGINA.ancho - width) / 2,
      y: (PAGINA.alto - height) / 2,
      width,
      height,
    });
  }

  return {
    async listar(candidatoId, usuario) {
      await candidatoServicio.obtenerAccesible(candidatoId, usuario);
      return antecedentesRepo.listarDe(candidatoId);
    },

    /**
     * Registra una verificación con su soporte.
     *
     * Se puede registrar desde que el candidato existe, en cualquier estado
     * (decisión de negocio, 2026-08-31): antes exigía que ya hubiera pasado
     * la entrevista, pero reclutamiento necesita poder cargarlos desde el
     * registro del candidato.
     */
    async registrar(candidatoId, { tipo, estado, novedad }, archivo, usuario) {
      await candidatoServicio.obtenerAccesible(candidatoId, usuario);

      if (estado === 'no_aprobado' && !novedad) {
        if (archivo) await borrarArchivos([archivo.path]);
        throw HttpError.peticionInvalida('Una verificación no aprobada exige describir la novedad', {
          codigo: 'NOVEDAD_REQUERIDA',
        });
      }

      const anterior = await antecedentesRepo.documentoAnterior(candidatoId, tipo);

      let documentoId = null;
      try {
        if (archivo) {
          documentoId = await antecedentesRepo.registrarDocumento({
            candidatoId,
            tipoCodigo: `antecedente_${tipo}`,
            rutaArchivo: path.relative(config.archivos.directorio, archivo.path),
            nombreOriginal: archivo.originalname,
            mimeType: archivo.mimetype,
            tamanoBytes: archivo.size,
            subidoPorId: usuario.id,
          });
          if (!documentoId) {
            throw HttpError.peticionInvalida(`Tipo de antecedente inválido: ${tipo}`, {
              codigo: 'TIPO_INVALIDO',
            });
          }
        }

        const guardado = await antecedentesRepo.guardar({
          candidatoId,
          tipoCodigo: tipo,
          estado,
          novedad,
          documentoId,
          verificadoPorId: usuario.id,
        });

        if (!guardado) {
          throw HttpError.peticionInvalida(`Tipo de antecedente inválido: ${tipo}`, {
            codigo: 'TIPO_INVALIDO',
          });
        }
      } catch (error) {
        // Si algo falló, el archivo recién subido no debe quedar huérfano en disco.
        if (archivo) await borrarArchivos([archivo.path]);
        throw error;
      }

      // El anterior se borra SOLO después de confirmar el cambio.
      if (documentoId && anterior?.documento_id && anterior.documento_id !== documentoId) {
        await antecedentesRepo.eliminarDocumento(anterior.documento_id);
        await borrarArchivos([path.join(config.archivos.directorio, anterior.ruta_archivo)]);
        logger.debug({ candidatoId, tipo }, 'Soporte de antecedente reemplazado');
      }

      return antecedentesRepo.listarDe(candidatoId);
    },

    /**
     * Descarga por proxy. La carpeta de subidas NUNCA se sirve como estática:
     * cada descarga pasa por la comprobación de visibilidad.
     */
    async descargar(candidatoId, documentoId, usuario) {
      await candidatoServicio.obtenerAccesible(candidatoId, usuario);

      const documento = await antecedentesRepo.buscarDocumento(documentoId);
      if (!documento || documento.candidato_id !== candidatoId) {
        throw HttpError.noEncontrado('Documento no encontrado');
      }

      return { contenido: await leerArchivo(documento), mimeType: documento.mime_type, documentoId };
    },

    /**
     * Une en un solo PDF todos los soportes cargados, en el orden del catálogo.
     * Los PDF aportan sus páginas tal cual; cada imagen ocupa una página carta.
     */
    async unificar(candidatoId, usuario) {
      const candidato = await candidatoServicio.obtenerAccesible(candidatoId, usuario);
      const documentos = await antecedentesRepo.documentosDe(candidatoId);
      if (documentos.length === 0) {
        throw HttpError.noEncontrado('El candidato no tiene soportes de antecedentes cargados', {
          codigo: 'SIN_SOPORTES',
        });
      }

      const unificado = await PDFDocument.create();
      for (const documento of documentos) {
        const contenido = await leerArchivo(documento);
        try {
          await anexar(unificado, documento, contenido);
        } catch (error) {
          logger.error({ err: error, documentoId: documento.documento_id }, 'Soporte ilegible');
          throw HttpError.peticionInvalida(
            `No se pudo leer el soporte de ${documento.nombre}. Vuelve a cargarlo e intenta de nuevo.`,
            { codigo: 'SOPORTE_ILEGIBLE' }
          );
        }
      }

      return {
        contenido: Buffer.from(await unificado.save()),
        nombreCandidato: nombreCompleto(candidato),
      };
    },
  };
}

module.exports = { crearAntecedentesServicio };
