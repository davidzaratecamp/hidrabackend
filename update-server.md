# Instrucciones para actualizar servidor

## Cambios pendientes en el servidor:
1. Ruta `/api/candidato/editar/:candidatoId` - 404 error
2. Ruta `/api/candidato/fecha-entrevista/:candidatoId` - 404 error  
3. "No apto" en observaciones_llamada
4. Funciones `editarCandidato` y `actualizarFechaEntrevista`

## Comandos para ejecutar en el servidor:
```bash
cd /path/to/backend
git pull origin main
npm install
# Reiniciar el proceso de Node.js
```

## Verificar que funcione:
```bash
curl http://200.91.204.54/api/candidato/catalogos
# Debe incluir "No apto" en observaciones_llamada
```

## Último commit con cambios:
- `98d040e Agregar 'No apto' a observaciones de llamada y permisos de entrevista`