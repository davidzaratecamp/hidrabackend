'use strict';

const { z } = require('zod');

const codigo = z.string().trim().min(1).max(120);
const texto = (max) => z.string().trim().max(max);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD');
const nivel1a5 = z.coerce.number().int().min(1).max(5);

const parametrosToken = z.object({ token: z.string().uuid('Enlace inválido') });

const hojaVida = z.object({
  aspiracionSalarial: z.coerce.number().min(0).max(99999999).optional(),
});

const datosBasicos = z.object({
  nombreCompleto: texto(255).min(3).optional(),
  numeroDocumento: z.string().trim().regex(/^\d{5,20}$/).optional(),
  celular: z.string().trim().regex(/^[\d+\s()-]{7,20}$/).optional(),
  edad: z.coerce.number().int().min(14).max(99).optional(),
  fechaNacimiento: fecha.optional(),
  estadoCivil: codigo.optional(),
  genero: codigo.optional(),
  grupoSanguineo: codigo.optional(),
  eps: codigo.optional(),
  afp: codigo.optional(),
  tallaCamisa: codigo.optional(),
  direccionResidencial: texto(255).optional(),
  barrio: texto(100).optional(),
  nombreEmergencia: texto(100).optional(),
  numeroEmergencia: z.string().trim().regex(/^[\d+\s()-]{7,20}$/).optional(),
  parentescoEmergencia: codigo.optional(),
});

const estudios = z.object({
  estudios: z
    .array(
      z.object({
        nivel: codigo,
        nombreInstitucion: texto(200).optional(),
        tituloObtenido: texto(200).optional(),
        anoFinalizacion: z.coerce.number().int().min(1950).max(2100).optional(),
        descripcion: texto(500).optional(),
      })
    )
    .min(1, 'Debes registrar al menos un nivel de estudios')
    .max(4)
    .refine(
      (lista) => new Set(lista.map((e) => e.nivel)).size === lista.length,
      'No puedes repetir un mismo nivel de estudios'
    ),
});

const experiencia = z.object({
  experiencias: z
    .array(
      z.object({
        orden: z.coerce.number().int().min(1).max(3),
        nombreEmpresa: texto(200).optional(),
        cargoDesempenado: texto(120).optional(),
        salario: z.coerce.number().min(0).optional(),
        funciones: texto(2000).optional(),
        fechaInicio: fecha.optional(),
        // Vacío significa "actualmente trabajo aquí".
        fechaRetiro: fecha.nullable().optional(),
        motivoRetiro: texto(2000).optional(),
      })
    )
    .max(3)
    .default([])
    .refine(
      (lista) => new Set(lista.map((e) => e.orden)).size === lista.length,
      'Hay experiencias con el mismo orden'
    ),
  resumen: z
    .object({
      haTrabajadoAsiste: z.boolean().optional(),
      haEstadoProcesoFormativoAsiste: z.boolean().optional(),
      experienciaComercialCertificada: z.boolean().optional(),
      experienciaComercialNoCertificada: z.boolean().optional(),
      primerEmpleoFormal: z.boolean().optional(),
      campanaAsiste: codigo.optional(),
      fechaInicioAsiste: fecha.optional(),
      fechaRetiroAsiste: fecha.optional(),
      motivoRetiroAsiste: texto(2000).optional(),
    })
    .optional(),
});

const personal = z.object({
  genograma: texto(4000).optional(),
  fortalezas: texto(4000).optional(),
  aspectosMejorar: texto(4000).optional(),
  competenciasLaborales: texto(4000).optional(),
  expectativaLaboral: texto(4000).optional(),
  estadoSaludActual: texto(150).optional(),
  tratamientoPsicologicoActual: z.boolean().optional(),
  tratamientoPsicologicoDetalle: texto(4000).optional(),
  autoevaluacion: nivel1a5.optional(),
  // La plantilla las imprime en la página 2, junto a la autoevaluación —no
  // junto a la experiencia laboral—, así que se capturan y envían desde este
  // paso aunque viven en la misma fila que llena "experiencia"
  // (`candidato_experiencia_resumen`, ver `guardarExperienciaResumen`).
  experienciaComercialCertificada: z.boolean().optional(),
  experienciaComercialNoCertificada: z.boolean().optional(),
  primerEmpleoFormal: z.boolean().optional(),
  metas: z
    .object({
      corto: texto(2000).optional(),
      mediano: texto(2000).optional(),
      largo: texto(2000).optional(),
    })
    .optional(),
  conocimientos: z
    .array(z.object({ herramienta: codigo, nivel: nivel1a5 }))
    .max(10)
    .optional(),
});

const consentimiento = z.object({
  ciudad: codigo.optional(),
  fecha,
  aceptado: z.literal(true, {
    errorMap: () => ({ message: 'Debes aceptar la autorización de tratamiento de datos' }),
  }),
});

module.exports = {
  parametrosToken,
  hojaVida,
  datosBasicos,
  estudios,
  experiencia,
  personal,
  consentimiento,
};
