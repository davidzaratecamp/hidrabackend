'use strict';

/**
 * Separación y composición del nombre del candidato.
 *
 * Portado de `utils/nombreCompleto.util.js`. Cambios: devuelve las claves en
 * camelCase (el mapeo a columnas es cosa del repositorio) y lanza un error de
 * negocio en vez de devolver `null`, para que ningún llamador pueda seguir
 * adelante con un nombre inválido sin darse cuenta.
 *
 * Regla para el caso ambiguo de nombres compuestos: las últimas dos palabras se
 * toman como apellidos, que es la convención más común en Colombia.
 *   2 palabras  -> nombre + apellido
 *   3+ palabras -> últimas 2 = apellidos, primera = primer nombre,
 *                  intermedias = segundo nombre
 */

const { HttpError } = require('../errors/HttpError');

function separarNombreCompleto(nombreCompleto) {
  const palabras = String(nombreCompleto ?? '').trim().split(/\s+/).filter(Boolean);

  if (palabras.length < 2) {
    throw HttpError.peticionInvalida(
      'El nombre completo debe incluir al menos un nombre y un apellido',
      { codigo: 'NOMBRE_INCOMPLETO' }
    );
  }

  if (palabras.length === 2) {
    return {
      primerNombre: palabras[0],
      segundoNombre: null,
      primerApellido: palabras[1],
      segundoApellido: null,
    };
  }

  const n = palabras.length;
  return {
    primerNombre: palabras[0],
    segundoNombre: palabras.slice(1, n - 2).join(' ') || null,
    primerApellido: palabras[n - 2],
    segundoApellido: palabras[n - 1],
  };
}

/**
 * Reconstruye el nombre completo. Estaba duplicado en tres archivos del sistema
 * viejo (`seleccion.controller`, `firmacloudDispatchService`, `pdfFillHelpers`).
 */
function nombreCompleto(persona) {
  return [
    persona.primer_nombre ?? persona.primerNombre,
    persona.segundo_nombre ?? persona.segundoNombre,
    persona.primer_apellido ?? persona.primerApellido,
    persona.segundo_apellido ?? persona.segundoApellido,
  ]
    .filter(Boolean)
    .join(' ');
}

module.exports = { separarNombreCompleto, nombreCompleto };
