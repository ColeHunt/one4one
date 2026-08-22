# Deploying one4one on a DigitalOcean Droplet

The whole app is one Node process plus a SQLite file. A 1 GB Droplet is plenty.

Two paths below: **systemd** (no Docker, fewest moving parts) and **Docker
Compose**. Both put nginx in front for TLS.

---

## Path A — systemd

### 1. Install Node 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx git
```

### 2. Put the code on the box

```bash
sudo useradd --system --home /srv/one4one --shell /usr/sbin/nologin one4one
sudo mkdir -p /srv/one4one /var/lib/one4one
sudo chown -R one4one:one4one /srv/one4one /var/lib/one4one

sudo -u one4one git clone https://github.com/colehunt/one4one.git /srv/one4one
cd /srv/one4one
sudo -u one4one npm ci
sudo -u one4one npm run build
sudo -u one4one npm prune --omit=dev
```

`npm run build` produces `web/dist` (the client) and `server/dist` (the
compiled server). In production the Node server serves the client itself, so
there is only one origin and one port.

### 3. Start the service

```bash
sudo cp deploy/one4one.service /etc/systemd/system/one4one.service
sudo systemctl daemon-reload
sudo systemctl enable --now one4one
sudo systemctl status one4one
curl localhost:8080/api/health   # -> {"ok":true}
```

### 4. Put nginx in front

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/one4one
sudo sed -i 's/drinks.example.com/YOUR.DOMAIN/' /etc/nginx/sites-available/one4one
sudo ln -s /etc/nginx/sites-available/one4one /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**The `/ws` block matters.** Without `Upgrade` and `Connection` headers the
WebSocket handshake fails, and the app degrades quietly: it loads, drinks log,
but nobody's screen ever updates. If sync looks dead in production, check that
block first.

### 5. TLS

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR.DOMAIN
```

Worth doing even for a party app: browsers only expose `navigator.share` and
the clipboard on a secure origin, so the Share button needs HTTPS.

### 6. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Port 8080 stays closed — nginx reaches it over localhost.

### Updating

```bash
cd /srv/one4one
sudo -u one4one git pull
sudo -u one4one npm ci
sudo -u one4one npm run build
sudo -u one4one npm prune --omit=dev
sudo systemctl restart one4one
```

A restart drops open WebSockets; clients reconnect on their own within a few
seconds and anything logged in the meantime is queued and flushed.

---

## Path B — Docker Compose

```bash
git clone https://github.com/colehunt/one4one.git /srv/one4one
cd /srv/one4one
docker compose up -d --build
```

The compose file binds to `127.0.0.1:8080`, so steps 4–6 above still apply.
Data lives in the `one4one-data` volume.

---

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8080` | Port the Node process listens on |
| `DATA_DIR` | `./data` | Directory holding `one4one.sqlite` |
| `ROOM_TTL_HOURS` | `48` | Rooms idle this long are purged hourly |
| `NODE_ENV` | — | Set to `production` on the server |

## Backups

Everything is in one SQLite file. It is in WAL mode, so copy it with the
`.backup` command rather than `cp`:

```bash
sudo -u one4one sqlite3 /var/lib/one4one/one4one.sqlite ".backup '/tmp/one4one-$(date +%F).sqlite'"
```

Rooms are ephemeral by design, so there may be nothing worth keeping.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Page loads, counts never update on other phones | nginx `/ws` block missing the `Upgrade`/`Connection` headers |
| "Connecting…" forever | Server not running, or the firewall is blocking nginx → 8080 |
| Share button does nothing | Not on HTTPS — `navigator.share` and the clipboard need a secure origin |
| `SQLITE_CANTOPEN` at boot | `DATA_DIR` not writable by the service user |
| Drinks vanish after a couple of days | Working as intended — see `ROOM_TTL_HOURS` |

Logs: `sudo journalctl -u one4one -f` (or `docker compose logs -f`).
