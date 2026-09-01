-- =============================================================================
-- 004 — Formulario del candidato (los 6 pasos que llena por link con token)
-- =============================================================================
-- Parte de las 6 tablas de la migración 002 del esquema viejo, que ya estaban
-- bien planteadas, y corrige lo que quedó pendiente:
--   * los VARCHAR de catálogo pasan a FK reales
--   * los VARCHAR(10) con 'si'/'no' pasan a BOOLEAN
--   * se eliminan las columnas derivadas (tiempo laborado)
--   * se disuelven los grupos repetitivos (metas, conocimientos informáticos)
--   * la fecha de consentimiento deja de estar partida en 3 columnas
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Paso 1 y 2 — Datos básicos
-- -----------------------------------------------------------------------------
CREATE TABLE candidato_datos_basicos (
  candidato_id           INT UNSIGNED NOT NULL,
  -- Paso 1 "Hoja de vida"
  aspiracion_salarial    DECIMAL(15,2) NULL,
  -- Paso 2 "Datos básicos"
  fecha_nacimiento       DATE NULL,
  estado_civil_id        TINYINT UNSIGNED NULL,
  genero_id              TINYINT UNSIGNED NULL,
  grupo_sanguineo_id     TINYINT UNSIGNED NULL,
  eps_id                 SMALLINT UNSIGNED NULL,
  afp_id                 SMALLINT UNSIGNED NULL,
  talla_camisa_id        TINYINT UNSIGNED NULL,
  direccion_residencial  VARCHAR(255) NULL,
  barrio                 VARCHAR(100) NULL,
  -- Contacto de emergencia
  nombre_emergencia      VARCHAR(100) NULL,
  numero_emergencia      VARCHAR(20)  NULL,
  parentesco_emergencia_id TINYINT UNSIGNED NULL,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (candidato_id),
  CONSTRAINT fk_datos_basicos_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_datos_basicos_estado_civil
    FOREIGN KEY (estado_civil_id) REFERENCES estados_civiles (id) ON DELETE SET NULL,
  CONSTRAINT fk_datos_basicos_genero
    FOREIGN KEY (genero_id) REFERENCES generos (id) ON DELETE SET NULL,
  CONSTRAINT fk_datos_basicos_grupo_sanguineo
    FOREIGN KEY (grupo_sanguineo_id) REFERENCES grupos_sanguineos (id) ON DELETE SET NULL,
  CONSTRAINT fk_datos_basicos_eps
    FOREIGN KEY (eps_id) REFERENCES eps (id) ON DELETE SET NULL,
  CONSTRAINT fk_datos_basicos_afp
    FOREIGN KEY (afp_id) REFERENCES afp (id) ON DELETE SET NULL,
  CONSTRAINT fk_datos_basicos_talla
    FOREIGN KEY (talla_camisa_id) REFERENCES tallas_camisa (id) ON DELETE SET NULL,
  CONSTRAINT fk_datos_basicos_parentesco
    FOREIGN KEY (parentesco_emergencia_id) REFERENCES parentescos (id) ON DELETE SET NULL,
  CONSTRAINT ck_datos_basicos_salario CHECK (aspiracion_salarial IS NULL OR aspiracion_salarial >= 0)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Paso 3 — Estudios
-- -----------------------------------------------------------------------------
CREATE TABLE candidato_estudios (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidato_id       INT UNSIGNED NOT NULL,
  nivel_estudios_id  TINYINT UNSIGNED NOT NULL,
  nombre_institucion VARCHAR(200) NULL,
  titulo_obtenido    VARCHAR(200) NULL,
  -- Era YEAR (rango 1901-2155 y conversiones sorpresivas). SMALLINT + CHECK.
  ano_finalizacion   SMALLINT UNSIGNED NULL,
  -- Solo la usa el nivel "conocimientos_informaticos", que es texto libre.
  descripcion        VARCHAR(500) NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Un candidato no puede repetir nivel. El upsert del repositorio depende de
  -- esta clave: si se elimina, se duplican filas en silencio.
  UNIQUE KEY uq_estudios_candidato_nivel (candidato_id, nivel_estudios_id),
  CONSTRAINT fk_estudios_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_estudios_nivel
    FOREIGN KEY (nivel_estudios_id) REFERENCES niveles_estudios (id) ON DELETE RESTRICT,
  CONSTRAINT ck_estudios_ano CHECK (ano_finalizacion IS NULL OR ano_finalizacion BETWEEN 1950 AND 2100)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Paso 4 — Experiencia laboral
-- -----------------------------------------------------------------------------
CREATE TABLE candidato_experiencias (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidato_id      INT UNSIGNED NOT NULL,
  orden             TINYINT UNSIGNED NOT NULL COMMENT '1 = empresa actual, 2 = anterior',
  nombre_empresa    VARCHAR(200) NULL,
  cargo_desempenado VARCHAR(120) NULL,
  salario           DECIMAL(15,2) NULL,
  funciones         TEXT NULL,
  fecha_inicio      DATE NULL,
  -- NULL significa "actualmente trabajo aquí". Hoy eso se infiere de un campo
  -- vacío, sin bandera explícita; el significado se documenta aquí.
  fecha_retiro      DATE NULL,
  motivo_retiro     TEXT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_experiencias_candidato_orden (candidato_id, orden),
  CONSTRAINT fk_experiencias_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT ck_experiencias_orden CHECK (orden BETWEEN 1 AND 3),
  CONSTRAINT ck_experiencias_fechas CHECK (fecha_retiro IS NULL OR fecha_inicio IS NULL OR fecha_retiro >= fecha_inicio),
  CONSTRAINT ck_experiencias_salario CHECK (salario IS NULL OR salario >= 0)
) ENGINE=InnoDB;
-- Nota: `tiempo_laborado_anos` y `tiempo_laborado_meses` NO se reconstruyen.
-- Son derivables de fecha_inicio/fecha_retiro y hoy pueden desincronizarse.

-- Bloque "reintegros Asiste ING" del paso 4.
CREATE TABLE candidato_experiencia_resumen (
  candidato_id                        INT UNSIGNED NOT NULL,
  ha_trabajado_asiste                 BOOLEAN NULL,
  ha_estado_proceso_formativo_asiste  BOOLEAN NULL,
  experiencia_comercial_certificada   BOOLEAN NULL,
  experiencia_comercial_no_certificada BOOLEAN NULL,
  primer_empleo_formal                BOOLEAN NULL,
  -- Era VARCHAR(100) libre. "Campaña" y "cliente" son el mismo concepto con dos
  -- nombres distintos en el sistema viejo; aquí se unifican.
  campana_asiste_id                   SMALLINT UNSIGNED NULL,
  fecha_inicio_asiste                 DATE NULL,
  fecha_retiro_asiste                 DATE NULL,
  motivo_retiro_asiste                TEXT NULL,
  created_at                          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (candidato_id),
  CONSTRAINT fk_exp_resumen_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_exp_resumen_campana
    FOREIGN KEY (campana_asiste_id) REFERENCES clientes (id) ON DELETE SET NULL,
  CONSTRAINT ck_exp_resumen_fechas CHECK (fecha_retiro_asiste IS NULL OR fecha_inicio_asiste IS NULL OR fecha_retiro_asiste >= fecha_inicio_asiste)
) ENGINE=InnoDB;
-- `tiempo_laborado_asiste` tampoco se reconstruye: derivable de las dos fechas.

-- -----------------------------------------------------------------------------
-- Paso 5 — Información personal
-- -----------------------------------------------------------------------------
CREATE TABLE candidato_personal (
  candidato_id                   INT UNSIGNED NOT NULL,
  genograma                      TEXT NULL COMMENT 'Texto libre: descripción del núcleo familiar',
  fortalezas                     TEXT NULL,
  aspectos_mejorar               TEXT NULL,
  competencias_laborales         TEXT NULL,
  expectativa_laboral            TEXT NULL,
  estado_salud_actual            VARCHAR(150) NULL,
  tratamiento_psicologico_actual BOOLEAN NULL,
  tratamiento_psicologico_detalle TEXT NULL,
  autoevaluacion                 TINYINT UNSIGNED NULL COMMENT 'Escala 1-5 ("CALIFIQUESE DE 1 A 5" del formato)',
  created_at                     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (candidato_id),
  CONSTRAINT fk_personal_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT ck_personal_autoevaluacion CHECK (autoevaluacion IS NULL OR autoevaluacion BETWEEN 1 AND 5)
) ENGINE=InnoDB;

-- `metas_corto_plazo`, `metas_mediano_plazo`, `metas_largo_plazo` son un grupo
-- repetitivo: tres columnas para el mismo hecho con distinto horizonte.
CREATE TABLE candidato_metas (
  candidato_id INT UNSIGNED NOT NULL,
  plazo        ENUM('corto','mediano','largo') NOT NULL,
  descripcion  TEXT NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (candidato_id, plazo),
  CONSTRAINT fk_metas_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Igual con `conocimiento_excel`, `conocimiento_powerpoint`, `conocimiento_word`:
-- agregar una cuarta herramienta dejaba de ser dato y pasaba a ser migración.
CREATE TABLE candidato_conocimientos_informaticos (
  candidato_id  INT UNSIGNED NOT NULL,
  herramienta_id TINYINT UNSIGNED NOT NULL,
  nivel         TINYINT UNSIGNED NOT NULL COMMENT 'Escala 1-5',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (candidato_id, herramienta_id),
  KEY idx_conocimientos_herramienta (herramienta_id),
  CONSTRAINT fk_conocimientos_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_conocimientos_herramienta
    FOREIGN KEY (herramienta_id) REFERENCES herramientas_informaticas (id) ON DELETE RESTRICT,
  CONSTRAINT ck_conocimientos_nivel CHECK (nivel BETWEEN 1 AND 5)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Paso 6 — Consentimiento de tratamiento de datos
-- -----------------------------------------------------------------------------
CREATE TABLE candidato_consentimiento (
  candidato_id INT UNSIGNED NOT NULL,
  ciudad_id    SMALLINT UNSIGNED NULL,
  -- Antes: dia_consentimiento INT + mes_consentimiento INT + ano_consentimiento YEAR
  -- (y los scripts viejos ni siquiera coincidían en el tipo de `mes`).
  fecha        DATE NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (candidato_id),
  CONSTRAINT fk_consentimiento_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_consentimiento_ciudad
    FOREIGN KEY (ciudad_id) REFERENCES ciudades (id) ON DELETE SET NULL
) ENGINE=InnoDB;
-- `consentimiento_aceptado` no se reconstruye: la existencia de esta fila ES el
-- consentimiento.
