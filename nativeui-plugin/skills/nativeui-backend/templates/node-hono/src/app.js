// NativeUI app backend — Node + Hono (plain ESM, no build step).
// Your exported app's NuiBackend.{kt,swift} calls THIS server. The on-device contract
// turns an authored CALL_API interaction into onCallApi(target, params): `target` names
// the endpoint, `params` is a flat string map. Mirror that here: one route per target,
// params arriving as a JSON body, JSON back. Add real routes in the marked region below.
//
// This file DEFINES and EXPORTS the Hono `app` (no server.listen) so it is reused by both
// the local/container entry (index.js, runs serve()) and the serverless adapters
// (deploy/vercel-netlify, which import this `app`). Start it locally via index.js.

import { Hono } from 'hono';
import { cors } from 'hono/cors';

// Comma-separated allowlist of app origins; "*" in dev. Devices/simulators send no Origin
// header on native fetch, so CORS only matters for browser-based callers and your own tools.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Secrets come from the environment, never the source tree (see .env.example). Keep third-party
// keys HERE on the server so the shipped, decompilable app never holds them.
const API_KEY = process.env.API_KEY ?? '';

const app = new Hono();

app.use(
  '*',
  cors({
    origin: ALLOWED_ORIGINS.includes('*') ? '*' : ALLOWED_ORIGINS,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

// Liveness probe — Cloud Run / Fly / Render hit this; keep it dependency-free.
app.get('/health', (c) => c.json({ ok: true, service: 'nui-backend', ts: Date.now() }));

// === app endpoints (fill from nui-backend-plan) ===
// Each authored CALL_API target becomes one route below. Shape: read the flat `params`
// map your NuiBackend sent, do the work (DB, third-party API with API_KEY, etc.), return
// JSON your NuiBackend parses back into the typed controls. Example for a target "login":
//
//   NuiBackend (iOS):     onCallApi("login", ["email": ..., "password": ...])  -> POST /api/login
//   NuiBackend (Android): onCallApi("login", mapOf("email" to ..., "password" to ...))
app.post('/api/login', async (c) => {
  const params = await c.req.json().catch(() => ({}));
  const email = (params.email ?? '').trim();
  const password = params.password ?? '';
  if (!email || !password) {
    return c.json({ error: 'email and password are required' }, 400);
  }
  // Fail closed until this route is connected to a real auth provider.
  // `API_KEY` is available here for any third-party call; it never leaves the server.
  return c.json({ error: 'login auth is not implemented in this scaffold' }, 501);
});
// === end app endpoints ===

export default app;

// Swap to Express: `import express from 'express'`, `app.use(cors())` (the `cors` pkg),
// the same routes, then `app.listen(PORT)` in index.js — same env, same request/response shapes.
