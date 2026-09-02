-- =============================================================================
-- 010 — Seguimiento de asistencia antes de la entrevista
-- =============================================================================
-- Decisión de negocio (2026-09-01): mientras una citación está pendiente,
-- Reclutamiento hace seguimiento para confirmar que el candidato va a asistir
-- (llamada de confirmación y/o mensaje de WhatsApp/Global), y necesita dejar
-- registrado si el candidato respondió a cada canal.
--
-- Dos columnas independientes, BOOLEAN NULL, mismo patrón que
-- `candidatos.contacto_llamada` / `contacto_whatsapp` (migración 003): hay que
-- poder distinguir "todavía no se intentó este canal" de "se intentó y no
-- respondió". Van en `candidato_citaciones`, no en `candidatos`, porque el
-- seguimiento es de UNA citación puntual — si se reagenda, el seguimiento
-- anterior no debe arrastrarse a la citación nueva.
-- =============================================================================

ALTER TABLE candidato_citaciones
  ADD COLUMN seguimiento_llamada BOOLEAN NULL
    COMMENT 'Seguimiento antes de la entrevista: si el candidato respondió la llamada de confirmación'
    AFTER observaciones,
  ADD COLUMN seguimiento_whatsapp BOOLEAN NULL
    COMMENT 'Seguimiento antes de la entrevista: si el candidato respondió el mensaje de WhatsApp/Global de confirmación'
    AFTER seguimiento_llamada;
