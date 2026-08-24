-- Captura el bloque "ANTECEDENTES" del Excel oficial (BASE RECLUTAMIENTO): 4 verificaciones
-- (ADRES, POL - Policía, COMP - Comprobación de antecedentes judiciales/comerciales, PROCU -
-- Procuraduría), cada una con estado Aprobado/No aprobado, el texto de la novedad cuando no se
-- aprueba (obligatorio en ese caso, ver actualizarAntecedentes), y su propio documento de soporte
-- (PDF o imagen) — cada verificación tiene su archivo independiente, no uno compartido entre las 4.
-- El archivo en sí se guarda en disco (uploads/antecedentes/), acá solo el nombre generado y el
-- nombre original para mostrarlo al descargar.
ALTER TABLE hyd_candidatos
  ADD COLUMN antecedentes_adres ENUM('aprobado', 'no_aprobado') NULL AFTER motivo_inasistencia,
  ADD COLUMN antecedentes_adres_novedad VARCHAR(255) NULL AFTER antecedentes_adres,
  ADD COLUMN antecedentes_adres_documento VARCHAR(255) NULL AFTER antecedentes_adres_novedad,
  ADD COLUMN antecedentes_adres_documento_nombre VARCHAR(255) NULL AFTER antecedentes_adres_documento,

  ADD COLUMN antecedentes_pol ENUM('aprobado', 'no_aprobado') NULL AFTER antecedentes_adres_documento_nombre,
  ADD COLUMN antecedentes_pol_novedad VARCHAR(255) NULL AFTER antecedentes_pol,
  ADD COLUMN antecedentes_pol_documento VARCHAR(255) NULL AFTER antecedentes_pol_novedad,
  ADD COLUMN antecedentes_pol_documento_nombre VARCHAR(255) NULL AFTER antecedentes_pol_documento,

  ADD COLUMN antecedentes_comp ENUM('aprobado', 'no_aprobado') NULL AFTER antecedentes_pol_documento_nombre,
  ADD COLUMN antecedentes_comp_novedad VARCHAR(255) NULL AFTER antecedentes_comp,
  ADD COLUMN antecedentes_comp_documento VARCHAR(255) NULL AFTER antecedentes_comp_novedad,
  ADD COLUMN antecedentes_comp_documento_nombre VARCHAR(255) NULL AFTER antecedentes_comp_documento,

  ADD COLUMN antecedentes_procu ENUM('aprobado', 'no_aprobado') NULL AFTER antecedentes_comp_documento_nombre,
  ADD COLUMN antecedentes_procu_novedad VARCHAR(255) NULL AFTER antecedentes_procu,
  ADD COLUMN antecedentes_procu_documento VARCHAR(255) NULL AFTER antecedentes_procu_novedad,
  ADD COLUMN antecedentes_procu_documento_nombre VARCHAR(255) NULL AFTER antecedentes_procu_documento,

  ADD COLUMN fecha_antecedentes TIMESTAMP NULL AFTER antecedentes_procu_documento_nombre;
