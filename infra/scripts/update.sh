#!/usr/bin/env bash
# Atualiza a plataforma: faz backup, reconstrói as imagens e reinicia os serviços.
# As migrações do banco são aplicadas automaticamente quando a API sobe.
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "1/3 Backup antes da atualização"
infra/scripts/backup.sh

echo "2/3 Construindo imagens"
docker compose build

echo "3/3 Reiniciando serviços"
docker compose up -d
for _ in $(seq 1 60); do
  if docker compose exec -T api wget -qO- http://127.0.0.1:3000/api/v1/health >/dev/null 2>&1; then
    echo "Atualização concluída."
    exit 0
  fi
  sleep 2
done
echo "A API não ficou pronta. Para voltar à versão anterior, restaure o backup acima"
echo "com infra/scripts/restore.sh e reconstrua a versão anterior do código."
exit 1
