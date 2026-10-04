#!/usr/bin/env bash
# Daily encrypted PostgreSQL backup (docs/SECURITY.md §4).
#   DATABASE_URL       connection string of the database to back up
#   BACKUP_PASSPHRASE  encryption passphrase (from the secret manager – never stored next to the backups)
#   BACKUP_DIR         target directory (default ./backups)
#   BACKUP_KEEP        number of daily files to keep (default 30)
# Restore: openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in <file> | gunzip | psql <database>
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP="${BACKUP_KEEP:-30}"

mkdir -p "$BACKUP_DIR"
umask 077
file="$BACKUP_DIR/stallioncrm-$(date -u +%Y%m%dT%H%M%SZ).sql.gz.enc"

# Prisma's ?schema= parameter is not understood by pg_dump
url="${DATABASE_URL%%\?*}"

pg_dump --no-owner --no-privileges "$url" | gzip -9 | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE -out "$file.part"
mv "$file.part" "$file"

# a backup that cannot be read back is worthless: check that it decrypts and is a complete dump
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$file" | gunzip | tail -n 5 | grep -q "PostgreSQL database dump complete" || {
  echo "backup verification failed: $file" >&2
  exit 1
}

ls -1t "$BACKUP_DIR"/stallioncrm-*.sql.gz.enc | tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm -f
echo "backup written: $file ($(du -h "$file" | cut -f1))"
