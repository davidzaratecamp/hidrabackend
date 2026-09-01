'use strict';

/**
 * Pruebas de los endpoints portados en el paso 2: reportes, estadísticas,
 * analíticas, desprendibles y apoyo a reasignación.
 *
 * El Excel se verifica leyendo el archivo generado con ExcelJS, no solo
 * comprobando que la respuesta pese algo: el formato "BASE RECLUTAMIENTO" es un
 * documento oficial y el orden de sus columnas importa.
 */

const request = require('supertest');
const ExcelJS = require('exceljs');

const { pool, cerrarPool } = require('../../src/config/db');
const { construirContenedor } = require('../../src/container');
const { construirApp } = require('../../src/app');
const { crearEmailMemoria } = require('../../src/modules/integraciones/email');
const { crearFirmaCloudMemoria } = require('../../src/modules/integraciones/firmacloud');
const { crearServicioPassword } = require('../../src/shared/seguridad/password');

const PASSWORD = 'Hidra2026Segura';
const sufijo = Date.now();
const correo = (n) => `${n}.${sufijo}@prueba.local`;
/**
 * Fecha local en AAAA-MM-DD.
 *
 * NO se usa `toISOString()`: da la fecha en UTC, y la base escribe `created_at`
 * en la hora local del servidor. Con Colombia en UTC-5, después de las 19:00 las
 * dos fechas son días distintos y el rango del reporte dejaba fuera lo que
 * acababa de crearse. El fallo solo aparecía de noche.
 */
const aFechaLocal = (d) => {
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
};

// El rango del reporte de citados es sobre la fecha EN QUE se citó, que para el
// candidato de prueba es hoy. Se deja `manana` como cota superior del rango.
const hoy = aFechaLocal(new Date());
const manana = aFechaLocal(new Date(Date.now() + 86_400_000));

let app;
const usuariosCreados = [];
const candidatosCreados = [];
const sesiones = {};
const auth = (rol) => ({ Authorization: `Bearer ${sesiones[rol].token}` });

async function crearUsuario({ email, roles }) {
  const servicio = crearServicioPassword({ rondas: 10 });
  const hash = await servicio.hashear(PASSWORD);
  const [res] = await pool.query(
    'INSERT INTO usuarios (nombre_completo, email, password_hash) VALUES (?, ?, ?)',
    [`Usuario ${email}`, email, hash]
  );
  usuariosCreados.push(res.insertId);
  await pool.query(
    `INSERT INTO usuario_roles (usuario_id, rol_id)
     SELECT ?, id FROM roles WHERE codigo IN (${roles.map(() => '?').join(',')})`,
    [res.insertId, ...roles]
  );
  return res.insertId;
}

async function iniciarSesion(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { token: res.body.datos.token, usuario: res.body.datos.usuario };
}

/** Lleva un candidato hasta la decisión final, para que aparezca en los reportes. */
async function candidatoCompleto(nombre) {
  const creado = await request(app)
    .post('/api/candidatos')
    .set(auth('reclutador'))
    .send({
      nombreCompleto: nombre,
      tipoDocumento: 'CC',
      numeroDocumento: String(Date.now()).slice(-9) + candidatosCreados.length,
      edad: 30,
      email: correo(nombre.split(' ')[0].toLowerCase()),
      celular: '3005551234',
      contactoLlamada: true,
      contactoWhatsapp: true,
      cliente: 'Hogar',
      cargo: 'Agente',
      perfil: 'Comercial con experiencia',
    });
  expect(creado.status).toBe(201);
  const id = creado.body.datos.id;
  candidatosCreados.push(id);

  const avanzar = (estado, motivo) =>
    request(app)
      .post(`/api/candidatos/${id}/estado`)
      .set(auth('reclutador'))
      .send({ estado, motivo });

  await avanzar('contacto_exitoso');
  await avanzar('formularios_enviados');
  await avanzar('formularios_completados');

  // Citar y marcar asistencia son de Reclutamiento desde el 2026-08-31 (ver
  // db/seeds/001_roles_y_permisos.sql): Selección ya no tiene estos permisos.
  await request(app)
    .post(`/api/seleccion/candidatos/${id}/citacion`)
    .set(auth('reclutador'))
    .send({});

  await request(app)
    .post(`/api/seleccion/candidatos/${id}/asistencia`)
    .set(auth('reclutador'))
    .send({ asistio: 'asistio' });

  await request(app)
    .post(`/api/seleccion/candidatos/${id}/evaluacion`)
    .set(auth('seleccion'))
    .send({ puntajes: { saludo: 18, perfilamiento: 16, producto: 15, objeciones: 14, cierre: 17 } });

  await request(app)
    .post(`/api/antecedentes/candidatos/${id}`)
    .set(auth('seleccion'))
    .field('tipo', 'adres')
    .field('estado', 'aprobado');

  await request(app)
    .post(`/api/seleccion/candidatos/${id}/decision-final`)
    .set(auth('seleccion'))
    .send({ aprobacion: true, razon: 'Perfil idóneo' });

  return id;
}

beforeAll(async () => {
  app = construirApp(
    construirContenedor({ email: crearEmailMemoria(), firma: crearFirmaCloudMemoria() })
  );

  const reclutador = correo('rec');
  const seleccion = correo('sel');
  const admin = correo('adm');
  await crearUsuario({ email: reclutador, roles: ['reclutamiento'] });
  await crearUsuario({ email: seleccion, roles: ['seleccion'] });
  await crearUsuario({ email: admin, roles: ['administrador'] });

  sesiones.reclutador = await iniciarSesion(reclutador);
  sesiones.seleccion = await iniciarSesion(seleccion);
  sesiones.admin = await iniciarSesion(admin);

  await candidatoCompleto('Marcela Andrea Pineda Rojas');
}, 60_000);

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

describe('Exportación a Excel', () => {
  async function leerHoja(respuesta) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(respuesta.body);
    return workbook.worksheets[0];
  }

  it('exporta los citados con el formato oficial de dos filas de encabezado', async () => {
    const res = await request(app)
      .get(`/api/reportes/citados.xlsx?desde=${hoy}&hasta=${manana}`)
      .set(auth('seleccion'))
      .buffer()
      .parse((r, cb) => {
        const trozos = [];
        r.on('data', (t) => trozos.push(t));
        r.on('end', () => cb(null, Buffer.concat(trozos)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="citados-/);

    const hoja = await leerHoja(res);
    expect(hoja.getRow(1).getCell(1).value).toBe('FECHA');
    expect(hoja.getRow(1).getCell(2).value).toBe('ANALISTA');
    expect(hoja.getRow(1).getCell(3).value).toBe('CAMPAÑA');
    // Grupo CONTACTO se fusiona horizontalmente y reparte subtítulos.
    expect(hoja.getRow(2).getCell(10).value).toBe('LLAMADA');
    expect(hoja.getRow(2).getCell(11).value).toBe('WHATSAPP');

    // La fila de datos: el candidato del beforeAll.
    const fila = hoja.getRow(3);
    expect(fila.getCell(5).value).toBe('Marcela Andrea Pineda Rojas');
    expect(fila.getCell(3).value).toBe('Hogar');
    // PERFIL ya no sale en blanco: se captura en el registro (migración 007).
    expect(fila.getCell(12).value).toBe('Comercial con experiencia');
    // CITADO deja de ser 'Sí' fijo. Este candidato no lo diligenció, así que
    // cae a la citación real, que sí existe.
    expect(fila.getCell(13).value).toBe('Sí');
    // La FECHA sale de candidato_citaciones, no de una columna sin escritor.
    expect(fila.getCell(1).value).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it('exporta los aprobados con la decisión final reflejada', async () => {
    const res = await request(app)
      .get('/api/reportes/aprobados.xlsx')
      .set(auth('seleccion'))
      .buffer()
      .parse((r, cb) => {
        const trozos = [];
        r.on('data', (t) => trozos.push(t));
        r.on('end', () => cb(null, Buffer.concat(trozos)));
      });

    expect(res.status).toBe(200);
    const hoja = await leerHoja(res);
    const fila = hoja.getRow(3);
    expect(fila.getCell(5).value).toBe('Marcela Andrea Pineda Rojas');
    // APROBADO (columna 23) y antecedente ADRES (columna 19).
    expect(fila.getCell(23).value).toBe('Sí');
    expect(fila.getCell(19).value).toBe('Aprobado');
  });

  it('el rango filtra de verdad: un día sin citaciones sale sin filas', async () => {
    const res = await request(app)
      .get('/api/reportes/citados.xlsx?desde=2020-01-01&hasta=2020-01-02')
      .set(auth('seleccion'))
      .buffer()
      .parse((r, cb) => {
        const trozos = [];
        r.on('data', (t) => trozos.push(t));
        r.on('end', () => cb(null, Buffer.concat(trozos)));
      });

    expect(res.status).toBe(200);
    const hoja = await leerHoja(res);
    // Solo las dos filas de encabezado.
    expect(hoja.rowCount).toBe(2);
  });

  it('exige el rango de fechas en el reporte de citados', async () => {
    const res = await request(app).get('/api/reportes/citados.xlsx').set(auth('seleccion'));
    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('VALIDACION');
  });

  it('rechaza un rango invertido', async () => {
    const res = await request(app)
      .get('/api/reportes/citados.xlsx?desde=2026-08-30&hasta=2026-08-01')
      .set(auth('seleccion'));
    expect(res.status).toBe(400);
  });

  it('reclutamiento también puede generar reportes (decisión de negocio, 2026-09-01)', async () => {
    const res = await request(app)
      .get(`/api/reportes/citados.xlsx?desde=${hoy}&hasta=${hoy}`)
      .set(auth('reclutador'));
    expect(res.status).toBe(200);
  });
});

describe('Estadísticas y analíticas', () => {
  it('devuelve el resumen del embudo', async () => {
    const res = await request(app).get('/api/reportes/estadisticas').set(auth('seleccion'));
    expect(res.status).toBe(200);
    expect(res.body.datos.total_candidatos).toBeGreaterThanOrEqual(1);
    expect(res.body.datos.aprobados).toBeGreaterThanOrEqual(1);
    expect(res.body.datos.asistencia.asistio).toBeGreaterThanOrEqual(1);
  });

  it('promedia la evaluación por criterio', async () => {
    const res = await request(app)
      .get('/api/reportes/estadisticas/evaluacion')
      .set(auth('seleccion'));

    expect(res.status).toBe(200);
    expect(res.body.datos.porCriterio).toHaveLength(5);
    const saludo = res.body.datos.porCriterio.find((c) => c.codigo === 'saludo');
    expect(saludo.promedio).toBe(18);
    expect(saludo.puntajeMaximo).toBe(20);
    expect(res.body.datos.porcentajePromedio).toBe(80);
  });

  it('la serie de estados sale del historial, no de updated_at', async () => {
    const res = await request(app)
      .get('/api/reportes/analytics/estados-tiempo?dias=7')
      .set(auth('seleccion'));

    expect(res.status).toBe(200);
    const estados = res.body.datos.map((f) => f.estado);
    // El recorrido completo del candidato quedó registrado, paso por paso.
    expect(estados).toEqual(
      expect.arrayContaining(['nuevo', 'contacto_exitoso', 'citado', 'entrevistado', 'aprobado'])
    );
  });

  it('agrupa por cliente y por cargo', async () => {
    const clientes = await request(app)
      .get('/api/reportes/analytics/clientes')
      .set(auth('seleccion'));
    expect(clientes.status).toBe(200);
    expect(clientes.body.datos.find((c) => c.cliente === 'Hogar').total).toBeGreaterThanOrEqual(1);

    const cargos = await request(app)
      .get('/api/reportes/analytics/cargos?limite=5')
      .set(auth('seleccion'));
    expect(cargos.status).toBe(200);
    expect(cargos.body.datos.length).toBeLessThanOrEqual(5);
  });

  it('reporta el avance de los formularios', async () => {
    const res = await request(app)
      .get('/api/reportes/analytics/progreso')
      .set(auth('seleccion'));
    expect(res.status).toBe(200);
    expect(res.body.datos[0]).toMatchObject({ total: 6 });
  });

  it('las analíticas respetan la visibilidad por dueño', async () => {
    const otro = correo('otro-rec');
    await crearUsuario({ email: otro, roles: ['reclutamiento'] });
    const sesionOtro = await iniciarSesion(otro);

    const res = await request(app)
      .get('/api/reportes/analytics/clientes')
      .set({ Authorization: `Bearer ${sesionOtro.token}` });

    expect(res.status).toBe(200);
    // No tiene candidatos propios: no ve los de nadie más.
    expect(res.body.datos).toEqual([]);
  });
});

describe('Apoyo a reasignación', () => {
  it('lista los reclutadores activos con su carga', async () => {
    const res = await request(app).get('/api/usuarios/reclutadores').set(auth('admin'));
    expect(res.status).toBe(200);

    const mio = res.body.datos.find((r) => r.email === correo('rec'));
    expect(mio).toMatchObject({ cartera: expect.any(Number) });
    expect(mio.cartera).toBeGreaterThanOrEqual(1);
  });

  it('reasigna la cartera completa dejando traza por candidato', async () => {
    const destino = correo('destino');
    const destinoId = await crearUsuario({ email: destino, roles: ['reclutamiento'] });
    const origenId = sesiones.reclutador.usuario.id;

    const res = await request(app)
      .post('/api/candidatos/reasignar-cartera')
      .set(auth('admin'))
      .send({ origenId, destinoId, motivo: 'El reclutador sale del equipo' });

    expect(res.status).toBe(200);
    expect(res.body.datos.reasignados).toBeGreaterThanOrEqual(1);

    // Cada candidato movido tiene su propia fila de traza, no una sola global.
    const [filas] = await pool.query(
      `SELECT COUNT(*) AS total FROM candidato_asignaciones
        WHERE reclutador_anterior_id = ? AND reclutador_nuevo_id = ?`,
      [origenId, destinoId]
    );
    expect(Number(filas[0].total)).toBe(res.body.datos.reasignados);

    // Y el candidato cambió de dueño de verdad.
    const perfil = await request(app)
      .get(`/api/candidatos/${candidatosCreados[0]}`)
      .set(auth('admin'));
    expect(perfil.body.datos.reclutador_id).toBe(destinoId);
  });

  it('rechaza reasignar a uno mismo', async () => {
    const id = sesiones.reclutador.usuario.id;
    const res = await request(app)
      .post('/api/candidatos/reasignar-cartera')
      .set(auth('admin'))
      .send({ origenId: id, destinoId: id });

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('REASIGNACION_SIN_CAMBIO');
  });
});

describe('Desprendibles de nómina', () => {
  it('exige que el usuario tenga cédula registrada', async () => {
    const res = await request(app).get('/api/desprendibles/meses').set(auth('admin'));
    // Los usuarios de prueba se crean sin numero_documento.
    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('SIN_DOCUMENTO');
  });

  it('exige sesión', async () => {
    const res = await request(app).get('/api/desprendibles/meses');
    expect(res.status).toBe(401);
  });
});
