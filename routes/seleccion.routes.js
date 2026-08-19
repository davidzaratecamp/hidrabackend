const express = require('express');
const router = express.Router();
const seleccionController = require('../controllers/seleccion.controller');
const { verificarToken } = require('../middleware/auth.middleware');

// Todas las rutas requieren autenticación
router.use(verificarToken);

// Middleware para verificar rol de selección o administrador (escritura)
const verificarRolSeleccion = (req, res, next) => {
  if (req.usuario.rol !== 'seleccion' && req.usuario.rol !== 'administrador') {
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de selección o administrador.' });
  }
  next();
};

// Middleware de solo lectura: reclutador, seleccion y administrador
const verificarRolLectura = (req, res, next) => {
  const rolesPermitidos = ['reclutador', 'seleccion', 'administrador'];
  if (!rolesPermitidos.includes(req.usuario.rol)) {
    return res.status(403).json({ error: 'Acceso denegado.' });
  }
  next();
};

// Rutas principales (lectura: todos los roles)
router.get('/candidatos-citados', verificarRolLectura, seleccionController.getCandidatosCitados);
router.get('/candidatos-total', verificarRolLectura, seleccionController.getCandidatosTotal);
router.get('/candidatos-aprobados', verificarRolLectura, seleccionController.getCandidatosAprobados);
router.get('/candidatos-rechazados', verificarRolLectura, seleccionController.getCandidatosRechazados);
router.get('/oleadas', verificarRolLectura, seleccionController.getOleadas);
router.get('/estadisticas', verificarRolLectura, seleccionController.getEstadisticasSeleccion);
router.get('/estadisticas-aprobados', verificarRolLectura, seleccionController.getEstadisticasAprobados);

// Rutas de gestión de oleadas
router.get('/oleada-actual/:operacion/:campana', verificarRolLectura, seleccionController.getOleadaActual);
router.get('/oleadas-disponibles/:operacion/:campana', verificarRolSeleccion, seleccionController.getOleadasDisponibles);
router.post('/inicializar-oleadas', verificarRolSeleccion, seleccionController.inicializarOleadas);

// Rutas de gestión de candidatos (escritura: solo seleccion y administrador)
router.put('/candidatos/:candidatoId/asistencia', verificarRolSeleccion, seleccionController.marcarAsistencia);
router.put('/candidatos/:candidatoId/oleada', verificarRolSeleccion, seleccionController.asignarOleada);
router.put('/candidatos/:candidatoId/estado', verificarRolSeleccion, seleccionController.actualizarEstado);
router.put('/candidatos/:candidatoId/operacion-campana', verificarRolSeleccion, seleccionController.actualizarOperacionCampana);
router.put('/candidatos/:candidatoId/evaluacion', verificarRolSeleccion, seleccionController.guardarEvaluacion);
router.put('/candidatos/:candidatoId/decision-final', verificarRolSeleccion, seleccionController.tomarDecisionFinal);

// Rutas de gestión de oleadas
router.post('/oleadas', verificarRolSeleccion, seleccionController.crearOleada);


module.exports = router;