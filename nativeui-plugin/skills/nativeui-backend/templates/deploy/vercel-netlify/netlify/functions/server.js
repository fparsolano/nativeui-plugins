// Netlify Functions entry — wraps the same shared Hono app.
import { handle } from 'hono/netlify';
import app from '../../server/node/src/app.js';

export default handle(app);
