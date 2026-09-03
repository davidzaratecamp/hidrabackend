'use strict';

/**
 * Repositorio del formulario que llena el candidato por link con token.
 *
 * Los tokens viven en `candidato_tokens_formulario` (1:N) en vez de en una
 * columna que se sobrescribe: así se conserva el historial de envíos y un token
 * anterior queda explícitamente revocado, que es lo que hoy produce el
 * "404 Token inválido" confuso al abrir el link de un correo viejo.
 */

const PASOS = Object.freeze([
  'hoja_vida', 'datos_basicos', 'estudios', 'experiencia', 'personal', 'consentimiento',
]);

function crearFormularioRepositorio({ db }) {
  // ---------------------------------------------------------------- tokens --
  async function revocarTokensVigentes(candidatoId) {
    await db.query(
      `UPDATE candidato_tokens_formulario
          SET revocado_en = NOW()
        WHERE candidato_id = ? AND revocado_en IS NULL AND usado_en IS NULL`,
      [candidatoId]
    );
  }

  async function emitirToken({ candidatoId, token, diasVigencia, enviadoPorId }) {
    const [res] = await db.query(
      `INSERT INTO candidato_tokens_formulario
         (candidato_id, token, enviado_por_id, expira_en)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
      [candidatoId, token, enviadoPorId ?? null, diasVigencia]
    );
    return res.insertId;
  }

  /** Devuelve el token con el candidato asociado, o null si no existe. */
  async function buscarToken(token) {
    const [filas] = await db.query(
      `SELECT t.id, t.candidato_id, t.expira_en, t.usado_en, t.revocado_en, t.enviado_en,
              t.expira_en > NOW() AS vigente,
              c.primer_nombre, c.segundo_nombre, c.primer_apellido, c.segundo_apellido,
              c.numero_documento, c.celular, c.email, c.edad,
              ca.codigo AS cargo, fr.codigo AS fuente_reclutamiento,
              td.nacionalidad,
              ec.codigo AS estado
         FROM candidato_tokens_formulario t
         JOIN candidatos c ON c.id = t.candidato_id
         JOIN cargos ca ON ca.id = c.cargo_id
         JOIN tipos_documento td ON td.id = c.tipo_documento_id
         LEFT JOIN fuentes_reclutamiento fr ON fr.id = c.fuente_reclutamiento_id
         JOIN estados_candidato ec ON ec.id = c.estado_id
        WHERE t.token = ?
        LIMIT 1`,
      [token]
    );
    return filas[0] ?? null;
  }

  async function marcarTokenUsado(tokenId) {
    await db.query(
      'UPDATE candidato_tokens_formulario SET usado_en = NOW() WHERE id = ?',
      [tokenId]
    );
  }

  // ----------------------------------------------------------------- pasos --
  async function marcarPaso(candidatoId, paso) {
    await db.query(
      `INSERT INTO candidato_formulario_pasos (candidato_id, paso)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE completado_en = CURRENT_TIMESTAMP`,
      [candidatoId, paso]
    );
  }

  async function pasosCompletados(candidatoId) {
    const [filas] = await db.query(
      'SELECT paso FROM candidato_formulario_pasos WHERE candidato_id = ?',
      [candidatoId]
    );
    return filas.map((f) => f.paso);
  }

  // ---------------------------------------------------------- paso 1 y 2 ----
  /** `candidato_datos_basicos` la escriben dos pasos, por eso el upsert parcial. */
  async function guardarDatosBasicos(candidatoId, campos) {
    const columnas = {
      aspiracionSalarial: 'aspiracion_salarial',
      fechaNacimiento: 'fecha_nacimiento',
      estadoCivilId: 'estado_civil_id',
      generoId: 'genero_id',
      grupoSanguineoId: 'grupo_sanguineo_id',
      epsId: 'eps_id',
      afpId: 'afp_id',
      tallaCamisaId: 'talla_camisa_id',
      direccionResidencial: 'direccion_residencial',
      barrio: 'barrio',
      nombreEmergencia: 'nombre_emergencia',
      numeroEmergencia: 'numero_emergencia',
      parentescoEmergenciaId: 'parentesco_emergencia_id',
    };

    const nombres = [];
    const valores = [];
    for (const [clave, columna] of Object.entries(columnas)) {
      if (campos[clave] !== undefined) {
        nombres.push(columna);
        valores.push(campos[clave]);
      }
    }
    if (nombres.length === 0) return;

    await db.query(
      `INSERT INTO candidato_datos_basicos (candidato_id, ${nombres.join(', ')})
       VALUES (?${', ?'.repeat(nombres.length)})
       ON DUPLICATE KEY UPDATE ${nombres.map((n) => `${n} = VALUES(${n})`).join(', ')}`,
      [candidatoId, ...valores]
    );
  }

  /**
   * Los datos de identidad que el candidato corrige en el paso 2 se reflejan en
   * `candidatos`, que es donde el reclutador los ve.
   */
  async function sincronizarIdentidad(candidatoId, { primerNombre, segundoNombre, primerApellido, segundoApellido, numeroDocumento, celular, edad }) {
    await db.query(
      `UPDATE candidatos
          SET primer_nombre = COALESCE(?, primer_nombre),
              segundo_nombre = COALESCE(?, segundo_nombre),
              primer_apellido = COALESCE(?, primer_apellido),
              segundo_apellido = COALESCE(?, segundo_apellido),
              numero_documento = COALESCE(?, numero_documento),
              celular = COALESCE(?, celular),
              edad = COALESCE(?, edad)
        WHERE id = ?`,
      [primerNombre ?? null, segundoNombre ?? null, primerApellido ?? null,
       segundoApellido ?? null, numeroDocumento ?? null, celular ?? null, edad ?? null,
       candidatoId]
    );
  }

  // -------------------------------------------------------------- paso 3 ----
  async function reemplazarEstudios(candidatoId, estudios) {
    await db.query('DELETE FROM candidato_estudios WHERE candidato_id = ?', [candidatoId]);
    if (estudios.length === 0) return;

    await db.query(
      `INSERT INTO candidato_estudios
         (candidato_id, nivel_estudios_id, nombre_institucion, titulo_obtenido, ano_finalizacion, descripcion)
       VALUES ${estudios.map(() => '(?,?,?,?,?,?)').join(', ')}`,
      estudios.flatMap((e) => [
        candidatoId, e.nivelEstudiosId, e.nombreInstitucion ?? null,
        e.tituloObtenido ?? null, e.anoFinalizacion ?? null, e.descripcion ?? null,
      ])
    );
  }

  // -------------------------------------------------------------- paso 4 ----
  async function reemplazarExperiencias(candidatoId, experiencias) {
    await db.query('DELETE FROM candidato_experiencias WHERE candidato_id = ?', [candidatoId]);
    if (experiencias.length === 0) return;

    await db.query(
      `INSERT INTO candidato_experiencias
         (candidato_id, orden, nombre_empresa, cargo_desempenado, salario, funciones,
          fecha_inicio, fecha_retiro, motivo_retiro)
       VALUES ${experiencias.map(() => '(?,?,?,?,?,?,?,?,?)').join(', ')}`,
      experiencias.flatMap((e) => [
        candidatoId, e.orden, e.nombreEmpresa ?? null, e.cargoDesempenado ?? null,
        e.salario ?? null, e.funciones ?? null, e.fechaInicio ?? null,
        e.fechaRetiro ?? null, e.motivoRetiro ?? null,
      ])
    );
  }

  /**
   * Actualización PARCIAL, campo por campo: dos pasos distintos escriben en
   * esta misma fila —"Experiencia laboral" (5 de los 9 campos) y "Sobre ti"
   * (las 3 preguntas Sí/No que la plantilla imprime junto a la autoevaluación,
   * en la página 2, no junto a la experiencia)—, cada uno en su propio envío.
   * Con `VALUES(x) = x` a secas, el segundo envío pisaría con NULL lo que
   * escribió el primero. `COALESCE(VALUES(x), x)` solo sobreescribe la
   * columna cuando ESTE envío trae un valor real para ella.
   */
  async function guardarExperienciaResumen(candidatoId, r) {
    await db.query(
      `INSERT INTO candidato_experiencia_resumen
         (candidato_id, ha_trabajado_asiste, ha_estado_proceso_formativo_asiste,
          experiencia_comercial_certificada, experiencia_comercial_no_certificada,
          primer_empleo_formal, campana_asiste_id, fecha_inicio_asiste,
          fecha_retiro_asiste, motivo_retiro_asiste)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         ha_trabajado_asiste = COALESCE(VALUES(ha_trabajado_asiste), ha_trabajado_asiste),
         ha_estado_proceso_formativo_asiste =
           COALESCE(VALUES(ha_estado_proceso_formativo_asiste), ha_estado_proceso_formativo_asiste),
         experiencia_comercial_certificada =
           COALESCE(VALUES(experiencia_comercial_certificada), experiencia_comercial_certificada),
         experiencia_comercial_no_certificada =
           COALESCE(VALUES(experiencia_comercial_no_certificada), experiencia_comercial_no_certificada),
         primer_empleo_formal = COALESCE(VALUES(primer_empleo_formal), primer_empleo_formal),
         campana_asiste_id = COALESCE(VALUES(campana_asiste_id), campana_asiste_id),
         fecha_inicio_asiste = COALESCE(VALUES(fecha_inicio_asiste), fecha_inicio_asiste),
         fecha_retiro_asiste = COALESCE(VALUES(fecha_retiro_asiste), fecha_retiro_asiste),
         motivo_retiro_asiste = COALESCE(VALUES(motivo_retiro_asiste), motivo_retiro_asiste)`,
      [candidatoId, r.haTrabajadoAsiste ?? null, r.haEstadoProcesoFormativoAsiste ?? null,
       r.experienciaComercialCertificada ?? null, r.experienciaComercialNoCertificada ?? null,
       r.primerEmpleoFormal ?? null, r.campanaAsisteId ?? null, r.fechaInicioAsiste ?? null,
       r.fechaRetiroAsiste ?? null, r.motivoRetiroAsiste ?? null]
    );
  }

  // -------------------------------------------------------------- paso 5 ----
  async function guardarPersonal(candidatoId, p) {
    await db.query(
      `INSERT INTO candidato_personal
         (candidato_id, genograma, fortalezas, aspectos_mejorar, competencias_laborales,
          expectativa_laboral, estado_salud_actual, tratamiento_psicologico_actual,
          tratamiento_psicologico_detalle, autoevaluacion)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         genograma = VALUES(genograma), fortalezas = VALUES(fortalezas),
         aspectos_mejorar = VALUES(aspectos_mejorar),
         competencias_laborales = VALUES(competencias_laborales),
         expectativa_laboral = VALUES(expectativa_laboral),
         estado_salud_actual = VALUES(estado_salud_actual),
         tratamiento_psicologico_actual = VALUES(tratamiento_psicologico_actual),
         tratamiento_psicologico_detalle = VALUES(tratamiento_psicologico_detalle),
         autoevaluacion = VALUES(autoevaluacion)`,
      [candidatoId, p.genograma ?? null, p.fortalezas ?? null, p.aspectosMejorar ?? null,
       p.competenciasLaborales ?? null, p.expectativaLaboral ?? null,
       p.estadoSaludActual ?? null, p.tratamientoPsicologicoActual ?? null,
       p.tratamientoPsicologicoDetalle ?? null, p.autoevaluacion ?? null]
    );
  }

  async function reemplazarMetas(candidatoId, metas) {
    await db.query('DELETE FROM candidato_metas WHERE candidato_id = ?', [candidatoId]);
    const entradas = Object.entries(metas).filter(([, v]) => v);
    if (entradas.length === 0) return;

    await db.query(
      `INSERT INTO candidato_metas (candidato_id, plazo, descripcion)
       VALUES ${entradas.map(() => '(?,?,?)').join(', ')}`,
      entradas.flatMap(([plazo, descripcion]) => [candidatoId, plazo, descripcion])
    );
  }

  async function reemplazarConocimientos(candidatoId, conocimientos) {
    await db.query(
      'DELETE FROM candidato_conocimientos_informaticos WHERE candidato_id = ?',
      [candidatoId]
    );
    if (conocimientos.length === 0) return;

    await db.query(
      `INSERT INTO candidato_conocimientos_informaticos (candidato_id, herramienta_id, nivel)
       VALUES ${conocimientos.map(() => '(?,?,?)').join(', ')}`,
      conocimientos.flatMap((c) => [candidatoId, c.herramientaId, c.nivel])
    );
  }

  // -------------------------------------------------------------- paso 6 ----
  async function guardarConsentimiento(candidatoId, { ciudad, fecha }) {
    await db.query(
      `INSERT INTO candidato_consentimiento (candidato_id, ciudad, fecha)
       VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE ciudad = VALUES(ciudad), fecha = VALUES(fecha)`,
      [candidatoId, ciudad ?? null, fecha]
    );
  }

  // --------------------------------------------- respuestas ya guardadas ----
  /**
   * Lo que el candidato ya diligenció, en la MISMA forma que espera el
   * formulario del frontend (por código de catálogo, no por id).
   *
   * Se usa para precargar el formulario cuando se reenvía el enlace: el token
   * rota en cada envío, pero los datos ya escritos son del candidato, no del
   * token, y no deben perderse ni volver a pedirse. Sin esto, reabrir un
   * paso ya completado lo mostraba en blanco, y guardarlo de nuevo pisaba con
   * NULL lo que el candidato ya había escrito (`guardarPersonal`,
   * `reemplazarEstudios` y `reemplazarExperiencias` no hacen merge parcial).
   */
  async function obtenerRespuestasGuardadas(candidatoId) {
    const [[basicos]] = await db.query(
      `SELECT db.aspiracion_salarial, db.fecha_nacimiento,
              db.direccion_residencial, db.barrio,
              db.nombre_emergencia, db.numero_emergencia,
              ecv.codigo AS estado_civil, ge.codigo AS genero,
              gs.codigo AS grupo_sanguineo, e.codigo AS eps, a.codigo AS afp,
              tc.codigo AS talla_camisa, pa.codigo AS parentesco_emergencia
         FROM candidato_datos_basicos db
         LEFT JOIN estados_civiles ecv ON ecv.id = db.estado_civil_id
         LEFT JOIN generos ge ON ge.id = db.genero_id
         LEFT JOIN grupos_sanguineos gs ON gs.id = db.grupo_sanguineo_id
         LEFT JOIN eps e ON e.id = db.eps_id
         LEFT JOIN afp a ON a.id = db.afp_id
         LEFT JOIN tallas_camisa tc ON tc.id = db.talla_camisa_id
         LEFT JOIN parentescos pa ON pa.id = db.parentesco_emergencia_id
        WHERE db.candidato_id = ?`,
      [candidatoId]
    );

    const [estudiosFilas] = await db.query(
      `SELECT ne.codigo AS nivel, e.nombre_institucion, e.titulo_obtenido,
              e.ano_finalizacion, e.descripcion
         FROM candidato_estudios e
         JOIN niveles_estudios ne ON ne.id = e.nivel_estudios_id
        WHERE e.candidato_id = ?`,
      [candidatoId]
    );

    const [experiencias] = await db.query(
      `SELECT orden, nombre_empresa AS nombreEmpresa, cargo_desempenado AS cargoDesempenado,
              salario, funciones, fecha_inicio AS fechaInicio, fecha_retiro AS fechaRetiro,
              motivo_retiro AS motivoRetiro
         FROM candidato_experiencias WHERE candidato_id = ? ORDER BY orden`,
      [candidatoId]
    );

    const [[resumen]] = await db.query(
      `SELECT er.ha_trabajado_asiste AS haTrabajadoAsiste,
              er.ha_estado_proceso_formativo_asiste AS haEstadoProcesoFormativoAsiste,
              er.experiencia_comercial_certificada AS experienciaComercialCertificada,
              er.experiencia_comercial_no_certificada AS experienciaComercialNoCertificada,
              er.primer_empleo_formal AS primerEmpleoFormal,
              cl.codigo AS campanaAsiste,
              er.fecha_inicio_asiste AS fechaInicioAsiste,
              er.fecha_retiro_asiste AS fechaRetiroAsiste,
              er.motivo_retiro_asiste AS motivoRetiroAsiste
         FROM candidato_experiencia_resumen er
         LEFT JOIN clientes cl ON cl.id = er.campana_asiste_id
        WHERE er.candidato_id = ?`,
      [candidatoId]
    );

    const [[personalFila]] = await db.query(
      `SELECT genograma, fortalezas, aspectos_mejorar AS aspectosMejorar,
              competencias_laborales AS competenciasLaborales,
              estado_salud_actual AS estadoSaludActual, autoevaluacion
         FROM candidato_personal WHERE candidato_id = ?`,
      [candidatoId]
    );

    const [metasFilas] = await db.query(
      'SELECT plazo, descripcion FROM candidato_metas WHERE candidato_id = ?',
      [candidatoId]
    );

    const [conocimientosFilas] = await db.query(
      `SELECT h.codigo, ci.nivel
         FROM candidato_conocimientos_informaticos ci
         JOIN herramientas_informaticas h ON h.id = ci.herramienta_id
        WHERE ci.candidato_id = ?`,
      [candidatoId]
    );

    const [[consentimientoFila]] = await db.query(
      `SELECT co.fecha, co.ciudad
         FROM candidato_consentimiento co
        WHERE co.candidato_id = ?`,
      [candidatoId]
    );

    return {
      // DECIMAL vuelve como string ('2100000.00'): se castea a número, como lo
      // espera el <input type="number"> y como lo manda `aCuerpo` al guardar.
      hoja_vida: {
        aspiracionSalarial:
          basicos?.aspiracion_salarial != null ? Number(basicos.aspiracion_salarial) : undefined,
      },
      datos_basicos: {
        eps: basicos?.eps ?? undefined,
        afp: basicos?.afp ?? undefined,
        estadoCivil: basicos?.estado_civil ?? undefined,
        genero: basicos?.genero ?? undefined,
        grupoSanguineo: basicos?.grupo_sanguineo ?? undefined,
        tallaCamisa: basicos?.talla_camisa ?? undefined,
        direccionResidencial: basicos?.direccion_residencial ?? undefined,
        barrio: basicos?.barrio ?? undefined,
        parentescoEmergencia: basicos?.parentesco_emergencia ?? undefined,
        nombreEmergencia: basicos?.nombre_emergencia ?? undefined,
        numeroEmergencia: basicos?.numero_emergencia ?? undefined,
      },
      // El paso "Estudios" guarda un objeto por código de nivel, no un array.
      estudios: {
        estudios: Object.fromEntries(
          estudiosFilas.map(({ nivel, ...resto }) => [
            nivel,
            {
              nombreInstitucion: resto.nombre_institucion ?? undefined,
              tituloObtenido: resto.titulo_obtenido ?? undefined,
              anoFinalizacion: resto.ano_finalizacion ?? undefined,
              descripcion: resto.descripcion ?? undefined,
            },
          ])
        ),
      },
      // `dateStrings` (config/db.js) ya entrega DATE como 'AAAA-MM-DD' y
      // BOOLEAN como boolean real: solo `salario` (DECIMAL) necesita casteo.
      experiencia: {
        experiencias: experiencias.map((e) => ({
          ...e,
          salario: e.salario != null ? Number(e.salario) : undefined,
          trabajaActualmente: Boolean(e.fechaInicio) && !e.fechaRetiro,
        })),
        resumen: resumen ?? {},
      },
      personal: {
        genograma: personalFila?.genograma ?? undefined,
        fortalezas: personalFila?.fortalezas ?? undefined,
        aspectosMejorar: personalFila?.aspectosMejorar ?? undefined,
        competenciasLaborales: personalFila?.competenciasLaborales ?? undefined,
        estadoSaludActual: personalFila?.estadoSaludActual ?? undefined,
        autoevaluacion: personalFila?.autoevaluacion ?? undefined,
        experienciaComercialCertificada: resumen?.experienciaComercialCertificada ?? undefined,
        experienciaComercialNoCertificada: resumen?.experienciaComercialNoCertificada ?? undefined,
        primerEmpleoFormal: resumen?.primerEmpleoFormal ?? undefined,
        metas: Object.fromEntries(metasFilas.map((m) => [m.plazo, m.descripcion])),
        conocimientos: Object.fromEntries(conocimientosFilas.map((c) => [c.codigo, c.nivel])),
      },
      consentimiento: {
        ciudad: consentimientoFila?.ciudad ?? undefined,
        fecha: consentimientoFila?.fecha ?? undefined,
      },
    };
  }

  // ------------------------------------------------- lectura para el PDF ----
  /**
   * Candidato completo, aplanado. Las relaciones 1:1 van por LEFT JOIN y las
   * 1:N en consultas aparte: unirlas todas produciría un producto cartesiano.
   */
  async function obtenerCompleto(candidatoId) {
    const [[candidato]] = await db.query(
      `SELECT c.*, td.codigo AS tipo_documento, td.nacionalidad,
              cl.codigo AS cliente, ca.codigo AS cargo,
              ci.codigo AS ciudad, fr.codigo AS fuente_reclutamiento,
              ec.codigo AS estado,
              db.aspiracion_salarial, db.fecha_nacimiento, db.direccion_residencial,
              db.barrio, db.nombre_emergencia, db.numero_emergencia,
              tc.codigo AS talla_camisa, gs.codigo AS grupo_sanguineo,
              e.nombre AS eps, a.nombre AS afp,
              ecv.nombre AS estado_civil, g.nombre AS genero,
              pa.nombre AS parentesco_emergencia,
              p.genograma, p.fortalezas, p.aspectos_mejorar, p.competencias_laborales,
              p.expectativa_laboral, p.estado_salud_actual, p.autoevaluacion,
              er.ha_trabajado_asiste, er.ha_estado_proceso_formativo_asiste,
              er.experiencia_comercial_certificada, er.experiencia_comercial_no_certificada,
              er.primer_empleo_formal, er.fecha_inicio_asiste, er.fecha_retiro_asiste,
              er.motivo_retiro_asiste, cla.codigo AS campana_asiste,
              cons.fecha AS fecha_consentimiento, cons.ciudad AS ciudad_consentimiento,
              (SELECT MAX(t.enviado_en) FROM candidato_tokens_formulario t
                WHERE t.candidato_id = c.id) AS fecha_envio_email
         FROM candidatos c
         JOIN tipos_documento td ON td.id = c.tipo_documento_id
         JOIN clientes cl ON cl.id = c.cliente_id
         JOIN cargos ca ON ca.id = c.cargo_id
         JOIN estados_candidato ec ON ec.id = c.estado_id
         LEFT JOIN ciudades ci ON ci.id = c.ciudad_id
         LEFT JOIN fuentes_reclutamiento fr ON fr.id = c.fuente_reclutamiento_id
         LEFT JOIN candidato_datos_basicos db ON db.candidato_id = c.id
         LEFT JOIN tallas_camisa tc ON tc.id = db.talla_camisa_id
         LEFT JOIN grupos_sanguineos gs ON gs.id = db.grupo_sanguineo_id
         LEFT JOIN eps e ON e.id = db.eps_id
         LEFT JOIN afp a ON a.id = db.afp_id
         LEFT JOIN estados_civiles ecv ON ecv.id = db.estado_civil_id
         LEFT JOIN generos g ON g.id = db.genero_id
         LEFT JOIN parentescos pa ON pa.id = db.parentesco_emergencia_id
         LEFT JOIN candidato_personal p ON p.candidato_id = c.id
         LEFT JOIN candidato_experiencia_resumen er ON er.candidato_id = c.id
         LEFT JOIN clientes cla ON cla.id = er.campana_asiste_id
         LEFT JOIN candidato_consentimiento cons ON cons.candidato_id = c.id
        WHERE c.id = ?`,
      [candidatoId]
    );
    if (!candidato) return null;

    const [estudios] = await db.query(
      `SELECT ne.codigo AS nivel_estudios, e.nombre_institucion, e.titulo_obtenido,
              e.ano_finalizacion, e.descripcion
         FROM candidato_estudios e
         JOIN niveles_estudios ne ON ne.id = e.nivel_estudios_id
        WHERE e.candidato_id = ?`,
      [candidatoId]
    );

    const [experiencia] = await db.query(
      `SELECT orden, nombre_empresa, cargo_desempenado, salario, funciones,
              fecha_inicio, fecha_retiro, motivo_retiro
         FROM candidato_experiencias WHERE candidato_id = ? ORDER BY orden`,
      [candidatoId]
    );

    const [metas] = await db.query(
      'SELECT plazo, descripcion FROM candidato_metas WHERE candidato_id = ?',
      [candidatoId]
    );

    const [conocimientos] = await db.query(
      `SELECT h.codigo, ci.nivel
         FROM candidato_conocimientos_informaticos ci
         JOIN herramientas_informaticas h ON h.id = ci.herramienta_id
        WHERE ci.candidato_id = ?`,
      [candidatoId]
    );

    return { ...candidato, estudios, experiencia, metas, conocimientos };
  }

  // --------------------------------------------------------------- firma ----
  async function registrarFirma({ candidatoId, proveedor, referenciaExterna, estado }) {
    const [res] = await db.query(
      `INSERT INTO candidato_firmas (candidato_id, proveedor, referencia_externa, estado)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE estado = VALUES(estado)`,
      [candidatoId, proveedor, referenciaExterna, estado ?? null]
    );
    return res.insertId;
  }

  async function buscarFirma(candidatoId) {
    const [filas] = await db.query(
      `SELECT id, proveedor, referencia_externa, estado, created_at
         FROM candidato_firmas WHERE candidato_id = ?
        ORDER BY created_at DESC LIMIT 1`,
      [candidatoId]
    );
    return filas[0] ?? null;
  }

  // -------------------------------------------------------------- correos ---
  async function registrarEnvioEmail({ candidatoId, destinatario, tipo, estado, error, enviadoPorId }) {
    await db.query(
      `INSERT INTO envios_email (candidato_id, destinatario, tipo, estado, error, enviado_por_id)
       VALUES (?,?,?,?,?,?)`,
      [candidatoId, destinatario, tipo, estado, error ?? null, enviadoPorId ?? null]
    );
  }

  async function enviosDe(candidatoId) {
    const [filas] = await db.query(
      `SELECT tipo, destinatario, estado, error, created_at
         FROM envios_email WHERE candidato_id = ? ORDER BY created_at DESC`,
      [candidatoId]
    );
    return filas;
  }

  return {
    revocarTokensVigentes, emitirToken, buscarToken, marcarTokenUsado,
    marcarPaso, pasosCompletados,
    guardarDatosBasicos, sincronizarIdentidad,
    reemplazarEstudios,
    reemplazarExperiencias, guardarExperienciaResumen,
    guardarPersonal, reemplazarMetas, reemplazarConocimientos,
    guardarConsentimiento,
    obtenerRespuestasGuardadas,
    obtenerCompleto,
    registrarFirma, buscarFirma,
    registrarEnvioEmail, enviosDe,
  };
}

module.exports = { crearFormularioRepositorio, PASOS };
