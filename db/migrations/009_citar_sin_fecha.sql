-- =============================================================================
-- 009 — Citar deja de llevar fecha, y se puede citar al registrar
-- =============================================================================
-- Decisión de negocio (2026-08-30). Dos cambios que van juntos:
--
--   1. Citar a un candidato ya no es agendar una fecha y hora: es marcarlo como
--      citado. La citación sigue existiendo como hecho (quién citó, cuándo, y
--      luego si asistió), pero sin fecha de entrevista. `created_at` pasa a ser
--      el ancla temporal: la fecha EN QUE se citó, que es la que el equipo usa
--      para el reporte y para ordenar la agenda.
--
--   2. La reclutadora cita desde el formulario de registro (Citado = Sí), sin
--      pasar por Selección. Eso exige la transición `nuevo -> citado`, que no
--      existía: hasta ahora solo se llegaba a `citado` desde
--      `formularios_completados` o desde `no_asistio`.
--
-- Se elimina la columna en vez de dejarla nullable: nadie volvería a escribirla
-- y una columna muerta en la tabla del embudo es exactamente el tipo de cosa que
-- la reestructuración vino a quitar. Los índices que la usaban se rehacen sobre
-- `created_at`, que es lo que ahora ordena y filtra.
-- =============================================================================

ALTER TABLE candidato_citaciones
  DROP INDEX idx_citaciones_candidato,
  DROP INDEX idx_citaciones_fecha_asistio,
  DROP COLUMN fecha_citacion,
  ADD KEY idx_citaciones_candidato (candidato_id, created_at),
  -- Índice de la agenda de Selección: mismo propósito que el anterior, sobre la
  -- columna que ahora ordena el listado.
  ADD KEY idx_citaciones_created_asistio (created_at, asistio, id);

-- -----------------------------------------------------------------------------
-- Transición nueva: se cita al registrar
-- -----------------------------------------------------------------------------
-- `INSERT IGNORE` para que la migración sea idempotente y no choque con la clave
-- primaria (origen, destino) si el seed ya la trajera en una base recreada.
INSERT IGNORE INTO estado_transiciones (estado_origen_id, estado_destino_id, requiere_motivo)
SELECT o.id, d.id, FALSE
  FROM estados_candidato o
  JOIN estados_candidato d
 WHERE o.codigo = 'nuevo' AND d.codigo = 'citado';
