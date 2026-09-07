# Lorekeeper

> A local-first roleplay client for LLMs — OpenRouter & UnoRouter.

**Created by Testika.** MIT licensed — see [LICENSE](./LICENSE) and [CREDITS.md](./CREDITS.md).

Lorekeeper is a local website for role-playing (RP) with various LLMs accessed through
[OpenRouter](https://openrouter.ai) and [UnoRouter](https://unorouter.com/en). It keeps every chat,
character, persona, and setting in a local SQLite database on your machine — no accounts, no cloud.

## Status

`M0 — Scaffold & skeleton` (see [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for the full plan).

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
bun run build        # build the SPA
bun run start        # serve built SPA + API on http://127.0.0.1:3000
```

The SQLite database and media live in `data/` (created on first boot, never committed).
