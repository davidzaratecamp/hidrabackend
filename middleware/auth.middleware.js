const UsuarioModel = require('../models/usuario.model');

// Middleware para verificar token JWT
const verificarToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token de acceso requerido' });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = UsuarioModel.verificarToken(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }

    // Verificar que el usuario existe y está activo
    const query = 'SELECT * FROM hyd_usuarios WHERE id = ? AND activo = TRUE';
    
    global.db.query(query, [decoded.id], (err, results) => {
      if (err) {
        console.error('Error verificando usuario:', err);
        return res.status(500).json({ error: 'Error de base de datos' });
      }

      if (results.length === 0) {
        return res.status(401).json({ error: 'Usuario no encontrado o inactivo' });
      }

      // Agregar usuario a request
      req.usuario = UsuarioModel.sanitizarUsuario(results[0]);
      next();
    });

  } catch (error) {
    console.error('Error en middleware de autenticación:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Middleware para verificar roles específicos
const verificarRol = (...rolesPermitidos) => {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ 
        error: 'No tienes permisos para acceder a este recurso',
        rol_requerido: rolesPermitidos,
        rol_actual: req.usuario.rol
      });
    }

    next();
  };
};

// Middleware para verificar permisos específicos
const verificarPermiso = (permiso) => {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    const permisos = UsuarioModel.getPermisosRol(req.usuario.rol);
    
    if (!permisos.includes(permiso)) {
      return res.status(403).json({ 
        error: 'No tienes permisos para realizar esta acción',
        permiso_requerido: permiso,
        permisos_actuales: permisos
      });
    }

    next();
  };
};

// Middleware para verificar que el usuario es el mismo o admin
const verificarPropietarioOAdmin = (req, res, next) => {
  if (!req.usuario) {
    return res.status(401).json({ error: 'Usuario no autenticado' });
  }

  const usuarioId = req.params.usuarioId || req.params.id;
  
  if (req.usuario.rol === 'administrador' || req.usuario.id.toString() === usuarioId) {
    next();
  } else {
    res.status(403).json({ error: 'Solo puedes acceder a tu propia información' });
  }
};

// Middleware opcional - no falla si no hay token
const verificarTokenOpcional = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.usuario = null;
    return next();
  }

  const token = authHeader.replace('Bearer ', '');
  const decoded = UsuarioModel.verificarToken(token);

  if (!decoded) {
    req.usuario = null;
    return next();
  }

  // Verificar usuario en BD
  const query = 'SELECT * FROM hyd_usuarios WHERE id = ? AND activo = TRUE';
  
  global.db.query(query, [decoded.id], (err, results) => {
    if (err || results.length === 0) {
      req.usuario = null;
    } else {
      req.usuario = UsuarioModel.sanitizarUsuario(results[0]);
    }
    next();
  });
};

module.exports = {
  verificarToken,
  verificarRol,
  verificarPermiso,
  verificarPropietarioOAdmin,
  verificarTokenOpcional
};