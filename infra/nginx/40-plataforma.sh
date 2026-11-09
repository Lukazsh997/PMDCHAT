#!/bin/sh
# Escolhe a configuração do Nginx na subida do contêiner: HTTPS se há certificado e chave
# em /etc/nginx/certs, HTTP caso contrário. Roda pelo /docker-entrypoint.d da imagem.
set -eu
certs=/etc/nginx/certs
target=/etc/nginx/conf.d/default.conf

if [ -s "$certs/server.crt" ] && [ -s "$certs/server.key" ]; then
  port="${HTTPS_PORT:-443}"
  suffix=""
  [ "$port" = "443" ] || suffix=":$port"
  sed "s|__HTTPS_PORT_SUFFIX__|$suffix|g" /etc/nginx/plataforma/https.conf > "$target"
  echo "plataforma: HTTPS ligado (porta publicada $port)."
else
  cp /etc/nginx/plataforma/http.conf "$target"
  echo "plataforma: HTTP (sem certificado em $certs)."
fi
