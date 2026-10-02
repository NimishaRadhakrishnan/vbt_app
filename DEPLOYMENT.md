# Deploying VBT One — Hostinger KVM 2 + Cloudflare

Written for the machine you have bought: **Hostinger KVM 2 — 2 vCPU, 8 GB RAM,
100 GB NVMe, 8 TB/month, 1 Gbps.**

---

## 1. How many people can use it

These are **measured numbers**, not estimates. The application was load-tested
on a 2 vCPU / 8 GB machine — the same shape as your KVM 2 — with Postgres,
Redis and the API all on the one box, at the two-worker setting this guide
configures.

| Endpoint | Requests/second | p95 latency at 10 users at once | Errors |
| --- | --- | --- | --- |
| Management dashboard (heaviest — 8 queries) | **80/s** | 336 ms | 0 |
| Session check (every page load) | **318/s** | 51 ms | 0 |
| Dealer list | **215/s** | 116 ms | 0 |

Nothing failed at any concurrency tested, up to 50 simultaneous requests.

**What that means in officers:**

A field officer is not sending requests continuously. A busy one checks in,
submits a visit, looks something up — perhaps **10–20 requests in a five-minute
burst**, then nothing for an hour. At that rate the constraint is the 9am
check-in peak, when everybody opens the app at once.

| | Comfortable | Peak that still holds up |
| --- | --- | --- |
| **Field officers using the app daily** | **300–500** | ~800 |
| **Admins/managers on the dashboard at once** | 10–15 | ~25 |
| **Simultaneous requests in flight** | 10–25 | 50 |

For the size of business this is built for — a Tamil Nadu agri-inputs company
with a field force — **this machine is not close to being the limit.** You
would feel disk and Postgres tuning long before you felt the CPU.

**What would actually run out first**, in order:

1. **Photo storage.** Visits carry crop photos. 100 GB at ~2 MB a photo is
   roughly 50,000 photos, minus the database and the OS. At 50 officers taking
   5 photos a day that is about **18 months** before the disk is the problem.
   Watch this before you watch anything else.
2. **Postgres connections.** Each API worker opens up to 30. Two workers = 60,
   against a default `max_connections` of 100. If you ever raise
   `UVICORN_WORKERS` above 3, raise `max_connections` too.
3. **CPU**, last — and only during a genuine all-at-once spike.

**The honest caveat:** this was measured against a demo database of ~3,000
rows. Query times grow with data. The heavy dashboard queries are indexed on
the columns they group by (migration `202609300002`), but at two or three
years of visits you should re-measure rather than trust this table.

---

## 2. One decision to make before you start

### Your frontend cannot be hosted on Cloudflare Pages as-is

This matters, so it is first.

Cloudflare Pages serves **static** files. This frontend is **not** static —
`next.config.js` sets `output: "standalone"`, and routes like
`/dashboard/officers/[id]` are rendered on the server at request time. Building
it for Pages would need `@cloudflare/next-on-pages` and a rewrite of anything
using Node APIs. That is a project, not a deploy step.

**You do not need it.** What you want from Cloudflare — a fast global edge,
free TLS, DDoS protection, hiding your server's IP — you get by putting
Cloudflare **in front of** the VPS as a proxy. That is this setup:

```
  Officer's phone
        │  HTTPS
        ▼
  Cloudflare edge  ──── caches static assets, terminates TLS, blocks attacks
        │  HTTPS (Full strict)
        ▼
  Your VPS :443  ── Nginx ─┬─→ Next.js  :3000   (the pages)
                           └─→ FastAPI  :8000   (the API and WebSocket)
                                  │
                           Postgres + Redis (same box, private network)
```

Everything runs on the VPS. Cloudflare sits in front. This is the normal way
to do it and it is what the config in this repo is written for.

### Which domain name

You said "same website domain name". **If your company website is already
serving on that domain, do not point the root at this VPS — your website will
go down the moment DNS propagates.**

Use a subdomain:

| Option | When |
| --- | --- |
| `app.yourcompany.com` | **Recommended.** Website stays where it is, untouched. |
| `vbt.yourcompany.com` | Same thing, different word. |
| `yourcompany.com` (root) | Only if this VPS is replacing the website entirely. |

The rest of this guide writes it as `app.yourcompany.com`. Substitute yours.

---

## 3. Before you touch the server

Have ready:

- The VPS **IP address** (Hostinger panel → VPS → Overview).
- **Root SSH access** — Hostinger emails the password, or you added a key.
- Your domain's **nameservers pointed at Cloudflare** (Cloudflare → Add site →
  it gives you two nameservers → set them at your registrar). This can take a
  few hours; start it now.
- The **production secrets**: `backend/.env.production.example` already has
  freshly generated values. You will copy it and edit two lines.

---

## 4. Server setup

SSH in as root:

```bash
ssh root@YOUR_VPS_IP
```

### 4.1 Update, and make a non-root user

Running an app as root means any flaw in it is a flaw with full control of the
machine. Five commands to avoid that:

```bash
apt update && apt upgrade -y
adduser vbt                      # set a real password when prompted
usermod -aG sudo vbt
rsync --archive --chown=vbt:vbt ~/.ssh /home/vbt   # carry your SSH key over
```

### 4.2 Firewall

Only three ports should be open. Do this **before** installing anything that
listens.

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

> **Do not open 8000 or 3000.** Nginx reaches them over Docker's private
> network. Exposing them lets anyone bypass Nginx, which means bypassing the
> rate limiting — and, because the app trusts forwarding headers from the
> proxy, it would let a caller claim any IP address they liked.

### 4.3 Docker

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker vbt
systemctl enable --now docker
docker --version && docker compose version
```

Now log out and back in **as `vbt`** — the rest is done as that user:

```bash
exit
ssh vbt@YOUR_VPS_IP
```

### 4.4 Swap — do not skip this

8 GB is comfortable, but a Docker build of the Next.js frontend can spike hard,
and a build that gets OOM-killed halfway leaves you debugging the wrong thing.
2 GB of swap costs nothing and removes the failure mode:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

---

## 5. Get the code onto the server

Upload `VBT-One-production.zip` from your machine:

```bash
# run this on YOUR laptop, not the server
scp VBT-One-production.zip vbt@YOUR_VPS_IP:~/
```

Then on the server:

```bash
sudo apt install -y unzip
unzip VBT-One-production.zip
mv app_vbt-8 vbt-one
cd vbt-one
```

---

## 6. Configuration

### 6.1 Backend secrets

```bash
cp backend/.env.production.example backend/.env
nano backend/.env
```

Three lines must change. **The app refuses to start if you get these wrong** —
that guard is deliberate (`app/main.py`), so a failure here is it working.

```ini
# 1. Your domain, exactly. No trailing slash. This is the CORS allowlist:
#    anything not listed here cannot call the API from a browser.
CORS_ALLOWED_ORIGINS=https://app.yourcompany.com

# 2. Generate a fresh one on the server and paste it:
#      openssl rand -hex 32
JWT_SECRET_KEY=<paste the 64 characters>

# 3. A strong database password. Generate it the same way.
POSTGRES_PASSWORD=<paste>

# 4. Confirm these are already set:
DEBUG=false
ENVIRONMENT=production
```

> The repository's git history contains an old committed JWT key from the
> project this was scaffolded from. Anyone with a copy could mint an admin
> token with it. `app/main.py` refuses to boot on that key or any other known
> one — generate your own.

### 6.2 Frontend and Nginx

```bash
nano .env
```

```ini
SERVER_NAME=app.yourcompany.com
NEXT_PUBLIC_API_BASE_URL=https://app.yourcompany.com/api/v1
PUBLIC_BACKEND_URL=https://app.yourcompany.com
```

`NEXT_PUBLIC_API_BASE_URL` is **baked into the frontend at build time**, not
read at runtime. If you change it later you must rebuild the frontend image,
not just restart it. Getting this wrong is the single most common reason a
deployed Next.js app loads but every button fails.

---

## 7. DNS and the certificate

### 7.1 Point the name at the server — grey cloud first

In Cloudflare → your domain → **DNS**:

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| A | `app` | `YOUR_VPS_IP` | **DNS only (grey cloud)** |

**Grey, not orange, for now.** Let's Encrypt has to reach your server directly
to verify you own the name. With the orange cloud on, it reaches Cloudflare
instead and the certificate request fails with an error that does not explain
why.

Wait until this resolves before continuing:

```bash
dig +short app.yourcompany.com     # must print YOUR_VPS_IP
```

### 7.2 Get the certificate

```bash
mkdir -p infra/certbot/conf infra/certbot/www

sudo docker run --rm \
  -v "$PWD/infra/certbot/conf:/etc/letsencrypt" \
  -v "$PWD/infra/certbot/www:/var/www/certbot" \
  -p 80:80 \
  certbot/certbot certonly --standalone \
  -d app.yourcompany.com \
  --email you@yourcompany.com \
  --agree-tos --no-eff-email
```

Check it landed:

```bash
sudo ls infra/certbot/conf/live/app.yourcompany.com/
# fullchain.pem  privkey.pem  cert.pem  chain.pem
```

### 7.3 Now turn the orange cloud on

Back in Cloudflare DNS, switch that A record to **Proxied (orange)**.

Then **SSL/TLS → Overview → Full (strict)**.

> **Full (strict)** means Cloudflare verifies your server's certificate.
> "Flexible" would make Cloudflare talk to your server over *plain HTTP* while
> showing visitors a padlock — the padlock would be a lie, and the traffic
> between Cloudflare and your VPS, including login passwords, would be
> unencrypted. Never use Flexible.

Also set, in Cloudflare:

- **SSL/TLS → Edge Certificates → Always Use HTTPS: On**
- **Network → WebSockets: On** — the app opens a WebSocket for live alerts.
  It is usually on by default; confirm it.

---

## 8. Start it

```bash
sudo docker compose build
sudo docker compose up -d
sudo docker compose ps        # every service should say healthy or running
```

The backend runs its own migrations on start (`backend/start.sh`), so there is
no separate migration step.

### Load the starting data

The app comes up **empty** and an empty app looks broken. Load the demo data
first to confirm everything works end to end:

```bash
sudo docker compose exec backend python scripts/demo_seed.py
```

It prints the sign-in details when it finishes.

> **This is demonstration data — officers, farmers, dealers, 15 months of
> orders.** It exists so you can see the dashboards working. Before the system
> carries real business data, wipe it and enter your own:
>
> ```bash
> sudo docker compose down -v      # deletes the volumes, and all data with them
> sudo docker compose up -d
> ```
>
> and change every seeded password.

### Check it

```bash
curl -s https://app.yourcompany.com/api/v1/health/ready
# {"status":"ready","checks":{"database":"ok","redis":"ok"}}
```

Then open `https://app.yourcompany.com` in a browser and sign in.

---

## 9. Certificate renewal

Let's Encrypt certificates last 90 days. Renew automatically:

```bash
crontab -e
```

```cron
# Renew at 03:17 on the 1st and 15th, then reload nginx so it picks up the
# new file. The odd minute is deliberate - Let's Encrypt asks that renewals
# are not all fired on the hour.
17 3 1,15 * * cd ~/vbt-one && sudo docker run --rm -v "$PWD/infra/certbot/conf:/etc/letsencrypt" -v "$PWD/infra/certbot/www:/var/www/certbot" certbot/certbot renew --webroot -w /var/www/certbot --quiet && sudo docker compose exec -T nginx nginx -s reload
```

Test the renewal path works **before** you need it:

```bash
sudo docker run --rm \
  -v "$PWD/infra/certbot/conf:/etc/letsencrypt" \
  -v "$PWD/infra/certbot/www:/var/www/certbot" \
  certbot/certbot renew --webroot -w /var/www/certbot --dry-run
```

---

## 10. Backups

**Do this on day one, not after the first scare.** A VPS is one machine; a
disk failure or a wrong `DELETE` with no backup is the end of the business's
records.

```bash
mkdir -p ~/backups
nano ~/backup-vbt.sh
```

```bash
#!/bin/bash
set -euo pipefail
cd ~/vbt-one
STAMP=$(date +%F-%H%M)

# Database
sudo docker compose exec -T postgres pg_dump -U vishakan_ffm vishakan_ffm \
  | gzip > ~/backups/db-$STAMP.sql.gz

# Uploaded photos - the database is useless without them
sudo docker run --rm \
  -v vbt-one_uploads_data:/data:ro \
  -v ~/backups:/backup alpine \
  tar czf /backup/uploads-$STAMP.tar.gz -C /data .

# Keep 14 days
find ~/backups -name '*.gz' -mtime +14 -delete
echo "backup ok: $STAMP"
```

```bash
chmod +x ~/backup-vbt.sh
~/backup-vbt.sh          # run it once now and check the files exist
ls -lh ~/backups/
crontab -e
```

```cron
30 2 * * * /home/vbt/backup-vbt.sh >> /home/vbt/backups/backup.log 2>&1
```

> **A backup you have never restored is not a backup.** Once a quarter, copy a
> dump to another machine and load it into a scratch database. Also copy these
> files off the VPS — Hostinger snapshots and `~/backups` die with the same
> server.

---

## 11. Updating later

```bash
cd ~/vbt-one
~/backup-vbt.sh                    # always, before an update
# upload and unzip the new build over the top, then:
sudo docker compose build
sudo docker compose up -d
```

The backend image has **no volume mount** — a code change needs a rebuild, not
a restart. If you restart without rebuilding you will be running the old code
and wondering why the fix did not take.

---

## 12. Tuning, if you ever need it

Everything below is already set correctly for KVM 2. This is for when you
outgrow it.

**API workers.** Two, in `backend/start.sh`, overridable:

```bash
# in backend/.env
UVICORN_WORKERS=2
```

One worker leaves half of a 2-core box idle; measured, the second worker took
the heaviest endpoint from ~52 to ~80 requests/second. Do not go above 3 on
this machine: each worker opens up to 30 Postgres connections, and four
workers would ask for 120 against a default limit of 100 while fighting over
two cores.

**If you move to a bigger VPS**, raise workers to roughly one per core and
raise Postgres `max_connections` to at least `workers × 30 + 20`.

**Watch these:**

```bash
df -h                          # disk — the first thing that will run out
sudo docker stats --no-stream  # per-container CPU and memory
sudo docker compose logs -f --tail=100 backend
```

---

## 13. When something is wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| Backend container exits immediately | The production config guard rejected a setting | `docker compose logs backend` — it names the setting |
| Site loads, every action fails | `NEXT_PUBLIC_API_BASE_URL` wrong, or baked in before you set it | Fix `.env`, then **rebuild** the frontend, not restart |
| Browser console: CORS error | `CORS_ALLOWED_ORIGINS` does not exactly match the URL | Include the scheme, no trailing slash |
| Redirect loop | Cloudflare SSL set to Flexible | Set **Full (strict)** |
| 521 / 522 from Cloudflare | Nginx not running, or port 443 closed | `docker compose ps`, `ufw status` |
| Certificate request fails | Orange cloud was on during issuance | Grey cloud, reissue, orange back on |
| Photo upload fails with 413 | Body-size limit | Already 25 MB in `nginx.conf`; raise if genuinely needed |
| Everyone locked out of login at once | Would have been the proxy-IP bug | Fixed — see below. If it recurs, check `CF-Connecting-IP` is reaching the backend |

### What was fixed for this deployment

Two things in this repository were wrong for any deployment behind a proxy,
and both were found while writing this guide:

1. **The login rate limiter saw the proxy, not the user.** It read the address
   that opened the TCP connection — which behind Nginx is Nginx, and behind
   Cloudflare is still Nginx. Every request in the world shared one bucket, so
   **100 failed logins from anyone would have locked out every officer in the
   company.** With a few hundred people mistyping passwords on rural phones,
   that is a Monday morning, not a hypothetical. The app now reads
   `CF-Connecting-IP`, then `X-Forwarded-For`, and only then the socket; Nginx
   only believes those headers from Cloudflare's own IP ranges. Covered by
   `test_the_client_ip_is_the_user_not_the_proxy`.

2. **Nginx would have refused to start on a host without IPv6.** The config
   listened on `[::]:80`. On a VPS with no IPv6 that is not a degraded start —
   nginx exits, and the whole site stays down. The listeners are IPv4 only
   now; Cloudflare serves IPv6 visitors from its edge regardless.

Also corrected while here: `Connection: upgrade` was being sent on *every* API
request rather than only real WebSocket upgrades (which disables keep-alive to
the upstream), the edge rate-limit zone was keyed on Cloudflare's address
rather than the visitor's, and there was no body-size limit, so a photo from a
phone camera would have been rejected with a bare `413`.

---

## 14. Before real data goes in

- [ ] Every seeded password changed
- [ ] Demo data wiped (`docker compose down -v`) and your own products,
      officers and dealers entered
- [ ] **Cost price** set on each product — until then the dashboard's profit
      card correctly says it cannot be shown
- [ ] Monthly sales targets set per officer
- [ ] A backup taken **and restored once** into a scratch database
- [ ] `ufw status` shows only 22, 80, 443
- [ ] `https://app.yourcompany.com` shows a valid certificate
- [ ] Cloudflare SSL is **Full (strict)**, WebSockets **On**
- [ ] Read `PRODUCTION_READINESS.md` — it lists what is still open
