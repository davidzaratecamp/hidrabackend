-- =============================================================================
-- 024 — EXPERIENCIA pasa de tiempo de experiencia a tipo de experiencia
-- =============================================================================
-- Decisión de negocio (2026-11-26): el campo EXPERIENCIA del registro (023) no
-- mide cuánto tiempo ha trabajado el candidato, sino en qué. Las opciones pasan
-- a ser: Primer empleo, Call center y Venta presencial.
--
-- "Primer empleo" se conserva tal cual. Las cuatro opciones de tiempo se
-- DESACTIVAN, no se borran (mismo criterio que la 008): salen del desplegable y
-- el backend deja de aceptarlas, pero un candidato que ya tenga una asignada
-- conserva su referencia. Un DELETE fallaría por la clave foránea o lo dejaría
-- sin dato.
--
-- Los WHERE van por `codigo`, que es UNIQUE: no los frena el modo de
-- actualización segura de Workbench (error 1175).
-- =============================================================================

UPDATE experiencias_laborales
   SET activo = FALSE
 WHERE codigo IN ('Menos de 6 meses', '6 meses a 1 año', '1 a 2 años', 'Más de 2 años');

UPDATE experiencias_laborales
   SET orden = 1
 WHERE codigo = 'Primer empleo';

INSERT INTO experiencias_laborales (codigo, nombre, orden) VALUES
  ('Call center',      'Call center',      2),
  ('Venta presencial', 'Venta presencial', 3);
