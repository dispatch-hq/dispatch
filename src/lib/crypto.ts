const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64UrlEncode(input: ArrayBuffer | Uint8Array | string): string {
  const bytes =
    typeof input === 'string'
      ? encoder.encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(input: string): Uint8Array<ArrayBuffer> {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

/* -------------------------------------------------------------------------- */
/*                               Signed tokens                                */
/* -------------------------------------------------------------------------- */

/**
 * Compact HMAC-signed token: `base64url(json).base64url(sig)`.
 * Payloads are signed, not encrypted — never put secrets in them.
 */
export async function signToken<T extends object>(
  secret: string,
  payload: T,
  ttlSeconds: number
): Promise<string> {
  const body = base64UrlEncode(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })
  );
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${base64UrlEncode(sig)}`;
}

export async function verifyToken<T extends object>(
  secret: string,
  token: string | null | undefined
): Promise<T | null> {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      base64UrlDecode(sig),
      encoder.encode(body)
    );
    if (!valid) return null;

    const payload = JSON.parse(decoder.decode(base64UrlDecode(body))) as T & { exp?: number };
    if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*                              GitHub webhooks                               */
/* -------------------------------------------------------------------------- */

/** Verifies the `X-Hub-Signature-256` header GitHub sends with every webhook. */
export async function verifyGitHubSignature(
  secret: string,
  body: string,
  header: string | null
): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return safeEqual(`sha256=${hex(sig)}`, header);
}

/* -------------------------------------------------------------------------- */
/*                              GitHub App JWTs                               */
/* -------------------------------------------------------------------------- */

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  while (length > 0) {
    bytes.unshift(length & 0xff);
    length >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

/**
 * GitHub hands out PKCS#1 keys (`BEGIN RSA PRIVATE KEY`), but WebCrypto only
 * imports PKCS#8. Wrap the RSA key in a PKCS#8 PrivateKeyInfo structure.
 */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const version = [0x02, 0x01, 0x00];
  const rsaAlgorithm = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ];
  const octetString = [0x04, ...derLength(pkcs1.length)];
  const innerLength = version.length + rsaAlgorithm.length + octetString.length + pkcs1.length;

  return new Uint8Array([
    0x30,
    ...derLength(innerLength),
    ...version,
    ...rsaAlgorithm,
    ...octetString,
    ...pkcs1,
  ]);
}

export async function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
  // Secrets pasted through dashboards sometimes arrive with literal "\n".
  const normalized = pem.replace(/\\n/g, '\n').trim();
  const isPkcs1 = normalized.includes('BEGIN RSA PRIVATE KEY');
  const base64 = normalized.replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\s+/g, '');
  const der = base64UrlDecode(base64.replace(/\+/g, '-').replace(/\//g, '_'));

  return crypto.subtle.importKey(
    'pkcs8',
    isPkcs1 ? pkcs1ToPkcs8(der) : der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/** Creates a short-lived JWT that authenticates as the GitHub App itself. */
export async function createAppJwt(appId: string, key: CryptoKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  // Backdate `iat` to tolerate clock drift; GitHub caps `exp` at 10 minutes.
  const payload = base64UrlEncode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(`${header}.${payload}`)
  );
  return `${header}.${payload}.${base64UrlEncode(signature)}`;
}
