import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { signToken } from '../src/lib/crypto';
import { sendChannelMessage, sendDirectMessage, setMemberRole } from '../src/services/discord';
import { canCreateInvites, healthOf, missingPermissions } from '../src/services/insights';
import type { AdminServerSummary } from '../src/types';
import { createWorld, IDS, type World } from './support/harness';

let w: World;

const ADMIN = '900000000000000009';
const OTHER = '210000000000000021';
const ALL_PERMISSIONS = String((1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 28n) | (1n << 35n));
const DAY = 24 * 60 * 60 * 1000;

const signedIn = async (path: string) => {
  const token = await signToken(w.env.STATE_SECRET, { k: 'admin_session', u: ADMIN }, 3600);
  return w.request(path, { headers: { cookie: `admin_session=${token}` } });
};

const failures = () => w.sqlite.prepare(`SELECT * FROM failure_log ORDER BY id`).all() as any[];

const addServer = (id: string = IDS.guild, name = 'Acme', extra: { first_seen?: number; left_at?: number; permissions?: string } = {}) =>
  w.sqlite
    .prepare(`INSERT INTO admin_servers (guild_id, name, first_seen, last_seen, left_at, permissions) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, name, extra.first_seen ?? Date.now(), Date.now(), extra.left_at ?? null, extra.permissions ?? ALL_PERMISSIONS);

const summary = (extra: Partial<AdminServerSummary> = {}): AdminServerSummary => ({
  guild_id: IDS.guild,
  name: 'Acme',
  icon: null,
  member_count: 5,
  online_count: 1,
  owner_id: null,
  first_seen: Date.now(),
  left_at: null,
  permissions: ALL_PERMISSIONS,
  pro: 0,
  pro_ends: null,
  owner_name: null,
  owner_avatar: null,
  vanity: null,
  description: null,
  reports: 0,
  repos: 1,
  configured: 1,
  last_command_at: null,
  pending: 0,
  oldest_pending: null,
  failures: 0,
  ...extra,
});

beforeEach(() => {
  w = createWorld();
  vi.stubGlobal('fetch', w.http.stub);
  w.env.ADMIN_DISCORD_ID = ADMIN;
  w.env.ASSETS = { fetch: async () => new Response('site 404', { status: 404 }) } as unknown as Fetcher;
});

describe('recording failures', () => {
  const refuse = (pattern: RegExp, method: string, code: number, status = 403) =>
    w.http.on(method, pattern, () => Response.json({ code, message: 'Missing Access' }, { status }));

  it('ties a failed message to the server that configured the channel', async () => {
    w.sqlite.prepare(`INSERT INTO guilds (guild_id, triage_channel_id) VALUES (?, ?)`).run(IDS.guild, IDS.triage);
    refuse(/channels\/\d+\/messages/, 'POST', 50001);

    expect(await sendChannelMessage(w.env, IDS.triage, [])).toBeNull();
    expect(failures()).toEqual([expect.objectContaining({ source: 'discord', status: 403, guild_id: IDS.guild, message: 'Missing Access' })]);
  });

  it('records a refused role change against its server', async () => {
    refuse(/members\/\d+\/roles\/\d+/, 'PUT', 50013);

    expect(await setMemberRole(w.env, IDS.guild, IDS.member, IDS.role, true)).toBe('missing_permissions');
    expect(failures()[0].guild_id).toBe(IDS.guild);
  });

  it('skips closed DMs, which are the member\'s choice', async () => {
    w.http.on('POST', /users\/@me\/channels/, () => ({ id: IDS.channel }));
    refuse(/channels\/\d+\/messages/, 'POST', 50007);

    expect(await sendDirectMessage(w.env, IDS.member, [])).toBe(false);
    expect(failures()).toHaveLength(0);
  });

  it('records a deferred command that throws, and still answers', async () => {
    w.http.on('PATCH', /webhooks/, () => ({ id: 'm' }));
    w.http.on('POST', /webhooks/, () => ({ id: 'm' }));
    w.sqlite.exec(`DROP TABLE reports`);

    await w.interact({ type: 2, ...w.base(IDS.member), data: { id: 'c', name: 'stats', type: 1 } });
    expect(failures()).toEqual([expect.objectContaining({ source: 'command', action: '/stats', guild_id: IDS.guild })]);
  });

  it('never lets recording break the caller', async () => {
    w.sqlite.exec(`DROP TABLE failure_log`);
    refuse(/channels\/\d+\/messages/, 'POST', 50001);

    expect(await sendChannelMessage(w.env, IDS.channel, [])).toBeNull();
  });
});

describe('server health', () => {
  it('finds nothing wrong with a healthy server', () => {
    expect(healthOf(summary(), Date.now())).toEqual([]);
  });

  it('skips servers the bot has left', () => {
    expect(healthOf(summary({ left_at: 1, failures: 3, repos: 0 }), Date.now())).toEqual([]);
  });

  it('names missing permissions, and treats Administrator as all of them', () => {
    expect(missingPermissions(String(1n << 10n))).toEqual(['Send Messages', 'Embed Links', 'Manage Roles', 'Create Public Threads']);
    expect(missingPermissions(String(1n << 3n))).toEqual([]);
    expect(missingPermissions(null)).toEqual([]);
    expect(healthOf(summary({ permissions: String(1n << 10n) }), Date.now())[0]!.level).toBe('serious');
  });

  it('knows when the bot can create invites', () => {
    expect(canCreateInvites('1')).toBe(true);
    expect(canCreateInvites('2')).toBe(false);
    expect(canCreateInvites(null)).toBeNull();
  });

  it('gives a new server time to finish setup', () => {
    const now = Date.now();
    expect(healthOf(summary({ configured: 0, repos: 0, first_seen: now - DAY }), now)).toEqual([]);
    expect(healthOf(summary({ configured: 0, repos: 0, first_seen: now - 5 * DAY }), now)[0]!.text).toBe('Added 5 days ago, never configured');
  });

  it('flags missing repositories, paused repositories, stale triage and failures', () => {
    const now = Date.now();
    const text = (extra: Partial<AdminServerSummary>) => healthOf(summary(extra), now).map((issue) => issue.text);

    expect(text({ repos: 0 })).toEqual(['No repository linked']);
    expect(text({ repos: 3 })).toEqual(['2 repositories paused without Dispatch Pro']);
    expect(text({ repos: 3, pro: 1 })).toEqual([]);
    expect(text({ oldest_pending: new Date(now - 9 * DAY).toISOString().slice(0, 19).replace('T', ' ') })).toEqual(['A report has waited in triage for 9 days']);
    expect(text({ failures: 1 })).toEqual(['1 failure in the last 7 days']);
  });
});

describe('hourly sync', () => {
  const run = async () => {
    const pending: Promise<unknown>[] = [];
    worker.scheduled({} as never, w.env, { waitUntil: (p: Promise<unknown>) => pending.push(p) } as never);
    await Promise.all(pending);
  };
  const server = (id: string) => w.sqlite.prepare(`SELECT * FROM admin_servers WHERE guild_id = ?`).get(id) as any;

  beforeEach(() => {
    w.http.on('GET', /users\/@me\/guilds/, () => [
      { id: IDS.guild, name: 'Acme', icon: null, permissions: ALL_PERMISSIONS },
      { id: OTHER, name: 'Other', icon: null, permissions: '0' },
    ]);
    w.http.on('GET', /\/guilds\/\d+\?with_counts=true/, () => new Response('{}', { status: 403 }));
  });

  it('stores the bot\'s permissions', async () => {
    w.http.on('GET', /entitlements/, () => []);
    await run();
    expect(server(IDS.guild).permissions).toBe(ALL_PERMISSIONS);
    expect(server(OTHER).permissions).toBe('0');
  });

  it('marks Pro servers, ignoring ended subscriptions and other products', async () => {
    w.env.PREMIUM_SKU_ID = 'pro-sku';
    const ends = '2099-01-01T00:00:00.000Z';
    w.http.on('GET', /entitlements/, () => [
      { id: '1', sku_id: 'pro-sku', guild_id: IDS.guild, deleted: false, starts_at: null, ends_at: ends },
      { id: '2', sku_id: 'other', guild_id: OTHER, deleted: false, starts_at: null, ends_at: null },
    ]);
    await run();

    expect(server(IDS.guild)).toMatchObject({ pro: 1, pro_ends: Date.parse(ends) });
    expect(server(OTHER).pro).toBe(0);
  });

  it('removes Pro once the subscription is gone', async () => {
    w.http.on('GET', /entitlements/, () => [{ id: '1', sku_id: 's', guild_id: IDS.guild, deleted: false, starts_at: null, ends_at: null }]);
    await run();
    expect(server(IDS.guild).pro).toBe(1);

    w.http.on('GET', /entitlements/, () => []);
    await run();
    expect(server(IDS.guild).pro).toBe(0);
  });

  it('keeps Pro as it was when Discord cannot be read, and records why', async () => {
    w.http.on('GET', /entitlements/, () => [{ id: '1', sku_id: 's', guild_id: IDS.guild, deleted: false, starts_at: null, ends_at: null }]);
    await run();

    w.http.on('GET', /entitlements/, () => new Response('{}', { status: 403 }));
    await run();
    expect(server(IDS.guild).pro).toBe(1);
    expect(failures().some((failure) => failure.action === 'read Pro subscriptions')).toBe(true);
  });

  it('keeps Pro as it was when the list is too long to read in one go', async () => {
    w.http.on('GET', /entitlements/, () => [{ id: '1', sku_id: 's', guild_id: IDS.guild, deleted: false, starts_at: null, ends_at: null }]);
    await run();

    w.http.on('GET', /entitlements/, () =>
      Array.from({ length: 100 }, (_, i) => ({ id: String(i + 1), sku_id: 's', guild_id: OTHER, deleted: false, starts_at: null, ends_at: null }))
    );
    await run();
    expect(w.http.find('GET', /entitlements/).length).toBe(4);
    expect(server(IDS.guild).pro).toBe(1);
    expect(server(OTHER).pro).toBe(0);
  });

  it('removes failures older than 30 days', async () => {
    w.http.on('GET', /entitlements/, () => []);
    w.sqlite.prepare(`INSERT INTO failure_log (at, source, action) VALUES (?, 'discord', 'old'), (?, 'discord', 'recent')`).run(Date.now() - 31 * DAY, Date.now() - DAY);
    await run();

    const actions = failures().map((failure) => failure.action);
    expect(actions).toContain('recent');
    expect(actions).not.toContain('old');
  });
});

describe('overview page', () => {
  it('is hidden without a session', async () => {
    for (const path of ['/admin', '/admin/overview', '/admin/failures']) {
      const res = await w.request(path);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('site 404');
    }
  });

  it('is where /admin goes when signed in', async () => {
    const res = await signedIn('/admin');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin/overview');
  });

  it('works with nothing recorded yet', async () => {
    const res = await signedIn('/admin/overview');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Every server looks healthy');
  });

  it('counts each step of the funnel, among servers the bot is in', async () => {
    addServer(IDS.guild, 'Acme');
    addServer(OTHER, 'Other');
    addServer('220000000000000022', 'Gone', { left_at: Date.now() });
    w.sqlite.prepare(`INSERT INTO guilds (guild_id) VALUES (?)`).run(IDS.guild);
    w.sqlite.prepare(`INSERT INTO guild_repos (guild_id, provider, installation_id, repo_id, repo_full_name) VALUES (?, 'github', 1, 1, 'a/b')`).run(IDS.guild);
    w.sqlite.prepare(`INSERT INTO command_log (at, kind, command, guild_id, user_id) VALUES (?, 'slash', 'stats', ?, ?)`).run(Date.now(), IDS.guild, IDS.member);

    const page = await (await signedIn('/admin/overview')).text();
    expect(page).toContain('Added the bot: 2 of 2 servers (100%)');
    expect(page).toContain('Configured: 1 of 2 servers (50%)');
    expect(page).toContain('Linked a repository: 1 of 2 servers (50%)');
    expect(page).toContain('Received a report: 0 of 2 servers (0%)');
    expect(page).toContain('Ran a command this week: 1 of 2 servers (50%)');
  });

  it('lists servers that need attention, and Pro subscribers', async () => {
    addServer(IDS.guild, 'Broken Server', { permissions: '0' });
    addServer(OTHER, 'Paying Server');
    w.sqlite.prepare(`UPDATE admin_servers SET pro = 1 WHERE guild_id = ?`).run(OTHER);

    const page = await (await signedIn('/admin/overview')).text();
    expect(page).toContain('Broken Server');
    expect(page).toContain('Missing permissions');
    expect(page).toContain('Paying Server');
    expect(page).toContain('Renewing');
  });
});

describe('failures page', () => {
  const seed = (source: string, action: string, guild: string | null = IDS.guild, message: string | null = null) =>
    w.sqlite.prepare(`INSERT INTO failure_log (at, source, action, message, guild_id) VALUES (?, ?, ?, ?, ?)`).run(Date.now(), source, action, message, guild);

  it('shows failures with links to the server', async () => {
    addServer();
    seed('github', 'create an issue');
    const page = await (await signedIn('/admin/failures')).text();

    expect(page).toContain('create an issue');
    expect(page).toContain('Acme');
    expect(page).toContain(`/admin/servers/${IDS.guild}`);
    expect(page).toContain(`/admin/failures?server=${IDS.guild}`);
  });

  it('filters by source and server', async () => {
    seed('github', 'one');
    seed('discord', 'two', OTHER);

    const bySource = await (await signedIn('/admin/failures?source=github')).text();
    expect(bySource).toContain('one');
    expect(bySource).not.toContain('>two');

    const byServer = await (await signedIn(`/admin/failures?server=${OTHER}`)).text();
    expect(byServer).toContain('two');
    expect(byServer).not.toContain('>one');
  });

  it('refuses filters it does not know', async () => {
    expect((await signedIn('/admin/failures?source=nope')).status).toBe(404);
    expect((await signedIn('/admin/failures?server=abc')).status).toBe(404);
  });

  it('escapes error text', async () => {
    seed('github', 'one', null, '<script>alert(1)</script>');
    const page = await (await signedIn('/admin/failures')).text();

    expect(page).not.toContain('<script>alert(1)');
    expect(page).toContain('&lt;script&gt;alert(1)');
  });
});

describe('server pages', () => {
  beforeEach(() => {
    w.http.on('GET', /users\/@me\/guilds/, () => [{ id: IDS.guild, name: 'Acme', icon: null, permissions: '0' }]);
    w.http.on('GET', /\/guilds\/\d+\?with_counts=true/, () => ({ id: IDS.guild, name: 'Acme', icon: null, owner_id: IDS.admin }));
    w.http.on('GET', /\/users\/\d+$/, () => ({ id: IDS.admin, username: 'owner' }));
    w.http.on('GET', /\/guilds\/\d+\/channels/, () => []);
  });

  it('flags a server with problems on the list', async () => {
    const page = await (await signedIn('/admin/servers')).text();
    expect(page).toContain('data-tags="attention');
    expect(page).toContain('1 issue');
    expect(page).toContain('Needs attention');
  });

  it('shows health and recent failures on the server page', async () => {
    await signedIn('/admin/servers');
    w.sqlite.prepare(`INSERT INTO failure_log (at, source, action, guild_id) VALUES (?, 'discord', 'post somewhere', ?)`).run(Date.now(), IDS.guild);
    const page = await (await signedIn(`/admin/servers/${IDS.guild}`)).text();

    expect(page).toContain('Missing permissions');
    expect(page).toContain('Recent failures');
    expect(page).toContain('post somewhere');
    expect(page).toContain('Can create invites');
  });
});
