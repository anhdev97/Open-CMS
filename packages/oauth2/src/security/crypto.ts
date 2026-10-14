import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

export type KeyPurpose = 'token' | 'key' | 'cookie' | 'client-secret';

export function deriveKey(secret: Buffer, purpose: KeyPurpose): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), `opencms/${purpose}`, 32));
}

/** base64url of iv(12) | tag(16) | ciphertext. */
export function seal(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
}

export function open(key: Buffer, sealed: string): string {
  const buf = Buffer.from(sealed, 'base64url');
  if (buf.length < 28) throw new Error('invalid sealed data');
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
