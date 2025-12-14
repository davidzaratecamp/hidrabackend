const express = require('express');
const router = express.Router();
const seleccionController = require('../controllers/seleccion.controller');
const { verificarToken } = require('../middleware/auth.middleware');

// Todas las rutas requieren autenticación
router.use(verificarToken);

// Middleware para verificar rol de selección o administrador
const verificarRolSeleccion = (req, res, next) => {
  if (req.usuario.rol !== 'seleccion' && req.usuario.rol !== 'administrador') {
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de selección o administrador.' });
  }
  next();
};

// Aplicar middleware de rol a todas las rutas
router.use(verificarRolSeleccion);

// Rutas principales
router.get('/candidatos-citados', seleccionController.getCandidatosCitados);
router.get('/candidatos-aprobados', seleccionController.getCandidatosAprobados);
router.get('/candidatos-rechazados', seleccionController.getCandidatosRechazados);
router.get('/oleadas', seleccionController.getOleadas);
router.get('/estadisticas', seleccionController.getEstadisticasSeleccion);
router.get('/estadisticas-aprobados', seleccionController.getEstadisticasAprobados);

// Rutas de gestión de oleadas
router.get('/oleada-actual/:operacion/:campana', seleccionController.getOleadaActual);
router.get('/oleadas-disponibles/:operacion/:campana', seleccionController.getOleadasDisponibles);
router.post('/inicializar-oleadas', seleccionController.inicializarOleadas);

// Rutas de gestión de candidatos
router.put('/candidatos/:candidatoId/asistencia', seleccionController.marcarAsistencia);
router.put('/candidatos/:candidatoId/oleada', seleccionController.asignarOleada);
router.put('/candidatos/:candidatoId/estado', seleccionController.actualizarEstado);
router.put('/candidatos/:candidatoId/operacion-campana', seleccionController.actualizarOperacionCampana);
router.put('/candidatos/:candidatoId/evaluacion', seleccionController.guardarEvaluacion);
router.put('/candidatos/:candidatoId/decision-final', seleccionController.tomarDecisionFinal);

// Rutas de gestión de oleadas
router.post('/oleadas', seleccionController.crearOleada);


module.exports = router;