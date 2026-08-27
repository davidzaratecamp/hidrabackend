-- Registra cuándo se le envió (o reenvió) al candidato el email con el link de sus formularios
-- (2026-08-27, pedido del usuario). Reemplaza a fecha_citacion_entrevista en la celda "FECHA DE
-- ENTREVISTA" de la hoja de vida impresa (hojaVidaPdfService.js) - desde que se quitó el
-- selector de fecha/hora del modal "Citar" (ver rondas anteriores), fecha_citacion_entrevista ya
-- no la fija nada, así que ese campo del PDF quedaba siempre en blanco. Se guarda en columna
-- nueva y separada en vez de reutilizar fecha_citacion_entrevista para no perder el significado
-- original de esa columna por si se retoma una citación real más adelante.
ALTER TABLE hyd_candidatos
  ADD COLUMN fecha_envio_email DATETIME NULL AFTER token_acceso;
