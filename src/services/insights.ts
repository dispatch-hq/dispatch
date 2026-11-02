import type { AdminServerSummary } from '../types';

/** Works out what the private admin pages flag about a server, from what's already stored. */

const DAY_MS = 24 * 60 * 60 * 1000;
const ADMINISTRATOR = 1n << 3n;
const CREATE_INVITE = 1n << 0n;

/** What the invite link asks for (see BOT_PERMISSIONS in index.ts). */
const REQUIRED: [bigint, string][] = [
  [1n << 10n, 'View Channel'],
  [1n << 11n, 'Send Messages'],
  [1n << 14n, 'Embed Links'],
  [1n << 28n, 'Manage Roles'],
  [1n << 35n, 'Create Public Threads'],
];

/** A server not configured after this long has probably stalled, rather than being mid-setup. */
const SETUP_GRACE_DAYS = 3;
const STALE_TRIAGE_DAYS = 7;

/** Server-wide only: a channel's own overrides can still block the bot, which then shows up as failures. */
export function missingPermissions(permissions: string | null): string[] {
  if (!permissions) return [];
  const granted = BigInt(permissions);
  if (granted & ADMINISTRATOR) return [];
  return REQUIRED.filter(([bit]) => !(granted & bit)).map(([, name]) => name);
}

export function canCreateInvites(permissions: string | null): boolean | null {
  if (!permissions) return null;
  const granted = BigInt(permissions);
  return !!(granted & (ADMINISTRATOR | CREATE_INVITE));
}

export type HealthIssue = { level: 'serious' | 'warning'; text: string };

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** D1 timestamps are UTC, in the form `2026-11-02 18:45:37`. */
export const parseDbDate = (value: string) => Date.parse(`${value.replace(' ', 'T')}Z`);

export function healthOf(server: AdminServerSummary, now: number): HealthIssue[] {
  if (server.left_at !== null) return [];
  const issues: HealthIssue[] = [];

  const missing = missingPermissions(server.permissions);
  if (missing.length) issues.push({ level: 'serious', text: `Missing permissions: ${missing.join(', ')}` });

  if (server.failures) {
    issues.push({ level: 'serious', text: `${server.failures} failure${server.failures === 1 ? '' : 's'} in the last 7 days` });
  }

  if (!server.configured) {
    const age = Math.floor((now - server.first_seen) / DAY_MS);
    if (age >= SETUP_GRACE_DAYS) issues.push({ level: 'warning', text: `Added ${days(age)} ago, never configured` });
  } else if (!server.repos) {
    issues.push({ level: 'warning', text: 'No repository linked' });
  }

  if (server.repos > 1 && !server.pro) {
    const paused = server.repos - 1;
    issues.push({ level: 'warning', text: `${paused} repositor${paused === 1 ? 'y' : 'ies'} paused without Dispatch Pro` });
  }

  if (server.oldest_pending) {
    const age = Math.floor((now - parseDbDate(server.oldest_pending)) / DAY_MS);
    if (age >= STALE_TRIAGE_DAYS) issues.push({ level: 'warning', text: `A report has waited in triage for ${days(age)}` });
  }

  return issues;
}
