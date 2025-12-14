-- Agregar nuevos estados al ENUM de la columna estado
-- Necesario para permitir 'aprobado_final' y 'rechazado_final'

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
) DEFAULT 'nuevo';

-- Verificar que los nuevos valores se agregaron correctamente
SHOW COLUMNS FROM hyd_candidatos LIKE 'estado';