'use strict';

/**
 * Validación de la consulta al archivo histórico.
 *
 * Todo es opcional salvo la paginación, que trae valores por defecto: la vista
 * abre mostrando la primera página del archivo completo, del más reciente al más
 * antiguo, sin obligar a filtrar nada.
 */

const { z } = require('zod');
const { ORDEN_PERMITIDO } = require('./historico.repository');

const texto = (max) => z.string().trim().min(1).max(max);
const fecha = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD');

const parametrosId = z.object({ id: z.coerce.number().int().positive() });

const listar = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1),
    // Tope de 200: el archivo tiene miles de filas y una página sin límite
    // sensato es una descarga completa disfrazada de consulta.
    porPagina: z.coerce.number().int().min(1).max(200).default(25),

    /** Busca en nombre completo, documento, correo y celular. */
    q: texto(100).optional(),

    estado: texto(60).optional(),
    cliente: texto(100).optional(),
    cargo: texto(100).optional(),
    ciudad: texto(100).optional(),
    reclutadorId: z.coerce.number().int().positive().optional(),
    /** Igualdad exacta (no LIKE): alerta de duplicado en Nuevo candidato. */
    numeroDocumento: texto(20).optional(),

    /** Rango sobre la fecha de registro, ambos inclusive. */
    desde: fecha.optional(),
    hasta: fecha.optional(),

    ordenarPor: z.enum(ORDEN_PERMITIDO).default('created_at'),
    direccion: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((d) => !(d.desde && d.hasta) || d.desde <= d.hasta, {
    message: 'La fecha inicial no puede ser posterior a la final',
    path: ['desde'],
  });

/**
 * Rango opcional para el Excel "BASE RECLUTAMIENTO" del archivo histórico.
 * Sin fechas, `candidatosBaseReclutamiento` trae los últimos 100 registrados.
 */
const baseReclutamiento = z
  .object({ desde: fecha.optional(), hasta: fecha.optional() })
  .refine((d) => !(d.desde && d.hasta) || d.desde <= d.hasta, {
    message: 'La fecha inicial no puede ser posterior a la final',
    path: ['desde'],
  });

module.exports = { listar, parametrosId, baseReclutamiento };
