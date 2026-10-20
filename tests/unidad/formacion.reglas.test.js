'use strict';

/**
 * Reglas puras de Formación y de la cola de Contratación: sin base de datos.
 */

const {
  enFormacion,
  porContratar,
  motivoNoAsistencia,
  motivoNoEstado,
  motivoNoEstadoStaff,
  debeLimpiarActivo,
} = require('../../src/modules/formacion/formacion.reglas');

const agente = {
  estado: 'aprobado_final',
  cargo: 'Agente',
  citado_formacion: true,
  contratacion: null,
  asistio_formacion: null,
  estado_formacion: null,
  contratacion_lote_id: null,
};
const staff = { ...agente, cargo: 'Coordinador', citado_formacion: null, contratacion: true };
const agenteFormado = { ...agente, asistio_formacion: true, estado_formacion: 'activo' };

describe('enFormacion (cola de Formación)', () => {
  it('solo Agentes citados a formación y aprobados finales', () => {
    expect(enFormacion(agente)).toBe(true);
    expect(enFormacion(agenteFormado)).toBe(true);
  });

  it('fuera: Staff, sin citación o sin decisión final aprobada', () => {
    // Desde la 020 el Staff no pasa por Formación: lo ve Contratación.
    expect(enFormacion(staff)).toBe(false);
    expect(enFormacion({ ...agente, citado_formacion: false })).toBe(false);
    // Un Agente no entra por "contratación" (eso es de Staff).
    expect(enFormacion({ ...agente, citado_formacion: null, contratacion: true })).toBe(false);
    expect(enFormacion({ ...agente, estado: 'contratado' })).toBe(false);
  });
});

describe('porContratar (cola de Contratación)', () => {
  it('Staff con contratación, marcado o no, y Agentes que pasaron la formación', () => {
    expect(porContratar(staff)).toBe(true);
    expect(porContratar({ ...staff, estado_formacion: 'baja' })).toBe(true);
    expect(porContratar(agenteFormado)).toBe(true);
  });

  it('fuera: Agentes que no terminaron la formación, o Staff sin contratación', () => {
    expect(porContratar(agente)).toBe(false);
    expect(porContratar({ ...agente, asistio_formacion: true })).toBe(false);
    expect(porContratar({ ...agenteFormado, estado_formacion: 'baja' })).toBe(false);
    expect(porContratar({ ...agenteFormado, asistio_formacion: false })).toBe(false);
    expect(porContratar({ ...staff, contratacion: false })).toBe(false);
    expect(porContratar({ ...staff, estado: 'aprobado' })).toBe(false);
  });
});

describe('motivoNoAsistencia', () => {
  it('solo a Agentes en formación y no enviados', () => {
    expect(motivoNoAsistencia(agente)).toBeNull();
    expect(motivoNoAsistencia(staff)).toMatch(/no está en formación/);
    expect(motivoNoAsistencia({ ...agente, citado_formacion: false })).toMatch(/no está en formación/);
    expect(motivoNoAsistencia({ ...agente, contratacion_lote_id: 7 })).toMatch(/ya fue enviado/);
  });
});

describe('motivoNoEstado (Formación)', () => {
  it('activo a un Agente exige asistencia en Sí; baja no', () => {
    expect(motivoNoEstado(agente, 'activo')).toMatch(/asistencia/);
    expect(motivoNoEstado({ ...agente, asistio_formacion: false }, 'activo')).toMatch(/asistencia/);
    expect(motivoNoEstado({ ...agente, asistio_formacion: true }, 'activo')).toBeNull();
    expect(motivoNoEstado(agente, 'baja')).toBeNull();
  });

  it('Formación ya no marca Staff', () => {
    expect(motivoNoEstado(staff, 'activo')).toMatch(/no está en formación/);
  });
});

describe('motivoNoEstadoStaff (Contratación)', () => {
  it('Staff con contratación y no enviado pasa a activo o baja sin asistencia', () => {
    expect(motivoNoEstadoStaff(staff)).toBeNull();
    expect(motivoNoEstadoStaff({ ...staff, contratacion_lote_id: 2 })).toMatch(/ya fue enviado/);
  });

  it('los Agentes los marca Formación', () => {
    expect(motivoNoEstadoStaff(agenteFormado)).toMatch(/Formación/);
    expect(motivoNoEstadoStaff({ ...staff, contratacion: false })).toMatch(/no es Staff/);
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
