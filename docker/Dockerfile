# syntax=docker/dockerfile:1
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Alpine's base image doesn't ship the IANA timezone database; without it, TZ=Europe/Vienna
# (set in docker-compose.yml) would be silently ignored and all date/time parsing would fall
# back to UTC - which is exactly the bug this is here to prevent.
RUN apk add --no-cache tzdata
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
# `prisma migrate deploy` / `prisma db seed` need the CLI + its transitive
# runtime deps (e.g. @prisma/config -> effect) which the standalone build's
# traced node_modules does not include. Overwrite it with the full
# node_modules from the builder instead of trying to cherry-pick subfolders.
COPY --from=builder /app/node_modules ./node_modules

COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "server.js"]
