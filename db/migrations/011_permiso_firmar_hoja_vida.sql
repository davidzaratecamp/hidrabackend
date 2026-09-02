-- =============================================================================
-- 011 — Permiso: firmar hoja de vida (Selección/Administrador)
-- =============================================================================
-- Después de que el candidato firma en FirmaCloud (hoja de vida + tratamiento de
-- datos), Selección o Administrador pueden estampar una segunda firma sobre la
-- hoja de vida (campo "PSICÓLOGO" de la plantilla). Nuevo permiso, mismo patrón
-- que el resto de `db/seeds/001_roles_y_permisos.sql`.
--
-- Esta migración corre DESPUÉS del seed inicial, así que el `CROSS JOIN` que le
-- da a `administrador` todos los permisos ya no alcanza a este — hay que
-- insertárselo también a mano aquí.
-- =============================================================================

INSERT INTO permisos (codigo, nombre, descripcion, modulo) VALUES
  ('firmar_hoja_vida', 'Firmar hoja de vida',
   'Estampar la firma de selección/administrador sobre la hoja de vida ya firmada por el candidato',
   'seleccion');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r, permisos p
WHERE r.codigo = 'administrador' AND p.codigo = 'firmar_hoja_vida';

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r, permisos p
WHERE r.codigo = 'seleccion' AND p.codigo = 'firmar_hoja_vida';
