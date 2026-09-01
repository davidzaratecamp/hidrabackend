-- =============================================================================
-- 003 — Candidatos, historial de estado y asignación
-- =============================================================================
-- `hyd_candidatos` tiene hoy 123 columnas. Aquí queda solo lo que carga el
-- reclutador al registrar y lo que controla el proceso. Todo lo demás se movió
-- a su propia tabla (004, 005, 006).
--
-- Columnas del esquema viejo que NO se reconstruyen:
--   * oleada, oleada_seleccion_id .... módulo muerto: 0 referencias en el código JS
--   * perfil ......................... la columna del Excel se emite siempre vacía
--   * nacionalidad ................... derivada de tipo_documento (ver 002)
--   * citado_gestion ................. "citado" ahora es tener una citación (005)
--   * motivo_no_citado ............... queda en candidato_estado_historial.motivo
--   * consentimiento_aceptado ........ derivable: existe la fila de consentimiento
--   * token_acceso, fecha_vencimiento_token, fecha_envio_email .... -> 006
--   * firmacloud_signature_id ........ -> 006
--   * los 6 formulario_*_completado y los 6 fecha_completado_* .... -> tabla propia
--   * los 17 campos de antecedentes .. -> 006
--   * los 9 campos de evaluación ..... -> 005
--   * los 4 campos de aprobación final -> 005
--   * asistio_citacion, fecha_asistencia, motivo_inasistencia, observaciones_seleccion -> 005
--   * los ~37 campos del formulario ... -> 004
-- =============================================================================

CREATE TABLE candidatos (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,

  -- Identidad -----------------------------------------------------------------
  primer_nombre          VARCHAR(100) NOT NULL,
  segundo_nombre         VARCHAR(100) NULL,
  primer_apellido        VARCHAR(100) NOT NULL,
  segundo_apellido       VARCHAR(100) NULL,
  tipo_documento_id      TINYINT UNSIGNED NOT NULL,
  numero_documento       VARCHAR(20)  NULL,
  -- Se captura de viva voz al registrar, antes de que el candidato llene el
  -- formulario. No es derivable de fecha_nacimiento (que llega después, en 004).
  edad                   TINYINT UNSIGNED NULL,

  -- Contacto ------------------------------------------------------------------
  -- Nullable a propósito: hoy, cuando no hay correo, se inventa uno
  -- (`temp_${Date.now()}@noviembrehidra.com`) que después hay que detectar por
  -- substring para rechazarlo. Ausencia se representa con NULL.
  email                  VARCHAR(255) NULL,
  celular                VARCHAR(20)  NOT NULL,
  contacto_llamada       BOOLEAN      NULL,
  contacto_whatsapp      BOOLEAN      NULL,

  -- Proceso -------------------------------------------------------------------
  cliente_id             SMALLINT UNSIGNED NOT NULL,
  cargo_id               SMALLINT UNSIGNED NOT NULL,
  ciudad_id              SMALLINT UNSIGNED NULL,
  fuente_reclutamiento_id SMALLINT UNSIGNED NULL,
  tipificacion_llamada_id SMALLINT UNSIGNED NULL,
  estado_gestion_id      SMALLINT UNSIGNED NULL COMMENT 'Tipificación cuando no se cita al candidato',
  observaciones_generales TEXT        NULL,

  -- Estado y dueño actuales ---------------------------------------------------
  -- Ambos son el hecho vigente; el historial (abajo) es el registro de auditoría.
  estado_id              SMALLINT UNSIGNED NOT NULL,
  reclutador_id          INT UNSIGNED NULL,

  created_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  -- La cédula única se valida hoy solo en el código (`crearCandidato`); aquí la
  -- garantiza la base. NULL no colisiona con NULL en MySQL, así que los
  -- candidatos sin documento no se estorban entre sí.
  UNIQUE KEY uq_candidatos_documento (numero_documento),

  -- El correo SÍ puede repetirse (decisión de negocio, 2026-08-26): un mismo
  -- correo puede pertenecer a varios registros de candidato.
  KEY idx_candidatos_email (email),
  KEY idx_candidatos_celular (celular),

  -- Índices de listado, replicados del análisis de EXPLAIN de las migraciones
  -- 007 y 010 del esquema viejo.
  KEY idx_candidatos_estado_updated (estado_id, updated_at, id),
  KEY idx_candidatos_reclutador_estado (reclutador_id, estado_id, updated_at, id),
  KEY idx_candidatos_cliente_cargo (cliente_id, cargo_id),

  CONSTRAINT fk_candidatos_tipo_documento
    FOREIGN KEY (tipo_documento_id) REFERENCES tipos_documento (id) ON DELETE RESTRICT,
  CONSTRAINT fk_candidatos_cliente
    FOREIGN KEY (cliente_id) REFERENCES clientes (id) ON DELETE RESTRICT,
  CONSTRAINT fk_candidatos_cargo
    FOREIGN KEY (cargo_id) REFERENCES cargos (id) ON DELETE RESTRICT,
  CONSTRAINT fk_candidatos_ciudad
    FOREIGN KEY (ciudad_id) REFERENCES ciudades (id) ON DELETE SET NULL,
  CONSTRAINT fk_candidatos_fuente
    FOREIGN KEY (fuente_reclutamiento_id) REFERENCES fuentes_reclutamiento (id) ON DELETE SET NULL,
  CONSTRAINT fk_candidatos_tipificacion
    FOREIGN KEY (tipificacion_llamada_id) REFERENCES tipificaciones_llamada (id) ON DELETE SET NULL,
  CONSTRAINT fk_candidatos_estado_gestion
    FOREIGN KEY (estado_gestion_id) REFERENCES estados_gestion_reclutamiento (id) ON DELETE SET NULL,
  CONSTRAINT fk_candidatos_estado
    FOREIGN KEY (estado_id) REFERENCES estados_candidato (id) ON DELETE RESTRICT,
  CONSTRAINT fk_candidatos_reclutador
    FOREIGN KEY (reclutador_id) REFERENCES usuarios (id) ON DELETE SET NULL,

  CONSTRAINT ck_candidatos_edad CHECK (edad IS NULL OR edad BETWEEN 14 AND 99)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Historial de estado — registro de auditoría append-only
-- -----------------------------------------------------------------------------
-- Responde "quién movió esto, cuándo y por qué", hoy imposible. Es también la
-- fuente de las analíticas del embudo (tiempo por etapa, conversión), que hoy se
-- aproximan mirando `updated_at`.
CREATE TABLE candidato_estado_historial (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidato_id      INT UNSIGNED NOT NULL,
  estado_anterior_id SMALLINT UNSIGNED NULL COMMENT 'NULL en el registro de creación',
  estado_nuevo_id   SMALLINT UNSIGNED NOT NULL,
  usuario_id        INT UNSIGNED NULL COMMENT 'NULL si lo movió el propio candidato desde el formulario público',
  motivo            TEXT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_historial_candidato (candidato_id, created_at),
  KEY idx_historial_estado_nuevo (estado_nuevo_id, created_at),
  CONSTRAINT fk_historial_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_historial_estado_anterior
    FOREIGN KEY (estado_anterior_id) REFERENCES estados_candidato (id) ON DELETE RESTRICT,
  CONSTRAINT fk_historial_estado_nuevo
    FOREIGN KEY (estado_nuevo_id) REFERENCES estados_candidato (id) ON DELETE RESTRICT,
  CONSTRAINT fk_historial_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Historial de asignación
-- -----------------------------------------------------------------------------
-- Reemplaza `reasignado_por_id` + `fecha_reasignacion`, que solo guardaban la
-- última reasignación y no llevaban FK.
CREATE TABLE candidato_asignaciones (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidato_id       INT UNSIGNED NOT NULL,
  reclutador_anterior_id INT UNSIGNED NULL,
  reclutador_nuevo_id    INT UNSIGNED NULL,
  asignado_por_id    INT UNSIGNED NULL,
  motivo             VARCHAR(255) NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_asignaciones_candidato (candidato_id, created_at),
  CONSTRAINT fk_asignaciones_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_asignaciones_anterior
    FOREIGN KEY (reclutador_anterior_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_asignaciones_nuevo
    FOREIGN KEY (reclutador_nuevo_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_asignaciones_por
    FOREIGN KEY (asignado_por_id) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Progreso del formulario
-- -----------------------------------------------------------------------------
-- Sustituye 12 columnas (6 `formulario_*_completado` + 6 `fecha_completado_*`),
-- que son un grupo repetitivo y por tanto una violación de 1NF. Una fila por
-- paso completado; el progreso es un COUNT.
CREATE TABLE candidato_formulario_pasos (
  candidato_id  INT UNSIGNED NOT NULL,
  paso          ENUM('hoja_vida','datos_basicos','estudios','experiencia','personal','consentimiento') NOT NULL,
  completado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (candidato_id, paso),
  CONSTRAINT fk_formulario_pasos_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE
) ENGINE=InnoDB;
