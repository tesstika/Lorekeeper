# M0 Audit Sign-off

**Milestone:** M0 — Scaffold & Skeleton (per `IMPLEMENTATION_PLAN.md` §10)
**Auditor:** independent review pass (separate session from the M0 implementer)
**Date:** 2026-09-07 · **Repo state at audit:** master @ `257f25c` (4 commits)
**Method:** every claim in `M0_REPORT.md` was re-tested or re-read from source — commands
re-executed, files/node_modules/registry inspected directly. The report was treated as
claims to test, not ground truth.

---

## 1. Result

**GO.** Every M0 done-criterion from plan §10 was independently verified and passed.
The defects found were documentation-accuracy issues and hygiene nits — none blocks M1.
All correctable findings have been fixed (see §4); those fixes are the current uncommitted
working-tree changes.

---

## 2. Plan §10 requirements — independent verification

| Plan §10 requirement | Verified? | Evidence (re-run, not read from report) |
|---|---|---|
| `git init` + first commit (plan, `.gitignore`) | Pass | `64a0cc6` contains plan, `.gitignore`, LICENSE, README, CREDITS, mockups. Note: master has 4 commits (report listed 2) |
| LICENSE (MIT), README credit, CREDITS.md | Pass | LICENSE = complete unmodified MIT text, (c) 2026 Testika; README credit present; CREDITS.md present; `author`/`license` consistent in all 4 package.jsons |
| Bun workspace scaffold | Pass | `workspaces: ["apps/*","packages/*"]`; tracked file list (64) matches report layout exactly — no undisclosed additions |
| Biome + Vitest + tsconfigs (TS 7 + TNB) | Pass | Re-ran: lint 46 files / 0 problems; typecheck server 518ms + frontend 916ms with `▎ TNB ACTIVE` banner |
| Tailwind 4 `@theme` tokens | Pass | `tailwind.css` carries the full plan §6.1 palette, fonts, radii; used throughout pages |
| Fastify skeleton (health, error handler, zod provider, static + SPA fallback) | Pass | Re-ran `bun run start`: `/api/health` 200, unknown `/api/*` → JSON 404 envelope, `/chats` → 200 SPA fallback; handler code matches report |
| Drizzle schema (7 tables) + migration + auto-migrate on boot | Pass | Booted with a **fresh** `LOREKEEPER_DATA_DIR`: DB auto-created, WAL mode, all 7 tables + `idx_messages_chat_seq` + `__drizzle_migrations` (verified via direct sqlite introspection of both fresh and real DB) |
| App shell (bottom nav, routes, empty pages) | Pass | 9 lazy routes; 6 pages on disk; vapor `BottomNav` with 3 RouterLinks |
| Vapor verification task | Pass | Tests re-run green: pure-vapor SFC mounted in VDOM host (2/2 frontend, 3/3 server); `defineVaporComponent` confirmed in HTTP-transformed SFC; pinia/router/vue-query wired and booting |
| **Done:** `bun run dev` shell at :5173 + live `/api/health` | Pass | netstat: both `127.0.0.1:3000` and `:5173` LISTENING; proxied health check returns `{"ok":true,...,"db":"ok"}` |
| **Done:** `bun run start` serves built SPA at :3000 | Pass | Build re-run: index 325.10 KB (116.67 gzip), CSS 27.39 KB, 9 fonts — matches report |
| **Done:** lint/typecheck/test green | Pass | All re-run green (3/3 + 2/2, same test subjects as reported) |
| **Done:** `data/lorekeeper.db` auto-created/migrated | Pass | See Drizzle row above |

## 3. Technical fact-checks (node_modules / registry level)

| Claim | Verdict | Evidence |
|---|---|---|
| Vapor exports only in full ESM build | **Confirmed** | `vue/dist/vue.esm-bundler.js:12` = `export * from "@vue/runtime-vapor"`; default import condition → runtime-only build; all CJS + `runtime-dom.esm-bundler.js` have zero vapor refs |
| test-utils 2.5.0 can't read `$el` of a vapor root | **True claim, wrong mechanism (was fabricated)** | `VueWrapper` constructor reads `vm.$el` (line 7658); dist has zero vapor handling. The cited symbol `getDevRootFragmentEl` **does not exist** in 2.5.0 — corrected in report |
| Fastify 5 generic order: Logger before TypeProvider | **Confirmed** | `types/instance.d.ts`: `<RawServer, RawRequest, RawReply, Logger, TypeProvider>` |
| Vitest error "Worker exited unexpectedly … during starting state" | **Confirmed** | Exact template in vitest 5.0.0 dist: `` `Worker exited unexpectedly ${errorDetails}during ${this._state} state` `` |
| `import.meta.dir` undefined under vitest | **Confirmed** | Probe test under vitest: `import.meta.dir = undefined` |
| Vite under Node silently loses its socket | **Not reproduced** | With `127.0.0.1` under Node 26.8.1: binds, LISTENING, serves 200 (tested with and without CLI overrides, bare project config). The `--host localhost` half-fail **does** reproduce (binds `[::1]` only, IPv4 refused). Claim downgraded to precaution |
| "794 packages, 14.2s; 6 peer warnings" | **False** | Fresh-clone install: 292 installed / 293 store entries; in-place: 451. Peer-range mismatches are real (pinia, vue-router, test-utils, plugin-vue exclude the RC) but the count is irreproducible from the committed lockfile |
| Registry pins (9 spot-checked) | **Confirmed** | Live npm: `vue` latest 3.5.42 / rc 3.6.0-rc.7; `fastify` 5.12.3; `drizzle-orm` 0.45.2; `drizzle-kit` 0.31.10; `zod` 4.5.4; `@biomejs/biome` 2.5.12; `bun-types` 1.4.2; `typescript` 7.0.2; `typescript-native-bridge` latest = `6.0.3-bridge.16.tsgo.7.0.2` |
| No secrets in git history | **Confirmed** (with a hygiene note) | Full-history scan: no `.env`, no real keys. Placeholder key-shaped strings existed in mockup HTML — fixed (see §4) |
| `data/`, `dist/`, `node_modules/`, `.vitest/` untracked + ignored | **Confirmed** | `.gitignore` covers all four (plus `.env*` w/ `!.env.example`); `git ls-files` shows nothing under them |
| Full 7-table schema in M0 = scope creep? | **No — plan-required** | Plan §3: "sketch — exact file delivered in M0". `schema.ts` diffed column-by-column against the §3 sketch: faithful, no invented fields |

## 4. Corrections applied (the changes this file accompanies)

All fixes are currently **uncommitted** in the working tree:

| # | File | Change |
|---|---|---|
| 1 | `M0_REPORT.md` §5 | Install row: "794 packages, 14.2s; 6 peer warnings" → measured numbers (292 fresh-clone / 451 in-place; warning count marked irreproducible) |
| 2 | `M0_REPORT.md` §5 | Build row: "7 route chunks" → "6 page chunks (+4 shared icon chunks)" |
| 3 | `M0_REPORT.md` §6.1 | Fabricated `getDevRootFragmentEl` → actual mechanism (`vm.$el` resolution; no vapor awareness in test-utils 2.5.0 dist). Workaround unchanged |
| 4 | `M0_REPORT.md` §6.2 | Item 1 rewritten: Vite-under-Node socket death downgraded to "precaution, not verified requirement" after failed reproductions; item 2 (localhost/IPv6 half-fail) marked verified-reproducible |
| 5 | `M0_REPORT.md` §8 | Added `bun --watch` / `packages/shared` non-watching caveat (server won't auto-restart on shared edits) |
| 6 | `M0_REPORT.md` §10 | New audit-corrections addendum documenting all of the above |
| 7 | `README.md` | Credit hyperlinked per plan §13; "Dev notes" claim aligned with re-test evidence |
| 8 | `temp/lorekeeper_settings/code.html` | Key-shaped placeholder strings → `sk-or-v1-EXAMPLE-PLACEHOLDER` / `sk-uno-EXAMPLE-PLACEHOLDER` (secret-scanner hygiene; no visual change) |
| 9 | `SECURITY.md` | **Created** — plan §13 requirement that was silently missing: key-at-rest scheme, honest threat model, rotate-if-exposed guidance |

Post-fix status: `bun run lint` → 46 files, 0 problems. No source code changed; all
runtime behavior verified before the fixes is unchanged.

## 5. Findings NOT corrected (need owner decision / outside reach)

- **Empty commit `257f25c` (message "t")** on master — authored post-report; dropping it
  is a history rewrite, left to the owner. Recommended before any public push.
- **Exact peer-warning count at first install** — irreproducible from the committed
  lockfile; report wording now reflects that honestly.
- **Plan-phase external claims** (UnoRouter live-verification: 245 models, streaming
  shape; TNB "Vue-team-validated / 205-209 Volar tests"; VS Code TNB-tsserver behavior) —
  no independent access; left as stated, marked unverifiable here.
- **Biome `.vue` overrides** (noUnusedImports/noUnusedVariables off) — deliberate,
  documented, revisit when Biome handles script-setup binding usage.

## 6. Recommendation

Proceed to **M1** on this M0 as-is. Suggested before the first M1 commit: commit the
audit corrections, and drop the empty `t` commit if the repo will be pushed publicly.

---

**M0_AUDIT_SIGNOFF** — independently verified, corrections applied, M1 cleared.
