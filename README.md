# Lorekeeper

> A local-first roleplay client for LLMs — OpenRouter & UnoRouter.

**Created by [Testika](https://github.com/Testika).** MIT licensed — see [LICENSE](./LICENSE) and [CREDITS.md](./CREDITS.md).

Lorekeeper is a local website for role-playing (RP) with various LLMs accessed through
[OpenRouter](https://openrouter.ai) and [UnoRouter](https://unorouter.com/en). It keeps every chat,
character, persona, and setting in a local SQLite database on your machine — no accounts, no cloud.

## Status

v1 is feature-complete — milestones M0–M4 (scaffold, settings & providers, characters & personas, chats & SSE streaming, polish & hardening) are implemented and audited.

## Stack

- **Frontend:** Vue 3.6 (Vapor Mode) + Vite 8 + Tailwind CSS 4 + Pinia + Vue Router + TanStack Vue Query
- **Backend:** Fastify 5 on Bun 1.4, SQLite (`bun:sqlite`) via Drizzle ORM, Zod-validated REST + SSE
- **Tooling:** TypeScript 7 (native `tsc`) with `typescript-native-bridge` for the Vue workspace, Biome, Vitest

## Development

```sh
bun install          # install workspace dependencies
bun run dev          # Vite dev server (:5173) + Fastify API (:3000) with proxy
bun run test         # vitest (unit + component)
bun run typecheck    # tsc (server/shared) + vue-tsc (frontend)
bun run lint         # biome check
bun run db:generate  # generate SQL migration from the Drizzle schema
bun run db:migrate   # apply migrations manually (the server also migrates on boot)
bun run build        # build the SPA
bun run start        # serve built SPA + API on http://127.0.0.1:3000
```

The SQLite database and media live in `data/` (created on first boot, never committed).

### Production (single process)

`bun run build` compiles the SPA into `apps/frontend/dist`; `bun run start` then serves the SPA and
the API from one Fastify process on **http://127.0.0.1:3000**. On Windows, `start.bat` wraps the
whole flow — it checks for Bun, builds the frontend if missing, and opens the browser.

## Dev notes (Windows)

- The Vite dev server runs under the **Bun runtime** (`bunx --bun vite`) — kept as a
  precaution; on audit re-test Vite under Node works fine with `127.0.0.1`. The host is
  pinned to `127.0.0.1` because a default `localhost` binding can half-fail on IPv6
  (binds `::1` only, IPv4 connections refused).
- Vitest also runs under Bun (`bunx --bun vitest`), with the `threads` pool — the `forks` pool is
  unstable under Bun. The server's `import.meta.dir`-style Bun-only APIs are avoided in favor of
  portable `import.meta.url`.
- Type checking: backend/shared use native TypeScript 7 (`tsc`); the frontend uses `vue-tsc` on
  `typescript-native-bridge` (the Go checker — the terminal prints `TNB ACTIVE` when it engages).
