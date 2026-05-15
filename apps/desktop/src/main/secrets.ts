// Persisted desktop secrets — the moral equivalent of `apps/backend/.env` for a
// packaged app. The backend already insists on a 32+ char ENCRYPTION_KEY (used
// to AES-256-GCM encrypt every API key the user pastes into the admin panel),
// so we cannot regenerate it on every launch — that would orphan all stored
// secrets after one restart.
//
// Strategy: on first launch we mint a cryptographically random key, persist it
// to <userData>/secrets.json (chmod 600 on POSIX), and reuse it forever. If the
// user wipes userData they'll lose access to their stored API keys, which is
// the expected behaviour for an "uninstall + reinstall" flow.

import fs from 'node:fs';
import crypto from 'node:crypto';
import log from 'electron-log/main';

interface PersistedSecrets {
  encryptionKey: string;
  createdAt: string;
}

export function loadOrCreateSecrets(secretsFile: string): PersistedSecrets {
  if (fs.existsSync(secretsFile)) {
    try {
      const raw = fs.readFileSync(secretsFile, 'utf8');
      const parsed = JSON.parse(raw) as PersistedSecrets;
      if (typeof parsed.encryptionKey === 'string' && parsed.encryptionKey.length >= 32) {
        return parsed;
      }
      log.warn('[secrets] existing secrets.json is malformed, regenerating');
    } catch (err) {
      log.warn('[secrets] failed to parse secrets.json, regenerating:', err);
    }
  }

  const fresh: PersistedSecrets = {
    // 32 bytes hex → 64 hex chars, well over the backend's 32-char minimum.
    encryptionKey: crypto.randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(secretsFile, JSON.stringify(fresh, null, 2), { mode: 0o600 });
  log.info('[secrets] minted fresh encryption key at', secretsFile);
  return fresh;
}
