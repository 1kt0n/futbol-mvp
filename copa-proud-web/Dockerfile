# Sitio público Copa Proud — servicio Railway "copa-proud-web" (root directory: copa-proud-web/)
# Build estático de Vite servido con Caddy. VITE_* se hornean en el build: Railway pasa las
# variables del servicio como build args porque están declaradas con ARG.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_API_URL
ARG VITE_COMPETITION_SLUG=copa-proud-2026
ENV VITE_API_URL=$VITE_API_URL VITE_COMPETITION_SLUG=$VITE_COMPETITION_SLUG
RUN test -n "$VITE_API_URL" || (echo "Falta VITE_API_URL (ej. https://api.copaproud.com)" && exit 1)
RUN npm run build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
