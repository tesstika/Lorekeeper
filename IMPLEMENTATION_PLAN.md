# Lorekeeper — Implementation Plan

**Author:** prepared for Testika (sole developer) · **Date:** 2026-09-07 · **Status:** REV 3 — REV 2 feedback applied (licensing, animations, inline errors, Vue 3.6-rc/vapor, confirm-everywhere, save-default, key received + live-verified, ports, git repo) + REV 3 (card-spec versions verified: no V4/V5/V6; backend tsconfig → `module: "preserve"` per TSConfig reference & Bun docs) — awaiting final approval
**Scope:** plan only. No application code is written until this document is approved.

---

## 0. Executive summary

Lorekeeper is a local-first, single-user web app for role-playing with LLMs accessed exclusively through **OpenRouter** and **UnoRouter**. It is a two-process app: a **Vue 3 SPA** (frontend) and a **Fastify server running on Bun** (backend, owns the database, API keys, and all provider calls). Communication is **REST (Zod-validated) + SSE** for token streaming.

Key decisions made in this plan (each justified in its section):

| # | Decision | Why |
|---|----------|-----|
| D1 | **Streaming via SSE over fetch (`ReadableStream`), not WebSocket** | Streaming is strictly server→client. `AbortController` on the client's fetch doubles as the Stop button and propagates to the upstream provider request. One less dependency (`@fastify/websocket` dropped). |
| D2 | **SQLite driver: `bun:sqlite` via `drizzle-orm/bun-sqlite`** | `better-sqlite3` is a V8-API native addon that **fails to load under Bun 1.4** (Bun throws a clear error pointing to `bun:sqlite`; the compat-shim PR oven-sh/bun#36712 is *not* shipped in 1.4.2). `bun:sqlite` is built-in, zero-install, fastest, and first-class in Drizzle. Escape hatch documented (§2.4). |
| D3 | **TypeScript 7.0.2 (native `tsc`) for backend/shared; `typescript-native-bridge` aliased as `typescript` in the frontend** | TS 7.0 ships **no programmatic API** (planned for 7.1), so `vue-tsc` cannot run on it. TNB (`6.0.3-bridge.16.tsgo.7.0.2`) keeps the classic API + `tsserver` and runs the Go checker (tsgo 7.0.2) in-process — validated by the Vue language-tools team. Vitest's `typecheck.checker: 'vue-tsc'` picks TNB up automatically. |
| D4 | **Vue 3.6.0-rc.7 with Vapor Mode** *(approved by Testika)* | `<script setup vapor>` is the default for feature components; the app shell (router view, bottom nav, transition-heavy containers) stays classic VDOM and mixes freely via Vapor interop. Fallback documented in §11 (3.5.42) if an RC blocker appears. Known cosmetic issue: pinia/vue-router/test-utils peer ranges don’t include the 3.6 prerelease → expected install warnings, no runtime impact (verified in M0). |
| D5 | **Images stored on disk (`data/media/`), metadata in SQLite** | Keeps the DB small and `VACUUM` cheap; easy to back up / open in Explorer; served via `@fastify/static`. SQLite BLOBs would bloat the main DB file. |
| D6 | **Swipes = variant groups**: assistant messages sharing a `seq` (logical position) form a group; exactly one active variant is sent in history | Clean mapping to SillyTavern swipes; cap of last N variants (default 20). |
| D7 | **Confirm dialog for every destructive action** (messages, chats, characters, personas) *(approved — no undo toasts)* | One consistent interaction pattern; simplifies flows (no delayed server calls). |
| D8 | **Editing a user message defaults to “Save”**; “Save & regenerate after” is offered in the dialog and can be made the default via a Settings toggle (`editDefaultRegenerate`) *(approved)* | Non-destructive default; power users flip the setting once. |
| D9 | **Streaming is animated, two-stage** (§6.7): live-typing caret (fading-in text chunks, sliding blinking caret, ~500 ms blink, adjustable) then a “delivered” dot that blinks exactly 6 × ~250 ms and settles | Feels like a word processor, not a raw log; motion is configurable and respects `prefers-reduced-motion`. |
| D10 | **Errors surfaced inline in chat** (§6.8): generation/provider/network/malformed-response failures render as a distinct error bubble (red accent + icon + underlying error), with a Retry action where applicable; persisted in the conversation | A persistent, visible record beats toasts/console for an RP log; Retry = regenerate one click away. |
| D11 | **Open source, MIT-licensed** (§13): LICENSE at repo root, Testika credited as creator in the README header, `author` field, and a CREDITS section | Required by the project charter. |
| D12 | **Dark theme only, Material-3 “Editorial Sanctum” palette + Plus Jakarta Sans / Source Serif 4 extracted from your mockups** *(fonts approved)* | The five mockups define a consistent design system; we translate it 1:1 into Tailwind 4 `@theme` tokens. |
| D13 | **Character cards: import Tavern V1 (legacy flat), SillyTavern/Tavern V2 (`chara_card_v2`) and V3 (`chara_card_v3`) JSON; export V2 JSON (universal baseline), optional dual V3 export as a stretch goal** *(verified 2026-09-07: no V4/V5/V6 exists — V3 is the newest published spec; a “V3.1” exists only as an open RFC, SillyTavern issue #5878, not adopted)* | V2 is the de-facto interchange format (SillyTavern, RisuAI, Agnai, Chub all read it); V3 adds `assets`, `group_only_greetings`, `nickname`, `creator_notes_multilingual`, `source` and uses the PNG `ccv3` chunk; SillyTavern writes **both** V2+V3 chunks. Unknown card fields are preserved in an `extensions` column for lossless round-trips. PNG-embedded cards (`chara` + `ccv3` chunks) = stretch goal, hand-rolled parser; RisuAI’s CHARX archive = out of scope. |

Additions beyond your library list (all justified): `marked`, `dompurify`, `highlight.js` (chat markdown rendering — §6.6), `@fastify/multipart` (image uploads — §7.1), `@fontsource-variable/plus-jakarta-sans` + `@fontsource-variable/source-serif-4` (design fonts — §6.1). Drops: `better-sqlite3`, `@types/better-sqlite3`, `@fastify/websocket`, `@types/ws`, `nanoid` (use `crypto.randomUUID`) — see §12.

---

## 1. Version verification

Every package was checked against the live npm registry (2026-09-07) and the official release notes. Registry `latest` versions matched your list **exactly** for: `typescript@7.0.2`, `vite@8.2.2`, `tailwindcss@4.3.3`, `pinia@4.0.3`, `@tanstack/vue-query@5.102.8`, `@vitejs/plugin-vue@6.0.8`, `vue-tsc@3.3.11`, `@vue/devtools-api@8.2.1`, `unplugin-icons@23.0.1`, `@iconify-json/lucide@1.2.129`, `@fontsource/inter@5.3.0`, `fastify@5.12.3`, `@fastify/static@10.1.3`, `@fastify/websocket@11.3.0`, `fastify-type-provider-zod@7.0.0`, `zod@4.5.4`, `better-sqlite3@13.0.3`, `@types/better-sqlite3@9.6.0`, `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`, `@biomejs/biome@2.5.12`, `vitest@5.0.0`, `@vue/test-utils@2.5.0`, `jsdom@30.0.1`, `@types/node@26.4.1`, `@types/ws@8.18.1`, `bun-types@1.4.2`.

Corrections and notes:

| Package | Your version | Verified state | Decision |
|---|---|---|---|
| `vue` | 3.6.0-rc.5 | `latest` = 3.5.42; `rc` tag = **3.6.0-rc.7** (RC since 2026-07-18, Vapor feature-complete) | **Use 3.6.0-rc.7 + Vapor Mode** (D4, approved). Peer-range notes: pinia 4.0.3 peers `vue ^3.5.11`, vue-router 5.3.1 peers `^3.5.34 \|\| ^4`, test-utils peers `3.x` — a prerelease does not satisfy these semver ranges, so `bun install` shows warnings; this is expected and harmless. M0 includes a runtime verification task; rollback path = 3.5.42 (VDOM-only) if a blocking RC bug appears. |
| `vue-router` | 5.2.0 | `latest` = **5.3.1** | Use **5.3.1**. Peers: `vue ^3.5.34 \|\| ^4`, `vite ^7.3 \|\| ^8` — vite satisfied; vue peer warning expected with 3.6-rc (see above). |
| `typescript` | 7.0.2 | GA 2026-07-08. Native Go binary; **no programmatic API until 7.1**; no `tsserver` (LSP instead). | Use as planned (D3). |
| `typescript-native-bridge` (TNB) | mentioned | `6.0.3-bridge.16.tsgo.7.0.2` — drop-in `typescript` fork: classic API + tsserver, Go checker in-process; vue-tsc verified ~3× faster, 205/209 Volar tests pass. | Frontend alias (D3). |
| `@typescript/typescript6` | — | Official shim: re-exports TS 6.0 API, ships `tsc6`. | Recorded as **fallback** if TNB misbehaves. |
| `vite` | 8.2.2 | Vite 8 GA 2026-03-12: Rolldown+Oxc replace esbuild/Rollup; compat layer auto-converts old config. engines `node ^20.19 \|\| >=22.12`. | Use **8.2.2**. Greenfield + only official plugins (`@vitejs/plugin-vue`, `@tailwindcss/vite`, `unplugin-icons`) = low risk. Avoid deprecated `esbuild`/`rollupOptions` keys; use `rolldownOptions` if ever needed. |
| `tailwindcss` / `@tailwindcss/vite` | 4.3.3 | 4.3.3 latest; plugin peers `vite ^5.2 \|\| ^6 \|\| ^7 \|\| ^8`. | Use **4.3.3** with CSS-first `@theme` config (no `tailwind.config.js`). |
| `bun` | 1.4.2 | 1.4 (2026-08-20): Rust rewrite, Node 26.3 compat (+1517 tests), `node:sqlite` 100% Node tests pass, Fastify `inject()` works, vitest runs under Bun. **`better-sqlite3` still cannot load** (clear error → suggests `bun:sqlite`; shim PR #36712 not shipped). | Backend runtime = **Bun 1.4.2**; vitest runs on Node 26.7 (jsdom path is bulletproof there); D2. |
| `bun-types` | 1.4.2 | 1.4.2; internally depends on `@types/node:*`. The docs-recommended alias `@types/bun` is at **1.4.1** (wraps bun-types 1.4.1). | Use `bun-types@1.4.2` + `"types": ["bun-types"]` — exact match to the pinned Bun 1.4.2 runtime (the alias lags one patch). Server tsconfig uses Bun’s own recommended combination: `module: "preserve"` + `moduleResolution: "bundler"` + `moduleDetection: "force"` + `verbatimModuleSyntax` (§8.1). |
| `vitest` | 5.0.0 | 5.0 released 2026-09-03; requires `vite >=6.4`, `node >=22.12`; breaking: `clearMocks: true` default, hoisted-mock top-level enforcement, benchmark API rewrite, `projects`/`extends` defaults. Peers `vite ^6.4 \|\| ^7 \|\| ^8` ✓. | Use **5.0.0**; nothing in the breaking list affects a new project that follows the current API. |
| `fastify` | 5.12.3 | 5.12.3 latest. | Use **5.12.3**. |
| `fastify-type-provider-zod` | 7.0.0 | 7.0.0 (2026-06-24) requires **zod ≥ 4.2** and fastify ^5.5; v7 uses Zod `.encode()/.decode()` → **response serialization is based on `z.output`** (post-transform type). | Use **7.0.0 + zod 4.5.4**. Caveat recorded in §8.1: response schemas must describe the *output* type (e.g. `.default()` values are always present in responses). |
| `zod` | 4.5.4 | 4.5.4 latest. | Use **4.5.4**. Zod-4 notes: `error` param replaces `message`; `.flatten()/.format()` deprecated (use `z.treeifyError`/`z.flattenError`); `z.enum()` over `z.nativeEnum()`; `z.output` vs `z.input` matters (see above). |
| `better-sqlite3` / `@types/better-sqlite3` | 13.0.3 / 9.6.0 | Real, but **unusable under Bun** (V8-API addon; engines `node >=22`). | **Dropped** (D2). Node-only fallback documented in §2.4. |
| `drizzle-orm` / `drizzle-kit` | 0.45.2 / 0.31.10 | 0.45.2 / 0.31.10 latest. drizzle-orm has native `bun-sqlite` driver + migrator; drizzle-kit deps are only tsx/esbuild/brocli (no native SQLite). | Use both; `drizzle-kit generate` is offline, migrations applied programmatically (§2.5). |
| `@biomejs/biome` | 2.5.12 | 2.5.12 latest; 2.x supports Vue SFCs (script blocks), CSS, JSON. | Use **2.5.12**; `.vue` templates get linting where supported, type-safety from vue-tsc regardless. |
| `@vue/devtools-api` | 8.2.1 | 8.2.1; pinia 4 peers `^8.1.5` | Frontend **dependency** (satisfies pinia peer). |
| `@types/node` | 26.4.1 | 26.4.1 latest | Root devDep (vitest/tooling). |
| `jsdom` | 30.0.1 | 30.0.1; engines `node ^22.22.2 \|\| ^24.15 \|\| >=26` ✓ Node 26.7 | devDep of frontend (component tests). |
| `@fastify/websocket` / `@types/ws` | 11.3.0 / 8.18.1 | Real. | **Dropped** — SSE chosen (D1). |
| `nanoid` | — | — | **Dropped** — `crypto.randomUUID()` is built into Bun/Node and browsers. |

**Provider APIs (verified):**

* **OpenRouter** — `POST https://openrouter.ai/api/v1/chat/completions` (OpenAI-compatible; `stream:true` → SSE; streaming errors arrive as `data:` events with an `error` field; a terminal `usage` chunk precedes `[DONE]` and carries an empty delta that repeats `finish_reason`); `GET /api/v1/models` returns catalog incl. `context_length`, `architecture.input_modalities` (vision detection), pricing; images via `content: [{type:'text'},{type:'image_url', image_url:{url: 'data:image/jpeg;base64,…'}}]` (base64 data URLs required for local files; supported: png/jpeg/webp/gif; **send text first, then images**); optional `HTTP-Referer` / `X-Title` headers; `usage:{include:true}` returns token accounting in the final chunk. Non-standard params `top_k`, `repetition_penalty` are accepted as passthrough.
* **UnoRouter** — documented as an **OpenAI-compatible gateway**: base URL `https://api.unorouter.com/v1`, endpoints `/v1/chat/completions` (+ `/v1/responses`, `/v1/embeddings`, Anthropic-native `/v1/messages`, Gemini-native `/v1beta`), streaming + tool calling supported, 200+ models, rate limit = HTTP 429 with `Retry-After`. Their SillyTavern integration guide uses the Custom OpenAI-compatible source with the same base URL.
* **UnoRouter — live-verified (2026-09-07, with the key Testika provided, used only for two read-only/minimal calls and never stored in any file):**
  * `GET /v1/models` → HTTP 200, **245 models**, OpenAI shape `{ id, object, created, owned_by, supported_endpoint_types, context_length? }`. `context_length` present only on some models; `supported_endpoint_types` distinguishes `openai` / `aihorde` / others; **no modality (`input_modalities`) metadata** → A1 confirmed: vision gating uses OpenRouter metadata when available, otherwise allow-with-warning + manual context-length field (§7.1 note).
  * `POST /v1/chat/completions` (`stream: true`, `max_tokens: 5`, free model) → HTTP 200, standard OpenAI SSE frames `data: {…chat.completion.chunk…}` with `choices[0].delta.content` and `finish_reason` — streaming pipeline identical to OpenRouter; one shared SSE parser is sufficient.
  * Key handling: the provided key is entered via the Settings UI in M1 (encrypted at rest, §2.5). **It is not written into this plan or the repo.** Recommendation: rotate the key at your convenience — it has been shared in plaintext outside the app.

---

## 2. Architecture overview

### 2.1 Monorepo layout (Bun workspaces)

```
Lorekeeper/                       # git repo (initialized in M0)
├─ package.json               # workspaces, scripts, author, license=MIT, biome, vitest, typescript@7
├─ LICENSE                    # MIT (c) Testika
├─ README.md                  # header credits Testika as creator; badge-free, concise
├─ CREDITS.md                 # ABOUT/credits: creator, stack acknowledgements
├─ .gitignore                 # node_modules, dist, data/, .vitest, secrets
├─ biome.json  vitest.config.ts  tsconfig.json (solution style, refs)
├─ IMPLEMENTATION_PLAN.md
├─ apps/
│  ├─ frontend/               # Vue 3 SPA (Vite 8 + Tailwind 4)
│  │  ├─ index.html
│  │  ├─ vite.config.ts
│  │  ├─ tsconfig.json        # typescript = TNB alias → vue-tsc on Go checker
│  │  └─ src/
│  │     ├─ main.ts  App.vue  router/  pages/  components/
│  │     ├─ stores/           # pinia: settings, streaming, ui
│  │     ├─ api/              # typed REST client + SSE client (uses shared schemas)
│  │     ├─ markdown/         # marked + DOMPurify + hljs pipeline
│  │     ├─ styles/           # tailwind.css (@theme tokens from mockups)
│  │     └─ tests/            # @vue/test-utils component tests (jsdom)
│  └─ server/                 # Fastify 5 on Bun
│     ├─ drizzle.config.ts
│     └─ src/
│        ├─ index.ts          # buildApp(): plugins, routes, static, SPA fallback
│        ├─ env.ts            # paths, port, data dir
│        ├─ db/               # schema.ts, migrate.ts, repositories/
│        ├─ providers/        # provider interface + openrouter.ts + unorouter.ts
│        ├─ prompt/           # assembly + truncation
│        ├─ routes/           # REST route modules (zod schemas from shared)
│        ├─ generation/       # orchestration: SSE session, abort, persistence
│        └─ tests/            # vitest unit tests (node env)
├─ packages/
│  └─ shared/                 # zod schemas + TS types + SSE event types (both sides)
│     └─ src/{schema,enums,sse,prompt-variables}.ts
└─ data/                      # created at runtime (gitignored)
   ├─ lorekeeper.db           # SQLite (WAL)
   └─ media/…                 # avatars + message images
```

### 2.2 Processes & transport

* **REST** for all CRUD (chats, messages, characters, personas, presets, settings, attachments, providers). JSON in/out, request/response validated by Zod via `fastify-type-provider-zod`.
* **SSE** for streaming generation only. Three endpoints return `text/event-stream` (§7.2). Why SSE and not WebSocket (D1):
  * Generation is one-directional after the request; all control (send/edit/regenerate/stop) is naturally request-scoped.
  * Client `AbortController.abort()` closes the fetch → Fastify emits `request.raw.close` → we abort the upstream `fetch` to the provider → provider stops billing. The Stop button is literally one line.
  * Partial text is already accumulated server-side; on abort we persist it with `finishReason: 'aborted'`.
  * `@fastify/websocket` + `@types/ws` removed from the dependency set; reconnect/heartbeat complexity avoided. SSE auto-reconnect (EventSource) is *not* used — we use `fetch` + manual parsing so we can `POST` and attach `AbortSignal`; a dropped stream mid-generation is recoverable because the partial message is already in the DB (client refetches chat on `visible`/reconnect).
* Heartbeat: SSE comment line `: ping` every 15 s to survive proxy idle timeouts (defensive; local traffic doesn't need it, cheap to have).

### 2.3 Dev mode vs “production” (local app) mode

* **Dev:** root `bun run dev` → `bun run --parallel --filter '*' dev`:
  * server: `bun --watch apps/server/src/index.ts` on `http://127.0.0.1:3000`
  * frontend: `vite` on `http://127.0.0.1:5173` with `server.proxy` for `/api` and `/media` → `:3000` (no CORS needed).
* **Built mode:** `bun run build` → `vite build` → `apps/server/src/index.ts` serves `apps/frontend/dist` via `@fastify/static` (SPA fallback for vue-router history mode through a `setNotFoundHandler` that returns `index.html` for non-`/api` GETs). `bun run start` = built frontend + API on one port (3000). This is the “website” mode: one local process, open `http://localhost:3000`.
* Bind to `127.0.0.1` only. No auth (local, single user); documented as the place where a token check would go if this ever leaves localhost.

### 2.4 Runtime strategy & escape hatches

* Backend executes on **Bun 1.4.2** (runtime + package manager + test runner for `bun test`-style scripts is *not* used — Vitest is the test runner, executed on Node 26.7 for maximum jsdom/Vite fidelity; Bun 1.4 also runs vitest fine, but Node is the conservative default).
* Everything server-side is plain `fetch`/Fastify — no Bun-only APIs outside `bun:sqlite`. If you ever need to run the server on Node 26, the only swap is `drizzle-orm/bun-sqlite` → `drizzle-orm/better-sqlite3` in a single `db/client.ts` module (schema is driver-agnostic); that also unlocks `bun build --compile` single-exe later.
* If TNB (frontend TypeScript alias) proves unstable: fallback is `@typescript/typescript6` (official shim) or temporarily TS 6.0.3 for the frontend only — type-level parity, only checker speed changes.

### 2.5 Security posture (honest version)

* API keys: stored **AES-256-GCM encrypted at rest** in the `settings` table; the data key is a random 32-byte file `%LOCALAPPDATA%/Lorekeeper/secret.key` (created with user-only ACL). Threat model honestly stated: this protects against casual copying of `data/lorekeeper.db`; it is *not* protection against code running in your user session. Frontend never receives keys — only `{hasKey: true, keyHint: 'sk-or-…3f2a'}`; all provider calls happen server-side.
* Keys are transmitted to OpenRouter/UnoRouter over HTTPS only; the app adds no attribution headers you don't configure (optional `X-Title: Lorekeeper` setting).
* Server binds `127.0.0.1`; no CORS (same-origin via proxy in dev); attachments validated (MIME sniff of magic bytes + extension allowlist, ≤ 8 MB) before hitting disk; markdown rendered client-side is sanitized (§6.6); provider-generated HTML is never trusted.

---

## 3. Data model (Drizzle / SQLite)

SQLite in **WAL** mode, foreign keys ON. All IDs are `crypto.randomUUID()` (TEXT). Timestamps ISO-8601 TEXT (UTC). JSON columns use Drizzle `{ mode: 'json' }`.

```ts
// apps/server/src/db/schema.ts (sketch — exact file delivered in M0)
export const characters = sqliteTable('characters', {
  id: text().primaryKey(),
  name: text().notNull(),
  tagline: text(),                                  // "Victorian Occultist & Archival Heiress"
  tags: text({ mode: 'json' }).$type<string[]>().notNull().default([]),   // ["Noir"]
  avatarPath: text(),                               // data/media/... (null → generated initials)
  description: text().notNull().default(''),        // description / appearance
  creatorNotes: text().notNull().default(''),       // card creator_notes (V2/V3)
  extensions: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}), // lossless card round-trip
  personality: text().notNull().default(''),
  behavior: text().notNull().default(''),           // mannerisms
  communicationStyle: text().notNull().default(''),
  likes: text().notNull().default(''),
  dislikes: text().notNull().default(''),
  backstory: text().notNull().default(''),
  scenario: text().notNull().default(''),
  exampleDialogue: text().notNull().default(''),
  firstMessage: text().notNull().default(''),       // greeting
  alternateGreetings: text({ mode: 'json' }).$type<string[]>().notNull().default([]),
  systemExtras: text().notNull().default(''),       // extra system-prompt directives
  createdAt: text().notNull(), updatedAt: text().notNull(),
});

export const personas = sqliteTable('personas', {
  id: text().primaryKey(),
  name: text().notNull(),
  description: text().notNull().default(''),
  avatarPath: text(),
  isDefault: integer({ mode: 'boolean' }).notNull().default(false),
  createdAt: text().notNull(), updatedAt: text().notNull(),
});

export const chats = sqliteTable('chats', {
  id: text().primaryKey(),
  characterId: text().notNull().references(() => characters.id, { onDelete: 'restrict' }),
  personaId: text().references(() => personas.id, { onDelete: 'set null' }),
  title: text().notNull(),                          // defaults to character name; renameable
  ribbon: text(),                                   // the "Chapter IV: …" context ribbon
  status: text().notNull().default('in_progress'),  // 'in_progress' | 'archived'  (list tabs)
  // per-chat overrides (null → global defaults from settings)
  providerId: text(),                               // 'openrouter' | 'unorouter'
  modelId: text(),                                  // e.g. 'anthropic/claude-3.5-sonnet'
  presetId: text().references(() => presets.id, { onDelete: 'set null' }),
  lastMessageAt: text().notNull(),                  // list sort
  lastMessagePreview: text(),                       // list card snippet
  createdAt: text().notNull(),
});

// Swipes: all variants of one logical "slot" share (chatId, seq, groupId);
// exactly one row per group has isActive = 1. User messages: groupId = null.
export const messages = sqliteTable('messages', {
  id: text().primaryKey(),
  chatId: text().notNull().references(() => chats.id, { onDelete: 'cascade' }),
  seq: integer().notNull(),                         // logical position, 0-based, no gaps on read
  role: text().notNull(),                           // 'user' | 'assistant'
  text: text().notNull().default(''),               // raw Markdown source
  groupId: text(),                                  // variant group id (assistant messages)
  variantIndex: integer(),                          // 0-based within group
  isActive: integer({ mode: 'boolean' }).notNull().default(true),
  isGreeting: integer({ mode: 'boolean' }).notNull().default(false),
  providerId: text(), modelId: text(),              // provenance
  finishReason: text(),                             // 'stop'|'length'|'aborted'|'error'|null
  isError: integer({ mode: 'boolean' }).notNull().default(false), // inline error bubble (D10)
  error: text({ mode: 'json' }).$type<ChatError | null>(),        // { code, message, providerId?, modelId?, statusCode?, retryAfterMs? }
  usage: text({ mode: 'json' }).$type<TokenUsage | null>(),
  createdAt: text().notNull(),
}, (t) => [index('idx_messages_chat_seq').on(t.chatId, t.seq)]);

export const attachments = sqliteTable('attachments', {
  id: text().primaryKey(),
  messageId: text().references(() => messages.id, { onDelete: 'cascade' }), // null = pending
  filePath: text().notNull(),                       // relative to data/
  originalName: text().notNull(),
  mimeType: text().notNull(),                       // png|jpeg|webp|gif (sniffed)
  width: integer(), height: integer(), sizeBytes: integer().notNull(),
  createdAt: text().notNull(),
});

export const presets = sqliteTable('presets', {
  id: text().primaryKey(),
  name: text().notNull(),
  description: text().notNull().default(''),
  temperature: real().notNull().default(0.85),
  topP: real().notNull().default(0.92),
  topK: integer(),                                  // null → omit from request
  maxTokens: integer().notNull().default(4096),
  frequencyPenalty: real().notNull().default(0.0),
  presencePenalty: real().notNull().default(0.0),
  repetitionPenalty: real(),                        // null → omit (provider passthrough)
  stopSequences: text({ mode: 'json' }).$type<string[]>().notNull().default([]),
  isDefault: integer({ mode: 'boolean' }).notNull().default(false),
  createdAt: text().notNull(), updatedAt: text().notNull(),
});

// Key-value settings; `value` is JSON (encrypted envelope for apiKeys)
export const settings = sqliteTable('settings', {
  key: text().primaryKey(),                         // 'apiKeys' | 'globalDefaults' | 'promptTemplate' | 'composer' | 'modelCache:<provider>'
  value: text({ mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: text().notNull(),
});
```

**Settings rows (shapes in `packages/shared`):**

* `apiKeys` — `{ openrouter: { encrypted: string, iv: string, tag: string, hint: string } | null, unorouter: … }`
* `globalDefaults` — `{ providerId, modelId, presetId, personaId, contextBudgetTokens, keepLastNVariants }`
* `promptTemplate` — `{ systemTemplate, postHistoryInstructions }` (§4)
* `composer` — `{ enterToSend, autoScroll, imageMaxBytes, editDefaultRegenerate, caretBlinkMs (500), deliveredBlinkMs (250), deliveredBlinks (6) }`

**Model cache** lives in `settings` under `modelCache:<providerId>` (TTL 24 h; manual refresh button + refresh-on-open if stale). Manual model entry allowed: free-text model id accepted anywhere a model can be picked.

### 3.1 Messages & variants — semantics

* **Reading history** (`GET /api/chats/:id`): rows ordered by `seq`; assistant rows sharing `seq` are grouped into `{variants: [...], activeVariantId}`; history sent to the model uses **active variants only**.
* **Send** appends a user row at `seq = max+1`. **Generate** appends an assistant group at `seq = max+1` (streamed into a fresh variant).
* **Regenerate** adds a variant to the targeted group (stream in place; on `done` the new variant becomes active). Variants capped at `keepLastNVariants` (default 20) — oldest pruned; if the pruned one was active, next-newest becomes active.
* **Failed generations become error messages** (D10): the assistant variant row is persisted with `isError = 1`, `error = {code, message, …}`, `finishReason = 'error'`, and whatever partial text streamed before the failure. Retry (UI) = regenerate on that group → new healthy variant.
* **History inclusion rule:** the active variant participates in the prompt iff it has non-empty `text` — pure-error variants (no text) are skipped; error variants with partial text are included (the model can continue from them).
* **Swipe ‹ ›** = `POST .../activate` on a neighbouring variant (local-only op, no request to the model).
* **Edit user message**: `PATCH … {text, regenerateAfter?: boolean}`; with `regenerateAfter`, all groups at `seq >` this one are deleted (transactionally) and the client opens the generate stream. Default in UI = **Save** (D8); the dialog always offers “Save & regenerate after”, and Settings → Composer Behavior has `editDefaultRegenerate` to flip the default.
* **Edit assistant message**: edits the active variant in place.
* **Delete user message**: confirm dialog with a checkbox **“Also delete the reply that followed?”** (default checked) — checked removes the user row and everything after; unchecked leaves the following assistant reply orphaned-but-visible (D7: confirm, no undo toast).
* **Delete assistant message**: confirm dialog; removes its whole group (all variants) and renumbers following seqs in a transaction.
* **Delete error message**: confirm dialog; same as assistant delete.
* `seq` normalization: after any delete, renumber `seq` densely (single transaction) — keeps swipe logic and truncation trivial.
* **Greeting**: chat creation inserts an `assistant`, `isGreeting` row from `firstMessage` (or a random alternate greeting) at seq 0. Fully editable/regeneratable like any message.

### 3.2 Migration strategy

* `drizzle-kit generate` (offline, from `schema.ts`) writes versioned SQL into `apps/server/drizzle/`; the SQL files are committed.
* On server boot: `migrate(db, { migrationsFolder })` from `drizzle-orm/bun-sqlite/migrator` inside a `user_version`-guarded transaction — auto-migrate on startup, plus an explicit `bun run db:migrate` script and `bun run db:generate` for authoring.
* Deletions of characters/personas with chats are blocked (`restrict`) with a clear error telling you which chats reference them; cascade delete is a separate explicit action (“delete character + its N chats”).

---

## 4. Prompt assembly

### 4.1 System prompt template

Stored in `settings.promptTemplate` (editable in Settings → “Prompt Template”, textarea with variable cheat-sheet). Default:

```
{systemExtras}
You are {{char}} in an ongoing roleplay with {{user}}.

<Character>
Name: {{char}}
{{#tagline}}Tagline: {{tagline}}{{/tagline}}
Appearance & description: {{description}}
Personality: {{personality}}
Behavior & mannerisms: {{behavior}}
Communication style: {{communicationStyle}}
Likes: {{likes}} | Dislikes: {{dislikes}}
Backstory: {{backstory}}
Scenario: {{scenario}}
{{/Character}}

<Persona>
{{user}}: {{personaDescription}}
</Persona>

<ExampleDialogue>
{{exampleDialogue}}
</ExampleDialogue>

Style rules (apply to every reply): keep *actions* in asterisks and spoken lines in
"quotes". Stay in character; do not speak or act for {{user}}.
```

* `{{…}}` variables: `char`, `user`, `tagline`, `description`, `personality`, `behavior`, `communicationStyle`, `likes`, `dislikes`, `backstory`, `scenario`, `exampleDialogue`, `systemExtras` (character.systemExtras + global “system additions”), `personaDescription`, `personaName`.
* `{{#block}}…{{/block}}` sections are omitted when their variable is empty (simple mustache-style sections implemented in ~40 lines in `packages/shared/prompt-variables.ts` — unit-tested; no Handlebars dependency).
* `postHistoryInstructions` (a.k.a. jailbreak slot): appended as the **last system message after the history** when non-empty.
* Example dialogue is inserted into the system block wrapped in `<ExampleDialogue>` (replaced with a condensed placeholder if it exceeds 25 % of the context budget).

### 4.2 Request assembly

```
messages = [
  { role: 'system', content: renderedSystemTemplate },
  ...activeVariantHistory (seq order; user→ 'user', assistant→ 'assistant'),
  ...(postHistoryInstructions ? [{ role: 'system', content: PHI }] : []),
]
```

* The newest user message is the final `user` turn; **images** are attached to it as `content` parts: `[{type:'text',…}, {type:'image_url',…}]` — text first, then images (OpenRouter-recommended order). Images are read from disk, base64-encoded server-side per request (never stored in the DB as base64).
* Multimodal gating: OpenRouter model metadata (`architecture.input_modalities` includes `image`) enables attach UI; for UnoRouter models without metadata, attaching is allowed with a warning banner (A1). If a request fails with a provider error indicating no vision support, the error toast suggests disabling images for that model.
* Temperature/top_p/top_k/max_tokens/penalties/stop sequences come from the effective preset = `chat.presetId ?? globalDefaults.presetId`; `model` = `chat.modelId ?? globalDefaults.modelId`; provider = `chat.providerId ?? globalDefaults.providerId`. `repetition_penalty` and `top_k` are included only when non-null (passthrough params; some providers ignore them — documented in the settings UI).

### 4.3 Context-window management (v1 strategy)

* Budget = `min(model.contextLength − maxTokens − overhead, globalDefaults.contextBudgetTokens)`; overhead estimated as `chars/4` of system + PHI + the final user message + a 5 % safety margin. Character-based estimation is deliberately chosen over a tokenizer dependency for v1 (±10 % accuracy is acceptable; the whole prompt is re-trimmed every generation anyway). A `debugPreview` endpoint shows the exact assembled request for tuning.
* Trimming: walk the active-variant history from newest to oldest, always keep: greeting (seq 0, marked “context anchor”) + the newest contiguous user+assistant block; drop oldest blocks until the estimated total fits. Never split a pair. Trimmed turns are replaced by a one-line notice to the model? — **No** (keeps prompts clean); they are simply omitted.
* Post-v1 ideas (parked): rolling summary of dropped turns, per-chat pinned “memory” notes, lorebook/character-book support (V2 card `character_book` is currently flattened into `systemExtras` on import — documented on the import dialog).

---

## 5. Provider abstraction

```ts
// apps/server/src/providers/types.ts
export interface LlmProvider {
  readonly id: 'openrouter' | 'unorouter';
  readonly label: string;
  readonly baseUrl: string;                      // https://openrouter.ai/api/v1 | https://api.unorouter.com/v1
  listModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]>;
  testConnection(apiKey: string): Promise<{ latencyMs: number }>;
  streamChat(req: ChatRequest, apiKey: string, signal: AbortSignal): AsyncIterable<StreamEvent>;
}
// StreamEvent = { type:'delta', text } | { type:'done', finishReason, usage? } |
//              { type:'error', code, message, retryAfterMs? }
```

* **Shared engine** (`openaiCompat.ts`): both providers speak the same wire format; one implementation handles request building (incl. multimodal content parts), `fetch` with `signal`, SSE line-buffer parsing (`data:` frames, `[DONE]`, terminal usage chunk quirk where OpenRouter repeats `finish_reason` in the usage chunk — treated as accounting-only), mid-stream `data:` error frames, 429/`Retry-After` backoff metadata, and non-streaming error mapping (401 → `invalid_key`, 402 → `insufficient_credits`, 429, 5xx, network).
* `openrouter.ts` adds: `GET /models` parsing (`context_length`, `architecture.input_modalities`, pricing), optional `HTTP-Referer`/`X-Title`, `usage:{include:true}`.
* `unorouter.ts` adds: base URL, model list parsing with graceful fallback when metadata fields are absent (A1), same key handling.
* **Key resolution & storage (§2.5):** keys live encrypted in `settings.apiKeys`; decrypted in-memory only for the duration of a call; never logged; never returned by any API (only `keyHint` = first 6 + last 4 chars). Missing key → request fails fast with `no_key` before any provider traffic.
* **Generation orchestration** (`generation/session.ts`): builds the prompt (§4) → persists an empty assistant variant row → opens the SSE response (`meta` event with ids) → forwards deltas (also appending to an in-memory buffer) → on completion writes final text + `finishReason` + `usage` and emits `done`; **on any failure (provider HTTP error, mid-stream error frame, network fault, malformed payload) writes `isError: true` + the `ChatError` payload + partial text and emits `error` (§6.8)**. Only one active generation per chat is allowed (409 otherwise). Stop = client abort → `request.raw.close` → upstream abort → partial text persisted. Server crash mid-stream leaves an empty variant; it is cleaned up lazily on next chat load (`finishReason IS NULL AND text = ''`).

---

## 6. Frontend structure

### 6.1 Design system (extracted from `temp/*` mockups)

The five mockups share one coherent system — **“Editorial Sanctum”**: Material-3-style dark purple, mobile-first 390 px column, serif prose. Translated into Tailwind 4 CSS-first tokens (`apps/frontend/src/styles/tailwind.css`):

```css
@import "tailwindcss";
@theme {
  /* Material-3 dark palette sampled from the mockup tailwind.config */
  --color-background: #151219;      --color-surface: #151219;
  --color-surface-container-lowest: #100d14;
  --color-surface-container-low: #1d1a21;
  --color-surface-container: #221e26;
  --color-surface-container-high: #2c2830;
  --color-surface-container-highest: #37333b;
  --color-on-surface: #e8e0ea;      --color-on-surface-variant: #d4c4af;
  --color-primary: #e3c3ff;         --color-on-primary: #490081;
  --color-primary-container: #d09fff;
  --color-secondary: #cdc2db;       --color-secondary-container: #4b4357;
  --color-tertiary: #ffbcd9;        --color-tertiary-container: #ff90c7;
  --color-error: #ffb4ab;           --color-error-container: #93000a;
  --color-outline: #9d8f7c;         --color-outline-variant: #504535;
  --font-sans: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif; /* UI */
  --font-serif: "Source Serif 4", ui-serif, Georgia, serif;              /* prose */
  --radius-*: initial; --radius-lg: 0.5rem; --radius-xl: 0.75rem;        /* per mockups */
}
```

Component conventions from the mockups (implemented as reusable utilities/components): user messages = warm amber-tinted band (`amber-500/20` badge “You”, `#F472B6` 3 px right-edge marker, name in `#f5ecd8`); character messages = plain surface, no bubble, “Character” badge in `secondary-container/50`, dialogue paragraphs in ivory `#f3efe6` with `border-l-2 border-primary/40`, narration in italic `on-surface-variant/85`; variant pill `‹ 2/4 ›`; floating action row on `surface-container/90` with backdrop blur; composer shell `rounded-xl border-outline-variant/40 focus-within:border-primary/60` with amber gradient send button (`from-amber-600 to-amber-400`); 4 px parchment scrollbar; bottom nav (Chats / Characters / Settings) on list pages only. Streaming visuals follow §6.7 (word-processor caret, not a block cursor). Icons: mockups use Material Symbols; the app uses **Lucide via `unplugin-icons`** (1:1 mapping documented in a single `icons.ts` — e.g. `content-copy→copy`, `attach-file→paperclip`, `chevron-left→chevron-left`).

Fonts: `@fontsource-variable/plus-jakarta-sans` + `@fontsource-variable/source-serif-4` (per mockups, approved). Inter from your list stays installed as an optional fallback (swap is one line in `@theme`).

**Vapor Mode adoption (D4, approved):**

* `vue@3.6.0-rc.7`; feature components default to `<script setup vapor>` (template-only SFCs included); Options API not used anywhere anyway.
* **Classic VDOM components (interop):** `App.vue`, router shell (`RouterView`), `BottomNav`, and anything relying on APIs Vapor doesn't support yet — per RC notes: `getCurrentInstance()`, `v-memo`, element-lifecycle events, global properties; `Transition`/`KeepAlive`-heavy containers stay VDOM in v1 to be safe. Vapor ↔ VDOM mixing is explicitly supported and stabilized in the 3.6 RCs.
* Headless libraries (pinia, vue-router composables, vue-query) are unaffected by Vapor.
* Expected rough edges (tracked in M0 verification): Vue Devtools inspector coverage for Vapor components is partial in the RC; `@vue/test-utils` mounting of pure-vapor components is exercised in M0 with a smoke test — if a blocker appears, affected component tests mount an interop wrapper (VDOM parent rendering the vapor child), which is supported.
* Rollback path: if a blocking Vapor bug is hit, flip the affected SFC back to classic by removing the `vapor` marker (per-component, zero migration cost); worst case the whole app returns to 3.5.42.

### 6.2 Routes (vue-router 5, history mode, lazy-loaded pages)

| Path | Page | Notes |
|---|---|---|
| `/` | redirect → `/chats` | |
| `/chats` | `ChatsListPage` | Tabs All Chronicles / In Progress / Archived; summary bar (count, sort by recency); cards: avatar+presence dot, title, model pill, genre tag, preview, relative time; search; **New Tale** FAB → new-chat sheet (character picker → persona → optional model override) |
| `/chats/:id` | `ChatPage` | Full-screen conversation, no bottom nav (per mockup) |
| `/characters` | `CharactersPage` | Tabs Characters (n) / Personas (n); responsive card grid; long-press/hover selection mode → edit/delete overlay (per mockup); FAB + |
| `/characters/new`, `/characters/:id` | `CharacterEditorPage` | Collapsible sections exactly per mockup: Personality & Essence / Backstory & Scenario / Dialogue & Greeting / Advanced & System Directives; avatar upload; “Quick Voice Archetype Presets” chips; Save bar; preview (eye) mode |
| `/personas/new`, `/personas/:id` | `PersonaEditorPage` | Same shell, `mode="persona"` (simpler fields) |
| `/settings` | `SettingsPage` | Sections per mockup: API Providers & Keys / Intelligence Engine / Sampling & Context Tuning / Composer Behavior / Saved Generation Presets / Prompt Template (added) / Reset |

Per-chat settings (model override, preset, persona, ribbon, context budget) = **bottom sheet inside ChatPage** (matches header gear icon), not a separate route.

### 6.3 Components (key ones)

* `chat/ChatHeader` (back, avatar, name, model pill, gear) · `chat/ContextRibbon`
* `chat/MessageList` (scroll manager: pinned-to-bottom unless user scrolled up > 120 px; smooth scroll on new tokens when pinned) · `chat/MessageItem` (role-polymorphic) · `chat/MessageBody` (settled markdown render with paragraph classification — starts with `“`/`"` → dialogue style, `em`-wrapped → narration — plus the §6.7 *streaming mode*: fade-in chunks + sliding caret) · `chat/StreamingCaret` (+ `caret.ts` FLIP helper) · `chat/DeliveredDot` (§6.7 Stage B) · `chat/ErrorBubble` (§6.8: code title, collapsible raw details, Retry/Delete) · `chat/MessageActions` (Edit/Copy/Delete; +Regenerate for assistant; +Retry for errors; click-reveal on mobile, hover-reveal on desktop) · `chat/VariantSwitcher` · `chat/ImageGrid` (attachments in bubbles, lightbox)
* `chat/Composer` (auto-grow textarea `max-h-24` per mockup; Enter/Shift+Enter per settings; paste-image & drag-drop handlers; pending attachment thumbnails with remove; Stop button while streaming)
* `chat/NewChatSheet` · `chat/ChatSettingsSheet`
* `characters/CharacterCard` · `PersonaCard` · `CharacterEditor` (+ `SectionCard`, `AvatarPicker`, `TagInput`, `VoiceArchetypeChips`)
* `settings/ProviderKeysCard` (masked value, reveal, copy, test-connection with latency) · `settings/ModelPicker` (+ `ModelLibraryModal` with search, context length, vision badge, pricing) · `settings/SamplingControls` (sliders with qualitative labels, steppers, stop-sequence tag input) · `settings/PresetCard` (Load/Edit/Delete + Save-current)
* `ui/BottomNav` · `ui/ToastHost` (informational toasts: Copied, warnings, CRUD errors) · `ui/ConfirmDialog` (single destructive-action pattern, D7) · `ui/Sheet` · `ui/Modal` · `ui/Slider` · `ui/Stepper` · `ui/ToggleSwitch` · `ui/Icon`

### 6.4 State management

* **Vue Query** owns *all server state*: `['chats', status, q]`, `['chat', id]`, `['characters']`, `['character', id]`, `['personas']`, `['presets']`, `['settings']`, `['providers']`, `['models', providerId]`. Mutations invalidate precisely; optimistic updates for rename/archive/delete with rollback on error.
* **Streaming** bypasses mutations: the SSE client writes deltas directly into the `['chat', id]` cache via `queryClient.setQueryData` (append text to the streaming variant row). A tiny Pinia store `useStreamingStore` holds `{ chatId, abortController, isStreaming }` — the single source of truth for Stop-button state and 409-guarding.
* **Pinia** additionally owns: `useSettingsStore` (mirror of `['settings']` + provider statuses for easy computed gating, e.g. attach-button disabled), `useUiStore` (toast/confirm queue). No global message store — the chat cache is it.

### 6.5 Chat view behaviors (checklist mapped from your spec)

1. Newest-at-bottom scrollable list; auto-scroll while streaming; **no yank** when scrolled up (scroll manager in 6.3). Toggle in settings (“Auto-scroll on response stream”).
2. Composer: grows to `max-h-24` then scrolls; Enter/Shift+Enter configurable; Send disabled while streaming; Stop visible while streaming (also per mockup inside the attachment row).
3. Attach images: button (file picker), drag-drop onto composer, clipboard paste; thumbnails with remove; hard cap 4 images/message and `imageMaxBytes` (default 8 MB); attach disabled + explanatory tooltip when model lacks vision (or warning when unknown — A1).
4. Streaming: animated per §6.7 (fading-in text + sliding blinking caret + post-stream “delivered” blink); **Stop** keeps partial text as the message (`finishReason: 'aborted'`).
5. Message action bar: click-to-reveal (must work on touch), hover-reveal on desktop; exact action sets per role (user: Edit/Copy/Delete; assistant: Regenerate/Edit/Copy/Delete; error bubbles: Retry/Delete).
6. Edit → inline editor (textarea + Save/Cancel, Esc cancels, Ctrl+Enter saves); user-message edit dialog offers **Save** (default) vs **Save & regenerate after**; Settings → Composer Behavior `editDefaultRegenerate` flips the default (D8).
7. Copy = raw Markdown source; “Copied” toast; uses async clipboard API with fallback.
8. Delete: confirm dialog for **every** delete (D7); user-message dialog includes checkbox “Also delete the reply that followed?” (default checked). No undo toasts.
9. Regenerate: streams a new variant in place; variant pill ‹ n/N › with keyboard ←/→ when focused; cap 20 (settings).
10. Errors: inline error bubble per §6.8, persisted in the conversation, with Retry where applicable.
11. Markdown: GFM (tables, strikethrough), fenced code with highlight.js and copy-button, `*narration*` italic serif, `"dialogue"` ivory + left border, block quotes; sanitized (§6.6).
12. Avatars + names + role badges; timestamps subtle on the right (per mockup), full date in tooltip.
13. Header: back, avatar+name, model pill (pulsing dot), gear → per-chat sheet; ribbon row with chapter label + live “Turn N” (count of logical positions).
14. Empty state = greeting already inserted server-side (3.1), rendered like any assistant message.

### 6.6 Markdown & safety pipeline

`marked` (GFM) → custom renderer (code → `highlight.js` with a small language set; links `rel="noopener noreferrer" target="_blank"`) → **`DOMPurify.sanitize`** (default profile + `img` allowed only from `/media/*` and `data:` images we rendered, no iframes/styles) → Vue `v-html` in a scoped container. The pipeline is a pure function with unit tests (XSS fixture corpus: `<script>`, `onerror=`, `javascript:` URIs, nested HTML in code fences).

### 6.7 Streaming animations (D9) — two sequential stages

**Stage A — live-typing caret (while streaming).** Implemented in `MessageBody` with a dedicated *streaming mode* renderer (bypasses the settled markdown pipeline; chunks accumulate as text nodes, sanitized chunk-wise with the same DOMPurify profile):

* **Fading-in text:** incoming deltas are batched per animation frame and appended as short `<span class="lk-fade-in">` runs with `@keyframes lk-fade-in { from { opacity: 0 } }` (~180 ms ease-out). A rolling window merges spans older than ~1 s back into the settled text node so the DOM never grows with the message.
* **The caret:** an inline-block vertical bar (`w-[2px] h-[1.05em] bg-primary`, rounded) rendered *inline* at the exact end of the in-progress text — it reflows with the text and therefore **follows line wraps automatically** instead of teleporting.
* **Sliding motion:** after each delta batch we apply a FLIP step — record the caret’s `getBoundingClientRect()` before commit, re-render, record again, then animate `transform: translate(old → new)` over ~150 ms ease-out (transition is interruptible: the next delta starts from the current interpolated position, so rapid tokens produce a continuous glide rather than stuttering). If reduced motion or the delta rate exceeds the animation budget (> ~30 commits/s), the FLIP step is skipped and the caret simply reflows.
* **Blink:** `@keyframes lk-caret-blink` steps opacity 1→0→1 over `caretBlinkMs` (default **500 ms**, adjustable in Settings → Composer Behavior → “Caret blink interval”); blink runs continuously while streaming.
* **Completion:** the caret element is removed when the stream finishes (message switches to the settled markdown renderer).

**Stage B — “delivered” indicator (after `done`).** In the message header next to the timestamp (per the mockup’s “Just now” + dot):

* A small dot (`w-1.5 h-1.5 rounded-full bg-tertiary-container`) appears and blinks with `@keyframes lk-delivered` at `deliveredBlinkMs` (default **250 ms**) for exactly `deliveredBlinks` (default **6**) iterations, then **fades out and is removed** — a brief confirmation, not a persistent blinker. (Also fires for aborted/error terminations, in the role-appropriate colour: tertiary for `stop`, amber for `aborted`, error-red for `error`.)
* Settings: “Delivered blink interval”, “Delivered blink count”; both default as above.

**Accessibility & performance:** all of Stage A/B collapses under `prefers-reduced-motion: reduce` (no fade, no FLIP, no blink — caret is a static bar, delivered dot is static). Animations are pure CSS + one rAF-coalesced FLIP helper in `streaming/caret.ts`; no new dependencies.

### 6.8 Errors surfaced inline in chat (D10)

Any generation-path failure — OpenRouter/UnoRouter HTTP errors (401/402/429/5xx), mid-stream error frames, network/DNS/timeouts, malformed AI responses (bad SSE payload, schema-violating chunk), or a locally-detected failure (e.g. missing API key) — becomes a **persistent message in the conversation**, not a toast:

* **Persistence:** the generation session writes the assistant variant row with `isError = 1`, `error = {code, message, providerId?, modelId?, statusCode?, retryAfterMs?}` and any partial text (§3.1). Failures that occur *before* any content (e.g. connection refused) persist an empty-text error variant, so the failed turn is still visible in the thread and survives reloads.
* **Rendering:** distinct bubble — `error`-accented: `border-l-2 border-error`, `bg-error-container/30`, `circle-alert` icon, title from `code` (“Rate limited”, “Insufficient credits”, “Connection failed”, “Malformed response”, …), collapsible **details** with the raw underlying message (and `retryAfterMs` when present). No prose renderer (never markdown-rendered; text is shown escaped) — avoids confusing partial HTML.
* **Actions:** **Retry** (regenerate → new variant; for 429 the button shows a countdown from `retryAfterMs`) and **Delete** (confirm dialog). Editing an error bubble is disabled.
* **What stays a toast instead:** pure CRUD/validation failures (rename/delete/rename character, settings saves, attachment upload rejections) — they are transient form errors, not conversation records; they also do not pollute the RP log.
* **Chat header state:** if the latest generation errored, the header “Just now” dot renders in `error` colour (§6.7 Stage B), and the composer shows a subtle inline hint “Last reply failed — Retry?” above the input.

---

## 7. API contract

Schemas live in `packages/shared` (zod 4) and are imported by both sides. Server registers `fastify-type-provider-zod`’s validator/serializer compilers. Errors: Fastify error shape + `hasZodFastifySchemaValidationErrors` guard → `{ statusCode, code, message, details? }`.

### 7.1 REST

| Method & path | Purpose | Body (zod) → Response |
|---|---|---|
| `GET /api/health` | liveness | → `{ ok, version, db }` |
| `GET /api/providers` | providers + status | → `[{ id, label, baseUrl, hasKey, keyHint, status: 'connected'\|'error'\|'no_key', latencyMs?, modelsFetchedAt? }]` |
| `PUT /api/providers/:id/key` | store key | `{ key: string (min 8) }` → `{ ok, keyHint }` |
| `DELETE /api/providers/:id/key` | remove key | → `{ ok }` |
| `POST /api/providers/:id/test` | ping | → `{ status, latencyMs }` |
| `GET /api/providers/:id/models?refresh=1` | catalog (cached 24 h) | → `[ModelInfo]` — `{ id, name, contextLength, inputModalities: string[], promptPrice?, completionPrice? }` |
| `GET/POST /api/characters` · `GET/PUT/DELETE /api/characters/:id` | character CRUD | `CharacterInput` / `Character` (§3); DELETE blocked while chats exist (error lists chat count; `?force=1` deletes chats too) |
| `POST /api/characters/import` | import card | card JSON — `chara_card_v3` (V3), `chara_card_v2` (V2), or legacy flat V1; unknown fields → `extensions` → `Character` |
| `GET /api/characters/:id/export` | export card | V2 card JSON (attachment download); `?format=v3` → V3 card (stretch, M4+) |
| `GET/POST /api/personas` · `GET/PUT/DELETE /api/personas/:id` · `PUT /api/personas/:id/default` | persona CRUD | `PersonaInput` / `Persona` |
| `GET /api/chats?status=&q=` | list | → `ChatSummary[]` (id, title, characterName, avatarPath, modelLabel, tag, preview, lastMessageAt, status) |
| `POST /api/chats` | create + greeting | `{ characterId, personaId?, providerId?, modelId?, presetId? }` → `ChatDetail` |
| `GET /api/chats/:id` | full thread | → `{ chat, character, persona?, messages: ChatMessage[] }` — `ChatMessage = { id, seq, role, groupId?, isGreeting, isError, error?: ChatError, variants: Variant[], activeVariantId, attachments, usage?, finishReason? }` |
| `PATCH /api/chats/:id` | rename / overrides / archive | `{ title?, ribbon?, personaId?, providerId?, modelId?, presetId?, status? }` → `Chat` |
| `DELETE /api/chats/:id` | delete chat | → `{ ok }` (confirm dialog in UI) |
| `POST /api/chats/:id/messages` | append user message | `{ text: string (1..32000), attachmentIds?: string[] (≤4) }` → `{ message }` |
| `POST /api/chats/:id/messages/:messageId` | edit | `{ text?, regenerateAfter?: boolean }` → `{ message, truncatedSeq? }` |
| `DELETE /api/chats/:id/messages/:messageId?withReplies=0\|1` | delete | → `{ deletedIds: string[] }` |
| `POST /api/chats/:id/messages/:messageId/activate` | swipe | `{ variantId: string }` → `{ message }` |
| `POST /api/attachments` | upload image (multipart) | file ≤ `imageMaxBytes`; png/jpeg/webp/gif sniffed | → `{ id, url, width, height, mimeType }` |
| `GET /media/*` | static images (@fastify/static) | — |
| `GET/POST /api/presets` · `PATCH/DELETE /api/presets/:id` | presets | `PresetInput` / `Preset` |
| `GET /api/settings` · `PATCH /api/settings` | settings sections | `SettingsPatch` (partial per §3) → `Settings` (keys masked) |
| `GET /api/chats/:id/prompt-preview` | debug | → assembled `{ system, history: [...], options }` (M4, powers a “what does the model see?” viewer) |

All list endpoints return stable shapes suitable for Vue Query; mutation responses return the mutated entity to enable optimistic cache writes.

### 7.2 SSE (generation)

`POST /api/chats/:id/generate` and `POST /api/chats/:id/messages/:messageId/regenerate` → `text/event-stream`:

```
event: message
data: {"type":"meta","messageId":"…","groupId":"…","seq":42}
data: {"type":"delta","text":"A ghost"}
data: {"type":"delta","text":" of a grim smile…"}
data: {"type":"done","finishReason":"stop","usage":{"promptTokens":1821,"completionTokens":342,"costUsd":0.0041}}
```

* `{"type":"error","code":"upstream_429","message":"…","retryAfterMs":1200}` replaces `done` on failure; the variant row is persisted with `isError: true`, the full `ChatError` payload and any partial text — rendered as an inline error bubble (§6.8). A final `done`-equivalent event always closes the stream (either `done` or `error`), so the client never waits on a dangling connection.
* Client: `fetch` + `ReadableStream` reader + line-buffer parser (`packages/shared/sse.ts`, shared with tests); `AbortController` for Stop; 409 handling if a generation is already running (single-flight guard in `useStreamingStore`).
* Comment heartbeat `: ping` / 15 s.

---

## 8. Tooling setup

### 8.1 TypeScript configuration (ESNext + TS 7 / tsgo aware)

* Root `typescript@7.0.2` provides the native `tsc` (used by backend/shared and by `tsc -b`).
* **ESNext frontend, `preserve` backend (settled with Testika after studying the TSConfig reference):** every tsconfig keeps `target: "esnext"` and explicit `lib`. The frontend uses `module: "esnext"` + `moduleResolution: "bundler"` (Vite/Vue ecosystem convention). The **backend (Bun) uses `module: "preserve"`** — the reference states (verbatim): *“this module mode best reflects the capabilities of most modern bundlers, as well as the Bun runtime”* (added in TS 5.4; still in the current reference’s allowed list, so tsgo/TS 7 supports it). `preserve` implies `moduleResolution: "bundler"` (documented default: *“Bundler if module is Preserve”*), preserves each import/export statement’s syntax as written, and is exactly the combination Bun’s own docs generate for `bun init` — together with `moduleDetection: "force"` and `verbatimModuleSyntax: true`. Invalid TS 7 combos (`moduleResolution: "node"/"classic"`, `target: "es5"`, `baseUrl`, `module: amd/umd/system/none`) remain hard errors; options below were cross-checked against the official TSConfig reference at `typescriptlang.org/tsconfig/`.

| Option | Value (base) | Reference-checked rationale |
|---|---|---|
| `target` | `esnext` | Runtime is Bun 1.4 / modern Chromium — no downleveling needed. |
| `module` | frontend `esnext` · server `preserve` | `preserve` = per-statement format preservation, bundler/Bun semantics (see above); `esnext` for the bundled SPA. |
| `moduleResolution` | `bundler` (both) | Required pairing for `module: esnext`; **implied default** by `module: preserve` (stated explicitly for clarity). Resolves `exports`/`imports` maps like Vite/Bun do; no file extensions required on relative imports. |
| `moduleDetection` | `force` (server) | Per Bun’s suggested config: every file is treated as a module regardless of imports. |
| `lib` | `["esnext", "dom", "dom.iterable"]` (frontend) · `["esnext"]` (server/shared) | Explicit `lib` keeps the environment surface honest alongside `types`. |
| `strict` | `true` | Default-on in TS 7; explicit for clarity. |
| `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | `true` | Strictest indexing/optionality; zero-`any` goal (Bun’s template also sets `noUncheckedIndexedAccess`). |
| `verbatimModuleSyntax`, `isolatedModules` | `true` | Correct `import type` discipline under Bun/Vite single-file transforms — compatible with `module: preserve` (Bun’s own template pairs them). |
| `allowImportingTsExtensions` | `true` (server) | Bun natively imports `.ts` extensions; requires `noEmit`, which we have (Bun docs recommendation). |
| `noEmit` | `true` | Typecheck-only pipeline: runtime compilation = Bun (server) / Vite (frontend). |
| `types` | frontend `["vite/client"]` · server `["bun-types"]` · shared `[]` | TS (6+/7) defaults `types` to `[]` — each project declares exactly what it runs on. `bun-types@1.4.2` matches the pinned runtime exactly; the docs-recommended `@types/bun@1.4.1` alias lags one patch behind, so `bun-types` wins. |
| `skipLibCheck` | `true` | Pragmatic; third-party `.d.ts` noise suppressed, own code still fully checked. |
| `paths` | frontend `{ "@/*": ["./src/*"] }` | TS 7 has **no `baseUrl`** — paths are relative to the tsconfig file (reference: paths remap relative to baseUrl “if set, or to the tsconfig file itself otherwise”). |
| `jsx` | `preserve` (frontend only) | Vue JSX not used in components; `preserve` keeps any `.tsx` util non-emitting. |
| `composite` / `references` | root solution file references the three projects | `tsc -b` builds/checks the graph. |

* **TS 7 hard rules respected**: no `baseUrl`; `moduleResolution` only `bundler`/`node16`/`nodenext`; `esModuleInterop`/`allowSyntheticDefaultImports` not disabled; `strict` on; `types` declared explicitly; no `ignoreDeprecations` anywhere.
* Frontend workspace declares `"typescript": "npm:typescript-native-bridge@6.0.3-bridge.16.tsgo.7.0.2"` → `vue-tsc`/`vitest typecheck`/tsserver all run on the Go checker with the classic API (D3). TNB pins tsgo **7.0.2** diagnostics — identical to the backend checker.
* Solution-style root `tsconfig.json` with `references` to `packages/shared`, `apps/server`, `apps/frontend`; `bun run typecheck` = `tsc -b` (native) **and** `vue-tsc -b apps/frontend` (TNB). Editor: VS Code “use workspace TypeScript version” → TNB tsserver (Vue plugin keeps working per TNB docs).

```jsonc
// tsconfig.base.json (shared bits)
{
  "compilerOptions": {
    "target": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true   // typecheck-only; runtime = Bun / Vite
  }
}
// apps/server/tsconfig.json → extends base;
//   "module": "preserve", "moduleDetection": "force", "allowImportingTsExtensions": true,
//   "lib": ["esnext"], "types": ["bun-types"]; include src
// apps/frontend/tsconfig.json → extends base;
//   "module": "esnext", "lib": ["esnext", "dom", "dom.iterable"], "types": ["vite/client"],
//   "jsx": "preserve", "paths": { "@/*": ["./src/*"] }; include src, env.d.ts
// packages/shared/tsconfig.json → extends base; "module": "esnext"; "lib": ["esnext"]
```

Note: `module` is deliberately **not** in the base file — it is a per-project decision (`preserve` for the Bun server, `esnext` for the bundled frontend/shared). `moduleResolution: "bundler"` is the shared, valid default for both (and the implied default of `preserve`).

### 8.2 Biome (`biome.json`)

Single formatter+linter for TS/Vue/CSS/JSON: 2-space indent, single quotes, semicolons, `organizeImports` on save, recommended lint + `a11y` group, `.vue` files included (script blocks; templates additionally guarded by vue-tsc). Scripts: `lint` = `biome check .`, `lint:fix` = `biome check --write .`. Git hook: optional `simple-git-hooks`-free approach — you run `bun run lint` before commits (solo project; no CI server in v1).

### 8.3 Vitest (`vitest.config.ts`, projects)

```ts
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', environment: 'node',
        include: ['packages/shared/**/*.test.ts', 'apps/server/**/*.test.ts'] } },
      { test: { name: 'component', environment: 'jsdom',
        plugins: [vue()], include: ['apps/frontend/src/**/*.test.ts'] } },
    ],
  },
})
```

Vitest 5 notes applied: `clearMocks` defaults to true (we rely on it), `vi.mock` only at top level, typecheck script (`bun run typecheck`) is separate from `test` — `vitest --typecheck` with `checker: 'vue-tsc'` available as `test:types` (runs on TNB). Vitest runs under Node 26.7 (`bun run test` spawns the Node-shebang bin).

### 8.4 Scripts (root `package.json`)

| Script | Does |
|---|---|
| `dev` | `bun run --parallel --filter '*' dev` (Vite + `bun --watch` server) |
| `build` | `bun run --filter '@lorekeeper/frontend' build` (vite build) |
| `start` | `bun apps/server/src/index.ts` (serves built SPA + API on :3000) |
| `test` / `test:watch` | `vitest run` / `vitest` |
| `typecheck` | `tsc -b && vue-tsc -b apps/frontend` |
| `lint` / `lint:fix` | `biome check .` / `--write` |
| `db:generate` | `drizzle-kit generate` (offline, from schema) |
| `db:migrate` | `bun apps/server/src/db/migrate.ts` (also runs automatically on boot) |

---

## 9. Testing strategy

| Layer | Tool | What is covered |
|---|---|---|
| Unit — pure logic | Vitest (node) | prompt-variables renderer (template + empty-section rules), context trimming (budget edges, pair integrity, greeting anchor), variant semantics (activate/cap/prune/renumber — against a real `bun:sqlite` in-memory DB via Drizzle), **error-message lifecycle (persist isError/error, partial-text retention, history inclusion rule)**, zod schemas round-trip, SSE line parser (chunk splits, `[DONE]`, usage chunk, mid-stream error), key crypto envelope, ST V2/V3 card mapping (fixtures incl. `character_book` flattening), provider request builders (snapshot: params included/omitted, image part ordering) |
| Unit — HTTP | Vitest + Fastify `inject()` | route auth-less happy paths, validation errors (zod → 400 shape), 409 single-generation guard, attachments (size/type rejection), settings masking (no key material in responses) |
| Unit — provider | Vitest + mocked `fetch` | SSE stream fixtures per provider (OpenRouter usage-chunk quirk; UnoRouter missing metadata), 401/402/429/5xx mapping, abort propagation |
| Component | Vitest + jsdom + @vue/test-utils | Composer (grow, Enter/Shift+Enter toggle, paste/drop attachments, disabled states), MessageItem (role actions, inline edit flows, variant switcher, **error bubble: rendering, details toggle, Retry wiring**), MessageList scroll manager (pinned/detached), streaming mode (**caret element present/moves/removed at done; fade-in spans coalesce; delivered-blink triggers the documented class sequence** — behavior assertions via class/DOM checks, not pixel timing), ModelPicker (vision gating), PresetCard, form validation for CharacterEditor |
| **Skipped for v1** | — | Browser E2E (Playwright), real-network provider tests (manual checklist in M1/M3 instead), visual regression against mockups (manual pass), performance tests. Planned post-v1: a thin Playwright smoke suite (`new chat → send → mock-stream → swipe → delete`). |

Definition of done for every milestone: `bun run lint && bun run typecheck && bun run test` green + manual smoke on Windows (dev and `start` mode).

---

## 10. Phased roadmap

**M0 — Scaffold & skeleton** (~0.5 wk)
`git init` + first commit (plan, `.gitignore`); **LICENSE (MIT), README with creator credit, CREDITS.md** (§13); Bun workspace scaffold; biome + vitest + tsconfigs (TS7 + TNB) working; Tailwind 4 `@theme` tokens from mockups; Fastify skeleton (`/api/health`, error handler, zod provider, static serving + SPA fallback); Drizzle schema + first migration + auto-migrate on boot; app shell (bottom nav, routes, empty pages); **Vue 3.6-rc.7 + Vapor verification task**: app renders with `<script setup vapor>` components inside the VDOM shell, one component test mounts a vapor SFC, pinia/router/vue-query run under the RC; recorded fallback trigger criteria.
**Done:** repo initialized and credited; `bun run dev` shows the shell at :5173 with live `/api/health`; `bun run start` serves the built SPA at :3000; lint/typecheck/test green; `data/lorekeeper.db` auto-created/migrated.

**M1 — Settings & providers** (~0.5 wk)
Settings page per mockup (providers/keys with mask+test, Intelligence Engine model picker + library modal, Sampling controls, Composer behavior incl. new streaming-animation and edit-default toggles, presets CRUD, prompt template editor); provider abstraction + OpenRouter/UnoRouter implementations (models, test, key storage); model cache; **enter the provided UnoRouter key via the UI** (never in files) and confirm both providers show “Connected (latency)”. Live API verification of UnoRouter was already performed during planning (§1) — M1 repeats it through the app itself.
**Done:** both providers connected; browse real model catalogs; save/load presets; manual model entry works; unit tests for providers (mocked) pass.

**M2 — Characters & personas** (~0.5–1 wk)
Character/persona CRUD + editors per mockup (sections, avatar upload, voice archetype chips); import (Tavern V1 flat / ST V2 `chara_card_v2` / V3 `chara_card_v3` JSON — no V4+ exists; V3.1 is an unadopted RFC) with `extensions` passthrough / export V2; Characters page grid + selection mode.
**Done:** create/edit/delete characters & personas; import real SillyTavern card JSON (V2 and V3 fixtures) maps all fields losslessly; export round-trips; grid matches mockup.

**M3 — Chats, streaming, messages** (~1–1.5 wk) — the core
Chats list page; chat creation flow (+greeting); ChatPage with header/ribbon; composer (send, Enter config, stop); SSE generation end-to-end (send → stream → persist); **streaming animations (§6.7: fade-in chunks, sliding blinking caret with FLIP, delivered-blink)**; **inline error bubbles with Retry (§6.8)**; message actions (edit/copy/delete/confirm, regenerate, swipes); scroll manager; markdown pipeline; image attachments (upload, thumbnails, multimodal request, vision gating) — images may land last within M3 if timeboxed.
**Done:** full RP session per your §1/1a checklist works against a real OpenRouter model: streaming with the caret/delivered animation and stop-keeps-partial, regenerate variants with ‹ n/N ›, edit-with-regenerate, deletes with confirm, errors render inline and retry cleanly, images render in bubbles and reach the model; tests from §9 green.

**M4 — Polish & hardening** (~0.5–1 wk)
Per-chat settings sheet; per-chat overrides honored in generation; prompt-preview debug viewer; empty/loading/error states everywhere; toasts/confirm dialogs unified; keyboard accessibility pass; manual pass against all five mockups; data backup note (`data/` copy); perf sanity (long chats: virtualize message list only if needed — measure first).
**Done:** every checklist item in your brief demonstrably works in `start` mode; lint/typecheck/test green; plan-vs-actual addenda recorded.

**Post-v1 backlog (parked):** PNG character-card import, character books/lorebooks, rolling summaries, chat export (Markdown/JSON), multi-model comparison swipes, optional pass-phrase lock, Bun `--compile` single executable, light theme.

---

## 11. Decisions received & risks

### All questions answered (2026-09-07, by Testika)

| # | Question | Decision |
|---|---|---|
| 1 | Fonts: design fonts vs Inter? | **Design fonts approved** (Plus Jakarta Sans + Source Serif 4; Inter stays as optional fallback). |
| 2 | Vue version | **3.6.0-rc.7 with Vapor Mode** (D4). Fallback: 3.5.42 if a blocker appears. |
| 3 | Delete UX | **Confirm dialog everywhere** (D7). No undo toasts. |
| 4 | Edit default | **“Save” is the default**; dialog offers “Save & regenerate after”; `editDefaultRegenerate` setting flips the default (D8). |
| 5 | Key encryption | **AES-256-GCM + key file in `%LOCALAPPDATA%`** (as planned, §2.5). |
| 6 | Variant cap 20 | **Confirmed.** |
| 7 | UnoRouter key | **Provided via chat**; live-verified `GET /v1/models` + one minimal streaming request during planning (§1). The key is never stored in the plan/repo — entered via the Settings UI in M1. **Recommend rotating the key**, since it was shared in plaintext. |
| 8 | Ports | **No conflicts** (server :3000, Vite :5173). |
| 9 | Git repo | **Yes — initialized at M0 start** (M0 includes `git init` + first commit). |

### New scope received with the answers

* **Open source / MIT / attribution** → §13 (LICENSE, README credit, `author` field, CREDITS.md; folded into M0).
* **Streaming animations** (caret + delivered blink) → §6.7 (D9); settings + tests updated.
* **ESNext tsconfig + TSConfig-reference study** → §8.1 rewritten with a reference-checked options table.
* **Inline chat errors with Retry** → §6.8 (D10); data model, generation session, API contract, tests updated.

### Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Vue 3.6-rc / Vapor is pre-stable**: RC regressions, partial Devtools support for Vapor components, `@vue/test-utils` gaps on pure-vapor SFCs | Framework churn during M0–M4 | Vapor is per-component opt-in — any problematic SFC drops the `vapor` marker (zero-cost revert); shell stays VDOM; M0 runs a dedicated verification task with explicit fallback criteria to 3.5.42; pin exact `3.6.0-rc.7` (no ranges) and track rc releases deliberately |
| Peer-range warnings under vue 3.6-rc (pinia/vue-router/test-utils) | Install noise, upgrade friction | Expected + documented; re-check peers when Vue 3.6 stable lands and unpin the rc |
| TS 7 ecosystem is young: TNB is a one-maintainer bridge (though Vue-team-validated) | Typecheck tooling breakage | Fallback chain: TNB → `@typescript/typescript6` → TS 6.0.3 for frontend only; nothing in app code depends on TS version |
| `bun:sqlite` locks backend to Bun | Runtime portability | Single `db/client.ts` swap point; schema driver-agnostic; documented Node path (§2.4) |
| Drizzle 0.45 minor-line API drift | Migration churn | Pin exact versions; migrations are plain SQL files; `generate` is offline |
| fastify-type-provider-zod v7 serializes `z.output` | Response/type surprises | Response schemas written as output types; round-trip tests per endpoint |
| Provider behavior differences (param passthrough, metadata gaps, 429 semantics) | Runtime errors | Single compat engine + per-provider adapters; explicit error-code mapping; unknown-metadata → allow-with-warning; integration checklist in M1/M3 |
| Vite 8/Rolldown edge cases with `unplugin-icons` | Build quirks | All plugins are maintained/Rolldown-compatible per Vite 8 CI suite; fallback: pin `rolldown-vite` interlayer |
| Long chats degrade DOM performance — amplified slightly by streaming-animation DOM (fade-in spans) | UX | Span coalescing window (~1 s) caps node growth; FLIP is one rAF step; reduced-motion collapses everything; virtualization parked but scoped |
| Single-process SQLite lock if two instances run | Confusion | WAL + `busy_timeout`; docs say “one instance” |
| Shared API key exposure (provided in chat) | Credential leak | Not stored anywhere in the plan/repo; entered via UI; **rotate** (§11 Q7) |

---

## 12. Final `package.json` files (verified versions)

```jsonc
// package.json (root)
{
  "name": "lorekeeper",
  "description": "Local-first roleplay client for LLMs via OpenRouter & UnoRouter",
  "author": "Testika",
  "license": "MIT",
  "private": true,
  "type": "module",
  "engines": { "bun": ">=1.4.2", "node": ">=26.0.0" },
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "bun run --parallel --filter '*' dev",
    "build": "bun run --filter '@lorekeeper/frontend' build",
    "start": "bun apps/server/src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:types": "vitest --typecheck",
    "typecheck": "tsc -b && vue-tsc -b apps/frontend",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "db:generate": "drizzle-kit generate --config apps/server/drizzle.config.ts",
    "db:migrate": "bun apps/server/src/db/migrate.ts"
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.12",
    "@types/node": "26.4.1",
    "drizzle-kit": "0.31.10",
    "typescript": "7.0.2",
    "vitest": "5.0.0"
  }
}
```

```jsonc
// packages/shared/package.json
{
  "name": "@lorekeeper/shared",
  "author": "Testika",
  "license": "MIT",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "4.5.4" }
}
```

```jsonc
// apps/server/package.json
{
  "name": "@lorekeeper/server",
  "author": "Testika",
  "license": "MIT",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "typecheck": "tsc -b",
    "test": "vitest run --project unit"
  },
  "dependencies": {
    "@lorekeeper/shared": "workspace:*",
    "@fastify/multipart": "10.1.1",
    "@fastify/static": "10.1.3",
    "drizzle-orm": "0.45.2",
    "fastify": "5.12.3",
    "fastify-type-provider-zod": "7.0.0",
    "zod": "4.5.4"
  },
  "devDependencies": {
    "bun-types": "1.4.2"
  }
}
```

```jsonc
// apps/frontend/package.json
{
  "name": "@lorekeeper/frontend",
  "author": "Testika",
  "license": "MIT",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "vue-tsc -b",
    "test": "vitest run --project component"
  },
  "dependencies": {
    "@fontsource-variable/plus-jakarta-sans": "5.3.0",
    "@fontsource-variable/source-serif-4": "5.3.0",
    "@fontsource/inter": "5.3.0",
    "@tanstack/vue-query": "5.102.8",
    "@vue/devtools-api": "8.2.1",
    "dompurify": "3.4.15",
    "highlight.js": "11.12.0",
    "marked": "18.0.11",
    "pinia": "4.0.3",
    "vue": "3.6.0-rc.7",
    "vue-router": "5.3.1"
  },
  "devDependencies": {
    "@iconify-json/lucide": "1.2.129",
    "@tailwindcss/vite": "4.3.3",
    "@vitejs/plugin-vue": "6.0.8",
    "@vue/test-utils": "2.5.0",
    "jsdom": "30.0.1",
    "tailwindcss": "4.3.3",
    "typescript": "npm:typescript-native-bridge@6.0.3-bridge.16.tsgo.7.0.2",
    "unplugin-icons": "23.0.1",
    "vite": "8.2.2",
    "vue-tsc": "3.3.11"
  }
}
```

Dropped vs your list, with reasons: `better-sqlite3` + `@types/better-sqlite3` (fails under Bun — D2), `@fastify/websocket` + `@types/ws` (SSE — D1), `nanoid` (crypto.randomUUID). Added: `marked`, `dompurify`, `highlight.js` (markdown pipeline §6.6), `@fastify/multipart` (uploads §7.1), two `@fontsource` design fonts (§6.1, approved). `@fontsource/inter` kept as an optional fallback per Q1.

---

## 13. Open source & licensing (D11)

* **License:** MIT — `LICENSE` file at the repo root, created in M0:

```
MIT License

Copyright (c) 2026 Testika

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction … (standard MIT text)
```

* **Attribution to the creator:**
  * `README.md` header (first lines of the file):

    ```markdown
    # Lorekeeper

    > A local-first roleplay client for LLMs — OpenRouter & UnoRouter.
    **Created by [Testika](https://github.com/Testika).** MIT licensed.
    ```
  * Every `package.json` carries `"author": "Testika"` and `"license": "MIT"`.
  * `CREDITS.md` — ABOUT/credits page: creator & maintainer (Testika), project provenance (design mockups by Testika), and the usual third-party acknowledgements (Vue, Vite, Tailwind, Fastify, Drizzle, Bun, OpenRouter, UnoRouter).
  * In-app **About** section on the Settings page (bottom): “Lorekeeper — created by Testika · MIT · v{version}”, linking to LICENSE and CREDITS.
* **Repo hygiene for open sourcing:** `.gitignore` excludes `data/` (DB, media, keys — never committed), `.vitest/`, `dist/`, `node_modules/`; the provider API keys are runtime-only (settings table), so no secret ever enters git history; a short `SECURITY.md` note documents the key-at-rest scheme and the “rotate if exposed” guidance.
* **Contribution note (v1):** solo project — README states issues/PRs welcome but review cadence is best-effort; no CLA/CODEOWNERS machinery for now.

---

## Appendix A — Assumptions register (best-guess, clearly marked)

* **A1** ~~UnoRouter exposes `/v1/models` and may return OpenAI-minimal metadata~~ **RESOLVED — live-verified 2026-09-07** (§1): `/v1/models` exists (245 models), carries `context_length` and `supported_endpoint_types` on some models, and has **no modality metadata** → vision gating falls back to allow-with-warning + manual context length; streaming verified OpenAI-identical.
* **A2** “Local website” = you open it in a desktop browser at `localhost:3000`; the mockups’ 390 px phone frame is treated as the design language (mobile-first) that also behaves well responsive up to desktop (centered column, max-width panels). A desktop-native wrapper (WebView/TAURI) is out of scope for v1.
* **A3** Single Windows machine; data dir defaults to `<repo>/data/` overridable via `LOREKEEPER_DATA_DIR`.
* **A4** Pricing display is best-effort from OpenRouter metadata; UnoRouter pricing may be absent → hidden, not guessed (confirmed absent in `/v1/models` — A1).
* **A5** `*actions*` / `"speech"` styling is presentation-only; raw text is stored as-is (Markdown source), matching Copy/Edit semantics.
* **A6** MIT copyright year 2026, holder “Testika” (no legal entity).
