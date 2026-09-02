'use strict';

/**
 * Consulta de la base histórica (`noviembrehidra`, tablas `hyd_*`).
 *
 * SOLO LECTURA. Aquí no hay ni un INSERT, ni un UPDATE, ni un DELETE, y no debe
 * haberlos: esa base es el archivo del sistema anterior y se conserva tal cual.
 *
 * El esquema viejo era una tabla ancha: `hyd_candidatos` tiene ~130 columnas con
 * la hoja de vida entera desnormalizada (los catálogos eran texto libre, así que
 * `cliente`, `cargo`, `ciudad` y `estado` son cadenas, no claves foráneas). Una
 * migración posterior creó tablas satélite (`hyd_candidato_estudios`,
 * `hyd_candidato_experiencia`, …) pero solo alcanzó a llenarlas para un puñado
 * de candidatos, así que el detalle lee de las dos fuentes: las columnas anchas
 * y, si existen, las filas satélite.
 *
 * Los nombres que salen de aquí son los del sistema NUEVO (`email`, `celular`),
 * no los del viejo (`email_personal`, `numero_celular`): el frontend no tiene
 * por qué aprender dos esquemas para pintar una lista.
 */

const { contiene, identificadorSeguro } = require('../../shared/utils/sql');
const { nombreCompleto } = require('../../shared/utils/nombreCompleto');
const { siNoBooleano, textoAntecedente, textoAsistencia, textoEstadoGestion } = require('./historico.presentacion');

const ORDEN_PERMITIDO = [
  'created_at',
  'updated_at',
  'primer_apellido',
  'fecha_citacion_entrevista',
];

/**
 * Columnas visibles solo con `ver_perfiles_completos`: valoración psicológica
 * (antecedentes, decisión final), no información de contacto. Mismo criterio
 * que la ficha (`obtenerPorId`), aplicado aquí por `historico.routes.js`.
 */
const CAMPOS_PERFIL_COMPLETO = Object.freeze([
  'antecedentesAdres', 'antecedentesPol', 'antecedentesComp', 'antecedentesProcu',
  'aprobado', 'razonNoAprobado',
]);

/** Columnas de la lista. Se piden explícitas: `SELECT *` traería 130 columnas. */
const SELECT_LISTA = `
  SELECT c.id, c.primer_nombre, c.segundo_nombre, c.primer_apellido, c.segundo_apellido,
         c.tipo_documento, c.numero_documento, c.edad, c.nacionalidad,
         c.email_personal, c.numero_celular, c.contacto_llamada, c.contacto_whatsapp,
         c.cliente, c.cargo, c.ciudad, c.estado,
         c.fecha_citacion_entrevista, c.asistio_citacion, c.fecha_asistencia,
         c.motivo_inasistencia,
         c.estado_gestion_reclutamiento, c.perfil,
         c.antecedentes_adres, c.antecedentes_pol, c.antecedentes_comp, c.antecedentes_procu,
         c.evaluacion_total, c.aprobacion_final, c.aprobacion_final_razon,
         c.created_at, c.updated_at,
         c.reclutador_id, u.nombre_completo AS reclutador_nombre
    FROM hyd_candidatos c
    LEFT JOIN hyd_usuarios u ON u.id = c.reclutador_id
`;

/**
 * Filtros de igualdad exacta: nombre público -> columna.
 *
 * No se expone `oleada`: era un módulo muerto del sistema viejo (ver la nota de
 * `db/migrations/003_candidatos.sql`) y no se reconstruye en ningún lado.
 */
const FILTROS_EXACTOS = Object.freeze({
  estado: 'c.estado',
  cliente: 'c.cliente',
  cargo: 'c.cargo',
  ciudad: 'c.ciudad',
  reclutadorId: 'c.reclutador_id',
  // Alerta de duplicado en "Nuevo candidato" (ver candidatos/NuevoCandidato.jsx):
  // exacto, no LIKE como `busqueda`, para no marcar coincidencia por un
  // número que solo comparte algunos dígitos.
  numeroDocumento: 'c.numero_documento',
});

function crearHistoricoRepositorio({ db }) {
  /**
   * Traduce los filtros públicos a WHERE + parámetros.
   *
   * El nombre de columna NUNCA viene de la petición: sale de FILTROS_EXACTOS y
   * del ORDEN_PERMITIDO. Todo valor va parametrizado.
   */
  function armarFiltros({ busqueda, desde, hasta, ...resto }) {
    const condiciones = [];
    const params = [];

    for (const [clave, columna] of Object.entries(FILTROS_EXACTOS)) {
      const valor = resto[clave];
      if (valor === undefined || valor === null || valor === '') continue;
      condiciones.push(`${columna} = ?`);
      params.push(valor);
    }

    if (desde) {
      condiciones.push('c.created_at >= ?');
      params.push(`${desde} 00:00:00`);
    }
    if (hasta) {
      condiciones.push('c.created_at <= ?');
      params.push(`${hasta} 23:59:59`);
    }

    if (busqueda) {
      // El nombre se busca sobre la concatenación: el esquema viejo lo guarda en
      // cuatro columnas, y quien escribe "maria gomez" espera encontrarlo.
      condiciones.push(
        `(CONCAT_WS(' ', c.primer_nombre, c.segundo_nombre, c.primer_apellido, c.segundo_apellido)
            LIKE ? ESCAPE '\\\\'
          OR c.numero_documento LIKE ? ESCAPE '\\\\'
          OR c.email_personal LIKE ? ESCAPE '\\\\'
          OR c.numero_celular LIKE ? ESCAPE '\\\\')`
      );
      const p = contiene(busqueda);
      params.push(p, p, p, p);
    }

    return {
      where: condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '',
      params,
    };
  }

  /**
   * Listado paginado. Por defecto del más reciente al más antiguo.
   *
   * El desempate por `c.id DESC` no es decorativo: `created_at` es un TIMESTAMP
   * en segundos y la carga masiva del sistema viejo insertó miles de candidatos
   * dentro del mismo segundo. Sin desempate, dos páginas consecutivas podrían
   * repetir u omitir filas.
   */
  async function listar({ pagina, porPagina, ordenarPor, direccion, ...filtros }) {
    const { where, params } = armarFiltros(filtros);
    const columna = identificadorSeguro(ordenarPor, ORDEN_PERMITIDO);
    const sentido = direccion === 'asc' ? 'ASC' : 'DESC';

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM hyd_candidatos c ${where}`,
      params
    );

    const [filas] = await db.query(
      `${SELECT_LISTA} ${where} ORDER BY c.${columna} ${sentido}, c.id DESC LIMIT ? OFFSET ?`,
      [...params, porPagina, (pagina - 1) * porPagina]
    );

    return {
      items: filas.map((f) => ({ ...aResumen(f), ...camposPerfilCompleto(f) })),
      total: Number(total),
    };
  }

  /** Ficha completa. `null` si el id no existe en el archivo. */
  async function obtenerPorId(id) {
    const [filas] = await db.query(
      `SELECT c.*, u.nombre_completo AS reclutador_nombre, u.email AS reclutador_email
         FROM hyd_candidatos c
         LEFT JOIN hyd_usuarios u ON u.id = c.reclutador_id
        WHERE c.id = ?`,
      [id]
    );
    if (filas.length === 0) return null;

    // Las tablas satélite solo tienen datos para los candidatos que alcanzaron a
    // llenar el formulario después de la normalización; para el resto vienen
    // vacías y el detalle se arma con las columnas anchas.
    const [estudios, experiencia, personal, datosBasicos, resumenExperiencia] = await Promise.all([
      db.query(
        `SELECT nivel_estudios, descripcion, nombre_institucion, titulo_obtenido, ano_finalizacion
           FROM hyd_candidato_estudios WHERE candidato_id = ? ORDER BY id`,
        [id]
      ),
      db.query(
        `SELECT orden, nombre_empresa, cargo_desempenado, salario, funciones,
                fecha_inicio, fecha_retiro, tiempo_laborado_anos, tiempo_laborado_meses,
                motivo_retiro
           FROM hyd_candidato_experiencia WHERE candidato_id = ? ORDER BY orden, id`,
        [id]
      ),
      db.query('SELECT * FROM hyd_candidato_personal WHERE candidato_id = ?', [id]),
      db.query('SELECT * FROM hyd_candidato_datos_basicos WHERE candidato_id = ?', [id]),
      db.query('SELECT * FROM hyd_candidato_experiencia_resumen WHERE candidato_id = ?', [id]),
    ]);

    return aDetalle(filas[0], {
      estudios: estudios[0],
      experiencia: experiencia[0],
      personal: personal[0][0] ?? null,
      datosBasicos: datosBasicos[0][0] ?? null,
      resumenExperiencia: resumenExperiencia[0][0] ?? null,
    });
  }

  /**
   * Valores presentes en el archivo, para poblar los desplegables del filtro.
   *
   * Se leen de los datos y no de una lista fija porque en el esquema viejo estos
   * campos eran texto libre: cualquier lista escrita a mano quedaría desfasada
   * respecto de lo que hay realmente guardado.
   */
  async function filtrosDisponibles() {
    const distintos = async (columna) => {
      const [filas] = await db.query(
        `SELECT ${columna} AS valor, COUNT(*) AS total
           FROM hyd_candidatos
          WHERE ${columna} IS NOT NULL AND ${columna} <> ''
          GROUP BY ${columna}
          ORDER BY total DESC, valor`
      );
      return filas.map((f) => ({ valor: f.valor, total: Number(f.total) }));
    };

    // Los nombres de columna son constantes del código, nunca entrada del usuario.
    const [estados, clientes, cargos, ciudades] = await Promise.all([
      distintos('estado'),
      distintos('cliente'),
      distintos('cargo'),
      distintos('ciudad'),
    ]);

    const [reclutadores] = await db.query(
      `SELECT u.id, u.nombre_completo, u.email, COUNT(c.id) AS total
         FROM hyd_usuarios u
         JOIN hyd_candidatos c ON c.reclutador_id = u.id
        GROUP BY u.id, u.nombre_completo, u.email
        ORDER BY total DESC, u.nombre_completo`
    );

    const [[rango]] = await db.query(
      `SELECT COUNT(*) AS total, MIN(created_at) AS desde, MAX(created_at) AS hasta
         FROM hyd_candidatos`
    );

    return {
      estados,
      clientes,
      cargos,
      ciudades,
      reclutadores: reclutadores.map((r) => ({
        id: r.id,
        nombreCompleto: r.nombre_completo,
        email: r.email,
        total: Number(r.total),
      })),
      totalCandidatos: Number(rango.total),
      rangoFechas: { desde: rango.desde, hasta: rango.hasta },
    };
  }

  /**
   * Filas crudas para el Excel "BASE RECLUTAMIENTO" del archivo histórico.
   *
   * Sin `desde`/`hasta`: los últimos 100 candidatos registrados (por
   * `created_at`, la fecha de registro en "Nuevo candidato" — NO
   * `fecha_citacion_entrevista`, que es una columna distinta y casi nunca la
   * escribió nadie de forma confiable). Con alguna de las dos fechas: todos
   * los del rango, sin tope.
   */
  async function candidatosBaseReclutamiento({ desde, hasta }) {
    const condiciones = [];
    const params = [];
    if (desde) { condiciones.push('c.created_at >= ?'); params.push(`${desde} 00:00:00`); }
    if (hasta) { condiciones.push('c.created_at <= ?'); params.push(`${hasta} 23:59:59`); }
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const limite = desde || hasta ? '' : 'LIMIT 100';

    const [filas] = await db.query(
      `SELECT c.primer_nombre, c.segundo_nombre, c.primer_apellido, c.segundo_apellido,
              c.tipo_documento, c.numero_documento, c.edad, c.email_personal,
              c.contacto_llamada, c.contacto_whatsapp, c.cliente, c.cargo,
              c.estado, c.created_at, c.asistio_citacion, c.motivo_inasistencia,
              c.antecedentes_adres, c.antecedentes_pol, c.antecedentes_comp, c.antecedentes_procu,
              c.evaluacion_total, c.aprobacion_final, c.aprobacion_final_razon,
              u.nombre_completo AS reclutador_nombre
         FROM hyd_candidatos c
         LEFT JOIN hyd_usuarios u ON u.id = c.reclutador_id
         ${where}
        ORDER BY c.created_at DESC
        ${limite}`,
      params
    );
    return filas;
  }

  return { listar, obtenerPorId, filtrosDisponibles, candidatosBaseReclutamiento };
}

/**
 * Columnas de "BASE RECLUTAMIENTO" que son valoración psicológica, no
 * información de contacto: separadas de `aResumen` a propósito, para que
 * `obtenerPorId` (que ya las expone, pero solo dentro de `seleccion`, con su
 * propio gate) no las herede sin querer al hacer `...aResumen(f)`. Solo
 * `listar()` las agrega, y `historico.routes.js` las retira de la respuesta
 * si el usuario no tiene `ver_perfiles_completos` — mismo criterio que la
 * ficha completa.
 */
function camposPerfilCompleto(f) {
  return {
    antecedentesAdres: textoAntecedente(f.antecedentes_adres),
    antecedentesPol: textoAntecedente(f.antecedentes_pol),
    antecedentesComp: textoAntecedente(f.antecedentes_comp),
    antecedentesProcu: textoAntecedente(f.antecedentes_procu),
    aprobado: siNoBooleano(f.aprobacion_final),
    razonNoAprobado: f.aprobacion_final_razon ?? null,
  };
}

/** Fila de la lista, con los nombres del esquema nuevo. */
function aResumen(f) {
  return {
    id: f.id,
    nombreCompleto: nombreCompleto(f),
    primerNombre: f.primer_nombre,
    segundoNombre: f.segundo_nombre,
    primerApellido: f.primer_apellido,
    segundoApellido: f.segundo_apellido,
    tipoDocumento: f.tipo_documento,
    numeroDocumento: f.numero_documento,
    nacionalidad: f.nacionalidad,
    edad: f.edad,
    email: f.email_personal,
    celular: f.numero_celular,
    contactoLlamada: f.contacto_llamada === 'si',
    contactoWhatsapp: f.contacto_whatsapp === 'si',
    cliente: f.cliente,
    cargo: f.cargo,
    ciudad: f.ciudad,
    perfil: f.perfil,
    estado: f.estado,
    estadoGestion: f.estado_gestion_reclutamiento,
    fechaCitacion: f.fecha_citacion_entrevista,
    asistioCitacion: f.asistio_citacion,
    asisteEntrevista: textoAsistencia(f.asistio_citacion),
    fechaAsistencia: f.fecha_asistencia,
    motivoInasistencia: f.motivo_inasistencia ?? null,
    // "ESTADO GESTIÓN RECLUTAMIENTO" del documento oficial "BASE
    // RECLUTAMIENTO": mismo texto que el Excel histórico, para que la vista
    // en pantalla y lo descargado digan lo mismo.
    estadoGestionReclutamiento: textoEstadoGestion(f),
    reclutador: f.reclutador_id
      ? { id: f.reclutador_id, nombreCompleto: f.reclutador_nombre }
      : null,
    createdAt: f.created_at,
    updatedAt: f.updated_at,
  };
}

/**
 * Ficha completa.
 *
 * El bloque `seleccion` (evaluación de la entrevista, antecedentes y decisión
 * final) se separa del resto a propósito: la ruta lo entrega solo a quien tiene
 * `ver_perfiles_completos`, igual que en el sistema nuevo.
 */
function aDetalle(f, satelites) {
  const { estudios, experiencia, personal, datosBasicos, resumenExperiencia } = satelites;

  return {
    ...aResumen(f),

    fuenteReclutamiento: f.fuente_reclutamiento,
    observacionesLlamada: f.observaciones_llamada,
    observacionesGenerales: f.observaciones_generales,
    motivoNoCitado: f.motivo_no_citado,
    motivoInasistencia: f.motivo_inasistencia,
    citadoGestion: f.citado_gestion,
    fechaEnvioEmail: f.fecha_envio_email,
    reasignadoPorId: f.reasignado_por_id,
    fechaReasignacion: f.fecha_reasignacion,

    datosBasicos: {
      genero: datosBasicos?.genero ?? f.genero,
      fechaNacimiento: datosBasicos?.fecha_nacimiento ?? f.fecha_nacimiento,
      estadoCivil: datosBasicos?.estado_civil ?? f.estado_civil,
      grupoSanguineo: datosBasicos?.grupo_sanguineo ?? f.grupo_sanguineo,
      eps: datosBasicos?.eps ?? f.eps,
      afp: datosBasicos?.afp ?? f.afp,
      direccionResidencial: datosBasicos?.direccion_residencial ?? null,
      barrio: datosBasicos?.barrio ?? null,
      tallaCamisa: datosBasicos?.talla_camisa ?? null,
      aspiracionSalarial: aNumero(datosBasicos?.aspiracion_salarial),
      contactoEmergencia: {
        nombre: datosBasicos?.nombre_emergencia ?? f.nombre_emergencia,
        numero: datosBasicos?.numero_emergencia ?? f.numero_emergencia,
        parentesco: datosBasicos?.parentesco_emergencia ?? f.parentesco_emergencia,
      },
    },

    estudios: {
      // Columnas anchas: es lo que tiene la inmensa mayoría del archivo.
      nivelEstudios: f.nivel_estudios,
      tituloObtenido: f.titulo_obtenido,
      nombreInstitucion: f.nombre_institucion,
      anoFinalizacion: f.ano_finalizacion,
      conocimientoExcel: personal?.conocimiento_excel ?? f.conocimiento_excel,
      conocimientoWord: personal?.conocimiento_word ?? f.conocimiento_word,
      conocimientoPowerpoint: personal?.conocimiento_powerpoint ?? f.conocimiento_powerpoint,
      // Filas satélite, cuando el candidato llenó el formulario normalizado.
      detalle: estudios.map((e) => ({
        nivelEstudios: e.nivel_estudios,
        descripcion: e.descripcion,
        nombreInstitucion: e.nombre_institucion,
        tituloObtenido: e.titulo_obtenido,
        anoFinalizacion: e.ano_finalizacion,
      })),
    },

    experiencia: {
      nombreEmpresa: f.nombre_empresa,
      cargoDesempenado: f.cargo_desempenado,
      salario: aNumero(f.salario_experiencia),
      fechaInicio: f.fecha_inicio_experiencia,
      fechaRetiro: f.fecha_retiro_experiencia,
      tiempoLaboradoAnos: f.tiempo_laborado_anos,
      tiempoLaboradoMeses: f.tiempo_laborado_meses,
      motivoRetiro: f.motivo_retiro,
      haTrabajadoAsiste: resumenExperiencia?.ha_trabajado_asiste ?? f.ha_trabajado_asiste,
      comercialCertificada:
        resumenExperiencia?.experiencia_comercial_certificada ??
        f.experiencia_comercial_certificada,
      comercialNoCertificada:
        resumenExperiencia?.experiencia_comercial_no_certificada ??
        f.experiencia_comercial_no_certificada,
      primerEmpleoFormal: resumenExperiencia?.primer_empleo_formal ?? f.primer_empleo_formal,
      detalle: experiencia.map((e) => ({
        orden: e.orden,
        nombreEmpresa: e.nombre_empresa,
        cargoDesempenado: e.cargo_desempenado,
        salario: aNumero(e.salario),
        funciones: e.funciones,
        fechaInicio: e.fecha_inicio,
        fechaRetiro: e.fecha_retiro,
        tiempoLaboradoAnos: e.tiempo_laborado_anos,
        tiempoLaboradoMeses: e.tiempo_laborado_meses,
        motivoRetiro: e.motivo_retiro,
      })),
    },

    personal: {
      fortalezas: personal?.fortalezas ?? f.fortalezas,
      aspectosMejorar: personal?.aspectos_mejorar ?? f.aspectos_mejorar,
      competenciasLaborales: personal?.competencias_laborales ?? f.competencias_laborales,
      autoevaluacion: personal?.autoevaluacion ?? f.autoevaluacion,
      genograma: personal?.genograma ?? f.genograma,
      metasCortoPlazo: personal?.metas_corto_plazo ?? f.metas_corto_plazo,
      metasMedianoPlazo: personal?.metas_mediano_plazo ?? f.metas_mediano_plazo,
      metasLargoPlazo: personal?.metas_largo_plazo ?? f.metas_largo_plazo,
      expectativaLaboral: personal?.expectativa_laboral ?? null,
    },

    formularios: {
      hojaVida: { completado: f.formulario_hoja_vida_completado, fecha: f.fecha_completado_hoja_vida },
      datosBasicos: {
        completado: f.formulario_datos_basicos_completado,
        fecha: f.fecha_completado_datos_basicos,
      },
      estudios: { completado: f.formulario_estudios_completado, fecha: f.fecha_completado_estudios },
      experiencia: {
        completado: f.formulario_experiencia_completado,
        fecha: f.fecha_completado_experiencia,
      },
      personal: { completado: f.formulario_personal_completado, fecha: f.fecha_completado_personal },
      consentimiento: {
        completado: f.formulario_consentimiento_completado,
        fecha: f.fecha_completado_consentimiento,
        aceptado: f.consentimiento_aceptado,
        ciudad: f.ciudad_consentimiento,
      },
      firmacloudSignatureId: f.firmacloud_signature_id,
    },

    seleccion: {
      evaluacion: {
        saludo: aNumero(f.evaluacion_saludo),
        perfilamiento: aNumero(f.evaluacion_perfilamiento),
        producto: aNumero(f.evaluacion_producto),
        objeciones: aNumero(f.evaluacion_objeciones),
        cierre: aNumero(f.evaluacion_cierre),
        total: aNumero(f.evaluacion_total),
        aprobado: f.evaluacion_aprobado,
        razonRechazo: f.evaluacion_razon_rechazo,
        fecha: f.fecha_evaluacion,
      },
      observaciones: f.observaciones_seleccion,
      antecedentes: {
        fecha: f.fecha_antecedentes,
        adres: antecedente(f, 'adres'),
        policia: antecedente(f, 'pol'),
        contraloria: antecedente(f, 'comp'),
        procuraduria: antecedente(f, 'procu'),
      },
      decisionFinal: {
        aprobado: f.aprobacion_final,
        razon: f.aprobacion_final_razon,
        fecha: f.fecha_aprobacion_final,
        psicologoId: f.psicologo_decision_id,
      },
    },
  };
}

/** Los cuatro antecedentes están en columnas con el mismo sufijo repetido. */
function antecedente(f, prefijo) {
  return {
    resultado: f[`antecedentes_${prefijo}`],
    novedad: f[`antecedentes_${prefijo}_novedad`],
    documento: f[`antecedentes_${prefijo}_documento_nombre`],
  };
}

/** DECIMAL llega como string desde el driver; el frontend espera un número. */
function aNumero(valor) {
  return valor === null || valor === undefined ? null : Number(valor);
}

module.exports = { crearHistoricoRepositorio, ORDEN_PERMITIDO, CAMPOS_PERFIL_COMPLETO };
