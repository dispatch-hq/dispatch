import { html } from 'hono/html';
import { healthOf, parseDbDate, type HealthIssue } from '../services/insights';
import type { AdminServerSummary, FailureLogEntry } from '../types';
import { adminNav, ago, count, date, icon, plural, serverIcon, summaryCell, type IconName } from './admin-pages';
import type { Html, Page } from './pages';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS = 8;
/** Workers Free's limit for one D1 database. */
const D1_FREE_BYTES = 500 * 1000 * 1000;
const LISTED = 5;

const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

function issueLine(issue: HealthIssue): Html {
  return html`<li class="health-issue" data-level="${issue.level}">${icon(issue.level === 'serious' ? 'alert' : 'clock', 14)}<span>${issue.text}</span></li>`;
}

export const healthList = (issues: HealthIssue[]): Html =>
  issues.length
    ? html`<ul class="health-list">${issues.map(issueLine)}</ul>`
    : html`<p class="health-ok">${icon('check', 14)}No problems found</p>`;

/* -------------------------------------------------------------------------- */
/*                                  Overview                                  */
/* -------------------------------------------------------------------------- */

function panel(iconName: IconName, title: string, body: unknown, note?: string): Html {
  return html`<section class="insight-panel">
    <h2>${icon(iconName, 16)}${title}</h2>
    ${body}
    ${note ? html`<p class="insight-note">${note}</p>` : ''}
  </section>`;
}

function funnel(servers: AdminServerSummary[], activeGuilds: Set<string>): Html {
  const steps = [
    { label: 'Added the bot', total: servers.length },
    { label: 'Configured', total: servers.filter((s) => s.configured).length },
    { label: 'Linked a repository', total: servers.filter((s) => s.repos > 0).length },
    { label: 'Received a report', total: servers.filter((s) => s.reports > 0).length },
    { label: 'Ran a command this week', total: servers.filter((s) => activeGuilds.has(s.guild_id)).length },
  ];

  return html`<ol class="funnel">
    ${steps.map((step) => {
      const share = percent(step.total, servers.length);
      return html`<li title="${step.label}: ${step.total} of ${servers.length} servers (${share}%)">
        <span class="funnel-label">${step.label}</span>
        <span class="funnel-track"><i style="width:${share}%"></i></span>
        <span class="funnel-value"><b>${step.total}</b> ${share}%</span>
      </li>`;
    })}
  </ol>`;
}

function weeklyBars(title: string, weeks: { start: number; total: number }[]): Html {
  const peak = Math.max(1, ...weeks.map((week) => week.total));
  const label = (start: number) => new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  return html`<figure class="week-chart">
    <figcaption>${title} <b>${weeks.reduce((sum, week) => sum + week.total, 0)}</b></figcaption>
    <div class="week-bars">
      ${weeks.map(
        (week) => html`<span class="week-bar" title="Week of ${label(week.start)}: ${week.total}">
          <i style="height:${Math.round((week.total / peak) * 100)}%" data-empty="${week.total ? 'no' : 'yes'}"></i>
          <span class="sr-only">Week of ${label(week.start)}: ${week.total}</span>
        </span>`
      )}
    </div>
    <div class="week-axis" aria-hidden="true"><span>${label(weeks[0]!.start)}</span><span>This week</span></div>
  </figure>`;
}

function weeksOf(times: number[], now: number) {
  return Array.from({ length: WEEKS }, (_, i) => {
    const end = now - (WEEKS - 1 - i) * 7 * DAY_MS;
    const start = end - 7 * DAY_MS;
    return { start, total: times.filter((at) => at > start && at <= end).length };
  });
}

function serverLink(server: Pick<AdminServerSummary, 'guild_id' | 'icon' | 'name'>, aside: unknown): Html {
  return html`<a class="insight-row" href="/admin/servers/${server.guild_id}">
    ${serverIcon(server.guild_id, server.icon, server.name)}
    <span class="insight-row-name">${server.name}</span>
    <span class="insight-row-aside">${aside}</span>
  </a>`;
}

function formatBytes(bytes: number) {
  return bytes >= 1000 * 1000 ? `${(bytes / (1000 * 1000)).toFixed(1)} MB` : `${Math.ceil(bytes / 1000)} KB`;
}

export function overviewPage(opts: {
  servers: AdminServerSummary[];
  activeGuilds: Set<string>;
  failuresToday: number;
  pipeline: { statuses: Record<string, number>; recent: number; waitingOnReporter: number; oldestPending: string | null; daysToFix: number | null };
  storage: { reports: number; attachments: number; commands: number; failures: number; bytes: number | null };
  now: number;
}): Page {
  const { servers, activeGuilds, failuresToday, pipeline, storage, now } = opts;
  const present = servers.filter((server) => server.left_at === null);
  const unhealthy = present
    .map((server) => ({ server, issues: healthOf(server, now) }))
    .filter(({ issues }) => issues.length)
    .sort((a, b) => b.issues.filter((i) => i.level === 'serious').length - a.issues.filter((i) => i.level === 'serious').length);
  const pro = present.filter((server) => server.pro);
  const upgrades = present
    .filter((server) => !server.pro && server.configured)
    .sort((a, b) => b.reports - a.reports || (b.member_count ?? 0) - (a.member_count ?? 0))
    .slice(0, LISTED);

  const left = servers.filter((server) => server.left_at !== null);
  const staySpan = left.map((server) => (server.left_at! - server.first_seen) / DAY_MS);
  const averageStay = staySpan.length ? staySpan.reduce((sum, span) => sum + span, 0) / staySpan.length : null;
  const s = pipeline.statuses;

  return {
    title: 'Overview',
    hero: html`<span class="index">Admin</span>
      <h1>The whole <em>picture.</em></h1>
      <p class="lede">How servers are getting on with Dispatch, and what needs you.</p>
      ${adminNav('overview')}`,
    body: html`<div class="admin-stats">
        ${summaryCell('server', count(present.length), 'Servers')} ${summaryCell('alert', count(unhealthy.length), 'Need attention')}
        ${summaryCell('bug', count(failuresToday), 'Failures, 24 hours')} ${summaryCell('star', count(pro.length), 'Pro servers')}
      </div>

      <div class="insight-grid">
        ${panel(
          'alert',
          'Needs attention',
          unhealthy.length
            ? html`<div class="insight-rows">
                ${unhealthy.slice(0, LISTED * 2).map(
                  ({ server, issues }) => html`<a class="attention-row" href="/admin/servers/${server.guild_id}">
                    ${serverIcon(server.guild_id, server.icon, server.name)}
                    <span>
                      <b>${server.name}</b>
                      ${healthList(issues)}
                    </span>
                  </a>`
                )}
              </div>`
            : html`<p class="health-ok">${icon('check', 14)}Every server looks healthy</p>`
        )}
        ${panel('funnel', 'Setup funnel', funnel(present, activeGuilds), `Of the ${plural(present.length, 'server')} the bot is in now. Each step's percentage is of all of them.`)}
        ${panel(
          'bug',
          'Report pipeline',
          html`<dl class="insight-facts">
            <div><dt>Waiting in triage</dt><dd>${count(s.pending ?? 0)}</dd></div>
            <div><dt>Open issues</dt><dd>${count(s.open ?? 0)}</dd></div>
            <div><dt>Fixed</dt><dd>${count(s.fixed ?? 0)}</dd></div>
            <div><dt>Closed or rejected</dt><dd>${count((s.closed ?? 0) + (s.rejected ?? 0))}</dd></div>
            <div><dt>New this week</dt><dd>${count(pipeline.recent)}</dd></div>
            <div><dt>Waiting on a reporter</dt><dd>${count(pipeline.waitingOnReporter)}</dd></div>
            <div><dt>Oldest in triage</dt><dd>${pipeline.oldestPending ? ago(parseDbDate(pipeline.oldestPending)) : '–'}</dd></div>
            <div><dt>Time to fix, average</dt><dd>${pipeline.daysToFix === null ? '–' : `${pipeline.daysToFix.toFixed(1)} days`}</dd></div>
          </dl>`,
          'Time to fix runs from a report being filed to its last update, so a later edit can lengthen it.'
        )}
        ${panel(
          'trending',
          'Growth and churn',
          html`<div class="week-charts">
              ${weeklyBars('Added', weeksOf(servers.map((server) => server.first_seen), now))}
              ${weeklyBars('Left', weeksOf(left.map((server) => server.left_at!), now))}
            </div>
            <p class="insight-stat">Average stay before leaving: <b>${averageStay === null ? '–' : `${averageStay.toFixed(1)} days`}</b></p>`,
          'Tracking began on Nov 2, 2026, so servers already using the bot count as added that week.'
        )}
        ${panel(
          'star',
          'Dispatch Pro',
          html`<h3 class="insight-sub">Subscribers</h3>
            ${pro.length
              ? html`<div class="insight-rows">
                  ${pro.map((server) => serverLink(server, server.pro_ends ? `Ends ${date(server.pro_ends)}` : 'Renewing'))}
                </div>`
              : html`<p class="insight-empty">No subscribers yet.</p>`}
            <h3 class="insight-sub">Likeliest upgrades</h3>
            ${upgrades.length
              ? html`<div class="insight-rows">
                  ${upgrades.map((server) => serverLink(server, plural(server.reports, 'report')))}
                </div>`
              : html`<p class="insight-empty">No configured free servers yet.</p>`}`,
          'Likeliest upgrades are configured free servers with the most reports, then the most members.'
        )}
        ${panel(
          'database',
          'Storage',
          html`${storage.bytes === null
              ? ''
              : html`<div class="storage-meter" title="${formatBytes(storage.bytes)} of 500 MB">
                  <span class="storage-label"><span>Database</span><b>${formatBytes(storage.bytes)}</b></span>
                  <span class="funnel-track"><i style="width:${Math.max(1, percent(storage.bytes, D1_FREE_BYTES))}%"></i></span>
                </div>`}
            <dl class="insight-facts">
              <div><dt>Reports</dt><dd>${count(storage.reports)}</dd></div>
              <div><dt>Attachments</dt><dd>${count(storage.attachments)}</dd></div>
              <div><dt>Command log rows</dt><dd>${count(storage.commands)}</dd></div>
              <div><dt>Failure log rows</dt><dd>${count(storage.failures)}</dd></div>
            </dl>`,
          'Bar shows the free plan limit of 500 MB per database. Daily read and write quotas are on the Cloudflare dashboard.'
        )}
      </div>`,
  };
}

/* -------------------------------------------------------------------------- */
/*                                  Failures                                  */
/* -------------------------------------------------------------------------- */

const SOURCES = ['command', 'discord', 'github', 'attachments', 'webhook'];
const SOURCE_NAMES: Record<string, string> = {
  command: 'Commands',
  discord: 'Discord',
  github: 'GitHub',
  attachments: 'Attachments',
  webhook: 'Webhooks',
};

export function failureLines(lines: FailureLogEntry[]): Html {
  return html`${lines.map(
    (line) => html`<details class="log-line failure-line">
      <summary>
        <time data-at="${line.at}" datetime="${new Date(line.at).toISOString()}">${new Date(line.at).toISOString().slice(11, 19)}</time>
        <span class="log-server">${line.guild_id ? (line.guild_name ?? line.guild_id) : 'No server'}</span>
        <span class="log-user">${SOURCE_NAMES[line.source] ?? line.source}</span>
        <span class="log-command"><span class="log-prompt" aria-hidden="true">!</span>${line.action}${line.status ? html` <span class="log-note">${line.status}</span>` : ''}</span>
      </summary>
      <div class="failure-detail">
        <p>${line.message ?? 'No further detail was recorded.'}</p>
        ${line.guild_id
          ? html`<p class="log-links">
              <a href="/admin/servers/${line.guild_id}">${icon('server', 13)}View server</a>
              <a href="/admin/failures?server=${line.guild_id}">${icon('alert', 13)}All failures here</a>
              <a href="/admin/activity?server=${line.guild_id}">${icon('terminal', 13)}Commands here</a>
            </p>`
          : ''}
      </div>
    </details>`
  )}`;
}

export function failuresPage(opts: {
  lines: FailureLogEntry[];
  counts: { source: string; total: number }[];
  filter: { guildId?: string; source?: string };
  serverName: string | null;
}): Page {
  const { lines, counts, filter, serverName } = opts;
  const total = counts.reduce((sum, row) => sum + row.total, 0);
  const tab = (source: string | null, label: string, n: number) => {
    const params = new URLSearchParams();
    if (filter.guildId) params.set('server', filter.guildId);
    if (source) params.set('source', source);
    const query = params.toString();
    return html`<a class="admin-filter" href="/admin/failures${query ? `?${query}` : ''}" ${(filter.source ?? null) === source ? html`aria-current="true"` : ''}>${label} <span>${n}</span></a>`;
  };

  return {
    title: 'Failures',
    hero: html`<span class="index">Admin</span>
      <h1>What went <em>wrong.</em></h1>
      <p class="lede">Things that failed behind the scenes, even when nobody reported them.</p>
      ${adminNav('failures')}`,
    body: html`${filter.guildId
        ? html`<div class="activity-filter">
            <a class="activity-filter-item" href="/admin/servers/${filter.guildId}">${icon('server', 14)}${serverName ?? filter.guildId}</a>
            <a class="activity-filter-clear" href="/admin/failures">Show everything</a>
          </div>`
        : ''}

      <div class="admin-filters failure-tabs" role="group" aria-label="Filter by source">
        ${tab(null, 'All, 7 days', total)}
        ${SOURCES.map((source) => tab(source, SOURCE_NAMES[source]!, counts.find((row) => row.source === source)?.total ?? 0))}
      </div>

      <div class="term">
        <div class="term-bar">
          <code class="term-title">dispatch:~$ cat failures${filter.source ? ` --source=${filter.source}` : ''}${filter.guildId ? ` --server="${serverName ?? filter.guildId}"` : ''}</code>
        </div>
        <div class="term-body static">
          ${lines.length
            ? html`<div class="term-lines">${failureLines(lines)}</div>`
            : html`<p class="term-empty">${icon('check', 14)} Nothing has failed.</p>`}
        </div>
      </div>
      <p class="term-note">Latest ${plural(lines.length, 'failure')}, newest first. Closed DMs aren't counted, since members choose those. Kept for 30 days.</p>`,
  };
}
