FROM node:20-alpine AS deps
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM node:20-alpine AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

ARG ELEVENLABS_API_KEY=build-placeholder-elevenlabs-key
ARG ELEVENLABS_VOICE_ID=build-placeholder-voice-id
ARG OPENCLAW_GATEWAY_URL=ws://localhost:3000
ARG OPENCLAW_GATEWAY_TOKEN=build-placeholder-gateway-token

ENV ELEVENLABS_API_KEY=${ELEVENLABS_API_KEY}
ENV ELEVENLABS_VOICE_ID=${ELEVENLABS_VOICE_ID}
ENV OPENCLAW_GATEWAY_URL=${OPENCLAW_GATEWAY_URL}
ENV OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN}

RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm exec next build && pnpm exec node scripts/generate-openapi.mjs \
  && rm -f .next/standalone/.env

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S nextjs && adduser -S nextjs -G nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
