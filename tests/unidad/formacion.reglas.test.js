'use strict';

/**
 * Reglas puras del rol Formación: sin base de datos.
 */

const {
  enFormacion,
  motivoNoAsistencia,
  motivoNoEstado,
  debeLimpiarActivo,
} = require('../../src/modules/formacion/formacion.reglas');

const agente = {
  estado: 'aprobado_final',
  cargo: 'Agente',
  citado_formacion: true,
  contratacion: null,
  asistio_formacion: null,
  contratacion_lote_id: null,
};
const staff = { ...agente, cargo: 'Coordinador', citado_formacion: null, contratacion: true };

describe('enFormacion', () => {
  it('Agente citado y Staff con contratación, ambos aprobados finales', () => {
    expect(enFormacion(agente)).toBe(true);
    expect(enFormacion(staff)).toBe(true);
  });

  it('fuera: sin citación/contratación, o sin decisión final aprobada', () => {
    expect(enFormacion({ ...agente, citado_formacion: false })).toBe(false);
    expect(enFormacion({ ...staff, contratacion: false })).toBe(false);
    // Un Agente no entra por "contratación" (eso es de Staff).
    expect(enFormacion({ ...agente, citado_formacion: null, contratacion: true })).toBe(false);
    expect(enFormacion({ ...agente, estado: 'contratado' })).toBe(false);
  });
});

describe('motivoNoAsistencia', () => {
  it('solo a Agentes en formación y no enviados', () => {
    expect(motivoNoAsistencia(agente)).toBeNull();
    expect(motivoNoAsistencia(staff)).toMatch(/solo se marca a candidatos Agente/);
    expect(motivoNoAsistencia({ ...agente, citado_formacion: false })).toMatch(/no está en formación/);
    expect(motivoNoAsistencia({ ...agente, contratacion_lote_id: 7 })).toMatch(/ya fue enviado/);
  });
});

describe('motivoNoEstado', () => {
  it('activo a un Agente exige asistencia en Sí; baja no', () => {
    expect(motivoNoEstado(agente, 'activo')).toMatch(/asistencia/);
    expect(motivoNoEstado({ ...agente, asistio_formacion: false }, 'activo')).toMatch(/asistencia/);
    expect(motivoNoEstado({ ...agente, asistio_formacion: true }, 'activo')).toBeNull();
    expect(motivoNoEstado(agente, 'baja')).toBeNull();
  });

  it('Staff pasa a activo o baja sin asistencia', () => {
    expect(motivoNoEstado(staff, 'activo')).toBeNull();
    expect(motivoNoEstado(staff, 'baja')).toBeNull();
    expect(motivoNoEstado({ ...staff, contratacion_lote_id: 2 }, 'baja')).toMatch(/ya fue enviado/);
  });
});

describe('debeLimpiarActivo', () => {
  it('solo cuando se marca "No asistió" sobre un activo', () => {
    expect(debeLimpiarActivo(false, 'activo')).toBe(true);
    expect(debeLimpiarActivo(false, 'baja')).toBe(false);
    expect(debeLimpiarActivo(true, 'activo')).toBe(false);
    expect(debeLimpiarActivo(false, null)).toBe(false);
  });
});
