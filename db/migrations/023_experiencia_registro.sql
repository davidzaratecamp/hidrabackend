-- =============================================================================
-- 023 — EXPERIENCIA en el registro del candidato
-- =============================================================================
-- Decisión de negocio (2026-11-26): la reclutadora captura, al registrar, cuánta
-- experiencia laboral tiene el candidato. Es un campo de "Nuevo Candidato", así
-- que también va en el cargue masivo por Excel y en el Excel de descarga.
--
-- Es un catálogo y no texto libre para que el reporte se pueda filtrar y contar
-- por opción; agregar o renombrar una opción es un INSERT/UPDATE aquí, no un
-- redespliegue. Misma forma que `fuentes_reclutamiento` (002).
--
-- No reemplaza a `candidato_experiencia_resumen.primer_empleo_formal` (004): ese
-- lo responde el propio candidato en el paso 4 del formulario. Este es lo que
-- registra la reclutadora en la llamada, antes de que exista el formulario.
--
-- La columna es NULL en la base porque los candidatos ya registrados no lo
-- tienen; la obligatoriedad para los nuevos la impone `candidato.schema.js`.
-- =============================================================================

CREATE TABLE experiencias_laborales (
  id     SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(60)  NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  orden  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  activo BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_experiencias_laborales_codigo (codigo)
) ENGINE=InnoDB;

INSERT INTO experiencias_laborales (codigo, nombre, orden) VALUES
  ('Primer empleo',     'Primer empleo',     1),
  ('Menos de 6 meses',  'Menos de 6 meses',  2),
  ('6 meses a 1 año',   '6 meses a 1 año',   3),
  ('1 a 2 años',        '1 a 2 años',        4),
  ('Más de 2 años',     'Más de 2 años',     5);

ALTER TABLE candidatos
  ADD COLUMN experiencia_laboral_id SMALLINT UNSIGNED NULL
    COMMENT 'Experiencia laboral que registra la reclutadora. Columna EXPERIENCIA del Excel'
    AFTER perfil,
  ADD CONSTRAINT fk_candidatos_experiencia_laboral
    FOREIGN KEY (experiencia_laboral_id) REFERENCES experiencias_laborales (id) ON DELETE SET NULL;
