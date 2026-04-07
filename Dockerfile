# Multi-stage build for Fieldsy Backend
# =====================================
# NOTE: Build context must be the project root (parent of backend/).
# Run as: docker build -f backend/Dockerfile .

# Stage 1: Builder - compiles TypeScript and generates Prisma client
FROM node:20-alpine AS builder

# Install build dependencies for native modules (sharp, bcrypt, etc.)
RUN apk add --no-cache python3 make g++ libc6-compat

# Set working directory to match the relative path in package.json
WORKDIR /app/backend

# Copy the local payout-engine package so npm can resolve file:./packages/stripe-auto-payout
# It must exist BEFORE npm install runs.
COPY backend/packages/stripe-auto-payout ./packages/stripe-auto-payout

# Copy package files first (for better layer caching)
COPY backend/package.json backend/package-lock.json* ./

# Install ALL dependencies (including dev for building)
RUN npm ci || npm install

# Copy Prisma schema first (for Prisma client generation)
COPY backend/prisma ./prisma

# Generate Prisma client (pin version to match @prisma/client in package.json)
RUN npx prisma@6.13.0 generate

# Copy source code
COPY backend/ .

# Build TypeScript to JavaScript (using SWC for speed - type checking done in deploy script)
RUN npm run build:fast

# =====================================
# Stage 2: Production - minimal runtime image
FROM node:20-alpine

# Install runtime dependencies and create non-root user early (before COPY)
RUN apk add --no-cache libc6-compat && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Set working directory to match the relative path in package.json
WORKDIR /app/backend

# Copy the local payout-engine package so npm can resolve file:./packages/stripe-auto-payout
# It must exist BEFORE npm install runs.
COPY --chown=nodejs:nodejs backend/packages/stripe-auto-payout ./packages/stripe-auto-payout

# Copy package files
COPY --chown=nodejs:nodejs backend/package.json backend/package-lock.json* ./

# Install production dependencies only (skip devDependencies entirely)
RUN npm ci --omit=dev || npm install --omit=dev

# Copy Prisma schema and generated client from builder
COPY --from=builder --chown=nodejs:nodejs /app/backend/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/backend/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nodejs:nodejs /app/backend/node_modules/@prisma ./node_modules/@prisma

# Copy built JavaScript files from builder
COPY --from=builder --chown=nodejs:nodejs /app/backend/dist ./dist

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
# (like stripe) from backend/node_modules instead of backend/packages/stripe-auto-payout/node_modules
CMD ["node", "--preserve-symlinks", "dist/server.js"]
