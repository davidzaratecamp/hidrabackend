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

/**
 * Obligatorio salvo `fechaNacimiento`/`genero`: la interfaz nunca llegó a
 * pedirlos (no hay campo en `pasos.jsx` para ninguno de los dos), así que
 * exigirlos dejaría el paso imposible de completar. Se quedan opcionales
 * hasta que alguien agregue el campo (decisión de negocio, 2026-09-03).
 */
const datosBasicos = z.object({
  nombreCompleto: texto(255).min(3),
  numeroDocumento: z.string().trim().regex(/^\d{5,20}$/, 'Documento inválido'),
  celular: z.string().trim().regex(/^[\d+\s()-]{7,20}$/, 'Celular inválido'),
  edad: z.coerce.number().int().min(14).max(99),
  fechaNacimiento: fecha.optional(),
  estadoCivil: codigo,
  genero: codigo.optional(),
  grupoSanguineo: codigo,
  eps: codigo,
  afp: codigo,
  tallaCamisa: codigo,
  direccionResidencial: texto(255).min(1),
  barrio: texto(100).min(1),
  nombreEmergencia: texto(100).min(1),
  numeroEmergencia: z.string().trim().regex(/^[\d+\s()-]{7,20}$/, 'Teléfono inválido'),
  parentescoEmergencia: codigo,
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
  // El primer bloque ("Información última o actual empresa", orden 1) es
  // obligatorio; el segundo ("Anterior empleo", orden 2) sigue opcional
  // (decisión de negocio, 2026-09-03). Los campos siguen `.optional()` a
  // nivel de fila porque una fila orden 2 vacía es válida — el `.refine`
  // de abajo es lo que exige el contenido mínimo de la fila 1.
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
    )
    .refine(
      (lista) =>
        lista.some((e) => e.orden === 1 && e.nombreEmpresa && e.cargoDesempenado && e.fechaInicio),
      'Debes registrar tu empleo actual o más reciente'
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

/**
 * Todo obligatorio (decisión de negocio, 2026-09-03), salvo dos que siguen
 * sin campo en la interfaz (`expectativaLaboral`, `tratamientoPsicologico*`
 * — mismo criterio que `fechaNacimiento`/`genero` en datosBasicos, ver
 * arriba): exigir un dato que no se puede escribir dejaría el paso
 * imposible de completar.
 */
const personal = z.object({
  genograma: texto(4000).min(1),
  fortalezas: texto(4000).min(1),
  aspectosMejorar: texto(4000).min(1),
  competenciasLaborales: texto(4000).min(1),
  expectativaLaboral: texto(4000).optional(),
  estadoSaludActual: texto(150).min(1),
  tratamientoPsicologicoActual: z.boolean().optional(),
  tratamientoPsicologicoDetalle: texto(4000).optional(),
  autoevaluacion: nivel1a5,
  // La plantilla las imprime en la página 2, junto a la autoevaluación —no
  // junto a la experiencia laboral—, así que se capturan y envían desde este
  // paso aunque viven en la misma fila que llena "experiencia"
  // (`candidato_experiencia_resumen`, ver `guardarExperienciaResumen`).
  experienciaComercialCertificada: z.boolean(),
  experienciaComercialNoCertificada: z.boolean(),
  primerEmpleoFormal: z.boolean(),
  metas: z.object({
    corto: texto(2000).min(1),
    mediano: texto(2000).min(1),
    largo: texto(2000).min(1),
  }),
  // No se exige calificar CADA herramienta del catálogo (validarlo obligaría
  // a conocer acá cuántas hay, acopladas a un catálogo que puede crecer):
  // basta con al menos una.
  conocimientos: z
    .array(z.object({ herramienta: codigo, nivel: nivel1a5 }))
    .min(1, 'Debes calificar al menos una herramienta')
    .max(10),
});

const consentimiento = z.object({
  // Antes un catálogo de solo 2 ciudades (Bogotá/Barranquilla, ver migración
  // 017); ahora texto libre, obligatorio igual.
  ciudad: texto(120).min(1, 'Debes indicar tu ciudad'),
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
