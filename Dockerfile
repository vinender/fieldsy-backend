# Multi-stage build for Fieldsy Backend
# =====================================
# NOTE: Build context must be the project root (parent of backend/).
# Run as: docker build -f backend/Dockerfile .

# Stage 1: Builder - compiles TypeScript and generates Prisma client
FROM node:20-alpine AS builder

# Install build dependencies for native modules (sharp, bcrypt, etc.)
RUN apk add --no-cache python3 make g++ libc6-compat

# Copy the local package so npm can resolve file:../packages/stripe-auto-payout
COPY packages/stripe-auto-payout /app/packages/stripe-auto-payout

# Set working directory to match the relative path in package.json
WORKDIR /app/backend

# Copy package files first (for better layer caching)
COPY backend/package.json backend/package-lock.json* ./

# Install ALL dependencies (including dev for building)
RUN npm ci || npm install

# Copy Prisma schema first (for Prisma client generation)
COPY backend/prisma ./prisma

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY backend/ .

# Build TypeScript to JavaScript
RUN npm run build

# =====================================
# Stage 2: Production - minimal runtime image
FROM node:20-alpine

# Install runtime dependencies for native modules
RUN apk add --no-cache libc6-compat

# Copy the local package so npm can resolve file:../packages/stripe-auto-payout
COPY packages/stripe-auto-payout /app/packages/stripe-auto-payout

# Set working directory to match the relative path in package.json
WORKDIR /app/backend

# Copy package files
COPY backend/package.json backend/package-lock.json* ./

# Install only production dependencies
RUN npm ci --omit=dev || npm install --production

# Copy Prisma schema and generated client from builder
COPY --from=builder /app/backend/prisma ./prisma
COPY --from=builder /app/backend/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/backend/node_modules/@prisma ./node_modules/@prisma

# Copy built JavaScript files from builder
COPY --from=builder /app/backend/dist ./dist

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port (Fieldsy backend runs on 5000)
EXPOSE 5000

# Set Node environment
ENV NODE_ENV=production

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
# --preserve-symlinks ensures the file: linked package resolves peer deps
# (like stripe) from backend/node_modules instead of packages/stripe-auto-payout/
CMD ["node", "--preserve-symlinks", "dist/server.js"]
