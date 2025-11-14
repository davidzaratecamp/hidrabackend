-- Crear base de datos
CREATE DATABASE IF NOT EXISTS noviembrehidra 
CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE noviembrehidra;

-- Tabla principal de candidatos
CREATE TABLE hyd_candidatos (
  -- Identificación
  id INT AUTO_INCREMENT PRIMARY KEY,
  primer_nombre VARCHAR(100) NOT NULL,
  primer_apellido VARCHAR(100) NOT NULL,
  email_personal VARCHAR(255) NOT NULL UNIQUE,
  numero_celular VARCHAR(20) NOT NULL,
  nacionalidad VARCHAR(50),
  tipo_documento VARCHAR(20),
  numero_documento VARCHAR(20) NOT NULL,

  -- Aplicación
  cliente VARCHAR(100) NOT NULL,
  cargo VARCHAR(100) NOT NULL,
  oleada VARCHAR(100) NULL,
  ciudad VARCHAR(100),
  fecha_citacion_entrevista DATE NULL,

  -- Hoja de Vida
  estado_civil VARCHAR(50),
  fuente_reclutamiento VARCHAR(100),

  -- Datos Básicos
  segundo_apellido VARCHAR(100),
  tercer_nombre VARCHAR(100),
  genero VARCHAR(20),
  fecha_nacimiento DATE,
  grupo_sanguineo VARCHAR(10),
  municipio_residencia VARCHAR(100),
  barrio_residencia VARCHAR(100),
  direccion_residencia TEXT,
  nombre_emergencia VARCHAR(100),
  numero_emergencia VARCHAR(20),
  parentesco_emergencia VARCHAR(50),
  eps VARCHAR(100),
  afp VARCHAR(100),

  -- Estudios
  nivel_estudios VARCHAR(50),
  titulo_obtenido VARCHAR(200),
  nombre_institucion VARCHAR(200),
  ano_finalizacion YEAR,

  -- Experiencia
  nombre_empresa VARCHAR(200),
  cargo_desempenado VARCHAR(100),
  salario_experiencia DECIMAL(15,2),
  fecha_inicio_experiencia DATE,
  fecha_retiro_experiencia DATE,
  tiempo_laborado_anos INT,
  tiempo_laborado_meses INT,
  motivo_retiro TEXT,
  ha_trabajado_asiste VARCHAR(10),

  -- Personal
  genograma JSON,
  fortalezas TEXT,
  aspectos_mejorar TEXT,
  competencias_laborales TEXT,
  metas_largo_plazo TEXT,
  metas_mediano_plazo TEXT,
  metas_corto_plazo TEXT,
  conocimiento_excel INT(1),
  conocimiento_powerpoint INT(1),
  conocimiento_word INT(1),
  autoevaluacion INT(1),
  experiencia_comercial_certificada VARCHAR(10),
  experiencia_comercial_no_certificada VARCHAR(10),
  primer_empleo_formal VARCHAR(10),

  -- Consentimiento
  ciudad_consentimiento VARCHAR(100),
  dia_consentimiento INT,
  mes_consentimiento INT,
  ano_consentimiento YEAR,
  consentimiento_aceptado BOOLEAN DEFAULT FALSE,

  -- Estados de formularios
  formulario_hoja_vida_completado BOOLEAN DEFAULT FALSE,
  formulario_datos_basicos_completado BOOLEAN DEFAULT FALSE,
  formulario_estudios_completado BOOLEAN DEFAULT FALSE,
  formulario_experiencia_completado BOOLEAN DEFAULT FALSE,
  formulario_personal_completado BOOLEAN DEFAULT FALSE,
  formulario_consentimiento_completado BOOLEAN DEFAULT FALSE,

  -- Fechas de completado
  fecha_completado_hoja_vida TIMESTAMP NULL,
  fecha_completado_datos_basicos TIMESTAMP NULL,
  fecha_completado_estudios TIMESTAMP NULL,
  fecha_completado_experiencia TIMESTAMP NULL,
  fecha_completado_personal TIMESTAMP NULL,
  fecha_completado_consentimiento TIMESTAMP NULL,

  -- Tokens de acceso
  token_acceso VARCHAR(255) UNIQUE,
  fecha_vencimiento_token TIMESTAMP,

  -- Estado del proceso
  estado ENUM('nuevo', 'formularios_enviados', 'formularios_completados', 'citado', 'entrevistado', 'aprobado', 'rechazado', 'contratado') DEFAULT 'nuevo',

  -- Auditoría
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_estado (estado),
  INDEX idx_token (token_acceso),
  INDEX idx_email (email_personal),
  INDEX idx_documento (numero_documento)
);

-- Insertar algunos candidatos de prueba
INSERT INTO hyd_candidatos (
  primer_nombre, primer_apellido, email_personal, numero_celular,
  nacionalidad, tipo_documento, numero_documento, cliente, cargo, 
  oleada, ciudad, token_acceso, fecha_vencimiento_token, estado
) VALUES 
(
  'Juan', 'Pérez', 'juan.perez@email.com', '3001234567',
  'Colombiana', 'CC', '12345678', 'Empresa ABC', 'Desarrollador Frontend',
  'Q4-2024', 'Bogotá', UUID(), DATE_ADD(NOW(), INTERVAL 30 DAY), 'nuevo'
),
(
  'María', 'González', 'maria.gonzalez@email.com', '3007654321',
  'Colombiana', 'CC', '87654321', 'TechCorp', 'Analista de Datos',
  'Q4-2024', 'Medellín', UUID(), DATE_ADD(NOW(), INTERVAL 30 DAY), 'formularios_enviados'
),
(
  'Carlos', 'Rodríguez', 'carlos.rodriguez@email.com', '3009876543',
  'Colombiana', 'CC', '11223344', 'Innovate SA', 'Project Manager',
  NULL, 'Cali', UUID(), DATE_ADD(NOW(), INTERVAL 30 DAY), 'formularios_completados'
);