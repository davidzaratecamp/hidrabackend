-- Migración 005: ajusta hyd_candidato_estudios.nivel_estudios a los 4 niveles exactos
-- del bloque "INFORMACIÓN ACADEMICA" del Excel oficial (FORMATO HOJA DE VIDA, hoja
-- "HOJA DE VIDA E INFORME DE SELEC", fila 22-27): BACHILLERATO, TÉCNICO/TECNÓLOGO,
-- PROFESIONAL U OTROS, CONOCIMIENTOS INFORMÁTICOS - son 4 filas fijas, no niveles
-- educativos abiertos.
-- Fecha: 2026-08-18
--
-- El catálogo anterior (candidato.model.js: niveles_estudios, 8 valores: primaria,
-- bachillerato, tecnico, tecnologo, universitario, especialista, magister, doctorado)
-- solo lo usaba Estudios.jsx (confirmado, sin otras referencias en el frontend) - se
-- reemplaza completo por los 4 valores del Excel, no se mantiene en paralelo.
--
-- Antes de alterar el ENUM hay que remapear los valores existentes que ya no calzan
-- (si no, MySQL los vacía silenciosamente en modo no estricto, o falla en modo
-- estricto). Verificado en la BD local (2026-08-18): solo 2 filas con datos reales
-- (candidato_id 1 = 'tecnologo', candidato_id 7858 = 'doctorado').
-- La columna es ENUM: hay que ensancharla a VARCHAR primero, porque los valores nuevos
-- (p. ej. 'tecnico_tecnologo') no existen todavía en el ENUM viejo y el UPDATE de abajo
-- fallaría con "Data truncated" si se intenta escribir directo sobre el ENUM original.
ALTER TABLE hyd_candidato_estudios MODIFY COLUMN nivel_estudios VARCHAR(50) NOT NULL;

UPDATE hyd_candidato_estudios SET nivel_estudios = 'tecnico_tecnologo' WHERE nivel_estudios IN ('tecnico', 'tecnologo');
UPDATE hyd_candidato_estudios SET nivel_estudios = 'profesional_u_otros' WHERE nivel_estudios IN ('universitario', 'especialista', 'magister', 'doctorado');
-- 'primaria' no tiene equivalente en el Excel (el nivel más bajo que pide es
-- Bachillerato) - se remapea a 'bachillerato' como la fila más cercana. Sin filas
-- afectadas en la BD local al momento de escribir esta migración.
UPDATE hyd_candidato_estudios SET nivel_estudios = 'bachillerato' WHERE nivel_estudios = 'primaria';

ALTER TABLE hyd_candidato_estudios
  MODIFY COLUMN nivel_estudios ENUM('bachillerato','tecnico_tecnologo','profesional_u_otros','conocimientos_informaticos') NOT NULL;
