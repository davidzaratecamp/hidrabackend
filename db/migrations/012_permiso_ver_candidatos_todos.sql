-- =============================================================================
-- 012 — Permiso: ver candidatos de todos (separa visibilidad de datos sensibles)
-- =============================================================================
-- Hasta ahora `visibilidad.js` reutilizaba `ver_perfiles_completos` tanto para
-- "¿ve candidatos que no son suyos?" como para "¿ve valoración psicológica y
-- evaluación en el histórico/trazabilidad?". Reclutamiento no tenía ese
-- permiso, así que un candidato registrado por otro usuario (p. ej. un admin)
-- no aparecía en su listado.
--
-- Decisión de negocio (2026-09-02): todos los roles deben ver el listado
-- completo de candidatos, sin importar quién los registró, pero Reclutamiento
-- sigue sin acceso a valoración psicológica/evaluación (eso se mantiene atado
-- a `ver_perfiles_completos`, que no cambia). Por eso el permiso es nuevo, no
-- una reasignación del existente.
--
-- Igual que en 011: esta migración corre después del seed inicial, así que
-- `administrador` necesita el INSERT explícito también.
-- =============================================================================

INSERT INTO permisos (codigo, nombre, descripcion, modulo) VALUES
  ('ver_candidatos_todos', 'Ver candidatos de todos',
   'Ver en listados y reportes los candidatos registrados por cualquier usuario, no solo los propios',
   'candidatos');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r, permisos p
WHERE r.codigo = 'administrador' AND p.codigo = 'ver_candidatos_todos';

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r, permisos p
WHERE r.codigo = 'seleccion' AND p.codigo = 'ver_candidatos_todos';

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r, permisos p
WHERE r.codigo = 'reclutamiento' AND p.codigo = 'ver_candidatos_todos';
