-- ========================================
-- SCRIPT PARA ACTUALIZAR BASE DE DATOS EN PRODUCCIÓN
-- Sistema de Evaluación de Entrevistas
-- Fecha: 2025-12-12
-- ========================================

USE noviembrehidra;

-- 1. Agregar campos de evaluación a la tabla candidatos
-- =====================================================
ALTER TABLE hyd_candidatos 
ADD COLUMN IF NOT EXISTS evaluacion_saludo DECIMAL(5,2) DEFAULT NULL COMMENT 'Puntaje de saludo (0-20)',
ADD COLUMN IF NOT EXISTS evaluacion_perfilamiento DECIMAL(5,2) DEFAULT NULL COMMENT 'Puntaje de perfilamiento (0-20)',
ADD COLUMN IF NOT EXISTS evaluacion_producto DECIMAL(5,2) DEFAULT NULL COMMENT 'Puntaje de producto (0-20)',
ADD COLUMN IF NOT EXISTS evaluacion_objeciones DECIMAL(5,2) DEFAULT NULL COMMENT 'Puntaje de manejo de objeciones (0-20)',
ADD COLUMN IF NOT EXISTS evaluacion_cierre DECIMAL(5,2) DEFAULT NULL COMMENT 'Puntaje de cierre de venta (0-20)',
ADD COLUMN IF NOT EXISTS evaluacion_total DECIMAL(5,2) DEFAULT NULL COMMENT 'Puntaje total de evaluación (0-100)',
ADD COLUMN IF NOT EXISTS evaluacion_aprobado BOOLEAN DEFAULT NULL COMMENT 'Si aprobó la evaluación (71% mínimo)',
ADD COLUMN IF NOT EXISTS evaluacion_razon_rechazo TEXT DEFAULT NULL COMMENT 'Razón del rechazo si no aprobó',
ADD COLUMN IF NOT EXISTS fecha_evaluacion DATETIME DEFAULT NULL COMMENT 'Fecha y hora de la evaluación';

-- 2. Verificar que los índices necesarios existen
-- ===============================================
-- Índice para consultas de candidatos por estado
CREATE INDEX IF NOT EXISTS idx_candidatos_estado ON hyd_candidatos(estado);

-- Índice para consultas de candidatos por oleada
CREATE INDEX IF NOT EXISTS idx_candidatos_oleada ON hyd_candidatos(oleada_seleccion_id);

-- Índice para consultas de evaluaciones
CREATE INDEX IF NOT EXISTS idx_candidatos_evaluacion ON hyd_candidatos(evaluacion_aprobado, fecha_evaluacion);

-- 3. Verificar estructura de tabla oleadas
-- ========================================
-- Esta verificación es para asegurar que las oleadas tienen la estructura correcta
DESCRIBE hyd_oleadas;

-- 4. Mostrar resumen de cambios aplicados
-- =======================================
SELECT 
    'RESUMEN DE CAMBIOS APLICADOS' as Titulo,
    'Sistema de Evaluación de Entrevistas implementado correctamente' as Descripcion;

-- Mostrar estructura actualizada de candidatos (solo campos de evaluación)
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT,
    COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'noviembrehidra' 
    AND TABLE_NAME = 'hyd_candidatos' 
    AND COLUMN_NAME LIKE 'evaluacion%'
ORDER BY ORDINAL_POSITION;

-- Contar candidatos por estado para verificar
SELECT 
    estado,
    COUNT(*) as total,
    COUNT(CASE WHEN evaluacion_total IS NOT NULL THEN 1 END) as evaluados,
    COUNT(CASE WHEN evaluacion_aprobado = 1 THEN 1 END) as aprobados,
    COUNT(CASE WHEN evaluacion_aprobado = 0 THEN 1 END) as rechazados
FROM hyd_candidatos 
WHERE estado IN ('citado', 'entrevistado', 'no_asistio', 'aprobado', 'rechazado')
GROUP BY estado
ORDER BY 
    CASE estado 
        WHEN 'citado' THEN 1 
        WHEN 'entrevistado' THEN 2 
        WHEN 'no_asistio' THEN 3 
        WHEN 'aprobado' THEN 4 
        WHEN 'rechazado' THEN 5 
        ELSE 6 
    END;

-- ========================================
-- NOTAS IMPORTANTES PARA PRODUCCIÓN:
-- ========================================
/*
1. CAMPOS AGREGADOS:
   - evaluacion_saludo: Puntaje de saludo (0-20 puntos)
   - evaluacion_perfilamiento: Puntaje de perfilamiento (0-20 puntos)
   - evaluacion_producto: Puntaje de producto (0-20 puntos)
   - evaluacion_objeciones: Puntaje de manejo de objeciones (0-20 puntos)
   - evaluacion_cierre: Puntaje de cierre de venta (0-20 puntos)
   - evaluacion_total: Puntaje total (suma de los 5 anteriores, máximo 100)
   - evaluacion_aprobado: TRUE si >= 71%, FALSE si < 71%
   - evaluacion_razon_rechazo: Texto explicativo si no aprobó
   - fecha_evaluacion: Timestamp de cuándo se realizó la evaluación

2. FLUJO DE EVALUACIÓN:
   - Candidato estado 'entrevistado' → se puede evaluar
   - Si aprueba (≥ 71%) → estado cambia a 'aprobado'
   - Si no aprueba (< 71%) → estado cambia a 'rechazado'
   - Razón de rechazo es obligatoria para candidatos rechazados

3. ÍNDICES AGREGADOS:
   - idx_candidatos_estado: Para consultas rápidas por estado
   - idx_candidatos_oleada: Para consultas de candidatos por oleada
   - idx_candidatos_evaluacion: Para consultas de evaluaciones

4. BACKEND ACTUALIZADO:
   - Nueva ruta: PUT /api/seleccion/candidatos/:candidatoId/evaluacion
   - Consulta actualizada para incluir estados 'aprobado' y 'rechazado'
   - Validaciones de rango (0-20 por criterio)

5. FRONTEND ACTUALIZADO:
   - Nuevo componente: EvaluacionEntrevista.jsx
   - Botón de evaluación para candidatos entrevistados
   - Columna de evaluación en tabla de candidatos
   - Cálculo automático de porcentajes y aprobación

6. COMPATIBILIDAD:
   - Todos los cambios son backwards compatible
   - Candidatos existentes no se ven afectados
   - Campos nullable permiten migración gradual
*/

SELECT 'Script de migración completado exitosamente' as RESULTADO;