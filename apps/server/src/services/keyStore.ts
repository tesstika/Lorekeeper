import type { KeyEnvelope, ProviderId } from '@lorekeeper/shared';
import type { LorekeeperDb } from '../db/client';
import { decryptApiKey, encryptApiKey, loadOrCreateMasterKey } from './crypto';
import { getApiKeys, setApiKeyEnvelope } from './settingsRepo';

/**
 * Server-side owner of API keys: envelopes live in `settings.apiKeys`
 * (AES-256-GCM); plaintext exists in memory only for the duration of a
 * provider call and is never logged or returned by any route (plan §2.5/§5).
 */
export class KeyStore {
  #masterKey: Buffer | null = null;

  constructor(private readonly db: LorekeeperDb) {}

  #master(): Buffer {
    this.#masterKey ??= loadOrCreateMasterKey();
    return this.#masterKey;
  }

  /** Test seam: inject a key file without touching the real user profile. */
  useMasterKeyForTesting(key: Buffer): void {
    this.#masterKey = key;
  }

  getEnvelope(providerId: ProviderId): KeyEnvelope | null {
    return getApiKeys(this.db)[providerId] ?? null;
  }

  hasKey(providerId: ProviderId): boolean {
    return this.getEnvelope(providerId) !== null;
  }

  /** Encrypts + persists; returns the envelope (including the safe hint). */
  setKey(providerId: ProviderId, plaintext: string): KeyEnvelope {
    const envelope = encryptApiKey(this.#master(), plaintext);
    setApiKeyEnvelope(this.db, providerId, envelope);
    return envelope;
  }

  removeKey(providerId: ProviderId): void {
    setApiKeyEnvelope(this.db, providerId, null);
  }

  /** Decrypted key for outbound provider calls. Never logged, never serialized. */
  decrypt(providerId: ProviderId): string {
    const envelope = this.getEnvelope(providerId);
    if (!envelope) {
      throw new Error(`No API key stored for ${providerId}`);
    }
    return decryptApiKey(this.#master(), envelope);
  }
}
