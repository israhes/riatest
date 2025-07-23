// healthcheck.js - Script para verificar la salud del contenedor
const http = require('http');
const mongoose = require('mongoose');

const options = {
  hostname: 'localhost',
  port: process.env.PORT || 3000,
  path: '/api/health',
  method: 'GET',
  timeout: 5000
};

// Función para verificar la conexión HTTP
const checkHTTP = () => {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      if (res.statusCode === 200) {
        resolve('HTTP OK');
      } else {
        reject(new Error(`HTTP Status: ${res.statusCode}`));
      }
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('HTTP Timeout'));
    });

    req.setTimeout(options.timeout);
    req.end();
  });
};

// Función para verificar la conexión a MongoDB
const checkMongoDB = () => {
  return new Promise((resolve, reject) => {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cobranza_ai';
    
    mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000
    })
    .then(() => {
      mongoose.connection.close();
      resolve('MongoDB OK');
    })
    .catch((err) => {
      reject(new Error(`MongoDB Error: ${err.message}`));
    });
  });
};

// Ejecutar verificaciones
async function healthCheck() {
  try {
    console.log('🔍 Iniciando verificación de salud...');
    
    // Verificar HTTP
    await checkHTTP();
    console.log('✅ HTTP Server: OK');
    
    // Verificar MongoDB
    await checkMongoDB();
    console.log('✅ MongoDB: OK');
    
    console.log('🎉 Sistema saludable');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error en verificación de salud:', error.message);
    process.exit(1);
  }
}

// Ejecutar solo si es llamado directamente
if (require.main === module) {
  healthCheck();
}