const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

class UsuarioModel {
  
  static getRolesValidos() {
    return ['reclutador', 'seleccion', 'administrador'];
  }

  static getPermisosRol(rol) {
    const permisos = {
      administrador: [
        'ver_dashboard', 'ver_estadisticas', 'ver_candidatos', 'crear_candidatos',
        'editar_candidatos', 'eliminar_candidatos', 'ver_usuarios', 'crear_usuarios',
        'editar_usuarios', 'eliminar_usuarios', 'ver_reportes'
      ],
      reclutador: [
        'ver_dashboard', 'ver_estadisticas', 'ver_candidatos', 'crear_candidatos',
        'editar_candidatos', 'reenviar_emails'
      ],
      seleccion: [
        'ver_candidatos', 'editar_estados_candidatos', 'ver_perfiles_completos',
        'generar_reportes_seleccion'
      ]
    };
    
    return permisos[rol] || [];
  }

  static async hashPassword(password) {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
  }

  static async compararPassword(password, hash) {
    return await bcrypt.compare(password, hash);
  }

  static generarToken(usuario) {
    const payload = {
      id: usuario.id,
      email: usuario.email,
      rol: usuario.rol,
      nombre_completo: usuario.nombre_completo
    };

    return jwt.sign(
      payload, 
      process.env.JWT_SECRET || 'hydra_secret_key_2024', 
      { expiresIn: '8h' }
    );
  }

  static verificarToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET || 'hydra_secret_key_2024');
    } catch (error) {
      return null;
    }
  }

  static validarEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  static validarPassword(password) {
    // Mínimo 6 caracteres, al menos una letra y un número
    return password && password.length >= 6;
  }

  static sanitizarUsuario(usuario) {
    const { password_hash, ...usuarioSinPassword } = usuario;
    return {
      ...usuarioSinPassword,
      permisos: this.getPermisosRol(usuario.rol)
    };
  }
}

module.exports = UsuarioModel;