const CandidatoModel = require('../models/candidato.model');
const emailService = require('../services/email.service');
const { v4: uuidv4 } = require('uuid');

class CandidatoController {
  
  async validarToken(req, res) {
    try {
      const { token } = req.params;
      
      const query = `
        SELECT * FROM hyd_candidatos 
        WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()
      `;
      
      global.db.query(query, [token], (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        if (results.length === 0) {
          return res.status(404).json({ error: 'Token inválido o expirado' });
        }
        
        const candidato = results[0];
        const progreso = CandidatoModel.calcularProgreso(candidato);
        
        res.json({
          candidato: {
            ...candidato,
            progreso_formularios: progreso
          }
        });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getCandidatosPorEstado(req, res) {
    try {
      const { estado } = req.params;
      
      if (!CandidatoModel.getEstadosValidos().includes(estado)) {
        return res.status(400).json({ error: 'Estado inválido' });
      }
      
      // Solo administradores ven todos los candidatos
      // Reclutadores y usuarios de selección solo ven sus candidatos
      let query, queryParams;
      
      if (req.usuario.rol === 'administrador') {
        // Administradores ven todos los candidatos
        query = `
          SELECT 
            id, primer_nombre, primer_apellido, email_personal, numero_celular,
            cliente, cargo, oleada, fecha_citacion_entrevista, estado, reclutador_id,
            formulario_hoja_vida_completado, formulario_datos_basicos_completado,
            formulario_estudios_completado, formulario_experiencia_completado,
            formulario_personal_completado, formulario_consentimiento_completado,
            updated_at
          FROM hyd_candidatos 
          WHERE estado = ?
          ORDER BY updated_at DESC
        `;
        queryParams = [estado];
      } else {
        // Reclutadores y usuarios de selección solo ven sus candidatos
        const userId = req.usuario.id;
        query = `
          SELECT 
            id, primer_nombre, primer_apellido, email_personal, numero_celular,
            cliente, cargo, oleada, fecha_citacion_entrevista, estado, reclutador_id,
            formulario_hoja_vida_completado, formulario_datos_basicos_completado,
            formulario_estudios_completado, formulario_experiencia_completado,
            formulario_personal_completado, formulario_consentimiento_completado,
            updated_at
          FROM hyd_candidatos 
          WHERE estado = ? AND reclutador_id = ?
          ORDER BY updated_at DESC
        `;
        queryParams = [estado, userId];
      }
      
      console.log('Obteniendo candidatos para usuario:', req.usuario.email, 'rol:', req.usuario.rol, 'estado:', estado);
      
      global.db.query(query, queryParams, (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        const candidatosConProgreso = results.map(candidato => ({
          ...candidato,
          progreso_formularios: CandidatoModel.calcularProgreso(candidato)
        }));
        
        res.json(candidatosConProgreso);
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getResumenEstados(req, res) {
    try {
      let query, queryParams;
      
      // Solo administradores ven todos los candidatos
      // Reclutadores y usuarios de selección solo ven sus candidatos
      if (req.usuario.rol === 'administrador') {
        query = `
          SELECT estado, COUNT(*) as cantidad 
          FROM hyd_candidatos 
          GROUP BY estado
        `;
        queryParams = [];
      } else {
        // Solo contar candidatos del usuario actual (reclutador_id)
        const userId = req.usuario.id;
        query = `
          SELECT estado, COUNT(*) as cantidad 
          FROM hyd_candidatos 
          WHERE reclutador_id = ?
          GROUP BY estado
        `;
        queryParams = [userId];
      }
      
      console.log('Obteniendo resumen de estados para usuario:', req.usuario.email, 'rol:', req.usuario.rol);
      
      global.db.query(query, queryParams, (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        // Incluir todos los estados visibles en el frontend
        const estadosVisibles = [
          'contacto_exitoso', 'formularios_enviados', 'formularios_completados',
          'citado', 'entrevistado', 'contacto_fallido', 'no_contesta', 'reagendar', 
          'no_interesado', 'numero_incorrecto', 'no_asistio', 'aprobado', 'rechazado', 'contratado'
        ];
        
        const resumen = {};
        estadosVisibles.forEach(estado => {
          resumen[estado] = 0;
        });
        
        results.forEach(item => {
          if (estadosVisibles.includes(item.estado)) {
            resumen[item.estado] = item.cantidad;
          }
        });
        
        res.json(resumen);
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getPerfilCompleto(req, res) {
    try {
      const { candidatoId } = req.params;
      
      // Los psicólogos y administradores pueden ver cualquier candidato, los reclutadores solo los suyos
      let query, queryParams;
      
      if (req.usuario.rol === 'seleccion' || req.usuario.rol === 'administrador') {
        query = 'SELECT * FROM hyd_candidatos WHERE id = ?';
        queryParams = [candidatoId];
      } else {
        const reclutadorId = req.usuario.id;
        query = 'SELECT * FROM hyd_candidatos WHERE id = ? AND reclutador_id = ?';
        queryParams = [candidatoId, reclutadorId];
      }
      
      global.db.query(query, queryParams, (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        if (results.length === 0) {
          return res.status(404).json({ error: 'Candidato no encontrado o no tienes acceso a este candidato' });
        }
        
        const candidato = results[0];
        const progreso = CandidatoModel.calcularProgreso(candidato);
        
        res.json({
          candidato: {
            ...candidato,
            progreso_formularios: progreso
          }
        });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getEstadosEnTiempo(req, res) {
    try {
      let query, queryParams;
      
      if (req.usuario.rol === 'administrador') {
        query = `
          SELECT 
            estado,
            DATE(created_at) as fecha,
            COUNT(*) as cantidad
          FROM hyd_candidatos 
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          GROUP BY estado, DATE(created_at)
          ORDER BY fecha DESC
        `;
        queryParams = [];
      } else {
        const userId = req.usuario.id;
        query = `
          SELECT 
            estado,
            DATE(created_at) as fecha,
            COUNT(*) as cantidad
          FROM hyd_candidatos 
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND reclutador_id = ?
          GROUP BY estado, DATE(created_at)
          ORDER BY fecha DESC
        `;
        queryParams = [userId];
      }
      
      global.db.query(query, queryParams, (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        res.json(results);
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getEstadisticasClientes(req, res) {
    try {
      let query, queryParams;
      
      if (req.usuario.rol === 'administrador') {
        query = `
          SELECT 
            cliente,
            COUNT(*) as total_candidatos,
            SUM(CASE WHEN estado = 'contratado' THEN 1 ELSE 0 END) as contratados,
            SUM(CASE WHEN estado = 'formularios_completados' THEN 1 ELSE 0 END) as completados
          FROM hyd_candidatos 
          GROUP BY cliente
          ORDER BY total_candidatos DESC
        `;
        queryParams = [];
      } else {
        const userId = req.usuario.id;
        query = `
          SELECT 
            cliente,
            COUNT(*) as total_candidatos,
            SUM(CASE WHEN estado = 'contratado' THEN 1 ELSE 0 END) as contratados,
            SUM(CASE WHEN estado = 'formularios_completados' THEN 1 ELSE 0 END) as completados
          FROM hyd_candidatos 
          WHERE reclutador_id = ?
          GROUP BY cliente
          ORDER BY total_candidatos DESC
        `;
        queryParams = [userId];
      }
      
      global.db.query(query, queryParams, (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        res.json(results);
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getEstadisticasCargos(req, res) {
    try {
      let query, queryParams;
      
      if (req.usuario.rol === 'administrador') {
        query = `
          SELECT 
            cargo,
            COUNT(*) as cantidad
          FROM hyd_candidatos 
          GROUP BY cargo
          ORDER BY cantidad DESC
          LIMIT 10
        `;
        queryParams = [];
      } else {
        const userId = req.usuario.id;
        query = `
          SELECT 
            cargo,
            COUNT(*) as cantidad
          FROM hyd_candidatos 
          WHERE reclutador_id = ?
          GROUP BY cargo
          ORDER BY cantidad DESC
          LIMIT 10
        `;
        queryParams = [userId];
      }
      
      global.db.query(query, queryParams, (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        res.json(results);
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getProgresoFormularios(req, res) {
    try {
      let query, queryParams;
      
      if (req.usuario.rol === 'administrador') {
        query = `
          SELECT 
            (formulario_hoja_vida_completado + formulario_datos_basicos_completado + 
             formulario_estudios_completado + formulario_experiencia_completado + 
             formulario_personal_completado + formulario_consentimiento_completado) as progreso,
            COUNT(*) as cantidad
          FROM hyd_candidatos 
          GROUP BY progreso
          ORDER BY progreso
        `;
        queryParams = [];
      } else {
        const userId = req.usuario.id;
        query = `
          SELECT 
            (formulario_hoja_vida_completado + formulario_datos_basicos_completado + 
             formulario_estudios_completado + formulario_experiencia_completado + 
             formulario_personal_completado + formulario_consentimiento_completado) as progreso,
            COUNT(*) as cantidad
          FROM hyd_candidatos 
          WHERE reclutador_id = ?
          GROUP BY progreso
          ORDER BY progreso
        `;
        queryParams = [userId];
      }
      
      global.db.query(query, queryParams, (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        res.json(results);
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async reenviarEmail(req, res) {
    try {
      const { candidatoId } = req.params;
      const reclutadorId = req.usuario.id;
      
      // Solo permitir reenvío de emails de candidatos del reclutador actual
      const query = 'SELECT * FROM hyd_candidatos WHERE id = ? AND reclutador_id = ?';
      
      global.db.query(query, [candidatoId, reclutadorId], async (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        if (results.length === 0) {
          return res.status(404).json({ error: 'Candidato no encontrado o no tienes acceso' });
        }
        
        const candidato = results[0];
        
        const updateQuery = `
          UPDATE hyd_candidatos 
          SET estado = 'formularios_enviados', updated_at = NOW()
          WHERE id = ? AND reclutador_id = ?
        `;
        
        global.db.query(updateQuery, [candidatoId, reclutadorId], async (updateErr) => {
          if (updateErr) {
            return res.status(500).json({ error: 'Error actualizando estado' });
          }
          
          const emailResult = await emailService.enviarFormularios(candidato);
          
          res.json({ 
            message: 'Email reenviado exitosamente',
            emailStatus: emailResult
          });
        });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getOpcionesCatalogo(req, res) {
    try {
      res.json({
        ...CandidatoModel.getOpcionesCatalogo(),
        anios: CandidatoModel.generarAnios(),
        estados_config: CandidatoModel.getEstadosConfig()
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async actualizarHojaVida(req, res) {
    try {
      const { token } = req.params;
      const { estado_civil } = req.body;
      
      if (!estado_civil) {
        return res.status(400).json({ error: 'Estado civil es requerido' });
      }
      
      const query = `
        UPDATE hyd_candidatos 
        SET 
          estado_civil = ?,
          formulario_hoja_vida_completado = TRUE,
          fecha_completado_hoja_vida = NOW(),
          updated_at = NOW()
        WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()
      `;
      
      global.db.query(query, [estado_civil, token], (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        if (results.affectedRows === 0) {
          return res.status(404).json({ error: 'Token inválido o expirado' });
        }
        
        res.json({ message: 'Hoja de vida actualizada exitosamente' });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async actualizarDatosBasicos(req, res) {
    try {
      const { token } = req.params;
      const {
        segundo_apellido, segundo_nombre, genero, fecha_nacimiento,
        grupo_sanguineo, eps, afp, nombre_emergencia, numero_emergencia, parentesco_emergencia
      } = req.body;
      
      if (!genero || !fecha_nacimiento || !grupo_sanguineo || !eps || !afp || 
          !nombre_emergencia || !numero_emergencia || !parentesco_emergencia) {
        return res.status(400).json({ error: 'Todos los campos requeridos deben completarse' });
      }
      
      const query = `
        UPDATE hyd_candidatos 
        SET 
          segundo_apellido = ?, segundo_nombre = ?, genero = ?, fecha_nacimiento = ?,
          grupo_sanguineo = ?, eps = ?, afp = ?, nombre_emergencia = ?,
          numero_emergencia = ?, parentesco_emergencia = ?,
          formulario_datos_basicos_completado = TRUE,
          fecha_completado_datos_basicos = NOW(),
          updated_at = NOW()
        WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()
      `;
      
      global.db.query(query, [
        segundo_apellido, segundo_nombre, genero, fecha_nacimiento,
        grupo_sanguineo, eps, afp, nombre_emergencia, numero_emergencia, parentesco_emergencia,
        token
      ], (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        if (results.affectedRows === 0) {
          return res.status(404).json({ error: 'Token inválido o expirado' });
        }
        
        res.json({ message: 'Datos básicos actualizados exitosamente' });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async actualizarEstudios(req, res) {
    try {
      const { token } = req.params;
      const { nivel_estudios, titulo_obtenido, nombre_institucion, ano_finalizacion } = req.body;
      
      if (!nivel_estudios || !titulo_obtenido || !nombre_institucion || !ano_finalizacion) {
        return res.status(400).json({ error: 'Todos los campos son requeridos' });
      }
      
      const query = `
        UPDATE hyd_candidatos 
        SET 
          nivel_estudios = ?, titulo_obtenido = ?, nombre_institucion = ?, ano_finalizacion = ?,
          formulario_estudios_completado = TRUE,
          fecha_completado_estudios = NOW(),
          updated_at = NOW()
        WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()
      `;
      
      global.db.query(query, [nivel_estudios, titulo_obtenido, nombre_institucion, ano_finalizacion, token], (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        if (results.affectedRows === 0) {
          return res.status(404).json({ error: 'Token inválido o expirado' });
        }
        
        res.json({ message: 'Estudios actualizados exitosamente' });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async actualizarExperiencia(req, res) {
    try {
      const { token } = req.params;
      const {
        nombre_empresa, cargo_desempenado, salario_experiencia,
        fecha_inicio_experiencia, fecha_retiro_experiencia,
        tiempo_laborado_anos, tiempo_laborado_meses,
        motivo_retiro, ha_trabajado_asiste
      } = req.body;
      
      if (!nombre_empresa || !cargo_desempenado || !salario_experiencia || 
          !fecha_inicio_experiencia || !fecha_retiro_experiencia ||
          tiempo_laborado_anos === undefined || tiempo_laborado_meses === undefined ||
          !motivo_retiro || !ha_trabajado_asiste) {
        return res.status(400).json({ error: 'Todos los campos son requeridos' });
      }
      
      const query = `
        UPDATE hyd_candidatos 
        SET 
          nombre_empresa = ?, cargo_desempenado = ?, salario_experiencia = ?,
          fecha_inicio_experiencia = ?, fecha_retiro_experiencia = ?,
          tiempo_laborado_anos = ?, tiempo_laborado_meses = ?,
          motivo_retiro = ?, ha_trabajado_asiste = ?,
          formulario_experiencia_completado = TRUE,
          fecha_completado_experiencia = NOW(),
          updated_at = NOW()
        WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()
      `;
      
      global.db.query(query, [
        nombre_empresa, cargo_desempenado, salario_experiencia,
        fecha_inicio_experiencia, fecha_retiro_experiencia,
        tiempo_laborado_anos, tiempo_laborado_meses,
        motivo_retiro, ha_trabajado_asiste, token
      ], (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        if (results.affectedRows === 0) {
          return res.status(404).json({ error: 'Token inválido o expirado' });
        }
        
        res.json({ message: 'Experiencia actualizada exitosamente' });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async actualizarPersonal(req, res) {
    try {
      const { token } = req.params;
      const {
        fortalezas, aspectos_mejorar, competencias_laborales,
        conocimiento_excel, conocimiento_powerpoint, conocimiento_word, autoevaluacion
      } = req.body;
      
      if (!fortalezas || !aspectos_mejorar || !competencias_laborales ||
          !conocimiento_excel || !conocimiento_powerpoint || !conocimiento_word || !autoevaluacion) {
        return res.status(400).json({ error: 'Todos los campos son requeridos' });
      }
      
      const query = `
        UPDATE hyd_candidatos 
        SET 
          fortalezas = ?, aspectos_mejorar = ?, competencias_laborales = ?,
          conocimiento_excel = ?, conocimiento_powerpoint = ?, conocimiento_word = ?, autoevaluacion = ?,
          formulario_personal_completado = TRUE,
          fecha_completado_personal = NOW(),
          updated_at = NOW()
        WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()
      `;
      
      global.db.query(query, [
        fortalezas, aspectos_mejorar, competencias_laborales,
        conocimiento_excel, conocimiento_powerpoint, conocimiento_word, autoevaluacion,
        token
      ], (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        if (results.affectedRows === 0) {
          return res.status(404).json({ error: 'Token inválido o expirado' });
        }
        
        res.json({ message: 'Información personal actualizada exitosamente' });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async actualizarConsentimiento(req, res) {
    try {
      const { token } = req.params;
      const { ciudad_consentimiento, dia_consentimiento, mes_consentimiento, ano_consentimiento } = req.body;
      
      if (!ciudad_consentimiento || !dia_consentimiento || !mes_consentimiento || !ano_consentimiento) {
        return res.status(400).json({ error: 'Todos los campos son requeridos' });
      }
      
      const query = `
        UPDATE hyd_candidatos 
        SET 
          ciudad_consentimiento = ?, dia_consentimiento = ?, mes_consentimiento = ?, ano_consentimiento = ?,
          consentimiento_aceptado = TRUE,
          formulario_consentimiento_completado = TRUE,
          fecha_completado_consentimiento = NOW(),
          estado = 'formularios_completados',
          updated_at = NOW()
        WHERE token_acceso = ? AND fecha_vencimiento_token > NOW()
      `;
      
      global.db.query(query, [ciudad_consentimiento, dia_consentimiento, mes_consentimiento, ano_consentimiento, token], async (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }
        
        if (results.affectedRows === 0) {
          return res.status(404).json({ error: 'Token inválido o expirado' });
        }
        
        const candidatoQuery = 'SELECT * FROM hyd_candidatos WHERE token_acceso = ?';
        global.db.query(candidatoQuery, [token], async (candidatoErr, candidatoResults) => {
          if (!candidatoErr && candidatoResults.length > 0) {
            await emailService.enviarNotificacionCompletado(candidatoResults[0]);
          }
        });
        
        res.json({ message: 'Consentimiento registrado y proceso completado exitosamente' });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async crearCandidato(req, res) {
    try {
      const {
        primer_nombre, primer_apellido, email_personal, numero_celular,
        nacionalidad, tipo_documento, numero_documento, cliente, cargo,
        oleada, ciudad, fecha_citacion_entrevista, fuente_reclutamiento,
        observaciones_llamada, observaciones_generales, estado
      } = req.body;

      if (!primer_nombre || !primer_apellido || !numero_celular || !cliente || !cargo) {
        return res.status(400).json({ error: 'Todos los campos requeridos deben completarse' });
      }

      // Validación condicional del número de documento
      // Si el estado es 'contacto_exitoso', el número de documento es obligatorio
      if (estado === 'contacto_exitoso' && !numero_documento) {
        return res.status(400).json({ error: 'El número de identificación es requerido cuando el estado es "contacto exitoso"' });
      }

      // Verificar duplicados (email y cédula)
      const checkDuplicatesQuery = `
        SELECT id, email_personal, numero_documento 
        FROM hyd_candidatos 
        WHERE (email_personal = ? AND email_personal IS NOT NULL AND email_personal != '') 
           OR (numero_documento = ? AND numero_documento IS NOT NULL AND numero_documento != '')
      `;
      
      global.db.query(checkDuplicatesQuery, [email_personal || '', numero_documento || ''], (checkErr, checkResults) => {
        if (checkErr) {
          return res.status(500).json({ error: 'Error verificando duplicados' });
        }
        
        if (checkResults.length > 0) {
          const existingCandidate = checkResults[0];
          if (existingCandidate.email_personal === email_personal && email_personal) {
            return res.status(400).json({ error: 'Ya existe un candidato con este email' });
          }
          if (existingCandidate.numero_documento === numero_documento && numero_documento) {
            return res.status(400).json({ error: 'Ya existe un candidato con esta cédula' });
          }
        }

        // Generar token único
        const token = uuidv4();
        const fechaVencimiento = new Date();
        fechaVencimiento.setDate(fechaVencimiento.getDate() + 30); // 30 días

        // Asignar candidato al reclutador actual
        const reclutadorId = req.usuario.id;
        
        const query = `
          INSERT INTO hyd_candidatos (
            primer_nombre, primer_apellido, email_personal, numero_celular,
            nacionalidad, tipo_documento, numero_documento, cliente, cargo,
            oleada, ciudad, fecha_citacion_entrevista, fuente_reclutamiento,
            observaciones_llamada, observaciones_generales, token_acceso, fecha_vencimiento_token,
            estado, reclutador_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `;

        console.log('Creando candidato para reclutador ID:', reclutadorId);

        global.db.query(query, [
          primer_nombre, primer_apellido, email_personal || `temp_${Date.now()}@noviembrehidra.com`, numero_celular,
          nacionalidad, tipo_documento, numero_documento || null, cliente, cargo,
          oleada || null, ciudad || null, fecha_citacion_entrevista || null,
          fuente_reclutamiento || null, observaciones_llamada || null, observaciones_generales || null,
          token, fechaVencimiento, estado || 'nuevo', reclutadorId
        ], (err, results) => {
          if (err) {
            console.error('Error creando candidato:', err);
            return res.status(500).json({ error: 'Error creando candidato' });
          }

          res.status(201).json({
            message: 'Candidato creado exitosamente',
            candidato: {
              id: results.insertId,
              primer_nombre,
              primer_apellido,
              email_personal,
              cliente,
              cargo,
              token_acceso: token,
              estado: estado || 'nuevo'
            }
          });
        });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async editarCandidato(req, res) {
    try {
      const { candidatoId } = req.params;
      const reclutadorId = req.usuario.id;
      
      const {
        primer_nombre, primer_apellido, email_personal, numero_celular,
        nacionalidad, tipo_documento, numero_documento, cliente, cargo,
        oleada, ciudad, fecha_citacion_entrevista, fuente_reclutamiento,
        observaciones_llamada, observaciones_generales, estado
      } = req.body;

      if (!primer_nombre || !primer_apellido || !numero_celular || !cliente || !cargo) {
        return res.status(400).json({ error: 'Todos los campos requeridos deben completarse' });
      }

      // Validar estado si se proporciona
      if (estado && !CandidatoModel.getEstadosValidos().includes(estado)) {
        return res.status(400).json({ error: 'Estado inválido' });
      }

      // Verificar que el candidato pertenece al reclutador
      const checkOwnershipQuery = 'SELECT id FROM hyd_candidatos WHERE id = ? AND reclutador_id = ?';
      
      global.db.query(checkOwnershipQuery, [candidatoId, reclutadorId], (ownerErr, ownerResults) => {
        if (ownerErr) {
          return res.status(500).json({ error: 'Error verificando pertenencia' });
        }
        
        if (ownerResults.length === 0) {
          return res.status(404).json({ error: 'Candidato no encontrado o no tienes acceso a este candidato' });
        }

        // Verificar duplicados (excluyendo el candidato actual)
        const checkDuplicatesQuery = `
          SELECT id, email_personal, numero_documento 
          FROM hyd_candidatos 
          WHERE id != ? AND (
            (email_personal = ? AND email_personal IS NOT NULL AND email_personal != '') 
            OR (numero_documento = ? AND numero_documento IS NOT NULL AND numero_documento != '')
          )
        `;
        
        global.db.query(checkDuplicatesQuery, [candidatoId, email_personal || '', numero_documento || ''], (checkErr, checkResults) => {
          if (checkErr) {
            return res.status(500).json({ error: 'Error verificando duplicados' });
          }
          
          if (checkResults.length > 0) {
            const existingCandidate = checkResults[0];
            if (existingCandidate.email_personal === email_personal && email_personal) {
              return res.status(400).json({ error: 'Ya existe un candidato con este email' });
            }
            if (existingCandidate.numero_documento === numero_documento && numero_documento) {
              return res.status(400).json({ error: 'Ya existe un candidato con esta cédula' });
            }
          }

          // Actualizar candidato
          let query, queryParams;
          
          if (estado !== undefined && estado !== null && estado !== '') {
            // Si se proporciona estado, incluirlo en la actualización
            query = `
              UPDATE hyd_candidatos 
              SET 
                primer_nombre = ?, primer_apellido = ?, email_personal = ?, numero_celular = ?,
                nacionalidad = ?, tipo_documento = ?, numero_documento = ?, cliente = ?, cargo = ?,
                oleada = ?, ciudad = ?, fecha_citacion_entrevista = ?, fuente_reclutamiento = ?,
                observaciones_llamada = ?, observaciones_generales = ?, estado = ?, updated_at = NOW()
              WHERE id = ? AND reclutador_id = ?
            `;
            
            queryParams = [
              primer_nombre, primer_apellido, email_personal || `temp_${Date.now()}@noviembrehidra.com`, numero_celular,
              nacionalidad, tipo_documento, numero_documento || null, cliente, cargo,
              oleada || null, ciudad || null, fecha_citacion_entrevista || null,
              fuente_reclutamiento || null, observaciones_llamada || null, observaciones_generales || null,
              estado, candidatoId, reclutadorId
            ];
          } else {
            // Si no se proporciona estado, no actualizarlo (mantener el estado actual)
            query = `
              UPDATE hyd_candidatos 
              SET 
                primer_nombre = ?, primer_apellido = ?, email_personal = ?, numero_celular = ?,
                nacionalidad = ?, tipo_documento = ?, numero_documento = ?, cliente = ?, cargo = ?,
                oleada = ?, ciudad = ?, fecha_citacion_entrevista = ?, fuente_reclutamiento = ?,
                observaciones_llamada = ?, observaciones_generales = ?, updated_at = NOW()
              WHERE id = ? AND reclutador_id = ?
            `;
            
            queryParams = [
              primer_nombre, primer_apellido, email_personal || `temp_${Date.now()}@noviembrehidra.com`, numero_celular,
              nacionalidad, tipo_documento, numero_documento || null, cliente, cargo,
              oleada || null, ciudad || null, fecha_citacion_entrevista || null,
              fuente_reclutamiento || null, observaciones_llamada || null, observaciones_generales || null,
              candidatoId, reclutadorId
            ];
          }

          global.db.query(query, queryParams, (err, results) => {
            if (err) {
              console.error('Error actualizando candidato:', err);
              return res.status(500).json({ error: 'Error actualizando candidato' });
            }

            if (results.affectedRows === 0) {
              return res.status(404).json({ error: 'Candidato no encontrado o no tienes acceso' });
            }

            res.json({
              message: 'Candidato actualizado exitosamente',
              candidatoId: candidatoId
            });
          });
        });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async actualizarFechaEntrevista(req, res) {
    try {
      const { candidatoId } = req.params;
      const { fecha_citacion_entrevista } = req.body;
      const reclutadorId = req.usuario.id;

      const query = `
        UPDATE hyd_candidatos 
        SET fecha_citacion_entrevista = ?, updated_at = NOW()
        WHERE id = ? AND reclutador_id = ?
      `;

      global.db.query(query, [fecha_citacion_entrevista || null, candidatoId, reclutadorId], (err, results) => {
        if (err) {
          console.error('Error actualizando fecha de entrevista:', err);
          return res.status(500).json({ error: 'Error actualizando fecha de entrevista' });
        }

        if (results.affectedRows === 0) {
          return res.status(404).json({ error: 'Candidato no encontrado o no tienes acceso' });
        }

        res.json({
          message: 'Fecha de entrevista actualizada exitosamente'
        });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async cambiarEstado(req, res) {
    try {
      const { candidatoId } = req.params;
      const { estado } = req.body;
      const reclutadorId = req.usuario.id;

      if (!estado) {
        return res.status(400).json({ error: 'Estado es requerido' });
      }

      const estadoLimpio = estado.trim();

      // Validar estado
      if (!CandidatoModel.getEstadosValidos().includes(estadoLimpio)) {
        return res.status(400).json({ 
          error: 'Estado inválido',
          estadosValidos: CandidatoModel.getEstadosValidos()
        });
      }

      const query = `
        UPDATE hyd_candidatos 
        SET estado = ?, updated_at = NOW()
        WHERE id = ? AND reclutador_id = ?
      `;

      global.db.query(query, [estadoLimpio, candidatoId, reclutadorId], (err, results) => {
        if (err) {
          console.error('Error cambiando estado:', err);
          return res.status(500).json({ error: 'Error cambiando estado del candidato' });
        }

        if (results.affectedRows === 0) {
          return res.status(404).json({ error: 'Candidato no encontrado o no tienes acceso' });
        }

        res.json({
          message: 'Estado actualizado exitosamente',
          candidatoId: candidatoId,
          nuevoEstado: estadoLimpio
        });
      });
    } catch (error) {
      console.error('Error en cambiarEstado:', error);
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new CandidatoController();