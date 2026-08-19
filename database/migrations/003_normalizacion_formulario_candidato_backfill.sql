-- Migración 003: backfill de datos existentes hacia las tablas nuevas del formulario
-- de candidato (ver 002_normalizacion_formulario_candidato_crear_tablas.sql).
-- Fecha: 2026-08-18
--
-- Alcance: solo INSERT ... SELECT desde hyd_candidatos, no modifica ni elimina nada
-- de hyd_candidatos todavía (eso es la migración 004, y solo debe correr después del
-- refactor de backend/frontend + QA, ver Fase 6 en claude/plan.md).
--
-- Verificado contra la BD local (2026-08-18) antes de escribir este archivo: solo 2
-- candidatos (id 1 y 7858) tienen nivel_estudios no nulo, con valores 'tecnologo' y
-- 'doctorado' - ambos calzan con el ENUM de hyd_candidato_estudios, así que el INSERT
-- no debería fallar por valor fuera de catálogo. Si se corre contra otra base (p. ej.
-- producción) y esto falla por data-truncation en el ENUM, correr primero:
--   SELECT DISTINCT nivel_estudios FROM hyd_candidatos WHERE nivel_estudios IS NOT NULL;
-- y ajustar el ENUM de la tabla o los datos antes de reintentar.
--
-- ⚠️ Hallazgo al validar este script contra la BD local (2026-08-18): el mismo bug de
-- importación ya documentado para evaluacion_total/evaluacion_aprobado en claude/context.md
-- (columnas "reseteadas" a 0 en vez de NULL) también afecta a estas columnas numéricas:
-- conocimiento_excel/powerpoint/word, autoevaluacion, dia_consentimiento, mes_consentimiento,
-- salario_experiencia, tiempo_laborado_anos, tiempo_laborado_meses - las ~7856 filas
-- "vacías" tienen 0 (o '0.00') en vez de NULL en esas columnas puntuales, mientras que las
-- columnas de texto/fecha hermanas (fortalezas, ciudad_consentimiento, nombre_empresa,
-- fecha_inicio_experiencia, etc.) sí quedaron correctamente en NULL. Por eso el WHERE de
-- cada bloque de abajo dispara el INSERT solo con columnas de texto/fecha (inmunes al
-- reset) y NUNCA con estas columnas numéricas - de lo contrario el backfill habría creado
-- ~7856 filas basura por tabla (confirmado: ocurrió en el primer intento de este script,
-- antes de este fix). ano_consentimiento (tipo YEAR) no tiene el problema, quedó NULL
-- correctamente en las filas placeholder.
--
-- Los campos nuevos que no existían en hyd_candidatos (aspiracion_salarial,
-- direccion_residencial, barrio, talla_camisa, funciones, todo el bloque de
-- "reintegros Asiste ING", expectativa_laboral, estado_salud_actual,
-- tratamiento_psicologico_*) no tienen columna origen - quedan NULL en el backfill,
-- se completan hacia adelante con el formulario nuevo.

-- 1. Datos básicos
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

-- 2. Estudios (una sola fila por candidato hoy, porque el esquema viejo solo
--    guardaba un nivel de estudios)
INSERT INTO hyd_candidato_estudios
  (candidato_id, nivel_estudios, nombre_institucion, titulo_obtenido, ano_finalizacion)
SELECT id, nivel_estudios, nombre_institucion, titulo_obtenido, ano_finalizacion
FROM hyd_candidatos
WHERE nivel_estudios IS NOT NULL;

-- 3. Experiencia laboral (orden = 1: es la única experiencia que existía en el
--    esquema viejo, así que se migra como la "más reciente")
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

-- 4. Resumen de experiencia
INSERT INTO hyd_candidato_experiencia_resumen
  (candidato_id, ha_trabajado_asiste, experiencia_comercial_certificada,
   experiencia_comercial_no_certificada, primer_empleo_formal)
SELECT id, ha_trabajado_asiste, experiencia_comercial_certificada,
       experiencia_comercial_no_certificada, primer_empleo_formal
FROM hyd_candidatos
WHERE ha_trabajado_asiste IS NOT NULL OR experiencia_comercial_certificada IS NOT NULL
   OR experiencia_comercial_no_certificada IS NOT NULL OR primer_empleo_formal IS NOT NULL;

-- 5. Personal / autoevaluación (genograma NO se migra: la columna vieja es JSON y
--    está 100% en NULL - no hay nada que copiar)
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

-- 6. Consentimiento
INSERT INTO hyd_candidato_consentimiento
  (candidato_id, ciudad_consentimiento, dia_consentimiento, mes_consentimiento, ano_consentimiento)
SELECT id, ciudad_consentimiento, dia_consentimiento, mes_consentimiento, ano_consentimiento
FROM hyd_candidatos
WHERE ciudad_consentimiento IS NOT NULL OR ano_consentimiento IS NOT NULL;
