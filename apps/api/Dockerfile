# API NestJS — imagem construída a partir da raiz do monorepo:
#   docker build -f apps/api/Dockerfile .
#
# Um estágio compila (shared + api + cliente do Prisma); o outro roda só com
# o necessário. O seed usa ts-node, então as devDependencies ficam na imagem
# — o custo é tamanho, o ganho é `docker compose exec api npm run db:seed`
# funcionar sem malabarismo.

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/design-kit/package.json packages/design-kit/
COPY packages/config/package.json packages/config/
RUN npm ci

COPY . .
RUN npm run build -w @app/shared \
 && npm run db:generate -w @app/api \
 && npm run build -w @app/api

FROM node:22-bookworm-slim
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
# Rodar de dentro de apps/api: o Prisma acha o schema e o `npm run db:seed` funciona.
WORKDIR /app/apps/api

EXPOSE 3000
# Sincroniza o schema com o banco antes de subir (sem migrações versionadas no MVP).
CMD ["sh", "-c", "npm run db:push && node dist/main.js"]
