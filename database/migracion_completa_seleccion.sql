-- ========================================
-- MIGRACIÓN COMPLETA - MÓDULO DE SELECCIÓN
-- Sistema completo de gestión de selección de candidatos
-- Fecha: 2025-12-12
-- INCLUYE: Oleadas, Evaluaciones, Estados, Asistencia
-- ========================================

USE noviembrehidra;

-- ========================================
-- 1. TABLA DE OLEADAS (Sistema de ondas secuenciales)
-- ========================================

-- Crear tabla de oleadas si no existe
CREATE TABLE IF NOT EXISTS `hyd_oleadas` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `numero_oleada` int(11) NOT NULL COMMENT 'Número de la oleada (1, 2, 3, etc.)',
  `operacion` varchar(100) NOT NULL COMMENT 'Operación/Cliente (ej: Staff Administrativo, Claro)',
  `campana` varchar(100) NOT NULL COMMENT 'Campaña/Cargo (ej: Analista De Calidad, Agente Call Center)',
  `descripcion` varchar(255) DEFAULT NULL COMMENT 'Descripción de la oleada',
  `fecha_inicio` datetime DEFAULT NULL COMMENT 'Fecha de inicio de la oleada',
  `fecha_fin` datetime DEFAULT NULL COMMENT 'Fecha de fin de la oleada',
  `activa` tinyint(1) DEFAULT 1 COMMENT 'Si la oleada está activa (1) o inactiva (0)',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_oleada_operacion_campana` (`numero_oleada`,`operacion`,`campana`),
  KEY `idx_oleada_operacion` (`operacion`),
  KEY `idx_oleada_campana` (`campana`),
  KEY `idx_oleada_activa` (`activa`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Oleadas secuenciales para gestión de selección';

-- ========================================
-- 2. CAMPOS DE CANDIDATOS - SELECCIÓN Y ASISTENCIA
-- ========================================

-- Agregar campos de selección si no existen
ALTER TABLE hyd_candidatos 
ADD COLUMN IF NOT EXISTS oleada_seleccion_id INT(11) DEFAULT NULL COMMENT 'ID de la oleada asignada',
ADD COLUMN IF NOT EXISTS asistio_citacion ENUM('pendiente', 'asistio', 'no_asistio') DEFAULT 'pendiente' COMMENT 'Estado de asistencia a la citación',
ADD COLUMN IF NOT EXISTS fecha_asistencia DATETIME DEFAULT NULL COMMENT 'Fecha y hora que marcó asistencia',
ADD COLUMN IF NOT EXISTS observaciones_seleccion TEXT DEFAULT NULL COMMENT 'Observaciones del área de selección';

-- Agregar clave foránea para oleadas
ALTER TABLE hyd_candidatos 
ADD CONSTRAINT IF NOT EXISTS fk_candidatos_oleada 
FOREIGN KEY (oleada_seleccion_id) REFERENCES hyd_oleadas(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- ========================================
-- 3. CAMPOS DE EVALUACIÓN DE ENTREVISTA
-- ========================================

-- Sistema de evaluación con 5 criterios (0-20 puntos cada uno)
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

-- ========================================
-- 4. ÍNDICES PARA OPTIMIZACIÓN
-- ========================================

-- Índices para consultas de candidatos
CREATE INDEX IF NOT EXISTS idx_candidatos_estado ON hyd_candidatos(estado);
CREATE INDEX IF NOT EXISTS idx_candidatos_oleada_seleccion ON hyd_candidatos(oleada_seleccion_id);
CREATE INDEX IF NOT EXISTS idx_candidatos_asistencia ON hyd_candidatos(asistio_citacion);
CREATE INDEX IF NOT EXISTS idx_candidatos_evaluacion ON hyd_candidatos(evaluacion_aprobado, fecha_evaluacion);
CREATE INDEX IF NOT EXISTS idx_candidatos_fecha_citacion ON hyd_candidatos(fecha_citacion_entrevista);

-- Índices para oleadas
CREATE INDEX IF NOT EXISTS idx_oleadas_operacion_campana ON hyd_oleadas(operacion, campana);
CREATE INDEX IF NOT EXISTS idx_oleadas_numero ON hyd_oleadas(numero_oleada);

-- ========================================
-- 5. DATOS INICIALES - OLEADAS DE EJEMPLO
-- ========================================

-- Insertar oleadas iniciales (solo si no existen)
INSERT IGNORE INTO hyd_oleadas (numero_oleada, operacion, campana, descripcion, activa) VALUES 
-- Staff Administrativo
(1, 'Staff Administrativo', 'Analista De Calidad', 'Primera oleada', TRUE),
(2, 'Staff Administrativo', 'Analista De Calidad', 'Segunda oleada', TRUE),
(3, 'Staff Administrativo', 'Analista De Calidad', 'Tercera oleada', TRUE),
(4, 'Staff Administrativo', 'Analista De Calidad', 'Cuarta oleada', TRUE),
(5, 'Staff Administrativo', 'Analista De Calidad', 'Quinta oleada', TRUE),
(6, 'Staff Administrativo', 'Analista De Calidad', 'Sexta oleada', TRUE),
(1, 'Staff Administrativo', 'Coordinador', 'Primera oleada', TRUE),
(1, 'Staff Administrativo', 'Analista Administrativa Y Contable', 'Primera oleada', TRUE),

-- Staff Operacional
(1, 'Staff Operacional', 'Desarrollador Web', 'Primera oleada', TRUE),
(1, 'Staff Operacional', 'Analista De Tecnologia', 'Primera oleada', TRUE),
(1, 'Staff Operacional', 'Tecnico De Soporte', 'Primera oleada', TRUE),

-- Operaciones Comerciales
(1, 'Claro', 'Agente Call Center', 'Primera oleada', TRUE),
(2, 'Claro', 'Agente Call Center', 'Segunda oleada', TRUE),
(3, 'Claro', 'Agente Call Center', 'Tercera oleada', TRUE),
(4, 'Claro', 'Agente Call Center', 'Cuarta oleada', TRUE),

(1, 'Obamacare', 'Customer Service', 'Primera oleada', TRUE),
(2, 'Obamacare', 'Customer Service', 'Segunda oleada', TRUE),
(3, 'Obamacare', 'Customer Service', 'Tercera oleada', TRUE),

(1, 'Majority', 'Agente Call Center', 'Primera oleada', TRUE),
(2, 'Majority', 'Agente Call Center', 'Segunda oleada', TRUE);

-- ========================================
-- 6. USUARIO DE SELECCIÓN (si no existe)
-- ========================================

-- Crear usuario de selección para pruebas (solo si no existe)
INSERT IGNORE INTO hyd_usuarios (nombre_completo, email, password, rol, activo, permisos) 
VALUES (
    'Psicologo Selección',
    'seleccion@asisteing.com',
    '$2b$10$rQJ8YnR.5RqW7LnLj1.zQeQ8XNrfQm8E7KzGJlmJKc6PnXdNV2Y8u', -- admin123
    'seleccion',
    1,
    '["ver_candidatos","crear_candidatos","editar_candidatos","editar_estados_candidatos","ver_perfiles_completos","generar_reportes_seleccion","agendar_entrevistas","reenviar_emails"]'
);

-- ========================================
-- 7. VERIFICACIONES Y RESUMEN
-- ========================================

-- Mostrar estructura actualizada de candidatos (campos de selección)
SELECT 'CAMPOS DE SELECCIÓN AGREGADOS A HYD_CANDIDATOS:' as titulo;
SELECT 
    COLUMN_NAME as campo,
    DATA_TYPE as tipo,
    IS_NULLABLE as nullable,
    COLUMN_DEFAULT as valor_default,
    COLUMN_COMMENT as descripcion
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = 'noviembrehidra' 
    AND TABLE_NAME = 'hyd_candidatos' 
    AND (COLUMN_NAME LIKE 'oleada_%' 
         OR COLUMN_NAME LIKE 'asistio_%' 
         OR COLUMN_NAME LIKE 'fecha_asistencia%'
         OR COLUMN_NAME LIKE 'observaciones_seleccion%'
         OR COLUMN_NAME LIKE 'evaluacion_%')
ORDER BY COLUMN_NAME;

-- Mostrar tabla de oleadas
SELECT 'TABLA HYD_OLEADAS CREADA:' as titulo;
DESCRIBE hyd_oleadas;

-- Contar oleadas creadas
SELECT 'OLEADAS INICIALES CREADAS:' as titulo;
SELECT 
    operacion,
    campana,
    COUNT(*) as total_oleadas,
    GROUP_CONCAT(numero_oleada ORDER BY numero_oleada) as numeros_oleada
FROM hyd_oleadas 
WHERE activa = 1
GROUP BY operacion, campana
ORDER BY operacion, campana;

-- Estadísticas de candidatos
SELECT 'ESTADÍSTICAS DE CANDIDATOS:' as titulo;
SELECT 
    estado,
    COUNT(*) as total,
    COUNT(oleada_seleccion_id) as con_oleada_asignada,
    COUNT(CASE WHEN evaluacion_total IS NOT NULL THEN 1 END) as evaluados,
    COUNT(CASE WHEN evaluacion_aprobado = 1 THEN 1 END) as aprobados
FROM hyd_candidatos 
GROUP BY estado
ORDER BY 
    CASE estado 
        WHEN 'nuevo' THEN 1
        WHEN 'contactado' THEN 2
        WHEN 'citado' THEN 3 
        WHEN 'entrevistado' THEN 4 
        WHEN 'no_asistio' THEN 5 
        WHEN 'aprobado' THEN 6 
        WHEN 'rechazado' THEN 7
        WHEN 'contratado' THEN 8 
        ELSE 9 
    END;

-- Verificar usuario de selección
SELECT 'USUARIO DE SELECCIÓN:' as titulo;
SELECT id, nombre_completo, email, rol, activo 
FROM hyd_usuarios 
WHERE rol = 'seleccion' OR email = 'seleccion@asisteing.com';

-- ========================================
-- RESUMEN FINAL
-- ========================================
SELECT 
    '========================================' as separador,
    'MIGRACIÓN COMPLETA DEL MÓDULO DE SELECCIÓN' as titulo,
    '========================================' as separador2;

SELECT 'FUNCIONALIDADES IMPLEMENTADAS:' as titulo;
SELECT 
    '✅ Sistema de Oleadas Secuenciales' as funcionalidad
UNION ALL SELECT '✅ Gestión de Asistencia a Citaciones'
UNION ALL SELECT '✅ Sistema de Evaluación de Entrevistas (5 criterios)'
UNION ALL SELECT '✅ Estados de Candidatos (citado → entrevistado → aprobado/rechazado)'
UNION ALL SELECT '✅ Asignación Libre de Oleadas por Psicólogos'
UNION ALL SELECT '✅ Usuario de Selección con Permisos'
UNION ALL SELECT '✅ Índices para Optimización de Consultas'
UNION ALL SELECT '✅ Datos Iniciales de Oleadas por Operación/Campaña';

-- ========================================
-- NOTAS IMPORTANTES PARA PRODUCCIÓN:
-- ========================================
/*
🔥 CAMBIOS PRINCIPALES IMPLEMENTADOS:

1. TABLA HYD_OLEADAS:
   - Sistema de oleadas secuenciales (1, 2, 3, etc.)
   - Por operación y campaña
   - Control de activación/desactivación

2. CAMPOS EN HYD_CANDIDATOS:
   - oleada_seleccion_id: Asignación a oleadas
   - asistio_citacion: Control de asistencia (pendiente/asistio/no_asistio)
   - fecha_asistencia: Timestamp de asistencia
   - observaciones_seleccion: Notas del área de selección
   - 9 campos de evaluación (saludo, perfilamiento, producto, objeciones, cierre, total, aprobado, razón, fecha)

3. FLUJO COMPLETO:
   candidato citado → marca asistencia → estado entrevistado → evaluación → aprobado/rechazado

4. RUTAS BACKEND AGREGADAS:
   - GET /api/seleccion/candidatos-citados
   - GET /api/seleccion/oleadas
   - GET /api/seleccion/estadisticas
   - PUT /api/seleccion/candidatos/:id/asistencia
   - PUT /api/seleccion/candidatos/:id/oleada
   - PUT /api/seleccion/candidatos/:id/evaluacion
   - POST /api/seleccion/oleadas

5. COMPONENTES FRONTEND:
   - CandidatosSeleccion.jsx (interfaz principal)
   - EvaluacionEntrevista.jsx (modal de evaluación)
   - SidebarSeleccion.jsx (navegación)
   - Navegación role-based fixed

6. PERMISOS Y USUARIO:
   - Usuario: seleccion@asisteing.com / admin123
   - Rol: 'seleccion'
   - Permisos completos para gestión de candidatos

7. COMPATIBILIDAD:
   - 100% backwards compatible
   - No afecta módulo de reclutamiento
   - Migración gradual sin pérdida de datos
*/

SELECT 'Script de migración completa ejecutado exitosamente' as RESULTADO_FINAL;