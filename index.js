const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
require('dotenv').config();

const candidatoRoutes = require('./routes/candidato.routes');
const authRoutes = require('./routes/auth.routes');
const seleccionRoutes = require('./routes/seleccion.routes');

const app = express();

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://200.91.204.54'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuración de conexión MySQL mejorada
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  charset: 'utf8mb4'
};

let db;

function createConnection() {
  db = mysql.createConnection(dbConfig);
  
  db.connect((err) => {
    if (err) {
      console.error('Error conectando a MySQL:', err);
      setTimeout(createConnection, 2000);
    } else {
      console.log('Conectado a MySQL');
    }
  });

  db.on('error', (err) => {
    console.error('Error de MySQL:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
      console.log('Reconectando a MySQL...');
      createConnection();
    } else {
      throw err;
    }
  });

  global.db = db;
}

createConnection();

app.use('/api/candidato', candidatoRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/seleccion', seleccionRoutes);

app.get('/api/health', (req, res) => {
  res.json({ 
    message: 'Hydra Reclutamiento API funcionando correctamente',
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en puerto ${PORT}`);
});
