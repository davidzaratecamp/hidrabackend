-- =============================================================================
-- SEED 001 — Roles y permisos
-- =============================================================================
-- Reemplaza la matriz hardcodeada de `models/usuario.model.js:getPermisosRol()`.
--
-- Nombres de rol: se conservan los tres actuales. El código del rol de
-- reclutamiento pasa de `reclutador` (esquema viejo) a `reclutamiento`.
-- =============================================================================

INSERT INTO roles (codigo, nombre, descripcion) VALUES
  ('administrador', 'Administrador', 'Acceso completo al sistema'),
  ('seleccion',     'Selección',     'Área de selección y psicología: entrevistas, evaluación y decisión final'),
  ('reclutamiento', 'Reclutamiento', 'Registro y gestión de candidatos propios');

INSERT INTO permisos (codigo, nombre, descripcion, modulo) VALUES
  ('ver_dashboard',             'Ver dashboard',              'Acceder al panel principal',                         'dashboard'),
  ('ver_estadisticas',          'Ver estadísticas',           'Ver métricas y analíticas del embudo',               'dashboard'),
  ('ver_candidatos',            'Ver candidatos',             'Consultar listados y perfiles de candidatos',        'candidatos'),
  ('crear_candidatos',          'Crear candidatos',           'Registrar candidatos nuevos',                        'candidatos'),
  ('editar_candidatos',         'Editar candidatos',          'Modificar datos de un candidato',                    'candidatos'),
  ('eliminar_candidatos',       'Eliminar candidatos',        'Dar de baja un candidato',                           'candidatos'),
  ('reasignar_candidatos',      'Reasignar candidatos',       'Transferir un candidato a otro reclutador',           'candidatos'),
  ('editar_estados_candidatos', 'Editar estados',             'Cambiar el estado de un candidato en el embudo',      'candidatos'),
  ('ver_perfiles_completos',    'Ver perfiles completos',     'Ver el formulario completo del candidato',            'candidatos'),
  ('reenviar_emails',           'Reenviar formularios',       'Emitir un token nuevo y reenviar el correo',          'candidatos'),
  ('agendar_entrevistas',       'Agendar entrevistas',        'Crear y reagendar citaciones',                        'seleccion'),
  ('registrar_asistencia',      'Registrar asistencia',       'Marcar si el candidato asistió a la entrevista',      'seleccion'),
  ('evaluar_candidatos',        'Evaluar candidatos',         'Registrar la evaluación de la entrevista',            'seleccion'),
  ('tomar_decision_final',      'Tomar decisión final',       'Aprobar o rechazar definitivamente a un candidato',   'seleccion'),
  ('gestionar_antecedentes',    'Gestionar antecedentes',     'Registrar verificaciones y subir soportes',           'seleccion'),
  ('ver_reportes',              'Ver reportes',               'Consultar reportes del sistema',                      'reportes'),
  ('generar_reportes_seleccion','Generar reportes',           'Exportar la base a Excel',                            'reportes'),
  ('ver_usuarios',              'Ver usuarios',               'Consultar el listado de usuarios',                    'usuarios'),
  ('crear_usuarios',            'Crear usuarios',             'Dar de alta usuarios',                                'usuarios'),
  ('editar_usuarios',           'Editar usuarios',            'Modificar usuarios y sus roles',                       'usuarios'),
  ('eliminar_usuarios',         'Eliminar usuarios',          'Dar de baja usuarios',                                'usuarios');

-- -----------------------------------------------------------------------------
-- Administrador: todos los permisos.
-- (En el sistema viejo el rol tenía 14 de 17 pese a estar documentado como
-- "acceso completo": le faltaban editar_estados_candidatos, ver_perfiles_completos
-- y generar_reportes_seleccion. Aquí se corrige.)
-- -----------------------------------------------------------------------------
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permisos p WHERE r.codigo = 'administrador';

-- -----------------------------------------------------------------------------
-- Reclutamiento: gestiona sus propios candidatos, sin acceso a usuarios.
-- Registra la asistencia a la entrevista (decisión de negocio, 2026-08-31:
-- antes era Selección quien la marcaba; ahora es Reclutamiento, que es quien
-- cita y hace seguimiento del candidato). También gestiona antecedentes desde
-- el registro del candidato (2026-08-31), sin esperar a que pase por Selección.
-- Descarga el Excel de su propia cartera (decisión de negocio, 2026-09-01):
-- mismo permiso que Selección, la visibilidad por dueño ya limita el export a
-- solo sus candidatos (ver `visibilidad.js`).
-- -----------------------------------------------------------------------------
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p
WHERE r.codigo = 'reclutamiento' AND p.codigo IN (
  'ver_dashboard', 'ver_estadisticas', 'ver_candidatos', 'crear_candidatos',
  'editar_candidatos', 'reasignar_candidatos', 'reenviar_emails', 'agendar_entrevistas',
  'registrar_asistencia', 'gestionar_antecedentes', 'generar_reportes_seleccion'
);

-- -----------------------------------------------------------------------------
-- Selección: todo el proceso posterior a la asistencia, sin gestión de
-- usuarios. Ya NO registra asistencia (pasó a Reclutamiento, ver arriba), NI
-- registra candidatos nuevos, NI agenda entrevistas (decisiones de negocio,
-- 2026-09-01): eso es trabajo exclusivo de Reclutamiento — Selección solo
-- gestiona lo que ya existe (evalúa y decide).
-- -----------------------------------------------------------------------------
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p
WHERE r.codigo = 'seleccion' AND p.codigo IN (
  'ver_dashboard', 'ver_estadisticas', 'ver_candidatos',
  'editar_candidatos', 'editar_estados_candidatos', 'ver_perfiles_completos',
  'reasignar_candidatos', 'reenviar_emails',
  'evaluar_candidatos', 'tomar_decision_final',
  'gestionar_antecedentes', 'generar_reportes_seleccion'
);
