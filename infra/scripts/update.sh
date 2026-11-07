#!/usr/bin/env bash
# Atualiza a plataforma: completa o .env, faz backup, reconstrói as imagens e
# reinicia os serviços. As migrações do banco são aplicadas quando a API sobe.
set -euo pipefail
cd "$(dirname "$0")/../.."

# Primeiro: variáveis novas (ex.: APP_SECRET). Sem elas o docker compose nem roda.
echo "1/4 Conferindo o .env"
infra/scripts/upgrade-env.sh

echo "2/4 Backup antes da atualização"
infra/scripts/backup.sh

echo "3/4 Construindo imagens"
docker compose build

echo "4/4 Reiniciando serviços (na primeira vez o antivírus baixa as assinaturas: alguns minutos)"
if docker compose up -d --wait --wait-timeout 600; then
  echo "Atualização concluída."
  # Aviso de certificado do HTTPS perto de vencer (o site para de abrir quando vence).
  crt=infra/nginx/certs/server.crt
  if [[ -s "$crt" ]] && ! openssl x509 -in "$crt" -noout -checkend $((60 * 86400)) >/dev/null 2>&1; then
    echo "ATENÇÃO: o certificado do HTTPS vence em $(openssl x509 -in "$crt" -noout -enddate | cut -d= -f2)."
    echo "Renove com: infra/scripts/https.sh renovar (AC interna) ou importe o novo certificado."
  fi
  exit 0
fi
docker compose ps
docker compose logs --tail 40 api || true
echo "A plataforma não ficou pronta. Para voltar à versão anterior, restaure o backup acima"
echo "com infra/scripts/restore.sh e reconstrua a versão anterior do código."
exit 1
