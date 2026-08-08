# Self-host on a VPS (Docker + Caddy/nginx TLS)

Full control on your own VM (a $5 droplet is plenty). The backend container is internal-only; a
reverse proxy terminates TLS and forwards to it.

**Prereqs:** a Linux VM with Docker + Compose, a domain, and DNS for `api.yourapp.com` pointed at the
VM's public IP.

## Steps
```bash
# on the VM, in the server dir (with Dockerfile + docker-compose.yml + Caddyfile)
cp .env.example .env          # then edit: ALLOWED_ORIGINS, API_TOKEN, ...
chmod 600 .env
edit Caddyfile                # set your real domain
docker compose up -d --build
docker compose logs -f caddy   # watch the cert get issued
curl https://api.yourapp.com/health   # -> {"ok":true}
```
Caddy gets a Let's Encrypt cert automatically and renews it; certs persist in the `caddy_data`
volume. Prefer nginx? Use `nginx.conf.example` + `certbot --nginx -d api.yourapp.com` instead of the
`caddy` service.

## Firewall
Expose only 80 + 443 (+ your SSH port); the app port (8787) stays internal to the Docker network and
is never published to the host:
```bash
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw enable
```
The compose file deliberately has **no `ports:` on the backend** — only Caddy is internet-facing.

## Secrets
Keep them in `.env` (loaded via `env_file`), `chmod 600`, and **git-ignored** — never commit it and
never bake secrets into the image. For more isolation use Docker secrets or a host secret store. Don't
log secret values. Rotate `API_TOKEN` by editing `.env` and `docker compose up -d` (recreates the
container with the new env).

---
## Final step — flip the app's API base URL
With `https://api.yourapp.com/health` green, set that as the **prod** value of the single `API_BASE`
constant in `NuiBackend.{kt,swift}` (see `../README.md`). Prod is HTTPS — keep any dev cleartext/ATS
opt-in out of the release build.
