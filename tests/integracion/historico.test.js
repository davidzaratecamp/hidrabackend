'use strict';

/**
 * Pruebas de la consulta al archivo histórico (`noviembrehidra`).
 *
 * Corre contra la base vieja REAL y solo hace SELECT: no crea, no modifica y no
 * borra nada allí. Los únicos datos que la prueba escribe —y limpia— son los
 * usuarios de sesión, que viven en la base nueva.
 *
 * Si la base histórica no está configurada (`DB_HISTORICO_NAME`) o está vacía,
 * el bloque se salta en vez de fallar: es una integración opcional y una máquina
 * sin ese archivo debe poder correr la batería completa.
 */

const request = require('supertest');

const { pool, cerrarPool } = require('../../src/config/db');
const { poolHistorico, cerrarPoolHistorico } = require('../../src/config/dbHistorico');
const { construirContenedor } = require('../../src/container');
const { construirApp } = require('../../src/app');
const { crearServicioPassword } = require('../../src/shared/seguridad/password');

const PASSWORD = 'Hidra2026Segura';
const sufijo = Date.now();
const correo = (n) => `hist.${n}.${sufijo}@prueba.local`;

let app;
let hayArchivo = false;
/** Un candidato real del archivo, elegido en beforeAll para no fijar ids a mano. */
let muestra = null;
const idsCreados = [];
const sesiones = {};
const auth = (rol) => ({ Authorization: `Bearer ${sesiones[rol]}` });

async function crearUsuario({ email, roles }) {
  const servicio = crearServicioPassword({ rondas: 10 });
  const hash = await servicio.hashear(PASSWORD);
  const [res] = await pool.query(
    'INSERT INTO usuarios (nombre_completo, email, password_hash) VALUES (?, ?, ?)',
    [`Usuario ${email}`, email, hash]
  );
  idsCreados.push(res.insertId);
  await pool.query(
    `INSERT INTO usuario_roles (usuario_id, rol_id)
     SELECT ?, id FROM roles WHERE codigo IN (${roles.map(() => '?').join(',')})`,
    [res.insertId, ...roles]
  );
  const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(login.status).toBe(200);
  return login.body.datos.token;
}

beforeAll(async () => {
  app = construirApp(construirContenedor());

  if (poolHistorico) {
    try {
      const [filas] = await poolHistorico.query(
        `SELECT id, primer_nombre, primer_apellido, numero_documento
           FROM hyd_candidatos ORDER BY created_at DESC, id DESC LIMIT 1`
      );
      muestra = filas[0] ?? null;
      hayArchivo = Boolean(muestra);
    } catch {
      hayArchivo = false;
    }
  }

  if (hayArchivo) {
    sesiones.reclutador = await crearUsuario({
      email: correo('rec'),
      roles: ['reclutamiento'],
    });
    sesiones.seleccion = await crearUsuario({ email: correo('sel'), roles: ['seleccion'] });
  }
}, 60_000);

afterAll(async () => {
  if (idsCreados.length > 0) {
    await pool.query(
      `DELETE FROM usuarios WHERE id IN (${idsCreados.map(() => '?').join(',')})`,
      idsCreados
    );
  }
  await Promise.all([cerrarPool(), cerrarPoolHistorico()]);
});

describe.skipIf(!process.env.DB_HISTORICO_NAME)('GET /api/historico', () => {
  it('exige sesión', async () => {
    const res = await request(app).get('/api/historico/candidatos');
    expect(res.status).toBe(401);
  });

  it('lista el archivo completo, del más reciente al más antiguo', async () => {
    if (!hayArchivo) return;

    const res = await request(app)
      .get('/api/historico/candidatos')
      .query({ porPagina: 10 })
      .set(auth('reclutador'));

    expect(res.status).toBe(200);
    expect(res.body.datos.length).toBeGreaterThan(0);
    expect(res.body.datos.length).toBeLessThanOrEqual(10);
    // El total es del archivo entero: la vista NO filtra por reclutador dueño.
    expect(res.body.meta.total).toBeGreaterThan(0);
    expect(res.body.meta.pagina).toBe(1);

    const fechas = res.body.datos.map((c) => c.createdAt);
    expect([...fechas].sort().reverse()).toEqual(fechas);
    expect(res.body.datos[0].id).toBe(muestra.id);
    expect(res.body.datos[0].nombreCompleto).toContain(muestra.primer_apellido);
  });

  it('pagina sin repetir filas entre páginas consecutivas', async () => {
    if (!hayArchivo) return;

    const consulta = (pagina) =>
      request(app)
        .get('/api/historico/candidatos')
        .query({ pagina, porPagina: 5 })
        .set(auth('reclutador'));

    const [primera, segunda] = await Promise.all([consulta(1), consulta(2)]);
    const ids = new Set([
      ...primera.body.datos.map((c) => c.id),
      ...segunda.body.datos.map((c) => c.id),
    ]);
    expect(ids.size).toBe(primera.body.datos.length + segunda.body.datos.length);
  });

  it('busca por nombre y por documento', async () => {
    if (!hayArchivo) return;

    const porNombre = await request(app)
      .get('/api/historico/candidatos')
      .query({ q: muestra.primer_apellido })
      .set(auth('reclutador'));

    expect(porNombre.status).toBe(200);
    expect(porNombre.body.datos.some((c) => c.id === muestra.id)).toBe(true);

    if (muestra.numero_documento) {
      const porDocumento = await request(app)
        .get('/api/historico/candidatos')
        .query({ q: muestra.numero_documento })
        .set(auth('reclutador'));
      expect(porDocumento.body.datos.some((c) => c.id === muestra.id)).toBe(true);
    }
  });

  it('no interpreta los comodines de LIKE que escriba el usuario', async () => {
    if (!hayArchivo) return;

    const [conComodin, sinFiltro] = await Promise.all([
      request(app).get('/api/historico/candidatos').query({ q: '%' }).set(auth('reclutador')),
      request(app).get('/api/historico/candidatos').set(auth('reclutador')),
    ]);

    expect(conComodin.status).toBe(200);
    // Con el comodín escapado, '%' se busca como texto literal y no devuelve
    // el archivo entero.
    expect(conComodin.body.meta.total).toBeLessThan(sinFiltro.body.meta.total);
  });

  it('rechaza un campo de orden que no esté en la lista blanca', async () => {
    if (!hayArchivo) return;

    const res = await request(app)
      .get('/api/historico/candidatos')
      .query({ ordenarPor: 'id; DROP TABLE hyd_candidatos' })
      .set(auth('reclutador'));

    expect(res.status).toBe(400);
  });

  it('devuelve los valores disponibles para los filtros', async () => {
    if (!hayArchivo) return;

    const res = await request(app).get('/api/historico/filtros').set(auth('reclutador'));

    expect(res.status).toBe(200);
    expect(res.body.datos.totalCandidatos).toBeGreaterThan(0);
    expect(res.body.datos.estados.length).toBeGreaterThan(0);
    expect(res.body.datos.clientes[0]).toHaveProperty('valor');
    expect(res.body.datos.reclutadores.length).toBeGreaterThan(0);
  });

  it('filtra por cliente usando un valor del propio archivo', async () => {
    if (!hayArchivo) return;

    const filtros = await request(app).get('/api/historico/filtros').set(auth('reclutador'));
    const cliente = filtros.body.datos.clientes[0];

    const res = await request(app)
      .get('/api/historico/candidatos')
      .query({ cliente: cliente.valor, porPagina: 5 })
      .set(auth('reclutador'));

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(cliente.total);
    expect(res.body.datos.every((c) => c.cliente === cliente.valor)).toBe(true);
  });

  it('el listado trae las columnas del documento oficial "BASE RECLUTAMIENTO"', async () => {
    if (!hayArchivo) return;

    const res = await request(app)
      .get('/api/historico/candidatos')
      .query({ porPagina: 5 })
      .set(auth('reclutador'));

    expect(res.status).toBe(200);
    const fila = res.body.datos[0];
    // No sensibles: visibles para cualquiera con `ver_candidatos`.
    expect(fila).toHaveProperty('estadoGestionReclutamiento');
    expect(fila).toHaveProperty('asisteEntrevista');
    expect(fila).toHaveProperty('motivoInasistencia');
    // Valoración psicológica: reclutamiento no la tiene (no ve perfiles
    // completos), mismo criterio que la ficha.
    expect(fila).not.toHaveProperty('antecedentesAdres');
    expect(fila).not.toHaveProperty('aprobado');
    expect(fila).not.toHaveProperty('razonNoAprobado');

    const conPerfilCompleto = await request(app)
      .get('/api/historico/candidatos')
      .query({ porPagina: 5 })
      .set(auth('seleccion'));

    const filaSeleccion = conPerfilCompleto.body.datos[0];
    expect(filaSeleccion).toHaveProperty('antecedentesAdres');
    expect(filaSeleccion).toHaveProperty('aprobado');
    expect(filaSeleccion).toHaveProperty('razonNoAprobado');
  });

  it('entrega la ficha sin el bloque de selección a quien no ve perfiles completos', async () => {
    if (!hayArchivo) return;

    const reclutador = await request(app)
      .get(`/api/historico/candidatos/${muestra.id}`)
      .set(auth('reclutador'));

    expect(reclutador.status).toBe(200);
    expect(reclutador.body.datos.id).toBe(muestra.id);
    expect(reclutador.body.datos.estudios).toBeDefined();
    expect(reclutador.body.datos.seleccion).toBeUndefined();

    const seleccion = await request(app)
      .get(`/api/historico/candidatos/${muestra.id}`)
      .set(auth('seleccion'));

    expect(seleccion.body.datos.seleccion.evaluacion).toBeDefined();
    expect(seleccion.body.datos.seleccion.antecedentes).toBeDefined();
  });

  it('responde 404 para un id que no está en el archivo', async () => {
    if (!hayArchivo) return;

    const res = await request(app)
      .get('/api/historico/candidatos/999999999')
      .set(auth('reclutador'));

    expect(res.status).toBe(404);
  });
});
