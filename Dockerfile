# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source and build
COPY . .
RUN npm run build

# ─── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Only install production dependencies
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --only=production && npm cache clean --force

# Generate Prisma client for production image
RUN npx prisma generate

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001
USER nestjs

EXPOSE 3000

# Run migrations then start the app
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
