// Vercel serverless entry — wraps the shared Hono app (no own server.listen).
// `app` is the Hono instance exported by the Node/Hono server scaffold (../server/node/src/app.js).
// On Vercel, Hono's Node handler turns the app into a (req, res) function automatically.
import { handle } from 'hono/vercel';
import app from '../server/node/src/app.js';

export const config = { runtime: 'nodejs' };
export default handle(app);
