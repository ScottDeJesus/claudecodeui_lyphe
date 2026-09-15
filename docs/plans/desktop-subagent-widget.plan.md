# Desktop subagent widget — the pinned strip moves into a gutter widget, and a click reads the transcript live

## INTENT LOCK

**ORIGINAL REQUEST** (the operator's own words, verbatim):
> next plan will be adding a subagent widget window for desktop only. moving its currently pinned area above the chat to a movable widget area. specific for only the sessions they were spawned and no others. I also would like the ability to click on said subagent to read its transcripts live.

**THIS PLAN DELIVERS:**
A third desktop chat-gutter widget, **Subagents**, beside Runner and Memory. It can be dragged into any of the four gutter slots, collapsed to a tab and swapped like the other two, and its placement persists in the same `chatGutters` preference. By default it sits bottom-left and starts open.

- **What moves.** The pinned strip above the chat box holds the running and recent Agent-tool subagents and `/dispatch` soul launches. While the gutters are showing (non-mobile, chat region wide enough for gutters), that strip is no longer drawn above the chat box. The same rows appear in the Subagents widget instead. When the gutters are not showing (mobile, or a desktop chat region too narrow for gutters), the strip stays above the chat box exactly as today, so nothing disappears on a small screen.
- **Only this chat's subagents.** The widget lists only the subagents and soul launches that the chat you have open spawned. The data comes from that chat's own session state, and the widget refuses rows tagged with any session id other than the open chat's. Switching chats switches the list, and a chat with none shows an empty state.
- **Dismissing.** Dismissing a row anywhere removes it everywhere at once: the widget list, the widget's tab count and the strip.
- **Click to read, live.** Clicking a row turns the widget into a transcript view for that subagent, with a Back button. For an Agent-tool subagent it reads the subagent's own transcript file. For a soul launch it reads that soul's Claude transcript. While the subagent is still running, the view re-reads every 2 seconds, so new steps appear as they are written. It stops re-reading once the subagent has finished.
- **Server.** Two new authenticated reads:
  - `GET /api/providers/sessions/:sessionId/subagents/:toolUseId/transcript`
  - `GET /api/dispatch-souls/launches/:launchId/transcript`
- **Docs.** The docs and code comments that say the pinned strip lives above the chat box, or that a row component has one consumer, are rewritten to the new rule.

**OPERATOR VERDICT:** CONFIRMED -- 2026-09-14 -- Scott: "Accept — run it"

## Runner

```toml
plan_format = 2
cwd = "/home/lyphe/.claude/claudecodeui_lyphe"
add_dirs = ["/home/lyphe/.claude/projects", "/home/lyphe/.claude/state/dispatch-souls", "/home/lyphe/.cloudcli"]

[budget]
max_cycles = 30
max_spawns = 120
max_fix_passes = 2
max_attempts = 2
max_replans = 3
```

## Interfaces

Paths are relative to the repo root unless absolute. Server code uses the `@/` alias with a `.js` suffix; client code uses `@/...`.

**Shared result type** (server `server/shared/types.ts`, mirrored byte-for-byte in client `src/shared/types.ts`, each in a new group `//----------------- SUBAGENT TRANSCRIPTS ------------` appended at the end of the file, each type commented):

- `export type SubagentTranscriptResult = { found: boolean; activity: SubagentActivity[]; total: number; inFlight: boolean; finishedAt: string | null };`
  - `found` is `false` when the session, provider, file or launch cannot be resolved. Then `activity` is `[]`, `total` is `0`, `inFlight` is `false` and `finishedAt` is `null`. "Not found" is never an HTTP error.
  - `activity` is the LAST `SUBAGENT_TRANSCRIPT_LIMIT = 1000` entries (a tail slice), each passed through the existing `truncateSubagentActivity`.
  - `total` is the untruncated entry count.
  - `SubagentActivity` is the existing type (server `server/shared/types.ts:451`, client `src/shared/types.ts:321-329`); it is not changed.

**Server: providers module** (`server/modules/providers/`):

- `list/claude/claude-sessions.provider.ts` gains the `export` keyword on three declarations: `readClaudeSubagentTranscript` (line ~152), the `ClaudeSubagentTranscript` type (line ~75) and `truncateSubagentActivity`. Its comment at line ~69 is rewritten to name `claude-transcript-activity.ts` as the reader's second consumer (the widget transcript read, tail-sliced, outside the history path's 200-entry head cap). Nothing else changes; this file is 1297 lines.
- `list/claude/claude-session-synchronizer.provider.ts`: the Claude projects root declared at lines ~33-35 is the ONE home of the transcript layout. It gains the `export` keyword if it lacks it, and nothing else changes.
- `list/claude/claude-transcript-activity.ts` (new, ≤200 LOC). All three reads are provider internals, and only the last is re-exported from the barrel.
  - `export const SUBAGENT_TRANSCRIPT_LIMIT = 1000;`
  - `export const NOT_FOUND_TRANSCRIPT: SubagentTranscriptResult` is the frozen not-found value described above. It is module-internal: never re-exported from the barrel.
  - `export async function readTranscriptActivity(filePath: string): Promise<SubagentTranscriptResult>` (module-internal):
    - calls `readClaudeSubagentTranscript(filePath)`;
    - returns `{ found: true, activity: tail(LIMIT).map(truncateSubagentActivity), total, inFlight, finishedAt: finishedAt ?? null }`;
    - a missing or unreadable file returns `NOT_FOUND_TRANSCRIPT`, and it never throws.
  - `export async function findSubagentTranscriptByToolUse(projectDirectory: string, providerSessionId: string, toolUseId: string): Promise<string | null>` (module-internal):
    - reads `<projectDirectory>/<providerSessionId>/subagents/`;
    - for each `agent-<agentId>.meta.json` whose JSON `toolUseId === toolUseId`, returns the sibling `agent-<agentId>.jsonl` path when that file exists;
    - otherwise returns `null`, and does not search the legacy loose layout;
    - caches hits only in a module-level `Map<string, string>` keyed `` `${providerSessionId}:${toolUseId}` ``, cleared at 500 entries.
  - `export async function readClaudeTranscriptBySessionId(providerSessionId: string): Promise<SubagentTranscriptResult>` (barrel-exported):
    1. Returns `NOT_FOUND_TRANSCRIPT` unless the id matches `/^[0-9a-f-]{36}$/`.
    2. **Row lookup first.** `sessionsDb.getSessionByProviderSessionId(providerSessionId)`, imported from `@/modules/database/index.js`. When the row has a `jsonl_path` that exists on disk, it returns `readTranscriptActivity(jsonl_path)`.
    3. **Directory scan fallback.** The first `<root>/<dir>/<providerSessionId>.jsonl` that exists across the directories of the projects root exported from `claude-session-synchronizer.provider.ts`. A module-level `Map<string, string>` caches hits only and is cleared at 200 entries. Then `readTranscriptActivity`.
    4. Any miss returns `NOT_FOUND_TRANSCRIPT`, and it never throws.
- `services/subagent-transcript.service.ts` (new, ≤120 LOC): `export const subagentTranscriptService = { readByToolUse(sessionId: string, toolUseId: string): Promise<SubagentTranscriptResult> }`. It resolves the app session with `sessionsDb.getSessionById(sessionId)` (the call `sessions.service.ts:471-521` `fetchHistory` makes) and returns `NOT_FOUND_TRANSCRIPT` when:
  - no row exists;
  - `provider !== 'claude'`;
  - there is no `jsonl_path`;
  - no file is found.

  Otherwise it sets `projectDirectory = path.dirname(session.jsonl_path)` and `providerSessionId = session.provider_session_id ?? sessionId`, then calls `findSubagentTranscriptByToolUse`, then `readTranscriptActivity`. It imports those from `@/modules/providers/list/claude/claude-transcript-activity.js`; this is the same module, so the deep path is allowed.
- `provider.routes.ts` gains `GET /sessions/:sessionId/subagents/:toolUseId/transcript`, directly after `GET /sessions/:sessionId/messages` (lines ~840-853). The route:
  - parses `sessionId` with the same `parseSessionId`;
  - rejects a `toolUseId` not matching `/^[A-Za-z0-9_-]{1,128}$/` with HTTP 400, in the file's existing error style;
  - calls `subagentTranscriptService.readByToolUse`;
  - answers `res.json(createApiSuccessResponse(result))`.

  The full URL is `/api/providers/sessions/:sessionId/subagents/:toolUseId/transcript`, mounted at `server/index.ts:222` behind `authenticateToken`.
- `index.ts` (barrel) gains exactly one export, `readClaudeTranscriptBySessionId`, with a consumer comment naming `dispatch-souls`.
- Comment-only rewrites, made necessary by this plan (healed means deleted):
  - `services/session-agents.service.ts` lines ~10, ~23 and ~25;
  - `services/session-soul-launches.service.ts` line ~10;
  - `list/claude/claude-runtime.provider.js` line ~386.

  Each place that describes the pinned strip above the composer, or the strip as the only place the rows render, is rewritten to: the chat's pinned rows, drawn in the strip above the chat box when the desktop chat gutters are not showing and in the gutter's Subagents widget while they are. No code line changes in these three files.

**Server: dispatch-souls module** (`server/modules/dispatch-souls/`):

- `soul-transcript.service.ts` (new, ≤100 LOC) exports `export async function readSoulTranscript(stateDir: string, launchId: string): Promise<SubagentTranscriptResult>`; `stateDir` is the launch root `createDispatchSoulsModule` already resolves (`dispatch-souls.module.ts:67`) and passes in, so the launch directory is `<stateDir>/<launchId>` and the module passes `transcript: (launchId) => readSoulTranscript(stateDir, launchId)`. It holds only two steps, and its not-found value is its own frozen literal of the same shape, because `NOT_FOUND_TRANSCRIPT` is provider-internal.
  1. **launch id → session id.** The launch directory is `<the launch root the lane already uses in soul-launch.transport.ts>/<launchId>`. The Claude session id is `result.json`'s `session_id` when present. Otherwise read the first 65536 bytes of `child.log` and take the first match of `/"session_id":"([0-9a-f-]{36})"/`.
  2. **The provider read.** `readClaudeTranscriptBySessionId(sessionId)`, imported from `@/modules/providers/index.js`.

  It knows nothing about `~/.claude/projects`, returns a frozen not-found result on any miss, and never throws.
- `dispatch-souls.routes.ts` gains `GET /launches/:launchId/transcript`. It rejects a `launchId` not matching `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/`, or containing `..`, with HTTP 400. Otherwise it answers `response.json(await dependencies.transcript(launchId))`, raw like its `/launches` sibling. The router's dependencies type gains `transcript: (launchId: string) => Promise<SubagentTranscriptResult>`.
- `dispatch-souls.module.ts` (line ~107) passes `transcript: readSoulTranscript` into `createDispatchSoulsRouter`. The full URL is `/api/dispatch-souls/launches/:launchId/transcript`.

**Client: api** (`src/shared/api.ts`): a new top-level member of the exported api object, written in the same `get(...)` helper style as `descent.memory` (lines ~604-609). BOTH methods resolve to a bare `SubagentTranscriptResult`, and every envelope unwrap happens inside this member:
- `subagentTranscripts.agent(sessionId: string, toolUseId: string): Promise<SubagentTranscriptResult>` reads `/api/providers/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(toolUseId)}/transcript`. That route answers the `createApiSuccessResponse` envelope `{ success, data }`, and the member returns `data`. Read `get`'s implementation in `api.ts` first:
  - if `get` already strips `data`, return its value unchanged;
  - if it returns the parsed body, return `.data`.

  Name `get`'s line in your report.
- `subagentTranscripts.soul(launchId: string): Promise<SubagentTranscriptResult>` reads `/api/dispatch-souls/launches/${encodeURIComponent(launchId)}/transcript`. That route answers the result raw, so the member returns it as is. If `get` strips a `data` key that is absent, the method returns the body.

**Client: chat module** (`src/modules/chat/`):

- New group `//----------------- CHAT SUBAGENT WIDGET ------------` in `src/shared/types.ts` (appended, commented):
  - `export type ChatSubagentSource = { sessionId: string; agentMessages: ChatMessage[]; soulLaunchIds: string[] };`
  - `export type SubagentTranscriptTarget = { kind: 'agent' | 'soul'; id: string };`

  The `*Feed` suffix is reserved for live-bus feeds (`docs/architecture/07-live-widgets.md`), so neither type nor store uses it.
- `utils/pinnedDismissals.ts` becomes a module-scope shared store, using the `src/shared/hooks/useCliVersion.ts:22-133` pattern:
  - the snapshot is read lazily once from the existing localStorage read, keeping today's key `cloudcli.pinned-agents.dismissed` and its 500 cap;
  - `export function useDismissedPins()` returns that snapshot through `useSyncExternalStore`, typed as today's read returns it. Its identity is stable until a write.
  - `export function dismissPin(id: string): void` writes through the existing write, replaces the snapshot and notifies listeners.
  - `readDismissed` and `writeDismissed` lose their `export` once no file outside `pinnedDismissals.ts` imports them (grep `src/`), so they are healed, not left dangling.
- `subagents/subagentSource.ts` (new, ≤120 LOC) is a module-scope store in the same pattern:
  - `export function publishSubagentSource(source: ChatSubagentSource | null): void`
  - `export function useSubagentSource(sessionId: string | null): ChatSubagentSource | null` returns the source only when `sessionId !== null && source !== null && source.sessionId === sessionId`, else `null`.
  - `export function useClaimSubagentStrip(active: boolean): void` is an effect that increments a module counter while `active` and decrements on cleanup.
  - `export function useSubagentStripClaimed(): boolean` returns `counter > 0`.
- `hooks/usePinnedSubagentRows.ts` (new) is a PURE MOVE of the row derivation now inside `transcript/PinnedSubagents.tsx:120-218`: the soul-launch map read, the agent entry build, the running/finished time windows, any `now` ticking state and the ordering. There is ONE deliberate change: dismissals come from `useDismissedPins()` and `dismissPin`, never a private `useState(readDismissed)`.
  - Signature: `export function usePinnedSubagentRows(messages: ChatMessage[], soulLaunchIds: string[]): { rows: PinnedSubagentRow[]; dismiss: (id: string) => void }`, where `dismiss` is `dismissPin`.
  - `rows` is exactly the array `PinnedSubagents` builds today before its `rows.length === 0` return: same elements, same order.
  - `PinnedSubagentRow` is that array's element type, exported from the hook file (rename the local type to this name).
  - The constants it uses (`FINISHED_SHOWN_FOR_MS`, `RUNNING_BELIEVED_FOR_MS`) move with it.
- `transcript/PinnedSubagents.tsx` keeps its props, calls `usePinnedSubagentRows(messages, soulLaunchIds)` and renders what it renders today. Its root element gains `data-testid="pinned-subagents-strip"`, and it no longer imports `readDismissed` or `writeDismissed`.
- `transcript/PinnedAgentRow.tsx` and `transcript/SoulLaunchPinRow.tsx` each gain optional `onOpen?: () => void` and `openLabel?: string` props.
  - When `onOpen` is given, the row's root gains `role="button"`, `tabIndex={0}`, `onClick={onOpen}`, an `onKeyDown` that calls `onOpen` on Enter or Space (with `preventDefault`), `aria-label={openLabel}` and `cursor-pointer`.
  - The dismiss button gains `data-testid="pinned-row-dismiss"`, and its handler calls `event.stopPropagation()` before `onDismiss`.
  - Without `onOpen`, the rendered output is unchanged apart from that `data-testid`.
  - The "its only consumer" comments (`PinnedAgentRow.tsx:7`, `SoulLaunchPinRow.tsx:10`) are rewritten to name both consumers: `PinnedSubagents` and `SubagentWidgetBody`.
- `tools/SubagentNote.tsx` (new) is a PURE MOVE of the module-local memoized `SubagentNote` out of `tools/SubagentPanel.tsx:72-90`, as `export const SubagentNote` with a consumer comment. `SubagentPanel.tsx` imports it from `@/modules/chat/tools/SubagentNote`.
- `hooks/useSubagentWidgetRows.ts` (new, ≤60 LOC):
  - `export function useSubagentWidgetRows(sessionId: string | null): { rows: PinnedSubagentRow[]; dismiss: (id: string) => void }` is `useSubagentSource(sessionId)`, then `usePinnedSubagentRows(source?.agentMessages ?? EMPTY, source?.soulLaunchIds ?? EMPTY)`, using module-level frozen empty arrays.
  - `export function useSubagentWidgetCount(sessionId: string | null): number` returns `rows.length`.
- `hooks/useSubagentTranscript.ts` (new, ≤120 LOC): `export function useSubagentTranscript(sessionId: string | null, target: SubagentTranscriptTarget | null, running: boolean): { result: SubagentTranscriptResult | null; failed: boolean }`.
  - It reads once when `target` changes. After each answer it schedules the next read in `TRANSCRIPT_POLL_MS = 2000` with `setTimeout`, while `running || result.inFlight`.
  - A request token keeps only the newest answer. It does no read while `target === null`, clears the timer and ignores late answers after unmount or a target change.
  - An `agent` target reads `api.subagentTranscripts.agent(sessionId, id)`, skipped when `sessionId === null`. A `soul` target reads `api.subagentTranscripts.soul(id)`. The hook consumes the bare result and does no envelope unwrap.
- `subagents/SubagentTranscriptView.tsx` (new, ≤200 LOC): `export function SubagentTranscriptView({ sessionId, target, label, running, onBack }: { sessionId: string | null; target: SubagentTranscriptTarget; label: string; running: boolean; onBack: () => void })`.
- `subagents/SubagentWidgetBody.tsx` (new, ≤200 LOC): `export function SubagentWidgetBody({ sessionId }: { sessionId: string | null })`.
- `index.ts` (barrel) gains `SubagentWidgetBody`, `useSubagentWidgetCount` and `useClaimSubagentStrip`, each with a consumer comment naming `chat-gutters`.

**Client: chat-gutters module** (`src/modules/chat-gutters/`):

- `src/shared/types.ts:2040` `GutterWidgetId` becomes `'runner' | 'memory' | 'subagents'`.
- `hooks/useGutterPlacements.ts`:
  - exports `export const GUTTER_WIDGET_ORDER: readonly GutterWidgetId[] = ['runner', 'memory', 'subagents'];`
  - its defaults gain `subagents: { slot: 'bottom-left', open: true }`;
  - `parsePlacements`, `withPlacement` and `moveWidget` are generalized over `GUTTER_WIDGET_ORDER` (the rules are in Phase 4);
  - the exported hook signature is unchanged.
- `ChatGutterLayout.tsx`:
  - `widgetIn` iterates `GUTTER_WIDGET_ORDER`.
  - `renderWidget` draws from ONE table keyed by `GutterWidgetId`: `Record<GutterWidgetId, { title: string; count: number; icon: LucideIcon; Body: ComponentType<{ sessionId: string | null }> }>`. The entries are:
    - `runner`: `t('gutters.runner.title')`, `runnerCount`, `ActivityIcon`, `RunnerWidgetBody`;
    - `memory`: `t('gutters.memory.title')`, `pendingCount`, `BrainIcon`, `MemoryWidgetBody`;
    - `subagents`: `t('gutters.subagents.title')`, `useSubagentWidgetCount(sessionId)`, `BotIcon` from lucide-react, `SubagentWidgetBody`.

    `renderWidget(w)` returns exactly one `<GutterWidgetFrame …>` built from `table[w]`, whose children are `<Boundary><Body sessionId={sessionId} /></Boundary>`.
  - The component calls `useClaimSubagentStrip(wide)`.
  - Imports come from `@/modules/chat`.
  - Only `widgetIn`, `renderWidget`, the table, the hook calls and the imports change; no geometry changes.

**data-testid hooks** the probe reads:
- `pinned-subagents-strip`: the strip root.
- `pinned-row-dismiss`: a row's dismiss button.
- `subagent-widget-list`: the list `ul`.
- `subagent-widget-row`: each `li`, with `data-row-id` (the agent's tool_use id, or the soul's `launch_id`), `data-kind="agent|soul"` and `data-running="true|false"`.
- `subagent-widget-empty`: the empty-state wrapper.
- `subagent-transcript`: the view root, with `data-kind`, `data-row-id` and `data-live="true|false"`.
- `subagent-transcript-back`: the Back button.
- `subagent-transcript-entry`: each rendered activity wrapper.
- `subagent-transcript-earlier`: the show-earlier button.

**i18n keys** go in a top-level `gutters.subagents` object in `common.json`, in all 11 locales (`de en es fr it ja ko ru tr zh-CN zh-TW`). The values below are English; translate the other ten and keep `{{name}}` verbatim.
- `gutters.subagents.title` "Subagents"
- `gutters.subagents.empty` "No subagents in this chat"
- `gutters.subagents.back` "Back to subagents"
- `gutters.subagents.loading` "Loading transcript…"
- `gutters.subagents.notFound` "No transcript on disk yet"
- `gutters.subagents.failed` "Could not read the transcript"
- `gutters.subagents.live` "Live"
- `gutters.subagents.showEarlier` "Show earlier steps"
- `gutters.subagents.openRow` "Read {{name}}'s transcript"

## Project Constraints

- No unit tests, ever. Add no `*.test.ts(x)` file, no `tests/` addition and no vitest config edit. `.agents/skills/*/SKILL.md` asks for module tests; the operator's global rule overrides it. Verification is the `check`/`verify` commands in this plan, run against the running dev server.
- Never commit, push, branch, stash, checkout, restore or reset inside the run; the tree accumulates.
  - Other sessions have many uncommitted edits in this tree, including `server/index.ts`, `server/shared/types.ts`, `src/shared/types.ts`, `src/modules/chat/ChatInterface.tsx`, `ChatComposer.tsx`, `PinnedSubagents.tsx`, `useChatSessionState.ts` and `docs/architecture/06-tool-view.md`. Edit those files where they stand.
  - Never revert or "clean up" a change that is not yours, and never treat one as a fence.
  - A probe is undone by deleting what it created, never through git.
- **The gutters are being reshaped by another build right now.** Iris, dispatch `dispatch-iris-20260914-204320-214a`, is changing the gutter proportions, the scroll pane and the slot heights in `src/modules/chat-gutters/ChatGutterLayout.tsx`, `GutterSlot.tsx`, `GutterWidgetFrame.tsx` and `.verify/probe-side-widgets.mjs`.
  - Anchor on SYMBOLS (`widgetIn`, `renderWidget`, `parsePlacements`, `moveWidget`, `WIDGETS`), never on line numbers or on today's grid classes, widths, constants or slot-height rules.
  - Never change any geometry: the grid columns, `max-w-*`, the `GUTTER_*`/`CHAT_COLUMN_PX`/`MIN_REGION_PX` constants, the slot grow rules or G1's geometry assertions. Leave them exactly as you find them.
- The dev server is two systemd units: `cloudcli-server-dev` on 127.0.0.1:3011 and `cloudcli-client-dev` on :5183.
  - Never restart either by hand, and never run `npm run dev`, `server:dev` or `npm run build`.
  - Every save under `server/` restarts the API through `tsx watch` and drops live Claude runs. So make ALL server edits of a phase in one consecutive pass, file after file, with no typecheck or curl in between, and run checks only after the last server file is saved.
  - Vite hot-reloads `src/`.
- Backend law (`.agents/skills/backend-module-standards/SKILL.md`):
  - TypeScript only under `server/modules/`. `claude-runtime.provider.js` is pre-existing JavaScript and takes a comment-only edit.
  - "Never deep-import another module's routes, services, repositories, adapters, or internal files" (L22). Cross-module imports go only through the module's `index.ts`, using the `@/` alias with a `.js` suffix.
  - `type` over `interface`.
  - Routes "Parse and validate transport input in the route … call one or more services, and translate the result to the response" (L48), and "Keep business logic, persistence, filesystem work … out of routes" (L49).
  - "Export a function or variable at its declaration" (L40), with a consumer comment (L42).
- Frontend law (`.agents/skills/frontend-module-standards/SKILL.md`):
  - `@/...` imports only, never `./` or `../`; bare specifiers for packages; `import type` for types (L19-23).
  - `type`, never `interface` (L66-72).
  - A type used by two or more files lives in `src/shared/types.ts`, with a comment (L74-80). The one exception, `PinnedSubagentRow`, is recorded in Decisions.
  - Another module is imported only through its `index.ts`, and a barrel exports only what has a consumer (L27-33).
  - "For every exported component, add a brief comment at its definition naming the consuming module or modules" (L52), and keep that comment current when consumers change (L53).
  - "Add a brief comment immediately above every newly introduced state declaration explaining why the state is essential" (L144).
  - No module-local `types.ts`, `utils.ts` or `constants.ts`.
- Verve (`~/.claude/design/DESIGN_DOCTRINE.md`; `src/shared/ui/verve/README.md`):
  - Compose existing library components imported from the barrel `@/shared/ui` ("Import from the barrel", README L84-86): `Button` (`size="icon"`, `variant="ghost"`), `Badge` (`tone`), `EmptyState`, `Spinner` and `Card`.
  - Add no file in `src/shared/ui/` and no CSS file anywhere.
  - "Colour reaches a screen through Tailwind, never as a literal" (README L29-40): Tailwind colour names only (`text-muted-foreground`, `border-border`), never hex or `var(--…)`.
  - Colour is never the whole signal: "Live" is a word in a `Badge`, not only a dot.
  - Icons come from `lucide-react`.
- No new npm dependency.
- Module size: a new file stays within the LOC noted in Interfaces, and never over 250; split by cohesion before it passes. Files already over 300 lines take only a handful:
  - `ChatInterface.tsx` (684): add ≤15 lines.
  - `claude-sessions.provider.ts` (1297): the three `export` keywords and the one comment only.
  - `provider.routes.ts` (912): add ≤20 lines.
  - `src/shared/types.ts` (~2050) and `server/shared/types.ts` (~1663): only the groups named in Interfaces.
- `npm run typecheck` must exit 0. `npm run lint` must exit 0 and must print no warning naming a file this plan creates or edits. The whole-repo warning count moves with other sessions and is not a gate.
- Every new user-facing string is an i18n key in all 11 locales' `common.json`. Parity is checked over `gutters.subagents.*` only. The existing hard-coded English inside `PinnedAgentRow.tsx` and `SoulLaunchPinRow.tsx` stays as it is.
- The operator asked that screenshots not be posted in chat. A probe may write screenshots under `.verify/shots/`, and a report names their paths only: never attach, embed or paste an image.
- Healed means deleted: no commented-out code, no "old" variants and no compatibility shims. A doc or comment line made false by this plan is rewritten, never annotated.
- Standing stop rule: when reality diverges from this plan, stop. That covers a file or symbol not where an anchor says, a signature that differs, or a check failing for a reason the plan did not name. Report the divergence verbatim with `RESULT: BLOCKED`, and do not improvise a fix.

## Phase 1 — Server: the two transcript reads, their type, the client api
Depends on: none

```toml
[phase]
id = "1"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
manifest = [
  "server/shared/types.ts",
  "server/modules/providers/list/claude/claude-sessions.provider.ts",
  "server/modules/providers/list/claude/claude-session-synchronizer.provider.ts",
  "server/modules/providers/list/claude/claude-runtime.provider.js",
  "server/modules/providers/services/session-agents.service.ts",
  "server/modules/providers/services/session-soul-launches.service.ts",
  "server/modules/providers/list/claude/claude-transcript-activity.ts",
  "server/modules/providers/services/subagent-transcript.service.ts",
  "server/modules/providers/provider.routes.ts",
  "server/modules/providers/index.ts",
  "server/modules/dispatch-souls/soul-transcript.service.ts",
  "server/modules/dispatch-souls/dispatch-souls.routes.ts",
  "server/modules/dispatch-souls/dispatch-souls.module.ts",
  "src/shared/types.ts",
  "src/shared/api.ts",
  "docs/dispatch-souls.md",
]
forbidden = ["server/modules/providers/services/sessions-watcher.service.ts", "server/index.ts"]
athena = [
  "A toolUseId, launchId or session id carrying '/', '..' or a NUL reaches path.join before validation, so a request can read a file outside the subagents dir, the launch root or the projects root",
  "readTranscriptActivity slices the HEAD (first 1000) instead of the TAIL, so a long running transcript never shows its newest steps",
  "A missing session, non-claude provider, absent meta.json or unreadable file throws a 500 instead of answering found:false",
  "The meta.json / session-id caches store misses, so a transcript that appears a second later is never found for the life of the process",
  "soul-transcript.service.ts knows the ~/.claude/projects layout (scans or joins it) instead of calling readClaudeTranscriptBySessionId, or the providers barrel exports readTranscriptActivity / NOT_FOUND_TRANSCRIPT",
  "A comment-only file (session-agents, session-soul-launches, claude-runtime) changed a code line",
  "api.subagentTranscripts.agent resolves to the {success,data} envelope instead of the bare result",
]

[[steps]]
kind = "edit"
path = "server/shared/types.ts"
what = "Per Interfaces (Shared result type): append the SUBAGENT TRANSCRIPTS group with SubagentTranscriptResult, commented."
check = '''grep -c 'export type SubagentTranscriptResult' server/shared/types.ts'''
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/providers/list/claude/claude-sessions.provider.ts"
what = "Attempt 1 (run desktop-subagent-widget-plan-20260915-010332-cb92) ALREADY LANDED this step: `export type ClaudeSubagentTranscript` (line ~75) and `export async function readClaudeSubagentTranscript` (line ~158), and the reader's own JSDoc (lines ~150-157) naming `claude-transcript-activity.ts` as its second consumer. Run the check; when it prints 2 and ok, leave the file alone. Correction to the Interfaces bullet on this file: it names THREE exports, but `truncateSubagentActivity` is not declared in this file. It is already `export function truncateSubagentActivity` at `server/shared/utils.ts:462`, and this file imports it from `@/shared/utils.js` (line 24). Add no export for it here and no copy of it anywhere; `claude-transcript-activity.ts` imports it from `@/shared/utils.js`. The consumer comment sits at the reader's JSDoc, not at line ~69, which is the `IN_FLIGHT_BELIEVED_FOR_MS` doc and stays as it is. Nothing else in the file changes."
check = '''grep -c 'export async function readClaudeSubagentTranscript\|export type ClaudeSubagentTranscript' server/modules/providers/list/claude/claude-sessions.provider.ts; grep -c 'claude-transcript-activity' server/modules/providers/list/claude/claude-sessions.provider.ts | sed 's/^[1-9][0-9]*$/ok/'; grep -c '^export function truncateSubagentActivity' server/shared/utils.ts'''
expect = "2\nok\n1"

[[steps]]
kind = "edit"
path = "server/modules/providers/list/claude/claude-session-synchronizer.provider.ts"
what = "Give the Claude projects root ONE exported declaration. This corrects the Interfaces bullet on this file, which says the root is declared at lines ~33-35. It is not: lines 33-35 are JSDoc prose. The root is built inline as `path.join(this.claudeHome, 'projects')` inside `synchronize` (line ~52), from the private instance field `private readonly claudeHome = path.join(os.homedir(), '.claude')` (line 27). Do exactly two things. (a) Directly above the `ClaudeSessionSynchronizer` class JSDoc (below the `ParsedSession` type), add a module-level declaration, exported at its declaration (backend law L40), with a comment above it naming both consumers: this synchronizer's scan and `claude-transcript-activity.ts`'s session-id fallback. The comment must not repeat the constant's name. The declaration line is exactly `export const CLAUDE_PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');`. (b) In `synchronize`, replace the argument line `      path.join(this.claudeHome, 'projects'),` with `      CLAUDE_PROJECTS_ROOT,`. Leave `claudeHome` and its two `history.jsonl` uses (lines ~50 and ~95) exactly as they are. Nothing else in the file changes."
check = '''F=server/modules/providers/list/claude/claude-session-synchronizer.provider.ts; grep -c "^export const CLAUDE_PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');$" $F; grep -c '^ *CLAUDE_PROJECTS_ROOT,$' $F; { grep -c "path.join(this.claudeHome, 'projects')" $F || true; }; grep -c "path.join(this.claudeHome, 'history.jsonl')" $F'''
expect = "1\n1\n0\n2"

[[steps]]
kind = "edit"
path = "server/modules/providers/list/claude/claude-runtime.provider.js"
what = "Comment-only per Interfaces: rewrite the comment at line ~386 that names the pinned strip so it says the rows render in the strip above the chat box when the desktop chat gutters are not showing and in the gutter's Subagents widget while they are. No code line changes."
check = '''grep -c 'Subagents widget' server/modules/providers/list/claude/claude-runtime.provider.js | sed 's/^[1-9][0-9]*$/ok/' '''
expect = "ok"

[[steps]]
kind = "edit"
path = "server/modules/providers/services/session-agents.service.ts"
what = "Comment-only per Interfaces: rewrite the comments at lines ~10, ~23 and ~25 that describe the pinned strip above the composer as where these agents render, to the when-gutters-show rule naming the gutter's Subagents widget. No code line changes."
check = '''grep -c 'Subagents widget' server/modules/providers/services/session-agents.service.ts | sed 's/^[1-9][0-9]*$/ok/' '''
expect = "ok"

[[steps]]
kind = "edit"
path = "server/modules/providers/services/session-soul-launches.service.ts"
what = "Comment-only per Interfaces: rewrite the comment at line ~10 that describes the pinned strip above the composer, to the when-gutters-show rule naming the gutter's Subagents widget. No code line changes."
check = '''grep -c 'Subagents widget' server/modules/providers/services/session-soul-launches.service.ts | sed 's/^[1-9][0-9]*$/ok/' '''
expect = "ok"

[[steps]]
kind = "edit"
path = "server/modules/providers/list/claude/claude-transcript-activity.ts"
what = "Create per Interfaces: SUBAGENT_TRANSCRIPT_LIMIT, NOT_FOUND_TRANSCRIPT, readTranscriptActivity (tail slice, never throws), findSubagentTranscriptByToolUse (meta.json toolUseId scan, hits-only cache capped 500), readClaudeTranscriptBySessionId (uuid check, sessionsDb.getSessionByProviderSessionId jsonl_path first, projects-root directory scan fallback over `CLAUDE_PROJECTS_ROOT`, hits-only cache capped 200). Imports, each on its own import statement: `CLAUDE_PROJECTS_ROOT` from `@/modules/providers/list/claude/claude-session-synchronizer.provider.js` (step 3); `readClaudeSubagentTranscript` from `@/modules/providers/list/claude/claude-sessions.provider.js`; `truncateSubagentActivity` from `@/shared/utils.js` (never from the provider, which does not export it); `sessionsDb` from `@/modules/database/index.js`; `SubagentTranscriptResult` as `import type` from `@/shared/types.js`. `sessionsDb.getSessionByProviderSessionId(id)` returns `SessionRow | null` (`sessions.db.ts:476`), and `SessionRow.jsonl_path` is `string | null`. The reader's `finishedAt` is optional (`claude-sessions.provider.ts:86`), so map it with `?? null`."
check = '''F=server/modules/providers/list/claude/claude-transcript-activity.ts; grep -c 'export const SUBAGENT_TRANSCRIPT_LIMIT = 1000\|export const NOT_FOUND_TRANSCRIPT\|export async function readTranscriptActivity\|export async function findSubagentTranscriptByToolUse\|export async function readClaudeTranscriptBySessionId\|getSessionByProviderSessionId' $F; grep -c "CLAUDE_PROJECTS_ROOT" $F | sed 's/^[1-9][0-9]*$/ok/'; grep -c "truncateSubagentActivity.*from '@/shared/utils.js'\|from '@/shared/utils.js'" $F | sed 's/^[1-9][0-9]*$/ok/'; { grep -c "os.homedir\|'.claude'" $F || true; }'''
expect = "6\nok\nok\n0"

[[steps]]
kind = "edit"
path = "server/modules/providers/services/subagent-transcript.service.ts"
what = "Create subagentTranscriptService.readByToolUse per Interfaces: sessionsDb.getSessionById, claude-only, projectDirectory = path.dirname(jsonl_path), provider_session_id fallback to sessionId, NOT_FOUND_TRANSCRIPT on every miss."
check = '''grep -c 'export const subagentTranscriptService\|getSessionById' server/modules/providers/services/subagent-transcript.service.ts'''
expect = "2"

[[steps]]
kind = "edit"
path = "server/modules/providers/provider.routes.ts"
what = "Add GET /sessions/:sessionId/subagents/:toolUseId/transcript directly after GET /sessions/:sessionId/messages, per Interfaces: parseSessionId, toolUseId regex -> 400, delegate to subagentTranscriptService.readByToolUse, createApiSuccessResponse."
check = '''grep -c "/sessions/:sessionId/subagents/:toolUseId/transcript" server/modules/providers/provider.routes.ts'''
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/providers/index.ts"
what = "Export readClaudeTranscriptBySessionId (and nothing else new) from the providers barrel, with a consumer comment naming dispatch-souls."
check = '''grep -c 'readClaudeTranscriptBySessionId' server/modules/providers/index.ts | sed 's/^[1-9][0-9]*$/ok/'; { grep -c 'readTranscriptActivity\|NOT_FOUND_TRANSCRIPT' server/modules/providers/index.ts || true; }'''
expect = "ok\n0"

[[steps]]
kind = "edit"
path = "server/modules/dispatch-souls/soul-transcript.service.ts"
what = "Create `export async function readSoulTranscript(stateDir: string, launchId: string): Promise<SubagentTranscriptResult>` per the Interfaces soul-transcript bullet. The launch root is NOT in `soul-launch.transport.ts`: that file takes the root as a parameter (`listLaunchDirs(root: string, notOlderThanMs: number)`, line 58) and joins nothing. The lane resolves it once, in the composition root, as `const stateDir = expandHome(process.env.DISPATCH_SOULS_STATE_DIR || DEFAULT_STATE_DIR)` (`dispatch-souls.module.ts:67`), whose JSDoc says everything under the root 'takes what it needs as an argument'. So this service takes `stateDir` as its first argument, exactly as `snapshotLaunches(stateDir, …)` does, and it reads no environment variable, names no home directory and declares no root. Launch directory = `path.join(stateDir, launchId)`. Session id = `result.json`'s `session_id` when it is a string matching `/^[0-9a-f-]{36}$/`; else the first 65536 bytes of `child.log`, first match of `/\"session_id\":\"([0-9a-f-]{36})\"/`. Then `readClaudeTranscriptBySessionId(sessionId)` from `@/modules/providers/index.js`. Any miss or throw returns its own `Object.freeze`d not-found literal `{ found: false, activity: [], total: 0, inFlight: false, finishedAt: null }`; it never throws. No knowledge of the Claude transcript layout: the words `projects` and `readdir` appear nowhere in the file, comments included."
check = '''F=server/modules/dispatch-souls/soul-transcript.service.ts; grep -c "export async function readSoulTranscript(stateDir: string, launchId: string)\|readClaudeTranscriptBySessionId(\|from '@/modules/providers/index.js'" $F; { grep -c "projects\|readdir" $F || true; }; { grep -c "process.env\|homedir\|DEFAULT_STATE_DIR\|state/dispatch-souls\|soul-launch.transport" $F || true; }'''
expect = "3\n0\n0"

[[steps]]
kind = "edit"
path = "server/modules/dispatch-souls/dispatch-souls.routes.ts"
what = "Add GET /launches/:launchId/transcript per Interfaces: launchId regex and '..' refusal -> `response.status(400).json({ error: 'Invalid launchId.' })`, else response.json(await dependencies.transcript(launchId)); `DispatchSoulsRouterDependencies` gains `transcript: (launchId: string) => Promise<SubagentTranscriptResult>` with a one-line doc comment like its `current` sibling, and `SubagentTranscriptResult` joins the existing `import type` from `@/shared/types.js`. The file's header JSDoc calls `/launches` 'the dispatch-souls lane's one route' and says 'no path from the request is ever named'; both become false with this route, so rewrite that JSDoc to describe both routes: `/launches` as the seed read, and `/launches/:launchId/transcript` as the read whose request id is validated here before the service joins it under the module's fixed state directory. Still true and kept: no file is read in this file and no process is started here. No file I/O in the route file."
check = '''grep -c "/launches/:launchId/transcript" server/modules/dispatch-souls/dispatch-souls.routes.ts'''
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/dispatch-souls/dispatch-souls.module.ts"
what = "In `createDispatchSoulsModule`'s return (line ~107), change `createDispatchSoulsRouter({ current: () => lane.current() })` so the dependencies object also carries `transcript: (launchId) => readSoulTranscript(stateDir, launchId)`, using the `stateDir` already resolved at line ~67. This corrects the Interfaces dispatch-souls.module.ts bullet's `transcript: readSoulTranscript`: the service takes the root as an argument (step 11). Import it beside the file's existing same-module imports (lines 10-11 use `./….js`) as exactly `import { readSoulTranscript } from './soul-transcript.service.js';`. Rewrite the `createDispatchSoulsModule` JSDoc phrase 'the poll, the frame and the seed route behind it' to also name the transcript route. Do NOT export `DEFAULT_STATE_DIR` or `expandHome`, and do not change `stateDir`'s resolution."
check = '''F=server/modules/dispatch-souls/dispatch-souls.module.ts; grep -c 'transcript: (launchId) => readSoulTranscript(stateDir, launchId)' $F; grep -c "^import { readSoulTranscript } from './soul-transcript.service.js';$" $F; { grep -c '^export const DEFAULT_STATE_DIR\|^export function expandHome' $F || true; }; grep -c "^  const stateDir = expandHome(process.env.DISPATCH_SOULS_STATE_DIR || DEFAULT_STATE_DIR);$" $F'''
expect = "1\n1\n0\n1"

[[steps]]
kind = "edit"
path = "src/shared/types.ts"
what = "Mirror SubagentTranscriptResult exactly (SUBAGENT TRANSCRIPTS group), then append the CHAT SUBAGENT WIDGET group with ChatSubagentSource and SubagentTranscriptTarget, each commented, per Interfaces."
check = '''grep -c 'export type SubagentTranscriptResult\|export type ChatSubagentSource\|export type SubagentTranscriptTarget' src/shared/types.ts; { grep -c 'ChatSubagentFeed' src/shared/types.ts || true; }'''
expect = "3\n0"

[[steps]]
kind = "edit"
path = "src/shared/api.ts"
what = "Add the subagentTranscripts member per Interfaces: agent and soul both resolve to a bare SubagentTranscriptResult; agent unwraps the createApiSuccessResponse envelope inside the member; soul returns the raw body. Attempt 1 ALREADY LANDED this member (line ~640). It found `get` at `src/shared/api.ts:157` is `authenticatedFetch` returning a bare `Response`, which is neither case the Interfaces bullet names. So the member completes the read with `readApiJson` (line 149), returning `.data` for agent and the parsed body for soul. That is correct: run the check, confirm by reading the member that agent returns `.data` and soul returns the body, and leave it when both hold."
check = '''grep -c 'subagentTranscripts\|/subagents/\|/transcript\|SubagentTranscriptResult' src/shared/api.ts | sed 's/^[4-9]$/ok/;s/^[1-9][0-9]$/ok/' '''
expect = "ok"

[[steps]]
kind = "edit"
path = "docs/dispatch-souls.md"
what = "In the launch-directory file table (lines ~94-99) add a row for child.log: 'the transcript read only: its first session_id, when result.json has none yet, is handed to the providers module (readClaudeTranscriptBySessionId), which GET /api/dispatch-souls/launches/:launchId/transcript serves to the chat's Subagents widget'. Add the session_id use to the result.json row."
check = '''grep -c 'launches/:launchId/transcript' docs/dispatch-souls.md | sed 's/^[1-9][0-9]*$/ok/' '''
expect = "ok"

[[steps]]
kind = "run"
cmd = "npm run typecheck"
check = '''npm run typecheck >/dev/null 2>&1; echo exit=$?'''
expect = "exit=0"
timeout_s = 300

[[steps]]
kind = "run"
cmd = '''python3 - <<'PYEOF'
import json, os, sqlite3
base = "/home/lyphe/.claude/state/dispatch-souls"
sid = None
for name in sorted(os.listdir(base), reverse=True):
    rp = os.path.join(base, name, "result.json")
    if name.startswith("dispatch-") and os.path.exists(rp):
        try:
            sid = json.load(open(rp)).get("session_id")
        except Exception:
            sid = None
        if sid:
            break
db = sqlite3.connect("file:/home/lyphe/.cloudcli/auth.db?mode=ro", uri=True)
r = db.execute("select jsonl_path from sessions where provider_session_id=?", (sid,)).fetchone()
print(("row" if r and r[0] else "scan"), sid)
PYEOF'''
check = '''python3 - <<'PYEOF'
import json, os, sqlite3
base = "/home/lyphe/.claude/state/dispatch-souls"
sid = None
for name in sorted(os.listdir(base), reverse=True):
    rp = os.path.join(base, name, "result.json")
    if name.startswith("dispatch-") and os.path.exists(rp):
        try:
            sid = json.load(open(rp)).get("session_id")
        except Exception:
            sid = None
        if sid:
            break
db = sqlite3.connect("file:/home/lyphe/.cloudcli/auth.db?mode=ro", uri=True)
r = db.execute("select jsonl_path from sessions where provider_session_id=?", (sid,)).fetchone()
print(("row" if r and r[0] else "scan"), sid)
PYEOF'''
expect_re = "^(row|scan) [0-9a-f-]{36}$"

[[verify]]
cmd = '''sleep 8; T=$(curl -s -X POST http://127.0.0.1:3011/api/auth/login -H 'Content-Type: application/json' -d '{"username":"verve","password":"verve-dev-2026"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])'); python3 - "$T" <<'PYEOF'
import glob, json, sys, urllib.request, urllib.error
tok = sys.argv[1]
root = "/home/lyphe/.claude/projects/-home-lyphe--claude-claudecodeui-lyphe"
pairs = [("04cc9797-3f67-4586-a6ce-04576cb11be8", "caad59e6-761d-4c77-af32-d0b4c45d1db8"), ("411574bc-0a24-45ca-81a0-c2926eb299d6", "1546a928-83e0-4d0c-a527-6f0f2bb7ddf1")]
def get(p):
    req = urllib.request.Request("http://127.0.0.1:3011" + p, headers={"Authorization": "Bearer " + tok})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, None
app = tu = None
for a, prov in pairs:
    for m in sorted(glob.glob("%s/%s/subagents/*.meta.json" % (root, prov))):
        v = json.load(open(m)).get("toolUseId")
        if v:
            app, tu = a, v
            break
    if tu:
        break
ok = tu is not None
s, j = get("/api/providers/sessions/%s/subagents/%s/transcript" % (app, tu))
r = (j or {}).get("data", j or {})
ok = ok and s == 200 and r.get("found") is True and len(r.get("activity", [])) > 0 and r.get("total", 0) >= len(r["activity"]) and len(r["activity"]) <= 1000
s2, j2 = get("/api/providers/sessions/%s/subagents/toolu_doesnotexist0/transcript" % app)
r2 = (j2 or {}).get("data", j2 or {})
ok = ok and s2 == 200 and r2.get("found") is False and r2.get("activity") == []
s3, _ = get("/api/providers/sessions/%s/subagents/bad.id%%2F..%%2Fx/transcript" % app)
ok = ok and s3 == 400
print(ok)
PYEOF'''
expect = "True"
timeout_s = 120

[[verify]]
cmd = '''T=$(curl -s -X POST http://127.0.0.1:3011/api/auth/login -H 'Content-Type: application/json' -d '{"username":"verve","password":"verve-dev-2026"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])'); python3 - "$T" <<'PYEOF'
import json, os, sys, urllib.request, urllib.error
tok = sys.argv[1]
def get(p):
    req = urllib.request.Request("http://127.0.0.1:3011" + p, headers={"Authorization": "Bearer " + tok})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, None
base = "/home/lyphe/.claude/state/dispatch-souls"
launch = None
for name in sorted(os.listdir(base), reverse=True):
    rp = os.path.join(base, name, "result.json")
    if name.startswith("dispatch-") and os.path.exists(rp):
        try:
            if json.load(open(rp)).get("session_id"):
                launch = name
                break
        except Exception:
            pass
s, r = get("/api/dispatch-souls/launches/%s/transcript" % launch)
ok = launch is not None and s == 200 and r["found"] is True and len(r["activity"]) > 0
s2, r2 = get("/api/dispatch-souls/launches/dispatch-nope-00000000/transcript")
ok = ok and s2 == 200 and r2["found"] is False
s3, _ = get("/api/dispatch-souls/launches/..%2F..%2Fetc/transcript")
ok = ok and s3 == 400
print(ok)
PYEOF'''
expect = "True"
timeout_s = 120
```

**What to build.** Two server reads, their contracts, and the comment rewrites they make necessary.

Make the twelve `server/` edits in ONE consecutive pass, in this order:
1. `server/shared/types.ts`
2. `claude-sessions.provider.ts`
3. `claude-session-synchronizer.provider.ts`
4. `claude-runtime.provider.js`
5. `session-agents.service.ts`
6. `session-soul-launches.service.ts`
7. `claude-transcript-activity.ts`
8. `subagent-transcript.service.ts`
9. `provider.routes.ts`
10. `providers/index.ts`
11. `soul-transcript.service.ts`
12. `dispatch-souls.routes.ts` and `dispatch-souls.module.ts`

After the pass come the client types, the api, the doc, the typecheck and the DB lookup step.

**Already in the tree from attempt 1** (run `desktop-subagent-widget-plan-20260915-010332-cb92`, 2026-09-15): steps 1, 2, 4, 5, 6, 14, 15 and 16 landed, and their checks pass today. The remaining work is steps 3 and 7-13 plus the typecheck. In the single server pass, open files 1, 2, 4, 5 and 6 only to confirm their checks; do not re-save them, because every save restarts the API. Then write 3 and 7-12 in order.

**The DB lookup step is a measurement, not a gate on either answer.** Nobody has checked whether a soul's Claude session gets a CloudCLI `sessions` row. The step prints `row <id>` when it does and `scan <id>` when it does not. Both are correct, because `readClaudeTranscriptBySessionId` handles both. Quote the printed line in your report as "soul lookup path: …".

**Facts the routes rest on** (measured 2026-09-14 by scout):
- **Agent transcripts.** Every Agent-tool subagent in the current layout has a `<projectDir>/<providerSessionId>/subagents/agent-<agentId>.meta.json` whose `toolUseId` is the parent's `tool_use` id. Example: `{"agentType":"odysseus",…,"toolUseId":"toolu_01LZft6owVLyyBzACk2ifcwf",…}`.
  - That is the id the chat already holds for the row: `PinnedSubagents.tsx:137`, `message.toolId`.
  - The file exists while the subagent is still running, before any `toolUseResult.agentId` lands.
- **Soul transcripts.** A soul launch's `child.log` is `claude -p` stream-json whose first line carries `"session_id":"<uuid>"`.
  - The matching Claude transcript exists under `~/.claude/projects/<encoded cwd>/<uuid>.jsonl`, even for DeepSeek-provider souls.
  - `result.json` carries the same `session_id` once the soul ends.
- **The reader.** `readClaudeSubagentTranscript` (`claude-sessions.provider.ts:152`) streams any Claude transcript JSONL into `SubagentActivity[]`.

**Patterns to copy.**
- The route shape: `GET /sessions/:sessionId/messages` at `provider.routes.ts:840-853`.
- The soul route's response style: its `/launches` sibling at `dispatch-souls.routes.ts:24`.
- The session lookup: `sessions.service.ts:471-521`.

**Sirens.**
- **The 200-entry cap.** You will see `MAX_TRANSMITTED_SUBAGENT_ACTIVITIES = 200` and its head slice at `claude-sessions.provider.ts:613`. Do not touch it; that is the history path.
- **Agent-id lookup.** You will see `findClaudeSubagentTranscript`, which looks up by agent id, and want to reuse it. Do not: a running agent's id is not known to the client.
- **Scanning in the soul service.** You will want `soul-transcript.service.ts` to scan `~/.claude/projects` itself. Do not. The transcript layout's one home is the providers module (`claude-session-synchronizer.provider.ts:33-35`). That anchor is JSDoc prose; the root's declaration is the `CLAUDE_PROJECTS_ROOT` export step 3 adds to the same file.
- **Pushing subagent growth.** You will see `sessions-watcher.service.ts` ignoring `**/subagents/**` and want to add a push for subagent growth. Do not.
- **Missing reader names.** If `readClaudeSubagentTranscript` does not return `inFlight`, `truncateSubagentActivity` does not exist under that name, or `sessionsDb.getSessionByProviderSessionId` does not exist, report the lines verbatim with `RESULT: BLOCKED`.
- **Launch root.** If `soul-launch.transport.ts` exposes no launch-root constant and builds the path inline, add `export` to the existing declaration and nothing more. If no such declaration exists, report it with `RESULT: BLOCKED`. Measured by attempt 1: the transport takes the root as a parameter, and the one declaration is `dispatch-souls.module.ts:22`/`:67`, which is module-private. The decided cure is steps 11 and 13, where the composition root passes `stateDir` into `readSoulTranscript`. That is not this BLOCK case, and `soul-launch.transport.ts` is not touched.
- **Comments already true.** In a comment-only file, the line may no longer describe the strip. Another session may have already rewritten it. If so, report the line verbatim with `RESULT: BLOCKED`. Do not invent a comment to satisfy the check. Exception: a comment naming the gutter's `Subagents widget` in `claude-runtime.provider.js`, `session-agents.service.ts` or `session-soul-launches.service.ts` is attempt 1's landed step 4, 5 or 6. That is this plan's own work, not another session's, so confirm its check and move on.
- **Attempt 1's edits look foreign.** You will find `SubagentTranscriptResult` in both `types.ts` files, `ChatSubagentSource`/`SubagentTranscriptTarget`, `api.subagentTranscripts`, the `child.log` doc row, the two `export` keywords and the reader's rewritten JSDoc already present. Do not rewrite, re-add or revert them, and do not BLOCK on them. Confirm each check and continue.
- **Exporting the launch root.** You will want to export `DEFAULT_STATE_DIR` or `expandHome` from `dispatch-souls.module.ts` and resolve the root inside the service. Do not: that creates an import cycle (the module imports the service) and a second place that reads the environment. Pass `stateDir` in (steps 11 and 13).
- **Soul route auth.** If `/api/dispatch-souls` is mounted without `authenticateToken` in `server/index.ts`, report the mount line verbatim with `RESULT: BLOCKED`. `server/index.ts` is forbidden.

## Phase 2 — Chat module: the session source, the claim, one dismissal store, the row hook
Depends on: Phase 1

```toml
[phase]
id = "2"
builder = "iris"
model = "opus"
code_change = true
doc_sweep = "foreground"
manifest = [
  "src/modules/chat/utils/pinnedDismissals.ts",
  "src/modules/chat/subagents/subagentSource.ts",
  "src/modules/chat/hooks/usePinnedSubagentRows.ts",
  "src/modules/chat/transcript/PinnedSubagents.tsx",
  "src/modules/chat/ChatInterface.tsx",
]
forbidden = ["src/modules/chat/composer/ChatComposer.tsx", "src/modules/chat/hooks/useChatSessionState.ts", "src/modules/chat/hooks/useSessionStore.ts", "src/modules/chat-gutters"]
athena = [
  "The row derivation is not a pure move apart from dismissals: ordering, the FINISHED_SHOWN_FOR_MS / RUNNING_BELIEVED_FOR_MS windows or the now-tick changed, so the strip shows different rows than before",
  "Dismissing a row in the widget body leaves the gutter tab count unchanged (a second dismissal copy survives: a private useState seeded from readDismissed anywhere)",
  "useSubagentSource returns a source whose sessionId differs from the argument (or the last source when sessionId is null), leaking another chat's subagents",
  "ChatInterface never publishes null on unmount or when selectedSession is null, so a stale source survives a session close",
  "useSyncExternalStore getSnapshot returns a fresh object/array per call in either store, causing a render loop or the 'getSnapshot should be cached' console error",
  "The claim counter can go negative or stick above zero (effect cleanup missing when active flips false), hiding the strip forever",
  "pinnedAgents is passed as a new element even when claimed, or ChatComposer was edited instead of ChatInterface",
  "A pre-existing lint warning was made to vanish instead of carried: an oxlint-disable / eslint-disable comment added in any manifest file, or the moved Date.now render clock rewritten (useState, useRef or an effect) so react(purity) no longer fires and the rows' time windows shift",
  "A NEW lint warning names a manifest file and hides behind the carried ones: a second react(purity) in usePinnedSubagentRows.ts, a preserve-manual-memoization in ChatInterface.tsx that names something other than selectProviderModel / selectProviderEffort, or any warning in pinnedDismissals.ts, subagentSource.ts or PinnedSubagents.tsx",
]

[[steps]]
kind = "edit"
path = "src/modules/chat/utils/pinnedDismissals.ts"
what = "Per Interfaces: turn the dismissal list into a module-scope shared store — lazy snapshot from the existing read, useDismissedPins() via useSyncExternalStore with a stable snapshot, dismissPin(id) writing through the existing write then replacing the snapshot and notifying; readDismissed/writeDismissed lose export once no other src/ file imports them."
check = '''grep -c 'export function useDismissedPins\|export function dismissPin\|useSyncExternalStore' src/modules/chat/utils/pinnedDismissals.ts | sed 's/^[3-9]$/ok/' '''
expect = "ok"

[[steps]]
kind = "edit"
path = "src/modules/chat/subagents/subagentSource.ts"
what = "Create the external store per Interfaces: publishSubagentSource, useSubagentSource (session-id gated), useClaimSubagentStrip, useSubagentStripClaimed; module-scope source + claims counter + one listeners Set; snapshots are the stored values themselves (stable identity)."
check = '''grep -c 'export function publishSubagentSource\|export function useSubagentSource\|export function useClaimSubagentStrip\|export function useSubagentStripClaimed\|useSyncExternalStore' src/modules/chat/subagents/subagentSource.ts | sed 's/^[5-9]$/ok/;s/^[1-9][0-9]$/ok/' '''
expect = "ok"

[[steps]]
kind = "edit"
path = "src/modules/chat/hooks/usePinnedSubagentRows.ts"
what = "Pure move per Interfaces: the row derivation from PinnedSubagents.tsx (soul map read, agent entries, time windows, now tick, ordering, constants) into usePinnedSubagentRows(messages, soulLaunchIds) returning { rows, dismiss }; dismissals read from useDismissedPins() and dismiss = dismissPin, with no private useState(readDismissed); export the row element type as PinnedSubagentRow."
check = '''grep -c 'export function usePinnedSubagentRows\|export type PinnedSubagentRow\|useDismissedPins()' src/modules/chat/hooks/usePinnedSubagentRows.ts; { grep -c 'readDismissed' src/modules/chat/hooks/usePinnedSubagentRows.ts || true; }'''
expect = "3\n0"

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/PinnedSubagents.tsx"
what = "Replace the moved derivation with const { rows, dismiss } = usePinnedSubagentRows(messages, soulLaunchIds); render exactly as before; drop the readDismissed/writeDismissed import; add data-testid=\"pinned-subagents-strip\" to the root. Rewrite the docblock sentence at lines ~36-38 that says the strip sits above the chat box to: it sits above the chat box whenever the desktop chat gutters are not showing; while they show, the same rows live in the gutter's Subagents widget and this strip is not drawn. Delete the old wording outright."
check = '''grep -c 'usePinnedSubagentRows(messages, soulLaunchIds)\|data-testid="pinned-subagents-strip"' src/modules/chat/transcript/PinnedSubagents.tsx; { grep -c 'FINISHED_SHOWN_FOR_MS = \|readDismissed\|writeDismissed' src/modules/chat/transcript/PinnedSubagents.tsx || true; }'''
expect = "2\n0"

[[steps]]
kind = "edit"
path = "src/modules/chat/ChatInterface.tsx"
what = "Import publishSubagentSource and useSubagentStripClaimed from '@/modules/chat/subagents/subagentSource'. Add one effect publishing { sessionId: selectedSession.id, agentMessages, soulLaunchIds } when selectedSession?.id is a string, else null, deps [selectedSession?.id, agentMessages, soulLaunchIds], with a cleanup that publishes null. Add const stripClaimed = useSubagentStripClaimed(); (with the why-comment) and pass pinnedAgents={stripClaimed ? null : <PinnedSubagents … />} at line ~595. At most 15 added lines."
check = '''grep -c 'publishSubagentSource(\|useSubagentStripClaimed()\|stripClaimed ? null' src/modules/chat/ChatInterface.tsx | sed 's/^[3-9]$/ok/' '''
expect = "ok"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint"
what = "Run both; the check reads the oxlint output line by line (format `path:line:col: warning rule(name): message`). Three warnings naming manifest files were there before this phase and are CARRIED, never fixed or suppressed: (a) two react(preserve-manual-memoization) in ChatInterface.tsx on the pre-existing selectProviderModel / selectProviderEffort callbacks (pre-edit lines ~417/~425, ~432/~440 after the +15); (b) one react(purity) for Date.now during render, which lived in PinnedSubagents.tsx (~line 74 of the derivation) and moves with the pure move into usePinnedSubagentRows.ts. The check prints tc, lint, then the count of every OTHER warning line naming one of the five manifest files (must be 0), then ok when usePinnedSubagentRows.ts holds at most one react(purity) warning. The Project Constraints line 'no warning naming a file this plan creates or edits' is read as no warning this plan INTRODUCES; the carried three are not this plan's."
check = '''npm run typecheck >/dev/null 2>&1; echo tc=$?; npm run lint > /tmp/dsaw-lint-2.txt 2>&1; echo lint=$?; { grep 'src/modules/chat/utils/pinnedDismissals\.ts:\|src/modules/chat/subagents/subagentSource\.ts:\|src/modules/chat/hooks/usePinnedSubagentRows\.ts:\|src/modules/chat/transcript/PinnedSubagents\.tsx:\|src/modules/chat/ChatInterface\.tsx:' /tmp/dsaw-lint-2.txt || true; } | { grep -v 'ChatInterface\.tsx:[0-9]*:[0-9]*: warning react(preserve-manual-memoization):.*selectProvider\(Model\|Effort\)' || true; } | { grep -v 'usePinnedSubagentRows\.ts:[0-9]*:[0-9]*: warning react(purity):.*Date\.now' || true; } | wc -l; { grep -c 'src/modules/chat/hooks/usePinnedSubagentRows\.ts:[0-9]*:[0-9]*: warning react(purity):' /tmp/dsaw-lint-2.txt || true; } | sed 's/^[01]$/ok/''''
expect = "tc=0\nlint=0\n0\nok"
timeout_s = 400

[[verify]]
cmd = '''for f in src/modules/chat/utils/pinnedDismissals.ts src/modules/chat/subagents/subagentSource.ts src/modules/chat/hooks/usePinnedSubagentRows.ts src/modules/chat/transcript/PinnedSubagents.tsx src/modules/chat/ChatInterface.tsx; do curl -s -o /dev/null -w '%{http_code} ' "http://127.0.0.1:5183/$f"; done'''
expect = "200 200 200 200 200"

[[verify]]
cmd = '''{ grep -n "from '\.\./\|from '\./\|interface " src/modules/chat/subagents/subagentSource.ts src/modules/chat/hooks/usePinnedSubagentRows.ts src/modules/chat/utils/pinnedDismissals.ts || true; } | wc -l; { grep -rln 'useState(readDismissed\|useState(() => readDismissed' src || true; } | wc -l; wc -l src/modules/chat/transcript/PinnedSubagents.tsx | awk '{print ($1 < 245) ? "shrunk" : "not-shrunk"}' '''
expect = "0\n0\nshrunk"
```

**What to build.** The plumbing that lets a component OUTSIDE `ChatInterface` see exactly this chat's subagent rows, plus one dismissal store that every copy of the rows shares.

**Why the rows need a way out.** Today `useSessionStore` is a per-caller `useRef` Map created once at `ChatInterface.tsx:99`, unreachable from outside. `agentMessages` and `soulLaunchIds` are computed at `useChatSessionState.ts:455-501` and passed straight to `<PinnedSubagents>` at `ChatInterface.tsx:595`. So `ChatInterface` publishes them into a module-scope store, tagged with the chat's app session id. Readers ask for a session id and get `null` for any other. The claim counter is how the gutter (Phase 4) tells the chat "the strip lives in me now" without the chat importing the gutter module.

**Why dismissals become one store.** While the gutters show, the row hook runs twice: in `ChatGutterLayout` (tab count) and in `SubagentWidgetBody` (list). Today's private `useState(readDismissed)` (`PinnedSubagents.tsx:121`) would give each copy its own seed, so a dismissal in the list would leave the tab count stale. One module store fixes it: every copy reads the same snapshot.

**Why this is session-exact.** The scout traced the strip's scoping and found no leak:
- `useChatSessionState.ts:435,454,493` reads the store keyed by session;
- `PinnedSubagents.tsx:173-179` looks up soul launches only by this chat's ids;
- `soulLaunchAnchors.ts:71-89` is the ownership test.

The published source carries those already-scoped arrays and adds one more gate, `source.sessionId === sessionId`. The publish uses `selectedSession.id`, the same value the gutter receives as `sessionId`.

**Patterns to copy.**
- Both stores follow `src/shared/hooks/useCliVersion.ts:22-133`: a module `let`, a `listeners` Set, `subscribe` and `getSnapshot`. Drop its polling.
- The hook move is lines `PinnedSubagents.tsx:120-218`, byte-for-byte except the dismissal read.

**Sirens.**
- **The published session id.** You will want to publish `activeSessionId` from `useChatSessionState`. Do not: it falls back to `currentSessionId` (`useChatSessionState.ts:341`). Publish `selectedSession?.id`. If `ChatInterface` has no `selectedSession` in scope, report the props block verbatim with `RESULT: BLOCKED`.
- **A context instead of a store.** You will want to lift `useSessionStore` into a context. Do not.
- **The live bus.** You will want to publish the rows on the live bus (`docs/architecture/07-live-widgets.md`) instead of a store of your own. Do not. The bus topic allowlist is the exfiltration control. Its publish compare would run over `ChatMessage[]` on every streamed token (Decisions).
- **Per-session dismissals.** You will see the dismissal key is one list for every conversation. That is correct, because ids are unique tool use and launch ids. Do not key it per session.
- **Hiding the strip in the composer.** You will want to edit `ChatComposer.tsx` to hide `{pinnedAgents}`. It is forbidden.
- **The chat barrel.** Do not export anything new from `src/modules/chat/index.ts` in this phase. Phase 4 adds those exports.
- **The carried lint warnings.** You will see oxlint name `ChatInterface.tsx` twice (react(preserve-manual-memoization) on `selectProviderModel` / `selectProviderEffort`) and `usePinnedSubagentRows.ts` once (react(purity), `Date.now` during render). All three predate this phase; the purity one moved with the derivation. Do not add a disable comment. Do not rewrite the render clock into state, a ref or an effect: that breaks the pure move. Leave them; step 6's check already excludes exactly these three. Any other warning naming a manifest file is yours: fix it in your own code.
- **The sibling purity warning.** You will see the same `Date.now` react(purity) warning in `src/modules/chat/composer/ScheduleMessagePopover.tsx`. It is not in this phase's manifest and not this phase's work. Do not open or edit it.
- **A tree that already holds the work.** A prior attempt landed steps 1-5 (`pinnedDismissals.ts` store, `subagentSource.ts` 94 LOC, `usePinnedSubagentRows.ts` 205 LOC, `PinnedSubagents.tsx` 91 LOC, `ChatInterface.tsx` +15). You will want to redo or revert them. Do not. Run each step's `check`; when it prints its `expect`, read the code against the step's `what` and the Interfaces, correct only what disagrees, and move on. Never exceed `ChatInterface.tsx`'s +15 lines by re-adding what is already there.

## Phase 3 — The Subagents widget body: clickable rows and the live transcript view
Depends on: Phase 1, Phase 2

```toml
[phase]
id = "3"
builder = "iris"
model = "opus"
code_change = true
doc_sweep = "foreground"
manifest = [
  "src/modules/chat/tools/SubagentNote.tsx",
  "src/modules/chat/tools/SubagentPanel.tsx",
  "src/modules/chat/transcript/PinnedAgentRow.tsx",
  "src/modules/chat/transcript/SoulLaunchPinRow.tsx",
  "src/modules/chat/hooks/useSubagentWidgetRows.ts",
  "src/modules/chat/hooks/useSubagentTranscript.ts",
  "src/modules/chat/subagents/SubagentTranscriptView.tsx",
  "src/modules/chat/subagents/SubagentWidgetBody.tsx",
  "src/modules/i18n/locales",
]
forbidden = ["src/modules/chat/subagents/subagentSource.ts", "src/modules/chat/hooks/usePinnedSubagentRows.ts", "src/modules/chat/utils/pinnedDismissals.ts", "src/modules/chat/ChatInterface.tsx", "src/modules/chat-gutters", "src/shared/ui", "src/shared/api.ts"]
athena = [
  "Polling never stops: a finished subagent (running false, inFlight false) is still re-read every 2 s, or a closed view leaves its timer alive",
  "An older slower response overwrites a newer one (no request token), so the transcript jumps backwards while live",
  "Clicking the dismiss X also opens the transcript (no stopPropagation), or the row is not keyboard-openable",
  "Rows passed to the widget are not the strip's rows (re-derived or filtered differently), so the widget and the strip disagree for the same chat",
  "SubagentNote's move changed SubagentPanel's rendering (not a pure move)",
  "useSubagentTranscript unwraps an envelope itself (the api member already returns the bare result), double-unwrapping to undefined",
  "A gutters.subagents key is missing or empty in a locale, or openRow lost its {{name}} placeholder",
  "The transcript view renders all 1000 entries at once instead of the last 100 with a show-earlier step",
]

[[steps]]
kind = "edit"
path = "src/modules/chat/tools/SubagentNote.tsx"
what = "Pure move per Interfaces: SubagentNote (memoized, SubagentPanel.tsx:72-90) into its own file as export const SubagentNote with a consumer comment naming SubagentPanel and SubagentTranscriptView."
check = '''grep -c 'export const SubagentNote' src/modules/chat/tools/SubagentNote.tsx'''
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/chat/tools/SubagentPanel.tsx"
what = "Delete the local SubagentNote and import it from '@/modules/chat/tools/SubagentNote'. No other change."
check = '''{ grep -c 'const SubagentNote = \|function SubagentNote' src/modules/chat/tools/SubagentPanel.tsx || true; }; grep -c "from '@/modules/chat/tools/SubagentNote'" src/modules/chat/tools/SubagentPanel.tsx'''
expect = "0\n1"

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/PinnedAgentRow.tsx"
what = "Per Interfaces: optional onOpen and openLabel props; when onOpen is present the root gets role=button, tabIndex 0, onClick, Enter/Space onKeyDown, aria-label={openLabel}, cursor-pointer; the dismiss button gains data-testid=\"pinned-row-dismiss\" and calls event.stopPropagation() before onDismiss. Rewrite the 'its only consumer' comment at line ~7 to name PinnedSubagents and SubagentWidgetBody."
check = '''grep -c 'onOpen' src/modules/chat/transcript/PinnedAgentRow.tsx | sed 's/^[3-9]$/ok/;s/^[1-9][0-9]$/ok/'; grep -c 'stopPropagation\|data-testid="pinned-row-dismiss"' src/modules/chat/transcript/PinnedAgentRow.tsx; { grep -c 'only consumer' src/modules/chat/transcript/PinnedAgentRow.tsx || true; }; grep -c 'SubagentWidgetBody' src/modules/chat/transcript/PinnedAgentRow.tsx | sed 's/^[1-9][0-9]*$/ok/' '''
expect = "ok\n2\n0\nok"

[[steps]]
kind = "edit"
path = "src/modules/chat/transcript/SoulLaunchPinRow.tsx"
what = "Same as PinnedAgentRow: optional onOpen and openLabel with role=button, tabIndex 0, onClick, Enter/Space, aria-label, cursor-pointer; dismiss button data-testid=\"pinned-row-dismiss\" with stopPropagation. Rewrite the 'its only consumer' comment at line ~10 to name PinnedSubagents and SubagentWidgetBody."
check = '''grep -c 'onOpen' src/modules/chat/transcript/SoulLaunchPinRow.tsx | sed 's/^[3-9]$/ok/;s/^[1-9][0-9]$/ok/'; grep -c 'stopPropagation\|data-testid="pinned-row-dismiss"' src/modules/chat/transcript/SoulLaunchPinRow.tsx; { grep -c 'only consumer' src/modules/chat/transcript/SoulLaunchPinRow.tsx || true; }; grep -c 'SubagentWidgetBody' src/modules/chat/transcript/SoulLaunchPinRow.tsx | sed 's/^[1-9][0-9]*$/ok/' '''
expect = "ok\n2\n0\nok"

[[steps]]
kind = "edit"
path = "src/modules/chat/hooks/useSubagentWidgetRows.ts"
what = "Create useSubagentWidgetRows and useSubagentWidgetCount per Interfaces: useSubagentSource(sessionId) then usePinnedSubagentRows over the source's arrays, with module-level frozen empty arrays for a null source."
check = '''grep -c 'export function useSubagentWidgetRows\|export function useSubagentWidgetCount\|useSubagentSource(sessionId)\|usePinnedSubagentRows(' src/modules/chat/hooks/useSubagentWidgetRows.ts | sed 's/^[4-9]$/ok/' '''
expect = "ok"

[[steps]]
kind = "edit"
path = "src/modules/chat/hooks/useSubagentTranscript.ts"
what = "Create useSubagentTranscript per Interfaces: read on target change; setTimeout chain every TRANSCRIPT_POLL_MS = 2000 while running || result.inFlight; request token; cleared on unmount/target change; agent -> api.subagentTranscripts.agent, soul -> api.subagentTranscripts.soul, both consumed as the bare SubagentTranscriptResult with no unwrap; failed true on a thrown read (keep the last result)."
check = '''grep -c 'export function useSubagentTranscript\|TRANSCRIPT_POLL_MS = 2000\|api.subagentTranscripts.agent\|api.subagentTranscripts.soul\|clearTimeout' src/modules/chat/hooks/useSubagentTranscript.ts | sed 's/^[5-9]$/ok/;s/^[1-9][0-9]$/ok/'; { grep -c 'setInterval\|\.data\b' src/modules/chat/hooks/useSubagentTranscript.ts || true; }'''
expect = "ok\n0"

[[steps]]
kind = "edit"
path = "src/modules/chat/subagents/SubagentTranscriptView.tsx"
what = "Create SubagentTranscriptView per Interfaces and the build notes: header with Back button (subagent-transcript-back), label, Live badge while running or inFlight; body shows Spinner / notFound / failed / the last 100 activity entries via ToolRenderer (mode input) or SubagentNote, each in a subagent-transcript-entry wrapper, a show-earlier button, and stick-to-bottom on growth."
check = '''grep -c 'export function SubagentTranscriptView\|data-testid="subagent-transcript"\|data-testid="subagent-transcript-back"\|data-testid="subagent-transcript-entry"\|useSubagentTranscript(\|SubagentNote' src/modules/chat/subagents/SubagentTranscriptView.tsx | sed 's/^[6-9]$/ok/;s/^[1-9][0-9]$/ok/' '''
expect = "ok"

[[steps]]
kind = "edit"
path = "src/modules/chat/subagents/SubagentWidgetBody.tsx"
what = "Create SubagentWidgetBody per Interfaces and the build notes: list mode (subagent-widget-list of subagent-widget-row li, each rendering PinnedAgentRow or SoulLaunchPinRow exactly as PinnedSubagents does, plus onOpen/openLabel) or empty state (subagent-widget-empty); one state holding the open target with its label; transcript mode renders SubagentTranscriptView with onBack clearing it."
check = '''grep -c 'export function SubagentWidgetBody\|data-testid="subagent-widget-list"\|data-testid="subagent-widget-row"\|data-testid="subagent-widget-empty"\|useSubagentWidgetRows(sessionId)\|SubagentTranscriptView' src/modules/chat/subagents/SubagentWidgetBody.tsx | sed 's/^[6-9]$/ok/;s/^[1-9][0-9]$/ok/' '''
expect = "ok"

[[steps]]
kind = "edit"
path = "src/modules/i18n/locales/en/common.json"
what = "Add the gutters.subagents.* keys from Interfaces inside the existing top-level gutters object of en/common.json, then the same keys translated into de es fr it ja ko ru tr zh-CN zh-TW common.json; keep {{name}} verbatim in openRow."
check = '''python3 -c '
import json
L="de en es fr it ja ko ru tr zh-CN zh-TW".split()
K="title empty back loading notFound failed live showEarlier openRow".split()
ok=True
for l in L:
    s=json.load(open("src/modules/i18n/locales/%s/common.json" % l)).get("gutters",{}).get("subagents",{})
    ok = ok and all(isinstance(s.get(k),str) and s.get(k).strip() for k in K) and "{{name}}" in s.get("openRow","")
print(ok)' '''
expect = "True"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint"
check = '''npm run typecheck >/dev/null 2>&1; echo tc=$?; npm run lint > /tmp/dsaw-lint-3.txt 2>&1; echo lint=$?; { grep -c 'SubagentNote\|PinnedAgentRow\|SoulLaunchPinRow\|useSubagentWidgetRows\|useSubagentTranscript\|SubagentTranscriptView\|SubagentWidgetBody\|SubagentPanel' /tmp/dsaw-lint-3.txt || true; }'''
expect = "tc=0\nlint=0\n0"
timeout_s = 400

[[verify]]
cmd = '''for f in src/modules/chat/tools/SubagentNote.tsx src/modules/chat/hooks/useSubagentWidgetRows.ts src/modules/chat/hooks/useSubagentTranscript.ts src/modules/chat/subagents/SubagentTranscriptView.tsx src/modules/chat/subagents/SubagentWidgetBody.tsx; do curl -s -o /dev/null -w '%{http_code} ' "http://127.0.0.1:5183/$f"; done'''
expect = "200 200 200 200 200"

[[verify]]
cmd = '''{ grep -n "from '\.\./\|from '\./\|interface " src/modules/chat/tools/SubagentNote.tsx src/modules/chat/hooks/useSubagentWidgetRows.ts src/modules/chat/hooks/useSubagentTranscript.ts src/modules/chat/subagents/SubagentTranscriptView.tsx src/modules/chat/subagents/SubagentWidgetBody.tsx || true; } | wc -l; wc -l src/modules/chat/subagents/SubagentTranscriptView.tsx src/modules/chat/subagents/SubagentWidgetBody.tsx src/modules/chat/hooks/useSubagentTranscript.ts | awk '$2 != "total" && $1 > 250 {print "oversize " $2}' '''
expect = "0"
```

**What to build.** Everything the widget draws, inside the chat module that owns the data. Phase 4 imports three barrel symbols and nothing else.

`SubagentWidgetBody({ sessionId })`:
- `const { rows, dismiss } = useSubagentWidgetRows(sessionId);`
- One state, with its why-comment: `const [target, setTarget] = useState<(SubagentTranscriptTarget & { label: string }) | null>(null);`
- An effect keyed on `sessionId` resets `target` to `null`, so a transcript view never survives a chat switch.
- **Transcript mode** (`target !== null`):
  - Find the row with `target.id` in `rows`.
  - `running` is `summary.status === 'running'` for an agent row. For a soul row it is the soul's running state, copied from the condition `SoulLaunchPinRow` uses.
  - When the row is gone (aged out or dismissed), `running` is `false`.
  - Render `<SubagentTranscriptView sessionId={sessionId} target={target} label={target.label} running={running} onBack={() => setTarget(null)} />`.
- **List mode, zero rows:** `<div data-testid="subagent-widget-empty"><EmptyState icon={BotIcon} title={t('gutters.subagents.empty')} /></div>`.
- **List mode, otherwise:** `<ul data-testid="subagent-widget-list" className="flex min-w-0 flex-col gap-2">`.
  - Each row is `<li data-testid="subagent-widget-row" data-row-id={id} data-kind={kind} data-running={String(running)} className="min-w-0">`.
  - The `li` holds EXACTLY the element `PinnedSubagents.tsx` renders for that row kind (copy the JSX branch at `PinnedSubagents.tsx:222-239`, including `onDismiss={dismiss}`).
  - Pass that element `onOpen={() => setTarget({ kind, id, label })}` and `openLabel={t('gutters.subagents.openRow', { name: label })}`.
  - `label` is the agent row's `summary.label` (or `summary.description` when the label is empty), or the soul row's `launch.agent`.
- `const { t } = useTranslation();` (no namespace; `common` is the default).

`SubagentTranscriptView`:
- `const { result, failed } = useSubagentTranscript(sessionId, target, running);` The result is already bare.
- `const createDiff = useMemo(() => createCachedDiffCalculator(), []);`, imported from `@/modules/chat/utils/messageTransforms` (a pure factory, `messageTransforms.ts:125`).
- `live = running || result?.inFlight === true`.
- **Root:** `<div data-testid="subagent-transcript" data-kind={target.kind} data-row-id={target.id} data-live={String(live)} className="flex min-w-0 flex-col gap-3">`.
- **Header:** `<div className="flex min-w-0 items-center gap-2">` holding:
  - `<Button data-testid="subagent-transcript-back" size="icon" variant="ghost" onClick={onBack} aria-label={t('gutters.subagents.back')}><ArrowLeftIcon aria-hidden="true" /></Button>`
  - `<span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>`
  - `{live ? <Badge tone="info">{t('gutters.subagents.live')}</Badge> : null}`
- **Body, one branch:**
  - `result === null && !failed` → `<Spinner />` with a muted `text-xs` line reading `t('gutters.subagents.loading')`.
  - `result === null && failed` → `t('gutters.subagents.failed')`.
  - `result.found === false` → `t('gutters.subagents.notFound')`.
  - Otherwise, the timeline.
- **Timeline:**
  - One state with its why-comment: `shown`, initially 100.
  - Render `result.activity.slice(-shown)` inside `<div className="flex min-w-0 flex-col gap-2 border-l border-border/60 pl-2">`, each entry in `<div data-testid="subagent-transcript-entry" className="min-w-0">`.
  - A `kind === 'tool'` entry renders `<ToolRenderer toolName={entry.toolName || 'UnknownTool'} toolInput={entry.toolInput} toolResult={entry.toolResult} toolId={entry.toolId} mode="input" createDiff={createDiff} />`. Import `ToolRenderer` exactly as `SubagentPanel.tsx` imports it. Any other kind renders `<SubagentNote activity={entry} />`.
  - Key each entry with `entry.toolId ?? String(result.total - result.activity.length + index)`.
  - When `result.activity.length > shown`, show `<Button data-testid="subagent-transcript-earlier" variant="ghost" size="sm" onClick={() => setShown((n) => n + 100)}>{t('gutters.subagents.showEarlier')}</Button>` above the list.
- **Stick to bottom:**
  - A sentinel `<div ref={endRef} />` sits after the list.
  - An `IntersectionObserver` on the sentinel keeps a ref `atEnd`; it is a ref, not state.
  - An effect on `result?.activity.length` calls `endRef.current?.scrollIntoView({ block: 'end' })` when `atEnd.current` is true, and once on the first non-null result.

**Sirens.**
- **`SubagentPanel`.** You will want to render `SubagentPanel` itself in the view. Do not: it is a collapsible container with a head cap of 25, built for the transcript flow.
- **The container's own activity.** You will want to read `subagentActivity` from the source's container message instead of polling. Do not. The history path caps it at 200 from the head, and a soul row has none.
- **A button around each row.** You will want to wrap each row in a `<button>`. Do not: the rows contain their own dismiss button, and nested buttons are invalid HTML.
- **ToolRenderer props.** If `ToolRenderer` has a required `onFileOpen` or `selectedProject` prop, report its props type verbatim with `RESULT: BLOCKED`.
- **The api envelope.** `src/shared/api.ts` is forbidden here, and the transcript hook unwraps nothing. If `api.subagentTranscripts.agent` returns an envelope at runtime, that is Phase 1's defect: report it with `RESULT: BLOCKED`.
- **`src/shared/ui`.** It is forbidden. Compose from `Button`, `Badge`, `Spinner` and `EmptyState`.

## Phase 4 — The gutter: a third widget from one table, generalized placements, the claim, the docs
Depends on: Phase 2, Phase 3

```toml
[phase]
id = "4"
builder = "iris"
model = "opus"
code_change = true
doc_sweep = "foreground"
manifest = [
  "src/shared/types.ts",
  "src/modules/chat-gutters/hooks/useGutterPlacements.ts",
  "src/modules/chat-gutters/ChatGutterLayout.tsx",
  "src/modules/chat/index.ts",
  "docs/architecture/06-tool-view.md",
  "docs/architecture/README.md",
  "docs/dispatch-souls.md",
]
forbidden = ["src/modules/chat-gutters/GutterSlot.tsx", "src/modules/chat-gutters/GutterWidgetFrame.tsx", "src/modules/chat/ChatInterface.tsx", "src/modules/chat/composer/ChatComposer.tsx", "src/shared/ui"]
athena = [
  "An existing stored chatGutters preference holding only runner and memory is thrown away (reset to defaults) instead of keeping those two and adding subagents in a free slot",
  "Two widgets can end up in one slot after parse or after a move (the repair or the generic swap is wrong), so a widget vanishes",
  "useClaimSubagentStrip is called with something other than wide (e.g. enabled), so the strip disappears on a desktop region too narrow for gutters",
  "renderWidget still branches per widget (more than one GutterWidgetFrame element in ChatGutterLayout) instead of reading one table",
  "The geometry (grid columns, max-w, GUTTER_*/CHAT_COLUMN_PX/MIN_REGION_PX, slot grow rules) changed, stepping on the in-flight proportions work",
  "chat-gutters deep-imports '@/modules/chat/...' instead of the '@/modules/chat' barrel, or the chat module now imports chat-gutters (a cycle)",
  "A doc still says the pinned strip always sits above the chat box / composer",
]

[[steps]]
kind = "edit"
path = "src/shared/types.ts"
what = "GutterWidgetId becomes 'runner' | 'memory' | 'subagents'; update its comment to name the three widgets. No other change in the CHAT GUTTERS group."
check = '''grep -c "export type GutterWidgetId = 'runner' | 'memory' | 'subagents';" src/shared/types.ts'''
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/chat-gutters/hooks/useGutterPlacements.ts"
what = "Per Interfaces and the build notes: export GUTTER_WIDGET_ORDER; defaults gain subagents bottom-left open; parsePlacements repairs per widget in GUTTER_WIDGET_ORDER; withPlacement generic; moveWidget swaps with whichever widget holds the target slot; toggleWidget generic. Delete the two-widget literal branches."
check = '''grep -c "export const GUTTER_WIDGET_ORDER\|subagents: { slot: 'bottom-left', open: true }" src/modules/chat-gutters/hooks/useGutterPlacements.ts; { grep -c "widget === 'runner' ?" src/modules/chat-gutters/hooks/useGutterPlacements.ts || true; }'''
expect = "2\n0"

[[steps]]
kind = "edit"
path = "src/modules/chat/index.ts"
what = "Export SubagentWidgetBody (from '@/modules/chat/subagents/SubagentWidgetBody'), useSubagentWidgetCount (from '@/modules/chat/hooks/useSubagentWidgetRows') and useClaimSubagentStrip (from '@/modules/chat/subagents/subagentSource'), each with a consumer comment naming chat-gutters."
check = '''grep -c 'SubagentWidgetBody\|useSubagentWidgetCount\|useClaimSubagentStrip' src/modules/chat/index.ts'''
expect = "3"

[[steps]]
kind = "edit"
path = "src/modules/chat-gutters/ChatGutterLayout.tsx"
what = "Per Interfaces: widgetIn iterates GUTTER_WIDGET_ORDER; renderWidget reads one table Record<GutterWidgetId, { title, count, icon, Body }> (runner, memory, subagents) and returns ONE GutterWidgetFrame with <Boundary><Body sessionId={sessionId} /></Boundary>; call useClaimSubagentStrip(wide); import from '@/modules/chat'. Touch only those symbols; no class name, constant or grid."
check = '''grep -c "useClaimSubagentStrip(wide)\|useSubagentWidgetCount(sessionId)\|SubagentWidgetBody\|GUTTER_WIDGET_ORDER\|Record<GutterWidgetId" src/modules/chat-gutters/ChatGutterLayout.tsx | sed 's/^[5-9]$/ok/;s/^[1-9][0-9]$/ok/'; grep -c '<GutterWidgetFrame' src/modules/chat-gutters/ChatGutterLayout.tsx; { grep -c "from '@/modules/chat/" src/modules/chat-gutters/ChatGutterLayout.tsx || true; }'''
expect = "ok\n1\n0"

[[steps]]
kind = "edit"
path = "docs/architecture/06-tool-view.md"
what = "Rewrite lines ~459-460 ('The strip above the chat box (PinnedSubagents.tsx) keeps an agent in view…') and the 'If you touch' row at ~798 so they say: the pinned rows (usePinnedSubagentRows, dismissals in pinnedDismissals' one store) render in the strip above the chat box whenever the desktop chat gutters are not showing, and in the chat gutter's Subagents widget (SubagentWidgetBody) while they are — ChatInterface publishes this chat's rows to subagentSource keyed by the app session id and the gutter claims the strip. Add one paragraph after it: clicking a widget row opens SubagentTranscriptView, which polls GET /api/providers/sessions/:sessionId/subagents/:toolUseId/transcript (agent, located by the subagent's meta.json toolUseId) or GET /api/dispatch-souls/launches/:launchId/transcript (soul, through providers' readClaudeTranscriptBySessionId) every 2 s while the subagent runs. Delete the old wording outright."
check = '''grep -c 'SubagentWidgetBody' docs/architecture/06-tool-view.md | sed 's/^[1-9][0-9]*$/ok/'; grep -c 'subagents/:toolUseId/transcript' docs/architecture/06-tool-view.md | sed 's/^[1-9][0-9]*$/ok/' '''
expect = "ok\nok"

[[steps]]
kind = "edit"
path = "docs/architecture/README.md"
what = "Rewrite line ~93 ('in the strip above the composer') to the when-gutters-show rule: in the strip above the composer when the desktop chat gutters are not showing, and in the gutter's Subagents widget while they are. Delete the old wording outright."
check = '''grep -c 'Subagents widget' docs/architecture/README.md | sed 's/^[1-9][0-9]*$/ok/' '''
expect = "ok"

[[steps]]
kind = "edit"
path = "docs/dispatch-souls.md"
what = "Rewrite lines ~7-11 so the PIN is 'one row among the chat's pinned subagent rows — drawn in the strip above the composer when the desktop chat gutters are not showing, and in the gutter's Subagents widget while they are', keeping the rest of the paragraph; adjust line ~33 and the FINISHED_SHOWN_FOR_MS row (~179) to name usePinnedSubagentRows.ts as where the join and the constant now live. Delete the old wording outright."
check = '''grep -c 'Subagents widget' docs/dispatch-souls.md | sed 's/^[1-9][0-9]*$/ok/'; grep -c 'usePinnedSubagentRows' docs/dispatch-souls.md | sed 's/^[1-9][0-9]*$/ok/' '''
expect = "ok\nok"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint"
check = '''npm run typecheck >/dev/null 2>&1; echo tc=$?; npm run lint > /tmp/dsaw-lint-4.txt 2>&1; echo lint=$?; { grep -c 'chat-gutters\|src/modules/chat/index.ts' /tmp/dsaw-lint-4.txt || true; }'''
expect = "tc=0\nlint=0\n0"
timeout_s = 400

[[verify]]
cmd = '''for f in src/modules/chat-gutters/ChatGutterLayout.tsx src/modules/chat-gutters/hooks/useGutterPlacements.ts src/modules/chat/index.ts; do curl -s -o /dev/null -w '%{http_code} ' "http://127.0.0.1:5183/$f"; done'''
expect = "200 200 200"

[[verify]]
cmd = '''{ grep -rn "modules/chat-gutters" src/modules/chat || true; } | wc -l; { grep -rn "from '\.\./\|from '\./\|interface " src/modules/chat-gutters || true; } | wc -l'''
expect = "0\n0"
```

**What to build.** The Subagents widget joins the gutter as its third widget. Every place that assumes exactly two widgets becomes one ordered list plus one table. The scout found those assumptions in four places:
- `types.ts:2040`;
- `useGutterPlacements.ts:48-61,85-93,109-119`;
- `ChatGutterLayout.tsx:106-107,114-154`;
- the probe's `WIDGETS`.

`parsePlacements(raw)`, the exact rule:
1. Start with `taken = new Set<GutterSlotId>()` and `result = {}`.
2. For each `w` of `GUTTER_WIDGET_ORDER`:
   - `parsed = isRecord(raw) ? parsePlacement(raw[w]) : null`
   - `wanted = parsed ?? DEFAULT_PLACEMENTS[w]`
   - `slot` = `wanted.slot` if it is not taken; else `DEFAULT_PLACEMENTS[w].slot` if that is not taken; else the first entry of `SLOTS` not taken.
   - `result[w] = { slot, open: wanted.open }`, then `taken.add(slot)`.
3. Return `result`, keeping the existing identity memo exactly as it is.

A stored `{ runner: top-left, memory: top-right }` therefore parses to those two plus `subagents: bottom-left, open`.

`moveWidget(w, slot)`:
- `occupant = GUTTER_WIDGET_ORDER.find((o) => o !== w && current[o].slot === slot)`
- `next = { ...current, [w]: { ...current[w], slot } }`
- When an occupant exists, `next[occupant] = { ...current[occupant], slot: current[w].slot }`.
- Write `next`.

`toggleWidget(w)` flips `open` generically.

`ChatGutterLayout`:
- **Claim.** `useClaimSubagentStrip(wide)` sits right after the `wide` state.
- **Counts.** `subagentCount = useSubagentWidgetCount(sessionId)` sits beside `runnerCount` and `pendingCount`.
- **The table.** `const widgets: Record<GutterWidgetId, { title: string; count: number; icon: LucideIcon; Body: ComponentType<{ sessionId: string | null }> }>`, built each render from `t` and the three counts. Hooks stay at the top level; the table only reads their values.
- **`renderWidget(w)`.**
  - `const { title, count, icon, Body } = widgets[w];`
  - It returns ONE `<GutterWidgetFrame widget={w} title={title} count={count} icon={icon} open={placements[w].open} slot={slot} onToggle={() => toggleWidget(w)} onDragStart={setDragging} onDragEnd={() => setDragging(null)}><Boundary><Body sessionId={sessionId} /></Boundary></GutterWidgetFrame>`.
  - Keep whatever the current frame props are. If Iris's build renamed or added one, pass it through unchanged.

**Sirens.**
- **Iris's build.** It may have changed `ChatGutterLayout.tsx` since this plan was written. Find `widgetIn`, `renderWidget` and the `wide` state by name. If one of them no longer exists by that name, report the current function list verbatim with `RESULT: BLOCKED`.
- **Out of scope.** You will want a settings toggle, a keyboard move, or a fifth slot. These are Exclusions.
- **Where the claim lives.** You will want to claim inside `SubagentWidgetBody`. Do not: a collapsed widget unmounts its body (`GutterWidgetFrame.tsx:54-79`), and the strip would jump back above the chat.
- **Forbidden frame files.** `GutterSlot.tsx` and `GutterWidgetFrame.tsx` are forbidden. A third widget needs no change there.

## Phase 5 — Proof in the real app: widget, session-exact rows, one dismissal, live transcript, strip where it belongs
Depends on: Phase 1, Phase 2, Phase 3, Phase 4

```toml
[phase]
id = "5"
builder = "hephaestus"
model = "opus"
code_change = false
doc_sweep = "foreground"
manifest = [".verify/probe-subagent-widget.mjs", ".verify/probe-side-widgets.mjs", ".verify/shots"]
forbidden = ["src/modules/chat", "src/modules/chat-gutters", "server/modules"]
athena = [
  "The session-exact gate passes vacuously: zero rows on both sessions, or the fixture row never appeared and the gate reads its absence as success",
  "The live gate counts entries before the first read settles, so an increase from 0 to N is mistaken for live growth",
  "The dismissal gate reloads the page, or reads the badge before and after from different widgets, so a stale tab count is never caught",
  "The probe leaves the fixture transcript files, the fixture session row, or its added dismissal id in localStorage behind after a failure",
  "The probe edits a real transcript under ~/.claude/projects instead of copies, or writes a Descent/runner/dispatch-souls file",
  "The side-widgets probe's WIDGETS edit changes any geometry assertion",
]

[[steps]]
kind = "edit"
path = ".verify/probe-side-widgets.mjs"
what = "Change const WIDGETS = ['runner', 'memory']; to const WIDGETS = ['runner', 'memory', 'subagents']; so its open-state record/restore covers the third widget. Nothing else in the file changes."
check = '''grep -c "const WIDGETS = \['runner', 'memory', 'subagents'\];" .verify/probe-side-widgets.mjs'''
expect = "1"

[[steps]]
kind = "edit"
path = ".verify/probe-subagent-widget.mjs"
what = "Write the probe exactly as the build notes specify: copied-and-time-shifted fixture session with one running and one finished Agent subagent, gates G1-G8 printing [PASS]/[FAIL], final line SUBAGENT-WIDGET PASS or SUBAGENT-WIDGET FAIL, full cleanup (files, DB row, localStorage dismissals) in finally."
check = '''node --check .verify/probe-subagent-widget.mjs && grep -c 'G1\|G2\|G3\|G4\|G5\|G6\|G7\|G8' .verify/probe-subagent-widget.mjs | sed 's/^[8-9]$/ok/;s/^[1-9][0-9]\+$/ok/' '''
expect = "ok"

[[steps]]
kind = "run"
cmd = "node .verify/probe-subagent-widget.mjs"
check = '''node .verify/probe-subagent-widget.mjs 2>&1 | tail -1'''
expect = "SUBAGENT-WIDGET PASS"
timeout_s = 540

[[verify]]
cmd = '''node .verify/probe-subagent-widget.mjs 2>&1 | grep -c '^\[PASS\] G[1-8]' '''
expect = "8"
timeout_s = 540

[[verify]]
cmd = '''node .verify/probe-side-widgets.mjs 2>&1 | tail -1'''
expect = "SIDE-WIDGETS PASS"
timeout_s = 480

[[verify]]
cmd = '''{ ls /home/lyphe/.claude/projects/-home-lyphe--claude-claudecodeui-lyphe | grep -c '^5ab0a9e0-' || true; }; python3 -c 'import sqlite3; db=sqlite3.connect("file:/home/lyphe/.cloudcli/auth.db?mode=ro", uri=True); print(db.execute("select count(*) from sessions where provider_session_id like ? or session_id like ?", ("5ab0a9e0-%","5ab0a9e0-%")).fetchone()[0])' '''
expect = "0\n0"
```

**What to build.** One Node ESM script, `.verify/probe-subagent-widget.mjs`. Harness conventions are in `docs/verification.md` L92-123.
- It proves the Goal against the running dev server: the UI on `:5183`, the API on `:3011`.
- It creates one fixture Claude session from COPIES of a real transcript, and removes every trace in `finally`.
- Screenshots go to `.verify/shots/dsaw-*.png`; never attach them anywhere.

**Header:**
- `import pw from '/opt/shadow-connector/node_modules/playwright/index.js'; const { chromium } = pw;`, plus `node:fs`, `node:path`, `node:os` and `node:crypto`.
- DB access: import the SQLite driver exactly as `.verify/keepalive-lib.mjs` does in `createProbeSession` (lines ~90-108).
- Constants:
  - `APP_URL = 'http://127.0.0.1:5183'`, `API_URL = 'http://127.0.0.1:3011'`
  - `PROJECT_DIR = '/home/lyphe/.claude/projects/-home-lyphe--claude-claudecodeui-lyphe'`
  - `FIXTURE = '5ab0a9e0-' + crypto.randomUUID().slice(9)`
  - `EMPTY_SESSION = 'c27f44f6-3db7-4596-be10-67d5dd0eb7ef'`, a real session in this project with no subagents (measured 2026-09-14).
- Sign in through the form flow of `.verify/empty-rows.mjs` lines 11-17: `#username` is `verve`, `#password` is `verve-dev-2026`.
- API reads go through `page.evaluate`, with `localStorage['auth-token']` as the Bearer token.
- `badgeCount()` reads the subagents widget's count badge with no testid. Evaluate on `[data-testid=gutter-widget][data-widget=subagents]` and return the first leaf element whose trimmed text is all digits, parsed as a number, or `0` when there is none.

**Fixture**, built before any gate:
1. **Source.** Scan the provider sessions `['caad59e6-761d-4c77-af32-d0b4c45d1db8', '1546a928-83e0-4d0c-a527-6f0f2bb7ddf1']` in that order, and within each its `subagents/*.meta.json` files in sorted order. Pick the first `(source, T, F)` where:
   - T is a meta file's `toolUseId` that occurs as a `tool_use` block id in `PROJECT_DIR/<source>.jsonl`;
   - F is another Agent/Task `tool_use` id in that parent file whose `tool_result` line comes BEFORE T's `tool_use` line and is timestamped at most 90 minutes before it.

   Take F as the latest such result. `AGENT_SRC` is T's sibling `.jsonl`. When no triple exists, print `[FAIL] fixture no source with a finished agent before a running one` and end FAIL.
2. **Parent lines.** Keep `PROJECT_DIR/<source>.jsonl` lines 0 through T's `tool_use` line, inclusive.
   - Parse each line and set its top-level `sessionId` to `FIXTURE` where present.
   - Shift every top-level `timestamp` ISO string by `delta = Date.now() - 5000 - Date.parse(<last kept line's timestamp>)`.
   - Write the result to `PROJECT_DIR/FIXTURE.jsonl`.
3. **Agent lines.** Read `AGENT_SRC` (`n` lines).
   - If `n < 8`, print `[FAIL] fixture agent too short` and end FAIL.
   - `HEAD = Math.max(3, Math.floor(n / 2))`, capped so that at least 5 lines remain.
   - Write the first `HEAD` lines to `PROJECT_DIR/FIXTURE/subagents/<same agent file name>`, with top-level `sessionId` set to FIXTURE and timestamps shifted so the last one is `Date.now() - 3000`.
   - Copy the meta.json beside it verbatim.
4. **Session row.** Poll the DB read-only every 1 s, for up to 30 s, for a `sessions` row with `provider_session_id = FIXTURE`.
   - Found → `APP = row.session_id`.
   - Not found → INSERT one row modeled on `keepalive-lib.mjs` `createProbeSession`: `session_id = FIXTURE`, `provider = 'claude'`, `provider_session_id = FIXTURE`, `project_path = '/home/lyphe/.claude/claudecodeui_lyphe'`, `jsonl_path = PROJECT_DIR/FIXTURE.jsonl`, `custom_name = 'subagent widget probe'`, `isArchived = 0`, timestamps now. Then `APP = FIXTURE`.

   Print which path was taken.

Before the gates, record three things so `finally` can restore them: the subagents widget's `data-open`, its slot, and `localStorage['cloudcli.pinned-agents.dismissed']`.

**Gates.** Each prints `[PASS] Gn <what>` or `[FAIL] Gn <reason>`.
- **G1 — wide: the widget shows, the strip does not.**
  - Set the viewport to 2560×1440, `goto(APP_URL + '/session/' + APP)`, and wait up to 30 s for the grid.
  - Open the subagents widget if `data-open` is `false`.
  - Wait up to 30 s for `[data-testid=subagent-widget-row][data-row-id="<T>"]`.
  - Pass iff the widget counts 1, `[data-testid=pinned-subagents-strip]` counts 0, T's row has `data-running="true"`, and F's row exists with `data-running="false"`.
  - Screenshot `dsaw-wide.png`.
- **G2 — session-exact rows.**
  - `fixtureText` = the JSON text of `GET /api/providers/sessions/APP/messages?limit=500`. Every visible row's `data-row-id` must be a substring of `fixtureText`, and T and F must be among the rows.
  - `goto` `EMPTY_SESSION`, wait for the grid, then wait 3 s. No row may carry T or F. Every row id must be a substring of that session's messages JSON. When there are zero rows, `subagent-widget-empty` counts 1.
  - `goto` APP again; T's row must reappear within 30 s.
  - The `[FAIL]` line names the first offending id.
- **G3 — the transcript reads live.**
  - Click T's row, then wait up to 20 s for `[data-testid=subagent-transcript][data-row-id="<T>"]` with at least one entry.
  - Wait 5 s; `n0` = the entry count. Assert `data-live="true"`.
  - Append the next 5 lines of `AGENT_SRC` (lines `HEAD..HEAD+4`, sessionId rewritten, timestamps shifted to now) to the fixture agent file.
  - Poll up to 15 s for an entry count `> n0`. If `n0` is already 100, compare the route's `total` before and after instead, and say so.
  - Screenshot `dsaw-transcript.png`.
  - Click `subagent-transcript-back`; `subagent-widget-list` must be visible.
- **G4 — the API contract.**
  - The agent route for T returns `found === true` and `activity.length > 0`.
  - `toolu_doesnotexist0` returns `found === false`.
  - `bad.id%2F..%2Fx` returns 400.
  - The soul route, for the newest `dispatch-*` launch with a `result.json` `session_id`, returns `found === true` and `activity.length > 0`.
  - `dispatch-nope-00000000` returns `found === false`.
  - Unwrap `data` when present; this reads the raw HTTP routes, not `api.ts`.
- **G5 — placement survives.**
  - Drag the subagents widget onto `[data-testid=gutter-slot][data-slot="top-right"]`, using its header when open or the root when collapsed, as `probe-side-widgets.mjs` G4 does.
  - Assert it sits in `top-right`, and the widget previously there moved to its old slot.
  - Wait 1500 ms, `page.reload()`, and assert the same again.
  - Drag it back and wait 1500 ms.
- **G6 — one dismissal, everywhere, no reload.**
  - `before = badgeCount()`.
  - Click `[data-testid=pinned-row-dismiss]` inside F's `subagent-widget-row`.
  - With NO reload, poll up to 5 s until F's row is gone AND `badgeCount() === before - 1`.
  - Pass iff both hold. The `[FAIL]` line prints `before`, the last badge reading and whether the row left.
- **G7 — narrow desktop keeps the strip.**
  - Set the viewport to 1280×900 and wait up to 10 s for the grid to be absent.
  - Pass iff `pinned-subagents-strip` counts 1 within 10 s, and F's id appears nowhere in the strip. Dismissed in G6 means dismissed here too; check with `document.querySelector('[data-testid=pinned-subagents-strip]').innerHTML.includes(F)` returning `false`. If the rows carry no id in their markup, skip that half and say so.
  - Screenshot `dsaw-narrow.png`, then restore 2560×1440.
- **G8 — mobile keeps the strip.**
  - Open a new context with `viewport: { width: 390, height: 844 }, isMobile: true`, sign in, go to `/session/APP`, and wait 8 s.
  - Pass iff `gutter-slot` counts 0 and `pinned-subagents-strip` counts 1.
  - Screenshot `dsaw-mobile.png`.

**`finally`**, always, in this order:
1. In a page of the main context, set `localStorage['cloudcli.pinned-agents.dismissed']` back to the recorded value, or remove the key if it was absent. The fixture's tool use ids are the real session's ids, so a leftover dismissal would hide them there.
2. Restore the subagents widget's recorded open state and wait 1500 ms.
3. Close the browser.
4. Delete `PROJECT_DIR/FIXTURE.jsonl` and the `PROJECT_DIR/FIXTURE` directory, recursively and forced.
5. Wait 3 s, then `DELETE FROM sessions WHERE provider_session_id = ? OR session_id = ?`, with FIXTURE for both placeholders.

The last line is `SUBAGENT-WIDGET PASS` when all eight gates passed. Otherwise it is `SUBAGENT-WIDGET FAIL`, with `process.exitCode = 1`. A thrown error prints `[FAIL] <gate in progress> <message>`, still runs `finally`, and ends FAIL.

**Sirens.**
- **A product failure.** A gate fails because the product is wrong: a row from another chat, no growth, a stale badge, the strip in the wrong place. Do not edit product code. Report the `[FAIL]` lines and the screenshot PATHS verbatim with `RESULT: BLOCKED`, and never attach images.
- **Real transcripts.** Never write, truncate or append to any file under `~/.claude/projects` other than the two fixture paths.
- **A fixture that will not render.** If `/session/<APP>` renders no chat, report the first 200 characters of `GET /api/providers/sessions/APP/messages` verbatim with `RESULT: BLOCKED`. Do not hand-craft transcript lines.
- **Stubbing.** You will want `page.route` to stub the transcript API. Do not.
- **The side-widgets probe.** If `probe-side-widgets.mjs` fails on a gate unrelated to `WIDGETS` (for example G1 geometry changed by the in-flight proportions work), report its `[FAIL]` lines verbatim with `RESULT: BLOCKED`. Do not edit its geometry assertions.

## Goal

*Goal:* on a desktop chat region wide enough for the gutters, the chat's subagent and soul-launch rows live in a draggable, persistent Subagents gutter widget instead of the strip above the chat box.
- The widget lists only the open chat's subagents.
- A dismissal updates the list and the tab count together, without a reload.
- Clicking a row shows that subagent's transcript, growing live while it runs.
- Narrow desktop and mobile keep the strip.

*Verify by:* Phase 5's `node .verify/probe-subagent-widget.mjs` ends `SUBAGENT-WIDGET PASS` with eight `[PASS]` gates and its fixture removed, and `node .verify/probe-side-widgets.mjs` still ends `SIDE-WIDGETS PASS`.

## Decisions

Each default is chosen now; its reversal is written beside it.

- **"Desktop only" means "while the gutters show".** The strip moves into the widget exactly when the chat region is wide enough for gutters and not mobile. A desktop region too narrow for gutters, and every mobile layout, keep the strip above the chat box. Reversal: pass `enabled` instead of `wide` to `useClaimSubagentStrip` in `ChatGutterLayout.tsx`.
- **Default placement.** Subagents starts bottom-left and open. An existing saved Runner/Memory placement is kept, and Subagents takes a free slot. Reversal: `DEFAULT_PLACEMENTS.subagents` in `useGutterPlacements.ts`.
- **Collapsed still counts as moved.** A collapsed Subagents tab keeps the strip hidden and shows the row count. The claim follows the gutters, not the widget body. Reversal: claim from the frame's open state.
- **Session exactness.** The widget reads the same session-scoped arrays the strip reads (the scout found no leak), published by `ChatInterface` with `selectedSession.id`, and refuses a source tagged with any other id. No reversal is wanted; this is the operator's requirement.
- **A separate store, not the live bus.** The chat's rows reach the gutter through `subagentSource.ts`, a module-scope store, and never through the live bus of `docs/architecture/07-live-widgets.md`. Two reasons:
  - The bus topic allowlist is the exfiltration control. Putting `ChatMessage[]` on it would expose tool inputs and results to model-written widgets.
  - The bus publish runs a JSON compare, which would serialize `ChatMessage[]` on every streamed token.

  The `*Feed` suffix stays reserved for bus feeds, hence `ChatSubagentSource` / `publishSubagentSource` / `useSubagentSource`. Also rejected:
  - Lifting `useSessionStore` into a context: it re-plumbs the whole chat.
  - Portaling `PinnedSubagents` into the gutter: a widget crash would reach the chat's boundary, and the tab would have no count.

  Reversal: `subagentSource.ts` plus two lines in `ChatInterface.tsx`.
- **One dismissal store for every copy of the rows.** `pinnedDismissals.ts` owns the only dismissal snapshot (`useDismissedPins`, `dismissPin`). The row hook runs once for the tab count and once for the list, and the strip may mount too; a per-hook seeded `useState` would let those copies disagree until a reload. No reversal is wanted; the alternative is the defect.
- **`PinnedSubagentRow` stays module-local.** Its element type references the module-local `SubagentSummary` (`subagentSummary.ts:13-30`), and this follows that precedent. Reversal: move both types into `src/shared/types.ts` in one pass.
- **Live means a 2-second poll of the transcript file.**
  - One server read serves finished and running subagents and soul launches alike, and avoids the history path's 200-entry head cap.
  - The poll runs only while the view is open and the subagent is running or the reader reports `inFlight`.
  - The sessions watcher deliberately ignores `**/subagents/**`.

  Reversal: `TRANSCRIPT_POLL_MS` in `useSubagentTranscript.ts`.
- **Agent transcripts are addressed by tool use id.** A subagent's `meta.json` `toolUseId` exists from launch; `toolUseResult.agentId` exists only once the result lands. The legacy loose layout carries no `meta.json` and answers "No transcript on disk yet". Reversal: add a legacy scan in `findSubagentTranscriptByToolUse`.
- **Soul transcripts go through providers.** The transcript layout has one home, `claude-session-synchronizer.provider.ts:33-35`, so `dispatch-souls` only turns a launch id into a Claude session id and calls `readClaudeTranscriptBySessionId`. That read tries the CloudCLI `sessions` row's `jsonl_path` first and falls back to a directory scan kept inside providers. Phase 1 measures which path a real soul takes. `readTranscriptActivity` and `NOT_FOUND_TRANSCRIPT` stay provider-internal. Reversal: none wanted; the alternative duplicates the layout.
- **Envelopes are unwrapped in `api.ts`.** Both `api.subagentTranscripts` methods resolve to a bare `SubagentTranscriptResult`, so no hook or component knows which route wraps its answer. Reversal: none wanted.
- **One widget table in the gutter.** `renderWidget` reads a `Record<GutterWidgetId, { title, count, icon, Body }>` and renders one `GutterWidgetFrame`, so a fourth widget is one table entry. Reversal: none wanted.
- **Transcript window.** The server sends the last 1000 activities; the view renders the last 100, and each "Show earlier steps" adds 100. Reversal: `SUBAGENT_TRANSCRIPT_LIMIT` and the view's `shown` default.
- **Where the transcript opens.** It opens in place, inside the widget, with a Back button, and never in a dialog over the chat. Reversal: wrap `SubagentTranscriptView` in `Dialog` from `@/shared/ui` inside `SubagentWidgetBody.tsx`.
- **Builders.** The server reads (Phase 1) and the probe (Phase 5) go to Hephaestus. Every phase that edits a component file (Phases 2, 3 and 4) goes to Iris, per the builder rule in `PLAN_FORMAT_V2.md` §5.

## Waves

Wave 1: Phase 1 — server reads, shared types, api
Wave 2: Phase 2 — chat source, claim, dismissal store (shares `src/shared/types.ts` with Phase 1)
Wave 3: Phase 3 — widget body (consumes Phase 1's api and Phase 2's hooks)
Wave 4: Phase 4 — gutter integration and docs (consumes Phase 3's components)
Wave 5: Phase 5 — proof

Every phase consumes an earlier phase's output or shares a file with it, so the plan stays one file walked in order; no split.

## Edge cases

- **No chat open, or a brand-new chat before its URL carries an id.** The gutter `sessionId` is null, so the source is refused and the widget shows its empty state. The strip stays hidden while the gutters show, and the rows appear once the URL session is set.
- **Switching chats with a transcript open.** The target resets to the list; the old poll's timer is cleared and a late answer is ignored.
- **A subagent finishes while its transcript is open.** One more read lands with `inFlight` false, polling stops and the Live badge goes.
- **The row ages out or is dismissed while its transcript is open.** The view keeps its stored label, `running` becomes false, and it polls only while the reader says `inFlight`.
- **Dismissing a row in the widget.** The list, the tab badge and the (hidden) strip all drop it at once, from one store (G6).
- **An Agent row from a non-Claude provider, or a legacy-layout subagent.** The response is `found: false`, shown as "No transcript on disk yet".
- **A soul still starting, before `child.log` has its first line.** The response is `found: false`, and the view keeps polling while the soul row is running.
- **A soul whose Claude session has no CloudCLI row.** The providers read falls back to its directory scan.
- **Hostile ids** (`..`, `/`, over 128 characters, a non-uuid session id). The route answers HTTP 400, or `found: false` for the session id, before any filesystem access.
- **A stored `chatGutters` value from before this plan.** Runner and Memory keep their slots, and Subagents takes bottom-left or the first free slot.
- **A corrupt `chatGutters` value.** Each widget independently falls back to a default or free slot; no slot ever holds two widgets.
- **A widget body throws.** Its own boundary contains the error; the chat and the other widgets keep rendering.
- **Two browser tabs.** Each tab has its own module stores. A dismissal written in one tab reaches the other on its next load, as today.
- **A transcript over 1000 activities.** The newest 1000 are served, `total` reports the full count, and "Show earlier steps" stops at the served window.

## Exclusions

- A realtime push channel for subagent file growth; the 2-second poll is the live mechanism.
- Translating the hard-coded English inside `PinnedAgentRow.tsx` and `SoulLaunchPinRow.tsx`, a separate card.
- Rendering `child.log` stream-json directly.
- Opening a subagent's files or diffs from the transcript view (`onFileOpen`); the view is read-only.
- A keyboard or menu alternative to dragging the widget, and a setting to turn the gutters off.
- Syncing dismissals across browser tabs live (a `storage` event listener).
- Committing or pushing this work. Nothing in the run depends on it.

## Doctrine citations

- `.agents/skills/frontend-module-standards/SKILL.md` L19-23, L27-33, L52-53, L66-80, L144, and `.agents/skills/backend-module-standards/SKILL.md` L22, L40-42, L48-49 (quoted in Project Constraints).
- `src/shared/ui/verve/README.md` library rule 4 (barrel import) and token rule 3 (colour via Tailwind); `~/.claude/design/DESIGN_DOCTRINE.md` §2 (compose) and §6 (a glyph plus a word).
- `docs/architecture/07-live-widgets.md`: the live bus, its topic allowlist and its `*Feed` naming, which this plan deliberately stays off.
- `server/modules/providers/list/claude/claude-session-synchronizer.provider.ts:33-35`: the Claude transcript layout's one home.
- `docs/architecture/06-tool-view.md` L375-400 (subagent containers), L459-472 and L798 (pinned strip, rewritten in Phase 4), and L700-705 (the `ToolRenderer` import cycle to avoid).
- `docs/architecture/README.md` L93 (rewritten in Phase 4) and L125 (a provider session id never reaches the browser; this plan sends only app session ids, tool use ids and launch ids).
- `docs/dispatch-souls.md` L7-11, L33, L94-99 and L179 (rewritten in Phases 1 and 4).
- `docs/verification.md` L92-123 (probe harness, Playwright path, shots directory).
- `docs/plans/desktop-side-widgets.plan.md` (the gutter design this extends).

## Open Questions

- None. Every question the brief raised, and every amendment from review, is decided above.

## Ship Logs

### Phase 1 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: builder-blocked: step 18: soul lookup path row 6966b727-d5dd-47e0-9de8-154d2477b2b1]
- run: desktop-subagent-widget-plan-20260915-010332-cb92 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha f7cb2690343c · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session f84d7d51-3ab6-4bb0-8854-43797c3f22ea · 442s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/desktop-subagent-widget-plan-20260915-010332-cb92/phase_1/

### Phase 1 Ship Log — ↻ REPLANNED 2026-09-15
- run: desktop-subagent-widget-plan-20260915-010332-cb92 · replan 1 of 3 · spec_sha f7cb2690343c → c123defe1c5f · replanner odysseus/claude-opus-5 · session 1412b91f-de16-45eb-abdd-ea5b637e9eac · 263s · cost $1.63
- cause: builder-blocked: step 18: soul lookup path row 6966b727-d5dd-47e0-9de8-154d2477b2b1
- changed: The replan is finished and all four proofs pass. `lint` exited 0, `gate` printed `RUNNER` first, `walk` rendered the new steps, and `lock` still prints `lock:b4629d0b36`. Step 2's corrected check already prints `2`/`ok`/`1` against the tree, and the anchors for steps 3 and 13 are where the new steps say. I rewrote Phase 1 to match what the builder found. Step 2 now expects two exports, not three, because `truncateSubagentActivity` is already exported from `server/shared/utils.ts:462`. Step 3 adds one exported `CLAUDE_PROJECTS_ROOT` in the synchronizer in place of the inline `projects` join, and its check now tests that edit instead of passing untouched. Steps 11 and 13 give the transcript s
- evidence: /home/lyphe/.claude/state/runner/desktop-subagent-widget-plan-20260915-010332-cb92/phase_1/

### Phase 1 Ship Log — ✅ SHIPPED 2026-09-15
- run: desktop-subagent-widget-plan-20260915-010332-cb92 · attempt 1 of 2 · cycle 2 · spawns 6/120 · fix-passes 1 of 2 · cost $1.35 (run $3.12) · resumed 0×
- builder: hephaestus/deepseek-flash · session e57375b4-20e6-4d36-a913-e0bf1a169d5f · 285s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 3 → fix-pass 1/deepseek-flash (153s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 18/18 steps OK · verify 2/2 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 1 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 3 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/desktop-subagent-widget-plan-20260915-010332-cb92/phase_1/

### Phase 2 Ship Log — ⛔ BLOCKED 2026-09-15
- [BLOCKED: builder-blocked: step 6: npm run typecheck (0) and npm run lint (0) hold; the check's grep prints 3 against an expectation of 0]
- run: desktop-subagent-widget-plan-20260915-010332-cb92 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha 5d1e38923699 · retry: on-spec-change
- builder: iris/deepseek-flash · session ad0aca07-f163-40c9-99ae-893b3a0972cd · 408s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/desktop-subagent-widget-plan-20260915-010332-cb92/phase_2/

### Phase 2 Ship Log — ↻ REPLANNED 2026-09-15
- run: desktop-subagent-widget-plan-20260915-010332-cb92 · replan 2 of 3 · spec_sha 5d1e38923699 → 5a6611a86d62 · replanner odysseus/claude-opus-5 · session 428e9387-b16e-4af0-b239-12292492e083 · 166s · cost $1.08
- cause: builder-blocked: step 6: npm run typecheck (0) and npm run lint (0) hold; the check's grep prints 3 against an expectation of 0
- changed: I rewrote Phase 2's step 6 check, and all four proofs pass: lint exits 0, gate prints `RUNNER`, walk renders, and the lock is still `lock:b4629d0b36`. The old check wanted zero lint lines naming the phase's five files. But three warnings were already there before the phase: two in `ChatInterface.tsx` on `selectProviderModel`/`selectProviderEffort`, and one about `Date.now` that moved with the code into `usePinnedSubagentRows.ts`. The new check still needs typecheck and lint to exit 0. It lets through only those three and requires zero other warnings in the five files. Run on the saved lint output, it prints the expected `tc=0 / lint=0 / 0 / ok`. I added two Athena items, three Sirens and a `
- evidence: /home/lyphe/.claude/state/runner/desktop-subagent-widget-plan-20260915-010332-cb92/phase_2/

### Phase 2 Ship Log — ✅ SHIPPED 2026-09-15
- run: desktop-subagent-widget-plan-20260915-010332-cb92 · attempt 1 of 2 · cycle 4 · spawns 12/120 · fix-passes 1 of 2 · cost $1.55 (run $5.85) · resumed 0×
- builder: iris/deepseek-flash · session 9450a126-8c09-4501-8ae0-a2c23da929a8 · 348s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 5 → fix-pass 1/deepseek-flash (951s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 6/6 steps OK · verify 2/2 OK
- forbidden: unchanged (4 declared, 4 present)
- docs: Prometheus returned · 2 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 5 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/desktop-subagent-widget-plan-20260915-010332-cb92/phase_2/

### Phase 3 Ship Log — ✅ SHIPPED 2026-09-15
- run: desktop-subagent-widget-plan-20260915-010332-cb92 · attempt 1 of 2 · cycle 5 · spawns 16/120 · fix-passes 1 of 2 · cost $1.84 (run $7.69) · resumed 0×
- builder: iris/deepseek-flash · session 9a659ded-2d27-4514-ac33-5cf61c1c795c · 560s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 3 → fix-pass 1/deepseek-flash (53s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 10/10 steps OK · verify 2/2 OK
- forbidden: unchanged (7 declared, 7 present)
- docs: Prometheus returned · 2 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 3 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/desktop-subagent-widget-plan-20260915-010332-cb92/phase_3/

### Phase 4 Ship Log — ✅ SHIPPED 2026-09-15
- run: desktop-subagent-widget-plan-20260915-010332-cb92 · attempt 1 of 2 · cycle 6 · spawns 20/120 · fix-passes 1 of 2 · cost $1.02 (run $8.71) · resumed 0×
- builder: iris/deepseek-flash · session fad6382d-e6b7-4a8e-a1ce-54d1226641e7 · 757s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 1 · LOW 4 → fix-pass 1/deepseek-flash (471s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 8/8 steps OK · verify 2/2 OK
- forbidden: unchanged (5 declared, 5 present)
- docs: Prometheus returned · 2 files
- residue: BLOCKING 0 · HIGH 0 · MED 1 · LOW 4 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/desktop-subagent-widget-plan-20260915-010332-cb92/phase_4/

### Phase 5 Ship Log — ✅ SHIPPED 2026-09-15
- run: desktop-subagent-widget-plan-20260915-010332-cb92 · attempt 1 of 2 · cycle 7 · spawns 21/120 · fix-passes 0 of 2 · cost $0.19 (run $8.91) · resumed 0×
- builder: hephaestus/deepseek-flash · session 9bc595d0-4f9c-47c4-ab60-a38d32761286 · 601s · RESULT: DONE
- athena: n/a — code_change = false
- checks: 3/3 steps OK · verify 3/3 OK
- forbidden: unchanged (3 declared, 3 present)
- evidence: /home/lyphe/.claude/state/runner/desktop-subagent-widget-plan-20260915-010332-cb92/phase_5/

### Run desktop-subagent-widget-plan-20260915-010332-cb92 — COMPLETE 2026-09-15
- shipped: 1, 2, 3, 4, 5
- blocked: none
- next: run complete — the checkpoint is Scott's /git, on his clock
- brief: /home/lyphe/.claude/state/runner/desktop-subagent-widget-plan-20260915-010332-cb92/resume_brief.md
