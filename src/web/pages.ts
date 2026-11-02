import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { GuildChannel, GuildDetails } from '../services/admin-servers';
import type { AdminServerRow, AdminServerSummary, Bindings } from '../types';

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

/** A page the Worker renders per request: a title and the content for the site's shell. */
export type Page = { title: string; body: Html };

/* -------------------------------------------------------------------------- */
/*                                    Shell                                   */
/* -------------------------------------------------------------------------- */

const TITLE_SLOT = '%%DISPATCH_TITLE%%';
const CONTENT_SLOT = '%%DISPATCH_CONTENT%%';

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Bare-bones page used if the site's shell can't be loaded (e.g. before the first site build). */
function plainPage(title: string, content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} · Dispatch</title></head><body style="margin:0;padding:48px 20px;background:#151618;color:#eeeef2;font:16px/1.6 system-ui,sans-serif"><main style="max-width:640px;margin:0 auto">${content}</main></body></html>`;
}

/**
 * Renders a page inside the static site's frame (`site/src/pages/shell.astro`),
 * so it shares the site's navigation, footer and styles. Falls back to a plain
 * page rather than failing the sign-in flow.
 */
export async function renderPage(env: Bindings, requestUrl: string, page: Page): Promise<string> {
  const content = (await page.body).toString();

  try {
    const res = await env.ASSETS.fetch(new URL('/shell/', requestUrl));
    const shell = res.ok ? await res.text() : '';
    if (shell.includes(CONTENT_SLOT)) {
      // Replacer functions, so `$` in user-visible text is never treated as a pattern.
      return shell.replace(TITLE_SLOT, () => escapeHtml(page.title)).replace(CONTENT_SLOT, () => content);
    }
  } catch (error) {
    console.error('shell unavailable', error);
  }
  return plainPage(page.title, content);
}

/* -------------------------------------------------------------------------- */
/*                                    Pages                                   */
/* -------------------------------------------------------------------------- */

type Kind = 'info' | 'error' | 'success';

const LABELS: Record<Kind, string> = {
  info: 'Dispatch',
  error: 'Something went wrong',
  success: 'All set',
};

export function messagePage(title: string, message: string, kind: Kind = 'info', another?: string): Page {
  const action =
    kind === 'success'
      ? html`<a class="button large" href="https://discord.com/app">Open Discord <span aria-hidden="true">→</span></a>
          ${another ? html`<a class="button large ghost" href="${another}">Add another repository</a>` : ''}`
      : html`<a class="button large ghost" href="/">Back to home</a>`;

  return {
    title,
    body: html`<div class="panel">
      <span class="index ${kind}">${LABELS[kind]}</span>
      <h1 class="panel-title">${title}</h1>
      <p class="lede">${message}</p>
      <div class="cta">${action}</div>
    </div>`,
  };
}

export type RepoChoice = {
  fullName: string;
  private: boolean;
  description: string | null;
  language: string | null;
  /** Signed grant to link it. Empty when it is already connected to this server. */
  token: string;
  connected: boolean;
};

const searchIcon = raw(
  `<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>`
);

function repoCard(repo: RepoChoice): Html {
  // The whole card is the submit button. Search (see site/src/pages/shell.astro)
  // matches against `data-search`.
  const search = `${repo.fullName} ${repo.description ?? ''} ${repo.language ?? ''}`.toLowerCase();
  return html`<form class="repo-form" method="post" action="/github/link" data-repo data-search="${search}">
    <input type="hidden" name="token" value="${repo.token}" />
    <button class="repo-card" type="submit" ${repo.connected ? raw('disabled aria-disabled="true"') : ''}>
      <span class="repo-head">
        <span class="repo-name">${repo.fullName}</span>
        ${repo.private ? html`<span class="chip">Private</span>` : ''}
        ${repo.connected ? html`<span class="chip">Connected</span>` : ''}
      </span>
      <span class="repo-desc ${repo.description ? '' : 'none'}">${repo.description ?? 'No description'}</span>
      <span class="repo-foot">
        <span class="repo-lang">${repo.language ?? ''}</span>
        <span class="repo-go">${repo.connected ? 'Already connected' : html`Connect <span aria-hidden="true">→</span>`}</span>
      </span>
    </button>
  </form>`;
}

export type PickerMode = {
  /** The server has Premium, so a new repository is added next to the existing ones. */
  premium: boolean;
  /** Repositories already connected to the server. */
  connected: number;
  max: number;
};

function intro({ premium, connected, max }: PickerMode): string {
  if (premium) {
    return `Bug reports from your server can go to any connected repository, and members choose which when they report. ${connected} of ${max} connected.`;
  }
  return connected
    ? `Bug reports from your server will be filed in the repository you pick, which replaces ${connected === 1 ? 'the one' : 'the ones'} already connected. Dispatch Pro lets one server connect up to ${max}.`
    : 'Bug reports from your server will be filed as issues in the repository you pick.';
}

export function repoPickerPage(opts: { login: string; repos: RepoChoice[]; installUrl: string; mode: PickerMode }): Page {
  const total = opts.repos.length;

  const head = html`<div class="picker-head">
    <span class="index">Connect a repository</span>
    <h1 class="panel-title">Choose a <em>repository.</em></h1>
    <p class="lede">
      Signed in as <strong>@${opts.login}</strong>. ${intro(opts.mode)}
    </p>
  </div>`;

  const body = total
    ? html`<div class="repo-tools">
          <label class="search">
            ${searchIcon}
            <input type="search" placeholder="Search repositories…" aria-label="Search repositories" autocomplete="off" data-repo-search />
          </label>
          <span class="repo-count" data-repo-count data-total="${total}">${total} ${total === 1 ? 'repository' : 'repositories'}</span>
        </div>
        <div class="repo-grid">${opts.repos.map(repoCard)}</div>
        <p class="repo-empty" data-repo-empty hidden>No repositories match your search.</p>`
    : html`<div class="panel">
        <p class="lede">
          Dispatch isn't installed on any repository you can push to yet. Install it first, then you'll be
          brought straight back here.
        </p>
      </div>`;

  return {
    title: 'Choose a repository',
    body: html`<div class="picker">
      ${head} ${body}
      <div class="picker-foot">
        <a class="button ${total ? 'ghost' : ''}" href="${opts.installUrl}">
          ${total ? 'Install on another repository' : 'Install the GitHub App'}
        </a>
        <p class="command-note">Only repositories where the app is installed and you have write access are shown.</p>
      </div>
    </div>`,
  };
}

/* -------------------------------------------------------------------------- */
/*                               Admin: servers                               */
/* -------------------------------------------------------------------------- */

const CDN = 'https://cdn.discordapp.com';

const count = (value: number | null | undefined) => (value === null || value === undefined ? '–' : value.toLocaleString('en-US'));
const date = (ms: number | null) => (ms === null ? '–' : new Date(ms).toISOString().slice(0, 10));
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

function serverIcon(id: string, icon: string | null, name: string): Html {
  return icon
    ? html`<img class="server-icon" src="${CDN}/icons/${id}/${icon}.webp?size=96" alt="" width="48" height="48" loading="lazy" />`
    : html`<span class="server-icon none" aria-hidden="true">${name.slice(0, 1).toUpperCase()}</span>`;
}

function ownerAvatar(id: string, avatar: string | null): Html {
  return avatar ? html`<img class="owner-avatar" src="${CDN}/avatars/${id}/${avatar}.webp?size=48" alt="" width="20" height="20" loading="lazy" />` : html``;
}

/** Replaced by a "Join server" link once the invite exists (see site/src/pages/shell.astro). */
function inviteButton(guildId: string, left: boolean): Html {
  return left ? html`` : html`<button class="button small ghost" type="button" data-invite="/admin/servers/${guildId}/invite">Create invite</button>`;
}

function serverRow(server: AdminServerSummary): Html {
  const left = server.left_at !== null;
  const search = [server.name, server.guild_id, server.owner_name, server.owner_id, server.vanity, server.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return html`<article class="server-row" data-repo data-search="${search}">
    ${serverIcon(server.guild_id, server.icon, server.name)}
    <div class="server-main">
      <div class="repo-head">
        <a class="repo-name" href="/admin/servers/${server.guild_id}">${server.name}</a>
        ${left ? html`<span class="chip">Left ${date(server.left_at)}</span>` : ''}
        ${server.configured ? html`<span class="chip">Configured</span>` : ''}
      </div>
      <p class="server-meta">
        <span>${count(server.member_count)} members</span>
        <span>${count(server.online_count)} online</span>
        <span>${plural(server.reports, 'report')}</span>
        <span>${plural(server.repos, 'repo')}</span>
        <span>Added ${date(server.first_seen)}</span>
      </p>
      <p class="server-meta">
        ${server.owner_id
          ? html`<span class="server-owner">${ownerAvatar(server.owner_id, server.owner_avatar)}${server.owner_name ?? server.owner_id}</span>`
          : html`<span>Owner not read yet</span>`}
        ${server.vanity ? html`<a href="https://discord.gg/${server.vanity}" target="_blank" rel="noopener noreferrer">discord.gg/${server.vanity}</a>` : ''}
      </p>
    </div>
    <div class="server-actions">${inviteButton(server.guild_id, left)}</div>
  </article>`;
}

export function serverListPage(servers: AdminServerSummary[], stale: boolean): Page {
  const present = servers.filter((server) => server.left_at === null).length;

  return {
    title: 'Servers',
    body: html`<div class="picker admin">
      <div class="picker-head">
        <span class="index">Admin</span>
        <h1 class="panel-title">Servers.</h1>
        <p class="lede">
          Dispatch is in <strong>${plural(present, 'server')}</strong>. Owners and details fill in over the hourly sync, a few servers at a time.
        </p>
      </div>
      ${stale ? html`<p class="admin-warning">Discord couldn't be read just now, so this is the last stored list.</p>` : ''}
      <div class="repo-tools">
        <label class="search">
          ${searchIcon}
          <input type="search" placeholder="Search name, ID, owner…" aria-label="Search servers" autocomplete="off" data-repo-search />
        </label>
        <span class="repo-count" data-repo-count data-total="${servers.length}" data-singular="server" data-plural="servers">${plural(servers.length, 'server')}</span>
      </div>
      <div class="server-list">${servers.map(serverRow)}</div>
      <p class="repo-empty" data-repo-empty ${servers.length ? raw('hidden') : ''}>No servers match your search.</p>
    </div>`,
  };
}

const CHANNEL_TYPES: Record<number, string> = {
  0: 'Text',
  2: 'Voice',
  4: 'Category',
  5: 'Announcement',
  13: 'Stage',
  15: 'Forum',
  16: 'Media',
};

const VERIFICATION = ['None', 'Low', 'Medium', 'High', 'Very high'];
const NSFW = ['Default', 'Explicit', 'Safe', 'Age restricted'];

function fact(label: string, value: unknown): Html {
  return html`<div class="server-fact">
    <dt>${label}</dt>
    <dd>${value === null || value === undefined || value === '' ? '–' : value}</dd>
  </div>`;
}

function namedList(title: string, items: { name?: string | null }[]): Html {
  if (!items.length) return html``;
  return html`<section class="server-section">
    <h2>${title} <span class="repo-count">${items.length}</span></h2>
    <p class="server-tags">${items.map((item) => html`<span class="chip">${item.name ?? 'Unnamed'}</span>`)}</p>
  </section>`;
}

const inviteLink = (url: string, label: string) =>
  html`<a class="button small ghost" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;

export function serverDetailPage(opts: {
  row: AdminServerRow;
  details: GuildDetails | null;
  channels: GuildChannel[] | null;
  widgetInvite: string | null;
}): Page {
  const { row, details, channels, widgetInvite } = opts;
  const left = row.left_at !== null;
  const owner = row.owner ? (JSON.parse(row.owner) as { username?: string; global_name?: string | null; avatar?: string | null }) : null;
  const features = (details?.features as string[] | undefined) ?? [];
  const list = (key: string) => (details?.[key] as { name?: string | null }[] | undefined) ?? [];

  return {
    title: row.name,
    body: html`<div class="picker admin">
      <a class="server-back" href="/admin/servers">← All servers</a>
      <div class="server-title">
        ${serverIcon(row.guild_id, row.icon, row.name)}
        <div>
          <h1 class="panel-title">${row.name}</h1>
          <p class="lede">${details?.description ?? ''}</p>
        </div>
      </div>

      <div class="server-invites">
        ${inviteButton(row.guild_id, left)}
        ${details?.vanity_url_code ? inviteLink(`https://discord.gg/${details.vanity_url_code}`, `discord.gg/${details.vanity_url_code}`) : ''}
        ${widgetInvite ? inviteLink(widgetInvite, 'Widget invite') : ''}
      </div>

      <dl class="server-facts">
        ${fact('Server ID', row.guild_id)}
        ${fact('Members', count(row.member_count))}
        ${fact('Online', count(row.online_count))}
        ${fact('Owner', owner?.username ?? null)}
        ${fact('Owner name', owner?.global_name ?? null)}
        ${fact('Owner ID', row.owner_id)}
        ${fact('Added', date(row.first_seen))}
        ${fact('Left', date(row.left_at))}
        ${fact('Details read', row.refreshed_at === null ? null : new Date(row.refreshed_at).toISOString())}
        ${fact('Boost tier', details?.premium_tier)}
        ${fact('Boosts', details?.premium_subscription_count)}
        ${fact('Locale', details?.preferred_locale)}
        ${fact('Verification', VERIFICATION[details?.verification_level as number])}
        ${fact('Age rating', NSFW[details?.nsfw_level as number])}
        ${fact('Two-factor for mods', details ? (details.mfa_level ? 'Required' : 'Not required') : null)}
      </dl>

      ${features.length
        ? html`<section class="server-section">
            <h2>Features</h2>
            <p class="server-tags">${features.map((feature) => html`<span class="chip">${feature}</span>`)}</p>
          </section>`
        : ''}
      ${channels
        ? html`<section class="server-section">
            <h2>Channels the bot can see <span class="repo-count">${channels.length}</span></h2>
            <p class="server-tags">
              ${channels.map((channel) => html`<span class="chip">${channel.name} · ${CHANNEL_TYPES[channel.type] ?? channel.type}</span>`)}
            </p>
          </section>`
        : ''}
      ${namedList('Roles', list('roles'))} ${namedList('Emojis', list('emojis'))} ${namedList('Stickers', list('stickers'))}

      <details class="server-raw">
        <summary>Everything Discord returned</summary>
        <pre>${JSON.stringify({ guild: details, owner }, null, 2)}</pre>
      </details>
    </div>`,
  };
}
