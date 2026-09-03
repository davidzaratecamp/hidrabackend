'use strict';

/**
 * Prueba de extremo a extremo de los filtros de `/api/candidatos` por rol.
 *
 * Cubre dos cosas a la vez, porque están relacionadas: quién ve qué (rol +
 * `ver_candidatos_todos`) y qué filtro devuelve qué (`agentes`, `staff`,
 * `estado`). Mismo patrón de fixtures que `flujo-completo.test.js`.
 *
 * La base compartida de desarrollo puede tener datos de otras sesiones (ver
 * la nota sobre `reportes.test.js` en `restructuracion.md` §11.9): en vez de
 * afirmar el TOTAL exacto de cada filtro, cada prueba comprueba que sus
 * propios candidatos de fixture están (o no están) en el resultado — así no
 * importa cuánta basura ajena haya en la base.
 */

const request = require('supertest');

const { pool, cerrarPool } = require('../../src/config/db');
const { construirContenedor } = require('../../src/container');
const { construirApp } = require('../../src/app');
const { crearEmailMemoria } = require('../../src/modules/integraciones/email');
const { crearFirmaCloudMemoria } = require('../../src/modules/integraciones/firmacloud');
const { crearServicioPassword } = require('../../src/shared/seguridad/password');

const PASSWORD = 'Hidra2026Segura';
const sufijo = Date.now();
const correo = (n) => `${n}.${sufijo}@prueba.local`;

let app;
const usuariosCreados = [];
const candidatosCreados = [];

const sesiones = {};
const auth = (rol) => ({ Authorization: `Bearer ${sesiones[rol].token}` });

async function crearUsuario({ email: correoUsuario, roles }) {
  const servicio = crearServicioPassword({ rondas: 10 });
  const hash = await servicio.hashear(PASSWORD);
  const [res] = await pool.query(
    'INSERT INTO usuarios (nombre_completo, email, password_hash) VALUES (?, ?, ?)',
    [`Usuario ${correoUsuario}`, correoUsuario, hash]
  );
  usuariosCreados.push(res.insertId);
  await pool.query(
    `INSERT INTO usuario_roles (usuario_id, rol_id)
     SELECT ?, id FROM roles WHERE codigo IN (${roles.map(() => '?').join(',')})`,
    [res.insertId, ...roles]
  );
  return res.insertId;
}

async function iniciarSesion(correoUsuario) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: correoUsuario, password: PASSWORD });
  expect(res.status).toBe(200);
  return { token: res.body.datos.token, usuario: res.body.datos.usuario };
}

/** Crea un candidato con el reclutador indicado como dueño, en 'nuevo'. */
async function crearCandidato(rolCreador, datos) {
  const res = await request(app)
    .post('/api/candidatos')
    .set(auth(rolCreador))
    .send(datos);
  expect(res.status).toBe(201);
  candidatosCreados.push(res.body.datos.id);
  return res.body.datos.id;
}

/** IDs devueltos por `/api/candidatos` con el filtro y la sesión dados. */
async function idsListados(rol, query) {
  const qs = new URLSearchParams({ porPagina: '100', ...query }).toString();
  const res = await request(app)
    .get(`/api/candidatos?${qs}`)
    .set(auth(rol));
  return { status: res.status, ids: new Set((res.body.datos ?? []).map((c) => c.id)) };
}

beforeAll(async () => {
  const email = crearEmailMemoria();
  const firma = crearFirmaCloudMemoria();
  app = construirApp(construirContenedor({ email, firma }));

  const reclutadorA = correo('filtros-reclutador-a');
  const reclutadorB = correo('filtros-reclutador-b');
  const seleccion = correo('filtros-seleccion');
  const admin = correo('filtros-admin');

  await crearUsuario({ email: reclutadorA, roles: ['reclutamiento'] });
  await crearUsuario({ email: reclutadorB, roles: ['reclutamiento'] });
  await crearUsuario({ email: seleccion, roles: ['seleccion'] });
  await crearUsuario({ email: admin, roles: ['administrador'] });

  sesiones.reclutadorA = await iniciarSesion(reclutadorA);
  sesiones.reclutadorB = await iniciarSesion(reclutadorB);
  sesiones.seleccion = await iniciarSesion(seleccion);
  sesiones.admin = await iniciarSesion(admin);
}, 30000);

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

// ---------------------------------------------------------------------------

describe('Filtros de /api/candidatos por rol', () => {
  // Fixture: dos candidatos Agente y dos Staff, repartidos entre los dos
  // reclutadores, en tres estados distintos del embudo — para que ningún
  // filtro pueda "acertar por accidente" con un solo candidato.
  let agenteDeA; // reclutadorA, cargo Agente, 'nuevo'
  let staffDeA; // reclutadorA, cargo Staff, 'nuevo'
  let agenteDeB; // reclutadorB, cargo Agente, 'citado'
  let staffDeB; // reclutadorB, cargo Staff, 'entrevistado'

  beforeAll(async () => {
    agenteDeA = await crearCandidato('reclutadorA', {
      nombreCompleto: 'Filtro Agente De A',
      tipoDocumento: 'CC',
      celular: '3011110001',
      cliente: 'Obamacare',
      cargo: 'Agente',
    });
    staffDeA = await crearCandidato('reclutadorA', {
      nombreCompleto: 'Filtro Staff De A',
      tipoDocumento: 'CC',
      celular: '3011110002',
      cliente: 'Staff Operacional',
      cargo: 'Coordinador',
    });
    agenteDeB = await crearCandidato('reclutadorB', {
      nombreCompleto: 'Filtro Agente De B',
      tipoDocumento: 'CC',
      celular: '3011110003',
      cliente: 'TyT',
      cargo: 'Agente Plus',
      citado: true, // queda en 'citado' directo (ver citar.js)
    });
    staffDeB = await crearCandidato('reclutadorB', {
      nombreCompleto: 'Filtro Staff De B',
      tipoDocumento: 'CC',
      celular: '3011110004',
      cliente: 'Staff Administrativo',
      cargo: 'Analista De Calidad',
    });

    // staffDeB pasa a 'entrevistado': citado -> asistió.
    const cita = await request(app)
      .post(`/api/seleccion/candidatos/${staffDeB}/citacion`)
      .set(auth('reclutadorB'));
    expect(cita.status).toBe(201);
    const asistencia = await request(app)
      .post(`/api/seleccion/candidatos/${staffDeB}/asistencia`)
      .set(auth('reclutadorB'))
      .send({ asistio: 'asistio' });
    expect(asistencia.status).toBe(200);
  }, 30000);

  describe('Visibilidad: ver_candidatos_todos hace que los tres roles vean lo mismo', () => {
    it.each(['reclutadorA', 'reclutadorB', 'seleccion', 'admin'])(
      '%s ve los cuatro candidatos del fixture, sean o no suyos',
      async (rol) => {
        const { status, ids } = await idsListados(rol, {});
        expect(status).toBe(200);
        expect(ids.has(agenteDeA)).toBe(true);
        expect(ids.has(staffDeA)).toBe(true);
        expect(ids.has(agenteDeB)).toBe(true);
        expect(ids.has(staffDeB)).toBe(true);
      }
    );
  });

  describe('Filtro agentes=true: solo cargo Agente', () => {
    it.each(['reclutadorA', 'seleccion', 'admin'])('%s: agentes=true trae solo Agente', async (rol) => {
      const { ids } = await idsListados(rol, { agentes: 'true' });
      expect(ids.has(agenteDeA)).toBe(true);
      expect(ids.has(agenteDeB)).toBe(true);
      expect(ids.has(staffDeA)).toBe(false);
      expect(ids.has(staffDeB)).toBe(false);
    });
  });

  describe('Filtro staff=true: solo cargo distinto de Agente', () => {
    it.each(['reclutadorA', 'seleccion', 'admin'])('%s: staff=true trae solo Staff', async (rol) => {
      const { ids } = await idsListados(rol, { staff: 'true' });
      expect(ids.has(staffDeA)).toBe(true);
      expect(ids.has(staffDeB)).toBe(true);
      expect(ids.has(agenteDeA)).toBe(false);
      expect(ids.has(agenteDeB)).toBe(false);
    });
  });

  describe('Filtro estado: cada candidato aparece solo en el suyo', () => {
    it('estado=nuevo trae a los dos que nunca se citaron, no a los otros dos', async () => {
      const { ids } = await idsListados('admin', { estado: 'nuevo' });
      expect(ids.has(agenteDeA)).toBe(true);
      expect(ids.has(staffDeA)).toBe(true);
      expect(ids.has(agenteDeB)).toBe(false);
      expect(ids.has(staffDeB)).toBe(false);
    });

    it('estado=citado trae solo al citado', async () => {
      const { ids } = await idsListados('admin', { estado: 'citado' });
      expect(ids.has(agenteDeB)).toBe(true);
      expect(ids.has(agenteDeA)).toBe(false);
      expect(ids.has(staffDeA)).toBe(false);
      expect(ids.has(staffDeB)).toBe(false);
    });

    it('estado=entrevistado trae solo al entrevistado', async () => {
      const { ids } = await idsListados('admin', { estado: 'entrevistado' });
      expect(ids.has(staffDeB)).toBe(true);
      expect(ids.has(agenteDeA)).toBe(false);
      expect(ids.has(staffDeA)).toBe(false);
      expect(ids.has(agenteDeB)).toBe(false);
    });
  });

  describe('Filtros combinados: staff + estado', () => {
    it('staff=true & estado=entrevistado trae exactamente al Staff entrevistado', async () => {
      const { ids } = await idsListados('seleccion', { staff: 'true', estado: 'entrevistado' });
      expect(ids.has(staffDeB)).toBe(true);
      expect(ids.has(agenteDeA)).toBe(false);
      expect(ids.has(staffDeA)).toBe(false);
      expect(ids.has(agenteDeB)).toBe(false);
    });

    it('agentes=true & estado=nuevo trae exactamente al Agente sin citar', async () => {
      const { ids } = await idsListados('reclutadorB', { agentes: 'true', estado: 'nuevo' });
      expect(ids.has(agenteDeA)).toBe(true);
      expect(ids.has(staffDeA)).toBe(false);
      expect(ids.has(agenteDeB)).toBe(false);
      expect(ids.has(staffDeB)).toBe(false);
    });
  });

  describe('Filtro cliente', () => {
    it('cliente=Obamacare trae solo al candidato de esa campaña', async () => {
      const { ids } = await idsListados('admin', { cliente: 'Obamacare' });
      expect(ids.has(agenteDeA)).toBe(true);
      expect(ids.has(staffDeA)).toBe(false);
      expect(ids.has(agenteDeB)).toBe(false);
      expect(ids.has(staffDeB)).toBe(false);
    });
  });

  describe('ver_candidatos_todos es del rol, no de haber creado los candidatos', () => {
    it('un tercer reclutador, recién creado, sin ningún candidato propio, también ve los cuatro', async () => {
      const reclutadorC = correo('filtros-reclutador-c');
      await crearUsuario({ email: reclutadorC, roles: ['reclutamiento'] });
      sesiones.reclutadorC = await iniciarSesion(reclutadorC);

      const { ids } = await idsListados('reclutadorC', {});
      expect(ids.has(agenteDeA)).toBe(true);
      expect(ids.has(staffDeA)).toBe(true);
      expect(ids.has(agenteDeB)).toBe(true);
      expect(ids.has(staffDeB)).toBe(true);
    });
  });
});
