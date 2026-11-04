#!/usr/bin/env bash
# Restaura um backup do banco. ATENÇÃO: substitui todos os dados atuais.
# Uso: infra/scripts/restore.sh backups/db-AAAAMMDD-HHMMSS.dump
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; source .env; set +a

FILE="${1:?Informe o arquivo de backup}"
[[ -f "$FILE" ]] || { echo "Arquivo não encontrado: $FILE"; exit 1; }

read -rp "Isto apaga os dados atuais e restaura $FILE. Digite RESTAURAR para continuar: " ok
[[ "$ok" == "RESTAURAR" ]] || { echo "Cancelado."; exit 1; }

docker compose stop nginx worker api
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner < "$FILE"
docker compose up -d
echo "Restauração concluída."
