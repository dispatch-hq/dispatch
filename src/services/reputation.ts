import type { ReporterStats } from '../db';
import type { GuildRow } from '../types';

/** Share of a reporter's reviewed reports that must be accepted to skip triage. */
export const TRUST_MIN_RATE = 90;

export type Reputation = {
  accepted: number;
  /** Percentage of reviewed reports that were accepted; null until one has been reviewed. */
  rate: number | null;
  trusted: boolean;
};

/**
 * How a member's reports have fared. Reports closed without a fix count against
 * them like rejections, so fast-tracked reports can't prop up their own score.
 */
export function reputation(stats: ReporterStats, guild: Pick<GuildRow, 'trust_min_reports'> | null): Reputation {
  const accepted = stats.open + stats.fixed;
  const reviewed = accepted + stats.rejected + stats.closed;
  const rate = reviewed ? Math.round((accepted / reviewed) * 100) : null;
  const minimum = guild?.trust_min_reports ?? 0;
  return { accepted, rate, trusted: minimum > 0 && accepted >= minimum && rate !== null && rate >= TRUST_MIN_RATE };
}

export function reputationLine(rep: Reputation): string {
  if (rep.rate === null) return 'New reporter';
  return `${rep.trusted ? 'Trusted · ' : ''}${rep.rate}% of reports accepted`;
}
