'use strict';

/**
 * Subida de un único archivo .xlsx a memoria (no a disco).
 *
 * Distinto de `subirArchivo.js`: ese es para documentos que se conservan
 * (antecedentes, hojas de vida firmadas), por eso escribe a disco con nombre
 * uuid. Un Excel de importación es transitorio — se lee una vez, se descarta
 * el buffer, y no queda rastro en el filesystem — así que memoria alcanza y
 * evita crear/limpiar archivos que nadie vuelve a necesitar.
 *
 * Mismo criterio que `subirArchivo.js` para traducir errores de multer a
 * `HttpError`, para que el frontend reciba el sobre JSON de siempre en vez de
 * la respuesta HTML por defecto de multer.
 */

const multer = require('multer');
const { HttpError } = require('../errors/HttpError');

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_BYTES = 100 * 1024 * 1024;

const subidor = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === MIME_XLSX) return cb(null, true);
    cb(
      HttpError.peticionInvalida(`Tipo de archivo no permitido: ${file.mimetype}. Solo .xlsx.`, {
        codigo: 'TIPO_ARCHIVO_INVALIDO',
      })
    );
  },
});

/** Middleware para un único campo de archivo `archivo`. */
function archivoExcel(req, res, next) {
  subidor.single('archivo')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const mensaje =
        error.code === 'LIMIT_FILE_SIZE'
          ? `El archivo supera el límite de ${Math.round(MAX_BYTES / 1024 / 1024)} MB`
          : `Error al subir el archivo: ${error.message}`;
      return next(HttpError.peticionInvalida(mensaje, { codigo: error.code, causa: error }));
    }
    return next(error);
  });
}

module.exports = { archivoExcel };
