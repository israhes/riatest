# Dockerfile para el backend de cobranza con IA
FROM node:18-alpine

# Información del mantenedor
LABEL maintainer="tu-email@ejemplo.com"
LABEL description="Backend para sistema de cobranza con IA"
LABEL version="1.0.0"

# Crear directorio de trabajo
WORKDIR /app

# Crear usuario no-root para seguridad
RUN addgroup -g 1001 -S nodejs && \
	adduser -S nextjs -u 1001

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias de producción
RUN npm ci --only=production && npm cache clean --force

# Copiar el código fuente
COPY . .

# Crear directorio para logs
RUN mkdir -p /app/logs && chown -R nextjs:nodejs /app

# Cambiar al usuario no-root
USER nextjs

# Exponer el puerto
EXPOSE 3000

# Configurar variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=3000

# Comando de inicio
CMD ["npm", "start"]

# Healthcheck para verificar que el contenedor esté funcionando
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js