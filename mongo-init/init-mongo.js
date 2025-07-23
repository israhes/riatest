// mongo-init/init-mongo.js - Script de inicialización de MongoDB
// Este script se ejecuta automáticamente cuando se crea el contenedor de MongoDB

// Cambiar a la base de datos de la aplicación
db = db.getSiblingDB('cobranza_ai');

// Crear usuario para la aplicación
db.createUser({
  user: 'cobranza_user',
  pwd: 'cobranza_password_2024',
  roles: [
    {
      role: 'readWrite',
      db: 'cobranza_ai'
    }
  ]
});

// Crear índices para optimizar consultas
print('Creando índices para optimización...');

// Índices para la colección de clientes
db.clientes.createIndex({ "email": 1 }, { unique: true });
db.clientes.createIndex({ "telefono": 1 });
db.clientes.createIndex({ "nombre": "text", "empresa": "text" });
db.clientes.createIndex({ "activo": 1, "fechaRegistro": -1 });

// Índices para la colección de deudas
db.deudas.createIndex({ "clienteId": 1 });
db.deudas.createIndex({ "estado": 1, "diasMora": 1 });
db.deudas.createIndex({ "fechaVencimiento": 1 });
db.deudas.createIndex({ "facturaNumero": 1 }, { unique: true });
db.deudas.createIndex({ "clienteId": 1, "estado": 1 });

// Índices para la colección de comunicaciones
db.comunicaciones.createIndex({ "clienteId": 1, "fechaEnvio": -1 });
db.comunicaciones.createIndex({ "deudaId": 1 });
db.comunicaciones.createIndex({ "tipo": 1, "estado": 1 });
db.comunicaciones.createIndex({ "campaniaId": 1 });
db.comunicaciones.createIndex({ "fechaEnvio": 1 });

// Índices para la colección de usuarios
db.usuarios.createIndex({ "email": 1 }, { unique: true });
db.usuarios.createIndex({ "activo": 1 });

// Índices para la colección de plantillas
db.plantillas.createIndex({ "tipo": 1, "tono": 1, "diasMora": 1 });
db.plantillas.createIndex({ "activa": 1 });

// Índices para la colección de campañas
db.campanias.createIndex({ "tipo": 1, "activa": 1 });
db.campanias.createIndex({ "fechaCreacion": -1 });

// Crear colecciones con validación de esquemas
print('Configurando validación de esquemas...');

// Validación para clientes
db.createCollection("clientes", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["nombre", "email", "telefono"],
      properties: {
        nombre: {
          bsonType: "string",
          minLength: 2,
          maxLength: 100,
          description: "Nombre debe ser un string entre 2-100 caracteres"
        },
        email: {
          bsonType: "string",
          pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
          description: "Email debe tener un formato válido"
        },
        telefono: {
          bsonType: "string",
          pattern: "^\\+[1-9]\\d{1,14}$",
          description: "Teléfono debe tener formato internacional"
        },
        activo: {
          bsonType: "bool",
          description: "Activo debe ser un boolean"
        }
      }
    }
  }
});

// Validación para deudas
db.createCollection("deudas", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["clienteId", "monto", "fechaVencimiento"],
      properties: {
        monto: {
          bsonType: "number",
          minimum: 0,
          description: "Monto debe ser un número positivo"
        },
        estado: {
          enum: ["pendiente", "mora_temprana", "mora_media", "mora_avanzada", "pagada", "cancelada"],
          description: "Estado debe ser uno de los valores permitidos"
        },
        diasMora: {
          bsonType: "number",
          minimum: 0,
          description: "Días de mora debe ser un número no negativo"
        }
      }
    }
  }
});

// Configurar TTL para logs de comunicaciones (mantener solo 1 año)
db.comunicaciones.createIndex(
  { "fechaEnvio": 1 }, 
  { expireAfterSeconds: 31536000 } // 365 días
);

print('✅ Inicialización de MongoDB completada');
print('📊 Base de datos: cobranza_ai');
print('👤 Usuario de aplicación: cobranza_user');
print('🔍 Índices creados para optimización');
print('✅ Validación de esquemas configurada');
print('⏰ TTL configurado para logs de comunicaciones');

// Insertar datos de configuración inicial
db.configuracion.insertOne({
  version: "1.0.0",
  fechaCreacion: new Date(),
  configuracion: {
    retencionLogs: 365, // días
    limitesComunicacion: {
      smsD: 100,
      emailDiario: 500,
      whatsappDiario: 200
    },
    configuracionIA: {
      modelo: "gpt-4",
      maxTokens: 1000,
      temperatura: 0.7
    }
  }
});

print('⚙️ Configuración inicial insertada');