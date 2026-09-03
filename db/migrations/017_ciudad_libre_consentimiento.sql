-- =============================================================================
-- 017 — Ciudad de consentimiento: de catálogo (Bogotá/Barranquilla) a texto libre
-- =============================================================================
-- El catálogo `ciudades` solo tenía esas dos opciones (ver db/seeds/003_catalogos.sql),
-- así que un candidato de cualquier otra ciudad no tenía cómo diligenciar el
-- paso 6 del formulario correctamente (pedido explícito, 2026-09-03).
--
-- Solo toca `candidato_consentimiento.ciudad_id`. La columna `candidatos.ciudad_id`
-- (que también referencia `ciudades`) es un campo distinto, ya muerto desde antes
-- de esta reestructuración (ver §4.3 de restructuracion.md) — no se toca acá.
-- El catálogo `ciudades` tampoco se borra: puede seguir usándose en otro lado.
-- =============================================================================

ALTER TABLE candidato_consentimiento
  DROP FOREIGN KEY fk_consentimiento_ciudad,
  DROP COLUMN ciudad_id,
  ADD COLUMN ciudad VARCHAR(120) NULL AFTER candidato_id;
