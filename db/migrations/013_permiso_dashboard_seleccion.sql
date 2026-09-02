-- =============================================================================
-- 013 — Permiso: ver dashboard de Selección (deja de compartirse con Admin)
-- =============================================================================
-- Decisión de negocio (2026-09-02): Administrador deja de ver el "Dashboard de
-- Selección" (cola de evaluación, resultados de Agente) — ese panel es
-- operativo de Selección, no algo que el administrador necesite como pantalla
-- de inicio. En su lugar el administrador tiene su propio dashboard, gateado
-- en el frontend por `ver_usuarios` (permiso ya exclusivo de administrador,
-- mismo patrón que "Agenda de entrevistas" y "Trazabilidad del equipo" en
-- `menu.js`).
--
-- Hasta ahora la ruta `/seleccion/dashboard` (frontend) usaba `evaluar_candidatos`,
-- que Selección y Administrador comparten. No se puede reutilizar ese permiso
-- para excluir a Administrador sin también quitárselo a Selección, así que
-- hace falta uno nuevo, exclusivo de Selección.
--
-- El endpoint del backend (`GET /reportes/panel-seleccion`) SIGUE gateado por
-- `evaluar_candidatos`: este permiso nuevo solo decide qué pantalla arma el
-- frontend, no quién puede pedir esos datos por API — mismo criterio que ya
-- aplica el frontend en otros menús (`ver_usuarios` para pantallas cuya ruta
-- exige un permiso distinto).
-- =============================================================================

INSERT INTO permisos (codigo, nombre, descripcion, modulo) VALUES
  ('ver_dashboard_seleccion', 'Ver dashboard de Selección',
   'Ver el panel de cola de evaluación y resultados de Selección',
   'seleccion');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r, permisos p
WHERE r.codigo = 'seleccion' AND p.codigo = 'ver_dashboard_seleccion';
