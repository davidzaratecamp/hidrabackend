'use strict';

/**
 * Integración con el Gestor Técnico (contratación en RRHH), fases 5 y 6.
 *
 * Gestor se sustituye por el adaptador en memoria: aquí se prueba el lado de
 * Hydra (elegibilidad, outbox, reintentos y los avisos de vuelta). La prueba con
 * los dos sistemas reales corriendo en local es la Fase 8.5 de conexionhydra.md.
 */

// Credenciales del canal Gestor → Hydra, antes de que se cargue la configuración.
process.env.GESTOR_CALLBACK_API_KEY = 'clave-prueba-gestor-a-hydra';
process.env.GESTOR_CALLBACK_HMAC_SECRET = 'secreto-prueba-gestor-a-hydra-0123456789';

const request = require('supertest');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const { pool, cerrarPool } = require('../../src/config/db');
const config = require('../../src/config/env');
const { construirContenedor } = require('../../src/container');
const { construirApp } = require('../../src/app');
const { crearServicioPassword } = require('../../src/shared/seguridad/password');
const { crearGestorMemoria } = require('../../src/modules/integraciones/gestor');
const { crearFirmaCloudMemoria } = require('../../src/modules/integraciones/firmacloud');
const { borrarArchivos } = require('../../src/shared/middleware/subirArchivo');
const { firmar } = require('../../src/shared/seguridad/firmaHmac');

const SOPORTE = path.join(__dirname, '..', 'fixtures', 'soporte.pdf');

const PASSWORD = 'Hidra2026Segura';
const sufijo = Date.now();
const correo = (n) => `contr.${n}.${sufijo}@prueba.local`;

let app;
let contenedor;
let gestor;
let firma;
let respuestaGestor;
// Los documentos (migración 021) se responden aparte: siempre recibidos.
const respuestaDocumento = () => ({ status: 200, codigo: null, cuerpo: { success: true }, error: null });
let tokenAdmin;
let tokenReclutamiento;
let tokenSeleccion;
let tokenFormacion;
let tokenContratacion;
const usuariosCreados = [];
const candidatosCreados = [];
const lotesCreados = [];

async function crearUsuario({ email, roles }) {
  const hash = await crearServicioPassword({ rondas: 10 }).hashear(PASSWORD);
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

const auth = () => ({ Authorization: `Bearer ${tokenAdmin}` });

async function crearCandidato(nombreCompleto, cargo = 'Agente') {
  const res = await request(app)
    .post('/api/candidatos')
    .set(auth())
    .send({
      nombreCompleto,
      tipoDocumento: 'CC',
      celular: '3000000000',
      numeroDocumento: `8${String(Date.now()).slice(-8)}${candidatosCreados.length}`,
      edad: 25,
      email: correo(`c${candidatosCreados.length}`),
      contactoLlamada: true,
      contactoWhatsapp: true,
      perfil: 'Perfil de prueba',
      citado: false,
      estadoGestion: '#Errado',
      fuenteReclutamiento: 'Computrabajo',
      cliente: 'Obamacare',
      cargo,
    });
  expect(res.status).toBe(201);
  candidatosCreados.push(res.body.datos.id);
  return res.body.datos.id;
}

/** Lleva un candidato hasta "aprobado_final" por la máquina de estados real. */
async function aprobarFinal(id) {
  for (const estado of ['contacto_exitoso', 'formularios_enviados', 'formularios_completados',
    'citado', 'entrevistado', 'aprobado', 'aprobado_final']) {
    const res = await request(app).post(`/api/candidatos/${id}/estado`).set(auth()).send({ estado });
    expect(res.status, `→ ${estado}: ${JSON.stringify(res.body)}`).toBe(200);
  }
}

async function citarFormacion(id) {
  const res = await request(app)
    .post(`/api/seleccion/candidatos/${id}/citacion-formacion`)
    .set(auth())
    .send({ citado: true });
  expect(res.status).toBe(200);
}

/**
 * Asistió y activo (Agente, lo marca Formación) o solo activo (Staff, lo marca
 * Contratación). Requisito para enviar a contratación.
 */
async function marcarFormacion(id, { agente = true, token = tokenAdmin } = {}) {
  const cabeceras = { Authorization: `Bearer ${token}` };
  if (agente) {
    const res = await request(app).put(`/api/formacion/candidatos/${id}/asistencia`).set(cabeceras).send({ asistio: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  const ruta = agente ? `/api/formacion/candidatos/${id}/estado` : `/api/formacion/por-contratar/${id}/estado`;
  const res = await request(app).put(ruta).set(cabeceras).send({ estado: 'activo' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

/**
 * Hoja de vida y tratamiento de datos enviados a FirmaCloud (de memoria) y, por
 * defecto, firmados por el candidato: requisito para enviar (migración 021).
 */
async function firmarDocumentos(id, { firmado = true } = {}) {
  const { referencia } = await firma.enviar({
    nombreCandidato: `Candidato ${id}`,
    emailCandidato: '',
    referenciaInterna: id,
    cvPdf: Buffer.from(`%PDF-1.4\n% hoja de vida firmada ${id}\n`),
    tratamientoPdf: Buffer.from(`%PDF-1.4\n% tratamiento de datos firmado ${id}\n`),
  });
  await pool.query(
    "INSERT INTO candidato_firmas (candidato_id, proveedor, referencia_externa, estado) VALUES (?, 'firmacloud', ?, 'enviado')",
    [id, referencia]
  );
  if (firmado) firma.marcarFirmado(referencia);
  return referencia;
}

async function cargarAntecedente(id, tipo) {
  const res = await request(app)
    .post(`/api/antecedentes/candidatos/${id}`)
    .set(auth())
    .field('tipo', tipo)
    .field('estado', 'aprobado')
    .attach('documento', SOPORTE);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

const enviosDocumento = (id) => gestor.enviados.filter((e) => e.ruta.startsWith(`/candidatos/${id}/documentos/`));

/** Petición firmada como la haría Gestor. */
function desdeGestor(ruta, cuerpo, { secreto = process.env.GESTOR_CALLBACK_HMAC_SECRET, ts } = {}) {
  const texto = JSON.stringify(cuerpo);
  const timestamp = ts ?? String(Math.floor(Date.now() / 1000));
  return request(app)
    .post(`/api/integraciones/gestor/v1${ruta}`)
    .set({
      'Content-Type': 'application/json',
      'X-Api-Key': process.env.GESTOR_CALLBACK_API_KEY,
      'X-Timestamp': timestamp,
      'X-Signature': firmar(secreto, timestamp, texto),
      'Idempotency-Key': randomUUID(),
    })
    .send(texto);
}

beforeAll(async () => {
  gestor = crearGestorMemoria({
    responder: (envio) => (envio.ruta.includes('/documentos/') ? respuestaDocumento(envio) : respuestaGestor(envio)),
  });
  firma = crearFirmaCloudMemoria();
  contenedor = construirContenedor({ gestor, firma, despachoInmediato: false });
  app = construirApp(contenedor);
  tokenAdmin = await crearUsuario({ email: correo('admin'), roles: ['administrador'] });
  tokenReclutamiento = await crearUsuario({ email: correo('rec'), roles: ['reclutamiento'] });
  tokenSeleccion = await crearUsuario({ email: correo('sel'), roles: ['seleccion'] });
  tokenFormacion = await crearUsuario({ email: correo('form'), roles: ['formacion'] });
  tokenContratacion = await crearUsuario({ email: correo('contr'), roles: ['contratacion'] });
}, 30_000);

afterAll(async () => {
  if (lotesCreados.length > 0) {
    await pool.query(`DELETE FROM contratacion_lotes WHERE id IN (${lotesCreados.map(() => '?').join(',')})`, lotesCreados);
  }
  if (candidatosCreados.length > 0) {
    const marcas = candidatosCreados.map(() => '?').join(',');
    // Soportes y copias de los firmados: las filas caen en cascada, los archivos no.
    const [documentos] = await pool.query(
      `SELECT ruta_archivo FROM candidato_documentos WHERE candidato_id IN (${marcas})`,
      candidatosCreados
    );
    await borrarArchivos(documentos.map((d) => path.join(config.archivos.directorio, d.ruta_archivo)));
    await pool.query(`DELETE FROM candidatos WHERE id IN (${marcas})`, candidatosCreados);
  }
  if (usuariosCreados.length > 0) {
    await pool.query(`DELETE FROM usuarios WHERE id IN (${usuariosCreados.map(() => '?').join(',')})`, usuariosCreados);
  }
  await cerrarPool();
});

describe('Contratación en Gestor — Fase 5 (envío) y Fase 6 (avisos)', () => {
  let listo;       // Agente aprobado y citado a formación
  let sinCitacion; // Agente aprobado, sin citación
  let otro;        // Agente que se descarta
  let sinFirmar;   // Agente listo en todo, menos en la firma
  let lote;
  const notas = () => ({ [listo]: 'Policía en trámite', [otro]: 'Los traerá el primer día' });

  it('prepara candidatos en distintos puntos del proceso', async () => {
    listo = await crearCandidato('Contratable Uno Prueba');
    sinCitacion = await crearCandidato('Sin Citacion Dos Prueba');
    otro = await crearCandidato('Descartable Tres Prueba');
    sinFirmar = await crearCandidato('Sinfirma Cuatro Prueba');
    for (const id of [listo, sinCitacion, otro, sinFirmar]) await aprobarFinal(id);
    for (const id of [listo, otro, sinFirmar]) {
      await citarFormacion(id);
      await marcarFormacion(id);
    }
    await firmarDocumentos(listo);
    await firmarDocumentos(otro);
    await cargarAntecedente(listo, 'adres');
  }, 60_000);

  it('sin el permiso enviar_contratacion → 403', async () => {
    const res = await request(app).get('/api/contratacion/lotes').set({ Authorization: `Bearer ${tokenReclutamiento}` });
    expect(res.status).toBe(403);
  });

  it('lista los elegibles y explica por qué uno no lo es', async () => {
    const res = await request(app).get('/api/contratacion/elegibles').set(auth());
    expect(res.status).toBe(200);
    const a = res.body.datos.find((c) => c.id === listo);
    const b = res.body.datos.find((c) => c.id === sinCitacion);
    expect(a.elegible).toBe(true);
    expect(a.antecedentesFaltantes).toEqual(['Antecedentes de Policía', 'Comparendos', 'Procuraduría']);
    expect(b.elegible).toBe(false);
    expect(b.motivoNoElegible).toMatch(/formación/);
  });

  it('sin la firma de la hoja de vida y el tratamiento no es elegible; firmado sí, y queda guardado', async () => {
    const elegible = async () =>
      (await request(app).get('/api/contratacion/elegibles').set(auth())).body.datos.find((c) => c.id === sinFirmar);

    expect((await elegible()).motivoNoElegible).toMatch(/enviados a firma/);

    const referencia = await firmarDocumentos(sinFirmar, { firmado: false });
    expect(await elegible()).toMatchObject({ elegible: false, motivoNoElegible: expect.stringMatching(/No ha firmado/) });

    firma.marcarFirmado(referencia);
    expect((await elegible()).elegible).toBe(true);
    const [[fila]] = await pool.query('SELECT estado FROM candidato_firmas WHERE referencia_externa = ?', [referencia]);
    expect(fila.estado).toBe('signed');
  });

  it('si le faltan antecedentes exige una nota para RRHH', async () => {
    const res = await request(app).post('/api/contratacion/lotes').set(auth()).send({ nombre: 'Sin nota', candidatoIds: [listo] });
    expect(res.status).toBe(409);
    expect(res.body.error.detalles[0].motivo).toMatch(/Policía, Comparendos, Procuraduría.*nota/);
  });

  it('rechaza un lote con un candidato no elegible y no crea nada', async () => {
    const res = await request(app)
      .post('/api/contratacion/lotes')
      .set(auth())
      .send({ nombre: 'Lote inválido', candidatoIds: [listo, sinCitacion], notasAntecedentes: notas() });
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('CANDIDATOS_NO_ELEGIBLES');
    expect(res.body.error.detalles).toHaveLength(1);
    const [[fila]] = await pool.query('SELECT COUNT(*) AS n FROM contratacion_candidatos WHERE candidato_id = ?', [listo]);
    expect(Number(fila.n)).toBe(0);
  });

  it('crea el lote con su envío pendiente (outbox) en una sola operación', async () => {
    const res = await request(app)
      .post('/api/contratacion/lotes')
      .set(auth())
      .send({
        nombre: 'Formación prueba',
        fechaIngresoSugerida: '2026-10-06',
        candidatoIds: [listo, otro],
        notasAntecedentes: notas(),
      });
    expect(res.status).toBe(201);
    lote = res.body.datos;
    lotesCreados.push(lote.id);
    expect(lote.lote_externo_id).toMatch(/^HYD-\d{8}-\d+-[0-9a-f]{8}$/);
    expect(lote.candidatos.map((c) => c.estado)).toEqual(['en_cola', 'en_cola']);
    expect(lote.candidatos.find((c) => c.candidato_id === listo).nota_antecedentes).toBe('Policía en trámite');
    // El lote y después un envío por documento: 2 firmados + ADRES de uno, 2 firmados del otro.
    expect(lote.envios[0]).toMatchObject({ tipo: 'lote', estado: 'pendiente', metodo: 'POST', ruta: '/lotes' });
    expect(lote.envios.slice(1).map((e) => e.ruta).sort()).toEqual([
      `/candidatos/${listo}/documentos/antecedente_adres`,
      `/candidatos/${listo}/documentos/hoja_vida_firmada`,
      `/candidatos/${listo}/documentos/tratamiento_datos_firmado`,
      `/candidatos/${otro}/documentos/hoja_vida_firmada`,
      `/candidatos/${otro}/documentos/tratamiento_datos_firmado`,
    ].sort());
    expect(lote.envios.slice(1).every((e) => e.tipo === 'documento' && e.metodo === 'PUT')).toBe(true);
  });

  it('no deja enviar dos veces al mismo candidato', async () => {
    const res = await request(app)
      .post('/api/contratacion/lotes')
      .set(auth())
      .send({ nombre: 'Otro lote', candidatoIds: [listo], notasAntecedentes: notas() });
    expect(res.status).toBe(409);
    expect(res.body.error.detalles[0].motivo).toMatch(/otro lote/);
  });

  it('Gestor caído (500) → el envío queda pendiente con un intento y reintento programado; los documentos esperan al lote', async () => {
    respuestaGestor = () => ({ status: 500, codigo: null, cuerpo: null, error: 'HTTP 500' });
    const procesados = await contenedor.servicios.contratacionServicio.despacharPendientes();
    expect(procesados).toEqual([expect.objectContaining({ tipo: 'lote', estado: 'pendiente' })]);
    const [[envio]] = await pool.query(
      "SELECT estado, intentos, proximo_intento > NOW() AS futuro FROM contratacion_envios WHERE lote_id = ? AND tipo = 'lote'",
      [lote.id]
    );
    expect(envio).toMatchObject({ estado: 'pendiente', intentos: 1, futuro: 1 });
    expect(enviosDocumento(listo)).toHaveLength(0);
  });

  it('cuando Gestor responde, el envío sale con el contrato correcto y los candidatos pasan a "recibido"', async () => {
    await pool.query('UPDATE contratacion_envios SET proximo_intento = NOW() WHERE lote_id = ?', [lote.id]);
    respuestaGestor = (envio) => ({
      status: 201,
      codigo: null,
      cuerpo: {
        success: true,
        candidatos: envio.payload.candidatos.map((c) => ({ hydra_candidato_id: c.hydra_candidato_id, resultado: 'creado' })),
      },
      error: null,
    });
    await contenedor.servicios.contratacionServicio.despacharPendientes();

    const envioLote = gestor.enviados.filter((e) => e.ruta === '/lotes');
    const ultimo = envioLote.at(-1);
    expect(ultimo.metodo).toBe('POST');
    expect(ultimo.payload).toMatchObject({
      lote_externo_id: lote.lote_externo_id,
      fecha_ingreso_sugerida: '2026-10-06',
    });
    const enviado = ultimo.payload.candidatos.find((c) => c.hydra_candidato_id === listo);
    expect(enviado).toMatchObject({
      version: 1,
      identificacion: { tipo: 'CC' },
      nombres: { primer_nombre: 'Contratable', primer_apellido: 'Uno' },
      proceso: { cliente: 'Obamacare', cargo: 'Agente' },
      documentos: {
        firmados: ['hoja_vida_firmada', 'tratamiento_datos_firmado'],
        antecedentes_faltantes: ['Antecedentes de Policía', 'Comparendos', 'Procuraduría'],
        nota_antecedentes: 'Policía en trámite',
      },
    });
    // El reintento usa la MISMA Idempotency-Key que el primer intento.
    expect(envioLote.at(-2).idempotencyKey).toBe(ultimo.idempotencyKey);

    const detalle = await request(app).get(`/api/contratacion/lotes/${lote.id}`).set(auth());
    expect(detalle.body.datos.candidatos.map((c) => c.estado)).toEqual(['recibido', 'recibido']);
    expect(detalle.body.datos.envios.every((e) => e.estado === 'enviado')).toBe(true);
  });

  it('después del lote salen los documentos: los firmados (copia de FirmaCloud) y el antecedente, con su hash', async () => {
    const documentos = enviosDocumento(listo);
    expect(documentos.map((d) => d.payload.tipo)).toEqual(['hoja_vida_firmada', 'tratamiento_datos_firmado', 'antecedente_adres']);

    const [cv, , adres] = documentos.map((d) => d.payload);
    const bytesCv = Buffer.from(cv.contenido_base64, 'base64');
    expect(bytesCv.toString()).toContain(`hoja de vida firmada ${listo}`);
    expect(cv).toMatchObject({ nombre: 'Hoja de vida firmada', mime_type: 'application/pdf' });
    expect(cv.sha256).toBe(createHash('sha256').update(bytesCv).digest('hex'));
    expect(Buffer.from(adres.contenido_base64, 'base64').equals(fs.readFileSync(SOPORTE))).toBe(true);
    expect(adres).toMatchObject({ nombre: 'ADRES', nombre_archivo: 'soporte.pdf' });

    // Hydra se queda con una copia de lo firmado, para que un reintento mande lo mismo.
    const [copias] = await pool.query(
      `SELECT t.codigo FROM candidato_documentos d JOIN tipos_documento_adjunto t ON t.id = d.tipo_id
        WHERE d.candidato_id = ? AND t.codigo IN ('hoja_vida_firmada', 'tratamiento_datos_firmado')`,
      [listo]
    );
    expect(copias.map((c) => c.codigo).sort()).toEqual(['hoja_vida_firmada', 'tratamiento_datos_firmado']);
  });

  it('reenviar sube la versión, encola un PUT y vuelve a mandar los documentos, sin descargar de nuevo lo firmado', async () => {
    await cargarAntecedente(listo, 'policia');
    const res = await request(app).post(`/api/contratacion/candidatos/${listo}/reenviar`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.datos).toMatchObject({ version: 2, estado: 'en_cola' });

    const antes = enviosDocumento(listo).length;
    respuestaGestor = () => ({ status: 200, codigo: null, cuerpo: { success: true, candidato: { hydra_candidato_id: listo, resultado: 'actualizado' } }, error: null });
    await contenedor.servicios.contratacionServicio.despacharPendientes();
    const put = gestor.enviados.filter((e) => e.ruta === `/candidatos/${listo}`).at(-1);
    expect(put.metodo).toBe('PUT');
    expect(put.payload.version).toBe(2);
    expect(put.payload.documentos).toMatchObject({
      antecedentes_faltantes: ['Comparendos', 'Procuraduría'],
      nota_antecedentes: 'Policía en trámite',
    });
    expect(enviosDocumento(listo).slice(antes).map((d) => d.payload.tipo)).toEqual([
      'hoja_vida_firmada', 'tratamiento_datos_firmado', 'antecedente_adres', 'antecedente_policia',
    ]);
    const [[copias]] = await pool.query(
      `SELECT COUNT(*) AS n FROM candidato_documentos d JOIN tipos_documento_adjunto t ON t.id = d.tipo_id
        WHERE d.candidato_id = ? AND t.codigo = 'hoja_vida_firmada'`,
      [listo]
    );
    expect(Number(copias.n)).toBe(1);
    const [[fila]] = await pool.query('SELECT estado FROM contratacion_candidatos WHERE candidato_id = ?', [listo]);
    expect(fila.estado).toBe('recibido');
  });

  it('un documento que ya no está en disco deja su envío fallido, sin tocar al candidato', async () => {
    await request(app).post(`/api/contratacion/candidatos/${listo}/reenviar`).set(auth());
    const [[adres]] = await pool.query(
      `SELECT d.ruta_archivo FROM candidato_documentos d JOIN tipos_documento_adjunto t ON t.id = d.tipo_id
        WHERE d.candidato_id = ? AND t.codigo = 'antecedente_adres'`,
      [listo]
    );
    fs.unlinkSync(path.join(config.archivos.directorio, adres.ruta_archivo));

    await contenedor.servicios.contratacionServicio.despacharPendientes();
    const [[envio]] = await pool.query(
      `SELECT estado, ultimo_error FROM contratacion_envios
        WHERE candidato_id = ? AND ruta LIKE '%antecedente_adres' ORDER BY id DESC LIMIT 1`,
      [listo]
    );
    expect(envio.estado).toBe('fallido');
    expect(envio.ultimo_error).toMatch(/ya no está en Hydra/);
    const [[fila]] = await pool.query('SELECT estado FROM contratacion_candidatos WHERE candidato_id = ?', [listo]);
    expect(fila.estado).toBe('recibido');
  });

  it('un rechazo permanente de Gestor (422) deja el envío fallido y el candidato con error visible', async () => {
    await request(app).post(`/api/contratacion/candidatos/${otro}/reenviar`).set(auth());
    respuestaGestor = () => ({ status: 422, codigo: 'REGLA_CONTRATACION', cuerpo: null, error: 'HTTP 422 REGLA_CONTRATACION: ya registrado' });
    await contenedor.servicios.contratacionServicio.despacharPendientes();
    const [[fila]] = await pool.query('SELECT estado, detalle FROM contratacion_candidatos WHERE candidato_id = ?', [otro]);
    expect(fila.estado).toBe('error');
    expect(fila.detalle).toMatch(/422/);

    const [[envio]] = await pool.query("SELECT id, estado FROM contratacion_envios WHERE candidato_id = ? AND tipo = 'actualizacion'", [otro]);
    expect(envio.estado).toBe('fallido');
    const reintento = await request(app).post(`/api/contratacion/envios/${envio.id}/reintentar`).set(auth());
    expect(reintento.status).toBe(200);
    const otraVez = await request(app).post(`/api/contratacion/envios/${envio.id}/reintentar`).set(auth());
    expect(otraVez.status).toBe(409);
    respuestaGestor = () => ({ status: 200, codigo: null, cuerpo: { success: true, candidato: { hydra_candidato_id: otro, resultado: 'actualizado' } }, error: null });
    await contenedor.servicios.contratacionServicio.despacharPendientes();
  });

  // ---------------------------------------------------------------- Fase 6 --

  it('aviso de Gestor con firma inválida o vencida → 401', async () => {
    const cuerpo = { hydra_candidato_id: listo, users_company_id: 555 };
    expect((await desdeGestor('/contrataciones', cuerpo, { secreto: 'otro-secreto-cualquiera-1234' })).status).toBe(401);
    expect((await desdeGestor('/contrataciones', cuerpo, { ts: String(Math.floor(Date.now() / 1000) - 600) })).status).toBe(401);
    const sinFirma = await request(app).post('/api/integraciones/gestor/v1/contrataciones').send(cuerpo);
    expect(sinFirma.status).toBe(401);
  });

  it('aviso de contratación → el candidato pasa a "contratado" con su traza', async () => {
    const res = await desdeGestor('/contrataciones', {
      hydra_candidato_id: listo, users_company_id: 555, fecha_ingreso: '2026-10-06', lote_externo_id: lote.lote_externo_id,
    });
    expect(res.status).toBe(200);
    expect(res.body.datos).toMatchObject({ estado: 'contratado', usersCompanyId: 555 });

    const candidato = await request(app).get(`/api/candidatos/${listo}`).set(auth());
    expect(candidato.body.datos.estado).toBe('contratado');
    const ultimo = candidato.body.datos.historial.at(-1);
    expect(ultimo).toMatchObject({ estado_anterior: 'aprobado_final', estado_nuevo: 'contratado', usuario: null });
    expect(ultimo.motivo).toMatch(/Gestor Técnico.*#555/);

    const [[fila]] = await pool.query('SELECT estado, users_company_id FROM contratacion_candidatos WHERE candidato_id = ?', [listo]);
    expect(fila).toMatchObject({ estado: 'registrado', users_company_id: 555 });
  });

  it('el mismo aviso repetido (reintento de Gestor) responde 200 sin duplicar la traza', async () => {
    const res = await desdeGestor('/contrataciones', { hydra_candidato_id: listo, users_company_id: 555 });
    expect(res.status).toBe(200);
    const candidato = await request(app).get(`/api/candidatos/${listo}`).set(auth());
    expect(candidato.body.datos.historial.filter((h) => h.estado_nuevo === 'contratado')).toHaveLength(1);
  });

  it('ya registrado: no se puede reenviar ni cancelar', async () => {
    expect((await request(app).post(`/api/contratacion/candidatos/${listo}/reenviar`).set(auth())).status).toBe(409);
    expect((await request(app).post(`/api/contratacion/candidatos/${listo}/cancelar`).set(auth()).send({ motivo: 'No aplica' })).status).toBe(409);
  });

  it('aviso de descarte → queda como nota, sin cambiar el estado en Hydra', async () => {
    const res = await desdeGestor('/descartes', { hydra_candidato_id: otro, motivo: 'No firmó el contrato' });
    expect(res.status).toBe(200);
    const [[fila]] = await pool.query('SELECT estado, detalle FROM contratacion_candidatos WHERE candidato_id = ?', [otro]);
    expect(fila.estado).toBe('descartado');
    expect(fila.detalle).toMatch(/No firmó el contrato/);
    const candidato = await request(app).get(`/api/candidatos/${otro}`).set(auth());
    expect(candidato.body.datos.estado).toBe('aprobado_final');
  });

  it('aviso de contratación para un candidato que no está aprobado → 422; para uno desconocido → 404', async () => {
    await pool.query("UPDATE contratacion_candidatos SET estado = 'recibido' WHERE candidato_id = ?", [otro]);
    await request(app).post(`/api/candidatos/${otro}/estado`).set(auth()).send({ estado: 'rechazado_final', motivo: 'Prueba' });
    const res = await desdeGestor('/contrataciones', { hydra_candidato_id: otro, users_company_id: 556 });
    expect(res.status).toBe(422);
    expect(res.body.error.codigo).toBe('ESTADO_NO_PERMITE_CONTRATAR');

    expect((await desdeGestor('/contrataciones', { hydra_candidato_id: 999999999, users_company_id: 1 })).status).toBe(404);
  });

  it('payload inválido desde Gestor → 400', async () => {
    const res = await desdeGestor('/contrataciones', { hydra_candidato_id: 'x' });
    expect(res.status).toBe(400);
  });

  it('cancelar encola la cancelación hacia Gestor', async () => {
    await pool.query("UPDATE contratacion_candidatos SET estado = 'recibido' WHERE candidato_id = ?", [otro]);
    const res = await request(app).post(`/api/contratacion/candidatos/${otro}/cancelar`).set(auth()).send({ motivo: 'Desistió del proceso' });
    expect(res.status).toBe(200);
    expect(res.body.datos.estado).toBe('cancelado');
    respuestaGestor = () => ({ status: 200, codigo: null, cuerpo: { success: true }, error: null });
    await contenedor.servicios.contratacionServicio.despacharPendientes();
    expect(gestor.enviados.at(-1)).toMatchObject({ metodo: 'POST', ruta: `/candidatos/${otro}/cancelar`, payload: { motivo: 'Desistió del proceso' } });
  });
});

describe('Roles Formación y Contratación (migraciones 019 y 020)', () => {
  let agente;  // Agente aprobado y citado a formación
  let staff;   // Staff aprobado y marcado como contratación
  let sinPaso; // Agente aprobado, sin citación: no está en ninguna cola
  const comoFormacion = () => ({ Authorization: `Bearer ${tokenFormacion}` });
  const comoContratacion = () => ({ Authorization: `Bearer ${tokenContratacion}` });
  const buscarEn = async (ruta, cabeceras, id) => {
    const res = await request(app).get(ruta).set(cabeceras);
    expect(res.status).toBe(200);
    return res.body.datos.find((c) => c.id === id);
  };
  const enFormacion = (id) => buscarEn('/api/formacion/candidatos', comoFormacion(), id);
  const porContratar = (id) => buscarEn('/api/formacion/por-contratar', comoContratacion(), id);

  it('prepara un Agente citado, un Staff con contratación y un aprobado sin paso', async () => {
    agente = await crearCandidato('Formacion Agente Prueba');
    staff = await crearCandidato('Formacion Staff Prueba', 'Coordinador');
    sinPaso = await crearCandidato('Formacion Sinpaso Prueba');
    for (const id of [agente, staff, sinPaso]) await aprobarFinal(id);
    await firmarDocumentos(agente);
    await firmarDocumentos(staff);
    await citarFormacion(agente);
    const res = await request(app).post(`/api/seleccion/candidatos/${staff}/contratacion`).set(auth()).send({ contratado: true });
    expect(res.status).toBe(200);
  }, 60_000);

  it('cada rol ve solo su cola: Formación no envía ni ve la de Contratación, y al revés', async () => {
    const get = (ruta, cabeceras) => request(app).get(ruta).set(cabeceras).then((r) => r.status);
    const sel = { Authorization: `Bearer ${tokenSeleccion}` };
    const rec = { Authorization: `Bearer ${tokenReclutamiento}` };

    expect(await get('/api/formacion/candidatos', comoFormacion())).toBe(200);
    expect(await get('/api/formacion/por-contratar', comoFormacion())).toBe(403);
    expect(await get('/api/contratacion/lotes', comoFormacion())).toBe(403);

    expect(await get('/api/formacion/por-contratar', comoContratacion())).toBe(200);
    expect(await get('/api/contratacion/lotes', comoContratacion())).toBe(200);
    expect(await get('/api/formacion/candidatos', comoContratacion())).toBe(403);

    for (const otro of [sel, rec]) {
      expect(await get('/api/formacion/candidatos', otro)).toBe(403);
      expect(await get('/api/formacion/por-contratar', otro)).toBe(403);
      expect(await get('/api/contratacion/lotes', otro)).toBe(403);
    }
  });

  it('Formación lista solo Agentes; Contratación, al Staff y todavía no al Agente', async () => {
    const a = await enFormacion(agente);
    expect(a).toMatchObject({ tipo: 'agente', elegible: false, asistencia: { asistio: null } });
    expect(a.motivoNoElegible).toMatch(/asistencia/);
    expect(await enFormacion(staff)).toBeUndefined();
    expect(await enFormacion(sinPaso)).toBeUndefined();

    const s = await porContratar(staff);
    expect(s).toMatchObject({ tipo: 'staff', elegible: false, asistencia: null });
    expect(s.motivoNoElegible).toMatch(/activo/);
    expect(await porContratar(agente)).toBeUndefined();
    expect(await porContratar(sinPaso)).toBeUndefined();
  });

  it('asistencia: solo Agentes en formación, y "No asistió" exige razón', async () => {
    const put = (id, cuerpo) => request(app).put(`/api/formacion/candidatos/${id}/asistencia`).set(comoFormacion()).send(cuerpo);
    expect((await put(staff, { asistio: true })).status).toBe(409);
    expect((await put(sinPaso, { asistio: true })).status).toBe(409);
    const sinRazon = await put(agente, { asistio: false });
    expect(sinRazon.status).toBe(400);
    expect(sinRazon.body.error.codigo).toBe('RAZON_REQUERIDA');
    const res = await put(agente, { asistio: false, razon: 'Calamidad doméstica' });
    expect(res.status).toBe(200);
    expect(res.body.datos.asistencia).toMatchObject({ asistio: false, razon: 'Calamidad doméstica' });
    expect(res.body.datos.motivoNoElegible).toMatch(/No asistió/);
  });

  it('un Agente que no asistió no puede quedar activo; al marcar "No asistió" se borra el activo', async () => {
    const estado = (cuerpo) => request(app).put(`/api/formacion/candidatos/${agente}/estado`).set(comoFormacion()).send(cuerpo);
    expect((await estado({ estado: 'activo' })).status).toBe(409);

    await request(app).put(`/api/formacion/candidatos/${agente}/asistencia`).set(comoFormacion()).send({ asistio: true });
    const activo = await estado({ estado: 'activo' });
    expect(activo.status).toBe(200);
    expect(activo.body.datos).toMatchObject({ elegible: true, formacion: { estado: 'activo' } });

    const noAsistio = await request(app)
      .put(`/api/formacion/candidatos/${agente}/asistencia`)
      .set(comoFormacion())
      .send({ asistio: false, razon: 'Se corrigió la asistencia' });
    expect(noAsistio.body.datos.formacion.estado).toBeNull();
    expect(await porContratar(agente)).toBeUndefined();

    await request(app).put(`/api/formacion/candidatos/${agente}/asistencia`).set(comoFormacion()).send({ asistio: true });
    expect((await estado({ estado: 'activo' })).status).toBe(200);
  });

  it('el Agente que pasó la formación (asistió y activo) aparece en la cola de Contratación', async () => {
    const a = await porContratar(agente);
    expect(a).toMatchObject({ tipo: 'agente', elegible: true });
    // Formación lo sigue viendo hasta que se envíe, por si hay que corregir.
    expect(await enFormacion(agente)).toBeDefined();
  });

  it('activo/baja de Staff lo marca Contratación, no Formación; baja exige razón y no cambia el embudo', async () => {
    const porFormacion = await request(app)
      .put(`/api/formacion/candidatos/${staff}/estado`)
      .set(comoFormacion())
      .send({ estado: 'activo' });
    expect(porFormacion.status).toBe(409);
    // Contratación no marca Agentes: eso es de Formación.
    const agentePorContratacion = await request(app)
      .put(`/api/formacion/por-contratar/${agente}/estado`)
      .set(comoContratacion())
      .send({ estado: 'baja', razon: 'No aplica' });
    expect(agentePorContratacion.status).toBe(409);

    const estado = (cuerpo) => request(app).put(`/api/formacion/por-contratar/${staff}/estado`).set(comoContratacion()).send(cuerpo);
    expect((await estado({ estado: 'baja' })).status).toBe(400);
    const baja = await estado({ estado: 'baja', razon: 'Renunció en la primera semana' });
    expect(baja.status).toBe(200);
    expect(baja.body.datos).toMatchObject({ elegible: false, formacion: { estado: 'baja', razon: 'Renunció en la primera semana' } });
    const candidato = await request(app).get(`/api/candidatos/${staff}`).set(auth());
    expect(candidato.body.datos.estado).toBe('aprobado_final');

    const activo = await estado({ estado: 'activo' });
    expect(activo.body.datos).toMatchObject({ elegible: true, formacion: { estado: 'activo', razon: null } });
  });

  it('Contratación envía a RRHH; Formación no; ya enviados salen de las colas y no se editan', async () => {
    const cuerpo = {
      nombre: 'Lote desde Contratación',
      candidatoIds: [agente, staff],
      notasAntecedentes: { [agente]: 'Antecedentes pendientes', [staff]: 'Antecedentes pendientes' },
    };
    expect((await request(app).post('/api/contratacion/lotes').set(comoFormacion()).send(cuerpo)).status).toBe(403);

    const res = await request(app).post('/api/contratacion/lotes').set(comoContratacion()).send(cuerpo);
    expect(res.status).toBe(201);
    lotesCreados.push(res.body.datos.id);

    expect(await enFormacion(agente)).toBeUndefined();
    expect(await porContratar(agente)).toBeUndefined();
    expect(await porContratar(staff)).toBeUndefined();
    const editar = await request(app)
      .put(`/api/formacion/por-contratar/${staff}/estado`)
      .set(comoContratacion())
      .send({ estado: 'baja', razon: 'Intento tardío' });
    expect(editar.status).toBe(409);
    expect(editar.body.error.mensaje).toMatch(/ya fue enviado/);
  });
});
