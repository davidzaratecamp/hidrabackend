-- =====================================================
-- ACTUALIZACIÓN PARA MÓDULO DE SELECCIÓN
-- Agrega funcionalidades para psicólogos
-- =====================================================

USE noviembrehidra;

-- =====================================================
-- TABLA: hyd_oleadas
-- Gestión de oleadas para cada operación y campaña
-- =====================================================
CREATE TABLE hyd_oleadas (
    id INT PRIMARY KEY AUTO_INCREMENT,
    numero_oleada INT NOT NULL,
    operacion VARCHAR(100) NOT NULL, -- Cliente actual (Claro, Obama, Majority, etc.)
    campana VARCHAR(255) NOT NULL,   -- Cargo actual
    fecha_inicio DATE NULL,
    fecha_fin DATE NULL,
    descripcion TEXT NULL,
    activa BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Índices
    INDEX idx_numero_oleada (numero_oleada),
    INDEX idx_operacion (operacion),
    INDEX idx_campana (campana),
    INDEX idx_activa (activa),
    
    -- Evitar duplicados de número de oleada para la misma operación y campaña
    UNIQUE KEY unique_oleada_operacion_campana (numero_oleada, operacion, campana)
);

-- =====================================================
-- ACTUALIZAR TABLA: hyd_candidatos
-- Agregar campos para selección
-- =====================================================

-- Agregar campo para oleada
ALTER TABLE hyd_candidatos 
ADD COLUMN oleada_seleccion_id INT NULL,
ADD COLUMN asistio_citacion ENUM('pendiente', 'asistio', 'no_asistio') DEFAULT 'pendiente',
ADD COLUMN fecha_asistencia DATETIME NULL,
ADD COLUMN observaciones_seleccion TEXT NULL;

-- Agregar índices para los nuevos campos
ALTER TABLE hyd_candidatos 
ADD INDEX idx_oleada_seleccion (oleada_seleccion_id),
ADD INDEX idx_asistio_citacion (asistio_citacion);

-- Agregar clave foránea para oleada
ALTER TABLE hyd_candidatos 
ADD FOREIGN KEY (oleada_seleccion_id) REFERENCES hyd_oleadas(id) ON DELETE SET NULL;

-- =====================================================
-- DATOS INICIALES: Oleadas de ejemplo
-- =====================================================

-- Oleadas para Staff Operacional
INSERT INTO hyd_oleadas (numero_oleada, operacion, campana, descripcion) VALUES
(1, 'Staff Operacional', 'Desarrollador Web', 'Primera oleada de desarrolladores web'),
(1, 'Staff Operacional', 'Analista De Tecnologia', 'Primera oleada de analistas de tecnología'),
(1, 'Staff Operacional', 'Tecnico De Soporte', 'Primera oleada de técnicos de soporte');

-- Oleadas para Staff Administrativo
INSERT INTO hyd_oleadas (numero_oleada, operacion, campana, descripcion) VALUES
(1, 'Staff Administrativo', 'Analista Administrativa Y Contable', 'Primera oleada de analistas administrativos'),
(1, 'Staff Administrativo', 'Coordinador', 'Primera oleada de coordinadores');

-- Oleadas para Claro
INSERT INTO hyd_oleadas (numero_oleada, operacion, campana, descripcion) VALUES
(1, 'Claro', 'Agente Call Center', 'Primera oleada de agentes Claro'),
(1, 'Claro', 'Agente Call Center Plus', 'Primera oleada de agentes Claro Plus');

-- Oleadas para Obamacare
INSERT INTO hyd_oleadas (numero_oleada, operacion, campana, descripcion) VALUES
(1, 'Obamacare', 'Customer Service', 'Primera oleada de customer service'),
(1, 'Obamacare', 'Agente Call Center', 'Primera oleada de agentes Obamacare');

-- Oleadas para Majority
INSERT INTO hyd_oleadas (numero_oleada, operacion, campana, descripcion) VALUES
(1, 'Majority', 'Agente Call Center', 'Primera oleada de agentes Majority');

-- =====================================================
-- ACTUALIZAR ESTADOS DE CANDIDATOS
-- Agregar nuevos estados para el flujo de selección
-- =====================================================

-- Los estados actuales son suficientes, pero agregamos comentarios para claridad:
-- 'citado' -> Los candidatos en este estado pasan a selección
-- 'no_asistio' -> Marcado por selección si no asistió a la cita
-- 'entrevistado' -> Marcado por selección después de la entrevista

-- =====================================================
-- INFORMACIÓN PARA DESARROLLO
-- =====================================================

/*
FLUJO DEL MÓDULO DE SELECCIÓN:

1. Candidatos con estado 'citado' aparecen en la vista de selección
2. Psicólogos pueden:
   - Marcar asistencia (asistio/no_asistio)
   - Asignar a oleada (operacion + campana + numero_oleada)
   - Cambiar estado a 'entrevistado', 'aprobado', 'rechazado'
   - Agregar observaciones específicas de selección

3. Campos importantes:
   - cliente (tabla candidatos) -> operacion (tabla oleadas)
   - cargo (tabla candidatos) -> campana (tabla oleadas)
   - oleada_seleccion_id -> vincula a tabla oleadas
   - asistio_citacion -> control de asistencia
   
4. Los psicólogos también pueden crear candidatos usando
   el mismo formulario que los reclutadores
*/