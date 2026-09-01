'use strict';

/**
 * Ayudas para construir SQL de forma segura.
 *
 * El escape de comodines de LIKE estaba copiado en tres archivos del sistema
 * viejo (`candidato.controller.js:94`, `seleccion.controller.js:309` y `:357`).
 */

/**
 * Escapa los comodines de LIKE en un término de búsqueda.
 *
 * Sin esto, un usuario que busque "100%" hace que `%` actúe como comodín y la
 * consulta devuelva filas que no contienen ese texto.
 *
 * Debe usarse junto con `ESCAPE '\\'` en la consulta.
 */
function escaparLike(termino) {
  return String(termino).replace(/[\\%_]/g, '\\$&');
}

/** Envuelve un término para una búsqueda `LIKE %termino%` ya escapada. */
function contiene(termino) {
  return `%${escaparLike(termino)}%`;
}

/**
 * Valida un identificador contra una lista blanca antes de interpolarlo.
 *
 * Se usa solo para nombres de columna en ORDER BY, que no admiten placeholders.
 * Cualquier otro valor va parametrizado con `?`.
 *
 * @throws {Error} si el identificador no está en la lista permitida.
 */
function identificadorSeguro(valor, permitidos) {
  if (!permitidos.includes(valor)) {
    throw new Error(`Identificador SQL no permitido: ${valor}`);
  }
  return valor;
}

/** Construye `(?, ?, ?)` para una cláusula IN, con sus parámetros. */
function marcadores(cantidad) {
  return Array(cantidad).fill('?').join(', ');
}

module.exports = { escaparLike, contiene, identificadorSeguro, marcadores };
