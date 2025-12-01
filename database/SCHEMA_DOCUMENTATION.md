# 📋 Documentación del Esquema de Base de Datos

## ⚠️ IMPORTANTE: Estado Real de Producción vs. Archivos de Desarrollo

### 🔴 **Diferencias Críticas Documentadas**

#### **Campo `reclutador_id`**
- ✅ **EXISTE en producción** (verificado Nov 2024)
- ✅ **EXISTE en desarrollo local** 
- ❌ **NO estaba documentado** en esquemas originales
- 🔧 **ACTUALIZADO** en `complete_database.sql`

#### **Estados de Candidatos**
**Producción (15 estados):**
```sql
ENUM(
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
    'contratado'
)
```

**Esquema Original (8 estados):**
```sql
ENUM('nuevo', 'formularios_enviados', 'formularios_completados', 'citado', 'entrevistado', 'aprobado', 'rechazado', 'contratado')
```

## 🏗️ **Estructura Real de Producción**

### **Tabla `hyd_candidatos`**
```sql
CREATE TABLE hyd_candidatos (
    id INT PRIMARY KEY AUTO_INCREMENT,
    
    -- [Campos estándar como en complete_database.sql]
    
    -- CAMPO CRÍTICO PARA FUNCIONALIDAD
    reclutador_id INT NULL,
    
    -- Estados completos de producción
    estado ENUM(...) DEFAULT 'nuevo',
    
    -- Índices requeridos
    INDEX idx_reclutador (reclutador_id),
    
    -- Relación de integridad
    FOREIGN KEY (reclutador_id) REFERENCES hyd_usuarios(id) ON DELETE SET NULL
);
```

### **Tabla `hyd_usuarios`**
- ✅ Estructura igual en producción y desarrollo
- ✅ Roles: `reclutador`, `seleccion`, `administrador`
- ✅ Campo `activo` para control de acceso

## 🔧 **Funcionalidad Dependiente de `reclutador_id`**

### **Backend (candidato.controller.js)**
```javascript
// Filtro por reclutador en todas las consultas
WHERE reclutador_id = ? OR reclutador_id IS NULL

// Control de acceso por reclutador
const reclutadorId = req.usuario.id;
```

### **Frontend (Dashboard, ListaCandidatos)**
- Dashboard muestra solo candidatos del reclutador logueado
- Filtros de estado respetan la asignación por reclutador
- Acciones (enviar emails, cambiar estado) están limitadas por reclutador

## 🔄 **Flujo de Estados Completo**

### **Estados de Contacto**
```
nuevo → contacto_exitoso → formularios_enviados
   ↓
contacto_fallido / no_contesta / reagendar / no_interesado / numero_incorrecto
```

### **Estados de Proceso**
```
formularios_enviados → formularios_completados → citado → entrevistado
                                                    ↓
                                                no_asistio
```

### **Estados Finales**
```
entrevistado → aprobado / rechazado → contratado
```

## ⚡ **Impacto en Nuevos Desarrollos**

### **✅ Considerar Siempre:**
1. **Campo `reclutador_id`** es obligatorio en consultas
2. **Estados completos** para lógica de negocio
3. **Control de acceso** por reclutador en todas las funciones
4. **Integridad referencial** con tabla usuarios

### **🔧 Scripts de Migración**
- ✅ Creados en `/scripts_migracion/`
- ✅ Consideran relación reclutador-candidato
- ✅ Preservan historial completo
- ✅ Manejan desactivación segura de usuarios

## 📅 **Historial de Cambios**

### **Nov 2024 - Actualización de Documentación**
- ✅ Agregado campo `reclutador_id` faltante
- ✅ Actualizado ENUM de estados completo
- ✅ Documentado índices requeridos
- ✅ Agregada clave foránea para integridad

### **Referencias:**
- Verificación en producción: `DESC hyd_candidatos;`
- Código backend: `candidato.controller.js:60`
- Frontend: `Dashboard.jsx`, `ListaCandidatos.jsx`

---

**🚨 NOTA CRÍTICA:** Este documento debe actualizarse cada vez que se modifique el esquema de producción. La discrepancia entre esquemas puede causar errores en desarrollo y despliegues.