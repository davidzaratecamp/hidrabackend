-- Columna de trazabilidad: id que devuelve FirmaCloud (POST /api/reclutamiento/send) al recibir
-- la hoja de vida + tratamiento de datos del candidato, para poder correlacionar/consultar el
-- estado de la firma después. NULL hasta que se dispare el envío (paso 6, ver claude/plan.md).
ALTER TABLE hyd_candidatos
  ADD COLUMN firmacloud_signature_id VARCHAR(36) NULL AFTER consentimiento_aceptado;
