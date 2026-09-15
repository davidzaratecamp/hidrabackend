'use strict';

const { z } = require('zod');

const id = z.coerce.number().int().positive();
const codigo = z.string().trim().min(1).max(120);

const parametrosId = z.object({ id });

const base = {
  nombreCompleto: z.string().trim().min(3).max(255),
  tipoDocumento: codigo,
  // Obligatorio en el registro (decisión de negocio, 2026-09-15): todos los
  // campos del formulario "Nuevo Candidato" pasan a ser requeridos. Sigue
  // opcional en `actualizar` (ver más abajo), para no romper la edición
  // parcial de un candidato ya existente.
  numeroDocumento: z.string().trim().regex(/^\d{5,20}$/, 'Documento inválido'),
  edad: z.coerce.number().int().min(14).max(99),
  email: z.string().trim().toLowerCase().email().max(255),
  celular: z.string().trim().regex(/^[\d+\s()-]{7,20}$/, 'Celular inválido'),
  contactoLlamada: z.boolean(),
  contactoWhatsapp: z.boolean(),
  cliente: codigo,
  cargo: codigo,
  ciudad: codigo.optional(),
  // Obligatorio en el registro, igual que el resto — ver nota de arriba.
  fuenteReclutamiento: codigo,
  tipificacionLlamada: codigo.optional(),
  // Solo aplica cuando Citado = No (ver el `superRefine` de `crear`, abajo):
  // con Citado = Sí el propio formulario lo vacía, no tiene sentido pedirlo.
  estadoGestion: codigo.optional(),
  observacionesGenerales: z.string().trim().max(5000).optional(),
  // Columna PERFIL del Excel oficial. Texto libre: no es un catálogo, la
  // reclutadora describe el perfil con sus palabras.
  perfil: z.string().trim().min(1, 'Requerido').max(255),
  // Columna CITADO. Es la gestión de la reclutadora, no la citación real de
  // Selección (que vive en `candidato_citaciones`).
  citado: z.boolean(),
};

const crear = z.object(base).superRefine((datos, ctx) => {
  // Único campo condicional del formulario: el propio formulario solo lo
  // muestra (y solo lo pide) cuando Citado = No.
  if (datos.citado === false && !datos.estadoGestion) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['estadoGestion'],
      message: 'Requerido cuando Citado es No',
    });
  }
});

const actualizar = z
  .object({
    // La edición sigue siendo parcial: `base` volvió requeridos varios de
    // estos campos para el ALTA (`crear`), así que aquí se envuelven de
    // vuelta en `.optional()` explícito para no exigir el formulario
    // completo cada vez que se edita un candidato ya existente.
    nombreCompleto: base.nombreCompleto.optional(),
    tipoDocumento: base.tipoDocumento.optional(),
    numeroDocumento: base.numeroDocumento.optional(),
    edad: base.edad.optional(),
    email: base.email.optional(),
    celular: base.celular.optional(),
    contactoLlamada: base.contactoLlamada.optional(),
    contactoWhatsapp: base.contactoWhatsapp.optional(),
    cliente: base.cliente.optional(),
    cargo: base.cargo.optional(),
    ciudad: base.ciudad,
    fuenteReclutamiento: base.fuenteReclutamiento.optional(),
    tipificacionLlamada: base.tipificacionLlamada,
    estadoGestion: base.estadoGestion,
    observacionesGenerales: base.observacionesGenerales,
    perfil: base.perfil.optional(),
    // `citado` NO se puede editar aquí: citar crea una citación y mueve el
    // estado (ver `seleccion/citar.js`). Si se pudiera cambiar la marca a secas,
    // volveríamos a tener la marca diciendo una cosa y el estado otra. Para
    // citar después del registro está el módulo de Selección.
  })
  .refine((d) => Object.keys(d).length > 0, 'No enviaste ningún cambio');

const cambiarEstado = z.object({
  estado: codigo,
  motivo: z.string().trim().min(3).max(1000).optional(),
});

const reasignar = z.object({
  reclutadorId: id,
  motivo: z.string().trim().min(3).max(255).optional(),
});

const reasignarCartera = z.object({
  origenId: id,
  destinoId: id,
  motivo: z.string().trim().min(3).max(255).optional(),
});

const listar = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
  busqueda: z.string().trim().min(1).max(120).optional(),
  estado: codigo.optional(),
  cliente: codigo.optional(),
  // Filtro dedicado para el cargo Agente (el único que evalúa entrevista, ver
  // seleccion.service.js): por texto, no por catálogo cerrado, para cubrir
  // 'Agente', 'Agente Plus', 'Agente Call Center' y cualquier variante futura.
  agentes: z.coerce.boolean().optional(),
  // Contraparte de "agentes": todo cargo que NO sea Agente ("Candidatos
  // Staff" del menú lateral, decisión de negocio 2026-09-02).
  staff: z.coerce.boolean().optional(),
  ordenarPor: z.enum(['created_at', 'updated_at', 'primer_apellido']).default('created_at'),
  direccion: z.enum(['asc', 'desc']).default('desc'),
});

module.exports = {
  parametrosId, crear, actualizar, cambiarEstado, reasignar, reasignarCartera, listar,
};
