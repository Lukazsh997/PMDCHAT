#!/usr/bin/env bash
# Backup do banco (pg_dump, formato custom) e dos anexos (tar.gz).
# Agende no cron da VM, ex.: 30 2 * * * /opt/plataforma/infra/scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

DEST="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEST"

DB_FILE="$DEST/db-$STAMP.dump"
# Usuário e banco vêm das variáveis do próprio contêiner do PostgreSQL.
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$DB_FILE.partial"
mv "$DB_FILE.partial" "$DB_FILE"
echo "Banco:   $DB_FILE ($(du -h "$DB_FILE" | cut -f1))"

# Anexos: só existem a partir da Fase 1 (numa atualização vinda da Fase 0, não há o que copiar).
if docker compose exec -T api test -d /data/files 2>/dev/null; then
  FILES_FILE="$DEST/files-$STAMP.tar.gz"
  docker compose exec -T api tar czf - -C /data/files --exclude=./tmp . > "$FILES_FILE.partial"
  mv "$FILES_FILE.partial" "$FILES_FILE"
  echo "Anexos:  $FILES_FILE ($(du -h "$FILES_FILE" | cut -f1))"
else
  echo "Anexos:  nenhum para copiar (pasta de anexos ainda não existe ou a API está parada)"
fi

# HTTPS: certificado e AC interna (sem a chave da AC, renovar exige redistribuir a AC).
if [[ -d infra/nginx/ca || -s infra/nginx/certs/server.crt ]]; then
  TLS_FILE="$DEST/https-$STAMP.tar.gz"
  tar czf "$TLS_FILE" --exclude='infra/nginx/certs/desligado-*' \
    $( [[ -d infra/nginx/ca ]] && echo infra/nginx/ca ) infra/nginx/certs
  chmod 600 "$TLS_FILE"
  echo "HTTPS:   $TLS_FILE"
fi

find "$DEST" \( -name 'db-*.dump' -o -name 'files-*.tar.gz' -o -name 'https-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
