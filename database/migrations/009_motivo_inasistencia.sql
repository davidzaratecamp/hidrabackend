-- Captura el detalle de "MOTIVO INASISTENCIA" del Excel oficial (BASE RECLUTAMIENTO), que hasta
-- ahora no se registraba al marcar "No asistió" (solo quedaba el sí/no en `asistio_citacion` y
-- observaciones libres en `observaciones_seleccion`, ver claude/plan.md, séptima ronda). VARCHAR
-- en vez de ENUM porque el catálogo incluye la opción "Otra", de texto libre.
ALTER TABLE hyd_candidatos
  ADD COLUMN motivo_inasistencia VARCHAR(150) NULL AFTER asistio_citacion;
