const express = require('express');
const router = express.Router();
const candidatoController = require('../controllers/candidato.controller');
const { verificarToken, verificarPermiso } = require('../middleware/auth.middleware');
const { uploadAntecedentes } = require('../middleware/upload.middleware');

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
router.put('/no-citado/:candidatoId', verificarToken, verificarPermiso('agendar_entrevistas'), candidatoController.marcarNoCitado);
router.put('/citado-gestion/:candidatoId', verificarToken, verificarPermiso('agendar_entrevistas'), candidatoController.actualizarCitadoGestion);
router.get('/reclutadores-activos', verificarToken, verificarPermiso('reasignar_candidatos'), candidatoController.getReclutadoresActivos);
router.put('/reasignar/:candidatoId', verificarToken, verificarPermiso('reasignar_candidatos'), candidatoController.reasignarCandidato);

// Antecedentes (ADRES/POL/COMP/PROCU), cada uno con su propio documento de soporte (PDF/imagen).
// El archivo se procesa con un wrapper propio (no el middleware de multer directo) para poder
// responder JSON en vez de dejar que Express muestre su página de error HTML por defecto ante un
// archivo inválido/pesado.
function subirDocumentosAntecedentes(req, res, next) {
  uploadAntecedentes.fields([
    { name: 'documento_adres', maxCount: 1 },
    { name: 'documento_pol', maxCount: 1 },
    { name: 'documento_comp', maxCount: 1 },
    { name: 'documento_procu', maxCount: 1 }
  ])(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Error subiendo el archivo' });
    }
    next();
  });
}
router.put(
  '/antecedentes/:candidatoId',
  verificarToken,
  verificarPermiso('editar_candidatos'),
  subirDocumentosAntecedentes,
  candidatoController.actualizarAntecedentes
);
router.get('/antecedentes/:candidatoId/documento/:tipo', verificarToken, verificarPermiso('ver_candidatos'), candidatoController.descargarDocumentoAntecedentes);

router.put('/hoja-vida/:token', candidatoController.actualizarHojaVida.bind(candidatoController));
router.put('/datos-basicos/:token', candidatoController.actualizarDatosBasicos.bind(candidatoController));
router.put('/estudios/:token', candidatoController.actualizarEstudios.bind(candidatoController));
router.put('/experiencia/:token', candidatoController.actualizarExperiencia.bind(candidatoController));
router.put('/personal/:token', candidatoController.actualizarPersonal.bind(candidatoController));
router.put('/consentimiento/:token', candidatoController.actualizarConsentimiento.bind(candidatoController));

module.exports = router;