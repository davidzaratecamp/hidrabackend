-- =============================================================================
-- 019 — Rol Formación: seguimiento de la formación y envío a contratación
-- =============================================================================
-- Decisión de negocio (2026-10-02): el envío de candidatos a contratación
-- (Gestor Técnico, migración 018) deja de ser de Selección y pasa a un rol
-- nuevo, Formación, que solo ve a quienes pasan a formación:
--   * Agente: aprobado en decisión final y citado a formación (migración 015).
--     Formación marca si asistió (razón obligatoria si no) y si está activo o
--     de baja (razón obligatoria si es baja).
--   * Staff: aprobado en decisión final y marcado como contratación (016). No
--     marca asistencia, solo activo o baja.
-- Solo los activos (y, si es Agente, que asistieron) se pueden enviar a
-- contratación.
--
-- Mismo patrón informativo que 014-016: no mueve el estado del candidato en
-- el embudo. Una baja es una nota del expediente; el candidato sigue en
-- `aprobado_final`, pero ya no es elegible para enviar.
-- =============================================================================

CREATE TABLE candidato_formacion (
  candidato_id          INT UNSIGNED NOT NULL,
  -- Solo Agente. NULL = todavía sin marcar.
  asistio               BOOLEAN NULL,
  razon_inasistencia    TEXT NULL,
  asistencia_usuario_id INT UNSIGNED NULL,
  asistencia_en         DATETIME NULL,
  -- NULL = todavía sin marcar.
  estado                ENUM('activo','baja') NULL,
  razon_baja            TEXT NULL,
  estado_usuario_id     INT UNSIGNED NULL,
  estado_en             DATETIME NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (candidato_id),
  KEY idx_candidato_formacion_estado (estado),
  CONSTRAINT fk_formacion_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_formacion_asistencia_usuario
    FOREIGN KEY (asistencia_usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_formacion_estado_usuario
    FOREIGN KEY (estado_usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT ck_formacion_razon_inasistencia
    CHECK (asistio IS NULL OR asistio = TRUE OR razon_inasistencia IS NOT NULL),
  CONSTRAINT ck_formacion_razon_baja
    CHECK (estado IS NULL OR estado = 'activo' OR razon_baja IS NOT NULL)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Rol y permiso. Como en 011/018, el CROSS JOIN del seed inicial no alcanza a
-- un permiso nuevo: hay que dárselo al administrador explícitamente.
-- -----------------------------------------------------------------------------
INSERT INTO roles (codigo, nombre, descripcion) VALUES
  ('formacion', 'Formación',
   'Seguimiento de candidatos en formación (asistencia, activo/baja) y envío a contratación');

INSERT INTO permisos (codigo, nombre, descripcion, modulo) VALUES
  ('gestionar_formacion', 'Gestionar formación',
   'Ver a los candidatos que pasan a formación y marcar asistencia y activo/baja',
   'formacion');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r, permisos p
WHERE r.codigo IN ('administrador', 'formacion') AND p.codigo = 'gestionar_formacion';

-- Formación envía a contratación; Selección deja de hacerlo (queda Administrador).
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r, permisos p
WHERE r.codigo = 'formacion' AND p.codigo = 'enviar_contratacion';

DELETE rp FROM rol_permisos rp
  JOIN roles r    ON r.id = rp.rol_id
  JOIN permisos p ON p.id = rp.permiso_id
 WHERE r.codigo = 'seleccion' AND p.codigo = 'enviar_contratacion';
