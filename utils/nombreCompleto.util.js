// Separa "Nombre Completo" en primer/segundo nombre y primer/segundo apellido (2026-08-18,
// reemplaza los campos sueltos "Primer Nombre"/"Primer Apellido" del formulario).
// Regla acordada con el usuario para el caso ambiguo de nombres compuestos: ante duda, las
// últimas 2 palabras se toman como apellidos (convención más común en Colombia).
//   2 palabras -> nombre + apellido
//   3+ palabras -> últimas 2 = apellidos, primera palabra = primer nombre,
//                  palabras intermedias (si las hay) = segundo nombre
//
// Vive en utils/ (no en el controller) porque lo usan tanto crearCandidato/editarCandidato
// (hyd_candidatos, sin capas) como el servicio de candidatoFormulario (paso "Datos Básicos").
function separarNombreCompleto(nombreCompleto) {
  const palabras = nombreCompleto.trim().split(/\s+/).filter(Boolean);

  if (palabras.length < 2) {
    return null;
  }

  if (palabras.length === 2) {
    return {
      primer_nombre: palabras[0],
      segundo_nombre: null,
      primer_apellido: palabras[1],
      segundo_apellido: null
    };
  }

  const n = palabras.length;
  return {
    primer_nombre: palabras[0],
    segundo_nombre: palabras.slice(1, n - 2).join(' ') || null,
    primer_apellido: palabras[n - 2],
    segundo_apellido: palabras[n - 1]
  };
}

module.exports = { separarNombreCompleto };
