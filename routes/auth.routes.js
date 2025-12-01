const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { verificarToken, verificarRol } = require('../middleware/auth.middleware');

// Rutas públicas
router.post('/login', authController.login);
router.post('/logout', authController.logout);

// Rutas protegidas
router.post('/verificar-token', authController.verificarToken);
router.post('/cambiar-password', verificarToken, authController.cambiarPassword);

// Rutas de administrador
router.get('/usuarios', verificarToken, verificarRol('administrador'), authController.obtenerUsuarios);
router.post('/usuarios', verificarToken, verificarRol('administrador'), authController.crearUsuario);

// Rutas específicas para gestión de reclutadores
router.get('/admin/reclutadores', verificarToken, verificarRol('administrador'), authController.obtenerReclutadores);
router.post('/admin/reclutadores', verificarToken, verificarRol('administrador'), authController.crearReclutador);
router.delete('/admin/reclutadores/:reclutadorId', verificarToken, verificarRol('administrador'), authController.eliminarReclutador);
router.post('/admin/reasignar-candidatos', verificarToken, verificarRol('administrador'), authController.reasignarCandidatos);

module.exports = router;