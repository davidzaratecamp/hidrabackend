-- Agregar campos para aprobación final del psicólogo
-- Estos campos son independientes de la evaluación técnica

-- Verificar si las columnas ya existen antes de agregarlas
SET @sql_aprobacion = (
    SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE hyd_candidatos ADD COLUMN aprobacion_final BOOLEAN DEFAULT NULL COMMENT "Decisión final del psicólogo para aprobar el candidato al trabajo"',
        'SELECT "Column aprobacion_final already exists" as message'
    ) 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = 'noviembrehidra' 
    AND TABLE_NAME = 'hyd_candidatos' 
    AND COLUMN_NAME = 'aprobacion_final'
);

PREPARE stmt FROM @sql_aprobacion;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_razon = (
    SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE hyd_candidatos ADD COLUMN aprobacion_final_razon TEXT DEFAULT NULL COMMENT "Razón de rechazo si no fue aprobado finalmente"',
        'SELECT "Column aprobacion_final_razon already exists" as message'
    ) 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = 'noviembrehidra' 
    AND TABLE_NAME = 'hyd_candidatos' 
    AND COLUMN_NAME = 'aprobacion_final_razon'
);

PREPARE stmt FROM @sql_razon;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_fecha = (
    SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE hyd_candidatos ADD COLUMN fecha_aprobacion_final DATETIME DEFAULT NULL COMMENT "Fecha cuando se tomó la decisión final"',
        'SELECT "Column fecha_aprobacion_final already exists" as message'
    ) 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = 'noviembrehidra' 
    AND TABLE_NAME = 'hyd_candidatos' 
    AND COLUMN_NAME = 'fecha_aprobacion_final'
);

PREPARE stmt FROM @sql_fecha;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_psicologo = (
    SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE hyd_candidatos ADD COLUMN psicologo_decision_id INT DEFAULT NULL COMMENT "ID del psicólogo que tomó la decisión final"',
        'SELECT "Column psicologo_decision_id already exists" as message'
    ) 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = 'noviembrehidra' 
    AND TABLE_NAME = 'hyd_candidatos' 
    AND COLUMN_NAME = 'psicologo_decision_id'
);

PREPARE stmt FROM @sql_psicologo;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Crear índice si no existe
SET @sql_index = (
    SELECT IF(
        COUNT(*) = 0,
        'CREATE INDEX idx_candidatos_aprobacion_final ON hyd_candidatos(aprobacion_final, fecha_aprobacion_final)',
        'SELECT "Index idx_candidatos_aprobacion_final already exists" as message'
    )
    FROM INFORMATION_SCHEMA.STATISTICS 
    WHERE TABLE_SCHEMA = 'noviembrehidra'
    AND TABLE_NAME = 'hyd_candidatos'
    AND INDEX_NAME = 'idx_candidatos_aprobacion_final'
);

PREPARE stmt FROM @sql_index;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

/*
EXPLICACIÓN DE LOS NUEVOS CAMPOS:

1. aprobacion_final: 
   - NULL: No se ha tomado decisión final
   - TRUE: Candidato APROBADO para el trabajo por el psicólogo
   - FALSE: Candidato RECHAZADO para el trabajo por el psicólogo

2. aprobacion_final_razon:
   - NULL: No aplica (si fue aprobado o no se ha decidido)
   - TEXT: Razón específica del rechazo final

3. fecha_aprobacion_final:
   - Timestamp de cuando se tomó la decisión

4. psicologo_decision_id:
   - ID del psicólogo que tomó la decisión final

FLUJO ACTUALIZADO:
1. Candidato completa formularios
2. Es citado para entrevista
3. Asiste y es entrevistado
4. Recibe evaluación técnica (puntaje + evaluacion_aprobado automático basado en ≥71%)
5. Psicólogo revisa y toma DECISIÓN FINAL (aprobacion_final) independientemente del puntaje
6. Estado final: 'aprobado_final' o 'rechazado_final' basado en aprobacion_final
*/