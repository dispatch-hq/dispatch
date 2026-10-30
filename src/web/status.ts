import { Hono } from 'hono';
import type { AppEnv, Bindings } from '../types';

/**
 * Public endpoints behind the site's /status page. Neither is an interaction,
 * so the 3 second rule doesn't apply; they still stay cheap, because anyone can call them.
 */

const DISCORD_API = 'https://discord.com/api/v10';
const GUILDS_PER_PAGE = 200;
/** Stops a runaway loop; 50 pages is 10,000 servers. */
const MAX_PAGES = 50;
const COUNTS_TTL_MS = 10 * 60 * 1000;

export type Check = { ok: boolean; ms: number | null };

export type Status = {
  ok: boolean;
  /** Edge location (IATA code) that answered this request, when Cloudflare reports one. */
  colo: string | null;
  checks: { database: Check; discord: Check };
  /** Servers the bot is in. Null when Discord couldn't be reached. */
  servers: number | null;
  /** Members across those servers. A person in several servers is counted once per server. */
  members: number | null;
  /** When `servers` and `members` were read from Discord. */
  countsAt: string | null;
};

type Counts = { servers: number; members: number; ms: number; at: number };

// Counts come from a paginated Discord call, so they're kept per isolate for a
// few minutes. A stale value beats an empty page when Discord is having a bad day.
let cached: Counts | null = null;

const colo = (request: Request) => (request.cf as { colo?: string } | undefined)?.colo ?? null;

async function readCounts(env: Bindings): Promise<Counts | null> {
  const started = Date.now();
  let servers = 0;
  let members = 0;
  let after = '';

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${DISCORD_API}/users/@me/guilds?with_counts=true&limit=${GUILDS_PER_PAGE}${after && `&after=${after}`}`;
    const res = await fetch(url, { headers: { authorization: `Bot ${env.DISCORD_TOKEN}` } });
    if (!res.ok) return null;

    const guilds = (await res.json()) as { id: string; approximate_member_count?: number }[];
    servers += guilds.length;
    for (const guild of guilds) members += guild.approximate_member_count ?? 0;
    if (guilds.length < GUILDS_PER_PAGE) break;
    after = guilds[guilds.length - 1]!.id;
  }

  return { servers, members, ms: Date.now() - started, at: Date.now() };
}

async function checkDatabase(db: D1Database): Promise<Check> {
  const started = Date.now();
  try {
    await db.prepare('SELECT 1').first();
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    console.error('status: database check failed', error);
    return { ok: false, ms: null };
  }
}

export async function getStatus(env: Bindings, request: Request): Promise<Status> {
  const database = checkDatabase(env.DB);

  let discord: Check;
  if (cached && Date.now() - cached.at < COUNTS_TTL_MS) {
    discord = { ok: true, ms: cached.ms };
  } else {
    const fresh = await readCounts(env).catch((error) => {
      console.error('status: reading server counts failed', error);
      return null;
    });
    if (fresh) cached = fresh;
    discord = { ok: fresh !== null, ms: fresh?.ms ?? null };
  }

  const db = await database;
  return {
    ok: db.ok && discord.ok,
    colo: colo(request),
    checks: { database: db, discord },
    servers: cached?.servers ?? null,
    members: cached?.members ?? null,
    countsAt: cached ? new Date(cached.at).toISOString() : null,
  };
}

/** Test hook: forget the cached counts. */
export function resetStatusCache() {
  cached = null;
}

const noStore = { 'cache-control': 'no-store' };

export const statusRoutes = new Hono<AppEnv>();

// What the page's "live ping" measures: a round trip to the nearest edge, with no
// database or Discord call, so it shows the network and the Worker rather than a dependency.
statusRoutes.get('/ping', (c) => c.json({ ok: true, colo: colo(c.req.raw) }, 200, noStore));

statusRoutes.get('/status', async (c) => {
  const status = await getStatus(c.env, c.req.raw);
  return c.json(status, status.ok ? 200 : 503, noStore);
});
