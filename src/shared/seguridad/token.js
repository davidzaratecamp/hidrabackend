'use strict';

/**
 * Emisión y verificación de JWT.
 *
 * Diferencias con el sistema viejo:
 *   - No hay secreto de reserva. `config/env.js` exige `JWT_SECRET` de al menos
 *     32 caracteres y detiene el arranque si falta.
 *   - El algoritmo se fija explícitamente en la verificación. Sin `algorithms`,
 *     la librería acepta el que venga en la cabecera del token, que es la vía de
 *     los ataques de confusión de algoritmo.
 *   - Se validan `issuer` y expiración.
 *   - El payload es mínimo: solo el identificador. El rol NO viaja en el token.
 *     En el esquema nuevo un usuario puede tener varios roles y estos pueden
 *     cambiar; los permisos se resuelven contra la base en cada petición, así que
 *     revocar un rol tiene efecto inmediato en vez de esperar 8 horas.
 */

const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');

const ALGORITMO = 'HS256';

function crearServicioToken({ secreto, expiraEn, emisor }) {
  return {
    /** @param {{id: number}} usuario */
    emitir(usuario) {
      return jwt.sign({}, secreto, {
        algorithm: ALGORITMO,
        subject: String(usuario.id),
        issuer: emisor,
        expiresIn: expiraEn,
        jwtid: randomUUID(),
      });
    },

    /**
     * @throws {jwt.JsonWebTokenError} si el token es inválido o expiró.
     * @returns {{sub: number, jti: string, iat: number, exp: number}}
     */
    verificar(token) {
      const payload = jwt.verify(token, secreto, {
        algorithms: [ALGORITMO],
        issuer: emisor,
      });
      return { ...payload, sub: Number(payload.sub) };
    },
  };
}

module.exports = { crearServicioToken };
