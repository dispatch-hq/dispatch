import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { base64UrlDecode } from '../src/lib/crypto';
import { reputation } from '../src/services/reputation';
import { createWorld, IDS, type World } from './support/harness';

/**
 * Upvotes, reputation, saved replies and the status board, end to end. Tests in
 * this file build on each other and run in order.
 */

const EPHEMERAL = 1 << 6;
const BOARD = '910000000000000010';
const VOTER = '920000000000000011';
const VOTER_2 = '930000000000000012';

let w: World;
let nextIssue = 100;
let nextMessage = 0;

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

/** What the message's image shows, read back from its signed URL. */
function imageData(payload: any): any {
  const match = /\/cards\/([\w-]+)\.[\w-]+\.png/.exec(JSON.stringify(payload));
  return match ? JSON.parse(new TextDecoder().decode(base64UrlDecode(match[1]!))) : null;
}

const discordCalls = (method: string, path: RegExp) => w.http.find(method, new RegExp(`discord\\.com/api/v10${path.source}`));
const followupOf = (token: string) => discordCalls('PATCH', new RegExp(`/webhooks/\\d+/${token}/messages/@original`)).at(-1)!;
const row = (id: number) => w.sqlite.prepare('SELECT * FROM reports WHERE id = ?').get(id) as any;
const latest = () => w.sqlite.prepare('SELECT * FROM reports ORDER BY id DESC LIMIT 1').get() as any;
const edits = (messageId: string) => discordCalls('PATCH', new RegExp(`/channels/\\d+/messages/${messageId}$`));

const submit = (title: string, who: string = IDS.member) =>
  w.interact({
    ...w.base(who),
    type: 5,
    data: {
      custom_id: 'report',
      components: [
        { type: 18, component: { type: 4, custom_id: 'title', value: title } },
        { type: 18, component: { type: 4, custom_id: 'description', value: 'Something is clearly broken here' } },
      ],
    },
  });

const press = (customId: string, who: string = IDS.admin, admin = true, extra: Record<string, unknown> = {}) =>
  w.interact({ type: 3, ...w.base(who, admin), ...extra, data: { custom_id: customId, component_type: 2 } });

const dispatch = (group: string, sub: string, options: unknown[] = []) =>
  w.interact({
    type: 2,
    ...w.base(IDS.admin, true),
    data: { id: 'c', name: 'dispatch', type: 1, options: [{ type: 2, name: group, options: [{ type: 1, name: sub, options }] }] },
  });

const webhook = (event: string, payload: unknown) => {
  const body = JSON.stringify(payload);
  return w.request('/github/webhook', {
    method: 'POST',
    body,
    headers: {
      'x-github-event': event,
      'x-hub-signature-256': `sha256=${createHmac('sha256', 'hook-secret').update(body).digest('hex')}`,
    },
  });
};

beforeAll(() => {
  w = createWorld();
  vi.stubGlobal('fetch', w.http.stub);

  const { on } = w.http;
  on('PATCH', /discord\.com\/api\/v10\/webhooks\/\d+\/[\w-]+\/messages\/@original/, () => ({ id: 'original' }));
  on('POST', /discord\.com\/api\/v10\/channels\/[\w-]+\/messages$/, () => ({ id: `${++nextMessage}` }));
  on('PATCH', /discord\.com\/api\/v10\/channels\/[\w-]+\/messages\/[\w-]+$/, () => ({}));
  on('DELETE', /discord\.com\/api\/v10\/channels\/[\w-]+\/messages\/[\w-]+$/, () => new Response(null, { status: 204 }));
  on('POST', /discord\.com\/api\/v10\/channels\/[\w-]+\/messages\/[\w-]+\/threads$/, () => ({ id: 'thread' }));
  on('POST', /discord\.com\/api\/v10\/users\/@me\/channels/, (call) => ({ id: `dm-${call.body.recipient_id}` }));
  on('POST', /api\.github\.com\/app\/installations\/7\/access_tokens/, () => ({
    token: 'ghs_installation',
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  }));
  on('POST', /api\.github\.com\/repos\/acme\/app\/issues$/, () => {
    nextIssue += 1;
    return { number: nextIssue, html_url: `https://github.com/acme/app/issues/${nextIssue}` };
  });

  w.sqlite.exec(
    `INSERT INTO guilds (guild_id, triage_channel_id, updates_channel_id, cooldown_seconds) VALUES ('${IDS.guild}', '${IDS.triage}', '${IDS.updates}', 0);
     INSERT INTO guild_repos (guild_id, provider, installation_id, repo_id, repo_full_name) VALUES ('${IDS.guild}', 'github', 7, 99, 'acme/app');`
  );
});

afterAll(() => vi.unstubAllGlobals());

describe('upvotes', () => {
  it('draws the card with no votes to begin with', async () => {
    await submit('Crash when opening settings');
    const card = discordCalls('POST', new RegExp(`/channels/${IDS.triage}/messages$`)).at(-1)!;
    expect(imageData(card.body)).toMatchObject({ k: 'report', title: 'Crash when opening settings', status: 'pending', votes: 0 });
    expect(customIds(card.body)).toContain('report-vote;1');
  });

  it('defers, counts the vote and redraws the image with the new number', async () => {
    const before = edits(row(1).triage_message_id).length;
    const res = await press('report-vote;1', VOTER, false);

    expect(res.json.type).toBe(5);
    expect(res.json.data.flags & EPHEMERAL).toBeTruthy();
    expect(textOf(followupOf(res.token).body)).toContain('**1**');
    expect(row(1).votes).toBe(1);

    const edit = edits(row(1).triage_message_id);
    expect(edit).toHaveLength(before + 1);
    expect(imageData(edit.at(-1)!.body).votes).toBe(1);
    expect(JSON.stringify(edit.at(-1)!.body)).toContain('Upvote · 1');
  });

  it('goes from 1 to 2 with a different image URL', async () => {
    const urlOf = (body: any) => /\/cards\/[^"]+/.exec(JSON.stringify(body))![0];
    const first = urlOf(edits(row(1).triage_message_id).at(-1)!.body);
    await press('report-vote;1', VOTER_2, false);
    const second = edits(row(1).triage_message_id).at(-1)!.body;
    expect(imageData(second).votes).toBe(2);
    expect(urlOf(second)).not.toBe(first);
  });

  it('takes a vote back on a second click', async () => {
    const res = await press('report-vote;1', VOTER_2, false);
    expect(textOf(followupOf(res.token).body)).toContain('Upvote removed');
    expect(row(1).votes).toBe(1);
    expect(imageData(edits(row(1).triage_message_id).at(-1)!.body).votes).toBe(1);
  });

  it("doesn't let reporters vote for themselves", async () => {
    const res = await press('report-vote;1', IDS.member, false);
    expect(textOf(followupOf(res.token).body)).toContain('your own report');
    expect(row(1).votes).toBe(1);
  });

  it('keeps the votes on the updates post after approval, and keeps it current', async () => {
    await press('triage-approve;1');
    const { announce_message_id: post, votes } = row(1);
    expect(post).toEqual(expect.any(String));
    expect(votes).toBe(1);

    const before = edits(post).length;
    await press('report-vote;1', VOTER_2, false);
    expect(edits(post)).toHaveLength(before + 1);
    expect(imageData(edits(post).at(-1)!.body)).toMatchObject({ status: 'open', votes: 2 });
  });

  it('redraws every message when the issue is fixed, and closes voting', async () => {
    const { triage_message_id: card, announce_message_id: post, issue_number: number } = row(1);
    await webhook('issues', { action: 'closed', issue: { number, state_reason: 'completed' }, repository: { id: 99, full_name: 'acme/app' } });

    for (const id of [card, post]) {
      const body = edits(id).at(-1)!.body;
      expect(imageData(body).status).toBe('fixed');
      expect(customIds(body)).not.toContain('report-vote;1');
    }
    const res = await press('report-vote;1', '940000000000000013', false);
    expect(textOf(followupOf(res.token).body)).toContain('closed');
  });
});

describe('saved replies', () => {
  it('saves replies and offers them when rejecting', async () => {
    const saved = await dispatch('replies', 'add', [
      { name: 'name', type: 3, value: 'Needs steps' },
      { name: 'text', type: 3, value: 'Please add steps to reproduce.' },
    ]);
    expect(saved.json.type).toBe(5);
    expect(textOf(followupOf(saved.token).body)).toContain('Saved');

    await submit('Vague report');
    const id = latest().id;
    const picker = await press(`triage-reject;${id}`);
    expect(picker.json.type).toBe(4);
    expect(picker.json.data.flags & EPHEMERAL).toBeTruthy();
    expect(customIds(picker.json)).toEqual([`triage-canned;reject:${id}`]);
    expect(JSON.stringify(picker.json)).toContain('Needs steps');
    expect(JSON.stringify(picker.json)).toContain('Write my own');
  });

  it('rejects with the saved text, redraws the card and tells the reporter', async () => {
    const id = latest().id;
    const reply = w.sqlite.prepare('SELECT id FROM canned_replies').get() as any;
    const res = await w.interact({
      type: 3,
      ...w.base(IDS.admin, true),
      data: { custom_id: `triage-canned;reject:${id}`, component_type: 3, values: [String(reply.id)] },
    });
    expect(res.json.type).toBe(6);
    expect(row(id)).toMatchObject({ status: 'rejected', review_note: 'Please add steps to reproduce.' });
    expect(imageData(edits(row(id).triage_message_id).at(-1)!.body).status).toBe('rejected');
    expect(textOf(discordCalls('POST', /\/channels\/dm-\d+\/messages/).at(-1)!.body)).toContain('Please add steps');
  });

  it('still opens the form for "write my own"', async () => {
    await submit('Another one');
    const res = await w.interact({
      type: 3,
      ...w.base(IDS.admin, true),
      data: { custom_id: `triage-canned;reject:${latest().id}`, component_type: 3, values: ['custom'] },
    });
    expect(res.json.type).toBe(9);
    expect(res.json.data.custom_id).toBe(`triage-reject;${latest().id}`);
  });

  it('only lets staff use a reply', async () => {
    const id = latest().id;
    const reply = w.sqlite.prepare('SELECT id FROM canned_replies').get() as any;
    const res = await w.interact({
      type: 3,
      ...w.base(IDS.member),
      data: { custom_id: `triage-canned;reject:${id}`, component_type: 3, values: [String(reply.id)] },
    });
    expect(textOf(followupOf(res.token).body)).toContain('Only staff');
    expect(row(id).status).toBe('pending');
  });

  it('removes replies, and goes back to the plain form without any', async () => {
    const removed = await dispatch('replies', 'remove', [{ name: 'name', type: 3, value: 'needs steps' }]);
    expect(textOf(followupOf(removed.token).body)).toContain('Removed');
    const modal = await press(`triage-reject;${latest().id}`);
    expect(modal.json.type).toBe(9);
  });
});

describe('asking the reporter for information', () => {
  const ask = (id: number, question: string) =>
    w.interact({
      type: 5,
      ...w.base(IDS.admin, true),
      data: { custom_id: `triage-info;${id}`, components: [{ type: 18, component: { type: 4, custom_id: 'question', value: question } }] },
    });

  it('DMs the question with a button, and shows it on the card', async () => {
    const id = latest().id;
    const res = await ask(id, 'Which version are you on?');
    expect(res.json.type).toBe(5);
    expect(textOf(followupOf(res.token).body)).toContain('Asked');
    expect(row(id)).toMatchObject({ status: 'pending', info_request: 'Which version are you on?', info_requested_by: IDS.admin });

    const dm = discordCalls('POST', /\/channels\/dm-\d+\/messages/).at(-1)!;
    expect(textOf(dm.body)).toContain('Which version are you on?');
    expect(customIds(dm.body)).toEqual([`report-info;${id}`]);

    const card = edits(row(id).triage_message_id).at(-1)!.body;
    expect(imageData(card).status).toBe('info');
    expect(textOf(card)).toContain('Waiting on the reporter');
  });

  it('only the reporter can answer', async () => {
    const id = latest().id;
    const dm = { user: w.member(VOTER).user, context: 1 };
    const res = await w.interact({ type: 3, ...dm, data: { custom_id: `report-info;${id}`, component_type: 2 } });
    expect(textOf(res.json)).toContain('no longer exists');
  });

  it('adds the answer to the report, updates the card and tells staff in the thread', async () => {
    const id = latest().id;
    const dm = { user: w.member(IDS.member).user, context: 1 };
    const modal = await w.interact({ type: 3, ...dm, data: { custom_id: `report-info;${id}`, component_type: 2 } });
    expect(modal.json.type).toBe(9);

    const res = await w.interact({
      type: 5,
      ...dm,
      data: { custom_id: `report-info;${id}`, components: [{ type: 18, component: { type: 4, custom_id: 'details', value: 'v2.3.1 on Windows' } }] },
    });
    expect(res.json.type).toBe(5);
    expect(textOf(followupOf(res.token).body)).toContain('Thanks');

    expect(row(id).info_request).toBeNull();
    expect(row(id).description).toContain('v2.3.1 on Windows');
    const { triage_message_id: card } = row(id);
    expect(imageData(edits(card).at(-1)!.body).status).toBe('pending');
    const thread = discordCalls('POST', new RegExp(`/channels/${card}/messages$`)).at(-1)!;
    expect(textOf(thread.body)).toContain('v2.3.1 on Windows');
    expect(thread.body.allowed_mentions.users).toEqual([IDS.admin]);
  });

  it("won't accept a second answer", async () => {
    const id = latest().id;
    const dm = { user: w.member(IDS.member).user, context: 1 };
    const res = await w.interact({ type: 3, ...dm, data: { custom_id: `report-info;${id}`, component_type: 2 } });
    expect(textOf(res.json)).toContain('no longer need');
  });

  it("won't let staff question their own report", async () => {
    await submit('My own report', IDS.admin);
    const id = latest().id;
    const res = await press(`triage-info;${id}`);
    expect(textOf(res.json)).toContain("can't ask a question about your own report");
    expect(res.json.data.flags & EPHEMERAL).toBeTruthy();

    const sent = discordCalls('POST', /\/channels\/dm-\d+\/messages/).length;
    const forced = await ask(id, 'Asking myself');
    expect(textOf(followupOf(forced.token).body)).toContain("can't ask a question about your own report");
    expect(row(id).info_request).toBeNull();
    expect(discordCalls('POST', /\/channels\/dm-\d+\/messages/)).toHaveLength(sent);
  });
});

describe('reporter reputation', () => {
  const stats = (over: Partial<Parameters<typeof reputation>[0]>) => ({ total: 0, pending: 0, open: 0, fixed: 0, rejected: 0, closed: 0, ...over });

  it('counts rejections and unfixed closures against a reporter', () => {
    expect(reputation(stats({}), null).rate).toBeNull();
    expect(reputation(stats({ open: 1, fixed: 3 }), null).rate).toBe(100);
    expect(reputation(stats({ fixed: 3, rejected: 1 }), null).rate).toBe(75);
    expect(reputation(stats({ fixed: 1, closed: 1 }), null).rate).toBe(50);
  });

  it('only trusts when the server opted in and both bars are met', () => {
    const good = stats({ fixed: 10 });
    expect(reputation(good, { trust_min_reports: 0 }).trusted).toBe(false);
    expect(reputation(good, { trust_min_reports: 10 }).trusted).toBe(true);
    expect(reputation(good, { trust_min_reports: 11 }).trusted).toBe(false);
    expect(reputation(stats({ fixed: 10, rejected: 2 }), { trust_min_reports: 10 }).trusted).toBe(false);
  });

  it('fast-tracks a trusted reporter past triage, and only them', async () => {
    const insert = w.sqlite.prepare(
      `INSERT INTO reports (guild_id, reporter_id, reporter_name, title, description, status) VALUES (?, ?, 'pro', 'Old', 'd', 'fixed')`
    );
    const pro = '950000000000000014';
    for (let i = 0; i < 3; i++) insert.run(IDS.guild, pro);

    const save = await w.interact({
      type: 5,
      ...w.base(IDS.admin, true),
      data: {
        custom_id: 'settings-edit',
        components: [
          { type: 18, component: { type: 4, custom_id: 'labels', value: 'bug' } },
          { type: 18, component: { type: 4, custom_id: 'cooldown', value: '0' } },
          { type: 18, component: { type: 4, custom_id: 'trust', value: '3' } },
        ],
      },
    });
    expect(textOf(save.json)).toContain('3+ accepted');

    const res = await submit('From a pro', pro);
    expect(latest()).toMatchObject({ status: 'open', reviewed_by: null, triage_message_id: null });
    expect(textOf(followupOf(res.token).body)).toContain('Issue created');

    await submit('From someone else', VOTER);
    expect(latest()).toMatchObject({ status: 'pending' });
    expect(textOf(discordCalls('POST', new RegExp(`/channels/${IDS.triage}/messages$`)).at(-1)!.body)).toContain('New reporter');
  });

  it('rejects a fast-track setting that is not a number', async () => {
    const save = await w.interact({
      type: 5,
      ...w.base(IDS.admin, true),
      data: {
        custom_id: 'settings-edit',
        components: [
          { type: 18, component: { type: 4, custom_id: 'cooldown', value: '0' } },
          { type: 18, component: { type: 4, custom_id: 'trust', value: 'lots' } },
        ],
      },
    });
    expect(textOf(save.json)).toContain('Fast-track must be');
  });

  it('shows reputation in /stats, with an image, deferred', async () => {
    const res = await w.interact({ type: 2, ...w.base(IDS.member), data: { id: 'c', name: 'stats', type: 1 } });
    expect(res.json.type).toBe(5);
    const body = followupOf(res.token).body;
    expect(imageData(body)).toMatchObject({ k: 'profile', name: 'reporter', fixed: 1 });
    expect(textOf(body)).toContain('accepted');
  });

  it('draws the leaderboard', async () => {
    const res = await w.interact({ type: 2, ...w.base(IDS.member), data: { id: 'c', name: 'leaderboard', type: 1 } });
    expect(imageData(followupOf(res.token).body).rows[0]).toEqual({ name: 'pro', fixed: 3 });
  });

  it('mutes and unmutes members', async () => {
    const mute = await dispatch('reporters', 'mute', [{ name: 'member', type: 6, value: VOTER_2 }]);
    expect(mute.json.type).toBe(5);

    const report = await w.interact({ type: 2, ...w.base(VOTER_2), data: { id: 'c', name: 'report', type: 1 } });
    expect(textOf(report.json)).toContain("can't file reports");

    const vote = await press(`report-vote;${latest().id}`, VOTER_2, false);
    expect(textOf(followupOf(vote.token).body)).toContain("can't file reports");

    const list = await dispatch('reporters', 'muted');
    expect(textOf(followupOf(list.token).body)).toContain(VOTER_2);

    await dispatch('reporters', 'unmute', [{ name: 'member', type: 6, value: VOTER_2 }]);
    const again = await w.interact({ type: 2, ...w.base(VOTER_2), data: { id: 'c', name: 'report', type: 1 } });
    expect(again.json.type).toBe(9);
  });
});

describe('status board', () => {
  const pickBoard = (values: string[]) =>
    w.interact({ type: 3, ...w.base(IDS.admin, true), data: { custom_id: 'settings-board', component_type: 8, values } });
  const posts = () => discordCalls('POST', new RegExp(`/channels/${BOARD}/messages$`));
  const boardMessage = () => (w.sqlite.prepare('SELECT board_message_id AS id FROM guilds').get() as any).id as string;

  it('is admin only', async () => {
    const res = await w.interact({ type: 3, ...w.base(IDS.member), data: { custom_id: 'settings-board', component_type: 8, values: [BOARD] } });
    expect(textOf(res.json)).toContain('Manage Server');
  });

  it('posts the board in the chosen channel, deferred', async () => {
    const res = await pickBoard([BOARD]);
    expect(res.json.type).toBe(6);
    expect(posts()).toHaveLength(1);
    expect(imageData(posts()[0]!.body)).toMatchObject({ k: 'board', repo: 'acme/app' });
    expect(boardMessage()).toEqual(expect.any(String));
  });

  it('updates when a new report comes in', async () => {
    const before = imageData(posts()[0]!.body).pending;
    await submit('Yet another bug', VOTER);
    const edit = edits(boardMessage()).at(-1)!;
    expect(imageData(edit.body).pending).toBe(before + 1);
  });

  it('shows the most upvoted, and redraws as the count changes', async () => {
    await press(`report-vote;${latest().id}`, VOTER_2, false);
    const { top } = imageData(edits(boardMessage()).at(-1)!.body);
    expect(top[0]).toEqual({ title: 'Yet another bug', votes: 1 });
  });

  it("doesn't edit when nothing it shows has changed", async () => {
    const { refreshBoard } = await import('../src/services/board');
    const before = edits(boardMessage()).length;
    await refreshBoard(w.env, IDS.guild);
    expect(edits(boardMessage())).toHaveLength(before);
  });

  it('warns when it cannot post, and changes nothing', async () => {
    w.http.on('POST', /\/channels\/1234\/messages$/, () => Response.json({ message: 'Missing Access' }, { status: 403 }));
    const id = boardMessage();
    const res = await pickBoard(['1234']);
    expect(textOf(followupOf(res.token).body)).toContain("can't post in");
    expect(boardMessage()).toBe(id);
  });

  it('removes the old message when turned off', async () => {
    const id = boardMessage();
    await pickBoard([]);
    expect(discordCalls('DELETE', new RegExp(`/channels/${BOARD}/messages/${id}$`))).toHaveLength(1);
    expect(boardMessage()).toBeNull();
  });
});
