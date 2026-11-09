#!/usr/bin/env bash
# Primeira instalação na VM: verifica pré-requisitos, gera o .env com senhas
# aleatórias e sobe a plataforma. Pode ser executado de novo com segurança.
set -euo pipefail
cd "$(dirname "$0")/../.."

command -v docker >/dev/null || { echo "Docker não encontrado. Instale o Docker Engine primeiro."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Plugin 'docker compose' não encontrado."; exit 1; }

# Normaliza um endereço digitado: acrescenta http:// e remove a barra final.
normalize_url() {
  local u="${1//[[:space:]]/}"
  u="${u%/}"
  [[ "$u" =~ ^https?:// ]] || u="http://$u"
  printf '%s' "$u"
}

if [[ ! -f .env ]]; then
  read -rp "Endereço de acesso (ex.: http://chat.orgao.local ou http://192.168.0.10): " url
  url=$(normalize_url "$url")
  read -rp "Nome da organização exibido no login: " org
  # Remove caracteres que quebrariam o .env ou o sed.
  org=$(printf '%s' "$org" | tr -d '"$`\\|\r')
  org=${org//&/\\&}
  db_pass=$(openssl rand -hex 16)
  admin_pass="Admin$(openssl rand -hex 5)9"
  tr -d '\r' < .env.example | sed \
      -e "s|^APP_ORIGINS=.*|APP_ORIGINS=${url}|" \
      -e "s|^ORG_NAME=.*|ORG_NAME=\"${org}\"|" \
      -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${db_pass}|" \
      -e "s|^DATABASE_URL=.*|DATABASE_URL=postgres://plataforma:${db_pass}@localhost:5432/plataforma|" \
      -e "s|^BOOTSTRAP_ADMIN_PASSWORD=.*|BOOTSTRAP_ADMIN_PASSWORD=${admin_pass}|" \
      -e "s|^NODE_ENV=.*|NODE_ENV=production|" \
      -e "s|^APP_SECRET=.*|APP_SECRET=$(openssl rand -hex 32)|" \
      -e "/^FILES_DIR=/d" \
      > .env
  chmod 600 .env
  echo
  echo "Arquivo .env criado. Endereço de acesso: ${url}"
  echo "Senha provisória do usuário 'admin': ${admin_pass}"
  echo "Ela será trocada no primeiro acesso. Guarde-a agora."
  echo
fi
# Instalação anterior: acrescenta variáveis novas sem alterar as existentes.
infra/scripts/upgrade-env.sh

# Confere APP_ORIGINS antes de subir, para não falhar dentro do contêiner.
origins=$(grep -E '^APP_ORIGINS=' .env | cut -d= -f2- | tr -d '"')
IFS=',' read -ra list <<< "$origins"
for o in "${list[@]}"; do
  if ! [[ "$o" =~ ^https?://[^/[:space:]]+$ ]]; then
    echo "APP_ORIGINS inválido no .env: '$o'"
    echo "Use o endereço completo, ex.: APP_ORIGINS=http://192.168.0.10"
    exit 1
  fi
done

echo "Construindo e subindo os serviços. Na primeira vez o antivírus baixa as"
echo "assinaturas de vírus, o que pode levar alguns minutos."
if ! docker compose up -d --build --wait --wait-timeout 600; then
  echo
  echo "A plataforma não subiu. Últimas linhas do log da API:"
  echo "--------------------------------------------------------------"
  docker compose logs --tail 40 api || true
  echo "--------------------------------------------------------------"
  echo "Corrija o problema indicado acima e rode este script novamente."
  exit 1
fi
echo "Plataforma no ar: ${origins%%,*}"
if [[ ! -s infra/nginx/certs/server.crt ]]; then
  echo "Para ligar o HTTPS (sem custo): infra/scripts/https.sh interna — ver docs/implantacao.md."
fi
