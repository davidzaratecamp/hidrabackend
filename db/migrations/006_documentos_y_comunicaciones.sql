-- =============================================================================
-- 006 — Documentos, antecedentes, tokens, firma y correos
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Archivos subidos
-- -----------------------------------------------------------------------------
-- Una sola tabla para todo archivo asociado a un candidato. Hoy el nombre en
-- disco y el nombre original viven como dos columnas por cada tipo de documento
-- dentro de `hyd_candidatos`.
CREATE TABLE candidato_documentos (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidato_id   INT UNSIGNED NOT NULL,
  tipo_id        TINYINT UNSIGNED NOT NULL,
  ruta_archivo   VARCHAR(255) NOT NULL COMMENT 'Nombre uuid en disco, relativo a uploads/',
  nombre_original VARCHAR(255) NOT NULL COMMENT 'Solo para mostrar y para el Content-Disposition (sanear antes de emitir)',
  mime_type      VARCHAR(100) NOT NULL,
  tamano_bytes   INT UNSIGNED NOT NULL,
  subido_por_id  INT UNSIGNED NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_documentos_ruta (ruta_archivo),
  KEY idx_documentos_candidato (candidato_id, tipo_id),
  CONSTRAINT fk_documentos_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_documentos_tipo
    FOREIGN KEY (tipo_id) REFERENCES tipos_documento_adjunto (id) ON DELETE RESTRICT,
  CONSTRAINT fk_documentos_subido_por
    FOREIGN KEY (subido_por_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT ck_documentos_tamano CHECK (tamano_bytes > 0)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Antecedentes
-- -----------------------------------------------------------------------------
-- Cuatro filas donde el esquema viejo tenía 17 columnas repetidas
-- (`antecedentes_adres_*`, `_pol_*`, `_comp_*`, `_procu_*`). Agregar una quinta
-- verificación pasa a ser un INSERT en `tipos_antecedente`.
CREATE TABLE candidato_antecedentes (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidato_id        INT UNSIGNED NOT NULL,
  tipo_antecedente_id TINYINT UNSIGNED NOT NULL,
  estado              ENUM('aprobado','no_aprobado') NOT NULL,
  novedad             VARCHAR(255) NULL,
  documento_id        INT UNSIGNED NULL,
  verificado_por_id   INT UNSIGNED NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_antecedentes_candidato_tipo (candidato_id, tipo_antecedente_id),
  KEY idx_antecedentes_documento (documento_id),
  CONSTRAINT fk_antecedentes_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_antecedentes_tipo
    FOREIGN KEY (tipo_antecedente_id) REFERENCES tipos_antecedente (id) ON DELETE RESTRICT,
  CONSTRAINT fk_antecedentes_documento
    FOREIGN KEY (documento_id) REFERENCES candidato_documentos (id) ON DELETE SET NULL,
  CONSTRAINT fk_antecedentes_verificado_por
    FOREIGN KEY (verificado_por_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  -- "No aprobado" exige novedad. Hoy la regla vive solo en el controller.
  CONSTRAINT ck_antecedentes_novedad
    CHECK (estado = 'aprobado' OR novedad IS NOT NULL)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Tokens del formulario público
-- -----------------------------------------------------------------------------
-- Sustituye `token_acceso` + `fecha_vencimiento_token` + `fecha_envio_email`.
-- Al ser 1:N se conserva el historial de envíos y un token anterior queda
-- explícitamente revocado, en vez de sobrescrito: eso es lo que hoy produce el
-- "404 Token inválido" confuso al abrir el link de un correo anterior.
CREATE TABLE candidato_tokens_formulario (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidato_id   INT UNSIGNED NOT NULL,
  token          CHAR(36) NOT NULL COMMENT 'UUID v4',
  enviado_por_id INT UNSIGNED NULL,
  enviado_en     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_en      TIMESTAMP NOT NULL,
  usado_en       TIMESTAMP NULL COMMENT 'Momento en que se completó el paso 6',
  revocado_en    TIMESTAMP NULL COMMENT 'Se fija al emitir un token nuevo',
  PRIMARY KEY (id),
  UNIQUE KEY uq_tokens_token (token),
  KEY idx_tokens_candidato (candidato_id, enviado_en),
  CONSTRAINT fk_tokens_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_tokens_enviado_por
    FOREIGN KEY (enviado_por_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT ck_tokens_expira CHECK (expira_en > enviado_en)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Firma electrónica (FirmaCloud)
-- -----------------------------------------------------------------------------
-- Sustituye `firmacloud_signature_id VARCHAR(36)`. Hydra no guarda copia de los
-- documentos firmados: se consultan y descargan en vivo del proveedor.
CREATE TABLE candidato_firmas (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidato_id       INT UNSIGNED NOT NULL,
  proveedor          VARCHAR(40) NOT NULL DEFAULT 'firmacloud',
  referencia_externa VARCHAR(64) NOT NULL COMMENT 'ID que devuelve el proveedor',
  estado             VARCHAR(40) NULL COMMENT 'Último estado consultado al proveedor',
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_firmas_proveedor_referencia (proveedor, referencia_externa),
  KEY idx_firmas_candidato (candidato_id, created_at),
  CONSTRAINT fk_firmas_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Registro de correos enviados
-- -----------------------------------------------------------------------------
-- Cierra la degradación silenciosa actual: si faltan credenciales o `sendMail`
-- falla, el servicio devuelve { success: true, message: 'Email simulado...' } y
-- el usuario ve "Email reenviado exitosamente" aunque no haya salido nada.
CREATE TABLE envios_email (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidato_id INT UNSIGNED NULL,
  destinatario VARCHAR(255) NOT NULL,
  tipo         ENUM('formularios','notificacion_completado') NOT NULL,
  estado       ENUM('enviado','fallido') NOT NULL,
  error        TEXT NULL,
  enviado_por_id INT UNSIGNED NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_envios_candidato (candidato_id, created_at),
  KEY idx_envios_estado (estado, created_at),
  CONSTRAINT fk_envios_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE SET NULL,
  CONSTRAINT fk_envios_enviado_por
    FOREIGN KEY (enviado_por_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT ck_envios_error CHECK (estado = 'enviado' OR error IS NOT NULL)
) ENGINE=InnoDB;
