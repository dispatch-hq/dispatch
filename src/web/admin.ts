import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getAdminServer, getAdminServerActivity, listAdminServers } from '../db';
import { safeEqual, signToken, verifyToken } from '../lib/crypto';
import {
  createServerInvite,
  getServerChannels,
  getWidgetInvite,
  parseDetails,
  refreshServer,
  syncServerList,
} from '../services/admin-servers';
import type { AppEnv } from '../types';
import { serverDetailPage, serverListPage } from './admin-pages';
import { renderPage } from './pages';

/**
 * The private server list. Only ADMIN_DISCORD_ID gets in, and everyone else
 * gets the site's normal 404, so nothing here shows that the pages exist.
 * Start at /admin/login. These aren't interactions, so the 3 second rule doesn't apply.
 */

const DISCORD_API = 'https://discord.com/api/v10';
const STATE_COOKIE = 'admin_state';
const SESSION_COOKIE = 'admin_session';
const STATE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 12 * 60 * 60;
/** Opening a server re-reads it from Discord unless that just happened. */
const DETAILS_TTL_MS = 5 * 60 * 1000;
const SERVER_ID = /^\d{17,20}$/;

/** The kind stops other tokens signed with STATE_SECRET from being accepted here. */
type AdminToken = { k: 'admin_state' | 'admin_session'; u?: string };

const cookieOptions = (maxAge: number) =>
  ({ path: '/admin', httpOnly: true, secure: true, sameSite: 'Lax', maxAge }) as const;

/** The same response as any other path that isn't part of the site. */
const hidden = (c: Context<AppEnv>) => c.env.ASSETS.fetch(c.req.raw);

const redirectUri = (c: Context<AppEnv>) => `${c.env.PUBLIC_URL}/admin/callback`;

const isAdmin = (c: Context<AppEnv>, userId: string | undefined) =>
  !!c.env.ADMIN_DISCORD_ID && !!userId && safeEqual(userId, c.env.ADMIN_DISCORD_ID);

const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await verifyToken<AdminToken>(c.env.STATE_SECRET, getCookie(c, SESSION_COOKIE));
  if (session?.k !== 'admin_session' || !isAdmin(c, session.u)) return hidden(c);
  c.header('cache-control', 'no-store');
  c.header('x-robots-tag', 'noindex');
  await next();
};

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.get('/login', async (c) => {
  if (!c.env.ADMIN_DISCORD_ID || !c.env.DISCORD_CLIENT_SECRET) return hidden(c);

  const state = await signToken<AdminToken>(c.env.STATE_SECRET, { k: 'admin_state' }, STATE_TTL_SECONDS);
  setCookie(c, STATE_COOKIE, state, cookieOptions(STATE_TTL_SECONDS));

  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', c.env.DISCORD_APPLICATION_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('redirect_uri', redirectUri(c));
  url.searchParams.set('state', state);
  return c.redirect(url.toString());
});

async function signedInUser(c: Context<AppEnv>, code: string): Promise<string | null> {
  const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.env.DISCORD_APPLICATION_ID,
      client_secret: c.env.DISCORD_CLIENT_SECRET ?? '',
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(c),
    }),
  });
  if (!tokenRes.ok) {
    console.warn(`admin: exchanging the sign-in code failed (${tokenRes.status})`);
    return null;
  }
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };

  const userRes = await fetch(`${DISCORD_API}/users/@me`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!userRes.ok) {
    console.warn(`admin: reading the signed-in user failed (${userRes.status})`);
    return null;
  }
  return ((await userRes.json()) as { id: string }).id;
}

adminRoutes.get('/callback', async (c) => {
  const { code, state } = c.req.query();
  const expected = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: '/admin', secure: true });

  const claims = await verifyToken<AdminToken>(c.env.STATE_SECRET, state);
  if (!code || !state || !expected || !safeEqual(state, expected) || claims?.k !== 'admin_state') return hidden(c);

  const userId = await signedInUser(c, code);
  if (!userId || !isAdmin(c, userId)) return hidden(c);

  const session = await signToken<AdminToken>(c.env.STATE_SECRET, { k: 'admin_session', u: userId }, SESSION_TTL_SECONDS);
  setCookie(c, SESSION_COOKIE, session, cookieOptions(SESSION_TTL_SECONDS));
  return c.redirect('/admin/servers');
});

adminRoutes.use('/servers', requireAdmin);
adminRoutes.use('/servers/*', requireAdmin);

adminRoutes.get('/servers', async (c) => {
  // If Discord can't be read, the page still shows what was last stored.
  const list = await syncServerList(c.env).catch((error) => {
    console.error('admin: syncing the server list failed', error);
    return 'down' as const;
  });
  const servers = await listAdminServers(c.env.DB);
  const stale = list === 'limited' || list === 'down';
  return c.html(await renderPage(c.env, c.req.url, serverListPage(servers, stale)));
});

adminRoutes.get('/servers/:id', async (c) => {
  const guildId = c.req.param('id');
  if (!SERVER_ID.test(guildId)) return hidden(c);

  const known = await getAdminServer(c.env.DB, guildId);
  if (!known) return hidden(c);

  const present = known.left_at === null;
  if (present && Date.now() - (known.refreshed_at ?? 0) > DETAILS_TTL_MS) await refreshServer(c.env, guildId);
  const row = (await getAdminServer(c.env.DB, guildId)) ?? known;

  const details = parseDetails(row);
  const [channels, widgetInvite, activity] = await Promise.all([
    present ? getServerChannels(c.env, guildId) : null,
    present && details?.widget_enabled ? getWidgetInvite(c.env, guildId) : null,
    getAdminServerActivity(c.env.DB, guildId),
  ]);
  return c.html(await renderPage(c.env, c.req.url, serverDetailPage({ row, details, channels, widgetInvite, activity })));
});

adminRoutes.post('/servers/:id/invite', async (c) => {
  const guildId = c.req.param('id');
  if (!SERVER_ID.test(guildId)) return hidden(c);
  // A signed-in browser shouldn't create invites because another site asked it to.
  if (c.req.header('origin') !== new URL(c.req.url).origin) return c.json({ error: 'failed' }, 403);

  const result = await createServerInvite(c.env, guildId).catch((error) => {
    console.error('admin: creating an invite failed', error);
    return { error: 'failed' } as const;
  });
  return c.json(result, 'url' in result ? 200 : 409);
});

adminRoutes.all('*', hidden);
