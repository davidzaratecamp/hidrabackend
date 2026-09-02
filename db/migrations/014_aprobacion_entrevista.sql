-- =============================================================================
-- 014 — Aprobación de entrevista (cargo Agente)
-- =============================================================================
-- Paso previo e informativo a la decisión final (`candidato_decision_final`):
-- Selección o Administrador registra si aprueba la entrevista en sí (Sí/No,
-- con razón obligatoria si es No), antes de tomar la decisión final. Solo
-- aplica a cargo Agente — el mismo criterio de negocio que ya limita la
-- evaluación de 5 criterios (`esCargoAgente` en seleccion.service.js).
--
-- No bloquea "Decidir": es un dato adicional del expediente, no una
-- transición de estado. Mismo patrón que `candidato_decision_final` (upsert
-- por candidato, razón obligatoria solo al rechazar).
-- =============================================================================

CREATE TABLE candidato_aprobacion_entrevista (
  candidato_id INT UNSIGNED NOT NULL,
  aprobacion   BOOLEAN NOT NULL,
  razon        TEXT NULL,
  usuario_id   INT UNSIGNED NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (candidato_id),
  CONSTRAINT fk_aprobacion_entrevista_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_aprobacion_entrevista_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT ck_aprobacion_entrevista_razon CHECK (aprobacion = TRUE OR razon IS NOT NULL)
) ENGINE=InnoDB;
