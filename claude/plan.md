# Plan: normalizar el formulario de candidato y evolucionar la arquitectura

## ✅ Estado (2026-08-18): normalización EJECUTADA, diseño final distinto al borrador de abajo

El borrador de la sección "Diseño propuesto" (justo abajo) quedó **superado por la implementación real**,
hecha después de revisar el Excel oficial (`Downloads/FORMATO HOJA DE VIDA.xlsx`, hoja "HOJA DE VIDA E
INFORME DE SELEC" v3.0). Se dejan las secciones viejas como registro histórico de cómo evolucionó el
diseño, pero el estado actual y autoritativo está en **"Sesión 2026-08-18: normalización ejecutada contra
el Excel oficial"**, al final de este archivo. Resumen de lo que cambió respecto al borrador:
- 6 tablas nuevas, no 5 (se agregó `hyd_candidato_experiencia_resumen`).
- `hyd_candidato_estudios` y `hyd_candidato_experiencia` son **1:N reales**, no 1:1 (decisión tomada al
  ver que el Excel pide varios niveles académicos y hasta 3 empresas).
- El diseño se amplió para cubrir campos del Excel que el sistema nunca capturó (aspiración salarial,
  dirección/barrio/talla de camisa, funciones, reintegros con Asiste ING, genograma, metas, estado de
  salud) — no solo replicar lo que ya existía.
- El backend y el frontend de los 6 pasos **ya fueron refactorizados** para usar las tablas nuevas, no
  solo la base de datos.

## Veredicto rápido

**Sí, es viable.** Verificado contra la BD local (`noviembrehidra`, 7859 filas en `hyd_candidatos`, 89 columnas) el 2026-08-14. El patrón que describiste se confirma: hay un bloque de ~40 columnas que corresponde al formulario de 6 pasos que se le envía al candidato por email (link con `token_acceso`), y salvo 2-3 candidatos que lo completaron en esta BD local, el resto está en `NULL`.

✅ Confirmado por el usuario (2026-08-14): la BD local es igual a producción — todos los registros salvo uno tienen esas columnas en `NULL` también en producción. Se elimina el paso de re-verificación contra producción que tenía este plan antes; se procede directo con el diseño y la migración.

📎 **Pendiente antes de fijar el diseño final de columnas**: el usuario va a pasar el formulario real en PDF para confirmar campos exactos, tipos de dato, opciones de catálogo (listas desplegables) y si hay campos que hoy no están mapeados 1:1 en `hyd_candidatos` (o viceversa, columnas actuales que ya no aplican). El diseño de tablas de la sección siguiente es un **borrador basado en el código actual** (`candidato.controller.js` + los 6 componentes del frontend) — se ajusta en cuanto llegue el PDF, antes de escribir cualquier `CREATE TABLE` definitivo.

## Lo que se verificó en la BD local

Script ad-hoc (`INFORMATION_SCHEMA.COLUMNS` + `COUNT(*) WHERE col IS NULL` por columna) contra `hyd_candidatos`:

- Total filas: **7859**
- Columnas base (siempre o casi siempre llenas): `id, primer_nombre, primer_apellido, email_personal, numero_celular, nacionalidad, tipo_documento, cliente, cargo, oleada, ciudad, fuente_reclutamiento, token_acceso, fecha_vencimiento_token, estado, created_at, updated_at, reclutador_id` — estas **no se tocan**.
- `numero_documento`: 3111 `NULL` de 7859 — dato base que el reclutador no siempre carga al crear el candidato, **no** es parte del formulario emailado, no se toca.
- **Bloque del formulario de 6 pasos** (ver detalle abajo, incluye `estado_civil`): entre 7856 y 7859 filas en `NULL` por columna, solo 1-3 candidatos con datos reales. Esto es justo el patrón que describiste. Confirmado con el usuario (2026-08-14): se elimina completo, incluyendo `estado_civil` (quedó fuera de la lista que pasaste por un olvido).
- **4 columnas 100% muertas** (7859/7859 `NULL`, cero referencias en el código de `hidrabackend` ni de `hidrafrontend`): `genograma`, `metas_largo_plazo`, `metas_mediano_plazo`, `metas_corto_plazo`. No pertenecen a ningún endpoint de los 6 pasos del formulario — parecen residuo de un diseño que nunca se conectó al frontend. Se eliminan directo, sin migrar (no hay nada que migrar).
- Fuera de alcance de este plan (pertenecen al módulo interno de selección/evaluación, no al formulario emailado): `evaluacion_*`, `aprobacion_final*`, `psicologo_decision_id`, `fecha_evaluacion`, `asistio_citacion`, `fecha_asistencia`, `observaciones_seleccion`. Se podrían normalizar con la misma lógica en una fase futura, pero no es lo que pediste ahora.
- 🔎 **Hallazgo aparte, para tener en cuenta después (no bloquea este plan)**: al revisar `evaluacion_total`/`evaluacion_aprobado` para confirmar que de verdad eran sparse, encontré que 7843 de 7859 filas tienen `evaluacion_total = 0.00` y `evaluacion_aprobado = 0` — no es `NULL`, es un valor placeholder. Solo ~16 filas tienen puntajes reales (coincide con las ~17 que sí tienen `fecha_asistencia`). Mismo patrón que el bug ya documentado de `estado` (reseteado a `0` en una importación defectuosa, ver `claude/context.md`) — probablemente estas columnas también quedaron "reseteadas" en vez de `NULL`. No es parte del alcance de este plan (es del módulo de selección, no del formulario), pero lo anoto para revisarlo cuando se toque esa tabla.

## El formulario: 6 pasos, mapeados exactamente desde el código

Confirmado en `controllers/candidato.controller.js` (endpoints `actualizarHojaVida`, `actualizarDatosBasicos`, `actualizarEstudios`, `actualizarExperiencia`, `actualizarPersonal`, `actualizarConsentimiento`, líneas 458-696) y en `hidrafrontend/src/components/candidato/*.jsx` (mismos 6 pasos: `HojaVida`, `DatosBasicos`, `Estudios`, `Experiencia`, `Personal`, `Consentimiento`).

| Paso | Columnas actuales en `hyd_candidatos` | No-nulas (local) |
|---|---|---|
| 1. Hoja de vida | `estado_civil` | 3 |
| 2. Datos básicos | `segundo_apellido, segundo_nombre, genero, fecha_nacimiento, grupo_sanguineo, eps, afp, nombre_emergencia, numero_emergencia, parentesco_emergencia` | 2 |
| 3. Estudios | `nivel_estudios, titulo_obtenido, nombre_institucion, ano_finalizacion` | 2 |
| 4. Experiencia | `nombre_empresa, cargo_desempenado, salario_experiencia, fecha_inicio_experiencia, fecha_retiro_experiencia, tiempo_laborado_anos, tiempo_laborado_meses, motivo_retiro, ha_trabajado_asiste, experiencia_comercial_certificada, experiencia_comercial_no_certificada, primer_empleo_formal` | 1-2 |
| 5. Personal | `fortalezas, aspectos_mejorar, competencias_laborales, conocimiento_excel, conocimiento_powerpoint, conocimiento_word, autoevaluacion` | 2 |
| 6. Consentimiento | `ciudad_consentimiento, dia_consentimiento, mes_consentimiento, ano_consentimiento, consentimiento_aceptado` | 2 |

Cada paso además tiene su propio `formulario_<paso>_completado` (tinyint, default 0) y `fecha_completado_<paso>` (timestamp) — 12 columnas de "metadata de progreso" que **no** se mueven (ver más abajo, por qué conviene dejarlas donde están).

## Diseño propuesto (borrador — sujeto al PDF): 5 tablas nuevas (1:1 con `hyd_candidatos`)

El paso 1 (Hoja de vida) queda fusionado dentro de `hyd_candidato_datos_basicos` porque es una sola columna (`estado_civil`) — no amerita tabla propia.

```sql
CREATE TABLE hyd_candidato_datos_basicos (
  candidato_id INT PRIMARY KEY,
  estado_civil varchar(50),
  segundo_apellido varchar(100),
  segundo_nombre varchar(100),
  genero varchar(20),
  fecha_nacimiento date,
  grupo_sanguineo varchar(10),
  eps varchar(100),
  afp varchar(100),
  nombre_emergencia varchar(100),
  numero_emergencia varchar(20),
  parentesco_emergencia varchar(50),
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidato_id) REFERENCES hyd_candidatos(id) ON DELETE CASCADE
);

CREATE TABLE hyd_candidato_estudios (
  candidato_id INT PRIMARY KEY,
  nivel_estudios varchar(50),
  titulo_obtenido varchar(200),
  nombre_institucion varchar(200),
  ano_finalizacion year,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidato_id) REFERENCES hyd_candidatos(id) ON DELETE CASCADE
);

CREATE TABLE hyd_candidato_experiencia (
  candidato_id INT PRIMARY KEY,
  nombre_empresa varchar(200),
  cargo_desempenado varchar(100),
  salario_experiencia decimal(15,2),
  fecha_inicio_experiencia date,
  fecha_retiro_experiencia date,
  tiempo_laborado_anos int,
  tiempo_laborado_meses int,
  motivo_retiro text,
  ha_trabajado_asiste varchar(10),
  experiencia_comercial_certificada varchar(10),
  experiencia_comercial_no_certificada varchar(10),
  primer_empleo_formal varchar(10),
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidato_id) REFERENCES hyd_candidatos(id) ON DELETE CASCADE
);

CREATE TABLE hyd_candidato_personal (
  candidato_id INT PRIMARY KEY,
  fortalezas text,
  aspectos_mejorar text,
  competencias_laborales text,
  conocimiento_excel int,
  conocimiento_powerpoint int,
  conocimiento_word int,
  autoevaluacion int,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidato_id) REFERENCES hyd_candidatos(id) ON DELETE CASCADE
);

CREATE TABLE hyd_candidato_consentimiento (
  candidato_id INT PRIMARY KEY,
  ciudad_consentimiento varchar(100),
  dia_consentimiento int,
  mes_consentimiento int,
  ano_consentimiento year,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidato_id) REFERENCES hyd_candidatos(id) ON DELETE CASCADE
);
```

Nota de diseño: es la **primera vez** que se declaran Foreign Keys reales en este proyecto (hoy `reclutador_id`/`oleada_seleccion_id` son enteros sueltos sin FK — ver `claude/arquitectura-y-bugs.md`, bug #9). Aquí sí conviene declararla porque es una relación 1:1 estricta y de borrado en cascada correcto (si se elimina un candidato, sus datos de formulario no deben quedar huérfanos).

### Qué se queda en `hyd_candidatos` y por qué (confirmado con el usuario, 2026-08-14)

- Los 6 `formulario_<paso>_completado` y 6 `fecha_completado_<paso>` **no se mueven**. Son booleans/timestamps baratos, siempre no-nulos (`DEFAULT 0`), y los usa `CandidatoModel.calcularProgreso()` (`models/candidato.model.js:252`) para el indicador de progreso (0-6) que se muestra en listas/dashboard sin necesitar ningún JOIN. Moverlos obligaría a 6 JOINs (o subconsultas) solo para pintar una lista de candidatos — mal trade-off para el beneficio que da, y el usuario confirmó dejarlas donde están.
- `token_acceso`, `fecha_vencimiento_token`, `consentimiento_aceptado`: se quedan, son mecanismo de acceso/seguridad del link, no datos del formulario en sí.

### Columnas que salen de `hyd_candidatos` (lista final confirmada)

**A) Se migran a las 5 tablas nuevas** (tienen datos reales en 1-3 candidatos, hay que preservarlos con `INSERT ... SELECT` antes del `DROP`):

`estado_civil, segundo_apellido, segundo_nombre, genero, fecha_nacimiento, grupo_sanguineo, nombre_emergencia, numero_emergencia, parentesco_emergencia, eps, afp, nivel_estudios, titulo_obtenido, nombre_institucion, ano_finalizacion, nombre_empresa, cargo_desempenado, salario_experiencia, fecha_inicio_experiencia, fecha_retiro_experiencia, tiempo_laborado_anos, tiempo_laborado_meses, motivo_retiro, ha_trabajado_asiste, fortalezas, aspectos_mejorar, competencias_laborales, conocimiento_excel, conocimiento_powerpoint, conocimiento_word, autoevaluacion, experiencia_comercial_certificada, experiencia_comercial_no_certificada, primer_empleo_formal, ciudad_consentimiento, dia_consentimiento, mes_consentimiento, ano_consentimiento`

(`consentimiento_aceptado` se queda, ver arriba — es el flag de aceptación, no un dato del formulario en sí.)

**B) Se eliminan directo, sin migrar** (100% `NULL`, cero referencias en `hidrabackend` ni `hidrafrontend`): `genograma, metas_largo_plazo, metas_mediano_plazo, metas_corto_plazo`.

Local = producción (confirmado por el usuario), así que ambos grupos se eliminan en la misma migración, sin paso adicional de verificación contra producción.

---

## Evolución de arquitectura: monolito modular, en capas, con límites de dominio inspirados en microservicios

⚠️ **Aclaración del usuario (2026-08-14), corrige una lectura anterior de este plan**: no se van a crear microservicios reales (no hay servicios separados, ni bases de datos separadas, ni despliegues independientes). Sigue siendo **un solo monolito, un solo proceso, un solo repo backend, una sola base de datos**. Lo que cambia es que, *dentro* de ese monolito, el código se organiza en **capas** y en **módulos con límites de dominio estrictos** — aplicando principios que vienen del mundo de microservicios (dueño único de cada tabla, contrato explícito de entrada/salida por módulo, nada de acceso cruzado directo a las tablas de otro módulo) pero sin pagar el costo operativo de separar servicios de verdad. Es, en una frase, un **monolito modular en capas, diseñado con disciplina de microservicios**.

Este desarrollo (extraer el formulario de candidato a tablas propias) se usa como **piloto**: es el primer módulo del sistema que se construye desde cero con las capas y prácticas nuevas, y sirve de referencia para migrar el resto del sistema después. No se reescribe todo de una vez.

### Diagnóstico de partida (ya documentado en `claude/arquitectura-y-bugs.md`)

Monolito de 2 piezas (backend + frontend), sin ORM, sin capa de servicio/repositorio (`global.db.query(...)` directo dentro de los controllers), sin FKs reales, sin tests, sin CI/CD, sin sistema de migraciones versionado (`database/` tiene ~15 `.sql` sueltos sin numerar). Producción corre en un único proceso Node (PM2) en un VPS, con el puerto MySQL (3306) abierto a `Anywhere` en el firewall — hallazgo de seguridad ya pendiente.

### 1. Arquitectura en capas (dentro de cada servicio)

Reemplaza el patrón actual "route → controller con SQL inline" por capas con responsabilidad única y contrato explícito entre ellas:

```
routes/          → define el endpoint HTTP, valida auth/permiso, delega
controllers/      → traduce HTTP ↔ dominio (parsea request, arma response), sin SQL
services/         → lógica de negocio pura (reglas del formulario, transiciones de estado, envío de notificación de completado)
repositories/     → único lugar que conoce SQL/tablas de un dominio (p. ej. `candidatoFormularioRepository`)
```

- **Validación en el borde**: los 6 endpoints hoy validan "todos los campos requeridos" a mano dentro del controller; pasa a un schema declarativo (`zod` o `joi`) por paso de formulario, reutilizable entre capas y fácil de mantener sincronizado con el PDF una vez lo definamos.
- **DTOs explícitos** entre capas en vez de pasar filas de MySQL tal cual hacia el frontend (hoy `getPerfilCompleto` hace `SELECT *` y devuelve la fila cruda) — así un cambio de columna interna no rompe el contrato con el frontend.

### 2. Módulos con límites de dominio (el "basado en microservicios" del monolito)

Los límites de dominio ya son visibles en el código actual — son la base natural para organizar el monolito en módulos, cada uno dueño exclusivo de sus tablas (nadie fuera del módulo hace SQL directo sobre ellas):

| Módulo | Hoy vive en | Datos propios |
|---|---|---|
| **Identidad** (auth, usuarios, roles/permisos) | `auth.controller.js`, `usuario.model.js` | `hyd_usuarios` |
| **Candidatos y formulario** (éste desarrollo) | `candidato.controller.js` | `hyd_candidatos` + las 5 tablas nuevas |
| **Selección y evaluación** (citas, oleadas, entrevistas, decisión final) | `seleccion.controller.js` | `hyd_oleadas`, columnas `evaluacion_*`/`aprobacion_final*` de `hyd_candidatos` |
| **Nómina/desprendibles** (ya envuelve una API externa — IntraCar) | `desprendibles.controller.js` | ninguna tabla propia hoy, solo proxy a la API externa |

Estructura de carpetas propuesta, dentro del mismo repo/proceso (`modules/candidatos-formulario`, `modules/seleccion`, `modules/identidad`, `modules/nomina`, cada uno con sus propias `routes/ controllers/ services/ repositories/` internas). Este desarrollo implementa primero el módulo de **candidatos/formulario** con esta estructura, como piloto; el resto se migra después, de forma incremental, sin big-bang.

Nota para el futuro (no es un plan, solo una observación): si el día de mañana el negocio realmente necesita escalar o desplegar un módulo por separado, tener los límites de dominio ya claros desde el código hace esa extracción mucho más barata — pero eso no es lo que se está pidiendo ni planeando ahora.

### 3. Consistencia de datos

- Toda la lógica sigue sobre **una sola base de datos MySQL** — se usan transacciones ACID normales y FKs reales para la integridad. El diseño de las 5 tablas nuevas ya declara FKs (primera vez en el proyecto, ver nota más abajo).
- **Ownership estricto por módulo**: cada tabla tiene un único módulo dueño que la escribe (a través de su capa de repositorio); el resto del código la lee/escribe solo llamando a las funciones de servicio de ese módulo, nunca hacienda SQL directo sobre tablas ajenas — esto es lo que rompe hoy (todo controller toca `hyd_candidatos` sin pasar por un dueño único).
- **Comunicación entre módulos, en proceso**: cuando un módulo necesita reaccionar a algo de otro (p. ej. selección necesita enterarse de que el formulario se completó), se hace con una llamada directa a la función de servicio del módulo dueño (todo vive en el mismo proceso, no hace falta cola de mensajes ni eventos distribuidos) o, si conviene desacoplar el código, con un emisor de eventos en memoria (`EventEmitter` de Node) dentro del mismo proceso — nunca escribiendo directo en la tabla del otro módulo.

### 4. Disponibilidad

- **Estado actual**: proceso único Node + PM2, `GET /api/health` como único health check, sin retries/timeouts explícitos hacia la API externa de nómina (IntraCar) — si esa API está lenta o caída, `desprendibles.controller.js` puede colgar la request sin un timeout propio.
- **A incorporar según se avance**: timeouts + reintentos con backoff en toda llamada saliente a una API externa (nómina/IntraCar); manejo de errores por módulo que evite que una falla en un módulo periférico (p. ej. nómina) tumbe todo el proceso (try/catch consistente, sin dejar que una excepción no capturada mate a Node entero).
- **Migraciones versionadas** (deuda ya documentada, bug #12): bloqueante real para evolucionar el esquema con seguridad y sin downtime — se resuelve como parte de este mismo desarrollo, numerando esta migración como la primera del sistema (ver Fase de ejecución más abajo).

### 5. Seguridad de los datos nuevos y existentes

- **Datos sensibles de candidato** (documento de identidad, fecha de nacimiento, contacto de emergencia, salario, género, grupo sanguíneo) son PII/datos sensibles bajo cualquier criterio razonable de protección de datos personales — evaluar cifrado a nivel de columna o at-rest para los campos más sensibles, y confirmar que la conexión de la app a MySQL en producción usa TLS.
- **Mínimo privilegio en la BD**: el `.env` local usa `root` sin password — confirmar que producción usa un usuario de aplicación dedicado con permisos acotados solo a las tablas que necesita (no `root`), y crear uno nuevo con permisos sobre las tablas nuevas si aplica.
- **Cerrar el hallazgo ya pendiente**: puerto 3306 abierto a `Anywhere` en el firewall de producción (`claude/context.md`) — corregirlo junto con esta migración, no después; es la misma superficie de ataque que expondría también las tablas nuevas.
- **Validación de entrada formal** por paso de formulario (ver capa de servicio arriba) en vez de checks sueltos de "campo no vacío" — reduce el riesgo de datos corruptos o inyección en columnas de texto libre (`motivo_retiro`, `fortalezas`, etc.).
- **FKs + `ON DELETE CASCADE`** en las tablas nuevas evitan filas huérfanas si se elimina un candidato — hoy la integridad referencial depende 100% de que el código no falle.

---

## Fases de ejecución (actualizado)

0. **Recibir el PDF del formulario** — ajustar el diseño de columnas/tipos/catálogos de la sección anterior contra el formulario real antes de escribir el `CREATE TABLE` definitivo.
1. **Crear las tablas nuevas** (aditivo, sin tocar `hyd_candidatos`, cero riesgo) con FKs reales — primera migración numerada formalmente en `database/` (arranca a resolver la deuda de "sin sistema de migraciones versionado").
2. **Backfill**: migrar los pocos candidatos que ya tienen datos del bloque de formulario hacia las tablas nuevas.
3. **Refactor a capas dentro del módulo de candidatos/formulario**: introducir `services/` y `repositories/` para este dominio (piloto de la arquitectura en capas, sin tocar todavía el resto del sistema). Los 6 endpoints pasan a escribir en las tablas nuevas vía repositorio; `getPerfilCompleto` pasa a `LEFT JOIN` (o a componer la respuesta vía el repositorio) manteniendo el mismo shape de respuesta que consume el frontend hoy.
4. **Endurecer seguridad de la BD en paralelo**: confirmar/crear usuario de aplicación de mínimo privilegio, cerrar el puerto 3306 a `Anywhere`, confirmar TLS en la conexión — no depende del resto de fases, se puede hacer ya.
5. **QA manual** end-to-end: reenviar formulario a un candidato de prueba, completar los 6 pasos desde el frontend, confirmar que persiste igual que hoy y que el perfil/progreso se ve igual.
6. **Drop de columnas** en `hyd_candidatos`: el grupo A (migrado a las 5 tablas nuevas) + el grupo B (`genograma`, `metas_*`, muertas).
7. **Actualizar documentación**: regenerar `database/SCHEMA_DOCUMENTATION.md` completo, y documentar el módulo nuevo (`modules/candidatos-formulario`) como referencia de patrón para migrar `seleccion`/`identidad`/`nomina` a la misma estructura en capas más adelante, dentro del mismo monolito.

## Decisiones ya confirmadas (2026-08-14)

- `estado_civil` se elimina junto con el resto del bloque del formulario (era un olvido en la lista original).
- Los 12 campos de tracking (`formulario_*_completado`, `fecha_completado_*`) **se quedan** en `hyd_candidatos`.
- La arquitectura es un **monolito modular en capas**, no microservicios reales — un solo proceso, un solo repo, una sola base de datos, organizados con límites de dominio estrictos por módulo.
- Local = producción en cuanto al patrón de columnas nulas — no hace falta re-verificar en producción antes de migrar.

## Preguntas abiertas para decidir antes de escribir código (normalización del formulario emailado)

- Falta el **PDF del formulario** — en cuanto llegue, confirmamos campos/tipos/catálogos exactos y cierro el diseño de tablas.
- ¿El alcance de este desarrollo es hacer el piloto completo (Fase 3: estructurar el módulo `candidatos-formulario` en `services/`+`repositories/`) ya mismo, o preferís primero cerrar solo la parte de BD (Fases 0-2 y 6) y dejar el refactor de capas como una tarea aparte?
- ¿Querés que arranque ya con el endurecimiento de seguridad (Fase 4 — usuario MySQL de mínimo privilegio, cerrar puerto 3306) en paralelo, o lo coordinamos aparte porque toca producción directamente?

---

# Trabajo en curso: formulario "Nuevo Candidato" (intranet) — `BASE RECLUTAMIENTO (2).xlsx`

Iniciativa separada de la normalización de arriba (esa sigue pendiente del PDF). Este bloque documenta el primer desarrollo real que arrancó: actualizar el formulario **"Nuevo Candidato"** que usan los reclutadores en la intranet (`hidrafrontend/src/components/reclutador/NuevoCandidato.jsx`), usando como fuente de verdad `Downloads/BASE RECLUTAMIENTO (2).xlsx`.

## Qué tiene el Excel

Dos hojas: **"BASE "** (plantilla de captura con 1 fila de ejemplo) y **"Hoja1"** (catálogo de valores válidos por columna, usados como listas desplegables en el Excel original). 18 columnas en total, que cubren **todo el embudo de reclutamiento**, no solo el alta inicial:

`FECHA, ANALISTA, CAMPAÑA, CARGO, NOMBRE, TIPO DE DOC, DOCUMENTO, EDAD, CORREO, CONTACTO (LLAMADA/WHATSAPP), ESTADO GESTIÓN RECLUTAMIENTO, PERFIL, SEGUIMIENTO ASISTENCIA (LLAMADA/GLOBAL-WA), ASISTE ENTREVISTA, MOTIVO INASISTENCIA, ANTECEDENTES (ADRES/POL/COMP/PROCU), APROBADO, ¿POR QUÉ NO APROBO?`

## Decisión de alcance (confirmada con el usuario, 2026-08-14)

El formulario **"Nuevo Candidato" solo cubre datos de primer contacto** — lo que el reclutador sabe al momento de registrar al candidato. El resto de columnas del Excel (`ESTADO GESTIÓN RECLUTAMIENTO` detallado con motivos, `PERFIL`, `SEGUIMIENTO ASISTENCIA`, `ASISTE ENTREVISTA`, `MOTIVO INASISTENCIA`, `ANTECEDENTES`, `APROBADO`, `¿POR QUÉ NO APROBO?`) pertenecen a etapas **posteriores** del proceso — quedan **fuera de este desarrollo**, pendientes de planear en pantallas de seguimiento/selección que hoy no existen.

## Mapeo columna Excel → campo del sistema (alcance "Nuevo Candidato")

| Columna Excel | Dónde queda | Detalle |
|---|---|---|
| FECHA | `hyd_candidatos.created_at` | Automático, no es un campo del formulario. |
| ANALISTA | `hyd_candidatos.reclutador_id` | Automático — el usuario logueado que crea el registro. |
| CAMPAÑA | `hyd_candidatos.cliente` | Mismo campo ya existente. Catálogo actualizado de forma **aditiva** (ver abajo). |
| CARGO | `hyd_candidatos.cargo` | Mismo campo ya existente. Catálogo actualizado de forma aditiva. |
| NOMBRE | `hyd_candidatos.primer_nombre` + `primer_apellido` | Ya existían, sin cambios. |
| TIPO DE DOC | `hyd_candidatos.tipo_documento` | Ya existía; se agregó la opción **PPT** (Permiso por Protección Temporal), que faltaba. |
| DOCUMENTO | `hyd_candidatos.numero_documento` | Ya existía, sin cambios. |
| EDAD | `hyd_candidatos.edad` (**columna nueva**, `INT NULL`) | No existía ninguna columna de edad en el sistema. |
| CORREO | `hyd_candidatos.email_personal` | Ya existía, sin cambios. |
| CONTACTO → LLAMADA | `hyd_candidatos.contacto_llamada` (**columna nueva**, `ENUM('si','no') NULL`) | Nuevo — si se logró contactar por llamada. |
| CONTACTO → WHATSAPP | `hyd_candidatos.contacto_whatsapp` (**columna nueva**, `ENUM('si','no') NULL`) | Nuevo — si se logró contactar por WhatsApp. |

**Respuesta a "dónde quedan guardados esos registros": todo sigue en la misma tabla `hyd_candidatos`** (no se creó tabla nueva para esto) — solo se agregaron 3 columnas nuevas (`edad`, `contacto_llamada`, `contacto_whatsapp`) y se ampliaron los catálogos de `cliente` (campaña) y `cargo`, que ya existían.

## Decisión de diseño: catálogos actualizados de forma **aditiva**, no reemplazados

El catálogo actual de `cliente` (Staff Operacional, Staff Administrativo, Claro, Obamacare, Majority) y de `cargo` por cliente son distintos a los del Excel (Hogar, Móvil, TyT, Pymes, Obamacare, ACA, Customer + una lista de 23 cargos). Los 7859 candidatos existentes ya tienen valores del catálogo viejo guardados en `cliente`/`cargo`. **Reemplazar el catálogo en vez de extenderlo habría roto la edición de esos candidatos** (el dropdown ya no tendría su valor actual como opción) sin una regla clara de a qué valor nuevo migrar cada uno. Por eso:

- `clientes`: se agregaron `Hogar, Móvil, TyT, Pymes, ACA, Customer` a la lista existente (`Obamacare` ya estaba). Nada se quitó.
- `cargos`: se agregó el catálogo `cargos_campanas` (23 cargos del Excel) para las 6 campañas nuevas; `cargos_obamacare` se amplió con esos mismos 23 (el Excel no distingue cargos por campaña). Los catálogos `cargos_staff`, `cargos_claro`, `cargos_majority` quedaron intactos.

⚠️ **Supuesto a confirmar con el usuario**: el Excel no diferencia cargos por campaña (una sola lista de 23 para todas). Si en realidad cada campaña nueva debe tener su propio subconjunto de cargos, hay que ajustarlo — es un cambio de datos, no de estructura.

## Qué se ejecutó (2026-08-14)

1. **Migración `database/migrations/001_nuevo_candidato_edad_contacto.sql`** — primera migración numerada formalmente del proyecto (arranca a resolver la deuda de "sin sistema de migraciones versionado", bug #12). Agrega `edad`, `contacto_llamada`, `contacto_whatsapp` a `hyd_candidatos`. **Aplicada en la BD local**, verificada con `INFORMATION_SCHEMA.COLUMNS`. **Pendiente aplicarla en producción** — no se tocó producción.
2. **`models/candidato.model.js`**: catálogo `clientes` ampliado, `tipos_documento_extranjero` con `PPT`, catálogo nuevo `cargos_campanas`, `cargos_obamacare` ampliado.
3. **`controllers/candidato.controller.js` (`crearCandidato`)**: acepta y guarda `edad`, `contacto_llamada`, `contacto_whatsapp`.
4. **`hidrafrontend/.../NuevoCandidato.jsx`**: campo `Edad` (input numérico) en "Datos Principales"; nueva sección "Contacto" con selects Sí/No para llamada y WhatsApp; catálogo de cliente y `getCargosDisponibles()` actualizados con las campañas nuevas (catálogo + fallback hardcodeado si la API de catálogos falla).
5. **`hidrafrontend/.../EditarCandidato.jsx`**: mismo ajuste en `getCargosDisponibles()` — sin esto, editar un candidato creado con una campaña nueva (p. ej. "Hogar") habría mostrado el dropdown de cargo vacío. **No se agregó UI de `edad`/`contacto_*` a este formulario** (fuera del alcance pedido — "Nuevo Candidato"); esos 2-3 campos no son editables todavía después de creados.
6. **Verificado end-to-end**: build de frontend (`npm run build`, sin errores nuevos) + lint (sin errores nuevos) + prueba real contra el backend local (crear candidato vía API con `cliente: "Hogar"`, `cargo: "Agente"`, `edad`, `contacto_llamada`, `contacto_whatsapp`, confirmado en BD, registro de prueba eliminado después).

## Pendiente / fuera de este desarrollo

- Aplicar `database/migrations/001_...sql` en **producción**.
- El resto de columnas del Excel (`ESTADO GESTIÓN RECLUTAMIENTO` detallado, `PERFIL`, `SEGUIMIENTO ASISTENCIA`, `ASISTE ENTREVISTA`, `MOTIVO INASISTENCIA`, `ANTECEDENTES` ADRES/POL/COMP/PROCU, `APROBADO`, `¿POR QUÉ NO APROBO?`) — quedan para planear en una siguiente iteración, en las pantallas de seguimiento/selección correspondientes (no en "Nuevo Candidato").
- Hacer editable `edad`/`contacto_llamada`/`contacto_whatsapp` desde `EditarCandidato.jsx`, si el negocio lo necesita.

## Correcciones del usuario (2026-08-18)

**1. CARGO — faltaban cargos del Excel en varios catálogos.** El catálogo `cargos_campanas` (para las 6 campañas nuevas) ya tenía los 23 cargos completos, pero `cargos_staff`, `cargos_claro` y `cargos_majority` no incluían cargos como `Agente`/`Agente Plus` (venían de antes, con nombres parecidos pero no iguales: `Agente Call Center`, `Staff`, etc.). Corregido en `models/candidato.model.js`: se extrajo el catálogo de 23 cargos a una constante (`CARGOS_BASE_RECLUTAMIENTO`) y ahora **todos** los catálogos de cargo (`cargos_staff`, `cargos_claro`, `cargos_obamacare`, `cargos_majority`, `cargos_campanas`) la incluyen de forma aditiva (unión sin duplicar), vía un helper `conCargosBaseReclutamiento()`. Verificado contra el endpoint `/api/candidato/catalogos`: los 5 catálogos ahora incluyen `Agente`/`Agente Plus` y el resto de la lista del Excel, sin perder ninguno de los cargos legacy.

**2. TIPO DE DOC — reducido a solo CC / PPT.** Se quitaron `Pasaporte`, `CE`, `DNI`, `Otro` del catálogo `tipos_documento_extranjero` (ahora solo tiene `PPT`); `CC` sigue autoasignado cuando `nacionalidad = Colombiano` (lógica que ya existía, sin cambios). Como en local hay 23 candidatos históricos con `tipo_documento = 'Otro'` (13) o `'Pasaporte'` (10), ambos venezolanos, se agregó una protección en `EditarCandidato.jsx`: si el candidato tiene un valor histórico que ya no está en el catálogo, se inyecta como opción adicional marcada "(histórico)" para que se siga viendo y no se pierda al abrir el formulario de edición (no se fuerza a cambiarlo). `NuevoCandidato.jsx` (creación) ya no ofrece esas opciones — solo CC/PPT, como pediste.

**Verificado**: build de frontend sin errores, lint sin errores nuevos, catálogos confirmados vía API real contra el backend local levantado para la prueba.

## Corrección del usuario (2026-08-18, segunda ronda): se elimina el campo Nacionalidad

El usuario pidió quitar el campo **Nacionalidad** del formulario y dejar **Tipo de Documento** con exactamente dos opciones: `CC`, `PPT`.

- **Antes**: el reclutador elegía Nacionalidad (Colombiano/Venezolano) y de eso se derivaba Tipo de Documento (CC forzado, o un select de Pasaporte/CE/DNI/Otro/PPT).
- **Ahora**: Nacionalidad desaparece de ambos formularios (`NuevoCandidato.jsx` y `EditarCandidato.jsx` — se aplicó a los dos por consistencia, ya que es el mismo campo compartido). Tipo de Documento pasa a ser un select directo y obligatorio con `CC`/`PPT` (catálogo `tipos_documento` en `models/candidato.model.js`, reemplaza a `tipos_documento_extranjero` y a `nacionalidades`, ambos eliminados).
- **La columna `nacionalidad` de `hyd_candidatos` no se tocó ni se eliminó** — sigue existiendo porque `PerfilCandidato.jsx` la muestra en el perfil y en el PDF exportado. Ahora se **deriva en el backend** (`crearCandidato`/`editarCandidato` en `candidato.controller.js`): `tipo_documento === 'CC' ? 'Colombiano' : 'Venezolano'`. El cliente ya no la envía ni se confía en que la envíe.
- `tipo_documento` pasó a ser **campo requerido** en ambos endpoints (antes no lo era explícitamente, porque nacionalidad hacía ese papel).
- **Dato histórico protegido**: los 23 candidatos locales con `tipo_documento` = `Otro`/`Pasaporte` (creados antes de este cambio) se siguen viendo correctamente en `EditarCandidato.jsx` — su valor histórico se inyecta como opción adicional "(histórico)" en el select si ya no está en el catálogo vigente, igual que se hizo en la corrección anterior.

**Verificado end-to-end contra el backend local real**: creación con `tipo_documento: "PPT"` sin enviar `nacionalidad` → quedó `nacionalidad: "Venezolano"` en BD; con `tipo_documento: "CC"` → `nacionalidad: "Colombiano"`; sin `tipo_documento` → rechazado con 400. Build y lint de frontend sin errores nuevos. Registros de prueba eliminados después.

## Corrección del usuario (2026-08-18, tercera ronda): "Primer Nombre" + "Primer Apellido" → un solo campo "Nombre Completo"

El usuario pidió unificar "Primer Nombre" y "Primer Apellido" en un solo campo de texto libre "Nombre Completo", con la condición de que **no se afecten los registros existentes** — es decir, seguir escribiendo `primer_nombre`, `segundo_nombre`, `primer_apellido`, `segundo_apellido` como columnas separadas en `hyd_candidatos` (sin cambio de esquema), partiendo el texto que escribe el reclutador.

**El punto delicado**: partir un nombre completo en español es ambiguo cuando hay exactamente 3 palabras (¿"Juan Carlos Pérez" es 2 nombres + 1 apellido, o es "Juan Pérez Gómez" = 1 nombre + 2 apellidos?). Se lo pregunté al usuario en vez de asumir, porque adivinar mal corrompe silenciosamente el nombre de cada candidato de 3 palabras hacia adelante. **Decisión del usuario**: ante ambigüedad, las últimas 2 palabras siempre se toman como apellidos (convención más común en Colombia, donde casi todos tienen 2 apellidos).

**Regla implementada** (`separarNombreCompleto()` en `controllers/candidato.controller.js`, compartida por `crearCandidato` y `editarCandidato`):
- 1 palabra → rechazado (400), se exige mínimo nombre + apellido.
- 2 palabras → `primer_nombre` + `primer_apellido` (sin segundo nombre/apellido).
- 3+ palabras → las **últimas 2** palabras son `primer_apellido`/`segundo_apellido`; la **primera** palabra es `primer_nombre`; las palabras intermedias (si las hay) van completas a `segundo_nombre`.

Verificado con pruebas reales: "Juan Perez" → nombre=Juan, apellido=Perez; "Juan Perez Gomez" → nombre=Juan, apellido=Perez, segundo_apellido=Gomez; "Juan Carlos Perez Gomez" → nombre=Juan, segundo_nombre=Carlos, apellido=Perez, segundo_apellido=Gomez; "Juan" solo → rechazado con el mensaje esperado.

**Dónde se aplicó**: `NuevoCandidato.jsx` (un input "Nombre Completo" reemplaza a los 2 anteriores) y, por consistencia, también `EditarCandidato.jsx` — al abrir un candidato para editar, se recompone "Nombre Completo" uniendo sus 4 campos guardados (`primer_nombre segundo_nombre primer_apellido segundo_apellido`, omitiendo los vacíos) y al guardar se vuelve a partir con la misma regla.

⚠️ **Riesgo identificado y aceptado, no corregido (impacto hoy: mínimo)**: como `EditarCandidato.jsx` recompone y vuelve a partir el nombre en cada edición, un candidato cuyo nombre real es "2 nombres + 1 apellido" de 3 palabras (p. ej. `primer_nombre=Juan, segundo_nombre=Carlos, primer_apellido=Perez, segundo_apellido=NULL`) se vería, al recomponerlo, como "Juan Carlos Perez" (3 palabras) — y al guardar se volvería a partir con la regla "últimas 2 = apellidos", quedando mal como `primer_nombre=Juan, primer_apellido=Carlos, segundo_apellido=Perez`. **Impacto real hoy: prácticamente nulo** — `segundo_nombre`/`segundo_apellido` están en `NULL` en 7857 de 7859 candidatos (ver diagnóstico inicial de este plan); solo se materializa si alguien edita uno de esos 2 candidatos con datos, o algún candidato nuevo (creado con esta función) resulta tener este patrón exacto y luego se edita. Documentado aquí para no perderlo de vista, no bloqueó la entrega porque el usuario ya fijó la regla de partición y el caso afectado es marginal.

⚠️ **Interacción pendiente de revisar (fuera de alcance de "Nuevo Candidato")**: el formulario emailado al candidato (paso "Datos Básicos", `actualizarDatosBasicos` en el mismo controller) también escribe `segundo_nombre`/`segundo_apellido`, y no los valida como requeridos — si el candidato completa ese paso sin tocar esos campos, podría sobreescribir con vacío el `segundo_nombre`/`segundo_apellido` que el reclutador ya había derivado del nombre completo al crear el candidato. No se tocó (pertenece al formulario emailado, no al de creación), pero queda anotado para cuando se aborde esa parte.

**Verificado**: build y lint de frontend sin errores nuevos; pruebas reales de creación contra el backend local cubriendo los 4 casos de conteo de palabras; registros de prueba eliminados después.

## Corrección del usuario (2026-08-18, cuarta ronda): se quitan "Fecha/Hora de Citación a Entrevista" del formulario

El usuario pidió eliminar "Fecha de Citación a Entrevista" y "Hora de Citación a Entrevista", y preguntó el paso a paso para registrar un candidato y citarlo según el Excel.

**Por qué tiene sentido**: revisando el código encontré que el sistema **ya tiene un flujo dedicado** para agendar entrevista, separado de crear/editar candidato: endpoint `PUT /api/candidato/fecha-entrevista/:candidatoId` (`actualizarFechaEntrevista` en el controller, permiso `agendar_entrevistas`), con su propia UI en `PerfilCandidato.jsx` — sección "Gestión de Entrevista" con un campo de fecha/hora y botón "Guardar". Esto además calza con el propio Excel: la citación pasa por `PERFIL`/`SEGUIMIENTO ASISTENCIA` — es un paso posterior a la gestión de contacto/registro, no parte de ella. Se quitó de **ambos** formularios (`NuevoCandidato.jsx` y `EditarCandidato.jsx`), no solo de "Nuevo Candidato", para que la fecha de cita tenga un único dueño (el flujo dedicado) y no 3 sitios distintos que puedan pisarse entre sí.

**Bug real que encontré y corregí de paso**: el `UPDATE` de `editarCandidato` en el backend seteaba `fecha_citacion_entrevista` incondicionalmente en cada edición, tomando el valor de `req.body`. Si el frontend dejaba de enviar ese campo (que es justo lo que pasa al quitarlo del formulario), cada vez que alguien editara cualquier otro dato de un candidato (p. ej. el teléfono), la fecha de entrevista ya agendada se habría **borrado silenciosamente** (`undefined || null` → `NULL`). Corregido quitando `fecha_citacion_entrevista` por completo del `UPDATE` de `editarCandidato` — ese campo ahora es responsabilidad exclusiva de `actualizarFechaEntrevista`. `crearCandidato` no se tocó (crear un candidato nuevo no tiene fecha previa que perder).

**Verificado con una prueba real de punta a punta** contra el backend local: crear candidato → agendar entrevista vía el endpoint dedicado → editar el candidato (otro campo) → confirmar que la fecha de entrevista seguía guardada. Sin el fix se habría perdido. Build y lint de frontend sin errores nuevos. Registro de prueba eliminado después.

### Paso a paso: registrar un candidato y citarlo a entrevista (según el Excel + sistema actual)

1. **Registrar el candidato** — `Nuevo Candidato` (recluta contacta al candidato por primera vez, llena lo que sabe de esa llamada): Tipo de Documento (CC/PPT), Nombre Completo, Edad, Correo, Celular, ¿Contactó por llamada?/¿Por WhatsApp?, Campaña (cliente), Cargo, Oleada (si aplica), Fuente de Reclutamiento, Observaciones de Llamada (esto fija el `estado` inicial: contacto exitoso, no contesta, reagendar, no interesado, etc.). *Corresponde a las columnas `FECHA…CONTACTO` del Excel. `Ciudad` se eliminó del formulario (corrección 2026-08-18).*
2. **Seguimiento de contacto** (si en el primer intento no hubo contacto exitoso) — reeditar el candidato según vaya progresando la gestión (`ESTADO GESTIÓN RECLUTAMIENTO` del Excel; hoy cubierto de forma simplificada por `Observaciones de Llamada` en `Editar Candidato` — el detalle fino de motivos "No apto por…"/"No interesado por…" del Excel queda pendiente, ver sección de columnas fuera de alcance).
3. **Enviar el formulario al candidato** (botón "Reenviar formulario"/`reenviarEmail`) una vez el contacto es exitoso — le llega un link para completar sus datos (hoja de vida, estudios, experiencia, etc.), y el `estado` avanza a `formularios_enviados` → `formularios_completados` cuando termina.
4. **Citar a entrevista** — desde el **perfil del candidato** (`PerfilCandidato.jsx`, sección "Gestión de Entrevista"): fijar fecha y hora, y cambiar el `estado` a `citado` (dropdown de estado, disponible en el perfil o en la lista de candidatos). *Corresponde a `PERFIL`/`SEGUIMIENTO ASISTENCIA` del Excel — ya no se hace desde "Nuevo Candidato"/"Editar Candidato".*
5. **Registrar asistencia** — **no está en el módulo de candidatos, vive en el módulo de Selección**, y **solo lo pueden hacer los roles `seleccion`/`administrador`** (un `reclutador` no tiene acceso a este paso, ni al endpoint que lo hace — `verificarRolSeleccion` en `seleccion.routes.js`). Pasos exactos:
   1. Entrar a **Selección → Candidatos** (`/hydra/seleccion/candidatos`, componente `CandidatosSeleccion.jsx`) — esta pantalla solo lista candidatos con `fecha_citacion_entrevista` ya puesta (los citados en el paso 4).
   2. En la fila del candidato, aparece un ícono de reloj **"Marcar asistencia"** — solo se ve si `asistio_citacion` sigue en `pendiente` (todavía no se marcó).
   3. Clic ahí abre un modal con observaciones opcionales y dos botones: **"Asistió"** / **"No asistió"**.
   4. Al confirmar, llama a `PUT /api/seleccion/candidatos/:candidatoId/asistencia` (`marcarAsistencia` en `seleccion.controller.js`), que hace lo siguiente en una sola operación:
      - Si **"Asistió"** → `asistio_citacion = 'asistio'`, `fecha_asistencia = NOW()`, y el `estado` del candidato pasa automáticamente a **`entrevistado`**.
      - Si **"No asistió"** → `asistio_citacion = 'no_asistio'`, y el `estado` pasa a **`no_asistio`**.
   *Corresponde a `ASISTE ENTREVISTA`/`MOTIVO INASISTENCIA` del Excel — el detalle de "motivo de inasistencia" del Excel no se captura hoy, solo el sí/no y observaciones libres.*
6. **Evaluación y aprobación** — una vez `estado = entrevistado`, en la misma pantalla de Selección aparece la opción de evaluar (evaluación por criterios → `evaluacion_total`/`evaluacion_aprobado`) y luego la decisión final (`aprobacion_final`). Esto corresponde a `ANTECEDENTES`/`APROBADO`/`¿POR QUÉ NO APROBO?` del Excel — lo maneja el módulo de selección/psicólogo, fuera del alcance de este desarrollo (no se detalla aquí, se puede profundizar si hace falta).

## Corrección del usuario (2026-08-18, quinta ronda): se quita "Ciudad que Aplica"

Eliminado de `NuevoCandidato.jsx` y `EditarCandidato.jsx` (estado, validación de campo requerido, y el `<select>` con el catálogo `ciudades`). No hizo falta tocar el backend: `ciudad` **ya era opcional** en `crearCandidato`/`editarCandidato` (no estaba en el chequeo de campos requeridos, y ambos endpoints ya usaban `ciudad || null` al insertar/actualizar) — la columna sigue existiendo en `hyd_candidatos`, simplemente deja de pedirse en el formulario. Verificado creando un candidato real sin enviar `ciudad`: se guarda sin error. Build y lint de frontend sin errores nuevos.

## Bug reportado por el usuario (2026-08-18): 400 al crear candidato desde la intranet

El usuario reportó un `400 Bad Request` en consola al intentar crear un candidato, con un mensaje inútil (`Error: 400`, sin detalle) — típico de un bug ya documentado en `claude/arquitectura-y-bugs.md` (bug #5): `services/api.js`, los métodos `get()` y `post()` no leían el `{ "error": "..." }` que sí manda el backend, solo lanzaban `Error: ${response.status}` (a diferencia de `put()`, que sí lo hacía).

**Diagnóstico**: levanté backend + frontend locales y reproduje la creación de un candidato en el navegador real (login como `admin@local.com`, formulario "Nuevo Candidato" completo). La primera vez fallé sin querer con `numero_documento = 12345678` — que ya pertenece a un candidato semilla preexistente en la BD local (`id=2`, "Candidato Prueba") — y confirmé contra la API directamente que eso devuelve `400 { "error": "Ya existe un candidato con esta cédula" }`. Es el chequeo de duplicados de `crearCandidato` (`checkDuplicatesQuery`, por email o cédula) funcionando como está diseñado — el problema real no era el 400 en sí, sino que **el frontend nunca mostraba por qué**.

**Corregido**:
- `services/api.js`: `get()` y `post()` ahora leen `errorData.error` del cuerpo de la respuesta antes de lanzar el error, igual que ya hacía `put()` — bug #5 de `claude/arquitectura-y-bugs.md`, resuelto de paso.
- `NuevoCandidato.jsx` y `EditarCandidato.jsx`: el `alert()` de error en `handleSubmit` ahora muestra `error.message` (el motivo real que manda el backend: cédula/email duplicado, campo faltante, etc.) en vez del texto genérico fijo de antes.

Con este fix, la próxima vez que alguien tope con un 400 al crear/editar un candidato, el `alert()` va a decir la razón exacta (p. ej. "Ya existe un candidato con esta cédula" o "El nombre completo debe incluir al menos nombre y apellido") en vez de un `Error: 400` sin contexto.

**Nota de proceso**: la reproducción en navegador real fue más difícil de lo esperado porque el formulario usa `alert()` nativo para avisar éxito/error — esto bloquea la automatización del navegador (Chrome deja de responder a la extensión mientras el diálogo está abierto). Tuve que cerrar y recrear la pestaña varias veces. No se tocó ese patrón de `alert()` ahora (no fue lo pedido), pero **queda anotado como mejora futura**: reemplazar los `alert()`/`confirm()` nativos por notificaciones en la propia UI (toast/modal) — más profesional para los reclutadores y no bloquea nada.

**Verificado**: `curl` directo contra el backend local confirmando el 400 real y su mensaje; build y lint de frontend sin errores nuevos; registro de prueba eliminado después.

---

# Sesión 2026-08-18: normalización ejecutada contra el Excel oficial

Retomando el plan de arriba: se revisó `Downloads/FORMATO HOJA DE VIDA.xlsx` (hoja **"HOJA DE VIDA E
INFORME DE SELEC"**, versión vigente 3.0, código `GH-RYS-F-04` — confirmado como la hoja que abre por
defecto: `workbookView firstSheet="2" activeTab="2"` en el XML). Decisiones de alcance confirmadas con el
usuario antes de tocar código:
1. Alcance = **formulario oficial completo** (no solo lo que el sistema ya capturaba), agregando los
   campos que el Excel pide y nunca se implementaron.
2. Estudios y experiencia laboral pasan a ser **1:N reales** (una fila por nivel académico / por
   empresa), no columnas fijas repetidas.
3. `genero` se mantiene (no está en el Excel, pero ya se usaba) — luego, en una corrección posterior, el
   usuario pidió **quitarlo** del formulario junto con `fecha_nacimiento` (ver más abajo).
4. `segundo_nombre`/`segundo_apellido` se retiraron del paso "Datos Básicos" del candidato — ya los
   deriva el reclutador del "Nombre Completo" al crear el candidato (`separarNombreCompleto`), y
   pedirlos de nuevo tenía el riesgo ya documentado de sobreescribirlos en blanco.

## Diseño final: 6 tablas nuevas (no 5, ver nota de estado al inicio del archivo)

Todas con `candidato_id` como FK a `hyd_candidatos(id) ON DELETE CASCADE` (primera vez que el proyecto
declara FKs reales, ver bug #9 en `claude/arquitectura-y-bugs.md`):

- **`hyd_candidato_datos_basicos`** (1:1): `estado_civil`, `aspiracion_salarial`, `direccion_residencial`,
  `barrio`, `talla_camisa`, `genero`, `fecha_nacimiento`, `grupo_sanguineo`, `eps`, `afp`,
  `nombre_emergencia`, `numero_emergencia`, `parentesco_emergencia`.
- **`hyd_candidato_estudios`** (1:N, `UNIQUE(candidato_id, nivel_estudios)`): `nivel_estudios` ENUM con
  los 4 niveles exactos del Excel (`bachillerato`, `tecnico_tecnologo`, `profesional_u_otros`,
  `conocimientos_informaticos`), `nombre_institucion`, `titulo_obtenido`, `ano_finalizacion`, y
  `descripcion` (VARCHAR 500, agregada en migración 006 — ver corrección más abajo).
- **`hyd_candidato_experiencia`** (1:N, `UNIQUE(candidato_id, orden)`, hasta 3 empresas): `orden`,
  `nombre_empresa`, `cargo_desempenado`, `salario`, `funciones`, `fecha_inicio`, `fecha_retiro`,
  `tiempo_laborado_anos`, `tiempo_laborado_meses`, `motivo_retiro`.
- **`hyd_candidato_experiencia_resumen`** (1:1): preguntas generales no ligadas a una empresa —
  `ha_trabajado_asiste`, `ha_estado_proceso_formativo_asiste`, `campana_asiste`, `fecha_inicio_asiste`,
  `fecha_retiro_asiste`, `tiempo_laborado_asiste`, `motivo_retiro_asiste` ("Información Reintegros" del
  Excel) + `experiencia_comercial_certificada`, `experiencia_comercial_no_certificada`,
  `primer_empleo_formal` (las escribe el paso "Personal", no "Experiencia" — ver más abajo por qué).
- **`hyd_candidato_personal`** (1:1): `genograma`, `fortalezas`, `aspectos_mejorar`,
  `competencias_laborales`, `metas_corto_plazo`, `metas_mediano_plazo`, `metas_largo_plazo`,
  `estado_salud_actual`, `conocimiento_excel/powerpoint/word`, `autoevaluacion`, más
  `expectativa_laboral`/`tratamiento_psicologico_actual`/`tratamiento_psicologico_detalle` (columnas
  creadas pero **todavía sin wire al frontend** — vienen de los headers del sheet `BB_DD` del Excel, no
  del layout visual que el usuario usó para las correcciones, así que quedaron pendientes).
- **`hyd_candidato_consentimiento`** (1:1): `ciudad_consentimiento`, `dia_consentimiento`,
  `mes_consentimiento`, `ano_consentimiento` (sin cambios respecto al diseño original).

`hyd_candidatos` se queda con: datos de "Nuevo Candidato" (recruiter), el mecanismo de acceso al link
(`token_acceso`, `fecha_vencimiento_token`, `consentimiento_aceptado`), los 12 campos de progreso
(`formulario_*_completado`/`fecha_completado_*`), y el módulo de Selección — ver mensaje del usuario
"me duplicaste el campo de edad..." de esta sesión para la confirmación explícita de este split.

## Migraciones (`database/migrations/`)

- **`002_normalizacion_formulario_candidato_crear_tablas.sql`**: `CREATE TABLE` de las 6 tablas.
- **`003_normalizacion_formulario_candidato_backfill.sql`**: migra los 2-3 candidatos con datos reales.
  ⚠️ **Bug encontrado y corregido al validar este script**: el mismo problema ya documentado para
  `evaluacion_total` (columnas "reseteadas" a `0` en vez de `NULL` por una importación defectuosa)
  también afecta a `conocimiento_excel/powerpoint/word`, `autoevaluacion`, `dia/mes_consentimiento`,
  `salario_experiencia`, `tiempo_laborado_anos/meses`. El primer intento del backfill generó ~7856 filas
  basura por tabla; se corrigió disparando el `INSERT` solo con columnas de texto/fecha (inmunes al
  reset), nunca con estas numéricas.
- **`004_normalizacion_formulario_candidato_drop_columnas.sql`**: `DROP COLUMN` de las ~37 columnas ya
  migradas en `hyd_candidatos`. **NO ejecutada todavía** — documentada para correr solo después de QA
  completo (el backend y frontend ya no las usan, pero se deja la limpieza final para el final).
- **`005_estudios_niveles_excel.sql`**: cambia `hyd_candidato_estudios.nivel_estudios` del catálogo
  abierto de 8 valores (`primaria`...`doctorado`) a los 4 valores fijos del Excel. Aplicada y verificada.
- **`006_estudios_conocimientos_informaticos_texto_libre.sql`**: agrega `descripcion VARCHAR(500)` a
  `hyd_candidato_estudios` — ver corrección de "Conocimientos Informáticos" más abajo.

Las migraciones 002, 003, 005 y 006 están **aplicadas en la BD local** y verificadas end-to-end contra el
backend real (candidatos de prueba creados, formulario completado vía `curl`, datos verificados en BD,
candidatos de prueba eliminados después). La 004 queda pendiente de forma deliberada.

## Backend: refactor de `candidato.controller.js`

- Se agregó un helper `queryAsync()` (wrapper con Promise sobre `global.db.query`) y
  `obtenerCandidatoConFormulario(whereClause, params)`, usado por `validarToken` y `getPerfilCompleto`:
  hace `LEFT JOIN` de las 4 tablas 1:1 sobre `hyd_candidatos`, trae `estudios`/`experiencia` como arrays
  aparte, y aplana el primer registro de cada uno sobre el objeto `candidato` (mismos nombres de columna
  que antes) para que el frontend siga recibiendo el shape de siempre.
- Los 6 endpoints (`actualizarHojaVida`, `actualizarDatosBasicos`, `actualizarEstudios`,
  `actualizarExperiencia`, `actualizarPersonal`, `actualizarConsentimiento`) pasan de `UPDATE
  hyd_candidatos` a `INSERT ... ON DUPLICATE KEY UPDATE` sobre la tabla nueva correspondiente, resolviendo
  el `candidato_id` desde el token primero.
- `actualizarEstudios` acepta un array `estudios: [...]` (hasta 4 filas) en una sola llamada, en vez de
  una fila a la vez.

### ✅ Corrección (2026-08-19): el manejo de las 6 tablas nuevas SÍ se movió a capas

Lo de arriba (`queryAsync`, `obtenerCandidatoConFormulario`, los 6 upserts) vivía todo dentro de
`candidato.controller.js` — la sección "Evolución de arquitectura" de este mismo archivo describía capas
(`routes/ → controllers/ → services/ → repositories/`) como diseño propuesto, pero nunca se ejecutó (quedó
confirmado al revisar el código real en esta sesión). El usuario pidió corregir esto **antes de comitear**,
con alcance acotado: **solo el manejo de las 6 tablas nuevas pasa a capas; el resto del controller
(`crearCandidato`, `editarCandidato`, `cambiarEstado`, `actualizarFechaEntrevista`, analytics, etc., todo
sobre `hyd_candidatos`) se deja exactamente como estaba, sin tocar.**

Hecho:
- **`repositories/candidatoFormulario.repository.js`** — único lugar que hace SQL contra las 6 tablas
  `hyd_candidato_*` (y los puntos puntuales donde ese formulario sincroniza/marca progreso sobre
  `hyd_candidatos`: `sincronizarCandidatoDesdeDatosBasicos`, `marcar*Completada`, `finalizarConsentimiento`).
  Contiene `queryAsync` y `obtenerCandidatoConFormulario`, movidos tal cual desde el controller.
- **`services/candidatoFormulario.service.js`** — toda la validación de negocio de los 6 pasos (campos
  requeridos, niveles de estudios válidos, límite de 500 caracteres de "Conocimientos Informáticos", etc.)
  y la orquestación (verificar acceso → upsert → marcar completado →, en consentimiento, notificar por
  email de forma fire-and-forget, igual que el comportamiento original). Lanza `HttpError` (nuevo,
  `utils/httpError.js`) con el status HTTP correcto; no conoce SQL, todo pasa por el repositorio.
- **`utils/nombreCompleto.util.js`** — `separarNombreCompleto()` se sacó del controller a un util
  compartido (sin cambiar su comportamiento) porque lo usan tanto `actualizarDatosBasicos` (ahora en el
  servicio nuevo) como `crearCandidato`/`editarCandidato` (que se quedaron sin tocar en el controller) —
  necesario para no duplicar la función ni crear una dependencia circular controller↔servicio.
- **`candidato.controller.js`**: los 6 endpoints (`actualizarHojaVida`...`actualizarConsentimiento`) más
  `validarToken` y `getPerfilCompleto` quedaron delgados — extraen `req.params`/`req.body`, llaman al
  servicio, y traducen el resultado/error a HTTP (`manejarErrorFormulario`, nuevo helper). El resto del
  archivo (CRUD viejo de candidato) no se tocó.
- **`routes/candidato.routes.js`**: sin cambios — los nombres de los métodos del controller no cambiaron,
  así que el wiring de rutas sigue igual.

**Verificado end-to-end contra el backend local real** (no solo `node --check`): candidato de prueba
creado, los 6 pasos del formulario completados en orden vía `curl` contra los endpoints reales, `estado`
avanzó correctamente a `formularios_completados`, `progreso_formularios` quedó en 6/6,
`getPerfilCompleto` devolvió el JOIN completo (estudios/experiencia como arrays, campos sincronizados de
"Datos Básicos" como `direccion_residencial`, nombre separado con segundo nombre/apellido correctos), el
candado de acceso (403 "ya completado") funcionó al reintentar un paso después del consentimiento, un
token inválido dio 404, y dos endpoints viejos sin tocar (`/catalogos`, `/por-estado/:estado`) siguieron
funcionando igual. Candidato de prueba eliminado después (el `ON DELETE CASCADE` de las 6 tablas nuevas
limpió las filas huérfanas correctamente, verificado con `COUNT(*)` en cada una).

### Corrección (durante la sesión): sincronizar campos compartidos con `hyd_candidatos`

El usuario pidió que el candidato pueda llenar/corregir **Nombres Completos, Tipo/N° de Documento,
Celular y Edad** en "Datos Básicos", y que al guardar esos valores se sincronicen de vuelta a
`hyd_candidatos` (no solo a la tabla nueva) — al estar unidas por `candidato_id`. Implementado en
`actualizarDatosBasicos`: resuelve el `candidato_id`, aplica el mismo chequeo de cédula duplicada que ya
usan `crearCandidato`/`editarCandidato` (rechaza 400 si el documento ya es de otro candidato), separa el
nombre con `separarNombreCompleto()`, deriva `nacionalidad` de `tipo_documento` (mismo criterio que la
intranet), y hace un segundo `UPDATE` sobre `hyd_candidatos`. **Se quedaron de solo lectura** (decisión
explícita del usuario): `Correo Electrónico` (es la clave del link/token), y `Cargo al que Aspira`/`Fuente
de Reclutamiento` (datos de control del embudo que fija el reclutador, no el candidato). `Nacionalidad`
tampoco se pide suelta: se deriva en vivo de `tipo_documento`, tanto en frontend como en backend.

## Frontend: los 6 pasos reestructurados bloque por bloque, igual que el Excel

El usuario fue corrigiendo iterativamente hasta que cada paso calzara **exactamente** con los bloques
visuales del Excel (pegó el texto del Excel tal cual varias veces para comparar). Estado final:

- **`HojaVida.jsx` (paso 1) = bloque "DATOS BÁSICOS"**: se quitaron los paneles de bienvenida
  ("Información Personal"/"Información del Proceso") que mostraban de más — el formulario arranca
  directo con el bloque real: Fecha de Entrevista / Fuente de Reclutamiento (solo lectura, layout 2×2) y
  Cargo al que Aspira / Aspiración Salarial (esta última editable, único dato que aporta el candidato
  aquí). `estado_civil` se movió a "Datos Básicos" (paso 2).
- **`DatosBasicos.jsx` (paso 2) = bloques "DATOS PERSONALES" + "CONTACTO DE EMERGENCIA"**: Nombres
  Completos/Tipo+N° Documento/Celular/Edad editables y sincronizados a `hyd_candidatos` (ver arriba);
  Nacionalidad y Correo de solo lectura; EPS/Fondo de Pensión/RH/Dirección Residencial/Barrio/Estado
  Civil/Talla de Camisa editables (Dirección, Barrio y Talla son campos nuevos, no existían antes).
  **Género y Fecha de Nacimiento se quitaron** del formulario en una corrección posterior (no están en el
  Excel oficial; el usuario decidió no pedirlos más, revirtiendo la decisión inicial de "mantenerlos").
  Contacto de Emergencia sin cambios de campos.
- **`Estudios.jsx` (paso 3) = bloque "INFORMACIÓN ACADEMICA"**: 4 filas fijas (Bachillerato,
  Técnico/Tecnólogo, Profesional u Otros, Conocimientos Informáticos), cada una opcional pero completa si
  se llena. **Corrección**: "Conocimientos Informáticos" no es institución/título/año como las otras 3 —
  es un campo de **texto libre, máximo 500 caracteres**, con contador visible (columna `descripcion`,
  migración 006).
- **`Experiencia.jsx` (paso 4) = bloque "EXPERIENCIA LABORAL" (última/actual empresa) + "INFORMACIÓN
  REINTEGROS"**: se agregó el campo `funciones` que faltaba. Se **quitó** la sección "Experiencia
  Comercial" (3 preguntas SI/NO) — en el Excel están físicamente junto a la autoevaluación de
  herramientas ofimáticas, no aquí — y se agregó el bloque de reintegros con Asiste ING (2 preguntas
  SI/NO + campaña/fechas/tiempo/motivo, estos últimos solo visibles si alguna de las 2 preguntas es "Sí").
- **`Personal.jsx` (paso 5) = bloques posteriores a la firma del Excel**: se agregaron, en este orden,
  Genograma (texto libre), Metas (Corto/Mediano/Largo plazo, 3 campos), Estado de Salud Actual (select
  Bueno/Regular/Malo — sin catálogo explícito en el Excel, elegido como default razonable a falta de uno
  confirmado), y al final **Experiencia Comercial** (las 3 preguntas SI/NO movidas desde Experiencia,
  escritas en `hyd_candidato_experiencia_resumen` mediante un upsert parcial que no pisa los datos de
  reintegros ya guardados por el paso anterior — verificado explícitamente con un caso de prueba).
- **`Consentimiento.jsx` (paso 6)**: no tocado en esta sesión.

Pendiente, sin tocar todavía (quedó explícito al cierre de la sesión): "Anterior Empleo" (2 empresas más,
la tabla `hyd_candidato_experiencia` ya soporta hasta `orden = 3`), y `expectativa_laboral`/
`tratamiento_psicologico_*` (columnas ya creadas en `hyd_candidato_personal`, sin UI todavía).

## Otro hallazgo de la sesión (no relacionado con el formulario, resuelto de paso)

El usuario preguntó por qué `editarCandidato` rechaza un email ya usado por otro candidato — se explicó
que es intencional (`email_personal` es `UNIQUE` en `hyd_candidatos`, y es la clave del link del
formulario). Para poder probar el formulario emailado repetidamente con el mismo correo real sin tocar la
validación, se le sugirió el truco del alias `+` de Gmail (`usuario+prueba1@gmail.com`,
`usuario+prueba2@gmail.com`, ...) — todos llegan a la misma bandeja pero son valores distintos para el
sistema. No se cambió código para esto.

## Paginación de la lista principal de candidatos (2026-08-19)

`GET /api/candidato/por-estado/:estado` (`getCandidatosPorEstado`, usado por
`ListaCandidatos.jsx` del reclutador) traía **todos** los candidatos de un estado en una sola
respuesta — con 7857 candidatos en la BD (casi todos en `'nuevo'`, ver diagnóstico inicial de
este plan), eso podía significar miles de filas en un solo `SELECT` sin límite. El usuario pidió
paginar de 20 en 20, confirmando el alcance con `AskUserQuestion`: solo esta lista, no los
listados del módulo de Selección (`seleccion.controller.js` tiene los mismos sin límite, pero
quedan fuera de este cambio).

**Backend** (`hidrabackend/controllers/candidato.controller.js`): acepta `?page=N` (default 1),
`limit` fijo en 20. Corre un `SELECT COUNT(*)` (mismo `WHERE` que ya filtraba por rol —
administrador/selección ven todo el estado, reclutador solo lo suyo) seguido del `SELECT` de
siempre con `LIMIT ? OFFSET ?`. La respuesta cambió de forma — **breaking change** para quien
consuma este endpoint —: pasó de un array plano a
`{ candidatos: [...], pagination: { page, limit, total, totalPages } }`.

**Frontend** (`hidrafrontend`):
- `services/api.js`: `getCandidatosPorEstado(estado, page = 1)` agrega `?page=` a la URL.
- `components/reclutador/ListaCandidatos.jsx`: estado `page`/`pagination` nuevos; el `useEffect`
  que recarga pasó a depender de `[estadoActivo, page]`. Se agregó `handleSetEstadoActivo()` para
  que cambiar de estado (pestaña) resetee `page` a 1 en el mismo batch de React (evita un fetch
  extra con la página vieja). Controles "Anterior/Siguiente" nuevos debajo de la tabla/tarjetas,
  visibles solo si `totalPages > 1`.
- ⚠️ **Trade-off aceptado, no resuelto**: el buscador de texto (`searchTerm`) sigue siendo
  client-side y ahora solo filtra los 20 candidatos de la página actual, no los del estado
  completo — antes sí buscaba sobre todos. Se agregó un aviso visible bajo el buscador
  (`"La búsqueda solo filtra los 20 candidatos de la página actual..."`) cuando hay más de una
  página, en vez de implementar búsqueda server-side (fuera del alcance pedido). Si el negocio lo
  necesita, la solución real sería mover la búsqueda al backend (`WHERE ... LIKE ?` o similar).

**Verificado**: `node --check` del controller; `npm run build` y `npm run lint` del frontend sin
errores/advertencias nuevas (las que reporta `eslint` en `ListaCandidatos.jsx` ya existían antes
de este cambio, confirmado comparando con `git stash`). Contra el backend local real: página 1 del
estado `nuevo` devuelve exactamente 20 candidatos (ids 1-20) con
`pagination: {page:1, limit:20, total:7857, totalPages:393}`; página 2 devuelve los siguientes 20
(ids 21-40) sin solapamiento ni huecos.

### Corrección (2026-08-19, mismo día): orden estable + medición real de rendimiento

El usuario preguntó si el paginado realmente mejora el rendimiento y pidió asegurar que la lista
quede del candidato más reciente al más antiguo.

**Rendimiento, medido contra la BD local real** (no estimado): para el estado `nuevo`
(7857 candidatos), la consulta vieja (sin paginar) tardaba 96ms y devolvía **4.3MB** de JSON; la
consulta paginada (20 filas) tarda ~22ms y devuelve **11KB** — una reducción de payload de ~99.7%.
Probé también una página profunda (`OFFSET 3980`, page 200) para confirmar que `LIMIT/OFFSET` no
degrada con la profundidad a esta escala: 24ms, prácticamente igual que la página 1. La mejora real
no es tanto en el costo de la consulta SQL en sí (`EXPLAIN` muestra que con `estado = 'nuevo'`
MySQL hace table scan completo igual, porque ese estado es el 99.97% de la tabla — el optimizador
decide que el índice `idx_estado` no vale la pena ahí) sino en lo que se serializa a JSON, viaja por
red y renderiza React: antes eran ~7857 objetos completos, ahora son 20.

**Bug real encontrado al verificar el orden**: los 7857 candidatos en estado `nuevo` comparten
exactamente el mismo `updated_at` (`2026-08-13 17:31:21`, remanente del reseteo masivo de `estado`
documentado en `claude/context.md`, sesión 2026-08-13). Con `ORDER BY updated_at DESC` a secas,
ese "más reciente primero" no tenía ningún criterio real para desempatar esas 7857 filas — el orden
resultante dependía del plan de ejecución de MySQL, no garantizado ni estable entre llamadas, lo que
además es un riesgo real de paginado roto (una fila podría aparecer en dos páginas distintas o
desaparecer de la lista si el orden cambiaba entre el fetch de la página 1 y la página 2). Corregido
en `candidato.controller.js` (ambas ramas de `getCandidatosPorEstado`, admin/selección y
reclutador): `ORDER BY updated_at DESC, id DESC` — `id` autoincremental como desempate determinista
(mayor id = creado más recientemente), que además coincide con el criterio "más reciente" pedido.

**Verificado contra el backend local real**: página 1 del estado `nuevo` devuelve ids
7857→7838 (el candidato con mayor id primero); pedí la página 2 dos veces seguidas y las respuestas
salieron byte-a-byte idénticas (orden estable), continuando exactamente en 7837→7818 sin huecos ni
solapamiento con la página 1.

⚠️ Detectado ese día: no había índice compuesto que cubra `(estado, updated_at, id)` ni
`(reclutador_id, estado, updated_at, id)` — solo índices simples en `estado` y `reclutador_id` por
separado. Quedó anotado como no bloqueante en su momento; se resolvió el mismo día, ver sección
siguiente.

### Corrección (2026-08-19, mismo día, tercera ronda): bug de búsqueda + índices compuestos

El usuario pidió arreglar los bugs encontrados hasta ahora, mejorar el rendimiento (backend o
frontend) y confirmar que la funcionalidad quedara correcta.

**Bug real (regresión introducida por el paginado, no detectado hasta ahora)**: antes de paginar,
el buscador de `ListaCandidatos.jsx` filtraba en el frontend sobre **todos** los candidatos del
estado ya cargados. Al paginar (ver sección anterior), el frontend solo tiene los 20 candidatos de
la página visible — el buscador seguía filtrando ahí mismo, así que dejó de encontrar candidatos que
sí existen en el estado pero están en otra página. Se había dejado como "trade-off aceptado" con un
aviso en la UI; el usuario pidió corregirlo de verdad.

**Fix**: la búsqueda se movió al backend.
- `candidato.controller.js` (`getCandidatosPorEstado`): nuevo `?search=` opcional, agrega
  `AND (primer_nombre LIKE ? OR primer_apellido LIKE ? OR email_personal LIKE ? OR
  numero_documento LIKE ? OR numero_celular LIKE ? OR cliente LIKE ? OR cargo LIKE ?)` al mismo
  `WHERE` que ya filtraba por estado/rol, tanto en el `COUNT` como en el `SELECT` paginado — la
  búsqueda ahora cubre el estado completo, no solo la página cargada. Escapa `\`, `%` y `_` del
  término de búsqueda (comodines/carácter de escape de `LIKE`) para que un término literal como
  `"50%"` no dispare coincidencias no intencionadas — verificado: buscar `"50%"` da 0 resultados,
  buscar `"50"` da 1252.
- `api.js`: `getCandidatosPorEstado(estado, page, search)` agrega `?search=` a la URL.
- `ListaCandidatos.jsx`: el buscador ahora hace debounce de 300ms (`searchTerm` → `busquedaActiva`
  tras el debounce) antes de disparar el fetch, para no golpear el backend en cada tecla; al
  cambiar la búsqueda vuelve a página 1 en el mismo batch (mismo patrón que
  `handleSetEstadoActivo`). Se eliminó el filtro client-side (`candidatosFiltrados`) y el aviso de
  "la búsqueda solo cubre la página actual" (ya no aplica).
- **Verificado contra el backend local real**: busqué `"zarate"` — encontró 13 candidatos
  incluyendo el `id=1` (que por orden `id DESC` cae en la última de 393 páginas si se navegara
  manualmente) — confirma que la búsqueda ya cubre el estado completo, no solo una página.

**Rendimiento — migración `007_indices_candidatos_por_estado.sql`** (aplicada y verificada en
local): se agregaron dos índices compuestos —`idx_estado_updated_id (estado, updated_at, id)` para
administrador/selección, `idx_reclutador_estado_updated_id (reclutador_id, estado, updated_at, id)`
para reclutador— que cubren exactamente el `WHERE` + `ORDER BY` de `getCandidatosPorEstado`.
Contra lo anotado el mismo día más arriba ("para `nuevo` no importa, MySQL prefiere table scan"):
**sí importó** — con el índice nuevo, `EXPLAIN` para `estado = 'nuevo'` (7857 de 7859 filas) pasó de
table scan + filesort a un **index scan directo sin filesort** (MySQL camina el índice ya ordenado y
para en cuanto junta 20 filas, sin tocar las otras miles). Medido real: página 1 del estado `nuevo`
bajó de ~22ms a ~2ms (en caliente). Página profunda (page 200, `OFFSET 3980`) se mantiene ~23-24ms
con o sin índice — el costo de saltar el `OFFSET` es inherente a este estilo de paginación
(paginación por cursor lo resolvería, pero es un cambio de diseño mayor, no pedido). Verificado
también que `EXPLAIN` para el filtro combinado reclutador+estado usa
`idx_reclutador_estado_updated_id` como *covering index range scan*.

**Verificado end-to-end**: `node --check` del controller; `npm run build` y `npm run lint` del
frontend sin errores/advertencias nuevas (mismas 2 preexistentes de siempre en
`ListaCandidatos.jsx`); migración 007 aplicada en local con `STEP 0` de verificación previa
(confirmó que los índices no existían) y `SHOW INDEX` final confirmando su creación.
**Pendiente**: aplicar la migración 007 en producción (junto con el resto del backend de esta
sesión, todavía sin comitear/desplegar).

### Paginación de "Candidatos Total" (2026-08-19, mismo día, cuarta ronda)

El usuario reportó que la pantalla **"Candidatos Total"** del reclutador (`CandidatosTotal.jsx`,
menú lateral) seguía trayendo todos los registros de una vez — no era la misma lista que se acababa
de paginar. Investigado: esa pantalla consume un endpoint distinto,
`GET /api/seleccion/candidatos-citados` (`seleccion.controller.js`), que **también** usa
`CandidatosSeleccion.jsx` — la pantalla de trabajo diario del equipo de Selección (evaluar
candidatos, gestionar oleadas, filtrando client-side sobre la lista completa cargada). Paginar ese
endpoint compartido sin más habría roto el flujo de Selección. Se confirmó el alcance con el usuario
vía `AskUserQuestion`: **paginar solo "Candidatos Total"**, sin tocar la pantalla de Selección.

**Backend**: se agregó un endpoint **nuevo y dedicado**, `GET /api/seleccion/candidatos-total`
(`getCandidatosTotal` en `seleccion.controller.js`, ruta en `seleccion.routes.js`, mismo middleware
`verificarRolLectura` que ya tenía `candidatos-citados`) — en vez de modificar el existente, para
que `candidatos-citados`/`CandidatosSeleccion.jsx` queden 100% intactos (verificado: sigue
devolviendo las 1984 filas de siempre, sin campo `pagination`). El endpoint nuevo:
- Pagina 20 en 20 (`?page=`), con el mismo patrón de `COUNT` + `LIMIT/OFFSET` que
  `getCandidatosPorEstado`, y el mismo desempate determinista (`..., c.id ASC`) que se corrigió
  antes ese mismo día.
- Búsqueda (`?search=`) y filtros (`?operacion=`, `?asistencia=`, `?estado=`, `?reclutador=`)
  server-side — mismo motivo que la búsqueda de `ListaCandidatos.jsx`: con paginado, filtrar en el
  frontend solo vería la página cargada.
- Devuelve además `filtrosDisponibles: { operaciones, reclutadores }` (2 `SELECT DISTINCT`
  calculados sobre todos los citados, sin aplicar los demás filtros activos — mismo comportamiento
  que tenían `getOperacionesUnicas()`/`getReclutadoresUnicos()` client-side, que leían del array
  completo, no del ya filtrado) para que los `<select>` de la UI sigan mostrando todas las opciones
  posibles sin tener que cargar todos los candidatos.
- Se agregó un helper local `queryAsync()` (mismo patrón usado antes en `candidato.controller.js`)
  para correr las 4 consultas (`COUNT`, datos, 2 `DISTINCT`) en paralelo con `Promise.all`.

**Frontend** (`CandidatosTotal.jsx`): reescrito para apuntar a `/candidatos-total` en vez de
`/candidatos-citados`; se eliminó el filtrado client-side (`candidatosFiltrados`,
`getOperacionesUnicas`, `getReclutadoresUnicos`); el buscador tiene debounce de 300ms igual que
`ListaCandidatos.jsx`; cualquier cambio de filtro (select) vuelve a página 1 en el mismo batch
(`actualizarFiltro()`); se agregaron controles "Anterior/Siguiente" idénticos a los de
`ListaCandidatos.jsx`.

**Verificado contra el backend local real**: `candidatos-citados` sigue devolviendo 1984 filas sin
paginar (cero impacto en Selección); `candidatos-total` pagina correctamente (total 1984,
totalPages 100, 20 filas por página); filtros por operación/asistencia/reclutador+estado combinados
narrowean el `total` correctamente; búsqueda funciona; orden estable entre requests repetidos
idénticos; páginas 1 y 2 sin solapamiento de ids. `npm run build`/`npm run lint` del frontend sin
errores nuevos.

---

## Sesión 2026-08-19 (quinta ronda): motor de llenado de `plantilla/hojavida.pdf` — integración con FirmaCloud

### Contexto

Hydra va a integrarse con **FirmaCloud** (`Backend firmacloud/firmacloudbackend`) para que el
candidato firme electrónicamente su hoja de vida + un tratamiento de datos de reclutamiento. Se
evaluaron dos arquitecturas posibles y se decidió (plan completo en
`Backend firmacloud/firmacloudbackend/claude/planReclutamiento.md`): **Hydra arma y renderiza el
PDF completo de la hoja de vida** (con los datos del candidato ya plasmados) y se lo entrega ya
listo a FirmaCloud; FirmaCloud solo detecta dinámicamente dónde va la firma (por el texto ancla
`"FIRMA DEL CANDIDATO"`, ya impreso en la plantilla) y la estampa — FirmaCloud nunca arma ni conoce
el contenido de la hoja de vida.

Motivo de que el renderizado quede del lado de Hydra y no de FirmaCloud: los datos del candidato
(estudios, experiencia, textos libres de la página 2) son de **longitud variable**, y esos campos
cambian de diseño con mucha frecuencia (ver todo el historial de correcciones de este mismo
archivo) — si esa lógica viviera en FirmaCloud, cada ajuste de este lado obligaría a tocar también
ese otro repo. Al quedar en Hydra, FirmaCloud sigue sin saber nada del contenido, solo firma (mismo
patrón que ya usa con los contratos de RRHH).

El paso 6 "Consentimiento" (checkbox de Ley 1581/2012, ver `Consentimiento.jsx`) queda destinado a
**reemplazarse** por el hand-off a FirmaCloud una vez esa integración esté completa — dejará de ser
un checkbox y pasará a ser una firma real con evidencia legal (IP, fecha, trazo de firma), pero esa
parte del flujo (llamar a `POST /api/reclutamiento/send` de FirmaCloud al completar el paso 5, y
reemplazar la pantalla de `Consentimiento.jsx`) **todavía no está implementada** — ver "Pendiente"
más abajo. Esta sesión solo cubre el primer paso: poder generar el PDF de la hoja de vida.

### Qué se implementó

**`services/hojaVidaPdfService.js`** (nuevo) — `generarHojaVidaPdf(candidato)` recibe exactamente
el objeto que ya devuelve `candidatoFormulario.repository.obtenerCandidatoConFormulario` (el mismo
shape que ya consume `getPerfilCompleto`, con `estudios`/`experiencia` como arrays) y devuelve un
`Buffer` con `plantilla/hojavida.pdf` ("FORMATO HOJA DE VIDA" v3.0, GH-RYS-F-04) lleno con los datos
reales del candidato.

**Estrategia de llenado** (misma familia de técnica que ya usa `firmacloudbackend` en
`fillContratoActivacion()`/`contrato_activacion.json`, adaptada): coordenadas de cada campo
calibradas extrayendo la posición real de cada etiqueta impresa con `pdfjs-dist`
(`extract-hojavida-positions.js`, script ad-hoc, no quedó en el repo), y luego cada valor se dibuja
con **"fit" automático de tamaño de fuente**: se reduce hasta que el texto quepa en el ancho/alto
disponible de su celda, y si ni al tamaño mínimo cabe, se recorta con "…". Los bloques de texto
libre de la página 2 (genograma, fortalezas, aspectos a mejorar, competencias, metas, estado de
salud) además envuelven en varias líneas con el mismo criterio de ajuste. Esto es necesario porque
la plantilla es un formato impreso de **celdas de tamaño fijo** (no una página que fluye), mientras
que la información real del candidato es de longitud variable (nombres largos, correos largos,
funciones/motivos de retiro sin límite, textos libres de la página 2) — sin este ajuste, cualquier
candidato con datos más largos que el promedio habría desbordado su celda.

**Detalle por sección:**
- **Datos básicos / Datos personales / Contacto de emergencia**: valores tomados de `hyd_candidatos`
  + `hyd_candidato_datos_basicos`. Las 2 filas de "Datos básicos" (fecha entrevista/fuente/cargo/
  aspiración) son más angostas (22pt) que el resto (36pt) — ahí el valor va a la derecha de la
  etiqueta en vez de debajo (se detectó y corrigió en la verificación visual, ver más abajo).
- **Información académica**: los 4 niveles posibles de `nivel_estudios` (`bachillerato`,
  `tecnico_tecnologo`, `profesional_u_otros`, `conocimientos_informaticos`) calzan exacto con las 4
  filas fijas ya impresas en la tabla — se recorre el array `estudios` (1:N variable en BD) y se
  llena la fila que corresponda a cada nivel presente, dejando en blanco las que no vengan.
- **Experiencia laboral**: solo se llena "INFORMACIÓN ÚLTIMA O ACTUAL EMPRESA" (`orden = 1`, el
  único que captura hoy el paso 4 del formulario). La fila "ANTERIOR EMPLEO" (`orden = 2`) queda
  con su código listo pero sin datos que pintar — ver "Vacío de datos" más abajo.
- **Información reintegros / experiencia comercial certificada / primer empleo**: las celdas
  impresas "SI"/"NO" se marcan con un óvalo rojo alrededor del valor que corresponda
  (`marcarSiNo()`), en vez de escribir una "X" — se ve más parecido a como se marcaría a mano.
- **"FIRMA DEL CANDIDATO: ______"**: se deja **sin tocar** a propósito — es el texto ancla que
  FirmaCloud va a buscar (`detectSignLocations`, del lado de FirmaCloud) para saber dónde estampar
  la firma. Solo se escribe el número de documento en su propio blanco al lado.
- **"CARGO AGENTES" / "CONCEPTO FINAL SELECCIÓN" / "PSICÓLOGO"** (página 2): se dejan en blanco a
  propósito — son campos de uso interno del equipo de selección/psicólogo, posteriores a la firma
  del candidato, no vienen del formulario que este mismo candidato completó.

**Dependencia nueva**: `pdf-lib` (`^1.17.1`) agregada a `package.json` e instalada
(`npm install pdf-lib --save`). No se agregó `pdfjs-dist` como dependencia de producción — solo se
usó de forma ad-hoc para la calibración inicial de coordenadas (no quedó como script en el repo).

### Vacíos de datos encontrados (pendientes de decidir con el negocio, no bloquearon esta sesión)

1. **"ANTERIOR EMPLEO"** (segunda fila de experiencia en la plantilla): el paso 4 del formulario
   actual (`actualizarExperiencia`) solo captura **una** empresa ("última o actual", `orden = 1`).
   El código de `hojaVidaPdfService.js` ya soporta un `orden = 2` si algún día existe (no truena si
   no viene, simplemente no imprime esa fila) — pero hoy esa sección de la plantilla siempre queda
   en blanco. Si el negocio quiere capturar una segunda empresa, hay que ampliar el paso 4 del
   formulario (`Experiencia.jsx` + `actualizarExperiencia`) para permitir un segundo registro.
2. **Autoevaluación de Excel/PowerPoint/Word**: `hyd_candidato_personal` los captura por separado
   (`conocimiento_excel/powerpoint/word`), pero la plantilla solo imprime **una** casilla combinada
   ("Autoevaluación en herramientas ofimáticas... califíquese de 1 a 5") — se usó el campo general
   `autoevaluacion`. Los 3 valores individuales siguen guardándose en BD pero no se imprimen en
   ningún lado del documento.

### Verificación realizada

Generado un PDF de prueba con datos **deliberadamente largos/variables** (nombre de 5 palabras,
correo de más de 60 caracteres, funciones de un párrafo completo, dirección larga, textos libres de
página 2 largos) para estresar el ajuste de fuente — reforzado explícitamente por el usuario durante
la sesión ("recuerda que la información de la hoja de vida es variable"). Revisado visualmente en 3
iteraciones (render real del PDF, no solo el código) — se encontraron y corrigieron 2 bugs de
coordenadas: la fila "Datos básicos" (demasiado angosta para el patrón "valor debajo de la
etiqueta") y "Motivo de retiro" de la empresa actual (coordenada X pisaba la propia etiqueta
"RETIRO:"). Corrido además un smoke test **dentro de `hidrabackend`**, usando su propio `pdf-lib`
recién instalado (no el de `firmacloudbackend`, donde se hizo el desarrollo/calibración inicial
porque ya tenía `pdf-lib`/`pdfjs-dist` instalados) — generó el PDF sin errores
(`generarHojaVidaPdf()` importado y ejecutado con datos de prueba realistas, 1.02MB de salida).

### Pendiente

- [ ] **Conectar `generarHojaVidaPdf()` al flujo real**: llamarla cuando el candidato complete el
  paso 5 (Personal) — hoy ese punto dispara `emailService.enviarNotificacionCompletado()`
  (`candidatoFormulario.service.js`, función `actualizarConsentimiento`, aunque el disparo debería
  moverse al final de `marcarPersonalCompletado`, no de consentimiento, una vez el paso 6 se
  reemplace). Esto depende de que exista el endpoint `POST /api/reclutamiento/send` del lado de
  FirmaCloud, que a la fecha de esta sesión sigue solo en fase de plan
  (`planReclutamiento.md`), no implementado.
- [ ] **Reemplazar `Consentimiento.jsx`** (paso 6) por la pantalla de cierre ("Revisa tu correo/
  WhatsApp para firmar") una vez el hand-off esté conectado — decisión ya confirmada con el usuario,
  falta implementarla.
- [ ] **Resolver los 2 vacíos de datos** de arriba (segunda empresa, sub-puntajes de ofimática) con
  el negocio, si se decide que deben quedar reflejados en el documento firmado.
- [ ] **Acordar con FirmaCloud el contrato exacto de envío** (multipart directo vs. JSON+base64 del
  PDF) — ya documentado como pendiente del lado de `planReclutamiento.md`.
- [ ] Guardar el `id` que devuelva `POST /api/reclutamiento/send` en una columna nueva de
  `hyd_candidatos` (ej. `firmacloud_signature_id`) para poder correlacionar y consultar el estado
  después — todavía no existe esa columna ni la migración.

---

## Sesión 2026-08-19 (sexta ronda): plantilla de tratamiento de datos + Hydra arma los 2 PDFs

### Decisión de arquitectura: Hydra también arma el tratamiento de datos, no solo la hoja de vida

El plan original (sesión anterior) asumía que FirmaCloud tendría su propia plantilla fija para el
tratamiento de datos, y que Hydra solo mandaba la hoja de vida. El usuario preguntó si convenía que
Hydra manejara también ese documento — **se decidió que sí**, y quedó actualizado en
`planReclutamiento.md` de `firmacloudbackend`:
- El texto legal de tratamiento de datos ya vive en Hydra (era el mismo Ley 1581/2012 de
  `Consentimiento.jsx`) — un solo dueño del contenido legal, sin coordinar despliegues con FirmaCloud
  para cambios de texto.
- FirmaCloud queda como un **motor de firma puro** para todo el módulo: detecta y estampa en
  cualquier PDF que Hydra le mande, usando el mismo mecanismo de detección de ancla para los 2
  documentos (ya no hay coordenadas fijas propias de FirmaCloud para nada de este módulo).
- Encaja con el flujo real: el botón "Ver tratamiento de datos" (que aparece al terminar el
  formulario) necesita que **ambos** documentos ya estén armados en ese momento — un solo motor de
  generación en Hydra, no dos sistemas preparando cada uno su parte.

`POST /api/reclutamiento/send` (lado FirmaCloud, todavía en plan) pasa a recibir **2 archivos**
(`cvFile` + `tratamientoFile`), no solo uno.

### Plantilla real de tratamiento de datos

El usuario cargó `plantilla/AUTORIZACIÓN TRATAMIENTO DE DATOS -BOG 1111.pdf` — documento oficial de 5
páginas ("AUTORIZACIÓN PARA EL TRATAMIENTO DE DATOS PERSONALES DE ASPIRANTES, EMPLEADOS Y
EXEMPLEADOS DE ASISTE ING S.A.S.", v2.0, GH-RL-F-03). A diferencia de la hoja de vida, es casi todo
texto legal fijo — solo tiene **6 espacios en blanco reales**:
- Página 1: nombre completo, tipo de documento, número de documento (dentro de la frase "Yo ___
  mayor de edad, Identificado (a) con ___ No. ___ domiciliado (a) en esta ciudad").
- Página 5: ciudad, día, mes (dentro de "Se firma... en la ciudad de ___ el día ___ del mes de ___
  del año 2026.") + la línea de firma + "Nombre trabajador:"/"Documento:".

**Texto ancla de firma: `"FIRMA"`** (verificado único en las 5 páginas del documento) — mismo
mecanismo de detección que va a usar FirmaCloud para la hoja de vida (`"FIRMA DEL CANDIDATO"`).

**Coordenadas de los 3 blancos de página 1** vienen de un solo `text run` fusionado por el PDF (ej.
`"__________________ No. ____________________ dom"` es un único fragmento de texto, no 3 separados)
— se calibraron por proporción de caracteres dentro del ancho real medido con `pdfjs-dist`, mismo
criterio que ya usa FirmaCloud en `pdfService.js` para posicionar valores después de etiquetas
fusionadas. Mismo caso para los 3 blancos de página 5.

**Nota, no bloqueante:** el "año 2026" viene impreso como texto fijo en el documento legal, no como
campo editable — si se sigue usando en 2027, hay que pedir una versión actualizada del documento a
quien lo redactó (fuera del alcance de este llenado).

### Qué se implementó

- **`services/tratamientoDatosPdfService.js`** (nuevo) — `generarTratamientoDatosPdf(candidato)`,
  mismo shape de entrada que `generarHojaVidaPdf()`. Llena los 6 espacios en blanco + deja la línea
  de firma intacta.
- **`utils/pdfFillHelpers.js`** (nuevo) — se extrajeron los helpers genéricos de "fit"/wrap
  (`fitSingleLine`, `wrapLines`, `drawTextBox`, `drawFit`, `marcarSiNo`, `fmtFecha`,
  `nombreCompleto`) que antes vivían duplicados dentro de `hojaVidaPdfService.js`, para que los
  reutilicen ambos servicios sin repetir código — es aceptable compartir helpers acá porque los dos
  servicios pertenecen al mismo módulo (candidatos/formulario) dentro del mismo repo, a diferencia
  del criterio de aislamiento estricto que aplica entre repos distintos (FirmaCloud vs. Hydra).
- **`hojaVidaPdfService.js` refactorizado** para importar de `utils/pdfFillHelpers.js` en vez de
  tener su propia copia — verificado que el refactor no cambió el comportamiento (mismo PDF de
  prueba, mismo tamaño de archivo exacto en bytes antes/después).

### Verificación realizada

Generado un PDF de prueba con nombre largo (5 palabras) para estresar el fit — igual que con la hoja
de vida. Revisado visualmente en 2 iteraciones: la primera mostró 2 espacios sin separación
("ciudad de**Bogotá**", "día**19**" pegados a la palabra anterior por quedarse corto el margen
calculado por proporción de caracteres); corregido ajustando esas 2 coordenadas ~5pt a la derecha.
Segunda iteración: las 5 páginas se ven correctas, el texto llenado no se sale de ningún blanco ni
pisa el texto legal fijo, la frase final lee natural ("...en la ciudad de Bogotá D.C. el día 19 del
mes de agosto del año 2026."). Página 1 quedó bien desde el primer intento.

### Pendiente

- [ ] Todo lo ya listado en la sesión anterior (conectar al flujo real, reemplazar
  `Consentimiento.jsx`, resolver vacíos de datos, acordar contrato con FirmaCloud, columna de
  correlación) — sigue igual, ahora con el agregado de que `generarTratamientoDatosPdf()` también
  debe llamarse junto con `generarHojaVidaPdf()` en ese mismo punto de disparo.

---

## Sesión 2026-08-19/20 (séptima ronda): conexión real con FirmaCloud, despliegue a producción,
## y ajustes finales de coordenadas + límites del formulario

Resumen de alto nivel de todo lo que pasó después de la sexta ronda — el detalle día a día quedó en
la conversación, no todo se documentó archivo por archivo acá; lo último y más reciente está en
**`claude/lastcontext.md`** (nuevo, ver ese archivo para el detalle completo de coordenadas y
límites de campo).

### Conexión real con FirmaCloud

- **`services/firmacloudDispatchService.js`** (nuevo): `enviarAFirmaCloud(candidatoId)` genera los 2
  PDFs y hace `POST /api/reclutamiento/send` (multipart, `fetch` nativo + `FormData`/`Blob`) contra
  `firmacloudbackend`, con `X-Api-Key: FIRMACLOUD_API_KEY`. Guarda el `id` devuelto en
  `hyd_candidatos.firmacloud_signature_id` (columna nueva,
  `database/migrations/008_firmacloud_signature_id.sql`, aplicada en local y producción) vía
  `repositories/candidatoFormulario.repository.js` → `guardarFirmaCloudId()`.
- **Punto de disparo**: al final de `actualizarConsentimiento`
  (`services/candidatoFormulario.service.js`) — diseño "mínimo" acordado explícitamente con el
  usuario (permite probar de inmediato sin rediseñar el paso 6 todavía): si `enviarAFirmaCloud` falla,
  no revierte ni bloquea el guardado del consentimiento, solo devuelve
  `firmacloudDispatch: { ok: false, error }` en la respuesta.
- **Redirección sin fricción** (`hidrafrontend/src/components/candidato/Consentimiento.jsx`): pedido
  explícito del usuario — en cuanto el candidato completa el checkbox, debe caer **directo** en la
  página de firma de FirmaCloud, sin pasar por revisar su correo. Si
  `resultado.firmacloudDispatch.ok && firmarUrl`, hace `window.location.href = firmarUrl`; si no,
  cae al comportamiento anterior (alerta + `window.close()`) como fallback.

### Fricción de puertos en local (resuelta y luego revertida)

`firmacloudbackend`/`hidrabackend` comparten puerto 3000 por defecto, y sus frontends comparten 5173
— varias iteraciones de prueba y error hasta asentar: **FirmaCloud se queda en sus puertos
originales** (3000/5173, sin tocar), **Hydra se mueve a 3001/5174 solo en local** (`dev:3001` con
`cross-env` en `package.json`, `--port 5174 --strictPort` en el frontend). Antes de desplegar a
producción, todo ese scaffolding de puertos alternos se **revirtió** en Hydra (pedido explícito del
usuario: "deja los puertos como estaban originalmente") — `package.json` quedó limpio, sin
`cross-env` ni script `dev:3001`; `.env` de Hydra volvió a apuntar `FIRMACLOUD_API_URL` a
`http://localhost:3000/api`.

### Despliegue a producción

Hecho por el usuario en sus propios servidores (sin acceso SSH de Claude), con los comandos exactos
provistos en la conversación. Hydra primero, después FirmaCloud
(`migration_reclutamiento.sql` corrida ahí → agente sistema quedó con `id = 3`, distinto al `id = 6`
de local). 2 bugs de despliegue encontrados y corregidos en el `.env` de producción de FirmaCloud
(detalle completo en `Backend firmacloud/firmacloudbackend/claude/planReclutamiento.md`, sección
"Estado (2026-08-20)"): `RECLUTAMIENTO_EMAIL_FROM` truncado (faltaba `@gmail.com`) y
`HYDRA_AGENT_ID` sin confirmar contra la BD real de producción.

### Correcciones de coordenadas de la hoja de vida (3 rondas, con datos reales de producción)

Después de una prueba real en producción, el usuario fue dando correcciones puntuales de posición
(desplazamientos en puntos, arriba/abajo/izquierda/derecha) sobre `hojaVidaPdfService.js`, verificadas
cada vez regenerando un PDF de prueba. 2 bugs reales encontrados en el camino (no de coordenadas):
- **`fmtFecha` corría un día hacia atrás** (`utils/pdfFillHelpers.js`): `new Date('2025-08-15')` se
  interpreta en UTC medianoche, y `toLocaleDateString` sin fijar zona horaria formatea en la zona
  local del servidor (Bogotá, UTC-5) — corregido agregando `timeZone: 'UTC'`.
- **`tiempo_laborado` con truthy-check en vez de `!= null`**: excluía silenciosamente valores
  legítimos de `0` (ej. "0 años, 5 meses" de experiencia) — corregido.

El detalle campo por campo de la última ronda (2026-08-20) está en `claude/lastcontext.md`.

### "Anterior Empleo" y "Fecha entrevista" — confirmados como limitación de diseño, no bugs

- **"Anterior Empleo"** (segunda fila de experiencia en la plantilla): confirmado leyendo
  `hidrafrontend/src/components/candidato/Experiencia.jsx` que el paso 4 del formulario solo tiene
  campos para **una** empresa — no hay forma de que ese dato llegue hoy. Si se quiere capturarlo,
  requiere ampliar `Experiencia.jsx` + el backend para aceptar `orden = 2` (no hecho, fuera de
  alcance salvo que el usuario lo pida).
- **"Fecha entrevista"**: confirmado que `fecha_citacion_entrevista` se llena después, por el
  reclutador, en el paso separado de "Gestión de Entrevista" — normal que esté vacía para un
  candidato que recién completó el formulario inicial, no es un bug.

### Auditoría de límites de campo (2026-08-20) — ver `claude/lastcontext.md` para el detalle completo

A pedido del usuario, se generó un PDF de estrés con datos deliberadamente largos en cada campo,
usando las funciones reales de `pdfFillHelpers.js` (no una reimplementación), para confirmar qué
campos se truncan y ajustar los límites (`maxLength`) del lado del formulario de Hydra en
consecuencia. Encontró un bug real: "Conocimientos Informáticos" permitía 500 caracteres en el
formulario pero la plantilla solo tiene espacio para ~129 en una sola línea.
- [ ] Ver nota sobre el año fijo "2026" arriba — no bloqueante, pero a vigilar de cara a 2027.

## Sesión 2026-08-20/21 (octava ronda): detección dinámica de columnas, límites de campo recalculados con precisión, y visor de documentos firmados en el perfil de candidato

Continuación de la séptima ronda, trabajada junto con la sesión paralela de FirmaCloud (ver
`Backend firmacloud/firmacloudbackend/claude/planReclutamiento.md`, sección "Sesión 2026-08-20/21").
El detalle campo por campo de esta ronda está en `claude/lastcontext.md` (reemplazado); acá el
resumen permanente.

### 1. Bloque "INFORMACIÓN ACADEMICA" — de coordenadas fijas a detección dinámica de columnas

Reporte del usuario: en Bachillerato y las demás filas, Institución/Título se veían **centrados**
en su celda en vez de pegados al borde izquierdo. Causa raíz: la calibración original usaba la
misma X del **encabezado de columna** (que sí está centrado por diseño) como X del valor de cada
fila — el dato heredaba esa posición centrada en vez de arrancar en el borde real de la celda.

Fix en `utils/pdfFillHelpers.js` (nuevas `getTableBorders`/`getRowColumnBorders`, exportadas) +
`services/hojaVidaPdfService.js`: en vez de una coordenada X fija recalibrada a mano, se escanean
los trazos vectoriales reales de la tabla (`page.getOperatorList()`, filtrando líneas delgadas —
mismo patrón que usa FirmaCloud para detectar dónde firmar) en cada generación de PDF, y el valor
arranca justo después del borde izquierdo detectado de su columna. Con esto Institución/Título/Año
(y la fila fusionada de Conocimientos Informáticos) quedan alineados a la izquierda sin depender de
una calibración manual que se desalinearía si la plantilla cambia de diseño. Verificado generando
un PDF de prueba y confirmando por `getTextContent()` que los valores caen exactamente después de
cada borde real.

### 2. Límites de caracteres de los 5 pasos del formulario — recalculados con precisión, no heurística

Pedido explícito: "el limite depende de la cantidad maxima de caracteres... que se puede plasmar en
la plantilla" — con contador visible en cada campo y bloqueo duro al llegar al límite.

En vez de una heurística aproximada (ancho/3), se reutilizó la lógica real de ajuste de texto
(`fitSingleLine`/`wrapLines` de `pdfFillHelpers.js`, importadas directo, no reimplementadas) contra
texto representativo en español (nombres/instituciones/frases típicas de hoja de vida), buscando el
máximo de caracteres que caben sin truncarse a tamaño mínimo de fuente — con 10% de margen en campos
de una línea y 5% en cajas multilínea. Aplicado con `maxLength` + `.slice()` en el `onChange` +
contador "X/Y caracteres" visible, en **todos** los campos de texto libre de los 5 pasos
(`HojaVida.jsx`, `DatosBasicos.jsx`, `Estudios.jsx`, `Experiencia.jsx`, `Personal.jsx`) — antes solo
algunos campos tenían límite y contador, otros ninguno (ej. `salario_experiencia` en
`Experiencia.jsx` no tenía tope). Build y lint de `hidrafrontend` sin errores nuevos.

### 3. Nuevo apartado "Documentos Firmados" en el perfil de candidato — consulta en vivo a FirmaCloud

Pedido: poder ver/descargar desde el perfil del candidato (reclutador) los 2 documentos ya firmados
en FirmaCloud, sin que Hydra guarde copia local.

- **`services/firmacloudDispatchService.js`**: nuevas `consultarEstadoFirma(whereClause, params)` y
  `descargarDocumento(whereClause, params, tipo)` — junto a `enviarAFirmaCloud` ya existente, mismo
  archivo de integración. Llaman a `GET /api/reclutamiento/:id` y
  `.../download/{cv|tratamiento}` de FirmaCloud con la misma `FIRMACLOUD_API_KEY` ya usada para
  enviar. Devuelven `{ enviado: false }` sin llamar a FirmaCloud si el candidato aún no tiene
  `firmacloud_signature_id` (no llegó al paso de Consentimiento); propagan el status real de
  FirmaCloud (404/400/etc.) en vez de aplanarlo todo a un error genérico.
- **`repositories/candidatoFormulario.repository.js`**: `obtenerCandidatoParaFirma(whereClause,
  params)` — SELECT liviano (`id, firmacloud_signature_id, reclutador_id`), sin el JOIN pesado de
  `obtenerCandidatoConFormulario`.
- **`controllers/candidato.controller.js`**: `getEstadoFirma`/`descargarDocumentoFirmado`, con el
  mismo chequeo de dueño que ya usa `getPerfilCompleto` (selección/administrador ven cualquier
  candidato, `reclutador` solo los suyos) — factorizado en la función suelta `construirWhereDueno`
  (no método de clase: la mayoría de rutas de este controller se registran sin
  `.bind(candidatoController)`, así que `this` no está disponible dentro de los handlers).
- **`routes/candidato.routes.js`**: `GET /candidato/firma-estado/:candidatoId` y
  `GET /candidato/firma-documento/:candidatoId/:tipo` (`tipo` = `cv`\|`tratamiento`), protegidas
  igual que `/perfil/:candidatoId`. La API key de FirmaCloud nunca llega al navegador.
- **Frontend**: `services/api.js` (`getEstadoFirma`, `getDocumentoFirmadoBlob` — mismo patrón blob
  que `getPdfDesprendible`) + nueva tarjeta "Documentos Firmados" en
  `components/reclutador/PerfilCandidato.jsx` (badge de estado Pendiente/Visto/Firmado; si está
  firmado, 2 botones que abren cada PDF en pestaña nueva vía blob URL).

Verificado con BD y `fetch` simulados (sin conexión real a FirmaCloud/MySQL): candidato
enviado+firmado, descarga de documento, candidato aún no enviado (`{enviado:false}` sin llamar a
FirmaCloud), y candidato de otro reclutador (rechazado con 404, sin filtrar info). Build y lint de
`hidrafrontend` sin errores nuevos.

### Estado de despliegue

Todo commiteado y pusheado: `hidrabackend` → `1a09aa1 "ajustes firma"` (incluye también los ajustes
de coordenadas de rondas anteriores ya committeados por separado, ver commits previos
`ajuste coordenadas`/`ajustecoo`/`ajuste coordenadas 2`/`ajuste coordenadass`), `hidrafrontend` →
`954adf0 "limite form"` + `00e583f "ver cartas firmadas"`. **Pendiente confirmar despliegue a
producción** de esta ronda (no confirmado en esta conversación).

---

## Sesión 2026-08-21 (novena ronda): Campaña/catálogos, motivo de inasistencia, paginación+orden de
## Selección, fix de "Marcar como Citado", módulo de Antecedentes

Detalle campo por campo en `claude/lastcontext.md` (reemplazado con el de esta ronda). Acá el
resumen permanente.

1. **Formulario "Nuevo Candidato"**: label "Cliente" → "Campaña" (campo interno `cliente` sin
   cambios), se quitaron `Claro`/`Majority` del catálogo de campañas, `Portal Web` → `Computrabajo`
   en fuentes de reclutamiento. Candidatos históricos con esos valores se siguen viendo vía el
   patrón de "valor histórico inyectado" ya usado para `tipo_documento`. **Hallazgo de la sesión,
   sin resolver**: el módulo de Selección ya usa "Campaña" para un campo distinto (`cargo`, no
   `cliente`) — el usuario decidió seguir adelante con "Campaña" en Reclutamiento de todas formas,
   queda la inconsistencia de nombres entre módulos.

2. **Motivo de inasistencia obligatorio** al marcar "No asistió" (catálogo de 12 valores del Excel,
   incluye "Otra" de texto libre) — migración `009_motivo_inasistencia.sql`
   (`hyd_candidatos.motivo_inasistencia VARCHAR(150)`), validado en `marcarAsistencia`
   (`seleccion.controller.js`), modal de `CandidatosSeleccion.jsx` rediseñado (selección primero,
   motivo condicional, un solo botón "Guardar" al final en vez de guardar al primer clic).

3. **Paginación de "Candidatos" en Selección** (`candidatos-citados`, antes traía las 1984+ filas
   sin límite) — migración `010_indice_candidatos_citados.sql` (índice compuesto
   `fecha_citacion_entrevista, created_at, id`), filtros server-side. **Orden corregido dos veces**:
   se empezó con "cita más antigua primero" (para priorizar casos atrasados) pero eso subía filas
   con fechas basura de una importación vieja (ej. "2001-01-01") — se cambió a "cita más reciente
   primero" (`DESC`) a pedido del usuario, manteniendo la prioridad de evaluación pendiente. Índice
   sigue usándose (verificado con `EXPLAIN`), sin pérdida de rendimiento.

4. **Bug real encontrado y corregido: "Marcar como Citado" podía dejar la cita sin fecha.** Un
   candidato del usuario quedó `estado='citado'` con `fecha_citacion_entrevista=NULL` (invisible
   para Selección) porque "Marcar como Citado" (`PerfilCandidato.jsx`/`ListaCandidatos.jsx`) y
   "Programar fecha" eran dos acciones independientes y desconectadas. Fix: `actualizarFechaEntrevista`
   (único endpoint que escribe la fecha) ahora también avanza `estado` a `'citado'` en la misma
   operación atómica cuando el candidato viene de un estado temprano, sin retroceder un estado ya
   más avanzado. Ambos botones ("Marcar como Citado"/"Citar") pasaron a abrir un modal que exige
   fecha/hora antes de confirmar, en vez de cambiar el estado directo.

5. **Nuevo módulo: Antecedentes** (ADRES/POL/COMP/PROCU, bloque del Excel oficial) en el perfil del
   candidato — visible solo si `asistio_citacion = 'asistio'`. Migración
   `011_antecedentes.sql` (4 ENUM de estado + 1 documento compartido + `fecha_antecedentes`).
   **Primera vez que el proyecto acepta archivos subidos por usuarios** (no solo PDFs generados
   internamente) — se agregó `multer`, `middleware/upload.middleware.js` (disco en
   `uploads/antecedentes/`, nombre por `uuid`, solo PDF/JPG/PNG, 10MB máx.), `uploads/` agregado a
   `.gitignore`. Endpoints nuevos `PUT`/`GET` en `candidato.controller.js`, mismo criterio de dueño
   (`construirWhereDueno`) que el resto del perfil. **Diseño en transición**: el usuario pidió al
   cierre de la sesión que cada una de las 4 verificaciones tenga su propio documento independiente
   (no uno compartido) — el rediseño completo quedó planeado (ver `claude/lastcontext.md`, §5) pero
   sin implementar todavía, para continuar en la próxima sesión.

6. **Hallazgos sin resolver, informados al usuario pero sin decisión al cierre**: (a) "Candidatos"
   de Reclutamiento no tiene pestaña para `aprobado`/`rechazado`/`aprobado_final`/`rechazado_final`/
   `contratado` — un candidato ya evaluado/decidido no aparece en ninguna pestaña de esa pantalla
   (sí en "CandidatosT"); (b) 17 candidatos con `asistio_citacion='asistio'` pero `estado='nuevo'`,
   remanente del reseteo masivo de `estado` del 2026-08-13 (dato histórico corrupto, no un bug del
   código actual — verificado que `marcarAsistencia` funciona bien hoy).

### Estado de despliegue

**Nada de esta ronda está commiteado** — todo queda como cambios locales sin commit en ambos repos
al cierre de la sesión (detalle completo de archivos tocados en `claude/lastcontext.md`, §7).
Pendiente: aplicar migraciones 009/010/011 en producción, `npm install` (multer) en el servidor, y
asegurar que `uploads/antecedentes/` persista entre despliegues en producción.

---

## Sesión 2026-08-21 (décima ronda): Antecedentes — 4 documentos independientes con arrastrar y
## soltar, y estado Aprobado/No aprobado con novedad obligatoria en modal

Continúa directo el diseño en transición que quedó pendiente al cierre de la novena ronda (ver
punto 5 arriba) y le agrega dos pedidos nuevos del usuario en esta sesión: cada verificación con su
propia caja de arrastrar y soltar, y el estado pasa de "Aprobado/Novedad" a "Aprobado/No aprobado"
(con un modal obligatorio para escribir la novedad solo cuando se marca "No aprobado").

**Confirmado con el usuario (`AskUserQuestion`) antes de tocar código**: cada una de las 4
verificaciones se auto-guarda independiente (sin botón general "Guardar Antecedentes" — se guarda
sola apenas se elige un estado o se suelta un archivo), y la caja de archivo queda siempre
disponible y opcional tanto en "Aprobado" como en "No aprobado" (nunca obligatoria).

1. **Esquema**: como la migración `011_antecedentes.sql` de la novena ronda nunca se desplegó a
   producción (se verificó `COUNT(*) = 0` sobre las columnas antes de tocar nada), se reescribió en
   el lugar en vez de encadenar una migración correctiva. Pasó de 6 columnas compartidas a 21: por
   cada verificación (`adres`/`pol`/`comp`/`procu`) ahora hay `antecedentes_<key>` (ENUM
   `aprobado`/`no_aprobado`, ya no `aprobado`/`novedad`), `antecedentes_<key>_novedad`
   (texto de la novedad, obligatorio solo cuando el estado es `no_aprobado`), y su propio par
   `antecedentes_<key>_documento`/`_documento_nombre` — más `fecha_antecedentes` (última
   actualización de cualquiera de las 4). Aplicado en local con un script de un solo uso (borrado
   después de correr).

2. **Backend** (`controllers/candidato.controller.js`, `routes/candidato.routes.js`): tabla de
   configuración `CAMPOS_ANTECEDENTES` (4 entradas) reemplaza la lógica repetida 4 veces.
   `uploadAntecedentes.single('documento')` → `.fields([...])` (4 campos,
   `documento_adres`/`documento_pol`/`documento_comp`/`documento_procu`). `actualizarAntecedentes`
   recorre la config: cada estado/novedad/archivo se guarda independiente en la misma petición si
   viene, sin exigir los otros 3; exige la novedad (no vacía, se recorta con `trim()`) cuando el
   estado enviado es `no_aprobado`, 400 si falta; al volver a `aprobado` limpia la novedad vieja de
   esa verificación. El borrado del documento reemplazado sigue siendo *fire-and-forget* (mismo
   patrón que ya usaba el diseño anterior), disparado después de confirmar el `UPDATE`. Descarga
   pasa de `/antecedentes/:candidatoId/documento` a `/antecedentes/:candidatoId/documento/:tipo`
   (`tipo` = `adres`\|`pol`\|`comp`\|`procu`, 400 si no es uno de los 4).

3. **Frontend** (`PerfilCandidato.jsx`): la tarjeta pasa de un formulario batch (4 selects + 1
   input de archivo compartido + botón único) a 4 tarjetas independientes, cada una con: badge de
   estado, 2 botones "Aprobado"/"No aprobado" (auto-guardan al hacer clic — "No aprobado" primero
   abre un modal pidiendo la novedad, con el botón "Guardar" del modal deshabilitado hasta que haya
   texto), la novedad guardada visible en rojo debajo si aplica, una caja de arrastrar-y-soltar
   propia (`onDragOver`/`onDrop` + input de archivo oculto activado por clic, mismo patrón sin
   librerías externas) que sube y guarda el archivo solo, y su propio "Ver Documento". Se eliminó
   todo el estado de formulario batch (`antecedentesForm`, `antecedentesArchivo`,
   `guardandoAntecedentes` único) a favor de estado por verificación
   (`guardandoAntecedente: { [key]: boolean }`, `dragOverAntecedente`, `abriendoAntecedente`,
   `modalNovedad`). `services/api.js`: `getDocumentoAntecedentesBlob` agrega `tipo` a la URL.

4. **Verificación**: `node --check` sobre los 2 archivos backend tocados; build + lint del
   frontend (mismo warning preexistente de antes, sin aumentar). Contra la BD/disco local reales
   (script de prueba de un solo uso, llamando al controller directo — no había contraseña de
   prueba disponible localmente para pasar por HTTP/login — candidato de prueba creado y borrado al
   final, junto con sus archivos): guardar estado sin archivo, exigir novedad al marcar no_aprobado
   (400 sin ella, 200 con ella recortada), subir documentos de 2 verificaciones en una sola
   petición sin tocar las otras 2, descargar y comparar contenido byte a byte, 404 claro al pedir
   el documento de una verificación sin cargar, 400 en tipo inválido, reemplazar un documento y
   confirmar que el archivo viejo se borra del disco y el nuevo queda activo, rechazar un valor de
   estado inválido sin tocar nada, y limpiar la novedad vieja al volver a aprobar. Los 2 scripts de
   un solo uso (aplicar el esquema en local, y el de pruebas) se borraron después de cumplir su
   función — no quedan en el repo.

5. **Refinamiento visual pedido en la misma sesión, ya con las 4 verificaciones funcionando**:
   antes cada tarjeta mostraba la caja de arrastrar/soltar siempre visible, y "Ver Documento" abría
   el archivo en una pestaña nueva. Ahora, solo frontend (`PerfilCandidato.jsx`, sin tocar backend):
   - **Aprobado + documento ya cargado**: la caja desaparece, reemplazada por dos acciones,
     "Previsualizar" (abre un modal — PDF en `<iframe>`, imagen con `<img>`, según la extensión del
     nombre guardado) y "Volver a subir" (vuelve a mostrar la caja temporalmente, con un link
     "Cancelar" para volver atrás sin subir nada; `resubiendoAntecedente: { [key]: boolean }`).
   - **No aprobado**: la caja de carga desaparece por completo (solo se ve el badge + la novedad
     guardada) — vuelve a aparecer únicamente si la verificación se marca "Aprobado" de nuevo.
   - Se agregaron `previewAntecedente` (`{ key, url, esImagen, nombre } | null`, con
     `URL.revokeObjectURL` al cerrar el modal) y `resubiendoAntecedente`; se eliminó
     `abrirDocumentoAntecedente` (pestaña nueva) a favor de `abrirPreviewAntecedente`/
     `cerrarPreviewAntecedente` (modal). Verificado con `node --check` no aplica (solo frontend);
     build + lint sin errores nuevos (mismo warning preexistente). **No se probó en un navegador
     real** — no había contraseña de prueba disponible localmente y, ofrecida la opción de resetear
     temporalmente la contraseña del admin local para poder loguearse y probar, el usuario prefirió
     quedarse con build+lint como en el resto de esta ronda.

### Estado de despliegue

**Nada de esta ronda está commiteado tampoco** — sigue sumándose a los cambios locales sin commit
de la novena ronda (mismo archivo `011_antecedentes.sql` reescrito en el lugar, no uno nuevo).
Pendiente: lo mismo que ya estaba pendiente (aplicar migraciones en producción, `npm install`,
persistencia de `uploads/`), sin cambios adicionales por esta ronda ni por el punto 5.

## Sesión 2026-08-21 (undécima ronda): se elimina por completo el concepto "oleada", y nuevo botón
## "No Citado" con motivo obligatorio en el perfil del reclutador

Dos pedidos independientes del usuario en la misma sesión, ambos ejecutados sobre los cambios sin
commitear de rondas anteriores (siguen sin commitear).

1. **Eliminación de "oleada"**: el usuario pidió quitarla del formulario Nuevo/Editar Candidato y
   de "todas las visuales". Se detectaron dos features distintas con ese nombre — confirmado con
   `AskUserQuestion` que había que borrar ambas:
   - El campo de texto simple `oleada` en `hyd_candidatos` (llenado en Nuevo/Editar Candidato solo
     para clientes Claro/Obamacare/Majority, mostrado en ListaCandidatos/CandidatosTotal).
   - El módulo completo de asignación de oleadas de Selección (tabla `hyd_oleadas`,
     `oleada_seleccion_id`, modal "Asignar Oleada" para psicólogos en CandidatosSeleccion.jsx y
     PerfilCandidato.jsx, columna numero_oleada/descripcion_oleada en PerfilesAprobados.jsx).

   **Backend**: `candidato.controller.js` — quitado `oleada` de `crearCandidato`/`editarCandidato`
   (destructuring, columnas del `INSERT`, las 4 variantes del `UPDATE` esAdmin×conEstado, y de la
   lista de columnas de `getCandidatosPorEstado`). `seleccion.controller.js` — eliminadas por
   completo `asignarOleada`, `getOleadas`, `crearOleada`, `getOleadaActual`, `getOleadasDisponibles`,
   `inicializarOleadas`, y los `LEFT JOIN hyd_oleadas`/columnas `numero_oleada`/`descripcion_oleada`
   de las 4 queries que las traían (`getCandidatosCitados`, `getCandidatosTotal`,
   `getCandidatosAprobados`, `getCandidatosRechazados`). `seleccion.routes.js` — quitadas las 6
   rutas asociadas (`/oleadas`, `/oleada-actual/...`, `/oleadas-disponibles/...`,
   `/inicializar-oleadas`, `PUT .../oleada`, `POST /oleadas`).

   **Frontend**: `NuevoCandidato.jsx`/`EditarCandidato.jsx` — quitado el input, `mostrarOleada()`,
   la validación y la nota informativa. `ListaCandidatos.jsx`/`CandidatosTotal.jsx` — quitado el
   badge/columna. `CandidatosSeleccion.jsx` — quitado el estado, `cargarOleadas`/`asignarOleada`, la
   columna de la tabla, el botón de acción y el componente `OleadaModal` completo (con su import
   `Edit3` ya sin uso). `PerfilesAprobados.jsx` — quitada columna/celda. `PerfilCandidato.jsx`
   (reclutador) — quitado el select de oleada y el botón "Asignar a Oleada" del modal de edición de
   psicólogos, dejando intacta la edición de operación/campaña de ese mismo modal.

   No se tocó el esquema de BD (columnas `oleada`/`oleada_seleccion_id`, tabla `hyd_oleadas` y los
   `.sql` históricos de migración siguen ahí, sin uso) ni el archivo huérfano
   `NuevoCandidato_clean.jsx` (no importado en ningún lado, código muerto ya desde antes).

   **Verificación**: `node --check` en los 3 archivos backend tocados; `npm run build` + `eslint`
   del frontend — los 3 errores/8 warnings que salieron ya existían antes de esta ronda (confirmado
   contra `HEAD` con `git show`), ninguno introducido por este cambio.

2. **Botón "No Citado"** en la tarjeta "Gestión del Proceso" del perfil del candidato
   (`PerfilCandidato.jsx`, reclutador), como alternativa a "Marcar como Citado" para cuando el
   reclutador decide no avanzar al candidato a entrevista — pide una observación obligatoria.

   **Esquema**: `database/migrations/012_motivo_no_citado.sql` agrega `motivo_no_citado TEXT NULL`
   a `hyd_candidatos`. Aplicado en local con un script de un solo uso (borrado después de correr).

   **Backend**: nuevo método `marcarNoCitado` en `candidato.controller.js` (mismo patrón que
   `cambiarEstado`/`actualizarFechaEntrevista`: exige `motivo` no vacío, 400 si falta; pasa el
   candidato a estado `rechazado` —el mismo bucket final que ya usa el resto del embudo, sin
   inventar un estado nuevo en el ENUM— y guarda el motivo en una sola operación; rama esAdmin igual
   que `cambiarEstado`/`editarCandidato`). Nueva ruta `PUT /candidato/no-citado/:candidatoId`
   (permiso `agendar_entrevistas`, igual que `/fecha-entrevista`).

   **Frontend**: `services/api.js` — `marcarNoCitado(candidatoId, motivo)`. `PerfilCandidato.jsx` —
   junto al botón morado "Marcar como Citado" (visible en estados `nuevo`/`contacto_exitoso`/
   `formularios_completados`, unificados en una sola condición) ahora hay un botón rojo "No Citado"
   que abre un modal con textarea obligatorio (mismo patrón que el modal de citar: estado
   `showNoCitadoModal`/`motivoNoCitado`/`guardandoNoCitado`, `abrirModalNoCitado`/
   `confirmarNoCitado`). Cuando el estado queda en `rechazado` por esta vía, el motivo guardado se
   muestra en la tarjeta.

   **Verificación**: `node --check`, `npm run build` + `eslint` (solo el warning preexistente de
   `useEffect`), y una prueba directa contra la BD local reproduciendo el `UPDATE` exacto del
   controller (candidato de prueba creado y borrado al final) — confirmó que `estado` queda en
   `rechazado` y `motivo_no_citado` se guarda correctamente. Los 2 scripts de un solo uso (migración
   y prueba) se borraron después de cumplir su función.

### Estado de despliegue

**Nada de esta ronda está commiteado** — se suma a los cambios locales sin commit de rondas
anteriores en ambos repos. Pendiente antes de producción: lo mismo que ya estaba pendiente, más
aplicar `012_motivo_no_citado.sql` (después de 009/010/011).

## Sesión 2026-08-21 a 2026-08-24 (duodécima ronda): fuente Times New Roman en la hoja de vida,
## corrección de 4 celdas que se desbordaban, y sincronización de límites de caracteres del
## formulario del candidato con la capacidad real de cada celda del PDF

Petición inicial: cambiar la fuente de "plasmado" de información de la hoja de vida (`plantilla/
hojavida.pdf`) a Times New Roman. De ahí se derivaron, en la misma sesión, un mapeo sistemático de
los recuadros reales de la plantilla, la corrección de 4 celdas que se desbordaban, una regla de
posicionamiento (etiqueta con ":" dentro del recuadro → valor en la misma línea) aclarada por el
usuario tras dos rondas de ida y vuelta, el cálculo exacto de cuántos caracteres caben en cada
campo, la sincronización de esos límites con el formulario del candidato (`hidrafrontend`, que ya
tenía una versión de este mismo feature desde el 2026-08-20), y 3 correcciones puntuales de
posición/formato pedidas al revisar el resultado.

### 1. Fuente Times New Roman

`services/hojaVidaPdfService.js`: `StandardFonts.Helvetica`/`HelveticaBold` →
`StandardFonts.TimesRoman`/`TimesRomanBold` — son de las 14 fuentes base de PDF, embebidas sin
archivo de fuente externo (no requieren `fontkit`); es lo que cualquier lector de PDF muestra como
Times New Roman. `services/tratamientoDatosPdfService.js` (el otro PDF que se firma junto con la
hoja de vida) **no se tocó** — sigue en Helvetica, pendiente de que el usuario confirme si también
debe cambiar.

### 2. Mapeo de recuadros reales de la plantilla y 4 celdas corregidas

Se generalizó a la página completa la misma técnica que ya usaba el código para la tabla académica
(`getTableBorders`/`getRowColumnBorders` en `utils/pdfFillHelpers.js`, escaneo de trazos
vectoriales vía `pdfjs-dist`), cruzada con la posición exacta de cada etiqueta impresa
(`getTextContent`). Con eso se detectaron 4 campos cuyo `maxHeight`/posición permitía dibujar texto
más allá del borde real de su celda, invadiendo la fila de abajo si el candidato escribía lo
suficiente:

- **Funciones** (empresa actual y anterior): la celda impresa mide solo 21.6pt de alto y ya la
  ocupa la etiqueta "FUNCIONES:" — no hay espacio para envolver una 2da línea sin invadir la fila
  de "Fecha de Inicio/Retiro". Redefinido como campo de una sola línea (`drawFit`, no
  `drawTextBox`), escrito junto a la etiqueta, con mucho más ancho horizontal disponible
  (`maxWidth: 510`) que compensa la falta de alto.
- **Competencias laborales** (p.2): `maxHeight` bajado de 100 a 73 — el borde real de la celda
  está en y=302.4 (encima del encabezado "Estado de salud actual"); con 100 el texto podía llegar
  hasta y=278, invadiendo esa fila.
- **Estado de salud actual** (p.2): `maxHeight` bajado de 34 a 17 — borde real en y=257.8 (encima
  de la sección de checkboxes "Marque con un (X)..."); con 34 se invadía esa sección.

Genograma y Fortalezas/Aspectos a Mejorar ya estaban bien calibrados (verificado contra el borde
real, con 0.8-7pt de margen) — sirvieron para confirmar que la técnica de mapeo es fiable.

### 3. Regla "etiqueta con ':' dentro del recuadro → valor en la misma línea"

El usuario aclaró (tras una primera aplicación demasiado amplia del principio, que hubo que
revertir) la lista exacta y cerrada de campos donde el valor debe arrancar justo después del ":"
de una etiqueta/nota impresa DENTRO del recuadro, en vez de debajo: **NOMBRE DE LA EMPRESA:**,
**CARGO DESEMPEÑADO:**, **SALARIO ($):**, **FUNCIONES:**, la nota **"...núcleo familiar :"** de
Genograma, **"Coloque mínimo dos fortalezas:"**, **"Coloque mínimo dos Competencias laborales:"**,
y **CORTO/MEDIANO/LARGO PLAZO:**. Todos los demás campos (incluyendo TODO el bloque "Datos
Personales" — nombre completo, documento, nacionalidad, celular, correo, EPS, AFP, edad, RH,
dirección, barrio, estado civil, talla de camisa — que se había movido por error a la misma línea
y tuvo que revertirse a su posición original debajo de la etiqueta) siguen arrancando "desde la
línea" como ya estaba.

Nombre de Empresa/Cargo/Salario/Corto-Mediano-Largo Plazo ya cumplían la regla (sin cambios).
Aspectos a Mejorar y Estado de Salud Actual NO la cumplen — sus notas no terminan en ":" — se
dejaron como estaban.

Para Genograma/Fortalezas/Competencias Laborales (cajas multilínea, a diferencia de Funciones que
es de una sola línea) se extendió `drawTextBox`/`wrapLines` en `utils/pdfFillHelpers.js` con los
parámetros opcionales `firstLineX`/`firstLineWidth`: la primera línea arranca junto a la nota
impresa (ancho reducido, limitado por el borde derecho de la celda), y si el texto no cabe ahí, el
resto envuelve debajo a ancho completo (sin la nota de por medio) — 100% retrocompatible, los
demás usos de `drawTextBox` sin esos parámetros se comportan igual que antes.

### 4. Cálculo exacto de capacidad por campo (máximo de caracteres sin desbordar)

Se construyeron varios scripts de un solo uso (todos borrados después de correr) que usan la fuente
TimesRoman **real embebida** y las funciones reales de ajuste (`wrapLines`/`fitSingleLine` de
`utils/pdfFillHelpers.js` — el mismo código que corre en producción) contra un corpus de texto
representativo en español, con búsqueda binaria para hallar el punto exacto donde cada campo deja
de caber sin truncarse. Primera vuelta permitía encoger la letra hasta el tamaño mínimo del campo;
el usuario pidió explícitamente NO encoger letra y calcular el límite a tamaño **estándar**
(`startSize`) — se rehizo con ese criterio, que es el que quedó vigente. Resultado: tabla completa
de capacidad máxima por campo (ver mensajes de la sesión), desde campos de una línea (ej. Nombre
completo: 64, Celular: 18 dígitos) hasta cajas multilínea de página 2 (ej. Genograma: 1457,
Competencias Laborales: 632).

### 5. Sincronización con el formulario del candidato (`hidrafrontend`)

Al pedir aplicar estos límites como `maxLength` en el formulario, se encontró que **ya existía**
este mismo feature — commit `954adf0 "limite form"` (2026-08-20), ya commiteado, en
`DatosBasicos.jsx`, `Experiencia.jsx`, `Estudios.jsx`, `Personal.jsx`, `HojaVida.jsx` — pero
calculado contra Helvetica, permitiendo encoger letra y con 5-10% de margen extra. Se actualizaron
las constantes `MAX_*` de los primeros 4 archivos a los números recalculados con Times/tamaño
estándar de hoy (`HojaVida.jsx` se dejó igual: su único límite, aspiración salarial, ya era
conservador a propósito y sigue siendo seguro). El cambio más notorio: `MAX_FUNCIONES` bajó de
**518 a 151** — consecuencia directa de la corrección de la celda "Funciones" del punto 2 (pasó de
envolver en 2 líneas a una sola línea junto a la etiqueta). Verificado con `eslint`/`npm run build`
del frontend, sin errores nuevos.

**Pendiente, no resuelto**: el campo Funciones en `Experiencia.jsx` sigue siendo un `<textarea>` de
3 filas (permite saltos de línea), pero el PDF ahora lo dibuja en una sola línea — un salto de
línea que escriba el candidato no se refleja en el PDF, el texto queda pegado. El usuario no ha
confirmado todavía si prefiere quitar los saltos de línea en el `onChange` o cambiar a un `<input>`
de una sola línea.

### 6. Tres correcciones puntuales (pedidas al revisar el PDF generado)

- **Fecha de entrevista**: la fila tiene su propio recuadro en blanco para el valor (x=180.4 a
  336.3), separado de la celda de la etiqueta — el código escribía en x=108, todavía dentro de la
  celda de la etiqueta "FECHA DE ENTREVISTA:", no en el recuadro vacío de al lado. Corregido a
  x=184.
- **Tiempo laborado**: de `"2a 7m"` a `"2 años 7 meses"` (con singular correcto: `"1 año"`/`"1
  mes"` cuando el valor es 1).
- **Autoevaluación en herramientas ofimáticas**: la plantilla trae `"CALIFIQUESE DE 1 A 5 =
  ______"` con el renglón en blanco entre x=434.2 y x=489.9; el código dibujaba el número en
  x=505, a la derecha de esa línea, no sobre ella. Corregido a x=459, centrado sobre el renglón.

### 7. Verificación

Todo verificado con `node --check` sobre los archivos backend tocados (`hojaVidaPdfService.js`,
`utils/pdfFillHelpers.js`) y regenerando un PDF de prueba con datos ficticios (candidato de prueba
armado a mano, sin tocar la BD) en cada ronda de cambios, sin errores. **No se verificó
visualmente** renderizando el PDF a imagen — no hay `poppler`/`pdftoppm` instalado en este entorno
Windows; la verificación fue por coordenadas/geometría exacta contra los trazos vectoriales y
posiciones de texto reales de la plantilla, no por inspección visual del resultado. Todos los
scripts de mapeo/cálculo usados durante la sesión (en `claude/`) se borraron después de cumplir su
función — no quedan en el repo.

### Estado de despliegue

**Nada de esta ronda está commiteado** en `hidrabackend` — se suma a los cambios locales sin
commit de rondas anteriores. En `hidrafrontend`, los 4 archivos con límites actualizados
(`DatosBasicos.jsx`, `Experiencia.jsx`, `Estudios.jsx`, `Personal.jsx`) tampoco están commiteados.
Pendiente, además de lo que ya estaba pendiente de rondas anteriores:
- Decidir si `tratamientoDatosPdfService.js` también pasa a Times New Roman.
- Decidir el tratamiento de saltos de línea en el campo Funciones de `Experiencia.jsx` (punto 5).
- Verificar visualmente el PDF generado (renderizado a imagen) en un entorno con `poppler`, o
  abriendo un PDF real generado por la app en un lector — esta sesión solo verificó por geometría.

## Sesión 2026-08-24 (décimotercera ronda): filtro de fechas y exportación a Excel en "Gestión de
## Selección"

Petición: en la pantalla de Selección (`CandidatosSeleccion.jsx`), agregar un filtro de fecha
desde/hasta y un botón para descargar un Excel filtrado por ese rango, con la estructura exacta de
columnas del Excel oficial "BASE RECLUTAMIENTO" (encabezados de 2 filas, con grupos fusionados:
CONTACTO, SEGUIMIENTO ASISTENCIA y ANTECEDENTES).

### 1. Dos campos del Excel sin dato en el sistema — aclarados con el usuario

- **PERFIL**: queda en blanco a propósito, no hay campo equivalente en `hyd_candidatos`.
- **SEGUIMIENTO ASISTENCIA (LLAMADA / GLOBAL-WA)**: el usuario aclaró que reutiliza el mismo dato
  que ya existe en el formulario "Nuevo Candidato" → sección Contacto (`contacto_llamada` /
  `contacto_whatsapp`, migración `001_nuevo_candidato_edad_contacto.sql`) — es el único dato de
  contacto que captura el sistema, así que va tanto en el bloque CONTACTO como en el de
  SEGUIMIENTO ASISTENCIA del Excel (mismos dos valores, duplicados en ambos bloques).

### 2. Backend: `exportarExcel` en `seleccion.controller.js`

Nuevo endpoint `GET /api/seleccion/candidatos-citados/exportar-excel` (mismos roles de lectura que
el resto del módulo), que exige `fechaDesde`/`fechaHasta` (formato `YYYY-MM-DD`, filtra contra
`c.fecha_citacion_entrevista`) y opcionalmente acepta `search`/`operacion`/`asistencia`/`estado`
— los mismos filtros que ya usaba `getCandidatosCitados`. Sin paginado: exporta todo lo que
matchee, no solo la página visible en pantalla.

Se agregó la dependencia `exceljs` (no había ninguna librería de Excel en el proyecto). El archivo
se arma con `ExcelJS.Workbook`, encabezado de 2 filas (24 columnas en total): las 15 columnas
simples se fusionan verticalmente (fila 1 y 2 como una sola celda), y los 3 grupos con
subcolumnas (CONTACTO: LLAMADA/WHATSAPP, SEGUIMIENTO ASISTENCIA: LLAMADA/GLOBAL-WA, ANTECEDENTES:
ADRES/POL/COMP/PROCU) fusionan horizontalmente en la fila 1 y reparten los subtítulos en la fila
2. Verificado con un script descartable que reproduce solo la lógica de armado de encabezados
(confirmó las 24 columnas y que el merge no lanza error) — se borró después de confirmar.

Mapeo de columnas → campos de `hyd_candidatos` (todos ya existentes salvo los dos del punto 1):
FECHA→`fecha_citacion_entrevista`, ANALISTA→`nombre_reclutador` (join con `hyd_usuarios`),
CAMPAÑA→`cliente`, CARGO→`cargo`, NOMBRE→concatenación de
`primer_nombre`/`segundo_nombre`/`primer_apellido`/`segundo_apellido` (mismo criterio que
`candidato.controller.js`), TIPO DE DOC→`tipo_documento`, DOCUMENTO→`numero_documento`,
EDAD→`edad`, CORREO→`email_personal`, CITADO→fijo en "Sí" (la consulta base siempre exige
`fecha_citacion_entrevista IS NOT NULL`, igual que `getCandidatosCitados`), ESTADO GESTIÓN
RECLUTAMIENTO→mismo texto/prioridad que `getEstadoTexto()` del frontend (incluye el caso
"Pendiente Decisión Final"), ASISTE ENTREVISTA→`asistio_citacion`, MOTIVO
INASISTENCIA→`motivo_inasistencia`, ANTECEDENTES→`antecedentes_adres/pol/comp/procu`,
APROBADO→`aprobacion_final`, ¿POR QUÉ NO APROBÓ?→`aprobacion_final_razon`.

`getCandidatosCitados` (el endpoint que alimenta la tabla en pantalla) también se extendió con
`fechaDesde`/`fechaHasta` opcionales, para que el filtro de fecha afecte la lista visible igual
que los demás filtros (operación/asistencia/estado) — no solo la descarga.

### 3. Frontend: filtro de fechas y botón de descarga en `CandidatosSeleccion.jsx`

Dos inputs `type="date"` ("Fecha cita desde"/"Fecha cita hasta") agregados al grid de Filtros,
integrados al mismo state `filtros` y al mismo flujo de re-fetch que operación/asistencia/estado.
Botón "Descargar Excel" junto al título de la sección Filtros: exige que ambas fechas estén
seleccionadas (alerta si falta alguna), pide el endpoint nuevo con los filtros activos como query
params, recibe un `blob` y dispara la descarga con un `<a>` temporal (`URL.createObjectURL` +
click + `revokeObjectURL`).

### 4. Verificación

`node --check` sobre `seleccion.controller.js`/`seleccion.routes.js`, `npm run build` en
`hidrafrontend` (sin errores nuevos; los 3 lint warnings/error preexistentes en el archivo —
`user` sin usar, deps de `useEffect` — ya estaban antes de esta ronda, no se tocaron). No se probó
contra una base de datos real (no hay entorno de DB disponible en esta sesión) ni se verificó
visualmente el `.xlsx` generado abriéndolo en Excel — solo se validó la lógica de armado de
encabezados/merge de forma aislada.

### Estado de despliegue

**Nada de esta ronda está commiteado**, se suma a los cambios locales sin commit de rondas
anteriores en ambos repos. `hidrabackend`: nueva dependencia `exceljs` en `package.json`/
`package-lock.json` — falta `npm install` en producción para traerla, igual que `multer` de
rondas anteriores. Pendiente, además de lo ya acumulado: probar la descarga contra datos reales y
confirmar visualmente el resultado en Excel.

## Sesión 2026-08-24 (décimocuarta ronda): botón de Excel también en "Perfiles Aprobados", y modal
## de descarga con estilo tipo Excel

Petición: agregar el mismo botón de descarga de Excel a la pantalla "Perfiles Aprobados"
(`PerfilesAprobados.jsx`), y reemplazar el flujo de descarga directa (alert + fetch) de la ronda
anterior por un modal estético con icono tipo Excel.

### 1. Backend: refactor + nuevo endpoint para aprobados

`construirWorkbookSeleccion(candidatos)` extraída como función de módulo en
`seleccion.controller.js` (arma el workbook de 2 filas de encabezado + filas de datos a partir de
un array de candidatos ya consultado) y `enviarWorkbookExcel(res, workbook, nombreArchivo)` para
las cabeceras HTTP + `workbook.xlsx.write(res)` — ambas compartidas ahora por `exportarExcel`
(citados) y el nuevo `exportarExcelAprobados`.

Nuevo endpoint `GET /api/seleccion/candidatos-aprobados/exportar-excel`: a diferencia de citados,
acá **el rango de fechas es opcional** (filtra sobre `fecha_evaluacion`, no
`fecha_citacion_entrevista` — mismo campo que ya usaban los filtros client-side de
`PerfilesAprobados.jsx`), y también acepta `operacion`/`puntajeMin`/`search` opcionales, alineados
con los filtros ya existentes de esa pantalla (`filtros.operacion`, `filtros.puntajeMin`,
`filtros.buscar`). Consulta base: `estado = 'aprobado_final' AND aprobacion_final = TRUE`. Mismas
24 columnas/estructura que el Excel de citados (reutiliza `GRUPOS_ENCABEZADO_EXCEL`/
`filaCandidatoExcel` sin cambios).

### 2. Frontend: `ModalDescargarExcel.jsx` (componente nuevo, reutilizable)

`src/components/seleccion/ModalDescargarExcel.jsx`: modal con encabezado en degradé verde
(`emerald-500` → `green-700`), icono `FileSpreadsheet` de `lucide-react` (el más parecido a un
ícono de Excel disponible en la librería que ya usa el proyecto) dentro de un cuadro blanco
redondeado con sombra, dos inputs de fecha (Desde/Hasta) prellenados desde la pantalla que lo abre,
validación inline (fechas requeridas u orden desde/hasta) y botón "Descargar" con spinner
(`Loader2` animado) mientras espera la respuesta. Es agnóstico del backend: recibe
`onDescargar(fechaDesde, fechaHasta)` como prop y deja que cada pantalla arme su propia llamada
fetch + blob + descarga; si el callback lanza error, el modal lo muestra sin cerrarse.

Prop `fechasRequeridas` controla si las fechas son obligatorias (`true` en Selección/citados,
`false` en Aprobados, igual que ya se comportaban esos filtros).

### 3. Integración en las 2 pantallas

- `CandidatosSeleccion.jsx`: se quitó el flujo anterior (botón que descargaba directo con
  `alert()` para errores/validación) — ahora el botón abre el modal
  (`fechasRequeridas`, prellenado con `filtros.fechaDesde`/`filtros.fechaHasta`).
  `descargarExcel` pasó de leer fechas de `filtros` a recibirlas como parámetros (las pone el
  modal) y de usar `alert` a `throw` (el modal captura y muestra el error).
- `PerfilesAprobados.jsx`: botón "Descargar Excel" nuevo junto a "Actualizar" en el header, abre el
  mismo modal (sin `fechasRequeridas`, prellenado con `filtros.fechaDesde`/`filtros.fechaHasta` que
  ya existían ahí como filtro client-side). `descargarExcel` nueva, mismo patrón fetch+blob.

### 4. Verificación

`node --check` sobre los 2 archivos backend tocados. `npm run build` en `hidrafrontend` sin
errores nuevos (mismos 2 lint errors/3 warnings preexistentes de ambos archivos — `user` sin usar,
deps de `useEffect` — ya estaban de antes). Prueba funcional end-to-end con `global.db.query`
mockeado y un `res` falso (sin conexión real a MySQL) para los dos controladores
(`exportarExcel`/`exportarExcelAprobados`): ambos generan el `.xlsx` completo sin lanzar error
(script descartable, borrado después). **No se abrió el archivo en Excel** para confirmar
visualmente encabezados fusionados/formato — solo se confirmó que el buffer se genera y tiene
contenido.

### Estado de despliegue

**Nada de esta ronda está commiteado**, se suma a los cambios locales sin commit de rondas
anteriores en ambos repos. Sin pendientes nuevos de infraestructura (mismo `npm install` para
`exceljs` que ya quedó pendiente de la ronda anterior).

## Sesión 2026-08-24 (décimoquinta ronda): botón "Reasignar" — un analista puede transferir un
## candidato propio a otro analista

Petición: dado que hoy un candidato queda asignado al reclutador que lo crea (`reclutador_id`,
campo que **toda** consulta/edición de un reclutador filtra con `WHERE ... AND reclutador_id = ?`
salvo administrador/selección), agregar una forma de que los analistas se transfieran candidatos
entre sí. Se propusieron 2 modelos (transferencia directa con auditoría básica, vs.
solicitud/aceptación) y el usuario eligió el simple: **transferencia directa**, sin que el
analista destino tenga que aceptar.

### 1. Backend

- **Migración `013_reasignacion_candidato.sql`**: `reasignado_por_id` (INT NULL) y
  `fecha_reasignacion` (TIMESTAMP NULL) en `hyd_candidatos`, junto a `reclutador_id` — rastro
  básico de auditoría (quién reasignó y cuándo), sin bloquear ni requerir aceptación del destino.
- **Permiso nuevo `reasignar_candidatos`** en `models/usuario.model.js` (`getPermisosRol`),
  agregado a `administrador` y `reclutador` (no a `seleccion` — el pedido es específicamente entre
  analistas/reclutadores).
- **`GET /candidatos/reclutadores-activos`** (`candidato.controller.js`,
  `getReclutadoresActivos`): lista liviana (id + nombre) de usuarios `rol = 'reclutador' AND
  activo = TRUE`, para el selector del modal. Deliberadamente separado de
  `authController.obtenerReclutadores` (admin-only, trae `candidatos_asignados` y es para el panel
  de administración) — este es accesible también al reclutador normal.
- **`PUT /candidatos/reasignar/:candidatoId`** (`reasignarCandidato`): body
  `{ nuevo_reclutador_id }`. Valida que el destino exista, esté activo y tenga rol `reclutador`.
  Mismo patrón `esAdmin` que el resto del controller (`marcarNoCitado`/`cambiarEstado`): un
  reclutador normal solo puede reasignar candidatos donde `reclutador_id = req.usuario.id` (SQL
  `WHERE id = ? AND reclutador_id = ?`); administrador/selección pueden reasignar cualquiera.
  Actualiza `reclutador_id`, `reasignado_por_id` y `fecha_reasignacion` en una sola query.
- Probado con `global.db.query` mockeado (sin MySQL real): éxito, destino inválido/inactivo, y
  `nuevo_reclutador_id` faltante — los 3 casos devuelven el código/mensaje esperado (script
  descartable, borrado después).

### 2. Frontend

- `src/services/api.js`: `getReclutadoresActivos()` y `reasignarCandidato(candidatoId,
  nuevoReclutadorId)`.
- `src/components/reclutador/PerfilCandidato.jsx` (perfil compartido por reclutador y selección,
  gateado por `isSeleccionModule`): botón "Reasignar" (ícono `UserCog`) en la tarjeta "Gestión del
  Proceso", visible solo si `user?.rol === 'reclutador' || user?.rol === 'administrador'` (mismo
  patrón de gating por rol que ya usaba el bloque de edición de operación "solo para psicólogos").
  Abre un modal simple: carga la lista de reclutadores activos (excluyendo al usuario actual),
  `<select>`, confirmar/cancelar — mismo estilo visual que el modal "No Citado" ya existente en
  este archivo.
- Detalle de UX importante: un reclutador normal (no admin) **pierde el acceso al perfil apenas
  reasigna** (deja de cumplir `reclutador_id = req.usuario.id`), así que tras confirmar con éxito
  se navega a la lista (`/hydra/reclutador/candidatos`) en vez de recargar el mismo perfil —
  recargarlo devolvería 404 "no tienes acceso". Administrador/selección sí recargan el perfil
  (mantienen acceso).

### 3. Verificación

`node --check` sobre los 3 archivos backend tocados. `npm run build` en `hidrafrontend` sin
errores nuevos (mismo warning preexistente de `useEffect` en `PerfilCandidato.jsx`, no tocado).
**No se probó contra una base de datos real** (no hay entorno de MySQL en esta sesión) ni se hizo
la prueba manual en navegador del flujo completo (abrir modal → elegir analista → confirmar →
verificar redirección).

### Estado de despliegue

**Nada de esta ronda está commiteado.** Nuevo pendiente de infraestructura: aplicar la migración
`013_reasignacion_candidato.sql` (después de la 009-012 ya pendientes, en orden).

### Corrección en la misma sesión: el botón no aparecía para el rol `seleccion`

El usuario probó con la cuenta de Laidy López, rol `seleccion` en el sistema, pero que en la
práctica también cumple funciones de reclutamiento — el botón "Reasignar" no le aparecía porque el
permiso `reasignar_candidatos` solo se había agregado a `administrador` y `reclutador` (a
propósito, según el pedido original de "entre analistas"). Como el sistema **no tiene permisos por
usuario individual** (`getPermisosRol` es un mapa fijo por rol, ver `models/usuario.model.js`), la
única forma de habilitarlo para Laidy es habilitarlo para el rol `seleccion` completo — se agregó
`reasignar_candidatos` también a `seleccion` en `getPermisosRol`, y el gate en
`PerfilCandidato.jsx` pasó a `user?.rol === 'reclutador' || 'administrador' || 'seleccion'`. Como
`reasignarCandidato` ya trataba `rol === 'seleccion'` igual que `administrador` (bypass del
`WHERE reclutador_id = ?`, mismo criterio que `getPerfilCompleto`), no hizo falta tocar el
controller — solo el modelo de permisos y el gate del botón. Verificado con `node --check`,
`npm run build`.

## Sesión 2026-08-24 (décimosexta ronda): dos bugs encontrados probando "Reasignar" en real —
## migración 013 sin aplicar (500) y `actualizarFechaEntrevista` sin bypass admin/selección (404)

Al probar el flujo de reasignación y, por separado, el flujo normal de "Marcar como Citado", el
usuario reportó dos errores en dos mensajes seguidos. Ninguno de los dos es un problema del código
nuevo de esta sesión en sí — el primero es infraestructura (migración pendiente) y el segundo es
un bug preexistente en `candidato.controller.js` que ya estaba ahí antes de esta sesión, solo que
se volvió visible ahora que `seleccion` (Laidy) edita/gestiona candidatos de otros reclutadores.

### 1. 500 al reasignar: migración 013 no aplicada en la BD local

`PUT /candidato/reasignar/:id` devolvía 500 ("Unknown column 'reasignado_por_id'"). Se verificó el
estado real de las migraciones 009-013 contra `information_schema.COLUMNS`/`STATISTICS` de la BD
local (`localhost/noviembrehidra`, confirmado por `DB_HOST`/`DB_NAME` en `.env`): 009, 011 y 012 sí
estaban aplicadas; el índice de la 010 también, con el nombre real `idx_citacion_created_id` (un
primer chequeo buscó mal el nombre del índice y dio falso negativo); solo la 013 faltaba. Se aplicó
directamente contra la BD local con un script de una sola vez (`ALTER TABLE` aditivo, sin riesgo de
datos, confirmado que apuntaba a `localhost` antes de correrlo) — no a través de un cliente `mysql`
CLI porque no hay uno instalado en este entorno Windows, se usó `mysql2` desde Node. Confirmado con
`information_schema.COLUMNS` que `reasignado_por_id`/`fecha_reasignacion` ya existen.

**Esto NO se aplicó en producción** — solo en la base de datos local de este entorno de desarrollo,
para poder seguir probando. Sigue pendiente aplicar 009-013 en producción.

### 2. 404 al citar: bug preexistente en `actualizarFechaEntrevista`

Reportado contra producción (`200.91.204.54`), sin relación con la reasignación: Laidy (rol
`seleccion`) editó un candidato ajeno (creado por otro reclutador) a "Contacto Exitoso" sin
problema, pero al citarlo (`PUT /candidato/fecha-entrevista/:id`, botón "Marcar como Citado")
recibía 404 "Candidato no encontrado o no tienes acceso".

Causa: `actualizarFechaEntrevista` era el **único** método de mutación de candidato en todo
`candidato.controller.js` sin el bypass `esAdmin` (`rol === 'administrador' || rol === 'seleccion'`)
que sí tienen `editarCandidato`, `cambiarEstado`, `marcarNoCitado`, `reenviarEmail`,
`reasignarCandidato` y los que usan el helper `construirWhereDueno`. Siempre filtraba
`WHERE id = ? AND reclutador_id = ?` contra el id del usuario actual, así que citar un candidato
ajeno (dueño ≠ usuario logueado) nunca encontraba filas que actualizar. Explica por qué editar sí
funcionaba (ese endpoint sí tenía el bypass) pero citar no.

**Fix**: se agregó el mismo patrón `esAdmin` que ya usa el resto del controller — bypassa
`reclutador_id` en el `WHERE` para `administrador`/`seleccion`, lo mantiene para `reclutador`
normal. Verificado con `node --check` y una prueba funcional con `global.db.query` mockeado (script
descartable, borrado después): `seleccion` citando un candidato ajeno ahora responde 200; un
reclutador normal citando un candidato ajeno sigue respondiendo 404 (no se relajó la seguridad para
ese caso). Se auditaron todos los demás `WHERE ... AND reclutador_id = ?` del archivo — no hay más
casos del mismo bug.

**Tampoco desplegado** — el fix solo existe en el working tree local sin commitear; en producción
el 404 persiste hasta que se despliegue.

### Verificación general de la ronda

`node --check` sobre `controllers/candidato.controller.js`. Sin cambios en frontend en esta ronda
(ambos fixes son puramente backend). No se corrió `npm run build` porque no se tocó ningún archivo
`.jsx`/`.js` del frontend.

### Estado de despliegue

**Nada de esta ronda está commiteado.** La migración 013 quedó aplicada solo en la BD local de
este entorno (no en producción). El fix de `actualizarFechaEntrevista` solo existe en el working
tree local (no commiteado, no desplegado) — en producción el bug original sigue activo.

## Sesión 2026-08-24 (décimoséptima ronda): rediseño del paso 6 del formulario (ya no es un
## "consentimiento" propio) + el candidato ya no ve su hoja de vida en FirmaCloud, solo el
## tratamiento de datos

Dos pedidos relacionados del usuario, consecuencia directa de que desde la décimocuarta ronda
(2026-08-20) el consentimiento real ya no lo da un checkbox en Hydra sino la firma electrónica en
FirmaCloud (ver `claude/planReclutamiento.md` del repo `firmacloudbackend`, sección "Estado
(2026-08-20)"): el checkbox del paso 6 quedó redundante/legalmente confuso, y de paso el usuario
pidió que el candidato tampoco pueda ver su propia hoja de vida al firmar, solo el tratamiento de
datos.

### 1. Frontend Hydra: `Consentimiento.jsx` deja de simular un consentimiento que ya no aplica

`hidrafrontend/src/components/candidato/Consentimiento.jsx` (paso 6/6, único componente tocado):

- Se quitó el bloque legal completo ("AUTORIZACIÓN TRATAMIENTO DE DATOS - LEY 1581/2012" + lista +
  "Mis derechos") y el checkbox "He leído y acepto la autorización para el tratamiento de datos
  personales" — el consentimiento real ahora se da firmando en FirmaCloud, tenerlo también acá era
  redundante y, peor, técnicamente falso (el checkbox nunca se enviaba al backend — `formData` que
  viaja a `actualizarConsentimiento` nunca incluyó `consentimiento_aceptado`, era puramente un gate
  de UI local). En su lugar, un mensaje breve y profesional: "¡Gracias por completar tu hoja de
  vida!" + explicación de que a continuación se lee y firma el tratamiento de datos.
- Se eliminó el estado `consentimientoAceptado` y toda su lógica asociada (el `useEffect` que lo
  seteaba desde `candidato.consentimiento_aceptado`, la validación que bloqueaba el submit, el
  `disabled` del botón).
- Colores del header: de rojo (`red-600`/`red-800`/`red-100`/`red-200`/`red-700`/`red-600`) a azul
  ASISTE (`blue-*` equivalentes), consistente con el resto de la paleta ya usada en el archivo
  (`bg-blue-50`, `focus:ring-blue-500`).
- Botón final: "🎯 Finalizar Proceso" → "Ver Tratamiento de Datos" (ícono `FileSignature` de
  `lucide-react` en vez de emoji), estado de carga "Finalizando..." → "Redirigiendo...".
- **No se tocó** `handleSubmit`/`ApiService.actualizarConsentimiento` ni el resto del flujo (sigue
  guardando ciudad/día/mes/año y redirigiendo a `firmarUrl` de FirmaCloud si `firmacloudDispatch.ok`)
  — el cambio es puramente de UI/copy en ese bloque.

Verificado con `npx eslint` sobre el archivo: solo el warning preexistente de dependencias de
`useEffect` (ya estaba antes, no introducido).

### 2. FirmaCloud (repo aparte, `firmacloudfrontend`): el candidato ya no visualiza su CV

Pedido explícito: "no es necesario que el candidato pueda visualizar la hoja de vida con los datos
plasmados... que solo pueda ver el tratamiento de datos". Investigado el flujo real de firma
(`firmacloudfrontend/src/pages/FirmarCV.jsx`, 3 pasos: ver CV → ver tratamiento → firmar, misma
firma estampada en ambos PDFs) y decidido que el ajuste va **solo en el frontend de FirmaCloud**, no
acá ni en el backend de FirmaCloud — la firma se sigue aplicando a los 2 documentos igual que
siempre (`reclutamientoPublicController.submitSignature`, sin tocar), el candidato simplemente ya no
ve ni descarga el CV antes de firmar. Detalle completo del cambio (STEPS reducido a
`['tratamiento', 'sign']`, simplificación de `loadDoc`/`activeData`/`goToNextStep`, ajuste del texto
legal del paso de firma) en `firmacloudbackend/claude/planReclutamiento.md`, sección "Sesión
2026-08-24 — El candidato ya no ve/visualiza su hoja de vida...".

### Verificación general de la ronda

Lint (`eslint`) limpio en ambos archivos tocados (`Consentimiento.jsx` de `hidrafrontend`,
`FirmarCV.jsx` de `firmacloudfrontend`) — los avisos que aparecen en `FirmarCV.jsx` son preexistentes
(confirmado con `git stash` + lint antes del cambio). No se probó el flujo en navegador real (ni el
paso 6 de Hydra ni la página de firma de FirmaCloud) contra un candidato/token real en esta sesión.

### Estado de despliegue

**Nada de esta ronda está commiteado**, en ninguno de los 2 repos tocados (`hidrafrontend`,
`firmacloudfrontend`). Sin pendientes nuevos de infraestructura/migraciones — es un cambio puramente
de UI, no toca backend ni base de datos.

## Sesión 2026-08-26 (décimoctava ronda): bug de antecedentes en producción (carpeta faltante) +
## rediseño del formulario "Nuevo Candidato" (orden de campos + nueva tipificación Citado/Estado
## Gestión Reclutamiento)

### 1. Bug reportado en producción: subir antecedente (PDF) daba 400/500 con `ENOENT`

El usuario reportó, probando en `200.91.204.54` (prod), que subir un PDF de antecedentes desde el
perfil del candidato fallaba con `PUT /api/candidato/antecedentes/341` → 400, y en el log del
frontend: `Error: ENOENT: no such file or directory, open
'/var/www/noviembrehidra/backend/uploads/antecedentes/<uuid>.pdf'`.

**Causa raíz**: `uploads/antecedentes/.gitkeep` (la carpeta vacía que el `.gitignore` está preparado
para preservar vía `!uploads/**/.gitkeep`) **nunca se había commiteado** al repo (`git log --all --
uploads/` no devuelve nada) — así que el checkout de producción nunca tuvo esa carpeta, y
`multer` (`middleware/upload.middleware.js`), que apunta su `destination` ahí, no la crea si falta.
Esto es justo el pendiente que ya había quedado anotado en `claude/lastcontext.md` de rondas
anteriores ("Asegurar que `uploads/antecedentes/` exista y persista entre despliegues").

**Fix**: `middleware/upload.middleware.js` ahora llama `fs.mkdirSync(DIR_ANTECEDENTES, { recursive:
true })` al cargar el módulo, así la carpeta se crea sola si falta en cualquier entorno (no depende
de que el `.gitkeep` haya llegado al deploy). Verificado con `node --check`.

**Pendiente**: commitear y desplegar este archivo; mientras tanto, crear la carpeta a mano en el
servidor (`mkdir -p /var/www/noviembrehidra/backend/uploads/antecedentes`) con permisos de escritura
para el proceso Node, como fix inmediato.

### 2. Rediseño del formulario "Nuevo Candidato" (`NuevoCandidato.jsx`): orden de campos + nueva
### tipificación Citado/Estado Gestión Reclutamiento

Pedido del usuario: reordenar la información del formulario de creación de candidato (distinto de
los formularios que llena el propio candidato) siguiendo el orden de columnas del Excel "BASE
RECLUTAMIENTO" (`GRUPOS_ENCABEZADO_EXCEL` en `seleccion.controller.js`) — FECHA, ANALISTA, CAMPAÑA,
CARGO, NOMBRE, TIPO DE DOC, DOCUMENTO, EDAD, CORREO, CONTACTO (LLAMADA/WHATSAPP), PERFIL, CITADO,
ESTADO GESTIÓN RECLUTAMIENTO — y quitar el desplegable "Observaciones de Llamada" (con "Contacto
exitoso" como tipificación), reemplazándolo por "Citado" (Sí/No) y, solo si es "No", un desplegable
"Estado Gestión Reclutamiento" con una lista fija de motivos (3 sueltos + 2 grupos "NO APTO POR:" y
"NO INTERESADOS POR:").

Antes de tocar código se resolvieron 3 ambigüedades con el usuario (`AskUserQuestion`), porque FECHA/
ANALISTA/PERFIL no existían como campos del formulario y el campo `estado` actual alimenta el
Dashboard/embudo completo:
- **FECHA/ANALISTA**: automáticos y de solo lectura (fecha de hoy, nombre del usuario logueado vía
  `useAuth()`), no editables.
- **PERFIL**: campo nuevo de texto libre corto (no existía ningún dato de este tipo en el sistema —
  en el Excel quedaba en blanco a propósito).
- **Integración con `estado`**: se decidió NO tocar el campo `estado` existente (el que alimenta
  Dashboard/filtros del embudo, ver `estadosVisibles` en `candidato.controller.js`) — "Citado" y
  "Estado Gestión Reclutamiento" se guardan en **columnas nuevas**, separadas.

**Migración `014_citado_gestion_perfil.sql`** (`hidrabackend/database/migrations/`): agrega
`citado_gestion ENUM('si','no')`, `estado_gestion_reclutamiento VARCHAR(100)` y `perfil VARCHAR(255)`
a `hyd_candidatos`. `citado_gestion` es conceptualmente distinto de `fecha_citacion_entrevista`/
`estado='citado'` (la citación real a entrevista, que sigue ocurriendo más adelante en el embudo vía
"Marcar como Citado") — este campo nuevo registra si el analista logró citar al candidato durante la
**primera gestión de contacto**, al momento de crearlo.

**⚠️ La migración 014 NO se pudo aplicar en esta sesión** — el modo automático bloqueó los intentos
de ejecutar `ALTER TABLE` directamente contra la BD local (tanto por `mysql` CLI como por un script
Node usando el driver del proyecto). El usuario debe aplicarla manualmente contra
`localhost/noviembrehidra` (y luego en producción) antes de poder probar/desplegar esto.

**Backend** (`hidrabackend`):
- `models/candidato.model.js`: nuevo catálogo `estado_gestion_reclutamiento` en
  `getOpcionesCatalogo()` (entradas con `grupo`/`opciones` para los 2 grupos, entradas planas
  `{value,label}` para los 3 sueltos) — el catálogo `observaciones_llamada` existente **no se tocó**
  (lo sigue usando `EditarCandidato.jsx`, formulario de edición, fuera del alcance de este pedido).
- `controllers/candidato.controller.js`, `crearCandidato`: acepta `perfil`, `citado_gestion`,
  `estado_gestion_reclutamiento` del body y los inserta en el `INSERT INTO hyd_candidatos`.
  Validación nueva: `estado_gestion_reclutamiento` requerido si `citado_gestion === 'no'`. La
  validación preexistente de "documento obligatorio" se adaptó de `estado === 'contacto_exitoso'` a
  `citado_gestion === 'si'` (mismo criterio de negocio — se necesita identificación cuando sí se
  logró la gestión — adaptado a la tipificación nueva).
- Verificado con `node --check` en ambos archivos.

**Frontend** (`hidrafrontend/src/components/reclutador/NuevoCandidato.jsx`, único archivo tocado —
`NuevoCandidato_clean.jsx` es un duplicado sin usar, no referenciado en `App.jsx`, no se tocó):
- Secciones reordenadas: "Fecha y Analista" (panel de solo lectura, nuevo) → "Datos del Proceso de
  Reclutamiento" (Campaña, Cargo, Fuente de Reclutamiento — sin cambios de contenido) → "Datos
  Principales del Candidato" (Nombre, Tipo de Documento, Documento, Edad, Correo, Celular) →
  "Contacto" (Llamada/WhatsApp) → "Perfil y Gestión" (nueva: Perfil, Citado, Estado Gestión
  Reclutamiento condicional) → "Observaciones" (solo Observaciones Generales, ya sin el desplegable
  de Observaciones de Llamada).
- `numero_celular` y `fuente_reclutamiento` no estaban en la lista de columnas que dio el usuario
  pero siguen siendo campos requeridos existentes — se mantuvieron (celular junto a correo, fuente
  junto a campaña/cargo) en vez de quitarlos, ya que no se pidió eliminarlos.
- `formData` perdió `observaciones_llamada` (ya no se captura en este formulario) y ganó `perfil`,
  `citado_gestion`, `estado_gestion_reclutamiento`.
- `handleSubmit`: se quitó el mapeo `estadoMap` (que traducía la tipificación vieja a `estado`) —
  ahora `dataToSend` ya no fija `estado` en absoluto, así que el backend sigue usando su default
  ('nuevo'), sin tocar el campo. Validaciones adaptadas a los nuevos campos (ver arriba, backend).
- Verificado con `npx eslint`: sin errores ni warnings nuevos.

**Sigue pendiente**: aplicar la migración 014 (local y luego producción), probar el formulario en
navegador real, commitear y desplegar (`hidrabackend` + `hidrafrontend`).

### 3. Integración de "Citado"/"Nuevos Candidatos" con la tabla de candidatos del reclutador
### (`ListaCandidatos.jsx`)

Pedido de seguimiento, mismo día: que al marcar Citado=Sí en el formulario nuevo, el candidato
aparezca en el tab/filtro "Citados" de `ListaCandidatos.jsx` (la tabla "Candidatos" del reclutador),
y que el tab "Contacto Exitoso" (que ya no se llena — la tipificación que lo alimentaba se quitó en
el punto 2) se reemplace por "Nuevos Candidatos", listando todos los registros con estado='nuevo'
(que es literalmente todo candidato recién creado, ya que `crearCandidato` ya no fija ningún otro
`estado`) del más reciente al más antiguo.

- `controllers/candidato.controller.js`, `getCandidatosPorEstado`: cuando el `estado` pedido es
  `'citado'`, el WHERE se amplía a `(estado = 'citado' OR citado_gestion = 'si')` — así los
  candidatos marcados Citado=Sí en la creación aparecen en ese tab aunque su `estado` real siga en
  'nuevo' hasta que se formalice la cita de verdad vía "Marcar como Citado". El resto de los
  filtros de estado no se tocó.
- `getResumenEstados`: se agregó `'nuevo'` a `estadosVisibles` (antes era el filtro por defecto
  pero sin badge de conteo visible en la UI) y se recalcula el conteo de `citado` con una consulta
  aparte que aplica el mismo OR de arriba (el `GROUP BY estado` normal no lo captura, para no
  contar dos veces a quien ya tenga `estado='citado'`).
- `hidrafrontend/src/components/reclutador/ListaCandidatos.jsx`: el tab `contacto_exitoso` en
  `estadosConfig` se reemplazó por `nuevo: { label: 'Nuevos Candidatos', ... }` (mismo orden en la
  UI, primer tab). El orden "más reciente al más antiguo" ya lo daba el `ORDER BY updated_at DESC,
  id DESC` existente en el backend (compartido por todos los tabs) — para `estado='nuevo'` eso
  coincide con la fecha de creación salvo que alguien edite el registro antes de que avance de
  estado.
- **No se tocó** el resto de la app que también muestra/cuenta `contacto_exitoso` (la tarjeta
  "Contacto Exitoso" del Dashboard del reclutador, `Dashboard.jsx`) — el pedido fue específicamente
  sobre "la tabla de candidatos de reclutamiento". Esa tarjeta va a quedar en 0 para candidatos
  nuevos de ahora en adelante (nadie vuelve a fijar `estado='contacto_exitoso']`), pero sigue
  mostrando el histórico de los que ya lo tenían. Posible ajuste a futuro si se pide.

Verificado con `node --check` (backend) y `npx eslint` (frontend) — los 2 avisos que aparecen en
`ListaCandidatos.jsx` (`useEffect` sin `cargarCandidatos` en deps, `handleMarcarNoAsistio` sin usar)
son preexistentes, confirmado con `git stash` + lint antes del cambio.

**Sigue pendiente**: todo lo del punto 2 (sobre todo aplicar la migración 014, sin la cual
`citado_gestion` no existe y esta integración no puede probarse funcionalmente), más probar en
navegador real que el tab "Citados" efectivamente traiga a los candidatos con Citado=Sí.

### 4. Perfil del candidato (`PerfilCandidato.jsx`): mostrar los datos del formulario "Nuevo
### Candidato" + la Hoja de Vida (aspiración salarial)

Pedido de seguimiento, mismo día: el perfil del candidato (`PerfilCandidato.jsx`, compartido por
reclutador y selección vía `isSeleccionModule`) no mostraba ninguno de los campos capturados en el
formulario "Nuevo Candidato" (ni los de siempre — Fuente de Reclutamiento, Edad, Contacto Llamada/
WhatsApp, Observaciones Generales — ni los nuevos del punto 2 — Perfil, Citado, Estado Gestión
Reclutamiento), y tampoco mostraba nunca `aspiracion_salarial` (el único campo que captura el paso
1/6 "Hoja de Vida" que llena el propio candidato tras recibir el email) — se guardaba en BD pero no
se renderizaba en ningún lado del perfil.

- `repositories/candidatoFormulario.repository.js`, `obtenerCandidatoConFormulario` (la consulta
  compartida por `validarToken` y `getPerfilCompleto`): se agregó `LEFT JOIN hyd_usuarios u ON
  u.id = c.reclutador_id` y `u.nombre_completo as nombre_reclutador` al SELECT — antes no se unía
  con `hyd_usuarios` en esta consulta, así que no había forma de mostrar el nombre del analista
  (solo `reclutador_id`, el id numérico). El resto de columnas nuevas (`perfil`, `citado_gestion`,
  `estado_gestion_reclutamiento`, `fuente_reclutamiento`, `contacto_llamada`, `contacto_whatsapp`,
  `observaciones_generales`, `created_at`) ya venían incluidas por el `c.*` existente, no hizo
  falta tocar el SELECT para esas.
- `PerfilCandidato.jsx`: nueva tarjeta "Datos de Registro" en la columna izquierda (justo debajo de
  "Información Básica"), con Fecha (`created_at`), Analista (`nombre_reclutador`), Edad, Fuente de
  Reclutamiento, Contacto (Llamada/WhatsApp Sí/No), Perfil, Citado (Sí/No), Estado Gestión
  Reclutamiento (solo si Citado=No) y Observaciones Generales — mismo patrón de renderizado
  condicional que ya usaba el resto del archivo (solo se muestra cada dato si existe).
- Nueva tarjeta "Hoja de Vida" en la columna derecha (antes de "Educación"), mostrando
  `aspiracion_salarial`, condicionada a que el campo exista — que en la práctica solo pasa una vez
  el candidato entra al link que le llega por email y completa ese paso, que es justo el
  comportamiento que pidió el usuario ("si se le envía el email se debe visualizar la información
  de la hoja de vida").

Verificado con `node --check` (backend) y `npx eslint` (frontend) — el único aviso que aparece en
`PerfilCandidato.jsx` (`useEffect` sin `cargarEstadoFirma`/`cargarPerfil` en deps) es preexistente,
confirmado con `git stash` + lint antes del cambio.

**Sigue pendiente**: aplicar la migración 014 para que `perfil`/`citado_gestion`/
`estado_gestion_reclutamiento` existan de verdad en BD (sin eso esas 3 filas de "Datos de
Registro" quedan siempre vacías); probar el perfil en navegador real contra un candidato creado con
el formulario nuevo, y contra uno que ya haya completado el paso "Hoja de Vida".
