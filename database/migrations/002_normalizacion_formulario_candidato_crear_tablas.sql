-- Migración 002: normalización del formulario de candidato (formulario emailado, 6 pasos)
-- Fuente: Downloads/FORMATO HOJA DE VIDA.xlsx, hoja "HOJA DE VIDA E INFORME DE SELEC"
--         (versión vigente: v3.0, código GH-RYS-F-04, fecha actualización 11/04/2025).
-- Fecha: 2026-08-18
--
-- Alcance: solo CREATE TABLE, aditivo, no toca hyd_candidatos. Cero riesgo.
--
-- Decisiones confirmadas con el usuario (2026-08-18):
--   1. Alcance = formulario oficial completo (no solo lo que el sistema ya captura hoy) -
--      se agregan los campos que el Excel pide y el sistema digital nunca implementó.
--   2. Estudios y experiencia laboral pasan a ser 1:N reales (una fila por nivel académico /
--      por empresa), no columnas fijas repetidas - el Excel soporta hasta 3 experiencias
--      (empresa actual + 2 anteriores) y estudios en varios niveles a la vez.
--   3. `genero` se mantiene (no está en el Excel, pero ya se captura y se usa hoy) -
--      se reubica junto con el resto de "datos básicos", igual que sus campos hermanos.
--   4. `segundo_nombre`/`segundo_apellido` se retiran del formulario del candidato (paso
--      "Datos Básicos"): ya los deriva el reclutador del "Nombre Completo" al crear el
--      candidato (candidato.controller.js: separarNombreCompleto) y quedarse ahí evita el
--      riesgo ya documentado en claude/plan.md de que el candidato los sobreescriba en
--      blanco. Siguen existiendo en hyd_candidatos, sin cambios.
--
-- Supuesto a confirmar con el usuario antes de tocar el frontend (fuera de esta migración):
--   los campos de autoevaluación/fortalezas/competencias/genograma/metas/expectativa laboral/
--   salud/tratamiento psicológico aparecen en el Excel físicamente bajo el bloque "INFORME DE
--   SELECCIÓN" (después de la firma del candidato, fila 54), lo que sugiere que en el papel
--   los diligencia el psicólogo en la entrevista, no el candidato de forma remota. El sistema
--   actual ya los hace parte del paso 5 "Personal" del formulario que se le envía por email al
--   candidato (candidato.controller.js: actualizarPersonal) - se mantiene esa asignación de
--   dueño (candidato, autorreporte) porque es lo que ya está implementado y en uso; si el
--   negocio en realidad quiere que esto lo llene selección/psicólogo, es un cambio de alcance
--   de módulo, no de esquema, y hay que decidirlo aparte.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Datos básicos (Excel: sección "DATOS BÁSICOS" + "DATOS PERSONALES", filas 4-16)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE hyd_candidato_datos_basicos (
  candidato_id INT PRIMARY KEY,
  estado_civil VARCHAR(50) NULL,
  aspiracion_salarial DECIMAL(15,2) NULL COMMENT 'Excel: "ASPIRACIÓN SALARIAL" - no capturado hoy',
  direccion_residencial VARCHAR(255) NULL COMMENT 'Excel: "DIRECCIÓN RESIDENCIAL" - no capturado hoy',
  barrio VARCHAR(100) NULL COMMENT 'Excel: "BARRIO" - no capturado hoy',
  talla_camisa VARCHAR(10) NULL COMMENT 'Excel: "TALLA DE CAMISA" - no capturado hoy',
  genero VARCHAR(20) NULL COMMENT 'No está en el Excel oficial; se mantiene por decisión del usuario (2026-08-18)',
  fecha_nacimiento DATE NULL,
  grupo_sanguineo VARCHAR(10) NULL COMMENT 'Excel: "RH"',
  eps VARCHAR(100) NULL,
  afp VARCHAR(100) NULL COMMENT 'Excel v3.0 lo llama "FONDO DE PENSIÓN"',
  nombre_emergencia VARCHAR(100) NULL,
  numero_emergencia VARCHAR(20) NULL,
  parentesco_emergencia VARCHAR(50) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_datos_basicos_candidato
    FOREIGN KEY (candidato_id) REFERENCES hyd_candidatos(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Estudios (Excel: sección "INFORMACIÓN ACADEMICA", filas 22-27)
--    1:N real - el Excel tiene 3 filas fijas (Bachillerato / Técnico-Tecnólogo /
--    Profesional u otros), pero se modela abierto reusando el catálogo completo
--    de `niveles_estudios` que ya existe en candidato.model.js (8 valores), para
--    no perder fidelidad si un candidato tiene, p. ej., especialización o magíster.
-- ─────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Experiencia laboral (Excel: sección "EXPERIENCIA LABORAL", filas 29-50)
--    1:N real - el Excel pide hasta 3 empresas (actual + 2 anteriores). `orden`
--    conserva el orden cronológico inverso: 1 = empresa actual/más reciente.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE hyd_candidato_experiencia (
  id INT PRIMARY KEY AUTO_INCREMENT,
  candidato_id INT NOT NULL,
  orden TINYINT NOT NULL COMMENT '1 = empresa actual/más reciente, 2 = anterior, 3 = anterior a esa',
  nombre_empresa VARCHAR(200) NULL,
  cargo_desempenado VARCHAR(100) NULL,
  salario DECIMAL(15,2) NULL,
  funciones TEXT NULL COMMENT 'Excel: "FUNCIONES" - no capturado hoy',
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

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Resumen de experiencia (preguntas generales del candidato, no ligadas a
--    una empresa puntual - Excel: fila 46 "¿HA LABORADO CON ASISTE ING?" y
--    sección "INFORMACIÓN REINTEGROS" filas 45-50, más fila 79 "SI/NO" de
--    experiencia comercial / primer empleo).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE hyd_candidato_experiencia_resumen (
  candidato_id INT PRIMARY KEY,
  ha_trabajado_asiste VARCHAR(10) NULL COMMENT 'Excel: "¿HA LABORADO CON ASISTE ING O ASISTE INGENIERIA?"',
  experiencia_comercial_certificada VARCHAR(10) NULL,
  experiencia_comercial_no_certificada VARCHAR(10) NULL,
  primer_empleo_formal VARCHAR(10) NULL,
  ha_estado_proceso_formativo_asiste VARCHAR(10) NULL COMMENT 'Excel: "¿HA ESTADO EN PROCESO FORMATIVO CON ASISTE ING?" - no capturado hoy',
  campana_asiste VARCHAR(100) NULL COMMENT 'Excel: "¿EN QUE CAMPAÑA LABORÓ?" - no capturado hoy',
  fecha_inicio_asiste DATE NULL COMMENT 'no capturado hoy',
  fecha_retiro_asiste DATE NULL COMMENT 'no capturado hoy',
  tiempo_laborado_asiste VARCHAR(50) NULL COMMENT 'Excel lo pide como texto libre ("coloque si fue meses o año") - no capturado hoy',
  motivo_retiro_asiste TEXT NULL COMMENT 'no capturado hoy',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_experiencia_resumen_candidato
    FOREIGN KEY (candidato_id) REFERENCES hyd_candidatos(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Personal / autoevaluación (Excel: bloque posterior a la firma - "GENOGRAMA",
--    "ESTRUCTURA DE PERSONALIDAD", "COMPETENCIAS LABORALES", "METAS", "Estado de
--    salud actual", "Autoevaluación en herramientas ofimáticas", filas 60-79).
--    Ver nota de supuesto arriba sobre quién diligencia este bloque en el papel.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE hyd_candidato_personal (
  candidato_id INT PRIMARY KEY,
  fortalezas TEXT NULL,
  aspectos_mejorar TEXT NULL,
  competencias_laborales TEXT NULL,
  conocimiento_excel INT NULL,
  conocimiento_powerpoint INT NULL,
  conocimiento_word INT NULL,
  autoevaluacion INT NULL,
  genograma TEXT NULL COMMENT 'Excel: "GENOGRAMA" (con quién vive) - columna muerta en hyd_candidatos (tipo JSON, 0 referencias en código); aquí como texto libre, que es como lo pide el Excel',
  metas_corto_plazo TEXT NULL,
  metas_mediano_plazo TEXT NULL,
  metas_largo_plazo TEXT NULL,
  expectativa_laboral TEXT NULL COMMENT 'Excel: "CUAL ES SU EXPECTATIVA LABORAL" - no capturado hoy',
  estado_salud_actual VARCHAR(100) NULL COMMENT 'Excel: "COMO CONSIDERA SU ESTADO DE SALUD ACTUAL" - no capturado hoy, catálogo sin confirmar',
  tratamiento_psicologico_actual VARCHAR(10) NULL COMMENT 'Excel: "¿ESTÁ EN TRATAMIENTO PSICOLÓGICO ACTUALMENTE O HA ESTADO?" - no capturado hoy',
  tratamiento_psicologico_detalle TEXT NULL COMMENT 'Excel: "SI ES ASI MENCIONE CUAL" - no capturado hoy',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_personal_candidato
    FOREIGN KEY (candidato_id) REFERENCES hyd_candidatos(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Consentimiento (Excel: firma del candidato, fila 54) - sin cambios de
--    campos respecto al diseño actual, solo cambia de tabla.
-- ─────────────────────────────────────────────────────────────────────────
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
