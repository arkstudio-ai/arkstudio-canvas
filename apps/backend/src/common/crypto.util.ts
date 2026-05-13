import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Symmetric AES-256-GCM helpers used to keep DB-stored secrets (e.g. the
 * DashScope API key in `global_configs`) opaque at rest.
 *
 * Storage format: `<iv-hex>:<auth-tag-hex>:<ciphertext-hex>`. GCM provides
 * authenticated encryption, so a tampered ciphertext fails on `decrypt()`
 * with an exception (we surface that to the caller -- they should treat
 * "decrypt failed" as a hard error, not as "no secret").
 *
 * The key is derived from `ENCRYPTION_KEY` (≥ 32 chars). It must live in
 * the operator's environment, never in the database -- otherwise the
 * encryption is purely cosmetic.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY ?? '';
  if (!key || key.length < 32) {
    throw new Error(
      'ENCRYPTION_KEY must be at least 32 characters. Set it in apps/backend/.env',
    );
  }
  return Buffer.from(key.slice(0, 32), 'utf-8');
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const [ivHex, tagHex, encrypted] = ciphertext.split(':');

  if (!ivHex || !tagHex || !encrypted) {
    throw new Error('Invalid encrypted format');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/** Best-effort sanity check on startup; throws if `ENCRYPTION_KEY` is missing. */
export function assertEncryptionKey(): void {
  getEncryptionKey();
}

/**
 * Mask a secret for safe display. e.g. `sk-1dec...920252` for a 35-char key.
 * Returns `null` if the input is empty so callers can render "未配置".
 */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 11) return '***';
  const head = value.slice(0, 6);
  const tail = value.slice(-4);
  return `${head}...${tail}`;
}
