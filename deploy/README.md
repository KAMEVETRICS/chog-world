# Hosting Chog World Order on your own server

One Docker Compose stack on a Linux VPS: the app (Chog Cult, Chog City and Chog Soul in one Node process),
PostgreSQL, and Caddy for HTTPS with an automatic certificate. Tested end to end on Docker Desktop on
2026-10-21 against Monad mainnet (read-only): image build, first start, health, both UIs, City and Cult data,
the live event streams through Caddy, and visitor addresses reaching the app only through Caddy.

Commands marked **PC** run in this repository on your computer; **server** ones run over SSH.

## What you need

- A VPS with Ubuntu 24.04: at least 2 vCPU, 2 GB RAM and 20 GB disk (building the image needs about 1.5 GB of RAM).
- A domain you control, for example `world.example.com`.
- About 15 minutes.

## 1. Point the domain at the server

At your DNS provider, add an **A record** for the domain with the server's IPv4 address (and an AAAA record
if the server has IPv6). Wait until `nslookup world.example.com` shows the server's address.

## 2. Prepare the server (once)

**server**

```bash
curl -fsSL https://get.docker.com | sh
```

```bash
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable
```

Only ports 80 and 443 (Caddy) are published. PostgreSQL and the app are reachable only inside the stack.

## 3. Upload the code

**PC**

```bash
node deploy/bundle.mjs
```

```bash
scp chog-world.tar.gz root@world.example.com:/opt/
```

The bundle holds `cult/`, `city/`, the verified mainnet manifest and this folder. It never contains `.env`
files or dependencies, and the script checks the archive before keeping it.

**server**

```bash
mkdir -p /opt/chog-world && tar -xzf /opt/chog-world.tar.gz -C /opt/chog-world
```

## 4. Settings

**server**

```bash
cd /opt/chog-world/deploy && cp production.env.example .env && chmod 600 .env
```

```bash
openssl rand -hex 24
```

Edit `.env` (`nano .env`) and set:

| Setting | What to put |
| --- | --- |
| `CULT_DOMAIN` | Your domain, without `https://`. Sign-in is tied to it. |
| `POSTGRES_PASSWORD` | The value from `openssl rand -hex 24`. |
| `CULT_TIMING` | `demo` (a 6-minute Cult cycle, good while people are watching) or `production` (one cycle a day). Fixed by the first start. |
| `OPENROUTER_API_KEY` | A new OpenRouter key made only for this server, with a credit limit. Paste it here and nowhere else. Empty keeps AI off. |
| `MONAD_MAINNET_RPC_URL` | Leave `https://rpc2.monad.xyz`: from AWS, the shared `rpc.monad.xyz` answered most requests with 429 and the other public endpoints lacked old receipts or pinned reads. A provider's URL with your own key is faster still. |
| `SOUL_TREASURY`, `SOUL_START_BLOCK` | Already set to the project treasury and the block credits start from. |
| `CULT_ROSTER_PATH` | Leave empty: the village starts empty and holders bring their awakened Chogs in. |

`.env` stays on the server: never commit it, email it or paste it into a chat.

## 5. Start

**server**

```bash
cd /opt/chog-world/deploy && docker compose up -d --build
```

```bash
docker compose logs -f app
```

The first build takes about 5 minutes. On its first start the app reads every Chog ownership change since
the adapter's activation block (115003560), four requests at a time: about 650 blocks a second on the
public RPC, so roughly 7 minutes plus a minute for each day since 2026-10-20. You'll see
`Ownership projection at block … of …` lines, then `live Cult started`. Until then Caddy answers 502. Later
restarts are fast: the progress is stored. If the RPC times out at startup, Docker restarts the app.

## 6. Check it

- `https://world.example.com/api/health` answers `{"status":"ok",...}`.
- `https://world.example.com/city/` shows the village (empty at first) and **Sign in with wallet**.
- `https://world.example.com/city/?tab=cult` opens Cult inside City's shared interface. Old `/cult/` URLs redirect there.
- Sign in, use **Bring a Chog** with an awakened Chog Genesis token, and it moves into the next free plot
  and joins the Cult. A Chog must be awakened on the adapter (`awaken(tokenId, agentURI)`) first.

## A server that already has a web server

If another site's Caddy or nginx already uses ports 80 and 443, don't start our Caddy; add Chog World to theirs.

1. In `.env`: set `COMPOSE_PROFILES=` (empty), `CULT_TRUSTED_PROXY=172.28.0.1`, and optionally `APP_HOST_PORT`
   (default 8790). The app then listens on `127.0.0.1:8790` only, and trusts the visitor address that the host's
   proxy forwards.
2. Add a site to the existing proxy. For Caddy, append this to `/etc/caddy/Caddyfile` (back the file up first):

   ```
   world.example.com {
       @compressible not path /api/city/events /api/cult/events
       encode @compressible zstd gzip
       reverse_proxy 127.0.0.1:8790 {
           flush_interval -1
       }
   }
   ```

   Then check the whole file before a graceful reload, so the other sites never go down:

   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && sudo systemctl reload caddy
   ```

   With nginx: `proxy_pass http://127.0.0.1:8790;`, `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`
   and `proxy_buffering off;` for `/api/city/events` and `/api/cult/events`.

No domain yet? `chog.<server-ip-with-dashes>.sslip.io` (for example `chog.100-58-20-106.sslip.io`) points at the
server without any DNS setup and gets a real certificate. Switching to your own domain later is a change of
`CULT_DOMAIN` and the proxy's site address, then a restart; holders sign in again.

## Updating

**PC**: `node deploy/bundle.mjs`, then `scp` it as in step 3. **server**: extract it over the same folder
(your `deploy/.env` is kept, since the bundle never contains one), then `docker compose up -d --build`.

## Backups

`deploy/backup.sh` writes a compressed `pg_dump` of the database to `/var/backups/chog-world` (root only), checks
it is complete before keeping it, and keeps the last 14 days. Schedule it daily (**server**; adjust the path to
where the code lives):

```bash
printf '%s\n' 'SHELL=/bin/bash' '30 3 * * * root /usr/bin/bash /opt/chog-world/deploy/backup.sh >> /var/log/chog-world-backup.log 2>&1' | sudo tee /etc/cron.d/chog-world-backup
```

Run one now and read the log line it prints:

```bash
sudo bash /opt/chog-world/deploy/backup.sh
```

**Restore** a backup into the running database. Stop the app first so nothing writes meanwhile; this replaces the
current data:

```bash
cd /opt/chog-world/deploy && docker compose stop app
```

```bash
docker compose exec -T db psql -U chog -d postgres -c "DROP DATABASE chog_world WITH (FORCE)" -c "CREATE DATABASE chog_world"
```

```bash
sudo zcat /var/backups/chog-world/chog-world-<time>.sql.gz | docker compose exec -T db psql -q -v ON_ERROR_STOP=1 -U chog -d chog_world
```

```bash
docker compose start app
```

To test a backup without touching live data, restore it into a scratch database instead (`createdb -U chog
chog_restore_check`, restore into it, compare, `dropdb`), as was done on 2026-10-21.

Backups on the same disk don't survive losing the server. Now and then copy the newest one off it (**PC**; the
folder is root-only, so it is read with sudo on the server):

```bash
ssh -i <key> ubuntu@<server> "sudo sh -c 'cat \$(ls -t /var/backups/chog-world/chog-world-*.sql.gz | head -1)'" > chog-world-backup.sql.gz
```

Or let AWS keep whole-disk snapshots on a schedule (Data Lifecycle Manager for the instance's EBS volume).

## Day to day

- Status: `docker compose ps` (the app reports healthy once it serves).
- Logs: `docker compose logs -f app`, and `docker compose logs caddy` for certificate problems.
- Restart: `docker compose restart app`. Stop everything: `docker compose down` (data stays in its volume).
- What to watch, and what each degraded state means: `cult/RUNBOOK.md`, "Health and what to watch".
