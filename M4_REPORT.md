# M4 Report — Polish, Hardening & Final Production Readiness

**Milestone:** M4 (per `IMPLEMENTATION_PLAN.md` §10 — polish & production readiness) · **Status:** COMPLETE (2026-09-09)
**Base:** master @ `2be0814` (M3 audit sign-off corrections were already committed before M4 work began)
**Environment:** Windows · Bun 1.4.2 · Node 26.8.1

---

## 1. Delivered vs. mission

| Deliverable | Status | Where |
|---|---|---|
| **Prompt-preview debug endpoint** `GET /api/chats/:id/prompt-preview` (§7.1): `{ system, trailing, history, warnings, budget, estimatedTokens, droppedTurnsCount, providerId, modelId, modelContextLength }` validated by a shared zod schema (`promptPreviewResponseSchema`); inline base64 images redacted to size placeholders; `404` unknown chat / `400 no_model_configured` when unset | ✅ | `routes/chats.ts`, `generation/promptInputs.ts`, `packages/shared/src/schema.ts` |
| **Guard message mutations during generation (D-T2)**: append/edit/delete while `isGenerating(chatId)` → `409 { code: 'generation_in_progress', message: 'Cannot modify messages while generation is active' }`; recovered state verified | ✅ | `routes/chats.ts`, `generation/config.ts` |
| **Attachment orphan GC sweep (D-C1/D-T4)**: `cleanupOrphanMedia(db, dataDir)` prunes `messageId IS NULL` rows older than 24 h, deletes files unreferenced by `characters.avatarPath` / `personas.avatarPath` / `attachments.filePath`; runs on boot after 1 s, `unref()`'d — never blocks startup or holds the process | ✅ | `services/attachments.ts`, `app.ts` |
| **Authenticated `testConnection` probe (D-T10)**: OpenRouter now queries `GET /api/v1/auth/key` (401 → honest `invalid_key` with statusCode) instead of the public `/models` ping that could show false "Connected"; UnoRouter keeps a lightweight `/v1/models` probe with graceful error parsing | ✅ | `providers/openrouter.ts`, `providers/openaiCompat.ts` |
| **Complete per-chat settings sheet**: model override (catalog + "Default (from settings)" + manual id entry), preset override, persona override ("Default / None" + list), context-budget override ("Default" + custom number) — persisted via defaults-free `PATCH /api/chats/:id` (explicit `null` on reset); generation sessions honor every override through the shared `resolveGenerationConfig` | ✅ | `components/chat/ChatSettingsSheet.vue`, `generation/config.ts` |
| **Prompt-preview debug modal**: header icon button → budget-utilization bar, rendered system prompt (collapsible, copyable), assembled conversation history, trailing system slot (PHI + jailbreak, copyable), active warnings (dropped turns etc.), "Copy system prompt" + "Copy full prompt" | ✅ | `components/chat/PromptPreviewModal.vue` |
| **Image lightbox (D-T7)**: thumbnail click → full-screen viewer (`role="dialog"`, `aria-modal`), high-res image, backdrop blur, close via × / backdrop / Escape, focus in and restored | ✅ | `components/chat/ImageLightbox.vue`, `ImageGrid.vue` |
| **Touch tap-reveal (M3 Deviation 3 rider)**: viewports < 768 px toggle the message action bar on bubble tap (excluding taps on buttons/links/inputs); desktop keeps instant hover/focus-within reveal | ✅ | `components/chat/MessageItem.vue`, `MessageActions.vue` |
| **Focus management & keyboard navigation**: one dependency-free util gives every overlay (sheets, modals, confirm dialog, lightbox) Tab trapping, topmost-overlay Escape handling and trigger-focus restoration — built for Vapor, where template refs do not bind, via `data-lk-overlay` tokens | ✅ | `utils/overlayA11y.ts` used by `BottomSheet`, `ConfirmDialog`, `PromptPreviewModal`, `ImageLightbox`, `EngineCard` (model library modal) |
| **Reduced-motion check**: caret FLIP, fade-in runs, delivered dot blink, sheet/modal transitions and skeleton pulses all collapse to static under `prefers-reduced-motion: reduce` (global 0.01 ms transition/animation collapse + targeted overrides) | ✅ | `styles/tailwind.css`, `streaming/caret.ts` |
| **Unified empty/loading/error states**: all four primary views gained skeleton pulses during first fetch, `ErrorBanner` with Retry on failure, and consistent empty states with calls-to-action (e.g. "No chronicles found — begin a new tale") | ✅ | `ui/ErrorBanner.vue`, stores (`charactersLoading`, `charactersError`, …), `ChatsListPage`, `CharactersPage`, `SettingsPage`, `ChatPage` |
| **Mockup parity**: M-3 "Editorial Sanctum" dark palette, serif narration/ivory dialogue, 4 px parchment scrollbar, sticky blurred headers, FAB placement, settings card headers and archival footer with dynamic `APP_VERSION` (`v0.1.0`) | ✅ | verified in the running build |

---

## 2. Architecture as built

### 2.1 Preview/config split on the server
`generation/config.ts` was extracted from the session engine: the single-flight set (`activeGenerations` / `isGenerating`) and `resolveGenerationConfig` (effective `chat.* ?? globalDefaults.*` resolution with the D-S1 `no_model_configured` guard) now live in one module. The generation routes and the new prompt-preview route both call the exact same resolution logic, so the debug viewer can never drift from what generation actually sends. `generation/promptInputs.ts` assembles the preview payload (system, trailing slot, selected history with redacted image placeholders, budget math, dropped-turn warnings) on top of the existing `buildAssembledPrompt`.

### 2.2 Overlay a11y without template refs
Vapor components cannot bind template refs, so `utils/overlayA11y.ts` inverts the usual pattern: every overlay marks its root with `data-lk-overlay="<token>"` and the util keeps a token stack. The **topmost** overlay owns Escape (a confirm dialog stacked over a sheet wins) and Tab cycling (capture-phase wrap across focusable descendants). Focus moves to the first focusable element on open and returns to the trigger on close/unmount. Used by `BottomSheet` (all sheets), `ConfirmDialog`, `PromptPreviewModal`, `ImageLightbox` and the model-library modal in `EngineCard`.

### 2.3 Overrides end-to-end
`ChatSettingsSheet` pickers write through `PATCH /api/chats/:id` (reset sends explicit `null`, matching the M3 defaults-free schema). The next generation (and the preview route) resolves provider/model/preset/persona/budget from chat-level overrides falling back to global defaults — verified live: setting the budget override to 4096 dropped the preview's computed budget from 7,961 to 3,865 tokens.

---

## 3. Verification results (all green)

| Check | Command | Result |
|---|---|---|
| Lint | `bun run lint` | **147 files, 0 errors** |
| Typecheck | `tsc -p .` ×2 + `vue-tsc` (TNB banner `▎ TNB ACTIVE`) | ✓ |
| Tests | `bun run test` | server **139/139** (11 files) · frontend **64/64** (6 files) |
| Build | `bun run build` | ✓ — 366 modules; ChatPage chunk 278.7 kB (92.9 gzip), index 336.8 kB (121.1 gzip), no warnings |
| Production smoke test | `bun run build` + `bun run start` (single process on `127.0.0.1:3000`) + Playwright | full mission checklist passed (§5) |

### 3.1 New test coverage

* **Server** (+6 in `m4-hardening.test.ts`, plus 1 regression in `prompt-variables.test.ts`): prompt-preview contract (system/trailing/history/budget math), per-chat budget override + `droppedTurnsCount`, base64 redaction, 404/`no_model_configured` errors; **409 mutation guard** on append/edit/delete during a live stream with recovery; `cleanupOrphanMedia` (stale pending rows + unreferenced files pruned, referenced/recent data kept); **default-template regression** — the shipped `DEFAULT_SYSTEM_TEMPLATE` renders without leaking any `{{#…}}/{{/…}}` markers (see §4.1).
* **Frontend** (+11 in `m4-components.test.ts`): `ImageLightbox` (high-res render, ×/Escape/backdrop close, focus in + restore), `ImageGrid` → lightbox wiring, `MessageItem` tap-reveal (mobile toggle on/off, desktop inert, button taps excluded), `BottomSheet` + `ConfirmDialog` focus management (Escape, focus return), `ChatSettingsSheet` overrides (pickers render, PATCH persistence, explicit-null reset).

### 3.2 Production smoke test (`bun run start`, mock provider)

Journey performed in a browser against the integrated build (SPA + API on `127.0.0.1:3000`):

1. `/` → redirects to `/chats`; deep links render via the SPA fallback (health `{"ok":true}`).
2. `/settings` — footer shows **Lorekeeper Sanctum • v0.1.0**; key stored masked (`sk-or-…-001`); **Test Connection** → "Connected (Latency 3ms)"; archival footer with MIT + encryption note. The OpenRouter authenticated `/auth/key` probe path is covered by the provider unit tests (mock mode hides the real provider card).
3. `/characters` — grid card for Lady Vivienne with tagline chip; editor shows the persisted **jailbreak** ("duels, blood and period-accurate weaponry…") and archetype-applied personality.
4. `/chats` — New Tale flow (character → persona → begin) created a chat with the greeting at seq 0, Turn 1 ribbon, header model pill, prompt-preview button.
5. **Prompt preview modal** — "What the model sees": model/ctx header, budget bar ("37 / 7,960 tokens"), rendered system prompt with character data, history, post-history slot showing the character jailbreak; focus restored to the trigger on Escape.
6. **Send → stream → Stop → regenerate → swipes** — live streaming with caret + fade-in runs observed in-DOM; Stop mid-stream persisted `finishReason:'aborted'` variants with partial text (288/90-char partials verified via API); regenerate joined the group; variant pill `‹ n/N ›` swiped (4/4 → 3/4).
7. **Chat settings overrides** — preset → "Default Sanctum", budget → custom 4096 saved through PATCH; prompt-preview immediately reflected the smaller budget; system template fixed per §4.1 served.
8. **Image attachment → lightbox** — thumbnail staged with remove ×, image reached the provider (mock's image preamble), bubble thumbnail opened the full-screen lightbox (`role=dialog`, `aria-modal=true`, backdrop blur 12 px, focus on the close button).
9. **Touch + keyboard** — 390 px viewport: bubble tap toggled the action bar on/off; 5 Tabs inside the settings sheet stayed trapped (focus on `override-persona` after cycling); Escape closed overlays and restored trigger focus.
10. **Delete chat with confirm** — sheet → "Delete chronicle" → confirm dialog → chat deleted, redirected to `/chats` showing the empty state "No chronicles found — begin a new tale." with its CTA.

---

## 4. Findings & fixes made during implementation/verification

### 4.1 `DEFAULT_SYSTEM_TEMPLATE` closed `<Character>` with an orphan `{{/Character}}` (latent M1–M3 defect)
The shipped template opened the character block with a literal `<Character>` tag but closed it with `{{/Character}}` — a section close tag with **no opener**, which the renderer correctly leaves verbatim; every generated prompt therefore leaked `{{/Character}}`. Caught by the new prompt-preview smoke step (visible in the rendered system prompt). Fixed to the consistent `</Character>` wrapper in `packages/shared/src/schema.ts` and locked by a regression test asserting the rendered default template contains no surviving section markers. (Already-persisted settings rows keep their stored template, as designed.)

### 4.2 Test pipeline broke under an inherited `NODE_ENV=production` (25 pre-existing frontend failures)
Running the suite in an environment that exports `NODE_ENV=production` (CI images, agent shells) failed 25 frontend component tests with raw refs leaking into templates (`[object Object]`, always-truthy `v-if`). Root cause chain:

1. `@vue/test-utils` was externalized and loaded via its CJS main; its `require('vue')` picked `vue.cjs.prod.js` → a **second** runtime instance (`runtime-core.cjs.prod.js` in the stacks) rendering the VDOM hosts while the Vapor SFC modules ran on the aliased ESM copy.
2. On the ESM copy, Vapor's `handleSetupResult` takes the prod branch (`callRender(render, instance, setupResult)`) which passes the raw setup-returned bindings object **without `proxyRefs`** — so template `_ctx.editing` saw the RefImpl itself (truthy) instead of the unwrapped value.

Fixed hermetically in `apps/frontend/vitest.config.ts`: force `process.env.NODE_ENV = 'test'` before anything reads it, and alias `@vue/test-utils` to its `esm-bundler.mjs` build so the CJS require chain can never pull an unaliased runtime. After the fix the whole suite (including all pre-M4 tests) runs green under any ambient `NODE_ENV`.

### 4.3 `ChatPage` never mounted `ConfirmDialog`/`ToastHost`
Destructive flows inside the chat (message delete, chat delete via the settings sheet) call `ui.confirm()`, and streaming errors call `ui.notify()` — but `ChatPage` rendered neither host, so confirms silently never resolved and toasts were invisible. `ChatsListPage` had the same toast gap. Both pages now mount `<ConfirmDialog />` and `<ToastHost />`; the chat-delete confirm was re-verified end-to-end in the browser (dialog → confirm → redirect to the chats empty state).

### 4.4 Misc
* `biome.json` now excludes `.commandcode/` (assistant tool-local settings) from lint/format.
* `stores/characters.ts` gained `charactersLoading/charactersError` + persona equivalents to power the unified skeleton/error UI without ad-hoc page state.

---

## 5. Documented deviations from the plan/mission

| # | Mission/plan said | Built instead | Why |
|---|---|---|---|
| 1 | Prompt-preview endpoint response `{ system, trailing, history, warnings, budget, estimatedTokens, droppedTurnsCount }` | Same shape **plus** `providerId`, `modelId`, `modelContextLength` for the modal header | The modal needs the effective model/ctx to title the budget bar; extra fields are additive and schema-validated. |
| 2 | "Test provider key with authenticated probe" on `/settings` in the smoke run | Verified on the **mock** provider card (Connected · 3 ms); the OpenRouter `/auth/key` 401 path is covered by the 14 provider unit tests | Mock mode hides the real-provider card; no real API key is available in the smoke environment. |
| 3 | `ModelLibraryModal.vue` listed as a separate modal | Model library remains inline in `EngineCard.vue` (as built in M1) but now uses the same overlay-a11y util | The component was never extracted in M1; extracting it in M4 would churn a stable 100+ kB chunk for no behavior gain. |
| 4 | Mission's `Modal.vue` named in the a11y checklist | No `Modal.vue` exists — the overlay family is `BottomSheet` (sheets), `PromptPreviewModal`, `ImageLightbox`, model-library inline modal and `ConfirmDialog`; **all** received focus traps | Name drift between mission text and the actual M1 component set; the a11y guarantee covers every overlay that exists. |

---

## 6. Carry-over / parked (post-v1)

* **Vue 3.6 stable re-verification** — the interop workarounds list now counts seven entries (four M1 primitives, the M3 sheet slot-leak gate, the M4 `data-lk-overlay` pattern for vapor's missing template refs, and the dev-split `_ctx` reliance documented in §4.2). Re-run the desync/slot probes on stable.
* **Lorebooks** remain parked per plan §9 (explicitly out of M1–M4 scope).
* **E2E smoke suite** — the manual Playwright journey (§3.2) is a candidate to codify around `LOREKEEPER_MOCK_PROVIDER=1` (plan §9 parked item).
* **`bun --watch` blind spot** (M0 §8) — restart manually after `packages/shared` edits, unchanged.
* **GC cadence** — the orphan sweep runs on boot only; a periodic sweep is unnecessary for the single-user desktop profile but trivially added if deployment profiles change.

---

## 7. Done-criteria checklist (mission)

- [x] `bun run lint` — 0 errors across 147 files
- [x] `bun run typecheck` — server/shared `tsc` + frontend `vue-tsc` (TNB) clean
- [x] `bun run test` — 139 server + 64 frontend, including new prompt-preview, mutation-guard and attachment-GC tests, plus the M4 a11y/overrides component tests
- [x] `bun run build` — production assets without warnings
- [x] End-to-end production smoke test on `bun run start` — all checklist steps passed (§3.2)
- [x] `M4_REPORT.md` written
- [x] Clean git commit

---

**M4 complete — and with it, the v1 plan.** Lorekeeper is production-ready end to end: prompts are inspectable before they are sent, every destructive action confirms, every overlay is keyboard-accessible and focus-safe, abandoned media is swept, provider failures are reported honestly, and the integrated single-process build serves the whole experience on one port.
