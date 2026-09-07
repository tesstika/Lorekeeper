# Security

## API keys at rest

- Provider API keys (OpenRouter / UnoRouter) are stored **AES-256-GCM encrypted** in the
  `settings` table of the local SQLite database (`data/lorekeeper.db`).
- The data-encryption key is a random 32-byte file at `%LOCALAPPDATA%/Lorekeeper/secret.key`,
  created with user-only ACLs. It never leaves your machine.
- Keys are decrypted in memory only for the duration of a provider call. They are never
  logged, never sent to the frontend (only a masked hint such as `sk-or-…3f2a`), and never
  stored in this repository.

## Threat model (honest version)

This protects against casual copying of `data/lorekeeper.db`. It is **not** protection
against code running in your user session.

## Other posture

- The server binds to `127.0.0.1` only — no network exposure.
- No auth by design (local, single-user). If this ever leaves localhost, a token check is
  the first thing to add.

## If a key is exposed

Rotate the affected key immediately in the provider's dashboard (OpenRouter / UnoRouter),
then enter the new key via Settings → API Providers & Keys. Keys are entered only through
the UI — never into files or this repository.
