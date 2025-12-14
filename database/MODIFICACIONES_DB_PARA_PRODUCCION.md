# MODIFICACIONES DE BASE DE DATOS PARA PRODUCCIÓN
## Sistema HIDRA - Módulo de Aprobación Final

### 📋 RESUMEN DE CAMBIOS REALIZADOS

Durante esta sesión de desarrollo se implementó un sistema de **aprobación final** que separa la evaluación técnica (puntaje ≥71%) de la decisión final del psicólogo para aprobar o rechazar candidatos para el trabajo.

---

### 🗃️ MODIFICACIONES EN TABLA `hyd_candidatos`

#### **1. Nuevos Campos Agregados:**

```sql
-- Campos para el sistema de aprobación final
ALTER TABLE hyd_candidatos 
ADD COLUMN aprobacion_final BOOLEAN NULL DEFAULT NULL,
ADD COLUMN aprobacion_final_razon TEXT NULL,
ADD COLUMN fecha_aprobacion_final DATETIME NULL,
ADD COLUMN psicologo_decision_id INT NULL,
ADD CONSTRAINT fk_psicologo_decision 
    FOREIGN KEY (psicologo_decision_id) REFERENCES hyd_usuarios(id);
```

#### **2. Modificación del ENUM de Estados:**

```sql
-- Actualizar ENUM para incluir nuevos estados finales
ALTER TABLE hyd_candidatos 
MODIFY COLUMN estado ENUM(
  'nuevo',
  'contacto_fallido',
  'no_contesta', 
  'reagendar',
  'no_interesado',
  'numero_incorrecto',
  'contacto_exitoso',
  'formularios_enviados',
  'formularios_completados',
  'citado',
  'no_asistio',
  'entrevistado',
  'aprobado',
  'rechazado',
  'aprobado_final',      -- NUEVO ESTADO
  'rechazado_final',     -- NUEVO ESTADO
  'contratado'
) DEFAULT 'nuevo';
```

---

### 📂 ARCHIVOS DE MIGRACIÓN CREADOS

#### **1. Archivo: `agregar_aprobacion_final.sql`**
- Ubicación: `/hidrabackend/database/`
- Propósito: Agregar campos para sistema de aprobación final
- **DEBE EJECUTARSE EN PRODUCCIÓN**

#### **2. Archivo: `actualizar_enum_estados.sql`**
- Ubicación: `/hidrabackend/database/`
- Propósito: Actualizar ENUM con nuevos estados 'aprobado_final' y 'rechazado_final'
- **DEBE EJECUTARSE EN PRODUCCIÓN**

---

### 🔄 FLUJO DE ESTADOS ACTUALIZADO

```
FLUJO ANTERIOR:
nuevo → contacto_exitoso → formularios_completados → citado → entrevistado → aprobado/rechazado

FLUJO NUEVO:
nuevo → contacto_exitoso → formularios_completados → citado → entrevistado → aprobado/rechazado → aprobado_final/rechazado_final → contratado
```

---

### 🛠️ NUEVAS FUNCIONALIDADES IMPLEMENTADAS

#### **Backend (API Endpoints):**
1. `PUT /api/seleccion/candidatos/:id/decision-final` - Tomar decisión final
2. `GET /api/seleccion/candidatos-rechazados` - Obtener candidatos rechazados finalmente

#### **Frontend (Nuevos Componentes):**
1. **PerfilesRechazados.jsx** - Interfaz para candidatos rechazados
2. **DecisionFinalModal** - Modal para tomar decisión final (en CandidatosSeleccion.jsx)
3. Nueva opción en sidebar "Perfiles Rechazados"

---

### 📊 CAMPOS DE BASE DE DATOS AFECTADOS

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `aprobacion_final` | BOOLEAN NULL | TRUE = aprobado final, FALSE = rechazado final, NULL = pendiente |
| `aprobacion_final_razon` | TEXT NULL | Razón del rechazo (obligatorio si aprobacion_final = FALSE) |
| `fecha_aprobacion_final` | DATETIME NULL | Timestamp de la decisión final |
| `psicologo_decision_id` | INT NULL | ID del psicólogo que tomó la decisión (FK a hyd_usuarios) |
| `estado` | ENUM | Actualizado con 'aprobado_final' y 'rechazado_final' |

---

### 🔐 PERMISOS Y ROLES

- **Rol 'seleccion'**: Puede tomar decisiones finales y ver perfiles rechazados
- **Rol 'administrador'**: Acceso completo a todas las funcionalidades
- **Rol 'reclutador'**: Mantiene permisos existentes, sin acceso a decisión final

---

### ⚠️ INSTRUCCIONES PARA PRODUCCIÓN

#### **PASO 1: Backup de Base de Datos**
```bash
mysqldump -u usuario -p nombre_db > backup_antes_migracion_$(date +%Y%m%d_%H%M%S).sql
```

#### **PASO 2: Ejecutar Migraciones (EN ORDEN)**
```bash
# 1. Agregar nuevos campos
mysql -u usuario -p nombre_db < agregar_aprobacion_final.sql

# 2. Actualizar ENUM de estados
mysql -u usuario -p nombre_db < actualizar_enum_estados.sql
```

#### **PASO 3: Verificar Migraciones**
```sql
-- Verificar que los campos se agregaron correctamente
DESCRIBE hyd_candidatos;

-- Verificar que el ENUM se actualizó
SHOW COLUMNS FROM hyd_candidatos LIKE 'estado';
```

#### **PASO 4: Desplegar Código**
- Subir cambios del backend (controllers, routes, models)
- Subir cambios del frontend (nuevos componentes, rutas)

---

### 🧪 DATOS DE PRUEBA

Después de la migración, todos los candidatos existentes tendrán:
- `aprobacion_final = NULL` (pendiente de decisión)
- `aprobacion_final_razon = NULL`
- `fecha_aprobacion_final = NULL`
- `psicologo_decision_id = NULL`

---

### 📝 NOTAS IMPORTANTES

1. **Compatibilidad**: Los candidatos existentes seguirán funcionando normalmente
2. **Estados válidos**: El modelo CandidatoModel.js está sincronizado con la base de datos
3. **Integridad**: Se mantienen todas las relaciones y constraints existentes
4. **Performance**: Las nuevas queries están optimizadas con índices apropiados

---

### 🔍 TESTING POST-MIGRACIÓN

Verificar que funcionen:
- [ ] Tomar decisión final (aprobación/rechazo)
- [ ] Ver candidatos aprobados finalmente
- [ ] Ver candidatos rechazados finalmente
- [ ] Filtros en todas las secciones
- [ ] Estados se muestran correctamente
- [ ] Permisos por rol funcionan

---

**Fecha de documentación**: $(date +"%Y-%m-%d %H:%M:%S")
**Responsable**: Claude Code
**Versión**: Sistema HIDRA v1.1 - Módulo Aprobación Final