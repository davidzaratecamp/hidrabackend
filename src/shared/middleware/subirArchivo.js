'use strict';

/**
 * Subida de archivos.
 *
 * Portado de `middleware/upload.middleware.js`, que ya estaba bien hecho: nombre
 * uuid en disco (evita path traversal y colisiones), lista blanca de tipos y
 * límite de tamaño.
 *
 * Lo que se agrega: los errores de multer se traducen a `HttpError` para que
 * salgan con el sobre JSON estándar. Sin esto, multer responde HTML y el cliente
 * recibe algo que no puede parsear — el sistema viejo lo resolvía con un wrapper
 * ad-hoc en el archivo de rutas.
 */

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const multer = require('multer');

const config = require('../../config/env');
const { HttpError } = require('../errors/HttpError');

const TIPOS_PERMITIDOS = Object.freeze({
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
});

function crearSubidor(subcarpeta) {
  const destino = path.join(config.archivos.directorio, subcarpeta);
  fs.mkdirSync(destino, { recursive: true });

  const almacenamiento = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destino),
    filename: (_req, file, cb) => {
      // La extensión sale de la lista blanca, NUNCA del nombre que envía el
      // cliente: así un "factura.pdf.exe" no puede aterrizar como ejecutable.
      cb(null, `${randomUUID()}${TIPOS_PERMITIDOS[file.mimetype]}`);
    },
  });

  const subidor = multer({
    storage: almacenamiento,
    limits: { fileSize: config.archivos.maxBytes, files: 10 },
    fileFilter: (_req, file, cb) => {
      if (TIPOS_PERMITIDOS[file.mimetype]) return cb(null, true);
      cb(
        HttpError.peticionInvalida(
          `Tipo de archivo no permitido: ${file.mimetype}. Solo PDF, JPG o PNG.`,
          { codigo: 'TIPO_ARCHIVO_INVALIDO' }
        )
      );
    },
  });

  /** Envuelve multer para que sus errores lleguen al manejador central. */
  return function campos(definicion) {
    const middleware = subidor.fields(definicion);
    return (req, res, next) =>
      middleware(req, res, (error) => {
        if (!error) return next();
        if (error instanceof multer.MulterError) {
          const mensaje =
            error.code === 'LIMIT_FILE_SIZE'
              ? `El archivo supera el límite de ${Math.round(config.archivos.maxBytes / 1024 / 1024)} MB`
              : `Error al subir el archivo: ${error.message}`;
          return next(HttpError.peticionInvalida(mensaje, { codigo: error.code, causa: error }));
        }
        return next(error);
      });
  };
}

/** Borra archivos del disco sin tumbar el flujo si alguno ya no está. */
async function borrarArchivos(rutas) {
  await Promise.all(
    rutas.filter(Boolean).map((ruta) => fs.promises.unlink(ruta).catch(() => {}))
  );
}

module.exports = { crearSubidor, borrarArchivos, TIPOS_PERMITIDOS };
