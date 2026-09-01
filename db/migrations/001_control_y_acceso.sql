-- =============================================================================
-- 001 — Control de esquema, usuarios, roles y permisos
-- =============================================================================
-- Base: ReclutamientoNuevo
--
-- Cambios respecto al esquema actual (`noviembrehidra`):
--   * `hyd_usuarios.rol ENUM(...)` desaparece. Un usuario puede tener VARIOS roles,
--     modelado con la tabla puente `usuario_roles` (M:N).
--   * Los permisos por rol dejan de estar hardcodeados en `models/usuario.model.js`
--     y pasan a `permisos` + `rol_permisos`.
--   * Se agrega `migraciones_aplicadas`: sin ella, el esquema no es reproducible
--     (causa raíz de los bugs #1-#4 del registro interno).
-- =============================================================================

-- Nota: `migraciones_aplicadas` NO se crea aquí. Es infraestructura del
-- aplicador (`db/migrate.js`), no parte del esquema del dominio: el runner la
-- crea antes de aplicar nada, porque necesita consultarla para saber qué falta.

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------
CREATE TABLE roles (
  id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo      VARCHAR(50)  NOT NULL COMMENT 'Identificador estable usado por el código',
  nombre      VARCHAR(100) NOT NULL COMMENT 'Etiqueta mostrada al usuario',
  descripcion VARCHAR(255) NULL,
  activo      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_codigo (codigo)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Permisos
-- -----------------------------------------------------------------------------
CREATE TABLE permisos (
  id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo      VARCHAR(60)  NOT NULL,
  nombre      VARCHAR(120) NOT NULL,
  descripcion VARCHAR(255) NULL,
  modulo      VARCHAR(50)  NOT NULL COMMENT 'Agrupador para presentar los permisos en la UI',
  PRIMARY KEY (id),
  UNIQUE KEY uq_permisos_codigo (codigo),
  KEY idx_permisos_modulo (modulo)
) ENGINE=InnoDB;

CREATE TABLE rol_permisos (
  rol_id     SMALLINT UNSIGNED NOT NULL,
  permiso_id SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (rol_id, permiso_id),
  KEY idx_rol_permisos_permiso (permiso_id),
  CONSTRAINT fk_rol_permisos_rol
    FOREIGN KEY (rol_id) REFERENCES roles (id) ON DELETE CASCADE,
  CONSTRAINT fk_rol_permisos_permiso
    FOREIGN KEY (permiso_id) REFERENCES permisos (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Usuarios
-- -----------------------------------------------------------------------------
CREATE TABLE usuarios (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre_completo  VARCHAR(255) NOT NULL,
  email            VARCHAR(255) NOT NULL,
  password_hash    VARCHAR(255) NOT NULL,
  numero_documento VARCHAR(20)  NULL COMMENT 'Cédula. La usa la integración de nómina (desprendibles)',
  activo           BOOLEAN      NOT NULL DEFAULT TRUE COMMENT 'Baja lógica: no se borran usuarios',
  ultimo_acceso    TIMESTAMP    NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_email (email),
  UNIQUE KEY uq_usuarios_documento (numero_documento),
  KEY idx_usuarios_activo (activo)
) ENGINE=InnoDB;

-- Un usuario puede tener varios roles, y un rol lo tienen varios usuarios.
CREATE TABLE usuario_roles (
  usuario_id     INT UNSIGNED      NOT NULL,
  rol_id         SMALLINT UNSIGNED NOT NULL,
  asignado_por_id INT UNSIGNED     NULL COMMENT 'Quién otorgó el rol. NULL = seed inicial',
  asignado_en    TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id, rol_id),
  KEY idx_usuario_roles_rol (rol_id),
  CONSTRAINT fk_usuario_roles_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE,
  CONSTRAINT fk_usuario_roles_rol
    FOREIGN KEY (rol_id) REFERENCES roles (id) ON DELETE RESTRICT,
  CONSTRAINT fk_usuario_roles_asignado_por
    FOREIGN KEY (asignado_por_id) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Permisos efectivos de un usuario = unión de los permisos de todos sus roles.
CREATE OR REPLACE VIEW v_usuario_permisos AS
SELECT DISTINCT
  ur.usuario_id,
  p.id     AS permiso_id,
  p.codigo AS permiso_codigo,
  p.modulo
FROM usuario_roles ur
JOIN roles r         ON r.id = ur.rol_id AND r.activo = TRUE
JOIN rol_permisos rp ON rp.rol_id = r.id
JOIN permisos p      ON p.id = rp.permiso_id;
