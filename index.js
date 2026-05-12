const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
require('dotenv').config();

const candidatoRoutes = require('./routes/candidato.routes');
const authRoutes = require('./routes/auth.routes');
const seleccionRoutes = require('./routes/seleccion.routes');
const desprendiblesRoutes = require('./routes/desprendibles.routes');

const app = express();

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://200.91.204.54'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

global.db = pool;
console.log('Pool de MySQL configurado correctamente');

app.use('/api/candidato', candidatoRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/seleccion', seleccionRoutes);
app.use('/api/desprendibles', desprendiblesRoutes);

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
