'use strict';

/**
 * Reglas de autenticación.
 *
 * Endurecimientos respecto al sistema viejo:
 *   - Un solo mensaje para "correo inexistente", "contraseña incorrecta" y
 *     "usuario inactivo". Mensajes distintos permiten enumerar qué correos
 *     existen en la organización.
 *   - Cuando el correo no existe se compara igualmente contra un hash señuelo,
 *     para que el tiempo de respuesta no delate la diferencia.
 *   - Cambiar la contraseña exige la actual y no permite repetirla.
 */

const { HttpError } = require('../../shared/errors/HttpError');
const { evaluarRobustez, HASH_SENUELO } = require('../../shared/seguridad/password');

const CREDENCIALES_INVALIDAS = 'Correo o contraseña incorrectos';

function crearAuthServicio({ usuarioRepo, servicioPassword, servicioToken, logger }) {
  return {
    async login({ email, password }) {
      const credenciales = await usuarioRepo.buscarCredencialesPorEmail(email);

      // Siempre se ejecuta un bcrypt.compare, exista o no el usuario.
      const hash = credenciales?.password_hash ?? HASH_SENUELO;
      const passwordCorrecta = await servicioPassword.verificar(password, hash);

      if (!credenciales || !credenciales.activo || !passwordCorrecta) {
        logger.warn(
          { email, motivo: !credenciales ? 'inexistente' : !credenciales.activo ? 'inactivo' : 'password' },
          'Intento de login fallido'
        );
        throw HttpError.noAutenticado(CREDENCIALES_INVALIDAS, {
          codigo: 'CREDENCIALES_INVALIDAS',
        });
      }

      const usuario = await usuarioRepo.obtenerContextoAutenticacion(credenciales.id);
      await usuarioRepo.registrarUltimoAcceso(usuario.id);

      logger.info({ usuarioId: usuario.id, roles: usuario.roles }, 'Login exitoso');

      return { token: servicioToken.emitir(usuario), usuario };
    },

    /**
     * Devuelve el contexto ya resuelto por el middleware de autenticación.
     * El frontend lo usa para construir el menú a partir de `permisos`, en vez
     * de tener los items del menú fijos en el código como hoy.
     */
    async perfil(usuario) {
      return usuario;
    },

    async cambiarPassword(usuarioId, { passwordActual, passwordNueva }) {
      if (passwordActual === passwordNueva) {
        throw HttpError.peticionInvalida('La contraseña nueva debe ser distinta de la actual', {
          codigo: 'PASSWORD_SIN_CAMBIO',
        });
      }

      const problemas = evaluarRobustez(passwordNueva);
      if (problemas.length > 0) {
        throw HttpError.peticionInvalida('La contraseña no cumple los requisitos', {
          codigo: 'PASSWORD_DEBIL',
          detalles: problemas,
        });
      }

      const hashActual = await usuarioRepo.obtenerHashPassword(usuarioId);
      if (!hashActual) {
        throw HttpError.noAutenticado('Tu usuario ya no está activo');
      }

      if (!(await servicioPassword.verificar(passwordActual, hashActual))) {
        logger.warn({ usuarioId }, 'Cambio de contraseña con contraseña actual incorrecta');
        throw HttpError.noAutenticado('La contraseña actual es incorrecta', {
          codigo: 'PASSWORD_ACTUAL_INCORRECTA',
        });
      }

      await usuarioRepo.actualizarPassword(
        usuarioId,
        await servicioPassword.hashear(passwordNueva)
      );
      logger.info({ usuarioId }, 'Contraseña actualizada');
    },
  };
}

module.exports = { crearAuthServicio };
