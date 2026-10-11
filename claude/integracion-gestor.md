# Integración con el Gestor Técnico (contratación en RRHH)

Hydra envía al Gestor Técnico (módulo de RRHH, repo hermano
`C:\Users\juan.acosta\Desktop\BackGestor\gestor-tecnico-backend`) los candidatos aprobados, para
que RRHH complete los datos de contratación y los registre como empleados. Cuando RRHH registra
o descarta a uno, Gestor avisa de vuelta.

**El plan completo, el contrato de la API y las notas de implementación viven en el repo de
Gestor: `conexionhydra.md`** (§5 contrato, §11 decisiones abiertas, §13.5 lado de Hydra, §13.6
prueba integrada, §14 despliegue). Este archivo es solo el mapa del lado de Hydra. Los diagramas
(arquitectura, secuencias, estados y flujo de datos) están en ese repo, en
`docs/diagramas/conexion-hydra/`.

## Flujo

```
Formación: POST /api/contratacion/lotes ─► outbox (contratacion_envios) ─► Gestor /lotes
                                                                              │ RRHH completa,
                                                                              │ verifica, registra
Hydra: candidato → "contratado"  ◄── POST /api/integraciones/gestor/v1/contrataciones (firmado)
       nota "descartado"         ◄── POST /api/integraciones/gestor/v1/descartes      (firmado)
```

## Rol Formación (migración 019, 2026-10-02)

Quien envía a contratación es el rol **Formación** (y Administrador); Selección perdió
`enviar_contratacion`. Formación solo ve a quienes pasan a formación y no se han enviado:
- **Agente** aprobado final y citado a formación: marca **asistió Sí/No** (razón si No) y
  **activo/baja** (razón si baja). Activo exige asistencia en Sí; marcar "No asistió" borra el
  activo.
- **Staff** aprobado final y marcado como contratación: solo **activo/baja**.

Todo es informativo (`candidato_formacion`): no cambia el estado del embudo. Una vez enviado, ya no
se edita (para deshacer, "cancelar" en el lote). Permiso `gestionar_formacion` (Formación y
Administrador). Formación no tiene `ver_candidatos`: no ve el listado ni los perfiles.
Backend: `src/modules/formacion/` (`GET /api/formacion/candidatos`,
`PUT /candidatos/:id/asistencia`, `PUT /candidatos/:id/estado`).

## Pantallas (frontend, repo `ReclutamientoFronted/hidrafrontend`)

- **Formación** (`/formacion`, `src/components/formacion/Formacion.jsx`): "En formación"
  (asistencia, activo/baja, casillas de los listos + "Enviar a contratación") y "Lotes enviados".
- **Detalle del lote** (`/formacion/lotes/:loteId`): estado de cada candidato en Gestor,
  reenviar, cancelar y reintentar envíos; se actualiza sola mientras hay algo en camino.
- El historial del candidato muestra "Gestor Técnico (automático)" en el paso a `contratado`.

## Dónde está

- `db/migrations/018_integracion_gestor.sql`: `contratacion_lotes`, `contratacion_candidatos`,
  `contratacion_envios` y el permiso `enviar_contratacion`.
- `db/migrations/019_rol_formacion.sql`: rol `formacion`, permiso `gestionar_formacion`, tabla
  `candidato_formacion`; `enviar_contratacion` pasa de Selección a Formación. Aplicada solo en local.
- `src/modules/contratacion/`: reglas puras (`contratacion.reglas.js`), repositorio, servicio y
  rutas.
- `src/modules/integraciones/gestor/`: adaptador HTTP y en memoria; middleware `autenticarGestor`.
- `src/shared/seguridad/firmaHmac.js`: firma HMAC. **Tiene que ser idéntica a
  `utils/firmaHydra.js` de Gestor**; si una cambia, la integración se rompe en los dos sentidos.

## Configuración (`.env`, ver `.env.example`)

| Variable | Equivale en Gestor a |
|---|---|
| `GESTOR_API_URL` | base de `/api/integraciones/hydra/v1` |
| `GESTOR_API_KEY` / `GESTOR_HMAC_SECRET` | `HYDRA_API_KEY` / `HYDRA_HMAC_SECRET` |
| `GESTOR_CALLBACK_API_KEY` / `GESTOR_CALLBACK_HMAC_SECRET` | `HYDRA_CALLBACK_API_KEY` / `HYDRA_CALLBACK_HMAC_SECRET` |
| `GESTOR_DESPACHO_INTERVALO_MS` | — (cada cuánto se revisa el outbox; 0 lo apaga) |

Sin las variables de salida, los envíos quedan `pendiente` (a propósito no hay adaptador en
memoria fuera de las pruebas). Sin las de entrada, los avisos de Gestor reciben 503 y Gestor los
reintenta.

## Reglas que hay que conocer

- **Elegible**: `aprobado_final` + (Agente: citado a formación y asistió · Staff: contratación
  registrada) + **activo en formación** + número de documento + nunca enviado antes. Un candidato vive en un solo lote; para corregir o
  deshacer se usa "reenviar" o "cancelar".
- **El estado `contratado` solo lo pone el aviso de Gestor.**
- **Un 409 de Gestor no es éxito** (a diferencia de la dirección inversa): `LOTE_CERRADO` deja el
  envío `fallido` y visible.
- **Pruebas**: `tests/unidad/contratacion.reglas.test.js` y
  `tests/integracion/contratacion.test.js` (Gestor en memoria). La prueba entre las dos apps se
  hace **en local con los dos backends corriendo a la vez** antes de desplegar (`conexionhydra.md`
  §13.6).
- `reportes.test.js › promedia la evaluación por criterio` falla en la base local por datos reales
  preexistentes (promedia toda la base). No tiene relación con esta integración.
