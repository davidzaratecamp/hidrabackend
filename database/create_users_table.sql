-- Tabla de usuarios del sistema
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

-- Insertar usuario administrador por defecto
INSERT INTO hyd_usuarios (nombre_completo, email, password_hash, rol) VALUES 
('Administrador', 'admin@asisteing.com', '$2b$10$8K1p/a0drtCZjNQV4CmG8u5d5YFVkWGD1G/5Pn3qA/Gm6vR1Q9B4G', 'administrador');

-- Insertar usuarios de ejemplo
INSERT INTO hyd_usuarios (nombre_completo, email, password_hash, rol) VALUES 
('María García', 'reclutador@asisteing.com', '$2b$10$8K1p/a0drtCZjNQV4CmG8u5d5YFVkWGD1G/5Pn3qA/Gm6vR1Q9B4G', 'reclutador'),
('Juan Pérez', 'seleccion@asisteing.com', '$2b$10$8K1p/a0drtCZjNQV4CmG8u5d5YFVkWGD1G/5Pn3qA/Gm6vR1Q9B4G', 'seleccion');

-- Password por defecto para todos: "admin123"