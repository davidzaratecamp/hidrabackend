-- Soporta la paginación nueva de GET /api/seleccion/candidatos-citados (pantalla "Candidatos" del
-- módulo de Selección, CandidatosSeleccion.jsx) — antes traía sin paginar todos los candidatos con
-- fecha_citacion_entrevista IS NOT NULL. El índice cubre el WHERE (IS NOT NULL) y el ORDER BY
-- (fecha_citacion_entrevista, created_at, id) que usa esa consulta, mismo criterio que la migración
-- 007 para candidato.controller.js.
ALTER TABLE hyd_candidatos
  ADD INDEX idx_citacion_created_id (fecha_citacion_entrevista, created_at, id);
