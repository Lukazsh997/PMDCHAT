#!/usr/bin/env bash
# Restaura um backup. ATENÇÃO: substitui todos os dados atuais.
# Uso: infra/scripts/restore.sh backups/db-AAAAMMDD-HHMMSS.dump [backups/files-AAAAMMDD-HHMMSS.tar.gz]
set -euo pipefail
cd "$(dirname "$0")/../.."

DB_FILE="${1:?Informe o arquivo de backup do banco}"
FILES_FILE="${2:-}"
[[ -f "$DB_FILE" ]] || { echo "Arquivo não encontrado: $DB_FILE"; exit 1; }
[[ -z "$FILES_FILE" || -f "$FILES_FILE" ]] || { echo "Arquivo não encontrado: $FILES_FILE"; exit 1; }

read -rp "Isto apaga os dados atuais e restaura o backup. Digite RESTAURAR para continuar: " ok
[[ "$ok" == "RESTAURAR" ]] || { echo "Cancelado."; exit 1; }

docker compose stop nginx worker
docker compose exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < "$DB_FILE"
if [[ -n "$FILES_FILE" ]]; then
  docker compose exec -T api sh -c 'find /data/files -mindepth 1 -delete && tar xzf - -C /data/files' < "$FILES_FILE"
  echo "Anexos restaurados."
fi
docker compose up -d --wait --wait-timeout 600
echo "Restauração concluída."
