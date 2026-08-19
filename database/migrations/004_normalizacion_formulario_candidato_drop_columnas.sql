-- Migración 004: elimina de hyd_candidatos las columnas ya migradas a las tablas
-- nuevas del formulario de candidato.
-- Fecha: 2026-08-18
--
-- ⚠️ NO EJECUTAR TODAVÍA. Requiere, en este orden:
--   1. Que el backend (candidato.controller.js: actualizarHojaVida, actualizarDatosBasicos,
--      actualizarEstudios, actualizarExperiencia, actualizarPersonal, actualizarConsentimiento,
--      getPerfilCompleto, calcularProgreso en candidato.model.js) lea/escriba en las tablas
--      nuevas en vez de estas columnas.
--   2. Que el frontend (hidrafrontend: HojaVida.jsx, DatosBasicos.jsx, Estudios.jsx,
--      Experiencia.jsx, Personal.jsx, Consentimiento.jsx, PerfilCandidato.jsx) siga
--      funcionando contra el nuevo shape de respuesta.
--   3. QA manual end-to-end (reenviar formulario a un candidato de prueba, completar los
--      6 pasos, confirmar que persiste y que perfil/progreso se ven igual).
-- Ver Fases 3 y 5 en claude/plan.md.
--
-- Se eliminan las columnas del "grupo A" (migradas con datos reales en 003_...sql) y
-- del "grupo B" (100% NULL, sin referencias en código, ver claude/plan.md): genograma,
-- metas_largo_plazo, metas_mediano_plazo, metas_corto_plazo.
--
-- NO se tocan: segundo_nombre, segundo_apellido (se quedan en hyd_candidatos, los deriva
-- el reclutador - ver nota en 002_...sql), los 6 formulario_*_completado / fecha_completado_*
-- (metadata de progreso, se quedan por la razón ya documentada en claude/plan.md),
-- token_acceso, fecha_vencimiento_token, consentimiento_aceptado, ni ninguna columna del
-- módulo de selección (evaluacion_*, aprobacion_final*, asistio_citacion, etc.).

ALTER TABLE hyd_candidatos
  DROP COLUMN estado_civil,
  DROP COLUMN genero,
  DROP COLUMN fecha_nacimiento,
  DROP COLUMN grupo_sanguineo,
  DROP COLUMN eps,
  DROP COLUMN afp,
  DROP COLUMN nombre_emergencia,
  DROP COLUMN numero_emergencia,
  DROP COLUMN parentesco_emergencia,
  DROP COLUMN nivel_estudios,
  DROP COLUMN titulo_obtenido,
  DROP COLUMN nombre_institucion,
  DROP COLUMN ano_finalizacion,
  DROP COLUMN nombre_empresa,
  DROP COLUMN cargo_desempenado,
  DROP COLUMN salario_experiencia,
  DROP COLUMN fecha_inicio_experiencia,
  DROP COLUMN fecha_retiro_experiencia,
  DROP COLUMN tiempo_laborado_anos,
  DROP COLUMN tiempo_laborado_meses,
  DROP COLUMN motivo_retiro,
  DROP COLUMN ha_trabajado_asiste,
  DROP COLUMN experiencia_comercial_certificada,
  DROP COLUMN experiencia_comercial_no_certificada,
  DROP COLUMN primer_empleo_formal,
  DROP COLUMN genograma,
  DROP COLUMN fortalezas,
  DROP COLUMN aspectos_mejorar,
  DROP COLUMN competencias_laborales,
  DROP COLUMN metas_largo_plazo,
  DROP COLUMN metas_mediano_plazo,
  DROP COLUMN metas_corto_plazo,
  DROP COLUMN conocimiento_excel,
  DROP COLUMN conocimiento_powerpoint,
  DROP COLUMN conocimiento_word,
  DROP COLUMN autoevaluacion,
  DROP COLUMN ciudad_consentimiento,
  DROP COLUMN dia_consentimiento,
  DROP COLUMN mes_consentimiento,
  DROP COLUMN ano_consentimiento;
