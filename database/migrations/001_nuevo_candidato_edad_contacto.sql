-- Migración 001: campos de primer contacto en el formulario "Nuevo Candidato"
-- Fuente: BASE RECLUTAMIENTO (2).xlsx (columnas EDAD y CONTACTO: LLAMADA / WHATSAPP)
-- Fecha: 2026-08-14
--
-- Alcance: solo columnas nuevas en hyd_candidatos. No se tocan ni se eliminan
-- columnas existentes, y los catálogos de `cliente`/`cargo` se actualizan de forma
-- ADITIVA (código de aplicación, no esquema) para no romper candidatos ya creados.

ALTER TABLE hyd_candidatos
  ADD COLUMN edad INT NULL AFTER numero_documento,
  ADD COLUMN contacto_llamada ENUM('si', 'no') NULL AFTER numero_celular,
  ADD COLUMN contacto_whatsapp ENUM('si', 'no') NULL AFTER contacto_llamada;
