import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { KeyEnvelope } from '@lorekeeper/shared';

const MASTER_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;

export interface EncryptedSecret extends KeyEnvelope {}

/**
 * Per plan §2.5: the 32-byte master key lives outside the data dir so that a
 * casual copy of `data/lorekeeper.db` alone reveals nothing.
 *  - Windows: `%LOCALAPPDATA%/Lorekeeper/secret.key`
 *  - POSIX:   `$XDG_DATA_HOME/Lorekeeper/secret.key` or `~/.local/share/…`
 * `LOREKEEPER_SECRET_KEY_PATH` overrides both (used by tests).
 */
export function masterKeyPath(): string {
  const override = process.env.LOREKEEPER_SECRET_KEY_PATH;
  if (override) return override;
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'Lorekeeper', 'secret.key');
  }
  const dataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, 'Lorekeeper', 'secret.key');
}

/**
 * Loads the master key, creating it (32 random bytes, written atomically with
 * user-only permissions) if missing. Throws a clear error on a corrupt file —
 * silently regenerating it would permanently lock out every stored key.
 */
export function loadOrCreateMasterKey(filePath: string = masterKeyPath()): Buffer {
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (existsSync(filePath)) {
    let raw: Buffer;
    try {
      raw = readFileSync(filePath);
    } catch (error) {
      // Distinct from the corrupt-file case: locked/unreadable must not be
      // mistaken for a wrong-length key (e.g. AV/backup tools holding it).
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Master key at ${filePath} could not be read: ${detail}`);
    }
    if (raw.length === MASTER_KEY_BYTES) return raw;
    throw new Error(
      `Master key at ${filePath} is corrupt (expected ${MASTER_KEY_BYTES} bytes, got ${raw.length}). ` +
        'Restore the file or delete it — note deleting it permanently invalidates all stored API keys.',
    );
  }
  const key = randomBytes(MASTER_KEY_BYTES);
  const tmpPath = `${filePath}.tmp-${randomUUID()}`;
  const tmpFd = openSync(tmpPath, 'w', 0o600);
  try {
    writeSyncAll(tmpFd, key);
  } finally {
    closeSync(tmpFd);
  }
  try {
    chmodSync(tmpPath, 0o600);
  } catch {
    // chmod is best-effort: Windows ACLs inherit the user profile's scoping.
  }
  renameSync(tmpPath, filePath);
  return key;
}

function writeSyncAll(fd: number, buffer: Buffer): void {
  let written = 0;
  while (written < buffer.length) {
    written += writeSync(fd, buffer, written, buffer.length - written);
  }
}

/** First 6 + last 4 characters — the only key fragment ever exposed client-side. */
export function keyHint(key: string): string {
  if (key.length <= 10) return `${key.slice(0, 2)}…${key.length} chars`;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

/** AES-256-GCM encrypt a plaintext API key into a storable envelope. */
export function encryptApiKey(masterKey: Buffer, plaintext: string): EncryptedSecret {
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    hint: keyHint(plaintext),
  };
}

/** Decrypt an envelope. Throws when the tag does not verify (tampered data). */
export function decryptApiKey(masterKey: Buffer, envelope: KeyEnvelope): string {
  const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.encrypted, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/** Utility for tests/cleanup — removes a master key file if it exists. */
export function removeMasterKeyFile(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // already gone
  }
}
