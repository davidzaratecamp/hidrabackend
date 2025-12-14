-- =====================================================
-- MIGRACIÓN COMPLETA PARA PRODUCCIÓN
-- Sistema HIDRA - Módulo de Aprobación Final
-- =====================================================

-- IMPORTANTE: EJECUTAR BACKUP ANTES DE ESTA MIGRACIÓN
-- mysqldump -u usuario -p hidra_db > backup_$(date +%Y%m%d_%H%M%S).sql

-- =====================================================
-- PASO 1: AGREGAR NUEVOS CAMPOS PARA APROBACIÓN FINAL
-- =====================================================

ALTER TABLE hyd_candidatos 
ADD COLUMN aprobacion_final BOOLEAN NULL DEFAULT NULL COMMENT 'TRUE=aprobado final, FALSE=rechazado final, NULL=pendiente',
ADD COLUMN aprobacion_final_razon TEXT NULL COMMENT 'Razón del rechazo (obligatorio si rechazado)',
ADD COLUMN fecha_aprobacion_final DATETIME NULL COMMENT 'Timestamp de la decisión final',
ADD COLUMN psicologo_decision_id INT NULL COMMENT 'ID del psicólogo que tomó la decisión';

-- =====================================================
-- PASO 2: AGREGAR FOREIGN KEY CONSTRAINT
-- =====================================================

ALTER TABLE hyd_candidatos 
ADD CONSTRAINT fk_candidatos_psicologo_decision 
    FOREIGN KEY (psicologo_decision_id) 
    REFERENCES hyd_usuarios(id) 
    ON DELETE SET NULL 
    ON UPDATE CASCADE;

-- =====================================================
-- PASO 3: ACTUALIZAR ENUM DE ESTADOS
-- =====================================================

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
  'aprobado_final',
  'rechazado_final',
  'contratado'
) DEFAULT 'nuevo' COMMENT 'Estados del candidato en el proceso de selección';

-- =====================================================
-- PASO 4: CREAR ÍNDICES PARA OPTIMIZACIÓN
-- =====================================================

-- Índice para búsquedas por aprobación final
CREATE INDEX idx_candidatos_aprobacion_final 
ON hyd_candidatos(aprobacion_final, fecha_aprobacion_final);

-- Índice para búsquedas por psicólogo decisión
CREATE INDEX idx_candidatos_psicologo_decision 
ON hyd_candidatos(psicologo_decision_id);

-- Índice compuesto para filtros comunes
CREATE INDEX idx_candidatos_estado_aprobacion 
ON hyd_candidatos(estado, aprobacion_final);

-- =====================================================
-- PASO 5: VERIFICACIONES POST-MIGRACIÓN
-- =====================================================

-- Verificar que los campos se agregaron correctamente
SELECT 
    COLUMN_NAME, 
    DATA_TYPE, 
    IS_NULLABLE, 
    COLUMN_DEFAULT, 
    COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'hyd_candidatos' 
  AND COLUMN_NAME IN (
    'aprobacion_final',
    'aprobacion_final_razon', 
    'fecha_aprobacion_final',
    'psicologo_decision_id'
  )
ORDER BY ORDINAL_POSITION;

-- Verificar que el ENUM se actualizó correctamente
SHOW COLUMNS FROM hyd_candidatos LIKE 'estado';

-- Verificar que el Foreign Key se creó correctamente
SELECT 
    CONSTRAINT_NAME,
    TABLE_NAME,
    COLUMN_NAME,
    REFERENCED_TABLE_NAME,
    REFERENCED_COLUMN_NAME
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
WHERE TABLE_NAME = 'hyd_candidatos' 
  AND CONSTRAINT_NAME = 'fk_candidatos_psicologo_decision';

-- Verificar que los índices se crearon correctamente
SHOW INDEX FROM hyd_candidatos 
WHERE KEY_NAME IN (
    'idx_candidatos_aprobacion_final',
    'idx_candidatos_psicologo_decision',
    'idx_candidatos_estado_aprobacion'
);

-- =====================================================
-- PASO 6: DATOS DE PRUEBA (OPCIONAL - SOLO DESARROLLO)
-- =====================================================

-- COMENTARIO: Los siguientes comandos son solo para verificación
-- En producción, todos los candidatos existentes tendrán los nuevos campos en NULL

-- Contar candidatos por estado actual
SELECT estado, COUNT(*) as total 
FROM hyd_candidatos 
GROUP BY estado 
ORDER BY total DESC;

-- Verificar que todos los nuevos campos están en NULL (como se esperaba)
SELECT COUNT(*) as total_candidatos,
       COUNT(aprobacion_final) as con_decision_final,
       COUNT(aprobacion_final_razon) as con_razon,
       COUNT(fecha_aprobacion_final) as con_fecha_decision,
       COUNT(psicologo_decision_id) as con_psicologo
FROM hyd_candidatos;

-- =====================================================
-- PASO 7: VERIFICACIÓN FINAL DE INTEGRIDAD
-- =====================================================

-- Verificar que no hay errores en la estructura de la tabla
CHECK TABLE hyd_candidatos;

-- Verificar que las foreign keys están funcionando
SELECT COUNT(*) as referencias_validas
FROM hyd_candidatos c
LEFT JOIN hyd_usuarios u ON c.psicologo_decision_id = u.id
WHERE c.psicologo_decision_id IS NOT NULL;

-- =====================================================
-- RESULTADO ESPERADO
-- =====================================================

-- Después de ejecutar esta migración:
-- 1. Tabla hyd_candidatos tendrá 4 nuevos campos para aprobación final
-- 2. ENUM estado incluirá 'aprobado_final' y 'rechazado_final'
-- 3. Foreign key conectará con tabla hyd_usuarios
-- 4. Índices optimizarán las consultas del nuevo módulo
-- 5. Todos los candidatos existentes tendrán campos nuevos en NULL
-- 6. Sistema funcionará normalmente con nuevas funcionalidades

-- =====================================================
-- FIN DE MIGRACIÓN
-- =====================================================

SELECT 'MIGRACIÓN COMPLETADA EXITOSAMENTE' as resultado;
SELECT NOW() as fecha_migracion;