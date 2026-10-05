# --- Dependencies stage ---------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund

# --- Build stage -----------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# BUG FIX: docker-compose.yml passes NEXT_PUBLIC_API_BASE_URL as a build
# arg, but without this ARG declaration it was silently discarded - Docker
# ignores a build arg the Dockerfile never declares, with no error. That
# meant `npm run build` always ran with this variable unset, and Next.js
# inlined whatever hardcoded fallback the frontend code uses
# (http://127.0.0.1:8000/api/v1) directly into the static JS bundle -
# baked in permanently, not fixable by changing .env afterward without a
# rebuild. NEXT_PUBLIC_* vars must be real environment variables during
# the build itself, not just passed to Docker - ARG alone does not
# expose them to the build process.
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

RUN npm run build

# --- Runtime stage (standalone output, minimal image, non-root) -----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
