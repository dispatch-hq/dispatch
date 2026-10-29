/**
 * In-process test harness: runs the real Hono app against
 *  - D1   → a thin shim over Node's built-in `node:sqlite`, with the real migrations applied
 *  - R2   → an in-memory map
 *  - HTTP → a recording `fetch` stub for the Discord and GitHub APIs
 * and signs interactions with a throwaway Ed25519 key, exactly like Discord does.
 */
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import app from '../../src/index';
import type { Bindings } from '../../src/types';

/* -------------------------------------------------------------------------- */
/*                                  D1 shim                                   */
/* -------------------------------------------------------------------------- */

type Value = string | number | null;

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    private readonly params: Value[] = []
  ) {}

  bind(...params: Value[]) {
    return new Statement(this.db, this.sql, params);
  }

  async first<T>() {
    const row = this.db.prepare(this.sql).get(...this.params);
    return (row ? { ...row } : null) as T | null;
  }

  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params).map((r) => ({ ...r })) as T[] };
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(result.changes) } };
  }
}

export function createD1() {
  const db = new DatabaseSync(':memory:');
  const dir = join(import.meta.dirname, '../../migrations');
  for (const file of readdirSync(dir).sort()) db.exec(readFileSync(join(dir, file), 'utf8'));

  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    batch: async (statements: Statement[]) => Promise.all(statements.map((s) => s.run())),
  };
  return { d1: d1 as unknown as D1Database, sqlite: db };
}

/* -------------------------------------------------------------------------- */
/*                                  R2 shim                                   */
/* -------------------------------------------------------------------------- */

export function createR2() {
  const objects = new Map<string, { data: ArrayBuffer; contentType?: string }>();
  const bucket = {
    async put(key: string, data: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
      objects.set(key, { data, contentType: opts?.httpMetadata?.contentType });
    },
    async get(key: string) {
      const object = objects.get(key);
      if (!object) return null;
      return {
        body: object.data,
        httpEtag: '"etag"',
        writeHttpMetadata(headers: Headers) {
          if (object.contentType) headers.set('content-type', object.contentType);
        },
      };
    },
  };
  return { r2: bucket as unknown as R2Bucket, objects };
}

/* -------------------------------------------------------------------------- */
/*                                 HTTP stub                                  */
/* -------------------------------------------------------------------------- */

export type Call = { method: string; url: string; body: any };
type Route = (call: Call) => Response | undefined;

export function createFetchStub() {
  const calls: Call[] = [];
  const routes: Route[] = [];

  const stub = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const text = request.body ? await request.text() : '';
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      const match = /name="payload_json"\r?\n\r?\n([\s\S]*?)\r?\n--/.exec(text);
      if (match) body = JSON.parse(match[1]!);
    }

    const call: Call = { method: request.method, url: request.url, body };
    calls.push(call);
    for (const route of routes) {
      const res = route(call);
      if (res) return res;
    }
    throw new Error(`Unexpected request: ${call.method} ${call.url}`);
  };

  return {
    stub: stub as typeof fetch,
    calls,
    on(method: string, pattern: RegExp, respond: (call: Call, match: RegExpExecArray) => unknown, status = 200) {
      routes.unshift((call) => {
        const match = call.method === method ? pattern.exec(call.url) : null;
        if (!match) return undefined;
        const result = respond(call, match);
        if (result instanceof Response) return result;
        return status === 204 ? new Response(null, { status }) : Response.json(result ?? {}, { status });
      });
    },
    find(method: string, pattern: RegExp) {
      return calls.filter((c) => c.method === method && pattern.test(c.url));
    },
  };
}

/* -------------------------------------------------------------------------- */
/*                                 Test world                                 */
/* -------------------------------------------------------------------------- */

export const IDS = {
  app: '100000000000000001',
  guild: '200000000000000002',
  channel: '300000000000000003',
  admin: '400000000000000004',
  member: '500000000000000005',
  triage: '600000000000000006',
  updates: '700000000000000007',
  role: '800000000000000008',
} as const;

const MANAGE_GUILD = (1n << 5n).toString();

export function createWorld() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const rsa = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  const { d1, sqlite } = createD1();
  const { r2, objects } = createR2();
  const http = createFetchStub();

  const env: Bindings = {
    DB: d1,
    FILES: r2,
    ASSETS: { fetch: async () => new Response('<h1>site</h1>', { headers: { 'content-type': 'text/html' } }) } as unknown as Fetcher,
    PUBLIC_URL: 'https://dispatch.test',
    DISCORD_APPLICATION_ID: IDS.app,
    DISCORD_PUBLIC_KEY: (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32).toString('hex'),
    DISCORD_TOKEN: 'bot-token',
    GITHUB_APP_ID: '1234',
    GITHUB_APP_SLUG: 'dispatch-test',
    GITHUB_CLIENT_ID: 'Iv1.client',
    GITHUB_CLIENT_SECRET: 'client-secret',
    GITHUB_PRIVATE_KEY: rsa.privateKey,
    GITHUB_WEBHOOK_SECRET: 'hook-secret',
    STATE_SECRET: 'state-secret',
  };

  /** Runs a request and waits for every `waitUntil` task to settle. */
  async function request(path: string, init?: RequestInit) {
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} };
    const res = await app.fetch(new Request(`https://dispatch.test${path}`, init), env, ctx as never);
    while (pending.length) await Promise.allSettled(pending.splice(0));
    return res;
  }

  let interactionId = 0;
  async function interact(payload: Record<string, unknown>) {
    const body = JSON.stringify({
      id: String(++interactionId),
      application_id: IDS.app,
      token: `token-${interactionId}`,
      version: 1,
      ...payload,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(timestamp + body), privateKey as KeyObject).toString('hex');
    const res = await request('/interactions', {
      method: 'POST',
      body,
      headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp },
    });
    return { status: res.status, json: (await res.json()) as any, token: `token-${interactionId}` };
  }

  function member(id: string, admin = false, roles: string[] = []) {
    return {
      user: { id, username: id === IDS.admin ? 'admin' : 'reporter', global_name: null },
      roles,
      permissions: admin ? MANAGE_GUILD : '0',
      nick: null,
      joined_at: '2026-01-01T00:00:00Z',
      deaf: false,
      mute: false,
      flags: 0,
    };
  }

  const base = (userId: string, admin = false) => ({
    guild_id: IDS.guild,
    channel_id: IDS.channel,
    member: member(userId, admin),
  });

  return {
    env,
    http,
    sqlite,
    objects,
    request,
    interact,
    base,
    member,
    rsaPublicKey: rsa.publicKey,
  };
}

export type World = ReturnType<typeof createWorld>;
