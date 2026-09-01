# Arquitectura actual y registro de bugs — Hydra Reclutamiento

## Arquitectura actual

**Panorama general:** monolito de 2 piezas (backend REST + frontend SPA), en repos Git separados, sin ORM, sin capa de servicios/repositorio (salvo email), sin tests, sin CI/CD visible, sin sistema de migraciones versionado.

### Backend (`hidrabackend`) — Express, capas planas

```
routes → middleware (auth) → controllers → mysql2 (pool global) → MySQL
```

- **Sin ORM**: `global.db` es un pool `mysql2` crudo, asignado una vez en `index.js`, usado directo en los controllers con `global.db.query(sql, params, callback)` (estilo callback, no `async/await`, no promesas).
- **Sin capa de repositorio/servicio**: los controllers arman SQL inline. La única excepción es `services/email.service.js`.
- **Auth stateless por JWT**: login por email+password (bcrypt) → JWT de 8h. Cada request protegida vuelve a golpear `hyd_usuarios` en `verificarToken` para confirmar que el usuario sigue activo (no hay caché ni sesión server-side).
- **Control de acceso en 2 capas independientes que no siempre coinciden**: `verificarRol(...roles)` / `verificarPermiso(permiso)` en `middleware/auth.middleware.js`, pero `seleccion.routes.js` **no los usa** — define sus propios middlewares inline (`verificarRolSeleccion`, `verificarRolLectura`), duplicando la lógica con reglas propias.
- **Filtrado por dueño inconsistente entre endpoints**: la mayoría de queries de candidato filtran `WHERE reclutador_id = ?` cuando el rol es `reclutador`, pero no todos los endpoints lo hacen (ver bug #4 abajo).
- **Sin Foreign Keys en la base**: `reclutador_id` y `oleada_seleccion_id` son enteros sueltos; la integridad referencial existe solo porque el código de la aplicación es disciplinado, no porque la BD lo garantice.
- **Subida de archivos (nuevo, 2026-08-21)**: `multer` + `middleware/upload.middleware.js`, guarda en disco local (`uploads/antecedentes/`, no versionado en git) — primera vez que el backend acepta archivos de usuario (antes solo generaba PDFs internamente vía `pdf-lib`). No hay almacenamiento externo (S3 u otro); en producción hay que asegurar que esa carpeta persista entre despliegues.

### Frontend (`hidrafrontend`) — React 19 + Vite, sin gestor de estado global

- **Enrutamiento**: `react-router-dom` v7, rutas declaradas todas en `App.jsx`, cada una envuelta en `<ProtectedRoute permission="..." />` o `<ProtectedRoute roles={[...]} />`.
- **Estado de auth**: Context API + `useReducer` (`AuthContext.jsx`), persistido en `localStorage` (`token`, `user`). No hay Redux/Zustand/Query — cada componente hace su propio `fetch` vía el singleton `ApiService` (`services/api.js`).
- **Navegación post-login por rol**: `RoleRedirect.jsx` manda a cada rol a su home (`administrador` → gestión reclutadores, `seleccion` → candidatos selección, `reclutador` → dashboard).
- **Menús laterales por rol, hardcodeados**: cada rol tiene su propio componente Sidebar (`AdminSidebar.jsx`, `Sidebar.jsx`, `SidebarSeleccion.jsx`) con un array `menuItems` fijo en código — **no se genera desde `user.permisos`**, así que permisos del backend y opciones visibles en el menú pueden divergir (ver bug #5).
- **URLs de API hardcodeadas**: `import.meta.env.DEV ? 'http://localhost:3000' : 'http://200.91.204.54'`, repetido en `api.js` y `AuthContext.jsx` — no hay variable de entorno de Vite (`.env`/`VITE_*`).

### Base de datos (MySQL, esquema `noviembrehidra`)

Núcleo original: `hyd_usuarios`, `hyd_candidatos`, `hyd_oleadas`. Desde 2026-08-18 se suman 6 tablas del formulario de candidato (`hyd_candidato_datos_basicos`, `hyd_candidato_estudios`, `hyd_candidato_experiencia`, `hyd_candidato_experiencia_resumen`, `hyd_candidato_personal`, `hyd_candidato_consentimiento`, ver `claude/plan.md`), con FK real a `hyd_candidatos`. La carpeta `database/` (raíz) tiene ~15 scripts `.sql` viejos sueltos (creación, migraciones incrementales, fixes) **sin numeración ni registro de cuáles se aplicaron dónde** — es la causa raíz de que el entorno local haya llegado a divergir fuertemente de producción (ver sección de bugs). Desde 2026-08-14, los cambios de esquema nuevos sí quedan en `database/migrations/`, numerados (bug #12, en progreso). `SCHEMA_DOCUMENTATION.md` documenta parte de esto pero ya estaba desactualizado (ver bug #1) y no incluye las tablas nuevas.

### Despliegue

Backend y frontend corren como procesos separados; producción apunta a la IP `200.91.204.54` hardcodeada en el frontend. No hay Dockerfile, no hay pipeline de CI/CD visible en ninguno de los dos repos.

---

## Registro de bugs y problemas de diseño

### 🔴 Corregidos en esta sesión (2026-08-13)

**1. `hyd_usuarios` sin `PRIMARY KEY`/`AUTO_INCREMENT` en `id`**
Toda la tabla local era `text`/`int` sueltos sin constraints (probablemente producto de una importación de datos defectuosa, no de `database/create_users_table.sql`). Cualquier `INSERT` sin `id` explícito (crear reclutador, crear usuario) dejaba la fila con `id NULL`, rompiendo JWT y cualquier lógica dependiente de `usuario.id`. **Corregido** con `ALTER TABLE` para igualar tipos, `PRIMARY KEY AUTO_INCREMENT`, `UNIQUE(email)`, índices en `rol`/`activo` — verificado contra `DESCRIBE hyd_usuarios` de producción, sin pérdida de datos.

**2. `hyd_oleadas` corrupta**
Las columnas literalmente eran fragmentos de texto JSON mal importado (`[{"id":1`, `numero_oleada:1`, etc. como *nombres* de columna) en vez de columnas reales. Rompía todo el módulo de oleadas de selección (`Unknown column` en SQL). **Reconstruida** parseando los 17 registros recuperables de las celdas corruptas, con el esquema real de producción (incluye quitar una `UNIQUE KEY(numero_oleada, operacion, campana)` que se había agregado de más — producción solo tiene índices simples). Backup de la versión corrupta en `hyd_oleadas_backup_corrupto`.

**3. `hyd_candidatos.estado` era `int`, no el `ENUM` real**
Local tenía `estado` como `int` con las 7857 filas en `0` (dato perdido en la importación). Producción usa `ENUM` de **17 estados** (no 15 como decía `SCHEMA_DOCUMENTATION.md` — faltaban `aprobado_final` y `rechazado_final`, ese doc está desactualizado). **Corregido**: columna convertida al ENUM real, indexada, `DEFAULT 'nuevo'`; los 7857 candidatos reseteados a `'nuevo'`.

**4. Otras discrepancias de esquema en `hyd_candidatos` vs. producción**
`asistio_citacion` era `varchar(20)` en vez de `ENUM('pendiente','asistio','no_asistio')`; `consentimiento_aceptado` y los 6 `formulario_*_completado` tenían `DEFAULT NULL` en vez de `DEFAULT 0`; faltaban índices en `reclutador_id`, `oleada_seleccion_id`, `aprobacion_final`. Todo corregido y verificado campo por campo contra el `DESCRIBE` real de producción.

### 🟡 Pendientes — bugs de código, no de datos

**5. `api.js`: `post()` y `get()` no exponen el error real del backend**
`services/api.js` — `put()` y `delete()` sí hacen `const errorData = await response.json()` y lanzan `errorData.error`, pero `post()` (línea ~46-69) y `get()` (línea ~22-44) solo lanzan `Error: ${response.status}`, descartando el mensaje JSON que sí manda el backend (`{"error": "..."}`). Esto causó confusión repetida en esta sesión: todo error de creación (`crearReclutador`, etc.) se ve en consola como `Error: 400` sin decir por qué. **Fix sugerido**: alinear `post()`/`get()` con el patrón que ya usa `put()`.

**6. `AdminSidebar.jsx` con menú hardcodeado — no refleja los permisos reales**
El array `menuItems` (`AdminSidebar.jsx:15-26`) solo tiene 2 entradas fijas (Gestión de Reclutadores, Desprendibles) aunque el rol `administrador` tiene *todos* los permisos (`ver_dashboard`, `ver_candidatos`, `ver_usuarios`, `ver_estadisticas`, etc.) y las rutas correspondientes en `App.jsx` sí lo dejarían entrar. El admin nunca ve esas opciones porque no hay link al sidebar. **Fix sugerido**: ampliar `menuItems` o generarlo desde `user.permisos`.

**7. `/api/seleccion/candidatos-citados` no filtra por `reclutador_id` — inconsistencia lista/detalle**
`seleccion.controller.js: getCandidatosCitados` (líneas 7-42) trae **todos** los candidatos citados del sistema, sin importar el rol que llama (el comentario en el código dice "los psicólogos ven todos los candidatos" — se diseñó pensando solo en el rol `seleccion`). Pero la ruta también la puede llamar `reclutador` (acceso de lectura vía `verificarRolLectura`), y el frontend la usa en `CandidatosTotal.jsx`, la página "Candidatos Total" del reclutador. Resultado: un reclutador ve en la lista candidatos que **no son suyos**, y al abrir el perfil (`candidato.controller.js: getPerfilCompleto`, que sí filtra `WHERE reclutador_id = ?` para ese rol) le sale 404 "no tienes acceso a este candidato". El candidato existe; la lista no debería habérselo mostrado. **Fix sugerido**: filtrar `getCandidatosCitados` por `reclutador_id` cuando `req.usuario.rol === 'reclutador'`, igual que el resto del backend.

**8. `seleccion.routes.js` no reutiliza el middleware de auth compartido**
Define sus propios `verificarRolSeleccion`/`verificarRolLectura` inline (líneas 10-24) en vez de usar `verificarRol()`/`verificarPermiso()` de `middleware/auth.middleware.js`. Funciona, pero duplica la lógica de control de acceso en dos sitios que pueden divergir con el tiempo (de hecho ya divergieron: es la única ruta del backend que no filtra por dueño, bug #7).

**9. Sin Foreign Keys declaradas en la base (parcialmente resuelto, 2026-08-18)**
`reclutador_id → hyd_usuarios.id` y `oleada_seleccion_id → hyd_oleadas.id` siguen sin FK real. No confirmado todavía si producción sí las tiene (`DESCRIBE` no lo distingue de un índice normal — haría falta `SHOW CREATE TABLE` de producción). Las 6 tablas nuevas del formulario de candidato (`hyd_candidato_datos_basicos`, `hyd_candidato_estudios`, `hyd_candidato_experiencia`, `hyd_candidato_experiencia_resumen`, `hyd_candidato_personal`, `hyd_candidato_consentimiento`, migración `database/migrations/002_...sql`) sí declaran FK real (`candidato_id → hyd_candidatos(id) ON DELETE CASCADE`) — primer caso en el proyecto. El resto de tablas sigue dependiendo 100% de que el código de los controllers no falle.

**10. Código muerto probable: `NuevoCandidato_clean.jsx`**
`components/reclutador/NuevoCandidato_clean.jsx` es casi idéntico a `NuevoCandidato.jsx` (mismos imports, misma estructura) y no está referenciado en `App.jsx`. Parece un remanente de una refactorización.

**11. Desprendibles depende de `numero_documento` del usuario (comportamiento esperado, no bug)**
`desprendibles.controller.js: getMesesController/getPdfController` requieren `req.usuario.numero_documento` para consultar la API externa de nómina (IntraCar) por cédula. Si el usuario logueado no tiene cédula cargada (como `admin@local.com`, o cualquier usuario de prueba sin `numero_documento`), la respuesta es `400 "Tu usuario no tiene número de documento registrado"` — es el comportamiento correcto del código, simplemente rompe con cualquier usuario ficticio de pruebas.

**12. `database/` sin control de versión de esquema (en progreso desde 2026-08-14)**
Los ~15 scripts `.sql` viejos (creación inicial, migraciones incrementales, fixes puntuales, en la raíz de `database/`) siguen sin numeración ni tabla de control de migraciones aplicadas — es la causa estructural detrás de los bugs #1-#4. Desde 2026-08-14 los cambios de esquema nuevos sí quedan numerados en `database/migrations/` (001 a 011 al 2026-08-21), pero **no hay una tabla `schema_migrations` ni tooling que registre cuáles ya corrieron en cada entorno** — seguir llevando la cuenta a mano (como se ha hecho hasta ahora: la migración 001 está aplicada en local y pendiente en producción; 002-003, 005-007 aplicadas en local; 004 escrita pero deliberadamente sin aplicar en ningún lado; 008 aplicada en local y producción; 009-011 aplicadas solo en local) es frágil a medida que se acumulen más migraciones.

### 🔴 Corregido esta sesión (2026-08-21)

**13. "Marcar como Citado" podía dejar `estado='citado'` con `fecha_citacion_entrevista=NULL`**
`PerfilCandidato.jsx` (tarjeta "Gestión del Proceso") y `ListaCandidatos.jsx` (acción rápida "Citar") cambiaban el `estado` directo a `'citado'` (`cambiarEstado`/`handleCambiarEstado`, endpoint `cambiar-estado`) — completamente desconectado de "Programar fecha" (tarjeta "Gestión de Entrevista", único lugar que en realidad escribía `fecha_citacion_entrevista`, vía `actualizarFechaEntrevista`). Un reclutador podía marcar "Citado" sin nunca fijar la fecha, dejando al candidato invisible para Selección (que filtra estrictamente `fecha_citacion_entrevista IS NOT NULL`). **Corregido**: `actualizarFechaEntrevista` ahora también avanza `estado` a `'citado'` en la misma operación cuando el candidato viene de un estado temprano (`nuevo`/`contacto_exitoso`/`formularios_completados`), sin retroceder un estado ya más avanzado. Ambos botones pasaron a abrir un modal que exige fecha/hora antes de confirmar, en vez de cambiar el estado directo. Detalle en `claude/lastcontext.md`, §4.

### 🟡 Pendientes nuevos, encontrados esta sesión (2026-08-21)

**14. "Candidatos" de Reclutamiento (`ListaCandidatos.jsx`) no tiene pestaña para estados posteriores a la evaluación**
Las pestañas fijas (`Contacto Exitoso`, `Formularios Enviados`, `Formularios Completados`, `Citados`, `Entrevistados` + dropdown de contacto fallido) no cubren `aprobado`, `rechazado`, `aprobado_final`, `rechazado_final` ni `contratado` — un candidato ya evaluado/decidido por Selección desaparece de esa pantalla (sigue viéndose en "CandidatosT", que no filtra por estado por defecto). El backend (`GET /candidato/por-estado/:estado`) sí soporta esos estados si se piden directamente; es puramente un hueco de UI (pestañas hardcodeadas, mismo patrón de bug ya documentado para `AdminSidebar.jsx`, bug #6). Informado al usuario, sin decisión tomada todavía sobre si agregar pestañas nuevas.

**15. 17 candidatos con `asistio_citacion='asistio'` pero `estado='nuevo'` (dato histórico, no bug de código)**
Remanente del reseteo masivo de `estado` del 2026-08-13 (bug #3 de esta misma lista): el reseteo pisó `estado` a `'nuevo'` para todos los candidatos, pero `asistio_citacion` sobrevivió con su valor de antes del reseteo en estos 17 casos puntuales. Verificado que el código actual de `marcarAsistencia` funciona bien (fija `estado='entrevistado'` correctamente) — esto es dato viejo inconsistente, no una regresión. Pendiente decidir con el usuario si se corrige con un `UPDATE` puntual (`estado='entrevistado'` solo para esos 17, sin tocar el resto de candidatos en `'nuevo'`).

### 🔴 Corregido esta sesión (2026-08-21/24)

**16. `hojaVidaPdfService.js`: 4 celdas de `hojavida.pdf` se desbordaban hacia la fila de abajo**
`drawTextBox`/`drawFit` en las celdas de **Funciones** (empresa actual y anterior), **Competencias
Laborales** y **Estado de Salud Actual** (página 2) tenían `maxHeight`/posición mayores que el
borde real de su celda — detectado mapeando los trazos vectoriales reales de toda la plantilla
(`getTableBorders`/`getRowColumnBorders`, ya usado antes solo para la tabla académica) y cruzándolo
con la posición exacta de cada etiqueta impresa. Con texto suficientemente largo, el valor se
dibujaba encima de la fila siguiente (ej. Competencias Laborales podía llegar a invadir el
encabezado "Estado de salud actual"). **Corregido**: Funciones pasó a una sola línea junto a su
etiqueta (el recuadro impreso solo tiene 21.6pt de alto, sin espacio real para 2 líneas);
Competencias Laborales y Estado de Salud Actual tienen su `maxHeight` recortado al borde real
medido. Detalle completo en `claude/plan.md`, "duodécima ronda".

**17. `fecha_citacion_entrevista` y `autoevaluacion` se dibujaban fuera del recuadro/renglón en
blanco de la plantilla**
`fecha_citacion_entrevista` escribía en x=108, todavía dentro de la celda de la propia etiqueta
"FECHA DE ENTREVISTA:", en vez del recuadro en blanco dedicado de esa fila (x=180.4-336.3).
`autoevaluacion` escribía en x=505, a la derecha del renglón en blanco impreso `"CALIFIQUESE DE 1 A
5 = ______"` (que va de x=434.2 a 489.9), no sobre él. Ambos detectados al revisar visualmente el
PDF generado, corregidos con la posición real medida (x=184 y x=459 respectivamente).
