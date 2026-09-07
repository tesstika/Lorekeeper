# M1 Report — Settings & Providers

**Milestone:** M1 (per `IMPLEMENTATION_PLAN.md` §10) · **Status:** COMPLETE (2026-09-07)
**Base:** master @ `2500dd6` (M0 audit fixes committed; empty commit `257f25c` rebased out before the first M1 commit)
**Environment:** Windows · Bun 1.4.2 · Node 26.8.1

---

## 1. Delivered vs. plan (§10 M1)

| Plan item | Status | Where |
|---|---|---|
| Settings page per mockup (providers/keys, engine, sampling, composer, presets, prompt template) | ✅ | `apps/frontend/src/pages/SettingsPage.vue` + `components/settings/*` |
| Provider abstraction + OpenRouter/UnoRouter implementations | ✅ | `apps/server/src/providers/{types,openaiCompat,openrouter,unorouter,index}.ts` |
| Key storage (AES-256-GCM, encrypted at rest, hint-only exposure) | ✅ | `apps/server/src/services/{crypto,keyStore}.ts` |
| Model cache (24 h TTL, `?refresh=1`, refresh-on-open-if-stale) | ✅ | `settings` row `modelCache:<providerId>` + providers route |
| Presets CRUD + seeded default | ✅ | `apps/server/src/services/presetsRepo.ts`, `routes/presets.ts` |
| Settings sections CRUD | ✅ | `routes/settings.ts`, `services/settingsRepo.ts` |
| Shared contracts (zod 4, z.input/z.output discipline) | ✅ | `packages/shared/src/schema.ts` |
| Version constant bound everywhere (About line, /api/health) | ✅ | `packages/shared/src/version.ts` (`APP_VERSION`) — M0 §8 carry-over closed |
| Error-handler `details` from the narrowed guard type | ✅ | `app.ts` — M0 §8 carry-over closed (see §4.1) |
| Component tests for settings panels | ✅ | `apps/frontend/src/tests/settings.test.ts` (11 tests) |
| Unit tests: crypto, providers (mocked fetch), routes | ✅ | `apps/server/src/tests/{crypto,providers,settings-routes}.test.ts` (38 tests) |

**Deliberately not in M1** (per plan phasing): `streamChat` route wiring (M3 — the engine itself is implemented + tested), `@fastify/multipart` (M3), persona picker (M2 — field exists in schema), prompt-variable *renderer* (M3/M4 — the editor + storage ship here).

---

## 2. Architecture as built

### 2.1 Server

* **Crypto** (`services/crypto.ts`): AES-256-GCM (12-byte IV, auth tag), master key = 32 random bytes at
  `%LOCALAPPDATA%/Lorekeeper/secret.key` (POSIX: `$XDG_DATA_HOME`/`~/.local/share/Lorekeeper/secret.key`),
  `LOREKEEPER_SECRET_KEY_PATH` override for tests. Atomic create (`.tmp-<uuid>` + rename), `0600` best-effort
  (Windows ACLs inherit user-profile scoping). Corrupt key file → explicit error (never silently rotated —
  that would brick all stored keys). `keyHint` = first 6 + last 4 chars — the only fragment any client sees.
* **KeyStore** (`services/keyStore.ts`): envelopes in `settings.apiKeys` row (`{ openrouter, unorouter }`).
  Plaintext exists in memory only for the duration of a call; never logged, never serialized by any route.
* **Settings repo** (`services/settingsRepo.ts`): typed kv access with schema-validated reads
  (`parse`-with-fallback so corrupt rows degrade to defaults). Also stores `modelCache:<id>`
  (`{ fetchedAt, models }`) and `providerTest:<id>` (last connection test: status/latency/code/testedAt).
* **Presets repo**: CRUD with the single-default invariant enforced in a transaction; deleting the preset
  referenced by `globalDefaults.presetId` clears the dangling reference in the same transaction.
  Seed = `Default Sanctum` (temp 0.85, topP 0.92, maxTokens 4096, isDefault) guarded by a `presetSeed:v1`
  settings marker (user deletion is not resurrected on reboot).
* **Providers**: `LlmProvider` interface per plan §5 (listModels / testConnection / streamChat). Shared
  OpenAI-compat engine: request building (text-first image parts, passthrough `top_k`/`repetition_penalty`
  only when non-null), SSE line-buffer parser (chunk splits, comments, `[DONE]`, mid-stream error frames,
  terminal usage chunk), error mapping (401→`invalid_key`, 402→`insufficient_credits`, 429+Retry-After→
  `rate_limited`, 5xx→`upstream_error`, network→`network_error`), client abort → `done{finishReason:'aborted'}`
  (partial text survives for M3 persistence). OpenRouter adds `X-Title: Lorekeeper` + optional
  `HTTP-Referer` (`LOREKEEPER_HTTP_REFERER`) + `usage:{include:true}`; UnoRouter parses the OpenAI-minimal
  catalog with A1 graceful fallbacks (missing `context_length` → null, no modality metadata → `[]`).
* **Routes** (`routes/providers.ts`, `presets.ts`, `settings.ts`): all request/response bodies validated
  with shared zod schemas. `GET /api/providers` composes key presence + last test + cache freshness.
  `GET .../models` serves fresh cache with zero provider traffic; stale cache is refreshed on open; `?refresh=1`
  bypasses TTL; stale-cache-without-key is served gracefully; otherwise `400 no_key` before any traffic.

### 2.2 Shared (`packages/shared`)

* `version.ts` — `APP_VERSION` consumed by server env, `/api/health`, and the Settings About line.
* `schema.ts` — keyEnvelope/apiKeys, globalDefaults/promptTemplate/composer (+ **defaults-free PATCH
  schemas** — see §4.2), provider info/status, model info/cache/response, preset input/schema/**patch**,
  `DEFAULT_SYSTEM_TEMPLATE`, `PROMPT_VARIABLES`. All types exported as `z.output` where handlers produce
  post-transform values; `z.input` only where callers build literals.
* `types.ts` — `ChatRequest` / `StreamEvent` / content-part types for the M3 generation engine.

### 2.3 Frontend

* `api/index.ts` — typed fetch client + `ApiError` (code/details surfaced).
* `stores/settings.ts` — single source of truth (settings, providers, presets, model catalog cache,
  `workingPreset` draft) — survives route navigation; `stores/ui.ts` + `ui/ToastHost.vue` for feedback.
* Components (all `<script setup lang="ts" vapor>`): `settings/{ProviderKeysCard,EngineCard,
  ModelLibraryModal,SamplingCard,PresetCard,ComposerCard,PromptTemplateCard,SectionHeader}` and
  `ui/{ToggleSwitch,RangeSlider,NumberStepper,TagInput,ToastHost}`. Mockup fidelity: max-w-xl column,
  section cards with icon headers + right captions, masked key input with reveal/paste/save/clear,
  live latency pill, provider pills with key dots, model row with vision/context/price metadata, dashed
  "Save Current as New Preset" button, Selected/Default chips, qualitative slider labels
  ("Precise & Deterministic" → "Vivid & Chaotic"), Engine Ready/Setup Needed status pill, two-step confirms
  (Reset, Clear key, Delete preset), archival footer bound to `APP_VERSION`.
* UX decisions within the mission's bounds: sampling sliders edit the *working copy*; persistence happens
  through **Update Current** (PATCH), **Save as New** (POST → becomes active), or the **Set as Default**
  action — matching the mockup's preset-card mental model. `repetitionPenalty` stays schema-backed but has
  no control yet (not in the M1 control list).

---

## 3. Verification results (all green)

| Check | Command | Result |
|---|---|---|
| Lint | `bun run lint` | 81 files, 0 problems |
| Typecheck | `tsc -p .` ×2 + `vue-tsc` (TNB banner) | ✓ |
| Tests | `bun run test` | server **41/41** · frontend **13/13** |
| Build | `bun run build` | ✓ — SettingsPage chunk 142.9 kB (39.6 gzip), CSS 41.3 kB |
| Start mode | `bun run start` | `/`→200, `/settings`→200 (SPA fallback), `/api/health`→ok |
| Dev smoke (Playwright, live) | manual checklist | all pass (§5) |

### 5. Dev-mode manual verification (browser-driven, fresh `data/`)

* **Key at rest**: saved a placeholder OpenRouter key via the UI → `settings.apiKeys` row holds a
  base64 AES-256-GCM envelope (`encrypted`/`iv`/`tag`/`hint`); plaintext **not** recoverable from the
  ciphertext; master key created at `C:\Users\…\AppData\Local\Lorekeeper\secret.key` (32 bytes). UI shows
  only `sk-or-…cdef` + "Key saved — not verified".
* **Connection test**: Test Connection → `Connected (Latency 668ms)` badge + toast; result persisted
  (`providerTest:openrouter` row) and reflected in `GET /api/providers`.
* **Catalog**: Model Library fetched the **live** OpenRouter catalog (430 models) with vision badges,
  context tags ("1.1M context"), pricing ("$10.00/M in · $50.00/M out"), free-model tags; search filtering;
  selection sets `globalDefaults.modelId` and closes; cached row `modelCache:openrouter` (430 models,
  24 h TTL) verified in SQLite; second open hits cache; manual model ID (`my-org/custom-rolling-model`)
  applies and renders.
* **Presets**: Update Current persisted temp 1.30/topK 1/stop `Player:` to Default Sanctum; Save as New
  ("Novelist's Flow") became selected; Set as Default flipped the invariant server-side and in the UI;
  deleting the active preset cleared `globalDefaults.presetId`; two-step confirm banner verified.
* **Sampling**: temperature slider → readout + "Vivid & Chaotic" label; topK stepper Off→1→Off; max tokens
  stepper; frequency/presence steppers; stop-sequence tag add/remove.
* **Composer**: toggles (Enter/auto-scroll/edit-default) + caret/delivered sliders + blink count stepper —
  all persisted (`composer` row verified after each change).
* **Prompt template**: textarea edits (debounced) + variable-chip insertion (`{{personaName}}`) and PHI —
  persisted to the `promptTemplate` row.
* **Navigation persistence**: `/chats` → `/settings` round-trips preserved provider status/latency, model,
  preset selection, composer values, and template text (pinia + server).
* **Reset**: two-step confirm → all three sections restored to schema defaults (keys deliberately untouched).

---

## 4. Findings & fixes made during implementation/smoke

### 4.1 Fastify 5: error handler must be set before route registration (M0 carry-over, root-caused)
The global error handler was registered *after* the routes. Fastify captures
`server[kErrorHandler]` into each route's context **at registration time** (`lib/context.js`), so zod
validation errors fell through to the built-in `FST_ERR_VALIDATION` shape and `details` was never emitted
(M0 had no body routes, so this was invisible). Fixed by ordering `setErrorHandler`/`setNotFoundHandler`
before all route registrations; `details` now maps the narrowed `error.validation` items
(`keyword`/`path`/`message`/`params`) and is locked by a unit test.

### 4.2 fastify-type-provider-zod v7 validates request bodies through the z.output direction
**Critical discovery:** v7's validator produces the *post-transform* output for request bodies too — every
`.default()` in a body schema is **injected into missing keys**. A `partial()` PATCH of `{ modelId }`
arrived as `{ modelId, providerId: null, presetId: null, … }`, silently clobbering stored values on merge.
Fix: dedicated **defaults-free** patch schemas (`globalDefaultsPatchSchema`, `promptTemplatePatchSchema`,
`composerPatchSchema`, explicit `presetPatchSchema`) used by every PATCH body; regression tests assert
untouched keys survive. Response schemas with defaults remain fine (documented behavior: defaults always
present in responses).

### 4.3 Vapor interop: native-input `v-model` desyncs (RC rough edge)
Under `vaporInteropPlugin`, checkbox/range `v-model`'s model→DOM effect (runtime's `ensureMounted` path)
never lands correctly: a checkbox rendered *unchecked* while the model was `true`, and a bare `change`
event flipped state from the unbound DOM. Template **prop bindings are fine** (verified: initial render +
reactive updates). Mitigations shipped:
* `ToggleSwitch` → button-based `role="switch"` (`aria-checked`, click toggles) — no native checkbox.
* `RangeSlider`/`NumberStepper`/`TagInput` → `:value` bindings + explicit `@input`/emits (no `defineModel`
  inside vapor SFCs; props read in templates).
* The preset `<select>` binds `:selected` **on the options** — the select's own `:value` property lands
  before its options exist (effect ordering) and is never retried.
* Component v-model *between* vapor components (parent assigns on `update:modelValue`) works and is used
  throughout; each write that must persist carries an explicit `@update:model-value` handler.
Track for the 3.6 stable: re-introduce native `v-model` in these primitives once interop bindings mature.

### 4.4 Misc fixes
* Store preset list went stale when the server cleared other presets' `isDefault` (single-default
  invariant) — the store now mirrors the invariant after every create/update.
* Composer sliders/steppers mutated local state without persisting — every control now fires its PATCH.
* `presetsRepo` upserts return `returning()[0]` with explicit null checks (Biome noNonNullAssertion).
* `GET .../models` TTL: freshness is now actually consulted (fresh → serve cache; stale → refresh when a
  key exists; stale without key → serve stale; `?refresh=1` always refetches).

### 4.5 Known caveat (recorded, by design)
OpenRouter's `GET /models` is **public** — `testConnection` pings it, so a syntactically-valid-but-wrong
key still reports "Connected". Real key validity is only proven at chat time (M3). This matches the plan
("test = ping `/models`"); flagged for a possible M3+ upgrade (probe a cheap authenticated endpoint).

---

## 5. Documented deviations from the plan

| # | Plan said | Built instead | Why |
|---|---|---|---|
| 1 | §7.1 `GET /api/providers/:id/models` → `[ModelInfo]` | `{ models, fetchedAt, cached }` envelope | The UI needs `cached`/`fetchedAt` for the library footer + refresh affordance; list shape available as `models`. |
| 2 | §7.1 `POST /api/providers/:id/test` → `{ status, latencyMs }` | + nullable `code`/`message` | Error tests (no_key/invalid_key) must tell the user *why*; plan's error contract elsewhere requires it. |
| 3 | §3 settings kv list | + `providerTest:<id>` rows | `GET /api/providers` needs honest status/latency across restarts without re-pinging on every GET. |
| 4 | SettingsPage column width 390 px (M0 shell) | `max-w-xl` per the settings mockup | The mockup itself specifies `max-w-xl`; all five mockups share tokens, layouts differ per page (A2). |
| 5 | Presets section mockup shows Load/Edit per card | Load via dropdown + Selected-card actions (Update Current / Set as Default / Delete / Save as New) | Mission's control list (dropdown + 4 actions); mockup visual language preserved (Selected chip, tags, dashed save button). |

---

## 6. Carry-over into M2/M3

* `bun --watch` still doesn't watch `packages/shared` — restart `bun run dev` after shared edits (bit twice
  during this milestone; unchanged from M0 §8).
* M3: wire `streamChat` into `POST /api/chats/:id/generate` (engine ready + tested); persist error variants;
  vision gating should treat empty `inputModalities` as "unknown → allow with warning" (A1) — helpers
  already in `utils/model-format.ts`.
* Consider re-verifying the four §4.3 vapor primitives against Vue 3.6 stable.
* `repetitionPenalty` has schema + wire support but no Settings control (not in the M1 control list).

---

**M1 done-criteria (mission):** lint/typecheck/test/build green · dev smoke verified all five DoD bullets
(encrypted keys, live latency, catalog + cache persistence, preset CRUD, navigation state persistence) ·
both providers implementable end-to-end with real keys entered via the UI (OpenRouter verified live with a
placeholder key; UnoRouter path covered by mocked tests + A1 fallbacks until the real key is entered by
the owner through the Settings UI).

---

## 7. M1 addendum — per-character "Jailbreak" groundwork (2026-09-07, post-sign-off)

**Decision (owner):** M2's Character Editor will carry a per-character **Jailbreak** field — an
anti-refusal preamble (combat / blood / weapons RP) composed into the final system slot.

**Does M1 need changes?** The Settings/global side does **not** — the global
`promptTemplate.postHistoryInstructions` slot (§4.1) already exists and stays as-is; the per-character
jailbreak composes *with* it (contract pinned below). The **data layer** did need one small change, so it
was landed in M1 rather than as M2 migration churn:

| Change | File | Notes |
|---|---|---|
| `characters.jailbreak` column (`text NOT NULL DEFAULT ''`) | `apps/server/src/db/schema.ts` | Placed next to `systemExtras`. Empty string = feature off per character. |
| Migration `0001_empty_shadowcat.sql` (`ALTER TABLE characters ADD jailbreak …`) | `apps/server/drizzle/` | Generated via `bun run db:generate`; applied automatically on boot by the existing `user_version`-guarded migrator — existing dev DBs pick it up with no data loss. |
| Column assertion in the boot test | `apps/server/src/tests/health.test.ts` | `PRAGMA table_info(characters)` must contain `jailbreak` — locks the migration in CI. |
| Plan updated to stay canonical | `IMPLEMENTATION_PLAN.md` §3 (sketch), §4.1/4.2 (composition), §10 (M2 bullet) | No behavior change to shipped M1 features. |

**Prompt-composition contract (pinned for M3):** final trailing system message =
`global postHistoryInstructions` + `\n\n` + `character.jailbreak` (character jailbreak **last** — most
specific instruction closest to the generation point); both empty → no trailing system message.

**Deferred to M2 (by design):** shared `CharacterInput`/`Character` zod schemas gain `jailbreak`, the
Character Editor textarea (with an anti-refusal hint), ST V2/V3 card import mapping (card-level
`post_history_instructions` → `jailbreak`), and prompt-preview rendering of the merged slot.
