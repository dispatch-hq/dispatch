import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  base64UrlDecode,
  base64UrlEncode,
  createAppJwt,
  importRsaPrivateKey,
  safeEqual,
  signToken,
  verifyGitHubSignature,
  verifyToken,
} from '../src/lib/crypto';

describe('signed tokens', () => {
  it('round-trips a payload', async () => {
    const token = await signToken('secret', { g: '1', u: '2' }, 60);
    expect(await verifyToken<{ g: string; u: string }>('secret', token)).toMatchObject({ g: '1', u: '2' });
  });

  it('rejects a token signed with another secret', async () => {
    const token = await signToken('secret', { g: '1' }, 60);
    expect(await verifyToken('other', token)).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await signToken('secret', { g: '1' }, 60);
    const [, sig] = token.split('.');
    const forged = `${base64UrlEncode(JSON.stringify({ g: '999', exp: 9_999_999_999 }))}.${sig}`;
    expect(await verifyToken('secret', forged)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await signToken('secret', { g: '1' }, -1);
    expect(await verifyToken('secret', token)).toBeNull();
  });

  it('rejects garbage', async () => {
    expect(await verifyToken('secret', undefined)).toBeNull();
    expect(await verifyToken('secret', 'not-a-token')).toBeNull();
    expect(await verifyToken('secret', 'a.b')).toBeNull();
  });
});

describe('verifyGitHubSignature', () => {
  const body = JSON.stringify({ action: 'closed' });
  const header = `sha256=${createHmac('sha256', 'hook-secret').update(body).digest('hex')}`;

  it('accepts a valid signature', async () => {
    expect(await verifyGitHubSignature('hook-secret', body, header)).toBe(true);
  });

  it('rejects wrong secret, modified body, or missing header', async () => {
    expect(await verifyGitHubSignature('nope', body, header)).toBe(false);
    expect(await verifyGitHubSignature('hook-secret', `${body} `, header)).toBe(false);
    expect(await verifyGitHubSignature('hook-secret', body, null)).toBe(false);
    expect(await verifyGitHubSignature('hook-secret', body, 'sha1=abc')).toBe(false);
  });
});

describe('GitHub App JWT', () => {
  const verifyJwt = (jwt: string, publicKey: string) => {
    const [header, payload, signature] = jwt.split('.');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    return verifier.verify(publicKey, Buffer.from(base64UrlDecode(signature!)));
  };

  for (const type of ['pkcs1', 'pkcs8'] as const) {
    it(`signs with a ${type} private key`, async () => {
      const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type, format: 'pem' },
      });

      const jwt = await createAppJwt('12345', await importRsaPrivateKey(privateKey));
      expect(verifyJwt(jwt, publicKey)).toBe(true);

      const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(jwt.split('.')[1]!)));
      expect(claims.iss).toBe('12345');
      expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    });
  }

  it('accepts keys with escaped newlines (as pasted into dashboards)', async () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    await expect(importRsaPrivateKey(privateKey.replace(/\n/g, '\\n'))).resolves.toBeDefined();
  });
});

describe('safeEqual', () => {
  it('compares strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
