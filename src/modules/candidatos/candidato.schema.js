'use strict';

const { z } = require('zod');

const id = z.coerce.number().int().positive();
const codigo = z.string().trim().min(1).max(120);

const parametrosId = z.object({ id });

const base = {
  nombreCompleto: z.string().trim().min(3).max(255),
  tipoDocumento: codigo,
  numeroDocumento: z.string().trim().regex(/^\d{5,20}$/, 'Documento inválido').optional(),
  edad: z.coerce.number().int().min(14).max(99).optional(),
  // Nullable a propósito: cuando no hay correo se guarda NULL, en vez del
  // `temp_${Date.now()}@...` que inventaba el sistema viejo.
  email: z.string().trim().toLowerCase().email().max(255).optional(),
  celular: z.string().trim().regex(/^[\d+\s()-]{7,20}$/, 'Celular inválido'),
  contactoLlamada: z.boolean().optional(),
  contactoWhatsapp: z.boolean().optional(),
  cliente: codigo,
  cargo: codigo,
  ciudad: codigo.optional(),
  fuenteReclutamiento: codigo.optional(),
  tipificacionLlamada: codigo.optional(),
  estadoGestion: codigo.optional(),
  observacionesGenerales: z.string().trim().max(5000).optional(),
  // Columna PERFIL del Excel oficial. Texto libre: no es un catálogo, la
  // reclutadora describe el perfil con sus palabras.
  perfil: z.string().trim().max(255).optional(),
  // Columna CITADO. Es la gestión de la reclutadora, no la citación real de
  // Selección (que vive en `candidato_citaciones`).
  citado: z.boolean().optional(),
};

const crear = z.object(base);

const actualizar = z
  .object({
    nombreCompleto: base.nombreCompleto.optional(),
    tipoDocumento: base.tipoDocumento.optional(),
    numeroDocumento: base.numeroDocumento,
    edad: base.edad,
    email: base.email,
    celular: base.celular.optional(),
    contactoLlamada: base.contactoLlamada,
    contactoWhatsapp: base.contactoWhatsapp,
    cliente: base.cliente.optional(),
    cargo: base.cargo.optional(),
    ciudad: base.ciudad,
    fuenteReclutamiento: base.fuenteReclutamiento,
    tipificacionLlamada: base.tipificacionLlamada,
    estadoGestion: base.estadoGestion,
    observacionesGenerales: base.observacionesGenerales,
    perfil: base.perfil,
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
