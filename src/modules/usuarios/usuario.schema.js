'use strict';

/** Esquemas de validación del módulo de usuarios. */

const { z } = require('zod');
const { LARGO_MINIMO } = require('../../shared/seguridad/password');

const id = z.coerce.number().int().positive();

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Correo electrónico inválido')
  .max(255);

const password = z
  .string()
  .min(LARGO_MINIMO, `Debe tener al menos ${LARGO_MINIMO} caracteres`)
  .max(128, 'Máximo 128 caracteres');

const nombreCompleto = z
  .string()
  .trim()
  .min(3, 'El nombre debe tener al menos 3 caracteres')
  .max(255);

const numeroDocumento = z
  .string()
  .trim()
  .regex(/^\d{5,20}$/, 'El documento debe tener entre 5 y 20 dígitos')
  .optional();

// Al menos un rol: un usuario sin roles no puede hacer nada y sería un alta inútil.
const roles = z
  .array(z.string().trim().min(1))
  .min(1, 'Debes asignar al menos un rol')
  .max(10)
  .refine((r) => new Set(r).size === r.length, 'Hay roles repetidos');

const parametrosId = z.object({ id });

const crear = z.object({
  nombreCompleto,
  email,
  password,
  numeroDocumento,
  roles,
});

const actualizar = z
  .object({
    nombreCompleto: nombreCompleto.optional(),
    email: email.optional(),
    numeroDocumento,
    activo: z.boolean().optional(),
    roles: roles.optional(),
  })
  .refine((datos) => Object.keys(datos).length > 0, 'No enviaste ningún cambio');

const listar = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
  busqueda: z.string().trim().min(1).max(120).optional(),
  rol: z.string().trim().min(1).max(50).optional(),
  activo: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  ordenarPor: z
    .enum(['nombre_completo', 'email', 'created_at', 'ultimo_acceso'])
    .default('created_at'),
  direccion: z.enum(['asc', 'desc']).default('desc'),
});

module.exports = {
  parametrosId,
  crear,
  actualizar,
  listar,
  campos: { email, password, nombreCompleto },
};
