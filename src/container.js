'use strict';

/**
 * Raíz de composición.
 *
 * Es el ÚNICO archivo que sabe cómo se conectan las piezas entre sí. Todo lo
 * demás recibe sus dependencias por parámetro y no importa nada concreto: por
 * eso un servicio se puede probar con un repositorio falso, y las pruebas de
 * extremo a extremo pueden inyectar adaptadores de correo y de firma en memoria
 * sin tocar el código de producción.
 *
 * Es también lo que sustituye a `global.db`. Ningún módulo alcanza el pool por
 * su cuenta.
 */

const config = require('./config/env');
const logger = require('./config/logger');
const { pool, conTransaccion } = require('./config/db');
const { poolHistorico } = require('./config/dbHistorico');

const { crearUnidadDeTrabajo } = require('./shared/db/unidadDeTrabajo');
const { crearServicioPassword } = require('./shared/seguridad/password');
const { crearServicioToken } = require('./shared/seguridad/token');
const { crearAutenticar, crearAutenticarOpcional } = require('./shared/middleware/autenticar');

// Repositorios
const { crearUsuarioRepositorio } = require('./modules/usuarios/usuario.repository');
const { crearRolRepositorio } = require('./modules/usuarios/rol.repository');
const { crearCatalogoRepositorio } = require('./modules/catalogos/catalogo.repository');
const {
  crearCandidatoRepositorio,
  crearEstadoRepositorio,
} = require('./modules/candidatos/candidato.repository');
const { crearFormularioRepositorio } = require('./modules/formulario/formulario.repository');
const { crearSeleccionRepositorio } = require('./modules/seleccion/seleccion.repository');
const { crearAntecedentesRepositorio } = require('./modules/antecedentes/antecedentes.repository');
const { crearTrazabilidadRepositorio } = require('./modules/trazabilidad/trazabilidad.repository');
const { crearReportesRepositorio } = require('./modules/reportes/reportes.repository');
const { crearHistoricoRepositorio } = require('./modules/historico/historico.repository');

// Servicios
const { crearUsuarioServicio } = require('./modules/usuarios/usuario.service');
const { crearAuthServicio } = require('./modules/auth/auth.service');
const { crearEstadoServicio } = require('./modules/candidatos/estado.service');
const { crearCandidatoServicio } = require('./modules/candidatos/candidato.service');
const { crearDocumentosServicio } = require('./modules/documentos/documentos.service');
const { crearFormularioServicio } = require('./modules/formulario/formulario.service');
const { crearSeleccionServicio } = require('./modules/seleccion/seleccion.service');
const { crearAntecedentesServicio } = require('./modules/antecedentes/antecedentes.service');

// Integraciones
const { crearEmailNodemailer, crearEmailMemoria } = require('./modules/integraciones/email');
const {
  crearFirmaCloudHttp,
  crearFirmaCloudMemoria,
} = require('./modules/integraciones/firmacloud');
const { crearNominaHttp, crearNominaMemoria } = require('./modules/integraciones/nomina');

// Controladores y rutas
const { crearUsuarioControlador } = require('./modules/usuarios/usuario.controller');
const { crearUsuarioRutas, crearRolRutas } = require('./modules/usuarios/usuario.routes');
const { crearAuthControlador } = require('./modules/auth/auth.controller');
const { crearAuthRutas } = require('./modules/auth/auth.routes');
const { crearCandidatoControlador } = require('./modules/candidatos/candidato.controller');
const { crearCandidatoRutas } = require('./modules/candidatos/candidato.routes');
const { crearCatalogoRutas } = require('./modules/catalogos/catalogo.routes');
const {
  crearFormularioRutas,
  crearFirmaRutas,
} = require('./modules/formulario/formulario.routes');
const { crearSeleccionRutas } = require('./modules/seleccion/seleccion.routes');
const { crearAntecedentesRutas } = require('./modules/antecedentes/antecedentes.routes');
const { crearTrazabilidadRutas } = require('./modules/trazabilidad/trazabilidad.routes');
const { crearReportesRutas } = require('./modules/reportes/reportes.routes');
const { crearHistoricoRutas } = require('./modules/historico/historico.routes');
const { crearDesprendiblesRutas } = require('./modules/desprendibles/desprendibles.routes');

/**
 * Elige el adaptador de correo.
 *
 * Sin SMTP configurado se usa el de memoria en vez de fallar el arranque: en
 * desarrollo se puede trabajar todo el embudo y leer el link del formulario en
 * los logs, sin montar un servidor de correo.
 */
function elegirEmail(sobrescrituras) {
  if (sobrescrituras.email) return sobrescrituras.email;
  if (config.email.configurado) return crearEmailNodemailer({ config: config.email, logger });
  logger.warn('Correo sin configurar: se usa el adaptador en memoria (no se envía nada real)');
  return crearEmailMemoria({ logger });
}

function elegirFirma(sobrescrituras) {
  if (sobrescrituras.firma) return sobrescrituras.firma;
  if (config.firmacloud.configurado) {
    return crearFirmaCloudHttp({ config: config.firmacloud, logger });
  }
  logger.warn('FirmaCloud sin configurar: se usa el adaptador en memoria');
  return crearFirmaCloudMemoria({ logger });
}

/**
 * @param {object} [sobrescrituras] Reemplazos para pruebas: `db`, `conTransaccion`,
 *   `email`, `firma`.
 */
/**
 * Los desprendibles son una integración opcional: sin configurar, el resto del
 * sistema funciona y solo esa pantalla avisa que no está disponible.
 */
function elegirNomina(sobrescrituras) {
  if (sobrescrituras.nomina) return sobrescrituras.nomina;
  if (config.nomina.configurado) return crearNominaHttp({ config: config.nomina, logger });
  logger.warn('Nómina sin configurar: los desprendibles no estarán disponibles');
  return crearNominaMemoria();
}

function construirContenedor(sobrescrituras = {}) {
  const db = sobrescrituras.db ?? pool;
  const transaccion = sobrescrituras.conTransaccion ?? conTransaccion;

  // --- Infraestructura -------------------------------------------------------
  const servicioPassword = crearServicioPassword({ rondas: config.auth.rondasBcrypt });
  const servicioToken = crearServicioToken({
    secreto: config.auth.jwtSecret,
    expiraEn: config.auth.jwtExpiraEn,
    emisor: config.auth.jwtEmisor,
  });
  const email = elegirEmail(sobrescrituras);
  const firma = elegirFirma(sobrescrituras);
  const nomina = elegirNomina(sobrescrituras);

  // Fábricas disponibles dentro de una transacción.
  const fabricas = {
    usuarioRepo: crearUsuarioRepositorio,
    rolRepo: crearRolRepositorio,
    catalogoRepo: crearCatalogoRepositorio,
    candidatoRepo: crearCandidatoRepositorio,
    estadoRepo: crearEstadoRepositorio,
    formularioRepo: crearFormularioRepositorio,
    seleccionRepo: crearSeleccionRepositorio,
    antecedentesRepo: crearAntecedentesRepositorio,
  };
  const uow = crearUnidadDeTrabajo({ conTransaccion: transaccion, fabricas });

  // --- Repositorios sobre el pool -------------------------------------------
  const usuarioRepo = crearUsuarioRepositorio({ db });
  const rolRepo = crearRolRepositorio({ db });
  const catalogoRepo = crearCatalogoRepositorio({ db });
  const candidatoRepo = crearCandidatoRepositorio({ db });
  const estadoRepo = crearEstadoRepositorio({ db });
  const formularioRepo = crearFormularioRepositorio({ db });
  const seleccionRepo = crearSeleccionRepositorio({ db });
  const antecedentesRepo = crearAntecedentesRepositorio({ db });
  const trazabilidadRepo = crearTrazabilidadRepositorio({ db });
  const reportesRepo = crearReportesRepositorio({ db });

  // Archivo histórico: otra base, otro pool, y `null` si no está configurada.
  // No entra en la unidad de trabajo porque nunca participa de una transacción:
  // solo se lee.
  const dbHistorico = sobrescrituras.dbHistorico ?? poolHistorico;
  const historicoRepo = dbHistorico ? crearHistoricoRepositorio({ db: dbHistorico }) : null;

  // --- Middlewares con dependencias de datos ---------------------------------
  const autenticar = crearAutenticar({ servicioToken, usuarioRepo });
  const autenticarOpcional = crearAutenticarOpcional({ servicioToken, usuarioRepo });

  // --- Servicios -------------------------------------------------------------
  const usuarioServicio = crearUsuarioServicio({ usuarioRepo, rolRepo, servicioPassword, uow });
  const authServicio = crearAuthServicio({ usuarioRepo, servicioPassword, servicioToken, logger });

  const estadoServicio = crearEstadoServicio({ estadoRepo });
  const candidatoServicio = crearCandidatoServicio({
    candidatoRepo, catalogoRepo, estadoServicio, uow,
  });
  const documentosServicio = crearDocumentosServicio({ formularioRepo, logger });
  const formularioServicio = crearFormularioServicio({
    formularioRepo, candidatoRepo, catalogoRepo, candidatoServicio, estadoServicio,
    documentosServicio, email, firma, uow, config, logger,
  });
  const seleccionServicio = crearSeleccionServicio({
    seleccionRepo, candidatoRepo, catalogoRepo, candidatoServicio, estadoServicio, uow,
  });
  const antecedentesServicio = crearAntecedentesServicio({
    antecedentesRepo, candidatoServicio, config, logger,
  });

  // --- Controladores ---------------------------------------------------------
  const usuarioControlador = crearUsuarioControlador({ usuarioServicio });
  const authControlador = crearAuthControlador({ authServicio });
  const candidatoControlador = crearCandidatoControlador({
    candidatoServicio, formularioServicio,
  });

  // --- Routers ---------------------------------------------------------------
  const routers = {
    '/api/auth': crearAuthRutas({ authControlador, autenticar }),
    '/api/usuarios': crearUsuarioRutas({ usuarioControlador, autenticar }),
    '/api/roles': crearRolRutas({ usuarioControlador, autenticar }),
    '/api/catalogos': crearCatalogoRutas({ catalogoRepo }),
    '/api/candidatos': crearCandidatoRutas({ candidatoControlador, autenticar }),
    '/api/formulario': crearFormularioRutas({ formularioServicio }),
    '/api/firma': crearFirmaRutas({ formularioServicio, autenticar }),
    '/api/seleccion': crearSeleccionRutas({ seleccionServicio, autenticar }),
    '/api/antecedentes': crearAntecedentesRutas({ antecedentesServicio, autenticar }),
    '/api/trazabilidad': crearTrazabilidadRutas({ trazabilidadRepo, autenticar }),
    '/api/reportes': crearReportesRutas({ reportesRepo, autenticar }),
    '/api/historico': crearHistoricoRutas({ historicoRepo, autenticar }),
    '/api/desprendibles': crearDesprendiblesRutas({ nomina, autenticar }),
  };

  return {
    config,
    logger,
    db,
    routers,
    middlewares: { autenticar, autenticarOpcional },
    integraciones: { email, firma, nomina },
    servicios: {
      usuarioServicio, authServicio, candidatoServicio, estadoServicio,
      formularioServicio, seleccionServicio, antecedentesServicio, documentosServicio,
    },
    repositorios: {
      usuarioRepo, rolRepo, catalogoRepo, candidatoRepo,
      formularioRepo, seleccionRepo, antecedentesRepo, trazabilidadRepo, reportesRepo,
      historicoRepo,
    },
  };
}

module.exports = { construirContenedor };
