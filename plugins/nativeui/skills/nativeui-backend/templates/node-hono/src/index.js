// Local / container entrypoint — starts the Hono app from app.js on a real HTTP server.
// Serverless targets (deploy/vercel-netlify) import `app` from app.js directly and never run this file.
// The Docker recipes (deploy/cloud-run, deploy/docker-vps) run exactly this: `node src/index.js`.

import { serve } from '@hono/node-server';
import app from './app.js';

const PORT = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
  console.log(`nui-backend listening on http://localhost:${port}`);
});
