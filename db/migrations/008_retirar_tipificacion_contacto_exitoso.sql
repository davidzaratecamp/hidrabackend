-- =============================================================================
-- 008 — Se retira la tipificación de llamada "Contacto exitoso"
-- =============================================================================
-- Decisión de negocio (2026-08-30): deja de ser una opción del formulario de
-- registro. El seed 003 ya no la inserta; esta migración se encarga de las bases
-- que la tienen sembrada.
--
-- Se DESACTIVA en vez de borrarse. Los catálogos tienen `activo` justamente para
-- esto: `catalogo.repository` solo lista y resuelve códigos con `activo = TRUE`,
-- así que desactivarla la saca del desplegable y hace que el backend rechace el
-- valor, mientras los candidatos que ya la tengan asignada conservan su
-- referencia intacta. Un DELETE los rompería (o fallaría por la clave foránea).
-- =============================================================================

UPDATE tipificaciones_llamada
   SET activo = FALSE
 WHERE codigo = 'Contacto exitoso';
