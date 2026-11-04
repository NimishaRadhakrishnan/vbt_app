#!/usr/bin/env bash
# Monthly restore test: load the newest database backup into a throwaway PostGIS
# container, check the data is really there, and log PASSED or FAILED.
# A backup that has never been restored is not a backup.
set -uo pipefail

ENV_FILE="${VBT_BACKUP_ENV:-/etc/vbt-backup.env}"
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/vbt}"
KEY_FILE="${KEY_FILE:-/etc/vbt-backup.key}"
PG_USER="${PG_USER:-vishakan_ffm}"; PG_DB="${PG_DB:-vishakan_ffm}"
PG_IMAGE="${PG_IMAGE:-postgis/postgis:16-3.4-alpine}"
# Test hook: restore into an existing scratch database instead of a container.
RESTORE_TARGET_URL="${RESTORE_TARGET_URL:-}"
LOG="$BACKUP_DIR/restore-test.log"
NAME="vbt-restore-test-$$"
log() { echo "$(date '+%F %T %z') $*" | tee -a "$LOG"; }
cleanup() { [ -z "$RESTORE_TARGET_URL" ] && docker rm -f "$NAME" >/dev/null 2>&1; true; }
trap cleanup EXIT

LATEST="$(ls -1t "$BACKUP_DIR"/daily/db-*.sql.gz.enc 2>/dev/null | head -1)"
[ -n "$LATEST" ] || { log "RESTORE TEST FAILED: no backup found in $BACKUP_DIR/daily"; exit 1; }
log "restore test start file=$(basename "$LATEST")"

dump() { openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$KEY_FILE" -in "$LATEST" | gunzip; }

if [ -n "$RESTORE_TARGET_URL" ]; then
  PSQL=(psql "$RESTORE_TARGET_URL" -v ON_ERROR_STOP=0 -q)
  dump | "${PSQL[@]}" >/dev/null 2>"$BACKUP_DIR/restore-errors.txt"
  Q() { psql "$RESTORE_TARGET_URL" -tAc "$1"; }
else
  docker run -d --name "$NAME" -e POSTGRES_USER="$PG_USER" -e POSTGRES_PASSWORD=restore-test -e POSTGRES_DB="$PG_DB" "$PG_IMAGE" >/dev/null \
    || { log "RESTORE TEST FAILED: could not start the scratch database"; exit 1; }
  # The PostGIS image starts a temporary server to set itself up, shuts it down, then starts the real one.
  # pg_isready passes on the temporary server, so wait until "ready to accept connections" has appeared twice.
  READY=0
  for _ in $(seq 1 90); do
    [ "$(docker logs "$NAME" 2>&1 | grep -c 'ready to accept connections')" -ge 2 ] && { READY=1; break; }
    [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" = true ] || break
    sleep 2
  done
  [ "$READY" = 1 ] || { log "RESTORE TEST FAILED: the scratch database did not start: $(docker logs --tail 3 "$NAME" 2>&1 | tr '\n' ' ')"; exit 1; }
  sleep 2
  dump | docker exec -i "$NAME" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=0 -q >/dev/null 2>"$BACKUP_DIR/restore-errors.txt"
  Q() { docker exec "$NAME" psql -U "$PG_USER" -d "$PG_DB" -tAc "$1"; }
fi

USERS="$(Q 'SELECT count(*) FROM users' 2>/dev/null || echo ERR)"
PERIODS="$(Q 'SELECT count(*) FROM kpi_period' 2>/dev/null || echo ERR)"
STMTS="$(Q 'SELECT count(*) FROM incentive_statement' 2>/dev/null || echo ERR)"
VISITS="$(Q 'SELECT count(*) FROM visits' 2>/dev/null || echo ERR)"
ERRS="$(grep -ci 'error' "$BACKUP_DIR/restore-errors.txt" 2>/dev/null || true)"

if [[ "$USERS" =~ ^[0-9]+$ && "$USERS" -gt 0 && "$PERIODS" =~ ^[0-9]+$ && "$STMTS" =~ ^[0-9]+$ && "$VISITS" =~ ^[0-9]+$ ]]; then
  log "RESTORE TEST PASSED file=$(basename "$LATEST") users=$USERS visits=$VISITS kpi_periods=$PERIODS statements=$STMTS load_errors=$ERRS"
else
  log "RESTORE TEST FAILED file=$(basename "$LATEST") users=$USERS visits=$VISITS kpi_periods=$PERIODS statements=$STMTS load_errors=$ERRS (see $BACKUP_DIR/restore-errors.txt)"
  exit 1
fi
