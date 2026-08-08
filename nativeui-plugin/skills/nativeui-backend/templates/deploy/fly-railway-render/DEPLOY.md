# Deploy to Fly.io, Railway, or Render

Three container hosts that deploy the same `Dockerfile` (reuse `../cloud-run/Dockerfile` — copy it
beside this file). All three give you an HTTPS URL. Pick one.

## Fly.io (config-driven, scale-to-zero)
```bash
# one-time
curl -L https://fly.io/install.sh | sh   # if not installed
fly auth login

# first deploy — generates/uses fly.toml in this dir (keep the one here; don't let it overwrite ports)
fly launch --no-deploy            # answer prompts; reuses the provided fly.toml

# secrets (encrypted, injected as env at runtime — never in the image)
fly secrets set API_TOKEN=super-secret ALLOWED_ORIGINS=https://yourapp.com

fly deploy
fly open                          # prints https://nui-backend.fly.dev
curl https://nui-backend.fly.dev/health   # -> {"ok":true}
```
Custom domain: `fly certs add api.yourapp.com`, then add the printed DNS records.

## Railway (repo or Dockerfile, near-zero config)
1. `npm i -g @railway/cli && railway login` (or use the web dashboard).
2. From the server dir: `railway init` then `railway up` — Railway detects the `Dockerfile` (or
   Nixpacks-builds a plain Node/Python app with no Dockerfile).
3. Set vars: `railway variables set API_TOKEN=… ALLOWED_ORIGINS=https://yourapp.com`. Railway injects
   `PORT` automatically — the server already reads it.
4. `railway domain` generates `https://<name>.up.railway.app`; add a custom domain in the dashboard.
   Verify `…/health`.

## Render (repo-driven Web Service)
1. Push the server to a Git repo, then in the Render dashboard: **New → Web Service** → connect the repo.
2. Render auto-detects the `Dockerfile`. If none, set Build = `npm ci && npm run build --if-present`,
   Start = `node src/index.js`. Render injects `PORT` (default 10000) — the server reads it.
3. Add env vars / secrets in **Environment**; mark secret values as **Secret**. Health check path:
   `/health`. Free instances cold-start; a paid instance stays warm.
4. URL is `https://<name>.onrender.com`; add a custom domain under **Settings → Custom Domains**.

**Python (FastAPI):** all three work — Fly/Render/Railway build the Python `Dockerfile` variant (see
`../cloud-run/Dockerfile`), or Railway/Render's native Python detection runs
`uvicorn main:app --host 0.0.0.0 --port $PORT`.

---
## Final step — flip the app's API base URL
With the host's HTTPS URL live and `/health` green, set it as the **prod** value of the single
`API_BASE` constant in `NuiBackend.{kt,swift}` (see `../README.md`). Prod is HTTPS — drop any dev
cleartext/ATS opt-in from the release build.
