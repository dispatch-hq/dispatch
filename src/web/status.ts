import { Hono } from 'hono';
import { claimStatusRefresh, getStatusCounts, saveStatusCounts, setStatusDiscordOk } from '../db';
import type { AppEnv, Bindings, StatusCountsRow } from '../types';

/**
 * Public endpoints behind the site's /status page. Neither is an interaction,
 * so the 3 second rule doesn't apply; they still stay cheap, because anyone can call them.
 */

const DISCORD_API = 'https://discord.com/api/v10';
const GUILDS_PER_PAGE = 200;
/** Stops a runaway loop; 45 pages is 9,000 servers, and leaves room for D1 in the free plan's 50 subrequests. */
const MAX_PAGES = 45;
const COUNTS_TTL_MS = 10 * 60 * 1000;
/** How long one isolate holds the refresh, which is also how often a failed read is retried. */
const REFRESH_CLAIM_MS = 60 * 1000;

export type Check = { ok: boolean; ms: number | null };

export type Status = {
  ok: boolean;
  /** Edge location (IATA code) that answered this request, when Cloudflare reports one. */
  colo: string | null;
  checks: { database: Check; discord: Check };
  /** Servers the bot is in. Null until Discord has been read successfully. */
  servers: number | null;
  /** Members across those servers. A person in several servers is counted once per server. */
  members: number | null;
  /** When `servers` and `members` were read from Discord. */
  countsAt: string | null;
};

type Counts = { servers: number; members: number; ms: number; at: number };
type Known = Pick<StatusCountsRow, 'servers' | 'members' | 'read_at'>;

const colo = (request: Request) => (request.cf as { colo?: string } | undefined)?.colo ?? null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A 429 still means Discord answered, so it's `limited` rather than `down`. */
async function readCounts(env: Bindings): Promise<Counts | 'limited' | 'down'> {
  const started = Date.now();
  let servers = 0;
  let members = 0;
  let after = '';

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${DISCORD_API}/users/@me/guilds?with_counts=true&limit=${GUILDS_PER_PAGE}${after && `&after=${after}`}`;
    const res = await fetch(url, { headers: { authorization: `Bot ${env.DISCORD_TOKEN}` } });
    if (!res.ok) {
      console.warn(`status: reading server counts failed (${res.status})`);
      return res.status === 429 ? 'limited' : 'down';
    }

    const guilds = (await res.json()) as { id: string; approximate_member_count?: number }[];
    servers += guilds.length;
    for (const guild of guilds) members += guild.approximate_member_count ?? 0;
    if (guilds.length < GUILDS_PER_PAGE) break;
    after = guilds[guilds.length - 1]!.id;

    if (res.headers.get('x-ratelimit-remaining') === '0') {
      await sleep(Number(res.headers.get('x-ratelimit-reset-after') ?? 1) * 1000);
    }
  }

  return { servers, members, ms: Date.now() - started, at: Date.now() };
}

/** Failing to record a result only means the next attempt repeats the work. */
const logFailure = (error: unknown) => console.error('status: saving server counts failed', error);

async function checkDiscord(
  env: Bindings,
  row: StatusCountsRow | null,
  databaseOk: boolean
): Promise<{ discord: Check; known: Known | null }> {
  const now = Date.now();
  const fresh = row?.discord_ok === 1 && row.read_at !== null && now - row.read_at < COUNTS_TTL_MS;
  if (fresh) return { discord: { ok: true, ms: row.ms }, known: row };

  // Without D1 there's nothing to coordinate through, so read Discord directly.
  const refresh = databaseOk
    ? await claimStatusRefresh(env.DB, now, now - REFRESH_CLAIM_MS).catch((error) => {
        logFailure(error);
        return true;
      })
    : true;
  if (!refresh) return { discord: { ok: row?.discord_ok !== 0, ms: row?.ms ?? null }, known: row };

  const reading = await readCounts(env).catch((error) => {
    console.error('status: reading server counts failed', error);
    return 'down' as const;
  });

  if (reading === 'limited' || reading === 'down') {
    const ok = reading === 'limited';
    await setStatusDiscordOk(env.DB, ok).catch(logFailure);
    return { discord: { ok, ms: ok ? (row?.ms ?? null) : null }, known: row };
  }

  await saveStatusCounts(env.DB, reading).catch(logFailure);
  return {
    discord: { ok: true, ms: reading.ms },
    known: { servers: reading.servers, members: reading.members, read_at: reading.at },
  };
}

export async function getStatus(env: Bindings, request: Request): Promise<Status> {
  const started = Date.now();
  let database: Check;
  let row: StatusCountsRow | null = null;
  try {
    row = await getStatusCounts(env.DB);
    database = { ok: true, ms: Date.now() - started };
  } catch (error) {
    console.error('status: database check failed', error);
    database = { ok: false, ms: null };
  }

  const { discord, known } = await checkDiscord(env, row, database.ok);

  return {
    ok: database.ok && discord.ok,
    colo: colo(request),
    checks: { database, discord },
    servers: known?.servers ?? null,
    members: known?.members ?? null,
    countsAt: known?.read_at ? new Date(known.read_at).toISOString() : null,
  };
}

const noStore = { 'cache-control': 'no-store' };

export const statusRoutes = new Hono<AppEnv>();

statusRoutes.get('/status', async (c) => {
  const status = await getStatus(c.env, c.req.raw);
  return c.json(status, status.ok ? 200 : 503, noStore);
});
