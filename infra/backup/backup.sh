#!/usr/bin/env bash
# Daily backup of the VBT database and uploaded photos.
#   compressed (gzip) -> encrypted (AES-256, key file) -> checked -> rotated -> copied off the server.
# Keeps 14 daily, 8 weekly (Sundays) and 12 monthly (1st of month) copies.
# Run from cron at 02:00 IST; see README.md. Settings come from /etc/vbt-backup.env.
set -euo pipefail

ENV_FILE="${VBT_BACKUP_ENV:-/etc/vbt-backup.env}"
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/vbt}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/vbt_app}"
KEY_FILE="${KEY_FILE:-/etc/vbt-backup.key}"
PG_USER="${PG_USER:-vishakan_ffm}"
PG_DB="${PG_DB:-vishakan_ffm}"
UPLOADS_VOLUME="${UPLOADS_VOLUME:-vishakan-ffm_uploads_data}"
KEEP_DAILY="${KEEP_DAILY:-14}"; KEEP_WEEKLY="${KEEP_WEEKLY:-8}"; KEEP_MONTHLY="${KEEP_MONTHLY:-12}"
# Off-server copy: set ONE of these. RCLONE_REMOTE="remote:vbt-backups"  or  RSYNC_TARGET="user@host:/path"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"; RSYNC_TARGET="${RSYNC_TARGET:-}"
# Test hooks (unset in production): a command that prints a dump, and a folder to archive instead of the docker volume.
DB_DUMP_CMD="${DB_DUMP_CMD:-}"; UPLOADS_SRC="${UPLOADS_SRC:-}"

mkdir -p "$BACKUP_DIR"/{daily,weekly,monthly}
LOG="$BACKUP_DIR/backup.log"
trap 'echo "$(date "+%F %T %z") BACKUP FAILED at line $LINENO" | tee -a "$BACKUP_DIR/backup.log"' ERR
log() { echo "$(date '+%F %T %z') $*" | tee -a "$LOG"; }
fail() { log "BACKUP FAILED: $*"; exit 1; }
[ -s "$KEY_FILE" ] || fail "encryption key file $KEY_FILE is missing or empty"

STAMP="$(date +%F-%H%M)"
DB_OUT="$BACKUP_DIR/daily/db-$STAMP.sql.gz.enc"
UP_OUT="$BACKUP_DIR/daily/uploads-$STAMP.tar.gz.enc"
enc() { openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$KEY_FILE"; }

log "backup start $STAMP"

# 1. database
if [ -n "$DB_DUMP_CMD" ]; then
  bash -c "$DB_DUMP_CMD" | gzip -9 | enc > "$DB_OUT" || fail "database dump"
else
  (cd "$COMPOSE_DIR" && docker compose exec -T postgres pg_dump -U "$PG_USER" "$PG_DB") | gzip -9 | enc > "$DB_OUT" || fail "database dump"
fi

# 2. uploaded photos (the database is not enough without them)
if [ -n "$UPLOADS_SRC" ]; then
  tar czf - -C "$UPLOADS_SRC" . | enc > "$UP_OUT" || fail "uploads archive"
else
  docker run --rm -v "$UPLOADS_VOLUME":/data:ro alpine tar czf - -C /data . | enc > "$UP_OUT" || fail "uploads archive"
fi

# 3. prove the files can be read back before calling this a backup
openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$KEY_FILE" -in "$DB_OUT" | gzip -t || fail "database backup does not decrypt/unzip"
openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$KEY_FILE" -in "$UP_OUT" | gzip -t || fail "uploads backup does not decrypt/unzip"
[ "$(stat -c %s "$DB_OUT")" -gt 1000 ] || fail "database backup is suspiciously small"
(cd "$BACKUP_DIR/daily" && sha256sum "$(basename "$DB_OUT")" "$(basename "$UP_OUT")" >> SHA256SUMS)

# 4. weekly (Sunday) and monthly (1st) copies
[ "$(date +%u)" = 7 ] && cp -p "$DB_OUT" "$UP_OUT" "$BACKUP_DIR/weekly/"
[ "$(date +%d)" = 01 ] && cp -p "$DB_OUT" "$UP_OUT" "$BACKUP_DIR/monthly/"

# 5. rotation: newest N of each kind
prune() { # dir keep
  for kind in db uploads; do
    find "$1" -maxdepth 1 -type f -name "$kind-*" -printf '%T@ %p\n' | sort -rn | tail -n +"$(( $2 + 1 ))" | cut -d' ' -f2- | xargs -r rm -f --
  done
}
prune "$BACKUP_DIR/daily" "$KEEP_DAILY"; prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"; prune "$BACKUP_DIR/monthly" "$KEEP_MONTHLY"

# 6. copy off the server (a backup that lives only on the VPS dies with the VPS)
if [ -n "$RCLONE_REMOTE" ]; then
  rclone sync "$BACKUP_DIR" "$RCLONE_REMOTE" --exclude "*.log" || fail "copy off the server (rclone)"
  log "copied off the server with rclone"
elif [ -n "$RSYNC_TARGET" ]; then
  rsync -a --delete --exclude '*.log' "$BACKUP_DIR"/ "$RSYNC_TARGET"/ || fail "copy off the server (rsync)"
  log "copied off the server with rsync"
else
  log "WARNING: NOT COPIED OFF THE SERVER - set RCLONE_REMOTE or RSYNC_TARGET in $ENV_FILE"
fi

log "backup ok $STAMP db=$(du -h "$DB_OUT" | cut -f1) uploads=$(du -h "$UP_OUT" | cut -f1)"
