'use strict';

/**
 * Construcción de la aplicación Express.
 *
 * Solo arma la cadena de middlewares y monta los routers que el contenedor
 * expone. No abre el puerto (eso es `server.js`) ni sabe nada de módulos
 * concretos: para agregar uno, se registra su router en `container.js` y aquí
 * no se toca nada.
 */

const express = require('express');
const pinoHttp = require('pino-http');

const {
  cabecerasSeguras,
  corsConfigurado,
  limiteGeneral,
  identificadorPeticion,
  rutaNoEncontrada,
} = require('./shared/middleware/seguridad');
const { manejarErrores } = require('./shared/middleware/manejarErrores');
const { ok } = require('./shared/utils/respuesta');

function construirApp(contenedor) {
  const app = express();

  // Detrás de nginx: necesario para que el límite de peticiones vea la IP real
  // del cliente y no la del proxy.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // --- Borde -----------------------------------------------------------------
  app.use(identificadorPeticion());
  app.use(cabecerasSeguras());
  app.use(corsConfigurado());
  app.use(limiteGeneral());

  app.use(
    pinoHttp({
      logger: contenedor.logger,
      genReqId: (req) => req.id,
      // Las peticiones correctas no merecen nivel info: solo lo anómalo.
      customLogLevel(_req, res, err) {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'debug';
      },
    })
  );

  // --- Cuerpo ----------------------------------------------------------------
  // Límite explícito: sin él, Express acepta cuerpos grandes por defecto y se
  // convierte en un vector de agotamiento de memoria.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // --- Salud -----------------------------------------------------------------
  app.get('/api/health', (_req, res) =>
    ok(res, { estado: 'ok', entorno: contenedor.config.entorno, hora: new Date().toISOString() })
  );

  // --- Módulos ---------------------------------------------------------------
  for (const [base, router] of Object.entries(contenedor.routers)) {
    app.use(base, router);
  }

  // --- Cierre ----------------------------------------------------------------
  app.use(rutaNoEncontrada());
  app.use(manejarErrores);

  return app;
}

module.exports = { construirApp };
