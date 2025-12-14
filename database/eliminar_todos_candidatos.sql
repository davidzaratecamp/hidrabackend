-- =====================================================
-- ELIMINAR TODOS LOS CANDIDATOS DE LA BASE DE DATOS
-- Sistema HIDRA - Limpieza para Producción
-- =====================================================

-- IMPORTANTE: ESTE SCRIPT ELIMINARÁ PERMANENTEMENTE TODOS LOS CANDIDATOS
-- ASEGÚRATE DE HACER BACKUP ANTES DE EJECUTAR

-- =====================================================
-- BACKUP RECOMENDADO ANTES DE EJECUTAR:
-- mysqldump -u usuario -p hidra_db > backup_antes_eliminar_candidatos_$(date +%Y%m%d_%H%M%S).sql
-- =====================================================

-- Mostrar el número actual de candidatos antes de eliminar
SELECT 'CANDIDATOS ANTES DE ELIMINAR:' as info;
SELECT COUNT(*) as total_candidatos FROM hyd_candidatos;
SELECT estado, COUNT(*) as cantidad FROM hyd_candidatos GROUP BY estado;

-- =====================================================
-- PASO 1: DESACTIVAR VERIFICACIONES DE FOREIGN KEYS
-- =====================================================
SET FOREIGN_KEY_CHECKS = 0;

-- =====================================================
-- PASO 2: ELIMINAR TODOS LOS CANDIDATOS
-- =====================================================

-- Eliminar todos los registros de la tabla hyd_candidatos
DELETE FROM hyd_candidatos;

-- Resetear el AUTO_INCREMENT a 1 para que los nuevos candidatos empiecen desde ID 1
ALTER TABLE hyd_candidatos AUTO_INCREMENT = 1;

-- =====================================================
-- PASO 3: REACTIVAR VERIFICACIONES DE FOREIGN KEYS
-- =====================================================
SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================
-- PASO 4: VERIFICAR QUE LA ELIMINACIÓN FUE EXITOSA
-- =====================================================

-- Verificar que no quedan candidatos
SELECT 'CANDIDATOS DESPUÉS DE ELIMINAR:' as info;
SELECT COUNT(*) as total_candidatos FROM hyd_candidatos;

-- Verificar que el AUTO_INCREMENT se reseteo correctamente
SELECT AUTO_INCREMENT as proximo_id 
FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'hyd_candidatos';

-- =====================================================
-- PASO 5: VERIFICAR INTEGRIDAD DE TABLAS RELACIONADAS
-- =====================================================

-- Verificar que no hay referencias huérfanas (no debería haber ninguna)
SELECT 'VERIFICACIÓN DE INTEGRIDAD:' as info;

-- Verificar tabla hyd_oleadas (no se ve afectada)
SELECT 'Oleadas existentes:' as tabla, COUNT(*) as total FROM hyd_oleadas;

-- Verificar tabla hyd_usuarios (no se ve afectada)
SELECT 'Usuarios existentes:' as tabla, COUNT(*) as total FROM hyd_usuarios;

-- =====================================================
-- RESULTADO ESPERADO
-- =====================================================

-- Después de ejecutar este script:
-- 1. Tabla hyd_candidatos estará completamente vacía (0 registros)
-- 2. AUTO_INCREMENT reseteado a 1
-- 3. Estructura de tabla intacta con todos los campos y constraints
-- 4. Tablas relacionadas (usuarios, oleadas) no afectadas
-- 5. Sistema listo para recibir nuevos candidatos desde cero

-- =====================================================
-- MENSAJE FINAL
-- =====================================================

SELECT 'ELIMINACIÓN DE CANDIDATOS COMPLETADA' as resultado;
SELECT 'La tabla hyd_candidatos está ahora vacía y lista para producción' as mensaje;
SELECT NOW() as fecha_eliminacion;