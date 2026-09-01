-- =============================================================================
-- SEED 003 — Catálogos
-- =============================================================================
-- Valores extraídos de `models/candidato.model.js:getOpcionesCatalogo()` y de
-- MOTIVOS_INASISTENCIA en `CandidatosSeleccion.jsx` (frontend).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Identidad y ubicación
-- -----------------------------------------------------------------------------
-- La nacionalidad se derivaba con `tipo_documento === 'CC' ? 'Colombiano' : 'Venezolano'`,
-- hardcodeado en candidato.controller.js y en candidatoFormulario.service.js.
INSERT INTO tipos_documento (codigo, nombre, nacionalidad, orden) VALUES
  ('CC',  'CC',  'Colombiano', 1),
  ('PPT', 'PPT', 'Venezolano', 2);

INSERT INTO ciudades (codigo, nombre, orden) VALUES
  ('bogota',       'Bogotá',       1),
  ('barranquilla', 'Barranquilla', 2);

-- -----------------------------------------------------------------------------
-- Clientes / campañas
-- -----------------------------------------------------------------------------
INSERT INTO clientes (codigo, nombre, orden) VALUES
  ('Staff Operacional',    'Staff Operacional',    1),
  ('Staff Administrativo', 'Staff Administrativo', 2),
  ('Obamacare',            'Obamacare',            3),
  ('Hogar',                'Hogar',                4),
  ('Móvil',                'Móvil',                5),
  ('TyT',                  'TyT',                  6),
  ('Pymes',                'Pymes',                7),
  ('ACA',                  'ACA',                  8),
  ('Customer',             'Customer',             9);

-- -----------------------------------------------------------------------------
-- Cargos
-- -----------------------------------------------------------------------------
-- INSERT IGNORE porque la colación es case-insensitive y el catálogo viejo tiene
-- el mismo cargo escrito de dos formas ('Backoffice' en cargos_staff y
-- 'BackOffice' en CARGOS_BASE_RECLUTAMIENTO). Antes eran dos entradas distintas
-- del desplegable; aquí queda una sola.
INSERT IGNORE INTO cargos (codigo, nombre) VALUES
  -- CARGOS_BASE_RECLUTAMIENTO: disponibles para todos los clientes
  ('Agente','Agente'),
  ('Agente Plus','Agente Plus'),
  ('Analista De Calidad','Analista De Calidad'),
  ('Analista De Reclutamiento','Analista De Reclutamiento'),
  ('Analista De Seleccion','Analista De Seleccion'),
  ('Analista De Usuarios','Analista De Usuarios'),
  ('Analista PQR','Analista PQR'),
  ('BackOffice','BackOffice'),
  ('Community Manager','Community Manager'),
  ('Coordinador','Coordinador'),
  ('Coordinador BackOffice','Coordinador BackOffice'),
  ('Coordinador De Reclutamiento Y Selección','Coordinador De Reclutamiento Y Selección'),
  ('Coordinadora De Calidad','Coordinadora De Calidad'),
  ('Director de formación','Director de formación'),
  ('Formador','Formador'),
  ('Formador Senior','Formador Senior'),
  ('Jefe de operacion','Jefe de operacion'),
  ('Jefe De Reclutamiento Y Selección','Jefe De Reclutamiento Y Selección'),
  ('Legalizador','Legalizador'),
  ('Psicologo De Seleccion','Psicologo De Seleccion'),
  ('Team Leader','Team Leader'),
  ('Team Lider BackOffice','Team Lider BackOffice'),
  ('Team Lider Operaciones','Team Lider Operaciones'),
  -- Propios de Staff
  ('Analista Administrativa Y Contable','Analista Administrativa Y Contable'),
  ('Analista De Calidad Pe','Analista De Calidad Pe'),
  ('Analista De Contratacion','Analista De Contratacion'),
  ('Auditor/Gestor Calidad Comercial','Auditor/Gestor Calidad Comercial'),
  ('Auxiliar De Gestion Humana','Auxiliar De Gestion Humana'),
  ('Auxiliar De Servicios Generales','Auxiliar De Servicios Generales'),
  ('Auxiliar Juridico','Auxiliar Juridico'),
  ('Auxiliar Mantenimiento','Auxiliar Mantenimiento'),
  ('Auxiliar SST','Auxiliar SST'),
  ('Ayudante De Obra','Ayudante De Obra'),
  ('Backoffice Pe','Backoffice Pe'),
  ('Contador','Contador'),
  ('Coordinador Datamarshall','Coordinador Datamarshall'),
  ('Coordinador De Contratacion','Coordinador De Contratacion'),
  ('Coordinador De Nomina','Coordinador De Nomina'),
  ('Coordinador De Tecnologia','Coordinador De Tecnologia'),
  ('Coordinador De Usuarios','Coordinador De Usuarios'),
  ('Coordinador Pe','Coordinador Pe'),
  ('Coordinador Tecnico','Coordinador Tecnico'),
  ('Coordinadora Backoffice','Coordinadora Backoffice'),
  ('Datamarshall','Datamarshall'),
  ('Datamarshall Senior Pe','Datamarshall Senior Pe'),
  ('Desarrollador Web','Desarrollador Web'),
  ('Director de Operaciones','Director de Operaciones'),
  ('Director de Operaciones Pe','Director de Operaciones Pe'),
  ('Director De Tecnologia','Director De Tecnologia'),
  ('Diseñador Grafico','Diseñador Grafico'),
  ('Formador Pe','Formador Pe'),
  ('Gestora De Marketing Y Calidad De Se','Gestora De Marketing Y Calidad De Se'),
  ('GTR','GTR'),
  ('Jefe Backoffice','Jefe Backoffice'),
  ('Jefe De Manteniminento','Jefe De Manteniminento'),
  ('Jefe de workforce','Jefe de workforce'),
  ('Jefe Financiero','Jefe Financiero'),
  ('Jefe Juridica','Jefe Juridica'),
  ('Maestro De Obra','Maestro De Obra'),
  ('Profesional De SST','Profesional De SST'),
  ('Recepcionista','Recepcionista'),
  ('Subgerente De Operaciones','Subgerente De Operaciones'),
  ('Tecnico De Soporte','Tecnico De Soporte'),
  ('Staff','Staff'),
  -- Propios de Obamacare
  ('Customer Service','Customer Service'),
  ('Agente Call Center','Agente Call Center');
-- No se siembra 'Agente Call Center Plus': solo existía en `cargos_claro`, y el
-- cliente 'Claro' ya no está en el catálogo (la rama del switch del frontend
-- quedó muerta). Lo mismo con `cargos_majority`.

-- Todos los clientes reciben el catálogo base.
INSERT INTO cliente_cargos (cliente_id, cargo_id)
SELECT cl.id, ca.id
FROM clientes cl
CROSS JOIN cargos ca
WHERE ca.codigo IN (
  'Agente','Agente Plus','Analista De Calidad','Analista De Reclutamiento',
  'Analista De Seleccion','Analista De Usuarios','Analista PQR','BackOffice',
  'Community Manager','Coordinador','Coordinador BackOffice',
  'Coordinador De Reclutamiento Y Selección','Coordinadora De Calidad',
  'Director de formación','Formador','Formador Senior','Jefe de operacion',
  'Jefe De Reclutamiento Y Selección','Legalizador','Psicologo De Seleccion',
  'Team Leader','Team Lider BackOffice','Team Lider Operaciones'
);

-- Cargos propios de Staff Operacional y Staff Administrativo.
INSERT IGNORE INTO cliente_cargos (cliente_id, cargo_id)
SELECT cl.id, ca.id
FROM clientes cl
CROSS JOIN cargos ca
WHERE cl.codigo IN ('Staff Operacional','Staff Administrativo')
  AND ca.codigo IN (
    'Analista Administrativa Y Contable','Analista De Calidad Pe',
    'Analista De Contratacion','Auditor/Gestor Calidad Comercial',
    'Auxiliar De Gestion Humana','Auxiliar De Servicios Generales',
    'Auxiliar Juridico','Auxiliar Mantenimiento','Auxiliar SST','Ayudante De Obra',
    'Backoffice Pe','Contador','Coordinador Datamarshall','Coordinador De Contratacion',
    'Coordinador De Nomina','Coordinador De Tecnologia','Coordinador De Usuarios',
    'Coordinador Pe','Coordinador Tecnico','Coordinadora Backoffice','Datamarshall',
    'Datamarshall Senior Pe','Desarrollador Web','Director de Operaciones',
    'Director de Operaciones Pe','Director De Tecnologia','Diseñador Grafico',
    'Formador Pe','Gestora De Marketing Y Calidad De Se','GTR','Jefe Backoffice',
    'Jefe De Manteniminento','Jefe de workforce','Jefe Financiero','Jefe Juridica',
    'Maestro De Obra','Profesional De SST','Recepcionista','Subgerente De Operaciones',
    'Tecnico De Soporte','Staff'
  );

-- Cargos propios de Obamacare.
INSERT IGNORE INTO cliente_cargos (cliente_id, cargo_id)
SELECT cl.id, ca.id
FROM clientes cl
CROSS JOIN cargos ca
WHERE cl.codigo = 'Obamacare'
  AND ca.codigo IN ('Customer Service','Agente Call Center');

-- -----------------------------------------------------------------------------
-- Gestión de contacto
-- -----------------------------------------------------------------------------
INSERT INTO fuentes_reclutamiento (codigo, nombre, orden) VALUES
  ('Computrabajo','Computrabajo',1), ('LinkedIn','LinkedIn',2),
  ('Referido Empleado','Referido Empleado',3), ('Referido Externo','Referido Externo',4),
  ('Redes Sociales','Redes Sociales',5), ('Ferias de Empleo','Ferias de Empleo',6),
  ('Universidades','Universidades',7), ('Base de Datos','Base de Datos',8),
  ('Otro','Otro',9);

-- 'Contacto exitoso' se retiró del catálogo (decisión de negocio, 2026-08-30).
-- Para las bases que ya lo tienen sembrado, lo desactiva la migración 008.
INSERT INTO tipificaciones_llamada (codigo, nombre, orden) VALUES
  ('No contesta','No contesta',1),
  ('Ocupado','Ocupado',2), ('Número incorrecto','Número incorrecto',3),
  ('Interesado','Interesado',4), ('No interesado','No interesado',5),
  ('Reagendar','Reagendar',6), ('No apto','No apto',7);

INSERT INTO estados_gestion_reclutamiento (codigo, nombre, grupo, orden) VALUES
  ('#Errado','#Errado',NULL,1),
  ('No Contesta / Msj Global-Wa','No Contesta / Msj Global-Wa',NULL,2),
  ('Contesta / Cuelga / Mensaje Global-Wa','Contesta / Cuelga / Mensaje Global-Wa',NULL,3),
  ('No Apto / Estudiante','No Apto / Estudiante','NO APTO POR:',10),
  ('No Apto / No experiencia','No Apto / No experiencia','NO APTO POR:',11),
  ('No Apto / Ubicación','No Apto / Ubicación','NO APTO POR:',12),
  ('No Apto / Edad mayor a 35','No Apto / Edad mayor a 35','NO APTO POR:',13),
  ('No Apto / No certificado de bachiller','No Apto / No certificado de bachiller','NO APTO POR:',14),
  ('No Apto / Menor de edad','No Apto / Menor de edad','NO APTO POR:',15),
  ('No Apto / Disposición','No Apto / Disposición','NO APTO POR:',16),
  ('No Apto / Sobreperfilado','No Apto / Sobreperfilado','NO APTO POR:',17),
  ('No Apto / EPS','No Apto / EPS','NO APTO POR:',18),
  ('No interesado / Horarios','No interesado / Horarios','NO INTERESADOS POR:',20),
  ('No interesado / Ventas','No interesado / Ventas','NO INTERESADOS POR:',21),
  ('No interesado / Ubicación','No interesado / Ubicación','NO INTERESADOS POR:',22),
  ('No interesado / Capacitación','No interesado / Capacitación','NO INTERESADOS POR:',23),
  ('No interesado / Call Center','No interesado / Call Center','NO INTERESADOS POR:',24),
  ('No interesado / Ya trabaja','No interesado / Ya trabaja','NO INTERESADOS POR:',25),
  ('No interesado / No parqueadero','No interesado / No parqueadero','NO INTERESADOS POR:',26);

INSERT INTO motivos_inasistencia (codigo, nombre, requiere_detalle, orden) VALUES
  ('Calamidad','Calamidad',FALSE,1),
  ('Asunto personal','Asunto personal',FALSE,2),
  ('Otra oferta / Menos días capa','Otra oferta / Menos días capa',FALSE,3),
  ('Otra oferta / Contrato inmediato','Otra oferta / Contrato inmediato',FALSE,4),
  ('No contesta','No contesta',FALSE,5),
  ('No interesado / Horarios','No interesado / Horarios',FALSE,6),
  ('No interesado / Ventas','No interesado / Ventas',FALSE,7),
  ('No interesado / Ubicación','No interesado / Ubicación',FALSE,8),
  ('No interesado / Capacitación','No interesado / Capacitación',FALSE,9),
  ('No interesado / Call center','No interesado / Call center',FALSE,10),
  ('No interesado / No parqueadero','No interesado / No parqueadero',FALSE,11),
  ('Otra','Otra',TRUE,12);

-- -----------------------------------------------------------------------------
-- Datos personales
-- -----------------------------------------------------------------------------
INSERT INTO estados_civiles (codigo, nombre, orden) VALUES
  ('soltero','Soltero(a)',1), ('casado','Casado(a)',2), ('union_libre','Unión libre',3),
  ('separado','Separado(a)',4), ('divorciado','Divorciado(a)',5), ('viudo','Viudo(a)',6);

INSERT INTO generos (codigo, nombre, orden) VALUES
  ('masculino','Masculino',1), ('femenino','Femenino',2);

INSERT INTO grupos_sanguineos (codigo, nombre, orden) VALUES
  ('O+','O+',1), ('O-','O-',2), ('A+','A+',3), ('A-','A-',4),
  ('B+','B+',5), ('B-','B-',6), ('AB+','AB+',7), ('AB-','AB-',8);

INSERT INTO eps (codigo, nombre, orden) VALUES
  ('Sura EPS','Sura EPS',1), ('Nueva EPS','Nueva EPS',2), ('Sanitas EPS','Sanitas EPS',3),
  ('Salud Total EPS','Salud Total EPS',4), ('Compensar EPS','Compensar EPS',5),
  ('Famisanar EPS','Famisanar EPS',6), ('Medimás EPS','Medimás EPS',7),
  ('Aliansalud EPS','Aliansalud EPS',8), ('EPS SOAS','EPS SOAS',9),
  ('Coosalud EPS','Coosalud EPS',10), ('Mutual SER','Mutual SER',11),
  ('Capital Salud','Capital Salud',12), ('Régimen Especial','Régimen Especial',13),
  ('No tengo EPS','No tengo EPS',14);

INSERT INTO afp (codigo, nombre, orden) VALUES
  ('Protección','Protección',1), ('Porvenir','Porvenir',2), ('Colfondos','Colfondos',3),
  ('Old Mutual','Old Mutual',4), ('Skandia','Skandia',5), ('Colpensiones','Colpensiones',6),
  ('No tengo AFP','No tengo AFP',7);

INSERT INTO parentescos (codigo, nombre, orden) VALUES
  ('padre','Padre',1), ('madre','Madre',2), ('hermano','Hermano(a)',3),
  ('hijo','Hijo(a)',4), ('conyuge','Cónyuge',5), ('pareja','Pareja',6),
  ('tio','Tío(a)',7), ('primo','Primo(a)',8), ('abuelo','Abuelo(a)',9),
  ('amigo','Amigo(a)',10), ('otro','Otro',11);

-- No existía catálogo: `talla_camisa` era VARCHAR(10) libre.
INSERT INTO tallas_camisa (codigo, nombre, orden) VALUES
  ('XS','XS',1), ('S','S',2), ('M','M',3), ('L','L',4), ('XL','XL',5), ('XXL','XXL',6);

-- OJO: estos códigos están acoplados al mapa NIVEL_ROWS de hojaVidaPdfService.js.
INSERT INTO niveles_estudios (codigo, nombre, orden) VALUES
  ('bachillerato','Bachillerato',1),
  ('tecnico_tecnologo','Técnico/Tecnólogo',2),
  ('profesional_u_otros','Profesional u Otros',3),
  ('conocimientos_informaticos','Conocimientos Informáticos',4);

INSERT INTO herramientas_informaticas (codigo, nombre, orden) VALUES
  ('excel','Excel',1), ('powerpoint','PowerPoint',2), ('word','Word',3);

-- -----------------------------------------------------------------------------
-- Selección y documentos
-- -----------------------------------------------------------------------------
-- Los 5 criterios que hoy son columnas fijas de hyd_candidatos.
INSERT INTO criterios_evaluacion (codigo, nombre, puntaje_maximo, orden) VALUES
  ('saludo','Saludo',20.00,1),
  ('perfilamiento','Perfilamiento',20.00,2),
  ('producto','Producto',20.00,3),
  ('objeciones','Manejo de objeciones',20.00,4),
  ('cierre','Cierre',20.00,5);

INSERT INTO tipos_antecedente (codigo, nombre, orden) VALUES
  ('adres','ADRES',1),
  ('policia','Antecedentes de Policía',2),
  ('comparendos','Comparendos',3),
  ('procuraduria','Procuraduría',4);

INSERT INTO tipos_documento_adjunto (codigo, nombre, orden) VALUES
  ('antecedente_adres','Soporte ADRES',1),
  ('antecedente_policia','Soporte antecedentes de Policía',2),
  ('antecedente_comparendos','Soporte comparendos',3),
  ('antecedente_procuraduria','Soporte Procuraduría',4),
  ('otro','Otro documento',99);
