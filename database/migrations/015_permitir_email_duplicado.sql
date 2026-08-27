-- Permite crear más de un candidato con el mismo email_personal (2026-08-26, pedido del usuario) -
-- hasta ahora había una restricción UNIQUE a nivel de base de datos (además de la validación de
-- la app en candidato.controller.js, ya quitada) que lo bloqueaba con un error de duplicado.
--
-- Se deja intacto el índice normal `idx_email` (email_personal) que ya existe aparte - solo se
-- quita la restricción UNIQUE, no la capacidad de buscar por email rápido.
ALTER TABLE hyd_candidatos
  DROP INDEX email_personal;
