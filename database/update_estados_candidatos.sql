-- =====================================================
-- ACTUALIZACIÓN: Nuevos estados para candidatos
-- Agregar estados para gestión de contacto
-- =====================================================

USE noviembrehidra;

-- Actualizar el ENUM del campo estado para incluir los nuevos estados
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
    'entrevistado',
    'aprobado',
    'rechazado',
    'contratado'
) DEFAULT 'nuevo';

-- Agregar campos adicionales para mejor tracking
ALTER TABLE hyd_candidatos 
ADD COLUMN fecha_ultimo_contacto DATETIME NULL AFTER estado,
ADD COLUMN intentos_contacto INT DEFAULT 0 AFTER fecha_ultimo_contacto,
ADD COLUMN notas_contacto TEXT NULL AFTER intentos_contacto;

-- Crear índice para optimizar consultas por estado
CREATE INDEX idx_estado_contacto ON hyd_candidatos(estado, fecha_ultimo_contacto);

-- Actualizar candidatos existentes que estén en 'formularios_enviados' a 'contacto_exitoso'
-- (asumiendo que si se enviaron formularios, el contacto fue exitoso)
UPDATE hyd_candidatos 
SET estado = 'contacto_exitoso', fecha_ultimo_contacto = updated_at
WHERE estado = 'formularios_enviados';

-- Después de esto, manually cambiar de 'contacto_exitoso' a 'formularios_enviados' según corresponda