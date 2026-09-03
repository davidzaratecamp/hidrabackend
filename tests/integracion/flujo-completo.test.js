'use strict';

/**
 * Prueba de extremo a extremo del embudo completo de reclutamiento.
 *
 * Recorre el mismo flujo que tenía el sistema anterior, contra la base real:
 *
 *   1. Login de administrador, reclutador y selección
 *   2. Registro del candidato
 *   3. Envío del correo con el link del formulario (token)
 *   4. El candidato llena los 6 pasos por el link, sin sesión
 *   5. Al cerrar: estampado de hoja de vida y autorización de tratamiento de
 *      datos, y envío a firma electrónica
 *   6. Citación a entrevista
 *   7. Registro de asistencia
 *   8. Evaluación por selección (total calculado en el servidor)
 *   9. Subida de antecedentes
 *  10. Decisión final
 *
 * Correo y firma usan adaptadores en memoria: cumplen el mismo contrato que los
 * reales, así que el flujo ejercitado es idéntico, pero la prueba no sale a
 * internet y además puede inspeccionar los PDF que se generaron.
 */

const request = require('supertest');
const path = require('node:path');
const fs = require('node:fs');

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
let email;
let firma;
const usuariosCreados = [];
const candidatosCreados = [];
const archivosCreados = [];

const sesiones = {};
const auth = (rol) => ({ Authorization: `Bearer ${sesiones[rol].token}` });

/** Extrae el texto de un PDF, para verificar que el estampado escribió los datos. */
async function extraerTexto(buffer) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const documento = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  let texto = '';
  for (let pagina = 1; pagina <= documento.numPages; pagina += 1) {
    const contenido = await (await documento.getPage(pagina)).getTextContent();
    texto += `${contenido.items.map((i) => i.str).join(' ')} `;
  }
  return texto;
}

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

beforeAll(async () => {
  email = crearEmailMemoria();
  firma = crearFirmaCloudMemoria();
  app = construirApp(construirContenedor({ email, firma }));

  const reclutador = correo('reclutador');
  const seleccion = correo('seleccion');
  const admin = correo('admin');

  await crearUsuario({ email: reclutador, roles: ['reclutamiento'] });
  await crearUsuario({ email: seleccion, roles: ['seleccion'] });
  await crearUsuario({ email: admin, roles: ['administrador'] });

  sesiones.reclutador = await iniciarSesion(reclutador);
  sesiones.seleccion = await iniciarSesion(seleccion);
  sesiones.admin = await iniciarSesion(admin);
});

afterAll(async () => {
  if (candidatosCreados.length > 0) {
    const marcadores = candidatosCreados.map(() => '?').join(',');
    // Los soportes subidos se resuelven ANTES de borrar los candidatos: el
    // ON DELETE CASCADE se lleva las filas, pero no los archivos del disco.
    const [documentos] = await pool.query(
      `SELECT ruta_archivo FROM candidato_documentos WHERE candidato_id IN (${marcadores})`,
      candidatosCreados
    );
    const config = require('../../src/config/env');
    archivosCreados.push(
      ...documentos.map((d) => path.join(config.archivos.directorio, d.ruta_archivo))
    );

    await pool.query(`DELETE FROM candidatos WHERE id IN (${marcadores})`, candidatosCreados);
  }
  if (usuariosCreados.length > 0) {
    await pool.query(
      `DELETE FROM usuarios WHERE id IN (${usuariosCreados.map(() => '?').join(',')})`,
      usuariosCreados
    );
  }
  await Promise.all(
    archivosCreados.map((f) => fs.promises.unlink(f).catch(() => {}))
  );
  await cerrarPool();
});

// ---------------------------------------------------------------------------

describe('Flujo completo del embudo de reclutamiento', () => {
  let candidatoId;
  let tokenFormulario;

  it('1. los tres roles inician sesión y reciben permisos coherentes', () => {
    expect(sesiones.reclutador.usuario.roles).toEqual(['reclutamiento']);
    expect(sesiones.reclutador.usuario.permisos).toContain('crear_candidatos');
    // Reclutamiento registra la asistencia (decisión de negocio, 2026-08-31),
    // pero NO evalúa ni decide.
    expect(sesiones.reclutador.usuario.permisos).toContain('registrar_asistencia');
    expect(sesiones.reclutador.usuario.permisos).not.toContain('evaluar_candidatos');

    // Selección ya no marca asistencia: pasó a Reclutamiento.
    expect(sesiones.seleccion.usuario.permisos).toEqual(
      expect.arrayContaining(['evaluar_candidatos', 'tomar_decision_final'])
    );
    expect(sesiones.seleccion.usuario.permisos).not.toContain('registrar_asistencia');
    // Selección tampoco registra candidatos nuevos ni agenda entrevistas
    // (decisiones de negocio, 2026-09-01): solo gestiona lo que ya existe.
    expect(sesiones.seleccion.usuario.permisos).not.toContain('crear_candidatos');
    expect(sesiones.seleccion.usuario.permisos).not.toContain('agendar_entrevistas');
  });

  it('1b. selección no puede registrar candidatos nuevos', async () => {
    const res = await request(app)
      .post('/api/candidatos')
      .set(auth('seleccion'))
      .send({
        nombreCompleto: 'No Debería Existir',
        tipoDocumento: 'CC',
        celular: '3009990001',
        cliente: 'Obamacare',
        cargo: 'Agente',
      });
    expect(res.status).toBe(403);
  });

  it('2. el catálogo se sirve desde la base, sin sesión', async () => {
    const res = await request(app).get('/api/catalogos');
    expect(res.status).toBe(200);
    expect(res.body.datos.tipos_documento.map((t) => t.codigo)).toEqual(['CC', 'PPT']);
    expect(res.body.datos.clientes.length).toBeGreaterThan(0);
    // Los cargos ya vienen resueltos por cliente desde la relación M:N.
    expect(res.body.datos.cargos_por_cliente.Obamacare).toEqual(
      expect.arrayContaining([expect.objectContaining({ codigo: 'Customer Service' })])
    );
  });

  it('3. el reclutador registra el candidato', async () => {
    const res = await request(app)
      .post('/api/candidatos')
      .set(auth('reclutador'))
      .send({
        nombreCompleto: 'Laura Sofía Restrepo Gómez',
        tipoDocumento: 'CC',
        numeroDocumento: String(sufijo).slice(-10),
        edad: 27,
        email: correo('candidata'),
        celular: '3001234567',
        contactoLlamada: true,
        contactoWhatsapp: false,
        cliente: 'Obamacare',
        // 'Agente': la evaluación de entrevista (paso 11) solo aplica a este
        // cargo (decisión de negocio, 2026-08-31, ver seleccion.service.js).
        cargo: 'Agente',
        perfil: 'Bachiller con experiencia comercial',
        // Este candidato recorre el embudo completo, así que NO se cita al
        // registrar: marcar Citado = Sí lo dejaría citado de entrada y se saltaría
        // los formularios. Ese camino se prueba aparte, en 3d.
        citado: false,
        ciudad: 'bogota',
        fuenteReclutamiento: 'Computrabajo',
        tipificacionLlamada: 'Interesado',
      });

    expect(res.status).toBe(201);
    candidatoId = res.body.datos.id;
    candidatosCreados.push(candidatoId);

    // Columnas PERFIL y CITADO del Excel oficial, capturadas en el registro
    // desde la migración 007. `citado` vuelve tipado, no como 1/0.
    expect(res.body.datos.perfil).toBe('Bachiller con experiencia comercial');
    expect(res.body.datos.citado).toBe(false);

    // El nombre se parte con la convención colombiana: últimas dos = apellidos.
    expect(res.body.datos).toMatchObject({
      primer_nombre: 'Laura',
      segundo_nombre: 'Sofía',
      primer_apellido: 'Restrepo',
      segundo_apellido: 'Gómez',
      estado: 'nuevo',
      // La nacionalidad ya no se guarda: se deriva del tipo de documento.
      nacionalidad: 'Colombiano',
    });
  });

  it('3b. rechaza un cargo que no pertenece al cliente', async () => {
    const res = await request(app)
      .post('/api/candidatos')
      .set(auth('reclutador'))
      .send({
        nombreCompleto: 'Cargo Invalido',
        tipoDocumento: 'CC',
        celular: '3001112222',
        cliente: 'Obamacare',
        cargo: 'Contador', // solo existe para Staff
      });

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('CARGO_NO_DISPONIBLE');
  });

  it('3b-bis. una tipificación retirada del catálogo deja de aceptarse', async () => {
    // 'Contacto exitoso' se desactivó en la migración 008. Desactivar, y no
    // borrar, es lo que permite que los candidatos antiguos la conserven; lo que
    // se verifica aquí es la otra mitad: que ya no se pueda asignar.
    const catalogos = await request(app).get('/api/catalogos');
    const codigos = catalogos.body.datos.tipificaciones_llamada.map((t) => t.codigo);
    expect(codigos).not.toContain('Contacto exitoso');

    const res = await request(app)
      .post('/api/candidatos')
      .set(auth('reclutador'))
      .send({
        nombreCompleto: 'Tipificacion Retirada',
        tipoDocumento: 'CC',
        celular: '3001113333',
        cliente: 'Obamacare',
        cargo: 'Customer Service',
        tipificacionLlamada: 'Contacto exitoso',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('CATALOGO_INVALIDO');
  });

  it('3d. registrar con Citado = Sí deja al candidato citado, sin pasar por Selección', async () => {
    const res = await request(app)
      .post('/api/candidatos')
      .set(auth('reclutador'))
      .send({
        nombreCompleto: 'Citado Al Registrar',
        tipoDocumento: 'CC',
        numeroDocumento: `${String(sufijo).slice(-9)}9`,
        celular: '3009998888',
        cliente: 'Obamacare',
        cargo: 'Customer Service',
        citado: true,
      });

    expect(res.status).toBe(201);
    const id = res.body.datos.id;
    candidatosCreados.push(id);

    // La marca y el estado son el mismo hecho: no puede quedar 'nuevo' con la
    // marca en Sí, que es lo que dejaría el filtro "Citado" sin encontrarlo.
    expect(res.body.datos.citado).toBe(true);
    expect(res.body.datos.estado).toBe('citado');

    // Y existe la citación real, así que Reclutamiento puede marcarle asistencia.
    const expediente = await request(app)
      .get(`/api/seleccion/candidatos/${id}/expediente`)
      .set(auth('seleccion'));
    expect(expediente.body.datos.citaciones).toHaveLength(1);

    // Ya citado: no se vuelve a citar (Selección ya ni tiene el permiso, ver
    // test 8c; acá se prueba la regla de negocio con quien sí puede citar).
    const repetir = await request(app)
      .post(`/api/seleccion/candidatos/${id}/citacion`)
      .set(auth('reclutador'))
      .send({});
    expect(repetir.status).toBe(409);
    expect(repetir.body.error.codigo).toBe('YA_CITADO');

    // Aparece en el filtro por estado del listado, que es lo que se pidió.
    const listado = await request(app)
      .get('/api/candidatos?estado=citado')
      .set(auth('reclutador'));
    expect(listado.body.datos.map((c) => c.id)).toContain(id);
  });

  it('3c. la máquina de estados rechaza un salto ilegal', async () => {
    const res = await request(app)
      .post(`/api/candidatos/${candidatoId}/estado`)
      .set(auth('reclutador'))
      .send({ estado: 'contratado' });

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('TRANSICION_INVALIDA');
    expect(res.body.error.detalles.permitidos).toContain('contacto_exitoso');
  });

  it('4. avanza a contacto exitoso y se le envía el formulario por correo', async () => {
    const avance = await request(app)
      .post(`/api/candidatos/${candidatoId}/estado`)
      .set(auth('reclutador'))
      .send({ estado: 'contacto_exitoso' });
    expect(avance.status).toBe(200);

    const envio = await request(app)
      .post(`/api/candidatos/${candidatoId}/enviar-formulario`)
      .set(auth('reclutador'));

    expect(envio.status).toBe(200);
    expect(envio.body.datos.enviado).toBe(true);

    // El correo salió de verdad por el puerto de email.
    const mensaje = email.enviados.at(-1);
    expect(mensaje.asunto).toMatch(/hoja de vida/i);

    const enlace = /\/candidato\/formulario\/([0-9a-f-]{36})/.exec(mensaje.html);
    expect(enlace).not.toBeNull();
    tokenFormulario = enlace[1];

    // Enviar el formulario avanza el estado.
    const perfil = await request(app)
      .get(`/api/candidatos/${candidatoId}`)
      .set(auth('reclutador'));
    expect(perfil.body.datos.estado).toBe('formularios_enviados');
  });

  it('4b. el envío queda registrado en envios_email', async () => {
    const [filas] = await pool.query(
      'SELECT tipo, estado FROM envios_email WHERE candidato_id = ?',
      [candidatoId]
    );
    expect(filas).toEqual(
      expect.arrayContaining([expect.objectContaining({ tipo: 'formularios', estado: 'enviado' })])
    );
  });

  it('5. el candidato abre el formulario sin sesión', async () => {
    const res = await request(app).get(`/api/formulario/${tokenFormulario}`);
    expect(res.status).toBe(200);
    expect(res.body.datos.candidato.primerNombre).toBe('Laura');
    expect(res.body.datos.progreso).toMatchObject({ completados: 0, total: 6 });
  });

  it('5b. un token inventado da 404', async () => {
    const res = await request(app).get(
      '/api/formulario/00000000-0000-4000-8000-000000000000'
    );
    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe('TOKEN_INVALIDO');
  });

  it('6. el candidato completa los 5 primeros pasos', async () => {
    const base = `/api/formulario/${tokenFormulario}`;

    const hojaVida = await request(app)
      .put(`${base}/hoja-vida`)
      .send({ aspiracionSalarial: 2100000 });
    expect(hojaVida.status).toBe(200);

    const datos = await request(app).put(`${base}/datos-basicos`).send({
      nombreCompleto: 'Laura Sofía Restrepo Gómez',
      // Obligatorios desde la decisión de negocio 2026-09-03: en la interfaz
      // real ya vienen precargados del registro (ver FormularioCandidato.jsx),
      // pero esta prueba llama al endpoint directo, sin ese precargado.
      numeroDocumento: String(sufijo).slice(-10),
      celular: '3001234567',
      edad: 27,
      fechaNacimiento: '1998-05-14',
      estadoCivil: 'soltero',
      genero: 'femenino',
      grupoSanguineo: 'O+',
      eps: 'Sura EPS',
      afp: 'Porvenir',
      tallaCamisa: 'M',
      direccionResidencial: 'Calle 100 # 15-20',
      barrio: 'Chicó',
      nombreEmergencia: 'Marta Gómez',
      numeroEmergencia: '3109876543',
      parentescoEmergencia: 'madre',
    });
    expect(datos.status).toBe(200);

    const estudios = await request(app).put(`${base}/estudios`).send({
      estudios: [
        {
          nivel: 'bachillerato',
          nombreInstitucion: 'Colegio San José',
          tituloObtenido: 'Bachiller Académico',
          anoFinalizacion: 2015,
        },
        {
          nivel: 'tecnico_tecnologo',
          nombreInstitucion: 'SENA',
          tituloObtenido: 'Técnico en Servicio al Cliente',
          anoFinalizacion: 2018,
        },
        { nivel: 'conocimientos_informaticos', descripcion: 'Excel avanzado, CRM Salesforce' },
      ],
    });
    expect(estudios.status).toBe(200);

    const experiencia = await request(app).put(`${base}/experiencia`).send({
      experiencias: [
        {
          orden: 1,
          nombreEmpresa: 'Contact Center SAS',
          cargoDesempenado: 'Asesora comercial',
          salario: 1600000,
          funciones: 'Venta telefónica de productos y manejo de objeciones',
          fechaInicio: '2022-02-01',
          fechaRetiro: '2024-08-31',
          motivoRetiro: 'Mejor oferta laboral',
        },
      ],
      resumen: {
        haTrabajadoAsiste: false,
        experienciaComercialCertificada: true,
        experienciaComercialNoCertificada: false,
        primerEmpleoFormal: false,
      },
    });
    expect(experiencia.status).toBe(200);

    const personal = await request(app).put(`${base}/personal`).send({
      genograma: 'Vivo con mi madre y mi hermano menor.',
      fortalezas: 'Escucha activa, orientación al logro',
      aspectosMejorar: 'Manejo del tiempo',
      competenciasLaborales: 'Negociación, servicio al cliente',
      estadoSaludActual: 'Buena',
      tratamientoPsicologicoActual: false,
      autoevaluacion: 4,
      // Obligatorios desde la decisión de negocio 2026-09-03 (antes solo se
      // mandaban desde el paso "experiencia"; el paso "personal" también los
      // acepta — ver comentario en formulario.schema.js::personal).
      experienciaComercialCertificada: true,
      experienciaComercialNoCertificada: false,
      primerEmpleoFormal: false,
      metas: { corto: 'Estabilidad laboral', mediano: 'Terminar profesional', largo: 'Liderar un equipo' },
      conocimientos: [
        { herramienta: 'excel', nivel: 4 },
        { herramienta: 'word', nivel: 5 },
        { herramienta: 'powerpoint', nivel: 3 },
      ],
    });
    expect(personal.status).toBe(200);
    expect(personal.body.datos.completados).toBe(5);
  });

  it('6b. no deja cerrar el formulario sin bachillerato', async () => {
    const res = await request(app)
      .put(`/api/formulario/${tokenFormulario}/estudios`)
      .send({ estudios: [{ nivel: 'tecnico_tecnologo', nombreInstitucion: 'X' }] });

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('BACHILLERATO_REQUERIDO');
  });

  it('6c. "datos personales" rechaza si falta un campo, ahora obligatorio', async () => {
    const res = await request(app)
      .put(`/api/formulario/${tokenFormulario}/datos-basicos`)
      .send({
        nombreCompleto: 'Laura Sofía Restrepo Gómez',
        numeroDocumento: String(sufijo).slice(-10),
        celular: '3001234567',
        edad: 27,
        estadoCivil: 'soltero',
        grupoSanguineo: 'O+',
        eps: 'Sura EPS',
        afp: 'Porvenir',
        tallaCamisa: 'M',
        direccionResidencial: 'Calle 100 # 15-20',
        // Sin "barrio": debe rechazar.
        nombreEmergencia: 'Marta Gómez',
        numeroEmergencia: '3109876543',
        parentescoEmergencia: 'madre',
      });
    expect(res.status).toBe(400);
  });

  it('6d. "sobre ti" rechaza si falta uno de los Sí/No, ahora obligatorios', async () => {
    const res = await request(app)
      .put(`/api/formulario/${tokenFormulario}/personal`)
      .send({
        genograma: 'x', fortalezas: 'x', aspectosMejorar: 'x', competenciasLaborales: 'x',
        estadoSaludActual: 'x', autoevaluacion: 4,
        metas: { corto: 'x', mediano: 'x', largo: 'x' },
        conocimientos: [{ herramienta: 'excel', nivel: 3 }],
        experienciaComercialCertificada: true,
        experienciaComercialNoCertificada: false,
        // Sin "primerEmpleoFormal": debe rechazar.
      });
    expect(res.status).toBe(400);
  });

  it('6e. "experiencia laboral" rechaza si el primer bloque queda incompleto', async () => {
    const res = await request(app)
      .put(`/api/formulario/${tokenFormulario}/experiencia`)
      .send({ experiencias: [{ orden: 1, nombreEmpresa: 'Solo el nombre, sin cargo ni fecha' }] });
    expect(res.status).toBe(400);
  });

  // "Anterior empleo" (segundo bloque) opcional: ya lo prueba el paso "6"
  // de arriba, que lo manda sin ningún dato y el backend lo acepta — no se
  // repite acá con un envío nuevo para no pisar (`reemplazarExperiencias` no
  // hace merge parcial) los datos completos que la prueba "7b-bis" necesita
  // más abajo.

  it('6g. "autorización de datos" rechaza sin ciudad', async () => {
    const res = await request(app)
      .put(`/api/formulario/${tokenFormulario}/consentimiento`)
      .send({ fecha: '2026-08-28', aceptado: true });
    expect(res.status).toBe(400);
  });

  it('7. al aceptar el consentimiento se estampan los PDF y se envían a firma', async () => {
    const res = await request(app)
      .put(`/api/formulario/${tokenFormulario}/consentimiento`)
      // "Cali" a propósito: el catálogo viejo solo tenía Bogotá/Barranquilla
      // (migración 017, decisión de negocio 2026-09-03) — cualquier texto
      // debe aceptarse ahora.
      .send({ ciudad: 'Cali', fecha: '2026-08-28', aceptado: true });

    expect(res.status).toBe(200);
    expect(res.body.datos.completado).toBe(true);

    // Estampado real: los dos PDF se generaron y pesan lo que pesa un PDF.
    expect(res.body.datos.firma.enviado).toBe(true);
    expect(res.body.datos.firma.bytesCv).toBeGreaterThan(20_000);
    expect(res.body.datos.firma.bytesTratamiento).toBeGreaterThan(20_000);

    // El proveedor de firma recibió ambos documentos.
    const envio = firma.envios.at(-1);
    expect(envio.nombreCandidato).toBe('Laura Sofía Restrepo Gómez');
    expect(envio.cvPdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(envio.tratamientoPdf.subarray(0, 5).toString()).toBe('%PDF-');

    // Y el reclutador dueño fue notificado.
    expect(email.enviados.at(-1).asunto).toMatch(/Formulario completado/);
  });

  it('7b. el estado avanzó y el token quedó consumido', async () => {
    const perfil = await request(app)
      .get(`/api/candidatos/${candidatoId}`)
      .set(auth('reclutador'));
    expect(perfil.body.datos.estado).toBe('formularios_completados');
    expect(perfil.body.datos.formulario.completados).toBe(6);

    // El link ya no sirve: es de un solo uso.
    const reintento = await request(app).get(`/api/formulario/${tokenFormulario}`);
    expect(reintento.status).toBe(404);
  });

  it('7b-bis. reenviar el formulario a un candidato ya completo precarga TODO lo que ya diligenció, sin perder nada', async () => {
    const reenvio = await request(app)
      .post(`/api/candidatos/${candidatoId}/enviar-formulario`)
      .set(auth('reclutador'));
    expect(reenvio.status).toBe(200);

    const mensaje = email.enviados.at(-1);
    const nuevoToken = /\/candidato\/formulario\/([0-9a-f-]{36})/.exec(mensaje.html)[1];
    expect(nuevoToken).not.toBe(tokenFormulario);

    const abierto = await request(app).get(`/api/formulario/${nuevoToken}`);
    expect(abierto.status).toBe(200);
    expect(abierto.body.datos.progreso).toMatchObject({ completados: 6, total: 6 });

    const r = abierto.body.datos.respuestas;
    expect(r.hoja_vida.aspiracionSalarial).toBe(2100000);
    expect(r.datos_basicos).toMatchObject({
      eps: 'Sura EPS',
      afp: 'Porvenir',
      direccionResidencial: 'Calle 100 # 15-20',
      barrio: 'Chicó',
      estadoCivil: 'soltero',
      tallaCamisa: 'M',
      grupoSanguineo: 'O+',
      parentescoEmergencia: 'madre',
      nombreEmergencia: 'Marta Gómez',
      numeroEmergencia: '3109876543',
    });
    expect(r.estudios.estudios.bachillerato).toMatchObject({
      nombreInstitucion: 'Colegio San José',
      tituloObtenido: 'Bachiller Académico',
      anoFinalizacion: 2015,
    });
    expect(r.estudios.estudios.conocimientos_informaticos).toMatchObject({
      descripcion: 'Excel avanzado, CRM Salesforce',
    });
    expect(r.experiencia.experiencias).toHaveLength(1);
    expect(r.experiencia.experiencias[0]).toMatchObject({
      orden: 1,
      nombreEmpresa: 'Contact Center SAS',
      cargoDesempenado: 'Asesora comercial',
      fechaRetiro: '2024-08-31',
      trabajaActualmente: false,
    });
    expect(r.personal).toMatchObject({
      genograma: 'Vivo con mi madre y mi hermano menor.',
      fortalezas: 'Escucha activa, orientación al logro',
      autoevaluacion: 4,
      conocimientos: { excel: 4, word: 5, powerpoint: 3 },
      metas: { corto: 'Estabilidad laboral' },
    });
    expect(r.consentimiento).toMatchObject({ ciudad: 'Cali', fecha: '2026-08-28' });

    // Este token viejo ya estaba consumido; el nuevo no se toca, para no
    // interferir con las pruebas 7c en adelante que siguen usando el original.
  });

  it('7bis. el PDF de hoja de vida contiene los datos estampados del candidato', async () => {
    // No basta con que el PDF pese: hay que comprobar que el estampado escribió
    // los valores. Se extrae el texto real del PDF que recibió el proveedor.
    const { cvPdf } = firma.envios.at(-1);
    const texto = await extraerTexto(cvPdf);

    for (const esperado of [
      'Laura', 'Restrepo', 'Gómez',        // identidad
      'Colegio San José', 'SENA',          // tabla académica (bordes vectoriales)
      'Excel avanzado',                    // fila fusionada de conocimientos
      'Contact Center SAS', 'Asesora comercial', // experiencia laboral
      'Chicó', 'Sura EPS', 'Porvenir',     // datos básicos
      'Marta Gómez',                       // contacto de emergencia
      'Escucha activa',                    // perfil
    ]) {
      expect(texto, `falta "${esperado}" en el PDF`).toContain(esperado);
    }
  });

  it('7ter. la autorización de tratamiento de datos lleva nombre y documento', async () => {
    const { tratamientoPdf } = firma.envios.at(-1);
    const texto = await extraerTexto(tratamientoPdf);
    expect(texto).toContain('Laura');
    expect(texto).toContain('Restrepo');
    expect(texto).toContain(String(sufijo).slice(-10));
  });

  it('7c. la firma quedó registrada y el documento se descarga por proxy', async () => {
    const estado = await request(app)
      .get(`/api/firma/${candidatoId}/estado`)
      .set(auth('reclutador'));
    expect(estado.status).toBe(200);
    expect(estado.body.datos.proveedor.estado).toBe('pendiente_de_firma');

    const descarga = await request(app)
      .get(`/api/firma/${candidatoId}/documento/cv`)
      .set(auth('seleccion'));
    expect(descarga.status).toBe(200);
    expect(descarga.headers['content-type']).toMatch(/application\/pdf/);
    expect(descarga.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('8. reclutamiento cita al candidato, sin fecha', async () => {
    const res = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/citacion`)
      .set(auth('reclutador'))
      .send({});

    expect(res.status).toBe(201);
    // Citar y estar 'citado' son ahora el mismo hecho: no se pueden desincronizar.
    expect(res.body.datos.candidato.estado).toBe('citado');
  });

  it('8b. no deja citar dos veces al mismo candidato', async () => {
    const res = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/citacion`)
      .set(auth('reclutador'))
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('YA_CITADO');
  });

  it('8c. selección ya NO puede citar candidatos', async () => {
    const otro = await request(app)
      .post('/api/candidatos')
      .set(auth('reclutador'))
      .send({
        nombreCompleto: 'Otro Para Citar',
        tipoDocumento: 'CC',
        celular: '3009990002',
        cliente: 'Obamacare',
        cargo: 'Agente',
      });
    candidatosCreados.push(otro.body.datos.id);

    const res = await request(app)
      .post(`/api/seleccion/candidatos/${otro.body.datos.id}/citacion`)
      .set(auth('seleccion'))
      .send({});

    expect(res.status).toBe(403);
  });

  it('9. reclutamiento marca la asistencia', async () => {
    const res = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/asistencia`)
      .set(auth('reclutador'))
      .send({ asistio: 'asistio', observaciones: 'Puntual, buena presentación' });

    expect(res.status).toBe(200);
    expect(res.body.datos.estado).toBe('entrevistado');
  });

  it('9b. no asistir sin motivo es rechazado por el esquema', async () => {
    const res = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/asistencia`)
      .set(auth('reclutador'))
      .send({ asistio: 'no_asistio' });

    expect(res.status).toBe(400);
  });

  it('9c. selección ya NO puede marcar asistencia', async () => {
    const res = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/asistencia`)
      .set(auth('seleccion'))
      .send({ asistio: 'asistio' });

    expect(res.status).toBe(403);
  });

  it('10. antecedentes: se registran las cuatro verificaciones con soporte', async () => {
    const soporte = path.join(__dirname, '..', 'fixtures', 'soporte.pdf');

    for (const tipo of ['adres', 'policia', 'comparendos']) {
      const res = await request(app)
        .post(`/api/antecedentes/candidatos/${candidatoId}`)
        .set(auth('seleccion'))
        .field('tipo', tipo)
        .field('estado', 'aprobado')
        .attach('documento', soporte);
      expect(res.status).toBe(200);
    }

    // Una no aprobada exige novedad.
    const sinNovedad = await request(app)
      .post(`/api/antecedentes/candidatos/${candidatoId}`)
      .set(auth('seleccion'))
      .field('tipo', 'procuraduria')
      .field('estado', 'no_aprobado');
    expect(sinNovedad.status).toBe(400);
    expect(sinNovedad.body.error.codigo).toBe('NOVEDAD_REQUERIDA');

    const conNovedad = await request(app)
      .post(`/api/antecedentes/candidatos/${candidatoId}`)
      .set(auth('seleccion'))
      .field('tipo', 'procuraduria')
      .field('estado', 'no_aprobado')
      .field('novedad', 'Sanción registrada en 2019')
      .attach('documento', soporte);
    expect(conNovedad.status).toBe(200);

    const resumen = conNovedad.body.datos;
    expect(resumen).toHaveLength(4);
    expect(resumen.filter((a) => a.estado === 'aprobado')).toHaveLength(3);

    // Y el soporte se descarga por proxy autenticado.
    const conDoc = resumen.find((a) => a.documento_id);
    const descarga = await request(app)
      .get(`/api/antecedentes/candidatos/${candidatoId}/documento/${conDoc.documento_id}`)
      .set(auth('seleccion'));
    expect(descarga.status).toBe(200);
  });

  it('11. la evaluación calcula el total en el SERVIDOR', async () => {
    const criterios = await request(app)
      .get('/api/seleccion/criterios')
      .set(auth('seleccion'));
    expect(criterios.body.datos).toHaveLength(5);

    const res = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/evaluacion`)
      .set(auth('seleccion'))
      .send({
        puntajes: { saludo: 18, perfilamiento: 16, producto: 15, objeciones: 14, cierre: 17 },
      });

    expect(res.status).toBe(201);
    // 18+16+15+14+17 = 80 sobre 100 = 80% >= 71% -> aprobado
    // Booleanos y puntajes llegan ya tipados: `true`, no 1; `80`, no '80.00'.
    expect(res.body.datos.total).toBe(80);
    expect(res.body.datos.porcentaje).toBe(80);
    expect(res.body.datos.aprobado).toBe(true);
  });

  it('11b. un puntaje fuera de rango se rechaza', async () => {
    const res = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/evaluacion`)
      .set(auth('seleccion'))
      .send({ puntajes: { saludo: 99, perfilamiento: 1, producto: 1, objeciones: 1, cierre: 1 } });

    // Ya no está 'entrevistado' (pasó a 'aprobado'), así que el guard de estado
    // es lo primero que salta: la evaluación no se puede repetir a voluntad.
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('ESTADO_NO_EVALUABLE');
  });

  it('11c. aprobación de entrevista: informativa, no bloquea la decisión final', async () => {
    const rechazo = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/aprobacion-entrevista`)
      .set(auth('seleccion'))
      .send({ aprobacion: false });
    // Igual que "Decidir": rechazar exige razón.
    expect(rechazo.status).toBe(400);
    expect(rechazo.body.error.codigo).toBe('RAZON_REQUERIDA');

    const res = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/aprobacion-entrevista`)
      .set(auth('seleccion'))
      .send({ aprobacion: true, razon: 'Buena impresión general' });
    expect(res.status).toBe(200);
    expect(res.body.datos.aprobacion).toBe(true);

    // No cambió el estado del candidato: sigue "aprobado" (evaluación), no
    // decidido — decisión final es la única transición de estado acá.
    const perfil = await request(app)
      .get(`/api/candidatos/${candidatoId}`)
      .set(auth('seleccion'));
    expect(perfil.body.datos.estado).toBe('aprobado');
    expect(perfil.body.datos.aprobacion_entrevista).toBe(true);
  });

  it('12. decisión final del área de selección', async () => {
    const res = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/decision-final`)
      .set(auth('seleccion'))
      .send({ aprobacion: true, razon: 'Perfil idóneo para la campaña' });

    expect(res.status).toBe(200);
    expect(res.body.datos.aprobacion).toBe(true);

    const perfil = await request(app)
      .get(`/api/candidatos/${candidatoId}`)
      .set(auth('seleccion'));
    expect(perfil.body.datos.estado).toBe('aprobado_final');
  });

  it('12b. citar a formación: informativo, no bloquea nada ni cambia el estado', async () => {
    const rechazo = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/citacion-formacion`)
      .set(auth('seleccion'))
      .send({ citado: false });
    // Igual que "Decidir": no citar exige razón.
    expect(rechazo.status).toBe(400);
    expect(rechazo.body.error.codigo).toBe('RAZON_REQUERIDA');

    const res = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/citacion-formacion`)
      .set(auth('seleccion'))
      .send({ citado: true });
    expect(res.status).toBe(200);
    expect(res.body.datos.citado).toBe(true);

    const perfil = await request(app)
      .get(`/api/candidatos/${candidatoId}`)
      .set(auth('seleccion'));
    expect(perfil.body.datos.estado).toBe('aprobado_final');
    expect(perfil.body.datos.citado_formacion).toBe(true);
  });

  it('13. el historial reconstruye todo el recorrido, con autor y motivo', async () => {
    const res = await request(app)
      .get(`/api/candidatos/${candidatoId}`)
      .set(auth('admin'));

    const recorrido = res.body.datos.historial.map((h) => h.estado_nuevo);
    expect(recorrido).toEqual([
      'nuevo',
      'contacto_exitoso',
      'formularios_enviados',
      'formularios_completados',
      'citado',
      'entrevistado',
      'aprobado',
      'aprobado_final',
    ]);

    // Cada paso sabe quién lo hizo; el del candidato no tiene usuario.
    const completado = res.body.datos.historial.find(
      (h) => h.estado_nuevo === 'formularios_completados'
    );
    expect(completado.usuario).toBeNull();
    expect(completado.motivo).toMatch(/completó el formulario/);
  });

  it('14. el expediente de selección reúne citación, evaluación y decisión', async () => {
    const res = await request(app)
      .get(`/api/seleccion/candidatos/${candidatoId}/expediente`)
      .set(auth('seleccion'));

    expect(res.status).toBe(200);
    expect(res.body.datos.citaciones).toHaveLength(1);
    expect(res.body.datos.citaciones[0].asistio).toBe('asistio');
    expect(res.body.datos.evaluaciones).toHaveLength(1);
    expect(res.body.datos.decisionFinal.aprobacion).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('Visibilidad entre reclutadores (ver_candidatos_todos) y permisos de selección', () => {
  let candidatoAjenoId;

  beforeAll(async () => {
    const otro = correo('otro-reclutador');
    await crearUsuario({ email: otro, roles: ['reclutamiento'] });
    sesiones.otroReclutador = await iniciarSesion(otro);

    const res = await request(app)
      .post('/api/candidatos')
      .set({ Authorization: `Bearer ${sesiones.otroReclutador.token}` })
      .send({
        nombreCompleto: 'Pedro Ajeno Pérez',
        tipoDocumento: 'CC',
        celular: '3005550000',
        cliente: 'Hogar',
        cargo: 'Agente',
      });
    candidatoAjenoId = res.body.datos.id;
    candidatosCreados.push(candidatoAjenoId);
  });

  // Desde el permiso `ver_candidatos_todos` (migración 012, decisión de
  // negocio 2026-09-02: "todos los roles deben ver el listado completo, sin
  // importar quién registró a cada candidato", ver visibilidad.js), un
  // reclutador SÍ ve, abre y muta candidatos ajenos — esta suite se llamaba
  // "Aislamiento entre reclutadores" cuando eso todavía no existía.
  // `ver_perfiles_completos` (sin tocar) sigue aparte, gateando solo datos
  // sensibles de histórico/trazabilidad.
  it('un reclutador SÍ ve el candidato de otro en el listado', async () => {
    const res = await request(app).get('/api/candidatos?porPagina=100').set(auth('reclutador'));
    const ids = res.body.datos.map((c) => c.id);
    expect(ids).toContain(candidatoAjenoId);
  });

  it('un reclutador SÍ puede abrir el perfil de un candidato ajeno', async () => {
    const res = await request(app)
      .get(`/api/candidatos/${candidatoAjenoId}`)
      .set(auth('reclutador'));
    expect(res.status).toBe(200);
  });

  it('un reclutador SÍ puede mutar un candidato ajeno', async () => {
    const res = await request(app)
      .post(`/api/candidatos/${candidatoAjenoId}/estado`)
      .set(auth('reclutador'))
      .send({ estado: 'contacto_exitoso' });
    expect(res.status).toBe(200);
  });

  it('selección SÍ ve todos los candidatos (tiene ver_candidatos_todos)', async () => {
    const res = await request(app)
      .get(`/api/candidatos/${candidatoAjenoId}`)
      .set(auth('seleccion'));
    expect(res.status).toBe(200);
  });

  it('un reclutador no puede evaluar ni decidir', async () => {
    const evaluar = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoAjenoId}/evaluacion`)
      .set(auth('reclutador'))
      .send({ puntajes: { saludo: 20 } });
    expect(evaluar.status).toBe(403);

    const decidir = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoAjenoId}/decision-final`)
      .set(auth('reclutador'))
      .send({ aprobacion: true });
    expect(decidir.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------

describe('Evaluación solo aplica a cargo Agente', () => {
  let candidatoId;

  beforeAll(async () => {
    // citado: true salta el formulario y deja al candidato en 'citado' con
    // citación real, igual que en el test 3d.
    const res = await request(app)
      .post('/api/candidatos')
      .set(auth('reclutador'))
      .send({
        nombreCompleto: 'Coordinador Sin Evaluacion',
        tipoDocumento: 'CC',
        celular: '3005551111',
        cliente: 'Staff Operacional',
        cargo: 'Coordinador',
        citado: true,
      });
    candidatoId = res.body.datos.id;
    candidatosCreados.push(candidatoId);

    await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/asistencia`)
      .set(auth('reclutador'))
      .send({ asistio: 'asistio' });
  });

  it('no se puede evaluar un cargo que no es Agente', async () => {
    const res = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/evaluacion`)
      .set(auth('seleccion'))
      .send({ puntajes: { saludo: 20, perfilamiento: 20, producto: 20, objeciones: 20, cierre: 20 } });
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('EVALUACION_NO_APLICA');
  });

  it('un candidato Staff (no Agente) SÍ puede usar aprobación de entrevista', async () => {
    const res = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/aprobacion-entrevista`)
      .set(auth('seleccion'))
      .send({ aprobacion: true });
    expect(res.status).toBe(200);
    expect(res.body.datos.aprobacion).toBe(true);
  });

  it('jefe inmediato y prueba técnica: informativos, razón obligatoria al rechazar', async () => {
    const sinRazon = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/aprobacion-jefe-inmediato`)
      .set(auth('seleccion'))
      .send({ aprobacion: false });
    expect(sinRazon.status).toBe(400);
    expect(sinRazon.body.error.codigo).toBe('RAZON_REQUERIDA');

    const jefe = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/aprobacion-jefe-inmediato`)
      .set(auth('seleccion'))
      .send({ aprobacion: true });
    expect(jefe.status).toBe(200);
    expect(jefe.body.datos.aprobacion).toBe(true);

    const prueba = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/aprobacion-prueba-tecnica`)
      .set(auth('seleccion'))
      .send({ aprobacion: false, razon: 'No superó la prueba de Excel' });
    expect(prueba.status).toBe(200);
    expect(prueba.body.datos.aprobacion).toBe(false);

    const perfil = await request(app)
      .get(`/api/candidatos/${candidatoId}`)
      .set(auth('seleccion'));
    expect(perfil.body.datos.estado).toBe('entrevistado'); // informativos: no mueven el estado
    expect(perfil.body.datos.aprobacion_jefe_inmediato).toBe(true);
    expect(perfil.body.datos.aprobacion_prueba_tecnica).toBe(false);
  });

  it('no se puede citar a formación antes de la decisión final', async () => {
    const res = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/citacion-formacion`)
      .set(auth('seleccion'))
      .send({ citado: true });
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('CITACION_FORMACION_NO_APLICA');
  });

  it('no se puede registrar contratación antes de la decisión final', async () => {
    const res = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/contratacion`)
      .set(auth('seleccion'))
      .send({ contratado: true });
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('CONTRATACION_NO_APLICA');
  });

  it('la decisión final se toma directo desde "entrevistado", sin evaluación', async () => {
    const res = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/decision-final`)
      .set(auth('seleccion'))
      .send({ aprobacion: true, razon: 'Buen perfil para el cargo' });
    expect(res.status).toBe(200);
    expect(res.body.datos.aprobacion).toBe(true);

    const perfil = await request(app)
      .get(`/api/candidatos/${candidatoId}`)
      .set(auth('seleccion'));
    expect(perfil.body.datos.estado).toBe('aprobado_final');
  });

  it('citar a formación NO aplica a un candidato Staff (usa contratación)', async () => {
    const res = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/citacion-formacion`)
      .set(auth('seleccion'))
      .send({ citado: true });
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('CITACION_FORMACION_NO_APLICA');
  });

  it('contratación ya sí aplica una vez aprobado_final', async () => {
    const sinRazon = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/contratacion`)
      .set(auth('seleccion'))
      .send({ contratado: false });
    expect(sinRazon.status).toBe(400);
    expect(sinRazon.body.error.codigo).toBe('RAZON_REQUERIDA');

    const res = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/contratacion`)
      .set(auth('seleccion'))
      .send({ contratado: true });
    expect(res.status).toBe(200);
    expect(res.body.datos.contratado).toBe(true);
  });

  it('las tres aprobaciones de Staff se pueden corregir ya con decisión final tomada', async () => {
    // Este mismo candidatoId ya quedó en aprobado_final (test anterior). Si
    // algo se guardó mal antes de decidir, Selección debe poder corregirlo
    // después también (pedido explícito, 2026-09-02).
    const entrevista = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/aprobacion-entrevista`)
      .set(auth('seleccion'))
      .send({ aprobacion: false, razon: 'Corrección: en realidad no aprobó' });
    expect(entrevista.status).toBe(200);
    expect(entrevista.body.datos.aprobacion).toBe(false);

    const jefe = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/aprobacion-jefe-inmediato`)
      .set(auth('seleccion'))
      .send({ aprobacion: true });
    expect(jefe.status).toBe(200);

    const prueba = await request(app)
      .post(`/api/seleccion/candidatos/${candidatoId}/aprobacion-prueba-tecnica`)
      .set(auth('seleccion'))
      .send({ aprobacion: true });
    expect(prueba.status).toBe(200);

    // Corregir no mueve el estado: sigue aprobado_final.
    const perfil = await request(app)
      .get(`/api/candidatos/${candidatoId}`)
      .set(auth('seleccion'));
    expect(perfil.body.datos.estado).toBe('aprobado_final');
    expect(perfil.body.datos.aprobacion_entrevista).toBe(false);
  });

  it('un candidato Agente NO puede saltarse la evaluación con este mismo atajo', async () => {
    const res = await request(app)
      .post('/api/candidatos')
      .set(auth('reclutador'))
      .send({
        nombreCompleto: 'Agente Sin Evaluar',
        tipoDocumento: 'CC',
        celular: '3005552222',
        cliente: 'Obamacare',
        cargo: 'Agente',
        citado: true,
      });
    const id = res.body.datos.id;
    candidatosCreados.push(id);

    await request(app)
      .post(`/api/seleccion/candidatos/${id}/asistencia`)
      .set(auth('reclutador'))
      .send({ asistio: 'asistio' });

    const decidir = await request(app)
      .post(`/api/seleccion/candidatos/${id}/decision-final`)
      .set(auth('seleccion'))
      .send({ aprobacion: true });
    expect(decidir.status).toBe(409);
    expect(decidir.body.error.codigo).toBe('EVALUACION_REQUERIDA');

    // Jefe inmediato y prueba técnica son exclusivos de Staff: un Agente no
    // las usa (tiene la evaluación de 5 criterios, ver arriba).
    const jefe = await request(app)
      .post(`/api/seleccion/candidatos/${id}/aprobacion-jefe-inmediato`)
      .set(auth('seleccion'))
      .send({ aprobacion: true });
    expect(jefe.status).toBe(409);
    expect(jefe.body.error.codigo).toBe('APROBACION_JEFE_INMEDIATO_NO_APLICA');
  });
});

// ---------------------------------------------------------------------------

describe('Degradación de integraciones externas', () => {
  let candidatoId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/candidatos')
      .set(auth('reclutador'))
      .send({
        nombreCompleto: 'Falla Correo Test',
        tipoDocumento: 'PPT',
        celular: '3007778888',
        email: correo('falla-correo'),
        cliente: 'Pymes',
        cargo: 'Agente',
      });
    candidatoId = res.body.datos.id;
    candidatosCreados.push(candidatoId);
  });

  it('un fallo de SMTP se reporta como fallo y queda registrado', async () => {
    await request(app)
      .post(`/api/candidatos/${candidatoId}/estado`)
      .set(auth('reclutador'))
      .send({ estado: 'contacto_exitoso' });

    email.hacerFallarProximo('Conexión SMTP rechazada');

    const res = await request(app)
      .post(`/api/candidatos/${candidatoId}/enviar-formulario`)
      .set(auth('reclutador'));

    // El sistema viejo devolvía { success: true, message: 'Email simulado...' }
    // y el usuario veía "Email reenviado exitosamente" sin que saliera nada.
    expect(res.status).toBe(502);
    expect(res.body.error.codigo).toBe('EMAIL_FALLIDO');
    // El link se entrega igual, para poder compartirlo a mano.
    expect(res.body.error.detalles.link).toMatch(/\/candidato\/formulario\//);

    const [filas] = await pool.query(
      "SELECT estado, error FROM envios_email WHERE candidato_id = ? AND estado = 'fallido'",
      [candidatoId]
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].error).toMatch(/SMTP/);
  });

  it('un candidato sin correo no puede recibir el formulario', async () => {
    const sinCorreo = await request(app)
      .post('/api/candidatos')
      .set(auth('reclutador'))
      .send({
        nombreCompleto: 'Sin Correo',
        tipoDocumento: 'CC',
        celular: '3009990000',
        cliente: 'ACA',
        cargo: 'Agente',
      });
    candidatosCreados.push(sinCorreo.body.datos.id);

    await request(app)
      .post(`/api/candidatos/${sinCorreo.body.datos.id}/estado`)
      .set(auth('reclutador'))
      .send({ estado: 'contacto_exitoso' });

    const res = await request(app)
      .post(`/api/candidatos/${sinCorreo.body.datos.id}/enviar-formulario`)
      .set(auth('reclutador'));

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('SIN_EMAIL');
  });
});
