-- =============================================================================
-- 018 — Integración con Gestor (contratación en RRHH)
-- =============================================================================
-- Selección arma un lote con los candidatos aprobados y Hydra lo envía al Gestor
-- Técnico (módulo de RRHH), donde se completan los datos de contratación y se
-- registran como empleados. Al registrarlos, Gestor avisa de vuelta y el
-- candidato pasa a "contratado". Plan completo en el repo de Gestor:
-- `conexionhydra.md` (§5 contrato de la API, §9 fases 5 y 6).
--
-- Tres tablas:
--   * contratacion_lotes ......... lo que Selección envió, y cuándo
--   * contratacion_candidatos .... estado de cada candidato del lado de Gestor
--   * contratacion_envios ........ outbox: peticiones pendientes hacia Gestor
-- =============================================================================

CREATE TABLE contratacion_lotes (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Identificador que viaja a Gestor y que Gestor usa como llave de idempotencia.
  -- Incluye un sufijo aleatorio: dos bases de Hydra (local y producción) generan
  -- los mismos `id`, y no deben poder pisarse si alguna vez apuntan al mismo Gestor.
  lote_externo_id        VARCHAR(64)  NOT NULL,
  nombre                 VARCHAR(150) NOT NULL,
  fecha_ingreso_sugerida DATE NULL,
  creado_por_id          INT UNSIGNED NULL,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contratacion_lotes_externo (lote_externo_id),
  CONSTRAINT fk_contratacion_lotes_creado_por
    FOREIGN KEY (creado_por_id) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Un candidato pertenece a un solo lote: Gestor rechaza (`en_otro_lote`) un
-- candidato que ya está en otro. Por eso la PK es el candidato.
CREATE TABLE contratacion_candidatos (
  candidato_id     INT UNSIGNED NOT NULL,
  lote_id          INT UNSIGNED NOT NULL,
  -- Crece en cada reenvío; Gestor ignora versiones menores o iguales a la suya.
  version          INT UNSIGNED NOT NULL DEFAULT 1,
  estado           ENUM('en_cola','recibido','registrado','descartado','cancelado','error')
                   NOT NULL DEFAULT 'en_cola'
                   COMMENT 'Estado del candidato en Gestor, según lo último que se supo',
  detalle          VARCHAR(255) NULL COMMENT 'Motivo de descarte o de error',
  users_company_id INT UNSIGNED NULL COMMENT 'Empleado creado en Gestor al registrar',
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (candidato_id),
  KEY idx_contratacion_candidatos_lote (lote_id, estado),
  CONSTRAINT fk_contratacion_candidatos_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_contratacion_candidatos_lote
    FOREIGN KEY (lote_id) REFERENCES contratacion_lotes (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Outbox hacia Gestor. Se inserta en la MISMA transacción que crea el lote o
-- marca el cambio; el despachador lo entrega con reintentos. Si Gestor está
-- caído no se pierde nada ni se revierte lo que hizo Selección.
-- El payload se guarda tal cual se va a enviar: un reintento manda exactamente
-- los mismos bytes con la misma Idempotency-Key, como exige Gestor.
CREATE TABLE contratacion_envios (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo            ENUM('lote','actualizacion','cancelacion') NOT NULL,
  lote_id         INT UNSIGNED NOT NULL,
  candidato_id    INT UNSIGNED NULL COMMENT 'Solo en actualizacion/cancelacion',
  metodo          ENUM('POST','PUT') NOT NULL,
  ruta            VARCHAR(120) NOT NULL COMMENT 'Relativa a GESTOR_API_URL',
  payload         JSON NOT NULL,
  idempotency_key CHAR(36) NOT NULL,
  estado          ENUM('pendiente','enviado','fallido') NOT NULL DEFAULT 'pendiente',
  intentos        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  proximo_intento DATETIME NOT NULL,
  ultimo_error    VARCHAR(500) NULL,
  enviado_por_id  INT UNSIGNED NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contratacion_envios_idempotency (idempotency_key),
  KEY idx_contratacion_envios_pendientes (estado, proximo_intento),
  KEY idx_contratacion_envios_lote (lote_id),
  CONSTRAINT fk_contratacion_envios_lote
    FOREIGN KEY (lote_id) REFERENCES contratacion_lotes (id) ON DELETE CASCADE,
  CONSTRAINT fk_contratacion_envios_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE SET NULL,
  CONSTRAINT fk_contratacion_envios_enviado_por
    FOREIGN KEY (enviado_por_id) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Permiso: enviar candidatos a contratación (Selección y Administrador).
-- Como en 011, el CROSS JOIN del seed inicial ya no alcanza a un permiso nuevo:
-- hay que dárselo al administrador explícitamente.
-- -----------------------------------------------------------------------------
INSERT INTO permisos (codigo, nombre, descripcion, modulo) VALUES
  ('enviar_contratacion', 'Enviar a contratación',
   'Enviar candidatos aprobados al módulo de RRHH del Gestor Técnico y seguir su estado',
   'seleccion');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r, permisos p
WHERE r.codigo IN ('administrador', 'seleccion') AND p.codigo = 'enviar_contratacion';
