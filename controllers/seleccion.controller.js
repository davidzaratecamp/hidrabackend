const { v4: uuidv4 } = require('uuid');

class SeleccionController {
  
  // Obtener candidatos en proceso de selección
  // Los psicólogos ven todos los candidatos que están en proceso de selección
  async getCandidatosCitados(req, res) {
    try {
      const query = `
        SELECT 
          c.*,
          u.nombre_completo as nombre_reclutador,
          up.nombre_completo as nombre_psicologo_decision,
          o.numero_oleada,
          o.descripcion as descripcion_oleada
        FROM hyd_candidatos c
        LEFT JOIN hyd_usuarios u ON c.reclutador_id = u.id
        LEFT JOIN hyd_usuarios up ON c.psicologo_decision_id = up.id
        LEFT JOIN hyd_oleadas o ON c.oleada_seleccion_id = o.id
        WHERE c.fecha_citacion_entrevista IS NOT NULL
        ORDER BY 
          CASE 
            WHEN c.evaluacion_total IS NOT NULL AND c.aprobacion_final IS NULL THEN 1
            ELSE 2 
          END,
          c.fecha_citacion_entrevista ASC, 
          c.created_at ASC
      `;
      
      global.db.query(query, (err, results) => {
        if (err) {
          console.error('Error obteniendo candidatos citados:', err);
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        res.json({ candidatos: results });
      });
    } catch (error) {
      console.error('Error en getCandidatosCitados:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Marcar asistencia de candidato
  async marcarAsistencia(req, res) {
    try {
      const { candidatoId } = req.params;
      const { asistio, observaciones } = req.body;
      
      if (!['asistio', 'no_asistio'].includes(asistio)) {
        return res.status(400).json({ error: 'Valor de asistencia inválido' });
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
          fecha_asistencia = NOW(),
          observaciones_seleccion = ?,
          estado = ?,
          updated_at = NOW()
        WHERE id = ?
      `;
      
      global.db.query(query, [asistio, observaciones || null, nuevoEstado, candidatoId], (err, results) => {
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
      });
    } catch (error) {
      console.error('Error en marcarAsistencia:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Asignar candidato a oleada
  async asignarOleada(req, res) {
    try {
      const { candidatoId } = req.params;
      const { oleadaId } = req.body;
      
      if (!oleadaId) {
        return res.status(400).json({ error: 'ID de oleada es requerido' });
      }
      
      // Verificar que la oleada existe y está activa
      const verificarQuery = `
        SELECT o.* FROM hyd_oleadas o WHERE o.id = ? AND o.activa = TRUE
      `;
      
      global.db.query(verificarQuery, [oleadaId], (err, oleadaResults) => {
        if (err) {
          console.error('Error verificando oleada:', err);
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        if (oleadaResults.length === 0) {
          return res.status(404).json({ error: 'Oleada no encontrada o inactiva' });
        }
        
        const oleada = oleadaResults[0];
        
        // Los psicólogos pueden asignar cualquier oleada activa a cualquier candidato
        
        // Por ahora, permitir asignación a cualquier oleada activa
        // La restricción de oleadas pasadas se manejará mediante la administración del campo 'activa'
        
        // Asignar oleada al candidato
        const updateQuery = `
          UPDATE hyd_candidatos 
          SET oleada_seleccion_id = ?, updated_at = NOW()
          WHERE id = ?
        `;
        
        global.db.query(updateQuery, [oleadaId, candidatoId], (err, results) => {
          if (err) {
            console.error('Error asignando oleada:', err);
            return res.status(500).json({ error: 'Error de base de datos' });
          }
          
          if (results.affectedRows === 0) {
            return res.status(404).json({ error: 'Candidato no encontrado' });
          }
          
          res.json({ 
            message: 'Candidato asignado a oleada correctamente',
            oleada: {
              id: oleada.id,
              numero: oleada.numero_oleada,
              operacion: oleada.operacion,
              campana: oleada.campana
            }
          });
        });
      });
    } catch (error) {
      console.error('Error en asignarOleada:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Obtener oleadas disponibles
  async getOleadas(req, res) {
    try {
      const query = `
        SELECT * FROM hyd_oleadas 
        WHERE activa = TRUE 
        ORDER BY operacion, campana, numero_oleada
      `;
      
      global.db.query(query, (err, results) => {
        if (err) {
          console.error('Error obteniendo oleadas:', err);
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        res.json({ oleadas: results });
      });
    } catch (error) {
      console.error('Error en getOleadas:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Crear nueva oleada
  async crearOleada(req, res) {
    try {
      const { numero_oleada, operacion, campana, descripcion, fecha_inicio, fecha_fin } = req.body;
      
      if (!numero_oleada || !operacion || !campana) {
        return res.status(400).json({ error: 'Número de oleada, operación y campaña son requeridos' });
      }
      
      const query = `
        INSERT INTO hyd_oleadas (numero_oleada, operacion, campana, descripcion, fecha_inicio, fecha_fin)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      global.db.query(query, [numero_oleada, operacion, campana, descripcion || null, fecha_inicio || null, fecha_fin || null], (err, results) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Ya existe una oleada con ese número para la misma operación y campaña' });
          }
          console.error('Error creando oleada:', err);
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        res.status(201).json({ 
          message: 'Oleada creada correctamente',
          oleada: {
            id: results.insertId,
            numero_oleada,
            operacion,
            campana,
            descripcion
          }
        });
      });
    } catch (error) {
      console.error('Error en crearOleada:', error);
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

  // Obtener oleada actual para una operación y campaña específica
  async getOleadaActual(req, res) {
    try {
      const { operacion, campana } = req.params;
      
      if (!operacion || !campana) {
        return res.status(400).json({ error: 'Operación y campaña son requeridos' });
      }
      
      const query = `
        SELECT MAX(numero_oleada) as oleada_actual
        FROM hyd_oleadas 
        WHERE operacion = ? AND campana = ? AND activa = TRUE
      `;
      
      global.db.query(query, [operacion, campana], (err, results) => {
        if (err) {
          console.error('Error obteniendo oleada actual:', err);
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        const oleadaActual = results[0]?.oleada_actual || 0;
        
        res.json({ 
          oleada_actual: oleadaActual,
          operacion,
          campana
        });
      });
    } catch (error) {
      console.error('Error en getOleadaActual:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Obtener oleadas disponibles para asignación (actual y futuras)
  async getOleadasDisponibles(req, res) {
    try {
      const { operacion, campana } = req.params;
      
      if (!operacion || !campana) {
        return res.status(400).json({ error: 'Operación y campaña son requeridos' });
      }
      
      // Primero obtener la oleada actual
      const oleadaActualQuery = `
        SELECT MAX(numero_oleada) as oleada_actual
        FROM hyd_oleadas 
        WHERE operacion = ? AND campana = ? AND activa = TRUE
      `;
      
      global.db.query(oleadaActualQuery, [operacion, campana], (err, oleadaResults) => {
        if (err) {
          console.error('Error obteniendo oleada actual:', err);
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        const oleadaActual = oleadaResults[0]?.oleada_actual || 0;
        
        // Obtener oleadas disponibles (actual y futuras)
        const query = `
          SELECT * FROM hyd_oleadas 
          WHERE operacion = ? AND campana = ? AND numero_oleada >= ? AND activa = TRUE
          ORDER BY numero_oleada ASC
        `;
        
        global.db.query(query, [operacion, campana, oleadaActual], (err, results) => {
          if (err) {
            console.error('Error obteniendo oleadas disponibles:', err);
            return res.status(500).json({ error: 'Error de base de datos' });
          }
          
          res.json({ 
            oleadas_disponibles: results,
            oleada_actual: oleadaActual,
            operacion,
            campana
          });
        });
      });
    } catch (error) {
      console.error('Error en getOleadasDisponibles:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Inicializar sistema de oleadas (crear oleada 1 para todas las operaciones activas)
  async inicializarOleadas(req, res) {
    try {
      // Obtener todas las combinaciones únicas de operación/campaña de candidatos existentes
      const candidatosQuery = `
        SELECT DISTINCT cliente as operacion, cargo as campana
        FROM hyd_candidatos 
        WHERE cliente IS NOT NULL AND cargo IS NOT NULL
        ORDER BY cliente, cargo
      `;
      
      global.db.query(candidatosQuery, (err, combinaciones) => {
        if (err) {
          console.error('Error obteniendo combinaciones:', err);
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        let oleadasCreadas = 0;
        let promesas = [];
        
        combinaciones.forEach(combo => {
          const promesa = new Promise((resolve) => {
            // Verificar si ya existe oleada 1 para esta combinación
            const existeQuery = `
              SELECT id FROM hyd_oleadas 
              WHERE operacion = ? AND campana = ? AND numero_oleada = 1
            `;
            
            global.db.query(existeQuery, [combo.operacion, combo.campana], (err, existe) => {
              if (err || existe.length > 0) {
                return resolve(false); // Ya existe o error
              }
              
              // Crear oleada 1
              const crearQuery = `
                INSERT INTO hyd_oleadas (numero_oleada, operacion, campana, descripcion)
                VALUES (1, ?, ?, ?)
              `;
              
              const descripcion = `Oleada inicial para ${combo.operacion} - ${combo.campana}`;
              
              global.db.query(crearQuery, [combo.operacion, combo.campana, descripcion], (err) => {
                if (!err) {
                  oleadasCreadas++;
                }
                resolve(!err);
              });
            });
          });
          
          promesas.push(promesa);
        });
        
        Promise.all(promesas).then(() => {
          res.json({
            message: 'Sistema de oleadas inicializado',
            oleadas_creadas: oleadasCreadas,
            combinaciones_procesadas: combinaciones.length
          });
        });
      });
    } catch (error) {
      console.error('Error en inicializarOleadas:', error);
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
          up.nombre_completo as nombre_psicologo_decision,
          o.numero_oleada,
          o.descripcion as descripcion_oleada
        FROM hyd_candidatos c
        LEFT JOIN hyd_usuarios u ON c.reclutador_id = u.id
        LEFT JOIN hyd_usuarios up ON c.psicologo_decision_id = up.id
        LEFT JOIN hyd_oleadas o ON c.oleada_seleccion_id = o.id
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
          up.nombre_completo as nombre_psicologo_decision,
          o.numero_oleada,
          o.descripcion as descripcion_oleada
        FROM hyd_candidatos c
        LEFT JOIN hyd_usuarios u ON c.reclutador_id = u.id
        LEFT JOIN hyd_usuarios up ON c.psicologo_decision_id = up.id
        LEFT JOIN hyd_oleadas o ON c.oleada_seleccion_id = o.id
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
}

module.exports = new SeleccionController();