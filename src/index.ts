import { Hono, type Handler } from 'hono';
import { verifyCard } from './cards';
import * as handlers from './commands';
import { factory } from './init';
import type { AppEnv } from './types';
import { githubRoutes } from './web/github';
import { statusRoutes } from './web/status';

const bot = factory.discord().loader(Object.values(handlers));

/** View Channel, Send Messages, Embed Links, Manage Roles, Create Public Threads. */
const BOT_PERMISSIONS = ((1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 28n) | (1n << 35n)).toString();

const app = new Hono<AppEnv>();

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

// Live numbers for the site's /status page.
app.route('/api', statusRoutes);

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

// Message images (see cards/index.ts). The URL is the data, so a response never
// goes stale and can be cached for good.
app.get('/cards/:file{.+\\.png}', async (c) => {
  const data = await verifyCard(c.env, c.req.param('file').slice(0, -'.png'.length));
  if (!data) return c.notFound();

  const cache = (caches as unknown as { default: Cache }).default;
  // Keyed without the query string, so adding one can't force a fresh render.
  const url = new URL(c.req.url);
  url.search = '';
  const key = url.toString();
  const cached = await cache.match(key);
  if (cached) return cached;

  // Loaded here so the renderer's WebAssembly only starts up in isolates that draw.
  const { renderCardPng } = await import('./cards/runtime');
  const response = new Response(await renderCardPng(data), {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
  c.executionCtx.waitUntil(cache.put(key, response.clone()));
  return response;
});

export default app;
