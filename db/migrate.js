#!/usr/bin/env node
'use strict';

/**
 * Aplicador de migraciones y seeds.
 *
 * Existe por dos razones:
 *
 * 1. Control de versión del esquema. Registra en `migraciones_aplicadas` qué se
 *    aplicó y con qué checksum, así que el esquema deja de depender de llevar la
 *    cuenta a mano —que es la causa raíz documentada de que el entorno local del
 *    sistema viejo divergiera de producción.
 *
 * 2. Codificación. Aplicar los `.sql` con el cliente `mysql` de la consola en
 *    Windows los lee en la página de códigos del terminal, no en UTF-8: los
 *    acentos quedan doblemente codificados ("Selección" -> "Selecci├│n") y el
 *    daño solo se ve en pantalla, mucho después. Al pasar por `mysql2` la
 *    conexión es utf8mb4 siempre, sin importar el terminal.
 *
 * Uso:
 *   node db/migrate.js              aplica las migraciones pendientes
 *   node db/migrate.js --seed       aplica migraciones y luego los seeds
 *   node db/migrate.js --reset      RECREA la base desde cero (pide confirmación)
 *   node db/migrate.js --estado     muestra qué está aplicado y qué falta
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');

require('dotenv').config();

const DIR_MIGRACIONES = path.join(__dirname, 'migrations');
const DIR_SEEDS = path.join(__dirname, 'seeds');

const config = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME,
  // Clave: la conexión fija utf8mb4 con independencia del terminal.
  charset: 'utf8mb4',
  // Los archivos de migración traen varias sentencias por archivo.
  multipleStatements: true,
};

const color = (codigo, texto) => `\x1b[${codigo}m${texto}\x1b[0m`;
const ok = (t) => color(32, t);
const aviso = (t) => color(33, t);
const malo = (t) => color(31, t);

function archivosDe(directorio) {
  if (!fs.existsSync(directorio)) return [];
  return fs
    .readdirSync(directorio)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function leer(directorio, archivo) {
  // 'utf8' explícito: sin esto Node usaría el default y volveríamos al mismo
  // problema de codificación que este runner viene a resolver.
  return fs.readFileSync(path.join(directorio, archivo), 'utf8');
}

const checksumDe = (contenido) =>
  crypto.createHash('sha256').update(contenido, 'utf8').digest('hex');

async function asegurarTablaControl(conexion) {
  await conexion.query(`
    CREATE TABLE IF NOT EXISTS migraciones_aplicadas (
      version     VARCHAR(20)  NOT NULL,
      nombre      VARCHAR(255) NOT NULL,
      checksum    CHAR(64)     NOT NULL,
      aplicada_en TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (version)
    ) ENGINE=InnoDB
  `);
}

async function aplicadas(conexion) {
  const [filas] = await conexion.query(
    'SELECT version, nombre, checksum FROM migraciones_aplicadas'
  );
  return new Map(filas.map((f) => [f.version, f]));
}

async function migrar(conexion) {
  await asegurarTablaControl(conexion);
  const yaAplicadas = await aplicadas(conexion);
  let nuevas = 0;

  for (const archivo of archivosDe(DIR_MIGRACIONES)) {
    const version = archivo.split('_')[0];
    const contenido = leer(DIR_MIGRACIONES, archivo);
    const checksum = checksumDe(contenido);
    const registro = yaAplicadas.get(version);

    if (registro) {
      // Una migración ya aplicada no debe cambiar: si cambió, los entornos
      // dejaron de ser comparables y hay que enterarse ahora, no después.
      if (registro.checksum !== checksum) {
        console.error(
          malo(`✗ ${archivo} fue modificada DESPUÉS de aplicarse.`),
          '\n  Crea una migración nueva en vez de editar una ya aplicada.'
        );
        process.exitCode = 1;
        return;
      }
      continue;
    }

    process.stdout.write(`  ${archivo} … `);
    await conexion.beginTransaction();
    try {
      await conexion.query(contenido);
      await conexion.query(
        'INSERT INTO migraciones_aplicadas (version, nombre, checksum) VALUES (?, ?, ?)',
        [version, archivo, checksum]
      );
      await conexion.commit();
      console.log(ok('aplicada'));
      nuevas += 1;
    } catch (error) {
      await conexion.rollback();
      console.log(malo('falló'));
      throw error;
    }
  }

  console.log(
    nuevas > 0 ? ok(`\n${nuevas} migración(es) aplicada(s).`) : aviso('\nSin migraciones pendientes.')
  );
}

/**
 * Los seeds no se registran: son datos de arranque, no cambios de esquema.
 * Se aplican solo sobre una base recién creada.
 */
async function sembrar(conexion) {
  console.log('\nSeeds:');
  for (const archivo of archivosDe(DIR_SEEDS)) {
    process.stdout.write(`  ${archivo} … `);
    await conexion.query(leer(DIR_SEEDS, archivo));
    console.log(ok('ok'));
  }
}

async function estado(conexion) {
  await asegurarTablaControl(conexion);
  const yaAplicadas = await aplicadas(conexion);

  console.log(`\nBase: ${config.database}\n`);
  for (const archivo of archivosDe(DIR_MIGRACIONES)) {
    const version = archivo.split('_')[0];
    const registro = yaAplicadas.get(version);
    if (!registro) {
      console.log(`  ${aviso('pendiente')}  ${archivo}`);
    } else if (registro.checksum !== checksumDe(leer(DIR_MIGRACIONES, archivo))) {
      console.log(`  ${malo('MODIFICADA')} ${archivo}`);
    } else {
      console.log(`  ${ok('aplicada')}   ${archivo}`);
    }
  }
}

async function principal() {
  const opciones = process.argv.slice(2);
  const conSeeds = opciones.includes('--seed');
  const conReset = opciones.includes('--reset');
  const soloEstado = opciones.includes('--estado');

  if (!config.database) {
    console.error(malo('Falta DB_NAME en el archivo .env'));
    process.exit(1);
  }

  if (conReset && process.env.NODE_ENV === 'production') {
    console.error(malo('--reset está bloqueado en producción.'));
    process.exit(1);
  }

  // Para poder crear la base, la primera conexión no la selecciona.
  const conexion = await mysql.createConnection({ ...config, database: undefined });

  try {
    if (conReset) {
      console.log(aviso(`Recreando la base ${config.database}…`));
      await conexion.query(`DROP DATABASE IF EXISTS \`${config.database}\``);
    }
    await conexion.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.database}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
    );
    await conexion.changeUser({ database: config.database });

    if (soloEstado) {
      await estado(conexion);
      return;
    }

    console.log(`Migraciones sobre ${config.database}:`);
    await migrar(conexion);
    if (conSeeds || conReset) await sembrar(conexion);
  } finally {
    await conexion.end();
  }
}

principal().catch((error) => {
  console.error(malo(`\n${error.message}`));
  process.exit(1);
});
