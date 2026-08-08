# Deploy the Node/Hono stack as serverless (Vercel or Netlify)

Serverless suits a **stateless, short-request** Hono API (the `CALL_API`/`CALL_DATABASE` endpoint
shape). Each request runs a function; there's no long-lived process.

## Why this needs the Hono stack (and an app/server split)
Hono runs on Web-standard `Request`/`Response`, so its adapters map cleanly onto Vercel/Netlify
functions. To deploy serverless **and** keep a runnable local server, the Node scaffold must export
the Hono `app` separately from the `serve()` call:
```js
// server/node/src/app.js  — the routes (no listen)
import { Hono } from 'hono';
import { cors } from 'hono/cors';
const app = new Hono();
app.use('*', cors({ origin: (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean) }));
app.get('/health', (c) => c.json({ ok: true }));
app.post('/api/:target', async (c) => { /* route by c.req.param('target') */ });
export default app;
```
```js
// server/node/src/index.js  — local + container entry (imported by Docker recipes)
import { serve } from '@hono/node-server';
import app from './app.js';
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787) });
```
The entries in this dir (`api/index.js`, `netlify/functions/server.js`) import that same `app`.

## Vercel
```bash
npm i -g vercel
vercel            # first run links/creates the project; uses vercel.json here
vercel env add API_TOKEN production        # secrets, per-environment
vercel env add ALLOWED_ORIGINS production
vercel --prod     # -> https://<project>.vercel.app
curl https://<project>.vercel.app/health   # -> {"ok":true}
```
Add a custom domain under the project's **Domains** (DNS to Vercel).

## Netlify
```bash
npm i -g netlify-cli
netlify init                # link/create the site; uses netlify.toml here
netlify env:set API_TOKEN super-secret
netlify env:set ALLOWED_ORIGINS https://yourapp.com
netlify deploy --prod       # -> https://<site>.netlify.app
curl https://<site>.netlify.app/health
```

## Caveat — what does NOT fit serverless
- **Python/FastAPI** — these adapters are Node-only. Deploy the Python stack on a container target
  (`../cloud-run/` or `../fly-railway-render/`) instead.
- **Long-running / stateful work** — functions are short-lived and time-limited (typically ~10–60s),
  cold-start, and don't hold in-memory state, sockets, background jobs, or streaming connections.
  Anything long-running or stateful belongs on a container target.

---
## Final step — flip the app's API base URL
With the serverless HTTPS URL live and `/health` green, set it as the **prod** value of the single
`API_BASE` constant in `NuiBackend.{kt,swift}` (see `../README.md`). Prod is HTTPS — no dev
cleartext/ATS opt-in in the release build.
