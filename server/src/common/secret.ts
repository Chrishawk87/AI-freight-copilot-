import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

// Symmetric encryption for secrets we must store and later reuse (e.g. a
// carrier's SMTP app password). The key is derived from JWT_SECRET, which
// already exists in every environment — so there's nothing extra to configure
// and no plaintext credential ever lands in the database.

const PREFIX = 'enc:v1:';

function key(): Buffer {
  const secret = process.env.JWT_SECRET || 'insecure-dev-secret';
  return createHash('sha256').update(secret).digest(); // 32 bytes
}

/** Encrypt a plaintext secret. Returns a self-describing, storable string. */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX +
    [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':')
  );
}

/** Decrypt a value produced by encryptSecret. Plain (legacy) values pass through. */
export function decryptSecret(stored: string): string {
  if (!stored) return '';
  if (!stored.startsWith(PREFIX)) return stored; // tolerate pre-encryption data
  try {
    const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(':');
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
}

/** True if the string looks like one of our encrypted blobs. */
export function isEncrypted(v: string): boolean {
  return typeof v === 'string' && v.startsWith(PREFIX);
}
