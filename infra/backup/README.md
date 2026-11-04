# Backups and the monthly restore test

`backup.sh` runs every night at 02:00 IST. It dumps the database and the uploaded photos,
compresses and encrypts them (AES-256), checks they can be read back, keeps **14 daily,
8 weekly (Sundays) and 12 monthly (1st)** copies, and copies everything off the server.
`restore_test.sh` loads the newest database backup into a throwaway database once a month and
logs PASSED or FAILED. It uses the PostGIS image the server already has and starts no
permanent container.

## One-time setup (on the server, as root)

```bash
cd /opt/vbt_app && git pull origin main
mkdir -p /var/backups/vbt
# 1. encryption key - then COPY IT SOMEWHERE SAFE OFF THE SERVER (password manager).
#    Without this key the backups cannot be opened.
openssl rand -base64 48 > /etc/vbt-backup.key && chmod 600 /etc/vbt-backup.key
cat /etc/vbt-backup.key          # <- save this now
# 2. settings
cat > /etc/vbt-backup.env <<'ENV'
BACKUP_DIR=/var/backups/vbt
COMPOSE_DIR=/opt/vbt_app
# Off-server copy - set ONE of these:
#RCLONE_REMOTE=remote:vbt-backups
#RSYNC_TARGET=user@other-server:/backups/vbt
ENV
chmod 600 /etc/vbt-backup.env
chmod +x infra/backup/*.sh
# 3. run once now and check
infra/backup/backup.sh && ls -lh /var/backups/vbt/daily
infra/backup/restore_test.sh
```

If the log says `NOT COPIED OFF THE SERVER`, the backup exists only on this server and would be lost
with it. Set `RCLONE_REMOTE` (any storage rclone supports: Google Drive, S3, Backblaze) or
`RSYNC_TARGET` (a second machine) before relying on it.

## Schedule (`crontab -e` as root)

```cron
CRON_TZ=Asia/Kolkata
0 2 * * *  /opt/vbt_app/infra/backup/backup.sh >> /var/backups/vbt/cron.log 2>&1
0 4 5 * *  /opt/vbt_app/infra/backup/restore_test.sh >> /var/backups/vbt/cron.log 2>&1
```

Logs: `/var/backups/vbt/backup.log` (every run) and `/var/backups/vbt/restore-test.log`
(one line per monthly test). Look for `backup ok` and `RESTORE TEST PASSED`.

## Restoring for real

```bash
KEY=/etc/vbt-backup.key
F=/var/backups/vbt/daily/db-YYYY-MM-DD-HHMM.sql.gz.enc
# database (stop the app first: docker compose stop backend scheduler)
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:$KEY -in $F | gunzip \
  | docker compose exec -T postgres psql -U vishakan_ffm -d vishakan_ffm
# photos
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:$KEY -in /var/backups/vbt/daily/uploads-....tar.gz.enc \
  | docker run --rm -i -v vishakan-ffm_uploads_data:/data alpine tar xzf - -C /data
```

Restore into an empty database (drop and recreate it first), then `docker compose up -d`.
