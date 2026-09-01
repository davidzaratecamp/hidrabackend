'use strict';

/**
 * Conexión a la base del sistema anterior (`noviembrehidra`).
 *
 * Es una base SEPARADA y CONGELADA: no se migró al esquema nuevo y no se vuelve
 * a escribir en ella. Vive aquí, en su propio pool, por tres razones:
 *
 *   1. El pool principal apunta a otra base. Consultar la vieja con un
 *      `noviembrehidra.hyd_candidatos` calificado ataría el esquema nuevo a un
 *      nombre de base concreto en cada consulta.
 *   2. El pool histórico es pequeño (5 conexiones por defecto): una consulta de
 *      archivo no debe poder agotar las conexiones que necesita la operación
 *      del día.
 *   3. Permite darle credenciales propias. En producción lo correcto es un
 *      usuario de MySQL con permiso SELECT y nada más, de modo que ni un error
 *      de programación pueda tocar el archivo. Ver DB_HISTORICO_USER.
 *
 * Si `DB_HISTORICO_NAME` no está configurado, `poolHistorico` es `null` y el
 * módulo de consulta responde 503 en vez de impedir el arranque: el archivo es
 * una función auxiliar, no un requisito para operar.
 */

const { crearPool } = require('./db');
const config = require('./env');
const logger = require('./logger');

// `configurado` es una bandera nuestra, no una opción de mysql2: se saca antes
// de crear el pool o el driver avisa de una opción desconocida en cada arranque.
const { configurado, ...opcionesHistorico } = config.historico;

const poolHistorico = configurado ? crearPool(opcionesHistorico) : null;

if (!poolHistorico) {
  logger.warn(
    'Base histórica sin configurar (DB_HISTORICO_NAME): la consulta de candidatos antiguos no estará disponible'
  );
}

/**
 * Ping real a la base histórica. No lanza: un archivo inaccesible degrada una
 * pantalla, no debe tumbar el arranque del servidor.
 *
 * @returns {Promise<boolean>} si la base respondió.
 */
async function verificarConexionHistorico() {
  if (!poolHistorico) return false;

  let conexion;
  try {
    conexion = await poolHistorico.getConnection();
    await conexion.ping();
    logger.info(
      { host: config.historico.host, base: config.historico.database },
      'Conexión a la base histórica verificada'
    );
    return true;
  } catch (error) {
    logger.error(
      { err: error, base: config.historico.database },
      'No se pudo conectar a la base histórica: la consulta de candidatos antiguos responderá 503'
    );
    return false;
  } finally {
    conexion?.release();
  }
}

async function cerrarPoolHistorico() {
  if (!poolHistorico) return;
  await poolHistorico.end();
  logger.info('Pool de la base histórica cerrado');
}

module.exports = { poolHistorico, verificarConexionHistorico, cerrarPoolHistorico };
