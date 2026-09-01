-- =============================================================================
-- SEED 002 — Estados del candidato y máquina de estados
-- =============================================================================
-- Los 17 estados del ENUM viejo, con las etiquetas y colores que hoy viven en
-- `models/candidato.model.js:getEstadosConfig()`.
-- =============================================================================

INSERT INTO estados_candidato (codigo, nombre, descripcion, color, etapa, orden, es_terminal) VALUES
  ('nuevo',                   'Nuevo',                   'Candidato registrado, sin gestionar',                 'bg-gray-100 text-gray-800',       'contacto',    10, FALSE),
  ('contacto_fallido',        'Contacto Fallido',        'No se logró establecer contacto',                     'bg-red-100 text-red-800',         'contacto',    20, FALSE),
  ('no_contesta',             'No Contesta',             'El candidato no responde las llamadas',               'bg-orange-100 text-orange-800',   'contacto',    30, FALSE),
  ('reagendar',               'Reagendar',               'Se debe volver a contactar más adelante',             'bg-yellow-100 text-yellow-800',   'contacto',    40, FALSE),
  ('no_interesado',           'No Interesado',           'El candidato no está interesado en la vacante',       'bg-red-100 text-red-800',         'contacto',    50, TRUE),
  ('numero_incorrecto',       'Número Incorrecto',       'El número de contacto no corresponde',                'bg-red-100 text-red-800',         'contacto',    60, TRUE),
  ('contacto_exitoso',        'Contacto Exitoso',        'Se estableció contacto y hay interés',                'bg-blue-100 text-blue-800',       'contacto',    70, FALSE),
  ('formularios_enviados',    'Formularios Enviados',    'Se envió el link del formulario al candidato',        'bg-indigo-100 text-indigo-800',   'formularios', 80, FALSE),
  ('formularios_completados', 'Formularios Completados', 'El candidato completó los 6 pasos',                   'bg-purple-100 text-purple-800',   'formularios', 90, FALSE),
  ('citado',                  'Citado',                  'Tiene entrevista agendada',                           'bg-cyan-100 text-cyan-800',       'entrevista', 100, FALSE),
  ('no_asistio',              'No Asistió',              'No se presentó a la entrevista',                      'bg-red-100 text-red-800',         'entrevista', 110, FALSE),
  ('entrevistado',            'Entrevistado',            'Asistió a la entrevista, pendiente de evaluación',    'bg-teal-100 text-teal-800',       'entrevista', 120, FALSE),
  ('aprobado',                'Aprobado',                'Aprobó la evaluación de entrevista',                  'bg-green-100 text-green-800',     'evaluacion', 130, FALSE),
  ('rechazado',              'Rechazado',                'No aprobó la evaluación de entrevista',               'bg-red-100 text-red-800',         'evaluacion', 140, FALSE),
  ('aprobado_final',          'Aprobado Final',          'Aprobado definitivamente por el psicólogo',           'bg-emerald-100 text-emerald-800', 'decision',   150, FALSE),
  ('rechazado_final',         'Rechazado Final',         'Rechazado definitivamente por el psicólogo',          'bg-red-100 text-red-800',         'decision',   160, TRUE),
  ('contratado',              'Contratado',              'Candidato contratado',                                'bg-green-100 text-green-800',     'cierre',     170, TRUE);

-- =============================================================================
-- Transiciones válidas
-- =============================================================================
-- Hoy `PUT /cambiar-estado/:id` acepta cualquier estado desde cualquier otro:
-- solo valida que el destino exista. Aquí el grafo es dato, y el servicio lo
-- consulta antes de mover a un candidato.
--
-- `requiere_motivo = TRUE` marca las transiciones donde el servicio exige una
-- justificación, que queda en candidato_estado_historial.motivo.
-- =============================================================================

-- Helper: inserta por código en vez de por id.
INSERT INTO estado_transiciones (estado_origen_id, estado_destino_id, requiere_motivo)
SELECT o.id, d.id, t.requiere_motivo
FROM (
  -- Gestión de contacto: desde 'nuevo' se puede tipificar de cualquier forma
  SELECT 'nuevo' AS origen, 'contacto_exitoso'  AS destino, FALSE AS requiere_motivo UNION ALL
  SELECT 'nuevo', 'contacto_fallido',  FALSE UNION ALL
  SELECT 'nuevo', 'no_contesta',       FALSE UNION ALL
  SELECT 'nuevo', 'reagendar',         FALSE UNION ALL
  SELECT 'nuevo', 'no_interesado',     TRUE  UNION ALL
  SELECT 'nuevo', 'numero_incorrecto', FALSE UNION ALL
  -- Se cita desde el propio formulario de registro (Citado = Sí), sin pasar por
  -- Selección ni por el resto del embudo. Ver migración 009.
  SELECT 'nuevo', 'citado',            FALSE UNION ALL

  -- Los estados de contacto fallido reintentan hacia contacto o se cierran
  SELECT 'contacto_fallido', 'contacto_exitoso', FALSE UNION ALL
  SELECT 'contacto_fallido', 'no_contesta',      FALSE UNION ALL
  SELECT 'contacto_fallido', 'reagendar',        FALSE UNION ALL
  SELECT 'contacto_fallido', 'no_interesado',    TRUE  UNION ALL
  SELECT 'contacto_fallido', 'numero_incorrecto',FALSE UNION ALL

  SELECT 'no_contesta', 'contacto_exitoso',  FALSE UNION ALL
  SELECT 'no_contesta', 'contacto_fallido',  FALSE UNION ALL
  SELECT 'no_contesta', 'reagendar',         FALSE UNION ALL
  SELECT 'no_contesta', 'no_interesado',     TRUE  UNION ALL
  SELECT 'no_contesta', 'numero_incorrecto', FALSE UNION ALL

  SELECT 'reagendar', 'contacto_exitoso',  FALSE UNION ALL
  SELECT 'reagendar', 'contacto_fallido',  FALSE UNION ALL
  SELECT 'reagendar', 'no_contesta',       FALSE UNION ALL
  SELECT 'reagendar', 'no_interesado',     TRUE  UNION ALL
  SELECT 'reagendar', 'numero_incorrecto', FALSE UNION ALL

  -- Embudo principal
  SELECT 'contacto_exitoso',        'formularios_enviados',    FALSE UNION ALL
  SELECT 'contacto_exitoso',        'reagendar',               FALSE UNION ALL
  SELECT 'contacto_exitoso',        'no_interesado',           TRUE  UNION ALL
  SELECT 'contacto_exitoso',        'rechazado',               TRUE  UNION ALL

  SELECT 'formularios_enviados',    'formularios_completados', FALSE UNION ALL
  SELECT 'formularios_enviados',    'reagendar',               FALSE UNION ALL
  SELECT 'formularios_enviados',    'no_interesado',           TRUE  UNION ALL
  SELECT 'formularios_enviados',    'rechazado',               TRUE  UNION ALL

  SELECT 'formularios_completados', 'citado',                  FALSE UNION ALL
  SELECT 'formularios_completados', 'rechazado',               TRUE  UNION ALL
  SELECT 'formularios_completados', 'no_interesado',           TRUE  UNION ALL

  -- Entrevista
  SELECT 'citado', 'entrevistado', FALSE UNION ALL
  SELECT 'citado', 'no_asistio',   TRUE  UNION ALL
  SELECT 'citado', 'citado',       FALSE UNION ALL  -- reagendamiento (se filtra abajo)

  SELECT 'no_asistio', 'citado',    FALSE UNION ALL  -- se reagenda
  SELECT 'no_asistio', 'rechazado', TRUE  UNION ALL

  -- Evaluación (solo candidatos con cargo Agente, ver seleccion.service.js)
  SELECT 'entrevistado', 'aprobado',  FALSE UNION ALL
  SELECT 'entrevistado', 'rechazado', TRUE  UNION ALL

  -- Decisión final directa, sin pasar por evaluación (decisión de negocio,
  -- 2026-08-31): la calificación de 5 criterios (saludo/perfilamiento/
  -- producto/objeciones/cierre) solo aplica a cargos "Agente"; cualquier otro
  -- cargo (Coordinador, Analista, Team Leader, etc.) va directo de
  -- 'entrevistado' a la decisión final. `seleccion.service.js` impide que un
  -- candidato Agente use este atajo.
  SELECT 'entrevistado', 'aprobado_final',  TRUE  UNION ALL
  SELECT 'entrevistado', 'rechazado_final', TRUE  UNION ALL

  -- Decisión final del psicólogo
  SELECT 'aprobado',  'aprobado_final',  FALSE UNION ALL
  SELECT 'aprobado',  'rechazado_final', TRUE  UNION ALL
  SELECT 'rechazado', 'aprobado_final',  TRUE  UNION ALL
  SELECT 'rechazado', 'rechazado_final', TRUE  UNION ALL

  -- Cierre
  SELECT 'aprobado_final', 'contratado',      FALSE UNION ALL
  SELECT 'aprobado_final', 'rechazado_final', TRUE
) AS t
JOIN estados_candidato o ON o.codigo = t.origen
JOIN estados_candidato d ON d.codigo = t.destino
-- La tabla prohíbe transiciones reflexivas; el reagendamiento de 'citado' no
-- cambia de estado, crea una citación nueva.
WHERE o.id <> d.id;
