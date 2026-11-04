#!/usr/bin/env bash
# Backup do banco de dados (formato custom do pg_dump, comprimido).
# Agende no cron da VM, ex.: 30 2 * * * /opt/plataforma/infra/scripts/backup.sh
# Os arquivos anexos (fase 1) entram neste script quando o volume existir.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; source .env; set +a

DEST="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEST"

FILE="$DEST/db-$STAMP.dump"
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$FILE.partial"
mv "$FILE.partial" "$FILE"
echo "Backup do banco: $FILE ($(du -h "$FILE" | cut -f1))"

find "$DEST" -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete
