-- =============================================================================
-- MIGRACION UNICA DE PRODUCCION -- esquema completo de `ReclutamientoNuevo`
-- desde cero
-- =============================================================================
-- Generado a partir de db/migrations/001..009 + db/seeds/001..003, concatenados
-- en el mismo orden en que los aplica `db/migrate.js`, mas el seed de abajo
-- (usuario administrador real de produccion -- no el de
-- db/seeds/004_usuario_admin.sql, que trae una contrasena publica apta solo
-- para desarrollo local).
--
-- NO editar migrations/ ni seeds/ para regenerar este archivo. Si el esquema
-- cambia, se genera de nuevo con el mismo procedimiento (ver
-- restructuracion.md, parrafos 4 y 7 fase 2). Este archivo es un artefacto de
-- despliegue; la fuente de verdad sigue siendo db/migrations/ + db/seeds/.
--
-- COMO USARLO
-- -----------
-- 1. Crear la base una sola vez (nombre acordado para produccion:
--    `ReclutamientoNuevo`, el mismo DB_NAME que ya usa el .env de desarrollo
--    -- distinto del diseno original de restructuracion.md, que proponia
--    `hidra`; se mantuvo `ReclutamientoNuevo` por consistencia con el entorno
--    ya en uso):
--
--      CREATE DATABASE IF NOT EXISTS `ReclutamientoNuevo`
--        CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
--
-- 2. Ejecutar este archivo completo sobre esa base, con un cliente que hable
--    utf8mb4 (igual que hace db/migrate.js -- evita el problema de
--    codificacion documentado ahi: los acentos se corrompen si el cliente
--    `mysql` de consola usa la code page del terminal en vez de UTF-8):
--
--      mysql --default-character-set=utf8mb4 -u <usuario> -p ReclutamientoNuevo < db/produccion-inicial.sql
--
-- 3. Este script deja registradas las 9 migraciones en `migraciones_aplicadas`
--    con el mismo checksum que calcula db/migrate.js sobre los archivos
--    actuales de db/migrations/. Asi, si despues corres `node db/migrate.js`
--    contra esta misma base (por ejemplo el dia que exista una migracion 010),
--    el runner reconoce las 9 como ya aplicadas y no intenta reejecutarlas ni
--    falla por checksum.
--
-- 4. Inicia sesion con el usuario administrador creado al final de este
--    archivo (bloque "Usuario administrador de produccion") y cambia la
--    contrasena desde la aplicacion de inmediato. Esa contrasena se genero una
--    sola vez para esta entrega y queda en texto plano en este archivo -- si
--    se commitea al repo, deja de ser secreta. No reutilizarla despues de la
--    primera rotacion. Antes de considerar esto listo para produccion real,
--    revisar tambien la seccion 8 de restructuracion.md (JWT_SECRET sin
--    fallback, rotacion de credenciales, usuario de base dedicado sin
--    privilegios de root, cierre del puerto 3306, HTTPS, rate limiting).
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- migrations/001_control_y_acceso.sql
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- migrations/002_catalogos.sql
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- migrations/003_candidatos.sql
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- migrations/004_formulario_candidato.sql
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- migrations/005_seleccion.sql
-- -----------------------------------------------------------------------------
-- =============================================================================
-- 005 — Citación, asistencia, evaluación y decisión final
-- =============================================================================
-- Corrige el problema estructural central del sistema viejo: el avance del
-- candidato vivía repartido en cuatro columnas paralelas de `hyd_candidatos`
-- (`estado`, `citado_gestion`, `asistio_citacion`, `aprobacion_final`), y la
-- fecha de la cita era una columna suelta que quedó sin ningún escritor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Citaciones
-- -----------------------------------------------------------------------------
-- Es 1:N a propósito: reagendar crea una citación nueva en vez de pisar la
-- anterior. "Citado" deja de ser una bandera y pasa a ser un hecho verificable
-- (existe una citación vigente), así que ya no es posible quedar en estado
-- 'citado' sin fecha, ni tener fecha sin estar citado.
CREATE TABLE candidato_citaciones (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidato_id           INT UNSIGNED NOT NULL,
  fecha_citacion         DATETIME NOT NULL,
  agendado_por_id        INT UNSIGNED NULL,

  asistio                ENUM('pendiente','asistio','no_asistio') NOT NULL DEFAULT 'pendiente',
  fecha_asistencia       DATETIME NULL,
  registrado_por_id      INT UNSIGNED NULL COMMENT 'Quién marcó la asistencia',
  motivo_inasistencia_id SMALLINT UNSIGNED NULL,
  motivo_inasistencia_detalle VARCHAR(255) NULL COMMENT 'Texto libre cuando el motivo lo exige',
  observaciones          TEXT NULL,

  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_citaciones_candidato (candidato_id, fecha_citacion),
  -- Índice de la pantalla "Candidatos" de Selección, equivalente al analizado
  -- con EXPLAIN en la migración 010 del esquema viejo.
  KEY idx_citaciones_fecha_asistio (fecha_citacion, asistio, id),
  CONSTRAINT fk_citaciones_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_citaciones_agendado_por
    FOREIGN KEY (agendado_por_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_citaciones_registrado_por
    FOREIGN KEY (registrado_por_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_citaciones_motivo
    FOREIGN KEY (motivo_inasistencia_id) REFERENCES motivos_inasistencia (id) ON DELETE RESTRICT,
  -- Un motivo de inasistencia solo tiene sentido si no asistió.
  CONSTRAINT ck_citaciones_motivo_coherente
    CHECK (motivo_inasistencia_id IS NULL OR asistio = 'no_asistio'),
  -- La fecha de asistencia solo existe una vez resuelta la citación.
  CONSTRAINT ck_citaciones_fecha_asistencia
    CHECK (fecha_asistencia IS NULL OR asistio <> 'pendiente')
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Evaluación de entrevista
-- -----------------------------------------------------------------------------
CREATE TABLE candidato_evaluaciones (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidato_id   INT UNSIGNED NOT NULL,
  citacion_id    INT UNSIGNED NULL COMMENT 'Entrevista que originó la evaluación',
  evaluador_id   INT UNSIGNED NULL,
  aprobado       BOOLEAN NOT NULL COMMENT 'Decisión registrada, derivada del umbral al momento de evaluar',
  razon_rechazo  TEXT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_evaluaciones_candidato (candidato_id, created_at),
  CONSTRAINT fk_evaluaciones_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_evaluaciones_citacion
    FOREIGN KEY (citacion_id) REFERENCES candidato_citaciones (id) ON DELETE SET NULL,
  CONSTRAINT fk_evaluaciones_evaluador
    FOREIGN KEY (evaluador_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  -- Rechazar exige justificar. Hoy `razon_rechazo` es opcional aunque el estado
  -- pase a 'rechazado'.
  CONSTRAINT ck_evaluaciones_razon
    CHECK (aprobado = TRUE OR razon_rechazo IS NOT NULL)
) ENGINE=InnoDB;

-- Un puntaje por criterio, en filas. Antes eran 5 columnas fijas
-- (`evaluacion_saludo`, `_perfilamiento`, `_producto`, `_objeciones`, `_cierre`).
CREATE TABLE evaluacion_puntajes (
  evaluacion_id INT UNSIGNED NOT NULL,
  criterio_id   TINYINT UNSIGNED NOT NULL,
  puntaje       DECIMAL(5,2) NOT NULL,
  PRIMARY KEY (evaluacion_id, criterio_id),
  KEY idx_puntajes_criterio (criterio_id),
  CONSTRAINT fk_puntajes_evaluacion
    FOREIGN KEY (evaluacion_id) REFERENCES candidato_evaluaciones (id) ON DELETE CASCADE,
  CONSTRAINT fk_puntajes_criterio
    FOREIGN KEY (criterio_id) REFERENCES criterios_evaluacion (id) ON DELETE RESTRICT,
  CONSTRAINT ck_puntajes_no_negativo CHECK (puntaje >= 0)
) ENGINE=InnoDB;

-- `evaluacion_total` NO es una columna. Hoy el cliente envía el total y el
-- backend lo guarda sin recalcular, así que se puede mandar total=100 con los
-- cinco criterios en cero. Aquí el total es, por definición, la suma.
CREATE OR REPLACE VIEW v_evaluacion_totales AS
SELECT
  e.id              AS evaluacion_id,
  e.candidato_id,
  SUM(ep.puntaje)   AS total,
  SUM(c.puntaje_maximo) AS total_maximo,
  ROUND(100 * SUM(ep.puntaje) / NULLIF(SUM(c.puntaje_maximo), 0), 2) AS porcentaje
FROM candidato_evaluaciones e
JOIN evaluacion_puntajes ep    ON ep.evaluacion_id = e.id
JOIN criterios_evaluacion c    ON c.id = ep.criterio_id
GROUP BY e.id, e.candidato_id;

-- -----------------------------------------------------------------------------
-- Decisión final del psicólogo
-- -----------------------------------------------------------------------------
CREATE TABLE candidato_decision_final (
  candidato_id INT UNSIGNED NOT NULL,
  aprobacion   BOOLEAN NOT NULL,
  razon        TEXT NULL,
  psicologo_id INT UNSIGNED NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (candidato_id),
  KEY idx_decision_aprobacion (aprobacion),
  CONSTRAINT fk_decision_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_decision_psicologo
    FOREIGN KEY (psicologo_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT ck_decision_razon CHECK (aprobacion = TRUE OR razon IS NOT NULL)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- migrations/006_documentos_y_comunicaciones.sql
-- -----------------------------------------------------------------------------
-- =============================================================================
-- 006 — Documentos, antecedentes, tokens, firma y correos
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Archivos subidos
-- -----------------------------------------------------------------------------
-- Una sola tabla para todo archivo asociado a un candidato. Hoy el nombre en
-- disco y el nombre original viven como dos columnas por cada tipo de documento
-- dentro de `hyd_candidatos`.
CREATE TABLE candidato_documentos (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidato_id   INT UNSIGNED NOT NULL,
  tipo_id        TINYINT UNSIGNED NOT NULL,
  ruta_archivo   VARCHAR(255) NOT NULL COMMENT 'Nombre uuid en disco, relativo a uploads/',
  nombre_original VARCHAR(255) NOT NULL COMMENT 'Solo para mostrar y para el Content-Disposition (sanear antes de emitir)',
  mime_type      VARCHAR(100) NOT NULL,
  tamano_bytes   INT UNSIGNED NOT NULL,
  subido_por_id  INT UNSIGNED NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_documentos_ruta (ruta_archivo),
  KEY idx_documentos_candidato (candidato_id, tipo_id),
  CONSTRAINT fk_documentos_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_documentos_tipo
    FOREIGN KEY (tipo_id) REFERENCES tipos_documento_adjunto (id) ON DELETE RESTRICT,
  CONSTRAINT fk_documentos_subido_por
    FOREIGN KEY (subido_por_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT ck_documentos_tamano CHECK (tamano_bytes > 0)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Antecedentes
-- -----------------------------------------------------------------------------
-- Cuatro filas donde el esquema viejo tenía 17 columnas repetidas
-- (`antecedentes_adres_*`, `_pol_*`, `_comp_*`, `_procu_*`). Agregar una quinta
-- verificación pasa a ser un INSERT en `tipos_antecedente`.
CREATE TABLE candidato_antecedentes (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidato_id        INT UNSIGNED NOT NULL,
  tipo_antecedente_id TINYINT UNSIGNED NOT NULL,
  estado              ENUM('aprobado','no_aprobado') NOT NULL,
  novedad             VARCHAR(255) NULL,
  documento_id        INT UNSIGNED NULL,
  verificado_por_id   INT UNSIGNED NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_antecedentes_candidato_tipo (candidato_id, tipo_antecedente_id),
  KEY idx_antecedentes_documento (documento_id),
  CONSTRAINT fk_antecedentes_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_antecedentes_tipo
    FOREIGN KEY (tipo_antecedente_id) REFERENCES tipos_antecedente (id) ON DELETE RESTRICT,
  CONSTRAINT fk_antecedentes_documento
    FOREIGN KEY (documento_id) REFERENCES candidato_documentos (id) ON DELETE SET NULL,
  CONSTRAINT fk_antecedentes_verificado_por
    FOREIGN KEY (verificado_por_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  -- "No aprobado" exige novedad. Hoy la regla vive solo en el controller.
  CONSTRAINT ck_antecedentes_novedad
    CHECK (estado = 'aprobado' OR novedad IS NOT NULL)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Tokens del formulario público
-- -----------------------------------------------------------------------------
-- Sustituye `token_acceso` + `fecha_vencimiento_token` + `fecha_envio_email`.
-- Al ser 1:N se conserva el historial de envíos y un token anterior queda
-- explícitamente revocado, en vez de sobrescrito: eso es lo que hoy produce el
-- "404 Token inválido" confuso al abrir el link de un correo anterior.
CREATE TABLE candidato_tokens_formulario (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidato_id   INT UNSIGNED NOT NULL,
  token          CHAR(36) NOT NULL COMMENT 'UUID v4',
  enviado_por_id INT UNSIGNED NULL,
  enviado_en     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_en      TIMESTAMP NOT NULL,
  usado_en       TIMESTAMP NULL COMMENT 'Momento en que se completó el paso 6',
  revocado_en    TIMESTAMP NULL COMMENT 'Se fija al emitir un token nuevo',
  PRIMARY KEY (id),
  UNIQUE KEY uq_tokens_token (token),
  KEY idx_tokens_candidato (candidato_id, enviado_en),
  CONSTRAINT fk_tokens_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_tokens_enviado_por
    FOREIGN KEY (enviado_por_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT ck_tokens_expira CHECK (expira_en > enviado_en)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Firma electrónica (FirmaCloud)
-- -----------------------------------------------------------------------------
-- Sustituye `firmacloud_signature_id VARCHAR(36)`. Hydra no guarda copia de los
-- documentos firmados: se consultan y descargan en vivo del proveedor.
CREATE TABLE candidato_firmas (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidato_id       INT UNSIGNED NOT NULL,
  proveedor          VARCHAR(40) NOT NULL DEFAULT 'firmacloud',
  referencia_externa VARCHAR(64) NOT NULL COMMENT 'ID que devuelve el proveedor',
  estado             VARCHAR(40) NULL COMMENT 'Último estado consultado al proveedor',
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_firmas_proveedor_referencia (proveedor, referencia_externa),
  KEY idx_firmas_candidato (candidato_id, created_at),
  CONSTRAINT fk_firmas_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Registro de correos enviados
-- -----------------------------------------------------------------------------
-- Cierra la degradación silenciosa actual: si faltan credenciales o `sendMail`
-- falla, el servicio devuelve { success: true, message: 'Email simulado...' } y
-- el usuario ve "Email reenviado exitosamente" aunque no haya salido nada.
CREATE TABLE envios_email (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidato_id INT UNSIGNED NULL,
  destinatario VARCHAR(255) NOT NULL,
  tipo         ENUM('formularios','notificacion_completado') NOT NULL,
  estado       ENUM('enviado','fallido') NOT NULL,
  error        TEXT NULL,
  enviado_por_id INT UNSIGNED NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_envios_candidato (candidato_id, created_at),
  KEY idx_envios_estado (estado, created_at),
  CONSTRAINT fk_envios_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE SET NULL,
  CONSTRAINT fk_envios_enviado_por
    FOREIGN KEY (enviado_por_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT ck_envios_error CHECK (estado = 'enviado' OR error IS NOT NULL)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- migrations/007_perfil_y_citado.sql
-- -----------------------------------------------------------------------------
-- =============================================================================
-- 007 — `perfil` y `citado` en el registro del candidato
-- =============================================================================
-- La migración 003 descartó ambas columnas del esquema viejo con esta nota:
--
--   * perfil ......... la columna del Excel se emite siempre vacía
--   * citado_gestion . "citado" ahora es tener una citación (005)
--
-- Ambas se reincorporan por decisión de negocio (2026-08-30): el formulario de
-- registro sigue el orden exacto del Excel oficial "BASE RECLUTAMIENTO", y esas
-- dos columnas son parte del formato. La reclutadora las diligencia al
-- registrar, antes de que exista cualquier citación.
--
-- `citado` NO reemplaza a `candidato_citaciones` (005), que sigue siendo el
-- hecho real de la agenda de Selección. Es la gestión de la reclutadora: "logré
-- citarlo". El Excel prefiere este dato cuando está diligenciado y cae a la
-- citación real cuando no, para que la columna nunca contradiga a quien la
-- llenó a mano.
-- =============================================================================

ALTER TABLE candidatos
  -- VARCHAR(255) igual que `hyd_candidatos.perfil`: los valores del archivo
  -- histórico caben sin truncarse si algún día se comparan.
  ADD COLUMN perfil VARCHAR(255) NULL
    COMMENT 'Perfil del candidato. Columna PERFIL del Excel oficial'
    AFTER observaciones_generales,

  -- BOOLEAN NULL, no NOT NULL DEFAULT FALSE: hay que poder distinguir "todavía
  -- no se gestionó" de "se gestionó y no se logró citar". El esquema viejo usaba
  -- enum('si','no') NULL, con la misma tercera posibilidad implícita.
  ADD COLUMN citado BOOLEAN NULL
    COMMENT 'Gestión de la reclutadora: si logró citar al candidato. La citación real vive en candidato_citaciones'
    AFTER perfil;

-- -----------------------------------------------------------------------------
-- migrations/008_retirar_tipificacion_contacto_exitoso.sql
-- -----------------------------------------------------------------------------
-- =============================================================================
-- 008 — Se retira la tipificación de llamada "Contacto exitoso"
-- =============================================================================
-- Decisión de negocio (2026-08-30): deja de ser una opción del formulario de
-- registro. El seed 003 ya no la inserta; esta migración se encarga de las bases
-- que la tienen sembrada.
--
-- Se DESACTIVA en vez de borrarse. Los catálogos tienen `activo` justamente para
-- esto: `catalogo.repository` solo lista y resuelve códigos con `activo = TRUE`,
-- así que desactivarla la saca del desplegable y hace que el backend rechace el
-- valor, mientras los candidatos que ya la tengan asignada conservan su
-- referencia intacta. Un DELETE los rompería (o fallaría por la clave foránea).
-- =============================================================================

UPDATE tipificaciones_llamada
   SET activo = FALSE
 WHERE codigo = 'Contacto exitoso';

-- -----------------------------------------------------------------------------
-- migrations/009_citar_sin_fecha.sql
-- -----------------------------------------------------------------------------
-- =============================================================================
-- 009 — Citar deja de llevar fecha, y se puede citar al registrar
-- =============================================================================
-- Decisión de negocio (2026-08-30). Dos cambios que van juntos:
--
--   1. Citar a un candidato ya no es agendar una fecha y hora: es marcarlo como
--      citado. La citación sigue existiendo como hecho (quién citó, cuándo, y
--      luego si asistió), pero sin fecha de entrevista. `created_at` pasa a ser
--      el ancla temporal: la fecha EN QUE se citó, que es la que el equipo usa
--      para el reporte y para ordenar la agenda.
--
--   2. La reclutadora cita desde el formulario de registro (Citado = Sí), sin
--      pasar por Selección. Eso exige la transición `nuevo -> citado`, que no
--      existía: hasta ahora solo se llegaba a `citado` desde
--      `formularios_completados` o desde `no_asistio`.
--
-- Se elimina la columna en vez de dejarla nullable: nadie volvería a escribirla
-- y una columna muerta en la tabla del embudo es exactamente el tipo de cosa que
-- la reestructuración vino a quitar. Los índices que la usaban se rehacen sobre
-- `created_at`, que es lo que ahora ordena y filtra.
-- =============================================================================

ALTER TABLE candidato_citaciones
  DROP INDEX idx_citaciones_candidato,
  DROP INDEX idx_citaciones_fecha_asistio,
  DROP COLUMN fecha_citacion,
  ADD KEY idx_citaciones_candidato (candidato_id, created_at),
  -- Índice de la agenda de Selección: mismo propósito que el anterior, sobre la
  -- columna que ahora ordena el listado.
  ADD KEY idx_citaciones_created_asistio (created_at, asistio, id);

-- -----------------------------------------------------------------------------
-- Transición nueva: se cita al registrar
-- -----------------------------------------------------------------------------
-- `INSERT IGNORE` para que la migración sea idempotente y no choque con la clave
-- primaria (origen, destino) si el seed ya la trajera en una base recreada.
INSERT IGNORE INTO estado_transiciones (estado_origen_id, estado_destino_id, requiere_motivo)
SELECT o.id, d.id, FALSE
  FROM estados_candidato o
  JOIN estados_candidato d
 WHERE o.codigo = 'nuevo' AND d.codigo = 'citado';

-- -----------------------------------------------------------------------------
-- seeds/001_roles_y_permisos.sql
-- -----------------------------------------------------------------------------
-- =============================================================================
-- SEED 001 — Roles y permisos
-- =============================================================================
-- Reemplaza la matriz hardcodeada de `models/usuario.model.js:getPermisosRol()`.
--
-- Nombres de rol: se conservan los tres actuales. El código del rol de
-- reclutamiento pasa de `reclutador` (esquema viejo) a `reclutamiento`.
-- =============================================================================

INSERT INTO roles (codigo, nombre, descripcion) VALUES
  ('administrador', 'Administrador', 'Acceso completo al sistema'),
  ('seleccion',     'Selección',     'Área de selección y psicología: entrevistas, evaluación y decisión final'),
  ('reclutamiento', 'Reclutamiento', 'Registro y gestión de candidatos propios');

INSERT INTO permisos (codigo, nombre, descripcion, modulo) VALUES
  ('ver_dashboard',             'Ver dashboard',              'Acceder al panel principal',                         'dashboard'),
  ('ver_estadisticas',          'Ver estadísticas',           'Ver métricas y analíticas del embudo',               'dashboard'),
  ('ver_candidatos',            'Ver candidatos',             'Consultar listados y perfiles de candidatos',        'candidatos'),
  ('crear_candidatos',          'Crear candidatos',           'Registrar candidatos nuevos',                        'candidatos'),
  ('editar_candidatos',         'Editar candidatos',          'Modificar datos de un candidato',                    'candidatos'),
  ('eliminar_candidatos',       'Eliminar candidatos',        'Dar de baja un candidato',                           'candidatos'),
  ('reasignar_candidatos',      'Reasignar candidatos',       'Transferir un candidato a otro reclutador',           'candidatos'),
  ('editar_estados_candidatos', 'Editar estados',             'Cambiar el estado de un candidato en el embudo',      'candidatos'),
  ('ver_perfiles_completos',    'Ver perfiles completos',     'Ver el formulario completo del candidato',            'candidatos'),
  ('reenviar_emails',           'Reenviar formularios',       'Emitir un token nuevo y reenviar el correo',          'candidatos'),
  ('agendar_entrevistas',       'Agendar entrevistas',        'Crear y reagendar citaciones',                        'seleccion'),
  ('registrar_asistencia',      'Registrar asistencia',       'Marcar si el candidato asistió a la entrevista',      'seleccion'),
  ('evaluar_candidatos',        'Evaluar candidatos',         'Registrar la evaluación de la entrevista',            'seleccion'),
  ('tomar_decision_final',      'Tomar decisión final',       'Aprobar o rechazar definitivamente a un candidato',   'seleccion'),
  ('gestionar_antecedentes',    'Gestionar antecedentes',     'Registrar verificaciones y subir soportes',           'seleccion'),
  ('ver_reportes',              'Ver reportes',               'Consultar reportes del sistema',                      'reportes'),
  ('generar_reportes_seleccion','Generar reportes',           'Exportar la base a Excel',                            'reportes'),
  ('ver_usuarios',              'Ver usuarios',               'Consultar el listado de usuarios',                    'usuarios'),
  ('crear_usuarios',            'Crear usuarios',             'Dar de alta usuarios',                                'usuarios'),
  ('editar_usuarios',           'Editar usuarios',            'Modificar usuarios y sus roles',                       'usuarios'),
  ('eliminar_usuarios',         'Eliminar usuarios',          'Dar de baja usuarios',                                'usuarios');

-- -----------------------------------------------------------------------------
-- Administrador: todos los permisos.
-- (En el sistema viejo el rol tenía 14 de 17 pese a estar documentado como
-- "acceso completo": le faltaban editar_estados_candidatos, ver_perfiles_completos
-- y generar_reportes_seleccion. Aquí se corrige.)
-- -----------------------------------------------------------------------------
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permisos p WHERE r.codigo = 'administrador';

-- -----------------------------------------------------------------------------
-- Reclutamiento: gestiona sus propios candidatos, sin acceso a usuarios.
-- Registra la asistencia a la entrevista (decisión de negocio, 2026-08-31:
-- antes era Selección quien la marcaba; ahora es Reclutamiento, que es quien
-- cita y hace seguimiento del candidato). También gestiona antecedentes desde
-- el registro del candidato (2026-08-31), sin esperar a que pase por Selección.
-- Descarga el Excel de su propia cartera (decisión de negocio, 2026-09-01):
-- mismo permiso que Selección, la visibilidad por dueño ya limita el export a
-- solo sus candidatos (ver `visibilidad.js`).
-- -----------------------------------------------------------------------------
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p
WHERE r.codigo = 'reclutamiento' AND p.codigo IN (
  'ver_dashboard', 'ver_estadisticas', 'ver_candidatos', 'crear_candidatos',
  'editar_candidatos', 'reasignar_candidatos', 'reenviar_emails', 'agendar_entrevistas',
  'registrar_asistencia', 'gestionar_antecedentes', 'generar_reportes_seleccion'
);

-- -----------------------------------------------------------------------------
-- Selección: todo el proceso posterior a la asistencia, sin gestión de
-- usuarios. Ya NO registra asistencia (pasó a Reclutamiento, ver arriba), NI
-- registra candidatos nuevos, NI agenda entrevistas (decisiones de negocio,
-- 2026-09-01): eso es trabajo exclusivo de Reclutamiento — Selección solo
-- gestiona lo que ya existe (evalúa y decide).
-- -----------------------------------------------------------------------------
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p
WHERE r.codigo = 'seleccion' AND p.codigo IN (
  'ver_dashboard', 'ver_estadisticas', 'ver_candidatos',
  'editar_candidatos', 'editar_estados_candidatos', 'ver_perfiles_completos',
  'reasignar_candidatos', 'reenviar_emails',
  'evaluar_candidatos', 'tomar_decision_final',
  'gestionar_antecedentes', 'generar_reportes_seleccion'
);

-- -----------------------------------------------------------------------------
-- seeds/002_estados_y_transiciones.sql
-- -----------------------------------------------------------------------------
-- =============================================================================
-- SEED 002 — Estados del candidato y máquina de estados
-- =============================================================================
-- Los 17 estados del ENUM viejo, con las etiquetas y colores que hoy viven en
-- `models/candidato.model.js:getEstadosConfig()`.
-- =============================================================================

INSERT INTO estados_candidato (codigo, nombre, descripcion, color, etapa, orden, es_terminal) VALUES
  ('nuevo',                   'Nuevo',                   'Candidato registrado, sin gestionar',                 'bg-gray-100 text-gray-800',       'contacto',    10, FALSE),
  ('contacto_fallido',        'Contacto Fallido',        'No se logró establecer contacto',                     'bg-red-100 text-red-800',         'contacto',    20, FALSE),
  ('no_contesta',             'No Contesta',             'El candidato no responde las llamadas',               'bg-orange-100 text-orange-800',   'contacto',    30, FALSE),
  ('reagendar',               'Reagendar',               'Se debe volver a contactar más adelante',             'bg-yellow-100 text-yellow-800',   'contacto',    40, FALSE),
  ('no_interesado',           'No Interesado',           'El candidato no está interesado en la vacante',       'bg-red-100 text-red-800',         'contacto',    50, TRUE),
  ('numero_incorrecto',       'Número Incorrecto',       'El número de contacto no corresponde',                'bg-red-100 text-red-800',         'contacto',    60, TRUE),
  ('contacto_exitoso',        'Contacto Exitoso',        'Se estableció contacto y hay interés',                'bg-blue-100 text-blue-800',       'contacto',    70, FALSE),
  ('formularios_enviados',    'Formularios Enviados',    'Se envió el link del formulario al candidato',        'bg-indigo-100 text-indigo-800',   'formularios', 80, FALSE),
  ('formularios_completados', 'Formularios Completados', 'El candidato completó los 6 pasos',                   'bg-purple-100 text-purple-800',   'formularios', 90, FALSE),
  ('citado',                  'Citado',                  'Tiene entrevista agendada',                           'bg-cyan-100 text-cyan-800',       'entrevista', 100, FALSE),
  ('no_asistio',              'No Asistió',              'No se presentó a la entrevista',                      'bg-red-100 text-red-800',         'entrevista', 110, FALSE),
  ('entrevistado',            'Entrevistado',            'Asistió a la entrevista, pendiente de evaluación',    'bg-teal-100 text-teal-800',       'entrevista', 120, FALSE),
  ('aprobado',                'Aprobado',                'Aprobó la evaluación de entrevista',                  'bg-green-100 text-green-800',     'evaluacion', 130, FALSE),
  ('rechazado',              'Rechazado',                'No aprobó la evaluación de entrevista',               'bg-red-100 text-red-800',         'evaluacion', 140, FALSE),
  ('aprobado_final',          'Aprobado Final',          'Aprobado definitivamente por el psicólogo',           'bg-emerald-100 text-emerald-800', 'decision',   150, FALSE),
  ('rechazado_final',         'Rechazado Final',         'Rechazado definitivamente por el psicólogo',          'bg-red-100 text-red-800',         'decision',   160, TRUE),
  ('contratado',              'Contratado',              'Candidato contratado',                                'bg-green-100 text-green-800',     'cierre',     170, TRUE);

-- =============================================================================
-- Transiciones válidas
-- =============================================================================
-- Hoy `PUT /cambiar-estado/:id` acepta cualquier estado desde cualquier otro:
-- solo valida que el destino exista. Aquí el grafo es dato, y el servicio lo
-- consulta antes de mover a un candidato.
--
-- `requiere_motivo = TRUE` marca las transiciones donde el servicio exige una
-- justificación, que queda en candidato_estado_historial.motivo.
-- =============================================================================

-- Helper: inserta por código en vez de por id.
INSERT INTO estado_transiciones (estado_origen_id, estado_destino_id, requiere_motivo)
SELECT o.id, d.id, t.requiere_motivo
FROM (
  -- Gestión de contacto: desde 'nuevo' se puede tipificar de cualquier forma
  SELECT 'nuevo' AS origen, 'contacto_exitoso'  AS destino, FALSE AS requiere_motivo UNION ALL
  SELECT 'nuevo', 'contacto_fallido',  FALSE UNION ALL
  SELECT 'nuevo', 'no_contesta',       FALSE UNION ALL
  SELECT 'nuevo', 'reagendar',         FALSE UNION ALL
  SELECT 'nuevo', 'no_interesado',     TRUE  UNION ALL
  SELECT 'nuevo', 'numero_incorrecto', FALSE UNION ALL
  -- Se cita desde el propio formulario de registro (Citado = Sí), sin pasar por
  -- Selección ni por el resto del embudo. Ver migración 009.
  SELECT 'nuevo', 'citado',            FALSE UNION ALL

  -- Los estados de contacto fallido reintentan hacia contacto o se cierran
  SELECT 'contacto_fallido', 'contacto_exitoso', FALSE UNION ALL
  SELECT 'contacto_fallido', 'no_contesta',      FALSE UNION ALL
  SELECT 'contacto_fallido', 'reagendar',        FALSE UNION ALL
  SELECT 'contacto_fallido', 'no_interesado',    TRUE  UNION ALL
  SELECT 'contacto_fallido', 'numero_incorrecto',FALSE UNION ALL

  SELECT 'no_contesta', 'contacto_exitoso',  FALSE UNION ALL
  SELECT 'no_contesta', 'contacto_fallido',  FALSE UNION ALL
  SELECT 'no_contesta', 'reagendar',         FALSE UNION ALL
  SELECT 'no_contesta', 'no_interesado',     TRUE  UNION ALL
  SELECT 'no_contesta', 'numero_incorrecto', FALSE UNION ALL

  SELECT 'reagendar', 'contacto_exitoso',  FALSE UNION ALL
  SELECT 'reagendar', 'contacto_fallido',  FALSE UNION ALL
  SELECT 'reagendar', 'no_contesta',       FALSE UNION ALL
  SELECT 'reagendar', 'no_interesado',     TRUE  UNION ALL
  SELECT 'reagendar', 'numero_incorrecto', FALSE UNION ALL

  -- Embudo principal
  SELECT 'contacto_exitoso',        'formularios_enviados',    FALSE UNION ALL
  SELECT 'contacto_exitoso',        'reagendar',               FALSE UNION ALL
  SELECT 'contacto_exitoso',        'no_interesado',           TRUE  UNION ALL
  SELECT 'contacto_exitoso',        'rechazado',               TRUE  UNION ALL

  SELECT 'formularios_enviados',    'formularios_completados', FALSE UNION ALL
  SELECT 'formularios_enviados',    'reagendar',               FALSE UNION ALL
  SELECT 'formularios_enviados',    'no_interesado',           TRUE  UNION ALL
  SELECT 'formularios_enviados',    'rechazado',               TRUE  UNION ALL

  SELECT 'formularios_completados', 'citado',                  FALSE UNION ALL
  SELECT 'formularios_completados', 'rechazado',               TRUE  UNION ALL
  SELECT 'formularios_completados', 'no_interesado',           TRUE  UNION ALL

  -- Entrevista
  SELECT 'citado', 'entrevistado', FALSE UNION ALL
  SELECT 'citado', 'no_asistio',   TRUE  UNION ALL
  SELECT 'citado', 'citado',       FALSE UNION ALL  -- reagendamiento (se filtra abajo)

  SELECT 'no_asistio', 'citado',    FALSE UNION ALL  -- se reagenda
  SELECT 'no_asistio', 'rechazado', TRUE  UNION ALL

  -- Evaluación (solo candidatos con cargo Agente, ver seleccion.service.js)
  SELECT 'entrevistado', 'aprobado',  FALSE UNION ALL
  SELECT 'entrevistado', 'rechazado', TRUE  UNION ALL

  -- Decisión final directa, sin pasar por evaluación (decisión de negocio,
  -- 2026-08-31): la calificación de 5 criterios (saludo/perfilamiento/
  -- producto/objeciones/cierre) solo aplica a cargos "Agente"; cualquier otro
  -- cargo (Coordinador, Analista, Team Leader, etc.) va directo de
  -- 'entrevistado' a la decisión final. `seleccion.service.js` impide que un
  -- candidato Agente use este atajo.
  SELECT 'entrevistado', 'aprobado_final',  TRUE  UNION ALL
  SELECT 'entrevistado', 'rechazado_final', TRUE  UNION ALL

  -- Decisión final del psicólogo
  SELECT 'aprobado',  'aprobado_final',  FALSE UNION ALL
  SELECT 'aprobado',  'rechazado_final', TRUE  UNION ALL
  SELECT 'rechazado', 'aprobado_final',  TRUE  UNION ALL
  SELECT 'rechazado', 'rechazado_final', TRUE  UNION ALL

  -- Cierre
  SELECT 'aprobado_final', 'contratado',      FALSE UNION ALL
  SELECT 'aprobado_final', 'rechazado_final', TRUE
) AS t
JOIN estados_candidato o ON o.codigo = t.origen
JOIN estados_candidato d ON d.codigo = t.destino
-- La tabla prohíbe transiciones reflexivas; el reagendamiento de 'citado' no
-- cambia de estado, crea una citación nueva.
WHERE o.id <> d.id;

-- -----------------------------------------------------------------------------
-- seeds/003_catalogos.sql
-- -----------------------------------------------------------------------------
-- =============================================================================
-- SEED 003 — Catálogos
-- =============================================================================
-- Valores extraídos de `models/candidato.model.js:getOpcionesCatalogo()` y de
-- MOTIVOS_INASISTENCIA en `CandidatosSeleccion.jsx` (frontend).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Identidad y ubicación
-- -----------------------------------------------------------------------------
-- La nacionalidad se derivaba con `tipo_documento === 'CC' ? 'Colombiano' : 'Venezolano'`,
-- hardcodeado en candidato.controller.js y en candidatoFormulario.service.js.
INSERT INTO tipos_documento (codigo, nombre, nacionalidad, orden) VALUES
  ('CC',  'CC',  'Colombiano', 1),
  ('PPT', 'PPT', 'Venezolano', 2);

INSERT INTO ciudades (codigo, nombre, orden) VALUES
  ('bogota',       'Bogotá',       1),
  ('barranquilla', 'Barranquilla', 2);

-- -----------------------------------------------------------------------------
-- Clientes / campañas
-- -----------------------------------------------------------------------------
INSERT INTO clientes (codigo, nombre, orden) VALUES
  ('Staff Operacional',    'Staff Operacional',    1),
  ('Staff Administrativo', 'Staff Administrativo', 2),
  ('Obamacare',            'Obamacare',            3),
  ('Hogar',                'Hogar',                4),
  ('Móvil',                'Móvil',                5),
  ('TyT',                  'TyT',                  6),
  ('Pymes',                'Pymes',                7),
  ('ACA',                  'ACA',                  8),
  ('Customer',             'Customer',             9);

-- -----------------------------------------------------------------------------
-- Cargos
-- -----------------------------------------------------------------------------
-- INSERT IGNORE porque la colación es case-insensitive y el catálogo viejo tiene
-- el mismo cargo escrito de dos formas ('Backoffice' en cargos_staff y
-- 'BackOffice' en CARGOS_BASE_RECLUTAMIENTO). Antes eran dos entradas distintas
-- del desplegable; aquí queda una sola.
INSERT IGNORE INTO cargos (codigo, nombre) VALUES
  -- CARGOS_BASE_RECLUTAMIENTO: disponibles para todos los clientes
  ('Agente','Agente'),
  ('Agente Plus','Agente Plus'),
  ('Analista De Calidad','Analista De Calidad'),
  ('Analista De Reclutamiento','Analista De Reclutamiento'),
  ('Analista De Seleccion','Analista De Seleccion'),
  ('Analista De Usuarios','Analista De Usuarios'),
  ('Analista PQR','Analista PQR'),
  ('BackOffice','BackOffice'),
  ('Community Manager','Community Manager'),
  ('Coordinador','Coordinador'),
  ('Coordinador BackOffice','Coordinador BackOffice'),
  ('Coordinador De Reclutamiento Y Selección','Coordinador De Reclutamiento Y Selección'),
  ('Coordinadora De Calidad','Coordinadora De Calidad'),
  ('Director de formación','Director de formación'),
  ('Formador','Formador'),
  ('Formador Senior','Formador Senior'),
  ('Jefe de operacion','Jefe de operacion'),
  ('Jefe De Reclutamiento Y Selección','Jefe De Reclutamiento Y Selección'),
  ('Legalizador','Legalizador'),
  ('Psicologo De Seleccion','Psicologo De Seleccion'),
  ('Team Leader','Team Leader'),
  ('Team Lider BackOffice','Team Lider BackOffice'),
  ('Team Lider Operaciones','Team Lider Operaciones'),
  -- Propios de Staff
  ('Analista Administrativa Y Contable','Analista Administrativa Y Contable'),
  ('Analista De Calidad Pe','Analista De Calidad Pe'),
  ('Analista De Contratacion','Analista De Contratacion'),
  ('Auditor/Gestor Calidad Comercial','Auditor/Gestor Calidad Comercial'),
  ('Auxiliar De Gestion Humana','Auxiliar De Gestion Humana'),
  ('Auxiliar De Servicios Generales','Auxiliar De Servicios Generales'),
  ('Auxiliar Juridico','Auxiliar Juridico'),
  ('Auxiliar Mantenimiento','Auxiliar Mantenimiento'),
  ('Auxiliar SST','Auxiliar SST'),
  ('Ayudante De Obra','Ayudante De Obra'),
  ('Backoffice Pe','Backoffice Pe'),
  ('Contador','Contador'),
  ('Coordinador Datamarshall','Coordinador Datamarshall'),
  ('Coordinador De Contratacion','Coordinador De Contratacion'),
  ('Coordinador De Nomina','Coordinador De Nomina'),
  ('Coordinador De Tecnologia','Coordinador De Tecnologia'),
  ('Coordinador De Usuarios','Coordinador De Usuarios'),
  ('Coordinador Pe','Coordinador Pe'),
  ('Coordinador Tecnico','Coordinador Tecnico'),
  ('Coordinadora Backoffice','Coordinadora Backoffice'),
  ('Datamarshall','Datamarshall'),
  ('Datamarshall Senior Pe','Datamarshall Senior Pe'),
  ('Desarrollador Web','Desarrollador Web'),
  ('Director de Operaciones','Director de Operaciones'),
  ('Director de Operaciones Pe','Director de Operaciones Pe'),
  ('Director De Tecnologia','Director De Tecnologia'),
  ('Diseñador Grafico','Diseñador Grafico'),
  ('Formador Pe','Formador Pe'),
  ('Gestora De Marketing Y Calidad De Se','Gestora De Marketing Y Calidad De Se'),
  ('GTR','GTR'),
  ('Jefe Backoffice','Jefe Backoffice'),
  ('Jefe De Manteniminento','Jefe De Manteniminento'),
  ('Jefe de workforce','Jefe de workforce'),
  ('Jefe Financiero','Jefe Financiero'),
  ('Jefe Juridica','Jefe Juridica'),
  ('Maestro De Obra','Maestro De Obra'),
  ('Profesional De SST','Profesional De SST'),
  ('Recepcionista','Recepcionista'),
  ('Subgerente De Operaciones','Subgerente De Operaciones'),
  ('Tecnico De Soporte','Tecnico De Soporte'),
  ('Staff','Staff'),
  -- Propios de Obamacare
  ('Customer Service','Customer Service'),
  ('Agente Call Center','Agente Call Center');
-- No se siembra 'Agente Call Center Plus': solo existía en `cargos_claro`, y el
-- cliente 'Claro' ya no está en el catálogo (la rama del switch del frontend
-- quedó muerta). Lo mismo con `cargos_majority`.

-- Todos los clientes reciben el catálogo base.
INSERT INTO cliente_cargos (cliente_id, cargo_id)
SELECT cl.id, ca.id
FROM clientes cl
CROSS JOIN cargos ca
WHERE ca.codigo IN (
  'Agente','Agente Plus','Analista De Calidad','Analista De Reclutamiento',
  'Analista De Seleccion','Analista De Usuarios','Analista PQR','BackOffice',
  'Community Manager','Coordinador','Coordinador BackOffice',
  'Coordinador De Reclutamiento Y Selección','Coordinadora De Calidad',
  'Director de formación','Formador','Formador Senior','Jefe de operacion',
  'Jefe De Reclutamiento Y Selección','Legalizador','Psicologo De Seleccion',
  'Team Leader','Team Lider BackOffice','Team Lider Operaciones'
);

-- Cargos propios de Staff Operacional y Staff Administrativo.
INSERT IGNORE INTO cliente_cargos (cliente_id, cargo_id)
SELECT cl.id, ca.id
FROM clientes cl
CROSS JOIN cargos ca
WHERE cl.codigo IN ('Staff Operacional','Staff Administrativo')
  AND ca.codigo IN (
    'Analista Administrativa Y Contable','Analista De Calidad Pe',
    'Analista De Contratacion','Auditor/Gestor Calidad Comercial',
    'Auxiliar De Gestion Humana','Auxiliar De Servicios Generales',
    'Auxiliar Juridico','Auxiliar Mantenimiento','Auxiliar SST','Ayudante De Obra',
    'Backoffice Pe','Contador','Coordinador Datamarshall','Coordinador De Contratacion',
    'Coordinador De Nomina','Coordinador De Tecnologia','Coordinador De Usuarios',
    'Coordinador Pe','Coordinador Tecnico','Coordinadora Backoffice','Datamarshall',
    'Datamarshall Senior Pe','Desarrollador Web','Director de Operaciones',
    'Director de Operaciones Pe','Director De Tecnologia','Diseñador Grafico',
    'Formador Pe','Gestora De Marketing Y Calidad De Se','GTR','Jefe Backoffice',
    'Jefe De Manteniminento','Jefe de workforce','Jefe Financiero','Jefe Juridica',
    'Maestro De Obra','Profesional De SST','Recepcionista','Subgerente De Operaciones',
    'Tecnico De Soporte','Staff'
  );

-- Cargos propios de Obamacare.
INSERT IGNORE INTO cliente_cargos (cliente_id, cargo_id)
SELECT cl.id, ca.id
FROM clientes cl
CROSS JOIN cargos ca
WHERE cl.codigo = 'Obamacare'
  AND ca.codigo IN ('Customer Service','Agente Call Center');

-- -----------------------------------------------------------------------------
-- Gestión de contacto
-- -----------------------------------------------------------------------------
INSERT INTO fuentes_reclutamiento (codigo, nombre, orden) VALUES
  ('Computrabajo','Computrabajo',1), ('LinkedIn','LinkedIn',2),
  ('Referido Empleado','Referido Empleado',3), ('Referido Externo','Referido Externo',4),
  ('Redes Sociales','Redes Sociales',5), ('Ferias de Empleo','Ferias de Empleo',6),
  ('Universidades','Universidades',7), ('Base de Datos','Base de Datos',8),
  ('Otro','Otro',9);

-- 'Contacto exitoso' se retiró del catálogo (decisión de negocio, 2026-08-30).
-- Para las bases que ya lo tienen sembrado, lo desactiva la migración 008.
INSERT INTO tipificaciones_llamada (codigo, nombre, orden) VALUES
  ('No contesta','No contesta',1),
  ('Ocupado','Ocupado',2), ('Número incorrecto','Número incorrecto',3),
  ('Interesado','Interesado',4), ('No interesado','No interesado',5),
  ('Reagendar','Reagendar',6), ('No apto','No apto',7);

INSERT INTO estados_gestion_reclutamiento (codigo, nombre, grupo, orden) VALUES
  ('#Errado','#Errado',NULL,1),
  ('No Contesta / Msj Global-Wa','No Contesta / Msj Global-Wa',NULL,2),
  ('Contesta / Cuelga / Mensaje Global-Wa','Contesta / Cuelga / Mensaje Global-Wa',NULL,3),
  ('No Apto / Estudiante','No Apto / Estudiante','NO APTO POR:',10),
  ('No Apto / No experiencia','No Apto / No experiencia','NO APTO POR:',11),
  ('No Apto / Ubicación','No Apto / Ubicación','NO APTO POR:',12),
  ('No Apto / Edad mayor a 35','No Apto / Edad mayor a 35','NO APTO POR:',13),
  ('No Apto / No certificado de bachiller','No Apto / No certificado de bachiller','NO APTO POR:',14),
  ('No Apto / Menor de edad','No Apto / Menor de edad','NO APTO POR:',15),
  ('No Apto / Disposición','No Apto / Disposición','NO APTO POR:',16),
  ('No Apto / Sobreperfilado','No Apto / Sobreperfilado','NO APTO POR:',17),
  ('No Apto / EPS','No Apto / EPS','NO APTO POR:',18),
  ('No interesado / Horarios','No interesado / Horarios','NO INTERESADOS POR:',20),
  ('No interesado / Ventas','No interesado / Ventas','NO INTERESADOS POR:',21),
  ('No interesado / Ubicación','No interesado / Ubicación','NO INTERESADOS POR:',22),
  ('No interesado / Capacitación','No interesado / Capacitación','NO INTERESADOS POR:',23),
  ('No interesado / Call Center','No interesado / Call Center','NO INTERESADOS POR:',24),
  ('No interesado / Ya trabaja','No interesado / Ya trabaja','NO INTERESADOS POR:',25),
  ('No interesado / No parqueadero','No interesado / No parqueadero','NO INTERESADOS POR:',26);

INSERT INTO motivos_inasistencia (codigo, nombre, requiere_detalle, orden) VALUES
  ('Calamidad','Calamidad',FALSE,1),
  ('Asunto personal','Asunto personal',FALSE,2),
  ('Otra oferta / Menos días capa','Otra oferta / Menos días capa',FALSE,3),
  ('Otra oferta / Contrato inmediato','Otra oferta / Contrato inmediato',FALSE,4),
  ('No contesta','No contesta',FALSE,5),
  ('No interesado / Horarios','No interesado / Horarios',FALSE,6),
  ('No interesado / Ventas','No interesado / Ventas',FALSE,7),
  ('No interesado / Ubicación','No interesado / Ubicación',FALSE,8),
  ('No interesado / Capacitación','No interesado / Capacitación',FALSE,9),
  ('No interesado / Call center','No interesado / Call center',FALSE,10),
  ('No interesado / No parqueadero','No interesado / No parqueadero',FALSE,11),
  ('Otra','Otra',TRUE,12);

-- -----------------------------------------------------------------------------
-- Datos personales
-- -----------------------------------------------------------------------------
INSERT INTO estados_civiles (codigo, nombre, orden) VALUES
  ('soltero','Soltero(a)',1), ('casado','Casado(a)',2), ('union_libre','Unión libre',3),
  ('separado','Separado(a)',4), ('divorciado','Divorciado(a)',5), ('viudo','Viudo(a)',6);

INSERT INTO generos (codigo, nombre, orden) VALUES
  ('masculino','Masculino',1), ('femenino','Femenino',2);

INSERT INTO grupos_sanguineos (codigo, nombre, orden) VALUES
  ('O+','O+',1), ('O-','O-',2), ('A+','A+',3), ('A-','A-',4),
  ('B+','B+',5), ('B-','B-',6), ('AB+','AB+',7), ('AB-','AB-',8);

INSERT INTO eps (codigo, nombre, orden) VALUES
  ('Sura EPS','Sura EPS',1), ('Nueva EPS','Nueva EPS',2), ('Sanitas EPS','Sanitas EPS',3),
  ('Salud Total EPS','Salud Total EPS',4), ('Compensar EPS','Compensar EPS',5),
  ('Famisanar EPS','Famisanar EPS',6), ('Medimás EPS','Medimás EPS',7),
  ('Aliansalud EPS','Aliansalud EPS',8), ('EPS SOAS','EPS SOAS',9),
  ('Coosalud EPS','Coosalud EPS',10), ('Mutual SER','Mutual SER',11),
  ('Capital Salud','Capital Salud',12), ('Régimen Especial','Régimen Especial',13),
  ('No tengo EPS','No tengo EPS',14);

INSERT INTO afp (codigo, nombre, orden) VALUES
  ('Protección','Protección',1), ('Porvenir','Porvenir',2), ('Colfondos','Colfondos',3),
  ('Old Mutual','Old Mutual',4), ('Skandia','Skandia',5), ('Colpensiones','Colpensiones',6),
  ('No tengo AFP','No tengo AFP',7);

INSERT INTO parentescos (codigo, nombre, orden) VALUES
  ('padre','Padre',1), ('madre','Madre',2), ('hermano','Hermano(a)',3),
  ('hijo','Hijo(a)',4), ('conyuge','Cónyuge',5), ('pareja','Pareja',6),
  ('tio','Tío(a)',7), ('primo','Primo(a)',8), ('abuelo','Abuelo(a)',9),
  ('amigo','Amigo(a)',10), ('otro','Otro',11);

-- No existía catálogo: `talla_camisa` era VARCHAR(10) libre.
INSERT INTO tallas_camisa (codigo, nombre, orden) VALUES
  ('XS','XS',1), ('S','S',2), ('M','M',3), ('L','L',4), ('XL','XL',5), ('XXL','XXL',6);

-- OJO: estos códigos están acoplados al mapa NIVEL_ROWS de hojaVidaPdfService.js.
INSERT INTO niveles_estudios (codigo, nombre, orden) VALUES
  ('bachillerato','Bachillerato',1),
  ('tecnico_tecnologo','Técnico/Tecnólogo',2),
  ('profesional_u_otros','Profesional u Otros',3),
  ('conocimientos_informaticos','Conocimientos Informáticos',4);

INSERT INTO herramientas_informaticas (codigo, nombre, orden) VALUES
  ('excel','Excel',1), ('powerpoint','PowerPoint',2), ('word','Word',3);

-- -----------------------------------------------------------------------------
-- Selección y documentos
-- -----------------------------------------------------------------------------
-- Los 5 criterios que hoy son columnas fijas de hyd_candidatos.
INSERT INTO criterios_evaluacion (codigo, nombre, puntaje_maximo, orden) VALUES
  ('saludo','Saludo',20.00,1),
  ('perfilamiento','Perfilamiento',20.00,2),
  ('producto','Producto',20.00,3),
  ('objeciones','Manejo de objeciones',20.00,4),
  ('cierre','Cierre',20.00,5);

INSERT INTO tipos_antecedente (codigo, nombre, orden) VALUES
  ('adres','ADRES',1),
  ('policia','Antecedentes de Policía',2),
  ('comparendos','Comparendos',3),
  ('procuraduria','Procuraduría',4);

INSERT INTO tipos_documento_adjunto (codigo, nombre, orden) VALUES
  ('antecedente_adres','Soporte ADRES',1),
  ('antecedente_policia','Soporte antecedentes de Policía',2),
  ('antecedente_comparendos','Soporte comparendos',3),
  ('antecedente_procuraduria','Soporte Procuraduría',4),
  ('otro','Otro documento',99);

SET FOREIGN_KEY_CHECKS = 1;

-- -----------------------------------------------------------------------------
-- Usuario administrador de produccion
-- -----------------------------------------------------------------------------
-- Generado especificamente para esta entrega (ver instrucciones en la
-- cabecera de este archivo). CAMBIAR LA CONTRASENA DESDE LA APLICACION
-- INMEDIATAMENTE DESPUES DEL PRIMER LOGIN.
--
--   Email:    admin@hidra.com
--   Password: V3Kw64pPYA0lQUqr6QSnYfFr!9
--
INSERT INTO usuarios (nombre_completo, email, password_hash, activo) VALUES
  ('Administrador', 'admin@hidra.com',
   '$2b$12$ICisMEF3hFoUvF9aTYopTeu3I2KnXBAwYJ4xH3tl1Bp3TH057tvtS', TRUE);

INSERT INTO usuario_roles (usuario_id, rol_id)
SELECT u.id, r.id
FROM usuarios u JOIN roles r
WHERE u.email = 'admin@hidra.com' AND r.codigo = 'administrador';

-- -----------------------------------------------------------------------------
-- Control de esquema -- deja las 9 migraciones registradas como ya aplicadas,
-- con el mismo checksum que calcula db/migrate.js, para que un
-- `node db/migrate.js` posterior contra esta base no intente reaplicarlas.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migraciones_aplicadas (
  version     VARCHAR(20)  NOT NULL,
  nombre      VARCHAR(255) NOT NULL,
  checksum    CHAR(64)     NOT NULL,
  aplicada_en TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version)
) ENGINE=InnoDB;

INSERT INTO migraciones_aplicadas (version, nombre, checksum) VALUES
  ('001', '001_control_y_acceso.sql', 'bc8e676a38b974c4543ccd7c1b51ace24cbe327bbc4897631f784bbc1cdcba22'),
  ('002', '002_catalogos.sql', 'ecfabeb9077814f54032c5af3526f05cde763252d37b7c817bda9fb23f316daf'),
  ('003', '003_candidatos.sql', 'e29fbb854da8e83befde7455f053977d9883447cb266bf8d9c03617518726078'),
  ('004', '004_formulario_candidato.sql', '7528c648d7919f666799f7936a0bcdd3d140ab8eea0117ebc55e532798aa53d0'),
  ('005', '005_seleccion.sql', '9f2c0e96cf47d5493bc9d78f2d36fa9150c001666327b3cc6696cd109d5dac45'),
  ('006', '006_documentos_y_comunicaciones.sql', '0e3c89e57e53c13ea2f33684bc7c0338312ff7322590df88ca2b926d181677f3'),
  ('007', '007_perfil_y_citado.sql', '44f8d76e64eea2489501ef6d3e7cc6a7978a1251055ba236c28b5c5b6c54b21c'),
  ('008', '008_retirar_tipificacion_contacto_exitoso.sql', 'e238f68e99d38fee4cbb0912621b6ff5eac69f06498202e4cf12c4b8aadf496a'),
  ('009', '009_citar_sin_fecha.sql', '7fb8e4a6e931b019f72bc43b938a8f1e1a379307b5519516a5b9a7220138e30e');
