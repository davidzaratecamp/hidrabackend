-- =============================================================================
-- 016 — Aprobaciones de Staff (jefe inmediato, prueba técnica) y contratación
-- =============================================================================
-- Candidatos Staff (cargo distinto a Agente) no pasan por la evaluación de 5
-- criterios de Clínica Agentes (`candidato_evaluaciones`): en su lugar,
-- Selección/Administrador registra, antes de la decisión final, tres
-- aprobaciones simples Sí/No con razón obligatoria si es No —entrevista
-- (reutiliza `candidato_aprobacion_entrevista` de la migración 014, que dejó
-- de estar restringida a cargo Agente), jefe inmediato y prueba técnica—.
-- Mismo patrón informativo que el resto de esta familia de tablas: no mueven
-- el estado del candidato ni bloquean "Decidir".
--
-- Contratación es la contraparte, para Staff, de "citar a formación"
-- (migración 015, ahora restringida a cargo Agente): paso posterior a la
-- decisión final aprobada.
-- =============================================================================

CREATE TABLE candidato_aprobacion_jefe_inmediato (
  candidato_id INT UNSIGNED NOT NULL,
  aprobacion   BOOLEAN NOT NULL,
  razon        TEXT NULL,
  usuario_id   INT UNSIGNED NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (candidato_id),
  CONSTRAINT fk_aprobacion_jefe_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_aprobacion_jefe_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT ck_aprobacion_jefe_razon CHECK (aprobacion = TRUE OR razon IS NOT NULL)
) ENGINE=InnoDB;

CREATE TABLE candidato_aprobacion_prueba_tecnica (
  candidato_id INT UNSIGNED NOT NULL,
  aprobacion   BOOLEAN NOT NULL,
  razon        TEXT NULL,
  usuario_id   INT UNSIGNED NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (candidato_id),
  CONSTRAINT fk_aprobacion_prueba_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_aprobacion_prueba_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT ck_aprobacion_prueba_razon CHECK (aprobacion = TRUE OR razon IS NOT NULL)
) ENGINE=InnoDB;

CREATE TABLE candidato_contratacion (
  candidato_id INT UNSIGNED NOT NULL,
  contratado   BOOLEAN NOT NULL,
  razon        TEXT NULL,
  usuario_id   INT UNSIGNED NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (candidato_id),
  CONSTRAINT fk_contratacion_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_contratacion_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT ck_contratacion_razon CHECK (contratado = TRUE OR razon IS NOT NULL)
) ENGINE=InnoDB;
