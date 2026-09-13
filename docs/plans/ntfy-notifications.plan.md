# ntfy phone push — a new channel in CloudCLI's notification orchestrator

## INTENT LOCK

**ORIGINAL REQUEST** (the operator's own words, verbatim):
> Can we plan on a ntfy integration in cloudcli? Some things I'd like to include are rate limits hit/reached, any other errors like API errors. When a question prompt reaches me. What else can you think of?
> I'd also like to add removing ntfy in descent

**THIS PLAN DELIVERS** (the CloudCLI slice; the Descent removal is the sibling plan named under Waves):
A fourth channel entry `ntfy` in `notificationChannels` of `server/modules/notifications/services/notification-orchestrator.service.js`, so every event the orchestrator already routes to web push and desktop also rides ntfy, plus the new events the request names, each produced by exactly one owner: Claude's SDK `rate_limit_event` stream (rate limit reached with reset time, limit reset — also fired by a timer at `resetsAt` when no turn is running —, usage warnings at the 80 and 95 buckets, overage started, out of credits), the SDK's synthetic API-error assistant reply after its own retries are exhausted (API error, login expired, billing/out of credits), the SDK `auth_status` message (login needed), SDK `result` error subtypes (max turns, max budget, crashed), a registry-level stall watchdog for every provider (silent for 15 min by default), and the existing run-stopped / background-finished / run-failed paths. Question prompts (AskUserQuestion) push the question text and numbered options; plan-ready (ExitPlanMode) pushes the plan's opening lines; a tool approval pushes the tool name and its command or file path — the "Tool X needs approval" copy is deleted for every channel. A `PreToolUse` SDK hook makes AskUserQuestion and ExitPlanMode reach the UI and the phone in `bypassPermissions`, `auto` and `dontAsk` modes, closing the caveat at `claude-runtime.provider.js:1055`. Each push carries the priority tier the request names (4 = needs-you, limit reached, errors; 3 = warnings, limit reset; 2 = finished work), a `click` deep link to `<appUrl>/session/<sessionId>`, and — for questions with up to three options, plans and tool approvals — ntfy `http` action buttons that answer from the lock screen through a public `POST /api/ntfy/act?t=<token>` route — its own prefix beside `/api/auth` and `/api/browser-use-mcp`, so no mount order is load-bearing — where the token is HMAC-signed with a server-side secret, bound to one request id, one user and one decision, single-use and time-limited; Argus audits that surface in its own phase. The push is skipped while a browser tab on that session is visible (a `chat.presence` websocket message the client sends on session change, visibility change and a 30 s heartbeat), and repeats of one code for one session inside 60 s collapse into the first push plus one summary push carrying the count. Long-run pushes fire only when the run's duration (the SDK result's `duration_ms`, or a spawn-to-exit clock for Codex, Cursor and OpenCode) meets a per-user minute threshold. Config lives in CloudCLI's own SQLite: the existing `notification_channel_endpoints` table holds one `ntfy` row per user (server URL defaulting to https://ntfy.sh, topic, optional access token, long-run minutes, enabled) and `app_config` gains the one app-wide key `public_app_url`; both are read live on every send, so no restart is ever needed; the topic and token are never returned unmasked, never logged, never placed in a URL. A new `events.limits` preference (default on) gates the limit family beside the existing actionRequired / stop / error toggles. Settings → Notifications gains an ntfy card composed from the settings module's own `SettingsSection` / `SettingsCard` / `SettingsRow` and the shared `Input` / `Button` / `Switch`, with Save, Remove and "Send test", and a fourth event checkbox for limits, in all 11 locales. Every phase is proven against the running dev server and a real scratch topic on ntfy.sh read back through ntfy's poll API, with three real Claude turns in total (a question answered from the "phone", a stalled Bash sleep, and a watched-versus-unwatched finish) and no test files. Descent is untouched by this file; its ntfy egress is removed by the sibling plan.

**OPERATOR VERDICT:** CONFIRMED — 2026-09-12 — Scott: "Ready to run, accepted"

## Runner

```toml
plan_format = 2
cwd = "/home/lyphe/.claude/claudecodeui_lyphe"
add_dirs = []

[budget]
max_cycles = 14
max_spawns = 70
max_fix_passes = 2
max_attempts = 2
max_replans = 3
```

## Interfaces

Server (paths relative to `server/`; application imports use the `@/` alias = `server/` and END IN `.js` even when the target file is `.ts` — the precedent is `notification-orchestrator.service.js:4` importing `desktop-notification-clients.service.js`, a `.ts` file). Every new server file is TypeScript.

- **Event vocabulary** (the orchestrator's `createNotificationEvent({ provider, sessionId, kind, code, meta, severity, dedupeKey, requiresUserAction })`, `notification-orchestrator.service.js:48-57`). `kind` is one of `action_required | stop | error | limit | info`. `KIND_TO_PREF_KEY` (`:6-10`) gains `limit: 'limits'`. Codes and the `meta` each carries:
  - `permission.required` (action_required) — `{ toolName, sessionName, requestId, toolInput }`; `toolInput` is the raw tool input object (added in Phase 4; absent until then).
  - `agent.notification` (action_required) — `{ message, sessionName }` (exists).
  - `run.stopped` (stop) — `{ stopReason, sessionName, durationMs }`; `durationMs` is a number or `null` (unknown).
  - `run.background_completed` (stop) — `{ sessionName }` (exists).
  - `run.failed` (error) — `{ error, sessionName }` (exists).
  - `run.limit` (error) — `{ limit: 'turns' | 'budget', numTurns, totalCostUsd }`.
  - `api.error` (error) — `{ reason, attempts, errorStatus }`; `reason` is an `SDKAssistantMessageError` string.
  - `session.stuck` (error) — `{ silentForMs }`.
  - `login.expired` (error) — `{ detail }`.
  - `limit.reached` / `limit.reset` / `limit.warning` / `limit.overage` / `limit.out_of_credits` (limit) — `{ rateLimitType, resetsAt, pct }`; `resetsAt` is the SDK's epoch number as received; `pct` is an integer (warning only).
  - `push.enabled` (info) — exists.
- **`notifyRunStopped({ userId, provider, sessionId = null, stopReason = 'completed', sessionName = null, durationMs = null })`** (`:250`) forwards `durationMs` into `meta`. The other exported signatures do not change: `notifyUserIfEnabled({ userId, event })`, `notifyRunFailed({ userId, provider, sessionId, error, sessionName })`, `notifyBackgroundWorkCompleted({ userId, provider, sessionId, sessionName })`, `buildNotificationPayload(event)`.
- **`modules/notifications/services/notification-copy.service.ts`** (new): `export function buildNotificationText(event: NotificationEventLike): { title: string; body: string }`. It replaces `CODE_MAP` (`notification-orchestrator.service.js:153-162`); `buildNotificationPayload` calls it for `title`/`body` and keeps every other payload field byte-identical. `title` = `${headline}${sessionName ? \` · ${sessionName}\` : ''}`; `body` per code: AskUserQuestion → the question text, then one line per option `${i+1}. ${label}` (a `header` prefixes the question as `[header] `; several questions are separated by a blank line; `multiSelect` appends ` (choose any)`); without `toolInput.questions` the body is `Claude has a question — open the session to answer.`; ExitPlanMode → headline `Plan ready for approval`, body = the first 600 characters of `toolInput.plan` (a string) else `Claude has a plan ready to review.`; any other tool → headline `Approve ${toolName}`, body = `toolInput.command` (Bash) or `toolInput.file_path` (Edit/Write/Read/MultiEdit/NotebookEdit) or `JSON.stringify(toolInput)` clamped to 300 chars, else `A tool needs your approval.`; `agent.notification` → `Claude needs you` / `meta.message`; `run.stopped` → `Run finished` (`Run aborted` when `stopReason === 'aborted'`) / `${providerLabel} finished${durationMs ? \` in ${humanDuration}\` : ''}`; `run.background_completed` → `Background agent finished` / `${providerLabel}: a background task completed`; `run.failed` → `Session crashed` / `meta.error`; `run.limit` → `Max turns reached` or `Max budget reached` / `The run stopped after ${numTurns} turns` or `The run stopped at $${totalCostUsd.toFixed(2)}`; `api.error` → `API error` / `${reason} after ${attempts} retries`; `session.stuck` → `Session silent` / `No output for ${minutes} min while a run is in flight`; `login.expired` → `Login needed` / `Claude needs you to sign in again${detail ? \`: ${detail}\` : ''}`; `limit.reached` → `Rate limit reached` / `${windowLabel} limit hit — resets ${resetsAtText}`; `limit.reset` → `Limit reset` / `${windowLabel} window reset — you can resume`; `limit.warning` → `Usage at ${pct}%` / `${windowLabel} window at ${pct}% — resets ${resetsAtText}`; `limit.overage` → `Overage started` / `You are now using overage on the ${windowLabel} window`; `limit.out_of_credits` → `Out of credits` / `Overage is disabled: out of credits`; `push.enabled` → `Push notifications enabled` / `Push notifications are now enabled!`; unknown code → `CloudCLI` / `You have a new notification`. `windowLabel`: five_hour → `5-hour`, seven_day → `7-day`, seven_day_opus → `7-day Opus`, seven_day_sonnet → `7-day Sonnet`, overage → `overage`, missing → `usage`. `resetsAtText`: `resetsAt` < 1e12 is seconds, else milliseconds; rendered with `toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })`; missing → `soon`. `providerLabel` is the orchestrator's existing label logic, moved here unchanged. The strings `needs approval` and `needs your approval` exist nowhere in the repo after Phase 1.
- **`modules/notifications/services/ntfy-publish.service.ts`** (new): `export type NtfyAction = { action: 'http'; label: string; url: string; method: 'POST'; clear: true }`; `export type NtfyMessage = { title: string; message: string; priority: 1 | 2 | 3 | 4 | 5; tags?: string[]; click?: string; actions?: NtfyAction[] }`; `export type NtfyTarget = { serverUrl: string; topic: string; token: string | null }`; `export type NtfyPublishResult = { ok: boolean; status: number | null; error: string | null }`; `export async function publishNtfy(target: NtfyTarget, message: NtfyMessage): Promise<NtfyPublishResult>`. POSTs JSON `{ topic, title, message, priority, tags, click, actions }` to `target.serverUrl` itself (ntfy's JSON-to-base-URL form — the topic rides in the body, never the path), header `Content-Type: application/json` and `Authorization: Bearer ${token}` when a token is set, `signal: AbortSignal.timeout(5000)`; clamps title to 200 chars, message to 2000, each action label to 30, actions to the first 3; never throws — a non-2xx returns `{ ok: false, status, error }` with the response text clamped to 200 chars and every occurrence of the topic removed; a network failure returns `{ ok: false, status: null, error: err.message clamped }`. One `console.warn('[ntfy] publish failed', status, error)` on failure; the topic, token, click URL and message body are never logged.
- **`modules/notifications/services/ntfy-config.service.ts`** (new): constants `NTFY_CHANNEL = 'ntfy'`, `NTFY_ENDPOINT_ID = 'default'`, `DEFAULT_NTFY_SERVER = 'https://ntfy.sh'`, `APP_URL_CONFIG_KEY = 'public_app_url'`, `DEFAULT_LONG_RUN_MINUTES = 5`. `export type NtfyConfig = { serverUrl: string; topic: string; token: string | null; longRunMinutes: number; enabled: boolean }` (server-internal, unmasked, never serialized to a client). `export type NtfyConfigView = { configured: boolean; enabled: boolean; serverUrl: string; topicMasked: string | null; hasToken: boolean; longRunMinutes: number; appUrl: string | null }`. `export function getNtfyConfig(userId: number): NtfyConfig | null` reads `notificationChannelEndpointsDb.getEndpoint(userId, 'ntfy', 'default')` and parses `metadata_json` (`{ serverUrl, topic, token, longRunMinutes }`), `enabled` from the row. `export function saveNtfyConfig(userId: number, input: { serverUrl?: string; topic?: string; token?: string | null; longRunMinutes?: number; enabled?: boolean }): NtfyConfigView` — `topic` absent keeps the stored one (a first save without a topic throws `NtfyConfigError('topic required')`); `token` absent keeps, `''`/`null` clears; `serverUrl` is trimmed, trailing slashes stripped, must start with `http://` or `https://`; `topic` must match `/^[A-Za-z0-9_-]{1,64}$/`; `longRunMinutes` is an integer 0-1440; upserts through `notificationChannelEndpointsDb.upsertEndpoint` and `setEndpointEnabled`. `export function removeNtfyConfig(userId: number): void`. `export function getAppUrl(): string | null` / `export function setAppUrl(url: string | null): void` via `appConfigDb.get/set` (`repositories/app-config.ts:19,33`), same URL rules, `null`/`''` deletes by storing `''`. `export function toNtfyConfigView(config: NtfyConfig | null): NtfyConfigView` — `topicMasked` = `••••` when the topic is 4 chars or shorter, else `${first 2}…${last 2}`. `export function maskNtfyMetadata(metadata: unknown): { serverUrl: string; topicMasked: string | null; hasToken: boolean; longRunMinutes: number }` for the generic endpoints route. `export class NtfyConfigError extends Error { status = 400 }`.
- **`modules/notifications/services/ntfy-channel.service.ts`** (new): `export const ntfyChannel = { id: 'ntfy', isEnabled: (_preferences, userId) => boolean, send: ({ userId, event, payload }) => Promise<void> }` registered as the LAST entry of `notificationChannels` (`notification-orchestrator.service.js:210-223`). `isEnabled` reads `getNtfyConfig(Number(userId))` and answers `Boolean(config?.enabled && config.topic)`: the endpoint row is the ONE source of the channel's enablement, never `preferences.channels.*` — `channels.desktop` / `channels.webPush` are derived copies of endpoint state (`notifications.routes.ts:33-40`, `settings.service.ts:166,180`), and the client normalizer (`useSettingsController.ts:105-121`) drops any channel key it does not know, so a `channels.ntfy` copy would be written back `false` on the next auto-save. The orchestrator's channel loop (`:240-243`) passes `userId` as the second argument to every channel's `isEnabled` (web push and desktop ignore it) — the one fan-out gate stays honest and the orchestrator's net line count does not grow. `send` in order: (1) `getNtfyConfig(Number(userId))` — null, `!enabled` or empty topic → return; (2) `event.sessionId && isSessionWatched(userId, event.sessionId)` → return; (3) `event.code === 'run.stopped'` and (`event.meta.durationMs == null` or `< longRunMinutes * 60000`) → return; (4) `priorityFor(event)`: kind action_required → 4, error → 4, limit with code `limit.reached` or `limit.out_of_credits` → 4, limit otherwise → 3, stop → 2, else 3; (5) `tagsFor(event)`: action_required → `['question']`, error → `['rotating_light']`, `limit.reached`/`limit.out_of_credits` → `['no_entry']`, other limit → `['warning']` except `limit.reset` → `['white_check_mark']`, stop → `['white_check_mark']`, else `['bell']`; (6) `click` = `${appUrl}/session/${sessionId}` when both exist, `${appUrl}/` when only the URL exists, absent otherwise; (7) `actions` = `buildNtfyActions(...)` only when `event.code === 'permission.required'` and `event.meta.requestId` and `appUrl` all exist, else none; (8) `floodControl.admit(collapseKey)` where `collapseKey = \`${userId}:${event.provider}:${event.code}:${event.sessionId ?? 'none'}\`` for codes in `COLLAPSIBLE_CODES = new Set(['api.error', 'run.failed', 'session.stuck', 'limit.warning', 'limit.reached', 'limit.overage', 'agent.notification', 'run.stopped'])` — a suppressed admit returns without publishing; (9) `await publishNtfy(target, { title: payload.title, message: payload.body, priority, tags, click, actions })`. The flood-control window close publishes ONE summary `{ title: \`${lastTitle} ×${count + 1}\`, message: \`${count} more in the last minute\`, priority: 3, tags: ['bell'], click }`. Errors never propagate: `send` resolves whatever `publishNtfy` returned.
- **`modules/notifications/services/ntfy-flood-control.service.ts`** (new): `export function createFloodControl(options: { windowMs?: number; onWindowClose: (key: string, suppressedCount: number) => void }): { admit(key: string): boolean }` — first `admit` of a key inside a window returns `true` and arms one `setTimeout(windowMs).unref()`; later admits return `false` and count; at the timer `onWindowClose(key, count)` runs only when `count > 0`; the entry is then dropped. Default `windowMs = 60_000`.
- **`modules/notifications/services/session-presence.service.ts`** (new): `export function markPresence(connection: object, presence: { userId: string | number | null; sessionId: string | null; visible: boolean }): void`; `export function clearPresence(connection: object): void`; `export function isSessionWatched(userId: string | number | null, sessionId: string | null, options?: { freshMs?: number }): boolean` — true when any record keyed by a live connection has `String(record.userId) === String(userId)`, the same `sessionId`, `visible === true` and `updatedAt` within `freshMs` (default 90 000). A `Map<object, Record>`; nothing else.
- **`modules/notifications/services/ntfy-action-token.service.ts`** (new): `export type NtfyActionDecision = 'allow' | 'deny' | 'revise' | \`opt:${number}\``; `export type PendingAction = { requestId: string; userId: string; sessionId: string | null; toolName: string; input: unknown; expiresAt: number }`; `export function registerPendingAction(action: Omit<PendingAction, 'expiresAt'> & { ttlMs: number }): void`; `export function mintActionToken(requestId: string, userId: string | number, decision: NtfyActionDecision): string` → `${base64url(JSON payload)}.${base64url(HMAC-SHA256(secret, payloadB64))}` with payload `{ r: requestId, u: String(userId), d: decision, e: expiresAtMs, n: 8-byte hex nonce }`, `e` = the pending action's `expiresAt`; the secret is `appConfigDb.get('ntfy_action_secret')`, generated as `crypto.randomBytes(32).toString('hex')` and stored on first use (the `getOrCreateJwtSecret` pattern, `repositories/app-config.ts:41-48`), cached in-process; `export function consumeActionToken(token: string): { ok: true; action: PendingAction; decision: NtfyActionDecision } | { ok: false; status: 400 | 401 | 410; reason: string }` — checked in this order: not a string of exactly two non-empty `.`-separated segments, or longer than 2048 chars → 400; the HMAC of the RAW first segment does not equal the second (`crypto.timingSafeEqual` after a length check, computed before the payload is decoded) → 401; the payload does not decode to JSON with string `r`, `u`, `d`, `n` and numeric `e` → 400; `e` in the past or `d` not a known decision shape → 401; nonce already consumed, no pending action for `r`, or `u` mismatch → 410; on success the nonce is recorded (pruned past `e`) and the pending action is deleted.
- **`modules/notifications/services/ntfy-action-decisions.service.ts`** (new): the ntfy-action ↔ permission-decision mapping, born as its own file because it changes for product reasons (a new decision shape, a new tool) while the token service changes for security reasons (Phase 3); it imports `registerPendingAction`, `mintActionToken`, `NtfyActionDecision` and `PendingAction` from the token service and `NtfyAction` from the publish service; the token service never imports this file (the crypto knows nothing about tools). `export function buildNtfyActions(input: { requestId: string; userId: string | number; sessionId: string | null; toolName: string; toolInput: unknown; appUrl: string }): NtfyAction[]` — registers the pending action (ttl 4 h for AskUserQuestion/ExitPlanMode, 5 min otherwise) and returns: AskUserQuestion with exactly one question, not `multiSelect`, 1-3 options → one `http` action per option, label = the option label, decision `opt:<index>`; AskUserQuestion otherwise → `[]`; ExitPlanMode → `Approve` (`allow`) and `Revise` (`revise`); any other tool → `Approve` (`allow`) and `Deny` (`deny`); every url is `${appUrl}/api/ntfy/act?t=${token}`, `method: 'POST'`, `clear: true`; `export function toPermissionDecision(action: PendingAction, decision: NtfyActionDecision): { allow: boolean; updatedInput?: Record<string, unknown>; message?: string } | null` — `allow` → `{ allow: true }`; `deny` → `{ allow: false, message: 'User denied tool use' }`; `revise` → `{ allow: false, message: 'User asked to revise the plan' }` (the string `PlanDisplay.tsx:57-59` sends); `opt:i` → `{ allow: true, updatedInput: { ...input, answers: { [question.question]: option.label } } }` mirroring `AskUserQuestionPanel.tsx:105-122`, `null` when the index is out of range; `export function describeDecision(action, decision): string` → the label for the 200 response.
- **`modules/notifications/ntfy-action.routes.ts`** (new): `export function createNtfyActionRoutes(dependencies: { runtime: { resolveToolApproval(requestId: string, decision: { allow: boolean; updatedInput?: unknown; message?: string }): void } }): express.Router` with one handler `POST /` reading `req.query.t`: missing → 400 `missing token`; `consumeActionToken` failure → its status and reason as `text/plain`; `toPermissionDecision` null → 400 `unknown option`; otherwise `dependencies.runtime.resolveToolApproval(action.requestId, decision)` and 200 `Answered: ${describeDecision(...)}`. A per-IP counter refuses with 429 `too many attempts` after 20 non-200 answers within 60 s. One `console.info('[ntfy] action', status, decisionKind)` per call; the token never appears in a log line. Mounted in `server/index.ts` as `app.use('/api/ntfy/act', createNtfyActionRoutes({ runtime: providerRuntimeService }));` on the line directly AFTER `app.use('/api/notifications', authenticateToken, notificationRoutes);` (`server/index.ts:194`) — its OWN public prefix, the shape the file already uses for a public router of an otherwise-authenticated module (`/api/browser-use-mcp` beside `/api/browser-use`, `:203-206`; `/api/auth`, `/api/agent`), so no mount order is load-bearing and an upstream reorder of `server/index.ts` (this fork absorbs upstream) cannot put `authenticateToken` in front of the phone; a one-line comment says the route authenticates by signed token, not JWT. `app.use('/api', validateApiKey)` (`:151`) still covers it — a no-op unless `API_KEY` is set (unset on this box), named under Edge cases. `providerRuntimeService` is already imported in `server/index.ts` (used at `:105-124`) and exports `resolveToolApproval(requestId, decision)` (`providers/services/provider-runtime.service.ts:94`).
- **`modules/notifications/notifications.routes.ts`** gains four thin routes on the existing `router` (mounted under `/api/notifications` behind `authenticateToken`): `GET /ntfy` → `{ ...toNtfyConfigView(getNtfyConfig(userId)), appUrl: getAppUrl() }`; `PUT /ntfy` body `{ serverUrl?, topic?, token?, longRunMinutes?, enabled?, appUrl? }` → applies `setAppUrl` when `appUrl` is present, then `saveNtfyConfig`, returns the same view shape (400 with `{ error }` on `NtfyConfigError`); `DELETE /ntfy` → `removeNtfyConfig`, `{ ok: true }`; `POST /ntfy/test` → `publishNtfy(target, { title: 'CloudCLI test', message: 'ntfy is connected to CloudCLI.', priority: 3, tags: ['white_check_mark'], click: appUrl ?? undefined })` awaited, returns the `NtfyPublishResult` (404 `{ error: 'ntfy is not configured' }` when no config). `sanitizeEndpoint` (`:11-23`) returns `metadata: maskNtfyMetadata(parsed)` when `endpoint.channel === 'ntfy'`.
- **`modules/notifications/index.ts`** additionally exports `markPresence`, `clearPresence`, `isSessionWatched`, `createNtfyActionRoutes`, `buildNotificationText`.
- **`modules/database/repositories/notification-preferences.ts`**: `NotificationPreferences.events` (`:9-22`) gains `limits: boolean`; `DEFAULT_NOTIFICATION_PREFERENCES.events.limits = true` (`:24-36`); the normalizer (`:56-60`) gains `limits: source.events?.limits !== false`.
- **`modules/providers/list/claude/claude-runtime-signals.ts`** (new): `export type RuntimeSignal = { kind: 'error' | 'limit'; code: string; meta: Record<string, unknown>; severity: 'warning' | 'error'; dedupeKey: string }`; `export type SignalState = { lastApiRetry: { attempt: number; maxRetries: number; errorStatus: number | null; error: string } | null; loginNotified: boolean }`; `export function createSignalState(): SignalState`; `export function detectRuntimeSignals(message: unknown, state: SignalState, context: { sessionId: string | null; emit: (signal: RuntimeSignal) => void }): void` — `rate_limit_event`: status `rejected` → `limit.reached` once per `(rateLimitType, resetsAt)`, arms one `setTimeout(...).unref()` at `resetsAt` (capped at 24 h, only when in the future) that emits `limit.reset` through `context.emit`; status `allowed_warning` → `pct` = `round(utilization * 100)` when `utilization` is a number, else `surpassedThreshold` scaled to percent, else 80; bucket 95 when `pct >= 95` else 80; `limit.warning` once per `(rateLimitType, bucket)` until the type's status returns to `allowed`; status `allowed` after a remembered `rejected` → `limit.reset` and the timer is cleared; `isUsingOverage === true` → `limit.overage` once per type until `isUsingOverage` reads false; `overageDisabledReason === 'out_of_credits'` → `limit.out_of_credits` once per type. `system`/`api_retry` → records `state.lastApiRetry`, emits nothing. `assistant` with `error`: `authentication_failed` or `oauth_org_not_allowed` → `login.expired` once per state; `billing_error` → `limit.out_of_credits`; `max_output_tokens` → nothing; every other value → `api.error` with `{ reason: error, attempts: state.lastApiRetry?.attempt ?? 0, errorStatus: state.lastApiRetry?.errorStatus ?? null }`, then `state.lastApiRetry = null`. `auth_status` with `error` or `isAuthenticating === true` → `login.expired` once per state with `detail` = `error ?? 'sign-in required'`. `result` with `subtype !== 'success'`: `error_max_turns` → `run.limit { limit: 'turns', numTurns }`; `error_max_budget_usd` → `run.limit { limit: 'budget', totalCostUsd }`; anything else → `run.failed { error: (errors ?? []).join('; ') || subtype }`. The rate-limit memory is module-level (the limits are account-wide, not per session); everything else lives in `state`.
- **`modules/providers/list/claude/claude-runtime.provider.js`** changes (net under 40 lines): (a) `sdkOptions.hooks` (`:1034-1053`) gains `PreToolUse: [{ matcher: 'AskUserQuestion|ExitPlanMode', timeout: 86400, hooks: [hook] }]` where the hook returns `{}` unless `HOOK_MODES.has(sdkOptions.permissionMode)` with `HOOK_MODES = new Set(['bypassPermissions', 'auto', 'dontAsk'])`, and otherwise awaits `promptForToolDecision(input.tool_name, input.tool_input, { signal: options.signal, requiresInteraction: true })` and returns `{ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: result.behavior, permissionDecisionReason: result.message, updatedInput: result.behavior === 'allow' ? result.updatedInput : undefined } }`; (b) `promptForToolDecision(toolName, input, { signal, requiresInteraction })` is the interactive path currently inlined at `:1084-1139` (mint requestId, `ws.send` the `permission_request` frame, `emitNotification(permission.required)`, `waitForToolApproval`, `permission_resolved` frame, `rememberEntry` handling, the `PermissionResult`), moved into one closure inside the same scope and called from `canUseTool` and the hook; (c) the `permission.required` event's `meta` (`:1091`) becomes `{ toolName, sessionName: sessionSummary, requestId, toolInput: input }`; (d) after the `system` block (`:1224`) one call `detectRuntimeSignals(message, signalState, { sessionId: sessionId || capturedSessionId || null, emit: (signal) => notifyUserIfEnabled({ userId: runUserId, event: createNotificationEvent({ provider: 'claude', sessionId: sessionId || capturedSessionId || null, requiresUserAction: false, ...signal }) }) })` with `const signalState = createSignalState()` and `const runUserId = ws?.userId || null` declared beside the other per-run state — the emit carries the user id as a VALUE captured when the run started, never a read of `ws` at fire time, because the `limit.reset` timer fires through this same `emit` up to 24 h later, long after the run's writer may have gone; (e) the `notifyRunStopped` at `:1340-1346` gains `durationMs: typeof message.duration_ms === 'number' ? message.duration_ms : null` and is skipped when `message.is_error === true` (the signals module already emitted the failure); the one at `:1387-1393` passes `durationMs: null`.
- **`modules/websocket/services/chat-run-registry.service.ts`**: `ChatRun` (`:30-41`) gains `lastEventAt: number` — set with `startedAt` at `:199` and stamped `run.lastEventAt = Date.now();` at `:98` beside `run.lastSeq += 1;`; `listRunningRuns()` (`:229`) adds `lastEventAt: number` and `userId: string | number | null` (= `run.writer.userId`, `chat-session-writer.service.ts:54`) to its projection. Nothing else changes: the registry stores facts about runs and keeps no memory of what any consumer did with them.
- **`modules/websocket/services/run-stall-watchdog.service.ts`** (new): `export function startRunStallWatchdog(options?: { intervalMs?: number }): () => void` — every `intervalMs` (default 15 000) reads `stallMs` = `Number(appConfigDb.get('run_stall_ms'))` when that is a positive number, else `Number(process.env.CLOUDCLI_STALL_MS)` when positive, else 900 000; holds its own `notifiedAt: Map<string, number>` keyed by app session id — the watchdog's memory of what it sent is the watchdog's, not the registry's; each tick, for every `chatRunRegistry.listRunningRuns()` entry with `now - lastEventAt >= stallMs` and `(notifiedAt.get(sessionId) ?? 0) < lastEventAt` (never notified, or events resumed since the last notice — a second stall in one run is this comparison, not a reset) calls `notifyUserIfEnabled({ userId, event: createNotificationEvent({ provider, sessionId, kind: 'error', code: 'session.stuck', meta: { silentForMs: now - lastEventAt }, severity: 'warning', dedupeKey: \`${provider}:stuck:${sessionId}:${now}\` }) })` and sets `notifiedAt.set(sessionId, now)`; after the pass every `notifiedAt` key absent from the list is deleted; the timer is `unref()`ed; returns the stop function. Exported from `modules/websocket/index.ts`; started in `server/index.ts` inside the same `listen` callback that starts the plan-runner poll.
- **`chat-websocket.service.ts`** gains inbound `chat.presence` `{ sessionId: string | null, visible: boolean }` → `handleChatPresence(ws, userId, data)` → `markPresence(ws, { userId, sessionId, visible })`, and `clearPresence(ws)` inside the existing `ws.on('close')` (`:654-657`). The protocol doc comment (`:525-538`) gains the `chat.presence` line in its inbound list and nothing else — the outbound kinds' one home is the `kind` table in `docs/architecture/README.md`. The inbound vocabulary has two documentary homes that must stay true: the Client → server table in `docs/architecture/README.md` § "The protocol, in two tables" and the `type` table under `docs/architecture/01-websocket-transport.md` § "The chat protocol going up" (its RULE line "five `type` values", the table, and the "five inbound handlers" cell of § "The pieces" all become six). Phase 5 writes those rows; Phase 6 rewrites the "All five are built in exactly two client files" sentence to name `useSessionPresence.ts`.
- **Codex / Cursor / OpenCode runtimes**: each `notifyRunStopped` call (`codex-runtime.provider.ts:439-445`, `cursor-runtime.provider.js:137-143`, `opencode-runtime.provider.js:165-171`) gains `durationMs: Date.now() - runStartedAt` where `const runStartedAt = Date.now()` is declared at the top of the function that spawns the run.

Client (application imports use `@/...`; `type` never `interface`; `import type` for types):

- **`src/shared/types.ts`**: `NotificationPreferencesState.events` (`:1372-1384`) gains `limits: boolean`; new `export type NtfySettingsView = { configured: boolean; enabled: boolean; serverUrl: string; topicMasked: string | null; hasToken: boolean; longRunMinutes: number; appUrl: string | null }` and `export type NtfySettingsInput = { serverUrl?: string; topic?: string; token?: string | null; longRunMinutes?: number; enabled?: boolean; appUrl?: string | null }`, placed directly after `NotificationPreferencesState` with the group comments the frontend standard requires. Edited in place with a minimal diff — this file is being edited by other sessions.
- **`src/shared/api.ts`**: a new top-level `notifications: { ntfy: { get: () => get('/api/notifications/ntfy'), save: (input: NtfySettingsInput) => put('/api/notifications/ntfy', input), remove: () => del('/api/notifications/ntfy'), test: () => post('/api/notifications/ntfy/test') } }` placed directly after the `settings` object closes (`:521`).
- **`src/modules/settings/hooks/useSettingsController.ts`**: `createDefaultNotificationPreferences` and the client `normalizeNotificationPreferences` (used at `:178`) carry `events.limits` (default `true`, preserved on round trip).
- **`src/modules/settings/hooks/useNtfySettings.ts`** (new, module-private): `export function useNtfySettings(): { view: NtfySettingsView | null; isLoading: boolean; draft: { serverUrl: string; topic: string; token: string; longRunMinutes: number; enabled: boolean; appUrl: string }; setDraft: (patch: Partial<draft>) => void; save: () => Promise<void>; remove: () => Promise<void>; sendTest: () => Promise<void>; status: { kind: 'idle' | 'saving' | 'saved' | 'testing' | 'tested' | 'error'; message: string | null } }` — loads `api.notifications.ntfy.get()` on mount; `draft.appUrl` defaults to `view.appUrl ?? window.location.origin`; `save` sends only the fields the draft changed (`token` is sent only when typed, so an untouched field keeps the stored token); `sendTest` shows `ok`/`status`/`error` in `status.message`.
- **`src/modules/settings/NtfySettingsCard.tsx`** (new): `export default function NtfySettingsCard()` composed of `SettingsSection` (`title = t('notifications.ntfy.title')`, `description`) → `SettingsCard divided` → `SettingsRow`s (`src/modules/settings/SettingsSection.tsx`, `SettingsCard.tsx`, `SettingsRow.tsx`, the composition at `AppearanceSettingsTab.tsx:190-216`) holding the shared `Input` (server URL; topic; token with `type="password"` and placeholder `t('notifications.ntfy.tokenKept')` when `view.hasToken`; app URL; long-run minutes with `type="number" min="0"`), `SettingsToggle` for enabled, and a final row with three `Button`s: Save (`variant="tonal"`), Send test (`variant="outline"`, disabled until `view.configured`), Remove (`variant="ghost"`). A status line under the buttons shows `status.message`; the topic is shown masked (`view.topicMasked`) beside the topic input's label once configured. `data-testid`s: `ntfy-card`, `ntfy-server`, `ntfy-topic`, `ntfy-token`, `ntfy-app-url`, `ntfy-long-run`, `ntfy-enabled`, `ntfy-save`, `ntfy-test`, `ntfy-remove`, `ntfy-status`.
- **`src/modules/settings/tabs/NotificationsSettingsTab.tsx`** renders `<NtfySettingsCard />` after the desktop card and gains a fourth event checkbox for `events.limits` in the exact pattern of the `error` checkbox (`:219-232`), label `t('notifications.events.limits')`.
- **`src/modules/chat/hooks/useSessionPresence.ts`** (new, module-private): `export function useSessionPresence(input: { sessionId: string | null; sendMessage: (message: unknown) => void; isConnected: boolean }): void` — sends `{ type: 'chat.presence', sessionId, visible: document.visibilityState === 'visible' }` on mount, whenever `sessionId` or `isConnected` changes, on `visibilitychange`, and every 30 s while visible; sends `{ type: 'chat.presence', sessionId: null, visible: false }` on unmount. Called once in `ChatInterface.tsx` beside `useWebSocket()` (`:89`) with the selected session's id and the context's `sendMessage`/`isConnected` (`WebSocketContext.tsx:11-24`).
- **i18n** (`src/modules/i18n/locales/<locale>/settings.json`, all 11: `de en es fr it ja ko ru tr zh-CN zh-TW`), keys added under `notifications`: `events.limits` "Usage limits"; `ntfy.title` "Phone push (ntfy)"; `ntfy.description` "Send every notification to the ntfy app on your phone."; `ntfy.server` "Server URL"; `ntfy.topic` "Topic"; `ntfy.topicHint` "Anyone who knows the topic can read it — treat it like a password."; `ntfy.token` "Access token"; `ntfy.tokenKept` "Stored — type to replace"; `ntfy.appUrl` "CloudCLI URL"; `ntfy.appUrlHint` "Where a tap on a push opens — the address your phone reaches CloudCLI at."; `ntfy.longRun` "Only notify runs longer than (minutes)"; `ntfy.enabled` "Enabled"; `ntfy.save` "Save"; `ntfy.test` "Send test"; `ntfy.remove` "Remove"; `ntfy.saved` "Saved"; `ntfy.tested` "Test push sent"; `ntfy.testFailed` "Test push failed"; `ntfy.configured` "Sending to {{topic}}".

Verification helper (`.verify/lib/ntfy.mjs`, created in Phase 1, plain ESM, no test runner): `export const API_URL = 'http://127.0.0.1:3011'`, `export const NTFY_SERVER = 'https://ntfy.sh'`, `export const APP_URL = 'http://100.103.222.79:5183'`, `export const SCRATCH_TOPIC_FILE = '/tmp/cloudcli-ntfy-verify/topic'`; `export async function loginToken(): Promise<string>` (POST `/api/auth/login` with `DEV_USER` from `./console.mjs:28`, reading the token field the handler in `server/modules/auth/auth.routes.ts` returns); `export async function api(path, init = {}): Promise<{ ok, status, body }>` (bearer from `loginToken()`); `export function scratchTopic(): string` (reads the file, else writes `cloudcli-verify-<12 hex>` and returns it); `export async function pollTopic(topic, server = NTFY_SERVER): Promise<object[]>` (GET `${server}/${topic}/json?poll=1`, NDJSON → the `event === 'message'` objects); `export async function waitForMessage(topic, predicate, { timeoutMs = 20000, pollMs = 2000 } = {}): Promise<object>` (throws `Error('TIMEOUT')`); `export async function configureNtfy(overrides = {})` (PUT `/api/notifications/ntfy` with `{ serverUrl: NTFY_SERVER, topic: scratchTopic(), appUrl: APP_URL, longRunMinutes: 0, enabled: true, ...overrides }`); `export async function createSession(provider, projectPath)` → the new session id (POST `/api/providers/sessions`, the body shape at `server/modules/providers/provider.routes.ts:727-737`); `export function openChatSocket(token)` → a `WebSocket` on `ws://127.0.0.1:3011/ws?token=...` with `subscribe(sessionId)`, `send(sessionId, content, options)`, `frames` (every parsed frame) and `waitFor(kind, timeoutMs)`; `export function openDb()` (better-sqlite3 on `~/.cloudcli/auth.db`). CLI when run directly: `whoami` prints the username; `topic` prints the scratch topic; `configure [longRunMinutes]` prints `configured=<bool> topicMasked=<s> hasToken=<bool> enabled=<bool> appUrl=<s>`; `test` prints `ok=<bool> status=<n>`; `prefs` prints `limits=<bool>`; `endpoints` prints the raw JSON of GET `/api/notifications/endpoints?channel=ntfy`; `appconfig-set <key> <value>` / `appconfig-del <key>` write `app_config` through `openDb()`.

## Project Constraints

- No unit tests, ever: no `*.test.ts(x)`, no additions under any `tests/` directory (`server/modules/notifications/tests/` exists — leave it), no vitest config edits. `.agents/skills/*/SKILL.md` asks for module tests; the operator's global rule overrides it. Verification is the `check`/`verify` commands in this plan against the running dev server, a real scratch topic on ntfy.sh (`https://ntfy.sh/` answered 200 and a publish-then-`json?poll=1` round trip returned the message, measured 2026-09-11), headless Chromium, and better-sqlite3.
- Never commit, push, branch, stash, checkout or restore inside the run; the tree accumulates and the checkpoint happens after the run, outside this plan. A probe is undone by deleting what it created through the API or the DB, never through git. Uncommitted work from other sessions is in the tree (git-panel, command-palette, project-workspace, `src/shared/types.ts`, `src/shared/constants.ts`, `src/shared/ui/Tabs.tsx`): edit shared files in place with the smallest diff, never reformat or reorder them.
- The dev server is two systemd units (`cloudcli-server-dev` on 127.0.0.1:3011 under `deploy/dev-supervisor/supervisor.mjs`, `cloudcli-client-dev` Vite on 0.0.0.0:5183 — both `active` on 2026-09-11). Never restart either by hand and never run `npm run dev`/`server:dev`. Every save under `server/` hands the API over (about one second; a failed boot keeps the previous server and writes one `[supervisor] boot failed — previous server kept:` journal line): make ALL server edits of a phase in one consecutive pass, file after file, without running typecheck or curl between them; after the last save wait for `journalctl -u cloudcli-server-dev -n 40 --no-pager` to show `handover complete — serving pid` and no `boot failed` line, then run checks. Vite reloads `src/` instantly. The app is reached from other devices at `http://100.103.222.79:5183` (tailnet; Vite proxies `/api` and `/ws` to 3011 — `docs/hosting.md:31-34`), which is also the `public_app_url` this plan records.
- Backend law (`.agents/skills/backend-module-standards/SKILL.md`): TypeScript for every new file under `server/modules/`; import another module only through its `index.ts`; `@/` alias with a `.js` suffix; `type` over `interface`; routes parse and delegate only; export at the declaration with a consumer comment; a utility used in two places goes to `server/shared/utils.ts`, never a module-local `utils.ts`. The orchestrator stays `.js` — it is not migrated. Frontend law (`.agents/skills/frontend-module-standards/SKILL.md`): `@/...` imports only, `type` never `interface`, shared types in `src/shared/types.ts` with a comment each, module-private hooks in `src/modules/<feature>/hooks/`, a comment above every new state declaration, a consumer comment on every exported component, `import type` for types.
- Module size (operator-global doctrine; this repo has no CLAUDE.md of its own): default ceiling 300 LOC per new file; never add more than ~40 lines to a file already over 300 (`claude-runtime.provider.js` 1534, `chat-websocket.service.ts` ~660, `src/shared/types.ts` 1961, `src/shared/api.ts` 679, `useSettingsController.ts` ~400) — new behaviour goes into the sibling modules this plan names. `claude-runtime.provider.js` is over the 800 hard ceiling already; this plan adds under 40 lines to it and names it as the next split, outside this plan.
- `npm run typecheck` must exit 0 and `npm run lint` must report 0 errors and at most 129 warnings (measured 2026-09-11 on the live tree; `.verify/baseline.txt` still says 130 and is stale). A change of this plan's may lower the count, never raise it.
- Secrets: the ntfy topic and access token are credentials. They are stored only in `notification_channel_endpoints.metadata_json`, returned to a client only as `topicMasked` / `hasToken`, never written to a log line, never embedded in a URL or in an error string, never echoed by `POST /ntfy/test`. The action-token secret lives in `app_config` like `jwt_secret`. Descent's `DESCENT_NTFY_TOPIC` is a different credential for a different topic and is never read by this code; Descent's `ov_notifications` are never forwarded through this channel (the operator's ruling in the INTENT LOCK).
- Every user-facing string is an i18n key present in all 11 locales; parity is checked mechanically over THIS PLAN'S OWN KEYS only (every non-English locale already misses unrelated keys, so a whole-file diff can never be clean).
- A probe that imports a server TypeScript module runs as `node_modules/.bin/tsx --tsconfig server/tsconfig.json .verify/ntfy/<probe>.mjs` and imports the module by relative path (`../../server/modules/...service.ts`); that flag is what resolves the module's own `@/` imports (measured 2026-09-11: `node --import tsx` reads the root `tsconfig.json`, maps `@/` to `src/`, and the import fails). Probes that only use `.verify/lib/ntfy.mjs`, HTTP and the websocket run under plain `node`.
- Doc home: `docs/notifications.md` (new in Phase 1) is the ONE home for this feature's documentation; Prometheus writes there and appends verification notes to `docs/verification.md`. No other doc file is created for this feature. The two architecture documents gain only the `chat.presence` row they already own the vocabulary for (Phase 5, Phase 6). `docs/notifications.md` never cites Descent's GOTCHAS or README — the sibling plan deletes those entries — and states the publish discipline (body-not-URL, clamps, never-raise, fire-and-forget) in its own words.

## Phase 1 — Server: the ntfy channel, its config, its copy
Depends on: none

```toml
[phase]
id = "1"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 3600
manifest = [
  "server/modules/notifications/services/ntfy-publish.service.ts",
  "server/modules/notifications/services/ntfy-config.service.ts",
  "server/modules/notifications/services/ntfy-channel.service.ts",
  "server/modules/notifications/services/notification-copy.service.ts",
  "server/modules/notifications/services/notification-orchestrator.service.js",
  "server/modules/notifications/notifications.routes.ts",
  "server/modules/notifications/index.ts",
  "server/modules/database/repositories/notification-preferences.ts",
  ".verify/lib/ntfy.mjs",
  ".verify/ntfy",
  "docs/notifications.md",
  "docs/verification.md",
]
forbidden = [
  "server/modules/providers",
  "server/modules/websocket",
  "server/index.ts",
  "src",
  "server/modules/notifications/tests",
]
athena = [
  "GET /api/notifications/endpoints?channel=ntfy still returns the topic or the token in metadata",
  "publishNtfy builds the URL as <server>/<topic> so the topic lands in fetch error messages and logs",
  "A publish failure (413, 403, DNS) rejects send() and the orchestrator's for-loop over channels stops before the next channel",
  "The copy service still emits 'needs approval' anywhere, or the desktop/web push payload lost a field buildNotificationPayload used to carry",
  "saveNtfyConfig with no token in the body clears the stored token instead of keeping it",
  "The ntfy channel consults preferences.channels.ntfy (which nothing sets) and so never sends",
  "events.limits is dropped by the server normalizer on a PUT that omits it, turning the default off",
]

[[steps]]
kind = "edit"
path = "server/modules/notifications/services/notification-copy.service.ts"
what = "Create buildNotificationText(event) exactly per Interfaces: every code's headline and body, windowLabel, resetsAtText, providerLabel moved from the orchestrator, the humanDuration helper; no 'needs approval' string anywhere."
check = "grep -c 'export function buildNotificationText' server/modules/notifications/services/notification-copy.service.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/notifications/services/ntfy-publish.service.ts"
what = "Create publishNtfy(target, message) per Interfaces: JSON POST to the base URL with the topic in the body, bearer header when a token exists, 5 s AbortSignal timeout, clamps 200/2000/30/3, never throws, topic scrubbed from any error text."
check = "grep -c 'AbortSignal.timeout' server/modules/notifications/services/ntfy-publish.service.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/notifications/services/ntfy-config.service.ts"
what = "Create getNtfyConfig / saveNtfyConfig / removeNtfyConfig / getAppUrl / setAppUrl / toNtfyConfigView / maskNtfyMetadata / NtfyConfigError per Interfaces on notificationChannelEndpointsDb (channel 'ntfy', endpoint 'default') and appConfigDb('public_app_url')."
check = "grep -c \"'public_app_url'\" server/modules/notifications/services/ntfy-config.service.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/notifications/services/ntfy-channel.service.ts"
what = "Create the ntfyChannel entry per Interfaces steps (1)-(9) with isEnabled(_preferences, userId) reading the endpoint row (enabled and a non-empty topic) per Interfaces, priorityFor, tagsFor, click, the long-run gate on meta.durationMs, and a collapse-key stub that always admits (flood control arrives in Phase 2); actions are omitted in this phase."
check = "grep -c \"id: 'ntfy'\" server/modules/notifications/services/ntfy-channel.service.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/database/repositories/notification-preferences.ts"
what = "Add events.limits to the NotificationPreferences type, the defaults (true) and the normalizer (source.events?.limits !== false), beside the existing three event keys."
check = "grep -c 'limits' server/modules/database/repositories/notification-preferences.ts"
expect_re = "^[3-6]$"

[[steps]]
kind = "edit"
path = "server/modules/notifications/services/notification-orchestrator.service.js"
what = "Add limit: 'limits' to KIND_TO_PREF_KEY; replace CODE_MAP and the title/body lines of buildNotificationPayload with buildNotificationText (every other payload field unchanged); register ntfyChannel as the last notificationChannels entry and pass userId as the second argument in the channel loop's isEnabled call; add durationMs = null to notifyRunStopped and forward it in meta. Net line count must not grow."
check = "grep -c \"limit: 'limits'\\|ntfyChannel\\|durationMs\" server/modules/notifications/services/notification-orchestrator.service.js"
expect_re = "^[4-9]$|^1[0-9]$"

[[steps]]
kind = "edit"
path = "server/modules/notifications/notifications.routes.ts"
what = "Add GET /ntfy, PUT /ntfy, DELETE /ntfy, POST /ntfy/test as thin handlers per Interfaces, and mask ntfy metadata in sanitizeEndpoint via maskNtfyMetadata; keep the four existing routes byte-identical."
check = "grep -c \"'/ntfy\" server/modules/notifications/notifications.routes.ts"
expect_re = "^[4-9]$"

[[steps]]
kind = "edit"
path = "server/modules/notifications/index.ts"
what = "Export buildNotificationText from the barrel (the presence and action exports are added in Phase 2); nothing else changes."
check = "grep -c 'buildNotificationText' server/modules/notifications/index.ts"
expect = "1"

[[steps]]
kind = "run"
cmd = "sleep 4; journalctl -u cloudcli-server-dev -n 40 --no-pager | tail -5"
check = "journalctl -u cloudcli-server-dev -n 60 --no-pager | grep -E 'handover complete|serving pid' | tail -1 | grep -c 'pid'"
expect = "1"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint 2>&1 | tail -1"
check = "npm run typecheck >/dev/null 2>&1 && echo typecheck=0; npm run lint 2>&1 | grep -c ': error' | sed 's/^/errors=/'; npm run lint 2>&1 | grep -c ': warning' | awk '{print ($1<=129) ? \"warnings=ok\" : \"warnings=\" $1}'"
expect = "typecheck=0\nerrors=0\nwarnings=ok"

[[steps]]
kind = "edit"
path = ".verify/lib/ntfy.mjs"
what = "Create the verification helper per Interfaces (loginToken via POST /api/auth/login with DEV_USER from ./console.mjs, api, scratchTopic, pollTopic, waitForMessage, configureNtfy, createSession, openChatSocket, openDb, and the CLI verbs whoami/topic/configure/test/prefs/endpoints/appconfig-set/appconfig-del)."
check = "node .verify/lib/ntfy.mjs whoami"
expect = "verve"

[[steps]]
kind = "run"
cmd = "node .verify/lib/ntfy.mjs configure 0"
check = "node .verify/lib/ntfy.mjs configure 0 | sed -E 's/topicMasked=[^ ]+/topicMasked=<masked>/'"
expect = "configured=true topicMasked=<masked> hasToken=false enabled=true appUrl=http://100.103.222.79:5183"

[[steps]]
kind = "run"
cmd = "node .verify/lib/ntfy.mjs test"
check = "node .verify/lib/ntfy.mjs test; sleep 3; curl -s \"https://ntfy.sh/$(cat /tmp/cloudcli-ntfy-verify/topic)/json?poll=1\" | grep -c '\"title\":\"CloudCLI test\"' | awk '{print ($1>=1) ? \"test-push=seen\" : \"test-push=missing\"}'"
expect = "ok=true status=200\ntest-push=seen"

[[steps]]
kind = "run"
cmd = "node .verify/lib/ntfy.mjs endpoints"
check = "T=$(cat /tmp/cloudcli-ntfy-verify/topic); node .verify/lib/ntfy.mjs endpoints | { grep -c \"$T\" || true; } | sed 's/^/topic-leaks=/'; node .verify/lib/ntfy.mjs prefs"
expect = "topic-leaks=0\nlimits=true"

[[steps]]
kind = "edit"
path = ".verify/ntfy/run-failed-probe.mjs"
what = "Write the run-failed probe exactly as the phase body describes (configureNtfy, a cursor session, chat.send, waitForMessage on 'Session crashed' with the session click, priority 4, rotating_light tag; PROBE OK line or PROBE FAILED plus the journal tail)."
check = "test -s .verify/ntfy/run-failed-probe.mjs && grep -c 'Session crashed' .verify/ntfy/run-failed-probe.mjs"
expect_re = "^[1-9]$"

[[steps]]
kind = "run"
cmd = "grep -rn 'needs approval\\|needs your approval' server src --include=*.ts --include=*.tsx --include=*.js | grep -v tests | grep -v '/i18n/' || true"
check = "grep -rn 'needs approval\\|needs your approval' server src --include=*.ts --include=*.tsx --include=*.js | grep -v '/tests/' | grep -v '/i18n/' | wc -l"
expect = "0"

[[verify]]
cmd = "node .verify/ntfy/run-failed-probe.mjs"
expect = "PROBE OK run.failed pushed priority=4 click-session=match"
timeout_s = 240
```

**What to build.** The channel and everything it needs to send one real push from the running server: the sender, the config service on the existing endpoints table, the copy service that replaces `CODE_MAP`, the `limits` preference, the four config routes, the verification helper, and one real-event probe.

**The probe you write** (`.verify/ntfy/run-failed-probe.mjs`): `configureNtfy()`; `createSession('cursor', '/tmp/cloudcli-ntfy-probe')` (`mkdir -p` it first); open a chat socket, `subscribe(sessionId)`, `send(sessionId, 'hello', {})`. The Cursor CLI is not installed on this box (`which cursor-agent` and `which agent` both answer nothing, measured 2026-09-11), so the cursor runtime's exit path (`cursor-runtime.provider.js:147-153`) calls `notifyRunFailed` — a real `run.failed` event through the real orchestrator, zero Claude turns. Then `waitForMessage(topic, m => m.title.startsWith('Session crashed') && m.click === \`${APP_URL}/session/${sessionId}\`, { timeoutMs: 45000 })` and assert `m.priority === 4` and `m.tags` includes `rotating_light`. Print exactly `PROBE OK run.failed pushed priority=4 click-session=match`. On timeout print `PROBE FAILED` followed by the last 40 lines of `journalctl -u cloudcli-server-dev --no-pager` and exit 1.

**Sirens.** You will see `POST /endpoints/current` can write arbitrary `ntfy` metadata past `saveNtfyConfig`'s validation; do not touch that route — Phase 3 audits it. You will want to wire `channels.ntfy` into preferences the way web push does; do not — the endpoint row's `enabled` is the one source and `isEnabled(_preferences, userId)` reads it, because a preference flag the client normalizer does not know about gets written back as `false` on the next auto-save. You will be tempted to migrate the orchestrator to TypeScript while you are in it; do not — it stays `.js`, and it must not grow. You will see that `normalizeNotificationSession` and `providerLabel` are private to the orchestrator; move `providerLabel` into the copy service and leave `normalizeNotificationSession` where it is. If the login handler in `auth.routes.ts` names its token field differently from what you expect, read it and use that name — do not mint a JWT by hand. If the run-failed probe times out AND the journal shows the cursor spawn error without a notification line, stop: report the journal excerpt verbatim as the divergence; do not switch the probe to another provider.

**Reversible defaults taken here** (each with its reversal): the ntfy channel row is keyed `endpoint_id = 'default'` (reversal: one row per device label); the long-run threshold defaults to 5 minutes (reversal: one constant); `topicMasked` shows two leading and two trailing characters (reversal: one function).

## Phase 2 — Server: tap-to-answer tokens, the public act route, presence, flood control
Depends on: Phase 1

```toml
[phase]
id = "2"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 3600
manifest = [
  "server/modules/notifications/services/ntfy-action-token.service.ts",
  "server/modules/notifications/services/ntfy-action-decisions.service.ts",
  "server/modules/notifications/services/ntfy-flood-control.service.ts",
  "server/modules/notifications/services/session-presence.service.ts",
  "server/modules/notifications/services/ntfy-channel.service.ts",
  "server/modules/notifications/ntfy-action.routes.ts",
  "server/modules/notifications/index.ts",
  "server/index.ts",
  ".verify/lib/ntfy.mjs",
  ".verify/ntfy",
  "docs/notifications.md",
  "docs/verification.md",
]
forbidden = [
  "server/modules/providers",
  "server/modules/websocket",
  "server/modules/notifications/services/ntfy-publish.service.ts",
  "server/modules/notifications/services/ntfy-config.service.ts",
  "server/modules/notifications/services/notification-copy.service.ts",
  "server/modules/notifications/services/notification-orchestrator.service.js",
  "server/modules/notifications/notifications.routes.ts",
  "src",
]
athena = [
  "A consumed token still resolves a second time because the nonce set is checked after resolveToolApproval is called",
  "A token minted for decision 'deny' verifies for 'allow' because the decision is not inside the signed payload",
  "The act router is mounted with authenticateToken, or under the authenticated /api/notifications prefix instead of its own /api/ntfy/act, so the phone gets a 401 today or after a mount reorder",
  "consumeActionToken or mintActionToken knows a tool or option name — the decision mapping leaked into the crypto file",
  "timingSafeEqual is called on buffers of different length and throws, turning a forged token into a 500",
  "Flood control suppresses the FIRST push of a burst (debounce) instead of the repeats, delaying a needs-you buzz",
  "isSessionWatched returns true for another user's tab on the same session id, or for a connection that closed without clearPresence",
  "The summary push repeats at priority 4 or carries the collapse key or the token in its text",
]

[[steps]]
kind = "edit"
path = "server/modules/notifications/services/ntfy-action-token.service.ts"
what = "Create registerPendingAction, mintActionToken, consumeActionToken per Interfaces: HMAC-SHA256 over the base64url payload with the app_config 'ntfy_action_secret', timingSafeEqual after a length check, nonce set pruned by expiry, pending map pruned by expiry. This file knows nothing about tools or options."
check = "grep -c 'timingSafeEqual' server/modules/notifications/services/ntfy-action-token.service.ts; { grep -c 'AskUserQuestion\\|ExitPlanMode' server/modules/notifications/services/ntfy-action-token.service.ts || true; }"
expect_re = "^[1-9]\\n0$"

[[steps]]
kind = "edit"
path = "server/modules/notifications/services/ntfy-action-decisions.service.ts"
what = "Create buildNtfyActions, toPermissionDecision, describeDecision per Interfaces, importing registerPendingAction / mintActionToken and the two types from the token service and NtfyAction from the publish service; every action url is <appUrl>/api/ntfy/act?t=<token>."
check = "grep -c 'export function buildNtfyActions\\|export function toPermissionDecision\\|export function describeDecision' server/modules/notifications/services/ntfy-action-decisions.service.ts"
expect = "3"

[[steps]]
kind = "edit"
path = "server/modules/notifications/services/ntfy-flood-control.service.ts"
what = "Create createFloodControl({ windowMs, onWindowClose }) per Interfaces: leading-edge admit, counted suppression, one onWindowClose call with the count when count > 0, timers unref()ed."
check = "grep -c 'unref()' server/modules/notifications/services/ntfy-flood-control.service.ts"
expect_re = "^[1-9]$"

[[steps]]
kind = "edit"
path = "server/modules/notifications/services/session-presence.service.ts"
what = "Create markPresence, clearPresence, isSessionWatched per Interfaces on a Map keyed by the connection object, with the 90 s freshness rule and String() comparison of userId."
check = "grep -c 'export function isSessionWatched' server/modules/notifications/services/session-presence.service.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/notifications/services/ntfy-channel.service.ts"
what = "Replace the always-admit stub with createFloodControl (window close publishes the summary push per Interfaces), add the isSessionWatched skip at step (2), and attach buildNtfyActions at step (7) for permission.required events that carry meta.requestId when an app URL exists."
check = "grep -c 'isSessionWatched\\|buildNtfyActions\\|createFloodControl' server/modules/notifications/services/ntfy-channel.service.ts"
expect_re = "^[3-9]$"

[[steps]]
kind = "edit"
path = "server/modules/notifications/ntfy-action.routes.ts"
what = "Create createNtfyActionRoutes({ runtime }) per Interfaces: POST / reading req.query.t, 400/401/410/429 text answers, resolveToolApproval on success, 200 'Answered: <label>', a per-IP failure counter, one log line per call without the token."
check = "grep -c 'export function createNtfyActionRoutes' server/modules/notifications/ntfy-action.routes.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/notifications/index.ts"
what = "Export markPresence, clearPresence, isSessionWatched and createNtfyActionRoutes from the barrel."
check = "grep -c 'isSessionWatched\\|createNtfyActionRoutes\\|markPresence\\|clearPresence' server/modules/notifications/index.ts"
expect_re = "^[2-9]$"

[[steps]]
kind = "edit"
path = "server/index.ts"
what = "Mount app.use('/api/ntfy/act', createNtfyActionRoutes({ runtime: providerRuntimeService })) on the line directly after the authenticated /api/notifications mount — its own public prefix, never a child of /api/notifications — with a one-line comment saying the route authenticates by signed token, not JWT; import createNtfyActionRoutes from the notifications barrel."
check = "grep -c \"app.use('/api/ntfy/act', createNtfyActionRoutes\" server/index.ts; grep \"app.use('/api/ntfy/act'\" server/index.ts | { grep -c authenticateToken || true; }"
expect = "1\n0"

[[steps]]
kind = "run"
cmd = "sleep 4; journalctl -u cloudcli-server-dev -n 40 --no-pager | tail -5"
check = "journalctl -u cloudcli-server-dev -n 60 --no-pager | grep -E 'handover complete|serving pid' | tail -1 | grep -c 'pid'"
expect = "1"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint 2>&1 | tail -1"
check = "npm run typecheck >/dev/null 2>&1 && echo typecheck=0; npm run lint 2>&1 | grep -c ': error' | sed 's/^/errors=/'; npm run lint 2>&1 | grep -c ': warning' | awk '{print ($1<=129) ? \"warnings=ok\" : \"warnings=\" $1}'"
expect = "typecheck=0\nerrors=0\nwarnings=ok"

[[steps]]
kind = "edit"
path = ".verify/ntfy/token-probe.mjs"
what = "Write the token probe exactly as the phase body describes: parts (1)-(8), real modules imported by relative path, the real act route over HTTP, one summary line matching the verify expect."
check = "test -s .verify/ntfy/token-probe.mjs && grep -c 'consumeActionToken' .verify/ntfy/token-probe.mjs"
expect_re = "^[1-9]$"

[[steps]]
kind = "run"
cmd = "curl -s -o /dev/null -w '%{http_code}\\n' -X POST http://127.0.0.1:3011/api/ntfy/act"
check = "printf 'no-token=%s ' $(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3011/api/ntfy/act); printf 'garbage=%s ' $(curl -s -o /dev/null -w '%{http_code}' -X POST 'http://127.0.0.1:3011/api/ntfy/act?t=abc.def'); printf 'sibling-unauth=%s\\n' $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3011/api/notifications/ntfy)"
expect = "no-token=400 garbage=401 sibling-unauth=401"

[[verify]]
cmd = "node_modules/.bin/tsx --tsconfig server/tsconfig.json .verify/ntfy/token-probe.mjs"
expect = "PROBE OK unknown-request=410 tamper=401 expired=401 swap=401 replay=410 flood=1+1 presence=ok"
timeout_s = 180
```

**What to build.** The signed single-use action tokens, the public act route that consumes them, the presence registry, and the flood-control window — and wire all three into the channel's `send`.

**The probe you write** (`.verify/ntfy/token-probe.mjs`). It runs the REAL modules in-process where the behaviour is pure, and the REAL route over HTTP where it is not: (1) import `../../server/modules/notifications/services/ntfy-action-token.service.ts`, `ntfy-flood-control.service.ts` and `session-presence.service.ts` by relative path (the probe runs under `node_modules/.bin/tsx --tsconfig server/tsconfig.json`, which is what makes their `@/` imports resolve), read the secret with `openDb()` from `app_config.ntfy_action_secret` — create it there first with `crypto.randomBytes(32).toString('hex')` when absent, so the server and the probe share one secret from the first request on; (2) `registerPendingAction` + `mintActionToken` for a fake request id, then POST that token to the running server's act route → the server has no pending action for it → expect 410 (`unknown-request=410`); (3) flip one character of the signature → 401; (4) a payload with `e` in the past, re-signed → 401; (5) a payload whose `d` is changed from `deny` to `allow` without re-signing → 401; (6) call `consumeActionToken` twice in-process on one token → second answer `410` (`replay=410`); (7) `createFloodControl({ windowMs: 1500, onWindowClose })` admitted 4 times for one key → the first returns true, three return false, `onWindowClose(key, 3)` fires once (`flood=1+1`); (8) `markPresence` / `isSessionWatched` for the same user + session → true, a different user → false, `clearPresence` → false, `freshMs: 1` after `setTimeout(5)` → false (`presence=ok`). Print the one-line summary exactly as `expect` shows.

**Sirens.** You will want to accept a JWT on the act route "as a convenience"; do not — the phone never has one and a bearer path is a second door for Argus to close. You will want to put the presence registry in the websocket module because that is where `chat.presence` will arrive; do not — the channel would then import the websocket barrel and close an import cycle (websocket → providers → notifications → websocket); Phase 5 imports presence FROM the notifications barrel. You will be tempted to make flood control a debounce that holds the first push; do not — the first push goes out at once, repeats are counted. When `consumeActionToken` succeeds, delete the pending action and record the nonce BEFORE calling `resolveToolApproval`, so a throw inside the runtime cannot leave a reusable token. The real end-to-end tap (a live question answered through the route) is Phase 4's verify; do not try to produce a live permission request here. The decisions file imports the token service, never the reverse — if you find yourself teaching `consumeActionToken` what an option is, stop.

## Phase 3 — Argus audits the tap-to-answer surface
Depends on: Phase 2

```toml
[phase]
id = "3"
builder = "argus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "server/modules/notifications/services/ntfy-action-token.service.ts",
  "server/modules/notifications/services/ntfy-action-decisions.service.ts",
  "server/modules/notifications/ntfy-action.routes.ts",
  "server/modules/notifications/services/ntfy-channel.service.ts",
  "server/modules/notifications/services/ntfy-publish.service.ts",
  "server/modules/notifications/services/ntfy-config.service.ts",
  "server/modules/notifications/notifications.routes.ts",
  ".verify/ntfy",
  "docs/notifications.md",
]
forbidden = [
  "server/modules/providers",
  "server/modules/websocket",
  "server/modules/database",
  "server/index.ts",
  "src",
]
athena = [
  "The audit report says a probe passed but the probe script prints its summary unconditionally",
  "A fix Argus made changed the token format so Phase 2's token-probe no longer passes",
  "The per-IP limiter keys on req.ip behind the Vite proxy, so every phone request shares 127.0.0.1 and one attacker locks out the phone",
  "POST /endpoints/current with channel=ntfy stores an unvalidated topic and GET /ntfy then throws instead of masking",
]

[[steps]]
kind = "run"
cmd = "node_modules/.bin/tsx --tsconfig server/tsconfig.json .verify/ntfy/token-probe.mjs"
check = "node_modules/.bin/tsx --tsconfig server/tsconfig.json .verify/ntfy/token-probe.mjs"
expect = "PROBE OK unknown-request=410 tamper=401 expired=401 swap=401 replay=410 flood=1+1 presence=ok"

[[steps]]
kind = "edit"
path = ".verify/ntfy/argus-probe.mjs"
what = "Write the attack probe per the phase body: JWT-on-act-route ignored, cross-user token 410, oversize token 400/401 without a 500, 25 bad tokens from one client then 429, secrets absent from the journal and from GET /ntfy and GET /endpoints, POST /endpoints/current channel=ntfy junk metadata then GET /ntfy answers 200 with topicMasked null. Print exactly one summary line."
check = "node_modules/.bin/tsx --tsconfig server/tsconfig.json .verify/ntfy/argus-probe.mjs"
expect = "ARGUS OK jwt-ignored=401 cross-user=410 oversize=no-500 limiter=429 journal-secrets=0 masked=ok junk-metadata=200"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint 2>&1 | tail -1"
check = "npm run typecheck >/dev/null 2>&1 && echo typecheck=0; npm run lint 2>&1 | grep -c ': error' | sed 's/^/errors=/'; npm run lint 2>&1 | grep -c ': warning' | awk '{print ($1<=129) ? \"warnings=ok\" : \"warnings=\" $1}'"
expect = "typecheck=0\nerrors=0\nwarnings=ok"

[[verify]]
cmd = "node_modules/.bin/tsx --tsconfig server/tsconfig.json .verify/ntfy/argus-probe.mjs && node_modules/.bin/tsx --tsconfig server/tsconfig.json .verify/ntfy/token-probe.mjs | cut -c1-8"
expect = "ARGUS OK jwt-ignored=401 cross-user=410 oversize=no-500 limiter=429 journal-secrets=0 masked=ok junk-metadata=200\nPROBE OK"
timeout_s = 240
```

**What to do.** Review the auth surface Phase 2 built as an attacker would, fix what you find in place (the manifest is yours), and leave a probe that proves each finding closed. The surface: an unauthenticated `POST /api/ntfy/act?t=<token>` reachable from the tailnet, whose token is HMAC-signed, bound to `(requestId, userId, decision)`, single-use, time-limited; the token is carried in an ntfy message body that the ntfy server (public ntfy.sh by default) stores for its cache window; the topic is the only thing protecting that message.

**Probes the audit must run** (`.verify/ntfy/argus-probe.mjs`, using `.verify/lib/ntfy.mjs`; the in-process parts import the token service the way Phase 2's token-probe does): (1) POST the act route with a valid bearer JWT for the dev user AND `t=abc.def` → 401, never a permission resolution — the JWT buys nothing; (2) in-process: `registerPendingAction` for the dev user's id, `mintActionToken` for user id `999` on that same request id, `consumeActionToken` → 410; (3) a 64 KiB `t=` query → 400 or 401, never 500; (4) 25 bad tokens from one client inside 60 s → the 21st onward answers 429; (5) `journalctl -u cloudcli-server-dev --since '-2 hours' --no-pager` contains neither the scratch topic, nor the value of `app_config.ntfy_action_secret`, nor the substring `act?t=`; `GET /ntfy` and `GET /endpoints?channel=ntfy` contain neither the topic nor the token; (6) `POST /endpoints/current` with `channel: 'ntfy'`, `endpointId: 'default'`, `metadata: { junk: true }` → then `GET /ntfy` answers 200 with `topicMasked: null` and `configured: false`, and a following `configureNtfy()` restores a valid row. Print exactly the `ARGUS OK …` line the check expects; any failure prints `ARGUS FAILED <which>` and exits 1.

**Judgement calls that are yours** (fix in place if you judge them open; say so in your report either way): the limiter's client key behind the Vite proxy (`X-Forwarded-For` is set by Vite's proxy — read it only when the request came from loopback); whether the act route should also require the ntfy `topic` as a second factor (it must not — the topic would then ride in a URL); whether the token TTL of 4 h for questions is too long (the pending action is deleted the moment the browser answers, so a stale token answers 410 — keep it unless you find a hole).

**Sirens.** You will want to add rate limiting middleware from npm; do not add a dependency — a `Map<string, number[]>` is enough. You will want to rotate the secret on every boot; do not — a restart would orphan every token already on a phone. Do not rewrite Phase 2's token format; extend `consumeActionToken`'s checks. Do not touch `server/modules/database` — if a repository needs a change, report it as a divergence.

## Phase 4 — Claude runtime: questions in every mode, rate limits, API errors, result signals
Depends on: Phase 2

```toml
[phase]
id = "4"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 3600
manifest = [
  "server/modules/providers/list/claude/claude-runtime.provider.js",
  "server/modules/providers/list/claude/claude-runtime-signals.ts",
  ".verify/ntfy",
  "docs/notifications.md",
  "docs/verification.md",
]
forbidden = [
  "server/modules/notifications",
  "server/modules/websocket",
  "server/modules/database",
  "server/index.ts",
  "src",
  "server/modules/providers/list/codex",
  "server/modules/providers/list/cursor",
  "server/modules/providers/list/opencode",
]
athena = [
  "In bypassPermissions mode the model answers its own AskUserQuestion (no permission_request frame) because the hook returned {} for a mode name that differs from the three listed",
  "In default mode one AskUserQuestion produces two permission_request frames (hook + canUseTool)",
  "The phone's option label never reaches the model: the hook's updatedInput is missing the answers map or is keyed by index instead of question text",
  "A result with is_error=true still fires notifyRunStopped as 'Run finished' beside the run.limit push",
  "limit.reset fires on every rate_limit_event with status allowed, not only after a remembered rejected",
  "api.error fires per api_retry instead of once on the assistant error message",
  "The reset timer captures a ws whose userId is null after the session ends, so limit.reset is dropped silently",
  "claude-runtime.provider.js grew by more than 40 lines",
]

[[steps]]
kind = "edit"
path = "server/modules/providers/list/claude/claude-runtime-signals.ts"
what = "Create createSignalState and detectRuntimeSignals per Interfaces: rate_limit_event memory per rateLimitType with the resetsAt timer, api_retry recording, assistant.error mapping, auth_status, and result error subtypes; every emitted signal carries kind, code, meta, severity, dedupeKey."
check = "grep -c 'export function detectRuntimeSignals\\|export function createSignalState' server/modules/providers/list/claude/claude-runtime-signals.ts"
expect = "2"

[[steps]]
kind = "edit"
path = "server/modules/providers/list/claude/claude-runtime.provider.js"
what = "Apply changes (a)-(e) per Interfaces: the PreToolUse hook for AskUserQuestion|ExitPlanMode that acts only when sdkOptions.permissionMode is in HOOK_MODES, the promptForToolDecision closure shared with canUseTool, requestId + toolInput in the permission.required meta, the detectRuntimeSignals call after the system block with runUserId captured beside signalState, durationMs on notifyRunStopped and the is_error skip."
check = "grep -c \"PreToolUse\\|promptForToolDecision\\|detectRuntimeSignals\\|toolInput: input\\|duration_ms\" server/modules/providers/list/claude/claude-runtime.provider.js"
expect_re = "^([6-9]|1[0-9])$"

[[steps]]
kind = "run"
cmd = "wc -l server/modules/providers/list/claude/claude-runtime.provider.js"
check = "wc -l < server/modules/providers/list/claude/claude-runtime.provider.js | awk '{print ($1<=1574) ? \"runtime-growth=ok\" : \"runtime-growth=\" $1}'"
expect = "runtime-growth=ok"

[[steps]]
kind = "run"
cmd = "sleep 4; journalctl -u cloudcli-server-dev -n 40 --no-pager | tail -5"
check = "journalctl -u cloudcli-server-dev -n 60 --no-pager | grep -E 'handover complete|serving pid' | tail -1 | grep -c 'pid'"
expect = "1"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint 2>&1 | tail -1"
check = "npm run typecheck >/dev/null 2>&1 && echo typecheck=0; npm run lint 2>&1 | grep -c ': error' | sed 's/^/errors=/'; npm run lint 2>&1 | grep -c ': warning' | awk '{print ($1<=129) ? \"warnings=ok\" : \"warnings=\" $1}'"
expect = "typecheck=0\nerrors=0\nwarnings=ok"

[[steps]]
kind = "edit"
path = ".verify/ntfy/signals-probe.mjs"
what = "Feed detectRuntimeSignals (imported by relative path from ../../server/modules/providers/list/claude/claude-runtime-signals.ts) the SDK-shaped messages listed in the phase body and print the emitted codes in order on one line."
check = "node_modules/.bin/tsx --tsconfig server/tsconfig.json .verify/ntfy/signals-probe.mjs"
expect = "limit.warning:80 limit.warning:95 limit.reached limit.reset limit.overage limit.out_of_credits api.error:overloaded login.expired run.limit:turns run.limit:budget run.failed"

[[steps]]
kind = "edit"
path = ".verify/ntfy/question-probe.mjs"
what = "Write the question probe exactly as the phase body describes: both permission modes, the permission_request frame, the ntfy message with two actions, the POST to the Blue action url as the phone, permission_resolved, the completion frame, the reply text; one summary line matching the verify expect."
check = "test -s .verify/ntfy/question-probe.mjs && grep -c 'bypassPermissions' .verify/ntfy/question-probe.mjs"
expect_re = "^[1-9]$"

[[verify]]
cmd = "node .verify/ntfy/question-probe.mjs"
expect = "PROBE OK bypass: frames=1 push=question actions=2 answered=Blue reply=Blue | default: frames=1 push=question actions=2 answered=Blue reply=Blue"
timeout_s = 900
```

**What to build.** The signals module and the five runtime edits. The runtime file is 1534 lines and already past the hard ceiling: every line of new logic lives in `claude-runtime-signals.ts`; the runtime gets the hook registration, the shared closure, three one-line edits and one call.

**The signals probe** (`.verify/ntfy/signals-probe.mjs`) feeds one `state` these messages in order and prints each emitted `code` (with `:` + `meta.pct` for warnings, `:` + `meta.reason` for `api.error`, `:` + `meta.limit` for `run.limit`), space-separated: `rate_limit_event {status:'allowed_warning', rateLimitType:'five_hour', utilization:0.82}` → `limit.warning:80`; the same at `0.96` → `limit.warning:95`; the same at `0.97` → nothing; `{status:'rejected', rateLimitType:'five_hour', resetsAt: <now+3600 s>}` → `limit.reached`; `{status:'allowed', rateLimitType:'five_hour'}` → `limit.reset`; `{status:'allowed', rateLimitType:'five_hour', isUsingOverage:true}` → `limit.overage`; `{status:'allowed', rateLimitType:'five_hour', isUsingOverage:true, overageDisabledReason:'out_of_credits'}` → `limit.out_of_credits`; `system/api_retry {attempt:3, max_retries:10, error_status:529, error:'overloaded'}` → nothing; `assistant {error:'overloaded'}` → `api.error:overloaded`; `auth_status {isAuthenticating:true, output:[]}` → `login.expired`; `result {subtype:'error_max_turns', is_error:true, num_turns:50}` → `run.limit:turns`; `result {subtype:'error_max_budget_usd', is_error:true, total_cost_usd:5}` → `run.limit:budget`; `result {subtype:'error_during_execution', is_error:true, errors:['boom']}` → `run.failed`. Use a fresh `rateLimitType` string per probe run (append a random suffix) so the module-level memory from an earlier run cannot swallow a signal.

**The question probe** (`.verify/ntfy/question-probe.mjs`) is the end-to-end proof and spends two real Claude turns: `configureNtfy()`; for each mode in `['bypassPermissions', 'default']`: `createSession('claude', '/tmp/cloudcli-ntfy-probe')`, open a chat socket, `subscribe`, `send(sessionId, "Call the AskUserQuestion tool exactly once with one question 'Which color?' and exactly two options labelled 'Red' and 'Blue' (single select). After I answer, reply with only the word I chose and nothing else.", { permissionMode: mode })`; wait for a `permission_request` frame with `toolName === 'AskUserQuestion'` (≤ 180 s); `waitForMessage(topic, m => m.title.startsWith('Question') && m.message.includes('Which color') && m.click.endsWith('/session/' + sessionId))`; assert `m.priority === 4`, `m.actions.length === 2`, labels `Red` and `Blue`, and `m.message` contains `1. Red` and `2. Blue`; POST the `Blue` action's `url` (plain `fetch`, no headers — you are the phone) → 200 body starting `Answered:`; wait for a `permission_resolved` frame, then for the turn's completion frame (≤ 180 s); assert exactly one `permission_request` frame arrived for that session and that the assistant's final text (the last assistant frame's text content) contains `Blue`. Print the one line `expect` shows. On any failure print `PROBE FAILED <mode> <step>` plus the frame kinds received and exit 1.

**Sirens.** In `default` mode the hook must return `{}` and let `canUseTool` prompt — if the default-mode run shows ZERO `permission_request` frames, the reversible default is to add `'default'` and `'acceptEdits'` to `HOOK_MODES` (the SDK skipped `canUseTool` for the interactive tool in that mode too); if it shows TWO, stop and report — do not add de-duplication by `tool_use_id`. Pass `options.signal` from the hook into `waitForToolApproval` so an aborted turn cancels the pending prompt with the existing `permission_cancelled` frame. Do not read `permissionMode` from a captured constant — `sdkOptions.permissionMode` is mutated in place (`:926-927`) and must be read at call time. `hooks` is a sibling of `canUseTool` in `sdkOptions`, never nested inside it. Do not touch the `Notification` hook. `duration_ms` is on the SDK result message, not on the run — do not reach for the registry. The signals module must not import the orchestrator; it emits through the `emit` callback only. Do not change the `permission_request` ws frame's shape. The signals `emit` carries `runUserId` — a value captured at run start — never `ws?.userId` read at fire time.

## Phase 5 — Stall watchdog, presence over the socket, durations for the other providers
Depends on: Phase 2

```toml
[phase]
id = "5"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 3000
manifest = [
  "server/modules/websocket/services/chat-run-registry.service.ts",
  "server/modules/websocket/services/chat-websocket.service.ts",
  "server/modules/websocket/services/run-stall-watchdog.service.ts",
  "server/modules/websocket/index.ts",
  "server/index.ts",
  "server/modules/providers/list/codex/codex-runtime.provider.ts",
  "server/modules/providers/list/cursor/cursor-runtime.provider.js",
  "server/modules/providers/list/opencode/opencode-runtime.provider.js",
  ".verify/ntfy",
  "docs/notifications.md",
  "docs/verification.md",
  "docs/architecture/README.md",
  "docs/architecture/01-websocket-transport.md",
]
forbidden = [
  "server/modules/notifications",
  "server/modules/providers/list/claude",
  "server/modules/database",
  "src",
]
athena = [
  "lastEventAt is stamped only in startRun, so every run reads as stalled exactly stallMs after it starts",
  "The watchdog never compares notifiedAt against lastEventAt, or never sets it, so a second stall in one run is silent or every tick re-notifies",
  "The registry grew a stallNotifiedAt field or a take-with-side-effect method, so the actuator's memory lives in the store",
  "chat.presence landed in the service doc comment but not in the two architecture documents' inbound tables, or the RULE still says five",
  "The watchdog reads run_stall_ms once at boot instead of every tick, so the probe's override never applies",
  "chat.presence from one socket overwrites another socket's record for the same user (keyed by userId instead of the connection)",
  "The socket close handler clears presence but a socket that errors without closing keeps a stale visible=true forever (the 90 s rule must cover it)",
  "runStartedAt in a provider file is captured at module load instead of at spawn",
]

[[steps]]
kind = "edit"
path = "server/modules/websocket/services/chat-run-registry.service.ts"
what = "Add lastEventAt to ChatRun (set at startRun beside startedAt, stamped at the lastSeq increment) and add lastEventAt and userId (run.writer.userId) to the listRunningRuns() projection per Interfaces; no other field, no new method."
check = "grep -c 'lastEventAt' server/modules/websocket/services/chat-run-registry.service.ts; { grep -c 'stallNotifiedAt\\|takeStalledRuns' server/modules/websocket/services/chat-run-registry.service.ts || true; }"
expect_re = "^[3-8]\\n0$"

[[steps]]
kind = "edit"
path = "server/modules/websocket/services/run-stall-watchdog.service.ts"
what = "Create startRunStallWatchdog per Interfaces: 15 s interval, stallMs from app_config run_stall_ms then CLOUDCLI_STALL_MS then 900000, its own notifiedAt map, listRunningRuns() read each tick, the lastEventAt-versus-notifiedAt comparison, notifyUserIfEnabled with the session.stuck event, keys pruned after the pass, unref, returns stop."
check = "grep -c \"run_stall_ms\\|session.stuck\\|notifiedAt\\|listRunningRuns\" server/modules/websocket/services/run-stall-watchdog.service.ts"
expect_re = "^([4-9]|1[0-9])$"

[[steps]]
kind = "edit"
path = "server/modules/websocket/services/chat-websocket.service.ts"
what = "Add the chat.presence case calling handleChatPresence(ws, userId, data) → markPresence, clearPresence(ws) in the close handler, and add the chat.presence line to the inbound list of the protocol doc comment (nothing about outbound kinds); import markPresence/clearPresence from the notifications barrel."
check = "grep -c \"chat.presence\\|clearPresence(ws)\" server/modules/websocket/services/chat-websocket.service.ts"
expect_re = "^[3-9]$"

[[steps]]
kind = "edit"
path = "server/modules/websocket/index.ts"
what = "Export startRunStallWatchdog from the websocket barrel."
check = "grep -c 'startRunStallWatchdog' server/modules/websocket/index.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "docs/architecture/README.md"
what = "Add one row to the Client → server table: chat.presence — which session this socket is watching and whether its tab is visible; nothing else in the file changes."
check = "grep -c 'chat.presence' docs/architecture/README.md"
expect = "1"

[[steps]]
kind = "edit"
path = "docs/architecture/01-websocket-transport.md"
what = "Add the chat.presence row to the inbound type table (payload sessionId, visible; the server records presence for the notification channels' watched-session check), make the RULE read six type values, and make the pieces-table cell read 'the six inbound handlers'. Leave the 'All five are built in exactly two client files' sentence to Phase 6."
check = "grep -c 'chat.presence' docs/architecture/01-websocket-transport.md; grep -c 'six `type` values\\|six inbound handlers' docs/architecture/01-websocket-transport.md"
expect_re = "^[1-9]\\n2$"

[[steps]]
kind = "edit"
path = "server/index.ts"
what = "Call startRunStallWatchdog() inside the listen callback that already starts the plan-runner poll, and stop it in the same shutdown path that stops that poll."
check = "grep -c 'startRunStallWatchdog' server/index.ts"
expect_re = "^[2-3]$"

[[steps]]
kind = "edit"
path = "server/modules/providers/list/codex/codex-runtime.provider.ts"
what = "Declare const runStartedAt = Date.now() at the top of the function that starts the Codex thread and pass durationMs: Date.now() - runStartedAt to the notifyRunStopped call at L439-445; nothing else changes."
check = "grep -c 'runStartedAt' server/modules/providers/list/codex/codex-runtime.provider.ts"
expect = "2"

[[steps]]
kind = "edit"
path = "server/modules/providers/list/cursor/cursor-runtime.provider.js"
what = "Declare const runStartedAt = Date.now() at the top of the spawn function and pass durationMs: Date.now() - runStartedAt to the notifyRunStopped call at L137-143; nothing else changes."
check = "grep -c 'runStartedAt' server/modules/providers/list/cursor/cursor-runtime.provider.js"
expect = "2"

[[steps]]
kind = "edit"
path = "server/modules/providers/list/opencode/opencode-runtime.provider.js"
what = "Declare const runStartedAt = Date.now() at the top of the spawn function and pass durationMs: Date.now() - runStartedAt to the notifyRunStopped call at L165-171; nothing else changes."
check = "grep -c 'runStartedAt' server/modules/providers/list/opencode/opencode-runtime.provider.js"
expect = "2"

[[steps]]
kind = "run"
cmd = "sleep 4; journalctl -u cloudcli-server-dev -n 40 --no-pager | tail -5"
check = "journalctl -u cloudcli-server-dev -n 60 --no-pager | grep -E 'handover complete|serving pid' | tail -1 | grep -c 'pid'"
expect = "1"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint 2>&1 | tail -1"
check = "npm run typecheck >/dev/null 2>&1 && echo typecheck=0; npm run lint 2>&1 | grep -c ': error' | sed 's/^/errors=/'; npm run lint 2>&1 | grep -c ': warning' | awk '{print ($1<=129) ? \"warnings=ok\" : \"warnings=\" $1}'"
expect = "typecheck=0\nerrors=0\nwarnings=ok"

[[steps]]
kind = "edit"
path = ".verify/ntfy/stall-probe.mjs"
what = "Write the stall probe exactly as the phase body describes: the run_stall_ms override through openDb(), the sleep 80 turn, waitForMessage on 'Session silent', the lastSeq samples on failure, the override deleted in finally; one summary line matching the verify expect."
check = "test -s .verify/ntfy/stall-probe.mjs && grep -c 'run_stall_ms' .verify/ntfy/stall-probe.mjs"
expect_re = "^[1-9]$"

[[verify]]
cmd = "node .verify/ntfy/stall-probe.mjs"
expect = "PROBE OK stuck-push=seen priority=4 click-session=match override-cleared=yes"
timeout_s = 600
```

**What to build.** Silence detection at the registry (provider-agnostic), the watchdog that turns it into `session.stuck`, the socket half of presence, and a start clock in the three non-Claude runtimes.

**The stall probe** (`.verify/ntfy/stall-probe.mjs`) spends one real Claude turn: `configureNtfy()`; `appconfig-set run_stall_ms 30000` through `openDb()`; `createSession('claude', '/tmp/cloudcli-ntfy-probe')`; socket, `subscribe`, `send(sessionId, "Use the Bash tool to run exactly this command and then reply DONE: sleep 80", { permissionMode: 'bypassPermissions' })`; `waitForMessage(topic, m => m.title.startsWith('Session silent') && m.click.endsWith('/session/' + sessionId), { timeoutMs: 150000 })`; assert `priority === 4`; wait for the turn to complete; in `finally` delete the `run_stall_ms` key and print `override-cleared=yes` only if `openDb()` no longer finds it. Print the line `expect` shows. On timeout, print `PROBE FAILED` with the `lastSeq` values you sampled by re-sending `chat.subscribe` every 10 s during the sleep (the `chat_subscribed` ack carries `lastSeq`).

**Sirens.** If the probe times out AND the sampled `lastSeq` kept advancing during the `sleep`, the run is emitting progress frames: the reversible default is to exclude frames whose `kind` is `tool_progress` (or whatever kind the samples show, named in your report) from the `lastEventAt` stamp at `:98`, and re-run the probe once; if `lastSeq` did NOT advance and the push still never came, stop and report the watchdog's log lines verbatim. Do not add the watchdog to the providers module; the registry owns runs. Do not add a `stallNotifiedAt` field or a take-with-side-effect method to the registry; what the watchdog has sent is the watchdog's own `notifiedAt` map, and "events resumed since" is `notifiedAt < lastEventAt`, not a reset at the event site. Do not key presence by userId; key it by the connection object. Do not add `chat.unsubscribe` — leaving a session is a `chat.presence` with `sessionId: null`, and the client sends it (Phase 6). The three provider edits are two lines each; if a provider's spawn function is not where the anchor says, report the divergence rather than searching for another home.

## Phase 6 — Client: the ntfy settings card, the limits toggle, presence
Depends on: Phase 4, Phase 5

```toml
[phase]
id = "6"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 3600
manifest = [
  "src/modules/settings/NtfySettingsCard.tsx",
  "src/modules/settings/hooks/useNtfySettings.ts",
  "src/modules/settings/hooks/useSettingsController.ts",
  "src/modules/settings/tabs/NotificationsSettingsTab.tsx",
  "src/modules/chat/hooks/useSessionPresence.ts",
  "src/modules/chat/ChatInterface.tsx",
  "src/shared/api.ts",
  "src/shared/types.ts",
  "src/modules/i18n/locales",
  ".verify/ntfy",
  "docs/notifications.md",
  "docs/verification.md",
  "docs/architecture/01-websocket-transport.md",
]
forbidden = [
  "server",
  "src/shared/ui",
  "src/shared/constants.ts",
  "src/modules/settings/SettingsSection.tsx",
  "src/modules/settings/SettingsRow.tsx",
  "src/modules/settings/SettingsCard.tsx",
  "src/modules/settings/SettingsToggle.tsx",
]
athena = [
  "Saving the card with the token field untouched sends token: '' and wipes the stored token",
  "The card hand-rolls a bordered div instead of SettingsSection/SettingsCard/SettingsRow, or adds a CSS rule",
  "Toggling any other setting auto-saves preferences without events.limits (the client normalizer dropped it), turning the limit family off",
  "useSessionPresence sends visible=true from a hidden tab because it reads document.hasFocus() or never listens to visibilitychange",
  "A locale is missing one of this plan's keys so the card falls back to English silently",
  "The app URL field defaults to 127.0.0.1 in the probe's browser and is saved as such, breaking the click links",
]

[[steps]]
kind = "edit"
path = "src/shared/types.ts"
what = "Add limits: boolean to NotificationPreferencesState.events and the NtfySettingsView / NtfySettingsInput types directly after it, with the group and per-type comments the frontend standard requires; smallest possible diff."
check = "grep -c 'export type NtfySettingsView\\|export type NtfySettingsInput' src/shared/types.ts"
expect = "2"

[[steps]]
kind = "edit"
path = "src/shared/api.ts"
what = "Add the top-level notifications.ntfy helpers (get, save, remove, test) directly after the settings object closes, per Interfaces."
check = "grep -c \"'/api/notifications/ntfy\" src/shared/api.ts"
expect = "4"

[[steps]]
kind = "edit"
path = "src/modules/settings/hooks/useSettingsController.ts"
what = "Carry events.limits (default true, preserved on normalize) in createDefaultNotificationPreferences and the client normalizeNotificationPreferences; nothing else in the file changes."
check = "grep -c 'limits' src/modules/settings/hooks/useSettingsController.ts"
expect_re = "^[2-4]$"

[[steps]]
kind = "edit"
path = "src/modules/settings/hooks/useNtfySettings.ts"
what = "Create useNtfySettings per Interfaces: load on mount, draft state with a comment above each state declaration, save sends only changed fields and never an empty token unless the user cleared it, remove, sendTest, status."
check = "grep -c 'export function useNtfySettings' src/modules/settings/hooks/useNtfySettings.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/settings/NtfySettingsCard.tsx"
what = "Create NtfySettingsCard per Interfaces composed of SettingsSection > SettingsCard divided > SettingsRow rows holding Input / SettingsToggle / Button from the existing modules, with every data-testid listed and every string through t('notifications.ntfy.*')."
check = "grep -c 'SettingsSection\\|SettingsCard\\|SettingsRow\\|SettingsToggle' src/modules/settings/NtfySettingsCard.tsx; { grep -c 'rounded-lg border' src/modules/settings/NtfySettingsCard.tsx || true; }"
expect_re = "^([4-9]|[1-9][0-9])\\n0$"

[[steps]]
kind = "edit"
path = "src/modules/settings/tabs/NotificationsSettingsTab.tsx"
what = "Render <NtfySettingsCard /> after the desktop card and add the events.limits checkbox in the exact pattern of the error checkbox with label t('notifications.events.limits')."
check = "grep -c 'NtfySettingsCard\\|events.limits' src/modules/settings/tabs/NotificationsSettingsTab.tsx"
expect_re = "^[3-5]$"

[[steps]]
kind = "edit"
path = "src/modules/chat/hooks/useSessionPresence.ts"
what = "Create useSessionPresence per Interfaces: chat.presence on mount / sessionId change / isConnected change / visibilitychange / 30 s heartbeat while visible; sessionId null + visible false on unmount; visible = document.visibilityState === 'visible'."
check = "grep -c \"chat.presence\\|visibilitychange\" src/modules/chat/hooks/useSessionPresence.ts"
expect_re = "^[2-6]$"

[[steps]]
kind = "edit"
path = "src/modules/chat/ChatInterface.tsx"
what = "Call useSessionPresence({ sessionId: selectedSession?.id ?? null, sendMessage, isConnected }) once beside the useWebSocket() call; three lines, nothing else."
check = "grep -c 'useSessionPresence' src/modules/chat/ChatInterface.tsx"
expect = "2"

[[steps]]
kind = "edit"
path = "docs/architecture/01-websocket-transport.md"
what = "Rewrite the 'All five are built in exactly two client files' sentence so it stays true: the five are built where it says, and chat.presence is built in src/modules/chat/hooks/useSessionPresence.ts."
check = "grep -c 'useSessionPresence' docs/architecture/01-websocket-transport.md"
expect_re = "^[1-9]$"

[[steps]]
kind = "run"
cmd = "for l in de en es fr it ja ko ru tr zh-CN zh-TW; do echo $l; done"
check = "node -e \"const fs=require('fs');const keys=['events.limits','ntfy.title','ntfy.description','ntfy.server','ntfy.topic','ntfy.topicHint','ntfy.token','ntfy.tokenKept','ntfy.appUrl','ntfy.appUrlHint','ntfy.longRun','ntfy.enabled','ntfy.save','ntfy.test','ntfy.remove','ntfy.saved','ntfy.tested','ntfy.testFailed','ntfy.configured'];let missing=0;for(const l of ['de','en','es','fr','it','ja','ko','ru','tr','zh-CN','zh-TW']){const j=JSON.parse(fs.readFileSync('src/modules/i18n/locales/'+l+'/settings.json','utf8')).notifications||{};for(const k of keys){const v=k.split('.').reduce((o,p)=>o&&o[p],j);if(typeof v!=='string'||!v){missing++;console.log('missing',l,k)}}}console.log('missing='+missing)\" | tail -1"
expect = "missing=0"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint 2>&1 | tail -1"
check = "npm run typecheck >/dev/null 2>&1 && echo typecheck=0; npm run lint 2>&1 | grep -c ': error' | sed 's/^/errors=/'; npm run lint 2>&1 | grep -c ': warning' | awk '{print ($1<=129) ? \"warnings=ok\" : \"warnings=\" $1}'"
expect = "typecheck=0\nerrors=0\nwarnings=ok"

[[steps]]
kind = "edit"
path = ".verify/ntfy/settings-probe.mjs"
what = "Write the settings probe exactly as the phase body describes: openConsole, the card filled and saved, the masked GET, the test push, two screenshots, the watched turn with no push, the unwatched turn with a priority-2 push; one summary line matching the verify expect."
check = "test -s .verify/ntfy/settings-probe.mjs && grep -c 'ntfy-save' .verify/ntfy/settings-probe.mjs"
expect_re = "^[1-9]$"

[[verify]]
cmd = "node .verify/ntfy/settings-probe.mjs"
expect = "PROBE OK card=visible saved=masked test-push=seen shots=2 watched=skipped unwatched=pushed"
timeout_s = 900
```

**What to build.** The card, its hook, the API helpers, the two shared types, the `limits` checkbox, the presence hook, and the locale keys.

**The settings probe** (`.verify/ntfy/settings-probe.mjs`, Playwright from `/opt/shadow-connector/node_modules/playwright` as `.verify/lib/console.mjs:15-20` does, through `openConsole()` from `./lib/console.mjs`): (1) `api('/api/notifications/ntfy', { method: 'DELETE' })` first so the card starts empty; open Settings → the Notifications tab; assert `[data-testid=ntfy-card]` is visible (`card=visible`); fill server `https://ntfy.sh`, topic = `scratchTopic()`, app URL `http://100.103.222.79:5183`, long-run `0`, leave the token empty; click `ntfy-save`; wait for `ntfy-status` to read the saved text; `GET /api/notifications/ntfy` → `configured: true`, `topicMasked` is not the full topic, `hasToken: false` (`saved=masked`); (2) click `ntfy-test`; `waitForMessage(topic, m => m.title === 'CloudCLI test')` (`test-push=seen`); (3) screenshots at 1440 and 390 px wide into `.verify/artifacts/ntfy-settings-{desktop,mobile}.png` (`shots=2`); (4) presence: `createSession('claude', '/tmp/cloudcli-ntfy-probe')`, `page.goto('/session/' + sessionId)`, wait 2 s, then from the probe's OWN chat socket `send(sessionId, 'Reply with exactly the word OK and nothing else.', { permissionMode: 'bypassPermissions' })`, wait for completion; poll the topic for 15 s and assert NO message with `click` ending `/session/<sessionId>` and title starting `Run finished` (`watched=skipped`); (5) `page.close()`, then wait until 25 s have passed since the first turn's completion frame (the orchestrator drops a same-code, same-session event inside its 20 s window — `DEDUPE_WINDOW_MS`, `notification-orchestrator.service.js:20`), send the same message on the same session again, `waitForMessage(... title starts 'Run finished' and click ends with the session id, timeoutMs 60000)` and assert `priority === 2` (`unwatched=pushed`). Print the `expect` line; on failure `PROBE FAILED <step>` and exit 1.

**Sirens.** You will want to build the card from the tab's own bordered-div pattern to match its neighbours; do not — the tab is the one hand-rolled outlier (its own primitives' docstrings list every other tab), and the Verve rule is compose from existing parts. You will want a `SettingsToggle` for the `limits` checkbox; do not — the three existing event checkboxes are raw inputs and the fourth matches them. You will want to add a `channels.ntfy` boolean to `NotificationPreferencesState`; do not — nothing reads it. `src/shared/types.ts` and `src/shared/api.ts` are being edited by other sessions: append, never reorder, never reformat. `document.hasFocus()` is false in headless Chromium — visibility is `document.visibilityState === 'visible'` and nothing else. Every new string is a key in all 11 locale files; a key present in `en` only is a bug the mechanical check will catch. The token input must send nothing when untouched.

## Goal

*Goal:* every event the request names reaches the phone through ntfy with the right priority, copy, deep link and (where it applies) action buttons; a question can be answered from the phone; a watched session stays quiet; repeats collapse; the card configures it without a restart. *Verify by:* the six phases' `[[verify]]` probes, each of which reads the real scratch topic back through `https://ntfy.sh/<topic>/json?poll=1`, plus the Phase 4 question probe's `answered=Blue reply=Blue` on both permission modes.

## Decisions made at plan time (with reversals)

- **One owner per event.** Usage warnings, limit reached/reset, overage and out-of-credits come from the SDK `rate_limit_event`; login expiry from the SDK's `assistant.error` and `auth_status`. Descent's usage proxy (`server/modules/descent/descent.service.ts`) is read-only and not a notification source — it polls one account on the client's clock, while the SDK event is pushed by the running session, which is the account that matters mid-run. Reversal: a `descent-usage-signals.ts` sibling of the stall watchdog polling `GET /api/descent/usage` on a 3-minute timer and emitting the same `limit.*` codes with `dedupeKey` per window — one new file, no other change.
- **A fourth event preference `limits`** rather than mapping the limit family onto `error`. Reversal: `KIND_TO_PREF_KEY.limit = 'error'` and delete the checkbox.
- **The PreToolUse hook is gated to `bypassPermissions`, `auto`, `dontAsk`** (the modes the caveat at `claude-runtime.provider.js:1055-1060` names as skipping `canUseTool`, plus `dontAsk`). Reversal: widen `HOOK_MODES` (Phase 4's Sirens name the trigger).
- **Stall = no recorded event on the run for `stallMs`** (default 15 min, env `CLOUDCLI_STALL_MS`, live override `app_config.run_stall_ms`). Reversal: exclude named progress kinds from the stamp (Phase 5's Sirens). The registry carries only the fact (`lastEventAt`); the watchdog carries its own memory of what it sent (`notifiedAt`), so a second stall in one run is a comparison, not a reset hook in the store.
- **The act route has its own public prefix** (`/api/ntfy/act`), never a child of the authenticated `/api/notifications` mount, so no mount order in `server/index.ts` is load-bearing. Reversal: none wanted — the child-path form only trades a path string for an ordering invariant an upstream merge can break.
- **Token crypto and decision mapping are two files** (`ntfy-action-token.service.ts`, `ntfy-action-decisions.service.ts`): Argus changes the first, a product change touches the second. Reversal: merge them if both stay under 150 LOC after Phase 3.
- **A channel's enablement is the endpoint row's**, and the orchestrator asks for it through `isEnabled(preferences, userId)`; `preferences.channels.*` is never a second copy for ntfy. Reversal: add `ntfy` to both normalizers and derive the flag the way `updateChannelPreference` does for desktop.
- **Flood control is leading-edge with one trailing summary at priority 3**, window 60 s, on the codes listed in Interfaces; never on `permission.required`. Reversal: the set and the window are two constants.
- **Tap-to-answer answers only single-select questions with up to three options**; other questions push without buttons and the click opens the session. Reversal: a `view` action per extra option is not possible (ntfy caps actions at three), so the reversal is a two-step "pick 1-3 / pick 4-6" — not built.
- **The public app URL is app-wide** (`app_config.public_app_url`), set from the ntfy card, defaulting in the card to the browser's origin. Reversal: move it into the per-user ntfy metadata.
- **The action-token secret is generated once and never rotated by code.** Reversal: a `DELETE /ntfy` could also delete the secret; not built.

## Waves

Wave 1: Phase 1 — the channel
Wave 2: Phase 2 — tokens, act route, presence, flood control; depends on Phase 1
Wave 3: Phase 3 — Argus audit; depends on Phase 2
Wave 4: Phase 4 — Claude runtime; depends on Phase 2
Wave 5: Phase 5 — watchdog, socket presence, provider clocks; depends on Phase 2
Wave 6: Phase 6 — client; depends on Phase 4 and Phase 5

Phases 3, 4 and 5 have disjoint code manifests but all three append to `docs/notifications.md` and `docs/verification.md`, so they are not independent under DOCTRINE §8 and this file stays one plan walked in order.

Sibling plans: `/home/lyphe/.claude/claudecodeui_lyphe/docs/plans/ntfy-notifications.plan.md` (this file, the CloudCLI slice) · `/home/lyphe/.claude/plans/ntfy-notifications--descent-removal.md` (the Descent slice, its own repo and `cwd`, independent of every phase here; runs in its own session).

## Edge cases (each with its decided ending)

- ntfy answers 413 (body too large) → the clamps make it unreachable for our copy; if it happens anyway, `publishNtfy` returns `ok:false, status:413` and the push is lost with one warn line — never a retry loop.
- The ntfy server is unreachable → 5 s timeout, `ok:false`, one warn line; the orchestrator's other channels are unaffected.
- No app URL configured → pushes go out without `click` and without action buttons; the body for a question ends with `— open CloudCLI to answer`.
- A question with `multiSelect` or four+ options → no buttons; the click opens the session.
- The browser answers a question first, then the phone taps → the act route finds no pending action → 410 `already answered`.
- The phone taps a plain-tool approval after the runtime's 55 s window (`CLAUDE_TOOL_APPROVAL_TIMEOUT_MS`, `claude-runtime.provider.js:70`) → `resolveToolApproval` finds no resolver → the route still answers 200 (the token was valid and is now consumed) and the run has already continued with `deny`; nothing hangs.
- The server restarts with tokens on phones → the secret persists in `app_config`, but pending actions are in-process, so every stale token answers 410.
- A `rate_limit_event` with `status: rejected` and no `resetsAt` → `limit.reached` with body `resets soon`; no reset timer; `limit.reset` fires when a later `allowed` arrives.
- Two tabs on one session, one hidden → watched (any visible tab counts).
- A tab closes without a `visibilitychange` (laptop lid) → the record ages out after 90 s.
- `durationMs` unknown (`null`) on `run.stopped` → the ntfy channel skips it; web push and desktop still send.
- `result` with `is_error: true` → `run.limit`/`run.failed` only, never `Run finished` beside it.
- A `limit.warning` at 82% then 84% → one push; at 96% → a second; after `allowed` → the buckets reset.
- The dev user has no ntfy row → every probe starts with `configureNtfy()`; `isEnabled` answers false and `send` returns at step (1) for users without a row.
- `API_KEY` is set in the server's environment → `validateApiKey` (`server/index.ts:151`) answers the phone's tap with 401 before the act router sees it; nothing in this plan sets `API_KEY` (unset on this box), and `docs/notifications.md` names it as the one environment that disables tap-to-answer.
- A run stalls, resumes, then stalls again → the second notice fires because `lastEventAt` moved past the watchdog's `notifiedAt` for that session.

## Exclusions (named here, never a step)

- Subscribing the ntfy phone app to CloudCLI's topic is outside this plan; the scratch topics the probes use are throwaway (`cloudcli-verify-<hex>`) and the real topic is whatever is typed into the card.
- Quiet hours (the request's Behaviors OUT).
- Rate-limit and usage detection for Codex, Cursor and OpenCode: their runtimes carry no limit signal today (`other_providers_sessions` scout, 2026-09-11); they get crash, long-run and stall pushes.
- Splitting `claude-runtime.provider.js` (1534 LOC, past the hard ceiling) — the next split, its own checkpoint.
- Migrating web push subscriptions into `notification_channel_endpoints` (the orchestrator's own TODO at `:213-214`).
- The `.verify/baseline.txt` stale count (130 vs the measured 129) — a one-line doc fix outside this plan.
- Migrating `NotificationsSettingsTab.tsx`'s hand-rolled bordered divs and raw checkboxes to `SettingsSection` / `SettingsCard` / `SettingsRow` / `SettingsToggle` — its own card; the fourth event checkbox matches its three raw siblings so the row stays one thing until that card lands.
- Centralizing run-lifecycle notifications: four runtimes each hand-assemble `run.stopped` / `run.failed` (and now a start clock) for a fact the registry witnesses exactly once per run (invariant 2, exactly one `complete`). A candidate for Asclepius or Arete on the running system, not this plan.

## Doctrine citations

- `~/.claude/CLAUDE.md` § "No unit tests. Ever." · § "Healed means deleted" (the `needs approval` copy) · § "A plan never involves the operator." · § "Root cause before fix" (the PreToolUse hook closes the caveat at its source).
- `.agents/skills/backend-module-standards/SKILL.md` § "Organize backend modules" (barrel imports, TypeScript, `.js` suffix) · § "Keep routes thin".
- `.agents/skills/frontend-module-standards/SKILL.md` § "Place types by usage" · § "Place hooks by ownership" · § "Document state deliberately".
- `~/.claude/design/DESIGN_DOCTRINE.md` § 2 "The compose-or-component test" · § 3 "Screens compose. They never build." · § 10 (a feature shipping with zero new CSS is the expected outcome).
- The ntfy publish discipline (body-not-URL publish, clamps, never-raise, fire-and-forget) is stated in full in the `ntfy-publish.service.ts` Interfaces bullet above; it has no other home once the sibling plan ships.
- `docs/architecture/README.md` § "The protocol, in two tables" (the inbound vocabulary's home) · `docs/architecture/01-websocket-transport.md` § "The chat protocol going up" (RULE: the `type` values, dispatched by one switch) · `docs/architecture/README.md` § "Cross-cutting invariants" #3 (a run belongs to the server, not to a socket — why presence is keyed by connection and the watchdog reads the registry).
- `docs/verification.md` (the two units, the handover line, the Playwright console harness) · `docs/hosting.md:31-34` (the tailnet URL).

## Ship Logs

### Phase 1 Ship Log — ✅ SHIPPED 2026-09-12
- run: ntfy-notifications-plan-20260912-071525-d0c8 · attempt 1 of 2 · cycle 1 · spawns 4/70 · fix-passes 1 of 2 · cost $12.11 (run $12.11) · resumed 0×
- builder: hephaestus/opus · session e2856d76-2648-4e96-8d4d-f98ceb0e7ec1 · 1137s · RESULT: DONE
- athena: pass 1 BLOCKING 0 · HIGH 0 · MED 1 · LOW 1 → fix-pass 1 (188s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 16/16 steps OK · verify 1/1 OK
- forbidden: unchanged (5 declared, 5 present)
- docs: Prometheus returned · 3 files
- residue: BLOCKING 0 · HIGH 0 · MED 1 · LOW 1 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/ntfy-notifications-plan-20260912-071525-d0c8/phase_1/

### Phase 2 Ship Log — ✅ SHIPPED 2026-09-12
- run: ntfy-notifications-plan-20260912-071525-d0c8 · attempt 1 of 2 · cycle 2 · spawns 9/70 · fix-passes 1 of 2 · cost $8.95 (run $21.06) · resumed 0×
- builder: hephaestus/opus · session 745ed0d9-f285-4b19-ad89-c7748ea65870 · 894s · RESULT: DONE
- athena: pass 1 BLOCKING 0 · HIGH 0 · MED 1 · LOW 3 → fix-pass 1 (193s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 12/12 steps OK · verify 1/1 OK
- forbidden: unchanged (8 declared, 8 present)
- docs: Prometheus returned no DOCS: line (the sweep is not a gate)
- residue: BLOCKING 0 · HIGH 0 · MED 1 · LOW 3 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/ntfy-notifications-plan-20260912-071525-d0c8/phase_2/

### Phase 3 Ship Log — ⛔ BLOCKED 2026-09-12
- [BLOCKED: crash: is_error (success)]
- run: ntfy-notifications-plan-20260912-071525-d0c8 · attempt 2 of 2 · fix-passes 0 of 2 · spec_sha 989de0618d65 · retry: allowed
- builder: argus/opus · session 2b51961e-9777-4d9e-b3d2-c44467e6bb59 · 0s · crash: is_error (success)
- evidence: /home/lyphe/.claude/state/runner/ntfy-notifications-plan-20260912-071525-d0c8/phase_3/

### Phase 4 Ship Log — ⛔ BLOCKED 2026-09-12
- [BLOCKED: crash: is_error (success)]
- run: ntfy-notifications-plan-20260912-071525-d0c8 · attempt 2 of 2 · fix-passes 0 of 2 · spec_sha 617d0ea7d8bd · retry: allowed
- builder: hephaestus/opus · session 44f7f06e-1b98-48a0-922f-c577946351cb · 0s · crash: is_error (success)
- evidence: /home/lyphe/.claude/state/runner/ntfy-notifications-plan-20260912-071525-d0c8/phase_4/

### Phase 5 Ship Log — ⛔ BLOCKED 2026-09-12
- [BLOCKED: budget: halted: 2 attempts since the last SHIPPED phase passed no check]
- run: ntfy-notifications-plan-20260912-071525-d0c8 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha 78fd024e2307 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/ntfy-notifications-plan-20260912-071525-d0c8/phase_5/

### Run ntfy-notifications-plan-20260912-071525-d0c8 — HALTED 2026-09-12
- shipped: 1, 2
- blocked: 3: crash, 4: crash, 5: budget
- next: plan-runner resume ntfy-notifications-plan-20260912-071525-d0c8
- brief: /home/lyphe/.claude/state/runner/ntfy-notifications-plan-20260912-071525-d0c8/resume_brief.md

### Phase 3 Ship Log — ✅ SHIPPED 2026-09-12
- run: ntfy-notifications-plan-20260912-081801-bf50 · attempt 1 of 2 · cycle 1 · spawns 4/70 · fix-passes 1 of 2 · cost $21.14 (run $21.14) · resumed 0×
- builder: argus/opus · session a6bb3db3-19e7-4469-96cc-f0a5db50ec67 · 1265s · RESULT: DONE
- athena: pass 1 BLOCKING 0 · HIGH 1 · MED 5 · LOW 4 → fix-pass 1 (1136s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 3/3 steps OK · verify 1/1 OK
- forbidden: unchanged (5 declared, 5 present)
- docs: Prometheus returned · 4 files
- residue: BLOCKING 0 · HIGH 1 · MED 5 · LOW 4 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/ntfy-notifications-plan-20260912-081801-bf50/phase_3/

### Phase 4 Ship Log — ✅ SHIPPED 2026-09-12
- run: ntfy-notifications-plan-20260912-081801-bf50 · attempt 1 of 2 · cycle 2 · spawns 8/70 · fix-passes 1 of 2 · cost $25.71 (run $46.85) · resumed 0×
- builder: hephaestus/opus · session 71d1ab94-599e-4b34-89b4-512fecd0b51e · 950s · RESULT: DONE
- athena: pass 1 BLOCKING 1 · HIGH 0 · MED 3 · LOW 4 → fix-pass 1 (493s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 7/7 steps OK · verify 1/1 OK
- forbidden: unchanged (8 declared, 8 present)
- docs: Prometheus returned · 4 files
- residue: BLOCKING 1 · HIGH 0 · MED 3 · LOW 4 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/ntfy-notifications-plan-20260912-081801-bf50/phase_4/

### Phase 5 Ship Log — ✅ SHIPPED 2026-09-12
- run: ntfy-notifications-plan-20260912-081801-bf50 · attempt 1 of 2 · cycle 3 · spawns 12/70 · fix-passes 1 of 2 · cost $20.10 (run $66.94) · resumed 0×
- builder: hephaestus/opus · session 91982dec-eb93-479a-bd1d-5d976b83b323 · 1056s · RESULT: DONE
- athena: pass 1 BLOCKING 0 · HIGH 1 · MED 3 · LOW 7 → fix-pass 1 (605s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 13/13 steps OK · verify 1/1 OK
- forbidden: unchanged (4 declared, 4 present)
- docs: Prometheus returned · 3 files
- residue: BLOCKING 0 · HIGH 1 · MED 3 · LOW 7 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/ntfy-notifications-plan-20260912-081801-bf50/phase_5/

### Phase 6 Ship Log — ✅ SHIPPED 2026-09-12
- run: ntfy-notifications-plan-20260912-081801-bf50 · attempt 1 of 2 · cycle 4 · spawns 16/70 · fix-passes 1 of 2 · cost $21.40 (run $88.35) · resumed 0×
- builder: hephaestus/opus · session aa3cfcdb-2f2f-43d1-9e71-0004be3e4f13 · 1853s · RESULT: DONE
- athena: pass 1 BLOCKING 0 · HIGH 1 · MED 1 · LOW 5 → fix-pass 1 (322s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 12/12 steps OK · verify 1/1 OK
- forbidden: unchanged (7 declared, 7 present)
- docs: Prometheus returned · 4 files
- residue: BLOCKING 0 · HIGH 1 · MED 1 · LOW 5 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/ntfy-notifications-plan-20260912-081801-bf50/phase_6/

### Run ntfy-notifications-plan-20260912-081801-bf50 — COMPLETE 2026-09-12
- shipped: 3, 4, 5, 6
- blocked: none
- next: run complete — the checkpoint is Scott's /git, on his clock
- brief: /home/lyphe/.claude/state/runner/ntfy-notifications-plan-20260912-081801-bf50/resume_brief.md
