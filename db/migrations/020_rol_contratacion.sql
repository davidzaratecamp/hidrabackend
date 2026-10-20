-- =============================================================================
-- 020 — Rol Contratación: separa la formación del envío a RRHH
-- =============================================================================
-- Decisión de negocio (2026-10-20), cambia el reparto de la 019:
--   * Formación solo ve Agentes (de cualquier campaña), que son los únicos que
--     pasan por formación: marca asistencia y activo/baja. Ya no envía a
--     contratación ni ve Staff.
--   * Contratación (rol nuevo) ve a quienes se van a contratar: Staff
--     aprobados en decisión final y marcados como contratación (marca él su
--     activo/baja) y Agentes que pasaron la formación (asistieron y quedaron
--     activos). Es quien envía los lotes a RRHH (Gestor Técnico).
--
-- No cambia el esquema: activo/baja de Staff sigue en `candidato_formacion`
-- (019), solo cambia quién lo marca. Las reglas de elegibilidad tampoco cambian.
-- =============================================================================

INSERT INTO roles (codigo, nombre, descripcion) VALUES
  ('contratacion', 'Contratación',
   'Candidatos que se van a contratar (Staff y Agentes que pasaron formación) y envío a RRHH');

UPDATE roles
   SET descripcion = 'Seguimiento de los Agentes en formación (asistencia, activo/baja)'
 WHERE codigo = 'formacion';

UPDATE permisos
   SET descripcion = 'Ver a los Agentes en formación y marcar asistencia y activo/baja'
 WHERE codigo = 'gestionar_formacion';

UPDATE permisos
   SET descripcion = 'Ver a quienes se van a contratar, marcar activo/baja de Staff y enviar lotes a RRHH (Gestor Técnico)'
 WHERE codigo = 'enviar_contratacion';

-- Contratación envía a RRHH; Formación deja de hacerlo (queda Administrador).
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r, permisos p
WHERE r.codigo = 'contratacion' AND p.codigo = 'enviar_contratacion';

DELETE rp FROM rol_permisos rp
  JOIN roles r    ON r.id = rp.rol_id
  JOIN permisos p ON p.id = rp.permiso_id
 WHERE r.codigo = 'formacion' AND p.codigo = 'enviar_contratacion';
