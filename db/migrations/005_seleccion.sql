-- =============================================================================
-- 005 — Citación, asistencia, evaluación y decisión final
-- =============================================================================
-- Corrige el problema estructural central del sistema viejo: el avance del
-- candidato vivía repartido en cuatro columnas paralelas de `hyd_candidatos`
-- (`estado`, `citado_gestion`, `asistio_citacion`, `aprobacion_final`), y la
-- fecha de la cita era una columna suelta que quedó sin ningún escritor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Citaciones
-- -----------------------------------------------------------------------------
-- Es 1:N a propósito: reagendar crea una citación nueva en vez de pisar la
-- anterior. "Citado" deja de ser una bandera y pasa a ser un hecho verificable
-- (existe una citación vigente), así que ya no es posible quedar en estado
-- 'citado' sin fecha, ni tener fecha sin estar citado.
CREATE TABLE candidato_citaciones (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidato_id           INT UNSIGNED NOT NULL,
  fecha_citacion         DATETIME NOT NULL,
  agendado_por_id        INT UNSIGNED NULL,

  asistio                ENUM('pendiente','asistio','no_asistio') NOT NULL DEFAULT 'pendiente',
  fecha_asistencia       DATETIME NULL,
  registrado_por_id      INT UNSIGNED NULL COMMENT 'Quién marcó la asistencia',
  motivo_inasistencia_id SMALLINT UNSIGNED NULL,
  motivo_inasistencia_detalle VARCHAR(255) NULL COMMENT 'Texto libre cuando el motivo lo exige',
  observaciones          TEXT NULL,

  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_citaciones_candidato (candidato_id, fecha_citacion),
  -- Índice de la pantalla "Candidatos" de Selección, equivalente al analizado
  -- con EXPLAIN en la migración 010 del esquema viejo.
  KEY idx_citaciones_fecha_asistio (fecha_citacion, asistio, id),
  CONSTRAINT fk_citaciones_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_citaciones_agendado_por
    FOREIGN KEY (agendado_por_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_citaciones_registrado_por
    FOREIGN KEY (registrado_por_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_citaciones_motivo
    FOREIGN KEY (motivo_inasistencia_id) REFERENCES motivos_inasistencia (id) ON DELETE RESTRICT,
  -- Un motivo de inasistencia solo tiene sentido si no asistió.
  CONSTRAINT ck_citaciones_motivo_coherente
    CHECK (motivo_inasistencia_id IS NULL OR asistio = 'no_asistio'),
  -- La fecha de asistencia solo existe una vez resuelta la citación.
  CONSTRAINT ck_citaciones_fecha_asistencia
    CHECK (fecha_asistencia IS NULL OR asistio <> 'pendiente')
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Evaluación de entrevista
-- -----------------------------------------------------------------------------
CREATE TABLE candidato_evaluaciones (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidato_id   INT UNSIGNED NOT NULL,
  citacion_id    INT UNSIGNED NULL COMMENT 'Entrevista que originó la evaluación',
  evaluador_id   INT UNSIGNED NULL,
  aprobado       BOOLEAN NOT NULL COMMENT 'Decisión registrada, derivada del umbral al momento de evaluar',
  razon_rechazo  TEXT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_evaluaciones_candidato (candidato_id, created_at),
  CONSTRAINT fk_evaluaciones_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_evaluaciones_citacion
    FOREIGN KEY (citacion_id) REFERENCES candidato_citaciones (id) ON DELETE SET NULL,
  CONSTRAINT fk_evaluaciones_evaluador
    FOREIGN KEY (evaluador_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  -- Rechazar exige justificar. Hoy `razon_rechazo` es opcional aunque el estado
  -- pase a 'rechazado'.
  CONSTRAINT ck_evaluaciones_razon
    CHECK (aprobado = TRUE OR razon_rechazo IS NOT NULL)
) ENGINE=InnoDB;

-- Un puntaje por criterio, en filas. Antes eran 5 columnas fijas
-- (`evaluacion_saludo`, `_perfilamiento`, `_producto`, `_objeciones`, `_cierre`).
CREATE TABLE evaluacion_puntajes (
  evaluacion_id INT UNSIGNED NOT NULL,
  criterio_id   TINYINT UNSIGNED NOT NULL,
  puntaje       DECIMAL(5,2) NOT NULL,
  PRIMARY KEY (evaluacion_id, criterio_id),
  KEY idx_puntajes_criterio (criterio_id),
  CONSTRAINT fk_puntajes_evaluacion
    FOREIGN KEY (evaluacion_id) REFERENCES candidato_evaluaciones (id) ON DELETE CASCADE,
  CONSTRAINT fk_puntajes_criterio
    FOREIGN KEY (criterio_id) REFERENCES criterios_evaluacion (id) ON DELETE RESTRICT,
  CONSTRAINT ck_puntajes_no_negativo CHECK (puntaje >= 0)
) ENGINE=InnoDB;

-- `evaluacion_total` NO es una columna. Hoy el cliente envía el total y el
-- backend lo guarda sin recalcular, así que se puede mandar total=100 con los
-- cinco criterios en cero. Aquí el total es, por definición, la suma.
CREATE OR REPLACE VIEW v_evaluacion_totales AS
SELECT
  e.id              AS evaluacion_id,
  e.candidato_id,
  SUM(ep.puntaje)   AS total,
  SUM(c.puntaje_maximo) AS total_maximo,
  ROUND(100 * SUM(ep.puntaje) / NULLIF(SUM(c.puntaje_maximo), 0), 2) AS porcentaje
FROM candidato_evaluaciones e
JOIN evaluacion_puntajes ep    ON ep.evaluacion_id = e.id
JOIN criterios_evaluacion c    ON c.id = ep.criterio_id
GROUP BY e.id, e.candidato_id;

-- -----------------------------------------------------------------------------
-- Decisión final del psicólogo
-- -----------------------------------------------------------------------------
CREATE TABLE candidato_decision_final (
  candidato_id INT UNSIGNED NOT NULL,
  aprobacion   BOOLEAN NOT NULL,
  razon        TEXT NULL,
  psicologo_id INT UNSIGNED NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (candidato_id),
  KEY idx_decision_aprobacion (aprobacion),
  CONSTRAINT fk_decision_candidato
    FOREIGN KEY (candidato_id) REFERENCES candidatos (id) ON DELETE CASCADE,
  CONSTRAINT fk_decision_psicologo
    FOREIGN KEY (psicologo_id) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT ck_decision_razon CHECK (aprobacion = TRUE OR razon IS NOT NULL)
) ENGINE=InnoDB;
