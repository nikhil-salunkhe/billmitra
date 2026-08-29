# BillMitra Backend — Production Dockerfile
# Target: linux/amd64 (Render)
FROM node:20-alpine

# Create a non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy dependency files first (better layer caching)
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Ensure the uploads directory exists (ephemeral on Render — see README)
RUN mkdir -p uploads

# Set environment
ENV NODE_ENV=production

# Render provides PORT; the app also falls back to 5000.
# EXPOSE is documentation only — the app uses process.env.PORT at runtime.
EXPOSE 10000

# Switch to non-root user
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
