'use strict';

/**
 * Trazabilidad: "por cargo" y el embudo de conversión.
 *
 * El resto del módulo (resumen, serie diaria, actividad reciente) ya se
 * ejercita indirectamente en otras pruebas del flujo; esta se enfoca en las
 * dos agregaciones nuevas, que son las que tienen lógica real de conteo.
 */

const request = require('supertest');

const { pool, cerrarPool } = require('../../src/config/db');
const { construirContenedor } = require('../../src/container');
const { construirApp } = require('../../src/app');
const { crearServicioPassword } = require('../../src/shared/seguridad/password');

const PASSWORD = 'Hidra2026Segura';
const sufijo = Date.now();
const correo = (n) => `traz.${n}.${sufijo}@prueba.local`;

let app;
const usuariosCreados = [];
const candidatosCreados = [];
let token;

async function crearUsuario({ email, roles }) {
  const servicio = crearServicioPassword({ rondas: 10 });
  const hash = await servicio.hashear(PASSWORD);
  const [res] = await pool.query(
    'INSERT INTO usuarios (nombre_completo, email, password_hash) VALUES (?, ?, ?)',
    [`Usuario ${email}`, email, hash]
  );
  usuariosCreados.push(res.insertId);
  await pool.query(
    `INSERT INTO usuario_roles (usuario_id, rol_id) SELECT ?, id FROM roles WHERE codigo IN (${roles.map(() => '?').join(',')})`,
    [res.insertId, ...roles]
  );
  const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return login.body.datos.token;
}

async function crearCandidato(datos) {
  const res = await request(app)
    .post('/api/candidatos')
    .set({ Authorization: `Bearer ${token}` })
    .send({
      tipoDocumento: 'CC',
      celular: '3000000000',
      numeroDocumento: `9${String(Date.now()).slice(-9)}${candidatosCreados.length}`,
      ...datos,
    });
  candidatosCreados.push(res.body.datos.id);
  return res.body.datos.id;
}

async function avanzar(id, estado, motivo) {
  const res = await request(app)
    .post(`/api/candidatos/${id}/estado`)
    .set({ Authorization: `Bearer ${token}` })
    .send(motivo ? { estado, motivo } : { estado });
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  app = construirApp(construirContenedor());
  token = await crearUsuario({ email: correo('rec'), roles: ['reclutamiento'] });
}, 30_000);

afterAll(async () => {
  if (candidatosCreados.length > 0) {
    await pool.query(
      `DELETE FROM candidatos WHERE id IN (${candidatosCreados.map(() => '?').join(',')})`,
      candidatosCreados
    );
  }
  if (usuariosCreados.length > 0) {
    await pool.query(
      `DELETE FROM usuarios WHERE id IN (${usuariosCreados.map(() => '?').join(',')})`,
      usuariosCreados
    );
  }
  await cerrarPool();
});

describe('GET /api/trazabilidad/mia — por cargo y embudo de conversión', () => {
  it('agrupa la cartera por campaña/cargo y cuenta hasta dónde llegó cada quien', async () => {
    // Dos candidatos "Obamacare / Agente", uno "Hogar / Agente Plus".
    const a = await crearCandidato({ nombreCompleto: 'Traza Uno', cliente: 'Obamacare', cargo: 'Agente' });
    const b = await crearCandidato({ nombreCompleto: 'Traza Dos', cliente: 'Obamacare', cargo: 'Agente' });
    const c = await crearCandidato({ nombreCompleto: 'Traza Tres', cliente: 'Hogar', cargo: 'Agente Plus' });

    // `a` recorre hasta "entrevistado" (nunca pasa por contacto_exitoso: usa
    // el camino directo nuevo -> citado del atajo... no, aquí sí probamos el
    // camino normal para que formularios_completados también cuente).
    await avanzar(a, 'contacto_exitoso');
    await avanzar(a, 'formularios_enviados');
    await avanzar(a, 'formularios_completados');
    await avanzar(a, 'citado');
    await avanzar(a, 'entrevistado');

    // `b` se queda en "contacto_exitoso": nunca llega a citado.
    await avanzar(b, 'contacto_exitoso');

    // `c` queda en "nuevo": no aparece en ninguna etapa del embudo salvo el
    // total de registrados.

    const res = await request(app)
      .get('/api/trazabilidad/mia')
      .set({ Authorization: `Bearer ${token}` });

    expect(res.status).toBe(200);

    const porCargo = res.body.datos.porCargo;
    const obamacareAgente = porCargo.find((f) => f.cliente === 'Obamacare' && f.cargo === 'Agente');
    const hogarAgentePlus = porCargo.find((f) => f.cliente === 'Hogar' && f.cargo === 'Agente Plus');
    expect(obamacareAgente.total).toBe(2);
    expect(hogarAgentePlus.total).toBe(1);

    const embudo = res.body.datos.embudo;
    expect(embudo.registrados).toBe(3);
    expect(embudo.contactoExitoso).toBe(2); // a y b
    expect(embudo.formulariosCompletados).toBe(1); // solo a
    expect(embudo.citado).toBe(1); // solo a
    expect(embudo.entrevistado).toBe(1); // solo a
    expect(embudo.aprobado).toBe(0);
    expect(embudo.contratado).toBe(0);
  });

  it('el atajo "Citado = Sí" al registrar cuenta en citado sin pasar por las etapas intermedias', async () => {
    const id = await crearCandidato({
      nombreCompleto: 'Traza Directo',
      cliente: 'Obamacare',
      cargo: 'Agente',
      citado: true,
    });

    const res = await request(app)
      .get('/api/trazabilidad/mia')
      .set({ Authorization: `Bearer ${token}` });

    const embudo = res.body.datos.embudo;
    // Cuenta en citado...
    expect(embudo.citado).toBeGreaterThanOrEqual(1);

    const detalle = await request(app)
      .get(`/api/candidatos/${id}`)
      .set({ Authorization: `Bearer ${token}` });
    expect(detalle.body.datos.estado).toBe('citado');
    // ...pero el historial de ESTE candidato nunca pasó por contacto_exitoso
    // ni formularios_completados: el atajo es honesto en el embudo.
    const historialEstados = detalle.body.datos.historial.map((h) => h.estado_nuevo);
    expect(historialEstados).not.toContain('contacto_exitoso');
    expect(historialEstados).not.toContain('formularios_completados');
  });
});

describe('GET /api/trazabilidad/mia — resultados de Agente', () => {
  it('solo cuenta candidatos con cargo Agente, agrupados por su etapa de decisión', async () => {
    // `d`: Agente, se queda en "aprobado" (pendiente decisión final).
    const d = await crearCandidato({ nombreCompleto: 'Agente D', cliente: 'Obamacare', cargo: 'Agente' });
    await avanzar(d, 'contacto_exitoso');
    await avanzar(d, 'formularios_enviados');
    await avanzar(d, 'formularios_completados');
    await avanzar(d, 'citado');
    await avanzar(d, 'entrevistado');
    await avanzar(d, 'aprobado');

    // `e`: "Agente Plus" (matchea /agente/i, igual que en `esCargoAgente`),
    // llega hasta "rechazado_final".
    const e = await crearCandidato({ nombreCompleto: 'Agente E', cliente: 'Hogar', cargo: 'Agente Plus' });
    await avanzar(e, 'contacto_exitoso');
    await avanzar(e, 'formularios_enviados');
    await avanzar(e, 'formularios_completados');
    await avanzar(e, 'citado');
    await avanzar(e, 'entrevistado');
    await avanzar(e, 'rechazado', 'no aplica al perfil');
    await avanzar(e, 'rechazado_final', 'confirmado por psicología');

    // `f`: Agente, pasa por "aprobado" y sigue hasta "aprobado_final" — solo
    // debe contar en la etapa final, no en las dos.
    const f = await crearCandidato({ nombreCompleto: 'Agente F', cliente: 'Obamacare', cargo: 'Agente' });
    await avanzar(f, 'contacto_exitoso');
    await avanzar(f, 'formularios_enviados');
    await avanzar(f, 'formularios_completados');
    await avanzar(f, 'citado');
    await avanzar(f, 'entrevistado');
    await avanzar(f, 'aprobado');
    await avanzar(f, 'aprobado_final');

    // `h`: NO es Agente (Customer Service) — pasa directo a "aprobado_final"
    // sin evaluación, como cualquier cargo que no sea Agente. No debe contar.
    const h = await crearCandidato({
      nombreCompleto: 'No Agente H', cliente: 'Obamacare', cargo: 'Customer Service',
    });
    await avanzar(h, 'contacto_exitoso');
    await avanzar(h, 'formularios_enviados');
    await avanzar(h, 'formularios_completados');
    await avanzar(h, 'citado');
    await avanzar(h, 'entrevistado');
    await avanzar(h, 'aprobado_final', 'decisión directa, no es Agente');

    const res = await request(app)
      .get('/api/trazabilidad/mia')
      .set({ Authorization: `Bearer ${token}` });

    const resultados = res.body.datos.resultadosAgentes;
    expect(resultados.aprobado).toBe(1); // d
    expect(resultados.rechazado).toBe(0); // e ya avanzó a rechazadoFinal
    expect(resultados.aprobadoFinal).toBe(1); // f
    expect(resultados.rechazadoFinal).toBe(1); // e
    // h (Customer Service) no debe sumar a ningún conteo.
    const totalAgentes =
      resultados.aprobado + resultados.rechazado + resultados.aprobadoFinal + resultados.rechazadoFinal;
    expect(totalAgentes).toBe(3);
  });
});

describe('GET /api/trazabilidad/mia — serie del mes en curso', () => {
  it('trae UN día por cada día del mes, sin huecos, con hoy sumando lo recién creado', async () => {
    const antes = await request(app)
      .get('/api/trazabilidad/mia')
      .set({ Authorization: `Bearer ${token}` });
    const serieAntes = antes.body.datos.serie;

    const hoy = new Date();
    const ultimoDiaDelMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();

    // Ni un hueco: un elemento por cada día del mes, del 1 al último.
    expect(serieAntes).toHaveLength(ultimoDiaDelMes);
    expect(serieAntes.map((d) => d.dia)).toEqual(
      Array.from({ length: ultimoDiaDelMes }, (_, i) => i + 1)
    );

    const filaHoy = serieAntes.find((d) => d.dia === hoy.getDate());
    const creadosAntes = filaHoy.creados;

    await crearCandidato({ nombreCompleto: 'Traza Serie', cliente: 'Obamacare', cargo: 'Agente' });

    const despues = await request(app)
      .get('/api/trazabilidad/mia')
      .set({ Authorization: `Bearer ${token}` });
    const filaHoyDespues = despues.body.datos.serie.find((d) => d.dia === hoy.getDate());
    expect(filaHoyDespues.creados).toBe(creadosAntes + 1);
  });
});
