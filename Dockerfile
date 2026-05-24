# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Install all deps (including devDeps needed for Vite build)
COPY package*.json ./
RUN npm ci

# Copy source and build the React frontend
COPY . .
RUN npm run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Install only production deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built frontend and server source
COPY --from=build /app/dist ./dist
COPY server ./server

CMD ["node", "server/index.js"]
