const express = require('express');
const router = express.Router();
const candidatoController = require('../controllers/candidato.controller');
const { verificarToken, verificarPermiso } = require('../middleware/auth.middleware');

// Rutas públicas para candidatos (con token de candidato)
router.get('/token/:token', candidatoController.validarToken);
router.get('/catalogos', candidatoController.getOpcionesCatalogo);

// Rutas protegidas para reclutadores
router.get('/por-estado/:estado', verificarToken, verificarPermiso('ver_candidatos'), candidatoController.getCandidatosPorEstado);
router.get('/resumen-estados', verificarToken, verificarPermiso('ver_dashboard'), candidatoController.getResumenEstados);
router.get('/perfil/:candidatoId', verificarToken, verificarPermiso('ver_candidatos'), candidatoController.getPerfilCompleto);
router.get('/firma-estado/:candidatoId', verificarToken, verificarPermiso('ver_candidatos'), candidatoController.getEstadoFirma);
router.get('/firma-documento/:candidatoId/:tipo', verificarToken, verificarPermiso('ver_candidatos'), candidatoController.descargarDocumentoFirmado);
router.get('/analytics/estados-tiempo', verificarToken, verificarPermiso('ver_estadisticas'), candidatoController.getEstadosEnTiempo);
router.get('/analytics/clientes', verificarToken, verificarPermiso('ver_estadisticas'), candidatoController.getEstadisticasClientes);
router.get('/analytics/cargos', verificarToken, verificarPermiso('ver_estadisticas'), candidatoController.getEstadisticasCargos);
router.get('/analytics/progreso', verificarToken, verificarPermiso('ver_estadisticas'), candidatoController.getProgresoFormularios);
router.post('/crear', verificarToken, verificarPermiso('crear_candidatos'), candidatoController.crearCandidato);
router.post('/reenviar-email/:candidatoId', verificarToken, verificarPermiso('reenviar_emails'), candidatoController.reenviarEmail);
router.put('/editar/:candidatoId', verificarToken, verificarPermiso('editar_candidatos'), candidatoController.editarCandidato);
router.put('/cambiar-estado/:candidatoId', verificarToken, verificarPermiso('editar_candidatos'), candidatoController.cambiarEstado);
router.put('/fecha-entrevista/:candidatoId', verificarToken, verificarPermiso('agendar_entrevistas'), candidatoController.actualizarFechaEntrevista);

router.put('/hoja-vida/:token', candidatoController.actualizarHojaVida.bind(candidatoController));
router.put('/datos-basicos/:token', candidatoController.actualizarDatosBasicos.bind(candidatoController));
router.put('/estudios/:token', candidatoController.actualizarEstudios.bind(candidatoController));
router.put('/experiencia/:token', candidatoController.actualizarExperiencia.bind(candidatoController));
router.put('/personal/:token', candidatoController.actualizarPersonal.bind(candidatoController));
router.put('/consentimiento/:token', candidatoController.actualizarConsentimiento.bind(candidatoController));

module.exports = router;