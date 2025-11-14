-- =====================================================
-- ASISTE ING - SISTEMA DE RECLUTAMIENTO
-- Base de datos completa para despliegue
-- =====================================================

-- Crear base de datos
CREATE DATABASE IF NOT EXISTS noviembrehidra 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

USE noviembrehidra;

-- =====================================================
-- TABLA: hyd_candidatos
-- =====================================================
CREATE TABLE hyd_candidatos (
    id INT PRIMARY KEY AUTO_INCREMENT,
    
    -- Información básica
    primer_nombre VARCHAR(100) NOT NULL,
    segundo_nombre VARCHAR(100) NULL,
    primer_apellido VARCHAR(100) NOT NULL,
    segundo_apellido VARCHAR(100) NULL,
    email_personal VARCHAR(255) NOT NULL UNIQUE,
    numero_celular VARCHAR(20) NOT NULL,
    nacionalidad VARCHAR(100) NULL,
    tipo_documento ENUM('CC', 'CE', 'Pasaporte', 'TI') NOT NULL DEFAULT 'CC',
    numero_documento VARCHAR(50) NOT NULL,
    
    -- Información del cliente y proceso
    cliente VARCHAR(255) NOT NULL,
    cargo VARCHAR(255) NOT NULL,
    oleada VARCHAR(100) NULL,
    ciudad VARCHAR(100) NULL,
    fecha_citacion_entrevista DATETIME NULL,
    fuente_reclutamiento VARCHAR(255) NULL,
    observaciones_llamada TEXT NULL,
    observaciones_generales TEXT NULL,
    
    -- Información adicional (datos básicos)
    genero ENUM('Masculino', 'Femenino', 'Otro') NULL,
    fecha_nacimiento DATE NULL,
    grupo_sanguineo VARCHAR(10) NULL,
    eps VARCHAR(255) NULL,
    afp VARCHAR(255) NULL,
    estado_civil ENUM('Soltero', 'Casado', 'Unión libre', 'Separado', 'Divorciado', 'Viudo') NULL,
    
    -- Contacto de emergencia
    nombre_emergencia VARCHAR(255) NULL,
    numero_emergencia VARCHAR(20) NULL,
    parentesco_emergencia VARCHAR(100) NULL,
    
    -- Educación
    nivel_estudios ENUM('Primaria', 'Secundaria', 'Técnico', 'Tecnológico', 'Universitario', 'Especialización', 'Maestría', 'Doctorado') NULL,
    titulo_obtenido VARCHAR(255) NULL,
    nombre_institucion VARCHAR(255) NULL,
    ano_finalizacion YEAR NULL,
    
    -- Experiencia laboral
    nombre_empresa VARCHAR(255) NULL,
    cargo_desempenado VARCHAR(255) NULL,
    salario_experiencia DECIMAL(12,2) NULL,
    fecha_inicio_experiencia DATE NULL,
    fecha_retiro_experiencia DATE NULL,
    tiempo_laborado_anos INT NULL DEFAULT 0,
    tiempo_laborado_meses INT NULL DEFAULT 0,
    motivo_retiro TEXT NULL,
    ha_trabajado_asiste ENUM('Sí', 'No') NULL,
    
    -- Información personal
    fortalezas TEXT NULL,
    aspectos_mejorar TEXT NULL,
    competencias_laborales TEXT NULL,
    conocimiento_excel INT NULL CHECK (conocimiento_excel BETWEEN 1 AND 5),
    conocimiento_powerpoint INT NULL CHECK (conocimiento_powerpoint BETWEEN 1 AND 5),
    conocimiento_word INT NULL CHECK (conocimiento_word BETWEEN 1 AND 5),
    autoevaluacion INT NULL CHECK (autoevaluacion BETWEEN 1 AND 5),
    
    -- Consentimiento
    consentimiento_aceptado BOOLEAN DEFAULT FALSE,
    ciudad_consentimiento VARCHAR(100) NULL,
    dia_consentimiento INT NULL,
    mes_consentimiento VARCHAR(20) NULL,
    ano_consentimiento YEAR NULL,
    
    -- Control de formularios
    formulario_hoja_vida_completado BOOLEAN DEFAULT FALSE,
    formulario_datos_basicos_completado BOOLEAN DEFAULT FALSE,
    formulario_estudios_completado BOOLEAN DEFAULT FALSE,
    formulario_experiencia_completado BOOLEAN DEFAULT FALSE,
    formulario_personal_completado BOOLEAN DEFAULT FALSE,
    formulario_consentimiento_completado BOOLEAN DEFAULT FALSE,
    
    -- Fechas de completado
    fecha_completado_hoja_vida DATETIME NULL,
    fecha_completado_datos_basicos DATETIME NULL,
    fecha_completado_estudios DATETIME NULL,
    fecha_completado_experiencia DATETIME NULL,
    fecha_completado_personal DATETIME NULL,
    fecha_completado_consentimiento DATETIME NULL,
    
    -- Control de acceso
    token_acceso VARCHAR(255) NULL UNIQUE,
    fecha_vencimiento_token DATETIME NULL,
    
    -- Estado del candidato
    estado ENUM('nuevo', 'formularios_enviados', 'formularios_completados', 'citado', 'entrevistado', 'aprobado', 'rechazado', 'contratado') DEFAULT 'nuevo',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Índices
    INDEX idx_email (email_personal),
    INDEX idx_estado (estado),
    INDEX idx_cliente (cliente),
    INDEX idx_token (token_acceso),
    INDEX idx_created_at (created_at)
);

-- =====================================================
-- TABLA: hyd_usuarios
-- =====================================================
CREATE TABLE hyd_usuarios (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nombre_completo VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    rol ENUM('reclutador', 'seleccion', 'administrador') NOT NULL DEFAULT 'reclutador',
    activo BOOLEAN DEFAULT TRUE,
    ultimo_acceso TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_email (email),
    INDEX idx_rol (rol),
    INDEX idx_activo (activo)
);

-- =====================================================
-- DATOS INICIALES: Usuarios del sistema
-- =====================================================

-- Insertar usuarios por defecto (password: admin123)
INSERT INTO hyd_usuarios (nombre_completo, email, password_hash, rol) VALUES 
('Administrador', 'admin@asisteing.com', '$2b$10$7YVmsY5ZUa5WWBWNn5kXS.H8wQA.j1YKHfKCnw8hwSPanCljUfaiu', 'administrador'),
('María García', 'reclutador@asisteing.com', '$2b$10$7YVmsY5ZUa5WWBWNn5kXS.H8wQA.j1YKHfKCnw8hwSPanCljUfaiu', 'reclutador'),
('Juan Pérez', 'seleccion@asisteing.com', '$2b$10$7YVmsY5ZUa5WWBWNn5kXS.H8wQA.j1YKHfKCnw8hwSPanCljUfaiu', 'seleccion');

-- =====================================================
-- DATOS DE EJEMPLO: Candidatos de prueba
-- =====================================================
INSERT INTO hyd_candidatos (
    primer_nombre, primer_apellido, email_personal, numero_celular, 
    tipo_documento, numero_documento, cliente, cargo, ciudad,
    estado, created_at, updated_at
) VALUES 
('Carlos', 'Rodríguez', 'carlos.rodriguez@email.com', '+57 300 123 4567', 'CC', '1234567890', 'ACME Corp', 'Desarrollador Frontend', 'Bogotá', 'nuevo', NOW(), NOW()),
('Ana', 'Martínez', 'ana.martinez@email.com', '+57 301 234 5678', 'CC', '2345678901', 'Tech Solutions', 'Analista de Datos', 'Medellín', 'formularios_enviados', NOW(), NOW()),
('Luis', 'González', 'luis.gonzalez@email.com', '+57 302 345 6789', 'CC', '3456789012', 'InnovaTech', 'Gerente de Proyecto', 'Cali', 'formularios_completados', NOW(), NOW()),
('María', 'López', 'maria.lopez@email.com', '+57 303 456 7890', 'CC', '4567890123', 'DataCorp', 'UX Designer', 'Barranquilla', 'entrevistado', NOW(), NOW()),
('Diego', 'Herrera', 'diego.herrera@email.com', '+57 304 567 8901', 'CC', '5678901234', 'ACME Corp', 'Backend Developer', 'Bogotá', 'aprobado', NOW(), NOW());

-- =====================================================
-- CONFIGURACIÓN DE LA BASE DE datos
-- =====================================================

-- Configurar charset y collation
ALTER DATABASE noviembrehidra CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- =====================================================
-- INFORMACIÓN DE DESPLIEGUE
-- =====================================================

/*
INSTRUCCIONES PARA DESPLIEGUE:

1. Variables de entorno necesarias (.env):
   PORT=3000
   DB_HOST=tu_servidor_mysql
   DB_USER=tu_usuario_mysql
   DB_PASSWORD=tu_contraseña_mysql
   DB_NAME=noviembrehidra
   DB_PORT=3306
   JWT_SECRET=tu_clave_secreta_jwt
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=465
   EMAIL_USER=tu_email@gmail.com
   EMAIL_PASS=tu_contraseña_aplicacion
   EMAIL_FROM=tu_email@gmail.com
   FRONTEND_URL=http://tu_dominio_frontend

2. Usuarios por defecto:
   - admin@asisteing.com / admin123 (Administrador)
   - reclutador@asisteing.com / admin123 (Reclutador)
   - seleccion@asisteing.com / admin123 (Selección)

3. Comandos de instalación:
   Backend: npm install && npm start
   Frontend: npm install && npm run build

4. Requisitos del servidor:
   - Node.js 18+
   - MySQL 8.0+
   - RAM: mínimo 1GB
   - Espacio: mínimo 1GB
*/