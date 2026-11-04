#!/usr/bin/env bash
# Primeira instalação na VM: verifica pré-requisitos, gera o .env com senhas
# aleatórias e sobe a plataforma.
set -euo pipefail
cd "$(dirname "$0")/../.."

command -v docker >/dev/null || { echo "Docker não encontrado. Instale o Docker Engine primeiro."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Plugin 'docker compose' não encontrado."; exit 1; }

if [[ ! -f .env ]]; then
  read -rp "Endereço de acesso (ex.: http://chat.orgao.local): " url
  read -rp "Nome da organização exibido no login: " org
  # Escapa caracteres especiais do sed no nome digitado.
  org=${org//&/\\&}
  org=${org//|/-}
  db_pass=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)
  admin_pass="Admin$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-10)9"
  sed -e "s|^APP_ORIGINS=.*|APP_ORIGINS=${url%/}|" \
      -e "s|^ORG_NAME=.*|ORG_NAME=${org}|" \
      -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${db_pass}|" \
      -e "s|^DATABASE_URL=.*|DATABASE_URL=postgres://plataforma:${db_pass}@localhost:5432/plataforma|" \
      -e "s|^BOOTSTRAP_ADMIN_PASSWORD=.*|BOOTSTRAP_ADMIN_PASSWORD=${admin_pass}|" \
      -e "s|^NODE_ENV=.*|NODE_ENV=production|" \
      .env.example > .env
  chmod 600 .env
  echo
  echo "Arquivo .env criado. Senha provisória do usuário 'admin': ${admin_pass}"
  echo "Ela será trocada no primeiro acesso. Guarde-a agora."
  echo
fi

docker compose up -d --build
echo "Aguardando a API ficar pronta…"
for _ in $(seq 1 60); do
  if docker compose exec -T api wget -qO- http://127.0.0.1:3000/api/v1/health >/dev/null 2>&1; then
    echo "Plataforma no ar."
    exit 0
  fi
  sleep 2
done
echo "A API não respondeu em 2 minutos. Veja: docker compose logs api"
exit 1
