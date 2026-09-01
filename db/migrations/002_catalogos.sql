-- =============================================================================
-- 002 — Catálogos
-- =============================================================================
-- Reemplazan las ~370 líneas hardcodeadas de `models/candidato.model.js`
-- (`getOpcionesCatalogo()` y `getEstadosConfig()`).
--
-- Se usan tablas dedicadas y no un par genérico `catalogos`/`catalogo_valores`,
-- porque una FK contra una tabla genérica no restringe A QUÉ catálogo apunta:
-- `candidatos.eps_id` podría terminar apuntando a una AFP sin que la base lo
-- impida. Con tablas dedicadas cada FK queda realmente constreñida.
--
-- Todas siguen la misma forma: (id, codigo, nombre, orden, activo).
--   codigo  -> identificador estable que usa el código
--   nombre  -> etiqueta mostrada al usuario
--   activo  -> baja lógica; nunca se borra un valor ya referenciado
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Identidad y ubicación
-- -----------------------------------------------------------------------------

-- `nacionalidad` NO se guarda en `candidatos`: hoy se deriva del tipo de documento
-- (`tipo_documento === 'CC' ? 'Colombiano' : 'Venezolano'`, hardcodeado en dos
-- archivos distintos). Guardarla en el candidato es una dependencia transitiva
-- (candidato -> tipo_documento -> nacionalidad) que viola 3NF. Vive aquí.
CREATE TABLE tipos_documento (
  id           TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo       VARCHAR(10)  NOT NULL,
  nombre       VARCHAR(80)  NOT NULL,
  nacionalidad VARCHAR(50)  NOT NULL,
  orden        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  activo       BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tipos_documento_codigo (codigo)
) ENGINE=InnoDB;

CREATE TABLE ciudades (
  id     SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(50)  NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  orden  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  activo BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ciudades_codigo (codigo)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Cliente / campaña y cargos
-- -----------------------------------------------------------------------------
CREATE TABLE clientes (
  id     SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(60)  NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  orden  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  activo BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_clientes_codigo (codigo)
) ENGINE=InnoDB;

-- Un cargo existe una sola vez. Hoy el mismo nombre está repetido en cinco
-- arrays distintos (`cargos_staff`, `cargos_claro`, `cargos_obamacare`,
-- `cargos_majority`, `cargos_campanas`), todos compuestos sobre
-- CARGOS_BASE_RECLUTAMIENTO: 'Agente Call Center' aparece en tres, 'Analista De
-- Calidad' en dos. Es una relación M:N, no 1:N.
CREATE TABLE cargos (
  id     SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(120) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  activo BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cargos_codigo (codigo)
) ENGINE=InnoDB;

CREATE TABLE cliente_cargos (
  cliente_id SMALLINT UNSIGNED NOT NULL,
  cargo_id   SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (cliente_id, cargo_id),
  KEY idx_cliente_cargos_cargo (cargo_id),
  CONSTRAINT fk_cliente_cargos_cliente
    FOREIGN KEY (cliente_id) REFERENCES clientes (id) ON DELETE CASCADE,
  CONSTRAINT fk_cliente_cargos_cargo
    FOREIGN KEY (cargo_id) REFERENCES cargos (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Gestión de contacto
-- -----------------------------------------------------------------------------
CREATE TABLE fuentes_reclutamiento (
  id     SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(60)  NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  orden  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  activo BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fuentes_codigo (codigo)
) ENGINE=InnoDB;

-- Catálogo "Observaciones de Llamada" (EditarCandidato.jsx)
CREATE TABLE tipificaciones_llamada (
  id     SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(60)  NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  orden  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  activo BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tipificaciones_codigo (codigo)
) ENGINE=InnoDB;

-- Catálogo "Estado Gestión Reclutamiento" (NuevoCandidato.jsx, cuando Citado = No).
-- `grupo` reproduce los <optgroup> "NO APTO POR:" / "NO INTERESADOS POR:".
CREATE TABLE estados_gestion_reclutamiento (
  id     SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(80)  NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  grupo  VARCHAR(60)  NULL,
  orden  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  activo BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_estados_gestion_codigo (codigo),
  KEY idx_estados_gestion_grupo (grupo)
) ENGINE=InnoDB;

CREATE TABLE motivos_inasistencia (
  id     SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(60)  NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  -- Cuando es TRUE la UI pide un texto libre adicional (el valor "Otra").
  requiere_detalle BOOLEAN NOT NULL DEFAULT FALSE,
  orden  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  activo BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_motivos_inasistencia_codigo (codigo)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Datos personales del candidato
-- -----------------------------------------------------------------------------
CREATE TABLE estados_civiles (
  id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(30) NOT NULL, nombre VARCHAR(60) NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0, activo BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id), UNIQUE KEY uq_estados_civiles_codigo (codigo)
) ENGINE=InnoDB;

CREATE TABLE generos (
  id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(30) NOT NULL, nombre VARCHAR(60) NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0, activo BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id), UNIQUE KEY uq_generos_codigo (codigo)
) ENGINE=InnoDB;

CREATE TABLE grupos_sanguineos (
  id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(10) NOT NULL, nombre VARCHAR(10) NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0, activo BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id), UNIQUE KEY uq_grupos_sanguineos_codigo (codigo)
) ENGINE=InnoDB;

CREATE TABLE eps (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(60) NOT NULL, nombre VARCHAR(100) NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0, activo BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id), UNIQUE KEY uq_eps_codigo (codigo)
) ENGINE=InnoDB;

CREATE TABLE afp (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(60) NOT NULL, nombre VARCHAR(100) NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0, activo BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id), UNIQUE KEY uq_afp_codigo (codigo)
) ENGINE=InnoDB;

CREATE TABLE parentescos (
  id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(30) NOT NULL, nombre VARCHAR(60) NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0, activo BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id), UNIQUE KEY uq_parentescos_codigo (codigo)
) ENGINE=InnoDB;

CREATE TABLE tallas_camisa (
  id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(10) NOT NULL, nombre VARCHAR(30) NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0, activo BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id), UNIQUE KEY uq_tallas_camisa_codigo (codigo)
) ENGINE=InnoDB;

-- Los 4 niveles fijos del bloque "INFORMACIÓN ACADEMICA" del formato oficial.
-- OJO: `codigo` está acoplado a coordenadas fijas de `plantilla/hojavida.pdf`
-- (`hojaVidaPdfService.js`, mapa NIVEL_ROWS). Cambiar un código sin tocar el
-- servicio de PDF deja esa fila del formato en blanco, sin error.
CREATE TABLE niveles_estudios (
  id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(40) NOT NULL, nombre VARCHAR(80) NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0, activo BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id), UNIQUE KEY uq_niveles_estudios_codigo (codigo)
) ENGINE=InnoDB;

-- Excel / PowerPoint / Word dejan de ser 3 columnas repetidas en `personal`.
CREATE TABLE herramientas_informaticas (
  id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(30) NOT NULL, nombre VARCHAR(60) NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0, activo BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id), UNIQUE KEY uq_herramientas_codigo (codigo)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Estados del candidato y máquina de estados
-- -----------------------------------------------------------------------------
-- Sustituye al ENUM de 17 valores y a `getEstadosConfig()` (etiqueta, color,
-- descripción, todo en JS).
CREATE TABLE estados_candidato (
  id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo      VARCHAR(40)  NOT NULL,
  nombre      VARCHAR(80)  NOT NULL,
  descripcion VARCHAR(255) NULL,
  color       VARCHAR(60)  NULL COMMENT 'Clases de Tailwind usadas por el frontend',
  etapa       ENUM('contacto','formularios','entrevista','evaluacion','decision','cierre') NOT NULL,
  orden       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  es_terminal BOOLEAN      NOT NULL DEFAULT FALSE COMMENT 'No admite transiciones de salida',
  activo      BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_estados_candidato_codigo (codigo),
  KEY idx_estados_candidato_etapa (etapa)
) ENGINE=InnoDB;

-- La máquina de estados vive en la base, no en un `if` del controller.
-- Hoy `PUT /cambiar-estado/:id` acepta cualquier estado desde cualquier otro.
CREATE TABLE estado_transiciones (
  estado_origen_id  SMALLINT UNSIGNED NOT NULL,
  estado_destino_id SMALLINT UNSIGNED NOT NULL,
  requiere_motivo   BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (estado_origen_id, estado_destino_id),
  KEY idx_estado_transiciones_destino (estado_destino_id),
  CONSTRAINT fk_transiciones_origen
    FOREIGN KEY (estado_origen_id) REFERENCES estados_candidato (id) ON DELETE CASCADE,
  CONSTRAINT fk_transiciones_destino
    FOREIGN KEY (estado_destino_id) REFERENCES estados_candidato (id) ON DELETE CASCADE,
  CONSTRAINT ck_transiciones_no_reflexiva CHECK (estado_origen_id <> estado_destino_id)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Catálogos de selección y documentos
-- -----------------------------------------------------------------------------
-- Los 5 criterios de entrevista dejan de ser 5 columnas: agregar o quitar uno
-- pasa a ser un INSERT, no una migración de esquema.
CREATE TABLE criterios_evaluacion (
  id             TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo         VARCHAR(40)  NOT NULL,
  nombre         VARCHAR(80)  NOT NULL,
  puntaje_maximo DECIMAL(5,2) NOT NULL,
  orden          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  activo         BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_criterios_codigo (codigo),
  CONSTRAINT ck_criterios_maximo CHECK (puntaje_maximo > 0)
) ENGINE=InnoDB;

-- ADRES / Policía / Comprobación / Procuraduría. Sustituye las 17 columnas
-- repetidas de la migración 011 del esquema viejo.
CREATE TABLE tipos_antecedente (
  id     TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(30)  NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  orden  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  activo BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tipos_antecedente_codigo (codigo)
) ENGINE=InnoDB;

CREATE TABLE tipos_documento_adjunto (
  id     TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(40)  NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  orden  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  activo BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tipos_documento_adjunto_codigo (codigo)
) ENGINE=InnoDB;
