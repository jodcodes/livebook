FROM node:22-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3002
ENV HOSTNAME=0.0.0.0

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts

EXPOSE 3002

CMD ["npm", "run", "start"]
