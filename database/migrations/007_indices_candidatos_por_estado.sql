-- Migración 007: índices compuestos para GET /api/candidato/por-estado/:estado (2026-08-19)
--
-- getCandidatosPorEstado (candidato.controller.js) filtra por estado (+ reclutador_id para el
-- rol reclutador) y ordena por updated_at DESC, id DESC antes de paginar (LIMIT/OFFSET). Hoy
-- solo existen índices simples en `estado` y `reclutador_id` por separado (idx_estado,
-- idx_reclutador_id) — ninguno cubre el ORDER BY, así que MySQL hace un filesort en cada
-- request. Con el estado `nuevo` (99.97% de la tabla en la BD verificada, 7857/7859 filas) el
-- optimizador de MySQL igual prefiere un table scan completo sobre usar el índice (la
-- selectividad es tan baja que el índice no ayuda ahí, confirmado con EXPLAIN) — pero para el
-- resto de estados del embudo (donde sí importa según los candidatos avancen fuera de "nuevo"),
-- este índice compuesto evita el filesort por completo.
--
-- Aditivo, no reordena ni toca datos - solo agrega índices. Verificar con
-- `SHOW INDEX FROM hyd_candidatos` antes de correr si ya existen (STEP 0 abajo).

-- STEP 0: verificación previa (solo lectura) - debe devolver 0 filas
SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hyd_candidatos'
  AND INDEX_NAME IN ('idx_estado_updated_id', 'idx_reclutador_estado_updated_id');

-- STEP 1: índice para administrador/selección (WHERE estado = ? ORDER BY updated_at DESC, id DESC)
ALTER TABLE hyd_candidatos
  ADD INDEX idx_estado_updated_id (estado, updated_at, id);

-- STEP 2: índice para reclutador (WHERE estado = ? AND reclutador_id = ? ORDER BY updated_at DESC, id DESC)
ALTER TABLE hyd_candidatos
  ADD INDEX idx_reclutador_estado_updated_id (reclutador_id, estado, updated_at, id);

-- Verificación final
SHOW INDEX FROM hyd_candidatos WHERE Key_name IN ('idx_estado_updated_id', 'idx_reclutador_estado_updated_id');
