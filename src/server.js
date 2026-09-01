'use strict';

/**
 * Punto de entrada: verifica dependencias, abre el puerto y apaga ordenadamente.
 *
 * El `index.js` viejo hacía todo en 52 líneas —CORS, pool, routers, listen— y
 * anunciaba "Pool de MySQL configurado correctamente" sin haber tocado la base.
 * Aquí no se acepta tráfico hasta que la conexión está comprobada.
 */

const config = require('./config/env');
const logger = require('./config/logger');
const { verificarConexion, cerrarPool } = require('./config/db');
const { verificarConexionHistorico, cerrarPoolHistorico } = require('./config/dbHistorico');
const { construirContenedor } = require('./container');
const { construirApp } = require('./app');

async function iniciar() {
  await verificarConexion();
  // No detiene el arranque si falla: la base histórica es opcional y su caída
  // solo desactiva la consulta de candidatos antiguos (queda en el log).
  await verificarConexionHistorico();

  const contenedor = construirContenedor();
  const app = construirApp(contenedor);

  const servidor = app.listen(config.servidor.puerto, () => {
    logger.info(
      { puerto: config.servidor.puerto, entorno: config.entorno },
      'Servidor escuchando'
    );
  });

  configurarApagado(servidor);
  return servidor;
}

/**
 * Apagado ordenado: deja de aceptar conexiones, espera a que terminen las
 * peticiones en curso y cierra el pool. Sin esto, un redespliegue corta
 * peticiones a mitad y puede dejar transacciones abiertas.
 */
function configurarApagado(servidor) {
  let apagando = false;

  const apagar = async (senal) => {
    if (apagando) return;
    apagando = true;
    logger.info({ senal }, 'Apagando servidor');

    const forzar = setTimeout(() => {
      logger.error('El apagado ordenado excedió 10s; se fuerza la salida');
      process.exit(1);
    }, 10_000).unref();

    servidor.close(async () => {
      try {
        await Promise.all([cerrarPool(), cerrarPoolHistorico()]);
        clearTimeout(forzar);
        process.exit(0);
      } catch (error) {
        logger.error({ err: error }, 'Error al cerrar el pool');
        process.exit(1);
      }
    });
  };

  process.on('SIGTERM', () => apagar('SIGTERM'));
  process.on('SIGINT', () => apagar('SIGINT'));

  // Un proceso con estado corrupto no debe seguir atendiendo peticiones.
  process.on('unhandledRejection', (razon) => {
    logger.fatal({ err: razon }, 'Promesa rechazada sin manejar');
    apagar('unhandledRejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Excepción no capturada');
    apagar('uncaughtException');
  });
}

if (require.main === module) {
  iniciar().catch((error) => {
    logger.fatal({ err: error }, 'No se pudo iniciar el servidor');
    process.exit(1);
  });
}

module.exports = { iniciar };
