-- =============================================================================
-- 022 — Exámenes médicos de SST (Gestor) en la contratación
-- =============================================================================
-- Decisión de negocio (2026-10-30): en Gestor, el rol SST recibe los candidatos
-- enviados a contratación y lleva el último control antes del registro: marca si
-- asistieron a los exámenes médicos y si los aprobaron (Gestor, migración 089).
-- Cada marca llega a Hydra (POST /api/integraciones/gestor/v1/examenes):
--
--   * No asistió → selección decide si da continuidad. "Dar continuidad" avisa a
--     Gestor que se le reagenda la cita (SST vuelve a marcar asistencia); "No
--     continuar" lo saca del proceso en los dos sistemas: aquí pasa a
--     `no_continua_examenes`.
--   * No aprobó → SST informa la no continuidad: el candidato pasa a
--     `no_apto_examenes`, con la nota de SST en su historial.
--
-- Todo queda en `contratacion_examenes`, que no se edita ni se borra: si no
-- asistió y se le reagenda, la traza conserva el "no asistió", su nota y la
-- decisión de selección.
-- =============================================================================

INSERT INTO estados_candidato (codigo, nombre, descripcion, color, etapa, orden, es_terminal) VALUES
  ('no_apto_examenes', 'No Apto Exámenes Médicos',
   'No aprobó los exámenes médicos de SST: no continúa en contratación',
   'bg-red-100 text-red-800', 'cierre', 172, TRUE),
  ('no_continua_examenes', 'No Continúa (Exámenes)',
   'No asistió a los exámenes médicos y selección no dio continuidad al proceso',
   'bg-red-100 text-red-800', 'cierre', 174, TRUE);

INSERT INTO estado_transiciones (estado_origen_id, estado_destino_id, requiere_motivo)
SELECT o.id, d.id, TRUE
  FROM estados_candidato o, estados_candidato d
 WHERE o.codigo = 'aprobado_final' AND d.codigo IN ('no_apto_examenes', 'no_continua_examenes');

ALTER TABLE contratacion_candidatos
  ADD COLUMN examen_estado ENUM('pendiente','no_asistio','reagendado','asistio','aprobado','no_aprobado') NULL
    COMMENT 'Exámenes médicos según SST en Gestor; NULL = Gestor todavía no ha marcado nada'
    AFTER nota_antecedentes;

CREATE TABLE contratacion_examenes (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidato_id     INT UNSIGNED NOT NULL,
  evento           ENUM('asistio','no_asistio','aprobado','no_aprobado','continuidad','no_continuidad') NOT NULL
                     COMMENT 'asistio..no_aprobado: SST en Gestor; continuidad/no_continuidad: selección en Hydra',
  nota             VARCHAR(1000) NULL,
  origen           ENUM('gestor','hydra') NOT NULL,
  marcado_por      VARCHAR(150) NULL COMMENT 'Nombre de quien marcó (en Gestor o en Hydra)',
  marcado_en       DATETIME NOT NULL,
  usuario_id       INT UNSIGNED NULL COMMENT 'Usuario de Hydra, solo en las decisiones de selección',
  idempotency_key  VARCHAR(64) NULL COMMENT 'La de Gestor: un reintento no duplica la marca',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contratacion_examenes_clave (idempotency_key),
  KEY idx_contratacion_examenes_candidato (candidato_id, id),
  CONSTRAINT fk_contratacion_examenes_candidato
    FOREIGN KEY (candidato_id) REFERENCES contratacion_candidatos (candidato_id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE contratacion_envios
  MODIFY COLUMN tipo ENUM('lote','actualizacion','cancelacion','documento','continuidad') NOT NULL;

INSERT INTO permisos (codigo, nombre, descripcion, modulo) VALUES
  ('decidir_continuidad_examenes', 'Exámenes médicos de contratación',
   'Ver los exámenes médicos que marca SST en Gestor y decidir si se da continuidad a quien no asistió',
   'seleccion');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r, permisos p
 WHERE r.codigo IN ('administrador', 'seleccion', 'contratacion')
   AND p.codigo = 'decidir_continuidad_examenes';
