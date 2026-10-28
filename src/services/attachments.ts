import type { APIAttachment } from 'discord-api-types/v10';
import type { Attachment, Bindings } from '../types';

export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Only types that are safe to serve back from our own origin. No HTML, SVG or
 * anything else a browser might execute.
 */
const ALLOWED_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  txt: 'text/plain',
  log: 'text/plain',
  json: 'application/json',
};

export function allowedContentType(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return ALLOWED_TYPES[ext] ?? null;
}

function safeFilename(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(-80);
  return cleaned || 'file';
}

export type RehostResult = {
  attachments: Attachment[];
  skipped: string[];
};

/**
 * Discord CDN links are signed and expire within a day, which would leave
 * broken images in GitHub issues. Copy uploads into R2 and serve them from
 * `/files/*` instead.
 */
export async function rehostAttachments(
  env: Bindings,
  guildId: string,
  uploads: APIAttachment[]
): Promise<RehostResult> {
  const result: RehostResult = { attachments: [], skipped: [] };

  for (const upload of uploads.slice(0, MAX_ATTACHMENTS)) {
    const contentType = allowedContentType(upload.filename);
    if (!contentType || upload.size > MAX_ATTACHMENT_BYTES) {
      result.skipped.push(upload.filename);
      continue;
    }

    try {
      const res = await fetch(upload.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const name = safeFilename(upload.filename);
      const key = `reports/${guildId}/${crypto.randomUUID()}/${name}`;
      await env.FILES.put(key, await res.arrayBuffer(), {
        httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
      });

      result.attachments.push({
        name,
        url: `${env.PUBLIC_URL}/files/${key}`,
        content_type: contentType,
      });
    } catch (error) {
      console.warn(`attachments: failed to rehost ${upload.filename}`, error);
      result.skipped.push(upload.filename);
    }
  }

  result.skipped.push(...uploads.slice(MAX_ATTACHMENTS).map((u) => u.filename));
  return result;
}
