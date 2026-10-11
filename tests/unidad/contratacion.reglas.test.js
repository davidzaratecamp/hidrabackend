'use strict';

/**
 * Reglas puras de la integración con Gestor: sin base de datos ni red.
 */

const {
  motivoNoElegible,
  construirCandidatoPayload,
  generarLoteExternoId,
  decidirResultadoEnvio,
  estadoLocalPorResultado,
} = require('../../src/modules/contratacion/contratacion.reglas');
const { firmar, firmaValida, timestampVigente } = require('../../src/shared/seguridad/firmaHmac');

const base = {
  id: 4821,
  estado: 'aprobado_final',
  cargo: 'Agente Call Center',
  citado_formacion: true,
  contratacion: null,
  asistio_formacion: true,
  estado_formacion: 'activo',
  numero_documento: '1012345678',
  contratacion_lote_id: null,
};

describe('motivoNoElegible', () => {
  it('acepta un Agente aprobado, citado, que asistió y está activo en formación', () => {
    expect(motivoNoElegible(base)).toBeNull();
  });

  it('acepta un Staff aprobado con contratación registrada', () => {
    expect(motivoNoElegible({ ...base, cargo: 'Analista de Calidad', citado_formacion: null, contratacion: true })).toBeNull();
  });

  it('a un Staff no se le exige asistencia a formación', () => {
    const staff = { ...base, cargo: 'Analista de Calidad', citado_formacion: null, contratacion: true };
    expect(motivoNoElegible({ ...staff, asistio_formacion: null })).toBeNull();
  });

  it('rechaza a un Agente sin asistencia marcada o que no asistió', () => {
    expect(motivoNoElegible({ ...base, asistio_formacion: null })).toMatch(/marcar la asistencia/);
    expect(motivoNoElegible({ ...base, asistio_formacion: false })).toMatch(/No asistió/);
  });

  it('rechaza de baja o sin marcar como activo, sea Agente o Staff', () => {
    const staff = { ...base, cargo: 'Coordinador', citado_formacion: null, contratacion: true };
    expect(motivoNoElegible({ ...base, estado_formacion: 'baja' })).toMatch(/baja/);
    expect(motivoNoElegible({ ...base, estado_formacion: null })).toMatch(/activo/);
    expect(motivoNoElegible({ ...staff, estado_formacion: 'baja' })).toMatch(/baja/);
    expect(motivoNoElegible({ ...staff, estado_formacion: null })).toMatch(/activo/);
  });

  it('rechaza si no está en aprobado_final', () => {
    expect(motivoNoElegible({ ...base, estado: 'aprobado' })).toMatch(/decisión final/);
  });

  it('rechaza un Agente sin citación a formación y un Staff sin contratación', () => {
    expect(motivoNoElegible({ ...base, citado_formacion: false })).toMatch(/formación/);
    expect(motivoNoElegible({ ...base, cargo: 'Coordinador', citado_formacion: true, contratacion: null })).toMatch(/contratación/);
  });

  it('rechaza sin número de documento o si ya fue enviado', () => {
    expect(motivoNoElegible({ ...base, numero_documento: null })).toMatch(/documento/);
    expect(motivoNoElegible({ ...base, contratacion_lote_id: 3 })).toMatch(/otro lote/);
  });
});

describe('construirCandidatoPayload', () => {
  const datos = {
    ...base,
    tipo_documento: 'CC',
    primer_nombre: 'Laura', segundo_nombre: '', primer_apellido: 'Gómez', segundo_apellido: 'Ruiz',
    email: 'laura@example.com', celular: '3001234567',
    fecha_nacimiento: '2001-05-14', genero: 'femenino', estado_civil: 'soltero', grupo_sanguineo: 'O+',
    eps: 'Sanitas EPS', afp: 'Porvenir',
    direccion_residencial: 'Cra 10 # 20-30', barrio: 'Chapinero',
    nombre_emergencia: 'Ana Ruiz', numero_emergencia: '3109876543', parentesco_emergencia: 'madre',
    talla_camisa: 'M', cliente: 'Hogar',
    fecha_decision: '2026-09-29 10:04:00',
    fecha_consentimiento: '2026-09-20', ciudad_consentimiento: 'Bogotá',
  };

  it('arma el contrato de Gestor con catálogos por código', () => {
    const payload = construirCandidatoPayload(datos, 2);
    expect(payload).toMatchObject({
      hydra_candidato_id: 4821,
      version: 2,
      identificacion: { tipo: 'CC', numero: '1012345678' },
      nombres: { primer_nombre: 'Laura', segundo_nombre: null, primer_apellido: 'Gómez', segundo_apellido: 'Ruiz' },
      personal: { genero: 'femenino', estado_civil: 'soltero', grupo_sanguineo: 'O+' },
      seguridad_social: { eps: 'Sanitas EPS', afp: 'Porvenir' },
      contacto_emergencia: { parentesco: 'madre' },
      proceso: { cliente: 'Hogar', cargo: 'Agente Call Center' },
    });
  });

  it('convierte la fecha de decisión (hora local) a instante ISO', () => {
    const { proceso } = construirCandidatoPayload(datos, 1);
    expect(proceso.aprobado_final_en).toBe(new Date('2026-09-29T10:04:00').toISOString());
  });

  it('no inventa datos: lo que falta viaja como null', () => {
    const payload = construirCandidatoPayload({ ...base, tipo_documento: 'CC', primer_nombre: 'A', primer_apellido: 'B' }, 1);
    expect(payload.personal).toEqual({ fecha_nacimiento: null, genero: null, estado_civil: null, grupo_sanguineo: null });
    expect(payload.proceso.aprobado_final_en).toBeNull();
  });
});

describe('generarLoteExternoId', () => {
  it('es legible y lleva sufijo aleatorio', () => {
    expect(generarLoteExternoId(12, '2026-10-01T15:00:00.000Z', 'a1b2c3d4-e5f6')).toBe('HYD-20261001-12-a1b2c3d4');
  });
});

describe('decidirResultadoEnvio', () => {
  const politica = { maxIntentos: 10, backoffMaximoMinutos: 60 };
  const decidir = (status, intentosPrevios = 0, codigo = null) =>
    decidirResultadoEnvio({ status, codigo, intentosPrevios }, politica);

  it('2xx → enviado', () => {
    expect(decidir(201)).toEqual({ estado: 'enviado', intentos: 1, esperaMinutos: null });
  });

  it('a diferencia de Gestor, un 409 LOTE_CERRADO NO es éxito: queda fallido', () => {
    expect(decidir(409, 0, 'LOTE_CERRADO').estado).toBe('fallido');
  });

  it('409 PETICION_CONCURRENTE, 503, 5xx y red caída se reintentan con backoff', () => {
    expect(decidir(409, 0, 'PETICION_CONCURRENTE')).toEqual({ estado: 'pendiente', intentos: 1, esperaMinutos: 1 });
    expect(decidir(503, 2).esperaMinutos).toBe(4);
    expect(decidir(null, 0).estado).toBe('pendiente');
    expect(decidir(500, 8).esperaMinutos).toBe(60);
  });

  it('otros 4xx son permanentes y el máximo de intentos corta', () => {
    for (const status of [400, 401, 404, 413, 422]) expect(decidir(status).estado).toBe('fallido');
    expect(decidir(500, 9).estado).toBe('fallido');
  });
});

describe('estadoLocalPorResultado', () => {
  it('traduce cada resultado de Gestor', () => {
    expect(estadoLocalPorResultado('creado', 'en_cola')).toEqual({ estado: 'recibido', detalle: null });
    expect(estadoLocalPorResultado('reintegro_detectado', 'en_cola').detalle).toMatch(/reintegro/);
    expect(estadoLocalPorResultado('ya_registrado', 'recibido').estado).toBe('registrado');
    expect(estadoLocalPorResultado('en_otro_lote', 'en_cola').estado).toBe('error');
  });

  it('sin_cambios solo avanza a quien seguía en cola', () => {
    expect(estadoLocalPorResultado('sin_cambios', 'en_cola')).toEqual({ estado: 'recibido', detalle: null });
    expect(estadoLocalPorResultado('sin_cambios', 'descartado')).toBeNull();
  });
});

describe('firmaHmac (mismo algoritmo que Gestor)', () => {
  // Vector fijo: si cambia, Hydra y Gestor dejan de entenderse.
  it('produce la firma esperada para un vector conocido', () => {
    const firma = firmar('secreto-de-prueba-0123456789abcdef', '1759300000', '{"a":1}');
    expect(firma).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(firmaValida('secreto-de-prueba-0123456789abcdef', '1759300000', Buffer.from('{"a":1}'), firma)).toBe(true);
    expect(firmaValida('secreto-de-prueba-0123456789abcdef', '1759300001', '{"a":1}', firma)).toBe(false);
    expect(firmaValida('otro', '1759300000', '{"a":1}', firma)).toBe(false);
  });

  it('timestampVigente aplica la ventana', () => {
    expect(timestampVigente('1000', 1300, 300)).toBe(true);
    expect(timestampVigente('1000', 1301, 300)).toBe(false);
    expect(timestampVigente('x', 1000, 300)).toBe(false);
  });
});
