// server.js - Backend principal para sistema de cobranza con IA
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const twilio = require('twilio');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Conexión a MongoDB
mongoose.connect('mongodb://localhost:27017/cobranza_ai', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// Schemas de Mongoose

// Schema para Clientes
const clienteSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  email: { type: String, required: true },
  telefono: { type: String, required: true },
  whatsapp: { type: String },
  empresa: String,
  fechaRegistro: { type: Date, default: Date.now },
  activo: { type: Boolean, default: true }
});

// Schema para Deudas
const deudaSchema = new mongoose.Schema({
  clienteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', required: true },
  monto: { type: Number, required: true },
  montoOriginal: { type: Number, required: true },
  fechaVencimiento: { type: Date, required: true },
  diasMora: { type: Number, default: 0 },
  estado: { 
    type: String, 
    enum: ['pendiente', 'mora_temprana', 'mora_media', 'mora_avanzada', 'pagada', 'cancelada'], 
    default: 'pendiente' 
  },
  descripcion: String,
  facturaNumero: String,
  fechaCreacion: { type: Date, default: Date.now },
  fechaPago: Date,
  metodoPago: String
});

// Schema para Comunicaciones
const comunicacionSchema = new mongoose.Schema({
  clienteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', required: true },
  deudaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deuda', required: true },
  tipo: { type: String, enum: ['email', 'sms', 'whatsapp'], required: true },
  contenido: { type: String, required: true },
  tono: { type: String, enum: ['amigable', 'formal', 'urgente', 'legal'], default: 'amigable' },
  estado: { type: String, enum: ['enviado', 'entregado', 'leido', 'respondido', 'error'], default: 'enviado' },
  fechaEnvio: { type: Date, default: Date.now },
  respuesta: String,
  fechaRespuesta: Date,
  campaniaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campania' }
});

// Schema para Campañas A/B
const campaniaSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  descripcion: String,
  tipo: { type: String, enum: ['A', 'B'], required: true },
  configuracion: {
    tono: String,
    plantilla: String,
    frecuencia: Number, // días entre envíos
    canales: [String], // ['email', 'sms', 'whatsapp']
    horarioEnvio: String
  },
  metricas: {
    enviados: { type: Number, default: 0 },
    entregados: { type: Number, default: 0 },
    leidos: { type: Number, default: 0 },
    respondidos: { type: Number, default: 0 },
    pagos: { type: Number, default: 0 },
    tasaConversion: { type: Number, default: 0 }
  },
  activa: { type: Boolean, default: true },
  fechaCreacion: { type: Date, default: Date.now },
  fechaFin: Date
});

// Schema para Usuarios del sistema
const usuarioSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  rol: { type: String, enum: ['admin', 'gestor', 'analista'], default: 'gestor' },
  fechaCreacion: { type: Date, default: Date.now },
  ultimoAcceso: Date,
  activo: { type: Boolean, default: true }
});

// Schema para Plantillas de IA
const plantillaSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  tipo: { type: String, enum: ['email', 'sms', 'whatsapp'], required: true },
  tono: { type: String, enum: ['amigable', 'formal', 'urgente', 'legal'], required: true },
  diasMora: { type: Number, required: true }, // para qué rango de días en mora
  plantilla: { type: String, required: true },
  variables: [String], // variables disponibles como {nombre}, {monto}, etc.
  activa: { type: Boolean, default: true },
  fechaCreacion: { type: Date, default: Date.now }
});

// Modelos
const Cliente = mongoose.model('Cliente', clienteSchema);
const Deuda = mongoose.model('Deuda', deudaSchema);
const Comunicacion = mongoose.model('Comunicacion', comunicacionSchema);
const Campania = mongoose.model('Campania', campaniaSchema);
const Usuario = mongoose.model('Usuario', usuarioSchema);
const Plantilla = mongoose.model('Plantilla', plantillaSchema);

// Middleware de autenticación
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET || 'secret_key', (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Configuración de servicios externos
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

const emailTransporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// RUTAS DE AUTENTICACIÓN

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const usuario = await Usuario.findOne({ email, activo: true });

    if (!usuario || !await bcrypt.compare(password, usuario.password)) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    usuario.ultimoAcceso = new Date();
    await usuario.save();

    const token = jwt.sign(
      { id: usuario._id, email: usuario.email, rol: usuario.rol },
      process.env.JWT_SECRET || 'secret_key',
      { expiresIn: '24h' }
    );

    res.json({
      token,
      usuario: {
        id: usuario._id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// RUTAS DE DASHBOARD

// Obtener métricas generales
app.get('/api/dashboard/metricas', authenticateToken, async (req, res) => {
  try {
    const totalClientes = await Cliente.countDocuments({ activo: true });
    const totalDeudas = await Deuda.countDocuments({ estado: { $ne: 'pagada' } });
    
    const deudasPorEstado = await Deuda.aggregate([
      { $match: { estado: { $ne: 'pagada' } } },
      { $group: { _id: '$estado', count: { $sum: 1 }, monto: { $sum: '$monto' } } }
    ]);

    const comunicacionesUltimos30Dias = await Comunicacion.countDocuments({
      fechaEnvio: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    });

    const tasaRespuesta = await Comunicacion.aggregate([
      { $match: { fechaEnvio: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          respondidas: { $sum: { $cond: [{ $eq: ['$estado', 'respondido'] }, 1, 0] } }
        }
      }
    ]);

    res.json({
      totalClientes,
      totalDeudas,
      deudasPorEstado,
      comunicacionesUltimos30Dias,
      tasaRespuesta: tasaRespuesta[0] ? (tasaRespuesta[0].respondidas / tasaRespuesta[0].total * 100).toFixed(2) : 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// RUTAS DE CLIENTES

// Obtener todos los clientes
app.get('/api/clientes', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    let query = { activo: true };

    if (search) {
      query.$or = [
        { nombre: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { telefono: { $regex: search, $options: 'i' } }
      ];
    }

    const clientes = await Cliente.find(query)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ fechaRegistro: -1 });

    const total = await Cliente.countDocuments(query);

    res.json({
      clientes,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear nuevo cliente
app.post('/api/clientes', authenticateToken, async (req, res) => {
  try {
    const cliente = new Cliente(req.body);
    await cliente.save();
    res.status(201).json(cliente);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// RUTAS DE DEUDAS

// Obtener deudas con filtros
app.get('/api/deudas', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, estado, clienteId, diasMora } = req.query;
    let query = {};

    if (estado) query.estado = estado;
    if (clienteId) query.clienteId = clienteId;
    if (diasMora) {
      const dias = parseInt(diasMora);
      query.diasMora = dias;
    }

    const deudas = await Deuda.find(query)
      .populate('clienteId', 'nombre email telefono')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ fechaVencimiento: 1 });

    const total = await Deuda.countDocuments(query);

    res.json({
      deudas,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear nueva deuda
app.post('/api/deudas', authenticateToken, async (req, res) => {
  try {
    const deuda = new Deuda(req.body);
    
    // Calcular días en mora
    const hoy = new Date();
    const fechaVencimiento = new Date(deuda.fechaVencimiento);
    if (hoy > fechaVencimiento) {
      deuda.diasMora = Math.floor((hoy - fechaVencimiento) / (1000 * 60 * 60 * 24));
      
      // Actualizar estado según días en mora
      if (deuda.diasMora <= 30) deuda.estado = 'mora_temprana';
      else if (deuda.diasMora <= 90) deuda.estado = 'mora_media';
      else deuda.estado = 'mora_avanzada';
    }

    await deuda.save();
    res.status(201).json(deuda);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// RUTAS DE COMUNICACIONES

// Obtener historial de comunicaciones
app.get('/api/comunicaciones', authenticateToken, async (req, res) => {
  try {
    const { clienteId, deudaId, tipo, page = 1, limit = 10 } = req.query;
    let query = {};

    if (clienteId) query.clienteId = clienteId;
    if (deudaId) query.deudaId = deudaId;
    if (tipo) query.tipo = tipo;

    const comunicaciones = await Comunicacion.find(query)
      .populate('clienteId', 'nombre email')
      .populate('deudaId', 'monto fechaVencimiento')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ fechaEnvio: -1 });

    const total = await Comunicacion.countDocuments(query);

    res.json({
      comunicaciones,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Enviar comunicación
app.post('/api/comunicaciones/enviar', authenticateToken, async (req, res) => {
  try {
    const { clienteId, deudaId, tipo, tono, campaniaId } = req.body;

    const cliente = await Cliente.findById(clienteId);
    const deuda = await Deuda.findById(deudaId);

    if (!cliente || !deuda) {
      return res.status(404).json({ error: 'Cliente o deuda no encontrada' });
    }

    // Buscar plantilla apropiada
    const plantilla = await Plantilla.findOne({
      tipo,
      tono,
      diasMora: { $lte: deuda.diasMora },
      activa: true
    }).sort({ diasMora: -1 });

    if (!plantilla) {
      return res.status(404).json({ error: 'No se encontró plantilla apropiada' });
    }

    // Generar contenido personalizado con IA (simulado)
    let contenido = plantilla.plantilla
      .replace('{nombre}', cliente.nombre)
      .replace('{monto}', `$${deuda.monto.toLocaleString()}`)
      .replace('{dias_mora}', deuda.diasMora)
      .replace('{fecha_vencimiento}', deuda.fechaVencimiento.toLocaleDateString());

    // Crear registro de comunicación
    const comunicacion = new Comunicacion({
      clienteId,
      deudaId,
      tipo,
      contenido,
      tono,
      campaniaId
    });

    // Enviar según el tipo
    let enviado = false;
    try {
      switch (tipo) {
        case 'email':
          await emailTransporter.sendMail({
            from: process.env.EMAIL_USER,
            to: cliente.email,
            subject: `Recordatorio de pago - Factura ${deuda.facturaNumero}`,
            html: contenido
          });
          enviado = true;
          break;

        case 'sms':
          await twilioClient.messages.create({
            body: contenido,
            from: process.env.TWILIO_PHONE,
            to: cliente.telefono
          });
          enviado = true;
          break;

        case 'whatsapp':
          await twilioClient.messages.create({
            body: contenido,
            from: `whatsapp:${process.env.TWILIO_WHATSAPP}`,
            to: `whatsapp:${cliente.whatsapp}`
          });
          enviado = true;
          break;
      }

      if (enviado) {
        comunicacion.estado = 'entregado';
        await comunicacion.save();

        // Actualizar métricas de campaña si aplica
        if (campaniaId) {
          await Campania.findByIdAndUpdate(campaniaId, {
            $inc: { 'metricas.enviados': 1, 'metricas.entregados': 1 }
          });
        }

        res.json({ success: true, comunicacion });
      }
    } catch (envioError) {
      comunicacion.estado = 'error';
      await comunicacion.save();
      res.status(500).json({ error: 'Error al enviar comunicación', details: envioError.message });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// RUTAS DE CAMPAÑAS A/B

// Obtener campañas
app.get('/api/campanias', authenticateToken, async (req, res) => {
  try {
    const campanias = await Campania.find().sort({ fechaCreacion: -1 });
    res.json(campanias);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear nueva campaña
app.post('/api/campanias', authenticateToken, async (req, res) => {
  try {
    const campania = new Campania(req.body);
    await campania.save();
    res.status(201).json(campania);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Comparar resultados A/B
app.get('/api/campanias/comparar/:campaniaA/:campaniaB', authenticateToken, async (req, res) => {
  try {
    const { campaniaA, campaniaB } = req.params;

    const [campaniaAData, campaniaBData] = await Promise.all([
      Campania.findById(campaniaA),
      Campania.findById(campaniaB)
    ]);

    const comparacion = {
      campaniaA: {
        nombre: campaniaAData.nombre,
        metricas: campaniaAData.metricas,
        tasaApertura: (campaniaAData.metricas.leidos / campaniaAData.metricas.enviados * 100).toFixed(2),
        tasaRespuesta: (campaniaAData.metricas.respondidos / campaniaAData.metricas.enviados * 100).toFixed(2),
        tasaConversion: (campaniaAData.metricas.pagos / campaniaAData.metricas.enviados * 100).toFixed(2)
      },
      campaniaB: {
        nombre: campaniaBData.nombre,
        metricas: campaniaBData.metricas,
        tasaApertura: (campaniaBData.metricas.leidos / campaniaBData.metricas.enviados * 100).toFixed(2),
        tasaRespuesta: (campaniaBData.metricas.respondidos / campaniaBData.metricas.enviados * 100).toFixed(2),
        tasaConversion: (campaniaBData.metricas.pagos / campaniaBData.metricas.enviados * 100).toFixed(2)
      }
    };

    res.json(comparacion);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// RUTAS DE PLANTILLAS

// Obtener plantillas
app.get('/api/plantillas', authenticateToken, async (req, res) => {
  try {
    const { tipo, tono } = req.query;
    let query = { activa: true };

    if (tipo) query.tipo = tipo;
    if (tono) query.tono = tono;

    const plantillas = await Plantilla.find(query).sort({ diasMora: 1 });
    res.json(plantillas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear nueva plantilla
app.post('/api/plantillas', authenticateToken, async (req, res) => {
  try {
    const plantilla = new Plantilla(req.body);
    await plantilla.save();
    res.status(201).json(plantilla);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// RUTAS DE REPORTES

// Reporte de cartera
app.get('/api/reportes/cartera', authenticateToken, async (req, res) => {
  try {
    const { fechaInicio, fechaFin } = req.query;
    let dateQuery = {};

    if (fechaInicio && fechaFin) {
      dateQuery.fechaVencimiento = {
        $gte: new Date(fechaInicio),
        $lte: new Date(fechaFin)
      };
    }

    const reporte = await Deuda.aggregate([
      { $match: { ...dateQuery, estado: { $ne: 'pagada' } } },
      {
        $group: {
          _id: '$estado',
          cantidad: { $sum: 1 },
          montoTotal: { $sum: '$monto' },
          diasMoraPromedio: { $avg: '$diasMora' }
        }
      }
    ]);

    res.json(reporte);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ENDPOINT DE SALUD (para Docker healthcheck)
app.get('/api/health', async (req, res) => {
  try {
    // Verificar conexión a MongoDB
    const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    // Verificar métricas básicas
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    
    // Verificar servicios externos (opcional)
    const healthData = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: `${Math.floor(uptime / 60)} minutos`,
      version: '1.0.0',
      services: {
        mongodb: mongoStatus,
        memory: {
          used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          unit: 'MB'
        }
      }
    };

    // Si MongoDB no está conectado, devolver error
    if (mongoStatus !== 'connected') {
      return res.status(503).json({
        status: 'ERROR',
        message: 'Base de datos no disponible',
        ...healthData
      });
    }

    res.status(200).json(healthData);
  } catch (error) {
    res.status(503).json({
      status: 'ERROR',
      message: 'Error en verificación de salud',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// TAREA PROGRAMADA: Actualizar días en mora
const actualizarDiasMora = async () => {
  try {
    const hoy = new Date();
    const deudas = await Deuda.find({ estado: { $ne: 'pagada' } });

    for (const deuda of deudas) {
      const fechaVencimiento = new Date(deuda.fechaVencimiento);
      if (hoy > fechaVencimiento) {
        const diasMora = Math.floor((hoy - fechaVencimiento) / (1000 * 60 * 60 * 24));
        
        let nuevoEstado = deuda.estado;
        if (diasMora <= 30) nuevoEstado = 'mora_temprana';
        else if (diasMora <= 90) nuevoEstado = 'mora_media';
        else nuevoEstado = 'mora_avanzada';

        await Deuda.findByIdAndUpdate(deuda._id, {
          diasMora,
          estado: nuevoEstado
        });
      }
    }

    console.log('Días en mora actualizados correctamente');
  } catch (error) {
    console.error('Error actualizando días en mora:', error);
  }
};

// Ejecutar actualización diariamente
setInterval(actualizarDiasMora, 24 * 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en puerto ${PORT}`);
  console.log('Sistema de Cobranza con IA - Backend activo');
});

module.exports = app;