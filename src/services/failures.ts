import { saveFailure, type NewFailure } from '../db';
import { ProviderError } from '../providers/types';
import type { Bindings } from '../types';

/** Backs the private /admin/failures page. Recording a failure must never cause another one. */

const MAX_MESSAGE = 300;

function messageOf(error: unknown): string | null {
  if (error instanceof ProviderError) return error.detail ? `${error.message}: ${error.detail}` : error.message;
  if (error instanceof Error) return error.message;
  return error === undefined || error === null ? null : String(error);
}

export async function recordFailure(
  env: Bindings,
  failure: Pick<NewFailure, 'source' | 'action'> & { error?: unknown; message?: string; status?: number; guildId?: string | null }
): Promise<void> {
  try {
    const status = failure.status ?? (failure.error instanceof ProviderError ? failure.error.status : null);
    await saveFailure(env.DB, {
      at: Date.now(),
      source: failure.source,
      action: failure.action,
      message: (failure.message ?? messageOf(failure.error))?.slice(0, MAX_MESSAGE) ?? null,
      status,
      guildId: failure.guildId ?? null,
    });
  } catch (error) {
    console.error('failures: recording a failure failed', error);
  }
}
