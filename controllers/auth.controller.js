const UsuarioModel = require('../models/usuario.model');

class AuthController {

  async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email y contraseña son requeridos' });
      }

      if (!UsuarioModel.validarEmail(email)) {
        return res.status(400).json({ error: 'Formato de email inválido' });
      }

      const query = 'SELECT * FROM hyd_usuarios WHERE email = ? AND activo = TRUE';
      
      global.db.query(query, [email], async (err, results) => {
        if (err) {
          console.error('Error en login:', err);
          return res.status(500).json({ error: 'Error de base de datos' });
        }

        if (results.length === 0) {
          return res.status(401).json({ error: 'Credenciales incorrectas' });
        }

        const usuario = results[0];

        const passwordValido = await UsuarioModel.compararPassword(password, usuario.password_hash);
        
        if (!passwordValido) {
          return res.status(401).json({ error: 'Credenciales incorrectas' });
        }

        // Actualizar último acceso
        const updateQuery = 'UPDATE hyd_usuarios SET ultimo_acceso = NOW() WHERE id = ?';
        global.db.query(updateQuery, [usuario.id]);

        // Generar token
        const token = UsuarioModel.generarToken(usuario);

        // Sanitizar datos del usuario
        const usuarioSanitizado = UsuarioModel.sanitizarUsuario(usuario);

        res.json({
          message: 'Login exitoso',
          token,
          usuario: usuarioSanitizado
        });
      });

    } catch (error) {
      console.error('Error en login:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }

  async verificarToken(req, res) {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return res.status(401).json({ error: 'Token no proporcionado' });
      }

      const decoded = UsuarioModel.verificarToken(token);
      
      if (!decoded) {
        return res.status(401).json({ error: 'Token inválido o expirado' });
      }

      // Verificar que el usuario sigue activo
      const query = 'SELECT * FROM hyd_usuarios WHERE id = ? AND activo = TRUE';
      
      global.db.query(query, [decoded.id], (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }

        if (results.length === 0) {
          return res.status(401).json({ error: 'Usuario no encontrado o inactivo' });
        }

        const usuario = UsuarioModel.sanitizarUsuario(results[0]);
        
        res.json({
          valid: true,
          usuario
        });
      });

    } catch (error) {
      console.error('Error verificando token:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }

  async logout(req, res) {
    // Para logout con JWT, simplemente informamos que se debe eliminar del lado cliente
    res.json({ message: 'Logout exitoso' });
  }

  async cambiarPassword(req, res) {
    try {
      const { passwordActual, passwordNuevo } = req.body;
      const usuarioId = req.usuario.id;

      if (!passwordActual || !passwordNuevo) {
        return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas' });
      }

      if (!UsuarioModel.validarPassword(passwordNuevo)) {
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
      }

      // Obtener usuario actual
      const query = 'SELECT * FROM hyd_usuarios WHERE id = ? AND activo = TRUE';
      
      global.db.query(query, [usuarioId], async (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }

        if (results.length === 0) {
          return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const usuario = results[0];

        // Verificar contraseña actual
        const passwordValido = await UsuarioModel.compararPassword(passwordActual, usuario.password_hash);
        
        if (!passwordValido) {
          return res.status(400).json({ error: 'Contraseña actual incorrecta' });
        }

        // Hash de la nueva contraseña
        const nuevoHash = await UsuarioModel.hashPassword(passwordNuevo);

        // Actualizar contraseña
        const updateQuery = 'UPDATE hyd_usuarios SET password_hash = ?, updated_at = NOW() WHERE id = ?';
        
        global.db.query(updateQuery, [nuevoHash, usuarioId], (updateErr, updateResults) => {
          if (updateErr) {
            return res.status(500).json({ error: 'Error actualizando contraseña' });
          }

          res.json({ message: 'Contraseña actualizada exitosamente' });
        });
      });

    } catch (error) {
      console.error('Error cambiando contraseña:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }

  async crearUsuario(req, res) {
    try {
      const { nombre_completo, email, password, rol } = req.body;

      // Validaciones
      if (!nombre_completo || !email || !password || !rol) {
        return res.status(400).json({ error: 'Todos los campos son requeridos' });
      }

      if (!UsuarioModel.validarEmail(email)) {
        return res.status(400).json({ error: 'Formato de email inválido' });
      }

      if (!UsuarioModel.validarPassword(password)) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
      }

      if (!UsuarioModel.getRolesValidos().includes(rol)) {
        return res.status(400).json({ error: 'Rol inválido' });
      }

      // Verificar que el usuario tiene permisos de administrador
      if (req.usuario.rol !== 'administrador') {
        return res.status(403).json({ error: 'No tienes permisos para crear usuarios' });
      }

      // Verificar email único
      const checkQuery = 'SELECT id FROM hyd_usuarios WHERE email = ?';
      
      global.db.query(checkQuery, [email], async (checkErr, checkResults) => {
        if (checkErr) {
          return res.status(500).json({ error: 'Error verificando email' });
        }

        if (checkResults.length > 0) {
          return res.status(400).json({ error: 'El email ya está registrado' });
        }

        // Hash password
        const passwordHash = await UsuarioModel.hashPassword(password);

        // Crear usuario
        const insertQuery = `
          INSERT INTO hyd_usuarios (nombre_completo, email, password_hash, rol, created_at, updated_at)
          VALUES (?, ?, ?, ?, NOW(), NOW())
        `;

        global.db.query(insertQuery, [nombre_completo, email, passwordHash, rol], (insertErr, insertResults) => {
          if (insertErr) {
            console.error('Error creando usuario:', insertErr);
            return res.status(500).json({ error: 'Error creando usuario' });
          }

          res.status(201).json({
            message: 'Usuario creado exitosamente',
            usuario: {
              id: insertResults.insertId,
              nombre_completo,
              email,
              rol,
              activo: true
            }
          });
        });
      });

    } catch (error) {
      console.error('Error creando usuario:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }

  async obtenerUsuarios(req, res) {
    try {
      // Verificar permisos de administrador
      if (req.usuario.rol !== 'administrador') {
        return res.status(403).json({ error: 'No tienes permisos para ver usuarios' });
      }

      const query = `
        SELECT id, nombre_completo, email, rol, activo, ultimo_acceso, created_at, updated_at
        FROM hyd_usuarios 
        ORDER BY created_at DESC
      `;

      global.db.query(query, (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Error de base de datos' });
        }

        const usuarios = results.map(usuario => UsuarioModel.sanitizarUsuario(usuario));

        res.json(usuarios);
      });

    } catch (error) {
      console.error('Error obteniendo usuarios:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
}

module.exports = new AuthController();