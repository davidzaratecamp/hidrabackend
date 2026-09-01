# Último contexto (2026-08-26, décimoctava ronda): bug de antecedentes en producción (carpeta
# faltante) + rediseño del formulario "Nuevo Candidato"

Este archivo documenta **la última ronda de cambios** (décimoctava), la más reciente de la sesión.
Para el contexto completo del módulo de Reclutamiento (arquitectura, decisiones, historial completo
de rondas anteriores), ver `claude/plan.md` (sección "décimoctava ronda" es la más reciente).

⚠️ Todo lo de esta ronda terminó commiteado (ver punto 12, "Estado de despliegue", para el detalle
de cómo pasó eso sin que Claude corriera `git commit`) — pero **nada está desplegado a producción
todavía**, y la migración 014 sigue sin aplicarse a ninguna base de datos.

## 1. Bug en producción: subir antecedente (PDF) daba 400 con `ENOENT`

Reportado por el usuario probando en `200.91.204.54` (prod): `PUT /api/candidato/antecedentes/341`
→ 400, con `Error: ENOENT: no such file or directory, open
'/var/www/noviembrehidra/backend/uploads/antecedentes/<uuid>.pdf'`.

**Causa**: `uploads/antecedentes/.gitkeep` nunca se había commiteado al repo, así que esa carpeta
nunca existió en el checkout de producción, y `multer` (`middleware/upload.middleware.js`) no la
crea si falta. Coincide con un pendiente ya anotado en rondas anteriores.

**Fix**: `middleware/upload.middleware.js` ahora hace `fs.mkdirSync(DIR_ANTECEDENTES, { recursive:
true })` al cargar el módulo. Verificado con `node --check`.

**Pendiente**: commitear/desplegar, y mientras tanto crear la carpeta a mano en el servidor
(`mkdir -p /var/www/noviembrehidra/backend/uploads/antecedentes`).

## 2. Rediseño del formulario "Nuevo Candidato": orden de campos + tipificación Citado/Estado
## Gestión Reclutamiento

Pedido: reordenar los campos del formulario de creación de candidato siguiendo el orden del Excel
"BASE RECLUTAMIENTO" (FECHA, ANALISTA, CAMPAÑA, CARGO, NOMBRE, TIPO DE DOC, DOCUMENTO, EDAD, CORREO,
CONTACTO, PERFIL, CITADO, ESTADO GESTIÓN RECLUTAMIENTO) y quitar el desplegable "Observaciones de
Llamada" (tipificación "Contacto exitoso" etc.), reemplazándolo por "Citado" (Sí/No) + un
desplegable "Estado Gestión Reclutamiento" (solo si Citado = No) con una lista fija de motivos.

Decisiones confirmadas con el usuario (`AskUserQuestion`) antes de implementar:
- FECHA y ANALISTA: automáticos y de solo lectura (fecha de hoy, usuario logueado).
- PERFIL: campo nuevo de texto libre corto.
- "Citado"/"Estado Gestión Reclutamiento" van en **columnas nuevas**, sin tocar el campo `estado`
  existente (que alimenta el Dashboard/embudo).

**Migración `014_citado_gestion_perfil.sql`** (nueva): agrega `citado_gestion`,
`estado_gestion_reclutamiento`, `perfil` a `hyd_candidatos`.

⚠️ **La migración 014 NO se aplicó** en esta sesión — el modo automático bloqueó los intentos de
ejecutar `ALTER TABLE` contra la BD local (mysql CLI y script Node). Pendiente aplicarla a mano,
local y luego en producción.

**Backend**: `models/candidato.model.js` (nuevo catálogo `estado_gestion_reclutamiento`, con grupos
"NO APTO POR:"/"NO INTERESADOS POR:"; el catálogo `observaciones_llamada` no se tocó, lo sigue
usando `EditarCandidato.jsx`), `controllers/candidato.controller.js` `crearCandidato` (acepta e
inserta los 3 campos nuevos, valida `estado_gestion_reclutamiento` requerido si citado = no, y
adapta la validación de documento obligatorio de `estado==='contacto_exitoso'` a
`citado_gestion==='si'`). Verificado con `node --check`.

**Frontend** (`hidrafrontend/src/components/reclutador/NuevoCandidato.jsx`, único archivo tocado):
secciones reordenadas (Fecha/Analista → Proceso de Reclutamiento → Datos Principales → Contacto →
Perfil y Gestión → Observaciones), `handleSubmit` sin el mapeo `estadoMap` viejo (ya no fija
`estado`, el backend usa su default). `numero_celular` y `fuente_reclutamiento` no estaban en la
lista del usuario pero se mantuvieron por ser campos requeridos ya existentes. Verificado con
`npx eslint`: sin errores ni warnings nuevos.

## 3. Integración con la tabla "Candidatos" del reclutador (`ListaCandidatos.jsx`)

Pedido de seguimiento el mismo día: Citado=Sí (punto 2) debe aparecer en el tab "Citados" de la
tabla de candidatos del reclutador, y el tab "Contacto Exitoso" (que ya no se llena) se reemplaza
por "Nuevos Candidatos" (todos los `estado='nuevo'`, del más reciente al más antiguo).

- Backend `getCandidatosPorEstado`: cuando piden el tab `'citado'`, el WHERE se amplía a
  `(estado = 'citado' OR citado_gestion = 'si')`.
- Backend `getResumenEstados`: `'nuevo'` agregado a `estadosVisibles` (badge de conteo), conteo de
  `citado` recalculado aparte con el mismo OR (sin duplicar).
- Frontend `ListaCandidatos.jsx`: tab `contacto_exitoso` → `nuevo` ("Nuevos Candidatos"), mismo
  orden (`updated_at DESC` ya existente, coincide con fecha de creación para candidatos nuevos).
- No se tocó la tarjeta "Contacto Exitoso" del Dashboard (`Dashboard.jsx`) — pedido específico era
  sobre la tabla de candidatos, esa tarjeta queda histórica/congelada, posible ajuste a futuro.
- Verificado con `node --check` / `npx eslint` (avisos en `ListaCandidatos.jsx` son preexistentes).

## 4. Perfil del candidato: datos del "Nuevo Candidato" + Hoja de Vida (aspiración salarial)

Pedido: el perfil del candidato (`PerfilCandidato.jsx`) no mostraba ninguno de los campos del
formulario "Nuevo Candidato" (ni los de siempre — Fuente, Edad, Contacto, Observaciones — ni los
nuevos del punto 2 — Perfil, Citado, Estado Gestión Reclutamiento), y tampoco mostraba nunca
`aspiracion_salarial` (el único dato del paso 1/6 "Hoja de Vida" que llena el candidato tras el
email) — se guardaba en BD pero no se renderizaba en ningún lado.

- `repositories/candidatoFormulario.repository.js`: `obtenerCandidatoConFormulario` ahora hace
  `LEFT JOIN hyd_usuarios` para traer `nombre_reclutador` (antes no existía ese join en esta
  consulta). El resto de columnas nuevas ya venían por `c.*`.
- `PerfilCandidato.jsx`: nueva tarjeta "Datos de Registro" (Fecha, Analista, Edad, Fuente, Contacto,
  Perfil, Citado, Estado Gestión Reclutamiento, Observaciones Generales) y nueva tarjeta "Hoja de
  Vida" (aspiración salarial, solo visible una vez el candidato la completa vía el link del email).
- Verificado con `node --check`/`npx eslint` (el único aviso es preexistente).

## 5. Perfil del candidato: se quitó "Gestión de Entrevista" (botón Programar) y los botones
## "Marcar como Citado"/"No Citado"

Pedido: en `PerfilCandidato.jsx`, quitar la tarjeta "Gestión de Entrevista" (donde salía el botón
"Programar"/"Editar" fecha) y, dentro de "Gestión del Proceso", los botones "Marcar como Citado" y
"No Citado".

- Se eliminó la tarjeta "Gestión de Entrevista" completa (edición in-place de
  `fecha_citacion_entrevista`) y el bloque de los 2 botones en "Gestión del Proceso" (solo esos —
  el resto de la tarjeta: Estado actual, Reasignar, y los mensajes informativos por estado
  'citado'/'entrevistado'/'rechazado'/etc. se mantienen igual).
- Limpieza de código muerto asociada: estados (`fechaEntrevista`, `editandoFecha`, `guardandoFecha`,
  `showCitarModal`, `fechaHoraCitar`, `guardandoCitar`, `showNoCitadoModal`, `motivoNoCitado`,
  `guardandoNoCitado`), funciones (`actualizarFechaEntrevista`, `cancelarEdicionFecha`,
  `marcarCitado`, `confirmarCitarModal`, `abrirModalNoCitado`, `confirmarNoCitado`) y los 2 modales
  correspondientes — todo quedaba sin usar tras quitar los botones que los disparaban. Iconos
  `Clock`/`XCircle` removidos del import por quedar sin uso.
- **No se tocó** el resto: el badge de "Estado actual", "Reasignar", ni el mensaje de solo lectura
  "Motivo de no citación" (que lee `candidato.motivo_no_citado`, dato ya guardado de antes — sigue
  mostrándose si existe, solo ya no hay forma de generarlo desde este perfil).
- Verificado con `npx eslint`: sin errores nuevos, el único aviso restante es preexistente.

## 6. Tab "Nuevos Candidatos": el modal "Citar" ya no se ofrece a los que ya tienen Citado=Sí

Ajuste sobre el punto 3: en el tab "Nuevos Candidatos" (`estado='nuevo'`), si el candidato tiene
`citado_gestion === 'si'` (marcado así en el formulario de creación), ya no se le ofrece el botón/
modal "Citar" en `ListaCandidatos.jsx` — se muestra el mismo "Ver" deshabilitado que usan otros
estados sin acción disponible. Con `citado_gestion === 'no'` (o sin marcar, registros anteriores a
esta función), el botón "Citar" sigue igual que antes.

- Backend `getCandidatosPorEstado`: se agregó `citado_gestion` a las columnas devueltas (antes no
  viajaba al frontend, aunque ya existía en BD desde la migración 014).
- Frontend `ListaCandidatos.jsx`, `getAccionButton`: dentro de la rama `estado === 'nuevo'`, chequea
  `candidato.citado_gestion` antes de ofrecer "Citar".
- Verificado con `node --check`/`npx eslint` (avisos preexistentes, sin errores nuevos).

## 7. Pantalla "Candidatos" de Selección: ahora lista TODOS los candidatos, no solo los citados

Pedido: en `CandidatosSeleccion.jsx` (pantalla "Candidatos" del módulo de Selección) debe listar
todos los candidatos creados, del más reciente al más antiguo — antes solo mostraba candidatos con
`fecha_citacion_entrevista` ya agendada (los "citados").

- `controllers/seleccion.controller.js`, `getCandidatosCitados` (endpoint `/api/seleccion/
  candidatos-citados`, se dejó el nombre igual a propósito para no tocar rutas): se quitó el
  `WHERE fecha_citacion_entrevista IS NOT NULL` obligatorio (tanto del conteo/listado como del
  dropdown de "Operación"). Orden cambiado de `fecha_citacion_entrevista DESC` a `created_at DESC`
  como criterio principal (dentro de cada grupo, se mantiene la prioridad de "pendiente decisión
  final" sin cambios) — con NULL en fecha_citacion_entrevista para los no citados, ese campo ya no
  servía como criterio de "más reciente".
- **No se tocó** `exportarExcel` (el botón "Descargar Excel" de esta misma pantalla) — sigue
  exigiendo rango de fechas y filtrando por `fecha_citacion_entrevista`, es un reporte distinto
  ("candidatos citados en el rango"), no lo que se pidió cambiar.
- Frontend: mensaje de "sin resultados" ajustado de "No se encontraron candidatos citados" a "No se
  encontraron candidatos" (ya no es preciso decir "citados").
- Verificado con `node --check`/`npx eslint` (errores/avisos preexistentes, confirmados con
  `git stash`, sin nada nuevo).

## 8. Modal "Citar" (ListaCandidatos.jsx): ya no pide fecha/hora, ahora es Citado Sí/No + Estado
## Gestión Reclutamiento

Pedido: en el modal "Citar" que aparece en el tab "Nuevos Candidatos" (y también en el legacy
`contacto_exitoso`, mismo modal compartido), quitar el selector de fecha/hora de la cita y dejarlo
igual que el control "Citado" (Sí/No) del formulario "Nuevo Candidato" — con su desplegable "Estado
Gestión Reclutamiento" condicional si es "No".

- **Backend, nuevo endpoint** `PUT /candidato/citado-gestion/:candidatoId` →
  `actualizarCitadoGestion` (`controllers/candidato.controller.js`, mismo patrón `esAdmin` que
  `actualizarFechaEntrevista`/`marcarNoCitado`): actualiza `citado_gestion` +
  `estado_gestion_reclutamiento`, validando que este último sea obligatorio si Citado=No. A
  propósito **no toca** `estado` ni `fecha_citacion_entrevista` — mismas columnas nuevas y
  separadas del embudo que ya se usan en `crearCandidato` (ver punto 2).
- `ApiService.actualizarCitadoGestion` nuevo en `services/api.js`.
- `ListaCandidatos.jsx`: el modal (antes "Citar a Entrevista", `input type="datetime-local"`) pasa
  a tener el mismo select Sí/No + desplegable agrupado ("NO APTO POR:"/"NO INTERESADOS POR:") que
  `NuevoCandidato.jsx` — carga el mismo catálogo `estado_gestion_reclutamiento` vía
  `ApiService.getCatalogos()` (nuevo `useEffect` en este componente). Título del modal:
  "Citar a Entrevista -" → "Citado -"; botón "Confirmar Cita" → "Guardar".
- Verificado con `node --check`/`npx eslint` (avisos preexistentes, sin errores nuevos).

**Sigue pendiente**: sin la migración 014 aplicada, `citado_gestion`/`estado_gestion_reclutamiento`
no existen en BD todavía — este modal no se puede probar funcionalmente hasta que se aplique.

## 9. Formulario del candidato, paso "Estudios": revelado progresivo por nivel + Bachillerato
## obligatorio

Pedido: en `Estudios.jsx` (paso 3/6 del formulario que llena el propio candidato), los 4 niveles
fijos (Bachillerato, Técnico/Tecnólogo, Profesional u Otros, Conocimientos Informáticos) se
mostraban todos a la vez. Ahora cada nivel siguiente solo aparece una vez el anterior está lleno
(institución+título+año, o descripción para Conocimientos Informáticos) - Bachillerato pasa a ser
obligatorio, los demás 3 siguen siendo opcionales.

- `Estudios.jsx`: nuevo helper `nivelLleno(valor)` (mismo criterio de "completo" que ya exigía
  `handleSubmit` para cualquier nivel con datos) y `nivelesVisibles` (Bachillerato siempre visible;
  cada nivel siguiente solo si el anterior está lleno - reactivo, si se borra un nivel ya lleno el
  siguiente vuelve a ocultarse, sin perder los datos que tenía). `handleSubmit` ahora exige
  Bachillerato completo siempre (antes bastaba con llenar cualquier nivel). UI: asterisco rojo en
  Bachillerato, "(opcional)" en los demás; texto de ayuda y estado del formulario actualizados.
- `services/candidatoFormulario.service.js`, `actualizarEstudios`: mismo ajuste en el backend
  (defensa en profundidad, no solo frontend) - exige que la fila 'bachillerato' venga completa,
  reemplazando el chequeo anterior de "al menos un nivel con datos".
- Verificado con `node --check`/`npx eslint` (el único aviso es preexistente, confirmado con
  `git stash`).

## 10. Experiencia laboral del candidato: opción "Actualmente trabajo aquí"

Pedido: en `Experiencia.jsx` (paso 4/6, sección "Fechas y Tiempo"), agregar una opción para que el
candidato indique que sigue trabajando en la empresa actual - hasta ahora "Fecha de Retiro" y
"Motivo de Retiro" eran siempre obligatorios.

- `Experiencia.jsx`: nuevo checkbox "Actualmente trabajo aquí" junto a "Fecha de Retiro". Al
  marcarlo, ese campo se deshabilita y se vacía, y deja de ser obligatorio junto con "Motivo de
  Retiro" (ambos opcionales cuando aplica). "Tiempo Laborado" se recalcula contra la fecha de hoy
  en vez de fecha_retiro_experiencia. Al cargar un candidato ya guardado, el checkbox se infiere
  solo (`fecha_inicio_experiencia` presente + `fecha_retiro_experiencia` vacía) - **no se agregó
  ninguna columna nueva** para este flag, se infiere de que la fecha de retiro venga vacía (mismo
  criterio en frontend y backend).
- `services/candidatoFormulario.service.js`, `actualizarExperiencia`: mismo relajo de validación
  (fecha_retiro_experiencia/motivo_retiro ya no son obligatorios), y se normalizan a `null` antes
  de guardarlos (evita mandar `''` a una columna `DATE`).
- `services/hojaVidaPdfService.js`: cuando fecha_retiro es NULL pero sí hay fecha_inicio, la celda
  "Fecha de Retiro" del PDF imprime "Actualidad" en vez de quedar en blanco.
- **No se tocó** `PerfilCandidato.jsx` (perfil del reclutador) - si fecha_retiro_experiencia está
  vacía, esa línea simplemente no se muestra (sin "Actualmente trabaja aquí"); no rompe nada, pero
  queda como posible mejora a futuro si se pide.
- Verificado con `node --check`/`npx eslint` (el único aviso es preexistente, confirmado con
  `git stash`).

## 11. Formulario del candidato, paso "Personal": "Genograma" → "Núcleo Familiar"

Cambio de copy puro en `Personal.jsx` (paso 5/6): el título de la sección pasó de "Genograma" a
"Núcleo Familiar" - el texto de ayuda ya decía "hace referencia a con quién vive usted, su núcleo
familiar", así que el nombre nuevo es más claro para el candidato. Solo se tocó el `<h2>`; el
nombre del campo en el código (`genograma`, `formData.genograma`, columna en BD) no se tocó -
"Genograma" no aparecía en ningún otro lado visible (ni `PerfilCandidato.jsx` ni el PDF, que trae
la etiqueta impresa en la plantilla base, fuera del alcance del pedido). Verificado con
`npx eslint` (aviso preexistente, mismo patrón de siempre).

## 11.5. Bugfix: "Citados" perdía el botón Email al pasar a "Entrevistados" + email duplicado
## permitido al crear candidato

Dos pedidos de seguimiento el mismo día:

**a) Botón Email en "Entrevistados"**: el usuario probó el flujo real (crear candidato → citar →
Selección marca "asistió") y notó que, al pasar de `citado` a `entrevistado` (`marcarAsistencia` en
`seleccion.controller.js`, sin tocar - siempre cambió el estado así), el candidato desaparecía del
tab "Citados" de `ListaCandidatos.jsx` y en "Entrevistados" nunca hubo botón de acción. Fix:
`getAccionButton` ahora muestra el botón "Email" (`handleReenviarEmail`) también para
`estado === 'entrevistado'`, no solo `'citado'`.

  ⚠️ Al investigar esto salió a la luz algo más grande: entre los cambios de hoy (quitar "Gestión
  de Entrevista", quitar "Marcar como Citado"/"No Citado", y quitarle la fecha/hora al modal
  "Citar") **ya no queda ningún lugar en la app que fije `fecha_citacion_entrevista` ni que avance
  `estado` a `'citado'`** (confirmado: `ApiService.actualizarFechaEntrevista` ya no lo llama nadie,
  solo queda declarado en `api.js`; el único código que lo seguía haciendo es
  `NuevoCandidato_clean.jsx`, el duplicado sin usar). Eso implica que, a futuro, el Excel de
  Selección (que exige rango de `fecha_citacion_entrevista`) y cualquier vista de "Fecha de Cita"
  se quedarán vacíos para candidatos nuevos. Se le planteó la pregunta al usuario (3 opciones:
  devolver el selector de fecha al modal "Citar", que Selección la fije al marcar asistencia, o
  ajustar Selección para no depender de esa fecha) — **el usuario no la respondió todavía**, pidió
  en su lugar el fix puntual del botón de Email. **Sigue pendiente resolver esto** cuando el
  usuario decida.

**b) Email duplicado permitido al crear candidato**: se quitó la validación que bloqueaba crear un
candidato con un email ya usado por otro candidato (`crearCandidato`,
`controllers/candidato.controller.js`) - la validación de cédula duplicada se dejó igual, solo se
quitó la de email. También había una restricción **UNIQUE a nivel de base de datos** sobre
`email_personal` (además de la validación de la app) que igual habría bloqueado el INSERT con un
error de duplicado aunque se quitara solo la validación de la app - **migración `015_permitir_
email_duplicado.sql`** (nueva) la elimina (`DROP INDEX email_personal`), dejando intacto el índice
normal `idx_email` que ya existía aparte para búsquedas. Verificado con `node --check`.

⚠️ **La migración 015 tampoco se aplicó** en esta sesión (mismo bloqueo del modo automático que la
014) - pendiente aplicarla a mano, junto con la 014.

## 12. Estado de despliegue

⚠️ **Hallazgo importante**: en esta sesión, todo el trabajo de los puntos 1-11 apareció commiteado
solo (commit `375d954 "ajustes finales"` en `hidrabackend`, `80799e3 "ajustes finales"` en
`hidrafrontend`, ambos autor `SebasAcosta77`, 2026-08-26 ~14:08) **sin que Claude ejecutara
`git commit` en ningún momento** — ya había pasado una vez antes en la misma sesión (commit
`c10dafc "ajuste anecedentes"`, solo `upload.middleware.js`). Contenido de ambos commits revisado:
coincide exactamente con los cambios descritos en este archivo, nada raro ni de más. Causa
desconocida (¿algo en el entorno del usuario que auto-commitea? no hay hooks en
`.claude/settings.json` ni global que lo expliquen). El usuario ya fue avisado en el chat las 2
veces que pasó.

**Con esto, working tree limpio en ambos repos** (solo `.gitignore` modificado en `hidrabackend` y
`claude/`/`uploads/` sin trackear) — commiteado NO es lo mismo que desplegado, sigue sin llegar a
producción.

**Pendiente, acumulado de rondas anteriores + esta:**
- Aplicar las migraciones 014 y 015 (local y luego producción) — esto es estado de BASE DE DATOS,
  el commit no lo resuelve. Sin la 014, `citado_gestion`/`estado_gestion_reclutamiento`/`perfil` no
  existen todavía; sin la 015, la restricción UNIQUE de `email_personal` sigue bloqueando crear un
  candidato con email repetido aunque la validación de la app ya se haya quitado (además de las
  009-013 que ya estaban pendientes de producción).
- **Decidir qué hacer con `fecha_citacion_entrevista`/`estado='citado'`** (ver punto 11.5) — ya no
  hay ninguna acción en la UI que los fije; se le preguntó al usuario 3 opciones y no respondió
  todavía, solo pidió el fix puntual del botón de Email en "Entrevistados" (ya hecho).
- Desplegar a producción (`git pull` + reiniciar el proceso Node) — el fix de
  `upload.middleware.js` (carpeta `uploads/antecedentes/`) sigue sin llegar ahí; mientras tanto,
  crear la carpeta a mano en el servidor como parche inmediato.
- El resto de pendientes de rondas anteriores (migraciones 009-013 en prod, `npm install`,
  pruebas de Reasignar/paso 6/FirmaCloud, commit y despliegue de `firmacloudfrontend`) sigue igual
  — detalle completo en `claude/plan.md`.

## 13. Prueba end-to-end en navegador real (2026-08-26): crear candidato → citar → email →
## llenar formulario completo

Se probó en el navegador, contra `localhost:5173`/`:3000` (local), el flujo completo pedido por el
usuario: crear candidato con "Citado: Sí" → confirmar que aparece en el tab "Citados" → enviar el
email (botón nuevo del punto 11.5) → llenar como candidato los 6 pasos del formulario (token real
tomado directo de la BD, sin pasar por un inbox real) → verificar el perfil del reclutador con todos
los datos.

**Login usado**: se reseteó localmente (`UPDATE hyd_usuarios SET password_hash = ...`, con
`bcryptjs` del propio proyecto) la contraseña de `test@local.com` (cuenta administrador ya existente
en la BD, `activo=1`) a `Test1234!`, con permiso explícito del usuario - **este cambio de contraseña
también quedó sin revertir** (cuenta de prueba local, no debería importar, pero queda anotado).

**Todo funcionó correctamente, punta a punta**:
- Formulario "Nuevo Candidato": Fecha/Analista de solo lectura ✅, orden de campos ✅.
- Al crear con Citado=Sí, apareció automáticamente en el tab "Citados" (gracias al OR con
  `citado_gestion` del punto 3) ✅, con botón "Email" visible (gracias al fix del punto 11.5) ✅.
- Botón "Email" → `reenviarEmail` regeneró el token correctamente (verificado en BD) ✅.
- Formulario del candidato con el token: Hoja de Vida (aspiración salarial) ✅, Datos Básicos ✅,
  Estudios (revelado progresivo: solo Bachillerato visible al inicio, apareció Técnico/Tecnólogo
  opcional al completarlo, se dejó vacío a propósito y no bloqueó el envío) ✅, Experiencia con
  "Actualmente trabajo aquí" (Fecha de Retiro se deshabilitó, Tiempo Laborado calculó "4 años y 7
  meses" contra hoy, Motivo de Retiro dejó de ser obligatorio) ✅, Personal con "Núcleo Familiar"
  renombrado ✅, Consentimiento (mensaje rediseñado del paso 6, sin checkbox) ✅ — los 6 pasos
  quedaron `completado=1` en BD, confirmado por consulta directa.
- El único paso que no se pudo completar fue el redirect final a FirmaCloud (falla al no estar ese
  servicio corriendo en este entorno local) - esperado, no es un bug de esta app, y el perfil del
  reclutador lo refleja correctamente ("Este candidato todavía no llegó al paso de firma").
- Perfil del reclutador: tarjetas "Hoja de Vida" y "Datos de Registro" (punto 4) con todos los datos
  correctos ✅, "Gestión de Entrevista"/"Marcar Citado"/"No Citado" confirmados ausentes (punto 5) ✅,
  "Estado de Formularios" con los 6 pasos en verde ✅.

**Un hallazgo real durante la prueba** (no del código, de la herramienta de automatización): el
checkbox "Actualmente trabajo aquí" no reaccionaba al helper `form_input` (que fuerza la propiedad
`checked` del DOM sin pasar bien por el sistema de eventos de React) - con un clic real sí disparó
`onChange` correctamente. No requirió ningún cambio de código, era un artefacto de cómo se probó, no
un bug de `Experiencia.jsx`.

**La migración 014 ya estaba aplicada en esta BD local** (verificado antes de la prueba, columnas
`citado_gestion`/`estado_gestion_reclutamiento`/`perfil` presentes - alguien la corrió fuera de esta
sesión). **La 015 se aplicó en esta BD local durante la sesión** (a pedido del usuario, que preguntó
si ya podía crear un candidato con email repetido - se corrió el `DROP INDEX email_personal` y se
verificó que solo queda `idx_email`, no único). Ninguna de las dos migraciones está aplicada en
producción todavía.

**Dato de prueba que quedó en la BD local**: candidato id 7888 ("Candidato PruebaE2E",
`999888777`, `candidato.pruebae2e@example.com`) - no se borró, queda ahí como dato de prueba local
si se quiere limpiar.

## 14. Migración 015 aplicada en BD local + nueva columna `fecha_envio_email` para la hoja de
## vida impresa

**a) Migración 015 aplicada**: el usuario preguntó si ya podía crear un candidato con email
duplicado - se corrió `database/migrations/015_permitir_email_duplicado.sql` contra la BD local
(el modo automático la dejó pasar esta vez, a diferencia de intentos anteriores con ALTER TABLE).
Verificado: `email_personal` ya no tiene el índice UNIQUE, solo `idx_email` (no único). Sigue sin
aplicarse en producción.

**b) "FECHA DE ENTREVISTA" de la hoja de vida impresa ahora usa la fecha de envío del email**:
pedido del usuario - esa celda del PDF (`hojaVidaPdfService.js`) se llenaba con
`fecha_citacion_entrevista`, que desde que se le quitó fecha/hora al modal "Citar" (rondas
anteriores) ya no la fija nada en la app, así que quedaba siempre en blanco. Ahora usa una fecha
distinta: cuándo se le envió (o reenvió) al candidato el email con el link de sus formularios.

- **Migración `016_fecha_envio_email.sql`** (nueva, ya aplicada en BD local): agrega
  `fecha_envio_email DATETIME NULL` a `hyd_candidatos`. Se decidió una columna nueva y separada en
  vez de reutilizar `fecha_citacion_entrevista`, para no perder el significado original de esa
  columna por si se retoma una citación real más adelante.
- `controllers/candidato.controller.js`, `reenviarEmail`: el mismo UPDATE que regenera el token
  ahora también fija `fecha_envio_email = NOW()` en cada (re)envío.
- `services/hojaVidaPdfService.js`: la celda "FECHA DE ENTREVISTA:" (x=184, y=681.56) ahora dibuja
  `fmtFecha(candidato.fecha_envio_email)` en vez de `fecha_citacion_entrevista`. El texto impreso
  de la etiqueta en la plantilla PDF sigue diciendo "FECHA DE ENTREVISTA" (es texto fijo del PDF
  base, no se puede cambiar por código) - el usuario fue informado de este matiz.
- **No se tocó** `PerfilCandidato.jsx` ni su exportación rápida a PDF (jsPDF, en el navegador) -
  nunca mostraron ese campo, no había nada que actualizar ahí.
- Verificado end-to-end en navegador real: se disparó `reenviarEmail` de verdad (vía fetch
  autenticado) contra el candidato de prueba (id 7888) y se confirmó en BD que `fecha_envio_email`
  quedó en la fecha/hora real del envío, con `fecha_citacion_entrevista` en NULL. Verificado con
  `node --check` en ambos archivos backend tocados.

⚠️ **Nuevo hallazgo del mismo patrón de auto-commit** (ver punto 12): aparecieron 2 commits más en
`hidrafrontend` que Claude no ejecutó (`941ddd5 "ajuste enviar email"` y `d18b7c1 "no me acuerdo"` -
este último con mensaje muy humano, timestamp de hoy 27-ago). Se revisó el contenido de ambos: juntos
capturan exactamente el fix de "Email" para `estado='nuevo'`/`'entrevistado'` de la ronda anterior,
sin nada extraño ni de más. El mensaje "no me acuerdo" sugiere que esto podría ser alguna
herramienta/extensión del propio entorno del usuario auto-commiteando, no algo de Claude Code -
ya se le avisó al usuario en el chat.

## 15. Bug real encontrado: TODA hoja de vida/tratamiento de datos generados llevaban el título
## "Potter Gayyyyyyyyyyyyyy" en su metadata /Title (no en el texto impreso)

El usuario reportó ver "836,11: %%Title: (Potter Gayyyyyyyyyyyyyy.pdf)" al abrir directamente
`plantilla/hojavida.pdf` en un editor de texto. Investigado: **no es un dato de un candidato
específico ni un bug de FirmaCloud** (se revisó también `firmacloudbackend/src/services/
reclutamientoPdfService.js::stampSignature` - solo dibuja la imagen de la firma + un ID de
FirmaCloud, nunca toca el nombre) - es metadata `/Title` de la plantilla PDF en sí, dejada por
Adobe Illustrator al exportarla (`Creator: Adobe Illustrator 29.3`, `/Title(Potter
Gayyyyyyyyyyyyyy)` en el Info dictionary, línea 8786 del archivo) - probablemente el nombre del
archivo de Illustrator con el que se diseñó la plantilla, filtrado sin querer al exportar a PDF.

Como el código (`hojaVidaPdfService.js`) nunca sobrescribía el título del documento, **todo
candidato heredaba ese mismo título fijo** en su PDF generado - visible en la pestaña del
navegador/visor de PDF al abrirlo, no impreso en el contenido de la página (por eso no aparecía en
ningún lugar de la UI de Hydra, solo al abrir el PDF directamente). Esto es justamente lo que el
usuario pedía ("que cuando vaya al perfil de cada candidato aparezca el nombre del candidato").

**Fix**: `pdfDoc.setTitle(nombreCompleto(candidato))` agregado al final de
`generarHojaVidaPdf` (`services/hojaVidaPdfService.js`) y `generarTratamientoDatosPdf`
(`services/tratamientoDatosPdfService.js`, mismo problema aunque con un título menos obviamente
raro - "AUTORIZACIÓN TRATAMIENTO DE DATOS -BOG 1111" en vez de un nombre de persona - corregido
por consistencia). Verificado generando de verdad ambos PDF contra el candidato de prueba (id
7888) y leyendo el título resultante con `pdf-lib`: ambos ahora devuelven "Candidato PruebaE2E" en
vez del título viejo de la plantilla.

⚠️ **Este fix solo aplica a documentos generados de ahora en adelante** - mismo problema que ya
se explicó para el nombre garbled: los PDF ya firmados en FirmaCloud son copias congeladas, este
cambio no los corrige retroactivamente.

**Hallazgo aparte, no tocado**: `plantilla/hojavida.pdf` apareció modificado en el working tree
(12086 líneas de diferencia contra el último commit del 2026-08-20) sin que esta sesión lo haya
tocado - parece trabajo previo sin commitear (posiblemente relacionado con el pendiente "decidir si
tratamientoDatosPdfService.js pasa a Times New Roman" de rondas anteriores). No se investigó más a
fondo ni se tocó, queda anotado para que el usuario lo revise.
