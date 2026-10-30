-- =============================================================================
-- 021 — Documentos de contratación hacia Gestor
-- =============================================================================
-- Decisión de negocio (2026-10-30): al enviar a contratación, además de los
-- datos del candidato, Gestor recibe sus documentos:
--   * los soportes de antecedentes que tenga cargados (ADRES, Policía,
--     Comparendos, Procuraduría), cada uno por separado;
--   * la hoja de vida y el tratamiento de datos firmados en FirmaCloud.
--
-- Hoja de vida y tratamiento firmados son OBLIGATORIOS: sin la firma del
-- candidato no se puede enviar (`motivoNoElegible`). Los antecedentes no: si
-- falta alguno, Contratación deja una nota para RRHH al enviar.
--
-- Hydra no guardaba copia de los documentos firmados (los descargaba de
-- FirmaCloud cada vez). Al enviarlos a Gestor se guarda una copia en
-- `candidato_documentos` con los dos tipos nuevos, para que un reintento mande
-- exactamente los mismos bytes con la misma Idempotency-Key.
--
-- Cada documento viaja como un envío propio del outbox (tipo `documento`),
-- después del envío del lote: un PDF no cabe en el JSON del lote.
-- =============================================================================

INSERT INTO tipos_documento_adjunto (codigo, nombre, orden) VALUES
  ('hoja_vida_firmada', 'Hoja de vida firmada', 10),
  ('tratamiento_datos_firmado', 'Tratamiento de datos firmado', 11);

ALTER TABLE contratacion_candidatos
  ADD COLUMN nota_antecedentes VARCHAR(500) NULL
    COMMENT 'Nota de Contratación para RRHH cuando faltan antecedentes al enviar'
    AFTER detalle;

ALTER TABLE contratacion_envios
  MODIFY COLUMN tipo ENUM('lote','actualizacion','cancelacion','documento') NOT NULL;
