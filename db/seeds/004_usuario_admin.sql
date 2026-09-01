-- =============================================================================
-- SEED 004 — Usuario administrador inicial
-- =============================================================================
-- La base arranca vacía: sin esta fila no hay forma de entrar al sistema.
--
-- ⚠️  SOLO PARA ENTORNO LOCAL. La contraseña de abajo está en el repositorio,
--     así que es pública. Antes de usar esta base en cualquier entorno
--     compartido hay que cambiarla desde la aplicación.
--
--     Email:    admin@local.com
--     Password: Hidra2026*
-- =============================================================================

INSERT INTO usuarios (nombre_completo, email, password_hash, activo) VALUES
  ('Administrador', 'admin@local.com',
   '$2b$10$fhMwF3DHkStanCz8SSt8DOcXIvdWly.R6pSjx5gweZ0.KJO2WIFHm', TRUE);

INSERT INTO usuario_roles (usuario_id, rol_id)
SELECT u.id, r.id
FROM usuarios u JOIN roles r
WHERE u.email = 'admin@local.com' AND r.codigo = 'administrador';
