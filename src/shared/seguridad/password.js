'use strict';

/**
 * Hash y verificación de contraseñas.
 *
 * Vive en `shared` y no dentro del módulo de autenticación para evitar un ciclo:
 * `auth` necesita el repositorio de usuarios, y `usuarios` necesita hashear al
 * dar de alta. Ambos dependen de esta pieza de infraestructura, no entre sí.
 *
 * Cambios respecto al sistema viejo: 12 rondas de bcrypt en vez de 10, y una
 * política de contraseña que sí se aplica — `validarPassword` solo comprobaba
 * `length >= 6` pese a que su comentario afirmaba exigir letra y número.
 */

const bcrypt = require('bcryptjs');

const LARGO_MINIMO = 10;

function crearServicioPassword({ rondas }) {
  return {
    async hashear(password) {
      return bcrypt.hash(password, rondas);
    },

    /**
     * Verifica la contraseña. Si el usuario no existe, el llamador debe pasar un
     * hash señuelo para que el tiempo de respuesta no revele su ausencia.
     */
    async verificar(password, hash) {
      return bcrypt.compare(password, hash);
    },
  };
}

/**
 * Reglas de robustez, en un solo sitio para que el esquema de validación y
 * cualquier otro punto de entrada compartan el mismo criterio.
 *
 * @returns {string[]} Lista de incumplimientos; vacía si la contraseña es válida.
 */
function evaluarRobustez(password) {
  const problemas = [];
  if (typeof password !== 'string' || password.length < LARGO_MINIMO) {
    problemas.push(`Debe tener al menos ${LARGO_MINIMO} caracteres`);
  }
  if (!/[a-z]/.test(password)) problemas.push('Debe incluir al menos una letra minúscula');
  if (!/[A-Z]/.test(password)) problemas.push('Debe incluir al menos una letra mayúscula');
  if (!/\d/.test(password)) problemas.push('Debe incluir al menos un número');
  return problemas;
}

/**
 * Hash bcrypt de un valor arbitrario, usado como señuelo cuando el email no
 * existe. Comparar contra él cuesta lo mismo que contra un hash real, así que el
 * atacante no puede distinguir "no existe" de "contraseña incorrecta" midiendo
 * el tiempo de respuesta.
 */
const HASH_SENUELO = '$2b$12$H4HxpFC7YkGrfCtygUCyIebYD7zUwRhTUFV6/oyDh4hbn.5C5lyFa';

module.exports = { crearServicioPassword, evaluarRobustez, LARGO_MINIMO, HASH_SENUELO };
