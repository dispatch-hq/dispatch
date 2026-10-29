import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { signToken } from '../src/lib/crypto';
import { startThread } from '../src/services/discord';
import { threadName } from '../src/services/reports';
import { createWorld, IDS, type World } from './support/harness';

/**
 * End-to-end flows through the real Worker: signed Discord interactions in,
 * GitHub + Discord REST calls out (stubbed), D1 state checked in between.
 * Tests in this file build on each other and run in order.
 */

const EPHEMERAL = 1 << 6;
const COMPONENTS_V2 = 1 << 15;

let w: World;
const memberRoles: Record<string, string[]> = {};
let nextIssue = 41;

/** Flattens every text display in a Components V2 payload. */
function textOf(payload: any): string {
  const out: string[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 10) out.push(node.content);
    for (const value of Object.values(node)) if (typeof value === 'object') walk(value);
  };
  walk(payload);
  return out.join('\n');
}

function customIds(payload: any): string[] {
  const out: string[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.custom_id === 'string') out.push(node.custom_id);
    for (const value of Object.values(node)) if (typeof value === 'object') walk(value);
  };
  walk(payload);
  return out;
}

const report = (rows: Record<string, string | string[]>, extra: Record<string, unknown> = {}) => ({
  type: 5,
  data: {
    custom_id: 'report',
    components: Object.entries(rows).map(([custom_id, value], i) => ({
      type: 18,
      id: i + 1,
      component: Array.isArray(value) ? { type: 19, custom_id, values: value } : { type: 4, custom_id, value },
    })),
    ...extra,
  },
});

const webhook = (event: string, payload: unknown, secret = 'hook-secret') => {
  const body = JSON.stringify(payload);
  return w.request('/github/webhook', {
    method: 'POST',
    body,
    headers: {
      'x-github-event': event,
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
  });
};

const reportRow = (id: number) => w.sqlite.prepare('SELECT * FROM reports WHERE id = ?').get(id) as any;
const discordCalls = (method: string, path: RegExp) => w.http.find(method, new RegExp(`discord\\.com/api/v10${path.source}`));
/** The deferred response edit for an interaction (`c.followup`). */
const followupOf = (token: string) => discordCalls('PATCH', new RegExp(`/webhooks/\\d+/${token}/messages/@original`)).at(-1)!;

beforeAll(() => {
  w = createWorld();
  vi.stubGlobal('fetch', w.http.stub);

  const { on } = w.http;
  // Discord
  on('PATCH', /discord\.com\/api\/v10\/webhooks\/\d+\/[\w-]+\/messages\/@original/, () => ({ id: 'original' }));
  let message = 0;
  on('POST', /discord\.com\/api\/v10\/channels\/([\w-]+)\/messages$/, () => ({ id: `msg-${++message}` }));
  on('PATCH', /discord\.com\/api\/v10\/channels\/[\w-]+\/messages\/[\w-]+$/, () => ({}));
  on('POST', /discord\.com\/api\/v10\/channels\/[\w-]+\/messages\/[\w-]+\/threads$/, () => ({ id: 'thread' }));
  on('POST', /discord\.com\/api\/v10\/users\/@me\/channels/, (call) => ({ id: `dm-${call.body.recipient_id}` }));
  on('GET', /discord\.com\/api\/v10\/guilds\/\d+\/members\/(\d+)$/, (_, m) => ({ roles: memberRoles[m[1]!] ?? [] }));
  on('PUT', /discord\.com\/api\/v10\/guilds\/\d+\/members\/(\d+)\/roles\/(\d+)/, (_, m) => {
    memberRoles[m[1]!] = [...(memberRoles[m[1]!] ?? []), m[2]!];
    return new Response(null, { status: 204 });
  });
  on('DELETE', /discord\.com\/api\/v10\/guilds\/\d+\/members\/(\d+)\/roles\/(\d+)/, (_, m) => {
    memberRoles[m[1]!] = (memberRoles[m[1]!] ?? []).filter((r) => r !== m[2]);
    return new Response(null, { status: 204 });
  });
  on('GET', /cdn\.discordapp\.com/, () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }));

  // GitHub
  on('POST', /github\.com\/login\/oauth\/access_token/, () => ({ access_token: 'ghu_user' }));
  on('GET', /api\.github\.com\/user$/, () => ({ login: 'octocat', avatar_url: '' }));
  on('GET', /api\.github\.com\/user\/installations\?/, () => ({ installations: [{ id: 7 }] }));
  on('GET', /api\.github\.com\/user\/installations\/7\/repositories/, () => ({
    repositories: [
      { id: 99, full_name: 'acme/app', private: false, description: 'The main <app>', language: 'TypeScript', permissions: { push: true } },
      { id: 100, full_name: 'acme/readonly', private: true, permissions: { pull: true } },
    ],
  }));
  on('POST', /api\.github\.com\/app\/installations\/7\/access_tokens/, () => ({
    token: 'ghs_installation',
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  }));
  on('POST', /api\.github\.com\/repos\/acme\/app\/issues$/, () => {
    nextIssue += 1;
    return { number: nextIssue, html_url: `https://github.com/acme/app/issues/${nextIssue}` };
  });
});

afterAll(() => vi.unstubAllGlobals());

describe('interactions endpoint', () => {
  it('answers Discord PINGs', async () => {
    const res = await w.interact({ type: 1 });
    expect(res.json).toEqual({ type: 1 });
  });

  it('rejects unsigned requests', async () => {
    const res = await w.request('/interactions', { method: 'POST', body: '{"type":1}' });
    expect(res.status).toBe(401);
  });

  it('tells members when no repository is linked', async () => {
    const res = await w.interact({ type: 2, ...w.base(IDS.member), data: { id: 'c', name: 'report', type: 1 } });
    expect(res.json.data.flags & EPHEMERAL).toBeTruthy();
    expect(textOf(res.json)).toContain("hasn't connected a repository");
  });
});

describe('linking a repository', () => {
  it('/dispatch setup returns install + sign-in links', async () => {
    const res = await w.interact({
      type: 2,
      ...w.base(IDS.admin, true),
      data: { id: 'c', name: 'dispatch', type: 1, options: [{ type: 1, name: 'setup' }] },
    });
    const json = JSON.stringify(res.json);
    expect(json).toContain('https://github.com/apps/dispatch-test/installations/new?state=');
    expect(json).toContain('https://github.com/login/oauth/authorize?client_id=Iv1.client');
  });

  it('rejects an invalid state', async () => {
    const res = await w.request('/github/callback?code=x&state=forged');
    expect(res.status).toBe(400);
  });

  it('only offers repos the user can push to, and links the chosen one', async () => {
    const state = await signToken(w.env.STATE_SECRET, { g: IDS.guild, u: IDS.admin }, 600);
    const page = await (await w.request(`/github/callback?code=abc&state=${encodeURIComponent(state)}`)).text();

    expect(page).toContain('acme/app');
    expect(page).toContain('The main &lt;app&gt;'); // description, escaped
    expect(page).toContain('TypeScript');
    expect(page).toContain('data-search="acme/app the main &lt;app&gt; typescript"');
    expect(page).not.toContain('acme/readonly');
    expect(page).toContain('@octocat');

    const token = /name="token" value="([^"]+)"/.exec(page)![1]!;
    const res = await w.request('/github/link', { method: 'POST', body: new URLSearchParams({ token }) });
    expect(res.status).toBe(200);

    const guild = w.sqlite.prepare('SELECT * FROM guilds WHERE guild_id = ?').get(IDS.guild) as any;
    expect(guild).toMatchObject({ provider: 'github', installation_id: 7, repo_id: 99, repo_full_name: 'acme/app', linked_by: IDS.admin });
    expect(discordCalls('POST', /\/users\/@me\/channels/).at(-1)!.body.recipient_id).toBe(IDS.admin);
  });

  it('redirects an install without a code to GitHub sign-in', async () => {
    const state = await signToken(w.env.STATE_SECRET, { g: IDS.guild, u: IDS.admin }, 600);
    const res = await w.request(`/github/callback?installation_id=7&setup_action=install&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('github.com/login/oauth/authorize');
  });
});

describe('reporting a bug directly', () => {
  it('/report opens the modal', async () => {
    const res = await w.interact({ type: 2, ...w.base(IDS.member), data: { id: 'c', name: 'report', type: 1 } });
    expect(res.json.type).toBe(9);
    expect(res.json.data.custom_id).toBe('report');
    expect(customIds(res.json.data.components)).toEqual(['title', 'description', 'steps', 'environment', 'files']);
  });

  it('files an issue with rehosted attachments', async () => {
    const res = await w.interact({
      ...w.base(IDS.member),
      ...report(
        {
          title: 'Crash when opening settings',
          description: 'The app closes immediately. cc @maintainer',
          steps: '1. Open app\n2. Click settings',
          environment: 'v2.3.1',
          files: ['att1', 'att2'],
        },
        {
          resolved: {
            attachments: {
              att1: { id: 'att1', filename: 'shot.png', size: 4, url: 'https://cdn.discordapp.com/a/shot.png', proxy_url: '', content_type: 'image/png' },
              att2: { id: 'att2', filename: 'page.html', size: 4, url: 'https://cdn.discordapp.com/a/page.html', proxy_url: '', content_type: 'text/html' },
            },
          },
        }
      ),
    });
    expect(res.json.type).toBe(5); // deferred
    expect(res.json.data.flags & EPHEMERAL).toBeTruthy();

    const issue = w.http.find('POST', /repos\/acme\/app\/issues$/).at(-1)!;
    expect(issue.body.title).toBe('Crash when opening settings');
    expect(issue.body.labels).toEqual(['bug']);
    expect(issue.body.body).toContain('cc @​maintainer');
    expect(issue.body.body).toMatch(/!\[shot\.png\]\(https:\/\/dispatch\.test\/files\/reports\/\d+\/[\w-]+\/shot\.png\)/);
    expect(issue.body.body).not.toContain('page.html');

    // Installation token was requested for just this repository.
    expect(w.http.find('POST', /access_tokens/).at(-1)!.body).toEqual({ repository_ids: [99] });

    const followup = followupOf(res.token);
    expect(followup.body.flags & COMPONENTS_V2).toBeTruthy();
    expect(textOf(followup.body)).toContain('Issue created');
    expect(textOf(followup.body)).toContain('page.html'); // reported as skipped

    expect(reportRow(1)).toMatchObject({ status: 'open', issue_number: 42, repo_id: 99, reporter_id: IDS.member });
  });

  it('serves rehosted files safely', async () => {
    const key = [...w.objects.keys()][0]!;
    const res = await w.request(`/files/${key}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect((await w.request('/files/../secret')).status).toBe(404);
  });

  it('enforces the per-member cooldown', async () => {
    const res = await w.interact({ type: 2, ...w.base(IDS.member), data: { id: 'c', name: 'report', type: 1 } });
    expect(textOf(res.json)).toContain('reporting a little fast');
  });

  it('pre-fills the modal from a message via the context menu', async () => {
    w.sqlite.exec(`UPDATE guilds SET cooldown_seconds = 0`);
    const res = await w.interact({
      type: 2,
      ...w.base(IDS.member),
      data: {
        id: 'c',
        name: 'Report bug',
        type: 3,
        target_id: '900',
        resolved: { messages: { '900': { id: '900', channel_id: IDS.channel, content: 'the login button does nothing' } } },
      },
    });
    expect(res.json.type).toBe(9);
    expect(res.json.data.custom_id).toBe(`report;${IDS.channel}:900`);
    expect(JSON.stringify(res.json.data)).toContain('the login button does nothing');
  });

  it("doesn't pre-fill messages shorter than the description minimum", async () => {
    const res = await w.interact({
      type: 2,
      ...w.base(IDS.member),
      data: {
        id: 'c',
        name: 'Report bug',
        type: 3,
        target_id: '901',
        resolved: { messages: { '901': { id: '901', channel_id: IDS.channel, content: 'old' } } },
      },
    });
    expect(res.json.type).toBe(9);
    expect(res.json.data.custom_id).toBe(`report;${IDS.channel}:901`);
    expect(JSON.stringify(res.json.data)).not.toContain('"value":"old"');
  });
});

describe('settings panel', () => {
  it('rejects non-admins', async () => {
    const res = await w.interact({
      type: 3,
      ...w.base(IDS.member),
      data: { custom_id: 'settings-triage', component_type: 8, values: [IDS.triage] },
    });
    expect(textOf(res.json)).toContain('Manage Server');
  });

  it('sets the triage and updates channels after confirming the bot can post there', async () => {
    for (const [id, channel] of [['settings-triage', IDS.triage], ['settings-updates', IDS.updates]] as const) {
      const res = await w.interact({
        type: 3,
        ...w.base(IDS.admin, true),
        data: { custom_id: id, component_type: 8, values: [channel] },
      });
      expect(res.json.type).toBe(7); // update message
      expect(discordCalls('POST', new RegExp(`/channels/${channel}/messages`))).toHaveLength(1);
    }
    const guild = w.sqlite.prepare('SELECT * FROM guilds').get() as any;
    expect(guild).toMatchObject({ triage_channel_id: IDS.triage, updates_channel_id: IDS.updates });
  });

  it('opens the edit modal without sending empty pre-filled values', async () => {
    // Discord rejects a modal containing `value: ""`, which shows up as "didn't respond in time".
    const emptyValues = (node: any): number =>
      !node || typeof node !== 'object'
        ? 0
        : (node.type === 4 && node.value === '' ? 1 : 0) + Object.values(node).reduce<number>((n, v) => n + emptyValues(v), 0);

    for (const labels of ['bug', '']) {
      w.sqlite.prepare('UPDATE guilds SET labels = ?').run(labels); // '' = an admin who cleared the labels
      const res = await w.interact({ type: 3, ...w.base(IDS.admin, true), data: { custom_id: 'settings-edit', component_type: 2 } });
      expect(res.json.type).toBe(9);
      expect(res.json.data.custom_id).toBe('settings-edit');
      expect(emptyValues(res.json.data)).toBe(0);
    }
    w.sqlite.prepare("UPDATE guilds SET labels = 'bug'").run();
  });

  it('keeps modal labels and descriptions within Discord limits', async () => {
    // Over-long strings are rejected the same way as empty values: "didn't respond in time".
    const res = await w.interact({ type: 3, ...w.base(IDS.admin, true), data: { custom_id: 'settings-edit', component_type: 2 } });
    const labels = res.json.data.components.filter((c: any) => c.type === 18);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.label.length).toBeLessThanOrEqual(45);
      expect((label.description ?? '').length).toBeLessThanOrEqual(100);
    }
    expect(res.json.data.title.length).toBeLessThanOrEqual(45);
  });

  it('validates the cooldown in the edit modal', async () => {
    const res = await w.interact({
      type: 5,
      ...w.base(IDS.admin, true),
      data: {
        custom_id: 'settings-edit',
        components: [
          { type: 18, component: { type: 4, custom_id: 'labels', value: 'bug, from-discord, bug' } },
          { type: 18, component: { type: 4, custom_id: 'cooldown', value: 'soon' } },
        ],
      },
    });
    expect(textOf(res.json)).toContain('Cooldown must be a whole number');

    await w.interact({
      type: 5,
      ...w.base(IDS.admin, true),
      data: {
        custom_id: 'settings-edit',
        components: [
          { type: 18, component: { type: 4, custom_id: 'labels', value: 'bug, from-discord, bug' } },
          { type: 18, component: { type: 4, custom_id: 'cooldown', value: '0' } },
        ],
      },
    });
    expect(w.sqlite.prepare('SELECT labels, cooldown_seconds FROM guilds').get()).toEqual({
      labels: 'bug, from-discord',
      cooldown_seconds: 0,
    });
  });
});

describe('triage threads', () => {
  it('names threads after the report, within Discord limits', () => {
    expect(threadName({ id: 7, title: 'Crash\non  startup' })).toBe('Report #7 · Crash on startup');
    const long = threadName({ id: 12, title: 'x'.repeat(300) });
    expect(long).toHaveLength(100);
    expect(long.startsWith('Report #12 · xxx')).toBe(true);
    expect(long.endsWith('…')).toBe(true);
  });

  it('never throws when the bot lacks permission to start a thread', async () => {
    w.http.on('POST', /\/messages\/denied\/threads$/, () => Response.json({ message: 'Missing Permissions', code: 50013 }, { status: 403 }));
    await expect(startThread(w.env, IDS.triage, 'denied', 'Report #1 · x')).resolves.toBe(false);
    await expect(startThread(w.env, IDS.triage, 'allowed', 'Report #1 · x')).resolves.toBe(true);
  });
});

describe('triage queue', () => {
  it('queues new reports for review instead of filing them', async () => {
    const before = w.http.find('POST', /repos\/acme\/app\/issues$/).length;
    const res = await w.interact({ ...w.base(IDS.member), ...report({ title: 'Typo on homepage', description: 'Says "teh" instead of "the"' }) });

    expect(w.http.find('POST', /repos\/acme\/app\/issues$/)).toHaveLength(before);
    const card = discordCalls('POST', new RegExp(`/channels/${IDS.triage}/messages$`)).at(-1)!;
    expect(customIds(card.body)).toEqual(['triage-approve;2', 'triage-reject;2']);
    expect(card.body.allowed_mentions).toEqual({ parse: [], users: [] });
    expect(reportRow(2)).toMatchObject({ status: 'pending', triage_channel_id: IDS.triage, triage_message_id: expect.any(String) });

    // Each queued report gets a discussion thread on its card.
    const thread = discordCalls('POST', new RegExp(`/channels/${IDS.triage}/messages/[\\w-]+/threads$`)).at(-1)!;
    expect(thread.url).toContain(`/messages/${reportRow(2).triage_message_id}/threads`);
    expect(thread.body).toEqual({ name: 'Report #2 · Typo on homepage', auto_archive_duration: 1440 });

    const followup = followupOf(res.token);
    expect(textOf(followup.body)).toContain('waiting for a moderator');
  });

  it('only lets staff approve', async () => {
    const res = await w.interact({ type: 3, ...w.base(IDS.member), data: { custom_id: 'triage-approve;2', component_type: 2 } });
    expect(textOf(res.json)).toContain('Only staff');
    expect(reportRow(2).status).toBe('pending');
  });

  it('files the issue on approval and notifies the reporter', async () => {
    const res = await w.interact({ type: 3, ...w.base(IDS.admin, true), data: { custom_id: 'triage-approve;2', component_type: 2 } });
    expect(res.json.type).toBe(6); // deferred update

    const issue = w.http.find('POST', /repos\/acme\/app\/issues$/).at(-1)!;
    expect(issue.body.labels).toEqual(['bug', 'from-discord']);
    expect(reportRow(2)).toMatchObject({ status: 'open', issue_number: 43, reviewed_by: IDS.admin });

    const updated = followupOf(res.token);
    expect(textOf(updated.body)).toContain('Filed');
    expect(customIds(updated.body)).toEqual([]); // buttons removed

    expect(discordCalls('POST', /\/channels\/dm-\d+\/messages/).some((c) => textOf(c.body).includes('Report approved'))).toBe(true);
    expect(discordCalls('POST', new RegExp(`/channels/${IDS.updates}/messages`)).some((c) => textOf(c.body).includes('New bug report'))).toBe(true);
  });

  it('ignores a second approval of the same report', async () => {
    const before = w.http.find('POST', /repos\/acme\/app\/issues$/).length;
    const res = await w.interact({ type: 3, ...w.base(IDS.admin, true), data: { custom_id: 'triage-approve;2', component_type: 2 } });
    expect(res.json.type).toBe(7);
    expect(w.http.find('POST', /repos\/acme\/app\/issues$/)).toHaveLength(before);
  });

  it('rejects with a reason sent to the reporter', async () => {
    await w.interact({ ...w.base(IDS.member), ...report({ title: 'Not a bug really', description: 'I would like dark mode please' }) });

    const modal = await w.interact({ type: 3, ...w.base(IDS.admin, true), data: { custom_id: 'triage-reject;3', component_type: 2 } });
    expect(modal.json.type).toBe(9);
    expect(modal.json.data.custom_id).toBe('triage-reject;3');

    const res = await w.interact({
      type: 5,
      ...w.base(IDS.admin, true),
      data: { custom_id: 'triage-reject;3', components: [{ type: 18, component: { type: 4, custom_id: 'reason', value: 'Feature request — see #ideas' } }] },
    });
    expect(res.json.type).toBe(7);
    expect(textOf(res.json)).toContain('Rejected');
    expect(reportRow(3)).toMatchObject({ status: 'rejected', review_note: 'Feature request — see #ideas' });

    const dm = discordCalls('POST', /\/channels\/dm-\d+\/messages/).at(-1)!;
    expect(textOf(dm.body)).toContain('Feature request — see #ideas');
  });
});

describe('rewards and GitHub webhooks', () => {
  it('saves a reward tier', async () => {
    const res = await w.interact({
      type: 2,
      ...w.base(IDS.admin, true),
      data: {
        id: 'c',
        name: 'dispatch',
        type: 1,
        options: [{ type: 2, name: 'rewards', options: [{ type: 1, name: 'add', options: [{ name: 'role', type: 8, value: IDS.role }, { name: 'reports', type: 4, value: 1 }] }] }],
        resolved: { roles: { [IDS.role]: { id: IDS.role, managed: false } } },
      },
    });
    expect(res.json.type).toBe(5);
    expect(w.sqlite.prepare('SELECT * FROM reward_tiers').all()).toEqual([{ guild_id: IDS.guild, role_id: IDS.role, threshold: 1 }]);
    expect(textOf(followupOf(res.token).body)).toContain('Reward saved');
  });

  it('refuses @everyone as a reward', async () => {
    const res = await w.interact({
      type: 2,
      ...w.base(IDS.admin, true),
      data: {
        id: 'c',
        name: 'dispatch',
        type: 1,
        options: [{ type: 2, name: 'rewards', options: [{ type: 1, name: 'add', options: [{ name: 'role', type: 8, value: IDS.guild }, { name: 'reports', type: 4, value: 1 }] }] }],
      },
    });
    expect(textOf(res.json)).toContain('@everyone');
  });

  it('rejects webhooks with a bad signature', async () => {
    const res = await webhook('issues', { action: 'closed' }, 'wrong-secret');
    expect(res.status).toBe(401);
  });

  it('marks a report fixed, grants the reward and celebrates', async () => {
    const res = await webhook('issues', {
      action: 'closed',
      issue: { number: 42, state_reason: 'completed' },
      repository: { id: 99, full_name: 'acme/app' },
    });
    expect(res.status).toBe(202);
    expect(reportRow(1).status).toBe('fixed');
    expect(memberRoles[IDS.member]).toContain(IDS.role);

    const updates = discordCalls('POST', new RegExp(`/channels/${IDS.updates}/messages`)).map((c) => c.body);
    expect(updates.some((b) => textOf(b).includes('Fixed') && b.allowed_mentions.users.includes(IDS.member))).toBe(true);
    expect(updates.some((b) => textOf(b).includes('earned'))).toBe(true);
  });

  it('shows progress in /stats and /leaderboard', async () => {
    const stats = await w.interact({ type: 2, ...w.base(IDS.member), data: { id: 'c', name: 'stats', type: 1 } });
    expect(textOf(stats.json)).toContain('**1** fixed · **2** filed');
    expect(textOf(stats.json)).toContain(`<@&${IDS.role}>`);

    const board = await w.interact({ type: 2, ...w.base(IDS.member), data: { id: 'c', name: 'leaderboard', type: 1 } });
    expect(board.json.data.flags & EPHEMERAL).toBeFalsy();
    expect(textOf(board.json)).toContain(`<@${IDS.member}> — **1** fixed`);
    expect(board.json.data.allowed_mentions.parse).toEqual([]);
  });

  it('keeps /stats public', async () => {
    const stats = await w.interact({ type: 2, ...w.base(IDS.member), data: { id: 'c', name: 'stats', type: 1 } });
    expect(stats.json.data.flags & EPHEMERAL).toBeFalsy();
  });

  it('/issues lists open issues anywhere and paginates', async () => {
    const insert = w.sqlite.prepare(
      `INSERT INTO reports (guild_id, reporter_id, reporter_name, title, description, status, repo_full_name, issue_number, issue_url)
       VALUES (?, ?, 'reporter', ?, 'desc', 'open', 'acme/app', ?, ?)`
    );
    for (let i = 1; i <= 6; i++) insert.run(IDS.guild, IDS.member, `Extra bug ${i}`, 900 + i, `https://github.com/acme/app/issues/${900 + i}`);

    // User-installed / DM context: `user` instead of `member`, no guild.
    const dm = { user: w.member(IDS.member).user, context: 1 };
    const first = await w.interact({ type: 2, ...dm, data: { id: 'c', name: 'issues', type: 1 } });
    expect(first.json.data.flags & EPHEMERAL).toBeTruthy();
    expect(textOf(first.json)).toContain('Page 1 of 2');
    expect(textOf(first.json)).toContain('Extra bug 6');
    expect(customIds(first.json)).toContain(`issues-page;${IDS.member}:1`);

    const next = await w.interact({
      type: 3,
      ...dm,
      message: { id: 'm', flags: EPHEMERAL | COMPONENTS_V2 },
      data: { custom_id: `issues-page;${IDS.member}:1`, component_type: 2 },
    });
    expect(next.json.type).toBe(7);
    expect(textOf(next.json)).toContain('Page 2 of 2');

    const stranger = await w.interact({
      type: 3,
      user: w.member('999').user,
      message: { id: 'm', flags: EPHEMERAL | COMPONENTS_V2 },
      data: { custom_id: `issues-page;${IDS.member}:1`, component_type: 2 },
    });
    expect(stranger.json.type).toBe(4);
    expect(textOf(stranger.json)).toContain('your own list');

    w.sqlite.prepare(`DELETE FROM reports WHERE title LIKE 'Extra bug %'`).run();
    const empty = await w.interact({ type: 2, ...dm, data: { id: 'c', name: 'issues', type: 1 } });
    expect(textOf(empty.json)).not.toContain('Extra bug');
  });

  it('takes the reward back when the issue is reopened', async () => {
    await webhook('issues', { action: 'reopened', issue: { number: 42 }, repository: { id: 99, full_name: 'acme/app' } });
    expect(reportRow(1).status).toBe('open');
    expect(memberRoles[IDS.member]).not.toContain(IDS.role);
  });

  it('does not count issues closed as not planned', async () => {
    await webhook('issues', { action: 'closed', issue: { number: 42, state_reason: 'not_planned' }, repository: { id: 99, full_name: 'acme/app' } });
    expect(reportRow(1).status).toBe('closed');
    expect(memberRoles[IDS.member]).not.toContain(IDS.role);
  });

  it('relays maintainer comments to the reporter, ignoring bots and outsiders', async () => {
    const comment = (login: string, association: string, type = 'User') =>
      webhook('issue_comment', {
        action: 'created',
        issue: { number: 43 },
        comment: { body: `Thanks! @${login} here`, html_url: 'https://github.com/acme/app/issues/43#c1', author_association: association, user: { login, type } },
        repository: { id: 99, full_name: 'acme/app' },
      });

    const before = discordCalls('POST', /\/channels\/dm-\d+\/messages/).length;
    await comment('random', 'NONE');
    await comment('dispatch[bot]', 'NONE', 'Bot');
    expect(discordCalls('POST', /\/channels\/dm-\d+\/messages/)).toHaveLength(before);

    await comment('maintainer', 'MEMBER');
    const dm = discordCalls('POST', /\/channels\/dm-\d+\/messages/).at(-1)!;
    expect(textOf(dm.body)).toContain('**maintainer** commented');
    expect(JSON.stringify(dm.body)).toContain('https://github.com/acme/app/issues/43#c1');
  });

  it('follows repository renames', async () => {
    await webhook('repository', { action: 'renamed', repository: { id: 99, full_name: 'acme/app-v2' } });
    expect(w.sqlite.prepare('SELECT repo_full_name FROM guilds').get()).toEqual({ repo_full_name: 'acme/app-v2' });
    await webhook('repository', { action: 'renamed', repository: { id: 99, full_name: 'acme/app' } });
  });

  it('unlinks the server when the app is uninstalled', async () => {
    await webhook('installation', { action: 'deleted', installation: { id: 7 } });
    const guild = w.sqlite.prepare('SELECT provider, repo_id, triage_channel_id FROM guilds').get();
    expect(guild).toEqual({ provider: null, repo_id: null, triage_channel_id: IDS.triage }); // settings survive
  });
});

describe('web', () => {
  it('renders sign-in pages inside the static site shell, uncached', async () => {
    const original = w.env.ASSETS;
    const requested: string[] = [];
    w.env.ASSETS = {
      fetch: async (input: Request | URL | string) => {
        requested.push(String(input instanceof Request ? input.url : input));
        return new Response('<title>%%DISPATCH_TITLE%% · Dispatch</title><nav>site nav</nav><div>%%DISPATCH_CONTENT%%</div>', {
          headers: { 'content-type': 'text/html' },
        });
      },
    } as unknown as Fetcher;

    try {
      const res = await w.request('/github/callback?code=x&state=forged');
      const page = await res.text();
      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(requested[0]).toMatch(/\/shell\/$/);
      expect(page).toContain('<nav>site nav</nav>');
      expect(page).toContain('<title>Link expired · Dispatch</title>');
      expect(page).toContain('Run /dispatch setup in Discord');
      expect(page).not.toContain('%%DISPATCH');
    } finally {
      w.env.ASSETS = original;
    }
  });

  it('hands GET / to the static site', async () => {
    const res = await w.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('site');
  });

  it('redirects /invite to the Discord authorize page', async () => {
    const res = await w.request('/invite');
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location).toContain(`client_id=${IDS.app}`);
    expect(location).toContain('scope=bot+applications.commands');
  });
});

describe('report types', () => {
  const lastIssue = () => w.http.find('POST', /repos\/acme\/app\/issues$/).at(-1)!;
  const latestReport = () => w.sqlite.prepare('SELECT * FROM reports ORDER BY id DESC LIMIT 1').get() as any;
  const submit = (customId: string, title: string) =>
    w.interact({ ...w.base(IDS.member), ...report({ title, description: 'Something is clearly broken here' }, { custom_id: customId }) });

  const settingsSubmit = (types: string) =>
    w.interact({
      type: 5,
      ...w.base(IDS.admin, true),
      data: {
        custom_id: 'settings-edit',
        components: [
          { type: 18, component: { type: 4, custom_id: 'labels', value: 'bug' } },
          { type: 18, component: { type: 4, custom_id: 'types', value: types } },
          { type: 18, component: { type: 4, custom_id: 'cooldown', value: '0' } },
        ],
      },
    });

  beforeAll(() => {
    // The earlier flows left this server unlinked; start from a plain, directly-filing setup.
    w.sqlite.exec(
      `UPDATE guilds SET provider = 'github', installation_id = 7, repo_id = 99, repo_full_name = 'acme/app',
         triage_channel_id = NULL, labels = 'bug', report_types = '', cooldown_seconds = 0`
    );
  });

  it('goes straight to the form when a server has no types (nothing to migrate)', async () => {
    const res = await w.interact({ type: 2, ...w.base(IDS.member), data: { id: 'c', name: 'report', type: 1 } });
    expect(res.json.type).toBe(9);
    expect(res.json.data.custom_id).toBe('report');
  });

  it('saves types from the settings modal, deduplicated, and caps them', async () => {
    await settingsSubmit('Crash, UI, crash, Performance');
    expect(w.sqlite.prepare('SELECT report_types FROM guilds').get()).toEqual({ report_types: 'Crash, UI, Performance' });

    const tooMany = await settingsSubmit('a,b,c,d,e,f,g,h,i,j,k');
    expect(textOf(tooMany.json)).toContain('at most 10');
    expect(w.sqlite.prepare('SELECT report_types FROM guilds').get()).toEqual({ report_types: 'Crash, UI, Performance' });
  });

  it('asks for a type before opening the form, and carries it into the modal', async () => {
    const picker = await w.interact({ type: 2, ...w.base(IDS.member), data: { id: 'c', name: 'report', type: 1 } });
    expect(picker.json.type).toBe(4);
    expect(picker.json.data.flags & EPHEMERAL).toBeTruthy();
    expect(customIds(picker.json)).toEqual(['report-type']);
    for (const type of ['Crash', 'UI', 'Performance']) expect(JSON.stringify(picker.json)).toContain(`"label":"${type}"`);

    const modal = await w.interact({ type: 3, ...w.base(IDS.member), data: { custom_id: 'report-type', component_type: 3, values: ['1'] } });
    expect(modal.json.type).toBe(9);
    expect(modal.json.data.custom_id).toBe('report;1|');
    expect(modal.json.data.title).toBe('Report a bug · UI');
  });

  it('files the issue with the base labels plus the chosen type', async () => {
    const res = await submit('report;1|', 'Settings page is blank');
    expect(textOf(followupOf(res.token).body)).toContain('Issue created');
    expect(lastIssue().body.labels).toEqual(['bug', 'UI']);
    expect(latestReport()).toMatchObject({ report_type: 'UI', status: 'open' });
  });

  it('ignores a type index the server no longer offers', async () => {
    await submit('report;9|', 'Stale form submission');
    expect(lastIssue().body.labels).toEqual(['bug']);
    expect(latestReport().report_type).toBeNull();
  });

  it('still accepts a form opened before report types existed', async () => {
    await submit(`report;${IDS.channel}:900`, 'Old style form');
    expect(latestReport()).toMatchObject({ report_type: null, source_url: expect.stringContaining('/900') });
    expect(lastIssue().body.labels).toEqual(['bug']);
  });

  it('keeps a reported message pre-filled through the picker, for its owner only', async () => {
    const target = { id: '900', channel_id: IDS.channel, content: 'the login button does nothing' };
    const picker = await w.interact({
      type: 2,
      ...w.base(IDS.member),
      data: { id: 'c', name: 'Report bug', type: 3, target_id: '900', resolved: { messages: { '900': target } } },
    });
    expect(picker.json.type).toBe(4);
    const [select] = customIds(picker.json);
    expect(select).toMatch(/^report-type;\d+$/);

    const own = await w.interact({ type: 3, ...w.base(IDS.member), data: { custom_id: select, component_type: 3, values: ['0'] } });
    expect(own.json.data.custom_id).toBe(`report;0|${IDS.channel}:900`);
    expect(JSON.stringify(own.json.data)).toContain('the login button does nothing');

    const other = await w.interact({ type: 3, ...w.base('999'), data: { custom_id: select, component_type: 3, values: ['0'] } });
    expect(other.json.type).toBe(9);
    expect(JSON.stringify(other.json.data)).not.toContain('the login button does nothing');
  });

  it('shows the type on the triage card and applies it when staff approve', async () => {
    w.sqlite.exec(`UPDATE guilds SET triage_channel_id = '${IDS.triage}'`);
    await submit('report;0|', 'Crash on export');
    const id = latestReport().id;

    const card = discordCalls('POST', new RegExp(`/channels/${IDS.triage}/messages$`)).at(-1)!;
    expect(textOf(card.body)).toContain('· Crash');
    expect(latestReport()).toMatchObject({ status: 'pending', report_type: 'Crash' });

    await w.interact({ type: 3, ...w.base(IDS.admin, true), data: { custom_id: `triage-approve;${id}`, component_type: 2 } });
    expect(lastIssue().body.labels).toEqual(['bug', 'Crash']);
  });
});
