# M0 Report — Scaffold & Skeleton

**Milestone:** M0 (per `IMPLEMENTATION_PLAN.md` §10) · **Status:** COMPLETE (2026-09-07)
**Commits:** `64a0cc6` (plan + repo docs) · `d40d253` (scaffold)
**Environment:** Windows · Bun 1.4.2 · Node 26.8.1 · git 2.55

---

## 1. What M0 was supposed to deliver (plan §10) vs. delivered

| Plan item | Status |
|---|---|
| `git init` + first commit (plan, `.gitignore`) | ✅ |
| `LICENSE` (MIT, © Testika), `README.md` with creator credit, `CREDITS.md` | ✅ |
| Bun workspace scaffold (root + `apps/*`, `packages/*`) | ✅ |
| Biome + Vitest + tsconfigs (TS 7 + `typescript-native-bridge`) working | ✅ (details §5) |
| Tailwind 4 `@theme` tokens from the mockups | ✅ (§4.4) |
| Fastify skeleton: `/api/health`, error handler, zod provider, static serving + SPA fallback | ✅ (§4.2) |
| Drizzle schema (all 7 tables) + first migration + auto-migrate on boot | ✅ (§4.3) |
| App shell: bottom nav, routes, empty pages | ✅ (§4.5) |
| Vue 3.6-rc.7 + Vapor verification task + recorded fallback criteria | ✅ (§6) |

**Done criteria (plan):** all verified — see §7.

---

## 2. Repository layout as built

```
Lorekeeper/
├─ package.json                  # workspaces, scripts, author/license
├─ tsconfig.base.json            # shared compilerOptions (module is per-project!)
├─ tsconfig.json                 # editor-only solution stub (files: [])
├─ biome.json                    # Biome 2.5 (migrated schema, css.tailwindDirectives)
├─ bun.lock                      # committed lockfile
├─ .gitignore                    # data/, dist/, .vitest/, node_modules/
├─ LICENSE  README.md  CREDITS.md  IMPLEMENTATION_PLAN.md
├─ temp/                         # design mockups (committed reference; excluded from lint)
├─ packages/shared/              # zod schemas + enums + cross-cutting types
├─ apps/server/                  # Fastify 5 on Bun
│  ├─ drizzle.config.ts          # dialect sqlite, casing snake_case
│  ├─ drizzle/0000_fine_rattler.sql (+ meta/)
│  ├─ vitest.config.ts
│  └─ src/
│     ├─ index.ts                # entry: buildApp() → listen(:3000)
│     ├─ app.ts                  # buildApp(): plugins, db, static, handlers
│     ├─ env.ts                  # paths (portable import.meta.url), port/host
│     ├─ db/{schema,client,migrate}.ts
│     ├─ routes/health.ts
│     ├─ types/{app.ts, fastify.d.ts}
│     └─ tests/health.test.ts
└─ apps/frontend/                # Vue 3.6-rc.7 (Vapor) + Vite 8 + Tailwind 4
   ├─ index.html  vite.config.ts  vitest.config.ts  tsconfig.json  env.d.ts
   └─ src/
      ├─ main.ts                 # createApp + vaporInteropPlugin + pinia/router/query
      ├─ App.vue                 # VDOM shell (RouterView)
      ├─ router/index.ts         # 9 routes, lazy pages
      ├─ styles/tailwind.css     # @theme tokens from mockups
      ├─ components/ui/BottomNav.vue            (vapor)
      ├─ components/vapor/{VaporProbe,VaporHost}.vue
      ├─ pages/{ChatsList,Chat,Characters,CharacterEditor,PersonaEditor,Settings}Page.vue (vapor)
      └─ tests/app.test.ts
```

---

## 3. How the pieces work together

### 3.1 Dev mode (`bun run dev`)

```
Browser ──> Vite dev server  127.0.0.1:5173
             │  transforms .vue (vapor), serves @theme CSS, resolves ~icons
             │  proxy /api/* and /media/* ──────┐
             ▼                                  ▼
        HMR / modules                     Fastify  127.0.0.1:3000
                                           │  zod-validated routes
                                           ▼
                                     bun:sqlite (WAL) → data/lorekeeper.db
```

* Root script `dev` = `bun run --parallel --filter '*' dev` → runs both workspaces' `dev`
  scripts concurrently with name-prefixed output.
* Frontend `dev` = `bunx --bun vite` (**Vite runs under the Bun runtime** — see §6.2).
* Server `dev` = `bun --watch src/index.ts`.
* No CORS anywhere: same origin via the Vite proxy in dev; single origin in built mode.

### 3.2 Built (“local app”) mode (`bun run build` + `bun run start`)

* `build` → frontend: `vue-tsc && vite build` → `apps/frontend/dist/` (hashed assets,
  per-route code-splitting, self-hosted variable fonts).
* `start` → `bun apps/server/src/index.ts` on `127.0.0.1:3000`:
  * `@fastify/static` serves `dist/` (`wildcard: false`, `index: false`);
  * the `setNotFoundHandler` returns `index.html` for extension-less GETs outside
    `/api` and `/media` (history-mode SPA fallback); everything else gets the JSON 404 envelope;
  * `/media/*` is a second `@fastify/static` mount rooted at `data/media/`
    (`decorateReply: false` — the first registration owns `reply.sendFile`).
* The dist mount is conditional: if `dist/` doesn't exist (pure dev), the handler serves only API 404s.

### 3.3 Boot sequence (`buildApp`, `apps/server/src/app.ts`)

1. Resolve `dataDir` (option override > `LOREKEEPER_DATA_DIR` > `<repo>/data`); mkdir `data/` + `data/media/`.
2. Create `Fastify({ logger: { level: 'warn' } })` and attach the Zod type provider
   (`withTypeProvider<ZodTypeProvider>()` + `setValidatorCompiler/SerializerCompiler`).
3. `createDb(data/lorekeeper.db)` — opens `bun:sqlite`, sets PRAGMAs
   (`journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`), wraps in Drizzle
   (`drizzle-orm/bun-sqlite`, `casing: 'snake_case'`).
4. `runMigrations(db)` — `drizzle-orm/bun-sqlite/migrator` against `apps/server/drizzle/`
   (auto-migrate on boot; `bun run db:migrate` runs the same thing standalone).
5. Decorate `db` + `sqlite` on the instance (typed via `types/fastify.d.ts`); register an
   `onClose` hook that closes SQLite (fastify close ⇒ db close — Windows file locks).
6. Register route modules (health today) — **called directly**, not via `app.register`,
   so the typed `AppInstance` flows through without plugin-generic friction.
7. Register static (dist if present, then `/media`), then the error + not-found handlers.

**Error contract** (global `setErrorHandler`):
* Zod request/response validation failures → `400 { statusCode, code: 'validation_error', message, details }`
  (detected via `hasZodFastifySchemaValidationErrors`).
* Anything with `statusCode` → that code; `>= 500` logged; payload
  `{ statusCode, code, message }`.

### 3.4 `GET /api/health`

* Schemas live in `packages/shared` (`healthResponseSchema` = `{ ok, version, db }`), imported by the
  server for validation/serialization **and** available to the frontend client.
* Handler runs `SELECT 1` on the raw `sqlite` handle → `db: 'ok' | 'error'`.

---

## 4. Workspace details

### 4.1 `packages/shared`
* `enums.ts` — `providerIds`, `chatStatuses`, `messageRoles`, `finishReasons` (const arrays + derived unions).
* `types.ts` — `TokenUsage`, `ChatError`, `ModelInfo` (used by the Drizzle schema via
  `$type<...>()` and later by both API sides).
* `schema.ts` — zod schemas (`healthResponseSchema` today). Both server and client import
  the same source (`exports: { ".": "./src/index.ts" }` — raw TS, resolved by Bun/Vite/
  drizzle-kit directly; no build step for this package, ever).

### 4.2 `apps/server`
* `schema.ts` implements the **full** planned model now (avoids migration churn later):
  `characters` (21 cols incl. `creatorNotes`, `extensions` json for lossless card
  round-trips), `personas`, `presets`, `chats` (per-chat overrides, `status`, `ribbon`),
  `messages` (variant machinery: `seq`, `groupId`, `variantIndex`, `isActive`,
  `isGreeting`, `finishReason`, `isError` + `error` json, `usage` json), `attachments`,
  `settings` (kv, json values). Index `idx_messages_chat_seq (chatId, seq)`.
* JSON columns are `TEXT { mode: 'json' }` with typed `$type<...>`; snake_case column names
  via `casing: 'snake_case'` on **both** drizzle() and drizzle-kit config.
* `env.ts` resolves all paths from `fileURLToPath(import.meta.url)` — **not** Bun-only
  `import.meta.dir`, which Vite/Vitest strip (see §6.2). `PORT`/`HOST`/`LOREKEEPER_DATA_DIR`
  env overrides.
* `types/app.ts` — `AppInstance` = `FastifyInstance<RawServer, RawRequest, RawReply, Logger, ZodTypeProvider>`
  (⚠ Fastify 5 swapped the generic order: Logger comes **before** the TypeProvider).

### 4.3 `apps/frontend`
* `main.ts` wiring order matters: `use(vaporInteropPlugin)` **first** (installs
  `app._context.vapor`), then pinia, router, VueQueryPlugin (with a `QueryClient` —
  `staleTime 30s`, `retry 1`, no refetch-on-focus).
* `App.vue` is the only classic-VDOM component besides `VaporHost` (the interop wrapper);
  all pages + `BottomNav` are `<script setup lang="ts" vapor>`.
* `tailwind.css`: Tailwind 4 CSS-first config — the complete Material-3 dark palette from
  the mockups as `--color-*` tokens (surface scale, primary/secondary/tertiary containers,
  error, outline pair, inverse), `--font-sans` = Plus Jakarta Sans Variable, `--font-serif`
  = Source Serif 4 Variable, `--radius-lg/xl` per mockups; plus base body styles,
  selection color, and the 4px parchment scrollbar. Utilities like `bg-surface-container`
  / `text-on-surface-variant` are generated from these tokens.
* `vite.config.ts` aliases: `@` → `src`; **`vue` → `vue/dist/vue.esm-bundler.js`**
  (full build — see §6.1); `server.host/port` pinned to `127.0.0.1:5173` + proxy for
  `/api` and `/media`.
* Routes (lazy): `/`→`/chats`, `/chats`, `/chats/:id`, `/characters`, `/characters/new`,
  `/characters/:id`, `/personas/new`, `/personas/:id`, `/settings`. Bottom nav renders on
  the three tab pages; Chat/editor pages are full-screen (per mockups).

### 4.4 Design fidelity
Page shells follow the five mockups: 390px centered column, sticky blurred headers,
pill tabs, FABs (`New Tale`, `+`), amber-gradient send button, chat header with model pill +
gear, composer shell with paperclip + self-centering textarea, settings section cards with
the About line (`Lorekeeper — created by Testika · MIT · v0.1.0`). Icons are Lucide via
`unplugin-icons` (`~icons/lucide/*`), typed through `env.d.ts` reference
(`unplugin-icons/types/vue`).

### 4.5 Toolchain notes
* `tsconfig.base.json`: `target/module esnext` shared parts, `moduleResolution: bundler`,
  strict family + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax` + `isolatedModules`, `skipLibCheck`, `noEmit`.
  **`module` is deliberately per-project**: `esnext` (frontend/shared, bundler semantics)
  vs `preserve` (server — Bun/bundler statement-preserving mode, per TSConfig reference;
  plus `moduleDetection: force`, `allowImportingTsExtensions`, `types: ["bun-types"]`).
* The root `tsconfig.json` is an editor stub (`files: []`); there are **no project
  references** — `typecheck` runs each project in parallel instead (see §5, deviation D-A).
* Biome 2.5: migrated config (`preset: "recommended"`), `css.parser.tailwindDirectives`
  (required for `@theme`), `.vue` overrides that disable `noUnusedImports`,
  `noUnusedVariables`, `noLabelWithoutControl` (Biome cannot link script-setup bindings
  to template usage yet — vue-tsc covers templates; documented, revisit when Biome improves).

---

## 5. Verification results (all green)

| Check | Command | Result |
|---|---|---|
| Install | `bun install` | 292 packages installed (fresh-clone re-run; 451 counted in the existing workspace). Expected `vue@3.6.0-rc.7` peer warnings from pinia/vue-router/@vue/test-utils/@vitejs/plugin-vue (ranges exclude prereleases); exact count not reproducible from the committed lockfile |
| Lint | `bun run lint` | 46 files, 0 problems |
| Typecheck (server/shared) | `tsc -p .` ×2 (native TS 7) | ✓ in ~0.5s |
| Typecheck (frontend) | `vue-tsc` on `typescript-native-bridge` | ✓ in ~0.9s — banner `▎ TNB ACTIVE` confirms the Go checker |
| Tests | `bun run test` (Bun runtime, threads pool) | server 3/3 (`/api/health` payload, migrated-tables assertion, 404 envelope) · frontend 2/2 (vapor-in-VDOM mount, RouterLink inside vapor) |
| Build | `bun run build` | ✓ ~0.4s; `index` chunk 325KB (116.7 gzip), 6 page chunks (+4 shared icon chunks), 9 font files, CSS 27.4KB |
| Built mode | `bun run start` | `/`→200 HTML, `/chats`→200 (SPA fallback), `/api/health`→JSON, unknown `/api/*`→404 envelope |
| Dev mode | `bun run dev` | both ports listening; `/api/health` proxied through :5173; vapor SFC transform verified over HTTP (`defineVaporComponent` in transformed output); `~icons/lucide/*` virtual modules resolve (200, svg) |
| DB | auto on boot | `data/lorekeeper.db` created with all 7 tables (WAL mode) |

---

## 6. Research findings baked into the scaffold (the “how it should work” fine print)

### 6.1 Vue 3.6-rc.7 + Vapor (decision D4)
* **Vapor exports live only in the full ESM build.** In rc.7, `vue`'s default entries
  (runtime-only esm-bundler, and *all* CJS builds) do **not** re-export
  `@vue/runtime-vapor`. Only `vue/dist/vue.esm-bundler.js` does
  (`export * from "@vue/runtime-vapor"`). Hence the permanent alias in both
  `vite.config.ts` and `vitest.config.ts`. Cost: the in-browser template compiler is
  bundled (unused — all templates are SFC-compiled); acceptable for v1, revisit on
  Vue 3.6 stable packaging.
* **`vaporInteropPlugin` is mandatory** for vapor components inside a VDOM app
  (`app.use(...)` installs `app._context.vapor`/`vdom` interop). Without it, mounting a
  vapor child from a VDOM parent throws (`getVaporInterface` undefined).
* **`@vue/test-utils` 2.5.0 cannot read `$el` of a vapor *root* component** — `mount()`/
  `VueWrapper` resolve the root element via `vm.$el`, which is undefined for a vapor root;
  the 2.5.0 dist contains no vapor handling at all. Per the plan's documented fallback,
  vapor components under test are mounted through a VDOM host wrapper (`VaporHost.vue`
  pattern / inline host in tests).
  Trigger recorded: if a *runtime* interop bug (not test-infra) blocks a milestone, flip
  that SFC back to classic (drop the `vapor` marker — per-component, zero migration) or
  fall back to 3.5.42 entirely.
* Peer warnings at install are expected and harmless (documented in plan §1).

### 6.2 Windows / Bun runtime findings (encoded in scripts + README “Dev notes”)
1. **Vite dev server runs under Bun — kept as a precaution, not a verified requirement.**
   Audit re-test (2026-09-07): under Node 26.8.1 with `host: '127.0.0.1'`, Vite 8.2.2
   binds, `netstat` shows the socket LISTENING, and HTTP requests return 200 — the earlier
   M0 observation ("prints ready but the socket silently disappears") could **not** be
   reproduced, with or without CLI overrides. What *does* reproduce under Node is the
   `localhost` half-fail (item 2). `bunx --bun vite` (D-D) stays as a harmless pin.
2. **`host: 'localhost'` binds half-fail** (IPv6 path) — verified: Vite binds `[::1]` only
   and IPv4 connections are refused. The config pins `host: '127.0.0.1'`, `port: 5173`.
3. **Vitest under Bun: `threads` pool only.** The default `forks` pool dies at worker
   startup (`Worker exited unexpectedly ... during starting state`). Both vitest configs
   set `pool: 'threads'`.
4. **`bunx` needs the binary in the local workspace** — with Bun's isolated store the root
   couldn't resolve `@vitejs/plugin-vue`, and workspace-level `bunx --bun vitest` tried a
   nonsense “git clone” install until `vitest@5.0.0` became a devDependency of each
   workspace that runs it.
5. **Bun-only APIs don't survive Vite transforms**: `import.meta.dir` is `undefined` in
   vitest-processed modules → `env.ts` uses portable `fileURLToPath(import.meta.url)`.
6. **Fastify 5 generic order** is `<Server, Request, Reply, Logger, TypeProvider>` —
   Logger before TypeProvider (initial scaffold had it backwards; fixed in
   `types/app.ts`).
7. **TypeScript-native-bridge works on Windows** (`@typescript-native-bridge/win32-x64`
   ships `native/bridge.node`; bun install picks it automatically). `vue-tsc` prints
   `TNB ACTIVE` when running on the Go checker. Fallback chain if it ever breaks:
   `@typescript/typescript6` → TS 6.0.3 (frontend only).
8. Editor note: point VS Code at the workspace TS version to get TNB's tsserver
   (CLI typecheck picks it up automatically).

---

## 7. Documented deviations from `IMPLEMENTATION_PLAN.md`

| # | Plan said | Built instead | Why |
|---|---|---|---|
| D-A | Root `vitest.config.ts` with `projects` (unit + component) | Per-workspace vitest configs (`apps/server`, `apps/frontend`) + root `test` = `bun run --parallel --filter '*' test` | Bun's isolated store: the root cannot resolve `@vitejs/plugin-vue`; per-workspace configs keep each package self-contained. Also Vitest 5 doesn't look up configs from parent dirs. |
| D-B | `typecheck` = `tsc -b` + `vue-tsc -b` with project references | `bun run --parallel --filter '*' typecheck` (per-project `tsc -p .` / `vue-tsc`) | `tsc -b` requires `composite`, which forces declaration emit — incompatible with the noEmit-only pipeline. Parallel per-project is equivalent and faster. |
| D-C | `drizzle-kit generate --config apps/server/...` from root | `db:generate` script lives in the server workspace | drizzle-kit resolves the `schema` path relative to CWD, not the config file. |
| D-D | Frontend `dev: "vite"` | `dev: "bunx --bun vite"` | §6.2 item 1 (Windows/Node socket failure). |
| E | — | `vitest` added as devDependency of server + frontend | §6.2 item 4. |

Everything else follows the plan verbatim (versions in `IMPLEMENTATION_PLAN.md` §12 are
pinned exactly as installed; `bun.lock` is committed).

---

## 8. Known small items carried into M1

* `@fastify/multipart` is installed but not registered yet — wired up in M3 with the
  attachment endpoints.
* `version` is a constant (`0.1.0`) in `env.ts`; switch to reading a package version when
  it starts mattering (About line already renders it).
* The global error handler's `details` extraction uses a structural cast — replace with
  the exported predicate's narrowed type when we add the first request-body routes (M1)
  and lock the shape with a unit test.
* Server logger is `warn`-level for quiet local dev; revisit if M1 provider debugging
  needs `info`/`debug` (per-route, not global).
* `SettingsPage` renders the About line from markup; move it to the shared version
  constant when the settings module is built for real (M1).
* `bun --watch` (server dev) only watches `apps/server/src` — `packages/shared` edits do
  not trigger a restart (bun prints "not in the project directory and will not be
  watched"); restart the server manually after editing shared code.

---

## 9. How to run everything (quick reference)

```sh
bun install            # once
bun run dev            # Vite :5173 + API :3000 (dev)
bun run build          # typecheck + bundle SPA
bun run start          # built SPA + API on http://127.0.0.1:3000
bun run test           # vitest under Bun (server 3 + frontend 2)
bun run typecheck      # tsc (TS7) + vue-tsc (TNB) in parallel
bun run lint           # biome check
bun run db:generate    # new SQL migration from schema changes
bun run db:migrate     # apply migrations manually (also automatic on boot)
```

Data lives in `data/` (gitignored): `lorekeeper.db` (+ WAL files) and `media/`.
Delete the folder to reset the app to a fresh migrated database.

---

## 10. Audit corrections (2026-09-07)

An independent audit re-verified every §10 deliverable and done-criterion from scratch
(all re-run green: lint 46 files · typecheck incl. `TNB ACTIVE` · tests 3+2 · build ·
start mode endpoints · dev mode incl. proxied `/api/health` and vapor SFC transform ·
fresh-boot DB auto-migration with all 7 tables in WAL · registry spot-checks of 9 pinned
packages · git history secret scan). The following claims in this report were found
inaccurate and have been corrected above:

* **§5 Install** — "794 packages, 14.2s; only the 6 expected peer warnings" did not
  reproduce under any counting method (fresh clone: 292 installed / 293 store entries;
  in-place check: 451). Peer-range mismatches are real (pinia, vue-router,
  @vue/test-utils, @vitejs/plugin-vue all exclude `3.6.0-rc.7`), but the exact count is
  not reproducible from the committed lockfile.
* **§5 Build** — "7 route chunks" → actually 6 page chunks (+4 shared icon chunks).
* **§6.1** — the cited `getDevRootFragmentEl` symbol does not exist anywhere in
  @vue/test-utils 2.5.0. The limitation is real (dist reads `vm.$el` and has no vapor
  handling), so the VDOM-host workaround stands; the mechanism text was corrected.
* **§6.2 item 1** — "Vite under Node silently loses its socket" could not be reproduced
  (with `127.0.0.1` under Node 26.8.1: binds, LISTENING in netstat, serves HTTP 200).
  The `localhost`/IPv6 half-fail *is* verified and reproducible (binds `[::1]` only).
  D-D (`bunx --bun vite`) retained as a precaution, not a requirement.
* **§8** — added the `bun --watch` / `packages/shared` non-watching caveat.

Also fixed outside this report: key-shaped placeholder strings in
`temp/lorekeeper_settings/code.html` replaced with `EXAMPLE-PLACEHOLDER` values
(secret-scanner hygiene), `README.md` credit hyperlinked per plan §13, and `SECURITY.md`
added (required by plan §13, previously absent).

Remaining known-non-issues: master contains an empty commit (`257f25c`, message "t",
authored post-report) — recommended to drop before any public push.
