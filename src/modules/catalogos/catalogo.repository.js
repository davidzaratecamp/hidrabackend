'use strict';

/**
 * Repositorio de catálogos.
 *
 * Reemplaza las ~370 líneas de `models/candidato.model.js:getOpcionesCatalogo()`.
 * Cambiar un cargo o una EPS pasa a ser un INSERT, no un redespliegue.
 */

/** Tablas de catálogo simples: todas comparten la forma (id, codigo, nombre, orden, activo). */
const TABLAS_SIMPLES = Object.freeze({
  tipos_documento: 'tipos_documento',
  ciudades: 'ciudades',
  fuentes_reclutamiento: 'fuentes_reclutamiento',
  tipificaciones_llamada: 'tipificaciones_llamada',
  motivos_inasistencia: 'motivos_inasistencia',
  estados_civiles: 'estados_civiles',
  generos: 'generos',
  grupos_sanguineos: 'grupos_sanguineos',
  eps: 'eps',
  afp: 'afp',
  parentescos: 'parentescos',
  tallas_camisa: 'tallas_camisa',
  niveles_estudios: 'niveles_estudios',
  herramientas_informaticas: 'herramientas_informaticas',
  tipos_antecedente: 'tipos_antecedente',
  criterios_evaluacion: 'criterios_evaluacion',
});

function crearCatalogoRepositorio({ db }) {
  /**
   * Resuelve el id de un valor de catálogo a partir de su código.
   * El nombre de tabla NUNCA viene del usuario: solo puede ser una clave de
   * TABLAS_SIMPLES, que es una constante del código.
   */
  async function idPorCodigo(catalogo, codigo) {
    const tabla = TABLAS_SIMPLES[catalogo];
    if (!tabla) throw new Error(`Catálogo desconocido: ${catalogo}`);
    if (codigo === null || codigo === undefined) return null;

    const [filas] = await db.query(
      `SELECT id FROM ${tabla} WHERE codigo = ? AND activo = TRUE LIMIT 1`,
      [codigo]
    );
    return filas[0]?.id ?? null;
  }

  async function listarSimple(catalogo) {
    const tabla = TABLAS_SIMPLES[catalogo];
    if (!tabla) throw new Error(`Catálogo desconocido: ${catalogo}`);
    const [filas] = await db.query(
      `SELECT id, codigo, nombre FROM ${tabla} WHERE activo = TRUE ORDER BY orden, nombre`
    );
    return filas;
  }

  async function idCliente(codigo) {
    const [filas] = await db.query(
      'SELECT id FROM clientes WHERE codigo = ? AND activo = TRUE LIMIT 1',
      [codigo]
    );
    return filas[0]?.id ?? null;
  }

  /** El cargo debe existir Y estar habilitado para ese cliente (tabla puente). */
  async function idCargoParaCliente(clienteId, codigoCargo) {
    const [filas] = await db.query(
      `SELECT c.id
         FROM cargos c
         JOIN cliente_cargos cc ON cc.cargo_id = c.id
        WHERE cc.cliente_id = ? AND c.codigo = ? AND c.activo = TRUE
        LIMIT 1`,
      [clienteId, codigoCargo]
    );
    return filas[0]?.id ?? null;
  }

  async function idEstadoGestion(codigo) {
    const [filas] = await db.query(
      'SELECT id FROM estados_gestion_reclutamiento WHERE codigo = ? AND activo = TRUE LIMIT 1',
      [codigo]
    );
    return filas[0]?.id ?? null;
  }

  async function listarClientes() {
    const [filas] = await db.query(
      'SELECT id, codigo, nombre FROM clientes WHERE activo = TRUE ORDER BY orden'
    );
    return filas;
  }

  /** Cargos por cliente, ya resueltos desde la relación M:N. */
  async function listarCargosPorCliente() {
    const [filas] = await db.query(
      `SELECT cl.codigo AS cliente, c.codigo, c.nombre
         FROM cliente_cargos cc
         JOIN clientes cl ON cl.id = cc.cliente_id
         JOIN cargos c    ON c.id = cc.cargo_id
        WHERE cl.activo = TRUE AND c.activo = TRUE
        ORDER BY cl.orden, c.nombre`
    );
    return filas.reduce((acc, f) => {
      (acc[f.cliente] ??= []).push({ codigo: f.codigo, nombre: f.nombre });
      return acc;
    }, {});
  }

  async function listarEstadosGestion() {
    const [filas] = await db.query(
      `SELECT codigo, nombre, grupo FROM estados_gestion_reclutamiento
        WHERE activo = TRUE ORDER BY orden`
    );
    return filas;
  }

  async function listarEstadosCandidato() {
    const [filas] = await db.query(
      `SELECT codigo, nombre, descripcion, color, etapa, es_terminal
         FROM estados_candidato WHERE activo = TRUE ORDER BY orden`
    );
    return filas;
  }

  /** Todo el catálogo en una respuesta, como espera el frontend. */
  async function listarTodo() {
    const simples = {};
    await Promise.all(
      Object.keys(TABLAS_SIMPLES).map(async (nombre) => {
        simples[nombre] = await listarSimple(nombre);
      })
    );

    const [clientes, cargosPorCliente, estadosGestion, estadosCandidato] = await Promise.all([
      listarClientes(),
      listarCargosPorCliente(),
      listarEstadosGestion(),
      listarEstadosCandidato(),
    ]);

    return {
      ...simples,
      clientes,
      cargos_por_cliente: cargosPorCliente,
      estados_gestion_reclutamiento: estadosGestion,
      estados_candidato: estadosCandidato,
    };
  }

  return {
    idPorCodigo,
    listarSimple,
    idCliente,
    idCargoParaCliente,
    idEstadoGestion,
    listarClientes,
    listarCargosPorCliente,
    listarEstadosGestion,
    listarEstadosCandidato,
    listarTodo,
  };
}

module.exports = { crearCatalogoRepositorio, TABLAS_SIMPLES };
