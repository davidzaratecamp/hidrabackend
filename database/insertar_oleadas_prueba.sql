-- Insertar oleadas de prueba para testing
USE noviembrehidra;

-- Staff Administrativo - Analista De Calidad (oleadas 1-6)
INSERT INTO hyd_oleadas (numero_oleada, operacion, campana, descripcion, activa) VALUES 
(1, 'Staff Administrativo', 'Analista De Calidad', 'Primera oleada de Analista De Calidad', TRUE),
(2, 'Staff Administrativo', 'Analista De Calidad', 'Segunda oleada de Analista De Calidad', TRUE),
(3, 'Staff Administrativo', 'Analista De Calidad', 'Tercera oleada de Analista De Calidad', TRUE),
(4, 'Staff Administrativo', 'Analista De Calidad', 'Cuarta oleada de Analista De Calidad', TRUE),
(5, 'Staff Administrativo', 'Analista De Calidad', 'Quinta oleada de Analista De Calidad', TRUE),
(6, 'Staff Administrativo', 'Analista De Calidad', 'Sexta oleada de Analista De Calidad', TRUE);

-- Staff Operacional - Algunos cargos comunes (oleadas 1-3)
INSERT INTO hyd_oleadas (numero_oleada, operacion, campana, descripcion, activa) VALUES 
(1, 'Staff Operacional', 'Analista De Calidad', 'Primera oleada Staff Operacional', TRUE),
(2, 'Staff Operacional', 'Analista De Calidad', 'Segunda oleada Staff Operacional', TRUE),
(3, 'Staff Operacional', 'Analista De Calidad', 'Tercera oleada Staff Operacional', TRUE),
(1, 'Staff Operacional', 'Coordinador', 'Primera oleada Coordinador', TRUE),
(2, 'Staff Operacional', 'Coordinador', 'Segunda oleada Coordinador', TRUE);

-- Claro - Agente Call Center (oleadas 1-4)
INSERT INTO hyd_oleadas (numero_oleada, operacion, campana, descripcion, activa) VALUES 
(1, 'Claro', 'Agente Call Center', 'Primera oleada Claro', TRUE),
(2, 'Claro', 'Agente Call Center', 'Segunda oleada Claro', TRUE),
(3, 'Claro', 'Agente Call Center', 'Tercera oleada Claro', TRUE),
(4, 'Claro', 'Agente Call Center', 'Cuarta oleada Claro', TRUE);

-- Obamacare - Customer Service (oleadas 1-3)
INSERT INTO hyd_oleadas (numero_oleada, operacion, campana, descripcion, activa) VALUES 
(1, 'Obamacare', 'Customer Service', 'Primera oleada Obamacare', TRUE),
(2, 'Obamacare', 'Customer Service', 'Segunda oleada Obamacare', TRUE),
(3, 'Obamacare', 'Customer Service', 'Tercera oleada Obamacare', TRUE);

-- Majority - Agente Call Center (oleadas 1-2)
INSERT INTO hyd_oleadas (numero_oleada, operacion, campana, descripcion, activa) VALUES 
(1, 'Majority', 'Agente Call Center', 'Primera oleada Majority', TRUE),
(2, 'Majority', 'Agente Call Center', 'Segunda oleada Majority', TRUE);

SELECT 'Oleadas de prueba insertadas correctamente' AS resultado;