'use strict';

/**
 * Carga masiva de candidatos por Excel (`POST /candidatos/importar-excel`).
 *
 * Cubre la garantía central del feature: cada fila válida termina como si
 * viniera de `POST /candidatos` (mismos datos, `reclutador_id` = quien sube
 * el archivo, `Citado=Sí` cita de verdad), y el criterio "todo o nada": una
 * sola fila mala entre varias buenas no registra ninguna.
 */

const request = require('supertest');
const ExcelJS = require('exceljs');

const { pool, cerrarPool } = require('../../src/config/db');
const { construirContenedor } = require('../../src/container');
const { construirApp } = require('../../src/app');
const { crearEmailMemoria } = require('../../src/modules/integraciones/email');
const { crearFirmaCloudMemoria } = require('../../src/modules/integraciones/firmacloud');
const { crearServicioPassword } = require('../../src/shared/seguridad/password');
const { COLUMNAS } = require('../../src/modules/candidatos/candidato.importarExcel');

const PASSWORD = 'Hidra2026Segura';
const sufijo = Date.now();
const correo = (n) => `${n}.${sufijo}@prueba.local`;
const documento = (n) => `${sufijo}${n}`.slice(-15);

/**
 * Fila completa y válida para el Excel de importación, con `overrides` por
 * encima. Todos los campos del formulario "Nuevo Candidato" son obligatorios
 * (decisión de negocio, 2026-09-15) — este helper evita repetir los que no
 * son el foco de cada prueba puntual.
 */
function filaCandidatoBase(overrides = {}) {
  return {
    edad: '25',
    email: correo(`import-${Math.random().toString(36).slice(2, 8)}`),
    contactoLlamada: 'Sí',
    contactoWhatsapp: 'Sí',
    perfil: 'Perfil de prueba',
    citado: 'No',
    estadoGestion: '#Errado',
    fuenteReclutamiento: 'Computrabajo',
    ...overrides,
  };
}

let app;
const usuariosCreados = [];
const documentosDeCandidatos = [];

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

/** Arma un .xlsx en memoria con el mismo formato que la plantilla descargable. */
async function construirExcel(filas) {
  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet('Candidatos');
  hoja.addRow(COLUMNAS.map((c) => c.encabezado));
  for (const fila of filas) hoja.addRow(COLUMNAS.map((c) => fila[c.campo] ?? ''));
  return workbook.xlsx.writeBuffer();
}

function subir(rol, buffer) {
  return request(app)
    .post('/api/candidatos/importar-excel')
    .set(auth(rol))
    .attach('archivo', Buffer.from(buffer), 'candidatos.xlsx');
}

beforeAll(async () => {
  const email = crearEmailMemoria();
  const firma = crearFirmaCloudMemoria();
  app = construirApp(construirContenedor({ email, firma }));

  await crearUsuario({ email: correo('reclutador-import'), roles: ['reclutamiento'] });
  await crearUsuario({ email: correo('reclutador-import-2'), roles: ['reclutamiento'] });
  await crearUsuario({ email: correo('seleccion-import'), roles: ['seleccion'] });
  sesiones.reclutador = await iniciarSesion(correo('reclutador-import'));
  sesiones.reclutador2 = await iniciarSesion(correo('reclutador-import-2'));
  sesiones.seleccion = await iniciarSesion(correo('seleccion-import'));
});

afterAll(async () => {
  if (documentosDeCandidatos.length > 0) {
    await pool.query(
      `DELETE FROM candidatos WHERE numero_documento IN (${documentosDeCandidatos.map(() => '?').join(',')})`,
      documentosDeCandidatos
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

describe('Carga masiva de candidatos por Excel', () => {
  it('selección no tiene acceso (no crea candidatos)', async () => {
    const buffer = await construirExcel([]);
    const res = await subir('seleccion', buffer);
    expect(res.status).toBe(403);

    const plantilla = await request(app)
      .get('/api/candidatos/plantilla-importacion')
      .set(auth('seleccion'));
    expect(plantilla.status).toBe(403);
  });

  it('el reclutador descarga la plantilla', async () => {
    const res = await request(app)
      .get('/api/candidatos/plantilla-importacion')
      .set(auth('reclutador'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });

  it('archivo válido: crea todas las filas, atribuidas al reclutador que sube, y Citado=Sí cita de verdad', async () => {
    const docSinCitar = documento('01');
    const docCitado = documento('02');
    documentosDeCandidatos.push(docSinCitar, docCitado);

    const buffer = await construirExcel([
      filaCandidatoBase({
        cliente: 'Obamacare',
        cargo: 'Agente',
        nombreCompleto: 'Excel Sin Citar',
        tipoDocumento: 'CC',
        numeroDocumento: docSinCitar,
        celular: '3001110000',
        citado: 'No',
      }),
      filaCandidatoBase({
        cliente: 'obamacare', // minúsculas: el importador es flexible con catálogos
        cargo: ' Agente ', // espacios de más: también debe resolver
        nombreCompleto: 'Excel Citado',
        tipoDocumento: 'CC',
        numeroDocumento: docCitado,
        celular: '3002220000',
        citado: 'Sí',
        estadoGestion: undefined,
      }),
    ]);

    const res = await subir('reclutador', buffer);
    expect(res.status).toBe(200);
    expect(res.body.datos).toEqual({ creados: 2 });

    const lista = await request(app)
      .get(`/api/candidatos?busqueda=${docSinCitar}`)
      .set(auth('reclutador'));
    expect(lista.body.datos).toHaveLength(1);
    expect(lista.body.datos[0]).toMatchObject({
      estado: 'nuevo',
      primer_nombre: 'Excel',
    });
    expect(lista.body.datos[0].reclutador_email).toBe(correo('reclutador-import'));

    const citado = await request(app)
      .get(`/api/candidatos?busqueda=${docCitado}`)
      .set(auth('reclutador'));
    expect(citado.body.datos).toHaveLength(1);
    expect(citado.body.datos[0].estado).toBe('citado');
  });

  it('lee correctamente un correo que Excel convirtió en hipervínculo', async () => {
    // Al escribir un correo y presionar Enter/Tab, Excel lo autoconvierte en
    // hipervínculo: `celda.value` deja de ser un string y pasa a ser
    // `{ text, hyperlink }`. Bug real encontrado en uso: se leía como
    // "[object Object]" y el correo, perfectamente válido, se rechazaba con
    // "Invalid email address".
    const doc = documento('21');
    documentosDeCandidatos.push(doc);
    const correoLinkificado = 'laura.restrepo@gmail.com';

    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet('Candidatos');
    hoja.addRow(COLUMNAS.map((c) => c.encabezado));
    const fila = hoja.addRow(
      COLUMNAS.map((c) => {
        const valores = filaCandidatoBase({
          cliente: 'Obamacare',
          cargo: 'Agente',
          nombreCompleto: 'Excel Correo Hipervinculo',
          tipoDocumento: 'CC',
          numeroDocumento: doc,
          celular: '3006660000',
        });
        return valores[c.campo] ?? '';
      })
    );
    const columnaCorreo = COLUMNAS.findIndex((c) => c.campo === 'email') + 1;
    fila.getCell(columnaCorreo).value = {
      text: correoLinkificado,
      hyperlink: `mailto:${correoLinkificado}`,
    };

    const res = await subir('reclutador', await workbook.xlsx.writeBuffer());
    expect(res.status).toBe(200);
    expect(res.body.datos).toEqual({ creados: 1 });

    const lista = await request(app).get(`/api/candidatos?busqueda=${doc}`).set(auth('reclutador'));
    expect(lista.body.datos[0].email).toBe(correoLinkificado);
  });

  it('todo o nada: una fila mala entre varias buenas no registra ninguna', async () => {
    const docBueno1 = documento('11');
    const docBueno2 = documento('12');
    // No se agregan a documentosDeCandidatos a propósito: si el test falla y
    // de verdad se crearan, el afterAll de este archivo no los limpiaría —
    // pero ese es justo el comportamiento que el test verifica que NO pasa.

    const buffer = await construirExcel([
      filaCandidatoBase({
        cliente: 'Obamacare',
        cargo: 'Agente',
        nombreCompleto: 'Bueno Uno',
        tipoDocumento: 'CC',
        numeroDocumento: docBueno1,
        celular: '3003330000',
      }),
      filaCandidatoBase({
        cliente: 'Obamacare',
        cargo: 'Cargo Que No Existe',
        nombreCompleto: 'Fila Mala',
        tipoDocumento: 'CC',
        numeroDocumento: documento('99'),
        celular: '3004440000',
      }),
      filaCandidatoBase({
        cliente: 'Obamacare',
        cargo: 'Agente',
        nombreCompleto: 'Bueno Dos',
        tipoDocumento: 'CC',
        numeroDocumento: docBueno2,
        celular: '3005550000',
      }),
    ]);

    const res = await subir('reclutador', buffer);
    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('ERRORES_EN_ARCHIVO');
    expect(res.body.error.detalles.filas).toHaveLength(1);
    // Fila 3 de la hoja: encabezado en la fila 1, "Fila Mala" es la segunda de datos.
    expect(res.body.error.detalles.filas[0].fila).toBe(3);
    expect(res.body.error.detalles.filas[0].errores[0]).toMatch(/Cargo Que No Existe/);

    const buenos = await request(app)
      .get(`/api/candidatos?busqueda=${docBueno1}`)
      .set(auth('reclutador'));
    expect(buenos.body.datos).toHaveLength(0);
  });

  it('dos reclutadores suben, al mismo tiempo, un archivo con el mismo documento: solo uno gana, ninguno queda a medias', async () => {
    const docCompartido = documento('31');
    documentosDeCandidatos.push(docCompartido);

    const filaCon = (nombre) => filaCandidatoBase({
      cliente: 'Obamacare',
      cargo: 'Agente',
      nombreCompleto: nombre,
      tipoDocumento: 'CC',
      numeroDocumento: docCompartido,
      celular: '3007770000',
    });

    const [bufferA, bufferB] = await Promise.all([
      construirExcel([filaCon('Carrera Reclutador Uno')]),
      construirExcel([filaCon('Carrera Reclutador Dos')]),
    ]);

    const [resA, resB] = await Promise.all([
      subir('reclutador', bufferA),
      subir('reclutador2', bufferB),
    ]);

    // Uno de los dos gana la carrera (200) y el otro pierde (400, documento
    // duplicado) — no importa cuál, pero nunca los dos a la vez ni ninguno.
    const resultados = [resA, resB];
    const exitosos = resultados.filter((r) => r.status === 200);
    const fallidos = resultados.filter((r) => r.status === 400);
    expect(exitosos).toHaveLength(1);
    expect(fallidos).toHaveLength(1);

    // El que pierde recibe el mismo formato de error por fila que cualquier
    // otra validación, no un 409 genérico sin decir cuál fue el problema.
    expect(fallidos[0].body.error.codigo).toBe('ERRORES_EN_ARCHIVO');
    expect(fallidos[0].body.error.detalles.filas[0].errores[0]).toMatch(/ya existe un candidato/);

    // La restricción UNIQUE de la base protegió la integridad: quedó
    // exactamente un candidato con ese documento, nunca cero ni dos.
    const lista = await request(app)
      .get(`/api/candidatos?busqueda=${docCompartido}`)
      .set(auth('reclutador'));
    expect(lista.body.datos).toHaveLength(1);
  });
});
