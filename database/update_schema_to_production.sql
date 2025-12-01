-- =====================================================
-- ACTUALIZAR ESQUEMA LOCAL PARA COINCIDIR CON PRODUCCIÓN
-- Archivo: update_schema_to_production.sql
-- Fecha: Nov 2024
-- =====================================================

-- IMPORTANTE: Este script sincroniza el esquema local con la realidad de producción
-- Ejecutar solo si la base de datos local no tiene estos campos

USE noviembrehidra;

-- =====================================================
-- 1. AGREGAR CAMPO RECLUTADOR_ID (si no existe)
-- =====================================================

-- Verificar si el campo existe antes de agregarlo
SET @column_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = 'noviembrehidra' 
    AND TABLE_NAME = 'hyd_candidatos' 
    AND COLUMN_NAME = 'reclutador_id'
);

-- Agregar campo solo si no existe
SET @sql = IF(@column_exists = 0, 
    'ALTER TABLE hyd_candidatos ADD COLUMN reclutador_id INT NULL AFTER observaciones_generales',
    'SELECT "Campo reclutador_id ya existe" as mensaje'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =====================================================
-- 2. AGREGAR ÍNDICE PARA RECLUTADOR_ID (si no existe)
-- =====================================================

-- Verificar si el índice existe
SET @index_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.STATISTICS 
    WHERE TABLE_SCHEMA = 'noviembrehidra' 
    AND TABLE_NAME = 'hyd_candidatos' 
    AND INDEX_NAME = 'idx_reclutador'
);

-- Agregar índice solo si no existe
SET @sql = IF(@index_exists = 0,
    'ALTER TABLE hyd_candidatos ADD INDEX idx_reclutador (reclutador_id)',
    'SELECT "Índice idx_reclutador ya existe" as mensaje'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =====================================================
-- 3. AGREGAR CLAVE FORÁNEA (si no existe)
-- =====================================================

-- Verificar si la clave foránea existe
SET @fk_exists = (
    SELECT COUNT(*) 
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
    WHERE TABLE_SCHEMA = 'noviembrehidra' 
    AND TABLE_NAME = 'hyd_candidatos' 
    AND COLUMN_NAME = 'reclutador_id'
    AND REFERENCED_TABLE_NAME = 'hyd_usuarios'
);

-- Agregar clave foránea solo si no existe
SET @sql = IF(@fk_exists = 0,
    'ALTER TABLE hyd_candidatos ADD FOREIGN KEY (reclutador_id) REFERENCES hyd_usuarios(id) ON DELETE SET NULL',
    'SELECT "Clave foránea reclutador_id ya existe" as mensaje'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =====================================================
-- 4. ACTUALIZAR ENUM DE ESTADOS (si es necesario)
-- =====================================================

-- Verificar estados actuales
SELECT COLUMN_TYPE 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'noviembrehidra' 
AND TABLE_NAME = 'hyd_candidatos' 
AND COLUMN_NAME = 'estado';

-- NOTA: Si los estados no coinciden, ejecutar manualmente:
/*
ALTER TABLE hyd_candidatos 
MODIFY COLUMN estado ENUM(
    'nuevo', 
    'contacto_fallido', 
    'no_contesta', 
    'reagendar', 
    'no_interesado', 
    'numero_incorrecto', 
    'contacto_exitoso', 
    'formularios_enviados', 
    'formularios_completados', 
    'citado', 
    'no_asistio', 
    'entrevistado', 
    'aprobado', 
    'rechazado', 
    'contratado'
) DEFAULT 'nuevo';
*/

-- =====================================================
-- 5. VERIFICACIÓN FINAL
-- =====================================================

-- Verificar estructura final
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT,
    EXTRA
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'noviembrehidra' 
AND TABLE_NAME = 'hyd_candidatos'
AND COLUMN_NAME IN ('reclutador_id', 'estado')
ORDER BY ORDINAL_POSITION;

-- Verificar índices
SELECT 
    INDEX_NAME,
    COLUMN_NAME,
    NON_UNIQUE
FROM INFORMATION_SCHEMA.STATISTICS 
WHERE TABLE_SCHEMA = 'noviembrehidra' 
AND TABLE_NAME = 'hyd_candidatos'
AND COLUMN_NAME = 'reclutador_id';

-- Verificar claves foráneas
SELECT 
    CONSTRAINT_NAME,
    COLUMN_NAME,
    REFERENCED_TABLE_NAME,
    REFERENCED_COLUMN_NAME
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
WHERE TABLE_SCHEMA = 'noviembrehidra' 
AND TABLE_NAME = 'hyd_candidatos'
AND COLUMN_NAME = 'reclutador_id'
AND REFERENCED_TABLE_NAME IS NOT NULL;

SELECT 'Esquema actualizado correctamente' as resultado;