'use strict';

/**
 * Pruebas de integración de autenticación y autorización.
 *
 * Corren contra la base real (`ReclutamientoNuevo`), no contra dobles: lo que se
 * quiere verificar aquí incluye las restricciones del esquema y la vista de
 * permisos efectivos, que un mock no ejerce.
 *
 * Cada prueba crea sus propios usuarios con correo único y los limpia al final.
 */

// `describe`/`it`/`expect`/`beforeAll`/`afterAll` vienen como globales
// (`globals: true` en vitest.config.mjs), para no mezclar ESM y CommonJS.
const request = require('supertest');

const { pool, cerrarPool } = require('../../src/config/db');
const { construirContenedor } = require('../../src/container');
const { construirApp } = require('../../src/app');
const { crearServicioPassword } = require('../../src/shared/seguridad/password');

const PASSWORD = 'Hidra2026Segura';
const sufijo = Date.now();
const correo = (nombre) => `${nombre}.${sufijo}@prueba.local`;

let app;
const idsCreados = [];

/** Da de alta un usuario directamente en la base, con los roles indicados. */
async function crearUsuario({ email, roles }) {
  const password = crearServicioPassword({ rondas: 10 });
  const hash = await password.hashear(PASSWORD);

  const [res] = await pool.query(
    'INSERT INTO usuarios (nombre_completo, email, password_hash) VALUES (?, ?, ?)',
    [`Usuario ${email}`, email, hash]
  );
  const id = res.insertId;
  idsCreados.push(id);

  if (roles.length > 0) {
    await pool.query(
      `INSERT INTO usuario_roles (usuario_id, rol_id)
       SELECT ?, id FROM roles WHERE codigo IN (${roles.map(() => '?').join(',')})`,
      [id, ...roles]
    );
  }
  return id;
}

async function iniciarSesion(email, password = PASSWORD) {
  return request(app).post('/api/auth/login').send({ email, password });
}

beforeAll(() => {
  app = construirApp(construirContenedor());
});

afterAll(async () => {
  if (idsCreados.length > 0) {
    await pool.query(
      `DELETE FROM usuarios WHERE id IN (${idsCreados.map(() => '?').join(',')})`,
      idsCreados
    );
  }
  await cerrarPool();
});

describe('POST /api/auth/login', () => {
  it('devuelve token y contexto del usuario con credenciales válidas', async () => {
    const email = correo('admin');
    await crearUsuario({ email, roles: ['administrador'] });

    const res = await iniciarSesion(email);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.datos.token).toEqual(expect.any(String));
    expect(res.body.datos.usuario.email).toBe(email);
    expect(res.body.datos.usuario.roles).toContain('administrador');
    // El hash nunca debe salir del backend.
    expect(JSON.stringify(res.body)).not.toContain('password_hash');
  });

  it('rechaza contraseña incorrecta y correo inexistente con el MISMO mensaje', async () => {
    const email = correo('existe');
    await crearUsuario({ email, roles: ['reclutamiento'] });

    const passwordMala = await iniciarSesion(email, 'ContraseñaEquivocada1');
    const usuarioInexistente = await iniciarSesion(correo('no-existe'));

    expect(passwordMala.status).toBe(401);
    expect(usuarioInexistente.status).toBe(401);
    // Si difirieran, se podría enumerar qué correos existen.
    expect(passwordMala.body.error.mensaje).toBe(usuarioInexistente.body.error.mensaje);
    expect(passwordMala.body.error.codigo).toBe('CREDENCIALES_INVALIDAS');
  });

  it('rechaza a un usuario desactivado', async () => {
    const email = correo('inactivo');
    const id = await crearUsuario({ email, roles: ['reclutamiento'] });
    await pool.query('UPDATE usuarios SET activo = FALSE WHERE id = ?', [id]);

    const res = await iniciarSesion(email);
    expect(res.status).toBe(401);
  });

  it('rechaza un cuerpo inválido con el detalle de cada campo', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'no-es-correo' });

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('VALIDACION');
    expect(res.body.error.detalles).toEqual(
      expect.arrayContaining([expect.objectContaining({ campo: 'body.email' })])
    );
  });
});

describe('Middleware de autenticación', () => {
  it('exige token en las rutas protegidas', async () => {
    const res = await request(app).get('/api/auth/perfil');
    expect(res.status).toBe(401);
  });

  it('rechaza un token con firma inválida', async () => {
    const res = await request(app)
      .get('/api/auth/perfil')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.firma-falsa');

    expect(res.status).toBe(401);
    expect(res.body.error.codigo).toBe('TOKEN_INVALIDO');
  });

  it('un token válido de un usuario desactivado después deja de servir', async () => {
    const email = correo('revocado');
    const id = await crearUsuario({ email, roles: ['reclutamiento'] });
    const { body } = await iniciarSesion(email);
    const token = body.datos.token;

    const antes = await request(app)
      .get('/api/auth/perfil')
      .set('Authorization', `Bearer ${token}`);
    expect(antes.status).toBe(200);

    await pool.query('UPDATE usuarios SET activo = FALSE WHERE id = ?', [id]);

    const despues = await request(app)
      .get('/api/auth/perfil')
      .set('Authorization', `Bearer ${token}`);
    expect(despues.status).toBe(401);
    expect(despues.body.error.codigo).toBe('USUARIO_INACTIVO');
  });
});

describe('Autorización por permisos', () => {
  it('un usuario de reclutamiento no puede listar usuarios', async () => {
    const email = correo('reclutador');
    await crearUsuario({ email, roles: ['reclutamiento'] });
    const { body } = await iniciarSesion(email);

    const res = await request(app)
      .get('/api/usuarios')
      .set('Authorization', `Bearer ${body.datos.token}`);

    expect(res.status).toBe(403);
    expect(res.body.error.codigo).toBe('PERMISO_INSUFICIENTE');
  });

  it('un administrador sí puede listar usuarios, con paginación', async () => {
    const email = correo('admin-lista');
    await crearUsuario({ email, roles: ['administrador'] });
    const { body } = await iniciarSesion(email);

    const res = await request(app)
      .get('/api/usuarios?porPagina=5')
      .set('Authorization', `Bearer ${body.datos.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.datos)).toBe(true);
    expect(res.body.meta).toMatchObject({ pagina: 1, porPagina: 5 });
  });

  it('los permisos de un usuario son la UNIÓN de todos sus roles', async () => {
    const email = correo('multirol');
    // 'reclutamiento' no da ver_usuarios; 'administrador' sí.
    await crearUsuario({ email, roles: ['reclutamiento', 'administrador'] });
    const { body } = await iniciarSesion(email);

    expect(body.datos.usuario.roles).toEqual(
      expect.arrayContaining(['reclutamiento', 'administrador'])
    );
    expect(body.datos.usuario.permisos).toContain('ver_usuarios');

    const res = await request(app)
      .get('/api/usuarios')
      .set('Authorization', `Bearer ${body.datos.token}`);
    expect(res.status).toBe(200);
  });
});

describe('Gestión de usuarios', () => {
  it('impide que quien no es administrador otorgue el rol de administrador', async () => {
    const email = correo('seleccion-escala');
    // El rol de selección tiene crear_usuarios? No: se le da explícitamente a un
    // administrador para aislar la regla de escalación del permiso de alta.
    await crearUsuario({ email, roles: ['seleccion'] });
    const { body } = await iniciarSesion(email);

    const res = await request(app)
      .post('/api/usuarios')
      .set('Authorization', `Bearer ${body.datos.token}`)
      .send({
        nombreCompleto: 'Intruso',
        email: correo('intruso'),
        password: PASSWORD,
        roles: ['administrador'],
      });

    // Selección no tiene 'crear_usuarios', así que se frena ya en el middleware.
    expect(res.status).toBe(403);
  });

  it('crea un usuario con varios roles y rechaza un rol inexistente', async () => {
    const email = correo('admin-crea');
    await crearUsuario({ email, roles: ['administrador'] });
    const { body } = await iniciarSesion(email);
    const auth = { Authorization: `Bearer ${body.datos.token}` };

    const nuevoEmail = correo('nuevo-multirol');
    const creado = await request(app)
      .post('/api/usuarios')
      .set(auth)
      .send({
        nombreCompleto: 'Nuevo Multirol',
        email: nuevoEmail,
        password: PASSWORD,
        roles: ['reclutamiento', 'seleccion'],
      });

    expect(creado.status).toBe(201);
    expect(creado.body.datos.roles.map((r) => r.codigo).sort()).toEqual([
      'reclutamiento',
      'seleccion',
    ]);
    idsCreados.push(creado.body.datos.id);

    const rolInvalido = await request(app)
      .post('/api/usuarios')
      .set(auth)
      .send({
        nombreCompleto: 'Rol Falso',
        email: correo('rol-falso'),
        password: PASSWORD,
        roles: ['superusuario'],
      });

    expect(rolInvalido.status).toBe(400);
    expect(rolInvalido.body.error.codigo).toBe('ROL_INVALIDO');
  });

  it('rechaza una contraseña débil y un correo duplicado', async () => {
    const email = correo('admin-valida');
    await crearUsuario({ email, roles: ['administrador'] });
    const { body } = await iniciarSesion(email);
    const auth = { Authorization: `Bearer ${body.datos.token}` };

    const debil = await request(app)
      .post('/api/usuarios')
      .set(auth)
      .send({
        nombreCompleto: 'Password Debil',
        email: correo('debil'),
        password: '123456',
        roles: ['reclutamiento'],
      });
    expect(debil.status).toBe(400);

    const duplicado = await request(app)
      .post('/api/usuarios')
      .set(auth)
      .send({
        nombreCompleto: 'Duplicado',
        email, // el del propio administrador
        password: PASSWORD,
        roles: ['reclutamiento'],
      });
    expect(duplicado.status).toBe(409);
    expect(duplicado.body.error.codigo).toBe('EMAIL_EN_USO');
  });

  it('no permite que un administrador se desactive a sí mismo', async () => {
    const email = correo('admin-suicida');
    const id = await crearUsuario({ email, roles: ['administrador'] });
    const { body } = await iniciarSesion(email);

    const res = await request(app)
      .delete(`/api/usuarios/${id}`)
      .set('Authorization', `Bearer ${body.datos.token}`);

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('AUTO_DESACTIVACION');
  });
});

describe('Contrato de la API', () => {
  it('responde 404 con el sobre estándar en una ruta inexistente', async () => {
    const res = await request(app).get('/api/no-existe');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ ok: false, error: { codigo: 'RUTA_NO_ENCONTRADA' } });
  });

  it('expone el health check y las cabeceras de seguridad', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.datos.estado).toBe('ok');
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
