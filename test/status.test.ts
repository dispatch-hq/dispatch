import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStatusCache } from '../src/web/status';
import { createWorld, type World } from './support/harness';

let w: World;

const guilds = (n: number, members: number, from = 1) =>
  Array.from({ length: n }, (_, i) => ({ id: String(from + i), approximate_member_count: members }));

beforeEach(() => {
  resetStatusCache();
  w = createWorld();
  vi.stubGlobal('fetch', w.http.stub);
});

describe('/api/ping', () => {
  it('answers without touching the database or Discord', async () => {
    const res = await w.request('/api/ping');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ ok: true });
    expect(w.http.calls).toHaveLength(0);
  });
});

describe('/api/status', () => {
  it('counts servers and members, following pagination', async () => {
    w.http.on('GET', /users\/@me\/guilds/, (call) =>
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
    expect(w.http.find('GET', /users\/@me\/guilds/)).toHaveLength(2);
    expect(w.http.calls[0]!.url).toContain('with_counts=true');
  });

  it('reuses the counts instead of calling Discord on every request', async () => {
    w.http.on('GET', /users\/@me\/guilds/, () => guilds(3, 10));
    await w.request('/api/status');
    const again = await (await w.request('/api/status')).json();

    expect(again).toMatchObject({ servers: 3, members: 30 });
    expect(w.http.find('GET', /users\/@me\/guilds/)).toHaveLength(1);
  });

  it('reports 503 and no counts when Discord is unreachable', async () => {
    w.http.on('GET', /users\/@me\/guilds/, () => new Response('nope', { status: 500 }));

    const res = await w.request('/api/status');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      ok: false,
      servers: null,
      members: null,
      checks: { database: { ok: true }, discord: { ok: false } },
    });
  });
});
