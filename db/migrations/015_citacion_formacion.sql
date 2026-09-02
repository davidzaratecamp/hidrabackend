-- =============================================================================
-- 015 — Citación a formación (candidatos aprobados)
-- =============================================================================
-- Al aprobar en decisión final, el candidato pasa al filtro "Aprobados" de la
-- pantalla Evaluaciones. Ahí Selección o Administrador registra si se citó al
-- candidato a formación (Sí/No, con razón obligatoria si es No).
--
-- Mismo patrón informativo que `candidato_aprobacion_entrevista` (migración
-- 014): no mueve el estado del candidato ni bloquea nada, es una nota
-- adicional del expediente. Upsert por candidato.
-- =============================================================================

CREATE TABLE candidato_citacion_formacion (
  candidato_id INT UNSIGNED NOT NULL,
  citado       BOOLEAN NOT NULL,
  razon        TEXT NULL,
  usuario_id   INT UNSIGNED NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (candidato_id),
  CONSTRAINT fk_citacion_formacion_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_citacion_formacion_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT ck_citacion_formacion_razon CHECK (citado = TRUE OR razon IS NOT NULL)
) ENGINE=InnoDB;
