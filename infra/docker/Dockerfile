# syntax=docker/dockerfile:1.7
# Imagens da plataforma, construídas a partir do monorepo:
#   --target api  → API HTTP/WebSocket, worker e CLI (mesmo código, comandos diferentes)
#   --target web  → Nginx servindo a interface e fazendo o proxy da API

ARG NODE_IMAGE=node:24-alpine
ARG NGINX_IMAGE=nginx:1.28-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

# ---- dependências (camada reaproveitada enquanto o lockfile não muda) ------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM deps AS build
ARG VITE_ORG_NAME="Comunicação Interna"
ENV VITE_ORG_NAME=${VITE_ORG_NAME}
COPY . .
RUN pnpm --filter @plataforma/contracts build \
 && pnpm --filter @plataforma/api build \
 && pnpm --filter @plataforma/web build \
 && pnpm --filter @plataforma/api deploy --prod --legacy /out/api

# ---- imagem da API / worker -------------------------------------------------
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=build --chown=node:node /out/api ./
COPY infra/docker/api-entrypoint.sh /usr/local/bin/api-entrypoint
# Garante o script executável e com quebras de linha Unix, mesmo que o código tenha
# passado por um Git ou editor no Windows (CRLF impede a execução no Linux).
RUN sed -i 's/\r$//' /usr/local/bin/api-entrypoint && chmod 0755 /usr/local/bin/api-entrypoint \
 && mkdir -p /data/files && chown node:node /data/files
# O volume de anexos herda o dono desta pasta quando é criado.
VOLUME /data/files
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health/live >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "api-entrypoint"]
CMD ["api"]

# ---- imagem web (Nginx) -----------------------------------------------------
FROM ${NGINX_IMAGE} AS web
# HTTP ou HTTPS é decidido na subida, pela presença do certificado (40-plataforma.sh).
COPY infra/nginx/app.conf infra/nginx/http.conf infra/nginx/https.conf /etc/nginx/plataforma/
COPY infra/nginx/40-plataforma.sh /docker-entrypoint.d/40-plataforma.sh
RUN sed -i 's/\r$//' /etc/nginx/plataforma/*.conf /docker-entrypoint.d/40-plataforma.sh \
  && chmod +x /docker-entrypoint.d/40-plataforma.sh \
  && rm -f /etc/nginx/conf.d/default.conf \
  && mkdir -p /etc/nginx/certs
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80 443
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/nginx-health >/dev/null || exit 1
