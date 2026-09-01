'use strict';

/**
 * Panel de Selección (`GET /api/reportes/panel-seleccion`): cola de trabajo,
 * resultados de Agente globales y evaluaciones por día.
 *
 * Los conteos son GLOBALES (sin filtrar por reclutador), así que las
 * aserciones son antes/después — la base puede tener datos de otras pruebas
 * o de uso real, y comparar deltas es lo único que no depende de eso.
 */

const request = require('supertest');

const { pool, cerrarPool } = require('../../src/config/db');
const { construirContenedor } = require('../../src/container');
const { construirApp } = require('../../src/app');
const { crearServicioPassword } = require('../../src/shared/seguridad/password');

const PASSWORD = 'Hidra2026Segura';
const sufijo = Date.now();
const correo = (n) => `panelsel.${n}.${sufijo}@prueba.local`;

let app;
const usuariosCreados = [];
const candidatosCreados = [];
let tokenRec;
let tokenSel;

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
    .set({ Authorization: `Bearer ${tokenRec}` })
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
    .set({ Authorization: `Bearer ${tokenRec}` })
    .send(motivo ? { estado, motivo } : { estado });
  expect(res.status).toBe(200);
}

/** Camino corto hasta "entrevistado", sin pasar por citación/asistencia reales. */
async function llevarAEntrevistado(id) {
  await avanzar(id, 'contacto_exitoso');
  await avanzar(id, 'formularios_enviados');
  await avanzar(id, 'formularios_completados');
  await avanzar(id, 'citado');
  await avanzar(id, 'entrevistado');
}

async function panel() {
  const res = await request(app)
    .get('/api/reportes/panel-seleccion')
    .set({ Authorization: `Bearer ${tokenSel}` });
  expect(res.status).toBe(200);
  return res.body.datos;
}

beforeAll(async () => {
  app = construirApp(construirContenedor());
  tokenRec = await crearUsuario({ email: correo('rec'), roles: ['reclutamiento'] });
  tokenSel = await crearUsuario({ email: correo('sel'), roles: ['seleccion'] });
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

describe('GET /api/reportes/panel-seleccion', () => {
  it('lo bloquea para Reclutamiento — evaluar_candidatos es exclusivo de Selección/Administrador', async () => {
    const res = await request(app)
      .get('/api/reportes/panel-seleccion')
      .set({ Authorization: `Bearer ${tokenRec}` });
    expect(res.status).toBe(403);
  });

  it('cuenta pendientes de evaluación (Agente entrevistado) y de decisión final (no-Agente entrevistado + Agente ya evaluado)', async () => {
    const antes = await panel();

    // p: Agente, entrevistado, nunca evaluado -> pendiente de EVALUACIÓN.
    const p = await crearCandidato({ nombreCompleto: 'Cola P', cliente: 'Obamacare', cargo: 'Agente' });
    await llevarAEntrevistado(p);

    // q: Customer Service (no Agente), entrevistado -> pendiente de DECISIÓN
    // FINAL directa, nunca pasa por evaluación.
    const q = await crearCandidato({ nombreCompleto: 'Cola Q', cliente: 'Obamacare', cargo: 'Customer Service' });
    await llevarAEntrevistado(q);

    // r: Agente ya evaluado (estado "aprobado", atajo de prueba) -> también
    // pendiente de DECISIÓN FINAL, no de evaluación otra vez.
    const r = await crearCandidato({ nombreCompleto: 'Cola R', cliente: 'Hogar', cargo: 'Agente Plus' });
    await llevarAEntrevistado(r);
    await avanzar(r, 'aprobado');

    const despues = await panel();

    expect(despues.cola.pendientesEvaluacion - antes.cola.pendientesEvaluacion).toBe(1); // p
    expect(despues.cola.pendientesDecisionFinal - antes.cola.pendientesDecisionFinal).toBe(2); // q, r
  });

  it('resultadosAgentes es global (no por reclutador) y evaluacionesPorDia registra la evaluación de hoy', async () => {
    const antes = await panel();

    const s = await crearCandidato({ nombreCompleto: 'Eval S', cliente: 'Obamacare', cargo: 'Agente' });
    await llevarAEntrevistado(s);

    const respuesta = await request(app)
      .post(`/api/seleccion/candidatos/${s}/evaluacion`)
      .set({ Authorization: `Bearer ${tokenSel}` })
      .send({
        puntajes: { saludo: 18, perfilamiento: 18, producto: 18, objeciones: 18, cierre: 18 }, // 90% > 71%
      });
    expect(respuesta.status).toBe(201);

    const despues = await panel();

    expect(despues.resultadosAgentes.aprobado - antes.resultadosAgentes.aprobado).toBe(1);

    const hoy = new Date().getDate();
    const filaAntes = antes.serie.find((d) => d.dia === hoy);
    const filaDespues = despues.serie.find((d) => d.dia === hoy);
    expect(filaDespues.evaluaciones).toBe(filaAntes.evaluaciones + 1);

    // Un elemento por cada día del mes, sin huecos — mismo criterio que la
    // serie de trazabilidad.
    const ultimoDiaDelMes = new Date(
      new Date().getFullYear(),
      new Date().getMonth() + 1,
      0
    ).getDate();
    expect(despues.serie).toHaveLength(ultimoDiaDelMes);

    // El promedio por criterio (`evaluacion.porCriterio`) también refleja la
    // evaluación recién guardada.
    const saludo = despues.evaluacion.porCriterio.find((c) => c.codigo === 'saludo');
    expect(saludo.evaluaciones).toBeGreaterThanOrEqual(1);
  });
});
