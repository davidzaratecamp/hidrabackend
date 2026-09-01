'use strict';

/**
 * Acceso a la base de datos.
 *
 * Diferencias con el sistema viejo:
 *   - El pool NO es una variable global (`global.db`). Se exporta y se inyecta,
 *     que es lo que permite sustituirlo en pruebas.
 *   - Es `mysql2/promise`: se acabaron los callbacks anidados.
 *   - `verificarConexion()` hace un ping real al arrancar. Antes se imprimía
 *     "Pool configurado correctamente" sin haber tocado la base, así que un
 *     DB_HOST equivocado no se notaba hasta la primera petición.
 *   - `conTransaccion()` da atomicidad a los flujos multi-tabla. El sistema
 *     viejo no usaba transacciones en ningún punto.
 */

const mysql = require('mysql2/promise');
const config = require('./env');
const logger = require('./logger');

/**
 * Crea un pool con las mismas garantías para cualquier base.
 *
 * Existe como función —y no como una única constante— porque hay una segunda
 * base: la histórica (`noviembrehidra`), que se consulta en solo lectura desde
 * `dbHistorico.js`. Las dos deben compartir la conversión de tipos y el rechazo
 * de sentencias múltiples; duplicar estas opciones sería la forma más fácil de
 * que una de las dos se quedara sin ellas.
 */
function crearPool(opciones) {
  return mysql.createPool({
    ...opciones,
    waitForConnections: true,
    queueLimit: 0,
    charset: 'utf8mb4',
    // Devuelve las fechas como string en vez de Date de JS. Evita el
    // corrimiento de zona horaria que el sistema viejo tenía que compensar a mano
    // al formatear fechas para el Excel.
    //
    // TIMESTAMP entra en la lista (2026-08-30): sin él, todo `created_at` volvía
    // como Date, se serializaba a JSON en UTC y la interfaz mostraba la hora
    // corrida cinco horas —"31/08 04:09" para algo ocurrido el 30/08 a las
    // 23:09—. Se notó al pasar la agenda de Selección a ordenar por `created_at`,
    // pero afectaba por igual a cualquier fecha de auditoría que se mostrara.
    dateStrings: ['DATE', 'DATETIME', 'TIMESTAMP'],
    timezone: 'local',
    // El driver rechaza múltiples sentencias en una sola llamada: cierra la vía
    // de escalada de una inyección SQL a ejecución encadenada.
    multipleStatements: false,
    enableKeepAlive: true,
    typeCast: convertirTipos,
  });
}

const pool = crearPool(config.db);

/**
 * MySQL no tiene tipo booleano: `BOOLEAN` es un alias de `TINYINT(1)`, y el
 * driver lo devuelve como 1/0. Sin esto, cada consumidor —el frontend incluido—
 * tendría que acordarse de que `aprobado` es un número que a veces se compara
 * con `true` y a veces con `1`.
 *
 * La conversión se hace aquí, en el único punto por el que pasan todas las
 * filas, en vez de repetirla en cada repositorio.
 *
 * La longitud declarada distingue los dos usos sin ambigüedad:
 *   BOOLEAN            -> TINYINT(1), length 1   (activo, aprobado, es_terminal…)
 *   TINYINT numérico   -> length 3               (edad, autoevaluacion, orden, nivel)
 * Comprobado contra el esquema real antes de activarlo.
 */
function convertirTipos(field, siguiente) {
  if (field.type === 'TINY' && field.length === 1) {
    const valor = field.string();
    return valor === null ? null : valor === '1';
  }
  return siguiente();
}

async function verificarConexion() {
  const conexion = await pool.getConnection();
  try {
    await conexion.ping();
    logger.info(
      { host: config.db.host, base: config.db.database },
      'Conexión a MySQL verificada'
    );
  } finally {
    conexion.release();
  }
}

/**
 * Ejecuta `trabajo` dentro de una transacción, con commit o rollback automático.
 *
 * El callback recibe una conexión con la misma interfaz que el pool, así que un
 * repositorio puede recibir `pool` o la conexión transaccional indistintamente
 * y comportarse igual (sustituibilidad, principio de Liskov).
 *
 * @template T
 * @param {(conexion: import('mysql2/promise').PoolConnection) => Promise<T>} trabajo
 * @returns {Promise<T>}
 */
async function conTransaccion(trabajo) {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const resultado = await trabajo(conexion);
    await conexion.commit();
    return resultado;
  } catch (error) {
    await conexion.rollback().catch((errorRollback) => {
      logger.error({ err: errorRollback }, 'Falló el rollback de la transacción');
    });
    throw error;
  } finally {
    conexion.release();
  }
}

async function cerrarPool() {
  await pool.end();
  logger.info('Pool de MySQL cerrado');
}

module.exports = { pool, crearPool, verificarConexion, conTransaccion, cerrarPool };
