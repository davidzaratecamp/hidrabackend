-- Nueva tipificación del formulario "Nuevo Candidato" (2026-08-26): reemplaza el desplegable
-- "Observaciones de Llamada" (que mapeaba a 'estado', ver estadoMap en NuevoCandidato.jsx) por
-- "Citado" (sí/no) + "Estado Gestión Reclutamiento" (motivo, solo si Citado = no). Decidido con
-- el usuario dejar esto en columnas nuevas, sin tocar 'estado' (columna que alimenta el Dashboard
-- y los filtros del embudo existentes) para no romper esa lógica.
--
-- 'citado_gestion' es distinto de fecha_citacion_entrevista/estado='citado' (la citación real a
-- entrevista, que ocurre más adelante en el embudo vía "Marcar como Citado") - este campo
-- registra si el analista logró citar al candidato durante la primera gestión de contacto.
--
-- 'perfil' es un campo de texto libre corto, nuevo en el sistema (antes columna en blanco a
-- propósito en el Excel "BASE RECLUTAMIENTO", ver GRUPOS_ENCABEZADO_EXCEL en
-- seleccion.controller.js).
ALTER TABLE hyd_candidatos
  ADD COLUMN citado_gestion ENUM('si', 'no') NULL AFTER observaciones_llamada,
  ADD COLUMN estado_gestion_reclutamiento VARCHAR(100) NULL AFTER citado_gestion,
  ADD COLUMN perfil VARCHAR(255) NULL AFTER estado_gestion_reclutamiento;
