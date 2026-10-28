import { Hono, type Handler } from 'hono';
import * as handlers from './commands';
import { factory } from './init';
import type { AppEnv } from './types';
import { githubRoutes } from './web/github';
import { landingPage } from './web/pages';

const bot = factory.discord().loader(Object.values(handlers));

/** View Channel, Send Messages, Embed Links, Manage Roles. */
const BOT_PERMISSIONS = ((1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 28n)).toString();

const app = new Hono<AppEnv>();

app.get('/', (c) => {
  const invite = new URL('https://discord.com/oauth2/authorize');
  invite.searchParams.set('client_id', c.env.DISCORD_APPLICATION_ID);
  invite.searchParams.set('scope', 'bot applications.commands');
  invite.searchParams.set('permissions', BOT_PERMISSIONS);
  return c.html(landingPage(invite.toString()));
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
