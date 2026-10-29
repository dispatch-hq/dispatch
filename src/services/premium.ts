import type { APIEntitlement } from 'discord-api-types/v10';
import type { Bindings } from '../types';

/**
 * Premium is a Discord app subscription (Developer Portal → Monetization).
 * Every interaction carries the entitlements of the invoking user and, inside a
 * server, of that server — so there is nothing to poll or store. A server is
 * Premium when one of those entitlements belongs to it, hasn't been deleted
 * and hasn't ended.
 */

type InteractionWithEntitlements = { entitlements?: APIEntitlement[] };

function isActive(entitlement: APIEntitlement, now: number): boolean {
  if (entitlement.deleted) return false;
  if (entitlement.starts_at && Date.parse(entitlement.starts_at) > now) return false;
  return !entitlement.ends_at || Date.parse(entitlement.ends_at) > now;
}

export function hasPremium(env: Bindings, interaction: InteractionWithEntitlements, guildId: string): boolean {
  const now = Date.now();
  return (interaction.entitlements ?? []).some(
    (e) =>
      e.guild_id === guildId &&
      (!env.PREMIUM_SKU_ID || e.sku_id === env.PREMIUM_SKU_ID) &&
      isActive(e, now)
  );
}

/**
 * A Premium button: Discord renders the price and handles the purchase, and no
 * custom_id or URL is involved. `null` until `PREMIUM_SKU_ID` is configured.
 */
export function premiumButton(env: Bindings) {
  return env.PREMIUM_SKU_ID ? { type: 2 as const, style: 6 as const, sku_id: env.PREMIUM_SKU_ID } : null;
}

export const PREMIUM_NAME = 'Dispatch Pro';

/**
 * Repositories members can file reports against. Without Premium that is only
 * the primary (oldest) one: extra repositories are kept but paused, so they come
 * back untouched if the subscription is renewed.
 */
export function activeRepos<T>(repos: T[], premium: boolean): T[] {
  return premium ? repos : repos.slice(0, 1);
}
