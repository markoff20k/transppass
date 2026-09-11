# Front React — imagem construída a partir da raiz do monorepo:
#   docker build -f apps/web/Dockerfile .
#
# Compila o Vite sem VITE_API_URL: o front chama /api na própria origem e o
# nginx desta imagem repassa para o serviço `api` do compose.

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/design-kit/package.json packages/design-kit/
COPY packages/config/package.json packages/config/
RUN npm ci

COPY . .
ENV VITE_API_URL=
RUN npm run build -w @app/shared \
 && npm run build -w @app/design-kit \
 && npm run build -w @app/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
