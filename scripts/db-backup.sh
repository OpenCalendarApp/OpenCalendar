#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

POSTGRES_DB="${POSTGRES_DB:-session_scheduler}"
POSTGRES_USER="${POSTGRES_USER:-ss_admin}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
OUTPUT_PATH="${1:-$BACKUP_DIR/${POSTGRES_DB}_${TIMESTAMP}.sql.gz}"

mkdir -p "$(dirname "$OUTPUT_PATH")"

echo "Creating backup for database '$POSTGRES_DB' -> $OUTPUT_PATH"
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "$OUTPUT_PATH"
echo "Backup completed: $OUTPUT_PATH"
