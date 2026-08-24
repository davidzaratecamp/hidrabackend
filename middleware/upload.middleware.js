const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Almacena en disco bajo uploads/antecedentes, con nombre generado (uuid) para evitar
// colisiones y path traversal - el nombre original del archivo se guarda aparte en BD
// (antecedentes_documento_nombre) para mostrarlo al descargar.
const storageAntecedentes = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads', 'antecedentes'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});

const TIPOS_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];

const uploadAntecedentes = multer({
  storage: storageAntecedentes,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (!TIPOS_PERMITIDOS.includes(file.mimetype)) {
      return cb(new Error('Solo se permiten archivos PDF o imágenes (JPG/PNG)'));
    }
    cb(null, true);
  }
});

module.exports = { uploadAntecedentes };
