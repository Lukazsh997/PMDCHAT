#!/usr/bin/env bash
# Atualiza a plataforma: faz backup, reconstrói as imagens e reinicia os serviços.
# As migrações do banco são aplicadas automaticamente quando a API sobe.
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "1/3 Backup antes da atualização"
infra/scripts/backup.sh

infra/scripts/upgrade-env.sh

echo "2/3 Construindo imagens"
docker compose build

echo "3/3 Reiniciando serviços"
if docker compose up -d --wait --wait-timeout 600; then
  echo "Atualização concluída."
  exit 0
fi
docker compose logs --tail 40 api || true
echo "A API não ficou pronta. Para voltar à versão anterior, restaure o backup acima"
echo "com infra/scripts/restore.sh e reconstrua a versão anterior do código."
exit 1
