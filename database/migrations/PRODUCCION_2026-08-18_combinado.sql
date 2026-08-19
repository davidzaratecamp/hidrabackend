-- ═══════════════════════════════════════════════════════════════════════════
-- SCRIPT COMBINADO PARA PRODUCCIÓN — 2026-08-18
-- Combina, en orden, las migraciones 001, 002, 003, 005 y 006 de
-- database/migrations/. Pensado para copiar y pegar completo en un cliente
-- MySQL contra la base de producción (`noviembrehidra` o el nombre que tenga
-- ahí).
--
-- NO incluye la migración 004 (DROP COLUMN de las ~37 columnas viejas de
-- hyd_candidatos ya migradas) — queda pendiente a propósito hasta confirmar
-- que el backend/frontend nuevos funcionan bien en producción durante un
-- tiempo. Correrla es un paso aparte, cuando lo pidas explícitamente.
--
-- ⚠️ ANTES DE CORRER ESTO:
--   1. Backup completo de la base (mysqldump o snapshot del proveedor). Este
--      script hace ALTER TABLE/CREATE TABLE — en MySQL cada DDL hace COMMIT
--      implícito, así que NO se puede revertir con un simple ROLLBACK si algo
--      sale mal a la mitad. El backup es la única red de seguridad real.
--   2. Correrlo en una ventana de bajo tráfico si la tabla hyd_candidatos es
--      grande en producción (los UPDATE de los pasos 3 y 4 recorren toda la
--      tabla).
--   3. Correr primero el bloque "STEP 0: verificación previa" de abajo y
--      confirmar que las columnas/tablas listadas ahí NO existen todavía. Si
--      alguna ya existe (p. ej. si la migración 001 ya se aplicó antes en
--      producción por otra vía), avisa antes de seguir — ese paso puntual del
--      script fallaría con "Duplicate column" y hay que saltarlo.
--
-- Después de correr todo, al final hay un bloque de verificación (conteos de
-- filas, DESCRIBE) para confirmar que quedó igual que en local.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- STEP 0: verificación previa (solo lectura, correr primero y revisar el
-- resultado antes de seguir)
-- ───────────────────────────────────────────────────────────────────────────

-- Debe devolver 0 filas (si devuelve algo, la migración 001 ya está aplicada
-- y hay que saltar el STEP 1 de abajo):
SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hyd_candidatos'
  AND COLUMN_NAME IN ('edad', 'contacto_llamada', 'contacto_whatsapp');

-- Debe devolver 0 filas (si devuelve algo, las tablas nuevas ya existen y hay
-- que saltar el STEP 2):
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'hyd_candidato\_%';

-- Para revisar si hay valores de nivel_estudios fuera del catálogo esperado
-- antes de que el STEP 4 los remapee (informativo, no bloquea nada):
SELECT DISTINCT nivel_estudios, COUNT(*) AS filas
FROM hyd_candidatos WHERE nivel_estudios IS NOT NULL GROUP BY nivel_estudios;


-- ───────────────────────────────────────────────────────────────────────────
-- STEP 1 (= migración 001): campos de primer contacto en "Nuevo Candidato"
-- Fuente: BASE RECLUTAMIENTO (2).xlsx. Aditivo, no toca columnas existentes.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE hyd_candidatos
  ADD COLUMN edad INT NULL AFTER numero_documento,
  ADD COLUMN contacto_llamada ENUM('si', 'no') NULL AFTER numero_celular,
  ADD COLUMN contacto_whatsapp ENUM('si', 'no') NULL AFTER contacto_llamada;


-- ───────────────────────────────────────────────────────────────────────────
-- STEP 2 (= migración 002): 6 tablas nuevas del formulario de candidato
-- Fuente: Downloads/FORMATO HOJA DE VIDA.xlsx. Aditivo, no toca hyd_candidatos.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE hyd_candidato_datos_basicos (
  candidato_id INT PRIMARY KEY,
  estado_civil VARCHAR(50) NULL,
  aspiracion_salarial DECIMAL(15,2) NULL,
  direccion_residencial VARCHAR(255) NULL,
  barrio VARCHAR(100) NULL,
  talla_camisa VARCHAR(10) NULL,
  genero VARCHAR(20) NULL,
  fecha_nacimiento DATE NULL,
  grupo_sanguineo VARCHAR(10) NULL,
  eps VARCHAR(100) NULL,
  afp VARCHAR(100) NULL,
  nombre_emergencia VARCHAR(100) NULL,
  numero_emergencia VARCHAR(20) NULL,
  parentesco_emergencia VARCHAR(50) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_datos_basicos_candidato
    FOREIGN KEY (candidato_id) REFERENCES hyd_candidatos(id) ON DELETE CASCADE
);

CREATE TABLE hyd_candidato_estudios (
  id INT PRIMARY KEY AUTO_INCREMENT,
  candidato_id INT NOT NULL,
  nivel_estudios ENUM('primaria','bachillerato','tecnico','tecnologo','universitario','especialista','magister','doctorado') NOT NULL,
  nombre_institucion VARCHAR(200) NULL,
  titulo_obtenido VARCHAR(200) NULL,
  ano_finalizacion YEAR NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_estudios_candidato_nivel (candidato_id, nivel_estudios),
  CONSTRAINT fk_estudios_candidato
    FOREIGN KEY (candidato_id) REFERENCES hyd_candidatos(id) ON DELETE CASCADE
);

CREATE TABLE hyd_candidato_experiencia (
  id INT PRIMARY KEY AUTO_INCREMENT,
  candidato_id INT NOT NULL,
  orden TINYINT NOT NULL COMMENT '1 = empresa actual/más reciente, 2 = anterior, 3 = anterior a esa',
  nombre_empresa VARCHAR(200) NULL,
  cargo_desempenado VARCHAR(100) NULL,
  salario DECIMAL(15,2) NULL,
  funciones TEXT NULL,
  fecha_inicio DATE NULL,
  fecha_retiro DATE NULL,
  tiempo_laborado_anos INT NULL,
  tiempo_laborado_meses INT NULL,
  motivo_retiro TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_experiencia_candidato_orden (candidato_id, orden),
  CONSTRAINT fk_experiencia_candidato
    FOREIGN KEY (candidato_id) REFERENCES hyd_candidatos(id) ON DELETE CASCADE
);

CREATE TABLE hyd_candidato_experiencia_resumen (
  candidato_id INT PRIMARY KEY,
  ha_trabajado_asiste VARCHAR(10) NULL,
  experiencia_comercial_certificada VARCHAR(10) NULL,
  experiencia_comercial_no_certificada VARCHAR(10) NULL,
  primer_empleo_formal VARCHAR(10) NULL,
  ha_estado_proceso_formativo_asiste VARCHAR(10) NULL,
  campana_asiste VARCHAR(100) NULL,
  fecha_inicio_asiste DATE NULL,
  fecha_retiro_asiste DATE NULL,
  tiempo_laborado_asiste VARCHAR(50) NULL,
  motivo_retiro_asiste TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_experiencia_resumen_candidato
    FOREIGN KEY (candidato_id) REFERENCES hyd_candidatos(id) ON DELETE CASCADE
);

CREATE TABLE hyd_candidato_personal (
  candidato_id INT PRIMARY KEY,
  fortalezas TEXT NULL,
  aspectos_mejorar TEXT NULL,
  competencias_laborales TEXT NULL,
  conocimiento_excel INT NULL,
  conocimiento_powerpoint INT NULL,
  conocimiento_word INT NULL,
  autoevaluacion INT NULL,
  genograma TEXT NULL,
  metas_corto_plazo TEXT NULL,
  metas_mediano_plazo TEXT NULL,
  metas_largo_plazo TEXT NULL,
  expectativa_laboral TEXT NULL,
  estado_salud_actual VARCHAR(100) NULL,
  tratamiento_psicologico_actual VARCHAR(10) NULL,
  tratamiento_psicologico_detalle TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_personal_candidato
    FOREIGN KEY (candidato_id) REFERENCES hyd_candidatos(id) ON DELETE CASCADE
);

CREATE TABLE hyd_candidato_consentimiento (
  candidato_id INT PRIMARY KEY,
  ciudad_consentimiento VARCHAR(100) NULL,
  dia_consentimiento INT NULL,
  mes_consentimiento INT NULL,
  ano_consentimiento YEAR NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_consentimiento_candidato
    FOREIGN KEY (candidato_id) REFERENCES hyd_candidatos(id) ON DELETE CASCADE
);


-- ───────────────────────────────────────────────────────────────────────────
-- STEP 3 (= migración 003): backfill de los candidatos que ya tienen datos
-- reales en las columnas viejas de hyd_candidatos hacia las tablas nuevas.
--
-- El WHERE de cada bloque dispara el INSERT solo con columnas de texto/fecha,
-- nunca con columnas numéricas (conocimiento_excel/powerpoint/word,
-- autoevaluacion, dia/mes_consentimiento, salario_experiencia,
-- tiempo_laborado_anos/meses) — en la BD local esas columnas numéricas
-- estaban "reseteadas" a 0 en vez de NULL para ~7856 filas vacías por un bug
-- de importación (mismo patrón que evaluacion_total, ver claude/context.md),
-- y usarlas como disparador habría creado miles de filas basura. No se sabe
-- con certeza si producción tiene el mismo problema, pero este WHERE es
-- seguro en ambos casos (si producción está limpia, igual funciona bien).
-- ───────────────────────────────────────────────────────────────────────────

-- 3.1 Datos básicos
INSERT INTO hyd_candidato_datos_basicos
  (candidato_id, estado_civil, genero, fecha_nacimiento, grupo_sanguineo, eps, afp,
   nombre_emergencia, numero_emergencia, parentesco_emergencia)
SELECT id, estado_civil, genero, fecha_nacimiento, grupo_sanguineo, eps, afp,
       nombre_emergencia, numero_emergencia, parentesco_emergencia
FROM hyd_candidatos
WHERE estado_civil IS NOT NULL OR genero IS NOT NULL OR fecha_nacimiento IS NOT NULL
   OR grupo_sanguineo IS NOT NULL OR eps IS NOT NULL OR afp IS NOT NULL
   OR nombre_emergencia IS NOT NULL OR numero_emergencia IS NOT NULL
   OR parentesco_emergencia IS NOT NULL;

-- 3.2 Estudios (una sola fila por candidato, porque el esquema viejo solo
-- guardaba un nivel de estudios)
INSERT INTO hyd_candidato_estudios
  (candidato_id, nivel_estudios, nombre_institucion, titulo_obtenido, ano_finalizacion)
SELECT id, nivel_estudios, nombre_institucion, titulo_obtenido, ano_finalizacion
FROM hyd_candidatos
WHERE nivel_estudios IS NOT NULL;

-- 3.3 Experiencia laboral (orden = 1: única experiencia que existía en el
-- esquema viejo, se migra como "más reciente")
INSERT INTO hyd_candidato_experiencia
  (candidato_id, orden, nombre_empresa, cargo_desempenado, salario, fecha_inicio,
   fecha_retiro, tiempo_laborado_anos, tiempo_laborado_meses, motivo_retiro)
SELECT id, 1, nombre_empresa, cargo_desempenado, salario_experiencia,
       fecha_inicio_experiencia, fecha_retiro_experiencia,
       tiempo_laborado_anos, tiempo_laborado_meses, motivo_retiro
FROM hyd_candidatos
WHERE nombre_empresa IS NOT NULL OR cargo_desempenado IS NOT NULL
   OR fecha_inicio_experiencia IS NOT NULL OR fecha_retiro_experiencia IS NOT NULL
   OR motivo_retiro IS NOT NULL;

-- 3.4 Resumen de experiencia
INSERT INTO hyd_candidato_experiencia_resumen
  (candidato_id, ha_trabajado_asiste, experiencia_comercial_certificada,
   experiencia_comercial_no_certificada, primer_empleo_formal)
SELECT id, ha_trabajado_asiste, experiencia_comercial_certificada,
       experiencia_comercial_no_certificada, primer_empleo_formal
FROM hyd_candidatos
WHERE ha_trabajado_asiste IS NOT NULL OR experiencia_comercial_certificada IS NOT NULL
   OR experiencia_comercial_no_certificada IS NOT NULL OR primer_empleo_formal IS NOT NULL;

-- 3.5 Personal / autoevaluación (genograma NO se migra: la columna vieja es
-- JSON y está 100% en NULL - no hay nada que copiar)
INSERT INTO hyd_candidato_personal
  (candidato_id, fortalezas, aspectos_mejorar, competencias_laborales,
   conocimiento_excel, conocimiento_powerpoint, conocimiento_word, autoevaluacion,
   metas_corto_plazo, metas_mediano_plazo, metas_largo_plazo)
SELECT id, fortalezas, aspectos_mejorar, competencias_laborales,
       conocimiento_excel, conocimiento_powerpoint, conocimiento_word, autoevaluacion,
       metas_corto_plazo, metas_mediano_plazo, metas_largo_plazo
FROM hyd_candidatos
WHERE fortalezas IS NOT NULL OR aspectos_mejorar IS NOT NULL
   OR competencias_laborales IS NOT NULL OR metas_corto_plazo IS NOT NULL
   OR metas_mediano_plazo IS NOT NULL OR metas_largo_plazo IS NOT NULL;

-- 3.6 Consentimiento
INSERT INTO hyd_candidato_consentimiento
  (candidato_id, ciudad_consentimiento, dia_consentimiento, mes_consentimiento, ano_consentimiento)
SELECT id, ciudad_consentimiento, dia_consentimiento, mes_consentimiento, ano_consentimiento
FROM hyd_candidatos
WHERE ciudad_consentimiento IS NOT NULL OR ano_consentimiento IS NOT NULL;


-- ───────────────────────────────────────────────────────────────────────────
-- STEP 4 (= migración 005): hyd_candidato_estudios.nivel_estudios pasa del
-- catálogo abierto de 8 valores a los 4 niveles fijos del Excel. Hay que
-- remapear los valores ya insertados por el STEP 3 antes de estrechar el ENUM.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE hyd_candidato_estudios MODIFY COLUMN nivel_estudios VARCHAR(50) NOT NULL;

UPDATE hyd_candidato_estudios SET nivel_estudios = 'tecnico_tecnologo' WHERE nivel_estudios IN ('tecnico', 'tecnologo');
UPDATE hyd_candidato_estudios SET nivel_estudios = 'profesional_u_otros' WHERE nivel_estudios IN ('universitario', 'especialista', 'magister', 'doctorado');
UPDATE hyd_candidato_estudios SET nivel_estudios = 'bachillerato' WHERE nivel_estudios = 'primaria';

ALTER TABLE hyd_candidato_estudios
  MODIFY COLUMN nivel_estudios ENUM('bachillerato','tecnico_tecnologo','profesional_u_otros','conocimientos_informaticos') NOT NULL;


-- ───────────────────────────────────────────────────────────────────────────
-- STEP 5 (= migración 006): campo de texto libre para "Conocimientos
-- Informáticos" (máx. 500 caracteres, no es institución/título/año).
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE hyd_candidato_estudios
  ADD COLUMN descripcion VARCHAR(500) NULL AFTER nivel_estudios;


-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN FINAL (correr después y revisar que todo tenga sentido)
-- ═══════════════════════════════════════════════════════════════════════════

-- Confirma las 3 columnas nuevas en hyd_candidatos
SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hyd_candidatos'
  AND COLUMN_NAME IN ('edad', 'contacto_llamada', 'contacto_whatsapp');

-- Confirma que las 6 tablas nuevas existen
SELECT TABLE_NAME, TABLE_ROWS FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'hyd_candidato\_%';

-- Conteo real de filas migradas por el backfill (compara contra cuántos
-- candidatos con datos reales esperabas ver)
SELECT 'datos_basicos' AS tabla, COUNT(*) AS filas FROM hyd_candidato_datos_basicos
UNION ALL SELECT 'estudios', COUNT(*) FROM hyd_candidato_estudios
UNION ALL SELECT 'experiencia', COUNT(*) FROM hyd_candidato_experiencia
UNION ALL SELECT 'experiencia_resumen', COUNT(*) FROM hyd_candidato_experiencia_resumen
UNION ALL SELECT 'personal', COUNT(*) FROM hyd_candidato_personal
UNION ALL SELECT 'consentimiento', COUNT(*) FROM hyd_candidato_consentimiento;

-- Confirma que el ENUM de nivel_estudios quedó con los 4 valores del Excel
SHOW COLUMNS FROM hyd_candidato_estudios LIKE 'nivel_estudios';
