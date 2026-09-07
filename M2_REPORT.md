# M2 Report — Characters & Personas

**Milestone:** M2 (per `IMPLEMENTATION_PLAN.md` §10) · **Status:** COMPLETE (2026-09-07)
**Base:** master @ `fa926c9` (M1 audit fixes committed first, per the audit sign-off checklist)
**Implementation commit:** `8706bcb`
**Environment:** Windows · Bun 1.4.2 · Node 26.8.1

---

## 0. Pre-work (audit checklist, M1 §6 "Do now")

* [x] Committed the four M1 audit fixes (`model-format.ts`, `routes/providers.ts`, `services/crypto.ts`,
  `services/settingsRepo.ts`) as `fa926c9 fix(audit): apply M1 independent audit sign-off corrections` —
  lint (82 files) / typecheck (TNB banner) / tests (41+13) verified green before the commit.
* [x] Card specs re-verified against the live sources (SillyTavern `spec-v2.d.ts`, the V2 spec repo
  `malfoyslastname/character-card-spec-v2`, and `kwaroran/character-card-spec-v3` SPEC_V3.md) before
  writing the parser. Confirmed: no V4+ exists; V3 fields = V2 + `nickname`, `assets`,
  `creator_notes_multilingual`, `source`, `group_only_greetings`, `creation_date`, `modification_date`.

---

## 1. Delivered vs. plan (§10 M2)

| Plan item | Status | Where |
|---|---|---|
| Character/persona CRUD + repos | ✅ | `services/charactersRepo.ts`, `services/personasRepo.ts` |
| Character editor per mockup (4 collapsible sections, avatar upload, voice archetype chips) | ✅ | `pages/CharacterEditorPage.vue` + `components/characters/*` |
| Per-character **Jailbreak** field (M1 groundwork column) | ✅ | Editor textarea + helper text; import maps `post_history_instructions` → `jailbreak` |
| Card import: Tavern V1 flat / ST V2 `chara_card_v2` / V3 `chara_card_v3` with `extensions` passthrough | ✅ | `services/cardParser.ts` + `POST /api/characters/import` |
| Export V2 JSON (universal baseline) | ✅ | `GET /api/characters/:id/export` (+ optional `?format=v3`) as an attachment download |
| Characters page grid + selection mode | ✅ | `pages/CharactersPage.vue` + `CharacterCard`/`PersonaCard` |
| Persona editor (simplified schema: name, description, avatar, default) | ✅ | `pages/PersonaEditorPage.vue` |
| Avatar uploads (multipart, magic bytes, `data/media/`) | ✅ | `POST /api/attachments` (`@fastify/multipart` 10.1.1) |
| Single-default persona invariant + dangling `globalDefaults.personaId` clear | ✅ | `personasRepo` (mirrors `presetsRepo` patterns) |
| Delete restriction: `409 character_in_use` + `chatCount`, `?force=1` cascade | ✅ | `charactersRepo.deleteCharacter` + route |

**Deliberately not in M2** (per plan phasing): chat flows, greeting insertion, PNG-embedded cards
(D13 stretch goal), V3 export from the UI (available via the API `?format=v3`), CHUB/CHARX formats.

---

## 2. Architecture as built

### 2.1 Shared contracts (`packages/shared/src/schema.ts`)

* `characterInputSchema` / `characterSchema` / **defaults-free** `characterPatchSchema` — every key
  `.optional()`, **zero `.default()`** (the M1 §4.2 `z.output` body-injection lesson). Length caps:
  prose ≤ 200 000 chars, name ≤ 120, ≤ 32 tags, ≤ 20 alternate greetings.
* `personaInputSchema` / `personaSchema` / `personaPatchSchema` — same discipline.
* Card schemas: `tavernCardV1Schema` (flat), `characterCardV2Schema` / `characterCardV3Schema`
  (loose root + `data`), `cardExportFormats = ['v2','v3']`, `importCardResponseSchema`
  (`{ character, detectedFormat }`), `exportedCardV2/V3Schema`, `attachmentResponseSchema`.

### 2.2 Card parser (`apps/server/src/services/cardParser.ts`)

* **Detection** (D13): `spec === 'chara_card_v3'` → V3; `'chara_card_v2'` → V2; spec-less `data`
  envelope (seen in the wild) → V2; otherwise flat V1. Unknown `spec` strings are rejected.
* **Lossless mapping.** Mapped fields: `name`, `description`, `personality`, `scenario`,
  `first_mes` → `firstMessage`, `mes_example` → `exampleDialogue`, `creator_notes` → `creatorNotes`,
  `system_prompt` → `systemExtras`, `post_history_instructions` → `jailbreak`,
  `alternate_greetings`, `tags`. Everything else — `creator`, `character_version`,
  `character_book`, V3 `nickname`/`assets`/`group_only_greetings`/`creator_notes_multilingual`/
  `source`/`creation_date`/`modification_date`, *and any unknown future field* — is preserved in the
  character's `extensions` column under a `lorekeeperCard` envelope:
  `{ spec, spec_version, fields: {…unmapped data keys}, extensions: {…native data.extensions}, root: {…unknown root keys} }`.
* **Export** rebuilds the card: canonical mapped fields → `data` top level, `fields` spread back on
  top, `extensions` restored as `data.extensions`, `root` spread back at the card root. `export →
  import` is byte-stable (locked by the round-trip test). Default export = V2; `?format=v3` supported.
  Tolerant coercion (string filters for tags/greetings) handles messy real-world cards.
* Sloppy-payload policy: non-string scalars in `tags`/`alternate_greetings` are dropped, not fatal;
  a missing/blank `name` is fatal (`400 invalid_card`).

### 2.3 Server

* **Repos.** `charactersRepo`: list (updated-at desc), get, create, partial-merge update,
  `deleteCharacter` — counts `chats` by FK; blocked → `{ ok:false, chatCount }` → route emits
  `409 { code:'character_in_use', message, chatCount }`; `?force=1` deletes the chats first
  (messages/attachments cascade) then the character, all inside one transaction.
  `personasRepo`: single-default invariant in a transaction (create/update/`PUT :id/default`),
  `deletePersona` clears a dangling `globalDefaults.personaId` in the same transaction (exact
  `presetsRepo.deletePreset` pattern).
* **Avatar uploads** (`routes/attachments.ts` + `services/attachments.ts`): `@fastify/multipart`
  registered with a 32 MB hard busboy cap; the handler buffers via `file.toBuffer()`, enforces the
  configured `composer.imageMaxBytes` (default 8 MB → `413 file_too_large`), sniffs **magic bytes**
  (PNG/JPEG/GIF/WEBP-VP8·VP8L·VP8X) with best-effort dimension extraction (JPEG SOF scan, GIF
  header, VP8L 14+14-bit packing), writes `data/media/<uuid>.<ext>` (D5: bytes on disk, metadata in
  the `attachments` row with `messageId: null`), and returns `{ id, url, width, height, mimeType, … }`.
  Rejected types → `400 unsupported_media_type` (declared MIME type is never trusted).
* **Routes** (`routes/characters.ts`, `routes/personas.ts`): all bodies validated by shared zod
  schemas; the 409 shape is a declared response schema; export sets
  `Content-Disposition: attachment; filename="<slug>.card.v2|v3.json"`.
* `app.ts`: registers multipart **before** routes; decorates `dataDir` (so tests with custom data
  dirs hit the right media folder — `env.dataDir` would have leaked the repo default).

### 2.4 Frontend

* **Store** (`stores/characters.ts`): load-once lists + `ensureCharacter/Persona` (cache-or-fetch for
  deep links), precise upserts, persona default-invariant mirroring (same as the settings-store
  preset pattern), and confirm-guarded deletions. `removeCharacter` **always** confirms (D7) and, on
  `409 character_in_use`, offers a second "delete character & chats" confirm before forcing.
* **ConfirmDialog** (`components/ui/ConfirmDialog.vue` + `ui.confirm()` in the ui store):
  the single destructive-action pattern (D7) — promise-based, mounted per page next to `ToastHost`.
* **Characters page**: pill tabs **Characters (N) / Personas (N)** (state per visit), 2-col
  responsive grid in a `max-w-[520px]` column (mockup: `max-w-2xl`), character cards with
  4/3 image well + vignette + genre pill + initials fallback, long-press (450 ms) or `⋯` quick-action
  overlay (**Edit / Export / Delete** — "Selected Companion", per mockup), header **Import Card**
  file-dialog button, `Select` toggle → batch bar (N selected · Export · Delete · Cancel), working
  search filter, empty states, FAB routed by active tab, bottom nav.
* **Character editor** (`/characters/new`, `/characters/:id`): header (Cancel · title + "Manuscript
  Archive" · eye preview toggle · ⋯ menu with Export/Delete), avatar uploader with live preview +
  remove, borderless display name + tagline inputs (mockup), TagInput chips, the four mockup
  accordion sections — **Personality & Essence** (description/personality/behavior/communication/
  likes/dislikes), **Backstory & Scenario** (+ creator notes), **Dialogue & Greeting** (first message
  in the bordered "Kickoff Turn" well, alternate-greetings manager with add/edit/delete, example
  dialogue), **Advanced & System Directives** (system extras + **Jailbreak** with the anti-refusal
  helper text) — plus the **Quick Voice Archetype Presets** chip row (6 archetypes; appends a
  stylistic guideline to personality) and a **preview mode** (assembled card: avatar, greeting
  bubble, definition list incl. the jailbreak slot).
* **Persona editor** (`/personas/new`, `/personas/:id`): same shell, fields = name, description,
  avatar, "Set as default" switch (button-based `ToggleSwitch`), ⋯ delete.
* **API client**: characters/personas CRUD, `importCard`, `exportCharacterCard` (anchor-download),
  `uploadAttachment` (FormData POST). 

### 2.5 Vapor discipline (M1 §4.3 / audit D-V1, applied everywhere)

* **Zero native `v-model` on native elements** in all new components: every input/textarea binds
  `:value` + explicit `@input` (the editors route through a `setText(key)` emit-helper that accepts
  every value — no clamping, so the DOM cannot drift from the model, per the audit's D-V1 guard-rail).
* Toggles stay button-based (`ToggleSwitch` role="switch"); selects avoided entirely.
* Component v-model between vapor components uses explicit `:model-value` +
  `@update:model-value` handlers (`TagInput`, `ToggleSwitch`, `GreetingsManager`, `AvatarPicker`).
* Component tests mount everything through VDOM hosts (`vaporInteropPlugin`), per the M0 pattern.

---

## 3. Verification results (all green)

| Check | Command | Result |
|---|---|---|
| Lint | `bun run lint` | **102 files, 0 problems** |
| Typecheck | `tsc -p .` ×2 + `vue-tsc` (TNB banner `▎ TNB ACTIVE`) | ✓ |
| Tests | `bun run test` | server **73/73** (6 files) · frontend **25/25** (3 files) |
| Build | `bun run build` | ✓ — CharacterEditorPage chunk 26.5 kB, CharactersPage 19.7 kB, CSS 52.9 kB |
| Start mode | `bun run start` (built SPA) | `/`→200, `/characters`→200 (SPA fallback), `/api/health`→ok |

**New test coverage:**
* `card-parser.test.ts` (13): format detection (V1/V2/V3/spec-less/unknown-spec), V2 mapping, V3-only
  field preservation, V1 flat + unknown keys, error envelopes, tolerant coercion, V2/V3 export,
  **import→export→re-import byte-equality round-trips**, filename slugging.
* `characters-routes.test.ts` (19): CRUD, validation, **PATCH untouched-keys regression**
  (tagline-only PATCH preserves name/tags/personality/firstMessage/jailbreak/alternateGreetings),
  explicit null PATCH, **delete blocked with 409 + chatCount while chats exist → force cascade
  removes chats**, V2 import with lossless envelope + export with `Content-Disposition`, V3 import +
  `?format=v3` export, V1 import, `invalid_card` 400s, persona CRUD + single-default invariant +
  `PUT :id/default` + dangling `globalDefaults.personaId` clear, avatar upload (multipart →
  `/media/<uuid>.png` served byte-identical), magic-byte rejection, 413 over-limit, missing file part.
* `characters.test.ts` (12, component): SectionCard accordion, GreetingsManager add/edit/remove,
  CharacterCard identity + quick actions, PersonaCard default chip + star/delete, CharactersPage
  (grid, **tab switch**, batch selection → confirm dialog → delete, per-card delete confirm),
  CharacterEditor create (greeting + **jailbreak** payload), archetype application, **existing-
  character load + full PATCH without clobbering**, PersonaEditor create with default flag.

### 3.1 Dev-mode Playwright verification (live, fresh `LOREKEEPER_DATA_DIR`)

All six DoD bullets exercised in the browser against `bun run dev` (Vite :5173 → Fastify :3000):

1. **Create from scratch with avatar, greetings, jailbreak** — FAB → `/characters/new`; uploaded a
   PNG portrait (stored `/media/<uuid>.png`, live preview + "Change portrait" state); filled name/
   tagline/genre tag/description/personality/behavior/style/likes/dislikes; wrote a first message;
   added an alternate greeting; wrote systemExtras + **jailbreak** (helper text visible); applied
   the *Sarcastic Rogue* voice chip; Save → redirected to `/characters/:id`; server record verified
   field-by-field via `GET /api/characters/:id` (archetype text appended to personality ✓).
2. **Import a real SillyTavern V2 card** — Import Card → file dialog → `st-card-v2.json` fixture
   (creator/character_version/character_book/talkativeness/fav + native extensions + unknown root
   fields): editor opened with every field loaded; `GET` showed the `lorekeeperCard` envelope
   preserving **all** unmapped metadata; **V3 fixture** (`st-card-v3.json`) imported too —
   `nickname`, `assets`, `creator_notes_multilingual`, `source`, `group_only_greetings`,
   `creation_date`/`modification_date` all preserved.
3. **Export** — editor ⋯ → Export Card → downloaded `captain-ronald-vance.card.v2.json`;
   file inspected: valid `{ spec:'chara_card_v2', spec_version:'2.0', data }` with `creator`,
   `character_version`, `character_book`, `talkativeness`, `fav`, and `extensions` restored — a
   field-for-field match of the original fixture.
4. **Tabs** — Characters (3) ↔ Personas (2) switch live, with counts and per-tab empty states.
5. **Selection mode + delete confirmation** — Select toggle → card clicks select ("2 selected")
   → batch bar (Export/Delete/Cancel) → Delete → confirm dialog → both characters removed
   (server list re-verified). Per-card ⋯ overlay shows Edit/Export/Delete ("Selected Companion").
6. **Persona flows** — created a persona with the default switch; created a second (API) default;
   flipped the default via the grid star → invariant verified server-side (exactly one default).
   Also live-verified a V1 flat import (`detectedFormat: 'v1'`, unknown `creatorcomment` preserved).

Screenshots captured during the run (not committed): `m2-characters-grid.png`,
`m2-selection-mode.png`, `m2-confirm-dialog.png`, `m2-card-actions-overlay.png`,
`m2-editor-preview.png`.

---

## 4. Findings & fixes made during implementation

1. **D7 gap caught by the component test:** the store's `removeCharacter` originally deleted
   immediately on the happy path and only confirmed on the 409 path. The test's dialog expectation
   exposed it — restructured so **every** character deletion confirms first (then the 409 cascade
   confirm as a second step).
2. **`ref(new Set())` under Vue 3.6-rc typing** — `.size` unwrapping breaks `vue-tsc`; switched the
   selection state to a plain array.
3. **Shared-router test pollution** — editor tests initially failed because a previous test's
   `router.push('/characters/:id')` left `params.id` set (singleton router); new-mode tests now
   explicitly `push('/characters/new')` first. Worth remembering for M3 chat tests.
4. **`useLiteralKeys` lint discipline** — envelope reads switched to dot access on
   `Record<string, unknown>`; harmless but keeps Biome at zero.
5. **VP8L dimension parsing** — first implementation shifted the packed bits by one byte (signature
   at byte 20, payload at 21, LSB-first); corrected and verified against synthetic buffers.
6. **Vapor render check via probe** — the editor initially "looked empty" in one debug run; a probe
   test confirmed the page renders fully (the real cause was collapsed accordion sections hiding
   `#jailbreak` in the test, not a vapor issue). Left in as evidence that vapor pages render in
   test-utils through the VDOM host.

---

## 5. Documented deviations from the plan

| # | Plan said | Built instead | Why |
|---|---|---|---|
| 1 | §4.3: "V2 card `character_book` is currently flattened into `systemExtras` on import" | `character_book` preserved in the `extensions` round-trip envelope (plan text updated) | The M2 mission directive is explicit ("must be preserved in the extensions JSON column so round-trip export loses zero data"); flattening would have corrupted export round-trips. Editor users can still copy lore into `systemExtras` manually until M4 lorebook support. |
| 2 | §7.1: `GET/PUT/DELETE /api/characters/:id` | `PATCH` instead of `PUT` | M1 established partial-merge PATCH discipline (defaults-free patch schemas); PUT-full-replace would fight the patch-schema pattern. The plan's other entities (settings/presets) already shipped PATCH. |
| 3 | §7.1 export `?format=v3` marked "stretch, M4+" | Implemented now | Zero extra risk once the round-trip envelope exists — the export builder takes a format parameter. UI keeps V2 as the one-click default per D13. |
| 4 | §6.2 mockup shows a 390 px phone column for the grid | `max-w-[520px]` responsive 2-col grid | The mockup's own grid uses `max-w-2xl` with `sm:` breakpoints (A2 responsive); 520 px keeps the 2-col literary grid comfortable on desktop without stretching cards. |
| 5 | Mockup header has search + overflow menu (Import/Export/Sort) | Working search filter + explicit **Import Card** button; export-archive/sort menu omitted | The mission's M2 control list: pill tabs, grid, selection mode, Import Card header action, FAB. Dead menu items would be worse than their absence; sort order is updatedAt-desc (fixed). |
| 6 | Editor mockup has a Character/Persona segmented mode toggle | Separate routes (`/personas/*`) with a shared shell; eye = Edit/Preview mode | The mission defines the mode toggle as **Edit vs Preview**, and personas are separate entities with their own routes (§6.2). The mockup's segmented control conflated two concepts; the editor header keeps the eye toggle. |

---

## 6. Carry-over into M3/M4

* **Chats/greetings (M3):** chat creation must insert the greeting row from `firstMessage` or a
  random alternate greeting (§3.1); `POST /api/chats` does not exist yet — the delete-restriction
  flow was verified by inserting chats directly in route tests + via the UI confirm path.
* **Extensions envelope vs lorebooks (M4):** `extensions.lorekeeperCard.fields.character_book` is
  stored verbatim; M4's lorebook/character-book support should read it from there (and decide
  whether to also surface a flattened digest in `systemExtras`).
* **Vapor primitives re-verification** (audit §6): the four M1 primitives are untouched; all M2
  inputs follow the `:value`+`@input` discipline with accept-all parents. Re-run the desync probe
  on Vue 3.6 stable before ever restoring native `v-model`.
* **Batch delete & FK cascade:** batch delete always forces (`?force=1`) after one confirm;
  single-card delete exercises the 409 → second-confirm path when chats exist. M3 should reuse the
  same dialog when deleting chats that reference messages.
* **`bun --watch` blind spot** (M0 §8): still restarts manually after `packages/shared` edits.
* **PNG card import** (D13 stretch): parser handles JSON only; PNG `chara`/`ccv3` chunk parsing
  remains parked.

---

## 7. Done-criteria checklist (mission)

- [x] `bun run lint` — 0 errors across 102 files
- [x] `bun run typecheck` — server/shared `tsc` + frontend `vue-tsc` (TNB) clean
- [x] `bun run test` — 73 server + 25 frontend, including card parser V1/V2/V3 round-trips, route
      CRUD/409/force-cascade, untouched-keys PATCH regressions, editor/grid component tests
- [x] `bun run build` — no bundle/chunk errors
- [x] Playwright dev verification — create w/ avatar+greetings+jailbreak, V2+V3 import with
      extensions, V2 export download, tab switching, selection mode + delete confirmation
- [x] `M2_REPORT.md` written and committed cleanly

---

**M2 complete.** Characters and personas are fully usable end-to-end: create, import (V1/V2/V3
losslessly), edit per mockup, export (V2/V3), default-persona invariant, chat-guarded deletion with
confirm dialogs, and avatar uploads with magic-byte validation.
