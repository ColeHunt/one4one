# Deploying one4one on a DigitalOcean Droplet

The whole app is one Node process plus a SQLite file. A 1 GB Droplet is plenty.

Two paths below: **systemd** (no Docker, fewest moving parts, hand-edited
nginx config) and **Docker Compose** (recommended — the app and a reverse
proxy with a web UI for TLS both run as containers, and `git pull` +
`docker compose up -d --build` is the entire update procedure).

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

## Path B — Docker Compose + Nginx Proxy Manager (recommended)

Everything needed to run one4one lives in this repo: the app's `Dockerfile`,
`docker-compose.yml` (which also runs the reverse proxy), and this doc. Clone
it once onto the droplet and every future deploy is just `git pull` +
`docker compose up -d --build` — either by hand or via the GitHub Actions
workflow below.

`docker-compose.yml` runs two containers:

- **`one4one`** — the app, built from this repo's `Dockerfile`. No host port
  is published; `rev-proxy` reaches it over the compose network by service
  name (`one4one:8080`).
- **`rev-proxy`** — [Nginx Proxy Manager](https://nginxproxymanager.com/), a
  reverse proxy with its own web UI for managing domains and Let's Encrypt
  certs, instead of a hand-edited nginx config. Its admin UI (port 81) is
  bound to the droplet's loopback only, so it's reached through an SSH
  tunnel, never the public internet.

### 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
```

### 2. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Port 8080 stays closed — only `rev-proxy` (80/443) is reachable from outside.

### 3. Point DNS at the droplet

Add an **A record** for the domain you're using (e.g. `drinks.example.com`)
pointing at the droplet's IP, before requesting a cert in step 5 or issuance
will fail.

### 4. Clone and start

```bash
sudo mkdir -p /opt/one4one && cd /opt/one4one
sudo git clone git@github.com:<you>/one4one.git .
docker compose up -d --build
```

Data lives in the `one4one-data` volume (SQLite) and `rev-proxy-config` /
`rev-proxy-le` volumes (NPM's config and certs) — all managed by Compose, not
bind-mounted, so they survive `git pull` + rebuild.

### 5. Configure the proxy + TLS

```bash
ssh -L 81:localhost:81 root@<droplet-ip>
# then browse to http://localhost:81 on your own machine
```

First run prompts you to replace NPM's default admin login. Then **Add Proxy
Host**: domain name, forward to `one4one` port `8080` (Compose's internal DNS
resolves the container name), enable **Websockets Support** (the `/ws`
endpoint needs this — without it the app loads but nobody's screen ever
updates), and request a Let's Encrypt cert from the same dialog.

### Updating

```bash
cd /opt/one4one
git pull origin master
docker compose build one4one
docker compose up -d
```

Or push to `master` and let the GitHub Actions workflow below do it.

---

## Auto-deploy on push (GitHub Actions)

`.github/workflows/deploy.yml` SSHs into the droplet and runs the update
steps above on every push to `master`. It needs one dedicated SSH keypair and
three repo secrets.

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f /tmp/deploy_key -N ""

# Let the droplet SSH into itself: add the public key to its own authorized_keys
ssh root@<droplet-ip> "cat >> ~/.ssh/authorized_keys" < /tmp/deploy_key.pub
```

In the repo's **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | The droplet's IP |
| `DEPLOY_USER` | `root` |
| `DEPLOY_SSH_KEY` | Contents of `/tmp/deploy_key` (the private half) |

Then delete the local copies of both key files.

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
`.backup` command rather than `cp`.

systemd (Path A):

```bash
sudo -u one4one sqlite3 /var/lib/one4one/one4one.sqlite ".backup '/tmp/one4one-$(date +%F).sqlite'"
```

Docker (Path B) — the database lives inside the `one4one-data` volume:

```bash
docker compose exec one4one sqlite3 /data/one4one.sqlite ".backup '/data/backup-$(date +%F).sqlite'"
docker cp one4one:/data/backup-$(date +%F).sqlite .
```

Rooms are ephemeral by design, so there may be nothing worth keeping.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Page loads, counts never update on other phones | Reverse proxy not forwarding the WebSocket upgrade — nginx: `/ws` block missing `Upgrade`/`Connection` headers; NPM: "Websockets Support" not enabled on the proxy host |
| "Connecting…" forever | App container/service not running, or the firewall is blocking the proxy → app |
| Share button does nothing | Not on HTTPS — `navigator.share` and the clipboard need a secure origin |
| `SQLITE_CANTOPEN` at boot | `DATA_DIR` not writable by the service user, or the volume isn't mounted |
| Drinks vanish after a couple of days | Working as intended — see `ROOM_TTL_HOURS` |
| Let's Encrypt request fails in NPM | DNS A record isn't pointing at the droplet yet, or hasn't propagated |

Logs: `sudo journalctl -u one4one -f` (Path A) or `docker compose logs -f one4one` (Path B).
