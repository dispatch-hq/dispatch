import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '../src/lib/crypto';
import worker from '../src/index';
import { createWorld, IDS, type World } from './support/harness';

let w: World;

const ADMIN = '900000000000000009';
const SERVER = '110000000000000011';
const OTHER = '120000000000000012';
const OWNER = '130000000000000013';

const GUILDS = /users\/@me\/guilds/;
const GUILD = /\/guilds\/(\d+)\?with_counts=true/;
const USER = /\/users\/(\d+)$/;
const CHANNELS = /\/guilds\/(\d+)\/channels/;
const INVITES = /\/channels\/(\d+)\/invites/;

const listed = (id = SERVER, name = 'Acme') => ({ id, name, icon: null, approximate_member_count: 10, approximate_presence_count: 4 });

const session = (userId = ADMIN, kind = 'admin_session') =>
  signToken(w.env.STATE_SECRET, { k: kind, u: userId }, 3600).then((token) => `admin_session=${token}`);

const signedIn = async (path: string, init: RequestInit = {}) =>
  w.request(path, { ...init, headers: { cookie: await session(), ...init.headers } });

const createInvite = async (id = SERVER, origin = 'https://dispatch.test') =>
  signedIn(`/admin/servers/${id}/invite`, { method: 'POST', headers: { origin } });

const server = (id = SERVER) => w.sqlite.prepare(`SELECT * FROM admin_servers WHERE guild_id = ?`).get(id) as any;

beforeEach(() => {
  w = createWorld();
  vi.stubGlobal('fetch', w.http.stub);
  w.env.ADMIN_DISCORD_ID = ADMIN;
  w.env.DISCORD_CLIENT_SECRET = 'discord-secret';
  // Like the real assets binding, for a path that isn't part of the site.
  w.env.ASSETS = { fetch: async () => new Response('site 404', { status: 404 }) } as unknown as Fetcher;
  w.http.on('GET', GUILDS, () => [listed()]);
  w.http.on('GET', GUILD, (_call, match) => ({ id: match[1], name: 'Acme', icon: null, owner_id: OWNER, approximate_member_count: 12 }));
  w.http.on('GET', USER, () => ({ id: OWNER, username: 'ownername', avatar: null }));
  w.http.on('GET', CHANNELS, () => [{ id: '140000000000000014', name: 'general', type: 0, position: 1 }]);
});

describe('admin access', () => {
  const hiddenFrom = async (cookie?: string) => {
    for (const path of ['/admin', '/admin/servers', `/admin/servers/${SERVER}`, '/admin/nope']) {
      const res = await w.request(path, cookie ? { headers: { cookie } } : undefined);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('site 404');
    }
  };

  it('looks like any other missing page without a session', async () => {
    await hiddenFrom();
    expect(w.http.calls).toHaveLength(0);
  });

  it('rejects a session for another user', async () => {
    await hiddenFrom(await session(IDS.member));
  });

  it('rejects other tokens signed with the same secret', async () => {
    await hiddenFrom(await session(ADMIN, 'admin_state'));
  });

  it('rejects a tampered session', async () => {
    await hiddenFrom(`${await session()}x`);
  });

  it('rejects everyone when ADMIN_DISCORD_ID is unset', async () => {
    delete w.env.ADMIN_DISCORD_ID;
    await hiddenFrom(await session());
    expect((await w.request('/admin/login')).status).toBe(404);
  });

  describe('sign-in', () => {
    const start = async () => {
      const res = await w.request('/admin/login');
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get('location')!);
      expect(location.origin).toBe('https://discord.com');
      expect(location.searchParams.get('scope')).toBe('identify');
      expect(location.searchParams.get('redirect_uri')).toBe('https://dispatch.test/admin/callback');
      const cookie = res.headers.get('set-cookie')!;
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/Secure/);
      return { state: location.searchParams.get('state')!, cookie: cookie.split(';')[0]! };
    };

    const finish = (state: string, cookie?: string) =>
      w.request(`/admin/callback?code=abc&state=${state}`, cookie ? { headers: { cookie } } : undefined);

    const signInAs = (id: string) => {
      w.http.on('POST', /oauth2\/token/, () => ({ access_token: 'user-token' }));
      w.http.on('GET', /users\/@me$/, () => ({ id }));
    };

    it('lets the admin in', async () => {
      signInAs(ADMIN);
      const { state, cookie } = await start();
      const res = await finish(state, cookie);

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/admin/servers');
      const sessionCookie = res.headers.getSetCookie().find((c) => c.startsWith('admin_session='))!;
      expect(sessionCookie).toMatch(/HttpOnly/);

      const page = await w.request('/admin/servers', { headers: { cookie: sessionCookie.split(';')[0]! } });
      expect(page.status).toBe(200);
      expect(page.headers.get('cache-control')).toBe('no-store');
    });

    it('gives anyone else the 404 and no session', async () => {
      signInAs(IDS.member);
      const { state, cookie } = await start();
      const res = await finish(state, cookie);

      expect(res.status).toBe(404);
      expect(res.headers.getSetCookie().some((c) => c.startsWith('admin_session=') && !c.includes('Max-Age=0'))).toBe(false);
    });

    it('refuses a state that this browser did not start', async () => {
      signInAs(ADMIN);
      const { state } = await start();
      expect((await finish(state)).status).toBe(404);
      expect(w.http.find('POST', /oauth2\/token/)).toHaveLength(0);
    });
  });
});

describe('server list', () => {
  it('shows and stores the servers Discord lists', async () => {
    const res = await signedIn('/admin/servers');
    const page = await res.text();

    expect(res.status).toBe(200);
    expect(server().member_count).toBe(10);
    expect(page).toContain('Acme');
  });

  it('escapes server names', async () => {
    w.http.on('GET', GUILDS, () => [listed(SERVER, '<script>alert(1)</script>')]);
    const page = await (await signedIn('/admin/servers')).text();

    expect(page).not.toContain('<script>alert(1)');
    expect(page).toContain('&lt;script&gt;alert(1)');
  });

  it('marks a server as left, and clears that if the bot comes back', async () => {
    w.http.on('GET', GUILDS, () => [listed(), listed(OTHER, 'Other')]);
    await signedIn('/admin/servers');
    expect(server(OTHER).left_at).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 2));
    w.http.on('GET', GUILDS, () => [listed()]);
    await signedIn('/admin/servers');
    expect(server(OTHER).left_at).not.toBeNull();
    expect(server().left_at).toBeNull();

    const firstSeen = server(OTHER).first_seen;
    await new Promise((resolve) => setTimeout(resolve, 2));
    w.http.on('GET', GUILDS, () => [listed(), listed(OTHER, 'Other')]);
    await signedIn('/admin/servers');
    expect(server(OTHER).left_at).toBeNull();
    expect(server(OTHER).first_seen).toBe(firstSeen);
  });

  it('marks nothing as left when Discord cannot be read', async () => {
    await signedIn('/admin/servers');
    w.http.on('GET', GUILDS, () => new Response('nope', { status: 500 }));

    const page = await (await signedIn('/admin/servers')).text();
    expect(server().left_at).toBeNull();
    expect(page).toContain('Acme');
    expect(page).toContain('last stored list');
  });

  it('marks nothing as left when the list is cut short', async () => {
    await signedIn('/admin/servers');
    await new Promise((resolve) => setTimeout(resolve, 2));
    // A full page every time, so the page cap ends the read rather than the list running out.
    w.http.on('GET', GUILDS, () => Array.from({ length: 200 }, (_, i) => listed(String(200000000000000000n + BigInt(i)), 'Filler')));
    await signedIn('/admin/servers');

    expect(w.http.find('GET', GUILDS).length).toBeGreaterThanOrEqual(45);
    expect(server().left_at).toBeNull();
  });
});

describe('server details', () => {
  it('reads the owner and details from Discord', async () => {
    await signedIn('/admin/servers');
    const page = await (await signedIn(`/admin/servers/${SERVER}`)).text();

    expect(page).toContain('ownername');
    expect(page).toContain('general');
    expect(server().owner_id).toBe(OWNER);
    expect(server().member_count).toBe(12);
  });

  it('groups channels by category and shows what Dispatch knows', async () => {
    w.http.on('GET', CHANNELS, () => [
      { id: '1', name: 'Community', type: 4, position: 0 },
      { id: '2', name: 'general-chat', type: 0, position: 0, parent_id: '1' },
      { id: '3', name: 'loose-channel', type: 2, position: 0, parent_id: null },
    ]);
    await signedIn('/admin/servers');
    const res = await w.request(`/admin/servers/${SERVER}`, { headers: { cookie: await session() } });
    const page = await res.text();

    expect(page.indexOf('loose-channel')).toBeLessThan(page.indexOf('Community'));
    expect(page.indexOf('Community')).toBeLessThan(page.indexOf('general-chat'));
    expect(page).toContain('Not set up');
  });

  it('does not read Discord again for a fresh server', async () => {
    await signedIn('/admin/servers');
    await signedIn(`/admin/servers/${SERVER}`);
    await signedIn(`/admin/servers/${SERVER}`);
    expect(w.http.find('GET', GUILD)).toHaveLength(1);
  });

  it('hides servers it has never seen', async () => {
    expect((await signedIn(`/admin/servers/${OTHER}`)).status).toBe(404);
    expect((await signedIn('/admin/servers/not-an-id')).status).toBe(404);
  });
});

describe('create invite', () => {
  beforeEach(async () => {
    await signedIn('/admin/servers');
  });

  it('creates a single-use invite that expires', async () => {
    w.http.on('POST', INVITES, () => ({ code: 'abc123' }));
    const res = await createInvite();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://discord.gg/abc123' });
    expect(w.http.find('POST', INVITES)[0]!.body).toEqual({ max_age: 3600, max_uses: 1, unique: true });
  });

  it('moves on to the next channel when one refuses', async () => {
    w.http.on('GET', CHANNELS, () => [
      { id: '150000000000000015', name: 'second', type: 0, position: 2 },
      { id: '160000000000000016', name: 'first', type: 0, position: 1 },
      { id: '170000000000000017', name: 'voice', type: 2, position: 0 },
    ]);
    w.http.on('POST', INVITES, (_call, match) =>
      match[1] === '150000000000000015' ? { code: 'second' } : new Response('{}', { status: 403 })
    );

    expect(await (await createInvite()).json()).toEqual({ url: 'https://discord.gg/second' });
    expect(w.http.find('POST', INVITES).map((c) => /channels\/(\d+)/.exec(c.url)![1])).toEqual(['160000000000000016', '150000000000000015']);
  });

  it('reports when no channel allows it', async () => {
    w.http.on('POST', INVITES, () => new Response('{}', { status: 403 }));
    const res = await createInvite();

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'no_permission' });
  });

  it('stops on any other failure', async () => {
    w.http.on('POST', INVITES, () => new Response('{}', { status: 500 }));
    expect(await (await createInvite()).json()).toEqual({ error: 'failed' });
  });

  it('refuses a server the bot has left', async () => {
    w.sqlite.prepare(`UPDATE admin_servers SET left_at = 1`).run();
    expect(await (await createInvite()).json()).toEqual({ error: 'gone' });
    expect(w.http.find('POST', INVITES)).toHaveLength(0);
  });

  it('refuses a request from another site', async () => {
    const res = await createInvite(SERVER, 'https://evil.test');
    expect(res.status).toBe(403);
    expect(w.http.find('POST', INVITES)).toHaveLength(0);
  });

  it('is hidden without a session', async () => {
    const res = await w.request(`/admin/servers/${SERVER}/invite`, { method: 'POST', headers: { origin: 'https://dispatch.test' } });
    expect(res.status).toBe(404);
    expect(w.http.find('POST', INVITES)).toHaveLength(0);
  });
});

describe('hourly sync', () => {
  const run = async () => {
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p) };
    worker.scheduled({} as never, w.env, ctx as never);
    await Promise.all(pending);
  };

  it('stays inside the subrequest budget, stalest servers first', async () => {
    const many = Array.from({ length: 30 }, (_, i) => listed(String(210000000000000000n + BigInt(i)), `S${i}`));
    w.http.on('GET', GUILDS, () => many);

    await run();
    expect(w.http.calls.length).toBeLessThanOrEqual(40);
    const read = new Set(w.http.find('GET', GUILD).map((c) => GUILD.exec(c.url)![1]));
    expect(read.size).toBe(19);

    await run();
    const second = w.http.find('GET', GUILD).slice(19).map((c) => GUILD.exec(c.url)![1]!);
    expect(second.slice(0, 11).every((id) => !read.has(id))).toBe(true);
  });

  it('stops reading details when rate limited', async () => {
    w.http.on('GET', GUILDS, () => [listed(), listed(OTHER, 'Other')]);
    w.http.on('GET', GUILD, () => new Response('{}', { status: 429 }));

    await run();
    expect(w.http.find('GET', GUILD)).toHaveLength(1);
    expect(server().refreshed_at).toBeNull();
  });

  it('keeps a server moving through the queue when it cannot be read', async () => {
    w.http.on('GET', GUILD, () => new Response('{}', { status: 403 }));

    await run();
    expect(server().refreshed_at).not.toBeNull();
    expect(server().details).toBeNull();
  });

  it('keeps the details when the owner cannot be read', async () => {
    w.http.on('GET', USER, () => new Response('{}', { status: 404 }));

    await run();
    expect(server().owner_id).toBe(OWNER);
    expect(server().owner).toBeNull();
    expect(server().details).not.toBeNull();
  });
});
