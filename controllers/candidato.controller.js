const CandidatoModel = require('../models/candidato.model');
const emailService = require('../services/email.service');
const candidatoFormularioService = require('../services/candidatoFormulario.service');
const firmacloudDispatchService = require('../services/firmacloudDispatchService');
const { v4: uuidv4 } = require('uuid');
const { separarNombreCompleto } = require('../utils/nombreCompleto.util');
const fs = require('fs');
const path = require('path');

const ANTECEDENTES_DIR = path.join(__dirname, '..', 'uploads', 'antecedentes');
const EXTENSIONES_CONTENT_TYPE = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png'
};

// Una entrada por cada una de las 4 verificaciones de antecedentes (ADRES/POL/COMP/PROCU) —
// cada una tiene su propio documento independiente (a diferencia del diseño original de esta
// sesión, que compartía un solo documento entre las 4). `campoArchivo` es el nombre del campo
// multipart que usa multer (`uploadAntecedentes.fields(...)` en las rutas).
const CAMPOS_ANTECEDENTES = [
  { key: 'adres', campoEstado: 'antecedentes_adres', campoNovedad: 'antecedentes_adres_novedad', campoDocumento: 'antecedentes_adres_documento', campoDocumentoNombre: 'antecedentes_adres_documento_nombre', campoArchivo: 'documento_adres' },
  { key: 'pol', campoEstado: 'antecedentes_pol', campoNovedad: 'antecedentes_pol_novedad', campoDocumento: 'antecedentes_pol_documento', campoDocumentoNombre: 'antecedentes_pol_documento_nombre', campoArchivo: 'documento_pol' },
  { key: 'comp', campoEstado: 'antecedentes_comp', campoNovedad: 'antecedentes_comp_novedad', campoDocumento: 'antecedentes_comp_documento', campoDocumentoNombre: 'antecedentes_comp_documento_nombre', campoArchivo: 'documento_comp' },
  { key: 'procu', campoEstado: 'antecedentes_procu', campoNovedad: 'antecedentes_procu_novedad', campoDocumento: 'antecedentes_procu_documento', campoDocumentoNombre: 'antecedentes_procu_documento_nombre', campoArchivo: 'documento_procu' }
];

// Traduce los errores de la capa de servicio del formulario (HttpError con status propio)
// a la respuesta HTTP; cualquier otro error (DB, inesperado) se sanitiza para no filtrar
// detalles internos, igual que ya hacía el resto de endpoints de este controller.
function manejarErrorFormulario(res, error) {
  if (error.status) {
    return res.status(error.status).json({ error: error.message });
  }
  res.status(500).json({ error: 'Error de base de datos' });
}

// Chequeo de dueño compartido por getEstadoFirma/descargarDocumentoFirmado — mismo criterio que
// getPerfilCompleto (selección/administrador ven cualquier candidato, el resto solo los suyos),
// pero SIN alias de tabla porque obtenerCandidatoParaFirma hace un SELECT liviano directo sobre
// hyd_candidatos (no el JOIN con alias `c` de obtenerCandidatoConFormulario). Función suelta (no
// método de clase) a propósito: los handlers se registran sin `.bind(candidatoController)` en la
// mayoría de rutas, así que `this` no está disponible dentro de ellos.
function construirWhereDueno(req) {
  const { candidatoId } = req.params;
  if (req.usuario.rol === 'seleccion' || req.usuario.rol === 'administrador') {
    return { whereClause: 'id = ?', params: [candidatoId] };
  }
  return { whereClause: 'id = ? AND reclutador_id = ?', params: [candidatoId, req.usuario.id] };
}

class CandidatoController {
  
  async validarToken(req, res) {
    try {
      const { token } = req.params;

      const candidato = await candidatoFormularioService.obtenerFormularioPorToken(token);
      const progreso = CandidatoModel.calcularProgreso(candidato);

      res.json({
        candidato: {
          ...candidato,
          progreso_formularios: progreso
        }
      });
    } catch (error) {
      manejarErrorFormulario(res, error);
    }
  }

  async getCandidatosPorEstado(req, res) {
    try {
      const { estado } = req.params;

      if (!CandidatoModel.getEstadosValidos().includes(estado)) {
        return res.status(400).json({ error: 'Estado inválido' });
      }

      // Paginación: 20 candidatos por página (fijo), ?page=N para navegar (2026-08-19,
      // antes traía todos los candidatos del estado de una sola vez).
      const limit = 20;
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const offset = (page - 1) * limit;

      // Búsqueda server-side (2026-08-19): antes del paginado, el buscador filtraba en el
      // frontend sobre TODOS los candidatos del estado ya cargados; con paginado el frontend
      // solo tiene los 20 de la página actual, así que la búsqueda se resuelve aquí para
      // seguir cubriendo el estado completo, no solo la página visible.
      const search = (req.query.search || '').trim();
      // Escapa \, % y _ (comodines/escape de LIKE) para que una búsqueda literal (ej. "50%")
      // no dispare coincidencias no intencionadas.
      const searchParam = search ? `%${search.replace(/[\\%_]/g, '\\$&')}%` : null;
      const filtroBusqueda = search
        ? ' AND (primer_nombre LIKE ? OR primer_apellido LIKE ? OR email_personal LIKE ? OR numero_documento LIKE ? OR numero_celular LIKE ? OR cliente LIKE ? OR cargo LIKE ?)'
        : '';
      const parametrosBusqueda = search ? Array(7).fill(searchParam) : [];

      const columnas = `
        id, primer_nombre, primer_apellido, email_personal, numero_celular,
        cliente, cargo, fecha_citacion_entrevista, estado, reclutador_id,
        formulario_hoja_vida_completado, formulario_datos_basicos_completado,
        formulario_estudios_completado, formulario_experiencia_completado,
        formulario_personal_completado, formulario_consentimiento_completado,
        updated_at
      `;

      // Administradores y usuarios de selección ven todos los candidatos
      // Reclutadores solo ven sus candidatos
      let countQuery, countParams, dataQuery, dataParams;

      if (req.usuario.rol === 'administrador' || req.usuario.rol === 'seleccion') {
        countQuery = `SELECT COUNT(*) as total FROM hyd_candidatos WHERE estado = ?${filtroBusqueda}`;
        countParams = [estado, ...parametrosBusqueda];
        dataQuery = `
          SELECT ${columnas}
          FROM hyd_candidatos
          WHERE estado = ?${filtroBusqueda}
          ORDER BY updated_at DESC, id DESC
          LIMIT ? OFFSET ?
        `;
        dataParams = [estado, ...parametrosBusqueda, limit, offset];
      } else {
        // Reclutadores solo ven sus candidatos
        const userId = req.usuario.id;
        countQuery = `SELECT COUNT(*) as total FROM hyd_candidatos WHERE estado = ? AND reclutador_id = ?${filtroBusqueda}`;
        countParams = [estado, userId, ...parametrosBusqueda];
        dataQuery = `
          SELECT ${columnas}
          FROM hyd_candidatos
          WHERE estado = ? AND reclutador_id = ?${filtroBusqueda}
          ORDER BY updated_at DESC, id DESC
          LIMIT ? OFFSET ?
        `;
        dataParams = [estado, userId, ...parametrosBusqueda, limit, offset];
      }

      console.log('Obteniendo candidatos para usuario:', req.usuario.email, 'rol:', req.usuario.rol, 'estado:', estado, 'page:', page, 'search:', search || '(ninguna)');

      global.db.query(countQuery, countParams, (countErr, countResults) => {
        if (countErr) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }

        const total = countResults[0].total;

        global.db.query(dataQuery, dataParams, (err, results) => {
          if (err) {
            return res.status(500).json({ error: 'Error de base de datos' });
          }

          const candidatosConProgreso = results.map(candidato => ({
            ...candidato,
            progreso_formularios: CandidatoModel.calcularProgreso(candidato)
          }));

          res.json({
            candidatos: candidatosConProgreso,
            pagination: {
              page,
              limit,
              total,
              totalPages: Math.max(Math.ceil(total / limit), 1)
            }
          });
        });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getResumenEstados(req, res) {
    try {
      let query, queryParams;
      
      // Administradores y usuarios de selección ven todos los candidatos
      // Reclutadores solo ven sus candidatos
      if (req.usuario.rol === 'administrador' || req.usuario.rol === 'seleccion') {
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
      let whereClause, params;

      if (req.usuario.rol === 'seleccion' || req.usuario.rol === 'administrador') {
        whereClause = 'c.id = ?';
        params = [candidatoId];
      } else {
        const reclutadorId = req.usuario.id;
        whereClause = 'c.id = ? AND c.reclutador_id = ?';
        params = [candidatoId, reclutadorId];
      }

      const candidato = await candidatoFormularioService.obtenerPerfilConFormulario(whereClause, params);
      const progreso = CandidatoModel.calcularProgreso(candidato);

      res.json({
        candidato: {
          ...candidato,
          progreso_formularios: progreso
        }
      });
    } catch (error) {
      manejarErrorFormulario(res, error);
    }
  }

  // Estado de la firma en FirmaCloud (enviado/pending/viewed/signed) — el panel de Hydra no
  // guarda copia de los documentos, siempre consulta en vivo. `{ enviado: false }` si el
  // candidato todavía no llegó al paso de Consentimiento (nunca se llamó a
  // firmacloudDispatchService.enviarAFirmaCloud para él).
  async getEstadoFirma(req, res) {
    try {
      const { whereClause, params } = construirWhereDueno(req);
      const estado = await firmacloudDispatchService.consultarEstadoFirma(whereClause, params);
      res.json(estado);
    } catch (error) {
      manejarErrorFormulario(res, error);
    }
  }

  // Descarga (proxy) la hoja de vida o el tratamiento de datos ya firmados —
  // GET /candidatos/firma-documento/:candidatoId/:tipo, tipo = 'cv' | 'tratamiento'.
  async descargarDocumentoFirmado(req, res) {
    try {
      const { tipo } = req.params;
      const { whereClause, params } = construirWhereDueno(req);
      const { buffer, contentType, filename } = await firmacloudDispatchService.descargarDocumento(whereClause, params, tipo);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.send(buffer);
    } catch (error) {
      manejarErrorFormulario(res, error);
    }
  }

  // Registra el resultado de las 4 verificaciones de antecedentes (ADRES/POL/COMP/PROCU, bloque
  // "ANTECEDENTES" del Excel oficial) y, opcionalmente, el documento de soporte de cada una (PDF
  // o imagen, campos "documento_adres"/"documento_pol"/"documento_comp"/"documento_procu" del
  // multipart — cada verificación tiene su propio archivo, no uno compartido) - solo aplica una
  // vez el candidato asistió a la entrevista (validado en el frontend, ver PerfilCandidato.jsx).
  // Cada verificación se guarda de forma independiente y auto-guardada apenas el reclutador
  // decide algo (2026-08-21): elegir "Aprobado" guarda el estado solo; elegir "No aprobado" exige
  // el texto de la novedad (campo "{key}_novedad") explicando por qué; soltar/seleccionar un
  // archivo lo guarda por separado, sin tocar el estado. `verificarPermiso('editar_candidatos')`
  // ya cubre reclutador/seleccion/admin; `construirWhereDueno` limita reclutador a sus propios
  // candidatos.
  async actualizarAntecedentes(req, res) {
    const archivosSubidos = req.files || {};
    const archivosSubidosFlat = Object.values(archivosSubidos).flat();
    const borrarArchivosSubidos = () => archivosSubidosFlat.forEach((f) => fs.unlink(f.path, () => {}));

    try {
      const sets = ['updated_at = NOW()'];
      const setParams = [];

      for (const { key, campoEstado, campoNovedad, campoDocumento, campoDocumentoNombre, campoArchivo } of CAMPOS_ANTECEDENTES) {
        const estado = req.body[key];
        const novedad = req.body[`${key}_novedad`];
        const archivo = archivosSubidos[campoArchivo]?.[0];

        if (estado !== undefined && estado !== '') {
          if (!['aprobado', 'no_aprobado'].includes(estado)) {
            borrarArchivosSubidos();
            return res.status(400).json({ error: `Valor inválido para "${key}": debe ser "aprobado" o "no_aprobado"` });
          }
          if (estado === 'no_aprobado' && !(novedad || '').trim()) {
            borrarArchivosSubidos();
            return res.status(400).json({ error: `Debes escribir la novedad de "${key}" para marcarlo como no aprobado` });
          }
          sets.push(`${campoEstado} = ?`, `${campoNovedad} = ?`);
          setParams.push(estado, estado === 'no_aprobado' ? novedad.trim() : null);
        }

        if (archivo) {
          sets.push(`${campoDocumento} = ?`, `${campoDocumentoNombre} = ?`);
          setParams.push(archivo.filename, archivo.originalname);
        }
      }

      if (setParams.length === 0) {
        return res.status(400).json({ error: 'No se envió ningún cambio' });
      }
      sets.push('fecha_antecedentes = NOW()');

      const { whereClause, params } = construirWhereDueno(req);

      const finalizarUpdate = (documentosAnteriores) => {
        const query = `UPDATE hyd_candidatos SET ${sets.join(', ')} WHERE ${whereClause}`;
        global.db.query(query, [...setParams, ...params], (err, results) => {
          if (err) {
            console.error('Error actualizando antecedentes:', err);
            borrarArchivosSubidos();
            return res.status(500).json({ error: 'Error actualizando antecedentes' });
          }
          if (results.affectedRows === 0) {
            borrarArchivosSubidos();
            return res.status(404).json({ error: 'Candidato no encontrado o no tienes acceso' });
          }
          // Borra del disco solo los documentos que efectivamente se reemplazaron en esta
          // petición, después de confirmar el UPDATE, para no dejar huérfano un archivo previo
          // si algo falla antes.
          CAMPOS_ANTECEDENTES.forEach(({ campoArchivo, campoDocumento }) => {
            const anterior = documentosAnteriores?.[campoDocumento];
            if (archivosSubidos[campoArchivo]?.[0] && anterior) {
              fs.unlink(path.join(ANTECEDENTES_DIR, anterior), () => {});
            }
          });
          res.json({ message: 'Antecedentes actualizados correctamente' });
        });
      };

      if (archivosSubidosFlat.length > 0) {
        const columnasDocumento = CAMPOS_ANTECEDENTES.map((c) => c.campoDocumento).join(', ');
        global.db.query(`SELECT ${columnasDocumento} FROM hyd_candidatos WHERE ${whereClause}`, params, (err, rows) => {
          if (err) {
            console.error('Error consultando documentos anteriores de antecedentes:', err);
            borrarArchivosSubidos();
            return res.status(500).json({ error: 'Error de base de datos' });
          }
          finalizarUpdate(rows[0] || null);
        });
      } else {
        finalizarUpdate(null);
      }
    } catch (error) {
      borrarArchivosSubidos();
      res.status(500).json({ error: error.message });
    }
  }

  // Descarga (proxy) el documento de antecedentes de una verificación puntual — GET
  // /candidato/antecedentes/:candidatoId/documento/:tipo, tipo = 'adres'|'pol'|'comp'|'procu'. El
  // archivo vive en disco (uploads/antecedentes/), nunca se expone una ruta pública directa a esa
  // carpeta.
  async descargarDocumentoAntecedentes(req, res) {
    try {
      const { tipo } = req.params;
      const campo = CAMPOS_ANTECEDENTES.find((c) => c.key === tipo);
      if (!campo) {
        return res.status(400).json({ error: 'Tipo de antecedente inválido' });
      }

      const { whereClause, params } = construirWhereDueno(req);
      global.db.query(
        `SELECT ${campo.campoDocumento} AS documento, ${campo.campoDocumentoNombre} AS documento_nombre FROM hyd_candidatos WHERE ${whereClause}`,
        params,
        (err, rows) => {
          if (err) {
            console.error('Error consultando documento de antecedentes:', err);
            return res.status(500).json({ error: 'Error de base de datos' });
          }
          if (rows.length === 0) {
            return res.status(404).json({ error: 'Candidato no encontrado o no tienes acceso' });
          }
          const { documento, documento_nombre } = rows[0];
          if (!documento) {
            return res.status(404).json({ error: 'Este candidato no tiene documento cargado para esta verificación' });
          }

          const filePath = path.join(ANTECEDENTES_DIR, documento);
          const contentType = EXTENSIONES_CONTENT_TYPE[path.extname(documento).toLowerCase()] || 'application/octet-stream';

          fs.readFile(filePath, (readErr, buffer) => {
            if (readErr) {
              console.error('Error leyendo documento de antecedentes:', readErr);
              return res.status(404).json({ error: 'No se pudo encontrar el archivo' });
            }
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `inline; filename="${documento_nombre || documento}"`);
            res.send(buffer);
          });
        }
      );
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getEstadosEnTiempo(req, res) {
    try {
      let query, queryParams;
      
      if (req.usuario.rol === 'administrador' || req.usuario.rol === 'seleccion') {
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
      
      if (req.usuario.rol === 'administrador' || req.usuario.rol === 'seleccion') {
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
      
      if (req.usuario.rol === 'administrador' || req.usuario.rol === 'seleccion') {
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
      
      if (req.usuario.rol === 'administrador' || req.usuario.rol === 'seleccion') {
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
      const rol = req.usuario.rol;
      const reclutadorId = req.usuario.id;

      // Admins y seleccion pueden reenviar a cualquier candidato; reclutadores solo a los suyos
      let selectQuery, selectParams;
      if (rol === 'administrador' || rol === 'seleccion') {
        selectQuery = 'SELECT * FROM hyd_candidatos WHERE id = ?';
        selectParams = [candidatoId];
      } else {
        selectQuery = 'SELECT * FROM hyd_candidatos WHERE id = ? AND reclutador_id = ?';
        selectParams = [candidatoId, reclutadorId];
      }

      global.db.query(selectQuery, selectParams, async (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }

        if (results.length === 0) {
          return res.status(404).json({ error: 'Candidato no encontrado o no tienes acceso' });
        }

        const candidato = results[0];

        if (!candidato.email_personal || candidato.email_personal.includes('@noviembrehidra.com')) {
          return res.status(400).json({ error: 'El candidato no tiene un email válido registrado' });
        }

        // Solo avanzar a 'formularios_enviados' si el candidato aún está en 'contacto_exitoso'.
        // Si ya está en un estado más avanzado, reenviar el email no debe retroceder su progreso.
        const nuevoToken = uuidv4();
        const nuevaFechaVencimiento = new Date();
        nuevaFechaVencimiento.setDate(nuevaFechaVencimiento.getDate() + 30);

        // Al reenviar: nuevo token (invalida el link anterior), desbloquea formularios,
        // y solo avanza el estado si venía de contacto_exitoso.
        const nuevoEstado = candidato.estado === 'contacto_exitoso' ? 'formularios_enviados' : candidato.estado;
        const esAdmin = rol === 'administrador' || rol === 'seleccion';

        const updateQuery = esAdmin
          ? `UPDATE hyd_candidatos SET token_acceso = ?, fecha_vencimiento_token = ?, formulario_consentimiento_completado = FALSE, estado = ?, updated_at = NOW() WHERE id = ?`
          : `UPDATE hyd_candidatos SET token_acceso = ?, fecha_vencimiento_token = ?, formulario_consentimiento_completado = FALSE, estado = ?, updated_at = NOW() WHERE id = ? AND reclutador_id = ?`;
        const updateParams = esAdmin
          ? [nuevoToken, nuevaFechaVencimiento, nuevoEstado, candidatoId]
          : [nuevoToken, nuevaFechaVencimiento, nuevoEstado, candidatoId, reclutadorId];

        global.db.query(updateQuery, updateParams, async (updateErr) => {
          if (updateErr) return res.status(500).json({ error: 'Error actualizando estado' });
          const emailResult = await emailService.enviarFormularios({ ...candidato, token_acceso: nuevoToken });
          res.json({ message: 'Email reenviado exitosamente', emailStatus: emailResult });
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

  // Los 6 endpoints de abajo (uno por paso del formulario) son delgados a propósito: toda
  // la validación y el acceso a las tablas hyd_candidato_* vive en
  // services/candidatoFormulario.service.js + repositories/candidatoFormulario.repository.js
  // (piloto de arquitectura en capas, ver claude/plan.md). El resto de este controller
  // (CRUD de "Nuevo/Editar Candidato" sobre hyd_candidatos) se queda como estaba.

  async actualizarHojaVida(req, res) {
    try {
      const { token } = req.params;
      const resultado = await candidatoFormularioService.actualizarHojaVida(token, req.body);
      res.json(resultado);
    } catch (error) {
      manejarErrorFormulario(res, error);
    }
  }

  async actualizarDatosBasicos(req, res) {
    try {
      const { token } = req.params;
      const resultado = await candidatoFormularioService.actualizarDatosBasicos(token, req.body);
      res.json(resultado);
    } catch (error) {
      manejarErrorFormulario(res, error);
    }
  }

  async actualizarEstudios(req, res) {
    try {
      const { token } = req.params;
      const resultado = await candidatoFormularioService.actualizarEstudios(token, req.body);
      res.json(resultado);
    } catch (error) {
      manejarErrorFormulario(res, error);
    }
  }

  async actualizarExperiencia(req, res) {
    try {
      const { token } = req.params;
      const resultado = await candidatoFormularioService.actualizarExperiencia(token, req.body);
      res.json(resultado);
    } catch (error) {
      manejarErrorFormulario(res, error);
    }
  }

  async actualizarPersonal(req, res) {
    try {
      const { token } = req.params;
      const resultado = await candidatoFormularioService.actualizarPersonal(token, req.body);
      res.json(resultado);
    } catch (error) {
      manejarErrorFormulario(res, error);
    }
  }

  async actualizarConsentimiento(req, res) {
    try {
      const { token } = req.params;
      const resultado = await candidatoFormularioService.actualizarConsentimiento(token, req.body);
      res.json(resultado);
    } catch (error) {
      manejarErrorFormulario(res, error);
    }
  }

  async crearCandidato(req, res) {
    try {
      const {
        nombre_completo, email_personal, numero_celular,
        tipo_documento, numero_documento, edad, cliente, cargo,
        ciudad, fecha_citacion_entrevista, fuente_reclutamiento,
        contacto_llamada, contacto_whatsapp,
        observaciones_llamada, observaciones_generales, estado
      } = req.body;

      if (!nombre_completo || !numero_celular || !cliente || !cargo || !tipo_documento) {
        return res.status(400).json({ error: 'Todos los campos requeridos deben completarse' });
      }

      // El campo "Nombre Completo" reemplaza a "Primer Nombre"/"Primer Apellido" (2026-08-18)
      // — se separa aquí para seguir guardando los 4 campos de siempre en hyd_candidatos.
      const nombreSeparado = separarNombreCompleto(nombre_completo);
      if (!nombreSeparado) {
        return res.status(400).json({ error: 'El nombre completo debe incluir al menos nombre y apellido' });
      }
      const { primer_nombre, segundo_nombre, primer_apellido, segundo_apellido } = nombreSeparado;

      // El campo Nacionalidad se eliminó del formulario (2026-08-18) — se deriva
      // de Tipo de Documento, que ahora es la única fuente de esa información.
      const nacionalidad = tipo_documento === 'CC' ? 'Colombiano' : 'Venezolano';

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
            primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, email_personal, numero_celular,
            nacionalidad, tipo_documento, numero_documento, edad, cliente, cargo,
            ciudad, fecha_citacion_entrevista, fuente_reclutamiento,
            contacto_llamada, contacto_whatsapp,
            observaciones_llamada, observaciones_generales, token_acceso, fecha_vencimiento_token,
            estado, reclutador_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `;

        console.log('Creando candidato para reclutador ID:', reclutadorId);

        global.db.query(query, [
          primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, email_personal || `temp_${Date.now()}@noviembrehidra.com`, numero_celular,
          nacionalidad, tipo_documento, numero_documento || null, edad || null, cliente, cargo,
          ciudad || null, fecha_citacion_entrevista || null,
          fuente_reclutamiento || null, contacto_llamada || null, contacto_whatsapp || null,
          observaciones_llamada || null, observaciones_generales || null,
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
              segundo_nombre,
              primer_apellido,
              segundo_apellido,
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
        nombre_completo, email_personal, numero_celular,
        tipo_documento, numero_documento, cliente, cargo,
        ciudad, fuente_reclutamiento,
        observaciones_llamada, observaciones_generales, estado
      } = req.body;

      if (!nombre_completo || !numero_celular || !cliente || !cargo || !tipo_documento) {
        return res.status(400).json({ error: 'Todos los campos requeridos deben completarse' });
      }

      // El campo "Nombre Completo" reemplaza a "Primer Nombre"/"Primer Apellido" (2026-08-18)
      // — se separa aquí para seguir guardando los 4 campos de siempre en hyd_candidatos.
      const nombreSeparado = separarNombreCompleto(nombre_completo);
      if (!nombreSeparado) {
        return res.status(400).json({ error: 'El nombre completo debe incluir al menos nombre y apellido' });
      }
      const { primer_nombre, segundo_nombre, primer_apellido, segundo_apellido } = nombreSeparado;

      // El campo Nacionalidad se eliminó del formulario (2026-08-18) — se deriva
      // de Tipo de Documento, que ahora es la única fuente de esa información.
      const nacionalidad = tipo_documento === 'CC' ? 'Colombiano' : 'Venezolano';

      // Validar estado si se proporciona
      if (estado && !CandidatoModel.getEstadosValidos().includes(estado)) {
        return res.status(400).json({ error: 'Estado inválido' });
      }

      // Admins y seleccion pueden editar cualquier candidato; reclutadores solo los suyos
      const rol = req.usuario.rol;
      const esAdmin = rol === 'administrador' || rol === 'seleccion';
      const checkOwnershipQuery = esAdmin
        ? 'SELECT id FROM hyd_candidatos WHERE id = ?'
        : 'SELECT id FROM hyd_candidatos WHERE id = ? AND reclutador_id = ?';
      const checkOwnershipParams = esAdmin ? [candidatoId] : [candidatoId, reclutadorId];

      global.db.query(checkOwnershipQuery, checkOwnershipParams, (ownerErr, ownerResults) => {
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
          
          // fecha_citacion_entrevista NO se toca aquí (2026-08-18) — ese campo se eliminó de
          // Nuevo/Editar Candidato y ahora es responsabilidad exclusiva de actualizarFechaEntrevista
          // (endpoint dedicado, botón "Agendar entrevista" en el perfil del candidato). Si se
          // incluyera en este UPDATE, cada edición del candidato borraría la cita ya agendada.
          if (estado !== undefined && estado !== null && estado !== '') {
            query = esAdmin
              ? `UPDATE hyd_candidatos SET primer_nombre = ?, segundo_nombre = ?, primer_apellido = ?, segundo_apellido = ?, email_personal = ?, numero_celular = ?, nacionalidad = ?, tipo_documento = ?, numero_documento = ?, cliente = ?, cargo = ?, ciudad = ?, fuente_reclutamiento = ?, observaciones_llamada = ?, observaciones_generales = ?, estado = ?, updated_at = NOW() WHERE id = ?`
              : `UPDATE hyd_candidatos SET primer_nombre = ?, segundo_nombre = ?, primer_apellido = ?, segundo_apellido = ?, email_personal = ?, numero_celular = ?, nacionalidad = ?, tipo_documento = ?, numero_documento = ?, cliente = ?, cargo = ?, ciudad = ?, fuente_reclutamiento = ?, observaciones_llamada = ?, observaciones_generales = ?, estado = ?, updated_at = NOW() WHERE id = ? AND reclutador_id = ?`;
            queryParams = esAdmin
              ? [primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, email_personal || `temp_${Date.now()}@noviembrehidra.com`, numero_celular, nacionalidad, tipo_documento, numero_documento || null, cliente, cargo, ciudad || null, fuente_reclutamiento || null, observaciones_llamada || null, observaciones_generales || null, estado, candidatoId]
              : [primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, email_personal || `temp_${Date.now()}@noviembrehidra.com`, numero_celular, nacionalidad, tipo_documento, numero_documento || null, cliente, cargo, ciudad || null, fuente_reclutamiento || null, observaciones_llamada || null, observaciones_generales || null, estado, candidatoId, reclutadorId];
          } else {
            query = esAdmin
              ? `UPDATE hyd_candidatos SET primer_nombre = ?, segundo_nombre = ?, primer_apellido = ?, segundo_apellido = ?, email_personal = ?, numero_celular = ?, nacionalidad = ?, tipo_documento = ?, numero_documento = ?, cliente = ?, cargo = ?, ciudad = ?, fuente_reclutamiento = ?, observaciones_llamada = ?, observaciones_generales = ?, updated_at = NOW() WHERE id = ?`
              : `UPDATE hyd_candidatos SET primer_nombre = ?, segundo_nombre = ?, primer_apellido = ?, segundo_apellido = ?, email_personal = ?, numero_celular = ?, nacionalidad = ?, tipo_documento = ?, numero_documento = ?, cliente = ?, cargo = ?, ciudad = ?, fuente_reclutamiento = ?, observaciones_llamada = ?, observaciones_generales = ?, updated_at = NOW() WHERE id = ? AND reclutador_id = ?`;
            queryParams = esAdmin
              ? [primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, email_personal || `temp_${Date.now()}@noviembrehidra.com`, numero_celular, nacionalidad, tipo_documento, numero_documento || null, cliente, cargo, ciudad || null, fuente_reclutamiento || null, observaciones_llamada || null, observaciones_generales || null, candidatoId]
              : [primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, email_personal || `temp_${Date.now()}@noviembrehidra.com`, numero_celular, nacionalidad, tipo_documento, numero_documento || null, cliente, cargo, ciudad || null, fuente_reclutamiento || null, observaciones_llamada || null, observaciones_generales || null, candidatoId, reclutadorId];
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

  // Único endpoint que escribe fecha_citacion_entrevista (ver nota en editarCandidato). Antes
  // solo tocaba la fecha y dejaba el cambio de estado a "citado" como una acción manual aparte
  // (botón "Marcar como Citado") — eso permitía quedar con estado='citado' sin fecha real si
  // alguien usaba ese botón sin pasar por acá (bug real encontrado 2026-08-21). Ahora, agendar
  // la fecha desde un estado temprano del embudo también avanza el estado a "citado" en la misma
  // operación, para que nunca quede desincronizado. No downgradea un estado ya más avanzado
  // (entrevistado/aprobado/etc.) si solo se está reprogramando la fecha de un candidato que ya
  // pasó por ahí.
  async actualizarFechaEntrevista(req, res) {
    try {
      const { candidatoId } = req.params;
      const { fecha_citacion_entrevista } = req.body;
      const reclutadorId = req.usuario.id;

      const query = `
        UPDATE hyd_candidatos
        SET
          fecha_citacion_entrevista = ?,
          estado = CASE WHEN estado IN ('nuevo', 'contacto_exitoso', 'formularios_completados') THEN 'citado' ELSE estado END,
          updated_at = NOW()
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

  // Alternativa a "Marcar como Citado" (actualizarFechaEntrevista): el reclutador decide NO
  // citar al candidato y deja registrado el motivo. Pasa a estado 'rechazado' (mismo bucket
  // final que ya usa el resto del embudo) en la misma operación que guarda el motivo.
  async marcarNoCitado(req, res) {
    try {
      const { candidatoId } = req.params;
      const { motivo } = req.body;
      const reclutadorId = req.usuario.id;

      const motivoLimpio = (motivo || '').trim();
      if (!motivoLimpio) {
        return res.status(400).json({ error: 'El motivo es requerido' });
      }

      const rol = req.usuario.rol;
      const esAdmin = rol === 'administrador' || rol === 'seleccion';
      const query = esAdmin
        ? `UPDATE hyd_candidatos SET estado = 'rechazado', motivo_no_citado = ?, updated_at = NOW() WHERE id = ?`
        : `UPDATE hyd_candidatos SET estado = 'rechazado', motivo_no_citado = ?, updated_at = NOW() WHERE id = ? AND reclutador_id = ?`;
      const queryParams = esAdmin
        ? [motivoLimpio, candidatoId]
        : [motivoLimpio, candidatoId, reclutadorId];

      global.db.query(query, queryParams, (err, results) => {
        if (err) {
          console.error('Error marcando no citado:', err);
          return res.status(500).json({ error: 'Error al marcar como no citado' });
        }

        if (results.affectedRows === 0) {
          return res.status(404).json({ error: 'Candidato no encontrado o no tienes acceso' });
        }

        res.json({ message: 'Candidato marcado como no citado' });
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

      const rolCambio = req.usuario.rol;
      const esAdminCambio = rolCambio === 'administrador' || rolCambio === 'seleccion';
      const query = esAdminCambio
        ? `UPDATE hyd_candidatos SET estado = ?, updated_at = NOW() WHERE id = ?`
        : `UPDATE hyd_candidatos SET estado = ?, updated_at = NOW() WHERE id = ? AND reclutador_id = ?`;
      const queryParamsCambio = esAdminCambio
        ? [estadoLimpio, candidatoId]
        : [estadoLimpio, candidatoId, reclutadorId];

      global.db.query(query, queryParamsCambio, (err, results) => {
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