-- Botón "Reasignar" (candidato pasa de un analista/reclutador a otro). Transferencia directa, sin
-- flujo de solicitud/aceptación - solo se guarda quién hizo el cambio y cuándo, como rastro básico
-- de auditoría. Ver claude/lastcontext.md.
ALTER TABLE hyd_candidatos
  ADD COLUMN reasignado_por_id INT NULL AFTER reclutador_id,
  ADD COLUMN fecha_reasignacion TIMESTAMP NULL AFTER reasignado_por_id;
