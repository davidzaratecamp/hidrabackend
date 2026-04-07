const { Router } = require('express');
const { getMesesController, getPdfController } = require('../controllers/desprendibles.controller');
const { verificarToken } = require('../middleware/auth.middleware');

const router = Router();

// GET /api/desprendibles/meses
router.get('/meses', verificarToken, getMesesController);

// GET /api/desprendibles/pdf/:year/:month
router.get('/pdf/:year/:month', verificarToken, getPdfController);

module.exports = router;
