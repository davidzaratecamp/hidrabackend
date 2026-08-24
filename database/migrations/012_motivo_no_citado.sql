-- Registra el motivo cuando el reclutador decide NO citar a un candidato a entrevista (botón
-- "No Citado" en el perfil, alternativa a "Marcar como Citado"). El candidato pasa al estado
-- 'rechazado' (mismo bucket final que ya usa el resto del embudo, ver Dashboard/Estadísticas) y
-- este campo guarda el porqué.
ALTER TABLE hyd_candidatos
  ADD COLUMN motivo_no_citado TEXT NULL AFTER fecha_citacion_entrevista;
