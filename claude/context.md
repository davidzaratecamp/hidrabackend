# Contexto del proyecto — Hydra Reclutamiento

Sistema de gestión de reclutamiento y selección de personal ("Hydra"). Dos repos separados que forman un monorepo lógico:

- **Backend**: `ReclutamientoBackend/hidrabackend` — Node.js + Express + MySQL, este repo.
- **Frontend**: `ReclutamientoFronted/hidrafrontend` — React 19 + Vite + Tailwind, repo hermano.

Ver también `claude/arquitectura-y-bugs.md` — catálogo detallado de la arquitectura actual y de bugs/problemas de diseño pendientes (más profundo que las notas de esta sesión más abajo).

## Cómo correr en local

```powershell
# Backend (hidrabackend)
npm run dev      # node --watch index.js, puerto 3000

# Frontend (hidrafrontend)
npm run dev       # vite, puerto 5173
```

Requiere MySQL local corriendo (servicio Windows "MySQL") con la base `noviembrehidra`. Configuración en `.env` del backend (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`, `JWT_SECRET`, credenciales de email SMTP, y `NOMINA_BASE_URL`/`API_KEY_NOMINA` para la API externa de nómina).

⚠️ **`DB_PASSWORD` y `FRONTEND_URL` del `.env` local NO son los de producción** — `DB_PASSWORD` vacío (root local sin password) y `FRONTEND_URL=http://localhost:5173` (para que los correos que genera el backend local apunten al frontend local, no al de producción). Si `FRONTEND_URL` queda apuntando a producción, los links de los correos de "reenviar formulario" llevan a `200.91.204.54`, que consulta la BD de **producción**, no la local — el candidato "no se encuentra" aunque exista en tu base local. Revisar estos dos valores primero si algo similar vuelve a fallar.

## Backend — estructura

```
index.js                 # bootstrap Express, pool mysql2, cors, monta routers
config/                  # scripts .sql sueltos (no config de app)
routes/
  auth.routes.js          # /api/auth/*
  candidato.routes.js      # /api/candidato/*
  seleccion.routes.js      # /api/seleccion/*
  desprendibles.routes.js  # /api/desprendibles/*
controllers/
  auth.controller.js       # login, gestión de usuarios/reclutadores
  candidato.controller.js  # CRUD candidatos, formularios públicos por token, analytics
  seleccion.controller.js  # proceso de selección: citas, oleadas, evaluaciones, decisión final
  desprendibles.controller.js # PDFs de desprendibles de nómina (integra API externa IntraCar)
models/
  usuario.model.js         # hash/verify password (bcryptjs), JWT, catálogo de roles y permisos
  candidato.model.js
middleware/
  auth.middleware.js        # verificarToken, verificarRol(...roles), verificarPermiso(permiso)
  upload.middleware.js      # multer (2026-08-21) - disco en uploads/antecedentes/, solo PDF/JPG/PNG, 10MB
services/
  email.service.js          # envío de correos (nodemailer, Gmail SMTP)
database/                  # dumps y migraciones .sql, SCHEMA_DOCUMENTATION.md
uploads/                   # archivos subidos por usuarios (antecedentes/) - no versionado, ver .gitignore
```

### Patrón de acceso a datos
No hay ORM: `global.db` es un pool `mysql2` asignado en `index.js` y usado directamente en los controllers con `global.db.query(sql, params, callback)` (estilo callback, no promesas).

### Auth y permisos
- Login por **email** (no username) + password (bcrypt) → JWT (`JWT_SECRET`, expira 8h). Payload: `{ id, email, rol, nombre_completo }`.
- 3 roles: `reclutador`, `seleccion`, `administrador`. `administrador` tiene todos los permisos (`usuario.model.js: getPermisosRol`):
  `ver_dashboard, ver_estadisticas, ver_candidatos, crear_candidatos, editar_candidatos, eliminar_candidatos, ver_usuarios, crear_usuarios, editar_usuarios, eliminar_usuarios, ver_reportes, agendar_entrevistas, reenviar_emails`.
- Middleware: `verificarToken` (valida JWT + que el usuario siga `activo` en BD), `verificarRol(...roles)` (whitelist de roles), `verificarPermiso(permiso)` (chequea contra `getPermisosRol`).
- `seleccion.routes.js` define sus propios middlewares inline (`verificarRolSeleccion`, `verificarRolLectura`) en vez de usar `verificarRol`/`verificarPermiso` del middleware compartido — inconsistencia a tener en cuenta.

### Base de datos (`noviembrehidra`)
Tablas clave: `hyd_usuarios`, `hyd_candidatos` (+ tablas de oleadas/evaluación usadas por `seleccion.controller.js`), y desde 2026-08-18 las 6 tablas del formulario emailado al candidato: `hyd_candidato_datos_basicos`, `hyd_candidato_estudios`, `hyd_candidato_experiencia`, `hyd_candidato_experiencia_resumen`, `hyd_candidato_personal`, `hyd_candidato_consentimiento` (ver `claude/plan.md`, sección "Sesión 2026-08-18").

✅ **Columnas nuevas en `hyd_candidatos` (2026-08-21, migraciones 009-011, aplicadas solo en local, pendientes en producción):** `motivo_inasistencia VARCHAR(150)` (catálogo de 12 valores + texto libre, obligatorio al marcar "No asistió", ver `claude/lastcontext.md`), y el bloque de Antecedentes: `antecedentes_adres/pol/comp/procu` (`ENUM('aprobado','novedad')`), `antecedentes_documento`/`antecedentes_documento_nombre` (documento compartido, en transición a 4 documentos independientes — ver `claude/lastcontext.md` §5) y `fecha_antecedentes`. También índice `idx_citacion_created_id (fecha_citacion_entrevista, created_at, id)` para paginar "Candidatos" de Selección.

✅ **Generación de PDF de la hoja de vida (2026-08-21/24):** `services/hojaVidaPdfService.js` +
`services/tratamientoDatosPdfService.js` (no listados en el árbol de arriba) llenan
`plantilla/hojavida.pdf`/`plantilla/AUTORIZACIÓN TRATAMIENTO DE DATOS -BOG 1111.pdf` con `pdf-lib`,
usando helpers compartidos en `utils/pdfFillHelpers.js` (`drawFit`/`drawTextBox` con auto-ajuste de
tamaño de fuente, `getTableBorders`/`getRowColumnBorders` para leer bordes reales de celda vía
`pdfjs-dist`). La hoja de vida pasó de Helvetica a Times New Roman esta sesión; el de tratamiento
de datos sigue en Helvetica. Detalle completo en `claude/lastcontext.md`.

⚠️ **Dato histórico inconsistente encontrado (2026-08-21, no corregido):** 17 candidatos tienen `asistio_citacion = 'asistio'` pero `estado = 'nuevo'` — remanente del reseteo masivo de `estado` del 2026-08-13 (mismo incidente documentado abajo: el reseteo pisó `estado` a `'nuevo'` para todos, pero `asistio_citacion` sobrevivió intacto de antes). No es un bug del código actual — `marcarAsistencia` sí fija `estado='entrevistado'` correctamente hoy, verificado varias veces. Pendiente decidir con el usuario si se corrige con un `UPDATE` puntual.

✅ **Normalización del formulario de candidato (2026-08-18):** los datos que antes vivían como ~37 columnas sueltas en `hyd_candidatos` (formulario de 6 pasos que se envía por email al candidato) se movieron a las 6 tablas nuevas de arriba, todas con FK real `candidato_id → hyd_candidatos(id) ON DELETE CASCADE` (primeras FKs reales del proyecto). `hyd_candidatos` quedó solo con los datos de "Nuevo Candidato" (los que carga el reclutador), el mecanismo de acceso al link (`token_acceso`, `fecha_vencimiento_token`), la metadata de progreso (`formulario_*_completado`), y el módulo de Selección. `database/migrations/` pasó de 1 a 6 archivos numerados (002-006); la migración 004 (`DROP COLUMN` de las columnas viejas ya migradas) está escrita pero **no aplicada todavía**, a propósito — queda para después de QA completo. Detalle completo del diseño, backfill y refactor de backend/frontend en `claude/plan.md`.

✅ **Corregido (2026-08-13):** la tabla `hyd_usuarios` en la BD local no tenía `id` como `PRIMARY KEY`/`AUTO_INCREMENT` (todas las columnas eran `text`/`int` sueltas, sin constraints) — desalineada de producción, que sí tiene `id INT PK AUTO_INCREMENT`, `email VARCHAR(255) UNIQUE`, `rol ENUM(...)`, `activo TINYINT(1)`, confirmado con `DESCRIBE hyd_usuarios` en producción. Se corrigió con `ALTER TABLE` para igualar tipos, PK/AUTO_INCREMENT, `UNIQUE(email)` e índices en `rol`/`activo`, sin pérdida de datos (17 filas existentes, ids 1-19 preservados, `AUTO_INCREMENT` reiniciado en 20). Antes de este fix, cualquier INSERT sin `id` explícito (incluyendo crear reclutadores/usuarios desde la app) dejaba la fila con `id NULL`, rompiendo login y cualquier lógica dependiente de `usuario.id`.

✅ **`hyd_oleadas` corregida y verificada contra producción (2026-08-13):** estaba corrupta (columnas con nombres literales de fragmentos JSON, causado por una importación defectuosa); fue reconstruida con el esquema de `database/migracion_completa_seleccion.sql` y luego ajustada para calzar exacto con el `DESCRIBE hyd_oleadas` real de producción que pasó el usuario — se eliminó una `UNIQUE KEY(numero_oleada, operacion, campana)` que se había agregado de más (producción solo tiene índices simples `MUL` en esas columnas, no una restricción única compuesta). La versión corrupta quedó respaldada como `hyd_oleadas_backup_corrupto`.

✅ **`hyd_candidatos` corregida y verificada contra producción (2026-08-13):** comparada campo por campo contra `DESCRIBE hyd_candidatos` de producción. Diferencias encontradas y corregidas:
- `estado`: era `int` (todo en 0, luego resembrado a mitad 1/mitad 0 como placeholder) → ahora `ENUM('nuevo','contacto_fallido','no_contesta','reagendar','no_interesado','numero_incorrecto','contacto_exitoso','formularios_enviados','formularios_completados','citado','no_asistio','entrevistado','aprobado','rechazado','aprobado_final','rechazado_final','contratado')` DEFAULT `'nuevo'`, indexado. **17 estados reales**, no los 15 que documenta `database/SCHEMA_DOCUMENTATION.md` (le faltan `aprobado_final` y `rechazado_final` — ese doc está desactualizado). Los 7857 candidatos quedaron en `'nuevo'` (decisión del usuario, en vez de repartirlos entre estados).
- `asistio_citacion`: era `varchar(20)` → ahora `ENUM('pendiente','asistio','no_asistio')` DEFAULT `'pendiente'`, indexado.
- `consentimiento_aceptado` y los 6 `formulario_*_completado`: `DEFAULT NULL` → `DEFAULT 0`.
- Índices agregados: `reclutador_id`, `oleada_seleccion_id`, `aprobacion_final`.

`reclutador_id`/`oleada_seleccion_id` en `hyd_candidatos` siguen sin Foreign Key declarada — no verificado aún si producción realmente las tiene (el `DESCRIBE` no lo distingue de un índice simple; haría falta `SHOW CREATE TABLE` de producción para confirmarlo). Las 6 tablas nuevas del formulario de candidato (2026-08-18) sí declaran FK real (`candidato_id → hyd_candidatos(id) ON DELETE CASCADE`) — primeras FKs reales del proyecto.

**Nota de proceso:** para alinear cualquier tabla local con producción, pedir al usuario el `DESCRIBE <tabla>;` corrido directamente en producción — es la fuente de verdad, más confiable que los `.sql` del repo (que ya demostraron estar desactualizados/divergentes en `hyd_usuarios` y `hyd_oleadas`).

### Usuario admin de prueba (local)
- Email: `admin@local.com`
- Password: `123456`
- Rol: `administrador`
- id: 19

### ✅ Bug de código corregido: rutas de formularios de candidato perdían el `this` (2026-08-13)
`candidato.routes.js` registraba los 6 endpoints de formularios públicos (`actualizarHojaVida`, `actualizarDatosBasicos`, `actualizarEstudios`, `actualizarExperiencia`, `actualizarPersonal`, `actualizarConsentimiento`) pasando el método directo del controller (`candidatoController.actualizarHojaVida`) sin bindear. Como esos 6 métodos son los únicos que internamente llaman a `this._verificarAccesoFormulario(...)` (helper privado del controller, línea 446), al perder el `this` explotaban con `Cannot read properties of undefined (reading '_verificarAccesoFormulario')` — el resto de endpoints del mismo controller nunca usan `this.` así que nunca mostraron el bug. Corregido agregando `.bind(candidatoController)` a esos 6 registros de ruta. Verificado con request real.

### 🔁 Comportamiento esperado (no bug) que causó confusión repetida: los tokens de candidato rotan en cada reenvío
Cada vez que se llama `reenviarEmail` (botón "reenviar formulario" en el frontend) sobre un candidato, se genera un `token_acceso` **nuevo** y se invalida el anterior — es intencional (para que solo el último link enviado funcione). Si se reenvía el correo más de una vez sobre el mismo candidato, cualquier link viejo (guardado, copiado, o de un correo anterior) deja de servir y da `404 Token inválido o expirado`. Al probar en local, siempre usar el link del **último** correo/reenvío, no uno guardado de antes.

### 🔥 Incidente de producción resuelto: sitio inaccesible por firewall (`ufw`), no por nginx/backend (2026-08-13/14)
Producción (`200.91.204.54`) daba timeout total (ni frontend puerto 80 ni backend puerto 3000 respondían desde internet). Diagnóstico: nginx y el proceso node (`hidra-backend` vía PM2) estaban perfectamente sanos y escuchando (`nginx -t` ok, `ss -tlnp` mostraba ambos puertos escuchando en `0.0.0.0`) — el problema era el firewall del servidor (`ufw`), que solo tenía reglas de entrada para `22/tcp` (SSH) y `3306/tcp` (MySQL), **nada para `80` ni `3000`**. Se corrigió con:
```bash
sudo ufw allow 80/tcp
sudo ufw allow 3000/tcp
```
Verificado con `curl` externo → ambos responden `200 OK` después del cambio.

⚠️ **Pendiente de seguridad, no resuelto:** el puerto `3306` (MySQL) está abierto a `Anywhere` en `ufw` — la base de datos de producción es alcanzable desde cualquier IP de internet, no solo localmente. Recomendado: `sudo ufw delete allow 3306/tcp` y, si se necesita acceso remoto real, restringirlo a IPs específicas (`sudo ufw allow from <IP> to any port 3306`).

## Frontend — estructura

```
src/
  main.jsx / App.jsx        # rutas (react-router-dom v7), todas envueltas en <AuthProvider>
  context/AuthContext.jsx   # estado de auth global (useReducer), login/logout, hasPermission(), isRole()
  services/api.js           # cliente fetch a la API (ApiService), maneja 401 global (borra sesión y redirige)
  components/
    auth/        Login.jsx, ProtectedRoute.jsx, RoleRedirect.jsx
    admin/       AdminSidebar.jsx, GestionReclutadores.jsx
    reclutador/  Dashboard.jsx, Estadisticas.jsx, ListaCandidatos.jsx, CandidatosTotal.jsx,
                 NuevoCandidato.jsx, EditarCandidato.jsx, PerfilCandidato.jsx, Sidebar.jsx
    seleccion/   CandidatosSeleccion.jsx, EvaluacionEntrevista.jsx, GestionUsuarios.jsx,
                 PerfilesAprobados.jsx, PerfilesRechazados.jsx, SidebarSeleccion.jsx
    candidato/   HojaVida.jsx, DatosBasicos.jsx, Estudios.jsx, Experiencia.jsx, Personal.jsx,
                 Consentimiento.jsx   (formularios públicos, acceso por token en URL, sin login)
    desprendibles/ DesprendiblesPage.jsx
```

### Ruteo y control de acceso
- `RoleRedirect.jsx`: al entrar a `/`, redirige según `user.rol`:
  `administrador → /hydra/admin/reclutadores`, `seleccion → /hydra/seleccion/candidatos`, `reclutador (default) → /hydra/reclutador/dashboard`.
- `ProtectedRoute.jsx` acepta `permission` (usa `hasPermission`) o `roles` (usa `isRole`, ver `App.jsx`).
- API base URL: `import.meta.env.DEV ? 'http://localhost:3000/api' : 'http://200.91.204.54:3000/api'` (hardcoded, no variable de entorno de Vite).

### ⚠️ Gap conocido: menú del admin incompleto
`AdminSidebar.jsx` tiene un array `menuItems` **hardcodeado** con solo 2 entradas (Gestión de Reclutadores, Desprendibles), no generado a partir de `user.permisos`. El backend sí le da al rol `administrador` todos los permisos y las rutas de `App.jsx` sí lo dejarían entrar a Dashboard/Candidatos/Estadísticas/Gestión de Usuarios (rutas ya cubren `administrador` en sus `roles={[...]}`), pero no hay links en el sidebar que apunten ahí — por eso el admin solo ve 2 opciones en el menú lateral pese a tener todos los permisos. Pendiente: ampliar `menuItems` en `AdminSidebar.jsx` con las rutas faltantes.

Otros archivos notables: `NuevoCandidato_clean.jsx` en `components/reclutador/` parece una copia/variante de `NuevoCandidato.jsx` sin usar en `App.jsx` — revisar si es código muerto.

## Endpoints principales (backend)

| Router | Base | Notas |
|---|---|---|
| `auth.routes.js` | `/api/auth` | login, logout, verificar-token, cambiar-password, CRUD usuarios/reclutadores (admin), CRUD usuarios desde rol selección |
| `candidato.routes.js` | `/api/candidato` | catálogos y validación de token públicos; CRUD candidato y analytics protegidos por permiso; formularios públicos por token (hoja de vida, datos básicos, estudios, experiencia, personal, consentimiento) |
| `seleccion.routes.js` | `/api/seleccion` | candidatos citados/aprobados/rechazados, oleadas, estadísticas, asistencia, evaluación, decisión final |
| `desprendibles.routes.js` | `/api/desprendibles` | meses disponibles y descarga de PDF de desprendible de nómina (vía API externa IntraCar) |

## Notas operativas
- El backend expone `GET /api/health` para chequeo rápido.
- CORS habilitado solo para `http://localhost:5173/5174/5175` y `http://200.91.204.54` (IP de producción).
- Los formularios de candidato (`/candidato/*` en frontend) son rutas públicas basadas en token, no requieren login.
