'use strict';

/**
 * Documentos de contratación (migración 021): lo que Hydra necesita saber y
 * mandar de cada candidato además de sus datos.
 *
 *   - Si ya firmó la hoja de vida y el tratamiento de datos: se le pregunta a
 *     FirmaCloud y un "signed" se guarda en `candidato_firmas`, para no volver
 *     a preguntar.
 *   - Qué antecedentes tiene cargados y cuáles le faltan.
 *   - El contenido de cada documento al despacharlo hacia Gestor.
 *
 * Las reglas (qué es elegible, qué se envía) están en `contratacion.reglas.js`;
 * aquí solo va lo que toca red, disco o base de datos.
 */

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { borrarArchivos } = require('../../shared/middleware/subirArchivo');
const { FIRMA_COMPLETA, FIRMA_SIN_CONSULTA, debeConsultarFirma } = require('./contratacion.reglas');

// Consultas simultáneas a FirmaCloud al listar: suficiente para una cola de
// decenas de candidatos sin saturar al proveedor.
const CONSULTAS_SIMULTANEAS = 4;
const CARPETA_FIRMADOS = 'firmados';

async function enGrupos(elementos, tamano, fn) {
  for (let i = 0; i < elementos.length; i += tamano) {
    await Promise.all(elementos.slice(i, i + tamano).map(fn));
  }
}

function crearDocumentosContratacion({ contratacionRepo, firma, config, logger }) {
  const directorio = path.resolve(config.archivos.directorio);

  function rutaAbsoluta(rutaRelativa) {
    const ruta = path.resolve(directorio, rutaRelativa);
    // La ruta sale de la base, pero se confirma que no escapa de uploads/.
    return ruta.startsWith(directorio + path.sep) ? ruta : null;
  }

  async function consultarFirma(fila) {
    try {
      const remoto = await firma.consultarEstado(fila.firma_referencia);
      fila.firma_estado = remoto?.status ?? fila.firma_estado;
      if (fila.firma_estado === FIRMA_COMPLETA) {
        await contratacionRepo.marcarFirmaCompleta(fila.firma_id, FIRMA_COMPLETA);
      }
    } catch (error) {
      logger.warn({ err: error, candidatoId: fila.id }, 'No se pudo consultar la firma en FirmaCloud');
      fila.firma_estado = FIRMA_SIN_CONSULTA;
    }
  }

  /**
   * Completa cada fila (con la forma de `SELECT_DATOS`/`SELECT_FORMACION`) con
   * el estado real de la firma y sus `antecedentes`. Modifica las filas.
   */
  async function completar(filas) {
    await enGrupos(filas.filter(debeConsultarFirma), CONSULTAS_SIMULTANEAS, consultarFirma);

    const antecedentes = await contratacionRepo.antecedentesDe(filas.map((f) => f.id));
    for (const fila of filas) {
      fila.antecedentes = antecedentes.filter((a) => a.candidato_id === fila.id);
    }
    return filas;
  }

  /**
   * Copia local del documento firmado. La primera vez se descarga de
   * FirmaCloud y se guarda, para que los reintentos manden los mismos bytes.
   */
  async function copiaFirmada(repo, envio) {
    const existente = await repo.documentoDeTipo(envio.candidato_id, envio.payload.tipo);
    if (existente) return existente;

    const firmaVigente = await repo.datosParaEnvio(envio.candidato_id);
    if (!firmaVigente?.firma_referencia) {
      throw Object.assign(new Error('El candidato ya no tiene documentos enviados a firma'), { permanente: true });
    }
    const { contenido } = await firma.descargar(firmaVigente.firma_referencia, envio.payload.firma);
    if (!Buffer.isBuffer(contenido) || contenido.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new Error('FirmaCloud no devolvió un PDF');
    }

    const nombre = `${envio.candidato_id}-${envio.payload.tipo}-${randomUUID()}.pdf`;
    const rutaRelativa = path.join(CARPETA_FIRMADOS, nombre);
    await fs.promises.mkdir(path.join(directorio, CARPETA_FIRMADOS), { recursive: true });
    await fs.promises.writeFile(path.join(directorio, rutaRelativa), contenido);
    try {
      const id = await repo.registrarDocumento({
        candidatoId: envio.candidato_id,
        tipoCodigo: envio.payload.tipo,
        rutaArchivo: rutaRelativa,
        nombreOriginal: `${envio.payload.tipo.replaceAll('_', '-')}.pdf`,
        mimeType: 'application/pdf',
        tamanoBytes: contenido.length,
      });
      if (!id) throw new Error(`Falta el tipo de documento ${envio.payload.tipo} (migración 021)`);
      return repo.buscarDocumento(id);
    } catch (error) {
      await borrarArchivos([path.join(directorio, rutaRelativa)]);
      throw error;
    }
  }

  /**
   * Cuerpo HTTP de un envío `documento`: el archivo en base64 con su hash, para
   * que Gestor confirme que llegó entero. Si el documento ya no se puede
   * conseguir devuelve `{ error, permanente }` en vez del cuerpo:
   *   - permanente: el archivo se borró de Hydra (p. ej. reemplazaron el
   *     soporte); reintentar no sirve, hay que "reenviar" al candidato.
   *   - no permanente: FirmaCloud no respondió; el despachador reintenta.
   */
  async function cuerpoDocumento(repo, envio) {
    let documento;
    try {
      if (envio.payload.origen === 'firma') {
        documento = envio.payload.documento_id
          ? await repo.buscarDocumento(envio.payload.documento_id)
          : await copiaFirmada(repo, envio);
        if (documento && envio.payload.documento_id !== documento.id) {
          await repo.actualizarPayloadEnvio(envio.id, { ...envio.payload, documento_id: documento.id });
        }
      } else {
        documento = await repo.buscarDocumento(envio.payload.documento_id);
      }
    } catch (error) {
      logger.warn({ err: error, envioId: envio.id }, 'No se pudo preparar el documento para Gestor');
      return { error: `No se pudo obtener el documento: ${error.message}`, permanente: Boolean(error.permanente) };
    }

    const ruta = documento && rutaAbsoluta(documento.ruta_archivo);
    let contenido = null;
    if (ruta) contenido = await fs.promises.readFile(ruta).catch(() => null);
    if (!contenido) {
      return {
        error: 'El archivo ya no está en Hydra (¿se reemplazó el soporte?): reenvía al candidato',
        permanente: true,
      };
    }

    return {
      cuerpo: {
        tipo: envio.payload.tipo,
        nombre: envio.payload.nombre,
        nombre_archivo: documento.nombre_original,
        mime_type: documento.mime_type,
        sha256: createHash('sha256').update(contenido).digest('hex'),
        contenido_base64: contenido.toString('base64'),
      },
    };
  }

  return { completar, cuerpoDocumento };
}

module.exports = { crearDocumentosContratacion };
