'use strict';

/**
 * Trazabilidad de la gestión de cada reclutador.
 *
 * Todo sale de las dos tablas de auditoría que introdujo la reestructuración:
 *
 *   candidato_estado_historial  -> quién movió a quién, cuándo y por qué
 *   candidato_asignaciones      -> quién recibió o entregó un candidato
 *
 * Con el esquema viejo esto era imposible: `estado` era una columna que se
 * sobrescribía y la única marca de tiempo era `updated_at`, que se pisaba en
 * cada cambio. No había forma de saber cuántos candidatos gestionó alguien ayer.
 *
 * Definiciones (importan, porque no son lo mismo):
 *   creados     -> el reclutador registró al candidato (evento sin estado anterior)
 *   gestionados -> candidatos DISTINTOS a los que les movió el estado
 *   asignados   -> candidatos que recibió de otra persona
 */

/** Rangos soportados. Las expresiones son constantes del código, nunca entrada. */
const PERIODOS = Object.freeze({
  dia: 'DATE(%s) = CURDATE()',
  semana: 'YEARWEEK(%s, 1) = YEARWEEK(CURDATE(), 1)',
  mes: 'YEAR(%s) = YEAR(CURDATE()) AND MONTH(%s) = MONTH(CURDATE())',
  total: '1 = 1',
});

function condicion(periodo, columna) {
  return PERIODOS[periodo].replaceAll('%s', columna);
}

function crearTrazabilidadRepositorio({ db }) {
  /**
   * Los tres contadores para los cuatro periodos, en una sola consulta.
   *
   * Se usa SUM(CASE...) en vez de cuatro consultas por métrica: son doce cifras
   * y hacerlo con doce viajes a la base sería innecesariamente caro.
   */
  async function resumen(reclutadorId) {
    const porPeriodo = (columna) =>
      Object.keys(PERIODOS)
        .map((p) => `SUM(CASE WHEN ${condicion(p, columna)} THEN 1 ELSE 0 END) AS ${p}`)
        .join(', ');

    const [[creados]] = await db.query(
      `SELECT ${porPeriodo('h.created_at')}
         FROM candidato_estado_historial h
        WHERE h.usuario_id = ? AND h.estado_anterior_id IS NULL`,
      [reclutadorId]
    );

    // DISTINCT sobre candidato: mover a un mismo candidato tres veces en el día
    // es un candidato gestionado, no tres.
    const gestionados = {};
    for (const periodo of Object.keys(PERIODOS)) {
      const [[fila]] = await db.query(
        `SELECT COUNT(DISTINCT h.candidato_id) AS total
           FROM candidato_estado_historial h
          WHERE h.usuario_id = ? AND h.estado_anterior_id IS NOT NULL
            AND ${condicion(periodo, 'h.created_at')}`,
        [reclutadorId]
      );
      gestionados[periodo] = fila.total;
    }

    const [[asignados]] = await db.query(
      `SELECT ${porPeriodo('a.created_at')}
         FROM candidato_asignaciones a
        WHERE a.reclutador_nuevo_id = ? AND a.reclutador_anterior_id IS NOT NULL`,
      [reclutadorId]
    );

    const aNumeros = (fila) =>
      Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, Number(v)]));

    return {
      creados: aNumeros(creados),
      gestionados: aNumeros(gestionados),
      asignados: aNumeros(asignados),
    };
  }

  /** Distribución actual de la cartera del reclutador, por estado. */
  async function porEstado(reclutadorId) {
    const [filas] = await db.query(
      `SELECT ec.codigo AS estado, ec.nombre, ec.etapa, ec.color, COUNT(c.id) AS total
         FROM estados_candidato ec
         LEFT JOIN candidatos c ON c.estado_id = ec.id AND c.reclutador_id = ?
        WHERE ec.activo = TRUE
        GROUP BY ec.id, ec.codigo, ec.nombre, ec.etapa, ec.color, ec.orden
        ORDER BY ec.orden`,
      [reclutadorId]
    );
    return filas.map((f) => ({ ...f, total: Number(f.total) }));
  }

  /**
   * Candidatos registrados por día, TODOS los días del mes en curso (28-31
   * según el mes) — no una ventana móvil de N días. Los días sin registro
   * SÍ aparecen, en 0: la consulta original solo devolvía los días con
   * actividad, así que la gráfica de barras/líneas que la consume habría
   * desalineado el eje X con el día real apenas faltara uno.
   */
  async function serieMensual(reclutadorId) {
    const [filas] = await db.query(
      `SELECT DATE(h.created_at) AS fecha, COUNT(*) AS creados
         FROM candidato_estado_historial h
        WHERE h.usuario_id = ? AND h.estado_anterior_id IS NULL
          AND YEAR(h.created_at) = YEAR(CURDATE()) AND MONTH(h.created_at) = MONTH(CURDATE())
        GROUP BY DATE(h.created_at)`,
      [reclutadorId]
    );
    // `dateStrings` (config/db.js) ya entrega DATE como 'AAAA-MM-DD'.
    const creadosPorFecha = new Map(filas.map((f) => [f.fecha, Number(f.creados)]));

    const hoy = new Date();
    const anio = hoy.getFullYear();
    const mes = hoy.getMonth(); // 0-indexado
    const ultimoDia = new Date(anio, mes + 1, 0).getDate();

    const dias = [];
    for (let dia = 1; dia <= ultimoDia; dia += 1) {
      const fecha = `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      dias.push({ fecha, dia, creados: creadosPorFecha.get(fecha) ?? 0 });
    }
    return dias;
  }

  /**
   * Cartera actual agrupada por campaña/cargo. Mismo alcance que `porEstado`
   * (candidatos que hoy tiene asignados, sin importar quién los creó): las
   * tres vistas —estado, cargo, embudo de conversión— describen el mismo
   * conjunto desde ángulos distintos, para no mezclar poblaciones distintas
   * en la misma pantalla sin decirlo.
   */
  async function porCargo(reclutadorId) {
    const [filas] = await db.query(
      `SELECT cl.nombre AS cliente, ca.nombre AS cargo, COUNT(*) AS total
         FROM candidatos c
         JOIN clientes cl ON cl.id = c.cliente_id
         JOIN cargos ca ON ca.id = c.cargo_id
        WHERE c.reclutador_id = ?
        GROUP BY cl.id, cl.nombre, ca.id, ca.nombre
        ORDER BY total DESC, cl.nombre, ca.nombre`,
      [reclutadorId]
    );
    return filas.map((f) => ({ ...f, total: Number(f.total) }));
  }

  /**
   * Embudo de conversión: no "dónde está cada candidato hoy" (eso es
   * `porEstado`), sino "hasta dónde llegó alguna vez" — un candidato que hoy
   * está `rechazado` sí cuenta en "Entrevistado" si de verdad se entrevistó.
   * Por eso los conteos no son estrictamente decrecientes entre sí: son
   * honestos, no un embudo dibujado a la fuerza.
   *
   * `citado` incluye a quien llegó ahí por el atajo "Citado = Sí" al
   * registrar (migración 009): nunca pasó por `contacto_exitoso` ni por
   * `formularios_completados`, y esas dos etapas reflejan eso con razón.
   */
  async function embudoConversion(reclutadorId) {
    const [[fila]] = await db.query(
      `SELECT COUNT(DISTINCT c.id) AS registrados,
              COUNT(DISTINCT CASE WHEN en.codigo = 'contacto_exitoso' THEN h.candidato_id END) AS contacto_exitoso,
              COUNT(DISTINCT CASE WHEN en.codigo = 'formularios_completados' THEN h.candidato_id END) AS formularios_completados,
              COUNT(DISTINCT CASE WHEN en.codigo = 'citado' THEN h.candidato_id END) AS citado,
              COUNT(DISTINCT CASE WHEN en.codigo = 'entrevistado' THEN h.candidato_id END) AS entrevistado,
              COUNT(DISTINCT CASE WHEN en.codigo IN ('aprobado', 'aprobado_final') THEN h.candidato_id END) AS aprobado,
              COUNT(DISTINCT CASE WHEN en.codigo = 'contratado' THEN h.candidato_id END) AS contratado
         FROM candidatos c
         LEFT JOIN candidato_estado_historial h ON h.candidato_id = c.id
         LEFT JOIN estados_candidato en ON en.id = h.estado_nuevo_id
        WHERE c.reclutador_id = ?`,
      [reclutadorId]
    );
    return {
      registrados: Number(fila.registrados),
      contactoExitoso: Number(fila.contacto_exitoso),
      formulariosCompletados: Number(fila.formularios_completados),
      citado: Number(fila.citado),
      entrevistado: Number(fila.entrevistado),
      aprobado: Number(fila.aprobado),
      contratado: Number(fila.contratado),
    };
  }

  /**
   * Resultado de decisión, solo para cargo Agente — es el único cargo que
   * pasa por evaluación de entrevista (`esCargoAgente`, ver
   * `seleccion.service.js`); el resto va directo de entrevistado a decisión
   * final, así que mezclarlos aquí diría "aprobado" de cosas distintas.
   * Población: candidatos Agente que ya llegaron a una de las cuatro etapas
   * de decisión — no cuenta a quien todavía está en proceso.
   */
  async function resultadosAgentes(reclutadorId) {
    const [filas] = await db.query(
      `SELECT ec.codigo AS estado, COUNT(*) AS total
         FROM candidatos c
         JOIN cargos ca ON ca.id = c.cargo_id
         JOIN estados_candidato ec ON ec.id = c.estado_id
        WHERE c.reclutador_id = ?
          AND ca.codigo LIKE '%agente%'
          AND ec.codigo IN ('aprobado', 'rechazado', 'aprobado_final', 'rechazado_final')
        GROUP BY ec.codigo`,
      [reclutadorId]
    );
    const porEstado = Object.fromEntries(filas.map((f) => [f.estado, Number(f.total)]));
    return {
      aprobado: porEstado.aprobado ?? 0,
      rechazado: porEstado.rechazado ?? 0,
      aprobadoFinal: porEstado.aprobado_final ?? 0,
      rechazadoFinal: porEstado.rechazado_final ?? 0,
    };
  }

  /** Últimos movimientos del reclutador, con nombre de candidato. */
  async function actividadReciente(reclutadorId, limite) {
    const [filas] = await db.query(
      `SELECT h.created_at, h.motivo,
              ea.codigo AS estado_anterior, en.codigo AS estado_nuevo, en.nombre AS estado_nombre,
              c.id AS candidato_id, c.primer_nombre, c.primer_apellido
         FROM candidato_estado_historial h
         JOIN candidatos c ON c.id = h.candidato_id
         JOIN estados_candidato en ON en.id = h.estado_nuevo_id
         LEFT JOIN estados_candidato ea ON ea.id = h.estado_anterior_id
        WHERE h.usuario_id = ?
        ORDER BY h.created_at DESC, h.id DESC
        LIMIT ?`,
      [reclutadorId, limite]
    );
    return filas;
  }

  /**
   * Comparativa de todo el equipo. Es la vista que solo tiene sentido para quien
   * puede ver a todos los reclutadores.
   */
  async function equipo() {
    // `h.candidato_id IS NOT NULL` es necesario porque este es un LEFT JOIN:
    // un reclutador sin ningún registro igual produce una fila (con `h` en
    // NULL) para que aparezca en la comparativa con cartera_actual = 0. La
    // condición 'total' de PERIODOS es '1 = 1' —no referencia `h.created_at`—
    // así que sin este guard esa fila fantasma contaría como "1 creado" para
    // todo el mundo, con role reclutamiento, sin importar si registró algo.
    const columnas = Object.keys(PERIODOS)
      .map(
        (p) =>
          `SUM(CASE WHEN h.candidato_id IS NOT NULL AND ${condicion(p, 'h.created_at')} THEN 1 ELSE 0 END) AS creados_${p}`
      )
      .join(', ');

    const [filas] = await db.query(
      `SELECT u.id, u.nombre_completo, u.email, u.activo,
              ${columnas},
              (SELECT COUNT(*) FROM candidatos c WHERE c.reclutador_id = u.id) AS cartera_actual,
              (SELECT COUNT(DISTINCT h2.candidato_id)
                 FROM candidato_estado_historial h2
                WHERE h2.usuario_id = u.id AND h2.estado_anterior_id IS NOT NULL
                  AND ${condicion('mes', 'h2.created_at')}) AS gestionados_mes,
              u.ultimo_acceso
         FROM usuarios u
         JOIN usuario_roles ur ON ur.usuario_id = u.id
         JOIN roles r ON r.id = ur.rol_id AND r.codigo = 'reclutamiento'
         LEFT JOIN candidato_estado_historial h
                ON h.usuario_id = u.id AND h.estado_anterior_id IS NULL
        GROUP BY u.id, u.nombre_completo, u.email, u.activo, u.ultimo_acceso
        ORDER BY creados_mes DESC, u.nombre_completo`
    );

    return filas.map((f) => ({
      id: f.id,
      nombreCompleto: f.nombre_completo,
      email: f.email,
      activo: Boolean(f.activo),
      ultimoAcceso: f.ultimo_acceso,
      carteraActual: Number(f.cartera_actual),
      creados: {
        dia: Number(f.creados_dia),
        semana: Number(f.creados_semana),
        mes: Number(f.creados_mes),
        total: Number(f.creados_total),
      },
      gestionadosMes: Number(f.gestionados_mes),
    }));
  }

  /** Totales del embudo completo, sin filtrar por reclutador. Para el admin. */
  async function totalesGlobales() {
    const [[fila]] = await db.query(
      `SELECT COUNT(*) AS candidatos,
              SUM(CASE WHEN ${condicion('dia', 'created_at')} THEN 1 ELSE 0 END) AS hoy,
              SUM(CASE WHEN ${condicion('semana', 'created_at')} THEN 1 ELSE 0 END) AS semana,
              SUM(CASE WHEN ${condicion('mes', 'created_at')} THEN 1 ELSE 0 END) AS mes
         FROM candidatos`
    );
    const [[usuarios]] = await db.query(
      'SELECT COUNT(*) AS activos FROM usuarios WHERE activo = TRUE'
    );
    return {
      candidatos: {
        total: Number(fila.candidatos),
        dia: Number(fila.hoy),
        semana: Number(fila.semana),
        mes: Number(fila.mes),
      },
      usuariosActivos: Number(usuarios.activos),
    };
  }

  return {
    resumen, porEstado, porCargo, embudoConversion, resultadosAgentes, serieMensual,
    actividadReciente, equipo, totalesGlobales,
  };
}

module.exports = { crearTrazabilidadRepositorio, PERIODOS };
