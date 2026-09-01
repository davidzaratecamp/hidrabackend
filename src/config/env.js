'use strict';

/**
 * Carga y validación de variables de entorno.
 *
 * La aplicación NO arranca si falta o es inválida una variable esencial. Esto
 * reemplaza al patrón `process.env.JWT_SECRET || 'hydra_secret_key_2024'` del
 * sistema viejo, donde un `.env` que no cargaba hacía que el servidor siguiera
 * funcionando firmando tokens con un secreto público del repositorio.
 *
 * Las variables de integraciones (correo, FirmaCloud, nómina) son opcionales a
 * propósito: cada módulo valida su propia configuración cuando se construye, así
 * que el sistema puede levantarse sin ellas y solo falla la integración que
 * falta, no el arranque completo.
 */

const path = require('node:path');
const { z } = require('zod');

require('dotenv').config();

const puerto = z.coerce.number().int().min(1).max(65535);
const booleano = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const esquema = z.object({
  // --- Aplicación ----------------------------------------------------------
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: puerto.default(3000),
  // 'silent' apaga el logger por completo; se usa en las pruebas.
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  /** Orígenes permitidos por CORS, separados por coma. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean)),

  /** Base pública del frontend. Se usa para armar los links de los correos. */
  FRONTEND_URL: z.string().url(),

  // --- Base de datos -------------------------------------------------------
  DB_HOST: z.string().min(1),
  DB_PORT: puerto.default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().min(1),
  DB_POOL_LIMIT: z.coerce.number().int().min(1).max(100).default(10),

  // --- Base histórica (solo lectura) ---------------------------------------
  // La base del sistema viejo (`noviembrehidra`), que se conserva intacta. Basta
  // con el nombre: host, puerto y credenciales se heredan de la base principal
  // salvo que se indiquen aparte (p. ej. para usar un usuario de MySQL con
  // permiso únicamente de SELECT, que es lo recomendable en producción).
  // Sin DB_HISTORICO_NAME el módulo de consulta histórica queda desactivado.
  DB_HISTORICO_NAME: z.string().optional(),
  DB_HISTORICO_HOST: z.string().optional(),
  DB_HISTORICO_PORT: puerto.optional(),
  DB_HISTORICO_USER: z.string().optional(),
  DB_HISTORICO_PASSWORD: z.string().optional(),
  DB_HISTORICO_POOL_LIMIT: z.coerce.number().int().min(1).max(100).default(5),

  // --- Autenticación -------------------------------------------------------
  // Sin valor por defecto y con longitud mínima: un secreto corto o ausente
  // detiene el arranque.
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  JWT_ISSUER: z.string().default('hidra'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  // --- Límite de peticiones ------------------------------------------------
  RATE_LIMIT_VENTANA_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().min(1).default(10),

  // --- Archivos ------------------------------------------------------------
  UPLOAD_DIR: z.string().default('uploads'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).default(10 * 1024 * 1024),

  // --- Integraciones (opcionales) ------------------------------------------
  EMAIL_HOST: z.string().optional(),
  EMAIL_PORT: puerto.optional(),
  EMAIL_SECURE: booleano.optional(),
  EMAIL_USER: z.string().optional(),
  EMAIL_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  FIRMACLOUD_API_URL: z.string().url().optional(),
  FIRMACLOUD_API_KEY: z.string().optional(),

  NOMINA_BASE_URL: z.string().url().optional(),
  API_KEY_NOMINA: z.string().optional(),
});

const resultado = esquema.safeParse(process.env);

if (!resultado.success) {
  const detalle = resultado.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // No se usa el logger: puede que la configuración de logging también falte.
  console.error(`\nConfiguración inválida. Revisa el archivo .env\n\n${detalle}\n`);
  process.exit(1);
}

const env = resultado.data;

/** Agrupa la configuración por área para que cada módulo reciba solo la suya. */
const config = Object.freeze({
  entorno: env.NODE_ENV,
  esProduccion: env.NODE_ENV === 'production',
  esPrueba: env.NODE_ENV === 'test',

  servidor: Object.freeze({
    puerto: env.PORT,
    origenesCors: Object.freeze(env.CORS_ORIGINS),
    urlFrontend: env.FRONTEND_URL,
  }),

  log: Object.freeze({ nivel: env.LOG_LEVEL }),

  db: Object.freeze({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    connectionLimit: env.DB_POOL_LIMIT,
  }),

  /**
   * Base del sistema anterior. Solo se le hacen SELECT: es un archivo de
   * consulta, no una fuente de la que el sistema nuevo dependa.
   */
  historico: Object.freeze({
    configurado: Boolean(env.DB_HISTORICO_NAME),
    host: env.DB_HISTORICO_HOST ?? env.DB_HOST,
    port: env.DB_HISTORICO_PORT ?? env.DB_PORT,
    user: env.DB_HISTORICO_USER ?? env.DB_USER,
    password: env.DB_HISTORICO_PASSWORD ?? env.DB_PASSWORD,
    database: env.DB_HISTORICO_NAME,
    connectionLimit: env.DB_HISTORICO_POOL_LIMIT,
  }),

  auth: Object.freeze({
    jwtSecret: env.JWT_SECRET,
    jwtExpiraEn: env.JWT_EXPIRES_IN,
    jwtEmisor: env.JWT_ISSUER,
    rondasBcrypt: env.BCRYPT_ROUNDS,
  }),

  limites: Object.freeze({
    ventanaMs: env.RATE_LIMIT_VENTANA_MS,
    maxPeticiones: env.RATE_LIMIT_MAX,
    maxLogin: env.RATE_LIMIT_LOGIN_MAX,
  }),

  archivos: Object.freeze({
    directorio: path.resolve(process.cwd(), env.UPLOAD_DIR),
    maxBytes: env.UPLOAD_MAX_BYTES,
  }),

  email: Object.freeze({
    configurado: Boolean(env.EMAIL_HOST && env.EMAIL_USER && env.EMAIL_PASS),
    host: env.EMAIL_HOST,
    port: env.EMAIL_PORT,
    secure: env.EMAIL_SECURE,
    usuario: env.EMAIL_USER,
    password: env.EMAIL_PASS,
    remitente: env.EMAIL_FROM,
  }),

  firmacloud: Object.freeze({
    configurado: Boolean(env.FIRMACLOUD_API_URL && env.FIRMACLOUD_API_KEY),
    url: env.FIRMACLOUD_API_URL,
    apiKey: env.FIRMACLOUD_API_KEY,
  }),

  nomina: Object.freeze({
    configurado: Boolean(env.NOMINA_BASE_URL && env.API_KEY_NOMINA),
    url: env.NOMINA_BASE_URL,
    apiKey: env.API_KEY_NOMINA,
  }),
});

module.exports = config;
