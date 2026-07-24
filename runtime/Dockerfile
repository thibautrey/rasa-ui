# syntax=docker/dockerfile:1.7

FROM node:22.18.0-alpine3.22 AS development-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM development-dependencies AS build
COPY tsconfig.json eslint.config.mjs ./
COPY src ./src
RUN npm run build

FROM node:22.18.0-alpine3.22 AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

FROM nginxinc/nginx-unprivileged:1.29-alpine AS ingress
COPY --chown=101:101 nginx.conf /etc/nginx/nginx.conf
USER root
RUN mkdir -p /run/runtime-public \
    && chmod 1777 /run/runtime-public
USER 101

FROM node:22.18.0-alpine3.22 AS runtime
ENV NODE_ENV=production \
    NODE_OPTIONS="--disable-proto=throw"
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node public ./public
RUN mkdir -p /run/runtime-public /run/runtime-broker /run/runtime-redis \
    && chmod 1777 /run/runtime-public /run/runtime-broker /run/runtime-redis
USER node
CMD ["node", "dist/public-server.js"]

FROM redis:7.4-alpine AS redis
USER root
RUN mkdir -p /run/runtime-redis \
    && chmod 1777 /run/runtime-redis
USER 999
