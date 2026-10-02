'use strict';

/**
 * Envía un PDF como descarga con el nombre del candidato como nombre de archivo.
 *
 * El nombre lleva tildes y lo escribió un usuario: se quitan los caracteres que
 * no valen en un nombre de archivo, y va en `filename*` (UTF-8) con una versión
 * ASCII en `filename` para clientes viejos. Si queda vacío se usa `respaldo`.
 */
function enviarPdfComoAdjunto(res, contenido, nombreCandidato, respaldo) {
  const limpio = String(nombreCandidato ?? '').replace(/[\\/:*?"<>|\r\n]+/g, '').trim();
  const nombre = `${limpio || respaldo}.pdf`;
  const ascii = nombre.normalize('NFD').replace(/[^\x20-\x7e]/g, '');
  res.set('Content-Type', 'application/pdf');
  res.set(
    'Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`
  );
  return res.send(contenido);
}

module.exports = { enviarPdfComoAdjunto };
