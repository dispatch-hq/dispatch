import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { signToken } from '../src/lib/crypto';
import { createWorld, IDS, type World } from './support/harness';

let w: World;

const ADMIN = '900000000000000009';
const OTHER_GUILD = '210000000000000021';

const signedIn = async (path: string) => {
  const token = await signToken(w.env.STATE_SECRET, { k: 'admin_session', u: ADMIN }, 3600);
  return w.request(path, { headers: { cookie: `admin_session=${token}` } });
};

const log = () => w.sqlite.prepare(`SELECT * FROM command_log ORDER BY id`).all() as any[];

const stats = (extra: Record<string, unknown> = {}, who: string = IDS.member) =>
  w.interact({ type: 2, ...w.base(who), ...extra, data: { id: 'c', name: 'stats', type: 1 } });

const seedLine = (guild: string = IDS.guild, user: string = IDS.member, command = 'stats', at = Date.now()) =>
  w.sqlite
    .prepare(`INSERT INTO command_log (at, kind, command, guild_id, channel_id, user_id, user_name) VALUES (?, 'slash', ?, ?, ?, ?, 'someone')`)
    .run(at, command, guild, IDS.channel, user);

beforeEach(() => {
  w = createWorld();
  vi.stubGlobal('fetch', w.http.stub);
  w.env.ADMIN_DISCORD_ID = ADMIN;
  w.env.ASSETS = { fetch: async () => new Response('site 404', { status: 404 }) } as unknown as Fetcher;
});

describe('recording commands', () => {
  it('records who ran a command and where', async () => {
    const res = await stats();

    expect(res.status).toBe(200);
    expect(log()).toEqual([
      expect.objectContaining({ kind: 'slash', command: 'stats', guild_id: IDS.guild, channel_id: IDS.channel, user_id: IDS.member, user_name: 'reporter' }),
    ]);
  });

  it('names subcommands, and never stores what was typed', async () => {
    await w.interact({
      type: 2,
      ...w.base(IDS.member),
      data: {
        id: 'c',
        name: 'dispatch',
        type: 1,
        options: [{ type: 2, name: 'replies', options: [{ type: 1, name: 'add', options: [{ type: 3, name: 'body', value: 'a secret value' }] }] }],
      },
    });

    expect(log()[0].command).toBe('dispatch replies add');
    expect(JSON.stringify(log())).not.toContain('secret');
  });

  it('skips buttons, which are not commands', async () => {
    await w.interact({ type: 3, ...w.base(IDS.member), data: { custom_id: 'nope', component_type: 2 } }).catch(() => undefined);
    expect(log()).toHaveLength(0);
  });

  it('skips requests that fail the signature check', async () => {
    const body = JSON.stringify({ id: '1', type: 2, version: 1, ...w.base(IDS.member), data: { id: 'c', name: 'stats', type: 1 } });
    const res = await w.request('/interactions', {
      method: 'POST',
      body,
      headers: { 'x-signature-ed25519': '00'.repeat(64), 'x-signature-timestamp': '1' },
    });

    expect(res.status).toBe(401);
    expect(log()).toHaveLength(0);
  });

  it('still answers the command when recording fails', async () => {
    w.sqlite.exec(`DROP TABLE command_log`);
    const res = await stats();

    expect(res.status).toBe(200);
    expect(res.json.type).toBeDefined();
  });
});

describe('activity page', () => {
  it('is hidden without a session', async () => {
    for (const path of ['/admin/activity', '/admin/activity/feed']) {
      const res = await w.request(path);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('site 404');
    }
  });

  it('shows lines linked to the server and the user', async () => {
    w.sqlite.prepare(`INSERT INTO admin_servers (guild_id, name, first_seen, last_seen) VALUES (?, 'Acme', 1, 1)`).run(IDS.guild);
    seedLine();
    const page = await (await signedIn('/admin/activity')).text();

    expect(page).toContain('/stats');
    expect(page).toContain('Acme');
    expect(page).toContain(`/admin/servers/${IDS.guild}`);
    expect(page).toContain(`/admin/activity?user=${IDS.member}`);
    expect(page).toContain(`/admin/activity?server=${IDS.guild}`);
  });

  it('escapes names people chose', async () => {
    w.sqlite
      .prepare(`INSERT INTO command_log (at, kind, command, guild_id, user_id, user_global_name) VALUES (1, 'slash', 'stats', ?, ?, '<img src=x>')`)
      .run(IDS.guild, IDS.member);
    const { html } = (await (await signedIn('/admin/activity/feed')).json()) as { html: string };

    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
  });

  it('filters by server and by user', async () => {
    seedLine(IDS.guild, IDS.member, 'stats');
    seedLine(OTHER_GUILD, IDS.admin, 'leaderboard');

    const byServer = await (await signedIn(`/admin/activity/feed?server=${OTHER_GUILD}`)).json() as any;
    expect(byServer.count).toBe(1);
    expect(byServer.html).toContain('/leaderboard');

    const byUser = await (await signedIn(`/admin/activity/feed?user=${IDS.member}`)).json() as any;
    expect(byUser.count).toBe(1);
    expect(byUser.html).toContain('/stats');

    const page = await (await signedIn(`/admin/activity?server=${OTHER_GUILD}`)).text();
    expect(page).toContain('Show everything');
    expect(page).toContain(`/admin/activity/feed?server=${OTHER_GUILD}`);
  });

  it('refuses filters that are not Discord IDs', async () => {
    expect((await signedIn(`/admin/activity?server=1' OR 1=1`)).status).toBe(404);
    expect((await signedIn('/admin/activity/feed?user=abc')).status).toBe(404);
  });

  it('feeds only newer lines, oldest first', async () => {
    seedLine(IDS.guild, IDS.member, 'one');
    const first = (await (await signedIn('/admin/activity/feed')).json()) as any;
    seedLine(IDS.guild, IDS.member, 'two');
    seedLine(IDS.guild, IDS.member, 'three');

    const next = (await (await signedIn(`/admin/activity/feed?after=${first.last}`)).json()) as any;
    expect(next.count).toBe(2);
    expect(next.html.indexOf('/two')).toBeLessThan(next.html.indexOf('/three'));
    expect(next.html).not.toContain('/one');

    const quiet = (await (await signedIn(`/admin/activity/feed?after=${next.last}`)).json()) as any;
    expect(quiet.count).toBe(0);
  });

  it('pages back through older lines', async () => {
    for (let i = 0; i < 101; i++) seedLine(IDS.guild, IDS.member, `c${i}`);

    const latest = (await (await signedIn('/admin/activity/feed')).json()) as any;
    expect(latest.count).toBe(100);
    expect(latest.more).toBe(true);
    expect(latest.html).not.toMatch(/\/c0\b/);

    const older = (await (await signedIn(`/admin/activity/feed?before=${latest.first}`)).json()) as any;
    expect(older.count).toBe(1);
    expect(older.more).toBe(false);
    expect(older.html).toMatch(/\/c0\b/);
  });
});

describe('links with the server pages', () => {
  beforeEach(() => {
    w.http.on('GET', /users\/@me\/guilds/, () => [{ id: IDS.guild, name: 'Acme', icon: null }]);
    w.http.on('GET', /\/guilds\/\d+\?with_counts=true/, () => ({ id: IDS.guild, name: 'Acme', icon: null, owner_id: IDS.admin }));
    w.http.on('GET', /\/users\/\d+$/, () => ({ id: IDS.admin, username: 'owner' }));
    w.http.on('GET', /\/guilds\/\d+\/channels/, () => []);
  });

  it('shows the last command on the server list', async () => {
    await signedIn('/admin/servers');
    expect(await (await signedIn('/admin/servers')).text()).toContain('No commands yet');

    seedLine();
    const page = await (await signedIn('/admin/servers')).text();
    expect(page).toContain('Last command just now');
    expect(page).toContain(`/admin/activity?server=${IDS.guild}`);
  });

  it('shows recent commands on the server page', async () => {
    await signedIn('/admin/servers');
    seedLine();
    seedLine(OTHER_GUILD, IDS.member, 'elsewhere');
    const page = await (await signedIn(`/admin/servers/${IDS.guild}`)).text();

    expect(page).toContain('Recent commands');
    expect(page).toContain('/stats');
    expect(page).not.toContain('/elsewhere');
  });
});

describe('hourly cleanup', () => {
  const run = async () => {
    const pending: Promise<unknown>[] = [];
    w.http.on('GET', /users\/@me\/guilds/, () => new Response('{}', { status: 500 }));
    worker.scheduled({} as never, w.env, { waitUntil: (p: Promise<unknown>) => pending.push(p) } as never);
    await Promise.all(pending);
  };

  it('removes lines older than 30 days, even if the server sync fails', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    seedLine(IDS.guild, IDS.member, 'old', Date.now() - 31 * DAY);
    seedLine(IDS.guild, IDS.member, 'recent', Date.now() - 29 * DAY);

    await run();
    expect(log().map((line) => line.command)).toEqual(['recent']);
  });
});
