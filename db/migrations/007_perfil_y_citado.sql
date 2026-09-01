-- =============================================================================
-- 007 — `perfil` y `citado` en el registro del candidato
-- =============================================================================
-- La migración 003 descartó ambas columnas del esquema viejo con esta nota:
--
--   * perfil ......... la columna del Excel se emite siempre vacía
--   * citado_gestion . "citado" ahora es tener una citación (005)
--
-- Ambas se reincorporan por decisión de negocio (2026-08-30): el formulario de
-- registro sigue el orden exacto del Excel oficial "BASE RECLUTAMIENTO", y esas
-- dos columnas son parte del formato. La reclutadora las diligencia al
-- registrar, antes de que exista cualquier citación.
--
-- `citado` NO reemplaza a `candidato_citaciones` (005), que sigue siendo el
-- hecho real de la agenda de Selección. Es la gestión de la reclutadora: "logré
-- citarlo". El Excel prefiere este dato cuando está diligenciado y cae a la
-- citación real cuando no, para que la columna nunca contradiga a quien la
-- llenó a mano.
-- =============================================================================

ALTER TABLE candidatos
  -- VARCHAR(255) igual que `hyd_candidatos.perfil`: los valores del archivo
  -- histórico caben sin truncarse si algún día se comparan.
  ADD COLUMN perfil VARCHAR(255) NULL
    COMMENT 'Perfil del candidato. Columna PERFIL del Excel oficial'
    AFTER observaciones_generales,

  -- BOOLEAN NULL, no NOT NULL DEFAULT FALSE: hay que poder distinguir "todavía
  -- no se gestionó" de "se gestionó y no se logró citar". El esquema viejo usaba
  -- enum('si','no') NULL, con la misma tercera posibilidad implícita.
  ADD COLUMN citado BOOLEAN NULL
    COMMENT 'Gestión de la reclutadora: si logró citar al candidato. La citación real vive en candidato_citaciones'
    AFTER perfil;
