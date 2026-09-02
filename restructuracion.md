# Reestructuración de Hydra — Backend, Base de Datos y Frontend

> Documento de trabajo. Es el contrato de la reescritura: define la arquitectura destino, el
> esquema de base de datos nuevo, los cambios en el frontend y el orden de ejecución.
>
> **Fecha:** 2026-08-27
> **Repos afectados:** `ReclutamientoBackend/hidrabackend`, `ReclutamientoFronted/hidrafrontend`

---

## 0. Decisiones tomadas

| Decisión | Elección |
|---|---|
| Alcance | Backend + base de datos + frontend |
| Estrategia | Reescritura desde cero |
| Stack | El mismo: Node + Express 5 + `mysql2`. Sin ORM, sin TypeScript. Lo que cambia es la arquitectura |
| Base de datos | Nueva desde cero. Nombres en **español `snake_case`, sin prefijo `hyd_`** |
| Datos | **Base totalmente vacía.** No se migran candidatos, usuarios ni oleadas |
| Convivencia | Se reescribe **dentro de este mismo repo**; lo viejo se borra al final |
| Calidad | Migraciones versionadas con runner + tests automatizados |
| Embudo | Estado único + tabla de historial + transiciones validadas |
| Oleadas | **Se elimina** del diseño nuevo |
| Catálogos y permisos | **A tablas de base de datos**, ya no hardcodeados en JS |

---

## 1. Diagnóstico

Por qué se reescribe. Todo lo de abajo está verificado en el código actual.

### 1.1 Tres arquitecturas conviviendo en el mismo repo

Un solo módulo — el formulario público del candidato — sigue una arquitectura en capas correcta:

```
routes → controller (6 handlers de 5 líneas)
       → services/candidatoFormulario.service.js   (299 líneas, validación y reglas, cero SQL)
       → repositories/candidatoFormulario.repository.js (413 líneas, todo el SQL, promisificado)
       + utils/httpError.js como contrato de errores
```

Los otros tres controllers no tienen ninguna capa: arman SQL inline, en callbacks anidados hasta
4 niveles, sobre la variable global `global.db`.

| Archivo | Líneas | Qué mezcla |
|---|---|---|
| `controllers/candidato.controller.js` | 1284 | Validación, autorización, reglas, SQL, archivos, PDFs, analíticas |
| `controllers/seleccion.controller.js` | 991 | Todo lo anterior + ~200 líneas de construcción de Excel |
| `controllers/auth.controller.js` | 702 | 3 variantes casi idénticas de "crear usuario" |

`queryAsync` está **duplicado con implementación idéntica** en `seleccion.controller.js:7` y
`repositories/candidatoFormulario.repository.js:8`.

### 1.2 El esquema de producción no es reproducible desde el repo

- ~15 scripts `.sql` sueltos en `database/` y 3 más en `config/`, **que se contradicen entre sí**:

  | Columna | `config/database.sql` | `complete_database.sql` | `noviembrehidra_export.sql` (el real) |
  |---|---|---|---|
  | `tipo_documento` | `VARCHAR(20)` | `ENUM('CC','CE','Pasaporte','TI')` | `VARCHAR(20)` |
  | `mes_consentimiento` | `INT` | `VARCHAR(20)` | `INT` |
  | `estado` | ENUM 8 valores | ENUM 15 valores | ENUM 17 valores |
  | `cliente` / `cargo` | `VARCHAR(100)` | `VARCHAR(255)` | `VARCHAR(100)` |

- `database/complete_database.sql:141` declara una FK a `hyd_usuarios` **antes** de crear la tabla
  (línea 147): el script no corre tal cual.
- `database/migracion_completa_seleccion.sql:119` inserta en columnas `password` y `permisos` que
  **no existen** en el esquema real.
- `database/SCHEMA_DOCUMENTATION.md` se declara a sí mismo fuente de verdad y documenta 15 estados;
  el ENUM real tiene 17. Está desactualizado y así lo confirma `claude/arquitectura-y-bugs.md:50`.
- Las 16 migraciones de `database/migrations/` sí están numeradas, pero **no hay tabla
  `migraciones_aplicadas` ni runner**. Qué corrió en qué entorno se lleva a mano, en prosa, en
  `claude/arquitectura-y-bugs.md:79`.

Esta es la causa raíz documentada de los bugs #1–#4 del registro interno: `hyd_usuarios` sin
`PRIMARY KEY`, `hyd_oleadas` con nombres de columna corruptos de un JSON mal importado, y `estado`
como `int` con 7857 filas en `0`.

### 1.3 Duplicación de datos activa

Las ~37 columnas del formulario existen **a la vez** en `hyd_candidatos` y en las 6 tablas
normalizadas creadas en la migración 002. La migración `004_..._drop_columnas.sql` que las
eliminaría lleva la advertencia `⚠️ NO EJECUTAR TODAVÍA` y nunca se aplicó en ningún entorno.

Hoy hay dos fuentes de verdad para `eps`, `afp`, `nivel_estudios`, `fortalezas`, `genograma` y
otras 30 columnas. Y la separación es parcial: `sincronizarCandidatoDesdeDatosBasicos`
(`repository.js:170-185`) escribe `primer_nombre`, `numero_documento`, `numero_celular` y `edad`
**de vuelta** a la tabla vieja.

### 1.4 El embudo está roto ahora mismo

Al quitar del frontend "Gestión de Entrevista", "Marcar como Citado" y el selector de fecha del
modal "Citar", el endpoint `actualizarFechaEntrevista` — **único que escribe
`fecha_citacion_entrevista`** — quedó sin ningún llamador.

Consecuencias en producción:
- `getCandidatosTotal` filtra `WHERE fecha_citacion_entrevista IS NOT NULL` → vacío para todo
  candidato nuevo.
- El export a Excel de Selección **exige** un rango sobre esa columna → sale vacío.
- La columna FECHA del Excel sale vacía.
- `hojaVidaPdfService.js:80` tuvo que pasar a usar `fecha_envio_email` para la celda "FECHA DE
  ENTREVISTA", porque la columna correcta ya no la escribe nadie.

Existe una columna de la que dependen dos reportes y que ya casi nada escribe.

### 1.5 El avance del candidato vive en cuatro columnas paralelas

`estado` (17 valores), `citado_gestion`, `asistio_citacion` y `aprobacion_final` representan todas
"en qué punto va el candidato". La migración 014 lo admite: *"dejar esto en columnas nuevas, sin
tocar `estado` … para no romper esa lógica"*. El resultado es código como
`candidato.controller.js:104`:

```js
const condicionEstado = estado === 'citado' ? '(estado = ? OR citado_gestion = ?)' : 'estado = ?';
```

Y tres listas de estados válidos que no coinciden: `getEstadosValidos()` (17),
`estadosVisibles` (15) y `estadosValidos` de `seleccion.controller.js:472` (6).

**No existe máquina de estados.** `PUT /cambiar-estado/:id` acepta cualquier estado desde cualquier
otro; solo valida pertenencia al array.

### 1.6 Fugas de aislamiento entre reclutadores

La regla `administrador|seleccion ⇒ ve todo, reclutador ⇒ solo lo suyo` está **repetida a mano ~15
veces**, cada endpoint armando su propio par `esAdmin ? queryA : queryB`. El helper
`construirWhereDueno(req)` existe pero solo lo usan dos endpoints.

Donde no se aplicó:
- `getCandidatosCitados`, `getCandidatosAprobados`, `getCandidatosRechazados` y los **dos exports a
  Excel** hacen `SELECT c.*` sin filtro de dueño. Un `reclutador` — que tiene acceso de lectura por
  `verificarRolLectura` — descarga la base completa con PII ajena.
- Efecto visible: el reclutador ve en la lista candidatos que no son suyos y al abrir el perfil
  recibe 404, porque el detalle sí filtra. El candidato existe; la lista no debió mostrarlo.
- Las mutaciones `marcarAsistencia`, `actualizarEstado`, `guardarEvaluacion`, `tomarDecisionFinal`
  y `actualizarOperacionCampana` hacen `WHERE id = ?` **sin verificar pertenencia**, solo rol.

Causa estructural: `routes/seleccion.routes.js:10-24` define sus propios `verificarRolSeleccion` y
`verificarRolLectura` inline en vez de usar el middleware compartido. Dos sistemas de autorización
que divergieron.

### 1.7 Seguridad

| Hallazgo | Ubicación |
|---|---|
| `JWT_SECRET` con fallback hardcodeado `'hydra_secret_key_2024'` — si el `.env` no carga, se firman tokens con un secreto público del repo, sin avisar | `models/usuario.model.js:52,59` |
| Hashes bcrypt reales versionados, todos correspondientes a `admin123` | `database/noviembrehidra_export.sql:163`, `complete_database.sql:169-171` |
| PII real versionada: nombre, email, **cédula**, fecha de nacimiento, EPS, salario de un candidato | `database/noviembrehidra_export.sql:128` |
| `evaluacion_total` y `evaluacion_aprobado` los envía el cliente y se guardan sin recalcular | `seleccion.controller.js:560,605` |
| Conexión a la base como `root` sin password, sin usuario de aplicación | `.env` |
| Puerto 3306 de producción abierto a `Anywhere` en `ufw` | documentado en `claude/context.md:112` |
| `Content-Disposition` con el nombre original del archivo sin sanear (header injection) | `candidato.controller.js:452` |
| Producción sobre HTTP sin TLS: los tokens de formulario viajan en la URL sin cifrar | `index.js:13` |
| Sin rate limiting en `/auth/login` ni en los endpoints públicos por token | — |

### 1.8 Lo que falta por completo

Cero tests (`npm test` es `exit 1`), cero linter, cero CI, cero Dockerfile, **cero transacciones**
(`beginTransaction` no aparece en el repo, y hay flujos de 3 queries que pueden quedar a medias),
sin manejador de errores global, sin handler 404, sin `helmet`.

Formatos de respuesta inconsistentes: `{ error }` en tres controllers, `{ ok, message }` en
`desprendibles`. Y niveles de sanitización distintos: `seleccion` devuelve `error.message` crudo al
cliente, `candidato` lo enmascara como `'Error de base de datos'`.

**Degradación silenciosa del email:** si faltan credenciales o `sendMail` falla,
`email.service.js:97-119` devuelve `{ success: true, message: 'Email simulado...' }`. El usuario ve
"Email reenviado exitosamente" aunque no haya salido nada. Sin reintentos, sin cola, sin registro.

### 1.9 Lo que NO se reconstruye

Verificado con `grep`: no tiene ninguna referencia en el código JS actual.

| Elemento | Evidencia |
|---|---|
| `hyd_oleadas` + `oleada_seleccion_id` + `oleada` | 0 referencias en `*.js`. Tabla, FK, índices y ~20 filas semilla, todo muerto. Las rutas `/api/seleccion/oleadas` que la documentación menciona no existen |
| `notas_contacto`, `intentos_contacto`, `fecha_ultimo_contacto` | 0 referencias |
| `verificarPropietarioOAdmin`, `verificarTokenOpcional` | Exportados, jamás importados |
| `authController.logout` | No-op (el JWT es stateless) |
| 8 de los 14 permisos declarados | `eliminar_candidatos`, `editar_usuarios`, `ver_reportes`, `editar_estados_candidatos`, `ver_perfiles_completos`, `generar_reportes_seleccion`, `crear_usuarios`, `ver_usuarios` — ninguna ruta los exige |
| Columna PERFIL del Excel | Se emite siempre `''` (`seleccion.controller.js:117`) |
| Columna CITADO del Excel | Hardcodeada a `'Sí'` en todas las filas (línea 118) |
| `NuevoCandidato_clean.jsx` (frontend) | Copia de `NuevoCandidato.jsx`, no referenciada en `App.jsx` |

---

## 2. Principios de la arquitectura destino

Cinco reglas no negociables. Todo el código nuevo las cumple.

1. **El SQL vive solo en repositorios.** Los servicios no conocen SQL; los controllers no conocen
   reglas de negocio. Un controller es: validar entrada → llamar al servicio → responder.
2. **Nada de `global.*`.** El pool se importa desde `config/db.js` y se inyecta. Es lo que hace
   testeable cada capa; hoy es imposible probar nada sin una base real.
3. **Todo `async/await` sobre `mysql2/promise`.** Cero callbacks. Toda operación multi-tabla va
   dentro de `withTransaction()`.
4. **Una sola forma de validar, una sola de fallar, una sola de responder.** Un esquema de
   validación por endpoint, `HttpError` como único tipo de error de negocio, un manejador de
   errores global, un sobre de respuesta uniforme.
5. **Toda regla de negocio se valida en el servidor**, aunque el frontend ya la valide.

---

## 3. Estructura del backend

```
src/
  server.js                  # arranque HTTP y apagado ordenado
  app.js                     # construcción de Express: middlewares, rutas, error handler
  config/
    env.js                   # carga y VALIDA todas las variables; falla al arrancar si falta una
    db.js                    # pool mysql2/promise + ping de arranque + withTransaction()
    dbHistorico.js           # segundo pool, solo lectura, hacia la base vieja
  modules/
    auth/                    # login, cambio de password, verificación de token
    usuarios/                # CRUD unificado (hoy son 3 variantes casi idénticas)
    catalogos/               # clientes, cargos, EPS, AFP, ciudades, motivos
    candidatos/
      estado/                # máquina de estados: transiciones + escritura del historial
    formulario/              # los 6 pasos públicos por token
    seleccion/               # citación, asistencia, evaluación, decisión final
    antecedentes/            # 4 verificaciones + sus documentos
    documentos/              # ← construido, no estaba en el árbol original de este documento
    reportes/                # exports a Excel + estadísticas/analíticas (`/api/reportes`)
    historico/               # consulta de solo lectura de la base vieja (ver 4.9)
    trazabilidad/            # ← construido, no estaba en el árbol original: gestión propia del
                              #   reclutador (creados/gestionados/asignados, embudo, por cargo,
                              #   resultados de Agente, serie mensual) y vista de equipo/global
                              #   para quien tiene `ver_perfiles_completos`
    desprendibles/           # ← construido, no estaba en el árbol original: PDFs de nómina
                              #   (integra la API externa IntraCar), sin filtro de dueño (cada
                              #   usuario ve solo los suyos por diseño del endpoint externo)
    integraciones/
      firmacloud/
      nomina/
      email/
  shared/
    errors/                  # HttpError + catálogo de códigos
    middleware/              # autenticar, autorizar, validar, subirArchivo, errorHandler, noEncontrado
    utils/                   # nombreCompleto, sql (escape LIKE), fechas
db/
  migrations/                # 001_*.sql … numeradas e inmutables
  seeds/                     # catálogos + usuario administrador inicial
  migrate.js                 # runner: tabla migraciones_aplicadas + checksum
tests/
  integration/
  unit/
```

Cada módulo tiene siempre los mismos cinco archivos:

```
<modulo>.routes.js       # solo rutas y middlewares. Sin lógica
<modulo>.controller.js   # HTTP in / HTTP out. Sin SQL, sin reglas
<modulo>.service.js      # reglas de negocio. Sin SQL
<modulo>.repository.js   # todo el SQL del módulo
<modulo>.schema.js       # validación de entrada
```

**El módulo `formulario` actual es el patrón de referencia.** `candidatoFormulario.service.js` +
`candidatoFormulario.repository.js` ya están bien construidos: se portan casi tal cual, renombrando
tablas. No hay que inventar el patrón, hay que extenderlo a los otros módulos.

Piezas existentes que se conservan y se mueven, no se reescriben:

| Actual | Destino |
|---|---|
| `utils/httpError.js` | `src/shared/errors/HttpError.js` |
| `utils/nombreCompleto.util.js` | `src/shared/utils/nombreCompleto.js` |
| `utils/pdfFillHelpers.js` | `src/modules/integraciones/firmacloud/pdf/helpers.js` |
| `services/hojaVidaPdfService.js`, `tratamientoDatosPdfService.js` | mismo módulo (coordenadas calibradas a mano: no tocar) |
| `middleware/upload.middleware.js` | `src/shared/middleware/subirArchivo.js` (está bien hecho: uuid, whitelist de mime, 10 MB) |

---

## 4. Esquema de la base de datos nueva

Base: **`hidra`**. La vieja `noviembrehidra` queda intacta como archivo histórico de solo lectura.

Convención: `snake_case`, español, sin prefijo `hyd_`, sin abreviaturas sin tilde forzadas
(`campana` → `campania` no aplica: esa columna desaparece con las oleadas). FK reales con
`ON DELETE` explícito en todas las relaciones, y `CHECK` donde el rango importa.

### 4.1 Acceso y permisos

```
roles          (id, codigo UNIQUE, nombre)
permisos       (id, codigo UNIQUE, descripcion)
rol_permisos   (rol_id FK, permiso_id FK)              PK compuesta
usuarios       (id, nombre_completo, email UNIQUE, password_hash, rol_id FK,
                numero_documento, activo, ultimo_acceso, created_at, updated_at)
```

`rol_permisos` reemplaza la matriz hardcodeada de `usuario.model.js:getPermisosRol()`. Cambiar un
permiso deja de requerir redespliegue, y el menú lateral del frontend pasa a generarse desde
permisos reales — que es lo que cierra el desalineamiento actual entre lo que el backend permite y
lo que el sidebar muestra.

### 4.2 Catálogos

Reemplazan las ~370 líneas de `models/candidato.model.js:getOpcionesCatalogo()` (9 clientes,
~90 cargos, 14 EPS, 7 AFP, ciudades, fuentes, ~20 motivos de gestión).

```
clientes          (id, nombre UNIQUE, activo)
cargos            (id, cliente_id FK, nombre, activo)   UNIQUE(cliente_id, nombre)

catalogos         (id, codigo UNIQUE, nombre)
catalogo_valores  (id, catalogo_id FK, codigo, etiqueta, orden, activo)
                                                        UNIQUE(catalogo_id, codigo)
```

El par genérico cubre las listas cerradas pequeñas: EPS, AFP, ciudades, grupos sanguíneos,
parentescos, tipos de pariente (genograma), estado civil, género, tipos de documento, fuentes de
reclutamiento, observaciones de llamada, motivos de gestión de reclutamiento y motivos de
inasistencia.

`clientes` y `cargos` tienen tabla propia porque tienen relación entre sí y el frontend filtra
cargos por cliente. Hoy los cargos están en cinco arrays separados por cliente
(`cargos_staff`, `cargos_claro`, `cargos_obamacare`, `cargos_majority`, `cargos_campanas`),
todos compuestos sobre `CARGOS_BASE_RECLUTAMIENTO`; pasan a ser filas de `cargos` con su
`cliente_id`.

`niveles_estudios` **no** va a catálogo: se mantiene como `ENUM` en `candidato_estudios`
(`bachillerato`, `tecnico_tecnologo`, `profesional_u_otros`, `conocimientos_informaticos`), porque
los valores están acoplados a coordenadas fijas de la plantilla PDF (ver riesgo en §9) y cambiarlos
sin tocar el PDF rompe el llenado en silencio.

`si_no` y `calificaciones` no se migran: son ayudas de renderizado del frontend, no catálogos de
negocio.

### 4.3 Candidato — tabla delgada

```
candidatos (
  id,
  -- identidad
  primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
  tipo_documento_id FK, numero_documento, nacionalidad, edad,
  -- contacto
  email, celular, contacto_llamada, contacto_whatsapp,
  -- proceso
  cliente_id FK, cargo_id FK, fuente_reclutamiento_id FK,
  observaciones_llamada, observaciones_generales,
  -- asignación
  reclutador_id FK → usuarios ON DELETE SET NULL,
  reasignado_por_id FK → usuarios, fecha_reasignacion,
  -- estado
  estado ENUM(...),
  created_at, updated_at
)
```

**Sin** las ~37 columnas del formulario. **Sin** las 17 de antecedentes. **Sin** las 6 de
evaluación. **Sin** `oleada_seleccion_id`, `citado_gestion`, `asistio_citacion`,
`fecha_citacion_entrevista`, `firmacloud_signature_id`, `token_acceso`. Todo eso vive en su propia
tabla, abajo.

`reasignado_por_id` sí lleva FK real esta vez — hoy la migración 013 solo hizo `ADD COLUMN`.

### 4.4 Formulario del candidato (6 pasos)

Portadas casi tal cual de la migración 002, que ya está bien diseñada. Todas con
`ON DELETE CASCADE`.

```
candidato_datos_basicos       1:1   PK = candidato_id
candidato_personal            1:1   PK = candidato_id
candidato_experiencia_resumen 1:1   PK = candidato_id
candidato_consentimiento      1:1   PK = candidato_id
candidato_estudios            1:N   UNIQUE(candidato_id, nivel_estudios)
candidato_experiencias        1:N   UNIQUE(candidato_id, orden)  CHECK(orden BETWEEN 1 AND 3)
```

Correcciones de tipos respecto a hoy:

| Hoy | Nuevo | Razón |
|---|---|---|
| `dia_consentimiento INT` + `mes_consentimiento INT` + `ano_consentimiento YEAR` | `fecha_consentimiento DATE` | Una fecha partida en tres columnas numéricas, con los scripts contradiciéndose sobre el tipo de `mes` |
| `ano_finalizacion YEAR` | `ano_finalizacion SMALLINT` | `YEAR` tiene rango 1901-2155 y comportamiento sorpresivo |
| `tiempo_laborado_anos` / `_meses` | *(eliminadas)* | Derivables de `fecha_inicio`/`fecha_retiro`; hoy pueden desincronizarse |
| `genograma JSON` / `TEXT` según script | `TEXT` | Se unifica: los scripts viejos no coincidían |

### 4.5 Embudo — la corrección estructural principal

```
candidato_estado_historial (
  id, candidato_id FK, estado_anterior, estado_nuevo,
  usuario_id FK, motivo, created_at
)
```

**Toda** transición de estado pasa por aquí. Es lo que hace posible responder "quién movió esto,
cuándo y por qué" — hoy imposible — y lo que habilita analíticas reales del embudo (tiempo por
etapa, tasa de conversión entre etapas) en vez de las aproximaciones actuales sobre `updated_at`.

```
candidato_citaciones (
  id, candidato_id FK, fecha_citacion DATETIME, agendado_por FK,
  asistio ENUM('pendiente','asistio','no_asistio'),
  fecha_asistencia, motivo_inasistencia, observaciones,
  created_at
)
```

Absorbe `citado_gestion`, `estado_gestion_reclutamiento`, `asistio_citacion`,
`motivo_inasistencia` y `fecha_citacion_entrevista` en un solo lugar coherente. Como es 1:N,
permite **reagendar sin perder el intento anterior** — hoy reagendar pisa el dato.

Resuelve de raíz el problema de §1.4: la fecha de citación deja de ser una columna suelta que
cualquiera puede dejar en `NULL`, y pasa a ser un registro cuya existencia *es* la citación.

```
candidato_evaluaciones (
  id, candidato_id FK, evaluador_id FK, fecha, total DECIMAL(5,2),
  aprobado BOOLEAN, razon_rechazo
)
evaluacion_criterios (
  id, evaluacion_id FK, criterio, puntaje DECIMAL(5,2) CHECK (puntaje BETWEEN 0 AND 20)
)

candidato_decision_final (
  candidato_id FK PK, aprobacion BOOLEAN, razon, psicologo_id FK, fecha
)
```

`total` **se calcula en el servidor** sumando `evaluacion_criterios`, y `aprobado` se deriva del
umbral. El cliente deja de poder enviar `total: 100` con los cinco criterios en cero.

Cinco criterios en filas, no en cinco columnas: agregar o quitar un criterio de entrevista deja de
ser una migración de esquema.

### 4.6 Documentos, tokens y comunicaciones

```
candidato_documentos (
  id, candidato_id FK, tipo, ruta_archivo, nombre_original,
  mime, tamano_bytes, subido_por FK, created_at
)

candidato_antecedentes (
  id, candidato_id FK,
  tipo ENUM('adres','policia','comparendos','procuraduria'),
  estado ENUM('aprobado','no_aprobado'), novedad,
  documento_id FK → candidato_documentos,
  verificado_por FK, fecha
)                                        UNIQUE(candidato_id, tipo)
```

Cuatro filas en vez de las **17 columnas repetidas** de la migración 011
(`antecedentes_adres_*`, `_pol_*`, `_comp_*`, `_procu_*`). El código actual ya delata el problema:
`candidato.controller.js:22-27` define un array `CAMPOS_ANTECEDENTES` para poder iterar sobre las
cuatro y construir el `UPDATE` a mano.

```
candidato_tokens_formulario (
  id, candidato_id FK, token UNIQUE, expira_en,
  usado_en, revocado_en, enviado_por FK, created_at
)
```

Sustituye la columna rotativa `token_acceso`. Se conserva el historial de envíos, y un token viejo
queda **explícitamente revocado** en vez de sobrescrito — que es lo que hoy produce el
`404 Token inválido` confuso al usar un link de un correo anterior.

```
candidato_firmas (
  id, candidato_id FK, proveedor, referencia_externa, estado,
  created_at, updated_at
)

envios_email (
  id, candidato_id FK, tipo, destinatario,
  estado ENUM('enviado','fallido'), error, created_at
)
```

`envios_email` cierra la degradación silenciosa de §1.8: un `sendMail` fallido queda registrado y
se reporta como fallo, en vez de devolver `{ success: true }`.

### 4.7 Control de esquema

```
migraciones_aplicadas (version PK, nombre, checksum, aplicada_en)
```

El runner (`db/migrate.js`) aplica en orden las migraciones no registradas, dentro de una
transacción por archivo, y verifica el `checksum` de las ya aplicadas para detectar si alguien
editó una migración vieja. Es la corrección de la causa raíz de §1.2.

### 4.8 Índices

Se replican los compuestos ya analizados con `EXPLAIN` en las migraciones 007 y 010, que están bien
justificados:

- `(estado, updated_at, id)`
- `(reclutador_id, estado, updated_at, id)`

Se eliminan los **cuatro índices redundantes** que hoy empiezan por `estado` (`idx_estado`,
`idx_candidatos_estado`, `idx_estado_contacto`, `idx_estado_updated_id`, acumulados por scripts
distintos).

Limitación conocida y documentada: la búsqueda usa `LIKE '%…%'`, que no puede usar índice por el
comodín inicial. Con el volumen esperado es aceptable; si crece, la opción es `FULLTEXT` sobre
nombre, documento y email.

### 4.9 Archivo histórico (`noviembrehidra`)

La base vieja no se migra ni se importa: se consulta. El módulo `historico` la lee con un **pool
propio** (`config/dbHistorico.js`, 5 conexiones) y sin una sola escritura, para que las reclutadoras
puedan responder "¿esta persona ya se había presentado, quién la gestionó, en qué quedó?".

| Endpoint | Devuelve |
|---|---|
| `GET /api/historico/candidatos` | Listado paginado del archivo COMPLETO, de más reciente a más antiguo. Búsqueda (`q`) sobre nombre completo, documento, correo y celular; filtros por estado, cliente, cargo, ciudad, reclutador y rango de fechas |
| `GET /api/historico/candidatos/:id` | Ficha completa: columnas anchas + tablas satélite (`hyd_candidato_*`) cuando existen |
| `GET /api/historico/filtros` | Valores realmente presentes en el archivo, para los desplegables |

Tres decisiones:

- **No hay filtro por dueño.** En el sistema nuevo un reclutador solo ve su cartera; aquí ve todo el
  archivo, porque el objetivo es justamente consultar lo que gestionó otra persona. Basta
  `ver_candidatos`.
- El bloque `seleccion` de la ficha (evaluación de entrevista, antecedentes, decisión final) solo se
  entrega con `ver_perfiles_completos`, igual que en el sistema nuevo.
- La salida usa los nombres del esquema NUEVO (`email`, `celular`), no los del viejo
  (`email_personal`, `numero_celular`): el frontend no aprende dos esquemas.

Se activa con `DB_HISTORICO_NAME`. Sin esa variable el módulo responde 502 con código
`HISTORICO_NO_DISPONIBLE` y el resto del sistema arranca igual. En producción debe apuntar a un
usuario de MySQL con permiso `SELECT` y nada más sobre esa base.

---

## 5. Reglas de negocio que se centralizan

| Regla | Dónde está hoy | Destino |
|---|---|---|
| Transiciones de estado | No existen: `cambiarEstado` acepta cualquiera | `modules/candidatos/estado/transiciones.js` — un mapa `estado → [estados alcanzables]`, y un único `cambiarEstado()` que valida, actualiza y escribe el historial |
| Visibilidad por dueño | `esAdmin ? queryA : queryB` repetido ~15 veces | Un solo `aplicarFiltroVisibilidad(usuario)` usado por **todo** listado, detalle, export y mutación |
| Total de evaluación | Lo envía el cliente sin recalcular | Se calcula en `seleccion.service` desde `evaluacion_criterios` |
| Aprobación por umbral | La envía el cliente | Se deriva en el servidor del total y el umbral |
| Email duplicado | Permitido al crear, prohibido al editar | Una sola regla, aplicada en ambos caminos |
| Nacionalidad según tipo de documento | Hardcodeada en dos archivos distintos | Una función en `candidatos.service` |
| Antecedentes solo tras la entrevista | Solo en `PerfilCandidato.jsx` | Validado también en el backend |
| Concatenar nombre completo | Repetido en 3 archivos | `shared/utils/nombreCompleto.js` (ya existe, se usa siempre) |
| Escape de comodines `LIKE` | Copiado en 3 sitios | `shared/utils/sql.js` |
| Texto de estado para el Excel | Duplicado backend/frontend, con el comentario "mismo texto que `getEstadoTexto()`" | Solo backend; el frontend lo consume de la API |

**Máquina de estados propuesta** (las transiciones se afinan al implementar la fase 4):

```
nuevo ──> contacto_exitoso ──> formularios_enviados ──> formularios_completados ──> citado
  │                                                                                    │
  └──> no_contesta | reagendar | no_interesado | numero_incorrecto | contacto_fallido   │
                                                        ┌───────────────────────────────┤
                                                        ▼                               ▼
                                                   no_asistio                     entrevistado
                                                                                        │
                                                                        aprobado ◄───────┴──────► rechazado
                                                                            │
                                                          aprobado_final ◄───┴───► rechazado_final
                                                                            │
                                                                       contratado
```

---

## 6. Frontend (`hidrafrontend`)

- **`VITE_API_URL` por entorno.** Elimina la IP `200.91.204.54` hardcodeada, repetida en
  `services/api.js` y `context/AuthContext.jsx`.
- **`ApiService`: unificar el manejo de errores.** `put()` y `delete()` ya leen
  `errorData.error`; `get()` y `post()` solo lanzan `Error: ${response.status}`, descartando el
  mensaje que el backend sí envía. Por eso todo fallo de creación se ve en consola como
  `Error: 400` sin decir por qué.
- **Un solo `Sidebar`, generado desde `user.permisos`.** Reemplaza `AdminSidebar.jsx`,
  `Sidebar.jsx` y `SidebarSeleccion.jsx`, cada uno con su array `menuItems` fijo en código. Hoy el
  administrador tiene todos los permisos y las rutas lo dejan entrar, pero solo ve 2 opciones en el
  menú. El mismo patrón de bug afecta a las pestañas de `ListaCandidatos.jsx`, que no cubren los
  estados posteriores a la evaluación: un candidato ya decidido desaparece de la pantalla.
- **Carpetas por módulo**, espejando el backend, en vez de por rol.
- **Catálogos desde la API**, ya no desde constantes del frontend.
- Adaptación al sobre de respuesta unificado.
- Se elimina `NuevoCandidato_clean.jsx`.

---

## 7. Plan por fases

Rama de trabajo: `restructuracion`. Antes de empezar, un tag `pre-restructuracion` sobre `main`.

Cada fase es entregable y verificable por separado.

| # | Contenido | Criterio de aceptación | Estado (2026-09-01) |
|---|---|---|---|
| 0 | Tag, rama, `.env.example`, ESLint + Prettier, Vitest configurado | `npm run lint` y `npm test` corren en verde en vacío | ✅ Hecho |
| 1 | `config/env.js`, `config/db.js`, `app.js`, error handler global, handler 404, runner de migraciones | La app falla ruidosamente al arrancar si falta una variable; `npm run migrate` es idempotente | ✅ Hecho |
| 2 | Esquema completo en `db/migrations/` + seeds de catálogos y administrador inicial | La base `hidra` se reconstruye desde cero con un comando | ✅ Hecho |
| 3 | Módulos `auth`, `usuarios`, `catalogos` | Login funcional, RBAC leído de tablas, CRUD de usuarios unificado (hoy son 3 variantes), con tests de integración | ✅ Hecho |
| 4 | Módulo `candidatos` + máquina de estados + historial | Registro, edición, listados y transiciones válidas. **Test que verifica que un reclutador no ve candidatos ajenos en ningún endpoint** | ✅ Hecho |
| 5 | Módulo `formulario` (6 pasos por token) | Flujo público completo end-to-end, con tokens en tabla propia | ✅ Hecho |
| 6 | Módulo `seleccion`: citación, asistencia, evaluación, decisión final | Total calculado en servidor; el embudo vuelve a registrar fecha de citación | ✅ Hecho — con un cambio de regla de negocio posterior a este documento: citar y registrar asistencia pasaron de Selección a Reclutamiento (ver §11) |
| 7 | `antecedentes`, `documentos`, `reportes` (Excel) | Subida, descarga y exports, todos con filtro de dueño aplicado | ✅ Hecho — `reportes` creció más allá del Excel: también estadísticas, analíticas y el panel de Selección (ver §11) |
| 8 | Integraciones: email (con `envios_email`), FirmaCloud, nómina, generación de PDFs | Un fallo de envío se registra y se reporta como fallo, no como éxito | ✅ Hecho |
| 9 | Frontend reestructurado | Todas las pantallas contra la API nueva | ✅ Hecho — más el rediseño visual completo y los dashboards por rol (ver §11) |
| 10 | Borrado de lo viejo + endurecimiento + despliegue | `controllers/`, `routes/`, `models/`, `repositories/`, `services/`, `config/*.sql` y los `.sql` sueltos de `database/` eliminados | ✅ **En producción desde 2026-09-01.** Borrado commiteado en ambos repos, backend y frontend desplegados y funcionando en el servidor de producción (ver §11.7). El endurecimiento del §8 sigue mayormente sin marcar — pendiente real, no bloqueante |

**Cobertura de tests priorizada** (fases 3–8): login y RBAC, aislamiento por dueño, transiciones
del embudo, los 6 pasos del formulario, cálculo de la evaluación, y el relleno del PDF de hoja de
vida (ver riesgo en §9).

---

## 8. Endurecimiento de seguridad

Se ejecuta como parte de la fase 10, salvo la rotación de credenciales, que conviene hacer ya.

- [ ] `JWT_SECRET` obligatorio, **sin fallback**. La app no arranca sin él.
- [ ] **Rotar las credenciales expuestas**: `JWT_SECRET`, el app-password de Gmail,
      `FIRMACLOUD_API_KEY` y `API_KEY_NOMINA`.
- [ ] Usuario de base de datos dedicado con privilegios mínimos, no `root`.
- [ ] Purgar `database/noviembrehidra_export.sql` — contiene hashes bcrypt reales de `admin123` y
      la cédula, email y fecha de nacimiento de un candidato real. *(Reescribir el historial de git
      para eliminarlo del pasado es una decisión aparte, con su propio riesgo.)*
- [ ] Cerrar el puerto 3306 al exterior: `sudo ufw delete allow 3306/tcp`.
- [ ] `helmet` + rate limiting en `/auth/login` y en los endpoints públicos por token.
- [ ] Sanear el nombre de archivo en la cabecera `Content-Disposition`.
- [ ] Transacciones en todo flujo multi-tabla.
- [ ] Servir sobre HTTPS. Hoy los tokens de formulario viajan en la URL sin cifrar.
- [ ] Política de contraseñas real (hoy: mínimo 6 caracteres, sin complejidad, pese al comentario
      del código que afirma exigir letra y número).

---

## 9. Riesgos y decisiones abiertas

**Base vacía.** No habrá usuarios ni candidatos al arrancar. El seed **debe** crear el
administrador inicial y los catálogos, o nadie podrá entrar al sistema.

**El anclaje de firma de FirmaCloud es textual.** El proveedor busca las cadenas
"FIRMA DEL CANDIDATO" y "FIRMA" dentro de los PDFs generados. Las plantillas de `plantilla/` no se
pueden alterar, y esas líneas deben quedar intactas.

**El relleno del PDF falla en silencio.** `hojaVidaPdfService.js:35-40` mapea los valores del
catálogo `nivel_estudios` a coordenadas Y fijas de la plantilla; si el valor no está en el mapa,
hace `continue` sin avisar. Ya pasó cuando la migración 005 cambió el ENUM. Necesita una prueba
explícita que genere el PDF y verifique que las cuatro filas académicas quedaron escritas.

**Bloque "ANTERIOR EMPLEO" del PDF.** Está implementado (`hojaVidaPdfService.js:164-174`, rama
`orden === 2`) pero el formulario nunca captura una segunda empresa. Hay que decidir: capturarla en
el formulario, o eliminar el bloque.

**Producción sigue corriendo el sistema viejo** durante toda la reescritura. El corte a la base
nueva es un evento único que hay que coordinar: no hay migración de datos que lo suavice.

**Las 16 migraciones actuales no están todas aplicadas en producción** (009–016 solo en local, según
las notas). El sistema viejo en producción tiene un esquema distinto al local mientras dure la
transición: cualquier arreglo urgente sobre el sistema viejo debe tenerlo en cuenta.

---

## 10. Referencias en el repo

| Archivo | Contenido |
|---|---|
| `claude/arquitectura-y-bugs.md` | ⚠️ **Obsoleto.** Registro de 17 bugs de la arquitectura VIEJA (`controllers/`, `hyd_*`) — ese código ya no existe en el repo. Queda como archivo histórico, no como referencia activa |
| `claude/context.md` | ⚠️ **Obsoleto**, mismo motivo (tablas `hyd_*`, roles `reclutador`/`seleccion`, `controllers/*.js` que ya no existen) |
| `claude/plan.md` | ⚠️ **Obsoleto**, historial de la normalización del formulario del sistema VIEJO, ya reemplazado por el módulo `formulario` nuevo |
| `database/migrations/002_*.sql` | ⚠️ Esta ruta ya no existe (`database/` se borró — ver §11); el diseño equivalente vive en `db/migrations/` |
| `database/SCHEMA_DOCUMENTATION.md` | ⚠️ Esta ruta ya no existe (`database/` se borró — ver §11) |

**Nota (2026-09-01):** los cuatro `claude/*.md` de arriba documentan el sistema que este mismo
documento propuso reemplazar, y ese reemplazo ya ocurrió — `controllers/`, `models/`, `routes/`,
`repositories/`, `services/`, `middleware/`, `database/` y `config/*.sql` ya no están en el disco
(siguen como `D` en `git status`, sin commitear). Este documento (`restructuracion.md`) y su §11 son
ahora la referencia vigente; los `claude/*.md` quedan solo como archivo histórico de la sesión que
llevó a la decisión de reescribir.

---

## 11. Estado actual y cambios posteriores a este documento (actualizado 2026-09-01)

Este documento se escribió el 2026-08-27, como el contrato inicial de la reescritura. Desde
entonces la reescritura se ejecutó casi por completo (§7) y, sobre la marcha, se tomaron decisiones
de negocio y se construyó funcionalidad que este documento no preveía. Esta sección las registra,
para no tener que releer todo el historial de sesiones para saber qué es cierto hoy.

### 11.1 Reparto de trabajo Reclutamiento ↔ Selección cambió

El diseño original (§4.1, §6) asumía el reparto de permisos del sistema viejo. Se ajustó:

- **Citar candidatos y registrar asistencia pasaron de Selección a Reclutamiento.** Selección ya no
  agenda entrevistas ni marca asistencia — solo evalúa (`evaluar_candidatos`) y toma la decisión
  final (`tomar_decision_final`) sobre lo que Reclutamiento ya le entregó citado y entrevistado.
- Consecuencia en el menú: "Agenda de entrevistas" se ocultó del sidebar tanto de Reclutamiento como
  de Selección (ambos conservan el permiso sobre la ruta, por si algo la enlaza directo); hoy solo
  la ve Administrador. "Mi trazabilidad" se ocultó del sidebar de Selección: es cartera por
  `reclutador_id` y Selección nunca es dueño de un candidato, así que esa pantalla le salía siempre
  vacía.
- El menú del frontend sigue derivándose de `user.permisos` (§6), pero desde esta ronda el permiso
  que gatea un ítem de menú no siempre coincide con el permiso mínimo de la ruta —a veces se elige
  a propósito uno más estrecho, solo para controlar qué rol VE el enlace— documentado caso a caso
  con comentarios en `hidrafrontend/src/components/layout/menu.js`.

### 11.2 Dashboards separados por rol

El plan original no distinguía un dashboard por rol más allá del sidebar único (§6). Se construyeron
dos, porque Reclutamiento y Selección hacen trabajo distinto y "Mi trazabilidad" (creados/
gestionados/asignados, cartera propia) solo tiene sentido para quien registra candidatos:

- **`/trazabilidad` ("Mi trazabilidad", Reclutamiento y Administrador):** resumen por periodo,
  cartera por estado, candidatos por campaña/cargo, embudo de conversión real (hasta dónde llegó
  cada candidato alguna vez, no dónde está hoy), resultados de Agente, serie mensual de registros
  con marca de "hoy" siempre visible, actividad reciente. `/trazabilidad/equipo` y
  `/trazabilidad/reclutador/:id` dan la vista comparativa a quien tiene `ver_perfiles_completos`.
- **`/seleccion/dashboard` ("Dashboard de Selección", primero en su menú y página de aterrizaje al
  entrar):** pendientes de evaluación / pendientes de decisión final (gateado por
  `evaluar_candidatos`, exclusivo de Selección y Administrador), resultados de Agente **globales**
  (todo el equipo, no por reclutador), promedio de evaluación por criterio, evaluaciones por día del
  mes en curso, y candidatos registrados por analista de Reclutamiento (reutiliza
  `/api/trazabilidad/equipo`, sin endpoint nuevo). Backend nuevo: `GET /api/reportes/panel-seleccion`
  en el módulo `reportes` (`colaSeleccion`, `resultadosAgenteGlobal`, `evaluacionesPorDia`).
- Varios componentes de gráfica (barra medida, dona de resultados, serie mensual con marca de "hoy")
  se comparten entre ambos dashboards desde `hidrafrontend/src/components/ui/graficas.jsx` +
  `graficaHelpers.js`, en vez de duplicarse.

### 11.3 Base histórica

Nuevo apartado de menú (`/historico`, Reclutamiento/Selección/Administrador): pantalla dedicada a
consultar la base vieja `noviembrehidra` de solo lectura (§4.9), con filtro por nombre, documento y
fechas, y el modal de "Descargar histórico" que antes estaba duplicado en varias pantallas.
`src/config/dbHistorico.js` y el módulo `historico` ya existían tal como los describe §3/§4.9; lo
nuevo fue la pantalla de frontend.

### 11.4 Excel para Reclutamiento, reenvío de email sin restricción de estado

- Reclutamiento obtuvo el mismo permiso de exportación a Excel que Selección
  (`generar_reportes_seleccion`); el filtro de dueño (§1.6, ya corregido) limita el export a su
  propia cartera.
- El botón "reenviar email" dejó de estar restringido al estado `entrevistado`: funciona para
  cualquier candidato/cargo, y si el candidato ya completó los 6 pasos del formulario, el reenvío
  precarga todas las respuestas guardadas (`formulario.repository.js: obtenerRespuestasGuardadas`).

### 11.5 Rediseño visual del frontend

Paleta de marca extraída del logo de Hydra (`tailwind.config.js`, escala `blue` 50–950),
tipografía Plus Jakarta Sans, logo en Login y en el sidebar. Todas las gráficas nuevas (embudo,
por cargo, resultados de Agente, series mensuales, por criterio) son SVG a mano siguiendo un
procedimiento fijo: forma → color → validación de paleta con script → marcas/espaciado →
interacción (crosshair + tooltip) → accesibilidad — sin librería de gráficas.

### 11.6 Pendiente real, no solo lo del §8/§9

- El checklist de endurecimiento del §8 sigue casi entero sin marcar (salvo `JWT_SECRET` sin
  fallback, que ya aplica en producción — ver §11.7).
- Reclutamiento conserva los permisos `agendar_entrevistas`/`registrar_asistencia` pero, desde que
  "Agenda de entrevistas" se ocultó de su menú (§11.1), no tiene un punto de entrada visible en el
  sidebar para citar un candidato — señalado, sin resolver todavía.

### 11.7 Despliegue a producción (2026-09-01)

**La reestructuración completa está en producción**, en el mismo servidor que corría el sistema
viejo (`hydraos@...`, `/var/www/noviembrehidra/`). Corte hecho en un solo día, sin ventana de
mantenimiento formal — quedó una franja corta con el backend nuevo arriba y el frontend viejo
todavía desplegado, que se cerró subiendo el frontend nuevo enseguida.

**Base de datos.** Se creó `ReclutamientoNuevo` (no `hidra`: se mantuvo el nombre que ya usaba el
`.env` de desarrollo, por consistencia — ver nota en `db/produccion-inicial.sql`) aplicando ese
archivo consolidado completo vía MySQL Workbench. `noviembrehidra` sigue intacta, sin tocar, tal
como exige §4.9. Detalle operativo no trivial: la cuenta `root@'%'` (la que usa una conexión remota
como Workbench) tenía privilegios acotados solo a `noviembrehidra` — `GRANT USAGE ON *.*` nada más
en el resto —, distinta de `root@localhost` (la de la sesión SSH), que sí tiene privilegios globales.
Hubo que hacer `GRANT ALL PRIVILEGES ON ReclutamientoNuevo.* TO 'root'@'%'` antes de que Workbench
pudiera ver la base nueva. Vale la pena recordar esto la próxima vez que haga falta una conexión
remota a esta base.

**Usuario administrador real.** `admin@hidra.com`, contraseña generada aleatoriamente para esta
entrega (no la `Hidra2026*` de `db/seeds/004_usuario_admin.sql`, que es pública). **Pendiente:
rotarla desde la aplicación** — se generó y se mostró una sola vez, ya quedó en el historial de esta
conversación y en el `.env` de producción no debería estar, así que hay que cambiarla apenas se
pueda.

**Backend — `.env` de producción.** `DB_NAME=ReclutamientoNuevo`, `DB_HISTORICO_NAME=noviembrehidra`,
`JWT_SECRET` nuevo generado (32+ caracteres aleatorios — el fallback hardcodeado que exigía §8 ya no
aplica, esta variable es obligatoria y sin default en `src/config/env.js`), resto de credenciales
(email, FirmaCloud, nómina) heredadas del `.env` viejo. Sigue corriendo como `DB_USER=root` sin
usuario dedicado — pendiente real de §8, no se resolvió en este corte.

**PM2 apuntaba al archivo equivocado.** La definición de PM2 (`pm2 start ...`) seguía apuntando a
`index.js`, el entrypoint del sistema viejo, que el commit de este documento borró. Después del
`git pull` en el servidor, PM2 entró en crash-loop (`MODULE_NOT_FOUND`, "too many unstable restarts")
hasta que se recreó apuntando al entrypoint correcto:

```bash
pm2 delete hidra-backend
pm2 start src/server.js --name hidra-backend
pm2 save
```

**Frontend — build sin `VITE_API_URL`.** El primer `npm run build` en el servidor se hizo sin
`.env.production`, así que el bundle quedó con el default de desarrollo
(`http://localhost:3000/api`) horneado adentro — Vite reemplaza `import.meta.env.VITE_API_URL` en
tiempo de compilación, no de ejecución. Como "localhost" en el navegador del usuario es su propia PC,
esto daba `ERR_CONNECTION_REFUSED` al hacer login. La configuración de nginx ya existente
(`/etc/nginx/sites-enabled/noviembrehidra`) resultó tener justo lo necesario: sirve `dist/` en `/` y
ya reenvía `location /api/ { proxy_pass http://localhost:3000; }`. La corrección fue usar ese proxy
en vez de pegarle al puerto 3000 directo:

```bash
# en /var/www/noviembrehidra/frontend
echo 'VITE_API_URL=/api' > .env.production
npm run build
```

Con `VITE_API_URL=/api` (ruta relativa) el frontend y el backend quedan en el mismo origen desde el
punto de vista del navegador — sin problema de CORS y sin depender de que el puerto 3000 esté
abierto al exterior. Preferible a la URL absoluta con IP que usaba el sistema viejo
(`http://200.91.204.54:3000/api`, documentada en §6): si el dominio o la IP cambian, no hay que
recompilar el frontend.

**Verificado tras el corte:** login funcional desde el frontend nuevo contra el backend nuevo, con
la base `ReclutamientoNuevo` para escritura y `noviembrehidra` para consulta histórica, ambas
conexiones confirmadas en el log de arranque (`"Conexión a MySQL verificada"`,
`"Conexión a la base histórica verificada"`).

**Resuelto 2026-09-01 (tercera ronda):** ~~Commitear el borrado de `controllers/`, `routes/`,
`models/`, `repositories/`, `services/`, `middleware/`, `database/`, `config/*.sql`~~ — commiteado en
`hidrabackend` (`main`, commit `cd692d3`) y en `hidrafrontend` (`sebas-branch`, commit `62df7ff`), y
desplegado a producción (ver §11.7).

**Resuelto 2026-09-01 (segunda ronda):**
- ~~`tests/integracion/reportes.test.js` tiene un helper desalineado con el cambio de §11.1~~ —
  corregido: `candidatoCompleto()` citaba y marcaba asistencia con `auth('seleccion')`; ahora usa
  `auth('reclutador')`, igual que el resto del sistema desde el 2026-08-31. Con esto, `npx vitest run`
  sobre una base limpia (creada solo con `db/migrations/` + `db/seeds/001-003`, sin datos previos)
  corre **93/93 pruebas en verde** — login/RBAC, aislamiento por dueño, el embudo completo de un
  candidato hasta decisión final, formulario de 6 pasos, evaluación calculada en servidor, reportes,
  histórico y trazabilidad. (No: `historico.test.js` y `flujo-completo.test.js` no tenían el problema
  de sintaxis Vitest/Jest que se documentó antes aquí — el proyecto corre con Vitest, como dice
  `package.json`, y esos archivos ya pasaban.)
- Nota de aislamiento: correr los tests contra la base de **desarrollo** (`ReclutamientoNuevo`)
  compartida, en vez de una base dedicada, puede dar falsos negativos si esa base ya tiene datos
  reales de pruebas manuales — pasó con "promedia la evaluación por criterio" en `reportes.test.js`,
  que promedia sobre TODA la tabla `candidato_evaluaciones` sin filtrar por los candidatos que crea el
  propio test. No es un bug de producto: es que los endpoints de estadísticas son deliberadamente
  globales. Para una corrida confiable, usar una base descartable (`DB_NAME=<algo> node db/migrate.js`
  + los tres seeds de catálogo, sin el seed de usuarios) y no la de desarrollo.
- Se generó `db/produccion-inicial.sql`: los 9 archivos de `db/migrations/` + los 3 seeds de catálogo
  (`001_roles_y_permisos.sql`, `002_estados_y_transiciones.sql`, `003_catalogos.sql`) concatenados en
  un solo archivo para el despliegue inicial de producción, más un usuario administrador real (no el
  de `db/seeds/004_usuario_admin.sql`, que trae la contraseña pública `Hidra2026*`) y el registro
  correspondiente en `migraciones_aplicadas` con los mismos checksums que calcula `db/migrate.js`, para
  que un `node db/migrate.js` posterior contra esa base no reintente aplicar nada. Verificado de punta
  a punta contra una base MySQL real: crea las 52 tablas, el admin generado inicia sesión con sus 21
  permisos, y `node db/migrate.js --estado` reconoce las 9 migraciones como aplicadas.

### 11.8 Funcionalidad nueva y correcciones post-despliegue (2026-09-01, segunda mitad del día)

Todo lo de esta sección se construyó **después** de que la reestructuración ya estaba en producción
(§11.7), como trabajo normal sobre el sistema nuevo — no como parte de la migración. Se agrupa acá
por la misma razón que el resto de §11: para no tener que releer sesiones viejas.

**Bug real en Desprendibles, encontrado por un usuario en producción.** El módulo de nómina
(`src/modules/desprendibles/`) tenía dos regresiones de la reescritura del frontend, comparado con el
componente viejo (`DesprendiblesPage.jsx`, ya borrado pero recuperable del historial de git):

- `normalizar()` en `Desprendibles.jsx` leía `respuesta.meses`, pero la API externa de nómina
  (IntraCar) devuelve el arreglo bajo `respuesta.data` — por eso la pantalla siempre mostraba "No hay
  desprendibles disponibles" aunque la API sí tuviera datos.
- Intentaba convertir `mes` a número (`Number("septiembre")`), pero la API lo manda como nombre en
  español, no `1-12` — el viejo componente ya sabía esto y pasaba el valor tal cual.
- Espejo en el backend: `desprendibles.routes.js` forzaba `mes: z.coerce.number().min(1).max(12)` en
  la ruta de descarga; se cambió a `z.string().min(1)`, porque hay que reenviarle a la API externa el
  mismo texto que vino de `/meses`.

De paso se rediseñó la pantalla: pasó de una lista angosta (`max-w-2xl`) a un grid de tarjetas más
grandes (icono de documento en área con degradado, hasta 4 columnas), con un botón "Ver" nuevo que
abre el PDF en un modal (reutiliza `ModalDocumento`, el mismo que ya usan antecedentes y firma) además
de "Descargar".

**Scroll propio en la columna "Perfil" de Base histórica.** Un perfil largo estiraba toda la fila de
la tabla. La celda ahora tiene `max-h-20 overflow-y-auto` — altura fija, scroll interno, la fila no se
deforma.

**Seguimiento de asistencia antes de la entrevista** (candidato citado, pendiente de resolver). Nueva
migración `db/migrations/010_seguimiento_citacion.sql` — **aplicada solo en local, todavía no en
producción** —, dos columnas en `candidato_citaciones`: `seguimiento_llamada`, `seguimiento_whatsapp`
(BOOLEAN NULL, independientes entre sí, mismo patrón que `candidatos.contacto_llamada`/
`contacto_whatsapp`). `GET`/`POST /api/seleccion/candidatos/:id/seguimiento`, actualiza uno o ambos
sin pisar el otro (`COALESCE` en el UPDATE), solo mientras la citación sigue pendiente. En el
frontend: botón "Seguimiento" junto a "Asistencia" (en Candidatos → Citado y en Agenda → Pendientes),
modal con dos toggles Sí/No que trae precargado lo ya guardado, y un resultado combinado —
`resultadoSeguimiento()` en `ui/formato.js` — que es "Sí" si respondió por cualquiera de los dos
canales, "No" solo si se agotaron los dos sin respuesta, "Pendiente" mientras falte alguno. El botón
"Seguimiento" de la tabla se pinta verde/rojo según ese resultado (`claseBotonSeguimiento()`, con `!`
para ganarle a la variante "secundario" de `Boton`).

**Re-citar a quien no asistió.** La máquina de estados ya tenía la transición `no_asistio -> citado`
("se reagenda", `db/seeds/002_estados_y_transiciones.sql`) desde el diseño original — no hizo falta
tocar el backend, solo faltaba el punto de entrada en la interfaz. Pestaña "No Asistió" agregada a
`SIEMPRE_VISIBLES` en Candidatos, justo al lado de "Citado" (el catálogo ya los ordena consecutivos:
100 y 110). Botón "Citar" (en Candidatos y en Agenda) abre `ModalRecitar`, que llama al mismo endpoint
de citar por primera vez.

**Bug de sincronización: los conteos de las pestañas no se actualizaban.** En `ListaCandidatos.jsx`,
la tabla y los conteos de las pestañas ("Citado 3", "No Asistió 2") son dos peticiones independientes
(dos `useRecurso`). Cerrar un modal que cambia el estado de un candidato (Asistencia, Recitar,
Evaluar) solo refrescaba la tabla — los conteos quedaban desactualizados hasta un F5 manual. Corregido
con una `recargarTodo()` que refresca ambas.

**Alerta de duplicado contra la base histórica, al registrar un candidato.** En "Nuevo candidato",
mientras se escribe el número de documento (con espera de 400ms), se busca coincidencia EXACTA en el
archivo histórico (`numeroDocumento` se agregó a `FILTROS_EXACTOS` en `historico.repository.js` — es
igualdad exacta, no el `LIKE` que ya usaba la búsqueda libre `q`, para no marcar coincidencia por un
número que solo comparte algunos dígitos). Si hay coincidencia, aparece una alerta ámbar (no bloquea
el registro) con un botón "Ver perfil" que abre `ModalPerfilHistorico` — nuevo, en
`components/historico/`, con identificación, proceso, perfil/observaciones y, si el usuario tiene
`ver_perfiles_completos`, el bloque de selección (antecedentes, evaluación, decisión final).

Ese mismo modal, si el candidato histórico tiene `firmacloudSignatureId` (columna
`hyd_candidatos.firmacloud_signature_id` del sistema viejo, migración 008 de `database/migrations/`),
muestra botones para ver su hoja de vida y tratamiento de datos firmados. Nuevo endpoint
`GET /api/historico/candidatos/:id/documento/:tipo`, que reutiliza **el mismo adaptador `firma`** que
ya usa el sistema nuevo (`firma.descargar(referencia, tipo)`) — mismo FirmaCloud, la única diferencia
es de dónde sale la referencia. Verificado contra las dos únicas referencias reales que hay en el
archivo histórico: ambas devuelven 404 del proveedor (parecen registros de prueba viejos, nunca
completados o purgados) — no es un bug del código, y el modal lo muestra como un error claro en vez de
romperse. El mecanismo es idéntico al que ya funciona a diario para candidatos del sistema nuevo.

**Pendiente real de esta sección:**
- Aplicar `db/migrations/010_seguimiento_citacion.sql` en producción (`node db/migrate.js`) — hoy solo
  está en local.
- Todo lo de §11.8 sigue sin commitear al cierre de esta sesión (ver también §11.6).
