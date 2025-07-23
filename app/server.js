// server.js - Backend simplificado para cobranza con IA
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Conectar a MongoDB
console.log('🔌 Conectando a MongoDB...');
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cobranza_ai', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ MongoDB conectado exitosamente');
}).catch(err => {
  console.error('❌ Error conectando a MongoDB:', err);
});

// Schemas básicos
const usuarioSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  rol: { type: String, enum: ['admin', 'gestor', 'analista'], default: 'gestor' },
  fechaCreacion: { type: Date, default: Date.now },
  activo: { type: Boolean, default: true }
});

const clienteSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  email: { type: String, required: true },
  telefono: { type: String, required: true },
  whatsapp: { type: String },
  empresa: String,
  fechaRegistro: { type: Date, default: Date.now },
  activo: { type: Boolean, default: true }
});

const deudaSchema = new mongoose.Schema({
  clienteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', required: true },
  monto: { type: Number, required: true },
  montoOriginal: { type: Number, required: true },
  fechaVencimiento: { type: Date, required: true },
  diasMora: { type: Number, default: 0 },
  estado: { 
	type: String, 
	enum: ['pendiente', 'mora_temprana', 'mora_media', 'mora_avanzada', 'pagada'], 
	default: 'pendiente' 
  },
  descripcion: String,
  facturaNumero: String,
  fechaCreacion: { type: Date, default: Date.now }
});

// Modelos
const Usuario = mongoose.model('Usuario', usuarioSchema);
const Cliente = mongoose.model('Cliente', clienteSchema);
const Deuda = mongoose.model('Deuda', deudaSchema);

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

// RUTAS

// Ruta principal
app.get('/', (req, res) => {
  res.json({ 
	message: '🤖 Sistema de Cobranza con IA',
	version: '1.0.0',
	status: 'funcionando',
	timestamp: new Date().toISOString()
  });
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
	const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
	const uptime = process.uptime();
	const memoryUsage = process.memoryUsage();
	
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
		},
		environment: process.env.NODE_ENV || 'development'
	  }
	};

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

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
	const { email, password } = req.body;
	
	if (!email || !password) {
	  return res.status(400).json({ error: 'Email y password son requeridos' });
	}

	// Buscar usuario
	let usuario = await Usuario.findOne({ email, activo: true });
	
	// Si no existe, crear usuario admin por defecto
	if (!usuario && email === 'admin@cobranza.com') {
	  const hashedPassword = await bcrypt.hash('admin123', 10);
	  usuario = new Usuario({
		nombre: 'Administrador',
		email: 'admin@cobranza.com',
		password: hashedPassword,
		rol: 'admin'
	  });
	  await usuario.save();
	  console.log('✅ Usuario admin creado por defecto');
	}

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
	  success: true,
	  token,
	  usuario: {
		id: usuario._id,
		nombre: usuario.nombre,
		email: usuario.email,
		rol: usuario.rol
	  }
	});
  } catch (error) {
	console.error('Error en login:', error);
	res.status(500).json({ error: error.message });
  }
});

// Obtener métricas del dashboard
app.get('/api/dashboard/metricas', authenticateToken, async (req, res) => {
  try {
	const totalClientes = await Cliente.countDocuments({ activo: true });
	const totalDeudas = await Deuda.countDocuments({ estado: { $ne: 'pagada' } });
	
	const deudasPorEstado = await Deuda.aggregate([
	  { $match: { estado: { $ne: 'pagada' } } },
	  { $group: { _id: '$estado', count: { $sum: 1 }, monto: { $sum: '$monto' } } }
	]);

	res.json({
	  success: true,
	  data: {
		totalClientes,
		totalDeudas,
		deudasPorEstado,
		ultimaActualizacion: new Date().toISOString()
	  }
	});
  } catch (error) {
	console.error('Error obteniendo métricas:', error);
	res.status(500).json({ error: error.message });
  }
});

// Listar clientes
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
	  success: true,
	  data: {
		clientes,
		totalPages: Math.ceil(total / limit),
		currentPage: parseInt(page),
		total
	  }
	});
  } catch (error) {
	console.error('Error obteniendo clientes:', error);
	res.status(500).json({ error: error.message });
  }
});

// Crear cliente
app.post('/api/clientes', authenticateToken, async (req, res) => {
  try {
	const cliente = new Cliente(req.body);
	await cliente.save();
	res.status(201).json({
	  success: true,
	  data: cliente,
	  message: 'Cliente creado exitosamente'
	});
  } catch (error) {
	console.error('Error creando cliente:', error);
	if (error.code === 11000) {
	  res.status(400).json({ error: 'El email ya existe' });
	} else {
	  res.status(400).json({ error: error.message });
	}
  }
});

// Listar deudas
app.get('/api/deudas', authenticateToken, async (req, res) => {
  try {
	const { page = 1, limit = 10, estado, clienteId } = req.query;
	let query = {};

	if (estado) query.estado = estado;
	if (clienteId) query.clienteId = clienteId;

	const deudas = await Deuda.find(query)
	  .populate('clienteId', 'nombre email telefono empresa')
	  .limit(limit * 1)
	  .skip((page - 1) * limit)
	  .sort({ fechaVencimiento: 1 });

	const total = await Deuda.countDocuments(query);

	res.json({
	  success: true,
	  data: {
		deudas,
		totalPages: Math.ceil(total / limit),
		currentPage: parseInt(page),
		total
	  }
	});
  } catch (error) {
	console.error('Error obteniendo deudas:', error);
	res.status(500).json({ error: error.message });
  }
});

// Crear deuda
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
	res.status(201).json({
	  success: true,
	  data: deuda,
	  message: 'Deuda creada exitosamente'
	});
  } catch (error) {
	console.error('Error creando deuda:', error);
	res.status(400).json({ error: error.message });
  }
});

// Ruta para poblar datos de ejemplo
app.post('/api/seed', async (req, res) => {
  try {
	// Crear usuarios de ejemplo si no existen
	const adminExists = await Usuario.findOne({ email: 'admin@cobranza.com' });
	if (!adminExists) {
	  const hashedPassword = await bcrypt.hash('admin123', 10);
	  await Usuario.create({
		nombre: 'Administrador Principal',
		email: 'admin@cobranza.com',
		password: hashedPassword,
		rol: 'admin'
	  });
	}

	// Crear clientes de ejemplo
	const clientesExample = [
	  {
		nombre: 'María García Rodríguez',
		email: 'maria.garcia@email.com',
		telefono: '+50212345678',
		whatsapp: '+50212345678',
		empresa: 'Distribuidora García S.A.'
	  },
	  {
		nombre: 'Carlos López Méndez',
		email: 'carlos.lopez@empresa.com',
		telefono: '+50287654321',
		whatsapp: '+50287654321',
		empresa: 'Construcciones López Ltda.'
	  }
	];

	for (const clienteData of clientesExample) {
	  const existe = await Cliente.findOne({ email: clienteData.email });
	  if (!existe) {
		await Cliente.create(clienteData);
	  }
	}

	res.json({
	  success: true,
	  message: 'Datos de ejemplo creados exitosamente'
	});
  } catch (error) {
	console.error('Error creando datos de ejemplo:', error);
	res.status(500).json({ error: error.message });
  }
});

// Middleware de manejo de errores
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({
	error: 'Error interno del servidor',
	message: process.env.NODE_ENV === 'development' ? err.message : 'Algo salió mal'
  });
});

// Ruta 404
app.use('*', (req, res) => {
  res.status(404).json({
	error: 'Ruta no encontrada',
	message: `La ruta ${req.originalUrl} no existe`
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/api/dashboard/metricas`);
  console.log('✅ Sistema de Cobranza con IA - Backend activo');
});

module.exports = app;