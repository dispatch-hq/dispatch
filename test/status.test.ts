import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorld, type World } from './support/harness';

let w: World;

const GUILDS = /users\/@me\/guilds/;

const guilds = (n: number, members: number, from = 1) =>
  Array.from({ length: n }, (_, i) => ({ id: String(from + i), approximate_member_count: members }));

const rateLimited = () =>
  Response.json({ message: 'You are being rate limited.', retry_after: 1, global: false }, { status: 429 });

/** Lets the next read through, as if the last one had happened long enough ago. */
const expire = (minutes: number) => {
  const ago = Date.now() - minutes * 60 * 1000;
  w.sqlite.prepare(`UPDATE status_counts SET read_at = ?, claimed_at = ?`).run(ago, ago);
};

beforeEach(() => {
  w = createWorld();
  vi.stubGlobal('fetch', w.http.stub);
});

describe('/api/status', () => {
  it('counts servers and members, following pagination', async () => {
    w.http.on('GET', GUILDS, (call) =>
      new URL(call.url).searchParams.has('after') ? guilds(30, 50, 201) : guilds(200, 100)
    );

    const res = await w.request('/api/status');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      servers: 230,
      members: 200 * 100 + 30 * 50,
      checks: { database: { ok: true }, discord: { ok: true } },
    });
    expect(w.http.find('GET', GUILDS)).toHaveLength(2);
    expect(w.http.calls[0]!.url).toContain('with_counts=true');
  });

  it('waits out the rate limit between pages', async () => {
    let last = 0;
    w.http.on('GET', GUILDS, (call) => {
      if (Date.now() - last < 40) return rateLimited();
      last = Date.now();
      const body = new URL(call.url).searchParams.has('after') ? guilds(30, 50, 201) : guilds(200, 100);
      return Response.json(body, { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '0.05' } });
    });

    const res = await w.request('/api/status');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, servers: 230 });
  });

  it('shares the counts between requests instead of calling Discord each time', async () => {
    w.http.on('GET', GUILDS, () => guilds(3, 10));
    await w.request('/api/status');
    const again = await (await w.request('/api/status')).json();

    expect(again).toMatchObject({ servers: 3, members: 30 });
    expect(w.http.find('GET', GUILDS)).toHaveLength(1);
  });

  it('calls Discord once when requests arrive together', async () => {
    w.http.on('GET', GUILDS, () => guilds(3, 10));
    const results = await Promise.all([w.request('/api/status'), w.request('/api/status'), w.request('/api/status')]);

    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(w.http.find('GET', GUILDS)).toHaveLength(1);
  });

  it('refreshes the counts once they go stale', async () => {
    let servers = 3;
    w.http.on('GET', GUILDS, () => guilds(servers, 10));
    await w.request('/api/status');

    servers = 4;
    expire(11);
    expect(await (await w.request('/api/status')).json()).toMatchObject({ servers: 4 });
  });

  it('treats a rate limit as Discord being up', async () => {
    w.http.on('GET', GUILDS, rateLimited);

    const res = await w.request('/api/status');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      servers: null,
      checks: { discord: { ok: true } },
    });
  });

  it('keeps the last counts when a refresh is rate limited', async () => {
    w.http.on('GET', GUILDS, () => guilds(3, 10));
    await w.request('/api/status');

    expire(11);
    w.http.on('GET', GUILDS, rateLimited);
    const res = await w.request('/api/status');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, servers: 3, members: 30 });
  });

  it('reports 503 and no counts when Discord is unreachable', async () => {
    w.http.on('GET', GUILDS, () => new Response('nope', { status: 500 }));

    const res = await w.request('/api/status');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      ok: false,
      servers: null,
      members: null,
      checks: { database: { ok: true }, discord: { ok: false } },
    });
  });

  it('keeps reporting an outage without retrying until the claim runs out, then recovers', async () => {
    w.http.on('GET', GUILDS, () => new Response('nope', { status: 500 }));
    await w.request('/api/status');

    expect((await w.request('/api/status')).status).toBe(503);
    expect(w.http.find('GET', GUILDS)).toHaveLength(1);

    w.http.on('GET', GUILDS, () => guilds(3, 10));
    expire(2);
    const res = await w.request('/api/status');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, servers: 3, checks: { discord: { ok: true } } });
  });

  it('still checks Discord when the database is down', async () => {
    w.http.on('GET', GUILDS, () => guilds(3, 10));
    w.sqlite.exec(`DROP TABLE status_counts`);

    const res = await w.request('/api/status');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      ok: false,
      servers: 3,
      checks: { database: { ok: false }, discord: { ok: true } },
    });
  });
});
