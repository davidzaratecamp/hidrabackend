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
const { HttpError } = require('../../shared/errors/HttpError');
const { borrarArchivos } = require('../../shared/middleware/subirArchivo');

function crearAntecedentesServicio({ antecedentesRepo, candidatoServicio, config, logger }) {
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

      const rutaAbsoluta = path.resolve(config.archivos.directorio, documento.ruta_archivo);
      // Defensa en profundidad: aunque la ruta sale de la base, se confirma que
      // no escapa del directorio de subidas.
      if (!rutaAbsoluta.startsWith(path.resolve(config.archivos.directorio))) {
        throw HttpError.noEncontrado('Documento no encontrado');
      }

      try {
        const contenido = await fs.promises.readFile(rutaAbsoluta);
        return { contenido, mimeType: documento.mime_type, documentoId };
      } catch (error) {
        logger.error({ err: error, documentoId }, 'El archivo está en la base pero no en disco');
        throw HttpError.noEncontrado('El archivo ya no está disponible');
      }
    },
  };
}

module.exports = { crearAntecedentesServicio };
