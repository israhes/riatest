#!/bin/bash

# setup.sh - Script automatizado para configurar el backend de cobranza con IA
# Uso: chmod +x setup.sh && ./setup.sh

set -e  # Salir si cualquier comando falla

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Función para imprimir mensajes con colores
print_status() {
	echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
	echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
	echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
	echo -e "${RED}[ERROR]${NC} $1"
}

# Banner
echo -e "${BLUE}"
echo "=================================================="
echo "🤖 SISTEMA DE COBRANZA CON IA - SETUP"
echo "=================================================="
echo -e "${NC}"

# Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
	print_error "No se encontró package.json. Ejecuta este script desde el directorio del proyecto."
	exit 1
fi

print_status "Iniciando configuración automatizada..."

# 1. Verificar dependencias del sistema
print_status "Verificando dependencias del sistema..."

# Verificar Docker
if ! command -v docker &> /dev/null; then
	print_error "Docker no está instalado. Por favor instala Docker primero."
	echo "Visita: https://docs.docker.com/get-docker/"
	exit 1
fi

# Verificar Docker Compose
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
	print_error "Docker Compose no está instalado. Por favor instala Docker Compose primero."
	echo "Visita: https://docs.docker.com/compose/install/"
	exit 1
fi

print_success "Docker y Docker Compose están instalados"

# 2. Crear directorios necesarios
print_status "Creando estructura de directorios..."

mkdir -p logs nginx/ssl mongo-init uploads

print_success "Directorios creados"

# 3. Configurar archivo .env si no existe
if [ ! -f ".env" ]; then
	print_status "Configurando archivo de variables de entorno..."
	
	if [ -f ".env.docker" ]; then
		cp .env.docker .env
		print_success "Archivo .env creado desde .env.docker"
	else
		print_warning "No se encontró .env.docker. Creando .env básico..."
		cat > .env << EOF
# Configuración básica - COMPLETA ESTAS VARIABLES
MONGO_ROOT_PASSWORD=cobranza_admin_2024_secure
REDIS_PASSWORD=cobranza_redis_2024_secure
JWT_SECRET=tu_jwt_secret_muy_seguro_2024_cobranza_sistema

# EMAIL (OBLIGATORIO)
EMAIL_USER=tu_email@gmail.com
EMAIL_PASS=tu_app_password_de_16_caracteres

# TWILIO (OBLIGATORIO)
TWILIO_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_TOKEN=tu_twilio_auth_token
TWILIO_PHONE=+1234567890
TWILIO_WHATSAPP=+14155238886

# OPENAI (OBLIGATORIO)
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# CONFIGURACIÓN OPCIONAL
FRONTEND_URL=http://localhost:3001
LOG_LEVEL=info
RATE_LIMIT_WINDOW=15
RATE_LIMIT_MAX_REQUESTS=100
EOF
		print_warning "⚠️  IMPORTANTE: Debes editar el archivo .env con tus credenciales reales"
	fi
else
	print_success "Archivo .env ya existe"
fi

# 4. Verificar puertos disponibles
print_status "Verificando puertos disponibles..."

check_port() {
	if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null 2>&1; then
		print_warning "Puerto $1 está ocupado"
		return 1
	else
		return 0
	fi
}

PORTS_OK=true
for port in 3000 27017 6379 80 8081; do
	if ! check_port $port; then
		PORTS_OK=false
	fi
done

if [ "$PORTS_OK" = false ]; then
	print_warning "Algunos puertos están ocupados. Puedes:"
	echo "1. Detener los servicios que usan esos puertos"
	echo "2. Modificar los puertos en docker-compose.yml"
	echo ""
	read -p "¿Continuar anyway? (y/n): " -n 1 -r
	echo
	if [[ ! $REPLY =~ ^[Yy]$ ]]; then
		print_error "Configuración cancelada"
		exit 1
	fi
fi

# 5. Construir y levantar servicios
print_status "Construyendo y levantando servicios..."

# Opción para desarrollo o producción
echo ""
echo "Selecciona el modo de despliegue:"
echo "1) Desarrollo (incluye Mongo Express)"
echo "2) Producción (solo servicios esenciales)"
read -p "Opción (1-2): " -n 1 -r
echo

if [[ $REPLY == "1" ]]; then
	COMPOSE_PROFILES="development"
	print_status "Modo desarrollo seleccionado"
else
	COMPOSE_PROFILES=""
	print_status "Modo producción seleccionado"
fi

# Construir imágenes
print_status "Construyendo imagen Docker..."
if [ -n "$COMPOSE_PROFILES" ]; then
	COMPOSE_PROFILES=$COMPOSE_PROFILES docker-compose build
else
	docker-compose build
fi

# Levantar servicios
print_status "Levantando servicios..."
if [ -n "$COMPOSE_PROFILES" ]; then
	COMPOSE_PROFILES=$COMPOSE_PROFILES docker-compose up -d
else
	docker-compose up -d
fi

# 6. Esperar a que los servicios estén listos
print_status "Esperando a que los servicios estén listos..."

# Función para verificar si un servicio está listo
wait_for_service() {
	local service=$1
	local max_attempts=30
	local attempt=1
	
	while [ $attempt -le $max_attempts ]; do
		if docker-compose ps $service | grep -q "Up (healthy)"; then
			return 0
		fi
		echo -n "."
		sleep 2
		((attempt++))
	done
	return 1
}

# Esperar MongoDB
echo -n "Esperando MongoDB"
if wait_for_service mongodb; then
	print_success "MongoDB está listo"
else
	print_warning "MongoDB tardó más de lo esperado en estar listo"
fi

# Esperar Backend
echo -n "Esperando Backend"
if wait_for_service cobranza-backend; then
	print_success "Backend está listo"
else
	print_warning "Backend tardó más de lo esperado en estar listo"
fi

# 7. Verificar estado de los servicios
print_status "Verificando estado de los servicios..."

# Mostrar estado de containers
echo ""
echo "Estado de los contenedores:"
docker-compose ps

# 8. Poblar base de datos (opcional)
echo ""
read -p "¿Quieres poblar la base de datos con datos de ejemplo? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
	print_status "Poblando base de datos..."
	if docker-compose exec cobranza-backend npm run seed; then
		print_success "Base de datos poblada con datos de ejemplo"
	else
		print_warning "Error poblando la base de datos. Puedes hacerlo manualmente después."
	fi
fi

# 9. Verificar que todo funcione
print_status "Verificando funcionamiento..."

# Verificar endpoint de salud
if curl -s http://localhost:3000/api/health > /dev/null; then
	print_success "API responde correctamente"
else
	print_warning "La API no responde. Verifica los logs: docker-compose logs cobranza-backend"
fi

# 10. Mostrar información final
echo ""
echo -e "${GREEN}=================================================="
echo "🎉 CONFIGURACIÓN COMPLETADA"
echo "==================================================${NC}"
echo ""
echo "📱 Servicios disponibles:"
echo "   • API Backend: http://localhost:3000"
echo "   • Health Check: http://localhost:3000/api/health"
if [ -n "$COMPOSE_PROFILES" ]; then
echo "   • Mongo Express: http://localhost:8081 (admin/admin123)"
fi
echo ""
echo "🔐 Credenciales por defecto:"
echo "   • Admin: admin@cobranza.com / admin123"
echo "   • Gestor: gestor@cobranza.com / admin123"
echo ""
echo "📋 Próximos pasos:"
echo "   1. Edita .env con tus credenciales reales"
echo "   2. Reinicia: docker-compose restart"
echo "   3. Prueba la API: curl http://localhost:3000/api/health"
echo ""
echo "📚 Documentación:"
echo "   • README.md - Documentación completa"
echo "   • PORTAINER-SETUP.md - Guía para Portainer"
echo ""
echo "🐛 Solución de problemas:"
echo "   • Ver logs: docker-compose logs [servicio]"
echo "   • Reiniciar: docker-compose restart [servicio]"
echo "   • Rebuild: docker-compose build --no-cache"
echo ""

# Verificar variables importantes
print_status "Verificando configuración..."

if grep -q "tu_email@gmail.com" .env; then
	print_warning "⚠️  Recuerda configurar EMAIL_USER en .env"
fi

if grep -q "ACxxxxxxxxxx" .env; then
	print_warning "⚠️  Recuerda configurar credenciales de Twilio en .env"
fi

if grep -q "sk-xxxxxxxx" .env; then
	print_warning "⚠️  Recuerda configurar OPENAI_API_KEY en .env"
fi

echo ""
print_success "🚀 ¡Tu sistema de cobranza con IA está listo!"
echo ""