-- Agrega número de documento a los usuarios del sistema
-- Necesario para consultar desprendibles de nómina por cédula
ALTER TABLE hyd_usuarios
ADD COLUMN numero_documento VARCHAR(20) NULL AFTER nombre_completo;
