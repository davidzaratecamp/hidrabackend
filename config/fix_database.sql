-- Script para corregir la base de datos
USE noviembrehidra;

-- Cambiar tercer_nombre a segundo_nombre
ALTER TABLE hyd_candidatos 
CHANGE COLUMN tercer_nombre segundo_nombre VARCHAR(100);

-- Eliminar campos de residencia que no se necesitan
ALTER TABLE hyd_candidatos 
DROP COLUMN municipio_residencia,
DROP COLUMN barrio_residencia, 
DROP COLUMN direccion_residencia;