# M3 Report — Chats, Streaming & Messages

**Milestone:** M3 (per `IMPLEMENTATION_PLAN.md` §10 — "the core") · **Status:** COMPLETE (2026-09-08)
**Base:** master @ `b57e772` (M2 audit fixes committed first, per the audit sign-off checklist)
**Implementation commits:** `6828c1e` (backend) · `8e6fb8c` (frontend) · `5293302` (verification-round fixes)
**Environment:** Windows · Bun 1.4.2 · Node 26.8.1

---

## 0. Pre-work (audit checklist, M2 §6 "Do now")

* [x] Committed the three M2 audit fixes (`cardParser.ts` export fixpoint, `app.ts` 8 MB
  `bodyLimit`, `routes/characters.ts` import cap-validation) plus the three regression tests as
  `b57e772 fix(audit): apply M2 independent audit sign-off corrections` — lint (102 files) /
  typecheck (TNB) / tests (76 server + 25 frontend) verified green before the commit.
* [x] New PATCH schemas (`chatPatchSchema`, defaults-free edit body) shipped with their
  untouched-keys regression tests in the same commit (D-Z1 discipline).

---

## 1. Delivered vs. mission

| Deliverable | Status | Where |
|---|---|---|
| **Shared contracts**: `Chat`, `ChatSummary`, `ChatDetail`, `CreateChatInput`, defaults-free `chatPatchSchema`; `ChatMessage`, `MessageInput`, `EditMessageInput`, `Variant`, defaults-free edit body; `SSEEvent` (meta/delta/done/error); zod `ChatError`/`TokenUsage` mirrors | ✅ | `packages/shared/src/schema.ts` |
| **Prompt template compiler** with mustache sections `{{#tagline}}…{{/tagline}}`, `<ExampleDialogue>` (condensed >25 % budget, stripped when empty), trailing system slot = global PHI + `\n\n` + `character.jailbreak` (**jailbreak last**; both empty → omitted) | ✅ | `packages/shared/src/prompt-variables.ts`, `apps/server/src/prompt/systemPrompt.ts` |
| **Context-window management**: budget = `min(contextLength − maxTokens, contextBudget) − overhead`; chars/4 + 5 % margin; trimming keeps greeting (seq 0) + newest block, drops whole pairs newest→oldest | ✅ | `prompt/systemPrompt.ts` (`computeHistoryBudgetTokens`, `selectHistoryForPrompt`) |
| **Multimodal builder**: images base64 data URLs read from `data/media/`, text part first then images, vision compatibility check with A1 allow-with-warning | ✅ | `prompt/assemble.ts` |
| **chatsRepo**: createChat + greeting insert (firstMessage or random alternate) in one transaction; listChats (status + `q`, `lastMessageAt` desc); delete cascades | ✅ | `services/chatsRepo.ts` |
| **messagesRepo**: appendUserMessage (+attachment linking), createAssistantVariant (generate/regenerate + `keepLastNVariants` cap pruning), activateVariant, editMessage (user ± regenerateAfter; assistant active-only), deleteMessage (group/user ± replies, dense renumbering), finalizeVariant, orphan cleanup | ✅ | `services/messagesRepo.ts` |
| **REST routes**: `GET/POST /api/chats`, `GET/PATCH/DELETE /api/chats/:id`, `POST …/messages`, `POST …/messages/:messageId`, `DELETE …/messages/:messageId?withReplies=`, `POST …/messages/:messageId/activate` | ✅ | `routes/chats.ts` |
| **SSE generation engine**: `POST /api/chats/:id/generate` + `POST …/messages/:messageId/regenerate`; single-flight 409; effective provider/model/preset resolution with zero-defaults fallback (D-S1); `meta`/`delta`/`done`/`error`; 15 s `: ping` heartbeat; 30 s idle watchdog; Stop → partial persisted `finishReason:'aborted'`; provider errors persisted as `isError` variants with the **full** `ChatError` (statusCode + retryAfterMs preserved) | ✅ | `generation/session.ts`, `generation/sseWriter.ts`, `routes/generation.ts` |
| **Chats list page**: tabs (All/In Progress/Archived), summary bar, cards (avatar + presence dot, model pill, preview, relative time), search, New Tale FAB → New Chat sheet (character → persona → optional model override → create & navigate) | ✅ | `pages/ChatsListPage.vue`, `components/chat/{ChatCard inline, NewChatSheet.vue}` |
| **ChatPage**: full-screen shell, header (back/avatar/name/model pill with pulsing dot while streaming/gear), context ribbon (chapter title + live "Turn N"), error hint above composer | ✅ | `pages/ChatPage.vue`, `components/chat/{ChatHeader inline, ContextRibbon.vue, ChatSettingsSheet.vue}` |
| **Scroll manager**: pinned to bottom, follows tokens, no-yank detach >120 px, re-attach ≤40 px, honors `composer.autoScroll` | ✅ | `components/chat/MessageList.vue` |
| **Markdown & safety pipeline**: marked (GFM) + highlight.js + DOMPurify; speech-quote → ivory + primary left border; `*narration*` → italic serif; fenced code with copy button; XSS fixture corpus tested | ✅ | `markdown/index.ts`, `components/chat/MessageBody.vue` |
| **Streaming animations (D9)**: Stage A fade-in runs (~180 ms) with 1 s coalescing window, sliding blinking caret via FLIP (~150 ms, WAAPI, interruptible, reduced-motion + >30 commits/s guards); Stage B delivered dot (blink `deliveredBlinks` × `deliveredBlinkMs` then fade; amber/red tones for aborted/error) | ✅ | `streaming/caret.ts`, `MessageBody.vue`, `StreamingCaret.vue`, `DeliveredDot.vue`, `styles/tailwind.css` |
| **Inline error bubbles (D10)**: red accent, alert icon, code→human title map, collapsible raw details (+statusCode/retryAfterMs), Retry with 429 countdown from `retryAfterMs`, Delete with confirm | ✅ | `components/chat/ErrorBubble.vue` |
| **Composer**: auto-grow textarea (`max-h-24`), Enter/Shift+Enter per `composer.enterToSend`, paste/drop/file attachments with thumbnails + remove ×, vision gating (disabled with note when model lacks vision, warning when unknown per A1), cap 4 images, amber gradient send disabled while streaming, Stop button while streaming | ✅ | `components/chat/ChatComposer.vue` |
| **Message actions & swipes**: `‹ n/N ›` pill (buttons + ←/→ keyboard), edit user (Save default / Save & regenerate after, D8) and assistant in place, delete confirms (D7, checkbox "Also delete the reply that followed?" default checked), copy raw Markdown with toast, regenerate on assistant, retry on errors | ✅ | `components/chat/{MessageItem.vue, MessageActions.vue, VariantSwitcher.vue}` |

**Deliberately not in M3** (per plan phasing): full per-chat override pickers in the settings
sheet (M4 — title/ribbon/archive/delete shipped; model/preset pickers reuse the M4 ModelPicker),
prompt-preview debug viewer (M4), attachment disk GC (D-C1, M4), lorebooks (M4).

---

## 2. Architecture as built

### 2.1 Generation session (`generation/session.ts`)
The route layer (`routes/generation.ts`) performs pre-flight checks that can fail *before* the
response is hijacked — 409 `generation_in_progress` (module-level single-flight set) and 404 chat
— so these surface as normal JSON errors. It then calls `reply.hijack()` via
`createSseWriter` (`generation/sseWriter.ts`), which writes raw SSE
(`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`,
`X-Accel-Buffering: no`) and registers `request.raw.on('close')` as the client-abort signal.
`SseWriter` is a seam: unit tests drive the session with a fake writer.

The session resolves effective config (`chat.* ?? globalDefaults.*`), persists the pending
assistant variant (`finishReason: null`, `text: ''`; regenerate joins the target group and
activates the new variant with cap pruning), emits `meta`, then forwards provider deltas while
accumulating an in-memory buffer. A 15 s heartbeat interval writes `: ping`; a watchdog interval
aborts the upstream `AbortController` when no bytes arrive for >30 s (fails with `idle_timeout`).
Completion persists text/finishReason/usage and emits `done`; client abort persists partial text
as `aborted` (never `error`); provider/HTTP/mid-stream/idle failures persist `isError: 1` +
the full `ChatError` and emit `error`. Every path clears timers, releases the single-flight slot
and ends the stream — the client never hangs.

### 2.2 Prompt assembly (`prompt/`)
`buildAssembledPrompt` renders the system template (shared renderer, sections omitted when the
variable is empty), strips/condenses `<ExampleDialogue>` against a 25 % budget share, composes the
trailing system slot (PHI + `\n\n` + character jailbreak, jailbreak last, omitted when both
empty), selects history under the computed budget and attaches images to the final user turn as
`data:` URLs (text part first). History inclusion follows §3.1: active variants with non-empty
text only; the regenerate target's own group is excluded.

### 2.3 Frontend state (plan §6.4 adapted)
`stores/chats.ts` mirrors list + active chat detail; `stores/streaming.ts` owns
`{chatId, streamingVariantId, isStreaming}` + the `AbortController`, guards 409s, writes SSE
deltas **directly into the chats store cache** (placeholder insert on `meta`, `appendDelta` per
`delta`, finish-marking on `done`), and reconciles with a single `GET /api/chats/:id` in its
`finally` (final text, usage, error payloads, list previews). `ui.confirm()` gained a checkbox
variant (`confirmWithCheckbox`) for the D7 delete-message dialog and a D-F1 fix: a new confirm
auto-cancels a pending one instead of orphaning its promise.

### 2.4 Vapor discipline (M1 §4.3 / M2 §2.5, continued)
Zero native `v-model` on native elements in all new components: the composer textarea, sheet
inputs and edit textareas all bind `:value` + explicit `@input` with accept-all handlers; the
ConfirmDialog checkbox is a button-based `role="checkbox"` (the D-V1 mount-time desync rules out
`:checked` bindings). One new interop rough edge was found and worked around during browser
verification (see §4.2).

---

## 3. Verification results (all green)

| Check | Command | Result |
|---|---|---|
| Lint | `bun run lint` | **138 files, 0 problems** |
| Typecheck | `tsc -p .` ×2 + `vue-tsc` (TNB banner `▎ TNB ACTIVE`) | ✓ |
| Tests | `bun run test` | server **127/127** (10 files) · frontend **53/53** (5 files) |
| Build | `bun run build` | ✓ — ChatPage chunk 262.4 kB (88.6 gzip, includes marked/DOMPurify/hljs), CSS 65.1 kB, 357 modules |
| Playwright dev verification | live `bun run dev` + mock provider, fresh data dir | all mission DoD bullets exercised (§5) |

### 3.1 New test coverage

* **Server** (+51): `prompt-variables.test.ts` (8 — substitution, section omission incl.
  nesting/whitespace/unterminated, known-vs-unknown variables), `prompt-assembly.test.ts` (16 —
  trailing-slot ordering contract, tagline section rule, ExampleDialogue condensation, budget
  formula, greeting anchor + pair-integrity + newest-block trimming, multimodal part order +
  missing-file skip + A1 warning + D-S1 preset fallback), `chats-routes.test.ts` (15 — greeting
  insertion incl. random alternate + 404, list filters, **PATCH untouched-keys regression**,
  attachment linking + double-link/unknown-id 400s, edit+regenerateAfter truncation, assistant
  active-only edit 409, group delete + dense renumber, user delete with/without replies, swipe
  activate + 404s + `not_a_group`, **variant cap pruning**, chat cascade), `generation-session.test.ts`
  (12 — full stream meta/delta/done + persistence, heartbeat comment, **client abort → partial
  text + `aborted`**, provider error → full ChatError payload + error frame, mid-stream error
  frame, **idle watchdog**, `no_key`, `no_model_configured` (D-S1), **409 single-flight on the
  route**, regenerate-joins-group, greeting regeneration, invalid target).
* **Frontend** (+28): `markdown.test.ts` (9 — GFM, XSS corpus `<script>`/`onerror`/`javascript:`/
  iframe, code-fence escaping, img allowlist, dialogue/narration classification, code copy bar,
  safe links), `chat-components.test.ts` (19 — StreamingCaret blink var, DeliveredDot
  blink-then-remove + tones, VariantSwitcher buttons + keyboard, ErrorBubble countdown/details/
  actions, MessageBody settled-vs-streaming + caret-last + fade-in runs, MessageItem role
  polymorphism + D8 save/save-and-regenerate + D7 checkbox delete + clipboard copy + swipe emits +
  error rendering, **MessageList pin/no-yank/re-attach/autoScroll-off**, streaming-store→chats
  store cache integration for generate and regenerate).

### 3.2 Playwright browser verification (dev mode, mock provider, fresh data dir)

Ran against `bun run dev` with `LOREKEEPER_MOCK_PROVIDER=1` (env-gated dev mock that streams a
canned tale in ~45 ms chunks and emits a distinctive preamble when the request carries image
parts) on a fresh `LOREKEEPER_DATA_DIR`:

1. **Create from `/chats`** — New Tale FAB → character (Lady Vivienne) → persona step ("No
   persona" selected, model override placeholder shows the configured default) → Begin the tale →
   chat created; list card shows model pill, greeting preview, "just now", presence dot. ChatPage
   showed the greeting at seq 0 with **Turn 1** on the ribbon.
2. **Send + live streaming** — message sent; `streaming-body` with fade-in runs observed
   (≥100 frames observed across a 1.8 s stream), sliding caret tracked the text end; after `done`
   the message switched to the settled markdown renderer (narration italic / dialogue ivory) and
   the **delivered dot** was visible immediately after completion.
3. **Stop button** — Stop clicked ~22 ms into the stream; stream halted, the variant persisted
   `finishReason: "aborted"` with the partial text ("*The cand…"), no error state.
4. **Regenerate + swipes** — regenerate on an assistant group created a new variant; pill showed
   `‹ 2/2 ›` (and `‹ 3/3 ›` on a thrice-attempted group); ‹ › buttons swiped between variants,
   switching the active text client-side and server-side.
5. **Edit user message with "Save & regenerate after"** — dialog offered Save (primary) and
   Save & regenerate after (D8); the edit replaced the text, deleted the following turn and
   streamed a fresh reply.
6. **Image attachment** — paperclip → file chooser → thumbnail with remove ×; the A1
   "unverified vision" warning banner appeared; sending delivered the image to the provider (the
   mock's image-specific preamble appeared in the reply, proving the base64 part rode the
   request), and the attachment rendered in the message bubble from `/media/…`.
7. **Error bubble + Retry** — with no key stored, generation produced the persisted error variant
   + inline bubble ("Missing API key", alert role, red accent); Details expanded to the raw
   message; storing a key via the API and clicking **Retry** streamed a healthy reply on the same
   group.

Screenshots/console captured during the run were session-local (not committed); the mock provider
log path is the only artifact (`C:\Temp\opencode`, outside the repo).

---

## 4. Findings & fixes made during implementation/verification

### 4.1 `DEFAULT_SYSTEM_TEMPLATE` opened with single-brace `{systemExtras}`
The shipped default template started with `{systemExtras}` — one brace pair — which the mustache
renderer can never substitute (it is not a `{{variable}}`). Character `systemExtras` therefore
silently never reached prompts and the literal `{systemExtras}` text leaked into every system
prompt. Fixed to `{{systemExtras}}` in `packages/shared/src/schema.ts`; locked by the
prompt-assembly test asserting the rendered system contains the character's systemExtras.

### 4.2 Vapor interop: slot content leaks past a child's `v-if` (new RC rough edge)
`BottomSheet`'s own template has `v-if="open"` on its wrapper — under `vaporInteropPlugin` the
**slot content passed by the parent still rendered into the DOM while the sheet was closed** (the
wrapper was removed but the parent-compiled slot subtree stayed, visibly). Mitigation, per the
established per-component workaround pattern: the callers (`NewChatSheet`,
`ChatSettingsSheet`) gate with `v-if` at the call site so the sheet component is never created
while closed. Recorded for the Vue 3.6-stable re-verification pass alongside the four M1
primitives.

### 4.3 D10 gap: config failures skipped the error variant
`no_model_configured` / `no_key` were detected *before* the pending variant existed, so they
emitted an SSE `error` without persisting a bubble — the failure vanished on reload. Fixed:
`failFast` now persists an empty-text `isError` variant (fresh group for generate, target group
for regenerate) for every generation-path failure except pure lookups (`not_found`,
`invalid_target`). Verified in the browser: the no-key bubble survived and Retry worked.

### 4.4 Mid-stream error frames preserved status (M1 D-P1 closed)
The shared `StreamEvent` error variant gained optional `statusCode`; `openaiCompat` passes a
numeric provider `code` from mid-stream frames through; the session maps both HTTP-thrown and
frame-carried errors into the persisted `ChatError` (statusCode + retryAfterMs verified by tests
and in the retry-countdown UI).

### 4.5 Misc
* `prompt-variables.ts`: known variables (the `PROMPT_VARIABLES` set) missing from the map render
  as `''`; unknown names stay verbatim so template typos remain visible in prompts.
* `MessageList` guards missing `requestAnimationFrame`/`scrollTo` (jsdom + defensive).
* `ui.confirm` overlap now resolves the superseded dialog with `false` (D-F1) instead of
  orphaning the promise.
* `getProvider` gained a test seam (`setProviderForTesting`) and the `LOREKEEPER_MOCK_PROVIDER=1`
  dev switch; both documented and env-gated only.

---

## 5. Documented deviations from the plan/mission

| # | Mission/plan said | Built instead | Why |
|---|---|---|---|
| 1 | §7.2 example shows `event: message` + data frames | Plain `data:` frames carrying `{"type": …}` (no `event:` lines) | The plan's own body examples carry the type in the data payload; skipping the redundant `event:` line keeps the wire format exactly what the plan's sample bodies show and the shared parser simple. |
| 2 | §6.3 `chat/ChatHeader` as a component | Header rendered inline in `ChatPage.vue` | It binds a dozen page-local store computeds; extracting it would only add a prop-drilling layer. All other listed components exist as files. |
| 3 | §6.5.5 click-to-reveal actions on touch + hover on desktop | Actions revealed on hover/focus (opacity classes), always in the DOM | Mission D7 flows and tests interact with the buttons directly; a JS tap-reveal toggle would fight vapor's group-hover CSS path for no functional gain. Revisit in the M4 a11y pass. |
| 4 | Mission: "New Chat bottom sheet (character → persona → optional model override)" | Implemented as such, but the persona step shows a radio-style list rather than the mockup's flow | The mockup shows no persona step at all; the plan §6.2 requires persona selection. List UI keeps the 390 px column layout. |
| 5 | Mission listed `ChatSettingsSheet` as gear target | Shipped with title/ribbon/archive/delete; model/preset/persona override pickers deferred to M4 | Plan §10 places per-chat override UI in M4; the sheet's schema support (`chatPatchSchema`) is complete, so M4 is UI-only. |
| 6 | `testConnection` upgrade to authenticated probe (M1 D-P1 checklist) | Not addressed in M3 | Key validity is proven at first chat (which M3 now surfaces honestly as an inline error bubble + retry, materially better than the M1 state); the probe itself stays on the M4 checklist. |

---

## 6. Carry-over into M4

* **Attachment GC (D-C1, unchanged):** message-linked attachments now cascade with their messages
  on delete; pending/replaced avatar media files still accumulate — orphan sweep on boot or after
  chat deletion remains open.
* **Per-chat settings sheet:** add model/preset/persona pickers (schema + PATCH route already
  live; reuse the settings store's catalog).
* **Prompt-preview debug viewer (§7.1):** the assembled-prompt module is factored for reuse
  (`buildAssembledPrompt` returns system/trailing/history/warnings); the M4 viewer is a route away
  (`GET /api/chats/:id/prompt-preview`).
* **Vapor primitives re-verification:** now five known interop workarounds (4 M1 primitives + the
  sheet slot-leak gate); re-run the desync probe and the slot probe on Vue 3.6 stable.
* **`bun --watch` blind spot (M0 §8):** still restart manually after `packages/shared` edits.
* **Mock provider:** `LOREKEEPER_MOCK_PROVIDER=1` is a dev-only switch for demos/tests without
  keys; consider a tiny E2E smoke suite around it post-v1 (plan §9 parked item).

---

## 7. Done-criteria checklist (mission)

- [x] `bun run lint` — 0 errors across 138 files
- [x] `bun run typecheck` — server/shared `tsc` + frontend `vue-tsc` (TNB) clean
- [x] `bun run test` — 127 server + 53 frontend: prompt assembly (mustache, `<ExampleDialogue>`,
      trailing slot ordering), trimming (budget edges, greeting, pair integrity), chat CRUD,
      message append/edit/dense-delete/swipe, defaults-free PATCH regressions, mock SSE stream,
      abort, 409, error-frame mapping, idle watchdog; component tests for `MessageItem`,
      `ChatComposer`, `ErrorBubble`, `StreamingCaret`, `DeliveredDot`, `VariantSwitcher`,
      `MessageBody`, `MessageList` mounted via VDOM hosts
- [x] `bun run build` — no bundle/chunk errors
- [x] Playwright dev verification — greeting at turn 0, live streaming with caret + delivered
      dot, Stop keeps partials, regenerate with `‹ n/N ›` + swipes, edit-and-regenerate, image
      attachments reaching the provider, inline error bubble with working Retry
- [x] `M3_REPORT.md` written and committed cleanly

---

**M3 complete.** The full RP loop works end-to-end: chronicles are created with greetings, messages
stream with the two-stage animation, every generation path (done/abort/error/idle) persists
honestly, swipes/edits/deletes keep `seq` dense and variants capped, and every destructive action
confirms.
