-- Actualizar tabla hyd_candidatos con nuevos campos
USE noviembrehidra;

-- Agregar nuevos campos
ALTER TABLE hyd_candidatos 
ADD COLUMN fuente_reclutamiento VARCHAR(100),
ADD COLUMN observaciones_llamada VARCHAR(100),
ADD COLUMN observaciones_generales TEXT;

-- Actualizar datos de prueba existentes
UPDATE hyd_candidatos SET fuente_reclutamiento = 'Portal Web' WHERE fuente_reclutamiento IS NULL;

-- Verificar estructura
DESCRIBE hyd_candidatos;