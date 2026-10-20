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

## 11. Estado actual y cambios posteriores a este documento (actualizado 2026-10-20)

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

### 11.9 Visibilidad de candidatos entre roles, bug de "carga por analista" y dashboard exclusivo de
### Administrador (2026-09-02)

**a) Un candidato registrado por un usuario no aparecía en el listado de otro.** Reportado por el
usuario: creó un candidato logueado como Administrador, y con un usuario de Reclutamiento ese
candidato no salía en "Candidatos". Causa: `visibilidad.js` filtra el listado por
`c.reclutador_id = usuario.id` salvo que el usuario tenga `ver_perfiles_completos` — permiso que
Reclutamiento no tiene (§4.1/§11.1), así que solo veía su propia cartera. Decisión de negocio: **todos
los roles deben ver el listado completo**, sin importar quién registró a cada candidato.

En vez de darle `ver_perfiles_completos` a Reclutamiento (que también destaparía valoración
psicológica/evaluación en histórico y trazabilidad, algo que no se pidió), se separó el concepto:
nuevo permiso `ver_candidatos_todos` (migración `012_permiso_ver_candidatos_todos.sql`), otorgado a
los **tres** roles, ahora es lo que consulta `visibilidad.js` (`veTodos`/`filtroSql`/`puedeAcceder`)
para decidir si un usuario ve candidatos ajenos. `ver_perfiles_completos` no se tocó y sigue aparte,
gateando solo los datos sensibles de histórico/trazabilidad — mismo patrón de "un permiso, una
responsabilidad" que ya se usó para separar Reclutamiento/Selección en §11.1.

**b) Bug real en "Candidatos registrados por analista" (`trazabilidad.repository.js: equipo()`):
cada analista de Reclutamiento mostraba "1" aunque no hubiera registrado nada.** `equipo()` hace
`LEFT JOIN` de `usuarios` (con el rol `reclutamiento`) contra `candidato_estado_historial`, para que
un reclutador sin ningún registro igual aparezca en la comparativa (con `creados = 0`). El conteo de
cada periodo usa `PERIODOS[periodo]` (`dia`/`semana`/`mes`/`total`) — pero `PERIODOS.total` es el
literal `'1 = 1'`, que a diferencia de los otros tres **no referencia `h.created_at`**. Con el
`LEFT JOIN` eso significa que hasta la fila fantasma (sin match real, `h.*` en NULL) contaba como "1
creado total" para cualquier reclutador, sin importar si de verdad registró algo — el caso reportado
por el usuario (tres analistas mostrando "1" cada uno, con un solo candidato real en el sistema,
registrado por un cuarto usuario) coincide exacto con este patrón. Fix: se agregó el guard
`h.candidato_id IS NOT NULL` a las cuatro condiciones de período en `equipo()` — `resumen()` (mismo
archivo) no tiene este bug porque ahí `PERIODOS.total` se usa sobre una consulta con `WHERE`, no un
`LEFT JOIN`, así que no hay fila fantasma que contar.

**c) Dashboard exclusivo de Administrador.** Pedido del usuario: Administrador aterrizaba en el
"Dashboard de Selección" (lo hereda por compartir `evaluar_candidatos` con Selección, ver §11.2) sin
que ese panel respondiera lo que Administrador necesita ver primero. Se le da uno propio y se le
quita el de Selección:

- **Nuevo `/dashboard` (`DashboardAdministrador.jsx`)**, primer ítem del menú "Mi gestión" y por lo
  tanto destino de `RoleRedirect` tras iniciar sesión para quien lo tiene. Contenido, todo servido
  por endpoints de `reportes`/`trazabilidad` que ya existían pero no tenían consumidor en el frontend:
  totales globales (`GET /trazabilidad/global`), embudo de conversión **global** —de registrado a
  contratado, todo el sistema— (`GET /reportes/estadisticas`), candidatos por cliente
  (`GET /reportes/analytics/clientes`), progreso de formularios **acumulado** por paso, calculado en
  el cliente a partir de los baldes exactos que devuelve `GET /reportes/analytics/progreso`, y carga
  de trabajo por analista (`GET /trazabilidad/equipo`, reusando el componente `CandidatosPorAnalista`
  que antes solo vivía en `DashboardSeleccion.jsx` — se movió a `ui/graficas.jsx` para no duplicarlo).
  Gateado por `ver_usuarios` (ruta y menú): no hay permiso propio "ver dashboard administrador", se
  reutiliza uno que hoy ya es exclusivo de Administrador — mismo criterio ya documentado en §11.1 para
  "Agenda de entrevistas"/"Trazabilidad del equipo".
- **`/seleccion/dashboard` pasa de `evaluar_candidatos` a un permiso nuevo, `ver_dashboard_seleccion`**
  (migración `013_permiso_dashboard_seleccion.sql`), otorgado solo a Selección. Antes Administrador lo
  heredaba por tener también `evaluar_candidatos`; con el permiso nuevo, exclusivo de Selección, deja
  de aparecer en el menú/ruta de Administrador. El endpoint del backend
  (`GET /reportes/panel-seleccion`) **no cambió** — sigue gateado por `evaluar_candidatos` a propósito:
  la distinción nueva es de qué arma el frontend, no de quién puede pedir esos datos por API, mismo
  criterio que el resto de §11.1.

**Migraciones 011/012/013 pendientes de aplicar contra `ReclutamientoNuevo`.** Al intentar
`node db/migrate.js` para aplicar 012 y 013, la 011 (`firmar_hoja_vida`, de una sesión anterior) falló
con `Duplicate entry 'firmar_hoja_vida'` — sus datos (permiso + grants a administrador/selección) ya
estaban aplicados en la base, pero sin el registro correspondiente en `migraciones_aplicadas`, así que
el runner la reintenta y choca contra el `UNIQUE` en vez de saltarla. Eso bloquea que 012 y 013 se
apliquen detrás. El intento de arreglarlo insertando la fila de control a mano vía script quedó
bloqueado por el clasificador de permisos del modo automático; se le explicó la situación al usuario
(con el `INSERT` exacto para `migraciones_aplicadas` y las dos formas de resolverlo) y quedó a su
cargo. Hasta que eso se resuelva: `ver_candidatos_todos` y `ver_dashboard_seleccion` no existen todavía
en la base, así que el fix de visibilidad (a) y el dashboard de administrador (c) no se pueden probar
funcionalmente contra `ReclutamientoNuevo`.

**Auto-commit, de nuevo (mismo fenómeno de `claude/lastcontext.md` §12).** Todo el trabajo de esta
sesión apareció commiteado solo, sin que Claude ejecutara `git commit` en ningún momento:
`hidrabackend` — `480e994 "ver todos los usuarios"`, `6cd0f6d "ajuste grafica admin"`,
`ebe461f "dash admin"`; `hidrafrontend` — `b3beee4 "dash admin"`. Working tree limpio en ambos repos
al cierre de la sesión. Avisado al usuario en el chat; causa sigue sin identificarse.

**Pendiente real de esta sección:**
- Resolver el desajuste de `migraciones_aplicadas` para la 011 y aplicar 011/012/013 (local y luego
  producción) — sin esto, (a) y (c) de arriba quedan sin verificar contra datos reales.
- §11.6 seguía señalando que Reclutamiento no tiene punto de entrada visible para citar un candidato
  — no se tocó en esta sesión.

### 11.10 Incidente de producción: el link del formulario fallaba desde datos móviles/otras redes
### (2026-09-11) — enrutamiento asimétrico por doble tarjeta de red, no era el firewall

Reportado por el usuario (dos capturas de WhatsApp de un candidato): al abrir desde datos móviles el
link del correo (`http://200.91.204.54/candidato/formulario/<token>`), el celular daba
`ERR_CONNECTION_ABORTED` — "No se puede acceder a este sitio". Desde la red de la oficina el mismo
link sí abría, lo que apuntaba a un problema de alcance externo, no de la app.

**Descartado primero (no era la causa esta vez):** el incidente de `ufw` ya documentado en
`claude/context.md` (§ "Incidente de producción resuelto: sitio inaccesible por firewall") — se
verificó `sudo ufw status verbose` y los puertos `22/80/3000/3306` seguían con `ALLOW IN Anywhere`
(v4 y v6). Tampoco era nginx/node caídos: `ss -tlnp` confirmó nginx escuchando en `0.0.0.0:80` y
`0.0.0.0:8080`, y node en `*:3000`. El log de nginx (`access.log`/`error.log`) no registraba nada al
reproducir el fallo desde el celular — la petición nunca llegaba a la aplicación.

**Causa real, encontrada con `tcpdump -i any -n port 80 or port 3000`:** el servidor
(`hydraos-Standard-PC-i440FX-PIIX-1996`, una VM) tiene **dos tarjetas de red**:
- `ens18`: red privada `10.255.255.0/24` (IP dinámica por DHCP, ruta por defecto vía `10.255.255.1`,
  métrica **100**).
- `ens19`: IP pública real `200.91.204.54/29` (IP estática, ruta por defecto vía `200.91.204.49`,
  métrica **101**).

Como la ruta por defecto de `ens18` tiene métrica más baja (preferida), el kernel usaba **esa** para
responder a cualquier paquete sin importar por qué interfaz entró. El `tcpdump` mostró justo eso: SYN
entrando por `ens19` (tráfico real de internet) y el SYN-ACK de respuesta saliendo por `ens18` hacia
el gateway privado — que no puede devolverlo a un cliente real de internet. El cliente reintentaba el
SYN varias veces y terminaba abortando la conexión (`ERR_CONNECTION_ABORTED`).

Dato que confirmó el diagnóstico sin ambigüedad: la propia sesión SSH del usuario
(`ssh hydraos@200.91.204.54`) también salía con origen `200.91.204.54` por el mismo camino roto —
mostrado por `sudo ss -tnp | grep :22` (local `200.91.204.54:22`, remoto un IP público real) — pero
esa sí funcionaba, porque la red del usuario tolera el enrutamiento asimétrico. Los operadores de
datos móviles suelen aplicar *reverse path filtering* estricto (anti-spoofing) y sí lo rechazan — de
ahí que el bug solo se viera "desde datos móviles u otra red" y nunca desde la oficina.

**Fix aplicado en caliente (producción), vía SSH:**
```bash
sudo ip route add default via 200.91.204.49 dev ens19 table 200
sudo ip rule add from 200.91.204.54 table 200 priority 100
```
Enrutamiento por políticas: fuerza que todo paquete con IP origen `200.91.204.54` salga siempre por
`ens19`/`200.91.204.49`, sin importar la métrica de la tabla principal. Se aplicó con una red de
seguridad (revertía solo a los 150s si algo salía mal) y se confirmó que resolvió el problema.

⚠️ **Pendiente crítico, sin resolver al cierre de esta sesión — se pierde en cada reinicio:**
- Lo de arriba **no es persistente**: es una tabla de rutas (`table 200`) agregada en caliente: un
  reinicio del servidor la borra.
- Peor aún, según reportó el usuario: **al reiniciar el servidor, la tarjeta pública (`ens19`) queda
  apagada/despriorizada por NetworkManager en favor de la red interna (`ens18`), y hay que
  habilitarla a mano** cada vez. Sin esto, ni siquiera hay IP pública activa, más allá del fix de
  enrutamiento.
- Falta implementar de forma persistente (vía `nmcli`, ya que `/etc/netplan/*.yaml` en este servidor
  usa `renderer: NetworkManager`): que `ens19` arranque siempre sola (`autoconnect`/prioridad), y que
  la regla `ip rule`/`table 200` de arriba se reaplique sola en cada boot (perfil de conexión de
  `ens19` con `ipv4.routing-rules`, o un script de `NetworkManager dispatcher`). Se pidió
  `nmcli connection show` / `nmcli device status` para diseñar el fix persistente pero la sesión
  terminó antes de recibir esa salida.
- **Mientras no se resuelva esto, cualquier reinicio del servidor de producción reintroduce el bug**
  (candidatos con datos móviles no pueden abrir el link del formulario) hasta que alguien entre por
  SSH, habilite `ens19` a mano y vuelva a correr los dos comandos de arriba.

### 11.11 Dos bugs de filtros en "Candidatos" corregidos + carga masiva de candidatos por Excel
### (2026-09-11/12)

**a) Filtro "Formularios Completados" no mostraba candidatos con 6/6 pasos ya llenos.** Reportado por
el usuario. Causa: ese filtro comparaba `estado = 'formularios_completados'` a secas, pero
`estado_transiciones` (§ máquina de estados, `estado.service.js`) no tiene arista
`citado → formularios_completados` — solo `formularios_enviados → formularios_completados`. Un
candidato marcado "Citado: Sí" directo al registrarse (salta `nuevo → citado`, ver migración 009) que
después llena el formulario por el link del correo se queda con `estado='citado'` para siempre; su
avance a `formularios_completados` lo descarta en silencio `avanzarSiSePuede` (no hay excepción, solo
no hace nada). **Fix**: ese filtro específico (`candidato.repository.js::listar`/`resumenPorEstado`)
ya no compara por `estado`, compara por progreso real (`pasos_completados = 6`) — mismo patrón que ya
usaba el sistema viejo para `citado`/`citado_gestion`. No se tocó la máquina de estados ni la pestaña
"Citados".

**b) "Candidatos Staff" mostraba un número en la pestaña pero cero resultados al hacer clic.**
Reportado por el usuario en roles Selección y Administrador: "No Contesta" mostraba 1, "Rechazado" 3,
"Rechazado Final" 6, pero la lista salía vacía en los tres. Causa: `resumenPorEstado` (alimenta el
número de la pestaña) nunca filtraba por cargo, mientras que `listar` (la lista en sí) sí excluye
cargo Agente cuando `segmento="staff"` — si los candidatos de un estado eran todos de cargo Agente, la
pestaña los contaba (global) y la lista filtrada los escondía. Mismo bug aplica al toggle "Solo
Agentes" del lado de Reclutamiento. **Fix**: `resumenPorEstado` ahora recibe `agentes`/`staff` y aplica
el mismo filtro de cargo que `listar` (vía `EXISTS` sobre `cargos`, no un `JOIN` — un `JOIN` directo
rompía el orden de las cláusulas `ON`, ver commit). Frontend: `ListaCandidatos.jsx` ahora manda
`filtroCargo` también al pedir `resumen-estados` y lo recalcula al cambiar `segmento`/`soloAgentes`
(antes solo dependía de `busqueda`).

Verificado con `node --check`, la suite completa (122-128/123-129 según el punto de la sesión, el
único fallo es preexistente y sin relación — `reportes.test.js::promedia la evaluación por criterio`,
confirmado con `git stash` que ya fallaba antes de esta sesión) y prueba real en navegador (login
Selección/Administrador, pestañas de "Candidatos Staff" y "Candidatos" con "Solo Agentes").

**c) Carga masiva de candidatos por Excel (feature nueva).** Pedido del usuario: que reclutadores y
administradores puedan subir un Excel y registrar varios candidatos de una, con los mismos campos del
formulario "Nuevo Candidato" (incluido Citado Sí/No), quedando atribuidos a quien sube el archivo.
Decisión de negocio: **todo o nada** — si una sola fila falla, no se registra ningún candidato del
archivo, con un mensaje señalando la fila y el motivo exacto.

- `POST /candidatos/importar-excel` y `GET /candidatos/plantilla-importacion`, gateados por
  `crear_candidatos` (ya lo tienen reclutamiento y administrador; selección no, coincide con lo
  pedido). Multipart en memoria (`src/shared/middleware/subirExcel.js`, no disco — el archivo es
  transitorio), límite 100 MB (subido desde 5 MB a pedido del usuario).
- **Garantía central**: cada fila válida termina en la base exactamente igual que si se hubiera
  tecleado en "Nuevo Candidato" — se extrajo el cuerpo de la transacción de `crear()` a
  `altaCandidatoEnTransaccion()` (candidato + historial + asignación inicial + citación si
  `Citado=Sí`), reusada tanto por el alta manual como por el importador, dentro de una sola
  transacción para TODO el archivo (todo o nada real, no solo a nivel de validación).
- Validación reusa `candidato.schema.js::crear` (zod) fila por fila, sin duplicar reglas. Catálogos
  (Campaña/Cargo/Tipo de Documento/Fuente/Estado Gestión) se resuelven con variantes "flexibles"
  nuevas en `catalogo.repository.js` (`idPorCodigoFlexible`, etc. — `LOWER(TRIM(...))`, no tocan las
  funciones exactas que usa el formulario manual), a pedido del usuario: el Excel puede traer
  mayúsculas/espacios de más y aun así resolver.
- Nuevo módulo `candidato.importarExcel.js`: lee el `.xlsx` con `exceljs` (no existía lector, solo
  generador — el de exportar Excel en `reportes/excel.js`), mapea por texto de encabezado (no por
  posición), y valida "Sí"/"No" de las 3 columnas booleanas antes de tocar el esquema.
- Frontend: botón "Cargar Excel" junto a "Nuevo candidato" en `ListaCandidatos.jsx`, modal nuevo
  `ImportarExcelModal.jsx` (plantilla descargable + subida + lista de errores por fila, sin cerrar el
  modal si falla, para corregir sin perder contexto).

**Dos bugs reales encontrados en uso real, ya corregidos:**
- **Correo convertido en hipervínculo por Excel** (`candidato.importarExcel.js`): al escribir un
  correo y dar Enter, Excel lo autoconvierte a `{ text, hyperlink }` — `String(valor)` de eso da
  literalmente `"[object Object]"`, y el correo (perfectamente válido) se rechazaba como
  "Invalid email address". Fix: `textoPlano()` extrae `.text` de hipervínculos, concatena
  `richText`, y sigue `.result` de fórmulas, antes de cualquier validación.
- **Carrera entre dos cargas simultáneas con el mismo documento**: la restricción `UNIQUE` de
  `candidatos.numero_documento` (`uq_candidatos_documento`) protege la integridad —nunca quedan dos
  candidatos con el mismo documento—, pero como la validación (`existeDocumento`) corre ANTES de
  abrir la transacción, dos cargas al mismo segundo pueden pasarla ambas y solo una gana al insertar.
  La que pierde veía un 409 genérico ("Ya existe un registro con esos datos") sin decir cuál fila.
  Fix: se captura `ER_DUP_ENTRY` de esa restricción específica dentro del loop de inserción y se
  traduce al mismo formato `Fila N: ...` que cualquier otro error de validación — el lote sigue
  revirtiéndose completo (todo o nada intacto), pero ahora sí dice cuál fila fue.

Verificado con `node --check`, suite completa (128/129, mismo fallo preexistente de siempre) y
prueba end-to-end real en navegador (login Administrador, descarga de plantilla, archivo con fila
mala rechazado con el error exacto, archivo corregido con 2 filas creadas — una con `Citado=Sí` quedó
realmente citada, la otra en "Nuevo", ambas con el reclutador/admin correcto en la columna
"Reclutador"). Tests de integración nuevos en `tests/integracion/candidatos.importar.test.js` (7
casos: permisos, plantilla, alta exitosa con atribución/citación, todo-o-nada, correo hipervínculo,
carrera de documento duplicado — este último corrido 5 veces seguidas sin fallar).

**Pendiente de esta sección:** commitear y desplegar a producción (backend y frontend) — todo lo de
arriba sigue solo en local al cierre de esta sesión.

### 11.12 "Citado" del perfil mostraba "No" para candidatos ya citados por Selección (2026-09-16)

Reportado por el usuario en producción: el candidato David Alejandro Devia Gómez (CC 1073514836),
en estado `aprobado_final` (ya pasó por todo el embudo, incluida la citación), mostraba "Citado: No"
en su perfil (`Ficha.jsx`).

**Causa**: `hyd_candidatos.citado` solo se fija una vez, al registrar el candidato (checkbox "Citado"
del formulario "Nuevo Candidato", ver §11.11-b y `candidato.service.js::crear`) — nunca se actualiza
después si el candidato termina citado por el camino normal de Selección (Agenda →
`seleccion.service.js`/`citar.js`, que solo tocan `estado` y `candidato_citaciones`, no la columna
`citado`). Este candidato se registró con `Citado: No` y fue citado más tarde por Selección: el dato
crudo quedó desactualizado aunque el proceso real siguió su curso. El Excel (`reportes/excel.js:114`)
ya tenía este mismo parche (cae a `fecha_citado` cuando `citado` es `null`/`undefined`); el perfil y
el listado nunca lo recibieron.

**Fix** en `candidato.repository.js`: nueva función `resolverCitado(fila)`, aplicada a los resultados
de `buscarPorId` (perfil) y `listar` (listado de candidatos) — `citado` pasa a ser `true` si la
columna cruda ya lo era **o** si el candidato tiene alguna citación real (`citacion_id`, ya
seleccionada en `SELECT_BASE` para el botón "Seguimiento"). Se resuelve en JS después de la consulta,
no con una expresión SQL calculada en el `SELECT`: el driver (`config/db.js::convertirTipos`) solo
auto-convierte a booleano real las columnas `TINYINT(1)` crudas, no el resultado de un `OR`/comparación
— hacerlo en SQL habría devuelto `0`/`1` en vez de `true`/`false`, y `Ficha.jsx::siNo()` (que compara
con `=== true`/`=== false`) lo habría mostrado en blanco en vez de "Sí"/"No".

No cambia nada más: el campo sigue siendo de solo lectura en `EditarCandidato.jsx`/`CandidatoCampos.jsx`
(no hay forma de marcar "Citado: Sí" a mano desde ahí, por diseño), y el botón "Citar" de
`ListaCandidatos.jsx` sigue dependiendo únicamente de `estado` (`nuevo`/`formularios_completados`), no
de este campo — para este candidato, ya en `aprobado_final`, sigue sin mostrarse, correctamente.

Verificado con `node --check` y la suite completa (128/130, las 2 fallas de `reportes.test.js` son
preexistentes — confirmado con `git stash` que fallan igual sin este cambio).

**Pendiente:** commitear y desplegar a producción.

### 11.13 Descarga unificada de antecedentes y de documentos firmados (2026-10-02)

Pedido del usuario: desde el perfil del candidato, descargar en **un solo PDF** con el **nombre del
candidato** como nombre de archivo (`José Peña.pdf`):

- **Pestaña Antecedentes → "Descargar todos en un PDF"**
  (`GET /api/antecedentes/candidatos/:id/unificado`, `antecedentesServicio.unificar()`): une los
  soportes cargados en el orden del catálogo (`tipos_antecedente.orden`: ADRES, Policía, Comparendos,
  Procuraduría), saltando los que no tienen archivo. Los PDF aportan sus páginas tal cual (`pdf-lib`,
  `ignoreEncryption`); cada JPG/PNG va en una página carta, centrada y reducida para caber. Sin
  soportes → 404 `SIN_SOPORTES`; un soporte ilegible → 400 `SOPORTE_ILEGIBLE` nombrando cuál, para
  volver a cargarlo. El botón solo aparece si hay al menos un soporte. La lectura segura del archivo
  (que la ruta no escape de `uploads/`) se extrajo a `leerArchivo()`, compartida con la descarga
  individual.
- **Pestaña Selección → panel "Firma electrónica" → "Descargar ambos en un PDF"**
  (`GET /api/firma/:id/unificado`, `formularioServicio.unificarDocumentosFirmados()`): pide a
  FirmaCloud la hoja de vida y el tratamiento de datos firmados (en paralelo) y los une en ese orden.
  Si FirmaCloud devuelve algo que no es PDF → error de servicio externo, no un archivo roto.

Ambas rutas usan `ver_candidatos` + `obtenerAccesible` (misma regla que las descargas individuales).
El nombre de archivo lo arma `src/shared/utils/descarga.js::enviarPdfComoAdjunto()` (quita
caracteres inválidos en nombres de archivo; `filename*` UTF-8 con respaldo ASCII). El frontend no
puede leer esa cabecera (`api.get` solo devuelve el Blob), así que `PerfilCandidato.jsx` le pasa
`nombreDe(candidato)` a `Antecedentes.jsx`/`ExpedienteSeleccion.jsx` y estos llaman a
`descargarBlob()`. Ojo: las dos descargas producen el mismo nombre de archivo; si se bajan ambas, el
navegador agrega "(1)" a la segunda — se ofreció distinguirlas con sufijo y quedó sin decidir.

Verificado con la prueba de extremo a extremo (`flujo-completo.test.js`, pasos 7c y 10: número de
páginas del unificado = suma de las partes) y en navegador contra la base local (antecedentes: 3 + 7
= 10 páginas; firma del candidato 1073: 2 + 5 = 7 páginas).

**Commits** (sin push al cierre de la sesión): `hidrabackend` `main` `f4aeb28`, `hidrafrontend`
`sebas-branch` `931c85d`. Solo esos archivos; lo de la integración con Gestor (ver
`claude/integracion-gestor.md`) sigue sin commitear a propósito. No requiere migraciones. Para
desplegar: push → `git pull` + `pm2 restart hidra-backend` en el backend, merge a `main` +
`git pull` + `npm run build` en el frontend. **No reiniciar el servidor** para esto: ver §11.10, el
arreglo de red sigue sin ser persistente (el servidor pedía reinicio el 2026-10-02).

Nota de lint: `formulario.service.js:437` (`fecha_nacimiento` sin usar) ya fallaba antes de este
cambio; no se tocó.

### 11.14 "Pendientes de decisión" y "Rechazados en evaluación" vacías en Clínica Agentes — no es bug
### (2026-10-02)

Reportado por el usuario en producción (perfil Administrador). Esas dos pestañas de
`Decisiones.jsx` listan por **estado actual** (`/candidatos?estado=aprobado|rechazado`): son colas de
trabajo — un Agente entra al evaluarse (`seleccion.service.js::evaluar`) y sale al darle "Decidir"
(`aprobado_final`/`rechazado_final`). Consultado en producción: 0 candidatos en `aprobado` y 0 en
`rechazado`; las 189 evaluaciones existentes ya tienen decisión final (135 aprobó→aprobado final,
14 aprobó→rechazado final, 30 no aprobó→rechazado final, 10 no aprobó→aprobado final — la decisión
final es independiente del puntaje por diseño). Los 33 en `entrevistado` esperan evaluación, que se
hace desde "Candidatos" (botón "Evaluar"), no desde Clínica Agentes. "Aprobados"/"Rechazados" de esa
pantalla no filtran por cargo, así que también incluyen Staff.

Se le ofrecieron dos cambios, **sin decidir todavía**: (1) pestaña "Por evaluar" en Clínica Agentes
con los Agentes en `entrevistado`; (2) que "Rechazados en evaluación" sea histórico (toda evaluación
no aprobada, aunque ya tenga decisión final).

### 11.15 Hoja de vida sin generar para dos candidatos de Staff: `WinAnsi cannot encode` (2026-10-16)

Reportado en producción: dos candidatos de cargo Staff (ids **1984** y **2062**) tenían la ficha
completa en Hydra, pero "Ver hoja de vida"/"Tratamiento de datos" daban **404** y en FirmaCloud no
había ningún registro de ellos. **No era un problema del cargo Staff** ni de FirmaCloud: el log de
producción (`pm2 logs hidra-backend`, JSON de pino) mostraba `WinAnsi cannot encode "\n"` al generar
la hoja de vida. Esos candidatos escribieron "Funciones" en varios renglones en el textarea, y las
fuentes estándar de `pdf-lib` (Times) solo codifican WinAnsi: un salto de línea, un tab o un emoji
hace fallar `widthOfTextAtSize`/`drawText`. Eso tumbaba la generación **completa** del PDF, así que
`enviarAFirmar` (`formulario.service.js`) caía en su `catch` ("Falló el envío a firma electrónica")
**sin guardar registro de firma**, y nunca se llamaba a FirmaCloud. Que les pasara a dos de Staff
fue coincidencia de lo que escribieron, no del cargo.

**Corregido** (commit `c5ffc92`, desplegado): `documentos/pdf/pdfFillHelpers.js` tiene un nuevo
`sanitizeForPdf(value)`, que convierte en espacio todo carácter fuera de WinAnsi (Latin-1 +
`WINANSI_EXTRA_CHARS`, los de cp1252 0x80-0x9F) y colapsa espacios y saltos con `\s+ → ' '`.
`drawTextBox` y `drawFit` lo aplican **siempre** antes de medir o dibujar, así que cubre la hoja de
vida y el tratamiento de datos sin tocar cada campo. Queda exportado por si otro servicio dibuja
texto sin pasar por estos helpers.

**Para los afectados**, el fix no regenera nada solo: hay que reenviarlos a firma. Se puede usar el
botón de reenvío de formulario en el perfil (requiere permiso `reenviar_emails`), o
`POST /api/firma/:id/reenviar` (`reenviarAFirmar`). En "Candidatos" (`ListaCandidatos.jsx`) el
botón de reenvío está oculto cuando `segmento === 'staff'`.

**Para diagnosticar casos parecidos**: si el candidato no aparece en FirmaCloud, el fallo fue en
Hydra **antes** del envío. Buscar `Falló el envío a firma electrónica` con su `candidatoId` en
`pm2 logs hidra-backend` (el proceso se llama `hidra-backend`, en el servidor de Hydra, no en el de
FirmaCloud).

### 11.16 Excel: "ESTADO GESTIÓN RECLUTAMIENTO" mostraba un motivo de no-citado a candidatos ya citados (2026-10-16)

Reportado en producción con el export "todos" (`todos-2026-10-13-a-2026-10-14.xlsx`): una candidata
en `aprobado_final` (asistió y aprobó todo) salía con **"NO INTERESADO / VENTAS"** en esa columna.
Esa columna sale del catálogo `estados_gestion_reclutamiento`, que es el **motivo por el que NO se
citó** al candidato, y solo tiene sentido con Citado = No. Había dos causas:

1. **En el registro**, el schema (`candidato.schema.js`, `superRefine`) exige `estadoGestion` solo
   si `citado === false`, pero **nunca lo limpia** si `citado === true`. El frontend
   (`CandidatoCampos.jsx::cambiarCitado`) sí lo limpia al marcar Sí, pero por la carga masiva
   (`candidato.importarExcel.js`, donde CITADO y ESTADO GESTIÓN son columnas independientes) o
   cualquier otro camino se podía guardar Citado = Sí con un motivo.
2. **En el export**, `excel.js::filaBase` hacía `c.estado_gestion || textoEstadoGestion(c)`: si
   había motivo guardado, ese ganaba siempre sobre el estado real del proceso. Así, un "No contesta"
   de un candidato registrado como Citado = No y **citado después por Selección** se quedaba pegado
   aunque avanzara.

**Corregido** (commit `2f6bdba`):
- `excel.js::filaBase`: `c.fecha_citado ? textoEstadoGestion(c) : c.estado_gestion || textoEstadoGestion(c)`.
  Si existe una citación (`fecha_citado` = `created_at` de la **última** citación, de `SELECT_EXCEL`
  en `reportes.repository.js`), manda el estado real; si no, el motivo como antes. `filaBase` es
  común a los tres reportes (todos, citados y aprobados), y en los dos últimos todos tienen citación.
- `candidato.service.js` (crear): `estadoGestionId: datos.citado === true ? null : ref.estadoGestionId ?? null`.
  Solo afecta registros **nuevos**.

**Impacto verificado sobre el Excel real (178 filas)**: cambian 6 filas, las únicas con citación y
motivo guardado a la vez. Son la reportada (Citado = Sí + motivo) y 5 registradas con Citado = No y
citadas después ("No contesta"/"No interesado"/"#Errado" → su estado real). Las otras 172 no
cambian. La columna CITADO no se tocó en este cambio (sí en el siguiente, ver §11.17).
**No se modifica ningún dato**: el motivo viejo sigue en la BD y solo deja de mostrarse en esa
columna. Si negocio quiere ver el motivo original de los citados después, habría que agregarlo como
columna aparte. El histórico (`noviembrehidra`) usa otro código y no se tocó.

**Limpieza opcional de datos** (no aplicada; solo los Citado = Sí, porque los Citado = No citados
después tienen un motivo que sí fue cierto al registrar):

```sql
SELECT id, estado_gestion_id FROM candidatos WHERE citado = 1 AND estado_gestion_id IS NOT NULL;
UPDATE candidatos SET estado_gestion_id = NULL WHERE citado = 1 AND estado_gestion_id IS NOT NULL;
```

**Deuda conocida que sigue igual**: el schema todavía no limpia `estadoGestion` cuando
`citado === true` en la **edición** del candidato; solo lo corrige la creación. Además, en local
fallaban de antes un lint (`'nombre' is assigned a value but never used`, `candidato.service.js`) y
un test (`reportes.test.js > promedia la evaluación por criterio`); ninguno de los dos viene de
estos cambios (180/181 tests pasan).

### 11.17 Excel: CITADO salía "No" a candidatos que asistieron a la entrevista (2026-10-20)

Reportado con el export "todos" de producción (`todos-2026-10-01-a-2026-10-19.xlsx`): el candidato
Cristian Enrique Castillo Álvarez (CC 1005582623, registrado el 08/10/2026) salía con **CITADO = NO**
pero **ASISTE ENTREVISTA = ASISTIÓ**, ESTADO GESTIÓN = RECHAZADO FINAL y decisión final llena.

**Causa**: la misma de §11.12, pero en el Excel. La columna `candidatos.citado` solo se escribe al
registrar y nunca se actualiza si el candidato se cita después (`candidato_citaciones`). El export
hacía `c.citado === null ? (c.fecha_citado ? 'Sí' : 'No') : siNo(c.citado)`: el respaldo a la
citación real solo aplicaba con `citado` en `NULL`, y desde que el campo es obligatorio al registrar
(2026-09-15) nunca es `NULL`. Un candidato registrado con Citado = No ("No contesta", "No interesado",
etc.) y citado después quedaba con "No" para siempre. El perfil ya lo resolvía bien desde §11.12
(`candidato.repository.js::resolverCitado`); el Excel no.

**Corregido** en `excel.js::filaBase`: `c.citado === true || c.fecha_citado ? 'Sí' : 'No'`. Es la
misma regla que `resolverCitado`: Sí si se marcó al registrar **o** si existe una citación. Va en la
misma línea que §11.16: con citación, CITADO y ESTADO GESTIÓN reflejan el proceso real, no lo que se
capturó al registrar. No modifica datos: `candidatos.citado` sigue con el valor original.

**Impacto medido sobre el Excel reportado (781 filas)**: pasan de NO a SÍ **50 filas**, las que
tenían CITADO = NO y ESTADO GESTIÓN con un estado del proceso (solo posible con citación): 19 No
asistió, 18 Aprobado final, 8 Entrevistado, 4 Citado, 1 Rechazado final. De ellas, 46 tienen la
asistencia marcada (la inconsistencia visible). Las otras 731 no cambian. Ninguna fila con CITADO = SÍ
cambia, porque la regla nueva solo puede convertir un No en Sí.

**Prueba**: `tests/integracion/reportes.test.js` ya no simula `citado = NULL` en la base; registra al
candidato con Citado = No (el caso real) y verifica CITADO = SÍ y que ESTADO GESTIÓN no sea el motivo
del registro. Sin el arreglo, la prueba falla con `"NO"`. Suite de reportes: 16/17 (la falla es la
preexistente `promedia la evaluación por criterio`).

**Pendiente:** commitear y desplegar (`git pull` + `pm2 restart hidra-backend`; **no reiniciar el
servidor**, ver §11.10). Si negocio quiere seguir viendo lo que marcó la reclutadora al registrar,
habría que agregarlo como columna aparte.
