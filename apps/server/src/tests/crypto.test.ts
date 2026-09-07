import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decryptApiKey,
  encryptApiKey,
  keyHint,
  loadOrCreateMasterKey,
  masterKeyPath,
  removeMasterKeyFile,
} from '../services/crypto';

const workDir = mkdtempSync(path.join(tmpdir(), 'lorekeeper-crypto-'));
const keyPath = path.join(workDir, 'secret.key');

beforeAll(() => {
  process.env.LOREKEEPER_SECRET_KEY_PATH = keyPath;
});

afterAll(() => {
  removeMasterKeyFile(keyPath);
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // Windows may hold file handles briefly — best-effort cleanup.
  }
});

describe('master key file', () => {
  it('resolves %LOCALAPPDATA%/Lorekeeper/secret.key on Windows', () => {
    if (process.platform !== 'win32') return;
    const override = process.env.LOREKEEPER_SECRET_KEY_PATH;
    const previousLocalAppData = process.env.LOCALAPPDATA;
    delete process.env.LOREKEEPER_SECRET_KEY_PATH;
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
    try {
      expect(masterKeyPath()).toBe('C:\\Users\\test\\AppData\\Local\\Lorekeeper\\secret.key');
    } finally {
      process.env.LOCALAPPDATA = previousLocalAppData;
      process.env.LOREKEEPER_SECRET_KEY_PATH = override;
    }
  });

  it('creates a 32-byte key on first load and reuses it afterwards', () => {
    const first = loadOrCreateMasterKey(keyPath);
    expect(first.length).toBe(32);
    expect(readFileSync(keyPath)).toEqual(first);
    const second = loadOrCreateMasterKey(keyPath);
    expect(second).toEqual(first);
  });

  it('rejects a corrupt key file instead of silently rotating it', () => {
    const corruptPath = path.join(workDir, 'corrupt.key');
    writeFileSync(corruptPath, Buffer.from('too-short'));
    expect(() => loadOrCreateMasterKey(corruptPath)).toThrow(/corrupt/);
    removeMasterKeyFile(corruptPath);
  });
});

describe('AES-256-GCM key envelopes', () => {
  const masterKey = loadOrCreateMasterKey(keyPath);
  const apiKey = 'sk-or-v1-abcdef0123456789abcdef';

  it('round-trips plaintext', () => {
    const envelope = encryptApiKey(masterKey, apiKey);
    expect(decryptApiKey(masterKey, envelope)).toBe(apiKey);
  });

  it('never stores plaintext in the envelope', () => {
    const envelope = encryptApiKey(masterKey, apiKey);
    expect(envelope.encrypted).not.toContain(apiKey);
    expect(atob(envelope.encrypted)).not.toContain('sk-or');
    expect(envelope.encrypted.length).toBeGreaterThan(0);
    expect(envelope.iv.length).toBeGreaterThan(0);
    expect(envelope.tag.length).toBeGreaterThan(0);
  });

  it('uses a fresh IV per encryption (same key, different ciphertexts)', () => {
    const a = encryptApiKey(masterKey, apiKey);
    const b = encryptApiKey(masterKey, apiKey);
    expect(a.encrypted).not.toBe(b.encrypted);
    expect(a.iv).not.toBe(b.iv);
    expect(decryptApiKey(masterKey, a)).toBe(apiKey);
    expect(decryptApiKey(masterKey, b)).toBe(apiKey);
  });

  it('fails closed when the ciphertext or tag is tampered with', () => {
    const envelope = encryptApiKey(masterKey, apiKey);
    const tamperedCiphertext = { ...envelope, encrypted: `${envelope.encrypted.slice(0, -4)}AAAA` };
    expect(() => decryptApiKey(masterKey, tamperedCiphertext)).toThrow();
    const tamperedTag = { ...envelope, tag: `${envelope.tag.slice(0, -4)}AAAA` };
    expect(() => decryptApiKey(masterKey, tamperedTag)).toThrow();
  });

  it('produces a first-6/last-4 hint and never leaks more', () => {
    expect(keyHint(apiKey)).toBe('sk-or-…cdef');
    expect(keyHint(apiKey)).not.toContain('abcdef0123456789');
    expect(keyHint('short-key')).toContain('chars');
  });
});
