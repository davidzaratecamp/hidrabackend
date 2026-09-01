'use strict';

/**
 * Logger de la aplicación.
 *
 * Reemplaza los 82 `console.log` repartidos por los controllers viejos, que no
 * tenían niveles, no permitían correlacionar las líneas de una misma petición y
 * en algunos casos imprimían datos personales del candidato.
 *
 * `redact` es la protección de fondo: aunque alguien loguee un objeto completo
 * con la contraseña o el token dentro, no llega al archivo de log.
 */

const pino = require('pino');
const config = require('./env');

/**
 * `pino-pretty` es una dependencia de desarrollo: en un servidor instalado con
 * `npm ci --omit=dev` no existe. Si NODE_ENV no fuera 'production' allí, pedirlo
 * tumbaría el arranque por una cuestión de formato de logs. Se comprueba que
 * esté disponible en vez de asumirlo.
 */
function transporteLegible() {
  if (config.esProduccion) return undefined;
  try {
    require.resolve('pino-pretty');
    return { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } };
  } catch {
    return undefined; // Sin pino-pretty: JSON plano, que siempre funciona.
  }
}

const logger = pino({
  level: config.log.nivel,
  base: undefined, // sin pid/hostname: ruido en local, y el orquestador ya los añade
  redact: {
    paths: [
      'password',
      'passwordActual',
      'passwordNueva',
      'password_hash',
      'token',
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.password_hash',
      '*.token',
    ],
    censor: '[oculto]',
  },
  transport: transporteLegible(),
});

module.exports = logger;
