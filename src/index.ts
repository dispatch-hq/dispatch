import { Hono, type Handler } from 'hono';
import * as handlers from './commands';
import { factory } from './init';
import { setAccent } from './lib/ui';
import type { AppEnv } from './types';
import { githubRoutes } from './web/github';

const bot = factory.discord().loader(Object.values(handlers));

/** View Channel, Send Messages, Embed Links, Manage Roles, Create Public Threads. */
const BOT_PERMISSIONS = ((1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 28n) | (1n << 35n)).toString();

const app = new Hono<AppEnv>();

app.use('*', (c, next) => {
  setAccent(c.env.ACCENT_COLOR);
  return next();
});

// The landing page is a static site (see `site/`) served by Workers Assets.
// `/` runs this Worker first only so the POST below keeps working; GETs go
// straight back to the assets.
app.get('/', (c) => c.env.ASSETS.fetch(c.req.raw));

// The site's "Add to Discord" buttons point here so the invite always uses
// this environment's Discord application.
app.get('/invite', (c) => {
  const invite = new URL('https://discord.com/oauth2/authorize');
  invite.searchParams.set('client_id', c.env.DISCORD_APPLICATION_ID);
  invite.searchParams.set('scope', 'bot applications.commands');
  invite.searchParams.set('permissions', BOT_PERMISSIONS);
  return c.redirect(invite.toString());
});

// Discord interactions. `/` is kept for endpoints configured before v2.
const interactions: Handler<AppEnv> = (c) => bot.fetch(c.req.raw, c.env, c.executionCtx);
app.post('/', interactions);
app.post('/interactions', interactions);

app.route('/github', githubRoutes);

// Rehosted report attachments (see services/attachments.ts).
app.get('/files/:key{reports/.+}', async (c) => {
  const object = await c.env.FILES.get(c.req.param('key'));
  if (!object) return c.notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-security-policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
  return new Response(object.body, { headers });
});

export default app;
