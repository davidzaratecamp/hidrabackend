const { v4: uuidv4 } = require('uuid');
const ExcelJS = require('exceljs');

// Helper para poder usar await con global.db.query (callback-style), usado solo por
// getCandidatosTotal (2026-08-19) - el resto del archivo se deja en su estilo callback
// original, sin tocar.
function queryAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    global.db.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
}

// --- Helpers de texto para el Excel "BASE RECLUTAMIENTO" (exportarExcel) ---

function textoSiNo(valor) {
  if (valor === 'si') return 'Sí';
  if (valor === 'no') return 'No';
  return '';
}

function textoAntecedente(valor) {
  if (valor === 'aprobado') return 'Aprobado';
  if (valor === 'no_aprobado') return 'No aprobado';
  return '';
}

function textoAprobadoFinal(valor) {
  if (valor === true || valor === 1) return 'Sí';
  if (valor === false || valor === 0) return 'No';
  return '';
}

function textoAsistencia(valor) {
  if (valor === 'asistio') return 'Asistió';
  if (valor === 'no_asistio') return 'No asistió';
  return 'Pendiente';
}

// Mismo texto/prioridad que getEstadoTexto() en CandidatosSeleccion.jsx.
function textoEstadoGestion(c) {
  if (c.evaluacion_total !== null && c.aprobacion_final === null) {
    return 'Pendiente Decisión Final';
  }
  const mapa = {
    citado: 'Citado',
    no_asistio: 'No asistió',
    entrevistado: 'Entrevistado',
    aprobado_final: 'Aprobado Final',
    rechazado_final: 'Rechazado Final',
    rechazado: 'Rechazado',
    contratado: 'Contratado'
  };
  return mapa[c.estado] || c.estado;
}

// c.fecha_citacion_entrevista llega como Date (columna DATE, sin dateStrings en el pool) -
// se formatea con getters locales para no arrastrar corrimientos de zona horaria.
function formatearFechaExcel(fecha) {
  if (!fecha) return '';
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// Estructura de encabezados del Excel oficial "BASE RECLUTAMIENTO": grupos de 1 columna se
// fusionan verticalmente (fila 1 y 2), grupos con `sub` fusionan horizontalmente en la fila 1 y
// reparten los subtítulos en la fila 2.
const GRUPOS_ENCABEZADO_EXCEL = [
  { label: 'FECHA' },
  { label: 'ANALISTA' },
  { label: 'CAMPAÑA' },
  { label: 'CARGO' },
  { label: 'NOMBRE' },
  { label: 'TIPO DE DOC' },
  { label: 'DOCUMENTO' },
  { label: 'EDAD' },
  { label: 'CORREO' },
  { label: 'CONTACTO', sub: ['LLAMADA', 'WHATSAPP'] },
  { label: 'PERFIL' },
  { label: 'CITADO' },
  { label: 'ESTADO GESTIÓN RECLUTAMIENTO' },
  { label: 'SEGUIMIENTO ASISTENCIA', sub: ['LLAMADA', 'GLOBAL/WA'] },
  { label: 'ASISTE ENTREVISTA' },
  { label: 'MOTIVO INASISTENCIA' },
  { label: 'ANTECEDENTES', sub: ['ADRES', 'POL', 'COMP', 'PROCU'] },
  { label: 'APROBADO' },
  { label: '¿POR QUÉ NO APROBÓ?' }
];

// PERFIL (sin dato en el sistema hoy, columna en blanco a propósito) y SEGUIMIENTO ASISTENCIA
// (reusa contacto_llamada/contacto_whatsapp del formulario "Nuevo Candidato" - es el único dato
// de contacto que captura el sistema) - decidido con el usuario, ver claude/lastcontext.md.
function filaCandidatoExcel(c) {
  const nombreCompleto = [c.primer_nombre, c.segundo_nombre, c.primer_apellido, c.segundo_apellido]
    .filter(Boolean)
    .join(' ');
  const contactoLlamada = textoSiNo(c.contacto_llamada);
  const contactoWhatsapp = textoSiNo(c.contacto_whatsapp);

  return [
    formatearFechaExcel(c.fecha_citacion_entrevista),
    c.nombre_reclutador || '',
    c.cliente || '',
    c.cargo || '',
    nombreCompleto,
    c.tipo_documento || '',
    c.numero_documento || '',
    c.edad ?? '',
    c.email_personal || '',
    contactoLlamada,
    contactoWhatsapp,
    '',
    'Sí',
    textoEstadoGestion(c),
    contactoLlamada,
    contactoWhatsapp,
    textoAsistencia(c.asistio_citacion),
    c.motivo_inasistencia || '',
    textoAntecedente(c.antecedentes_adres),
    textoAntecedente(c.antecedentes_pol),
    textoAntecedente(c.antecedentes_comp),
    textoAntecedente(c.antecedentes_procu),
    textoAprobadoFinal(c.aprobacion_final),
    c.aprobacion_final_razon || ''
  ];
}

// Arma el workbook (encabezado de 2 filas fusionado + filas de datos) a partir de un array de
// candidatos ya consultado - compartido por exportarExcel (citados) y exportarExcelAprobados
// (perfiles aprobados), que solo difieren en el WHERE/ORDER BY de la consulta y el nombre del
// archivo.
function construirWorkbookSeleccion(candidatos) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Selección');

  const row1 = sheet.getRow(1);
  const row2 = sheet.getRow(2);
  let colIndex = 1;

  GRUPOS_ENCABEZADO_EXCEL.forEach((grupo) => {
    const span = grupo.sub ? grupo.sub.length : 1;
    const startCol = colIndex;
    const endCol = colIndex + span - 1;

    row1.getCell(startCol).value = grupo.label;
    if (span > 1) {
      sheet.mergeCells(1, startCol, 1, endCol);
      grupo.sub.forEach((subLabel, i) => {
        row2.getCell(startCol + i).value = subLabel;
      });
    } else {
      sheet.mergeCells(1, startCol, 2, startCol);
    }
    sheet.getColumn(startCol).width = Math.max(grupo.label.length, 12);

    colIndex = endCol + 1;
  });

  const totalColumnas = colIndex - 1;
  [row1, row2].forEach((row) => {
    for (let i = 1; i <= totalColumnas; i++) {
      const cell = row.getCell(i);
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' }
      };
    }
  });
  row1.height = 20;
  row2.height = 18;

  candidatos.forEach((c) => {
    sheet.addRow(filaCandidatoExcel(c));
  });

  return workbook;
}

function enviarWorkbookExcel(res, workbook, nombreArchivo) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
  return workbook.xlsx.write(res).then(() => res.end());
}

class SeleccionController {
  
  // Obtener candidatos en proceso de selección (pantalla "Candidatos" de Selección,
  // CandidatosSeleccion.jsx). Paginado 20 en 20 (2026-08-21) - antes traía todos los citados sin
  // límite (1984 filas en local); solo lo consume esta pantalla (CandidatosTotal.jsx, la vista de
  // solo lectura del reclutador, tiene su propio endpoint dedicado, getCandidatosTotal, desde
  // 2026-08-19).
  // Orden (corregido 2026-08-21, segunda vuelta): el intento inicial ordenaba por
  // fecha_citacion_entrevista ASC ("cita más antigua primero", pensado para priorizar casos
  // atrasados) - en la práctica eso subía a la cima filas viejas con fecha_citacion_entrevista
  // basura (ej. "2001-01-01", remanente de datos corruptos/importación defectuosa, ver
  // claude/context.md) y enterraba candidatos recién citados de verdad. El usuario confirmó que
  // quiere lo contrario: citados más recientes primero. Se mantiene la prioridad de evaluación
  // pendiente de decisión (sigue siendo un caso distinto y no cuestionado), pero dentro de cada
  // grupo ahora ordena por fecha_citacion_entrevista DESC.
  async getCandidatosCitados(req, res) {
    try {
      const limit = 20;
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const offset = (page - 1) * limit;

      const search = (req.query.search || '').trim();
      const searchParam = search ? `%${search.replace(/[\\%_]/g, '\\$&')}%` : null;

      const condiciones = [];
      const params = [];

      if (search) {
        condiciones.push('(c.primer_nombre LIKE ? OR c.primer_apellido LIKE ? OR c.email_personal LIKE ? OR c.numero_celular LIKE ?)');
        params.push(searchParam, searchParam, searchParam, searchParam);
      }
      if (req.query.operacion) {
        condiciones.push('c.cliente = ?');
        params.push(req.query.operacion);
      }
      if (req.query.asistencia) {
        condiciones.push('c.asistio_citacion = ?');
        params.push(req.query.asistencia);
      }
      if (req.query.estado) {
        condiciones.push('c.estado = ?');
        params.push(req.query.estado);
      }
      if (req.query.fechaDesde) {
        condiciones.push('c.fecha_citacion_entrevista >= ?');
        params.push(req.query.fechaDesde);
      }
      if (req.query.fechaHasta) {
        condiciones.push('c.fecha_citacion_entrevista <= ?');
        params.push(req.query.fechaHasta);
      }

      const whereExtra = condiciones.length ? ` AND ${condiciones.join(' AND ')}` : '';
      const baseFrom = `
        FROM hyd_candidatos c
        LEFT JOIN hyd_usuarios u ON c.reclutador_id = u.id
        LEFT JOIN hyd_usuarios up ON c.psicologo_decision_id = up.id
        WHERE c.fecha_citacion_entrevista IS NOT NULL${whereExtra}
      `;

      // El dropdown de "Operación" se calcula sobre TODOS los citados (sin aplicar los demás
      // filtros activos) - mismo comportamiento que tenía getOperacionesUnicas() client-side,
      // que leía del array completo, no del ya filtrado.
      const [countResults, results, operaciones] = await Promise.all([
        queryAsync(`SELECT COUNT(*) as total ${baseFrom}`, params),
        queryAsync(
          `SELECT
            c.*,
            u.nombre_completo as nombre_reclutador,
            up.nombre_completo as nombre_psicologo_decision
          ${baseFrom}
          ORDER BY
            CASE WHEN c.evaluacion_total IS NOT NULL AND c.aprobacion_final IS NULL THEN 1 ELSE 2 END,
            c.fecha_citacion_entrevista DESC, c.created_at DESC, c.id DESC
          LIMIT ? OFFSET ?`,
          [...params, limit, offset]
        ),
        queryAsync(
          `SELECT DISTINCT cliente FROM hyd_candidatos
           WHERE fecha_citacion_entrevista IS NOT NULL AND cliente IS NOT NULL
           ORDER BY cliente`
        )
      ]);

      res.json({
        candidatos: results,
        pagination: {
          page,
          limit,
          total: countResults[0].total,
          totalPages: Math.max(Math.ceil(countResults[0].total / limit), 1)
        },
        filtrosDisponibles: {
          operaciones: operaciones.map((r) => r.cliente)
        }
      });
    } catch (error) {
      console.error('Error en getCandidatosCitados:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Exporta a Excel (.xlsx) los candidatos citados, con el mismo filtro de búsqueda/operación/
  // asistencia/estado que la pantalla, más un rango de fechas obligatorio sobre
  // fecha_citacion_entrevista (columna FECHA del Excel). Sin paginado: exporta todo lo que
  // matchee el filtro, no solo la página visible.
  async exportarExcel(req, res) {
    try {
      const { fechaDesde, fechaHasta } = req.query;
      if (!fechaDesde || !fechaHasta) {
        return res.status(400).json({ error: 'fechaDesde y fechaHasta son requeridos' });
      }

      const search = (req.query.search || '').trim();
      const searchParam = search ? `%${search.replace(/[\\%_]/g, '\\$&')}%` : null;

      const condiciones = ['c.fecha_citacion_entrevista >= ?', 'c.fecha_citacion_entrevista <= ?'];
      const params = [fechaDesde, fechaHasta];

      if (search) {
        condiciones.push('(c.primer_nombre LIKE ? OR c.primer_apellido LIKE ? OR c.email_personal LIKE ? OR c.numero_celular LIKE ?)');
        params.push(searchParam, searchParam, searchParam, searchParam);
      }
      if (req.query.operacion) {
        condiciones.push('c.cliente = ?');
        params.push(req.query.operacion);
      }
      if (req.query.asistencia) {
        condiciones.push('c.asistio_citacion = ?');
        params.push(req.query.asistencia);
      }
      if (req.query.estado) {
        condiciones.push('c.estado = ?');
        params.push(req.query.estado);
      }

      const candidatos = await queryAsync(
        `SELECT
          c.*,
          u.nombre_completo as nombre_reclutador
        FROM hyd_candidatos c
        LEFT JOIN hyd_usuarios u ON c.reclutador_id = u.id
        WHERE c.fecha_citacion_entrevista IS NOT NULL AND ${condiciones.join(' AND ')}
        ORDER BY c.fecha_citacion_entrevista DESC, c.created_at DESC, c.id DESC`,
        params
      );

      const workbook = construirWorkbookSeleccion(candidatos);
      await enviarWorkbookExcel(res, workbook, `seleccion_${fechaDesde}_a_${fechaHasta}.xlsx`);
    } catch (error) {
      console.error('Error en exportarExcel:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Exporta a Excel (.xlsx) los perfiles aprobados finalmente (misma estructura de columnas que
  // exportarExcel). A diferencia de los citados, acá el rango de fechas es opcional (filtra sobre
  // fecha_evaluacion) - mismo criterio que los filtros ya existentes de PerfilesAprobados.jsx, que
  // también son opcionales.
  async exportarExcelAprobados(req, res) {
    try {
      const { fechaDesde, fechaHasta, operacion, puntajeMin } = req.query;
      const search = (req.query.search || '').trim();
      const searchParam = search ? `%${search.replace(/[\\%_]/g, '\\$&')}%` : null;

      const condiciones = [`c.estado = 'aprobado_final'`, 'c.aprobacion_final = TRUE'];
      const params = [];

      if (fechaDesde) {
        condiciones.push('c.fecha_evaluacion >= ?');
        params.push(fechaDesde);
      }
      if (fechaHasta) {
        condiciones.push('c.fecha_evaluacion <= ?');
        params.push(`${fechaHasta} 23:59:59`);
      }
      if (operacion) {
        condiciones.push('c.cliente = ?');
        params.push(operacion);
      }
      if (puntajeMin) {
        condiciones.push('c.evaluacion_total >= ?');
        params.push(parseFloat(puntajeMin));
      }
      if (search) {
        condiciones.push('(c.primer_nombre LIKE ? OR c.primer_apellido LIKE ? OR c.email_personal LIKE ? OR c.numero_celular LIKE ?)');
        params.push(searchParam, searchParam, searchParam, searchParam);
      }

      const candidatos = await queryAsync(
        `SELECT
          c.*,
          u.nombre_completo as nombre_reclutador
        FROM hyd_candidatos c
        LEFT JOIN hyd_usuarios u ON c.reclutador_id = u.id
        WHERE ${condiciones.join(' AND ')}
        ORDER BY c.fecha_aprobacion_final DESC, c.evaluacion_total DESC`,
        params
      );

      const workbook = construirWorkbookSeleccion(candidatos);
      const nombreArchivo = fechaDesde && fechaHasta
        ? `perfiles_aprobados_${fechaDesde}_a_${fechaHasta}.xlsx`
        : 'perfiles_aprobados.xlsx';
      await enviarWorkbookExcel(res, workbook, nombreArchivo);
    } catch (error) {
      console.error('Error en exportarExcelAprobados:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Marcar asistencia de candidato
  async marcarAsistencia(req, res) {
    try {
      const { candidatoId } = req.params;
      const { asistio, observaciones, motivoInasistencia } = req.body;

      if (!['asistio', 'no_asistio'].includes(asistio)) {
        return res.status(400).json({ error: 'Valor de asistencia inválido' });
      }

      if (asistio === 'no_asistio' && !motivoInasistencia) {
        return res.status(400).json({ error: 'El motivo de inasistencia es requerido' });
      }

      // Determinar el nuevo estado
      let nuevoEstado = 'citado'; // Por defecto mantiene citado
      if (asistio === 'no_asistio') {
        nuevoEstado = 'no_asistio';
      } else if (asistio === 'asistio') {
        nuevoEstado = 'entrevistado'; // Si asistió, pasa a entrevistado
      }

      const query = `
        UPDATE hyd_candidatos
        SET
          asistio_citacion = ?,
          motivo_inasistencia = ?,
          fecha_asistencia = NOW(),
          observaciones_seleccion = ?,
          estado = ?,
          updated_at = NOW()
        WHERE id = ?
      `;

      global.db.query(
        query,
        [asistio, asistio === 'no_asistio' ? motivoInasistencia : null, observaciones || null, nuevoEstado, candidatoId],
        (err, results) => {
          if (err) {
            console.error('Error marcando asistencia:', err);
            return res.status(500).json({ error: 'Error de base de datos' });
          }

          if (results.affectedRows === 0) {
            return res.status(404).json({ error: 'Candidato no encontrado' });
          }

          res.json({
            message: 'Asistencia marcada correctamente',
            asistencia: asistio,
            nuevo_estado: nuevoEstado
          });
        }
      );
    } catch (error) {
      console.error('Error en marcarAsistencia:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Actualizar estado de candidato (para entrevistado, aprobado, rechazado, etc.)
  async actualizarEstado(req, res) {
    try {
      const { candidatoId } = req.params;
      const { estado, observaciones } = req.body;
      
      const estadosValidos = ['citado', 'no_asistio', 'entrevistado', 'aprobado', 'rechazado', 'contratado'];
      
      if (!estadosValidos.includes(estado)) {
        return res.status(400).json({ error: 'Estado inválido' });
      }
      
      const query = `
        UPDATE hyd_candidatos 
        SET 
          estado = ?,
          observaciones_seleccion = ?,
          updated_at = NOW()
        WHERE id = ?
      `;
      
      global.db.query(query, [estado, observaciones || null, candidatoId], (err, results) => {
        if (err) {
          console.error('Error actualizando estado:', err);
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        if (results.affectedRows === 0) {
          return res.status(404).json({ error: 'Candidato no encontrado' });
        }
        
        res.json({ 
          message: 'Estado actualizado correctamente',
          nuevo_estado: estado
        });
      });
    } catch (error) {
      console.error('Error en actualizarEstado:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Actualizar operación (cliente) y campaña (cargo) de candidato
  async actualizarOperacionCampana(req, res) {
    try {
      const { candidatoId } = req.params;
      const { cliente, cargo, observaciones } = req.body;
      
      if (!cliente || !cargo) {
        return res.status(400).json({ error: 'Cliente (operación) y cargo (campaña) son requeridos' });
      }
      
      const query = `
        UPDATE hyd_candidatos 
        SET 
          cliente = ?,
          cargo = ?,
          observaciones_seleccion = ?,
          updated_at = NOW()
        WHERE id = ?
      `;
      
      global.db.query(query, [cliente, cargo, observaciones || null, candidatoId], (err, results) => {
        if (err) {
          console.error('Error actualizando operación y campaña:', err);
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        if (results.affectedRows === 0) {
          return res.status(404).json({ error: 'Candidato no encontrado' });
        }
        
        res.json({ 
          message: 'Operación y campaña actualizadas correctamente',
          nueva_operacion: cliente,
          nueva_campana: cargo
        });
      });
    } catch (error) {
      console.error('Error en actualizarOperacionCampana:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Guardar evaluación de entrevista
  async guardarEvaluacion(req, res) {
    try {
      const { candidatoId } = req.params;
      const { 
        saludo, 
        perfilamiento, 
        producto, 
        objeciones, 
        cierre, 
        total, 
        aprobado, 
        razonRechazo 
      } = req.body;
      
      // Validar que todos los campos requeridos estén presentes
      if (saludo === undefined || perfilamiento === undefined || producto === undefined || 
          objeciones === undefined || cierre === undefined || total === undefined || 
          aprobado === undefined) {
        return res.status(400).json({ error: 'Todos los campos de evaluación son requeridos' });
      }
      
      // Validar rangos
      const evaluaciones = [saludo, perfilamiento, producto, objeciones, cierre];
      if (evaluaciones.some(evaluacion => evaluacion < 0 || evaluacion > 20)) {
        return res.status(400).json({ error: 'Las evaluaciones deben estar entre 0 y 20' });
      }
      
      // Determinar nuevo estado basado en aprobación
      const nuevoEstado = aprobado ? 'aprobado' : 'rechazado';
      
      
      const query = `
        UPDATE hyd_candidatos 
        SET 
          evaluacion_saludo = ?,
          evaluacion_perfilamiento = ?,
          evaluacion_producto = ?,
          evaluacion_objeciones = ?,
          evaluacion_cierre = ?,
          evaluacion_total = ?,
          evaluacion_aprobado = ?,
          evaluacion_razon_rechazo = ?,
          fecha_evaluacion = NOW(),
          estado = ?,
          updated_at = NOW()
        WHERE id = ?
      `;
      
      global.db.query(query, [
        saludo, 
        perfilamiento, 
        producto, 
        objeciones, 
        cierre, 
        total, 
        aprobado, 
        razonRechazo || null, 
        nuevoEstado,
        candidatoId
      ], (err, results) => {
        if (err) {
          console.error('Error guardando evaluación:', err);
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        if (results.affectedRows === 0) {
          return res.status(404).json({ error: 'Candidato no encontrado' });
        }
        
        
        res.json({ 
          message: 'Evaluación guardada correctamente',
          evaluacion: {
            saludo,
            perfilamiento,
            producto,
            objeciones,
            cierre,
            total,
            aprobado,
            nuevo_estado: nuevoEstado
          }
        });
      });
    } catch (error) {
      console.error('Error en guardarEvaluacion:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Obtener candidatos aprobados finalmente
  // Los psicólogos ven todos los candidatos que han sido aprobados finalmente
  async getCandidatosAprobados(req, res) {
    try {
      const query = `
        SELECT 
          c.*,
          u.nombre_completo as nombre_reclutador,
          up.nombre_completo as nombre_psicologo_decision
        FROM hyd_candidatos c
        LEFT JOIN hyd_usuarios u ON c.reclutador_id = u.id
        LEFT JOIN hyd_usuarios up ON c.psicologo_decision_id = up.id
        WHERE c.estado = 'aprobado_final'
          AND c.aprobacion_final = TRUE
        ORDER BY c.fecha_aprobacion_final DESC, c.evaluacion_total DESC
      `;
      
      global.db.query(query, (err, results) => {
        if (err) {
          console.error('Error obteniendo candidatos aprobados:', err);
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        res.json({ candidatos: results });
      });
    } catch (error) {
      console.error('Error en getCandidatosAprobados:', error);
      res.status(500).json({ error: error.message });
    }
  }


  // Obtener estadísticas de candidatos aprobados finalmente
  // Los psicólogos ven estadísticas de todos los candidatos aprobados finalmente del sistema
  async getEstadisticasAprobados(req, res) {
    try {
      const statsQuery = `
        SELECT 
          COUNT(*) as total_aprobados,
          AVG(evaluacion_total) as promedio_general,
          MAX(evaluacion_total) as mejor_puntaje,
          MIN(evaluacion_total) as peor_puntaje,
          COUNT(CASE WHEN evaluacion_total >= 90 THEN 1 END) as excelentes,
          COUNT(CASE WHEN evaluacion_total >= 80 AND evaluacion_total < 90 THEN 1 END) as buenos,
          COUNT(CASE WHEN evaluacion_total >= 71 AND evaluacion_total < 80 THEN 1 END) as regulares
        FROM hyd_candidatos 
        WHERE estado = 'aprobado_final' 
          AND aprobacion_final = TRUE
      `;

      const distribucionQuery = `
        SELECT 
          cliente as operacion,
          COUNT(*) as total,
          AVG(evaluacion_total) as promedio_operacion,
          MAX(evaluacion_total) as mejor_operacion
        FROM hyd_candidatos 
        WHERE estado = 'aprobado_final' 
          AND aprobacion_final = TRUE
          AND cliente IS NOT NULL
        GROUP BY cliente
        ORDER BY promedio_operacion DESC
      `;
      
      global.db.query(statsQuery, (err, statsResults) => {
        if (err) {
          console.error('Error obteniendo estadísticas de aprobados:', err);
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        global.db.query(distribucionQuery, (err, distribucionResults) => {
          if (err) {
            console.error('Error obteniendo distribución:', err);
            return res.status(500).json({ error: 'Error de base de datos' });
          }
          
          const stats = statsResults[0];
          
          res.json({ 
            estadisticas: {
              total: parseInt(stats.total_aprobados) || 0,
              promedioGeneral: parseFloat(stats.promedio_general || 0).toFixed(1),
              mejorPuntaje: parseFloat(stats.mejor_puntaje || 0).toFixed(1),
              peorPuntaje: parseFloat(stats.peor_puntaje || 0).toFixed(1),
              excelentes: parseInt(stats.excelentes) || 0,
              buenos: parseInt(stats.buenos) || 0,
              regulares: parseInt(stats.regulares) || 0,
              distribucionPorOperacion: distribucionResults.map(row => ({
                operacion: row.operacion,
                total: parseInt(row.total),
                promedio: parseFloat(row.promedio_operacion).toFixed(1),
                mejor: parseFloat(row.mejor_operacion).toFixed(1)
              }))
            }
          });
        });
      });
    } catch (error) {
      console.error('Error en getEstadisticasAprobados:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Obtener estadísticas de selección
  // Los psicólogos ven estadísticas de todos los candidatos del sistema
  async getEstadisticasSeleccion(req, res) {
    try {
      const statsQuery = `
        SELECT 
          COUNT(*) as total_citados,
          SUM(CASE WHEN asistio_citacion = 'asistio' THEN 1 ELSE 0 END) as asistieron,
          SUM(CASE WHEN asistio_citacion = 'no_asistio' THEN 1 ELSE 0 END) as no_asistieron,
          SUM(CASE WHEN estado = 'entrevistado' THEN 1 ELSE 0 END) as entrevistados,
          SUM(CASE WHEN estado = 'aprobado_final' THEN 1 ELSE 0 END) as aprobados_finales,
          SUM(CASE WHEN estado = 'rechazado_final' THEN 1 ELSE 0 END) as rechazados_finales,
          SUM(CASE WHEN estado = 'contratado' THEN 1 ELSE 0 END) as contratados,
          SUM(CASE WHEN evaluacion_aprobado = TRUE AND aprobacion_final IS NULL THEN 1 ELSE 0 END) as pendientes_decision
        FROM hyd_candidatos 
        WHERE estado IN ('citado', 'no_asistio', 'entrevistado', 'aprobado_final', 'rechazado_final', 'contratado')
      `;
      
      global.db.query(statsQuery, (err, results) => {
        if (err) {
          console.error('Error obteniendo estadísticas:', err);
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        const stats = results[0];
        
        res.json({ 
          estadisticas: {
            total_citados: parseInt(stats.total_citados) || 0,
            asistieron: parseInt(stats.asistieron) || 0,
            no_asistieron: parseInt(stats.no_asistieron) || 0,
            entrevistados: parseInt(stats.entrevistados) || 0,
            aprobados_finales: parseInt(stats.aprobados_finales) || 0,
            rechazados_finales: parseInt(stats.rechazados_finales) || 0,
            contratados: parseInt(stats.contratados) || 0,
            pendientes_decision: parseInt(stats.pendientes_decision) || 0,
            porcentaje_asistencia: stats.total_citados > 0 ? 
              Math.round((parseInt(stats.asistieron) / parseInt(stats.total_citados)) * 100) : 0
          }
        });
      });
    } catch (error) {
      console.error('Error en getEstadisticasSeleccion:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Aprobar o rechazar candidato finalmente (decisión del psicólogo)
  async tomarDecisionFinal(req, res) {
    try {
      const { candidatoId } = req.params;
      const { 
        aprobacion_final, 
        aprobacion_final_razon 
      } = req.body;
      
      // Validar que todos los campos requeridos estén presentes
      if (aprobacion_final === undefined || aprobacion_final === null) {
        return res.status(400).json({ error: 'La decisión final es requerida (true/false)' });
      }
      
      // Si se rechaza, la razón es obligatoria
      if (!aprobacion_final && (!aprobacion_final_razon || aprobacion_final_razon.trim() === '')) {
        return res.status(400).json({ error: 'La razón del rechazo es requerida cuando se rechaza al candidato' });
      }
      
      // Determinar nuevo estado basado en la decisión final
      const nuevoEstado = aprobacion_final ? 'aprobado_final' : 'rechazado_final';
      const psicologoId = req.usuario.id;
      
      const query = `
        UPDATE hyd_candidatos 
        SET 
          aprobacion_final = ?,
          aprobacion_final_razon = ?,
          fecha_aprobacion_final = NOW(),
          psicologo_decision_id = ?,
          estado = ?,
          updated_at = NOW()
        WHERE id = ?
      `;
      
      global.db.query(query, [
        aprobacion_final, 
        aprobacion_final_razon || null, 
        psicologoId,
        nuevoEstado,
        candidatoId
      ], (err, results) => {
        if (err) {
          console.error('Error tomando decisión final:', err);
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        if (results.affectedRows === 0) {
          return res.status(404).json({ error: 'Candidato no encontrado' });
        }
        
        res.json({ 
          message: 'Decisión final tomada correctamente',
          decision: {
            aprobacion_final,
            razon: aprobacion_final_razon,
            nuevo_estado: nuevoEstado,
            fecha: new Date().toISOString(),
            psicologo_id: psicologoId
          }
        });
      });
    } catch (error) {
      console.error('Error en tomarDecisionFinal:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Obtener candidatos rechazados finalmente
  async getCandidatosRechazados(req, res) {
    try {
      const query = `
        SELECT 
          c.*,
          u.nombre_completo as nombre_reclutador,
          up.nombre_completo as nombre_psicologo_decision
        FROM hyd_candidatos c
        LEFT JOIN hyd_usuarios u ON c.reclutador_id = u.id
        LEFT JOIN hyd_usuarios up ON c.psicologo_decision_id = up.id
        WHERE c.estado = 'rechazado_final'
          AND c.aprobacion_final = FALSE
        ORDER BY c.fecha_aprobacion_final DESC
      `;
      
      global.db.query(query, (err, results) => {
        if (err) {
          console.error('Error obteniendo candidatos rechazados:', err);
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        res.json({ candidatos: results });
      });
    } catch (error) {
      console.error('Error en getCandidatosRechazados:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Versión paginada de getCandidatosCitados, dedicada a "Candidatos Total" (vista de solo
  // lectura del reclutador, CandidatosTotal.jsx). Se agregó como endpoint nuevo (2026-08-19)
  // en vez de modificar getCandidatosCitados a propósito: ese otro lo usa también
  // CandidatosSeleccion.jsx, la pantalla de trabajo diario del equipo de Selección
  // (evaluar/gestionar citados, filtrando client-side sobre la lista completa) - paginar ahí
  // habría arriesgado romper ese flujo. Confirmado el alcance con el usuario.
  async getCandidatosTotal(req, res) {
    try {
      const limit = 20;
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const offset = (page - 1) * limit;

      // Búsqueda/filtros server-side (mismo motivo que en candidato.controller.js:
      // getCandidatosPorEstado - con paginado, filtrar en el frontend solo vería la página
      // cargada, no todos los citados).
      const search = (req.query.search || '').trim();
      const searchParam = search ? `%${search.replace(/[\\%_]/g, '\\$&')}%` : null;

      const condiciones = [];
      const params = [];

      if (search) {
        condiciones.push('(c.primer_nombre LIKE ? OR c.primer_apellido LIKE ? OR c.email_personal LIKE ? OR c.numero_celular LIKE ?)');
        params.push(searchParam, searchParam, searchParam, searchParam);
      }
      if (req.query.operacion) {
        condiciones.push('c.cliente = ?');
        params.push(req.query.operacion);
      }
      if (req.query.asistencia) {
        condiciones.push('c.asistio_citacion = ?');
        params.push(req.query.asistencia);
      }
      if (req.query.estado) {
        condiciones.push('c.estado = ?');
        params.push(req.query.estado);
      }
      if (req.query.reclutador) {
        condiciones.push('u.nombre_completo = ?');
        params.push(req.query.reclutador);
      }

      const whereExtra = condiciones.length ? ` AND ${condiciones.join(' AND ')}` : '';
      const baseFrom = `
        FROM hyd_candidatos c
        LEFT JOIN hyd_usuarios u ON c.reclutador_id = u.id
        LEFT JOIN hyd_usuarios up ON c.psicologo_decision_id = up.id
        WHERE c.fecha_citacion_entrevista IS NOT NULL${whereExtra}
      `;

      // Las opciones de los dropdowns de "Operación"/"Reclutador" se calculan sobre TODOS los
      // citados (sin aplicar los demás filtros activos) - mismo comportamiento que tenía el
      // cálculo client-side original (getOperacionesUnicas/getReclutadoresUnicos leían del
      // array completo `candidatos`, no del filtrado).
      const [countResults, results, operaciones, reclutadores] = await Promise.all([
        queryAsync(`SELECT COUNT(*) as total ${baseFrom}`, params),
        queryAsync(
          `SELECT
            c.id, c.primer_nombre, c.primer_apellido, c.email_personal, c.numero_celular,
            c.cliente, c.cargo, c.fecha_citacion_entrevista, c.asistio_citacion, c.estado,
            c.evaluacion_total, c.aprobacion_final, c.created_at,
            u.nombre_completo as nombre_reclutador,
            up.nombre_completo as nombre_psicologo_decision
          ${baseFrom}
          ORDER BY
            CASE WHEN c.evaluacion_total IS NOT NULL AND c.aprobacion_final IS NULL THEN 1 ELSE 2 END,
            c.fecha_citacion_entrevista ASC, c.created_at ASC, c.id ASC
          LIMIT ? OFFSET ?`,
          [...params, limit, offset]
        ),
        queryAsync(
          `SELECT DISTINCT cliente FROM hyd_candidatos
           WHERE fecha_citacion_entrevista IS NOT NULL AND cliente IS NOT NULL
           ORDER BY cliente`
        ),
        queryAsync(
          `SELECT DISTINCT u.nombre_completo FROM hyd_candidatos c
           JOIN hyd_usuarios u ON c.reclutador_id = u.id
           WHERE c.fecha_citacion_entrevista IS NOT NULL
           ORDER BY u.nombre_completo`
        )
      ]);

      res.json({
        candidatos: results,
        pagination: {
          page,
          limit,
          total: countResults[0].total,
          totalPages: Math.max(Math.ceil(countResults[0].total / limit), 1)
        },
        filtrosDisponibles: {
          operaciones: operaciones.map((r) => r.cliente),
          reclutadores: reclutadores.map((r) => r.nombre_completo)
        }
      });
    } catch (error) {
      console.error('Error en getCandidatosTotal:', error);
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new SeleccionController();