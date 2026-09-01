'use strict';

/**
 * Consultas de reportes: exportación a Excel, estadísticas y analíticas.
 *
 * Con el esquema normalizado los datos que el Excel necesita ya no están todos
 * en una fila: los antecedentes son cuatro filas, la citación vive en su tabla y
 * la decisión final en otra. Se aplanan aquí, con subconsultas, en vez de hacer
 * varios viajes y armar el cruce en JavaScript.
 */

const TIPOS_ANTECEDENTE = Object.freeze(['adres', 'policia', 'comparendos', 'procuraduria']);

function crearReportesRepositorio({ db }) {
  /** Subconsulta del estado de un antecedente concreto. */
  const antecedente = (codigo) => `
    (SELECT a.estado FROM candidato_antecedentes a
       JOIN tipos_antecedente t ON t.id = a.tipo_antecedente_id
      WHERE a.candidato_id = c.id AND t.codigo = '${codigo}') AS antecedente_${codigo}`;

  const SELECT_EXCEL = `
    SELECT c.id, c.primer_nombre, c.segundo_nombre, c.primer_apellido, c.segundo_apellido,
           c.numero_documento, c.edad, c.email, c.celular, c.created_at,
           c.contacto_llamada, c.contacto_whatsapp, c.perfil, c.citado,
           td.codigo AS tipo_documento, cl.nombre AS cliente, ca.nombre AS cargo,
           ec.codigo AS estado, ec.nombre AS estado_nombre,
           eg.nombre AS estado_gestion,
           u.nombre_completo AS reclutador,
           ult.created_at AS fecha_citado, ult.asistio, mi.nombre AS motivo_inasistencia,
           df.aprobacion AS aprobacion_final, df.razon AS aprobacion_final_razon,
           ev.total AS evaluacion_total,
           ${TIPOS_ANTECEDENTE.map(antecedente).join(',\n           ')}
      FROM candidatos c
      JOIN tipos_documento td ON td.id = c.tipo_documento_id
      JOIN clientes cl ON cl.id = c.cliente_id
      JOIN cargos ca ON ca.id = c.cargo_id
      JOIN estados_candidato ec ON ec.id = c.estado_id
      LEFT JOIN estados_gestion_reclutamiento eg ON eg.id = c.estado_gestion_id
      LEFT JOIN usuarios u ON u.id = c.reclutador_id
      LEFT JOIN candidato_decision_final df ON df.candidato_id = c.id
      -- Última citación del candidato: la tabla es 1:N para permitir reagendar.
      LEFT JOIN candidato_citaciones ult
             ON ult.id = (SELECT ci.id FROM candidato_citaciones ci
                           WHERE ci.candidato_id = c.id
                           ORDER BY ci.created_at DESC, ci.id DESC LIMIT 1)
      LEFT JOIN motivos_inasistencia mi ON mi.id = ult.motivo_inasistencia_id
      -- Última evaluación, con su total ya calculado por la vista.
      LEFT JOIN v_evaluacion_totales ev
             ON ev.evaluacion_id = (SELECT e.id FROM candidato_evaluaciones e
                                     WHERE e.candidato_id = c.id
                                     ORDER BY e.created_at DESC, e.id DESC LIMIT 1)
  `;

  /**
   * Candidatos citados en un rango.
   *
   * El rango es obligatorio en el reporte oficial. Desde la migración 009 citar
   * no lleva fecha de entrevista, así que el rango es sobre la fecha EN QUE se
   * citó (`candidato_citaciones.created_at`), que es lo que el equipo pregunta:
   * "a quiénes citamos esta semana".
   */
  async function candidatosCitados({ desde, hasta, visibilidad }) {
    const condiciones = ['ult.id IS NOT NULL'];
    const params = [];

    if (visibilidad.sql) {
      condiciones.push(visibilidad.sql);
      params.push(...visibilidad.params);
    }
    if (desde) { condiciones.push('ult.created_at >= ?'); params.push(`${desde} 00:00:00`); }
    if (hasta) { condiciones.push('ult.created_at <= ?'); params.push(`${hasta} 23:59:59`); }

    const [filas] = await db.query(
      `${SELECT_EXCEL} WHERE ${condiciones.join(' AND ')} ORDER BY ult.created_at DESC, c.id DESC`,
      params
    );
    return filas;
  }

  /**
   * Todos los candidatos, sin filtrar por citación ni decisión — para el
   * botón "Descargar Excel" de la pantalla Candidatos, que lista cualquier
   * estado. Por eso el rango es sobre `c.created_at` (fecha de REGISTRO), no
   * sobre la citación: la mayoría de estas filas ni siquiera tienen una.
   * Sin rango, los últimos 100 registrados; con alguna fecha, todos los del
   * rango, sin tope.
   */
  async function candidatosTodos({ desde, hasta, visibilidad }) {
    const condiciones = [];
    const params = [];

    if (visibilidad.sql) {
      condiciones.push(visibilidad.sql);
      params.push(...visibilidad.params);
    }
    if (desde) { condiciones.push('c.created_at >= ?'); params.push(`${desde} 00:00:00`); }
    if (hasta) { condiciones.push('c.created_at <= ?'); params.push(`${hasta} 23:59:59`); }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const limite = desde || hasta ? '' : 'LIMIT 100';

    const [filas] = await db.query(
      `${SELECT_EXCEL} ${where} ORDER BY c.created_at DESC, c.id DESC ${limite}`,
      params
    );
    return filas;
  }

  /** Candidatos con decisión final favorable. */
  async function candidatosAprobados({ desde, hasta, visibilidad }) {
    const condiciones = ['df.aprobacion = TRUE'];
    const params = [];

    if (visibilidad.sql) {
      condiciones.push(visibilidad.sql);
      params.push(...visibilidad.params);
    }
    if (desde) { condiciones.push('df.created_at >= ?'); params.push(`${desde} 00:00:00`); }
    if (hasta) { condiciones.push('df.created_at <= ?'); params.push(`${hasta} 23:59:59`); }

    const [filas] = await db.query(
      `${SELECT_EXCEL} WHERE ${condiciones.join(' AND ')} ORDER BY df.created_at DESC, c.id DESC`,
      params
    );
    return filas;
  }

  // ------------------------------------------------------------ estadísticas --
  /** Reemplaza `GET /seleccion/estadisticas` del sistema viejo. */
  async function estadisticasSeleccion({ visibilidad }) {
    const where = visibilidad.sql ? `WHERE ${visibilidad.sql}` : '';

    const [[totales]] = await db.query(
      `SELECT
         COUNT(*) AS total_candidatos,
         SUM(CASE WHEN ec.codigo = 'citado' THEN 1 ELSE 0 END) AS citados,
         SUM(CASE WHEN ec.codigo = 'entrevistado' THEN 1 ELSE 0 END) AS entrevistados,
         SUM(CASE WHEN ec.codigo = 'no_asistio' THEN 1 ELSE 0 END) AS no_asistieron,
         SUM(CASE WHEN ec.codigo = 'aprobado_final' THEN 1 ELSE 0 END) AS aprobados,
         SUM(CASE WHEN ec.codigo = 'rechazado_final' THEN 1 ELSE 0 END) AS rechazados,
         SUM(CASE WHEN ec.codigo = 'contratado' THEN 1 ELSE 0 END) AS contratados
       FROM candidatos c
       JOIN estados_candidato ec ON ec.id = c.estado_id
       ${where}`,
      visibilidad.params
    );

    // "Pendiente decisión final": tiene evaluación pero nadie ha decidido.
    const [[pendientes]] = await db.query(
      `SELECT COUNT(DISTINCT c.id) AS total
         FROM candidatos c
         JOIN candidato_evaluaciones e ON e.candidato_id = c.id
         LEFT JOIN candidato_decision_final d ON d.candidato_id = c.id
        WHERE d.candidato_id IS NULL ${visibilidad.sql ? `AND ${visibilidad.sql}` : ''}`,
      visibilidad.params
    );

    const [asistencia] = await db.query(
      `SELECT ci.asistio, COUNT(*) AS total
         FROM candidato_citaciones ci
         JOIN candidatos c ON c.id = ci.candidato_id
         ${where}
        GROUP BY ci.asistio`,
      visibilidad.params
    );

    return {
      ...Object.fromEntries(Object.entries(totales).map(([k, v]) => [k, Number(v)])),
      pendientes_decision_final: Number(pendientes.total),
      asistencia: asistencia.reduce(
        (acc, f) => ({ ...acc, [f.asistio]: Number(f.total) }),
        { pendiente: 0, asistio: 0, no_asistio: 0 }
      ),
    };
  }

  /** Promedios de evaluación por criterio. Reemplaza `estadisticas-aprobados`. */
  async function estadisticasEvaluacion({ visibilidad }) {
    const [porCriterio] = await db.query(
      `SELECT cr.codigo, cr.nombre, cr.puntaje_maximo,
              AVG(ep.puntaje) AS promedio, COUNT(*) AS evaluaciones
         FROM evaluacion_puntajes ep
         JOIN criterios_evaluacion cr ON cr.id = ep.criterio_id
         JOIN candidato_evaluaciones e ON e.id = ep.evaluacion_id
         JOIN candidatos c ON c.id = e.candidato_id
        ${visibilidad.sql ? `WHERE ${visibilidad.sql}` : ''}
        GROUP BY cr.id, cr.codigo, cr.nombre, cr.puntaje_maximo, cr.orden
        ORDER BY cr.orden`,
      visibilidad.params
    );

    const [[global]] = await db.query(
      `SELECT COUNT(*) AS evaluaciones,
              SUM(CASE WHEN e.aprobado THEN 1 ELSE 0 END) AS aprobadas,
              AVG(t.porcentaje) AS porcentaje_promedio
         FROM candidato_evaluaciones e
         JOIN candidatos c ON c.id = e.candidato_id
         LEFT JOIN v_evaluacion_totales t ON t.evaluacion_id = e.id
        ${visibilidad.sql ? `WHERE ${visibilidad.sql}` : ''}`,
      visibilidad.params
    );

    return {
      porCriterio: porCriterio.map((f) => ({
        codigo: f.codigo,
        nombre: f.nombre,
        puntajeMaximo: Number(f.puntaje_maximo),
        promedio: Number(Number(f.promedio).toFixed(2)),
        evaluaciones: Number(f.evaluaciones),
      })),
      evaluaciones: Number(global.evaluaciones),
      aprobadas: Number(global.aprobadas ?? 0),
      porcentajePromedio: global.porcentaje_promedio
        ? Number(Number(global.porcentaje_promedio).toFixed(2))
        : null,
    };
  }

  /**
   * Cola de trabajo de Selección: cuántos candidatos esperan cada tipo de
   * acción, por estado ACTUAL (no historial — es "qué hay que hacer hoy").
   *
   * Solo Agente pasa por evaluación de entrevista (`esCargoAgente`, ver
   * `seleccion.service.js`); el resto de cargos salta de "entrevistado"
   * directo a decisión final. Por eso "pendiente de decisión final" mezcla
   * dos orígenes: Agentes ya evaluados (estado `aprobado`/`rechazado`, antes
   * de que el psicólogo decida) y no-Agentes recién entrevistados.
   */
  async function colaSeleccion({ visibilidad }) {
    const condiciones = visibilidad.sql ? [visibilidad.sql] : [];
    const where = (extra) => `WHERE ${[...condiciones, extra].join(' AND ')}`;

    const [[evaluacion]] = await db.query(
      `SELECT COUNT(*) AS total
         FROM candidatos c
         JOIN cargos ca ON ca.id = c.cargo_id
         JOIN estados_candidato ec ON ec.id = c.estado_id
         ${where("ec.codigo = 'entrevistado' AND ca.codigo LIKE '%agente%'")}`,
      visibilidad.params
    );

    const [[decisionFinal]] = await db.query(
      `SELECT COUNT(*) AS total
         FROM candidatos c
         JOIN cargos ca ON ca.id = c.cargo_id
         JOIN estados_candidato ec ON ec.id = c.estado_id
         ${where(
           "(ec.codigo IN ('aprobado','rechazado') OR (ec.codigo = 'entrevistado' AND ca.codigo NOT LIKE '%agente%'))"
         )}`,
      visibilidad.params
    );

    return {
      pendientesEvaluacion: Number(evaluacion.total),
      pendientesDecisionFinal: Number(decisionFinal.total),
    };
  }

  /**
   * Resultados de Agente, sin filtrar por reclutador — la vista de equipo de
   * Selección: no evalúan candidatos propios, evalúan lo que llega de
   * cualquier reclutador. Misma regla que `trazabilidad.resultadosAgentes`,
   * aquí sin `WHERE c.reclutador_id = ?`.
   */
  async function resultadosAgenteGlobal({ visibilidad }) {
    const condiciones = ["ca.codigo LIKE '%agente%'", "ec.codigo IN ('aprobado', 'rechazado', 'aprobado_final', 'rechazado_final')"];
    if (visibilidad.sql) condiciones.push(visibilidad.sql);

    const [filas] = await db.query(
      `SELECT ec.codigo AS estado, COUNT(*) AS total
         FROM candidatos c
         JOIN cargos ca ON ca.id = c.cargo_id
         JOIN estados_candidato ec ON ec.id = c.estado_id
        WHERE ${condiciones.join(' AND ')}
        GROUP BY ec.codigo`,
      visibilidad.params
    );
    const porEstado = Object.fromEntries(filas.map((f) => [f.estado, Number(f.total)]));
    return {
      aprobado: porEstado.aprobado ?? 0,
      rechazado: porEstado.rechazado ?? 0,
      aprobadoFinal: porEstado.aprobado_final ?? 0,
      rechazadoFinal: porEstado.rechazado_final ?? 0,
    };
  }

  /**
   * Evaluaciones registradas por día, TODOS los días del mes en curso
   * (28-31 según el mes), con los días sin evaluación en 0 — mismo criterio
   * de relleno que `trazabilidad.serieMensual`, para que el eje X nunca se
   * desalinee con el día real.
   */
  async function evaluacionesPorDia({ visibilidad }) {
    const condiciones = [
      'YEAR(e.created_at) = YEAR(CURDATE())',
      'MONTH(e.created_at) = MONTH(CURDATE())',
    ];
    if (visibilidad.sql) condiciones.push(visibilidad.sql);

    const [filas] = await db.query(
      `SELECT DATE(e.created_at) AS fecha, COUNT(*) AS evaluaciones
         FROM candidato_evaluaciones e
         JOIN candidatos c ON c.id = e.candidato_id
        WHERE ${condiciones.join(' AND ')}
        GROUP BY DATE(e.created_at)`,
      visibilidad.params
    );
    const evaluacionesPorFecha = new Map(filas.map((f) => [f.fecha, Number(f.evaluaciones)]));

    const hoy = new Date();
    const anio = hoy.getFullYear();
    const mes = hoy.getMonth();
    const ultimoDia = new Date(anio, mes + 1, 0).getDate();

    const dias = [];
    for (let dia = 1; dia <= ultimoDia; dia += 1) {
      const fecha = `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      dias.push({ fecha, dia, evaluaciones: evaluacionesPorFecha.get(fecha) ?? 0 });
    }
    return dias;
  }

  // -------------------------------------------------------------- analíticas --
  /**
   * Evolución de los cambios de estado en el tiempo.
   *
   * El sistema viejo aproximaba esto con `updated_at`, que se pisaba en cada
   * cambio. Aquí sale del historial, que es un registro append-only, así que la
   * serie es exacta.
   */
  async function estadosEnTiempo({ dias, visibilidad }) {
    const [filas] = await db.query(
      `SELECT DATE(h.created_at) AS fecha, en.codigo AS estado, COUNT(*) AS total
         FROM candidato_estado_historial h
         JOIN estados_candidato en ON en.id = h.estado_nuevo_id
         JOIN candidatos c ON c.id = h.candidato_id
        WHERE h.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
          ${visibilidad.sql ? `AND ${visibilidad.sql}` : ''}
        GROUP BY DATE(h.created_at), en.codigo, en.orden
        ORDER BY fecha, en.orden`,
      [dias, ...visibilidad.params]
    );
    return filas.map((f) => ({ ...f, total: Number(f.total) }));
  }

  async function porCliente({ visibilidad }) {
    const [filas] = await db.query(
      `SELECT cl.nombre AS cliente, COUNT(*) AS total,
              SUM(CASE WHEN ec.codigo IN ('aprobado_final','contratado') THEN 1 ELSE 0 END) AS aprobados
         FROM candidatos c
         JOIN clientes cl ON cl.id = c.cliente_id
         JOIN estados_candidato ec ON ec.id = c.estado_id
        ${visibilidad.sql ? `WHERE ${visibilidad.sql}` : ''}
        GROUP BY cl.id, cl.nombre, cl.orden
        ORDER BY total DESC`,
      visibilidad.params
    );
    return filas.map((f) => ({
      cliente: f.cliente,
      total: Number(f.total),
      aprobados: Number(f.aprobados),
    }));
  }

  async function porCargo({ limite, visibilidad }) {
    const [filas] = await db.query(
      `SELECT ca.nombre AS cargo, COUNT(*) AS total
         FROM candidatos c
         JOIN cargos ca ON ca.id = c.cargo_id
        ${visibilidad.sql ? `WHERE ${visibilidad.sql}` : ''}
        GROUP BY ca.id, ca.nombre
        ORDER BY total DESC
        LIMIT ?`,
      [...visibilidad.params, limite]
    );
    return filas.map((f) => ({ cargo: f.cargo, total: Number(f.total) }));
  }

  /** Avance de los formularios enviados: cuántos pasos lleva cada candidato. */
  async function progresoFormularios({ visibilidad }) {
    const [filas] = await db.query(
      `SELECT completados, COUNT(*) AS candidatos FROM (
         SELECT c.id, COUNT(p.paso) AS completados
           FROM candidatos c
           LEFT JOIN candidato_formulario_pasos p ON p.candidato_id = c.id
          ${visibilidad.sql ? `WHERE ${visibilidad.sql}` : ''}
          GROUP BY c.id
       ) AS avance
       GROUP BY completados
       ORDER BY completados`,
      visibilidad.params
    );
    return filas.map((f) => ({
      pasosCompletados: Number(f.completados),
      candidatos: Number(f.candidatos),
      total: 6,
    }));
  }

  return {
    candidatosTodos,
    candidatosCitados,
    candidatosAprobados,
    estadisticasSeleccion,
    estadisticasEvaluacion,
    colaSeleccion,
    resultadosAgenteGlobal,
    evaluacionesPorDia,
    estadosEnTiempo,
    porCliente,
    porCargo,
    progresoFormularios,
  };
}

module.exports = { crearReportesRepositorio, TIPOS_ANTECEDENTE };
