import { html, raw } from 'hono/html';
import type { GuildChannel, GuildDetails } from '../services/admin-servers';
import type { CommandFilter } from '../db';
import { canCreateInvites, healthOf } from '../services/insights';
import type { AdminServerRow, AdminServerSummary, CommandLogEntry, FailureLogEntry } from '../types';
import { failureLines, healthList } from './admin-insights-pages';
import { searchIcon, type Html, type Page } from './pages';

const CDN = 'https://cdn.discordapp.com';

/* -------------------------------------------------------------------------- */
/*                                   Pieces                                   */
/* -------------------------------------------------------------------------- */

const ICONS = {
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  check: '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  crown: '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>',
  dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  dashed: '<circle cx="12" cy="12" r="9" stroke-dasharray="3 3.1"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  funnel: '<path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"/>',
  gitBranch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  logOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  trending: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  volume: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
} as const;

export type IconName = keyof typeof ICONS;

export const icon = (name: IconName, size = 16) =>
  raw(
    `<svg class="i" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`
  );

export const count = (value: number | null | undefined) => (value === null || value === undefined ? '–' : value.toLocaleString('en-US'));
export const date = (ms: number | null) =>
  ms === null ? '–' : new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} hr ago`;
  return date(ms);
}

export function serverIcon(id: string, image: string | null, name: string, large = false): Html {
  const size = large ? 64 : 44;
  return image
    ? html`<img class="server-icon" src="${CDN}/icons/${id}/${image}.webp?size=128" alt="" width="${size}" height="${size}" loading="lazy" />`
    : html`<span class="server-icon none" aria-hidden="true">${[...name][0]?.toUpperCase() ?? '?'}</span>`;
}

function avatar(id: string, image: string | null | undefined, name: string): Html {
  return image
    ? html`<img class="owner-avatar" src="${CDN}/avatars/${id}/${image}.webp?size=96" alt="" width="40" height="40" loading="lazy" />`
    : html`<span class="owner-avatar none" aria-hidden="true">${[...name][0]?.toUpperCase() ?? '?'}</span>`;
}

type Status = 'configured' | 'unconfigured' | 'left';

const STATUS: Record<Status, { label: string; icon: IconName }> = {
  configured: { label: 'Configured', icon: 'check' },
  unconfigured: { label: 'Not set up', icon: 'dashed' },
  left: { label: 'Left', icon: 'logOut' },
};

const statusOf = (leftAt: number | null, configured: number): Status =>
  leftAt !== null ? 'left' : configured ? 'configured' : 'unconfigured';

const statusBadge = (status: Status) =>
  html`<span class="server-badge" data-status="${status}">${icon(STATUS[status].icon, 13)}${STATUS[status].label}</span>`;

/** Replaced by a "Join server" link once the invite exists (see site/src/pages/shell.astro). */
function inviteButton(guildId: string, left: boolean): Html {
  return left
    ? html``
    : html`<button class="button small ghost" type="button" data-invite="/admin/servers/${guildId}/invite">${icon('link', 15)}Create invite</button>`;
}

function stat(iconName: IconName, value: string, label: string): Html {
  return html`<span class="server-stat">
    <span class="server-stat-value">${icon(iconName, 14)}<b>${value}</b></span>
    <span class="server-stat-label">${label}</span>
  </span>`;
}

function onlineStat(online: number | null): Html {
  return html`<span class="server-stat">
    <span class="server-stat-value"
      ><span class="online-dot" data-online="${online ? 'yes' : 'no'}" aria-hidden="true"></span><b>${count(online)}</b></span
    >
    <span class="server-stat-label">online</span>
  </span>`;
}

export function adminNav(active: 'overview' | 'servers' | 'activity' | 'failures'): Html {
  return html`<nav class="admin-nav" aria-label="Admin">
    <a href="/admin/overview" ${active === 'overview' ? raw('aria-current="page"') : ''}>${icon('dashboard', 15)}Overview</a>
    <a href="/admin/servers" ${active === 'servers' ? raw('aria-current="page"') : ''}>${icon('server', 15)}Servers</a>
    <a href="/admin/activity" ${active === 'activity' ? raw('aria-current="page"') : ''}>${icon('activity', 15)}Activity</a>
    <a href="/admin/failures" ${active === 'failures' ? raw('aria-current="page"') : ''}>${icon('alert', 15)}Failures</a>
  </nav>`;
}

/* -------------------------------------------------------------------------- */
/*                                Server list                                 */
/* -------------------------------------------------------------------------- */

function serverRow(server: AdminServerSummary): Html {
  const status = statusOf(server.left_at, server.configured);
  const issues = healthOf(server, Date.now());
  const serious = issues.some((issue) => issue.level === 'serious');
  const tags = [issues.length ? 'attention' : '', server.pro ? 'pro' : ''].join(' ');
  const search = [server.name, server.guild_id, server.owner_name, server.owner_id, server.vanity, server.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return html`<article class="server-row" data-repo data-search="${search}" data-status="${status}" data-tags="${tags}">
    <div class="server-identity">
      ${serverIcon(server.guild_id, server.icon, server.name)}
      <div class="server-names">
        <div class="server-name-line">
          <a class="server-name" href="/admin/servers/${server.guild_id}">${server.name}</a>
          ${statusBadge(status)}
          ${server.pro ? html`<span class="server-badge" data-status="pro">${icon('star', 13)}Pro</span>` : ''}
          ${issues.length
            ? html`<span class="server-badge" data-status="${serious ? 'serious' : 'attention'}" title="${issues.map((issue) => issue.text).join('. ')}">${icon('alert', 13)}${plural(issues.length, 'issue')}</span>`
            : ''}
        </div>
        <p class="server-sub">
          ${server.owner_id
            ? html`<span title="Owner">${icon('crown', 13)}${server.owner_name ?? server.owner_id}</span>`
            : html`<span class="pending" title="Filled in by the hourly sync, or by opening this server">${icon('clock', 13)}Owner pending</span>`}
          <span title="Added">${icon('calendar', 13)}${status === 'left' ? `Left ${date(server.left_at)}` : `Added ${date(server.first_seen)}`}</span>
          ${server.vanity
            ? html`<a class="server-vanity" href="https://discord.gg/${server.vanity}" target="_blank" rel="noopener noreferrer">${icon('globe', 13)}discord.gg/${server.vanity}</a>`
            : ''}
          <a class="server-vanity" href="/admin/activity?server=${server.guild_id}">
            ${icon('terminal', 13)}${server.last_command_at === null ? 'No commands yet' : `Last command ${ago(server.last_command_at)}`}
          </a>
        </p>
      </div>
    </div>
    <div class="server-stats">
      ${stat('users', count(server.member_count), 'members')} ${onlineStat(server.online_count)}
      ${stat('bug', count(server.reports), server.reports === 1 ? 'report' : 'reports')}
      ${stat('gitBranch', count(server.repos), server.repos === 1 ? 'repo' : 'repos')}
    </div>
    <div class="server-actions">
      ${inviteButton(server.guild_id, status === 'left')}
      <span class="server-chevron" aria-hidden="true">${icon('chevronRight', 18)}</span>
    </div>
  </article>`;
}

export function summaryCell(iconName: IconName | 'online', value: string, label: string): Html {
  return html`<div class="admin-stat">
    <span class="admin-stat-label">
      ${iconName === 'online' ? html`<span class="online-dot" data-online="yes" aria-hidden="true"></span>` : icon(iconName, 14)}${label}
    </span>
    <b>${value}</b>
  </div>`;
}

function filterButton(filter: string, label: string, total: number, active = false): Html {
  return html`<button class="admin-filter" type="button" data-repo-filter="${filter}" aria-pressed="${active ? 'true' : 'false'}">
    ${label} <span>${total}</span>
  </button>`;
}

export function serverListPage(servers: AdminServerSummary[], stale: boolean): Page {
  const present = servers.filter((server) => server.left_at === null);
  const configured = present.filter((server) => server.configured).length;
  const pending = present.filter((server) => !server.owner_id).length;
  const sum = (key: 'member_count' | 'online_count') => present.reduce((total, server) => total + (server[key] ?? 0), 0);

  const banner = stale
    ? { state: 'degraded', title: "Couldn't reach Discord", note: 'This is the last stored list.' }
    : { state: 'ok', title: 'Live from Discord', note: pending ? `${plural(pending, 'server')} waiting on owner details from the hourly sync.` : 'Owner details are up to date.' };

  return {
    title: 'Servers',
    hero: html`<span class="index">Admin</span>
      <h1>Your <em>servers.</em></h1>
      <p class="lede">Every server Dispatch is in, and how each one is using it.</p>
      ${adminNav('servers')}`,
    body: html`<div class="status-banner" data-state="${banner.state}" role="status">
        <span class="dot" aria-hidden="true"></span>
        <b>${banner.title}</b>
        <span>${banner.note}</span>
      </div>

      <div class="admin-stats">
        ${summaryCell('server', count(present.length), 'Servers')} ${summaryCell('users', count(sum('member_count')), 'Members')}
        ${summaryCell('online', count(sum('online_count')), 'Online now')} ${summaryCell('check', `${configured} / ${present.length}`, 'Configured')}
      </div>

      <div class="repo-tools admin-tools">
        <label class="search">
          ${searchIcon}
          <input type="search" placeholder="Search name, ID, owner…" aria-label="Search servers" autocomplete="off" data-repo-search />
        </label>
        <div class="admin-filters" role="group" aria-label="Filter servers">
          ${filterButton('all', 'All', servers.length, true)} ${filterButton('configured', 'Configured', configured)}
          ${filterButton('unconfigured', 'Not set up', present.length - configured)} ${filterButton('attention', 'Needs attention', present.filter((server) => healthOf(server, Date.now()).length).length)}
          ${filterButton('pro', 'Pro', present.filter((server) => server.pro).length)}
          ${filterButton('left', 'Left', servers.length - present.length)}
        </div>
        <span class="repo-count" data-repo-count data-total="${servers.length}" data-singular="server" data-plural="servers">${plural(servers.length, 'server')}</span>
      </div>

      <div class="server-list">${servers.map(serverRow)}</div>
      <p class="repo-empty" data-repo-empty ${servers.length ? raw('hidden') : ''}>No servers match.</p>`,
  };
}

/* -------------------------------------------------------------------------- */
/*                               Server details                               */
/* -------------------------------------------------------------------------- */

const CHANNELS: Record<number, { label: string; icon: IconName }> = {
  0: { label: 'Text', icon: 'hash' },
  2: { label: 'Voice', icon: 'volume' },
  5: { label: 'Announcement', icon: 'megaphone' },
  13: { label: 'Stage', icon: 'volume' },
  15: { label: 'Forum', icon: 'message' },
  16: { label: 'Media', icon: 'message' },
};
const CATEGORY = 4;

const VERIFICATION = ['None', 'Low', 'Medium', 'High', 'Very high'];
const NSFW = ['Default', 'Explicit', 'Safe', 'Age restricted'];
const CONTENT_FILTER = ['Off', 'Members without roles', 'All members'];

type Owner = { username?: string; global_name?: string | null; avatar?: string | null };
type Role = { id?: string; name?: string; color?: number; position?: number };
type Emoji = { id?: string | null; name?: string | null; animated?: boolean };
type Sticker = { name?: string };

function fact(iconName: IconName, label: string, value: unknown): Html {
  return html`<div class="server-fact">
    <dt>${icon(iconName, 13)}${label}</dt>
    <dd>${value === null || value === undefined || value === '' ? '–' : value}</dd>
  </div>`;
}

function section(iconName: IconName, title: string, total: number | null, body: unknown): Html {
  return html`<section class="server-section">
    <h2>${icon(iconName, 16)}${title} ${total === null ? '' : html`<span class="repo-count">${total}</span>`}</h2>
    ${body}
  </section>`;
}

const channelTag = (channel: GuildChannel) => {
  const kind = CHANNELS[channel.type];
  return html`<span class="server-tag" title="${kind?.label ?? `Type ${channel.type}`}">${icon(kind?.icon ?? 'hash', 13)}${channel.name}</span>`;
};

/** Grouped the way Discord's sidebar shows them: loose channels, then each category. */
function channelGroups(channels: GuildChannel[]): Html {
  const byPosition = (a: GuildChannel, b: GuildChannel) => (a.position ?? 0) - (b.position ?? 0);
  const inGroup = (parent: string | null) =>
    channels
      .filter((channel) => channel.type !== CATEGORY && (channel.parent_id ?? null) === parent)
      .sort(byPosition)
      .map(channelTag);
  const categories = channels.filter((channel) => channel.type === CATEGORY).sort(byPosition);
  const loose = inGroup(null);

  return html`${loose.length ? html`<p class="server-tags">${loose}</p>` : ''}
  ${categories.map(
    (category) => html`<div class="channel-group">
      <h3>${icon('folder', 13)}${category.name}</h3>
      <p class="server-tags">${inGroup(category.id)}</p>
    </div>`
  )}`;
}

const roleTag = (role: Role) => {
  const color = role.color ? `#${role.color.toString(16).padStart(6, '0')}` : 'var(--muted)';
  return html`<span class="server-tag"><span class="role-dot" style="background:${color}" aria-hidden="true"></span>${role.name ?? 'Unnamed'}</span>`;
};

const featureName = (feature: string) => feature.toLowerCase().replace(/_/g, ' ').replace(/^./, (first) => first.toUpperCase());

export function serverDetailPage(opts: {
  row: AdminServerRow;
  details: GuildDetails | null;
  channels: GuildChannel[] | null;
  widgetInvite: string | null;
  summary: AdminServerSummary;
  recent: CommandLogEntry[];
  failures: FailureLogEntry[];
}): Page {
  const { row, details, channels, widgetInvite, summary: activity, recent, failures } = opts;
  const issues = healthOf(activity, Date.now());
  const invites = canCreateInvites(row.permissions);
  const status = statusOf(row.left_at, activity.configured);
  const owner = row.owner ? (JSON.parse(row.owner) as Owner) : null;
  const list = <T>(key: string) => (details?.[key] as T[] | undefined) ?? [];
  const features = list<string>('features');
  const roles = [...list<Role>('roles')].sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
  const emojis = list<Emoji>('emojis').filter((emoji) => emoji.id);
  const stickers = list<Sticker>('stickers');
  const vanity = details?.vanity_url_code;

  return {
    title: row.name,
    hero: html`<a class="server-back" href="/admin/servers">${icon('arrowLeft', 14)}All servers</a>
      <div class="server-title">
        ${serverIcon(row.guild_id, row.icon, row.name, true)}
        <div>
          <h1>${row.name}</h1>
          ${details?.description ? html`<p class="lede">${details.description}</p>` : ''}
          <p class="server-title-badges">
            ${statusBadge(status)}
            ${row.pro ? html`<span class="server-badge" data-status="pro">${icon('star', 13)}Pro${row.pro_ends ? ` until ${date(row.pro_ends)}` : ''}</span>` : ''}
          </p>
        </div>
      </div>`,
    body: html`<div class="admin-stats">
        ${summaryCell('users', count(row.member_count), 'Members')} ${summaryCell('online', count(row.online_count), 'Online now')}
        ${summaryCell('bug', count(activity.reports), 'Reports')} ${summaryCell('gitBranch', count(activity.repos), 'Repositories')}
      </div>

      <div class="server-layout">
        <div class="server-content">
          <dl class="server-facts">
            ${fact('hash', 'Server ID', row.guild_id)} ${fact('calendar', 'Added', date(row.first_seen))}
            ${status === 'left' ? fact('logOut', 'Left', date(row.left_at)) : ''}
            ${fact('globe', 'Locale', details?.preferred_locale)} ${fact('zap', 'Boost tier', details?.premium_tier)}
            ${fact('zap', 'Boosts', details?.premium_subscription_count)}
            ${fact('shield', 'Verification', VERIFICATION[details?.verification_level as number])}
            ${fact('shield', 'Content filter', CONTENT_FILTER[details?.explicit_content_filter as number])}
            ${fact('shield', 'Age rating', NSFW[details?.nsfw_level as number])}
            ${fact('shield', 'Two-factor for mods', details ? (details.mfa_level ? 'Required' : 'Not required') : null)}
            ${fact('clock', 'Details read', row.refreshed_at === null ? 'Not yet' : ago(row.refreshed_at))}
            ${fact('bug', 'Waiting in triage', count(activity.pending))}
            ${fact('link', 'Can create invites', invites === null ? null : invites ? 'Yes, server-wide' : 'No')}
          </dl>

          ${failures.length
            ? html`<section class="server-section">
                <h2>${icon('alert', 16)}Recent failures <a class="section-link" href="/admin/failures?server=${row.guild_id}">View all ${icon('chevronRight', 14)}</a></h2>
                <div class="term compact"><div class="term-lines">${failureLines(failures)}</div></div>
              </section>`
            : ''}

          <section class="server-section">
            <h2>${icon('terminal', 16)}Recent commands <a class="section-link" href="/admin/activity?server=${row.guild_id}">View all ${icon('chevronRight', 14)}</a></h2>
            <div class="term compact">
              <div class="term-lines">${recent.length ? commandLines(recent) : html`<p class="term-empty">No commands recorded yet.</p>`}</div>
            </div>
          </section>

          ${channels ? section('hash', 'Channels the bot can see', channels.filter((channel) => channel.type !== CATEGORY).length, channelGroups(channels)) : ''}
          ${roles.length ? section('tag', 'Roles', roles.length, html`<p class="server-tags">${roles.map(roleTag)}</p>`) : ''}
          ${features.length ? section('zap', 'Features', features.length, html`<p class="server-tags">${features.map((feature) => html`<span class="server-tag">${featureName(feature)}</span>`)}</p>`) : ''}
          ${emojis.length
            ? section(
                'smile',
                'Emojis',
                emojis.length,
                html`<p class="server-emojis">
                  ${emojis.map((emoji) => html`<img src="${CDN}/emojis/${emoji.id}.webp?size=48" alt="${emoji.name ?? ''}" title="${emoji.name ?? ''}" width="28" height="28" loading="lazy" />`)}
                </p>`
              )
            : ''}
          ${stickers.length ? section('smile', 'Stickers', stickers.length, html`<p class="server-tags">${stickers.map((sticker) => html`<span class="server-tag">${sticker.name ?? 'Unnamed'}</span>`)}</p>`) : ''}

          <details class="server-raw">
            <summary>${icon('code', 14)}Everything Discord returned</summary>
            <pre>${JSON.stringify({ guild: details, owner }, null, 2)}</pre>
          </details>
        </div>

        <aside class="server-side">
          <div class="server-card">
            <h2>${icon('shield', 16)}Health</h2>
            ${status === 'left' ? html`<p class="server-card-note">The bot isn't in this server any more.</p>` : healthList(issues)}
          </div>

          <div class="server-card">
            <h2>${icon('crown', 16)}Owner</h2>
            ${row.owner_id
              ? html`<div class="server-owner-card">
                  ${avatar(row.owner_id, owner?.avatar, owner?.username ?? '?')}
                  <div>
                    <b>${owner?.global_name ?? owner?.username ?? 'Unknown'}</b>
                    ${owner?.username ? html`<span>@${owner.username}</span>` : ''}
                    <span>${row.owner_id}</span>
                  </div>
                </div>`
              : html`<p class="server-card-note">Not read yet.</p>`}
          </div>

          <div class="server-card">
            <h2>${icon('link', 16)}Invites</h2>
            <div class="server-invites">
              ${inviteButton(row.guild_id, status === 'left')}
              ${vanity ? html`<a class="button small ghost" href="https://discord.gg/${vanity}" target="_blank" rel="noopener noreferrer">${icon('external', 14)}discord.gg/${vanity}</a>` : ''}
              ${widgetInvite ? html`<a class="button small ghost" href="${widgetInvite}" target="_blank" rel="noopener noreferrer">${icon('external', 14)}Widget invite</a>` : ''}
            </div>
            <p class="server-card-note">
              ${status === 'left'
                ? "The bot isn't in this server any more."
                : "Created invites are single-use, last an hour, and show in the server's audit log."}
            </p>
          </div>
        </aside>
      </div>`,
  };
}

/* -------------------------------------------------------------------------- */
/*                                  Activity                                  */
/* -------------------------------------------------------------------------- */

const commandText = (kind: string, command: string) => (kind === 'slash' ? `/${command}` : command);
const KIND_NOTES: Record<string, string> = { user: 'user menu', message: 'message menu' };

const userName = (line: Pick<CommandLogEntry, 'user_name' | 'user_global_name' | 'user_id'>) =>
  line.user_global_name ?? line.user_name ?? line.user_id;

const serverName = (line: Pick<CommandLogEntry, 'guild_id' | 'guild_name'>) =>
  line.guild_id ? (line.guild_name ?? line.guild_id) : 'Direct message';

const clockUtc = (ms: number) => new Date(ms).toISOString().slice(11, 19);

function commandLine(line: CommandLogEntry): Html {
  const note = KIND_NOTES[line.kind];

  return html`<details class="log-line" data-id="${line.id}">
    <summary>
      <time data-at="${line.at}" datetime="${new Date(line.at).toISOString()}">${clockUtc(line.at)}</time>
      <span class="log-server">${serverName(line)}</span>
      <span class="log-user">${userName(line)}</span>
      <span class="log-command"><span class="log-prompt" aria-hidden="true">$</span>${commandText(line.kind, line.command)}${note ? html` <span class="log-note">${note}</span>` : ''}</span>
    </summary>
    <div class="log-detail">
      <div class="log-card">
        <h3>${icon('user', 14)}Ran by</h3>
        <div class="server-owner-card">
          ${avatar(line.user_id, line.user_avatar, userName(line))}
          <div>
            <b>${userName(line)}</b>
            ${line.user_name ? html`<span>@${line.user_name}</span>` : ''}
            <span>${line.user_id}</span>
          </div>
        </div>
        <p class="log-links">
          <a href="/admin/activity?user=${line.user_id}">${icon('terminal', 13)}All their commands</a>
          <a href="https://discord.com/users/${line.user_id}" target="_blank" rel="noopener noreferrer">${icon('external', 13)}Discord profile</a>
        </p>
      </div>
      <div class="log-card">
        <h3>${icon('server', 14)}In</h3>
        ${line.guild_id
          ? html`<a class="log-server-link" href="/admin/servers/${line.guild_id}">
                ${serverIcon(line.guild_id, line.guild_icon, serverName(line))}
                <div>
                  <b>${serverName(line)}</b>
                  <span>${line.guild_id}</span>
                </div>
              </a>
              <p class="log-links">
                <a href="/admin/servers/${line.guild_id}">${icon('server', 13)}View server</a>
                <a href="/admin/activity?server=${line.guild_id}">${icon('terminal', 13)}All commands here</a>
                ${line.channel_id
                  ? html`<a href="https://discord.com/channels/${line.guild_id}/${line.channel_id}" target="_blank" rel="noopener noreferrer">${icon('hash', 13)}Open channel</a>`
                  : ''}
              </p>`
          : html`<p class="server-card-note">Run in a direct message with the bot.</p>`}
      </div>
    </div>
  </details>`;
}

export function commandLines(lines: CommandLogEntry[]): Html {
  return html`${lines.map(commandLine)}`;
}

export function activityPage(opts: {
  lines: CommandLogEntry[];
  stats: { commands: number; servers: number; users: number; top: { command: string; kind: string } | null };
  filter: CommandFilter;
  server: AdminServerRow | null;
  limit: number;
}): Page {
  const { lines, stats, filter, server, limit } = opts;
  const params = new URLSearchParams();
  if (filter.guildId) params.set('server', filter.guildId);
  if (filter.userId) params.set('user', filter.userId);
  const query = params.toString();

  const newest = lines[lines.length - 1];
  const filteredUser = filter.userId ? (lines.find((line) => line.user_id === filter.userId) ?? null) : null;
  const args = [
    filter.guildId ? `--server="${server?.name ?? filter.guildId}"` : '',
    filter.userId ? `--user="${filteredUser?.user_name ?? filter.userId}"` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    title: 'Activity',
    hero: html`<span class="index">Admin</span>
      <h1>Live <em>activity.</em></h1>
      <p class="lede">Commands as they're run. Open a line to see who ran it, and where.</p>
      ${adminNav('activity')}`,
    body: html`${query
        ? html`<div class="activity-filter">
            ${filter.guildId
              ? html`<a class="activity-filter-item" href="/admin/servers/${filter.guildId}">${icon('server', 14)}${server?.name ?? filter.guildId}</a>`
              : ''}
            ${filter.userId
              ? html`<span class="activity-filter-item">${icon('user', 14)}${filteredUser ? userName(filteredUser) : filter.userId}</span>`
              : ''}
            <a class="activity-filter-clear" href="/admin/activity">Show everything</a>
          </div>`
        : ''}

      <div class="admin-stats">
        <div class="admin-stat">
          <span class="admin-stat-label">${icon('terminal', 14)}Commands, 24 hours</span>
          <b data-activity-total>${count(stats.commands)}</b>
        </div>
        ${summaryCell('server', count(stats.servers), 'Active servers')} ${summaryCell('users', count(stats.users), 'Active users')}
        <div class="admin-stat">
          <span class="admin-stat-label">${icon('zap', 14)}Most used</span>
          <b class="admin-stat-text">${stats.top ? commandText(stats.top.kind, stats.top.command) : '–'}</b>
        </div>
      </div>

      <div class="term">
        <div class="term-bar">
          <code class="term-title">dispatch:~$ tail -f commands${args ? ` ${args}` : ''}</code>
          <div class="term-controls">
            <span class="term-live" data-activity-live data-state="live" role="status"><span class="online-dot" data-online="yes" aria-hidden="true"></span><b>Live</b></span>
            <button class="term-pause" type="button" data-activity-pause aria-pressed="false">Pause</button>
          </div>
        </div>
        <div
          class="term-body"
          data-activity="/admin/activity/feed${query ? `?${query}` : ''}"
          data-last="${newest?.id ?? 0}"
          data-first="${lines[0]?.id ?? ''}"
          tabindex="0"
          aria-label="Command log"
        >
          <button class="term-older" type="button" data-activity-older ${lines.length < limit ? raw('hidden') : ''}>Load older</button>
          <p class="term-empty" data-activity-empty ${lines.length ? raw('hidden') : ''}>No commands recorded yet. They'll appear here as they're run.</p>
          <div class="term-lines" data-activity-lines>${commandLines(lines)}</div>
          <p class="term-cursor" aria-hidden="true"><span>$</span><i></i></p>
        </div>
      </div>
      <p class="term-note">Shows slash commands and menu commands, without what was typed into them. Kept for 30 days.</p>`,
  };
}
