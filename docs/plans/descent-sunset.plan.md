# Descent sunset — CloudCLI stands alone

## INTENT LOCK

**ORIGINAL REQUEST** (the operator's own words, verbatim):
> lets make a plan to make account usage standalone here on cloudcli. We already have ntfy so were good. Lets transfer over metis lessons, making sure its gitignored. lets make sure kanban cards can hold attachments, or references to the attachments. skip pilot terminal. The info that makes sense here: Cross-board Metis, nudge, the relaunch ledger, session telemetry, the vitals status bar, plan cost tracking, the plan-archive watcher and the gotchas pre-gate. I only want the pm command to be in the kanban board area, not seen by global claude project, it should only live in there so when metis is launched, its really the pm command launching. make sure that the metis launch area is capable of handling multiple metis agents, being able to click to view the conversation and reply within the session if needed.

**THIS PLAN DELIVERS:**
CloudCLI stops needing Descent. The account switcher and the usage meters are served by CloudCLI's
own code against the real credential files and the real vendor API, with the Descent proxy deleted.
The lesson corpus becomes the board's own table with the four stubbed `kanban-pm` lesson tools made
real and its review fence enforced at the door; the memory-intake queue becomes its own module —
`server/modules/memory-intake/`, mounted at `/api/memory`, unreachable from any agent seam — and both
spill queues take `/learn` and `/remember` straight into CloudCLI, outside the repository. A card holds real
attachment BYTES under `~/.cloudcli/`, Descent's 27 files imported and served from the card drawer.
Seven Descent lanes arrive where they have a consumer here — a board nudge that wakes the driver, a
relaunch ledger with backoff and a rate-limit hold, per-session token telemetry that fills the card's
four counters, a vitals strip in the board header, the plan cost read from the ledgers that already
exist, the plan-archive sweep, and the gotchas pre-gate lifted out of Descent's tree — and
cross-board Metis arrives as a read-only estate view, because a board Metis's working directory is
her board's. `~/.claude/commands/pm.md` is deleted: the board's own brief becomes the only `/pm`
there is, and the nine hook guards that read Descent's database — twelve modules once their private
helpers go — are deleted with it. The pilot panel
lists every live Metis, opens any one of them as a conversation, and sends a reply into that session.
The last phase stops and disables Descent's four systemd units; the run ends with `:7878` dark and
every surface above still answering.

**OPERATOR VERDICT:** CONFIRMED -- 2026-09-17 -- Scott: "Accept — run it"

## Runner

```toml
plan_format = 2
cwd = "/home/lyphe/.claude/claudecodeui_lyphe"
add_dirs = [
  "/home/lyphe/.claude/descent",
  "/home/lyphe/.claude/hooks",
  "/home/lyphe/.claude/commands",
  "/home/lyphe/.claude/skills",
  "/home/lyphe/.claude/agents",
]

[budget]
max_cycles = 60
max_spawns = 300
max_fix_passes = 2
max_review_passes = 1
max_attempts = 3
max_replans = 6
```

## Interfaces

Contracts only. Signatures, shapes, paths and route tables — never control flow.

### 1. The new tables, the one additive column, and the one that gains nothing

Declared in `server/modules/database/kanban-schema.ts`'s `KANBAN_SCHEMA_SQL`, every statement
`IF NOT EXISTS`, exec'd from `runMigrations` (`migrations.ts:601-603`). A live database already
carries the eleven tables, so a column added here changes nothing on it — an additive column needs an
explicit `addColumnToTableIfNotExists` call beside `migrateKanbanBoardsColumns` (`migrations.ts:544-551`).

```sql
CREATE TABLE IF NOT EXISTS kanban_lessons (
    id TEXT PRIMARY KEY NOT NULL,
    card_id TEXT NULL REFERENCES kanban_cards(id) ON DELETE SET NULL,
    name TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    trigger TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'note',
    tags TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'staged',
    source TEXT NOT NULL DEFAULT 'metis',
    draft_path TEXT NULL,
    created_at TEXT NOT NULL,
    reviewed_at TEXT NULL,
    descent_id TEXT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS ix_kanban_lessons_status ON kanban_lessons(status, created_at);

CREATE TABLE IF NOT EXISTS memory_candidates (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    target TEXT NOT NULL,
    project TEXT NULL,
    index_line TEXT NULL,
    rationale TEXT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    source TEXT NOT NULL DEFAULT 'spill',
    session_id TEXT NULL,
    asserted_path TEXT NULL,
    refusal TEXT NULL,
    created_at TEXT NOT NULL,
    reviewed_at TEXT NULL,
    descent_id TEXT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS ix_memory_candidates_status ON memory_candidates(status, created_at);

CREATE TABLE IF NOT EXISTS kanban_session_usage (
    session_id TEXT PRIMARY KEY NOT NULL,
    board_id TEXT NULL,
    card_id TEXT NULL,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cache_read INTEGER NOT NULL DEFAULT 0,
    cache_create INTEGER NOT NULL DEFAULT 0,
    byte_offset INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);
```

`memory_candidates` is NOT a board table and is not declared in `KANBAN_SCHEMA_SQL`: it lives in
its own `server/modules/database/memory-schema.ts`, exec'd from `runMigrations` beside the board's
script. The name carries no `kanban_` prefix because the board never reads it — the lane is its own
module (§3), and a board prefix on a table the board cannot see is the same lie as a `Descent*` type
name after Phase 9.

`kanban_boards` gains **one** additive column, beside the two governors already there:

```sql
-- migrations.ts, beside migrateKanbanBoardsColumns (:544-551), which is the ONE place an
-- additive kanban column is added to a live database:
addColumnToTableIfNotExists(db, 'kanban_boards', columnNames, 'concurrency', 'INTEGER NOT NULL DEFAULT 1');
```

`kanban_attachments` gains **no column**. Its bytes live at a DERIVED path (§4) and a row whose file
is missing answers 404 — the same discipline `kanban_attachments`'s own header comment already states
(`server/shared/kanban-types.ts:276`), and it gains no derived `url` field either — a route path
inside a data type is a second home for a truth `src/shared/api.ts` already composes, and the one
consumer cannot use it anyway (a bearer-authenticated blob, never an `<img src>`).
`kanban_cards.build_tokens_in|out|cache_read|cache_create`
(`kanban-schema.ts:55-58`) already exist and are written by nothing today; §7 fills them.

New id prefix for `kanbanIdsDb.mintId`: `ls` (lessons). Existing: `a` (attachments). The memory
lane mints its own `mc-<n>` inside its module, from its own counter — it does not reach into the
board's id sequence, which is the board's.

New `KanbanEventKind` members (`server/shared/kanban-types.ts:138`, mirrored in
`src/shared/kanban-types.ts`): `lesson.staged`, `lesson.reviewed`, `attachment.removed`,
`metis.nudged` — four, not seven. The memory lane writes none of them: after §3 it is not a board
lane and records its own timestamps instead.

### 2. The lessons lane

`server/modules/kanban/kanban-lessons.service.ts` — every write through `writeKanban`
(`kanban-write.service.ts:47`), never a second seam.

```ts
export type KanbanLessonInput = { name: string; summary: string; trigger: string; body?: string;
  tags?: string[]; cardId?: string | null; kind?: 'note' | 'skill_draft'; source?: string };
export function stageLesson(input: KanbanLessonInput, context?: KanbanWriteContext): KanbanLesson;
export function listLessons(query: { status?: string; limit?: number }): KanbanLessonLean[];
export function getLesson(lessonId: string): KanbanLesson | null;
export function reviewLesson(lessonId: string, approve: boolean, context?: KanbanWriteContext): KanbanLesson | null;
export function approvedIndex(limit?: number): KanbanLessonLean[];
```

Behaviour ported from `~/.claude/descent/store_lessons.py`: `stage_lesson` (`:158`) validates the card
reference and mints `ls-<n>` at status `staged`; `review_lesson` (`:229`) is a CAS
`UPDATE … WHERE id = ? AND status = 'staged'` — a non-staged row is a 422, an unknown id is `null`;
`list_lessons` (`:288`) is lean (no `body`, no `draft_path`), `ORDER BY created_at DESC, id DESC`;
`get_lesson` (`:310`) is full. `approvedIndex` is `store_actionable.py:170-171`'s
`WHERE status='approved' ORDER BY created_at DESC LIMIT 50` — an unscored recency slice, because
there is no lesson scoring anywhere in Descent and none is invented here. A `kind='skill_draft'`
lesson also writes `~/.cloudcli/pending-skills/<id>-<kebab-name>.SKILL.md`
(`store_lessons.py:222-223`).

**There is no MCP review verb, and the review routes are refused AT THE DOOR.** Staging is the
agent's (MCP) and the spill sweep's; reviewing is a person's. Not exposing a tool is not a fence —
the kanban router is mounted twice, and the `kanban-pm` mount is reachable by any live Metis holding
her derived credential. So `kanbanMetisSecretGuard` gains a `REVIEW_PATH` refusal beside its
`IMPORT_PATH` one (`kanban-metis.routes.ts:73`), decoded and case-insensitive the same way:

```ts
const IMPORT_PATH = /\/import(\/|$)/i;                                  // already there
const REVIEW_PATH = /\/lessons\/[^/]+\/(approve|reject)(\/|$)/i;          // Phase 2 adds this
const OPERATOR_BYTES = /\/cards\/[^/]+\/attachments\/[^/]+$/i;           // Phase 5 adds this, DELETE only
```

`/memory` never appears in that list because after §3 it is not on this router at all.

### 3. The memory-intake module — its own module, not the board's

`server/modules/memory-intake/` — `memory.service.ts`, `memory-assert.ts`, `memory-caps.ts`,
`memory.routes.ts` and an `index.ts` barrel exporting `createMemoryIntakeModule()` and the two verbs
the Descent import needs. Mounted at `/api/memory` behind `authenticateToken` in `server/index.ts`,
and **never** on the kanban router — so it is unreachable from the `kanban-pm` mount by construction
rather than by a refusal list.

Why it is not in `server/modules/kanban`: a candidate has no board, no card, no lane and no
`board_id`; its write targets are `~/.claude/RULES.md`, `REQUIREMENTS.md`, `CLAUDE.md` and a
project's `memory/` directory; its reader polls and has never consumed a board frame; and its wire
types already live in `server/shared/types.ts`. The only thing it borrowed from the board was the
sqlite file, which is `modules/database`'s.

```ts
export const MEMORY_TARGETS = ['memory', 'topic', 'rules', 'requirements', 'claude'] as const;
export type MemoryTarget = (typeof MEMORY_TARGETS)[number];
export class MemoryRefusal extends Error {}
export function validateMemoryArgs(input: unknown): MemoryCandidateInput;   // the 7-key door
export function stageMemoryCandidate(input: MemoryCandidateInput): MemoryCandidateFull;
export function listMemoryCandidates(query: { status?: string; limit?: number }): MemoryCandidateLean[];
export function getMemoryCandidate(id: string): MemoryCandidateFull | null;
export function approveMemoryCandidate(id: string): MemoryCandidateFull | null;  // asserts, then flips
export function rejectMemoryCandidate(id: string): MemoryCandidateFull | null;
export function importDescentCandidates(rows: DescentMemoryRow[]): number;        // Phase 6 calls this
export function assertIntoTarget(row: MemoryCandidateFull): { path: string };     // memory-assert.ts
```

**`MEMORY_TARGETS` has ONE home — `memory.service.ts`, beside the `validateMemoryArgs` door that
checks against it.** `memory-assert.ts` imports it from there; nothing re-declares it.

**No `writeKanban`, no `kanban_events` row, no frame.** The lane's own table records `created_at`
and `reviewed_at`, the tab polls at 60 s and has never read a frame, and a board-shaped event for a
row with no board would be the fabrication §1 of the review names.

**The wire keeps the `{ reachable }` envelope the client is built on** — the same ruling §6 makes for
accounts. The canonical shapes are `MemoryPending`, `MemoryCandidateRead`, `MemoryCandidateLean` and
`MemoryCandidateFull`, which ALREADY EXIST at `server/shared/types.ts:1866-1876` and are neither
moved nor re-declared:

```
GET  /api/memory?status=            -> MemoryPending       { reachable: true, candidates } | { reachable: false, reason }
GET  /api/memory/:candidateId       -> MemoryCandidateRead  { reachable: true, candidate } | { reachable: false, reason }
POST /api/memory/:candidateId/approve -> { candidate } | 404 | 422 (not pending, or a cap refusal in plain English)
POST /api/memory/:candidateId/reject  -> { candidate } | 404 | 422
```

Five client calls read those four routes (`pending`, `approved` — the same route at
`?status=approved` — `candidate`, `approve`, `reject`). Each row's `sessionId` keeps the resolution
it has today: Descent's unverified provenance column resolved server-side through
`sessionsDb.resolveAppSessionId`, display-only, gating nothing — it drives `isMine`/`mineFirst` in
`MemoryIntakePanel`, so dropping it would silently un-sort the operator's own proposals.

The five write destinations, derived in `_steps()` (`store_memory_assert.py:165-214`) and never taken
from the row:

| `target` | What is written |
|---|---|
| `memory` | `~/.claude/projects/<project>/memory/<kebab(name)>.md` (created), then one `- …` line appended to that project's `memory/MEMORY.md` |
| `topic` | the same note file only, no index line |
| `rules` | inserted at the end of `## Rules` in `~/.claude/RULES.md` |
| `requirements` | inserted at the end of `## Requirements` in `~/.claude/REQUIREMENTS.md` |
| `claude` | appended to `~/.claude/CLAUDE.md` |

Caps (`store_memory_caps.py:63-81`): `MEMORY.md` max 200 lines / 250 chars a line; `RULES.md` and
`REQUIREMENTS.md` max 60 lines / 2000 chars total; `topic` and `CLAUDE.md` uncapped. A breach throws
`MemoryRefusal`, the row stays `pending`, its `refusal` records the words, and **nothing is
truncated**. Every byte write is atomic — temp file in the same directory, then rename
(`store_memory_assert.py:258-274`). Approve asserts LAST inside the transaction, so a write failure
rolls the row and its event back (`store_memory.py:249-253`).

### 4. Attachments — the bytes

```ts
export function attachmentsRoot(): string;   // KANBAN_ATTACHMENTS_ROOT ?? ~/.cloudcli/kanban-attachments
export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
export const ATTACHMENT_MIME_TO_EXT: Record<string, string>;  // image/png→png, image/jpeg→jpg, image/gif→gif, image/webp→webp, application/pdf→pdf
export function addAttachment(cardId: string, file: { filename: string; mime: string; bytes: Buffer },
  context?: KanbanWriteContext): KanbanAttachment;
export function resolveAttachmentFile(cardId: string, attachmentId: string):
  { path: string; mime: string; filename: string } | null;
export function removeAttachment(cardId: string, attachmentId: string, context?: KanbanWriteContext): boolean;
```

On-disk layout, Descent's own (`store_schema.py:79-93`): `<root>/<cardId>/<attachmentId>.<ext>`, the
extension taken from the closed mime allowlist and never from the client's filename. The stored
filename is the row's, the display filename is the column's. `resolveAttachmentFile` does not re-implement the
traversal gate — it calls the one this repository already has, extracted as a PURE MOVE into the
shared home the backend standard names:

```ts
// server/shared/utils.ts — moved from image-assets.service.ts:82-95, which then calls it
export function resolveUnderRoot(root: string, ...segments: string[]): string | null;
```

It refuses any segment carrying a separator, `..` or a backslash, resolves, and requires the result
to start with `root + path.sep`. A security predicate with two copies is a predicate that gets fixed
once.

### 5. The route table (added to `server/modules/kanban/routes/`)

Two new route files, each a `create<X>Routes(services): Router` factory `use`d by
`kanban.routes.ts:42-51`. Both mounts inherit them: `/api/kanban` behind `authenticateToken`
(`server/index.ts:194`) and `/api/kanban-pm` behind `kanbanMetisSecretGuard` (`server/index.ts:203`).

```
GET    /api/kanban/lessons?status=&limit=                    -> { lessons }
GET    /api/kanban/lessons/:lessonId                         -> { lesson } | 404
POST   /api/kanban/lessons            { name, summary, trigger, body?, tags?, cardId?, kind? } -> { lesson }
POST   /api/kanban/lessons/:lessonId/approve                 -> { lesson } | 404 | 422   (403 on the kanban-pm mount)
POST   /api/kanban/lessons/:lessonId/reject                  -> { lesson } | 404 | 422   (403 on the kanban-pm mount)
POST   /api/kanban/cards/:cardId/attachments   (multipart, field `file`) -> { attachment } | 413 | 422
GET    /api/kanban/cards/:cardId/attachments/:attachmentId   -> the bytes | 404
DELETE /api/kanban/cards/:cardId/attachments/:attachmentId   -> { ok: true } | 404   (403 on the kanban-pm mount)
GET    /api/kanban/boards/:boardId/vitals                    -> { vitals }
GET    /api/kanban/cards/:cardId/plan-cost                   -> { planCost }
```

`POST /api/kanban/cards/:cardId/attachments` **replaces** today's metadata-only JSON route
(`detail.routes.ts`, body `{ filename, mime, size }`). Healed means deleted: the JSON shape goes.

**The ruling on the two refusals, made here rather than discovered at runtime.** A Metis may STAGE a
lesson and may ADD an attachment — both are how she records what a build learned and produced. She
may not REVIEW a lesson (that is the fence Descent kept structurally) and she may not DELETE an
operator's uploaded bytes (an unattended session destroying an operator's file is a loss no lease
CAS can undo). Reads stay open on both mounts. So the guard refuses two shapes, both method-scoped:
`POST …/lessons/<id>/(approve|reject)` and `DELETE …/cards/<id>/attachments/<id>`.

The kanban-metis router (`kanban-metis.routes.ts`, mounted at `/api/kanban-metis`) gains:

```
POST   /api/kanban-metis/boards/:boardId/nudge               -> { nudged: true, at }
POST   /api/kanban-metis/sessions/:sessionId/reply  { text } -> { session } | 409
```

### 6. Accounts and usage, standalone

`server/modules/accounts/` — a new module, barrel `index.ts` exporting `createAccountsModule()` only.

```ts
// account-store.service.ts — ported from ~/.claude/descent/account_store.py
export function accountsRoot(): string;          // CLOUDCLI_ACCOUNTS_ROOT ?? ~/.cloudcli/accounts
export function identity(): string | null;       // ~/.claude.json  oauthAccount.emailAddress
export function listSlots(): AccountSlot[];       // one per directory under accountsRoot()
export function captureLive(): string;            // copies the live pair into its slot; returns the slug
export function install(slug: string): { installed: string; captured: string | null };
export function drift(activeSlug: string | null): boolean;
export function stateSummary(activeSlug: string | null): ClaudeAccounts | null;
export function activeSlug(): string | null;      // <accountsRoot()>/active, one line
export function setActiveSlug(slug: string): void;// atomic temp-file + rename
export class AccountRefusal extends Error {}

// usage.service.ts — ported from server_api_usage.py + usage_windows.py
export async function readUsage(): Promise<ClaudeUsage>;
export function parseWindows(payload: unknown): ClaudeUsageWindow[];
export function markRolled(windows: ClaudeUsageWindow[], now: number, readAt: number): ClaudeUsageWindow[];
```

The live files are `~/.claude/.credentials.json` and `~/.claude.json`; a slot is
`<accountsRoot()>/<slug>/{credentials.json,claude.json}`, directory `0700`, files `0600`. A capture
COPIES live into the slot; an install captures the live login into its own slot first, then copies
the target slot over live (`account_store.py:315-346`). **Token bytes are copied, never parsed** —
the one parse in the whole module is usage's read of `accessToken`, in memory, never logged.

Usage is `GET https://api.anthropic.com/api/oauth/usage` with `anthropic-beta: oauth-2025-04-20` and
a bearer of that access token (`server_api_usage.py:192-222`), cached in module memory with a
last-good fallback, never on disk and never in sqlite.

The four routes answer the **camelCase shapes the deleted proxy used to produce**, so no component
changes: `ClaudeAccounts`, `ClaudeAccountSlot`, `ClaudeUsage`, `ClaudeUsageWindow` — the types named
`Descent*` in `server/shared/types.ts` § DESCENT CONTRACTS and `src/shared/types.ts`, renamed in
place, field for field unchanged.

```
GET  /api/accounts                 -> ClaudeAccounts | { reachable: false, reason }
GET  /api/usage                    -> ClaudeUsage    | { reachable: false, reason }
POST /api/accounts/switch  { slug } -> { installed, captured } | 422
POST /api/accounts/capture         -> { captured } | 422
```

`reachable` stays on the wire because the client reads it; it is `true` on every answer this module
can compute and `false` only when the credential files cannot be read. `percent`, `expiresAt`,
`liveExpiresAt`, `staleSince` and `resetsAt` are `null` when unknown — never `0`
(`docs/descent-proxy.md` rule 3).

### 7. The lanes

```ts
// server/modules/kanban-metis/metis-telemetry.service.ts
export function tickTelemetry(now: number): void;          // one pass over live sessions
export function usageForSession(sessionId: string): KanbanSessionUsage | null;

// server/modules/kanban-metis/metis-relaunch.service.ts
export const RELAUNCH_MAX_ATTEMPTS = 3;
export const RELAUNCH_BACKOFF_BASE_MS = 600_000;    // doubling, capped at 3_600_000
export function shouldRelaunch(boardId: string, now: number): boolean;
export function recordAttempt(boardId: string, now: number): void;
export function clearAttempts(boardId: string): void;
export function rateLimitHold(now: number): number | null;  // epoch ms the hold expires, else null

// server/modules/kanban/kanban-vitals.service.ts
export type KanbanVitals = { building: number; awaitingAnswer: number; awaitingApprove: number;
  lessonsPendingEstate: number; memoryPendingEstate: number; claimable: number };
export function vitalsCounts(boardId: string): KanbanVitals;

// server/modules/plan-runner/plan-archive.service.ts — it never learns that a board exists
export function sweepPlanArchive(now: number, apply: boolean, heldPlanPaths: Set<string>):
  { moved: string[]; held: Record<string, string> };

// server/modules/plan-runner/plan-cost.service.ts
export function planCostFor(planPath: string):
  { totalUsd: number; byKind: { planning: number; review: number; scouts: number; build: number }; runs: number } | null;

// server/modules/kanban/index.ts — the board answers which plans its leases hold
export function plansHeldByLease(): string[];

// server/modules/kanban-metis/metis-spawn.service.ts — one predicate, three callers
export function canSpawn(input: { live: number; dial: number }): { allowed: boolean; reason: string | null };
```

**The arrow between the board and the runner points ONE way, and it is joined above both.**
`plan-archive.service.ts` takes the held paths as a parameter; the board exposes `plansHeldByLease()`
from its barrel; `server/index.ts` composes them. `plan-runner` never reads a `kanban_*` row, and the
board's card routes reach the cost through the `planCost` service `createKanbanModule` threads into
them — the one cross-module import sits in the composition root, where `kanban.module.ts:15-19`
already says it belongs.

The relaunch ledger is `<KANBAN_METIS_STATE_ROOT>/relaunch-ledger.json`, written atomically
(temp + rename), shape `{ "<boardId>": { attempts: number, lastAt: number } }` —
`pm_relaunch_ledger.py:159-191`'s rule with Descent's own constants. The rate-limit signal is the
file `~/.claude/hooks/notify_api_error.sh` writes, repointed to `~/.cloudcli/rate_limit.json`; its
keys are read from that script and mirrored, never guessed.

Plan cost is READ, never re-ledgered: `readPlanLedger(planPath)` and `readRunFiles(dir)` already exist
in `server/modules/plan-runner/runner-state.transport.ts:142,259`, and every ledger row and every
receipt already carries a priced `cost_usd` — plus `receipt.json.plan_cost.total_usd`, the whole-plan
total precomputed by the runner itself. Nothing here prices a token.

### 8. The Metis fleet

```ts
// metis-spawn.service.ts
export async function reply(sessionId: string, text: string): Promise<KanbanMetisSession>;
```

`reply` is `resume` with the operator's words in place of the standard opening turn: the same
`--resume <sessionId>`, the same freshly-read brief, the same `--mcp-config`/`--strict-mcp-config`,
the same env, the text written to stdin and then EOF (`metis-spawn.service.ts:264-265`). A session
whose child is still RUNNING cannot receive it — its stdin was closed at spawn and no live-injection
path in this repository can reach it (measured; scout `cloudcli-metis` §4) — so the route answers 409
with `she is mid-turn — stop her first, then reply` and the composer is disabled with those words.

**The dial gets a home, because today it has none.** Measured: `kanban-metis.module.ts:126`
constructs the driver as `createMetisDriver({ registry, spawner })` with no `concurrency`, so the
requested value falls to `DEFAULT_CONCURRENCY` = 1 (`metis-driver.service.ts:261-266`), and the
driver's own comment says the board "has no such column" (:102-104). There is no env var, no column
and no route that moves it — so replacing the launch refusal with `live >= dial` would change
nothing observable and the operator's ask would go unmet. The dial becomes
`kanban_boards.concurrency` (§1), beside `autonomy` and `deepseek_flash` where its two siblings
already live, read at CALL time (never captured at construction), clamped `[0, CONCURRENCY_MAX]`,
moved by the board `PATCH`, and surfaced in the driver reading the panel already fetches.

**One predicate, three callers.** `canSpawn({ live, dial })` is pure arithmetic over two facts the
caller gathers — the shape `metis-liveness.ts` already uses, readable without a running server — and
`launch`, `resume` and `reply` all ask it. A reply that would exceed the dial is the same refusal,
naming the dial and its value; the fence exists on all three paths today and no path loses it.

**The shared cwd is deliberate.** Two children of one board share
`~/.claude/kanban-metis/<boardId>/`, and that is now the ordinary case rather than the refused one.
It is safe because nothing per-session is written there — every per-session file lives under
`~/.claude/state/kanban-metis/<sessionId>/` — and the real arbiter of who owns a card is the lease
CAS, not the directory. A per-session cwd is FORBIDDEN: `~/.claude/hooks/kanban_metis.py`'s
`board_id()` takes the leaf directly under the session root, and a deeper path would make every
board session invisible to the seclusion predicate.

`SubagentTranscriptView` (`target: { kind: 'metis', id }`) is the conversation, unchanged — chat's
own barrel exports it (`src/modules/chat/index.ts:16`) and the panel already imports it that way.
The composer beneath it is assembled from `PromptInput`'s primitives, which MOVE to `@/shared/ui` as
a pure move in Phase 17: the file is a headless kit (its only imports are `cn` and `Button, Tooltip`
from `@/shared/ui`) that has just acquired a second consumer, and chat's barrel does not export it —
a deep import into another feature module is refused by
`.agents/skills/frontend-module-standards/SKILL.md:30`. `ChatComposer` itself is 681 LOC of
chat-session coupling and is never imported here.

### 9. Cross-board Metis, as far as it goes here

One new `kanban-pm` tool, `list_features_all({ status?, tag? })`, answering every non-archived board's
cards with each card's `board { id, name }` — `mcp_tools_xboard.py:33-47`'s schema exactly. It is a
READ. Claims stay board-scoped, because a board Metis's cwd is `~/.claude/kanban-metis/<boardId>/` and
her one `--add-dir` is derived from that board's `project_id` — a card from another board would be
built in the wrong directory. The brief's `parallelism.md` chapter says exactly that, in place of
Descent's "she runs every board, current first".

### 10. The environment overrides a probe uses

Every runtime root this plan adds is redirectable by ONE variable, so a probe touches nothing live.
Each is read at CALL time, never captured at module load, and each falls back to the default named:

| Variable | Default | Who reads it |
|---|---|---|
| `DATABASE_PATH` | `~/.cloudcli/auth.db` | the whole server (`server/load-env.ts:43-46`) |
| `KANBAN_METIS_STATE_ROOT` | `~/.claude/state/kanban-metis` | the registry, and the relaunch ledger beside it |
| `KANBAN_ATTACHMENTS_ROOT` | `~/.cloudcli/kanban-attachments` | the attachments service |
| `CLOUDCLI_ACCOUNTS_ROOT` | `~/.cloudcli/accounts` | the account store, slots and the active-slug file |
| `CLOUDCLI_SPILL_ROOT` | `~/.cloudcli` | the spill sweep — `<root>/pending-lessons/`, `<root>/pending-memories/`, `<root>/pending-skills/` |
| `CLOUDCLI_RATE_LIMIT_PATH` | `~/.cloudcli/rate_limit.json` | the driver's rate-limit hold |
| `CLOUDCLI_PLANS_DIR` | `~/.claude/plans` | the plan-archive sweep |
| `CLOUDCLI_SCAFFOLD_ROOT` | `~/.cloudcli/sunset-scaffold` | where a scaffold phase keeps the copy its fill phase diffs against |

The scaffold copies do NOT live in `/tmp`: a twenty-six-phase run spans hours and can be resumed,
and `/tmp` is the one directory on this box that does not promise to survive that.

One more signature the telemetry phase needs, stated here because two phases read it:

```ts
export function accumulateUsage(jsonlPath: string, fromOffset: number):
  { tokensIn: number; tokensOut: number; cacheRead: number; cacheCreate: number; seen: string[]; offset: number };
```


## Project Constraints

Copied verbatim to every child. These are the rules and the mechanics, both.

1. **No test files, ever.** No `*.test.ts`, no `*.spec.ts`, no vitest or `node:test` file, no new
   entry under any `tests/` directory. The repository's backend and frontend standards documents each
   ask for tests; that clause is **OVERRIDDEN** by the operator's standing rule, and the `check` and
   `[[verify]]` commands in this plan are the verification. Where a standards document and this line
   disagree, this line wins.
2. **No branches, and no git writes of any kind inside the run** — no `add`, `commit`, `stash`,
   `checkout`, `restore`, `reset`, `clean`, `push`. The work ends in the working tree. A probe is
   undone from a backup copy taken by the same command, never with `git checkout --`.
3. **Healed means deleted.** No SUPERSEDED block, no "previously this was…", no pointer to removed
   text, no dead tempting code left behind. When this plan replaces a route, a type name, a guard or
   a doc page, the old one is removed in the same phase.
4. **Module size.** 300 LOC default ceiling, 500 soft, 800 hard. Several splits are made FOR you at
   plan time and are not yours to re-merge: the memory lane is three files (service, assert, caps),
   the accounts module is two services plus its routes, the lanes are one service file each. Never
   append a hundred lines to `server/shared/types.ts`, `src/shared/types.ts`,
   `server/shared/kanban-types.ts` or `src/shared/kanban-types.ts` — each takes small, named edits in
   this plan and nothing more.
5. **`~/.claude/descent/` is READ-ONLY in every phase.** Read it, port from it, cite it — never edit,
   move or delete anything under it. Phase 26 stops its systemd units and touches no file of its own.
   Deleting the tree is not in this plan.
6. **`/home/lyphe/.claude/CLAUDE.md` is the operator's file and is never edited by any phase**, not even to
   correct the two Descent lines it carries. This is not a preference: `~/.claude/hooks/enforce_shelf_channel.py`
   and its shell door `shelf_channel_bash.py` REFUSE an Edit, Write or Bash write that could add a
   line to that file, from any session and any soul (measured 2026-09-17 — this plan's own author was
   blocked by it mid-authoring). A phase that tried would be refused by the harness, not by taste.
   The two stale lines are named with their exact replacement text in Exclusions, where the report
   can hand them over. The one write that still reaches the file is the memory lane's `claude`
   target, when a person approves a candidate at runtime — the app running, not a phase writing.
7. **Cross-module imports go through barrels.** `server/modules/kanban-metis/` reaches the board only
   through `server/modules/kanban/index.ts`, the settings writer only through
   `server/modules/settings/index.ts`, the transcript reader only through
   `server/modules/providers/index.ts`. The accounts module imports no other feature module.
   On the client, `src/modules/kanban/index.ts` still exports `KanbanPanel` and nothing else.
7a. **The MCP program is a LEAF.** `kanban-pm-mcp.ts` and everything under
   `server/modules/kanban-metis/mcp/` import only from `mcp/`, from `node:` builtins and from
   `server/shared/`. A lesson tool reaches the board the way every other tool does — over HTTP through
   `kanban-pm-client.ts` against the `/api/kanban-pm` mount — never by importing a service.
8. **The real-system harness.** A probe NEVER touches the live database, the live state root or the
   live attachment root. These four snippets are the harness; use them verbatim rather than inventing
   a variant.

```bash
# (a) A scratch copy of the database, DISARMED so no board can spawn a Metis from a probe.
probe_db() {
  cp ~/.cloudcli/auth.db /tmp/sunset-probe.db
  python3 -c "import sqlite3; c=sqlite3.connect('/tmp/sunset-probe.db'); c.execute('update kanban_boards set autonomy=0'); c.commit(); c.close()"
}

# (b) A JWT for the first user, minted from the SCRATCH database's own secret.
mint_token() {
  python3 - /tmp/sunset-probe.db <<'PY'
import sqlite3, json, hmac, hashlib, base64, time, sys
conn = sqlite3.connect(sys.argv[1])
secret = conn.execute("select value from app_config where key='jwt_secret'").fetchone()[0].encode()
uid, uname = conn.execute('select id, username from users order by id limit 1').fetchone()
enc = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(',', ':')).encode()).rstrip(b'=')
now = int(time.time())
head = enc({'alg': 'HS256', 'typ': 'JWT'})
body = enc({'userId': uid, 'username': uname, 'iat': now, 'exp': now + 3600})
sig = base64.urlsafe_b64encode(hmac.new(secret, head + b'.' + body, hashlib.sha256).digest()).rstrip(b'=')
print((head + b'.' + body + b'.' + sig).decode())
PY
}

# (c) Boot a SECOND server on 7893 against the scratch database and scratch roots, keeping the
#     operator's local-server.json marker intact.
boot_probe_server() {
  cp ~/.cloudcli/local-server.json /tmp/sunset-marker.bak 2>/dev/null || true
  rm -rf /tmp/sunset-state /tmp/sunset-att && mkdir -p /tmp/sunset-state /tmp/sunset-att
  rm -rf /tmp/sunset-spill && mkdir -p /tmp/sunset-spill
  SERVER_PORT=7893 DATABASE_PATH=/tmp/sunset-probe.db KANBAN_METIS_STATE_ROOT=/tmp/sunset-state \
  KANBAN_ATTACHMENTS_ROOT=/tmp/sunset-att CLOUDCLI_ACCOUNTS_ROOT=/tmp/sunset-accounts \
  CLOUDCLI_SPILL_ROOT=/tmp/sunset-spill CLOUDCLI_RATE_LIMIT_PATH=/tmp/sunset-ratelimit.json \
    node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > /tmp/sunset-server.log 2>&1 &
  echo $! > /tmp/sunset-server.pid
  for i in $(seq 1 90); do curl -sf http://127.0.0.1:7893/api/auth/status > /dev/null && break; sleep 1; done
}

# (d) Stop it and put the marker back. Runs on EVERY exit path, including the aborted one.
stop_probe_server() {
  kill "$(cat /tmp/sunset-server.pid 2>/dev/null)" 2>/dev/null || true
  sleep 1
  cp /tmp/sunset-marker.bak ~/.cloudcli/local-server.json 2>/dev/null || true
  rm -rf /tmp/sunset-state /tmp/sunset-att /tmp/sunset-accounts /tmp/sunset-spill /tmp/sunset-probe.db /tmp/sunset-ratelimit.json
}
```

9. **Every probe command traps its own teardown**: `trap stop_probe_server EXIT` before the boot, so a
   read failing under `set -e` never strands the server on 7893 or leaves a scratch root behind. A
   probe that creates a board names it `probe-sunset<N>` — on the SCRATCH database, which is deleted
   whole by the teardown, so nothing of the operator's is ever written.
10. **Never run `npm run dev`** (Vite and the server together, never exits). `npm run build:client`,
    `npm run typecheck`, `npm run lint` and the boot snippet above are the tools. Any command that can
    exceed two minutes carries a `timeout` or runs in the background.
11. **The operator's own server is running on 3011 against the live database, and that is fine.** It
    never sees the scratch copy. On a `SQLITE_BUSY` run the command once more; if it fails again, file
    `[BLOCKED: sqlite busy]` rather than changing a pragma or a path.
12. **Nothing this plan builds writes inside the repository at runtime.** The corpus, the queues, the
    attachment bytes and the account slots all live under `~/.cloudcli/`, outside the work tree, and
    `*.db` is ignored anyway — `git check-ignore -q database/auth.db` is the proof Phase 1 runs, and
    Phase 5 proves the same of the attachment root by asking the code where it resolves. A phase that
    adds a runtime write path proves its root sits outside this directory; never that the tree is
    clean, which it is not and which is never a gate (DOCTRINE §9).
13. **Documentation has one home per lane, and every lane this plan ships has one.**
    `docs/kanban.md` — the board, the lesson STORE, attachments, the driver, the dial, the nudge and
    the reply. `docs/accounts.md` — the account switcher and the usage meters. `docs/memory-intake.md`
    — the Memory tab, its new server half, the memory-intake module, and the lesson REVIEW surface
    (the store is documented in `docs/kanban.md`; one cross-reference between them, never both).
    `docs/plan-runner.md` — the archive sweep and the plan-cost read. `docs/applications.md` — the
    tile's removal. No phase creates a new document; `docs/descent-proxy.md` is DELETED by the phase
    that deletes the proxy.
14. **The divergence rule.** If reality differs from this plan — a file is not where it says, a
    signature differs, a check fails for a reason the plan does not name — STOP, report the divergence
    verbatim, and do not improvise a fix.

## Phase 1 — The probe harness, the new tables, and the shared shapes
Depends on: none

```toml
[phase]
id = "1"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "scripts/sunset-probe.sh",
  "server/modules/database/kanban-schema.ts",
  "server/modules/database/memory-schema.ts",
  "server/modules/database/migrations.ts",
  "server/modules/database/repositories/kanban-learning.db.ts",
  "server/modules/database/repositories/memory-candidates.db.ts",
  "server/shared/kanban-types.ts",
  "src/shared/kanban-types.ts",
]
forbidden = [
  "server/modules/kanban/kanban-write.service.ts",
  "server/shared/types.ts",
]
athena = [
  "A new table is declared without IF NOT EXISTS, so the second boot of an existing database throws",
  "kanban_lessons.card_id uses ON DELETE CASCADE instead of SET NULL, so deleting a card destroys the lesson learned from it",
  "MemoryCandidateLean or MemoryCandidateFull is re-declared in kanban-types.ts, so one shape has two homes",
  "The memory table is declared inside KANBAN_SCHEMA_SQL, putting a non-board table in the board's script",
  "The repository opens its own database handle instead of taking the caller's, so a write lands outside its caller's transaction",
]

[[steps]]
kind = "edit"
path = "scripts/sunset-probe.sh"
what = "Create the four probe functions VERBATIM from Project Constraint 8 — probe_db, mint_token, boot_probe_server, stop_probe_server — as a sourceable bash file with no top-level side effects (no set -e, no auto-boot), so every later phase can `source scripts/sunset-probe.sh` and call them."
check = "bash -n scripts/sunset-probe.sh && source scripts/sunset-probe.sh && declare -F probe_db boot_probe_server stop_probe_server mint_token | wc -l"
expect = "4"

[[steps]]
kind = "edit"
path = "server/modules/database/kanban-schema.ts"
what = "Append the two BOARD tables and their index from Interfaces §1 to KANBAN_SCHEMA_SQL — kanban_lessons and kanban_session_usage. Column for column as written there; no extra column, no CHECK constraint the Interfaces does not name. The memory table does NOT go here."
check = "grep -c '^CREATE TABLE IF NOT EXISTS kanban_lessons\\|^CREATE TABLE IF NOT EXISTS kanban_session_usage' server/modules/database/kanban-schema.ts"
expect = "2"

[[steps]]
kind = "edit"
path = "server/modules/database/memory-schema.ts"
what = "Create MEMORY_SCHEMA_SQL with the memory_candidates table and its index from Interfaces §1, in the same idempotent shape as the board's script and with the same header warning about what a re-exec does and does not change."
check = "grep -c '^CREATE TABLE IF NOT EXISTS memory_candidates' server/modules/database/memory-schema.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/database/migrations.ts"
what = "Exec MEMORY_SCHEMA_SQL from runMigrations beside the board's own exec at :601-603 — after it, since both want the projects rebuild behind them. Nothing else in this file moves; the concurrency column Phase 14 adds is Phase 14's."
check = "grep -c 'MEMORY_SCHEMA_SQL' server/modules/database/migrations.ts"
expect_re = "^[1-9]"

[[steps]]
kind = "edit"
path = "server/shared/kanban-types.ts"
what = "Add ONLY the genuinely new board shapes — KanbanLesson, KanbanLessonLean, KanbanSessionUsage, KanbanVitals — each with the doc comment the backend standards require, and add the four new members to KanbanEventKind (lesson.staged, lesson.reviewed, attachment.removed, metis.nudged). KanbanVitals lives HERE and nowhere else, with the six keys Interfaces §7 now names — building, awaitingAnswer, awaitingApprove, lessonsPendingEstate, memoryPendingEstate, claimable: the two estate-wide counts carry the word in their name so a board id can never imply a board scope, and Phase 12 (whose manifest cannot edit this file) imports the type from here rather than re-declaring it in its service. MemoryCandidateLean and MemoryCandidateFull ALREADY EXIST at server/shared/types.ts:1866,1868 and are neither moved nor re-declared here; this file must not name them."
check = "grep -c \"'lesson.staged'\\|'lesson.reviewed'\\|'attachment.removed'\\|'metis.nudged'\" server/shared/kanban-types.ts"
expect = "4"

[[steps]]
kind = "edit"
path = "src/shared/kanban-types.ts"
what = "Mirror the same four types and the same four event-kind members on the client side, field for field. This file and its server twin are one shape in two places; a difference here is a bug."
check = "grep -c \"'lesson.staged'\\|'lesson.reviewed'\\|'attachment.removed'\\|'metis.nudged'\" src/shared/kanban-types.ts"
expect = "4"

[[steps]]
kind = "edit"
path = "server/modules/database/repositories/kanban-learning.db.ts"
what = "Create the repository for kanban_lessons and kanban_session_usage in the shape of repositories/kanban-checklist.db.ts: every function takes the caller's Database handle, returns rows, opens no transaction of its own. Insert/select/update for lessons, upsert-by-session for the usage table, and the lean lesson projection (no body, no draft_path). Create repositories/memory-candidates.db.ts the same way for memory_candidates, with its own mc-<n> counter and its own lean projection (no body, no rationale) — it never touches kanban_id_seq."
check = "npm run typecheck > /dev/null 2>&1 && echo TYPECHECK-OK"
expect = "TYPECHECK-OK"

[[verify]]
cmd = '''
set -e
source scripts/sunset-probe.sh
trap stop_probe_server EXIT
probe_db
boot_probe_server
python3 -c "
import sqlite3
c = sqlite3.connect('/tmp/sunset-probe.db')
names = sorted(r[0] for r in c.execute(\"select name from sqlite_master where type='table'\"))
want = ['kanban_lessons', 'kanban_session_usage', 'memory_candidates']
print('TABLES', sum(1 for w in want if w in names))
"
'''
expect = "TABLES 3"
timeout_s = 420

[[verify]]
cmd = '''
set -e
trap 'rm -f /tmp/sunset-verify-1.mts' EXIT
cat > /tmp/sunset-verify-1.mts <<'TS'
import '@/load-env.js';
const db = process.env.DATABASE_PATH || '';
const repo = '/home/lyphe/.claude/claudecodeui_lyphe';
console.log('DB-OUTSIDE-REPO', db.length > 0 && !db.startsWith(repo));
TS
node_modules/.bin/tsx --tsconfig=server/tsconfig.json /tmp/sunset-verify-1.mts < /dev/null
'''
expect = "DB-OUTSIDE-REPO true"
timeout_s = 300

[[verify]]
cmd = "{ grep -c 'MemoryCandidateLean\\|MemoryCandidateFull' server/shared/kanban-types.ts src/shared/kanban-types.ts || true; } | { grep -cv ':0$' || true; }"
expect = "0"
```

**Read first.** `server/modules/database/kanban-schema.ts` (its header states the re-exec trap),
`repositories/kanban-checklist.db.ts` (the repository shape), `server/shared/types.ts:1866-1876` (the
memory shapes that already exist), `docs/kanban.md` §"The tables" and §"Ids, order and time", and
Project Constraint 8.

**What to build.** The harness other phases lean on, three tables in two scripts, the four genuinely
new board shapes, and two row-level repositories. No service, no route, no behaviour.

**Sirens.** You will want to put `memory_candidates` in `KANBAN_SCHEMA_SQL` because that is where
tables go — it is not a board table, it has no `board_id`, and the module that owns it (Phase 3) is
not the board. You will want to add a CHECK constraint on `status` because `kanban_cards` has one —
do not: Descent's lesson and candidate statuses grew a value twice, and an import of a value the
CHECK forbids fails the whole transaction. You will want to re-declare the memory types beside the
lesson ones for symmetry; the backend standard names that defect by name
(`backend-module-standards/SKILL.md:34`). `kanban_lessons.card_id` is `SET NULL` deliberately: a
lesson outlives the card it was learned on.

**The tsx flag form, measured on this box.** The installed tsx is 4.21.0, and in the `-e` form it
parses `--tsconfig <path>` in its first pass and then takes the tsconfig path as the ENTRY FILE: the
eval code never runs and the command exits **0 with empty stdout**. The `=` form,
`--tsconfig=server/tsconfig.json -e "…"`, runs it — this phase's second verify uses that form and
prints `DB-OUTSIDE-REPO true` (both forms run and confirmed 2026-09-17). The space form with a real
entry file, as Project Constraint 8's `boot_probe_server` uses it, is unaffected and is not yours to
change. **You will see the space form in the `[[verify]]` commands of LATER phases, and it is broken
there too — do not go and fix them, do not edit any phase but this one; note it in your report and
keep rowing.** Each is its own phase's to cure when the runner reaches it.

**The proof the operator asked for.** "Making sure its gitignored" is answered by the second verify,
which resolves `DATABASE_PATH` the way the server does (`load-env.ts:43-46`) and shows it lands
outside the work tree by construction — not by a `.gitignore` line over a path the server never
opens.

## Phase 2 — The lessons lane: the service, its five routes, and the review fence
Depends on: Phase 1

```toml
[phase]
id = "2"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 3000
manifest = [
  "server/modules/kanban/kanban-lessons.service.ts",
  "server/modules/kanban/kanban-write.service.ts",
  "server/modules/kanban/routes/learning.routes.ts",
  "server/modules/kanban/routes/kanban.routes.ts",
  "server/modules/kanban/kanban.module.ts",
  "server/modules/kanban/index.ts",
  "server/modules/kanban-metis/kanban-metis.routes.ts",
  "server/shared/types.ts",
  "src/shared/kanban-types.ts",
]
forbidden = [
  "server/modules/database/kanban-schema.ts",
  "server/modules/kanban/kanban-cards.service.ts",
]
athena = [
  "reviewLesson updates without the status='staged' guard, so a second approve re-stamps an already-reviewed row",
  "The REVIEW_PATH refusal matches the path before it is percent-decoded, so /lessons/ls-1%2Fapprove walks straight past it",
  "stageLesson fabricates a board id for the frame, repainting some innocent board's lane counts",
  "listLessons returns the body column, so a 50-row index carries fifty full lesson bodies to the client",
  "The widened boardId now lets an ordinary card write pass null by accident, and that write sends no frame at all",
  "REVIEW_PATH also catches a read or a stage on the same mount, so the 403 proves only that the door refuses everything and the MCP surface Phase 7 is built on is already shut",
  "KanbanBoardEvent.boardId was widened on the server and not in its client mirror, or the reverse, so one wire shape has two declarations that disagree",
  "The fence probe's 200 came from a server whose registry never adopted the seeded session — the session directory was written after the boot rather than before it, or the sleeper's cmdline does not carry the session id — so the pair proves nothing about a live Metis",
]

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-write.service.ts"
what = "Widen KanbanWriteSpec.boardId to string | null | ((value: T) => string | null), skip the laneCounts read when it resolves to null, and send the frame with boardId null and lanes [] so an estate-scoped write still has a signal on the wire. kanban_events.board_id is already TEXT NULL (kanban-schema.ts:138), so the row needs no change. Say in the file's own header why the seam now admits a boardless write: a staged lesson has no board, and the alternative is twenty-eighth verb inventing one. The WIRE type that frame is declared as is widened in the next step; no type file is edited here."
check = "grep -c 'string | null' server/modules/kanban/kanban-write.service.ts"
expect_re = "^[1-9]"

[[steps]]
kind = "edit"
path = "server/shared/types.ts"
what = "Widen KanbanBoardEvent.boardId from string to string | null at server/shared/types.ts:283, and field for field in its client mirror src/shared/kanban-types.ts:395 — the frame the previous step now sends with a null board cannot be carried by a type that says string, and the two declarations of one wire shape are never allowed to disagree. Add to each declaration's header the two sentences that say WHY: a lesson staged against the estate has no board and therefore no lanes, and every consumer already tests the board id before it trusts the rest of the frame, so a null-board frame is inert where it does not apply. Say in the client mirror's header, as the measured truth it is, that KanbanPanel's subscription drops a frame whose boardId is not a string — the lessons list does not repaint from this frame and does not claim to. These two files take THIS edit and its header sentences and nothing else (Project Constraint 4)."
check = "grep -l 'boardId: string | null' server/shared/types.ts src/shared/kanban-types.ts | wc -l"
expect = "2"

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-lessons.service.ts"
what = "Create the five verbs of Interfaces §2 over the Phase 1 repository, each write through writeKanban with kind lesson.staged or lesson.reviewed and boardId null unless the lesson names a card, in which case that card's board. Port ~/.claude/descent/store_lessons.py: stage_lesson (:158) mints ls-<n> at status staged and validates the card reference; review_lesson (:229) is a CAS on status='staged' answering null for an unknown id and throwing for a non-staged one; list_lessons (:288) is lean, ORDER BY created_at DESC, id DESC; approvedIndex is store_actionable.py:170-171's approved top-50."
check = "grep -c 'export function stageLesson\\|export function listLessons\\|export function getLesson\\|export function reviewLesson\\|export function approvedIndex' server/modules/kanban/kanban-lessons.service.ts"
expect = "5"

[[steps]]
kind = "edit"
path = "server/modules/kanban/routes/learning.routes.ts"
what = "Create createLearningRoutes(services): Router carrying the five lesson routes of Interfaces §5 — thin handlers that parse, call one service verb and format, exactly like board.routes.ts:170-177. A malformed status or limit is a 400 from the route; an unknown id is a 404; a non-staged review is a 422 carrying the service's words. A staged lesson answers 201 with its row, which is what the fence probe measures on the child mount. Use the router onto the factory in kanban.routes.ts:42-51 in the same step."
check = "grep -c \"router.get('/lessons'\\|router.get('/lessons/:lessonId'\\|router.post('/lessons'\\|router.post('/lessons/:lessonId/approve'\\|router.post('/lessons/:lessonId/reject'\" server/modules/kanban/routes/learning.routes.ts"
expect = "5"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/kanban-metis.routes.ts"
what = "Add the REVIEW_PATH refusal to kanbanMetisSecretGuard beside IMPORT_PATH (:73): /\\/lessons\\/[^/]+\\/(approve|reject)(\\/|$)/i, matched against the DECODED path the same way its neighbour is, answering 403 with one sentence naming the fence. A read and a stage on the same mount are untouched — a Metis stages and reads lessons; she does not review them. This file gains NO probe-only export: the fence probe derives its own credential from the scratch database (the verify below), a second process cannot make this server's registry accept one however it is minted, and an exported mintProbeCredential left over from an earlier attempt is deleted here — an export with no caller is dead tempting code (Project Constraint 3). Keep the knowledge that export carried by writing it into the guard's own doc comment: a credential alone is not acceptance, because the guard also asks this server's live registry whether that session is running, and that map is filled by the spawner and serialized nowhere — which is the revocation the whole scheme rests on. The file stands near 320 LOC with the refusal in; the deletion trims it, and a split of the door guard into a sibling module is a follow-up for the two drivers, never this run."
check = '''printf '%s %s\n' "$(grep -c REVIEW_PATH server/modules/kanban-metis/kanban-metis.routes.ts)" "$(grep -c mintProbeCredential server/modules/kanban-metis/kanban-metis.routes.ts)"'''
expect_re = "^[1-9][0-9]* 0$"

[[verify]]
cmd = '''
set -e
source scripts/sunset-probe.sh
trap stop_probe_server EXIT
probe_db
boot_probe_server
TOK=$(mint_token)
BASE=http://127.0.0.1:7893/api/kanban
ID=$(curl -sf -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"name":"probe lesson","summary":"a probe staged this","trigger":"complex_task"}' \
  "$BASE/lessons" | python3 -c "import sys,json; print(json.load(sys.stdin)['lesson']['id'])")
S1=$(curl -sf -H "Authorization: Bearer $TOK" "$BASE/lessons/$ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['lesson']['status'])")
S2=$(curl -sf -X POST -H "Authorization: Bearer $TOK" "$BASE/lessons/$ID/approve" | python3 -c "import sys,json; print(json.load(sys.stdin)['lesson']['status'])")
C2=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $TOK" "$BASE/lessons/$ID/approve")
C3=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOK" "$BASE/lessons/ls-999999")
echo "$S1 $S2 $C2 $C3"
'''
expect = "staged approved 422 404"
timeout_s = 420

[[verify]]
cmd = '''
set -e
SID=sunset-fence-probe
source scripts/sunset-probe.sh
trap 'kill "$(cat /tmp/sunset-fence-child.pid 2>/dev/null)" 2>/dev/null || true; rm -f /tmp/sunset-fence-child.pid; stop_probe_server' EXIT
probe_db
python3 -c "import time; time.sleep(900)  # $SID" > /dev/null 2>&1 &
echo $! > /tmp/sunset-fence-child.pid
cp ~/.cloudcli/local-server.json /tmp/sunset-marker.bak 2>/dev/null || true
rm -rf /tmp/sunset-state /tmp/sunset-att && mkdir -p /tmp/sunset-state/$SID /tmp/sunset-att
rm -rf /tmp/sunset-spill && mkdir -p /tmp/sunset-spill
python3 - /tmp/sunset-state/$SID/spec.json $SID <<'PY'
import json, sys, time
path, sid = sys.argv[1], sys.argv[2]
json.dump({"session_id": sid, "board_id": "", "board_name": "", "provider": "claude",
           "model": "claude-sonnet-4", "owner": "fence", "launched_by": "operator",
           "api_origin": "http://127.0.0.1:7893", "cwd": "/tmp", "opening_turn": "fence probe",
           "brief_path": "/tmp/fence.md", "brief_sha256": "0" * 64, "resumed": False,
           "started_at": int(time.time() * 1000)}, open(path, "w"), indent=1)
PY
cp /tmp/sunset-fence-child.pid /tmp/sunset-state/$SID/child.pid
SERVER_PORT=7893 DATABASE_PATH=/tmp/sunset-probe.db KANBAN_METIS_STATE_ROOT=/tmp/sunset-state \
KANBAN_ATTACHMENTS_ROOT=/tmp/sunset-att CLOUDCLI_ACCOUNTS_ROOT=/tmp/sunset-accounts \
CLOUDCLI_SPILL_ROOT=/tmp/sunset-spill CLOUDCLI_RATE_LIMIT_PATH=/tmp/sunset-ratelimit.json \
  node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > /tmp/sunset-server.log 2>&1 &
echo $! > /tmp/sunset-server.pid
for i in $(seq 1 90); do curl -sf http://127.0.0.1:7893/api/auth/status > /dev/null && break; sleep 1; done
TOK=$(mint_token)
CRED=$(python3 - /tmp/sunset-probe.db $SID <<'PY'
import sqlite3, hmac, hashlib, sys
secret = sqlite3.connect(sys.argv[1]).execute("select value from app_config where key='jwt_secret'").fetchone()[0].encode()
sid = sys.argv[2]
print(f"{sid}.{hmac.new(secret, sid.encode(), hashlib.sha256).hexdigest()}")
PY
)
ID=$(curl -sf -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"name":"fence probe","summary":"for the guard","trigger":"complex_task"}' \
  http://127.0.0.1:7893/api/kanban/lessons | python3 -c "import sys,json; print(json.load(sys.stdin)['lesson']['id'])")
READ=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $CRED" http://127.0.0.1:7893/api/kanban-pm/lessons)
STAGE=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $CRED" -H 'Content-Type: application/json' \
  -d '{"name":"a metis staged this","summary":"s","trigger":"complex_task"}' http://127.0.0.1:7893/api/kanban-pm/lessons)
REVIEW=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $CRED" "http://127.0.0.1:7893/api/kanban-pm/lessons/$ID/approve")
ENCODED=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $CRED" "http://127.0.0.1:7893/api/kanban-pm/lessons/$ID%2Fapprove")
OPERATOR=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $TOK" "http://127.0.0.1:7893/api/kanban/lessons/$ID/approve")
echo "MCP-READ $READ MCP-STAGE $STAGE MCP-REVIEW $REVIEW ENCODED $ENCODED OPERATOR $OPERATOR"
'''
expect = "MCP-READ 200 MCP-STAGE 201 MCP-REVIEW 403 ENCODED 403 OPERATOR 200"
timeout_s = 480
```

**Read first.** `~/.claude/descent/store_lessons.py` whole (330 lines, the source of truth for this
lane), `server_api_lessons.py:20-22`, `kanban-metis.routes.ts:45-175` (`readAppJwtSecret`,
`kanbanMetisSecretGuard` and `IMPORT_PATH`), `metis-env.service.ts:75-77` (`metisBearer`: the
credential is `<sessionId>.<hmac-sha256(app jwt secret, sessionId)>`, and it arrives as
`Authorization: Bearer`, never in a header of its own),
`metis-registry.service.ts:159-176,229,282` (the registry adopts the sessions on disk ONCE, at
construction, and `ownsSession` requires a live pid whose `/proc/<pid>/cmdline` names the session),
`kanban-checklist.service.ts:232-257`, `docs/kanban.md` §"The one write seam".

**What to build.** One service, one routes file, one seam widened, one wire type widened on both
sides, one refusal added.

**The fence probe is the point of the second verify, and it is falsifiable both ways.** The SAME
credential must read 200, stage 201 and review 403 — a credential that fails everything proves
nothing, and a guard that refuses everything would break the MCP surface Phase 7 depends on. Every
number in that verify was MEASURED against a booted probe server on 2026-09-17 before it was written
down: seeded, the line comes back `MCP-READ 200 MCP-STAGE 201 MCP-REVIEW 403 ENCODED 403 OPERATOR
200` in 3.3 s; with the seeded session directory removed and nothing else changed, the same script
prints `MCP-READ 401 MCP-STAGE 401 MCP-REVIEW 403` — that is the falsification, and it is why the
seed is the probe's whole apparatus.

**Why that verify boots the server itself, and what you may not do about it.** The guard asks this
server's OWN registry whether the session is running, and the registry adopts what it finds on disk
at construction — so the session directory (`spec.json`, plus a `child.pid` naming a live process
whose cmdline carries the session id) must exist BEFORE the boot, and `boot_probe_server` clears
`/tmp/sunset-state` on its way in. The verify therefore inlines snippet (c) of Project Constraint 8
with the seed written between its `mkdir` and its launch, keeping the same port, the same scratch
roots, the same `/tmp/sunset-server.pid` and the same marker backup, so the harness's own
`stop_probe_server` still tears every part of it down on every exit path. `scripts/sunset-probe.sh`
is Phase 1's file and is not in your manifest: do not edit it. Three things were MEASURED to be
dead ends on 2026-09-17 and are not to be re-tried: `tsx --tsconfig <cfg> -e "<program>"` parks
forever with stdin open and prints nothing at EOF (the space form hands tsx the config path as its
ENTRY FILE, so the program never runs at all — which is also why nothing inside such an eval, the
`@/…` alias included, can be said to resolve or not), and a credential minted in a second process is well-formed and refused 401 because
the registry is the revocation. If the pair the verify measures is anything other than 200 and 403,
STOP and report the divergence verbatim — never weaken the guard, the header test or the probe to
make a number appear.

**Sirens.** You will want to add an MCP-facing approve so Metis can file her own lessons — that is
the one fence this lane has; the guard is now where it lives. You will want to score lessons for
relevance: there is no scoring anywhere in Descent, the index is recency, and inventing a score here
would make the corpus disagree with the brief that reads it. You will see `descent_id` and want to
fill it — the importer fills it in Phase 6.

**Sirens, the second set.** You will find most of this phase already on disk from an earlier
attempt that blocked on its verify text, and you will want to call the phase done without reading
what is there — read it, hold it to these steps, and change what disagrees. You will want to teach
`scripts/sunset-probe.sh` to seed a session so the verify can call `boot_probe_server` — it is not
your file; the verify inlines the boot instead. You will want to make the guard accept the
`X-Kanban-Pm-Token` header the old verify sent, or to accept a credential minted in a second
process: do neither — the header is `Authorization: Bearer` and the live registry is the
revocation. And when reality diverges from this phase in any other way — a file not where it says,
a signature that differs, a check that fails for a reason written nowhere above — stop, report the
divergence verbatim, and do not improvise a fix.

## Phase 3 — The memory-intake module: its own home, its four routes, its five write targets
Depends on: Phase 1

```toml
[phase]
id = "3"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 3300
manifest = [
  "server/modules/memory-intake/memory.service.ts",
  "server/modules/memory-intake/memory-assert.ts",
  "server/modules/memory-intake/memory-caps.ts",
  "server/modules/memory-intake/memory.routes.ts",
  "server/modules/memory-intake/memory-intake.module.ts",
  "server/modules/memory-intake/index.ts",
  "server/index.ts",
]
forbidden = [
  "server/modules/kanban",
  "server/shared/types.ts",
]
athena = [
  "A cap breach truncates the target file instead of refusing, so an approved memory silently loses somebody else's line",
  "assertIntoTarget writes the note file directly rather than temp-file-then-rename, so a crash mid-write leaves a half file the next session reads",
  "The target allowlist carries 'user' from the stale DDL comment, or omits 'rules'/'requirements', so a candidate is filed into a target the door never validated",
  "approveMemoryCandidate flips the row before the file write succeeds, so a MemoryRefusal leaves a row claiming approved with nothing on disk",
  "The module reaches into the kanban barrel — for the id mint, the write seam or a frame — and re-couples the lane to a board it has no column for",
]

[[steps]]
kind = "edit"
path = "server/modules/memory-intake/memory-caps.ts"
what = "Port store_memory_caps.py's table exactly: CAP_MEMORY_MD max_lines 200 / max_line_chars 250, CAP_RULES_MD and CAP_REQUIREMENTS_MD max_lines 60 / max_total_chars 2000, CAP_TOPIC and CAP_CLAUDE_MD null (uncapped). One exported table plus the predicate that reads it; a breach is described in words, since those words become the candidate's refusal."
check = "grep -c '200\\|250\\|60\\|2000' server/modules/memory-intake/memory-caps.ts"
expect_re = "^[1-9]"

[[steps]]
kind = "edit"
path = "server/modules/memory-intake/memory-assert.ts"
what = "Port store_memory_assert.py's _steps() (:165-214) and _atomic_write (:258-274): the five targets of Interfaces §3, each path DERIVED from the target and never read off the row, guard-then-write in two passes, every byte write a temp file in the same directory followed by a rename. Export assertIntoTarget and MemoryRefusal. MEMORY_TARGETS is IMPORTED from memory.service.ts, never re-declared here — it has one home, beside the door that validates against it."
check = "grep -c 'MEMORY.md\\|RULES.md\\|REQUIREMENTS.md' server/modules/memory-intake/memory-assert.ts"
expect_re = "^[3-9]"

[[steps]]
kind = "edit"
path = "server/modules/memory-intake/memory.service.ts"
what = "Port store_memory.py's verbs per Interfaces §3 over the Phase 1 repository — no writeKanban, no event row, no frame; the row's own created_at and reviewed_at are the record. Export MEMORY_TARGETS here. validateMemoryArgs is store_memory_door.py:37's seven-key door: target in the five-value allowlist, name at most 80 chars, body non-empty and at most 4000, project slug required and existing for memory and topic, index_line required and shaped for memory alone. approveMemoryCandidate asserts LAST and records the refusal without flipping the row when it throws. Every row leaves this module with its sessionId resolved through sessionsDb.resolveAppSessionId, reached via the providers or sessions barrel — display-only provenance that gates nothing but drives the panel's isMine/mineFirst ordering. importDescentCandidates is NOT written here and its absence is not a gap: the descent_id upsert it stands on belongs to repositories/memory-candidates.db.ts, which Phase 6 owns along with this file and the barrel, and over the Phase 1 repository the only insert available here would mint a fresh mc-<n> on every re-import. DescentMemoryRow likewise gets its home in Phase 6; declaring it here would be the second home this lane exists to remove. The barrel exports createMemoryIntakeModule plus this module's own verbs, so Phase 6 has one door to add to."
check = "grep -c 'export const MEMORY_TARGETS\\|resolveAppSessionId' server/modules/memory-intake/memory.service.ts"
expect_re = "^[2-9]"

[[steps]]
kind = "edit"
path = "server/modules/memory-intake/memory.routes.ts"
what = "The four routes of Interfaces §3, answering the { reachable } envelope the client is built on: a list that is MemoryPending, a by-id read that is MemoryCandidateRead (reachable true with candidate null when no row carries that id), and the two writes answering { candidate } or 404 or a 422 carrying the refusal's plain English. A malformed id fails /^[A-Za-z0-9_-]{1,64}$/ at the route with a 422 and never reaches the service. Wire the module and its barrel, and mount it in server/index.ts at /api/memory behind authenticateToken — never on the kanban router."
check = "grep -c \"'/api/memory'\" server/index.ts"
expect_re = "^[1-9]"

[[verify]]
cmd = '''
set -e
source scripts/sunset-probe.sh
trap stop_probe_server EXIT
probe_db
boot_probe_server
TOK=$(mint_token)
B=http://127.0.0.1:7893
LIST=$(curl -sf -H "Authorization: Bearer $TOK" "$B/api/memory" | python3 -c "import sys,json; d=json.load(sys.stdin); print('env', d.get('reachable'), 'rows', isinstance(d.get('candidates'), list))")
READ=$(curl -sf -H "Authorization: Bearer $TOK" "$B/api/memory/mc-999999" | python3 -c "import sys,json; d=json.load(sys.stdin); print('read', d.get('reachable'), d.get('candidate'))")
BAD=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOK" "$B/api/memory/not..an..id")
echo "$LIST $READ $BAD"
'''
expect = "env True rows True read True None 422"
timeout_s = 480

[[verify]]
cmd = '''
set -e
trap 'rm -f /tmp/sunset-p3-onehome.ts /tmp/sunset-p3-onehome.db' EXIT
cat > /tmp/sunset-p3-onehome.ts <<TS
import * as svc from '$PWD/server/modules/memory-intake/memory.service.ts';
import * as asrt from '$PWD/server/modules/memory-intake/memory-assert.ts';
console.log('TARGETS', [...svc.MEMORY_TARGETS].sort().join(','), 'ONE-HOME', !Object.keys(asrt).includes('MEMORY_TARGETS'));
TS
DATABASE_PATH=/tmp/sunset-p3-onehome.db node_modules/.bin/tsx --tsconfig=server/tsconfig.json /tmp/sunset-p3-onehome.ts < /dev/null
'''
expect = "TARGETS claude,memory,requirements,rules,topic ONE-HOME true"
timeout_s = 300

[[verify]]
cmd = "{ grep -rn 'truncat' server/modules/memory-intake/ || true; } | wc -l"
expect = "0"

[[verify]]
cmd = "{ grep -rli 'memory' server/modules/kanban/routes/ server/modules/kanban/kanban.module.ts || true; } | wc -l"
expect = "0"
```

**Read first.** `~/.claude/descent/store_memory.py`, `store_memory_assert.py`, `store_memory_caps.py`
and `store_memory_door.py` — all four. `server/shared/types.ts:1866-1876` (the four wire shapes,
already canonical). `src/modules/memory-intake/context/MemoryIntakeContext.tsx:66,105` and
`MemoryIntakePanel.tsx:68,78` (what the client reads off the envelope, and what `sessionId` drives).
`~/.claude/hooks/enforce_shelf_channel.py`: it BLOCKS a direct Edit or Write that adds a line to
`RULES.md`, `REQUIREMENTS.md`, `CLAUDE.md` or a project's `memory/` directory, which is exactly why
this lane exists — the app's own runtime write is not that hook's subject, a builder hand-editing one
of those files is.

**What to build.** A module: caps, writer, service, routes, barrel, mount. It is the lane's whole
home — no board import, no write seam, no frame.

**Sirens.** The DDL comment on Descent's `target` column lists a fourth value `user`; the enforced
allowlist has five and no `user` (`store_memory_assert.py:90`). Port the CODE's list. You will want a
cap breach to trim the file to fit — it must refuse, leave the candidate pending, and record the
words. You will want to write into the operator's real `~/.claude/CLAUDE.md` while testing — do not:
Project Constraint 6, and the harness will refuse you anyway. You will want to mint ids from
`kanbanIdsDb` because it is right there; this module keeps its own counter, because borrowing the
board's is the coupling this phase exists to remove.

**Sirens, the second set.** Most of this module is already on disk from an attempt that blocked on
verify #2's COMMAND, not on its code — you will want to call the phase done without reading what is
there. Read all six files, hold them to the four steps above, and change what disagrees. The
verify's shape is MEASURED and is not yours to re-cut: `tsx --tsconfig <cfg> -e "<program>"`
(space-separated) swallows the `-e` pair, takes its program from the inherited stdin instead and
exits 0 printing nothing — measured on tsx 4.21.0 here on 2026-09-17, and again in Phase 2's own
note. So the verify writes its three lines to `/tmp/sunset-p3-onehome.ts`, runs THAT file with
`--tsconfig=` joined by an equals sign, `< /dev/null`, and a scratch `DATABASE_PATH` no live
database answers, and removes it on every exit path. Do not re-introduce `-e`: an eval is CJS-loaded
and cannot load the server graph at all — the kanban barrel dies on `@openai/codex-sdk`'s exports map
(measured 2026-09-17) — while the same import from an entry file resolves. The `@/…` alias DOES
resolve under `--tsconfig=server/tsconfig.json` (measured: `import * as u from '@/shared/utils.js'`
prints `object`); a relative path is still the plainer spelling here. And the two big files
are this plan's own shape: `memory-assert.ts` (~390 LOC) and `memory.service.ts` (~365 LOC) sit over
the 300 default and under the 500 soft cap, because Project Constraint 4 makes this lane three files
and the weight is path derivation, the seven-key door and the why-comments — never re-split them,
never re-merge them, and never shed the comments to reach 300. When reality diverges from this phase
in any other way — a file not where it says, a signature that differs, a check that fails for a
reason written nowhere above — stop, report the divergence verbatim, and do not improvise a fix.

## Phase 4 — The two spill queues, the two commands, and the tab repointed
Depends on: Phase 2, Phase 3

```toml
[phase]
id = "4"
builder = "hephaestus"
model = "opus"
builder_reason = "plumbing only inside the .tsx files: an api-key rename and one refusal string threaded through existing components, with no composition, layout or new copy"
code_change = true
doc_sweep = "foreground"
expected_s = 3000
manifest = [
  "server/modules/kanban/kanban-spill.service.ts",
  "server/modules/kanban/kanban.module.ts",
  "server/modules/memory-intake/memory-spill.service.ts",
  "server/modules/memory-intake/memory-intake.module.ts",
  "src/shared/api.ts",
  "src/modules/memory-intake",
  "src/i18n",
  "/home/lyphe/.claude/commands/learn.md",
  "/home/lyphe/.claude/commands/remember.md",
]
forbidden = [
  "server/modules/memory-intake/memory-assert.ts",
  "server/modules/kanban/kanban-lessons.service.ts",
]
athena = [
  "The sweep reads a spill file that is still being written, because it does not require the atomic .json rename the command performs",
  "A spill file that fails validation is left in place and re-read every 15 seconds forever",
  "A sweep starts a second interval per module construction, so two servers on one host double-ingest",
  "The client still calls /api/descent/memory somewhere, so the Memory tab half-works after the proxy is deleted",
  "The refusal copy still says Descent — in useMemoryReview.ts's literal or in the memory.unreachable i18n key — so the screen names a service that is gone",
]

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-spill.service.ts"
what = "The board's own queue door: a 15-second sweep ingesting <CLOUDCLI_SPILL_ROOT>/pending-lessons/*.json through stageLesson, ported from lessons_ingest.py. Only files ending .json (a .tmp is still being written), each file deleted after its row lands, each failure moved to a failed/ sibling with its reason so the same file is never re-read forever. One interval per module construction, unref'd, started from kanban.module.ts."
check = "grep -c 'pending-lessons' server/modules/kanban/kanban-spill.service.ts"
expect_re = "^[1-9]"

[[steps]]
kind = "edit"
path = "server/modules/memory-intake/memory-spill.service.ts"
what = "The memory lane's own queue door, same shape and same cadence, over <CLOUDCLI_SPILL_ROOT>/pending-memories/*.json through stageMemoryCandidate, ported from memory_ingest.py and started from memory-intake.module.ts. Each module sweeps its OWN queue; there is no third home that knows about both."
check = "grep -c 'pending-memories' server/modules/memory-intake/memory-spill.service.ts"
expect_re = "^[1-9]"

[[steps]]
kind = "edit"
path = "src/shared/api.ts"
what = "Point all FIVE memory calls at the new module — pending, approved (the same route at ?status=approved), candidate, approve, reject — as api.memory.*, against /api/memory…, and delete the api.descent memory entries. The response shapes are unchanged, so every consumer keeps its branches; only the key and the URL move. The accounts entries stay until Phase 9."
check = "{ grep -c '/api/descent/memory' src/shared/api.ts || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "src/modules/memory-intake"
what = "Follow the api key rename through the five call sites, and correct the copy the rename makes false: useMemoryReview.ts:20's literal 'Descent is not reachable.' and the memory.unreachable i18n key become the same sentence about the memory queue itself, in every locale file that carries the key. Healed means deleted — no Descent word survives in this module's user-visible text."
check = "{ grep -rci 'descent' src/modules/memory-intake/ || true; } | { grep -cv ':0$' || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/commands/remember.md"
what = "Repoint the spill directory to ~/.cloudcli/pending-memories (lines 70 and 75), the review surface to CloudCLI's Memory tab in place of http://127.0.0.1:7878 (line 91), and the log line to the CloudCLI server's own log in place of journalctl -u descent (line 96). Nothing else in the command changes."
check = "{ grep -c 'descent' /home/lyphe/.claude/commands/remember.md || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/commands/learn.md"
what = "Repoint the spill directory to ~/.cloudcli/pending-lessons (lines 35, 37, 41) and replace the descent-pm dedupe sentence at line 24 with the kanban-pm one — the tool names are identical, only the server word moves."
check = "{ grep -c 'descent' /home/lyphe/.claude/commands/learn.md || true; }"
expect = "0"

[[verify]]
cmd = '''
set -e
source scripts/sunset-probe.sh
trap stop_probe_server EXIT
probe_db
boot_probe_server
TOK=$(mint_token)
STAMP=$(date +%s)
mkdir -p /tmp/sunset-spill/pending-lessons /tmp/sunset-spill/pending-memories
printf '%s' '{"name":"spill probe","summary":"dropped by a probe","trigger":"complex_task"}' > /tmp/sunset-spill/pending-lessons/"$STAMP"-spill-probe.json.tmp
mv /tmp/sunset-spill/pending-lessons/"$STAMP"-spill-probe.json.tmp /tmp/sunset-spill/pending-lessons/"$STAMP"-spill-probe.json
printf '%s' '{"name":"spill memory","body":"a probe proposed this","target":"topic","project":"sunset"}' > /tmp/sunset-spill/pending-memories/"$STAMP"-spill-mem.json.tmp
mv /tmp/sunset-spill/pending-memories/"$STAMP"-spill-mem.json.tmp /tmp/sunset-spill/pending-memories/"$STAMP"-spill-mem.json
for i in $(seq 1 30); do
  N=$(curl -sf -H "Authorization: Bearer $TOK" 'http://127.0.0.1:7893/api/kanban/lessons?status=staged' | python3 -c "import sys,json; print(sum(1 for l in json.load(sys.stdin)['lessons'] if l['name']=='spill probe'))")
  [ "$N" = "1" ] && break
  sleep 2
done
LEFT=$(ls /tmp/sunset-spill/pending-lessons/*.json 2>/dev/null | wc -l)
QUEUED=$(ls /tmp/sunset-spill/pending-memories/*.json 2>/dev/null | wc -l)
FAILED=$(ls /tmp/sunset-spill/pending-memories/failed/* 2>/dev/null | wc -l)
echo "INGESTED $N LEFT $LEFT QUEUED $QUEUED FAILED $FAILED"
'''
expect = "INGESTED 1 LEFT 0 QUEUED 0 FAILED 1"
timeout_s = 540

[[verify]]
cmd = "{ grep -rln 'api/descent/memory' src/ server/ 2>/dev/null || true; } | wc -l"
expect = "0"
```

**Read first.** `~/.claude/descent/lessons_ingest.py` and `memory_ingest.py` (the sweep, 15 s, the
`.tmp`-then-rename contract), `~/.claude/commands/remember.md:70,75,81,91,96` and `learn.md:22-45`,
`docs/memory-intake.md` §"The reading, and when it is taken",
`src/modules/memory-intake/hooks/useMemoryReview.ts:20`.

**What to build.** Two queue doors, one per module; five api calls repointed; the copy the repoint
makes false, corrected in the same pass. The tab's provider, panel, rows and cadence are untouched.

**Sirens.** You will want one sweep for both queues because the code is nearly identical — each
module owns its own door, and a shared sweeper is a third thing that must know about both lanes. You
will want to read `.tmp` files "just in case"; the `.tmp`-then-rename IS the atomicity contract
(`remember.md:81`). You will want to delete a spill file that failed validation — move it aside with
its reason, because the operator's words are in it. The memory probe in the verify is deliberately a
`topic` candidate for a project that does not exist, so the door REFUSES it and it lands in
`failed/`, proving the queue never half-files something the validator rejects.

## Phase 5 — Attachments: the byte store and its three routes
Depends on: Phase 1

```toml
[phase]
id = "5"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2700
manifest = [
  "server/modules/kanban/kanban-attachments.service.ts",
  "server/modules/kanban/routes/attachment.routes.ts",
  "server/modules/kanban/routes/kanban.routes.ts",
  "server/modules/kanban/routes/detail.routes.ts",
  "server/modules/kanban/kanban-checklist.service.ts",
  "server/modules/kanban/kanban.module.ts",
  "server/modules/kanban-metis/kanban-metis.routes.ts",
  "server/modules/assets/services/image-assets.service.ts",
  "server/modules/assets/image-assets.service.ts",
  "server/shared/utils.ts",
]
forbidden = [
  "server/modules/kanban/kanban-write.service.ts",
  "server/modules/assets/assets.routes.ts",
]
athena = [
  "The download route builds its path from the request's attachment id without the separator-and-resolve double gate, so ../ escapes the root",
  "The extension comes from the client's filename rather than from the mime allowlist, so a .png upload lands as whatever the caller named it",
  "A row is written before the bytes are on disk, so a failed write leaves a card pointing at a file that does not exist",
  "The size cap is enforced after the whole body is buffered in memory, so an 800 MB upload is read before it is refused",
  "removeAttachment deletes the row but leaves the file, so the card's directory grows forever",
  "The resolveUnderRoot move changed image-assets.service.ts's behaviour instead of being a pure move",
  "A file the earlier attempt left on disk disagrees with Interfaces §4 or §5 and was kept because it was already there, rather than read and held to the contract",
  "removeAttachment's row delete opened a transaction of its own instead of running inside the writeKanban callback, so the row and its event are no longer one commit",
]

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-attachments.service.ts"
what = "THIS WORK IS ALREADY ON DISK from an attempt that blocked on verify #3's COMMAND, not on its code. Finding it in place is NOT a divergence: read `server/modules/kanban/kanban-attachments.service.ts` and `server/shared/utils.ts` as they stand, hold them to the contract below, change only what disagrees, and rewrite nothing that already matches. The contract is Interfaces §4's four exports over the existing kanban_attachments repository: attachmentsRoot() reading KANBAN_ATTACHMENTS_ROOT AT CALL TIME and defaulting to ~/.cloudcli/kanban-attachments, the closed mime-to-extension allowlist, addAttachment writing the bytes FIRST and the row second through writeKanban, resolveAttachmentFile calling the SHARED resolveUnderRoot, and removeAttachment removing both the file and the row. The resolveUnderRoot PURE move belongs to this step and has already landed: the predicate is `server/shared/utils.ts:443` and its first caller is `server/modules/assets/services/image-assets.service.ts:83-88` — one directory deeper than this plan's original `server/modules/assets/image-assets.service.ts` anchor, which names no file on this box; the real path is in the manifest beside it. Confirm the move stayed PURE (refuse any segment carrying a separator, `..` or a backslash, then resolve, then require the result to start with root + path.sep) and leave it alone if it did. The one raw SQL statement in removeAttachment is a PLAN-TIME DECISION, not a defect to cure: `kanban-checklist.db.ts` carries insertAttachment and listAttachments but no delete, and that repository file is not in this phase's manifest — so the DELETE runs inside the callback writeKanban hands its mutation, on that seam's own connection and inside the same transaction as the event beside it. Keep it there, keep the comment that says why, and do not reach into the repository file. Reversal: a later pass that opens `kanban-checklist.db.ts` adds deleteAttachment and moves the one statement into it."
check = "grep -c 'export function attachmentsRoot\\|export function addAttachment\\|export function resolveAttachmentFile\\|export function removeAttachment' server/modules/kanban/kanban-attachments.service.ts"
expect = "4"

[[steps]]
kind = "edit"
path = "server/modules/kanban/routes/attachment.routes.ts"
what = "createAttachmentRoutes(services): Router with the three routes of Interfaces §5 — a multer single-file upload on field `file` capped at ATTACHMENT_MAX_BYTES through multer's own fileSize limit (so an oversized body is cut off as it arrives rather than buffered and then refused) with a fileFilter over the mime allowlist, a byte-streaming GET that sets Content-Type from the STORED mime and X-Content-Type-Options nosniff, and a DELETE answering { ok: true } or 404. The upload uses multer's memory storage, since the service owns where a byte lands. THIS FILE IS ALSO ALREADY ON DISK from the blocked attempt, wired through kanban.routes.ts and kanban.module.ts: read it, hold it to §5 clause by clause, change only what disagrees. `assets.routes.ts:22-47` is the pattern to read and is FORBIDDEN to edit."
check = "grep -c \"router.post('/cards/:cardId/attachments'\\|router.get('/cards/:cardId/attachments/:attachmentId'\\|router.delete('/cards/:cardId/attachments/:attachmentId'\" server/modules/kanban/routes/attachment.routes.ts"
expect = "3"

[[steps]]
kind = "edit"
path = "server/modules/kanban/routes/detail.routes.ts"
what = "The metadata-only POST /cards/:cardId/attachments route, its JSON body parsing and its size reader are deleted from detail.routes.ts — healed means deleted, and the upload route in attachment.routes.ts takes that path. The blocked attempt already did this: confirm with the check below rather than deleting twice, and if the count is not 0, delete what is left."
check = "{ grep -c 'attachments' server/modules/kanban/routes/detail.routes.ts || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/kanban-metis.routes.ts"
what = "kanbanMetisSecretGuard carries the OPERATOR_BYTES refusal beside IMPORT_PATH and Phase 2's REVIEW_PATH: a DELETE whose decoded path matches /\\/cards\\/[^/]+\\/attachments\\/[^/]+$/i answers 403 with one sentence. Method-scoped — a Metis may add an attachment and read one; she may not destroy an operator's uploaded bytes. The blocked attempt already added it: read it, hold it to that shape, and use the regex VERBATIM. You will notice that a DELETE spelled `.../attachments/a-1%2Fx` decodes to a two-segment tail this regex does not match and falls through to the credential check — measured, and harmless: no minted attachment id carries a separator, so that path finds no row and answers 404 with nothing destroyed. Do not widen the regex; note it and keep rowing."
check = "grep -c 'OPERATOR_BYTES' server/modules/kanban-metis/kanban-metis.routes.ts"
expect_re = "^[1-9]"

[[verify]]
cmd = '''
set -e
source scripts/sunset-probe.sh
trap stop_probe_server EXIT
probe_db
boot_probe_server
TOK=$(mint_token)
BASE=http://127.0.0.1:7893/api/kanban
BOARD=$(curl -sf -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"name":"probe-sunset5"}' "$BASE/boards" | python3 -c "import sys,json; print(json.load(sys.stdin)['board']['id'])")
CARD=$(curl -sf -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"title":"attachment probe"}' "$BASE/boards/$BOARD/cards" | python3 -c "import sys,json; print(json.load(sys.stdin)['card']['id'])")
python3 -c "
import base64, pathlib
png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
pathlib.Path('/tmp/sunset-pixel.png').write_bytes(png)
"
ATT=$(curl -sf -X POST -H "Authorization: Bearer $TOK" -F "file=@/tmp/sunset-pixel.png;type=image/png" "$BASE/cards/$CARD/attachments" | python3 -c "import sys,json; print(json.load(sys.stdin)['attachment']['id'])")
BYTES=$(curl -sf -H "Authorization: Bearer $TOK" "$BASE/cards/$CARD/attachments/$ATT" | wc -c)
ESCAPE=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOK" "$BASE/cards/$CARD/attachments/..%2f..%2fauth.db")
ONDISK=$(ls /tmp/sunset-att/"$CARD"/ | wc -l)
echo "BYTES $BYTES ESCAPE $ESCAPE ONDISK $ONDISK"
'''
expect = "BYTES 70 ESCAPE 404 ONDISK 1"
timeout_s = 480

[[verify]]
cmd = "{ grep -rn \"filename.*mime.*size\" server/modules/kanban/routes/detail.routes.ts || true; } | wc -l"
expect = "0"

[[verify]]
cmd = '''
set -eo pipefail
trap 'rm -f /tmp/sunset-p5-root.mts /tmp/sunset-p5-root.db' EXIT
cat > /tmp/sunset-p5-root.mts <<TS
import { attachmentsRoot } from '$PWD/server/modules/kanban/kanban-attachments.service.ts';
delete process.env.KANBAN_ATTACHMENTS_ROOT;
const fallback = attachmentsRoot();
process.env.KANBAN_ATTACHMENTS_ROOT = '/tmp/sunset-p5-att';
const redirected = attachmentsRoot();
console.log('OUTSIDE-REPO', !fallback.startsWith('$PWD'), 'UNDER-CLOUDCLI', fallback.includes('.cloudcli'), 'CALL-TIME', redirected === '/tmp/sunset-p5-att');
TS
DATABASE_PATH=/tmp/sunset-p5-root.db node_modules/.bin/tsx --tsconfig=server/tsconfig.json /tmp/sunset-p5-root.mts < /dev/null | grep '^OUTSIDE-REPO'
'''
expect = "OUTSIDE-REPO true UNDER-CLOUDCLI true CALL-TIME true"
timeout_s = 300
```

**Read first.** `~/.claude/descent/store_attachments.py` and `store_schema.py:71-93` (the path
derivation and the mime allowlist), `server_api.py:360-399` (the gate ORDER: mime, then decode, then
size, then a magic sniff), `server/modules/assets/assets.routes.ts` and
`server/modules/assets/services/image-assets.service.ts:83-88` (this repository's own upload and its
path guard, the guard now calling the shared predicate), `docs/kanban.md` §"The tables".

**What to build.** One shared predicate extracted, one service, one routes file, the old metadata
route removed, one refusal added. **70 bytes** is the size of the one-pixel PNG the verify posts — if
your gate rejects it, the mime allowlist or the sniff is wrong, not the fixture.

`KanbanAttachment` gains no `url` field: `api.kanban.attachmentBlob(cardId, attachmentId)` (Phase 16)
composes that path where every other path in this client is composed.

**Sirens.** You will want to reuse `~/.cloudcli/assets` because it already exists — do not: that
store is flat, filename-keyed, chat-scoped and never pruned, and its resolver forbids the
subdirectory a card needs. You will want to keep the metadata-only POST "for compatibility" — nothing
calls it and healed means deleted. You will want to accept any mime the way `/api/assets/files` does;
this route is a card attachment, and the closed allowlist is what makes the stored extension
derivable. And `resolveUnderRoot` is a PURE move — if the existing caller's behaviour has to change
to accommodate the new one, stop and report it rather than widening a security predicate.

**Sirens, the second set.** All four steps are ALREADY ON DISK from the attempt that blocked on
verify #3's COMMAND, not on its code — the two files were created, the metadata route was deleted and
the refusal was added, and the first two verifies printed `BYTES 70 ESCAPE 404 ONDISK 1` and `0`
exactly. Two temptations follow from that, opposite to each other. You will want to call the phase
done without reading what is there — do not: read all four files, hold each to its step's contract
and to Interfaces §4 and §5, and change what disagrees. And you will want to re-do the work from
scratch because the step says "create" — do not: an existing file that already matches its contract
is the step, satisfied; rewriting it churns the diff Athena reads and loses the comments that record
why each line is where it is.

**The tsx form in verify #3 is MEASURED and is not yours to re-cut.** `tsx --tsconfig <cfg> -e
"<program>"` (space-separated) swallows the `-e` pair, takes its program from the inherited stdin
instead and exits 0 printing nothing — measured on tsx 4.21.0 here on 2026-09-17, in Phase 2's note,
in Phase 3's, and once more by the attempt that blocked on this very phase. The `=`-joined form with
`-e` runs the program but in a CJS context, where importing this service dies
`ERR_PACKAGE_PATH_NOT_EXPORTED` on `@openai/codex-sdk` (reached through `kanban-cards.guards.ts` and
the providers barrel). So the verify writes its six lines to a `.mts` ENTRY FILE, runs THAT with
`--tsconfig=` joined by an equals sign, `< /dev/null` and a scratch `DATABASE_PATH` no live database
answers, filters stdout to the marker line (the first import of the database module prints a
`Migrated legacy database` line that would otherwise sit in front of the answer), and removes both
scratch files on every exit path. Measured whole on 2026-09-17: it prints `OUTSIDE-REPO true
UNDER-CLOUDCLI true CALL-TIME true`, exits 1 when the module cannot be imported, and answers the same
under an ambient `KANBAN_ATTACHMENTS_ROOT` because the program clears the variable before asking.
Do not re-introduce `-e`: an eval cannot load the server graph at all (the kanban barrel dies on
`@openai/codex-sdk`'s exports map), while an entry file can. The `@/…` alias DOES resolve under
`--tsconfig=server/tsconfig.json`; a relative path is still the plainer spelling here. **The space
form is gone from every later phase's `[[verify]]` — cured in one pass on 2026-09-17, with the lint
rule `v2:tsx-eval-flag` now refusing it at the door**; each is its own phase's to cure
when the runner reaches it.

## Phase 6 — The corpus import: 210 lessons, 53 candidates, 27 files
Depends on: Phase 2, Phase 3, Phase 5

```toml
[phase]
id = "6"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 3000
manifest = [
  "server/modules/kanban/kanban-import-shape.ts",
  "server/modules/kanban/kanban-import.transport.ts",
  "server/modules/kanban/kanban-import-satellites.ts",
  "server/modules/kanban/kanban-import.mapping.ts",
  "server/modules/kanban/routes/import.routes.ts",
  "server/modules/database/repositories/kanban-import.db.ts",
  "server/modules/database/repositories/kanban-import-rows.db.ts",
  "server/modules/database/repositories/kanban-import-children.db.ts",
  "server/modules/database/repositories/memory-candidates.db.ts",
  "server/modules/database/index.ts",
  "server/modules/memory-intake/memory.service.ts",
  "server/modules/memory-intake/index.ts",
  "server/shared/kanban-types.ts",
]
forbidden = [
  "server/modules/kanban/kanban-import.service.ts",
  "server/modules/kanban/kanban-write.service.ts",
]
athena = [
  "A second import duplicates rows because the new upserts key on id rather than on descent_id",
  "The attachment byte copy runs inside the write transaction, so a slow 9 MB copy holds the database lock",
  "A missing source file aborts the whole import instead of recording the row and moving on",
  "The lesson import maps Descent's feature_id to a card id that does not exist, and the foreign key throws mid-transaction",
  "REQUIRED_DESCENT_TABLES gained the new tables, so an older Descent database with no ov_lessons now fails the shape check entirely",
  "The byte copy is deferred behind queueMicrotask, setImmediate or an unawaited promise, so the POST answers while the files are still landing and a count taken the instant the response returns reads fewer than 27",
  "The copy runs in the route AND is still attempted inside the mapping, so the same bytes are written twice or one of the two runs under the write transaction after all",
  "importDescentCandidates pushes Descent rows through validateMemoryArgs, so the three live rows whose target is user are refused and one refused value fails the whole board import",
  "A lesson whose Descent feature_id names a card this board never imported is dropped rather than landed with a NULL card_id, and the 210 count is met only because some other row was counted twice",
]

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-import.transport.ts"
what = "Read ov_lessons (all 14 columns) and ov_memory_candidates (all 15) from the read-only Descent handle into DescentSourceRows, beside the rows already read, each read presence-guarded so an older Descent install carrying neither table still imports. Descent timestamps are microsecond precision with a numeric offset and are normalised to ISO-8601 UTC seconds before they land, exactly as the existing passes do. The candidate row shape is DescentMemoryRow and it has ONE home: declared in repositories/memory-candidates.db.ts and re-exported from server/modules/database/index.ts, the barrel every module outside database/ reaches it through (Project Constraint 7). Import that type here and never re-declare it; that one re-export line is why the barrel is in the manifest. The band admits any count of 2 or more, of any width; the tree this check reads today counts 5."
check = "grep -c 'ov_lessons\\|ov_memory_candidates' server/modules/kanban/kanban-import.transport.ts"
expect_re = "^(?:[2-9]|[1-9][0-9]+)$"

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-import-satellites.ts"
what = "Add ONE importTable pass in the shape of the attachment pass at :135-151 — lessons keyed on descent_id, with their feature_id resolved to the imported card id (null when the card is absent) — and wire it into SatellitePasses and the returned counts. Its table name joins the KanbanImportTable union in repositories/kanban-import.db.ts and its row shape is KanbanImportLesson in repositories/kanban-import-rows.db.ts: those two files already hold that union and those row shapes for the six passes above, and each is in the manifest for exactly that one addition. The memory candidates are NOT a board satellite: hand their rows to importDescentCandidates(rows) from the server/modules/memory-intake barrel (Interfaces 3) and record its count beside the others. One button for the operator, one owner per lane. The band admits any count of 2 or more, of any width; the tree this check reads today counts 12 — the single-digit band this step used to carry read that true 12 as a failure, and that spec defect is what is cured here."
check = "grep -c 'lesson\\|importDescentCandidates' server/modules/kanban/kanban-import-satellites.ts"
expect_re = "^(?:[2-9]|[1-9][0-9]+)$"

[[steps]]
kind = "edit"
path = "server/modules/database/repositories/kanban-import-children.db.ts"
what = "Add upsertLesson, INSERT … ON CONFLICT(descent_id) DO UPDATE SET …, in the shape of upsertAttachment (:141-150). The imported id is minted locally and the Descent id lives in descent_id, never the other way round: Descent ls-N and mc-N ARE its own primary keys, so an upsert that targets the primary key throws on the second import and the idempotency verify reads it. The candidates own upsert belongs to repositories/memory-candidates.db.ts, behind importDescentCandidates — same statement shape, different owner, and that row lands with the target Descent holds (see the prose below). The band admits any count of 3 or more, of any width; the tree this check reads today counts 7."
check = "grep -c 'ON CONFLICT(descent_id)' server/modules/database/repositories/kanban-import-children.db.ts"
expect_re = "^(?:[3-9]|[1-9][0-9]+)$"

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-import-satellites.ts"
what = "PLAN the attachment copies here and place none of them here. One planner records, for every imported attachment, the pair ~/.claude/descent/attachments/<descent feature id>/<descent attachment id>.<ext> → attachmentsRoot()/<card id>/<attachment id>.<ext>, both sides resolved through resolveUnderRoot (Interfaces 4), and that list leaves the module on the satellite result and then on KanbanImportResult.attachmentCopies, whose type is declared in server/shared/kanban-types.ts. Beside the planner, export placeAttachmentBytes(copies): number — the byte work itself, synchronous, skipping a file already at its destination and recording a missing source in the server log without throwing, because an import that landed two hundred lessons must not report a failure over one missing blob. Nothing in this file copies a byte while the mapping runs: the mapping is inside the write seam transaction and nine megabytes under that lock stalls every other writer. Step 5 says who calls placeAttachmentBytes. The band admits any count of 1 or more, of any width; the tree this check reads today counts 2."
check = "grep -c 'descent/attachments\\|attachmentsRoot' server/modules/kanban/kanban-import-satellites.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban/routes/import.routes.ts"
what = "Call placeAttachmentBytes(result.attachmentCopies) in the import handler, SYNCHRONOUSLY, between importFromDescent(...) returning and response.json(result), with a header comment stating the obligation so the next reader does not re-derive it. This route is the one post-commit slot this phase owns, and that is settled here rather than at the keyboard: the mapping runs inside the frozen transaction, and kanban-import.service.ts only forwards the KanbanImportResult that server/shared/kanban-types.ts declares, so it needs no edit at all and stays in forbidden beside kanban-write.service.ts. Do not defer the copy behind queueMicrotask, setImmediate, setTimeout or an unawaited promise — a prior attempt measured a deferred copy placing 5 of 27 files at the instant the POST returned and 18 of 27 on the next run, because the copy loop and the client next command genuinely race. The check prints the order it reads and the number of deferral primitives in this file; the tree it reads today prints SYNC-BEFORE-RESPONSE DEFER 0."
check = '''ORDER=$(awk '/placeAttachmentBytes\(/{p=NR} /response\.json\(result\)/{r=NR} END{print (p && r && p<r) ? "SYNC-BEFORE-RESPONSE" : "DEFERRED-OR-MISSING"}' server/modules/kanban/routes/import.routes.ts); DEFER=$(grep -c 'queueMicrotask\|setImmediate\|setTimeout' server/modules/kanban/routes/import.routes.ts); echo "$ORDER DEFER $DEFER"'''
expect = "SYNC-BEFORE-RESPONSE DEFER 0"

[[verify]]
cmd = '''
set -e
source scripts/sunset-probe.sh
trap stop_probe_server EXIT
probe_db
boot_probe_server
TOK=$(mint_token)
curl -sf -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:7893/api/kanban/import/descent > /dev/null
read -r L1 M1 <<< "$(python3 -c "
import sqlite3
c = sqlite3.connect('/tmp/sunset-probe.db')
print(c.execute('select count(*) from kanban_lessons').fetchone()[0], c.execute('select count(*) from memory_candidates').fetchone()[0])
")"
curl -sf -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:7893/api/kanban/import/descent > /dev/null
read -r L2 M2 <<< "$(python3 -c "
import sqlite3
c = sqlite3.connect('/tmp/sunset-probe.db')
print(c.execute('select count(*) from kanban_lessons').fetchone()[0], c.execute('select count(*) from memory_candidates').fetchone()[0])
")"
echo "LESSONS $([ "$L1" -ge 210 ] && echo ok || echo "$L1") CANDIDATES $([ "$M1" -ge 53 ] && echo ok || echo "$M1") REIMPORT $((L2 - L1 + M2 - M1))"
'''
expect = "LESSONS ok CANDIDATES ok REIMPORT 0"
timeout_s = 600

[[verify]]
cmd = '''
set -e
source scripts/sunset-probe.sh
trap stop_probe_server EXIT
probe_db
boot_probe_server
TOK=$(mint_token)
curl -sf -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:7893/api/kanban/import/descent > /dev/null
COPIED=$(find /tmp/sunset-att -type f | wc -l)
SRC=$(find ~/.claude/descent/attachments -type f | wc -l)
echo "COPIED $([ "$COPIED" = "$SRC" ] && echo all || echo "$COPIED of $SRC")"
'''
expect = "COPIED all"
timeout_s = 600
```

**Read first.** `docs/kanban.md` §"Importing from Descent", `kanban-import-satellites.ts:135-151`
(the attachment pass is the exact pattern), `kanban-import-shape.ts:29-39`,
`server/modules/kanban/routes/import.routes.ts` (76 lines — the one door this import answers through),
and the scout's note that the import package is three files but the repository and the mapping's
`passes` array are two more.

**What to build.** Two more satellite passes, one upsert, and one byte copy PLANNED in the satellites
module and PLACED BY THE ROUTE. The counts in the verify are today's measured rows — 210 lessons, 53
candidates, 27 files — and the second import in the same command is what proves idempotency: a
duplicating importer reads 420 and fails. The five grep bands are measured on the tree those greps
read (5, 12, 7, 2, and `SYNC-BEFORE-RESPONSE DEFER 0`) and every count band now admits a number of
any width; a single-digit band is how a true count of 12 was once read as a failure.

**Where the bytes are placed — decided here, so no builder re-derives it.** The mapping runs INSIDE
the write seam's transaction, and `kanban-import.service.ts` is a pass-through that forwards the
`KanbanImportResult` declared in `server/shared/kanban-types.ts` — it needs no edit, it is
sha-guarded, and it stays in `forbidden` with `kanban-write.service.ts`. That leaves exactly one slot
between the commit and the answer: `routes/import.routes.ts`, which is in the manifest for this
reason and no other, along with the two import repositories that hold the union and the row shape
(`kanban-import.db.ts`, `kanban-import-rows.db.ts`) and the `database/index.ts` barrel that
re-exports `DescentMemoryRow`. Those four are ground this phase needs, named here so the deliverable
does not have to discover them mid-build.

**The target vocabulary, decided too.** `importDescentCandidates` lands each candidate's `target` AS
DESCENT HOLDS IT and does not push it through `validateMemoryArgs`: Descent's vocabulary carries
`user` — 3 of the 53 live rows — a value that lane's door refuses, and one refused value must never
fail a whole board import. The door still guards every runtime staging path; the import, and only the
import, bypasses it. A lesson whose `feature_id` names a card this board never imported lands with a
NULL `card_id`, never as a dropped row.

**Sirens.** You will want to add the two new tables to `REQUIRED_DESCENT_TABLES` — think first: a
required table that an older Descent database lacks refuses the whole import, and these two are
satellites, not the spine. You will want to copy the bytes inside the transaction, where the rows
are; nine megabytes of copying under a write lock stalls every other writer. You will want to place
the bytes in the service, where the result is built — it is sha-guarded and forbidden, the route is
the slot, and a third seam is not to be invented. You will find part of this work already in the tree
from an earlier attempt: a step whose `check` already reads green is DONE — read it, confirm it does
what the step says, and take the next step; never rewrite a green step and never delete work to start
clean. You will see `kanban-import-satellites.ts` at 355 LOC and `memory-intake/memory.service.ts` at
432 — both over the 300 default, both under the 500 soft cap, and both ACCEPTED at plan time: a split
is a pure move and its own checkpoint, so note it and keep rowing. And the standing rule: when
reality diverges from this chart — a file not where it says, a signature that differs, a check that
fails for a reason it does not name — stop, report the divergence verbatim, and improvise no fix.

## Phase 7 — The MCP surface: four real lesson tools and the cross-board read
Depends on: Phase 2

```toml
[phase]
id = "7"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2700
manifest = [
  "server/modules/kanban-metis/mcp/kanban-pm-tools-board.ts",
  "server/modules/kanban-metis/mcp/kanban-pm-tools-lessons.ts",
  "server/modules/kanban-metis/mcp/kanban-pm-tools-cards.ts",
  "server/modules/kanban-metis/mcp/kanban-pm-recall.ts",
  "server/modules/kanban-metis/mcp/kanban-pm-client.ts",
  "server/modules/kanban-metis/mcp/kanban-pm-board-reads.ts",
  "server/modules/kanban-metis/brief/chapters/learning.md",
  "server/modules/kanban-metis/brief/chapters/parallelism.md",
]
forbidden = [
  "server/modules/kanban-metis/metis-spawn.service.ts",
  "server/modules/kanban/kanban-lessons.service.ts",
]
athena = [
  "A lesson tool imports the lessons service directly, breaking the MCP program's leaf rule and dragging a database handle into the stdio child",
  "The refusal text is gone but the tool still answers an empty result instead of the board's rows",
  "stage_lesson's inputSchema drifted from Descent's — a trigger value outside the four-value enum is accepted",
  "list_features_all answers archived boards, so Metis plans work on a board the operator retired",
  "The tool count is no longer 25 plus one, so the brief's catalogue and the MCP surface disagree",
  "The cross-board read was added a SECOND time — a duplicate list_features_all descriptor in another module, or its name planted in kanban-pm-board-reads.ts — so one tool name answers from two places",
  "A lesson tool validates its arguments only AFTER its HTTP call, so a refused limit or an out-of-enum trigger still reaches the board",
  "The lesson lane's own module re-declares a bound the tools already own — the four-value trigger enum, the 60-char summary, the 1..500 limit — so two copies exist and have already drifted",
  "The surface answers a different number of tools than the brief's catalogue claims: it is twenty-five today, list_features_all included, because the cross-board read already existed before this phase",
]

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/mcp/kanban-pm-tools-board.ts"
what = "Make the four lesson call sites real. Delete LESSONS_NOT_HERE and lessonStub; stage_lesson, list_lessons and get_lesson call the board's lesson routes through kanban-pm-client.ts against the /api/kanban-pm mount, and search_history's lesson kind searches the corpus. The three input schemas are mcp_tools_lessons.py:45-95's, verbatim — trigger is the four-value enum complex_task|error_resolved|operator_correction|workflow_discovered, kind is note|skill_draft, stage_lesson requires name, summary and trigger, list_lessons's limit is 1..500 and is REFUSED rather than clamped outside it, and a summary past 60 chars is REFUSED rather than truncated. EVERY argument check runs BEFORE the HTTP call, so a refused call never reaches the board. The three descriptors and their handlers MAY live in their own module — mcp/kanban-pm-tools-lessons.ts, spliced into createBoardTools — and Project Constraint 4 is why: with them inline, tools-board.ts runs past the 300-LOC ceiling. What may NOT change is the tool NAMES or the count; the surface answers twenty-five tools, list_features_all included. RECONCILE, never redo: attempt 1 of this phase already landed this work in the tree, so read what is there first, keep what already satisfies the check below, and say in your report that you kept it."
check = '''
python3 - <<'PY'
import json, os, pathlib, subprocess
ENV = {**os.environ, 'KANBAN_PM_API_URL': 'http://127.0.0.1:9', 'KANBAN_PM_TOKEN': 'probe.probe',
       'KANBAN_PM_BOARD_ID': 'b-probe', 'KANBAN_PM_OWNER': '0' * 16}
init = {"jsonrpc": "2.0", "id": 0, "method": "initialize",
        "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                   "clientInfo": {"name": "probe", "version": "0"}}}
def call(i, name, args):
    return {"jsonrpc": "2.0", "id": i, "method": "tools/call",
            "params": {"name": name, "arguments": args}}
msgs = [init, {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
        call(2, 'list_lessons', {'limit': 501}),
        call(3, 'stage_lesson', {'name': 'probe', 'summary': 'probe', 'trigger': 'nope'}),
        call(4, 'stage_lesson', {'name': 'probe', 'summary': 'x' * 61, 'trigger': 'error_resolved'})]
out = subprocess.run(['node_modules/.bin/tsx', '--tsconfig', 'server/tsconfig.json',
                      'server/modules/kanban-metis/kanban-pm-mcp.ts'],
                     input='\n'.join(json.dumps(m) for m in msgs) + '\n',
                     capture_output=True, text=True, env=ENV, timeout=240).stdout
answers = {}
for line in out.splitlines():
    try:
        message = json.loads(line)
    except Exception:
        continue
    if isinstance(message.get('id'), int):
        answers[message['id']] = message
tools = {t['name']: t for t in answers.get(1, {}).get('result', {}).get('tools', [])}
said = lambda i: json.dumps(answers.get(i, {}))
source = ' '.join(p.read_text() for p in pathlib.Path('server/modules/kanban-metis/mcp').glob('*.ts'))
try:
    schema = lambda n: tools[n]['inputSchema']
    checks = {
        'trigger-enum': schema('stage_lesson')['properties']['trigger']['enum'] == [
            'complex_task', 'error_resolved', 'operator_correction', 'workflow_discovered'],
        'kind-enum': schema('stage_lesson')['properties']['kind']['enum'] == ['note', 'skill_draft'],
        'stage-required': schema('stage_lesson')['required'] == ['name', 'summary', 'trigger'],
        'get-required': schema('get_lesson')['required'] == ['id'],
        'search-kind': 'lesson' in schema('search_history')['properties']['kinds']['items']['enum'],
        'limit-refused': 'between 1 and 500' in said(2),
        'trigger-refused': 'trigger must be one of' in said(3),
        'summary-refused': 'never truncated' in said(4),
        'stub-gone': 'LESSONS_NOT_HERE' not in source and 'lessonStub' not in source,
    }
    bad = sorted(k for k, v in checks.items() if not v)
except Exception as error:
    bad = ['probe-failed:' + type(error).__name__]
print('LESSON-TOOLS ' + ('ok' if not bad else ' '.join(bad)))
PY
'''
expect = "LESSON-TOOLS ok"
timeout_s = 300

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/mcp/kanban-pm-tools-cards.ts"
what = "Do NOT add a tool here. The cross-board read of Interfaces §9 ALREADY EXISTS in this file — descriptor at :61, handler at :159 — carrying mcp_tools_xboard.py:33-47's schema exactly (status the five-value enum, tag, and an empty required list so both parameters are optional), skipping board.archived, and pushing each row with its own board {id, name}. This step is a VERIFICATION: run the check below and the phase's first [[verify]], and edit this file ONLY where they find a divergence — a required parameter, an archived board answered, a row without its board {id, name}, a second descriptor of the same name. If it verifies as it stands, leave the file BYTE-IDENTICAL and say so in your report; an unchanged file is the honest outcome of this step. The name list_features_all must NOT be planted in kanban-pm-board-reads.ts, which is the shared lane-read helper (scanLaneCards, listBoards, openAllCards, findQuestion) and holds no tool descriptor and no tool table — the check refuses that spelling outright. This step reads as it does because attempt 1 was ordered to add the tool to that helper, found it already built here, and blocked rather than plant a name."
check = '''
python3 - <<'PY'
import json, os, pathlib, subprocess
ENV = {**os.environ, 'KANBAN_PM_API_URL': 'http://127.0.0.1:9', 'KANBAN_PM_TOKEN': 'probe.probe',
       'KANBAN_PM_BOARD_ID': 'b-probe', 'KANBAN_PM_OWNER': '0' * 16}
msgs = [{"jsonrpc": "2.0", "id": 0, "method": "initialize",
         "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                    "clientInfo": {"name": "probe", "version": "0"}}},
        {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}]
out = subprocess.run(['node_modules/.bin/tsx', '--tsconfig', 'server/tsconfig.json',
                      'server/modules/kanban-metis/kanban-pm-mcp.ts'],
                     input='\n'.join(json.dumps(m) for m in msgs) + '\n',
                     capture_output=True, text=True, env=ENV, timeout=240).stdout
listed = []
for line in out.splitlines():
    try:
        message = json.loads(line)
    except Exception:
        continue
    if message.get('id') == 1:
        listed = message.get('result', {}).get('tools', [])
named = [t for t in listed if t['name'] == 'list_features_all']
cards = pathlib.Path('server/modules/kanban-metis/mcp/kanban-pm-tools-cards.ts').read_text()
helper = pathlib.Path('server/modules/kanban-metis/mcp/kanban-pm-board-reads.ts').read_text()
try:
    schema = named[0]['inputSchema']
    checks = {
        'exactly-one': len(named) == 1,
        'both-optional': schema.get('required') == [],
        'two-parameters': sorted(schema['properties']) == ['status', 'tag'],
        'status-enum': schema['properties']['status']['enum'] == [
            'not_ready', 'todo', 'questions', 'active', 'done'],
        'says-non-archived': 'non-archived' in named[0]['description'],
        'skips-archived': 'if (board.archived) continue;' in cards,
        'carries-board': 'board: { id: board.id, name: board.name }' in cards,
        'helper-clean': 'list_features_all' not in helper,
    }
    bad = sorted(k for k, v in checks.items() if not v)
except Exception as error:
    bad = ['probe-failed:' + type(error).__name__]
print('XBOARD ' + ('ok' if not bad else ' '.join(bad)) + ' ' + str(len(listed)))
PY
'''
expect = "XBOARD ok 25"
timeout_s = 300

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/brief/chapters/learning.md"
what = "Replace the chapter's lessons paragraph so it describes the live corpus: stage at RETRO through stage_lesson, the operator reviews, only approved lessons return through list_actionable's index, and decisions remain the separate passive substrate get_learned_selections reads. Every sentence claiming lessons are Descent-only is DELETED, never annotated. Name the tools by the names the surface answers to — stage_lesson, list_lessons, get_lesson, search_history — and state the two refusals the tools actually keep: a summary past 60 chars and a limit outside 1..500 are REFUSED, never truncated and never clamped. RECONCILE, never redo: attempt 1 already rewrote this chapter, so read it first and keep every sentence that is true."
check = '''
python3 - <<'PY'
import pathlib
text = pathlib.Path('server/modules/kanban-metis/brief/chapters/learning.md').read_text()
lies = [w for w in ('Descent-only', 'not on this board yet', 'lives in Descent') if w in text]
missing = [w for w in ('stage_lesson', 'list_lessons', 'get_lesson', 'search_history',
                       'list_actionable', 'get_learned_selections', 'REFUSED') if w not in text]
print('LEARNING ' + ('ok' if not lies and not missing
                     else 'lies=' + ','.join(lies) + ' missing=' + ','.join(missing)))
PY
'''
expect = "LEARNING ok"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/brief/chapters/parallelism.md"
what = "State the cross-board rule this board actually keeps: list_features_all shows the whole estate — every NON-ARCHIVED board's cards, each carrying its own board {id, name} — so she can ORDER her own board first and see what else is moving, and a card on another board is never claimed from here, because her cwd and her one --add-dir are her board's. Descent's she-works-every-board sentence is deleted, not annotated. RECONCILE, never redo: attempt 1 already wrote this passage, so read it first and keep what is true."
check = '''
python3 - <<'PY'
import pathlib
text = pathlib.Path('server/modules/kanban-metis/brief/chapters/parallelism.md').read_text()
lies = [w for w in ('runs every board', 'works every board', 'current first') if w in text]
missing = [w for w in ('list_features_all', 'never claimed from here', 'NON-ARCHIVED',
                       '--add-dir') if w not in text]
print('PARALLELISM ' + ('ok' if not lies and not missing
                        else 'lies=' + ','.join(lies) + ' missing=' + ','.join(missing)))
PY
'''
expect = "PARALLELISM ok"

[[verify]]
cmd = '''
set -e
source scripts/sunset-probe.sh
trap stop_probe_server EXIT
probe_db
boot_probe_server
TOK=$(mint_token)
curl -sf -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"name":"mcp probe","summary":"staged by the tool probe","trigger":"error_resolved"}' \
  http://127.0.0.1:7893/api/kanban/lessons > /dev/null
N=$(curl -sf -H "Authorization: Bearer $TOK" 'http://127.0.0.1:7893/api/kanban/lessons?status=staged' | python3 -c "import sys,json; print(len(json.load(sys.stdin)['lessons']) > 0)")
REST=$(PROBE_TOKEN="$TOK" python3 - <<'PY'
import json, os, subprocess, urllib.request
BASE = 'http://127.0.0.1:7893/api/kanban'
TOKEN = os.environ['PROBE_TOKEN']

def api(path, body=None, method=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(BASE + path, data=data, method=method,
                                     headers={'Authorization': 'Bearer ' + TOKEN,
                                              'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as answer:
        return json.load(answer)

# THE DOOR: the real stdio program, pointed at the probe server with a credential no session owns.
# Each lesson tool must come back naming the board ROUTE it called and the door's own 401 — which is
# what proves it went over HTTP through the client rather than reading a stub or importing a service.
ENV = {**os.environ, 'KANBAN_PM_API_URL': 'http://127.0.0.1:7893',
       'KANBAN_PM_TOKEN': 'no-such-session.no-such-proof',
       'KANBAN_PM_BOARD_ID': 'b-probe', 'KANBAN_PM_OWNER': '0' * 16}
messages = [{"jsonrpc": "2.0", "id": 0, "method": "initialize",
             "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                        "clientInfo": {"name": "probe", "version": "0"}}},
            {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
             "params": {"name": "list_lessons", "arguments": {"limit": 5}}},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
             "params": {"name": "get_lesson", "arguments": {"id": "ls-1"}}},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
             "params": {"name": "stage_lesson", "arguments": {"name": "probe",
                        "summary": "a door probe", "trigger": "error_resolved"}}}]
spoken = subprocess.run(['node_modules/.bin/tsx', '--tsconfig', 'server/tsconfig.json',
                         'server/modules/kanban-metis/kanban-pm-mcp.ts'],
                        input='\n'.join(json.dumps(m) for m in messages) + '\n',
                        capture_output=True, text=True, env=ENV, timeout=300).stdout
answers = {}
for line in spoken.splitlines():
    try:
        message = json.loads(line)
    except Exception:
        continue
    if isinstance(message.get('id'), int):
        answers[message['id']] = json.dumps(message)
door = {'list_lessons': 'GET /lessons?limit=5 failed with 401' in answers.get(1, ''),
        'get_lesson': 'GET /lessons/ls-1 failed with 401' in answers.get(2, ''),
        'stage_lesson': 'POST /lessons failed with 401' in answers.get(3, '')}

# THE CROSS-BOARD READ, exercised against real rows: a retired board carrying a card, created on the
# SCRATCH database, which the teardown deletes whole.
retired = api('/boards', {'name': 'probe-sunset7'})['board']['id']
api('/boards/' + retired + '/cards', {'title': 'probe card on a retired board'})
api('/boards/' + retired, {'archived': True}, method='PATCH')
tools = os.path.abspath('server/modules/kanban-metis/mcp/kanban-pm-tools-cards.js')
script = """
import { createCardTools } from '__TOOLS__';
const base = 'http://127.0.0.1:7893/api/kanban';
const token = process.env.PROBE_TOKEN;
const get = async (path) => {
  const answer = await fetch(base + path, { headers: { Authorization: 'Bearer ' + token } });
  if (!answer.ok) throw new Error(path + ' -> ' + answer.status);
  return answer.json();
};
const client = { apiUrl: base, token, boardId: process.env.PROBE_RETIRED, owner: '0'.repeat(16),
                 get, post: get, patch: get, del: get };
const result = await createCardTools(client).handlers.list_features_all({});
const rows = JSON.parse(result.content[0].text);
console.log(JSON.stringify({
  rows: rows.length,
  leak: rows.some((row) => row.board && row.board.id === process.env.PROBE_RETIRED),
  named: rows.every((row) => row.board && typeof row.board.id === 'string'
                             && typeof row.board.name === 'string'),
}));
""".replace('__TOOLS__', tools)
path = '/tmp/sunset-xboard-probe.mts'
with open(path, 'w', encoding='utf-8') as handle:
    handle.write(script)
done = subprocess.run(['node_modules/.bin/tsx', '--tsconfig', 'server/tsconfig.json', path],
                      capture_output=True, text=True, timeout=300,
                      env={**os.environ, 'PROBE_RETIRED': retired})
os.unlink(path)
try:
    read = json.loads(done.stdout.strip().splitlines()[-1])
    cross = {'rows': read['rows'] >= 1, 'archived-skipped': read['leak'] is False,
             'board-named': read['named'] is True}
except Exception as error:
    cross = {'probe-failed:' + type(error).__name__: False}
bad = sorted(k for k, v in {**door, **cross}.items() if not v)
print('DOOR-AND-XBOARD ' + ('ok' if not bad else ' '.join(bad)))
PY
)
echo "LESSONS-LIVE $N $REST"
'''
expect = "LESSONS-LIVE True DOOR-AND-XBOARD ok"
timeout_s = 600

[[verify]]
cmd = "{ grep -rn 'lesson' server/modules/kanban-metis/mcp/ | grep -ci 'not here\\|Descent-only\\|sunset' || true; }"
expect = "0"
```

**Read first.** `~/.claude/descent/mcp_tools_lessons.py` (the three schemas), `mcp_tools_xboard.py`
(the fourth — read it to CHECK the tool that already ships, never to write one),
`server/modules/kanban-metis/mcp/kanban-pm-client.ts` (how a tool reaches the board),
`docs/kanban.md` §"The kanban-pm MCP surface", and Project Constraint 7a.

**What to build.** Four lesson tools that work and two chapters that stop lying. The cross-board read
is already built and is only VERIFIED here (step 2). The client is the only door to the board;
nothing under `mcp/` imports a service.

**Sirens.** You will want to import `kanban-lessons.service.ts` directly — it is two directories away
and it would work in the server process. It must not: this program is a stdio child with no server in
it, and the import would drag a database handle, a router and a websocket fan-out into a process that
must start in milliseconds. You will want to clamp `list_lessons`'s limit instead of refusing it;
Descent refuses (`mcp_tools_lessons.py:184-186`) and a silently clamped limit hides a caller's bug.
You will find `list_features_all` ALREADY SHIPPED in `kanban-pm-tools-cards.ts` and be tempted to
satisfy step 2 by writing its name somewhere else — a second descriptor, a re-export, a comment in
`kanban-pm-board-reads.ts`. Do not: one tool name answering from two places is the defect, the step's
check refuses the planted spelling, and an unchanged file that verifies is a passing step. You will
find most of this phase ALREADY DONE in the tree — attempt 1 landed the lesson lane and both chapters
before it blocked on step 2. Reconcile with it: read it, keep it, re-run the checks, and never rewrite
work that already passes. You will find `server/modules/kanban-metis/brief/METIS.md` and
`docs/kanban.md` still saying the lesson tools refuse; they are NOT yours — Phase 24 rewrites the
brief's catalogue and Phase 25 owns the docs. Do not edit them, and name them in your report. And when
reality still diverges from this chart — a file that is not where it says, a signature that differs, a
check that fails for a reason written nowhere here — STOP, report the divergence verbatim, and
improvise no fix.

## Phase 8 — The account store, standalone
Depends on: none

```toml
[phase]
id = "8"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 3000
manifest = [
  "server/modules/accounts/account-store.service.ts",
  "server/modules/accounts/accounts.module.ts",
  "server/modules/accounts/index.ts",
]
forbidden = [
  "server/modules/descent",
  "server/modules/settings",
]
athena = [
  "A slot write is not atomic, so an interrupted capture leaves a half-written credentials.json that a later switch installs live",
  "The credential file is parsed, logged or re-serialised rather than copied byte for byte",
  "A slot directory or file is created with the process umask instead of 0700/0600, leaving the token world-readable",
  "install() copies the target over live WITHOUT capturing the outgoing login first, so the account being replaced is lost",
  "activeSlug() reads a path that a probe's CLOUDCLI_ACCOUNTS_ROOT does not redirect, so a verify moves the operator's real active account",
  "A probe copies the live credential into a predictable directory and leaves it there when a later line fails",
]

[[steps]]
kind = "edit"
path = "server/modules/accounts/account-store.service.ts"
what = "Port ~/.claude/descent/account_store.py to TypeScript per Interfaces §6: identity() from ~/.claude.json's oauthAccount.emailAddress, listSlots() over accountsRoot(), captureLive() copying the live pair into its slot, install(slug) capturing the live login into its own slot FIRST and then copying the target pair over live, drift(), stateSummary() and the active-slug file. Every write is temp-file-then-rename (account_store.py:247-278); directories are 0700 and files 0600; token bytes are copied and never parsed."
check = "grep -c 'export function identity\\|export function listSlots\\|export function captureLive\\|export function install\\|export function drift\\|export function stateSummary\\|export function activeSlug\\|export function setActiveSlug' server/modules/accounts/account-store.service.ts"
expect = "8"

[[steps]]
kind = "edit"
path = "server/modules/accounts/index.ts"
what = "The barrel: export createAccountsModule and nothing else. No service, no type, no path constant leaves this module."
check = "grep -c 'export' server/modules/accounts/index.ts"
expect_re = "^[1-2]$"

[[steps]]
kind = "run"
cmd = "npm run typecheck"
check = "npm run typecheck > /dev/null 2>&1 && echo TYPECHECK-OK"
expect = "TYPECHECK-OK"

[[verify]]
cmd = '''
set -e
CLOUDCLI_ACCOUNTS_ROOT=$(mktemp -d /tmp/sunset-accounts.XXXXXX)
export CLOUDCLI_ACCOUNTS_ROOT
chmod 700 "$CLOUDCLI_ACCOUNTS_ROOT"
trap 'rm -rf "$CLOUDCLI_ACCOUNTS_ROOT" /tmp/sunset-verify-2.mts' EXIT
cat > /tmp/sunset-verify-2.mts <<'TS'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '@/modules/accounts/account-store.service.js';
const slug = store.captureLive();
const slots = store.listSlots();
const dir = path.join(process.env.CLOUDCLI_ACCOUNTS_ROOT, slug);
const dmode = (fs.statSync(dir).mode & 0o777).toString(8);
const fmode = (fs.statSync(path.join(dir, 'credentials.json')).mode & 0o777).toString(8);
const live = fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'));
const copy = fs.readFileSync(path.join(dir, 'credentials.json'));
console.log('SLOTS', slots.length >= 1, 'DIR', dmode, 'FILE', fmode, 'IDENTICAL', Buffer.compare(live, copy) === 0);
TS
node_modules/.bin/tsx --tsconfig=server/tsconfig.json /tmp/sunset-verify-2.mts < /dev/null
'''
expect = "SLOTS true DIR 700 FILE 600 IDENTICAL true"
timeout_s = 300

[[verify]]
cmd = "{ grep -rn 'accessToken\\|refreshToken' server/modules/accounts/account-store.service.ts || true; } | wc -l"
expect = "0"
```

**Read first.** `~/.claude/descent/account_store.py` whole — 430 lines, and its module docstring
states the three bounds this port inherits. `docs/accounts.md` §"The rules that bite" (why an expiry
in the past is not an alarm), `docs/descent-proxy.md` rules 1, 2, 3 and 7.

**What to build.** One service and its module. The routes are Phase 9's; nothing here is mounted yet.

**Sirens.** A capture is safe — it only copies live into a slot — and the verify does exactly one,
into a `mktemp -d` root at mode 700 with its removal TRAPPED on every exit path: the file it writes
is the operator's real refresh token, and `set -e` between a `cp` and an `rm` is how one ends up
sitting in a predictable directory.
A SWITCH is not: `install()` replaces the operator's live login, and no check or verify in this plan
ever calls it with a real slug. You will want to parse the credentials to validate them: the whole
design is that this module never learns what a token is. You will want to store the active slug in
sqlite because Descent did (`ov_settings`); it is a one-line file beside the slots here, so the
account store has exactly one home and a probe redirects all of it with one environment variable.

## Phase 9 — Usage, the four routes, and the proxy deleted
Depends on: Phase 8

```toml
[phase]
id = "9"
builder = "hephaestus"
model = "opus"
builder_reason = "plumbing only inside the .tsx files: the Descent* type names are renamed in place and the api call sites follow them; no layout, copy or composition changes"
code_change = true
doc_sweep = "foreground"
expected_s = 3300
manifest = [
  "server/modules/accounts/usage.service.ts",
  "server/modules/accounts/accounts.routes.ts",
  "server/modules/accounts/accounts.module.ts",
  "server/modules/descent",
  "server/index.ts",
  "server/shared/types.ts",
  "src/shared/types.ts",
  "src/shared/api.ts",
  "src/modules/accounts",
  "docs/descent-proxy.md",
]
forbidden = [
  "server/modules/accounts/account-store.service.ts",
  "server/modules/kanban",
]
athena = [
  "A vendor failure answers 5xx instead of a calm 200 {reachable:false, reason}, so the panel draws an error wall where it used to draw em-dashes",
  "An unknown percent or expiry arrives as 0 rather than null, so the meter reads '0% used' for a figure nobody has",
  "The usage cache keeps no last-good reading, so one slow vendor call empties the meters the operator was watching",
  "A window Descent flagged loses its severity, so an account lock reads as a comfortable 12%",
  "Something still imports server/modules/descent or calls /api/descent, so the deletion breaks a surface the plan did not name",
]

[[steps]]
kind = "edit"
path = "server/modules/accounts/usage.service.ts"
what = "Port server_api_usage.py and usage_windows.py per Interfaces §6: read the access token from ~/.claude/.credentials.json in memory only, GET https://api.anthropic.com/api/oauth/usage with the anthropic-beta: oauth-2025-04-20 header, parse the windows (parse_windows :91-172), mark rolled windows (mark_rolled :193-236), and keep the two module-level caches — current and last-good — in memory, never on disk. A failure answers degraded with the last good figures and a reason, never an exception."
check = "grep -c 'oauth/usage\\|oauth-2025-04-20' server/modules/accounts/usage.service.ts"
expect_re = "^[2-9]"

[[steps]]
kind = "edit"
path = "server/modules/accounts/accounts.routes.ts"
what = "The four routes of Interfaces §6, answering the camelCase bodies the deleted proxy used to produce, with the proxy's own refusals kept: a missing, blank, numeric or null slug is a 422 {error:'slug is required'} refused at the route and never sent further; a read never fails, answering {reachable:false, reason} on a 200."
check = "grep -c \"'/accounts'\\|'/usage'\\|'/accounts/switch'\\|'/accounts/capture'\" server/modules/accounts/accounts.routes.ts"
expect = "4"

[[steps]]
kind = "edit"
path = "server/index.ts"
what = "Mount the accounts module at /api behind authenticateToken so its four paths land at /api/accounts, /api/usage, /api/accounts/switch and /api/accounts/capture, and delete the /api/descent mount at :190 in the same edit."
check = "{ grep -c \"api/descent\" server/index.ts || true; }"
expect = "0"

[[steps]]
kind = "run"
cmd = "rm -rf server/modules/descent docs/descent-proxy.md"
check = "test ! -e server/modules/descent && test ! -e docs/descent-proxy.md && echo GONE"
expect = "GONE"

[[steps]]
kind = "edit"
path = "server/shared/types.ts"
what = "Rename the § DESCENT CONTRACTS group to § CLAUDE ACCOUNT CONTRACTS and its four account types to ClaudeAccounts, ClaudeAccountSlot, ClaudeUsage and ClaudeUsageWindow — field for field unchanged — mirroring the same rename in src/shared/types.ts and following it through src/shared/api.ts and every file under src/modules/accounts/. The memory candidate types keep their names and move under their own group heading."
check = "{ grep -rc 'DescentAccounts\\|DescentUsage\\|DescentSlot' server/shared/types.ts src/shared/types.ts src/shared/api.ts || true; } | grep -cv ':0$'"
expect = "0"

[[verify]]
cmd = '''
set -e
source scripts/sunset-probe.sh
trap stop_probe_server EXIT
probe_db
boot_probe_server
TOK=$(mint_token)
A=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOK" http://127.0.0.1:7893/api/accounts)
U=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOK" http://127.0.0.1:7893/api/usage)
SLOTS=$(curl -sf -H "Authorization: Bearer $TOK" http://127.0.0.1:7893/api/accounts | python3 -c "import sys,json; d=json.load(sys.stdin); print('KEYS', 'slots' in d or 'reachable' in d)")
BAD=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"slug":""}' http://127.0.0.1:7893/api/accounts/switch)
NOSUCH=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"slug":"__no_such_slug__"}' http://127.0.0.1:7893/api/accounts/switch)
echo "$A $U $SLOTS $BAD $NOSUCH"
'''
expect = "200 200 KEYS True 422 422"
timeout_s = 480

[[verify]]
cmd = "n=$( { grep -rln 'modules/descent\\|/api/descent' server/ src/ docs/descent-proxy.md 2>/dev/null || true; } | wc -l ); test -e docs/descent-proxy.md && n=$((n+1)) || true; echo strays=$n"
expect = "strays=0"

[[verify]]
cmd = '''
set -e
cat > /tmp/sunset-tc-9-client.json <<EOF
{"extends": "$PWD/tsconfig.json",
 "compilerOptions": {"noEmit": true, "typeRoots": ["$PWD/node_modules/@types"], "types": ["node"]},
 "include": ["$PWD/src/vite-env.d.ts",
             "$PWD/src/shared/types.ts",
             "$PWD/src/shared/api.ts",
             "$PWD/src/modules/accounts/**/*.ts",
             "$PWD/src/modules/accounts/**/*.tsx"],
 "exclude": []}
EOF
cat > /tmp/sunset-tc-9-server.json <<EOF
{"extends": "$PWD/server/tsconfig.json",
 "compilerOptions": {"noEmit": true, "typeRoots": ["$PWD/node_modules/@types"]},
 "include": ["$PWD/server/modules/accounts/**/*.ts",
             "$PWD/server/shared/types.ts"],
 "exclude": []}
EOF
# `include` SKIPS a pattern that matches nothing, so `tc=0` over a tree this phase never wrote is
# worth nothing: every code path this phase's manifest names (the two it DELETES excepted) must turn
# up in the RESOLVED file list, or it counts missing. `server/index.ts` is deliberately not a root —
# it pulls the whole 812-file server tree in through its imports, which is the tree gate this scope
# exists to avoid; its one edit is the deleted proxy, which verify 2 above measures.
tool=0
[ -x node_modules/.bin/tsc ] || tool=$((tool+1))
[ -x node_modules/.bin/oxlint ] || tool=$((tool+1))
tc=0
node_modules/.bin/tsc -p /tmp/sunset-tc-9-client.json || tc=$?
node_modules/.bin/tsc -p /tmp/sunset-tc-9-server.json || tc=$?
node_modules/.bin/tsc -p /tmp/sunset-tc-9-client.json --listFilesOnly > /tmp/sunset-tc-9-client.files 2>/dev/null || true
node_modules/.bin/tsc -p /tmp/sunset-tc-9-server.json --listFilesOnly > /tmp/sunset-tc-9-server.files 2>/dev/null || true
miss=0
chk() { f="$1"; shift; for e in "$@"; do
    if [ -d "$e" ]; then n=$(grep -cF "$PWD/$e/" "$f" || true)
    else n=$(grep -cxF "$PWD/$e" "$f" || true); fi
    [ "${n:-0}" -gt 0 ] || { miss=$((miss+1)); echo "MISSING $e"; }
  done; }
chk /tmp/sunset-tc-9-client.files src/shared/types.ts src/shared/api.ts src/modules/accounts
chk /tmp/sunset-tc-9-server.files server/modules/accounts server/shared/types.ts
lint=$(node_modules/.bin/oxlint src/shared/types.ts src/shared/api.ts src/modules/accounts \
    server/modules/accounts server/shared/types.ts 2>&1 | grep -c ' error ' || true)
printf 'tc=%s miss=%s lint=%s tool=%s\n' "$tc" "$miss" "$lint" "$tool"
'''
expect = "tc=0 miss=0 lint=0 tool=0"
timeout_s = 600
```

**Read first.** `server_api_usage.py` and `usage_windows.py` whole, `docs/descent-proxy.md` before
you delete it (its nine rules ARE the contract this module now owns; the ones that survive belong in
`docs/accounts.md`, which Phase 25 writes), `docs/accounts.md` §"The usage meters" and
§"The rules that bite".

**What to build.** The usage reader, the four routes, the proxy gone, the types renamed. The
components render the same bodies they render today; if a `.tsx` under `src/modules/accounts/` needs
a change beyond following a renamed type or a renamed api key, STOP and report it — that would be a
shape change this phase did not plan.

**Sirens.** The switch verify sends `__no_such_slug__` and an empty slug and NOTHING else — a real
slug would swap the operator's live login mid-run, which is why the Descent-era probe did the same
(`docs/descent-proxy.md` §"Proving it"). You will want a `reachable:false` to be a 503 because that is
what an outage is; the panel is built on the calm 200 and the em-dash. You will want to keep the
`Descent*` type names to save a rename — the word is a lie the moment this module answers.

## Phase 10 — The driver: the nudge, the relaunch ledger, the rate-limit hold
Depends on: none

```toml
[phase]
id = "10"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 3000
manifest = [
  "server/modules/kanban-metis/metis-driver.service.ts",
  "server/modules/kanban-metis/metis-relaunch.service.ts",
  "server/modules/kanban-metis/kanban-metis.routes.ts",
  "server/modules/kanban-metis/kanban-metis.module.ts",
  "src/shared/api.ts",
  "/home/lyphe/.claude/hooks/notify_api_error.sh",
]
forbidden = [
  "server/modules/kanban-metis/metis-spawn.service.ts",
  "server/modules/kanban-metis/metis-liveness.ts",
]
athena = [
  "The nudge calls tick() synchronously inside the request, so a slow reap holds the HTTP response open",
  "The ledger counts an attempt for a board whose spawn SUCCEEDED, so a healthy board backs itself off",
  "The backoff never resets, so one bad night silences the board until a server restart",
  "The ledger writes non-atomically, so a killed server leaves a truncated JSON the next boot cannot parse — and the driver throws on every tick",
  "The rate-limit hold reads a key notify_api_error.sh does not write, so the hold is never on and the repoint is decoration",
]

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/metis-relaunch.service.ts"
what = "Create the ledger of Interfaces §7 at <KANBAN_METIS_STATE_ROOT>/relaunch-ledger.json, ported from pm_relaunch_ledger.py:159-191: shouldRelaunch is false once attempts reach RELAUNCH_MAX_ATTEMPTS (3) or while inside the exponential backoff (base 600000 ms, doubling, capped at 3600000), recordAttempt persists atomically (temp file then rename), clearAttempts wipes a board's row. Add rateLimitHold(now), which reads the file ~/.claude/hooks/notify_api_error.sh writes — read that script, mirror its key names exactly — from CLOUDCLI_RATE_LIMIT_PATH or ~/.cloudcli/rate_limit.json, and answers the epoch the hold expires or null."
check = "grep -c 'export function shouldRelaunch\\|export function recordAttempt\\|export function clearAttempts\\|export function rateLimitHold' server/modules/kanban-metis/metis-relaunch.service.ts"
expect = "4"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/hooks/notify_api_error.sh"
what = "Repoint the rate-limit signal file from ~/.claude/descent/state/rate_limit.json to ~/.cloudcli/rate_limit.json, keeping the JSON shape and every key exactly as they are, and update the comment at :46 to name the board's driver as the reader instead of Descent's relauncher."
check = "{ grep -c 'descent' /home/lyphe/.claude/hooks/notify_api_error.sh || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/metis-driver.service.ts"
what = "Two gates and one reset in spawnForBoard, between the churn cooldown (:386-387) and the claimable read (:390): return when rateLimitHold(now) is in the future, return when shouldRelaunch(board.id, now) is false, recordAttempt on a spawn that THREW, and clearAttempts when a session for that board reaches a completed ending. Export the existing tick() unchanged — the route calls it."
check = "grep -c 'rateLimitHold\\|shouldRelaunch\\|recordAttempt\\|clearAttempts' server/modules/kanban-metis/metis-driver.service.ts"
expect_re = "^[4-9]"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/kanban-metis.routes.ts"
what = "Add POST /boards/:boardId/nudge: it records a metis.nudged event on the board through the kanban module's barrel, schedules driver.tick() on the next macrotask (setImmediate, never awaited inside the handler), and answers { nudged: true, at }. The driver is already in this file's dependencies (:185)."
check = "grep -c 'nudge' server/modules/kanban-metis/kanban-metis.routes.ts"
expect_re = "^[1-9]"

[[verify]]
cmd = '''
set -e
source scripts/sunset-probe.sh
trap stop_probe_server EXIT
probe_db
boot_probe_server
TOK=$(mint_token)
BOARD=$(curl -sf -H "Authorization: Bearer $TOK" http://127.0.0.1:7893/api/kanban/boards | python3 -c "import sys,json; print(json.load(sys.stdin)['boards'][0]['id'])")
COUNT="import sqlite3; print(sqlite3.connect('/tmp/sunset-probe.db').execute(\"select count(*) from kanban_events where kind='metis.nudged'\").fetchone()[0])"
BEFORE=$(python3 -c "$COUNT")
OK=$(curl -sf -X POST -H "Authorization: Bearer $TOK" "http://127.0.0.1:7893/api/kanban-metis/boards/$BOARD/nudge" | python3 -c "import sys,json; print(json.load(sys.stdin)['nudged'])")
sleep 2
AFTER=$(python3 -c "$COUNT")
echo "NUDGED $OK DELTA $((AFTER - BEFORE))"
'''
expect = "NUDGED True DELTA 1"
timeout_s = 480

[[verify]]
cmd = '''
set -e
export KANBAN_METIS_STATE_ROOT=/tmp/sunset-ledger
export CLOUDCLI_RATE_LIMIT_PATH=/tmp/sunset-ratelimit.json
rm -rf "$KANBAN_METIS_STATE_ROOT" /tmp/sunset-ratelimit.json
mkdir -p "$KANBAN_METIS_STATE_ROOT"
trap 'rm -f /tmp/sunset-verify-3.mts /tmp/sunset-ratelimit.json' EXIT
cat > /tmp/sunset-verify-3.mts <<'TS'
import * as r from '@/modules/kanban-metis/metis-relaunch.service.js';
const now = Date.now();
const first = r.shouldRelaunch('b-probe', now);
r.recordAttempt('b-probe', now);
const held = r.shouldRelaunch('b-probe', now + 1000);
const later = r.shouldRelaunch('b-probe', now + 700000);
r.recordAttempt('b-probe', now); r.recordAttempt('b-probe', now);
const spent = r.shouldRelaunch('b-probe', now + 99999999);
r.clearAttempts('b-probe');
const cleared = r.shouldRelaunch('b-probe', now + 1000);
console.log('FIRST', first, 'HELD', held, 'LATER', later, 'SPENT', spent, 'CLEARED', cleared);
TS
node_modules/.bin/tsx --tsconfig=server/tsconfig.json /tmp/sunset-verify-3.mts < /dev/null
rm -rf "$KANBAN_METIS_STATE_ROOT"
'''
expect = "FIRST true HELD false LATER true SPENT false CLEARED true"
timeout_s = 300
```

**Read first.** `~/.claude/descent/pm_relaunch_ledger.py` (the constants and the give-up rule),
`store_nudge.py:70-85` and `server_api_nudge.py:43-53` (what a nudge reaches — in Descent it collapses
a daemon's sleep; here it calls the tick the interval would have called),
`server/modules/kanban-metis/metis-driver.service.ts` (the tick's ordered body, its four early
returns, `TICK_MS` and `CHURN_COOLDOWN_MS`), and `~/.claude/hooks/notify_api_error.sh`.

**What to build.** A ledger, two gates, one route. Nothing else in the driver moves — its tick order,
its dial and its churn cooldown are correct as they stand.

**Sirens.** You will want to await `driver.tick()` in the nudge handler so the response says what
happened; a reap plus a spawn can take seconds and the caller pressed a button. You will want to
count an attempt on every spawn — count only the ones that THREW, or a healthy board backs itself off
after three successes. You will want to invent the rate-limit file's shape: read the script and
mirror it, because a key you guessed makes the hold silently dead.

## Phase 11 — Session telemetry: the transcript tail and the card's four counters
Depends on: Phase 1

```toml
[phase]
id = "11"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2700
manifest = [
  "server/modules/kanban-metis/metis-telemetry.service.ts",
  "server/modules/kanban-metis/kanban-metis.module.ts",
  "server/modules/kanban/kanban-cards.service.ts",
  "server/modules/kanban/index.ts",
]
forbidden = [
  "server/modules/kanban-metis/metis-driver.service.ts",
  "server/modules/kanban-metis/metis-spawn.service.ts",
]
athena = [
  "The same assistant message is counted twice across two passes, because dedup keys on position rather than on message id",
  "The tail re-reads the whole JSONL every 30 seconds instead of resuming from the stored byte offset",
  "A truncated last line is parsed as JSON and throws, ending the interval for every session",
  "The card counters are SET to a session's totals rather than accumulated, so a second session on one card erases the first's spend",
  "The telemetry interval starts once per module construction but is never unref'd, so the server will not exit",
]

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/metis-telemetry.service.ts"
what = "Port pm_telemetry.py's watcher: export accumulateUsage(jsonlPath, fromOffset) returning { tokensIn, tokensOut, cacheRead, cacheCreate, seen, offset } — resuming at the byte offset, parsing one JSON object a line, skipping a trailing partial line, and deduplicating on message.id (:120-150) — and tickTelemetry(now), which walks the registry's live sessions, finds each transcript the way the routes already do (readClaudeTranscriptBySessionId's scanProjectsRoot fallback), upserts kanban_session_usage and adds the delta to the card's four build_tokens_* columns. Every write goes through the kanban barrel; the interval is 30 s and unref'd."
check = "grep -c 'export function accumulateUsage\\|export function tickTelemetry' server/modules/kanban-metis/metis-telemetry.service.ts"
expect = "2"

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-cards.service.ts"
what = "Add addCardTokens(cardId, delta, context?) — an ACCUMULATING update of the four build_tokens_* columns through writeKanban with kind card.updated — and export it from the module barrel so the telemetry service can reach it without a deep import."
check = "grep -c 'addCardTokens' server/modules/kanban/kanban-cards.service.ts server/modules/kanban/index.ts | grep -c ':[1-9]'"
expect = "2"

[[verify]]
cmd = '''
set -e
python3 - <<'PY'
import json, pathlib
rows = [
  {"type": "assistant", "message": {"id": "msg_1", "usage": {"input_tokens": 10, "output_tokens": 20, "cache_read_input_tokens": 30, "cache_creation_input_tokens": 40}}},
  {"type": "assistant", "message": {"id": "msg_1", "usage": {"input_tokens": 10, "output_tokens": 20, "cache_read_input_tokens": 30, "cache_creation_input_tokens": 40}}},
  {"type": "assistant", "message": {"id": "msg_2", "usage": {"input_tokens": 1, "output_tokens": 2, "cache_read_input_tokens": 3, "cache_creation_input_tokens": 4}}},
]
p = pathlib.Path('/tmp/sunset-telemetry.jsonl')
p.write_text("\n".join(json.dumps(r) for r in rows) + "\n" + '{"type":"assistant","message":{"id":"msg_3"')
PY
trap 'rm -f /tmp/sunset-verify-4.mts /tmp/sunset-telemetry.jsonl' EXIT
cat > /tmp/sunset-verify-4.mts <<'TS'
import { accumulateUsage } from '@/modules/kanban-metis/metis-telemetry.service.js';
const a = accumulateUsage('/tmp/sunset-telemetry.jsonl', 0);
console.log('IN', a.tokensIn, 'OUT', a.tokensOut, 'READ', a.cacheRead, 'CREATE', a.cacheCreate);
TS
node_modules/.bin/tsx --tsconfig=server/tsconfig.json /tmp/sunset-verify-4.mts < /dev/null
rm -f /tmp/sunset-telemetry.jsonl
'''
expect = "IN 11 OUT 22 READ 33 CREATE 44"
timeout_s = 300

[[verify]]
cmd = '''
set -e
cat > /tmp/sunset-tc-11-server.json <<EOF
{"extends": "$PWD/server/tsconfig.json",
 "compilerOptions": {"noEmit": true, "typeRoots": ["$PWD/node_modules/@types"]},
 "include": ["$PWD/server/modules/kanban-metis/metis-telemetry.service.ts",
             "$PWD/server/modules/kanban-metis/kanban-metis.module.ts",
             "$PWD/server/modules/kanban/kanban-cards.service.ts",
             "$PWD/server/modules/kanban/index.ts"],
 "exclude": []}
EOF
# `include` SKIPS a path it cannot match, so `tc=0` over a tree this phase never wrote is worth
# nothing: every file the manifest names must turn up in the RESOLVED file list, or it counts
# missing — all four gone used to answer `tc=2` (TS18003), one present answered a false `tc=0`.
tool=0
[ -x node_modules/.bin/tsc ] || tool=$((tool+1))
[ -x node_modules/.bin/oxlint ] || tool=$((tool+1))
tc=0; node_modules/.bin/tsc -p /tmp/sunset-tc-11-server.json || tc=$?
node_modules/.bin/tsc -p /tmp/sunset-tc-11-server.json --listFilesOnly > /tmp/sunset-tc-11-server.files 2>/dev/null || true
miss=0
for e in server/modules/kanban-metis/metis-telemetry.service.ts \
         server/modules/kanban-metis/kanban-metis.module.ts \
         server/modules/kanban/kanban-cards.service.ts server/modules/kanban/index.ts; do
  n=$(grep -cxF "$PWD/$e" /tmp/sunset-tc-11-server.files || true)
  [ "${n:-0}" -gt 0 ] || { miss=$((miss+1)); echo "MISSING $e"; }
done
lint=$(node_modules/.bin/oxlint server/modules/kanban-metis/metis-telemetry.service.ts \
    server/modules/kanban-metis/kanban-metis.module.ts \
    server/modules/kanban/kanban-cards.service.ts server/modules/kanban/index.ts \
    2>&1 | grep -c ' error ' || true)
printf 'tc=%s miss=%s lint=%s tool=%s\n' "$tc" "$miss" "$lint" "$tool"
'''
expect = "tc=0 miss=0 lint=0 tool=0"
timeout_s = 420
```

**Read first.** `~/.claude/descent/pm_telemetry.py` (the 30 s tick, the byte offsets, the message-id
dedup at :120-150) and `store_telemetry.py:52-75` (the silent upsert — telemetry writes no event in
Descent; here the card update does, because every board write goes through the seam).
`server/modules/providers/list/claude/claude-transcript-activity.ts:138-155` is how a Metis session's
transcript is found without a database row.

**What to build.** One service and one accumulating card verb. The duplicate `msg_1` in the verify is
the point: 11/22/33/44 is the answer with dedup, 21/42/63/84 without it, and the truncated last line
must be skipped rather than thrown on.

**Sirens.** You will want to count every `usage` object you see; the CLI repeats a message across
stream events and Descent deduplicates on `message.id` for exactly that reason. You will want to set
the card's counters to the session's totals — two Metis sessions can work one card over its life, and
a set erases the first one's spend.

## Phase 12 — Two read-only projections: a board's vitals and a card's plan cost
Depends on: Phase 1, Phase 2, Phase 3

```toml
[phase]
id = "12"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2700
manifest = [
  "server/modules/kanban/kanban-vitals.service.ts",
  "server/modules/kanban/routes/board.routes.ts",
  "server/modules/kanban/routes/card.routes.ts",
  "server/modules/kanban/kanban.module.ts",
  "server/modules/plan-runner/plan-cost.service.ts",
  "server/modules/plan-runner/index.ts",
  "server/index.ts",
  "src/shared/api.ts",
]
forbidden = [
  "server/modules/plan-runner/runner-state.transport.ts",
  "server/modules/kanban/kanban-write.service.ts",
]
athena = [
  "The board module imports plan-runner or memory-intake directly instead of taking them as injected services, so the board's routes cannot be built against a scratch root",
  "The plan-cost read prices tokens itself instead of summing the cost_usd every ledger row and receipt already carries",
  "A card with no plan path answers a cost of 0 rather than null, so the drawer claims a build was free",
  "A board-shaped key carries an estate-wide number, so two boards report the same count under a board id",
  "The plan-cost route walks every run directory on every call with no cache, so opening a drawer scans 274 directories",
]

[[steps]]
kind = "edit"
path = "server/modules/plan-runner/plan-cost.service.ts"
what = "Create planCostFor(planPath) per Interfaces §7, READING the ledgers that already exist: readPlanLedger(planPath) and the run directories through readRunFiles, both already exported from runner-state.transport.ts, plus receipt.json's own precomputed plan_cost when the latest matching receipt carries one. Nothing here prices a token and nothing writes a ledger. Match a run to a plan by the realpath of its plan_path with ~ expanded FIRST — costs.py:328-330 records why a bare comparison is wrong. Cache per plan path for 20 seconds, costs.py's own TTL. Export it from the module barrel."
check = "grep -c 'export function planCostFor\\|readPlanLedger' server/modules/plan-runner/plan-cost.service.ts"
expect_re = "^[2-9]"

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-vitals.service.ts"
what = "Create vitalsCounts(boardId, estate) per Interfaces §7: the four BOARD-scoped counts (building, awaitingAnswer, awaitingApprove, claimable) plus lessonsPendingEstate from the board's own lesson table, as ONE query with scalar sub-selects in the shape of store_actionable.py:307-345, scoped to the board and excluding archived cards. memoryPendingEstate arrives as the `estate` argument — this module never imports memory-intake. Every estate-wide key carries the word in its name, so a board id can never imply a board scope."
check = "grep -c 'lessonsPendingEstate\\|memoryPendingEstate' server/modules/kanban/kanban-vitals.service.ts"
expect_re = "^[2-9]"

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban.module.ts"
what = "createKanbanModule gains two injected readers in its dependencies — planCost(planPath) and memoryPending() — threaded into the services object its routes already take (kanban.module.ts:15-19). server/index.ts composes them from the plan-runner and memory-intake barrels: the ONE cross-module import sits in the composition root, and neither the board's services nor its routes import a sibling module."
check = "grep -c 'planCost\\|memoryPending' server/modules/kanban/kanban.module.ts server/index.ts | grep -c ':[1-9]'"
expect = "2"

[[steps]]
kind = "edit"
path = "server/modules/kanban/routes/board.routes.ts"
what = "Add GET /boards/:boardId/vitals -> { vitals }, a thin handler in the shape of the claimable route at :170-177, calling vitalsCounts with the injected memoryPending() reading. Add GET /cards/:cardId/plan-cost -> { planCost } to card.routes.ts in the same step: null when the card's plan column is empty, otherwise the injected planCost service's answer."
check = "grep -c 'vitals' server/modules/kanban/routes/board.routes.ts"
expect_re = "^[1-9]"

[[verify]]
cmd = '''
set -e
source scripts/sunset-probe.sh
trap stop_probe_server EXIT
probe_db
boot_probe_server
TOK=$(mint_token)
BOARD=$(curl -sf -H "Authorization: Bearer $TOK" http://127.0.0.1:7893/api/kanban/boards | python3 -c "import sys,json; print(json.load(sys.stdin)['boards'][0]['id'])")
curl -sf -H "Authorization: Bearer $TOK" "http://127.0.0.1:7893/api/kanban/boards/$BOARD/vitals" | python3 -c "
import sys, json
v = json.load(sys.stdin)['vitals']
want = ['building','awaitingAnswer','awaitingApprove','claimable','lessonsPendingEstate','memoryPendingEstate']
print('VITALS', sum(1 for k in want if isinstance(v.get(k), int)))
"
'''
expect = "VITALS 6"
timeout_s = 480

[[verify]]
cmd = '''
set -e
# The fixture is THIS plan, not whatever planning ran last: the newest ledger entry is live state, so
# one planning run anywhere between the write and the walk turned `KNOWN` false and blocked the phase.
# This plan's own ledger entry exists for as long as this run does.
trap 'rm -f /tmp/sunset-verify-5.mts' EXIT
cat > /tmp/sunset-verify-5.mts <<'TS'
import { planCostFor } from '@/modules/plan-runner/plan-cost.service.js';
const known = planCostFor(process.argv[2]);
const missing = planCostFor('/home/lyphe/.claude/plans/__no_such_plan__.md');
console.log('KNOWN', known !== null && known.totalUsd > 0, 'MISSING', missing === null || missing.totalUsd === 0);
TS
node_modules/.bin/tsx --tsconfig=server/tsconfig.json /tmp/sunset-verify-5.mts "$PWD/docs/plans/descent-sunset.plan.md" < /dev/null
'''
expect = "KNOWN true MISSING true"
timeout_s = 300
```

**Read first.** `~/.claude/hooks/plan_runner/costs.py` (`summary` at :376, the ledger directory at
:50, the slug rule at :194-196 — the slug is the plan file's BASENAME minus `.md`, so any directory
reaches the same ledger — and the run index at :327-370),
`server/modules/plan-runner/runner-state.transport.ts:138-142,223-259` (the readers that already
exist), `~/.claude/descent/store_actionable.py:307-345`, `plan_costs.py:35-52` (the 20-second cache),
and `kanban.module.ts:15-19` (why nothing below the module constructor reaches sideways).

**What to build.** Two read-only services, two routes, and the two injections that keep the board
module free of its siblings. The client surfaces are Phases 19 and 20.

**Sirens.** You will want to write a cost ledger of your own so the number is fast — the operator's
instruction is explicit that the reading is ported and not a second ledger, and every row it reads is
already priced. You will want `card.routes.ts` to import the plan-runner barrel directly; it is legal
under the barrel law and still wrong here, because this module's whole composition discipline is that
everything below the constructor takes what it needs as an argument. The verify picks the NEWEST
ledger rather than naming one, so an archived or pruned ledger never fails a phase that did not cause
it.

## Phase 13 — The plan-archive sweep, with the board's leases handed in
Depends on: none

```toml
[phase]
id = "13"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2700
manifest = [
  "server/modules/plan-runner/plan-archive.service.ts",
  "server/modules/plan-runner/plan-runner.module.ts",
  "server/modules/plan-runner/index.ts",
  "server/modules/kanban/kanban-cards.service.ts",
  "server/modules/kanban/index.ts",
  "server/index.ts",
]
forbidden = [
  "server/modules/plan-runner/runner-state.service.ts",
  "server/modules/database/kanban-schema.ts",
]
athena = [
  "plan-archive opens the database or names a kanban_ table, re-drawing the cycle the parameter exists to break",
  "A plan is moved while a card still holds a plan or build lease on it, because plansHeldByLease returned paths in a different spelling than the sweep compares",
  "The sweep runs on the interval from process start rather than after a settle window, so a dev reload sweeps every restart",
  "A destination that already exists is clobbered instead of held",
  "The unshipped-phase count is re-implemented in TypeScript and drifts from the one the runner itself uses",
]

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-cards.service.ts"
what = "Add plansHeldByLease(): string[] — every live card's plan path where plan_lease_at or build_lease_at is set and fresh by the board's own 40-second staleness rule — and export it from the module barrel. The board answers what its leases hold; nobody else reads its rows to find out."
check = "grep -c 'plansHeldByLease' server/modules/kanban/kanban-cards.service.ts server/modules/kanban/index.ts | grep -c ':[1-9]'"
expect = "2"

[[steps]]
kind = "edit"
path = "server/modules/plan-runner/plan-archive.service.ts"
what = "Port archive_plans.py's four clauses per Interfaces §7 as sweepPlanArchive(now, apply, heldPlanPaths): cold (mtime older than 48 h), zero unshipped phases, NOT in heldPlanPaths, and positive done-evidence (a SHIPPED stamp in the file). The phase count is NOT re-implemented — shell `python3 -c` against ~/.claude/hooks/auto_execute_plan.py's _count_unshipped_phases, the one home for that rule. Source CLOUDCLI_PLANS_DIR (default ~/.claude/plans), top level only, never archive/; destination its archive/ subdirectory; an existing destination is HELD and never clobbered; the only write is the move. This file never opens a database and never names a kanban_ table."
check = "{ grep -c 'kanban\\|sqlite\\|better-sqlite3' server/modules/plan-runner/plan-archive.service.ts || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "server/modules/plan-runner/plan-runner.module.ts"
what = "Start the sweep on plans_archive_watcher.py's cadence: a 120-second settle after construction, then every 86400 seconds, unref'd, one interval per module construction, each pass wrapped so a throw is logged and never ends the interval. The module takes heldPlanPaths as a dependency — a function it calls per pass — and server/index.ts composes it from the kanban barrel's plansHeldByLease."
check = "grep -c 'sweepPlanArchive\\|heldPlanPaths' server/modules/plan-runner/plan-runner.module.ts server/index.ts | grep -c ':[1-9]'"
expect = "2"

[[verify]]
cmd = '''
set -e
export CLOUDCLI_PLANS_DIR=/tmp/sunset-plans
export DATABASE_PATH=/tmp/sunset-archive.db
rm -rf /tmp/sunset-plans /tmp/sunset-archive.db
mkdir -p /tmp/sunset-plans/archive
trap 'rm -f /tmp/sunset-verify-8.mts' EXIT
cat > /tmp/sunset-verify-8.mts <<'TS'
import { sweepPlanArchive } from '@/modules/plan-runner/plan-archive.service.js';
const r = sweepPlanArchive(Date.now(), false, new Set());
console.log('DRYRUN', Array.isArray(r.moved), 'HELD', typeof r.held === 'object');
TS
node_modules/.bin/tsx --tsconfig=server/tsconfig.json /tmp/sunset-verify-8.mts < /dev/null
'''
expect = "DRYRUN true HELD true"
timeout_s = 300

[[verify]]
cmd = '''
set -e
export CLOUDCLI_PLANS_DIR=/tmp/sunset-plans
rm -rf /tmp/sunset-plans && mkdir -p /tmp/sunset-plans/archive
printf '%s\n' '# probe plan' '## Phase 1 — a phase' > /tmp/sunset-plans/probe-unshipped.md
printf '%s\n' '# probe plan' '## Phase 1 — a phase' '### Phase 1 Ship Log — ✅ SHIPPED 2026-01-01' > /tmp/sunset-plans/probe-shipped.md
printf '%s\n' '# probe plan' '## Phase 1 — a phase' '### Phase 1 Ship Log — ✅ SHIPPED 2026-01-01' > /tmp/sunset-plans/probe-held.md
touch -d '10 days ago' /tmp/sunset-plans/probe-unshipped.md /tmp/sunset-plans/probe-shipped.md /tmp/sunset-plans/probe-held.md
trap 'rm -rf /tmp/sunset-verify-6.mts /tmp/sunset-plans' EXIT
cat > /tmp/sunset-verify-6.mts <<'TS'
import { sweepPlanArchive } from '@/modules/plan-runner/plan-archive.service.js';
const held = new Set(['/tmp/sunset-plans/probe-held.md']);
const r = sweepPlanArchive(Date.now(), true, held);
console.log('MOVED', r.moved.length);
TS
node_modules/.bin/tsx --tsconfig=server/tsconfig.json /tmp/sunset-verify-6.mts < /dev/null
LEFT=$(ls /tmp/sunset-plans/*.md | wc -l)
rm -rf /tmp/sunset-plans
echo "LEFT $LEFT"
'''
expect_re = "MOVED 1\\s+LEFT 2"
timeout_s = 300
```

**Read first.** `~/.claude/descent/archive_plans.py` (the four clauses at :124-200, the clobber
refusal at :248-251, the constants at :36-45), `plans_archive_watcher.py:63-70,106-113`, and
`docs/kanban.md` §"The driver" on why a second reader of board rows is refused.

**What to build.** One service that knows nothing about boards, one read verb on the board, and the
join in `server/index.ts`. The second verify is the whole point: of three ten-day-old plans, the
unshipped one and the leased one stay and only the third moves — the two clauses an eager port always
loses, proven in one command.

**Sirens.** You will want to port `_count_unshipped_phases` into TypeScript so the module has no
Python dependency; that function is the runner's own reading of a plan, it changes when the plan
format changes, and a second copy would answer differently from the thing that walks the file. You
will want to read the leases here, since the database is one `better-sqlite3` call away — that is the
cycle this phase's signature exists to break.

## Phase 14 — The dial, the one spawn predicate, and the reply channel
Depends on: Phase 1

```toml
[phase]
id = "14"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 3300
manifest = [
  "server/modules/database/kanban-schema.ts",
  "server/modules/database/migrations.ts",
  "server/modules/kanban/kanban-boards.service.ts",
  "server/modules/kanban/routes/board.routes.ts",
  "server/modules/kanban-metis/metis-spawn.service.ts",
  "server/modules/kanban-metis/metis-driver.service.ts",
  "server/modules/kanban-metis/kanban-metis.routes.ts",
  "server/modules/kanban-metis/kanban-metis.module.ts",
  "src/shared/api.ts",
  "server/shared/kanban-types.ts",
  "src/shared/kanban-types.ts",
]
forbidden = [
  "server/modules/kanban-metis/metis-registry.service.ts",
  "server/modules/kanban-metis/metis-liveness.ts",
]
athena = [
  "The dial is read at module construction, so moving it needs a server restart and the route lies about what it did",
  "reply spawns with --session-id instead of --resume, so the operator's words start a brand-new conversation",
  "reply drops the brief, the mcp-config or bypassPermissions, so the replying Metis has no tools and no board",
  "resume or reply escapes canSpawn, so a board at its dial gains a child through the door the phase did not guard",
  "The additive column is declared in the schema script only, so a live database never gets it and every board reads the default",
]

[[steps]]
kind = "edit"
path = "server/modules/database/kanban-schema.ts"
what = "Declare kanban_boards.concurrency INTEGER NOT NULL DEFAULT 1 in KANBAN_SCHEMA_SQL beside autonomy and deepseek_flash, and add the matching addColumnToTableIfNotExists call to migrateKanbanBoardsColumns in migrations.ts (:544-551) in the same step — the schema script alone never reaches a database that already has the table, which that file's own header says."
check = "grep -c 'concurrency' server/modules/database/kanban-schema.ts server/modules/database/migrations.ts | grep -c ':[1-9]'"
expect = "2"

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-boards.service.ts"
what = "Carry concurrency on the board row and its summary, clamped to [0, CONCURRENCY_MAX] on every read and on every write, and accept it in the board PATCH beside autonomy and deepseekFlash (board.routes.ts). Mirror the field on KanbanBoard in server/shared/kanban-types.ts and src/shared/kanban-types.ts. Zero is a real value and means this board spawns nothing."
check = "grep -c 'concurrency' server/modules/kanban/kanban-boards.service.ts server/modules/kanban/routes/board.routes.ts | grep -c ':[1-9]'"
expect = "2"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/metis-spawn.service.ts"
what = "Export canSpawn({ live, dial }) -> { allowed, reason } — pure arithmetic over two facts the caller gathers, in the shape metis-liveness.ts already uses — and call it from launch, resume AND reply alike, each reading the board's concurrency column at CALL time. The refusal names the dial and its value. Delete the one-running-session refusal at :387-392 and its driver-exemption comment: both paths now honour the same number."
check = "grep -c 'export function canSpawn\\|export const canSpawn' server/modules/kanban-metis/metis-spawn.service.ts"
expect_re = "^[1-9]"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/metis-spawn.service.ts"
what = "Add reply(sessionId, text) per Interfaces §8: resume() with the operator's text as the opening turn instead of the standard one — the same --resume <sessionId>, the same freshly-read brief, the same --mcp-config/--strict-mcp-config/--permission-mode/env, the text written to stdin then EOF — refusing a session whose child is running with 'she is mid-turn — stop her first, then reply', and refusing past the dial with canSpawn's own words. The spec record it writes carries the reply verbatim as its openingTurn."
check = "grep -c 'export async function reply\\|const reply' server/modules/kanban-metis/metis-spawn.service.ts"
expect_re = "^[1-9]"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/metis-driver.service.ts"
what = "Read the dial from the board row at every tick instead of from the constructor (:261-266 and the comparison at :385), keep the [0, CONCURRENCY_MAX] clamp, and surface it in reading() beside lastSpawnAt so the panel shows live against dial."
check = "grep -c 'concurrency' server/modules/kanban-metis/metis-driver.service.ts"
expect_re = "^[2-9]"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/kanban-metis.routes.ts"
what = "Add POST /sessions/:sessionId/reply with body { text }, refusing in THIS order: a blank or missing text is a 422 decided at the route before any lookup, a session the registry does not know is a 404, a running session is a 409, a board at its dial is a 409 carrying canSpawn's reason, and otherwise the answer is { session }."
check = "grep -c 'reply' server/modules/kanban-metis/kanban-metis.routes.ts"
expect_re = "^[1-9]"

[[verify]]
cmd = '''
set -e
trap 'rm -f /tmp/sunset-verify-7.mts' EXIT
cat > /tmp/sunset-verify-7.mts <<'TS'
import { canSpawn } from '@/modules/kanban-metis/metis-spawn.service.js';
const a = canSpawn({ live: 0, dial: 1 });
const b = canSpawn({ live: 1, dial: 1 });
const c = canSpawn({ live: 1, dial: 2 });
const d = canSpawn({ live: 0, dial: 0 });
console.log('EMPTY', a.allowed, 'AT-DIAL', b.allowed, 'ROOM', c.allowed, 'ZERO', d.allowed, 'NAMED', typeof b.reason === 'string' && b.reason.includes('1'));
TS
node_modules/.bin/tsx --tsconfig=server/tsconfig.json /tmp/sunset-verify-7.mts < /dev/null
'''
expect = "EMPTY true AT-DIAL false ROOM true ZERO false NAMED true"
timeout_s = 300

[[verify]]
cmd = '''
set -e
source scripts/sunset-probe.sh
trap stop_probe_server EXIT
probe_db
boot_probe_server
TOK=$(mint_token)
B=http://127.0.0.1:7893
BOARD=$(curl -sf -H "Authorization: Bearer $TOK" "$B/api/kanban/boards" | python3 -c "import sys,json; print(json.load(sys.stdin)['boards'][0]['id'])")
SET=$(curl -sf -X PATCH -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"concurrency":3}' "$B/api/kanban/boards/$BOARD" | python3 -c "import sys,json; print(json.load(sys.stdin)['board']['concurrency'])")
CLAMP=$(curl -sf -X PATCH -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"concurrency":99}' "$B/api/kanban/boards/$BOARD" | python3 -c "import sys,json; print(json.load(sys.stdin)['board']['concurrency'])")
READING=$(curl -sf -H "Authorization: Bearer $TOK" "$B/api/kanban-metis/boards/$BOARD/driver" | python3 -c "import sys,json; print(json.load(sys.stdin)['concurrency'])")
BLANK=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"text":"  "}' "$B/api/kanban-metis/sessions/00000000-0000-0000-0000-000000000000/reply")
MISSING=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"text":"hello"}' "$B/api/kanban-metis/sessions/00000000-0000-0000-0000-000000000000/reply")
echo "DIAL $SET CLAMP $CLAMP READING $CLAMP BLANK $BLANK MISSING $MISSING"
'''
expect = "DIAL 3 CLAMP 4 READING 4 BLANK 422 MISSING 404"
timeout_s = 540

[[verify]]
cmd = "grep -c -- '--resume' server/modules/kanban-metis/metis-spawn.service.ts server/modules/kanban-metis/metis-env.service.ts | grep -c ':[1-9]'"
expect = "2"
```

**Read first.** `server/modules/kanban-metis/metis-spawn.service.ts` (the spawn at :245-265, resume at
:485-516, the refusal at :387-392 and the REASON written into it), `metis-driver.service.ts:102-104,
261-266, 385` (the dial that has no home today), `metis-env.service.ts:219-247` (the argv),
`metis-liveness.ts` (the pure-predicate shape `canSpawn` copies), `migrations.ts:544-551`, and
`docs/kanban.md` §"A board's Metis, launched".

**What to build.** A column, a clamp, one predicate with three callers, one new verb, one route. The
dial is the phase: without a home for it, replacing the launch refusal with `live >= dial` would ship
exactly the behaviour that exists today.

**The fence that comes down, and why that is safe.** The refusal being deleted carries its own
reason: two children of one board share a cwd and are handed different lease owners. That is now the
ordinary case, and it is safe because nothing per-session is written into the cwd — every per-session
file lives under `~/.claude/state/kanban-metis/<sessionId>/` — and the arbiter of who owns a card is
the lease CAS, not the directory. **A per-session cwd is forbidden**: `~/.claude/hooks/kanban_metis.py`'s
`board_id()` reads the leaf directly under the session root, and a deeper path would make every board
session invisible to the seclusion predicate. Say this in the code where the refusal used to be.

**Sirens.** You will want to hold a reply and deliver it when she finishes — a queued turn nobody can
see is worse than a refusal the screen explains. You will want to reach the live child through the
chat websocket or the session host; neither knows her. You will want to raise `CONCURRENCY_MAX`
because four feels arbitrary — it is the ceiling the driver already declares, and this phase gives
the dial a home rather than a new ceiling.

## Phase 15 — Scaffold: the card drawer's attachments section
Depends on: Phase 5

```toml
[phase]
id = "15"
builder = "iris"
model = "fable"
kind = "scaffold"
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "src/modules/kanban/card-drawer/DrawerAttachments.tsx",
  "src/modules/kanban/card-drawer/KanbanCardDrawer.tsx",
]
forbidden = [
  "src/modules/kanban/card-drawer/DrawerBody.tsx",
  "src/modules/kanban/card-drawer/DrawerChecklist.tsx",
]
athena = [
  "The section renders nothing at all when a card has no attachments, so the operator cannot tell it from a card that failed to load",
  "A marker carries no name, or is a comment the fill phase cannot find by its literal FILL: token",
  "The section invents its own fetch instead of reading detail.attachments, breaking the drawer's one-fetcher rule",
  "An image preview is drawn with a bare img src, which cannot carry the bearer token this server requires",
  "The section is mounted inside the autonomy-gated block, so attachments vanish when autonomy is off",
]

[[steps]]
kind = "edit"
path = "src/modules/kanban/card-drawer/DrawerAttachments.tsx"
what = "Compose the section only — props { detail: KanbanCardDetail; writes: KanbanMutations }, the same two every sibling section takes. Draw every state: no attachments, a list of them (filename, size, kind glyph, a preview slot for an image), one uploading, one failed, and a drop/select affordance. Verve components from @/shared/ui only. Every handler and every data hook is a marker line carrying the literal token FILL: and a name — FILL: onSelectFiles, FILL: onRemove, FILL: previewSrc, FILL: uploading — with fake props so the file renders as-is. No behaviour and no data wiring."
check = "grep -c 'FILL:' src/modules/kanban/card-drawer/DrawerAttachments.tsx"
expect_re = "^[4-9]"

[[steps]]
kind = "edit"
path = "src/modules/kanban/card-drawer/KanbanCardDrawer.tsx"
what = "Mount DrawerAttachments in the ALWAYS-shown slot beside DrawerBody (:235), keyed `attachments-${detail.id}` like its siblings — not inside the autonomy-gated block."
check = "grep -c 'DrawerAttachments' src/modules/kanban/card-drawer/KanbanCardDrawer.tsx"
expect_re = "^[1-9]"

[[steps]]
kind = "run"
cmd = "mkdir -p ~/.cloudcli/sunset-scaffold && cp src/modules/kanban/card-drawer/DrawerAttachments.tsx ~/.cloudcli/sunset-scaffold/"
check = "test -f ~/.cloudcli/sunset-scaffold/DrawerAttachments.tsx && echo SCAFFOLD-KEPT"
expect = "SCAFFOLD-KEPT"

[[verify]]
cmd = "npm run build:client > /dev/null 2>&1 && echo CLIENT-BUILDS"
expect = "CLIENT-BUILDS"
timeout_s = 600

[[verify]]
cmd = "grep -c 'from .@/shared/ui' src/modules/kanban/card-drawer/DrawerAttachments.tsx"
expect_re = "^[1-9]"
```

**Read first.** `src/modules/kanban/card-drawer/DrawerIssuesAndTokens.tsx` (the sibling's shape and
its two props), `KanbanCardDrawer.tsx:229-247` (the two mount slots), `docs/kanban.md` §"The panel",
and `src/modules/chat/transcript/ChatMessageImages.tsx:20-69` — the one honest way to draw a
server-held image here is a blob fetched with the token and `URL.createObjectURL`, never `<img src>`
pointed at the route.

**What to build.** One file's composition and one mount line. No fetch, no handler, no api call.

**Sirens.** You will want to wire the upload because it is three lines — the fill phase owns every
line under a marker, and a scaffold that behaves cannot be diffed against the shipped file. You will
want to gate the section on autonomy like its three neighbours; attachments are the operator's own
and belong on every card.

## Phase 16 — Fill: the card drawer's attachments section
Depends on: Phase 15

```toml
[phase]
id = "16"
builder = "hephaestus"
model = "opus"
kind = "fill"
scaffold_of = "15"
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "src/modules/kanban/card-drawer/DrawerAttachments.tsx",
  "src/modules/kanban/hooks/useKanbanMutations.ts",
  "src/shared/api.ts",
]
forbidden = [
  "src/modules/kanban/card-drawer/KanbanCardDrawer.tsx",
  "server/modules/kanban",
]
athena = [
  "The upload posts JSON instead of multipart, so every upload is refused by the route",
  "The blob URL is never revoked, so opening twenty cards leaks twenty object URLs",
  "A failed upload leaves the section in its uploading state forever",
  "The remove call does not re-read the card, so the removed row stays on screen until a frame arrives",
  "The composition outside the markers moved — a Verve component or a state branch the scaffold drew is gone",
]

[[steps]]
kind = "edit"
path = "src/shared/api.ts"
what = "Add api.kanban.uploadAttachment(cardId, file) posting multipart/form-data on field `file` (the uploadFiles entry at :474-479 is the pattern), api.kanban.attachmentBlob(cardId, attachmentId) fetching the bytes with the bearer token, and api.kanban.removeAttachment(cardId, attachmentId)."
check = "grep -c 'uploadAttachment\\|attachmentBlob\\|removeAttachment' src/shared/api.ts"
expect_re = "^[3-9]"

[[steps]]
kind = "edit"
path = "src/modules/kanban/hooks/useKanbanMutations.ts"
what = "Add the two writes in the file's own shape (:220-224): uploadAttachment and removeAttachment, each returning what the route answered and nothing more."
check = "grep -c 'uploadAttachment\\|removeAttachment' src/modules/kanban/hooks/useKanbanMutations.ts"
expect_re = "^[2-9]"

[[steps]]
kind = "edit"
path = "src/modules/kanban/card-drawer/DrawerAttachments.tsx"
what = "Fill every FILL: marker and remove the token: onSelectFiles uploads through the mutation and clears its uploading state in a finally, onRemove removes and lets the drawer's own re-read repaint, previewSrc fetches the blob for an image mime and revokes the object URL on unmount, uploading reflects the in-flight write. Nothing outside the marker lines changes."
check = "{ grep -c 'FILL:' src/modules/kanban/card-drawer/DrawerAttachments.tsx || true; }"
expect = "0"

[[verify]]
cmd = '''
set -e
cat > /tmp/sunset-tc-16-client.json <<EOF
{"extends": "$PWD/tsconfig.json",
 "compilerOptions": {"noEmit": true, "typeRoots": ["$PWD/node_modules/@types"], "types": ["node"]},
 "include": ["$PWD/src/vite-env.d.ts",
             "$PWD/src/modules/kanban/card-drawer/DrawerAttachments.tsx",
             "$PWD/src/modules/kanban/hooks/useKanbanMutations.ts",
             "$PWD/src/shared/api.ts"],
 "exclude": []}
EOF
# `include` SKIPS a path it cannot match, so `tc=0` over a tree this phase never wrote is worth
# nothing: every file the manifest names must turn up in the RESOLVED file list, or it counts
# missing. `src/vite-env.d.ts` is the ambient-types root, not a file this phase writes.
tool=0
[ -x node_modules/.bin/tsc ] || tool=$((tool+1))
[ -x node_modules/.bin/oxlint ] || tool=$((tool+1))
tc=0; node_modules/.bin/tsc -p /tmp/sunset-tc-16-client.json || tc=$?
node_modules/.bin/tsc -p /tmp/sunset-tc-16-client.json --listFilesOnly > /tmp/sunset-tc-16-client.files 2>/dev/null || true
miss=0
for e in src/modules/kanban/card-drawer/DrawerAttachments.tsx \
         src/modules/kanban/hooks/useKanbanMutations.ts src/shared/api.ts; do
  n=$(grep -cxF "$PWD/$e" /tmp/sunset-tc-16-client.files || true)
  [ "${n:-0}" -gt 0 ] || { miss=$((miss+1)); echo "MISSING $e"; }
done
lint=$(node_modules/.bin/oxlint src/modules/kanban/card-drawer/DrawerAttachments.tsx \
    src/modules/kanban/hooks/useKanbanMutations.ts src/shared/api.ts \
    2>&1 | grep -c ' error ' || true)
printf 'tc=%s miss=%s lint=%s tool=%s\n' "$tc" "$miss" "$lint" "$tool"
'''
expect = "tc=0 miss=0 lint=0 tool=0"
timeout_s = 600

[[verify]]
cmd = '''
set -e
KEPT=$(grep -o 'from .@/shared/ui[^;]*' ~/.cloudcli/sunset-scaffold/DrawerAttachments.tsx | head -1)
NOW=$(grep -o 'from .@/shared/ui[^;]*' src/modules/kanban/card-drawer/DrawerAttachments.tsx | head -1)
SCAFFOLD_WORDS=$(grep -c 'FILL:' ~/.cloudcli/sunset-scaffold/DrawerAttachments.tsx)
echo "IMPORTS-HELD $([ "$KEPT" = "$NOW" ] && echo yes || echo no) MARKERS-WERE $([ "$SCAFFOLD_WORDS" -ge 4 ] && echo 4plus || echo few)"
'''
expect = "IMPORTS-HELD yes MARKERS-WERE 4plus"
timeout_s = 120
```

**Read first.** The scaffold as it stands, and `~/.cloudcli/sunset-scaffold/DrawerAttachments.tsx` — the
copy Phase 15 kept under the scaffold root (Interfaces §10), which the second verify diffs against.
If that copy is MISSING, the scaffold phase has to be re-walked: report the divergence and never reconstruct it by hand. Also
`src/modules/chat/hooks/useChatComposerState.ts:116` (how
this repository already posts a multipart upload), `ChatMessageImages.tsx:20-69` (the blob-and-revoke
pattern), and `useKanbanMutations.ts:220-224`.

**What to build.** The four markers, the two api entries, the two mutations. The second verify is the
composition guard: the scaffold's Verve import line must survive the fill unchanged.

**Sirens.** You will want to re-lay-out the section while you are in it — the composition is Iris's
and it is finished. You will want to post base64 JSON because Descent did; this route is multer
multipart, like every other upload in this repository.

## Phase 16b — The composer kit, moved to the shared library
Depends on: none

```toml
[phase]
id = "16b"
builder = "hephaestus"
model = "opus"
builder_reason = "a pure file move of a headless component kit, landed as its own checkpoint: no composition, layout or copy decision is taken here"
code_change = true
doc_sweep = "foreground"
expected_s = 1800
manifest = [
  "src/shared/ui/PromptInput.tsx",
  "src/shared/ui/index.ts",
  "src/modules/chat/composer",
  "src/modules/chat/index.ts",
]
forbidden = [
  "src/modules/kanban",
  "src/modules/chat/transcript",
]
athena = [
  "The move changed behaviour — a prop renamed, a default altered, a primitive dropped — instead of being byte-identical",
  "ChatComposer still deep-imports the old path, so two copies of the kit exist for one render",
  "The shared barrel now re-exports a chat-only type along with the primitives, widening the shared surface",
  "The old file is left behind as a re-export shim rather than deleted",
  "A primitive lost its doc comment naming its consumers, which the backend and frontend standards both require",
]

[[steps]]
kind = "edit"
path = "src/shared/ui/PromptInput.tsx"
what = "PURE MOVE: relocate src/modules/chat/composer/PromptInput.tsx and its nine primitives (PromptInput, PromptInputHeader/Body/Textarea/Footer/Tools/Button/Submit and the kit's own types) to src/shared/ui/PromptInput.tsx, byte-identical but for the import paths, and export them from src/shared/ui/index.ts. Its only imports are `cn` and Button/Tooltip from @/shared/ui, so nothing follows it."
check = "test -f src/shared/ui/PromptInput.tsx && grep -c 'PromptInput' src/shared/ui/index.ts"
expect_re = "^[1-9]"

[[steps]]
kind = "edit"
path = "src/modules/chat/composer"
what = "Point ChatComposer and every other chat-side consumer at the shared barrel and DELETE the old file — no re-export shim, no compatibility path. Healed means deleted."
check = "test ! -f src/modules/chat/composer/PromptInput.tsx && echo MOVED"
expect = "MOVED"

[[verify]]
cmd = '''
set -e
cat > /tmp/sunset-tc-16b-client.json <<EOF
{"extends": "$PWD/tsconfig.json",
 "compilerOptions": {"noEmit": true, "typeRoots": ["$PWD/node_modules/@types"], "types": ["node"]},
 "include": ["$PWD/src/vite-env.d.ts",
             "$PWD/src/shared/ui/PromptInput.tsx",
             "$PWD/src/shared/ui/index.ts",
             "$PWD/src/modules/chat/composer/**/*.ts",
             "$PWD/src/modules/chat/composer/**/*.tsx",
             "$PWD/src/modules/chat/index.ts"],
 "exclude": []}
EOF
# `include` SKIPS a pattern that matches nothing, so `tc=0` over a tree this phase never wrote is
# worth nothing: every path the manifest names must turn up in the RESOLVED file list, or it counts
# missing. `src/vite-env.d.ts` is the ambient-types root, not a file this phase writes.
tool=0
[ -x node_modules/.bin/tsc ] || tool=$((tool+1))
[ -x node_modules/.bin/oxlint ] || tool=$((tool+1))
tc=0; node_modules/.bin/tsc -p /tmp/sunset-tc-16b-client.json || tc=$?
node_modules/.bin/tsc -p /tmp/sunset-tc-16b-client.json --listFilesOnly > /tmp/sunset-tc-16b-client.files 2>/dev/null || true
miss=0
for e in src/shared/ui/PromptInput.tsx src/shared/ui/index.ts src/modules/chat/composer \
         src/modules/chat/index.ts; do
  if [ -d "$e" ]; then n=$(grep -cF "$PWD/$e/" /tmp/sunset-tc-16b-client.files || true)
  else n=$(grep -cxF "$PWD/$e" /tmp/sunset-tc-16b-client.files || true); fi
  [ "${n:-0}" -gt 0 ] || { miss=$((miss+1)); echo "MISSING $e"; }
done
lint=$(node_modules/.bin/oxlint src/shared/ui/PromptInput.tsx src/shared/ui/index.ts \
    src/modules/chat/composer src/modules/chat/index.ts 2>&1 | grep -c ' error ' || true)
printf 'tc=%s miss=%s lint=%s tool=%s\n' "$tc" "$miss" "$lint" "$tool"
'''
expect = "tc=0 miss=0 lint=0 tool=0"
timeout_s = 600

[[verify]]
cmd = "{ grep -rln 'composer/PromptInput' src/ || true; } | wc -l"
expect = "0"
```

**Read first.** `src/modules/chat/composer/PromptInput.tsx` (222 LOC, the headless kit),
`src/modules/chat/composer/ChatComposer.tsx` (its current consumer),
`.agents/skills/frontend-module-standards/SKILL.md:30` (why the kanban module may not reach into
chat for it), and `src/shared/ui/index.ts`.

**What to build.** One move and its import updates. Nothing else — this is a checkpoint of its own
precisely so the fleet panel's composition (Phase 17) and its wiring (Phase 18) are judged against a
library that already holds the kit.

**Sirens.** You will want to "improve" a primitive while you are in it: a pure move is judged by
being a pure move. You will want to leave the old path re-exporting for safety; two paths to one
component is the defect the move exists to prevent.

## Phase 17 — Scaffold: the pilot panel's fleet, conversation and composer
Depends on: Phase 14, Phase 16b

```toml
[phase]
id = "17"
builder = "iris"
model = "fable"
kind = "scaffold"
code_change = true
doc_sweep = "foreground"
expected_s = 2700
manifest = [
  "src/modules/kanban/KanbanMetisPanel.tsx",
  "src/modules/kanban/KanbanMetisRow.tsx",
  "src/modules/kanban/KanbanMetisConversation.tsx",
]
forbidden = [
  "src/modules/kanban/hooks/useKanbanMetis.ts",
  "src/modules/chat/transcript/SubagentTranscriptView.tsx",
]
athena = [
  "The conversation replaces the fleet list, so the operator loses sight of the other sessions while reading one",
  "The composer is drawn enabled for a running session, promising a reply the server will refuse",
  "The panel still renders one open transcript at a time but gives no way back to the list",
  "A marker is placed on a line the fill phase must delete rather than replace, so the composition cannot survive the fill",
  "Launch is drawn as the only way to start a session, with no sign of the dial that caps them",
]

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanMetisConversation.tsx"
what = "Compose the conversation surface: a header naming the session and its state, the transcript body (SubagentTranscriptView with target kind 'metis' — the scroller is the container's, never the view's), and a composer assembled from PromptInput's primitives beneath it. Draw every state: reading, empty, a live session with the composer disabled and the words 'She is mid-turn — stop her to reply', a stopped session with the composer enabled, a send in flight, and a refusal banner. Markers: FILL: onSend, FILL: sending, FILL: onStop, FILL: transcriptTarget."
check = "grep -c 'FILL:' src/modules/kanban/KanbanMetisConversation.tsx"
expect_re = "^[4-9]"

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanMetisPanel.tsx"
what = "Compose the fleet for several sessions at once: the list stays visible with the opened session's conversation beside or beneath it (never instead of it), each row openable, a visible Back affordance, the board's live count against its dial, and a ⚡ Nudge control beside Launch. Markers: FILL: onNudge, FILL: nudging, FILL: dial."
check = "grep -c 'FILL:' src/modules/kanban/KanbanMetisPanel.tsx"
expect_re = "^[3-9]"

[[steps]]
kind = "run"
cmd = "mkdir -p ~/.cloudcli/sunset-scaffold && cp src/modules/kanban/KanbanMetisPanel.tsx src/modules/kanban/KanbanMetisConversation.tsx ~/.cloudcli/sunset-scaffold/"
check = "test -f ~/.cloudcli/sunset-scaffold/KanbanMetisConversation.tsx && echo SCAFFOLD-KEPT"
expect = "SCAFFOLD-KEPT"

[[verify]]
cmd = '''
set -e
cat > /tmp/sunset-tc-17-client.json <<EOF
{"extends": "$PWD/tsconfig.json",
 "compilerOptions": {"noEmit": true, "typeRoots": ["$PWD/node_modules/@types"], "types": ["node"]},
 "include": ["$PWD/src/vite-env.d.ts",
             "$PWD/src/modules/kanban/KanbanMetisPanel.tsx",
             "$PWD/src/modules/kanban/KanbanMetisRow.tsx",
             "$PWD/src/modules/kanban/KanbanMetisConversation.tsx"],
 "exclude": []}
EOF
# `include` SKIPS a path it cannot match, so `tc=0` over a scaffold this phase never wrote is worth
# nothing — the three files below are the scaffold, and a gate that stays green while one is absent
# is the whole defect: each must turn up in the RESOLVED file list, or it counts missing.
tool=0
[ -x node_modules/.bin/tsc ] || tool=$((tool+1))
[ -x node_modules/.bin/oxlint ] || tool=$((tool+1))
tc=0; node_modules/.bin/tsc -p /tmp/sunset-tc-17-client.json || tc=$?
node_modules/.bin/tsc -p /tmp/sunset-tc-17-client.json --listFilesOnly > /tmp/sunset-tc-17-client.files 2>/dev/null || true
miss=0
for e in src/modules/kanban/KanbanMetisPanel.tsx src/modules/kanban/KanbanMetisRow.tsx \
         src/modules/kanban/KanbanMetisConversation.tsx; do
  n=$(grep -cxF "$PWD/$e" /tmp/sunset-tc-17-client.files || true)
  [ "${n:-0}" -gt 0 ] || { miss=$((miss+1)); echo "MISSING $e"; }
done
lint=$(node_modules/.bin/oxlint src/modules/kanban/KanbanMetisPanel.tsx \
    src/modules/kanban/KanbanMetisRow.tsx src/modules/kanban/KanbanMetisConversation.tsx \
    2>&1 | grep -c ' error ' || true)
printf 'tc=%s miss=%s lint=%s tool=%s\n' "$tc" "$miss" "$lint" "$tool"
'''
expect = "tc=0 miss=0 lint=0 tool=0"
timeout_s = 600

[[verify]]
cmd = "{ grep -c 'ChatComposer' src/modules/kanban/KanbanMetisConversation.tsx || true; }"
expect = "0"

[[verify]]
cmd = "{ grep -rc 'modules/chat/composer' src/modules/kanban/ || true; } | { grep -cv ':0$' || true; }"
expect = "0"
```

**Read first.** `src/modules/kanban/KanbanMetisPanel.tsx` and `KanbanMetisRow.tsx` as they stand,
`src/modules/chat/.../PromptInput.tsx` (the nine headless primitives — `cn`, `Button` and `Tooltip`
are its only imports), `SubagentTranscriptView.tsx:41-53` and its comment about the scroller, and
`docs/kanban.md` §"The pilot panel".

**What to build.** Composition for a fleet that is read while it moves. `ChatComposer` is 681 lines
of chat-session coupling and is never imported here; the composer is assembled from `PromptInput`'s
primitives, which Phase 16b has already moved to `@/shared/ui` so neither module deep-imports the
other. `SubagentTranscriptView` needs no move: chat's barrel already exports it
(`src/modules/chat/index.ts:16`) and the panel already imports it that way.

**Sirens.** You will want the transcript to take the whole panel — the operator asked to watch several
Metis at once, and a full-panel takeover is the pilot terminal by another name, which is out of scope.
You will want to enable the composer always and let the server explain; the 409 is measured and
structural, so the screen says it before the press.

## Phase 18 — Fill: the pilot panel's fleet, conversation and composer
Depends on: Phase 17

```toml
[phase]
id = "18"
builder = "hephaestus"
model = "opus"
kind = "fill"
scaffold_of = "17"
code_change = true
doc_sweep = "foreground"
expected_s = 2700
manifest = [
  "src/modules/kanban/KanbanMetisPanel.tsx",
  "src/modules/kanban/KanbanMetisConversation.tsx",
  "src/modules/kanban/hooks/useKanbanMetis.ts",
  "src/shared/api.ts",
]
forbidden = [
  "src/modules/kanban/KanbanMetisRow.tsx",
  "server/modules/kanban-metis",
]
athena = [
  "A reply is sent without disabling the composer, so a double press spawns two resumes of one session",
  "The 409 refusal is swallowed and the operator sees nothing happen",
  "The nudge button has no in-flight state, so it can be held down into a spawn storm",
  "useKanbanMetis re-seeds by REST on every frame instead of applying the frame it was sent",
  "The composition outside the markers moved — a state branch or a Verve import the scaffold drew is gone",
]

[[steps]]
kind = "edit"
path = "src/shared/api.ts"
what = "Add api.kanbanMetis.reply(sessionId, text) and api.kanbanMetis.nudge(boardId), beside the five entries already at :702-711."
check = "grep -c 'kanbanMetis' src/shared/api.ts | head -1"
expect_re = "^[1-9]"

[[steps]]
kind = "edit"
path = "src/modules/kanban/hooks/useKanbanMetis.ts"
what = "Add reply and nudge to the hook's writes, in the shape of launch/stop/resume: each answers with what the route returned so the row repaints without waiting for the frame, each holds its own in-flight flag in a ref, and a refusal is returned to the caller rather than thrown away."
check = "grep -c 'reply\\|nudge' src/modules/kanban/hooks/useKanbanMetis.ts"
expect_re = "^[2-9]"

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanMetisConversation.tsx"
what = "Fill every FILL: marker and remove the token: onSend replies and clears the draft only on success, sending disables the composer, onStop stops the session, transcriptTarget is { kind: 'metis', id: sessionId }. A 409 or any other refusal raises the banner the scaffold already drew."
check = "{ grep -c 'FILL:' src/modules/kanban/KanbanMetisConversation.tsx || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanMetisPanel.tsx"
what = "Fill every FILL: marker and remove the token: onNudge calls the hook's nudge for this board, nudging is its in-flight flag, dial is the board's live count against the driver reading the panel already fetches."
check = "{ grep -c 'FILL:' src/modules/kanban/KanbanMetisPanel.tsx || true; }"
expect = "0"

[[verify]]
cmd = '''
set -e
cat > /tmp/sunset-tc-18-client.json <<EOF
{"extends": "$PWD/tsconfig.json",
 "compilerOptions": {"noEmit": true, "typeRoots": ["$PWD/node_modules/@types"], "types": ["node"]},
 "include": ["$PWD/src/vite-env.d.ts",
             "$PWD/src/modules/kanban/KanbanMetisPanel.tsx",
             "$PWD/src/modules/kanban/KanbanMetisConversation.tsx",
             "$PWD/src/modules/kanban/hooks/useKanbanMetis.ts",
             "$PWD/src/shared/api.ts"],
 "exclude": []}
EOF
# `include` SKIPS a path it cannot match, so `tc=0` over a tree this phase never wrote is worth
# nothing: every file the manifest names must turn up in the RESOLVED file list, or it counts
# missing — the wiring is unbuilt exactly when the conversation is still absent.
tool=0
[ -x node_modules/.bin/tsc ] || tool=$((tool+1))
[ -x node_modules/.bin/oxlint ] || tool=$((tool+1))
tc=0; node_modules/.bin/tsc -p /tmp/sunset-tc-18-client.json || tc=$?
node_modules/.bin/tsc -p /tmp/sunset-tc-18-client.json --listFilesOnly > /tmp/sunset-tc-18-client.files 2>/dev/null || true
miss=0
for e in src/modules/kanban/KanbanMetisPanel.tsx src/modules/kanban/KanbanMetisConversation.tsx \
         src/modules/kanban/hooks/useKanbanMetis.ts src/shared/api.ts; do
  n=$(grep -cxF "$PWD/$e" /tmp/sunset-tc-18-client.files || true)
  [ "${n:-0}" -gt 0 ] || { miss=$((miss+1)); echo "MISSING $e"; }
done
lint=$(node_modules/.bin/oxlint src/modules/kanban/KanbanMetisPanel.tsx \
    src/modules/kanban/KanbanMetisConversation.tsx src/modules/kanban/hooks/useKanbanMetis.ts \
    src/shared/api.ts 2>&1 | grep -c ' error ' || true)
printf 'tc=%s miss=%s lint=%s tool=%s\n' "$tc" "$miss" "$lint" "$tool"
'''
expect = "tc=0 miss=0 lint=0 tool=0"
timeout_s = 600

[[verify]]
cmd = '''
set -e
K=$(grep -o "from '@/shared/ui'" ~/.cloudcli/sunset-scaffold/KanbanMetisConversation.tsx | wc -l)
N=$(grep -o "from '@/shared/ui'" src/modules/kanban/KanbanMetisConversation.tsx | wc -l)
M=$(grep -c 'mid-turn' src/modules/kanban/KanbanMetisConversation.tsx)
echo "UI-IMPORTS $([ "$K" = "$N" ] && echo held || echo moved) COPY $([ "$M" -ge 1 ] && echo held || echo gone)"
'''
expect = "UI-IMPORTS held COPY held"
timeout_s = 120
```

**Read first.** The two scaffolds and their copies under `~/.cloudcli/sunset-scaffold/` (a missing copy
means Phase 17 must be re-walked — report it, never rebuild it by hand), `useKanbanMetis.ts` as it stands (245 LOC — the frame is applied,
never re-seeded), and `src/shared/api.ts:702-711`.

**What to build.** Seven markers, two api entries, two hook writes.

**Sirens.** You will want to re-open the conversation after a reply so the operator sees the answer —
the transcript polls itself while the session runs (`TRANSCRIPT_POLL_MS` 2000) and re-mounting it
loses the scroll. You will want to nudge on every render of an idle board; it is a button.

## Phase 19 — Scaffold: the vitals strip and the lessons review list
Depends on: Phase 12

```toml
[phase]
id = "19"
builder = "iris"
model = "fable"
kind = "scaffold"
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "src/modules/kanban/KanbanVitalsStrip.tsx",
  "src/modules/kanban/KanbanBoardHeader.tsx",
  "src/modules/memory-intake/LessonReviewList.tsx",
  "src/modules/memory-intake/MemoryIntakePanel.tsx",
]
forbidden = [
  "src/modules/kanban/KanbanPanel.tsx",
  "src/modules/memory-intake/context/MemoryIntakeContext.tsx",
]
athena = [
  "The strip draws a zero as an em-dash or an em-dash as a zero, so unknown and none read the same",
  "The strip pushes the board switcher or the two switches off a narrow header instead of collapsing",
  "The lessons list is drawn as a third tab, changing the Memory tab's navigation rather than composing inside it",
  "A staged lesson's body is drawn in the list, so a 4000-character lesson fills the pane",
  "Approve and Reject are drawn without a state for the one that failed",
]

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanVitalsStrip.tsx"
what = "Compose the counts strip: six glyph-and-number registers in Descent's own vocabulary — ▶ building, ? awaiting answer, ✋ awaiting approve, 💡 lessons pending, ✎ memory pending, and the claimable count — each with a title naming it in words, a zero drawn as a calm zero and an unknown reading as an em-dash, and the whole strip collapsing to the two loudest registers under a narrow header. Markers: FILL: vitals, FILL: loading."
check = "grep -c 'FILL:' src/modules/kanban/KanbanVitalsStrip.tsx"
expect_re = "^[2-9]"

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanBoardHeader.tsx"
what = "Mount the strip as a new sibling between the board switcher (:108) and the ml-auto cluster (:126), taking one new prop, and nothing else in this header moves."
check = "grep -c 'KanbanVitalsStrip' src/modules/kanban/KanbanBoardHeader.tsx"
expect_re = "^[1-9]"

[[steps]]
kind = "edit"
path = "src/modules/memory-intake/LessonReviewList.tsx"
what = "Compose the lessons review list as a section that sits INSIDE the Memory tab's existing panel, under its own heading: one row per staged lesson (name, summary, trigger, its card when it has one), an expanded row showing the body, Approve and Reject per row, and every state — reading, none staged, a write in flight, a refusal. Markers: FILL: lessons, FILL: onApprove, FILL: onReject, FILL: busy."
check = "grep -c 'FILL:' src/modules/memory-intake/LessonReviewList.tsx"
expect_re = "^[4-9]"

[[steps]]
kind = "edit"
path = "src/modules/memory-intake/MemoryIntakePanel.tsx"
what = "Mount LessonReviewList beneath the memory queue inside the same panel — a second section, not a second tab and not a second provider."
check = "grep -c 'LessonReviewList' src/modules/memory-intake/MemoryIntakePanel.tsx"
expect_re = "^[1-9]"

[[steps]]
kind = "run"
cmd = "mkdir -p ~/.cloudcli/sunset-scaffold && cp src/modules/kanban/KanbanVitalsStrip.tsx src/modules/memory-intake/LessonReviewList.tsx ~/.cloudcli/sunset-scaffold/"
check = "test -f ~/.cloudcli/sunset-scaffold/KanbanVitalsStrip.tsx && echo SCAFFOLD-KEPT"
expect = "SCAFFOLD-KEPT"

[[verify]]
cmd = '''
set -e
cat > /tmp/sunset-tc-19-client.json <<EOF
{"extends": "$PWD/tsconfig.json",
 "compilerOptions": {"noEmit": true, "typeRoots": ["$PWD/node_modules/@types"], "types": ["node"]},
 "include": ["$PWD/src/vite-env.d.ts",
             "$PWD/src/modules/kanban/KanbanVitalsStrip.tsx",
             "$PWD/src/modules/kanban/KanbanBoardHeader.tsx",
             "$PWD/src/modules/memory-intake/LessonReviewList.tsx",
             "$PWD/src/modules/memory-intake/MemoryIntakePanel.tsx"],
 "exclude": []}
EOF
# `include` SKIPS a path it cannot match, so `tc=0` over a scaffold this phase never wrote is worth
# nothing: the strip and the review list are what this phase builds, and each must turn up in the
# RESOLVED file list, or it counts missing.
tool=0
[ -x node_modules/.bin/tsc ] || tool=$((tool+1))
[ -x node_modules/.bin/oxlint ] || tool=$((tool+1))
tc=0; node_modules/.bin/tsc -p /tmp/sunset-tc-19-client.json || tc=$?
node_modules/.bin/tsc -p /tmp/sunset-tc-19-client.json --listFilesOnly > /tmp/sunset-tc-19-client.files 2>/dev/null || true
miss=0
for e in src/modules/kanban/KanbanVitalsStrip.tsx src/modules/kanban/KanbanBoardHeader.tsx \
         src/modules/memory-intake/LessonReviewList.tsx \
         src/modules/memory-intake/MemoryIntakePanel.tsx; do
  n=$(grep -cxF "$PWD/$e" /tmp/sunset-tc-19-client.files || true)
  [ "${n:-0}" -gt 0 ] || { miss=$((miss+1)); echo "MISSING $e"; }
done
lint=$(node_modules/.bin/oxlint src/modules/kanban/KanbanVitalsStrip.tsx \
    src/modules/kanban/KanbanBoardHeader.tsx src/modules/memory-intake/LessonReviewList.tsx \
    src/modules/memory-intake/MemoryIntakePanel.tsx 2>&1 | grep -c ' error ' || true)
printf 'tc=%s miss=%s lint=%s tool=%s\n' "$tc" "$miss" "$lint" "$tool"
'''
expect = "tc=0 miss=0 lint=0 tool=0"
timeout_s = 600
```

**Read first.** `src/modules/kanban/KanbanBoardHeader.tsx:103-198` (the one flex row and its two
slots), `docs/memory-intake.md` §"What the panel says", `~/.claude/descent/vitals_status.py:41-47`
(the five glyphs and their vocabulary), and `docs/accounts.md` rule 2 — unknown is an em-dash, never
a zero.

**What to build.** Two new components and two mount lines. The vitals bar Descent shipped was a tmux
line with no consumer on this box; here it is the board header, which is where the operator is
already looking.

**Sirens.** You will want to give the lessons their own tab — the Memory tab is the review surface and
a second tab splits one habit in two. You will want to draw a zero as an em-dash so the strip looks
quiet; a zero is a reading and says so.

## Phase 20 — Fill: the vitals strip and the lessons review list
Depends on: Phase 19

```toml
[phase]
id = "20"
builder = "hephaestus"
model = "opus"
kind = "fill"
scaffold_of = "19"
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "src/modules/kanban/KanbanVitalsStrip.tsx",
  "src/modules/memory-intake/LessonReviewList.tsx",
  "src/modules/kanban/hooks/useKanbanLaneFeed.ts",
  "src/modules/memory-intake/hooks/useLessonReview.ts",
  "src/shared/api.ts",
]
forbidden = [
  "src/modules/kanban/KanbanBoardHeader.tsx",
  "src/modules/memory-intake/MemoryIntakePanel.tsx",
]
athena = [
  "The vitals are re-fetched on every kanban frame, so a busy board asks for them every two seconds",
  "The lessons list holds its own poller beside the memory provider's, doubling the Memory tab's traffic",
  "An approve that fails clears the row anyway, so the lesson disappears without being reviewed",
  "The strip shows a stale count after a card moves, because nothing re-reads it on a frame",
  "The composition outside the markers moved",
]

[[steps]]
kind = "edit"
path = "src/shared/api.ts"
what = "Add api.kanban.vitals(boardId) and the three lesson calls the review list needs: list staged, approve, reject."
check = "grep -c 'vitals' src/shared/api.ts"
expect_re = "^[1-9]"

[[steps]]
kind = "edit"
path = "src/modules/kanban/hooks/useKanbanLaneFeed.ts"
what = "Read the board's vitals beside the lane counts this hook already holds: once on board selection, and again on a kanban frame for this board — coalesced so a burst of frames costs one read — never on a timer of its own."
check = "grep -c 'vitals' src/modules/kanban/hooks/useKanbanLaneFeed.ts"
expect_re = "^[1-9]"

[[steps]]
kind = "edit"
path = "src/modules/memory-intake/hooks/useLessonReview.ts"
what = "Create the lessons review lifecycle in the shape of useMemoryReview: the staged list, the in-flight id, the held refusals, and a re-read in a finally after every outcome. It reads on mount and after a write, and holds no interval — the Memory tab's own provider is the only poller on this surface."
check = "grep -c 'export function useLessonReview' src/modules/memory-intake/hooks/useLessonReview.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/memory-intake/LessonReviewList.tsx"
what = "Fill every FILL: marker and remove the token: lessons from the hook, onApprove and onReject through it, busy from its in-flight id."
check = "{ grep -c 'FILL:' src/modules/memory-intake/LessonReviewList.tsx || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanVitalsStrip.tsx"
what = "Fill both markers and remove the token: vitals from the prop the header now passes, loading while the first reading is outstanding."
check = "{ grep -c 'FILL:' src/modules/kanban/KanbanVitalsStrip.tsx || true; }"
expect = "0"

[[verify]]
cmd = '''
set -e
cat > /tmp/sunset-tc-20-client.json <<EOF
{"extends": "$PWD/tsconfig.json",
 "compilerOptions": {"noEmit": true, "typeRoots": ["$PWD/node_modules/@types"], "types": ["node"]},
 "include": ["$PWD/src/vite-env.d.ts",
             "$PWD/src/modules/kanban/KanbanVitalsStrip.tsx",
             "$PWD/src/modules/memory-intake/LessonReviewList.tsx",
             "$PWD/src/modules/kanban/hooks/useKanbanLaneFeed.ts",
             "$PWD/src/modules/memory-intake/hooks/useLessonReview.ts",
             "$PWD/src/shared/api.ts"],
 "exclude": []}
EOF
# `include` SKIPS a path it cannot match, so `tc=0` over a tree this phase never wrote is worth
# nothing: both hooks and the review list are this phase's own, and each must turn up in the
# RESOLVED file list, or it counts missing.
tool=0
[ -x node_modules/.bin/tsc ] || tool=$((tool+1))
[ -x node_modules/.bin/oxlint ] || tool=$((tool+1))
tc=0; node_modules/.bin/tsc -p /tmp/sunset-tc-20-client.json || tc=$?
node_modules/.bin/tsc -p /tmp/sunset-tc-20-client.json --listFilesOnly > /tmp/sunset-tc-20-client.files 2>/dev/null || true
miss=0
for e in src/modules/kanban/KanbanVitalsStrip.tsx src/modules/memory-intake/LessonReviewList.tsx \
         src/modules/kanban/hooks/useKanbanLaneFeed.ts \
         src/modules/memory-intake/hooks/useLessonReview.ts src/shared/api.ts; do
  n=$(grep -cxF "$PWD/$e" /tmp/sunset-tc-20-client.files || true)
  [ "${n:-0}" -gt 0 ] || { miss=$((miss+1)); echo "MISSING $e"; }
done
lint=$(node_modules/.bin/oxlint src/modules/kanban/KanbanVitalsStrip.tsx \
    src/modules/memory-intake/LessonReviewList.tsx src/modules/kanban/hooks/useKanbanLaneFeed.ts \
    src/modules/memory-intake/hooks/useLessonReview.ts src/shared/api.ts \
    2>&1 | grep -c ' error ' || true)
printf 'tc=%s miss=%s lint=%s tool=%s\n' "$tc" "$miss" "$lint" "$tool"
'''
expect = "tc=0 miss=0 lint=0 tool=0"
timeout_s = 600

[[verify]]
cmd = "{ grep -c 'setInterval' src/modules/memory-intake/hooks/useLessonReview.ts src/modules/kanban/KanbanVitalsStrip.tsx || true; } | grep -cv ':0$'"
expect = "0"
```

**Read first.** `src/modules/memory-intake/hooks/useMemoryReview.ts` (the lifecycle this one copies),
`useKanbanLaneFeed.ts:40,87,240` (where counts arrive and how they are applied), and the two
scaffolds.

**What to build.** Six markers, one hook, one api group, one read folded into the feed the panel
already has.

**Sirens.** You will want to poll the vitals every few seconds — the board already gets a frame on
every write, and that frame is the signal. You will want to optimistically remove a reviewed lesson
from the list; re-read in a `finally` instead, the way the memory lane does, so a refusal leaves the
row where the reviewer can see it.

## Phase 21 — The gotchas pre-gate, out of Descent's tree
Depends on: none

```toml
[phase]
id = "21"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "/home/lyphe/.claude/hooks/gotchas_check.py",
  "/home/lyphe/.claude/hooks/gotchas_checks.py",
  "/home/lyphe/.claude/hooks/plan_runner/unblock_steps.py",
  "/home/lyphe/.claude/skills/prune/SKILL.md",
  "/home/lyphe/.claude/skills/heal/SKILL.md",
  "/home/lyphe/.claude/skills/inline/SKILL.md",
  "/home/lyphe/.claude/skills/dispatch/SKILL.md",
]
forbidden = [
  "/home/lyphe/.claude/descent/gotchas_check.py",
  "/home/lyphe/.claude/descent/gotchas_checks.py",
]
athena = [
  "A check whose target moved now FAILS rather than being retired, so the gate goes red for every caller",
  "The gate stops being fail-open: a check that throws propagates and breaks /prune, /heal, /inline and /dispatch at once",
  "A caller still shells to ~/.claude/descent/gotchas_check.py, so it breaks the moment that tree is deleted",
  "The tool-count check counts a different set than the brief's catalogue names, so it is green while the two disagree",
  "The copy in ~/.claude/descent was edited rather than left alone, breaking Project Constraint 5",
]

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/hooks/gotchas_check.py"
what = "Copy ~/.claude/descent/gotchas_check.py here unchanged in behaviour — the fail-open runner, one [STATUS] line per check, --json, exit 1 only on a proven breach — with its import of the checks module pointing at its new sibling. The Descent original is left untouched."
check = "python3 /home/lyphe/.claude/hooks/gotchas_check.py > /tmp/sunset-gotchas.txt 2>&1; { grep -c '^\\[' /tmp/sunset-gotchas.txt || true; }"
expect_re = "^[1-9]"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/hooks/gotchas_checks.py"
what = "Copy the checks here and re-aim them: keep every check whose target still exists outside ~/.claude/descent; RETIRE — delete, never comment out — every check whose subject is Descent's own source (descent_import_chain, innerhtml_single_sink at its ui/dom.js, and any check reading descent.db); and repoint mcp_tool_count_parity at the board — the kanban-pm tool count under server/modules/kanban-metis/mcp/ against the catalogue in server/modules/kanban-metis/brief/METIS.md. Each surviving check keeps its id and its one-line detail."
check = "{ grep -c 'descent' /home/lyphe/.claude/hooks/gotchas_checks.py || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/hooks/plan_runner/unblock_steps.py"
what = "Point _GOTCHAS_DEFAULT at ~/.claude/hooks/gotchas_check.py."
check = "{ grep -c 'descent/gotchas' /home/lyphe/.claude/hooks/plan_runner/unblock_steps.py || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/skills/prune/SKILL.md"
what = "Point every gotchas_check invocation in this skill at ~/.claude/hooks/gotchas_check.py, and do the same in heal/SKILL.md, inline/SKILL.md and dispatch/SKILL.md in this one step — four files, one substitution each, nothing else changed. The check names those four files rather than the whole of ~/.claude/skills/: this phase may write only its manifest, and a bare tree sweep would fail on a stale pointer in one of the fifty skills it cannot touch."
check = "{ grep -rc 'descent/gotchas_check' /home/lyphe/.claude/skills/prune/SKILL.md /home/lyphe/.claude/skills/heal/SKILL.md /home/lyphe/.claude/skills/inline/SKILL.md /home/lyphe/.claude/skills/dispatch/SKILL.md || true; } | { grep -cv ':0$' || true; }"
expect = "0"

[[verify]]
cmd = '''
set -e
python3 /home/lyphe/.claude/hooks/gotchas_check.py --json > /tmp/sunset-gotchas.json 2>/dev/null || true
python3 -c "
import json, pathlib
rows = json.loads(pathlib.Path('/tmp/sunset-gotchas.json').read_text())
rows = rows if isinstance(rows, list) else rows.get('checks', [])
named = sum(1 for r in rows if 'descent' in json.dumps(r).lower())
statused = sum(1 for r in rows if r.get('status'))
print('CHECKS', statused == len(rows) and len(rows) > 0, 'DESCENT-NAMED', named)
"
'''
expect = "CHECKS True DESCENT-NAMED 0"
timeout_s = 300

[[verify]]
# `--exclude-dir=__pycache__`: a `.pyc` is a build artifact, not a caller — it is rewritten the
# moment the module this phase edits is next imported, so a zero-expect sweep that reads it can
# never reach zero. Measured 2026-09-17: this sweep read 5, one of them
# `plan_runner/__pycache__/unblock_steps.cpython-312.pyc`; with the artifact excluded the four
# remaining files are exactly the four this phase's steps rewrite.
cmd = "{ grep -rln --exclude-dir=__pycache__ 'descent/gotchas_check' /home/lyphe/.claude/hooks /home/lyphe/.claude/skills /home/lyphe/.claude/commands 2>/dev/null || true; } | wc -l"
expect = "0"
```

**Read first.** `~/.claude/descent/gotchas_check.py:9-10,50-63` (informational, fail-open, never
blocking) and `gotchas_checks.py:446-456` (the eleven registered checks), plus the five call sites the
scout measured: `hooks/plan_runner/unblock_steps.py:63`, `skills/prune/SKILL.md:29,80,82`,
`skills/heal/SKILL.md:242`, `skills/inline/SKILL.md:38`, `skills/dispatch/SKILL.md:117`.

**What to build.** The gate, living where its callers live. It is the one lane whose consumers were
never Descent's own UI — five skills and the runner's unblock step all shell to it, and every one of
them breaks the day that tree is deleted.

**Sirens.** You will want to keep a Descent check "until the tree is gone" — a check whose subject is
about to be deleted is a red gate with a countdown; retire it now. You will want to make a real
breach block the caller; it never has, and four skills read its output as advice. And do NOT assert
the gate's exit code in a verify: it exits 1 on any proven breach anywhere in its eleven checks, so
an unrelated live breach would fail a phase that only moved the gate. The verify asserts the shape
the move is about — every surviving check reports a status, and no check names Descent.

## Phase 22 — The concurrency arbiter's presence ladder, repointed at the board
Depends on: none

```toml
[phase]
id = "22"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2700
manifest = [
  "/home/lyphe/.claude/hooks/concurrency_arbiter/presence.py",
  "/home/lyphe/.claude/hooks/concurrency_arbiter/presence_resolve.py",
  "/home/lyphe/.claude/hooks/concurrency_arbiter/selfcheck_presence.py",
  "/home/lyphe/.claude/hooks/concurrency_arbiter/selfcheck_presence_aware.py",
  "/home/lyphe/.claude/hooks/concurrency_arbiter/selfcheck_holder_intent.py",
]
forbidden = [
  "/home/lyphe/.claude/hooks/concurrency_arbiter/arbiter.py",
]
athena = [
  "The ladder now opens the board database on EVERY write instead of behind the same gate that made the Descent read rare",
  "The database is opened read-write, so a hook can lock the app's own database",
  "A missing database file raises instead of answering 'no presence', so every file write in every session starts failing",
  "The lease columns were renamed but the staleness rule was not carried, so a dead session's lease holds a file forever",
  "A self-check still fabricates Descent's schema, so it passes while the real reader queries columns that do not exist",
  "selfcheck_footprint_gate.py was repaired here instead of being left to the phase that deletes its subject",
]

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/hooks/concurrency_arbiter/presence_resolve.py"
what = "Repoint the default store from ~/.claude/descent/descent.db to CloudCLI's ~/.cloudcli/auth.db (env override kept, renamed to KANBAN_DB), and rewrite the pm-branch query against kanban_cards — build_owner, build_lease_at, plan_owner, plan_lease_at — with the board's own 40-second staleness rule (KANBAN_LEASE_STALE_SECONDS, server/shared/kanban-types.ts). Read-only (mode=ro), and a missing or unreadable database answers 'no presence' rather than raising."
check = "{ grep -c 'descent' /home/lyphe/.claude/hooks/concurrency_arbiter/presence_resolve.py || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/hooks/concurrency_arbiter/presence.py"
what = "Follow the rename through the ladder and its comments: the costly leg is now the board read, and it stays behind exactly the same gate that made the Descent read rare. No new call site, no widened gate."
check = "{ grep -c 'descent' /home/lyphe/.claude/hooks/concurrency_arbiter/presence.py || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/hooks/concurrency_arbiter/selfcheck_presence.py"
what = "Rebuild the fabricated fixture to the board's schema — a kanban_cards table with the four lease columns — in this file and in selfcheck_presence_aware.py and selfcheck_holder_intent.py, in this one step. Each must still fabricate its own database and touch nothing real. selfcheck_footprint_gate.py is deliberately NOT in this phase: its subject is the footprint guard, which Phase 23 deletes along with it. The check below names those three files rather than the whole directory, because a directory-wide zero-expect sweep here is unreachable by construction."
check = "{ grep -rc 'descent' /home/lyphe/.claude/hooks/concurrency_arbiter/selfcheck_presence.py /home/lyphe/.claude/hooks/concurrency_arbiter/selfcheck_presence_aware.py /home/lyphe/.claude/hooks/concurrency_arbiter/selfcheck_holder_intent.py || true; } | { grep -cv ':0$' || true; }"
expect = "0"

[[verify]]
cmd = '''
set -e
cd /home/lyphe/.claude/hooks/concurrency_arbiter
OK=0
for f in selfcheck_presence.py selfcheck_presence_aware.py selfcheck_holder_intent.py; do
  if python3 "$f" > /dev/null 2>&1; then OK=$((OK + 1)); fi
done
echo "SELFCHECKS $OK of 3"
'''
expect = "SELFCHECKS 3 of 3"
timeout_s = 300

[[verify]]
cmd = "python3 -c \"import sys; sys.path.insert(0, '/home/lyphe/.claude/hooks'); from concurrency_arbiter import presence_resolve as p; print('NO-RAISE', p is not None)\""
expect = "NO-RAISE True"
timeout_s = 120
```

**Read first.** `~/.claude/hooks/concurrency_arbiter/presence.py:13,140,151` and
`presence_resolve.py:28,52-54,174`, `docs/kanban.md` §"Ids, order and time" (the lease rule and the
40-second staleness), and `~/.claude/hooks/README.md` on the arbiter.

**What to build.** One default path, one query, four fabricated fixtures. This is the one Descent
coupling that is not Metis-scoped: it runs for EVERY session's file write, and it is the reason this
phase exists rather than a deletion.

**Sirens.** You will want to open the board database read-write because the hook module already has a
helper that does; a hook that can lock the app's database will, on the worst possible day. You will
want to widen the gate so the presence answer is always fresh — that leg is the ladder's only costly
one and the gate is why the arbiter is cheap.

## Phase 23 — The guard ladder healed: nine dead guards, eleven deletions, one trim
Depends on: Phase 22

```toml
[phase]
id = "23"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 3000
manifest = [
  "/home/lyphe/.claude/hooks/enforce_metis_contract.py",
  "/home/lyphe/.claude/hooks/pipeline_state.py",
  "/home/lyphe/.claude/hooks/metis_presence_bridge.py",
  "/home/lyphe/.claude/hooks/metis_footprint.py",
  "/home/lyphe/.claude/hooks/metis_footprint_symbols.py",
  "/home/lyphe/.claude/hooks/metis_keepflowing_caps.py",
  "/home/lyphe/.claude/hooks/metis_operator_gate.py",
  "/home/lyphe/.claude/hooks/metis_board_check.py",
  "/home/lyphe/.claude/hooks/metis_autonomy.py",
  "/home/lyphe/.claude/hooks/metis_stop_warnings.py",
  "/home/lyphe/.claude/hooks/metis_honesty.py",
  "/home/lyphe/.claude/hooks/metis_freshness.py",
  "/home/lyphe/.claude/hooks/metis_followup.py",
  "/home/lyphe/.claude/hooks/metis_followup_questions.py",
  "/home/lyphe/.claude/hooks/concurrency_arbiter/selfcheck_footprint_gate.py",
  "/home/lyphe/.claude/hooks/concurrency_arbiter/selfcheck_presence_aware.py",
  "/home/lyphe/.claude/hooks/concurrency_arbiter/holder_intent.py",
]
forbidden = [
  "/home/lyphe/.claude/hooks/metis_plan_lint.py",
  "/home/lyphe/.claude/hooks/metis_git_detect.py",
  "/home/lyphe/.claude/hooks/metis_sql_gate.py",
  "/home/lyphe/.claude/hooks/metis_session.py",
  "/home/lyphe/.claude/hooks/concurrency_arbiter/presence_resolve.py",
]
athena = [
  "metis_presence_bridge was deleted whole, taking the UserPromptSubmit trigger that stamps EVERY session's prompt and busy state with it",
  "A surviving module imported a deleted one at import time — pipeline_state.py and the two self-checks are the ones outside the ladder that reach in — so a live hook now throws on every event",
  "G1, G2, G5 or G10 lost a dispatch branch along with the deleted ones",
  "The file was emptied rather than deleted, leaving a dead module that still imports",
  "enforce_metis_contract.py still imports sqlite3 or names descent.db, so the deletion was cosmetic",
]

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/hooks/metis_presence_bridge.py"
what = "TRIM, never delete. Measured: side_effects() carries TWO triggers (:250-286) — (b) UserPromptSubmit → presence.note_prompt, which stamps the prompt excerpt and opens the turn for EVERY session in this house and has no Descent coupling whatever, and (a) PostToolUse mcp__descent-pm__set_status → note_claim/note_unclaim, which does. Keep (b) exactly as it is. Delete (a) with _SET_STATUS_TOOL, _set_status_errored, _overlap_awareness and the footprint parameter. Say in the docstring why the claim bind is gone: after Phase 22 the presence ladder resolves a holder from kanban_cards' own lease columns, so the binding is derived rather than stamped. If you find note_claim feeding something presence_resolve cannot derive, STOP and report the divergence. Two prose mentions of the deleted guard go with it — :116 (\"metis_footprint's SINGLE mode=ro seam\") and :244 (the `footprint` parameter's own account): re-point each clause at the module that owns that seam now, or delete the clause if the seam is gone. After this step the file names no deleted guard."
check = "{ grep -c 'descent-pm\\|_overlap_awareness\\|metis_footprint' /home/lyphe/.claude/hooks/metis_presence_bridge.py || true; }"
expect = "0"

[[steps]]
kind = "run"
cmd = "rm -f /home/lyphe/.claude/hooks/metis_footprint.py /home/lyphe/.claude/hooks/metis_footprint_symbols.py /home/lyphe/.claude/hooks/metis_board_check.py /home/lyphe/.claude/hooks/metis_autonomy.py /home/lyphe/.claude/hooks/metis_keepflowing_caps.py /home/lyphe/.claude/hooks/metis_operator_gate.py /home/lyphe/.claude/hooks/metis_stop_warnings.py /home/lyphe/.claude/hooks/metis_honesty.py /home/lyphe/.claude/hooks/metis_freshness.py /home/lyphe/.claude/hooks/metis_followup.py /home/lyphe/.claude/hooks/metis_followup_questions.py /home/lyphe/.claude/hooks/concurrency_arbiter/selfcheck_footprint_gate.py"
check = "ls /home/lyphe/.claude/hooks/metis_*.py | wc -l"
expect = "5"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/hooks/enforce_metis_contract.py"
what = "Delete every dispatch branch, import, constant and docstring line belonging to the nine deleted guards — G3, G4, G4b, G6, G7, G8, G9 and the P5/P6 Stop pair — and keep G1 (plan lint), G2 (git write), G5 (terminal prompt) and G10 (destructive SQL) working exactly as they do. The presence-bridge call at :681 survives, without its footprint argument. Healed means deleted: no commented-out branch, no 'formerly G4' line, no mention of descent-pm or descent.db anywhere in the file, and no line naming any of the eleven modules step 2 deletes — the import table at :62-71, the fail-open binds at :86-100 and every docstring above them goes, while `metis_plan_lint`, `metis_git_detect` and `metis_session` stay: they are the guards that remain."
check = "{ grep -c 'descent\\|metis_footprint\\|metis_board_check\\|metis_autonomy\\|metis_stop_warnings\\|metis_honesty\\|metis_freshness\\|metis_followup\\|metis_keepflowing_caps\\|metis_operator_gate' /home/lyphe/.claude/hooks/enforce_metis_contract.py || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/hooks/pipeline_state.py"
what = "Remove this module's fail-open import of metis_keepflowing_caps and the call site behind it — read that call site first: it is cap-state housekeeping for the G4b guard that no longer exists. If it turns out to do something this file needs for its OWN pipeline marker, STOP and report the divergence rather than inventing a replacement."
check = "{ grep -c 'metis_keepflowing_caps\\|metis_autonomy' /home/lyphe/.claude/hooks/pipeline_state.py || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/hooks/concurrency_arbiter/selfcheck_presence_aware.py"
what = "Repair the two self-check residues this deletion leaves, in the same phase that creates them: selfcheck_presence_aware.py:249's reference to the deleted set_status trigger (it now exercises the surviving UserPromptSubmit one), and holder_intent.py:47-49's 'drift-forbidden MIRROR' of metis_footprint._FOOTPRINT_LINE_RE — the source is gone, so the regex becomes holder_intent's own declaration and the comment says so instead of naming a file that does not exist."
check = "{ grep -rc 'metis_footprint\\|set_status' /home/lyphe/.claude/hooks/concurrency_arbiter/selfcheck_presence_aware.py /home/lyphe/.claude/hooks/concurrency_arbiter/holder_intent.py || true; } | { grep -cv ':0$' || true; }"
expect = "0"

[[steps]]
kind = "run"
cmd = "python3 -c \"import py_compile, glob; [py_compile.compile(f, doraise=True) for f in glob.glob('/home/lyphe/.claude/hooks/*.py') + glob.glob('/home/lyphe/.claude/hooks/concurrency_arbiter/*.py')]\""
check = "python3 -c \"import py_compile, glob; [py_compile.compile(f, doraise=True) for f in glob.glob('/home/lyphe/.claude/hooks/*.py') + glob.glob('/home/lyphe/.claude/hooks/concurrency_arbiter/*.py')]\" && echo COMPILES"
expect = "COMPILES"

[[verify]]
cmd = '''
cd /home/lyphe/.claude/hooks
PAYLOAD='{"session_id":"sunset-probe","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo hello"},"cwd":"/tmp"}'
if echo "$PAYLOAD" | python3 enforce_metis_contract.py > /tmp/sunset-guard.txt 2>&1; then echo "PLAIN-BASH allowed"; else echo "PLAIN-BASH blocked"; fi
'''
expect = "PLAIN-BASH allowed"

[[verify]]
cmd = '''
set -e
cd /home/lyphe/.claude/hooks/concurrency_arbiter
OK=0
for f in selfcheck_presence.py selfcheck_presence_aware.py selfcheck_holder_intent.py; do
  if python3 "$f" > /dev/null 2>&1; then OK=$((OK + 1)); fi
done
python3 -c "
import sys; sys.path.insert(0, '/home/lyphe/.claude/hooks')
import metis_presence_bridge as b
print('SELFCHECKS', $OK, 'PROMPT-TRIGGER', 'UserPromptSubmit' in open('/home/lyphe/.claude/hooks/metis_presence_bridge.py').read())
"
'''
expect = "SELFCHECKS 3 PROMPT-TRIGGER True"
timeout_s = 300

[[verify]]
# SCOPE, measured 2026-09-17. This verify used to sweep all of ~/.claude/hooks, ~/.claude/skills and
# ~/.claude/commands, and so read 51 FILES — never 0, whatever this phase did. The 51: 27
# `__pycache__/*.pyc` artifacts (rewritten on the next import of any module this phase edits), 15
# that this phase's own steps clean (11 of them deleted outright by step 2), 4 that are this phase's
# own FORBIDDEN files (metis_plan_lint.py:6, metis_sql_gate.py:31,39, metis_session.py:438,462,
# concurrency_arbiter/presence_resolve.py:11,52,58) and 5 that no phase of this run owns
# (concurrency_arbiter/db_config.py:15, concurrency_arbiter/selfcheck.py:480,
# auto_execute_plan.py:171,2112, outstanding_souls.py:161, commands/pm.md:328 — pm.md is Phase 24's
# and dies there). Every one of those 9 survivors is PROSE: a comment or docstring naming a module
# this phase deletes. None is an import, none is a call — read, not assumed. They stand
# deliberately: this phase may not write those files, and a gate a phase cannot satisfy is not a
# proof of its work. What it CAN assert is that the manifest files it leaves alive no longer name
# any of the nine, so those five are named here and nothing else is read.
cmd = "{ grep -rln 'metis_footprint\\|metis_board_check\\|metis_autonomy\\|metis_stop_warnings\\|metis_honesty\\|metis_freshness\\|metis_followup\\|metis_keepflowing_caps\\|metis_operator_gate' /home/lyphe/.claude/hooks/metis_presence_bridge.py /home/lyphe/.claude/hooks/pipeline_state.py /home/lyphe/.claude/hooks/enforce_metis_contract.py /home/lyphe/.claude/hooks/concurrency_arbiter/holder_intent.py /home/lyphe/.claude/hooks/concurrency_arbiter/selfcheck_presence_aware.py 2>/dev/null || true; } | wc -l"
expect = "0"
```

**Read first.** `~/.claude/hooks/enforce_metis_contract.py:14-23` (the guard table — each line names
its trigger and its store) and `:675-686` (the presence-bridge call),
`metis_presence_bridge.py:1-24,238-286` (the TWO triggers — read them before you touch this file),
`concurrency_arbiter/OPERATOR.md:416` (what the bridge wires), and `docs/kanban.md` §"Seclusion",
which already records which guards stand down for a board Metis and why.

**What to build.** Eleven deletions plus one self-check, one TRIM, one ladder rewritten around the
four guards that remain, one import removed from `pipeline_state.py`, and the two self-check residues
repaired here rather than left for a later reader.

**Why this phase depends on Phase 22.** The two phases were drawn independent and are not: Phase 22's
self-checks import modules this one deletes, and `holder_intent.py` mirrors a regex from one of them.
Phase 22 repoints the ladder's READ side first; this phase then removes the dead write side and
repairs what the removal touches.

**Sirens.** You will want to delete `metis_presence_bridge.py` with the rest — measured, its
`UserPromptSubmit` trigger stamps the prompt excerpt and the busy state for EVERY session in this
house, and deleting it would silently take the arbiter's interactive-intent source with it. You will
want to repoint the nine at the board instead of deleting them — that is rebuilding Descent's
autonomy enforcement on a board that already enforces the same things structurally. You will want to
leave a module in place "in case"; a hook nothing dispatches is a file the next reader must prove
dead.

## Phase 24 — `/pm` deleted, and every reference purged
Depends on: Phase 7, Phase 23

```toml
[phase]
id = "24"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2700
manifest = [
  "/home/lyphe/.claude/commands/pm.md",
  "/home/lyphe/.claude/settings.json",
  "/home/lyphe/.claude/commands/harmonia.md",
  "/home/lyphe/.claude/agents/harmonia.md",
  "/home/lyphe/.claude/hooks/metis_session.py",
  "/home/lyphe/.claude/hooks/enforce_planner_go.py",
  "/home/lyphe/.claude/hooks/enforce_intent_lock.py",
  "/home/lyphe/.claude/scripts/universe/registry.py",
  "server/modules/kanban-metis/brief/METIS.md",
]
forbidden = [
  "/home/lyphe/.claude/CLAUDE.md",
  "/home/lyphe/.claude/hooks/enforce_metis_contract.py",
]
athena = [
  "The board brief lost a rule that only lived in pm.md, because the diff was skimmed rather than read",
  "metis_session.py's board-cwd trigger was deleted along with the /pm ones, so no session is ever recognised as Metis again and G5 stops firing",
  "The two exemptions in enforce_planner_go and enforce_intent_lock were deleted as dead, though a board Metis still needs them",
  "Harmonia now names a tool that does not exist in the session she runs in, because the server word was changed in one file and not the other",
  "A settings.json hook matcher still fires on mcp__descent-pm__*, so a dead registration outlives the server it names",
  "pm.md was deleted before its residual rules were folded into the brief, and the deletion is the only record of what they were",
]

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/brief/METIS.md"
what = "Fold in what ~/.claude/commands/pm.md still carries and this brief does not. Diff the two files first (they are 847 and 884 lines and already 95% shared), and for every rule pm.md has that the brief lacks, either bring it across in the board's own vocabulary or leave it out deliberately — never by accident. The brief keeps its own launch story: the driver spawns her, nobody types a command."
check = "{ grep -c 'descent-pm\\|/pm session' server/modules/kanban-metis/brief/METIS.md || true; }"
expect = "0"

[[steps]]
kind = "run"
cmd = "rm -f /home/lyphe/.claude/commands/pm.md"
check = "test ! -e /home/lyphe/.claude/commands/pm.md && echo PM-GONE"
expect = "PM-GONE"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/hooks/metis_session.py"
what = "Keep exactly ONE create trigger — an event whose cwd is a board session under ~/.claude/kanban-metis/<boardId>/ (:246-247) — and delete the three that named /pm or mcp__descent-pm__ (:243, :244-245, :251), the _BOARD_MCP_PREFIX constant with them. is_metis_session and the marker keep their shape and their readers: G5, the SQL gate, the planner go-gate and the intent lock all still ask this question and still get a true answer for a board Metis. Two prose mentions of guards Phase 23 deleted go in the same pass — :438's 'mirrors how the keep-flowing nudge lives in `metis_autonomy`' and :462's 'mirrors `metis_honesty.honesty_verdict`': the mirror is the point, the module name is not, so keep what is mirrored and name no file that no longer exists."
check = "{ grep -c 'descent-pm\\|/pm' /home/lyphe/.claude/hooks/metis_session.py || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/hooks/enforce_planner_go.py"
what = "Keep the exemption and correct its words: a Metis session is exempt because she is unattended and her board flow already asked — she is no longer 'a /pm session'. The same one-line correction in enforce_intent_lock.py:1155-1158 in this step. Neither behaviour changes."
check = "{ grep -c '/pm' /home/lyphe/.claude/hooks/enforce_planner_go.py /home/lyphe/.claude/hooks/enforce_intent_lock.py || true; } | { grep -cv ':0$' || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/agents/harmonia.md"
what = "Swap the server word in her three verbs — create_feature, set_status, approve_feature — from mcp__descent-pm__ to mcp__kanban-pm__, in this file and in commands/harmonia.md in the same step. The tool names are identical by design; only the server word moves. Then state in her own file, in one line, WHERE those verbs work: she runs INLINE in the invoking session (commands/harmonia.md:5), so she reaches the board only from a session that holds the kanban-pm MCP — which today is a board Metis's session and nothing else. Measured 2026-09-17: ~/.claude.json carries no descent-pm entry either, so an ordinary session never held her old verbs; this swap changes where she works, not whether."
check = "{ grep -rc 'descent-pm' /home/lyphe/.claude/agents/harmonia.md /home/lyphe/.claude/commands/harmonia.md || true; } | { grep -cv ':0$' || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/settings.json"
what = "Purge the four hook matcher entries naming mcp__descent-pm__* (:175 set_status, :184 set_closing_remarks, :193 the seven-tool alternation, :294 set_status again). Each of them fires a guard this run deleted in Phase 23; a matcher on a tool name that can no longer be emitted is a dead registration, and healed means deleted. Every other entry in the file is untouched, and the file must still parse as JSON."
check = "{ grep -c 'descent-pm' /home/lyphe/.claude/settings.json || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/scripts/universe/registry.py"
what = "Drop 'descent-pm' from the claude node's mcp list at :52 and any Descent unit or service row beside it; the board's kanban-pm is what that node actually holds now."
check = "{ grep -c 'descent' /home/lyphe/.claude/scripts/universe/registry.py || true; }"
expect = "0"

[[verify]]
# `--exclude-dir=__pycache__`: a `.pyc` is a build artifact, not a reference — it is rewritten the
# moment the module it caches is next imported, so a zero-expect sweep that reads one can never
# reach zero. Measured 2026-09-17: this sweep read 18, seven of them `__pycache__/*.pyc`; with the
# artifacts excluded the eleven remaining files are each cleaned by one of this phase's steps or by
# the Phase 23 it depends on (enforce_metis_contract.py and metis_presence_bridge.py by G3-G9's
# removal, selfcheck_footprint_gate.py and metis_freshness.py by deletion, the other seven here).
cmd = "{ grep -rln --exclude-dir=__pycache__ 'descent-pm\\|commands/pm.md' /home/lyphe/.claude/hooks /home/lyphe/.claude/commands /home/lyphe/.claude/agents /home/lyphe/.claude/skills /home/lyphe/.claude/scripts /home/lyphe/.claude/settings.json 2>/dev/null || true; } | { grep -v 'GOTCHAS.md\\|README.md' || true; } | wc -l"
expect = "0"

[[verify]]
cmd = "python3 -c \"import json, pathlib; json.loads(pathlib.Path('/home/lyphe/.claude/settings.json').read_text()); print('SETTINGS-PARSES')\""
expect = "SETTINGS-PARSES"

[[verify]]
cmd = '''
set -e
python3 -c "
import sys; sys.path.insert(0, '/home/lyphe/.claude/hooks')
import metis_session as m
print('DOOR-OPEN', callable(m.is_metis_session), 'TRIGGERS', 'kanban-metis' in open('/home/lyphe/.claude/hooks/metis_session.py').read())
"
'''
expect = "DOOR-OPEN True TRIGGERS True"
timeout_s = 180
```

**Read first.** `~/.claude/commands/pm.md` in full and the board's `brief/METIS.md` in full — the
diff between them is this phase's first act, and it is the only moment the residual rules are still
readable. `~/.claude/hooks/metis_session.py:242-273` (the four triggers), `docs/kanban.md` §"The
brief" and §"Seclusion".

**What to build.** One deletion, one fold, five corrections, one dead registration purged. The marker
and `is_metis_session` SURVIVE
— a board Metis is still a Metis session, and four live readers depend on that answer.

**Sirens.** You will want to delete the two exemptions because a scout called them dead: they are not.
Their subject moved from a typed `/pm` to a board-issued identity, and the board-cwd trigger still
creates the marker. You will want to delete `pm.md` first and fold afterwards — fold first; once it is
gone the only copy of a rule it alone carried is in the reflog, and this run never reads git.

## Phase 25 — The documentation
Depends on: Phase 24

```toml
[phase]
id = "25"
builder = "prometheus"
model = "sonnet"
code_change = false
expected_s = 2400
manifest = [
  "docs/kanban.md",
  "docs/accounts.md",
  "docs/memory-intake.md",
  "docs/plan-runner.md",
  "docs/verification.md",
  "docs/applications.md",
  "/home/lyphe/.claude/hooks/README.md",
  "/home/lyphe/.claude/hooks/GOTCHAS.md",
]
forbidden = [
  "/home/lyphe/.claude/CLAUDE.md",
]
athena = [
  "A page still points at docs/descent-proxy.md, which no longer exists",
  "The hooks README still documents nine guards that were deleted",
  "docs/kanban.md gained a second home for the learning lanes instead of one section each",
  "The account switcher page still says its figures come from Descent",
  "A section describes what the plan intended rather than what the code does",
  "The lesson corpus is documented twice — the store in kanban.md and again in memory-intake.md — instead of once with a cross-reference",
]

[[steps]]
kind = "edit"
path = "docs/kanban.md"
what = "Carry the board's new lanes into the one home they have: the two learning tables and their routes, the attachment bytes and where they live, the vitals strip, the nudge, the relaunch ledger and the rate-limit hold, session telemetry and the card's four counters, the reply channel and the dial that caps a board's sessions, the cross-board read and what it deliberately does not grant. Every claim is read from the shipped code, never from this plan."
check = "grep -c 'kanban_lessons\\|attachment\\|vitals\\|nudge\\|reply' docs/kanban.md"
expect_re = "^[5-9]"

[[steps]]
kind = "edit"
path = "docs/accounts.md"
what = "Rewrite the server half: the switcher and the meters are CloudCLI's own module now, the slots live under ~/.cloudcli/accounts, usage comes straight from the vendor, and the nine rules worth keeping from the deleted docs/descent-proxy.md are restated here in their new home. Every pointer to that page, in this file and in every other, goes."
check = "{ grep -c 'descent-proxy' docs/accounts.md || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/hooks/README.md"
what = "Correct the guard catalogue to the four guards that remain, the one create trigger metis_session keeps, the arbiter's repointed presence ladder, and the gotchas gate's new home — and remove the line naming ~/.claude/commands/pm.md as the brain these guards enforce. The same correction pass over GOTCHAS.md's Descent entries: a scar whose subject is gone is deleted, not annotated."
check = "{ grep -c 'commands/pm.md' /home/lyphe/.claude/hooks/README.md || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "docs/plan-runner.md"
what = "Document the two lanes this module gained: the plan-archive sweep (its four clauses, its settle-then-daily cadence, the held-paths parameter and why the board hands them in rather than the sweep reading rows) and the plan-cost read (what it reads, that every row it sums is already priced, and the 20-second cache). Constraint 13 makes this their one home."
check = "grep -c 'archive\\|plan cost\\|planCost' docs/plan-runner.md"
expect_re = "^[2-9]"

[[steps]]
kind = "edit"
path = "docs/memory-intake.md"
what = "Rewrite the server half: the tab is served by server/modules/memory-intake/ at /api/memory behind authenticateToken, not by a proxy; the envelope, the five calls and the sessionId provenance are unchanged; the five write targets and their caps live here. Add the lesson REVIEW surface — the list inside this tab, its two verbs — with ONE cross-reference to docs/kanban.md, which documents the lesson STORE. Never both. This file carries four pointers to the deleted descent-proxy.md (:16, :153, :203, :212 — each a relative link or a bare name); all four go here, because this step is the file's owner and Phase 25's first verify is a docs-wide zero that no later step can reach past."
check = "grep -c 'modules/memory-intake\\|/api/memory' docs/memory-intake.md"
expect_re = "^[2-9]"

[[steps]]
kind = "edit"
path = "docs/applications.md"
what = "Remove the Descent tile from the application registry's documented seed and say in one line that the host's own apps.local.json entry went with it."
check = "{ grep -ci 'descent' docs/applications.md || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "docs/verification.md"
what = "Record scripts/sunset-probe.sh as the harness this work is proven with: the scratch database, the disarmed boards, the scratch state and attachment roots, and the rule that no probe ever touches the live ones. This file also carries two pointers to the page this run deletes — :246 (the memory lane's narrative) and :379 (the phase-20 narrative), each the trailing sentence 'Its contract is at [descent-proxy.md](descent-proxy.md).' Re-point each at the page that holds that contract now (docs/accounts.md for the accounts and usage surface, docs/memory-intake.md for the memory lane), or drop the sentence where its narrative no longer needs it: a link to a deleted page is a dead pointer, not history. Measured 2026-09-17, these two are the last descent-proxy mentions outside docs/plans/ once this phase's other steps land."
check = "grep -c 'sunset-probe' docs/verification.md"
expect_re = "^[1-9]"

[[verify]]
cmd = "{ grep -rln 'Descent proxy\\|/api/descent\\|descent-proxy' docs/ 2>/dev/null || true; } | { grep -v 'docs/plans/' || true; } | wc -l"
expect = "0"

[[verify]]
cmd = "test -f docs/kanban.md && test -f docs/accounts.md && test ! -f docs/descent-proxy.md && echo DOCS-CONSISTENT"
expect = "DOCS-CONSISTENT"
```

**Read first.** The shipped code of every phase above, `docs/kanban.md` as it stands, and the two
pages whose server half moved (`docs/accounts.md`, `docs/memory-intake.md`).

**What to build.** Prose only. One home per lane, and every lane this run shipped has one:
`docs/kanban.md`, `docs/accounts.md`, `docs/memory-intake.md`, `docs/plan-runner.md`,
`docs/applications.md`, the hooks README and GOTCHAS. Nothing new is created.

**What this phase may NOT do.** It does not edit `/home/lyphe/.claude/CLAUDE.md`. That is not a preference:
`enforce_shelf_channel.py` and `shelf_channel_bash.py` refuse an Edit, Write or Bash write that could
add a line to that file, from any session and any soul — measured 2026-09-17, and this plan's own
author was blocked by it while writing. The two lines the run makes stale are named, with their exact
replacement text, in Exclusions; the report is what hands them over.

**Sirens.** You will want to write what this plan says; write what the code does — where they differ,
the code is right and the difference is worth a line in your report.

## Phase 26 — Descent stopped, and the tile removed
Depends on: Phase 9, Phase 24

```toml
[phase]
id = "26"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "server/modules/apps/apps.seed.ts",
  "server/modules/apps/apps.service.ts",
  "src/modules/app-switcher/utils/resolveAppUrl.ts",
  "apps.local.json",
]
forbidden = [
  "server/modules/kanban",
  "server/modules/kanban-metis",
]
athena = [
  "A unit was stopped but not disabled, so systemd's Restart=always brings it straight back",
  "The tmux watchdog timer was left armed, so it restarts descent-pm-tmux within the minute",
  "The app tile is gone from the seed but still in apps.local.json, so the dead tile survives on this host",
  "Something in CloudCLI still calls 127.0.0.1:7878 and now fails silently",
  "A file under ~/.claude/descent was edited or deleted, against Project Constraint 5",
]

[[steps]]
kind = "edit"
path = "server/modules/apps/apps.seed.ts"
what = "Remove the Descent entry at :21 from the seed and the order sentence above it (:17-18, '`descent` first because it is where the operator starts' — false the moment the row goes), the {host}:7878 template from src/modules/app-switcher/utils/resolveAppUrl.ts:16, the URL example at server/modules/apps/apps.service.ts:70 and the `descent-2` example at :36, in this one step. Where an example is load-bearing, re-point it at a surviving entry (dispatch, eis-app) rather than leaving a hole. apps.service.ts is in this phase's manifest because verify 3 below reads the whole of server/ and src/ and that file is the third and last place the dead tile's URL is written down. Healed means deleted."
check = "{ grep -rc '7878\\|descent' server/modules/apps/apps.seed.ts server/modules/apps/apps.service.ts src/modules/app-switcher/utils/resolveAppUrl.ts || true; } | { grep -cv ':0$' || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "apps.local.json"
what = "Remove the descent entry from this host's own registry if it carries one, leaving every other entry and the file's shape untouched. It is gitignored and private to this machine, which is why the seed change alone does not clear it."
check = "python3 -c \"import json, pathlib; p = pathlib.Path('apps.local.json'); d = json.loads(p.read_text()) if p.exists() else {}; print(json.dumps(d).count('descent'))\""
expect = "0"

[[steps]]
kind = "run"
cmd = "sudo -n systemctl disable --now descent-pm-tmux-watchdog.timer && sudo -n systemctl disable descent-pm-tmux-watchdog.service && sudo -n systemctl disable --now descent-pm-tmux.service && sudo -n systemctl disable --now descent.service"
check = "systemctl is-active descent.service descent-pm-tmux.service descent-pm-tmux-watchdog.timer 2>/dev/null | sort -u | tr '\\n' ' '"
expect = "inactive"

[[verify]]
cmd = "sleep 70; { ss -lntp 2>/dev/null | grep -c ':7878' || true; }"
expect = "0"
timeout_s = 300

[[verify]]
cmd = '''
set -e
source scripts/sunset-probe.sh
trap stop_probe_server EXIT
probe_db
boot_probe_server
TOK=$(mint_token)
H="Authorization: Bearer $TOK"
B=http://127.0.0.1:7893
BOARD=$(curl -sf -H "$H" "$B/api/kanban/boards" | python3 -c "import sys,json; print(json.load(sys.stdin)['boards'][0]['id'])")
A=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" "$B/api/accounts")
U=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" "$B/api/usage")
L=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" "$B/api/kanban/lessons")
M=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" "$B/api/kanban/memory")
V=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" "$B/api/kanban/boards/$BOARD/vitals")
S=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" "$B/api/kanban-metis/sessions")
echo "$A $U $L $M $V $S"
'''
expect = "200 200 200 200 200 200"
timeout_s = 600

[[verify]]
cmd = "{ grep -rln '127.0.0.1:7878\\|{host}:7878' server/ src/ 2>/dev/null || true; } | wc -l"
expect = "0"
```

**Read first.** The four unit files under `~/.claude/descent/` (`descent.service`,
`descent-pm-tmux.service`, `descent-pm-tmux-watchdog.service`, `.timer`) and the measured facts
behind the order below.

**What to build.** Two code removals, one host registry edit, four units disabled. All four units are
SYSTEM-scoped (`/etc/systemd/system/`), `systemctl --user` does not work on this box, and `sudo -n`
does — measured 2026-09-17. The ORDER is load-bearing: the watchdog timer first (it fires every 60
seconds and restarts `descent-pm-tmux`), then the tmux unit, then the server — and `disable --now`
rather than `stop`, because both services carry `Restart=always` and a bare stop self-heals. The
70-second sleep in the first verify is one full watchdog period: a port that is still dark after it
is a port nothing is reviving.

**Sirens.** You will want to `systemctl stop` because it is gentler — it is also undone by systemd
within seconds. You will want to remove `~/.claude/descent/` now that nothing runs: it is not in this
plan and Project Constraint 5 forbids it — the tree stays on disk, inert, for the operator to remove
when they are ready. You will want to `sudo systemctl mask` for good measure; disable is reversible
with one command and mask is the kind of thing nobody remembers doing.

**Left standing, deliberately.** `src/modules/app-switcher/AppDrawerRow.tsx:15` names `descent` in a
comment as an example of a row label ("a row that says `descent` is more useful to its reader than a
row that says…") — an illustration of how to label, not a registration of the app. The sentence
reads the same with the tile gone, this phase does not own that file, and verify 3 measures the dead
URL, not the word. Measured 2026-09-17: it is the only `descent` mention left in `server/` or `src/`
outside this phase's three files.

## Goal

*Goal: nothing CloudCLI's board, its Metis, or the operator's daily loop needs still lives in
Descent, and Descent's four systemd units are stopped and disabled with every CloudCLI surface still
answering. Verify by: Phase 26's last three verify entries — `:7878` dark after a full watchdog
period, six lanes answering 200 on a probe server that never touches the live database, and no
reference to `127.0.0.1:7878` left in `server/` or `src/`.*

The Goal's own line is re-run once, at the end, by that phase. No earlier phase gates on it.

## Waves

**A wave here is an ORDERING, not a concurrency grant.** Every phase's own `Depends on:` line is what
the runner reads; this table is the shape those lines make.

Wave 1: Phase 1, Phase 8, Phase 10, Phase 13, Phase 21, Phase 22 — nothing earlier constrains them
Wave 2: Phase 2, Phase 3, Phase 5, Phase 11, Phase 14, Phase 23 — over Wave 1's tables, store or ladder
Wave 3: Phase 4, Phase 6, Phase 7, Phase 9, Phase 12 — routes and imports over Wave 2's services
Wave 4: Phase 15, Phase 16b, Phase 17, Phase 19 — the composer kit's move, then the three scaffolds
Wave 5: Phase 16, Phase 18, Phase 20 — each fill completes its own scaffold
Wave 6: Phase 24 — the purge, after the MCP surface and the guard ladder
Wave 7: Phase 25, then Phase 26 — the documentation, then the sunset

**No wave here is splittable as drawn, and the reason is measurable rather than stylistic.** Three
files are written by phases in more than one wave and by more than one phase within a wave:
`src/shared/api.ts` (Phases 4, 9, 10, 12, 14, 16, 18, 20), `server/index.ts` (Phases 3, 9, 12, 13) and
`server/modules/kanban-metis/kanban-metis.routes.ts` (Phases 2, 5, 10, 14). Handing two sessions the
same file is what §8 of the doctrine forbids, doc sweeps aside. Phase 23 also depends on Phase 22 —
its deletions land in the ladder Phase 22 repoints — so even the first wave is an order, not a set.
This plan is therefore ONE file, walked in written order.

## Decisions already made, with their reversals

1. **The memory-intake lane transfers with the lessons.** The operator named lessons; the Memory tab
   is fed by the same proxy that feeds accounts, and sunsetting Descent under it would leave a live
   workspace tab reading a dead port (`docs/memory-intake.md`, `docs/descent-proxy.md` §Consumers).
   Both halves of the learning substrate move together. *Reversal:* keep `server/modules/descent/`'s
   memory half and its four routes, and Descent stays up for that lane alone.
2. **The corpus lives in CloudCLI's own database, not in a file of its own.** `~/.cloudcli/auth.db`
   already holds the board; a second store would need a second backup, a second migration path and a
   second answer to "where is this". The deciding evidence for "make sure its gitignored" is
   `server/load-env.ts:43-46`: `DATABASE_PATH` defaults to `~/.cloudcli/auth.db`, **outside the work
   tree by construction** — not a `.gitignore` line over a path the server never opens. Phase 1's
   second verify resolves it the way the server does and proves it. *Reversal:* a
   `KANBAN_LEARNING_DB` pointing at a separate file; the repository layer is the only thing that
   would change.
2b. **The memory-intake lane is its own module, and its table loses the `kanban_` prefix.** A
   candidate has no board, no card, no lane and no `board_id`; its write targets are `RULES.md`,
   `REQUIREMENTS.md`, `CLAUDE.md` and a project's `memory/` directory; its reader polls and has never
   consumed a board frame; its wire types already live in `server/shared/types.ts`. The only thing it
   borrowed from the board was the sqlite file, which belongs to `modules/database`. So it is born as
   `server/modules/memory-intake/` with its own schema file, its own `mc-` counter and its own routes
   at `/api/memory` behind `authenticateToken` — never on the kanban router, which is mounted a
   second time for the MCP child and would otherwise have given an unattended session a path to
   `CLAUDE.md`. The table is named `memory_candidates` in the same phase that creates it, because a
   `kanban_` prefix on a table the board cannot see is the same lie as a `Descent*` type name.
   *Reversal:* the module folds back under the board with one import change and one rename — but the
   guard refusal then has to grow a `/memory` clause, which is the thing this placement makes
   structural.
3. **Attachments store BYTES, not references.** A reference to `~/.claude/descent/attachments/…`
   dies the day the operator deletes that tree, which is the day this plan is for. 27 files, 9.4 MB,
   copied once by the importer into `~/.cloudcli/kanban-attachments/<cardId>/<attachmentId>.<ext>` —
   Descent's own naming, so the import is a 1:1 copy. *Reversal:* `KANBAN_ATTACHMENTS_ROOT` points
   anywhere, including back at Descent's tree.
4. **A reply is a resume carrying the operator's words, and it is refused while she is running.**
   Measured: a Metis child's stdin is closed the instant she is spawned
   (`metis-spawn.service.ts:264-265`), and none of the three live-injection mechanisms in this
   repository — the runtime's in-process stream, the SDK's cold resume, the keepalive session host —
   can reach a child that `child_process.spawn` started outside their registries. So the honest
   channel is the one `resume()` already uses. *Reversal:* the 409 becomes a queue — the reply is
   held in the session record and delivered as the opening turn of the next resume — if the operator
   would rather wait than stop her.
5. **The dial gets a home, and all three spawn paths honour it.** Measured: the driver is
   constructed with no `concurrency` (`kanban-metis.module.ts:126`), so it falls to
   `DEFAULT_CONCURRENCY` 1 and its own comment says the board "has no such column" — there is no env
   var, no column and no route that moves it, so merely replacing the launch refusal with
   `live >= dial` would have shipped today's behaviour under a new name. Phase 14 adds
   `kanban_boards.concurrency` beside `autonomy` and `deepseek_flash`, read at call time, clamped
   `[0, CONCURRENCY_MAX]`, and `canSpawn({ live, dial })` is asked by `launch`, `resume` AND `reply`
   — the fence exists on all three paths today and none of them loses it. The shared cwd the old
   refusal protected is deliberately kept (nothing per-session is written there, and a per-session
   cwd would break `kanban_metis.py`'s `board_id()`). *Reversal:* set a board's `concurrency` to 1
   and the old behaviour is back, per board, without a code change.
6. **Cross-board Metis is a READ here.** Her cwd is `~/.claude/kanban-metis/<boardId>/` and her one
   `--add-dir` is derived from that board's project, so a card claimed from another board would be
   built in the wrong directory. `list_features_all` shows her the estate; the claim stays hers.
   *Reversal:* give the MCP child a board argument per call and let the driver spawn her with every
   board's project directory — a different design, not a flag.
7. **The vitals bar becomes a board header strip, not a tmux line.** Measured: `vitals_status.py`
   has no consumer on this box — nothing in `~/.tmux.conf`, no hook, no skill, no UI reads
   `/api/vitals`. The numbers are worth carrying; the delivery was not. *Reversal:* the counts route
   stands alone, so a shell line over it is a few lines whenever it is wanted.
8. **The plan-archive sweep shells to `auto_execute_plan.py` for the unshipped-phase count.** That
   function is the runner's own reading of a plan and changes when the plan format does; a TypeScript
   copy would answer differently from the thing that walks the file. *Reversal:* port the two regexes
   if the hooks directory ever moves away from this box.
9. **The gotchas pre-gate moves to `~/.claude/hooks/` rather than into CloudCLI.** Its five callers
   are skills and the runner's unblock step, none of which is CloudCLI; it lives where its callers
   live. Its three Descent-subject checks are retired, and the tool-count check is repointed at the
   board's own MCP surface. *Reversal:* a thin wrapper left at the old path would restore the old
   invocation, at the cost of the pointer this plan exists to remove.
10. **The nine Descent-coupled hook guards are deleted, not repointed** (twelve modules, once the
    three helpers only they import go with them). `docs/kanban.md` §Seclusion
    already stands every one of them down for a board Metis, and after this plan every Metis is a
    board Metis. G1, G2, G5 and G10 carry no Descent coupling and stay. *Reversal:* they are one
    `git checkout` away for the operator at any later checkpoint, which is a decision this run never
    makes for them.
11. **The account store keeps its active slug in a file beside the slots, not in sqlite.** Descent
    used `ov_settings`; here the whole account lane is file-based, and one environment variable
    (`CLOUDCLI_ACCOUNTS_ROOT`) then redirects all of it for a probe. *Reversal:* a settings row, at
    the cost of a second home for one string.
12. **`~/.claude/descent/` is left on disk, inert.** Stopping the units is reversible with one
    command; deleting 449 cards' worth of history is not, and it is not this plan's to do.

## Edge cases and their endings

- **A spill file arrives while the sweep is mid-pass** → only `.json` is read, and the commands write
  `.json.tmp` then rename; a `.tmp` is skipped and read on the next pass.
- **A spill file fails validation** → moved to a `failed/` sibling with its reason beside it, never
  deleted and never re-read forever.
- **An approved memory breaches its cap** → `MemoryRefusal`, the row stays `pending`, the refusal text
  is recorded, and nothing on disk is touched. Never truncate.
- **A Descent lesson names a feature this board never imported** → the lesson lands with a NULL
  `card_id`. Never a dropped row.
- **An attachment row whose file is missing** → the download answers 404 and the row stays; the
  importer records the miss and carries on.
- **An upload over 8 MB or outside the mime allowlist** → 413 and 422 respectively, refused before a
  byte is written.
- **A reply to a running session** → 409, with the words the composer already shows.
- **A board at its dial** → both Launch and the driver refuse the same way, naming the dial and its
  value.
- **The vendor's usage endpoint is slow or down** → the last good reading, marked degraded, with its
  age; never an empty meter and never a 5xx.
- **`~/.claude/.credentials.json` unreadable** → `{ reachable: false, reason }` on a 200; the panel
  draws em-dashes, exactly as it does today.
- **A plan file cold, shipped, and holding a live lease** → held, not archived, with the lease named
  in `held`.
- **A unit that refuses to disable** → the phase blocks with the systemctl error verbatim; nothing
  else in the phase is attempted, and Descent is left running.
- **`sudo -n` stops working between now and the run** → Phase 26's third step fails and the phase
  files `[BLOCKED]` with the systemctl error verbatim. Nothing else regresses: every other phase has
  already shipped and CloudCLI no longer reads `:7878`. What remains is named in the report.

## Exclusions — named, not deferred into a step

- **Notifications.** `ov_notifications` (464 rows), `notifications_*.py`, the board bell. The operator
  said ntfy covers it, and CloudCLI already has that lane (`docs/notifications.md`).
- **The pilot terminal.** `pm_pty.py`, `pm_tmux*.py`, `pm_screen.py`, `pm_ansi.py`,
  `pm_image_sweep.py`, `pm_image_refs.py`, phone driving, the image-preview pipeline over a running
  session's transcript. The operator said skip; the conversation view in Phase 17 is a transcript and
  a composer, not a terminal.
- **Descent's own web UI.** `descent/ui/`, the SSE stream, `server_sse.py`, the canvas sky and
  `server_api_weather.py` — CloudCLI has its own front end and its own weather.
- **`process_health*.py`, `restart_watch.py`, `remarks_face.py`, `pm_orphan_sweep.py`,
  `pm_log_archive.py`, `pm_join_snapshot.py`, `pm_subscribers.py`** — all serve Descent's own process
  model (tmux panes, its devserver, its session registry), which CloudCLI does not have.
- **`pm_relaunch_resume.py`'s confident-link heuristic** — it links a stale orphan to a dead tmux
  pane by board label. There are no tmux panes here; the board's registry already knows which session
  held which card, so the ledger ported in Phase 10 is the whole of what survives.
- **The relaunch's Slack POST** (`pm_relaunch_events.py:59-63`) — an outward send to a URL only the
  operator holds, and ntfy is the channel now.
- **`ov_session_usage`'s 239 historical rows** — per-Descent-session token spend keyed on session ids
  this board never had. The table is ported; its history is not, and no card's counters are
  back-filled from it.
- **Deleting `~/.claude/descent/`** — the operator's act, after this plan verifies. One command:
  `rm -rf ~/.claude/descent`. Nothing in CloudCLI will read it after Phase 26; the 9.4 MB of
  attachments it holds are copied by Phase 6 first.
- **Editing `~/.claude/CLAUDE.md`** — excluded because the HARNESS refuses it, not because the plan
  prefers to leave it: `~/.claude/hooks/enforce_shelf_channel.py` and its shell door
  `shelf_channel_bash.py` block any Edit, Write or Bash write that could add a line to that file,
  from any session and any soul (measured 2026-09-17 — this plan's author was blocked by it
  mid-authoring; a removal-only edit passes, a correction does not). So the run cannot fix it, and
  "leave it better than you found it" is served by handing over the exact edit instead. The section
  `## Descent — personal project-command-center` is stale in full once Phase 26 lands. What it says
  today:

  > A personal Kanban board for running the user's own software with an AI builder in
  > the loop, self-contained under `~/.claude/descent/`. Reach it at
  > `http://100.103.222.79:7878`. Full docs: `~/.claude/descent/README.md` +
  > `~/.claude/descent/GOTCHAS.md`; the authoritative `/pm` doctrine is
  > `~/.claude/commands/pm.md`.

  What it should say after this run:

  > A personal Kanban board for running the user's own software with an AI builder in
  > the loop, inside CloudCLI at `~/.claude/claudecodeui_lyphe`. Reach it on the
  > Kanban tab of the app. Full docs: `docs/kanban.md`; the authoritative Metis
  > doctrine is `server/modules/kanban-metis/brief/METIS.md`, which is the only `/pm`
  > there is — the board's driver launches her with it.

  The heading itself wants `## The Kanban board — personal project-command-center`. The one channel
  that CAN write that file is the memory lane this run builds (`target: claude`), which a person
  approves; the plan neither stages it nor waits for it.
- **Registering `kanban-pm` for ordinary operator sessions** — measured 2026-09-17: `~/.claude.json`
  carries no `descent-pm` entry either, so an ordinary session never held the board's tools; Descent
  reached a `/pm` session only through the inline `--mcp-config` its launcher composed. Harmonia
  therefore works where she always worked — inside the session that holds the board MCP, which after
  this run is a board Metis's. Giving an operator session the same tools needs a board id from
  `current_board` and a user JWT as the child's credential; it is a design of its own and is not in
  this plan.
- **Descent's `/api/vitals` as a shell status line** — see Decision 7.
- **Re-authoring `~/.claude/commands/execute.md`, the runner, or the plan format** — untouched.

## Doctrine citations

- `~/.claude/charters/odysseus/DOCTRINE.md` §9 (git is never a phase, a gate or a boundary — no phase
  here commits, and no check reads git state), §10 (the operator is never an actor — the one act only
  they can perform, deleting Descent's tree, is excluded above rather than written as a step).
- The operator's standing rules: no unit tests, no branches, healed means deleted, root cause before
  fix, verify before answering, a plan never involves the operator.
- `AGENTS.md` → `.agents/skills/backend-module-standards/SKILL.md` for everything under `server/`
  (barrels, thin routes, shared types, no module-local `types.ts`), and
  `.agents/skills/frontend-module-standards/SKILL.md` for everything under `src/` — with their test
  clauses overridden by Project Constraint 1.
- `docs/kanban.md` §"The one write seam" (every board write goes through `writeKanban`), §"Ids, order
  and time" (minted ids, ISO-8601 UTC seconds, the 40-second lease staleness), §"Seclusion" (which
  hook guards stand down for a board Metis and why), §"A board's Metis, launched" (the argv, the
  derived lease owner, the opening turn on stdin).
- `docs/descent-proxy.md` rules 1, 2, 3, 5 and 7 — the null discipline, the calm 200, the severity
  floor and the single origin — carried into Phase 9 and then into `docs/accounts.md` as that page is
  deleted.
- Descent's own `GOTCHAS.md` #28 (the current-board lens) and #253 (the memory fence has no agent
  seam) — both honoured here: the cross-board tool is a read, and no MCP verb can approve a memory.

## Scout findings behind this plan

Twelve scouts, two waves, `~/.claude/state/scout-waves/descent-sunset-1/` and `-2/`. The findings
this plan leans on hardest, each already cited at its phase:

1. The accounts lane touches no database at all — it is file copies between `~/.claude/.credentials.json`,
   `~/.claude.json` and per-slot directories — and the usage lane is one vendor call with an in-memory
   cache. Neither needs a schema, which is why Phases 8 and 9 are a port rather than a migration.
2. `ov_session_usage` is NOT part of the usage lane: it is per-session build spend written by
   `pm_telemetry.py`, unrelated to the OAuth quota meter. The two share a word and nothing else.
3. `get_learned_selections` reads `ov_decisions`, not `ov_lessons`. There is no lesson scoring
   anywhere in Descent; the index is an unscored recency slice.
4. `/learn` and `/remember` are commands, not skills, and both reach Descent through a spill file —
   the only wire in from outside. `enforce_shelf_channel.py` is the counter-guard that forces them
   through it.
5. A Metis child's stdin is closed at spawn; no mechanism in this repository can inject a turn into a
   live one (Decision 4).
6. The driver has one per-board churn cooldown and no attempt counter, no backoff and no give-up rule
   — a repeatedly failing board is retried every 15 seconds forever. That is what Phase 10 cures.
7. `vitals_status.py` has no consumer on this box (Decision 7).
8. CloudCLI's plan-runner module ALREADY reads the cost ledgers in TypeScript
   (`runner-state.transport.ts:142`), and every ledger row and receipt carries a priced `cost_usd` —
   so Phase 12 is a read over existing readers, not a pricing engine.
9. `concurrency_arbiter/presence.py` reads `descent.db` for EVERY session's file-write serialization
   — the one Descent coupling that is not Metis-scoped, and the reason Phase 22 repoints rather than
   deletes.
10. All four Descent units are SYSTEM-scoped, `systemctl --user` has no bus on this box, `sudo -n`
    works, and `descent-pm-tmux-watchdog.timer` restarts the tmux unit every 60 seconds — which fixes
    Phase 26's order and its 70-second wait.
11. `server/modules/apps/apps.seed.ts:21` and `src/modules/app-switcher/utils/resolveAppUrl.ts:16`
    register Descent as an app tile at `:7878` — the one CloudCLI consumer the proxy deletion misses.
12. Harmonia's only board verb is `mcp__descent-pm__create_feature`, and the `kanban-pm` surface
    carries the identical 25 tool names — so her repoint is one word in two files.

Four more, measured while folding the shape review in (2026-09-17):

13. `metis_presence_bridge.side_effects` carries TWO triggers, not one
    (`metis_presence_bridge.py:250-286`): a `UserPromptSubmit` trigger that stamps the prompt excerpt
    and opens the turn for EVERY session in this house, and a `mcp__descent-pm__set_status` trigger
    that binds a claim. Only the second is Descent's. The module is therefore TRIMMED in Phase 23,
    never deleted — and Phase 23 now depends on Phase 22, whose self-checks import what it removes.
14. `~/.claude.json` carries NO `descent-pm` entry (measured directly). Descent's MCP reached a
    session only through the inline `--mcp-config` its `/pm` launcher composed, so an ordinary
    operator session never held those tools and Harmonia's verbs have always worked only inside the
    session that holds the board MCP. There is no registry entry to purge — but
    `~/.claude/settings.json` does carry four hook matchers on `mcp__descent-pm__*` (:175, :184, :193,
    :294), and those are dead the moment Phase 23 lands.
15. `enforce_shelf_channel.py` and `shelf_channel_bash.py` refuse an Edit, Write or Bash write that
    could ADD a line to `~/.claude/CLAUDE.md`, from any session and any soul — this plan's own author
    was blocked by it mid-authoring. So no phase can correct the operator's two stale pointer lines;
    Exclusions carries the exact replacement text instead.
16. `MemoryCandidateLean`, `MemoryCandidateFull`, `MemoryPending` and `MemoryCandidateRead` already
    exist at `server/shared/types.ts:1866-1876`, and `kanban_events.board_id` is already `TEXT NULL`
    (`kanban-schema.ts:138`) — the first is why Phase 1 declares four types rather than six, the
    second is why the write seam can admit a boardless write without a schema change.

## Open Questions

None. Every scope question this plan met was answered from the code, the codices or the operator's
standing intent, and each is recorded above with its reversal.

## Ship Logs

### Phase 1 Ship Log — ⛔ BLOCKED 2026-09-17
- [BLOCKED: builder-blocked: DIVERGENCE: verify 2 of Phase 1 cannot print its expected stdout on this box — the `tsx --tsconfig <path> -e "<code>"` form (tsx 4.21.0, the version installed) parses `--tsconfig` in its first pass and then takes the tsconfig path as the ENTRY FILE, so the eval code never runs: the command exits 0 w]
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · fix-passes 0 of 2 · spec_sha 7e1e00c473f5 · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session b5e38404-05e2-446f-bb75-3107a1a4b09c · 637s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_1/

### Phase 1 Ship Log — ↻ REPLANNED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · replan 1 of 6 · spec_sha 7e1e00c473f5 → 8ca977e42642 · replanner odysseus/claude-opus-5 · session d4a1092a-3368-435c-9e7a-7baad21c5b81 · 306s · cost $2.12
- cause: builder-blocked: DIVERGENCE: verify 2 of Phase 1 cannot print its expected stdout on this box — the `tsx --tsconfig <path> -e "<code>"` form (tsx 4.21.0, the version installed) parses `--tsconfig` in its first pass and then takes the tsconfig path as the ENTRY FILE, so the eval code never runs: the command exits 0 w
- changed: All four proofs pass, and `spec_sha` moved `7e1e00c473f5` → `8ca977e42642` (manifest 8, forbidden 2, athena 5, `code_change = true` — all intact). **Flags for the caller (not fixable from this window):** 1. **The same broken `tsx --tsconfig <path> -e` form sits in ~12 verifies of later phases** (around lines 855, 968, 1226, 1447, 1530, 1768, 1858, 1978, 2067, 2085, 2195). Each will exit 0 with empty stdout and block its phase, spending a replan apiece. Curing them is a one-character edit (`--tsconfig=`) but lives outside my edit window. *Project Constraint 8's `boot_probe_server` uses the space form with a real entry file — that one works (verify 1 proved it) and must not be "fixed".* 2. **
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_1/

### Phase 1 Ship Log — ✅ SHIPPED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · cycle 2 · spawns 6/300 · fix-passes 1 of 2 · cost $1.24 (run $3.54) · resumed 0×
- builder: hephaestus/deepseek-flash · session f184b4cb-247f-4271-b96a-b1802a3c8a64 · 108s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 1 · MED 0 · LOW 2 → fix-pass 1/deepseek-flash (80s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 7/7 steps OK · verify 3/3 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 1 files
- residue: BLOCKING 0 · HIGH 1 · MED 0 · LOW 2 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_1/

### Phase 2 Ship Log — ⛔ BLOCKED 2026-09-17
- [BLOCKED: builder-blocked: step 6: typecheck clean on both tsconfigs, oxlint clean for the touched files, no test files, no git writes, no probe processes or scratch roots left behind]
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · fix-passes 0 of 2 · spec_sha 69581789c5e3 · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session f2ccacc5-689f-41db-81fc-2bc470812f6d · 1325s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_2/

### Phase 2 Ship Log — ↻ REPLANNED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · replan 2 of 6 · spec_sha 69581789c5e3 → b3993a98bad7 · replanner odysseus/claude-opus-5 · session 6f427795-5bbb-4be9-8029-fb3294ff6922 · 686s · cost $4.39
- cause: builder-blocked: step 6: typecheck clean on both tsconfigs, oxlint clean for the touched files, no test files, no git writes, no probe processes or scratch roots left behind
- changed: **What changed, and why.** Verify 2 was the only thing broken, so verify 2 is what I cured: the credential is now derived in the probe (python HMAC over the scratch DB's `jwt_secret`, `metisBearer`'s own expression), sent as `Authorization: Bearer`, and accepted because the probe seeds a session into the state root *before* the boot — the registry adopts once, at construction. Measured through the runner's own Popen: `MCP-READ 200 MCP-STAGE 201 MCP-REVIEW 403 ENCODED 403 OPERATOR 200`, exit 0, 3.3 s; with the seed removed, `401 401 403` — falsifiable both ways. The manifest gains the two frame-type files step 1 forced the blocked builder to write unlisted, with their own step and check. The
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_2/

### Phase 2 Ship Log — ✅ SHIPPED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · cycle 4 · spawns 12/300 · fix-passes 1 of 2 · cost $3.05 (run $11.21) · resumed 0×
- builder: hephaestus/deepseek-flash · session 3ae7b926-1004-40ed-b11b-e640ecc883e0 · 88s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 3 → fix-pass 1/deepseek-flash (122s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 5/5 steps OK · verify 2/2 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 1 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 3 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_2/

### Phase 3 Ship Log — ⛔ BLOCKED 2026-09-17
- [BLOCKED: builder-blocked: DIVERGENCE: verify #2's command as written (`node_modules/.bin/tsx --tsconfig server/tsconfig.json -e "<code>"`) exits 0 printing nothing, so its `expect = "TARGETS claude,memory,requirements,rules,topic ONE-HOME true"` cannot match — tsx 4.21.0 (`package.json: tsx ^4.21.0`) swallows the `-e <code>`]
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · fix-passes 0 of 2 · spec_sha 4b4fc8f678be · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session ba990925-629b-4ecd-8a5b-1be8125a9712 · 360s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_3/

### Phase 3 Ship Log — ↻ REPLANNED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · replan 3 of 6 · spec_sha 4b4fc8f678be → aa4665ce2b0a · replanner odysseus/claude-opus-5 · session 9808af5f-5252-4d69-b44d-67707a0db33d · 225s · cost $1.66
- cause: builder-blocked: DIVERGENCE: verify #2's command as written (`node_modules/.bin/tsx --tsconfig server/tsconfig.json -e "<code>"`) exits 0 printing nothing, so its `expect = "TARGETS claude,memory,requirements,rules,topic ONE-HOME true"` cannot match — tsx 4.21.0 (`package.json: tsx ^4.21.0`) swallows the `-e <code>`
- changed: I cured the spec, not the world: the deliverable never required a `tsx -e` eval, only proof that `MEMORY_TARGETS` has one home, so verify #2 now writes its three lines to `/tmp/sunset-p3-onehome.ts` and runs THAT file with `--tsconfig=` (equals-joined), `< /dev/null`, a scratch `DATABASE_PATH`, and a literal-path `trap … EXIT` cleanup — measured through the runner's own exec shape (`bash -c`, cwd, inherited stdin): exit 0, stdout exactly `TARGETS claude,memory,requirements,rules,topic ONE-HOME true`. The space-separated `-e` swallow is now named in a second Sirens set alongside the on-disk-attempt temptation and the two files' sanctioned sizes, and step 3's `what` decides the fork the last b
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_3/

### Phase 3 Ship Log — ✅ SHIPPED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · cycle 6 · spawns 18/300 · fix-passes 1 of 2 · cost $1.49 (run $14.51) · resumed 0×
- builder: hephaestus/deepseek-flash · session dcad5aac-b1f3-4e7e-9add-602049a7c6c9 · 122s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 1 · LOW 1 → fix-pass 1/deepseek-flash (78s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 4/4 steps OK · verify 4/4 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 1 files
- residue: BLOCKING 0 · HIGH 0 · MED 1 · LOW 1 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_3/

### Phase 4 Ship Log — ✅ SHIPPED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · cycle 7 · spawns 22/300 · fix-passes 1 of 2 · cost $2.62 (run $17.13) · resumed 0×
- builder: hephaestus/deepseek-flash · session 726a5dec-43f2-47fc-a85c-da7d1979ecf7 · 509s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 1 · MED 4 · LOW 2 → fix-pass 1/deepseek-flash (556s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 6/6 steps OK · verify 2/2 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 2 files
- residue: BLOCKING 0 · HIGH 1 · MED 4 · LOW 2 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_4/

### Phase 5 Ship Log — ⛔ BLOCKED 2026-09-17
- [BLOCKED: builder-blocked: DIVERGENCE: verify #3's command as written (`node_modules/.bin/tsx --tsconfig server/tsconfig.json -e "<program>"`, the space-separated form) exits 0 printing nothing on this box — tsx 4.21.0 parses `--tsconfig` in its first pass and the eval program never runs (proved: an eval with a `writeFileSync]
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · fix-passes 0 of 2 · spec_sha e48cd6792fbc · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session d103b4a3-fac7-481a-9265-fcde1be60e90 · 411s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_5/

### Phase 5 Ship Log — ↻ REPLANNED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · replan 4 of 6 · spec_sha e48cd6792fbc → 82b386c98a7e · replanner odysseus/claude-opus-5 · session 2a12ee99-d81f-4204-9311-e10dc6514102 · 358s · cost $2.92
- cause: builder-blocked: DIVERGENCE: verify #3's command as written (`node_modules/.bin/tsx --tsconfig server/tsconfig.json -e "<program>"`, the space-separated form) exits 0 printing nothing on this box — tsx 4.21.0 parses `--tsconfig` in its first pass and the eval program never runs (proved: an eval with a `writeFileSync
- changed: Verify #3 was unrunnable, not wrong: `tsx --tsconfig <cfg> -e "<program>"` swallows the eval, and the `=` form runs it in a CJS context that dies on `@openai/codex-sdk`. I replaced it with the entry-file idiom Phase 3 already carries — a `.mts` written to `/tmp`, run with `--tsconfig=`, `< /dev/null`, a scratch `DATABASE_PATH`, stdout filtered past the `Migrated legacy database` line, both files trapped away — and widened it to prove call-time resolution: measured `OUTSIDE-REPO true UNDER-CLOUDCLI true CALL-TIME true`, exit 1 when the import fails. I added the real `server/modules/assets/services/image-assets.service.ts` (the old anchor names no file), told every step its work is already on
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_5/

### Phase 5 Ship Log — ✅ SHIPPED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · cycle 9 · spawns 28/300 · fix-passes 1 of 2 · cost $1.67 (run $21.86) · resumed 0×
- builder: hephaestus/deepseek-flash · session bf104604-e8b3-4ace-beda-aa467567d160 · 92s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 1 · HIGH 0 · MED 1 · LOW 4 → fix-pass 1/deepseek-flash (169s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 4/4 steps OK · verify 3/3 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 1 files
- residue: BLOCKING 1 · HIGH 0 · MED 1 · LOW 4 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_5/

### Phase 6 Ship Log — ⛔ BLOCKED 2026-09-17
- [BLOCKED: builder-blocked: step 4: the copy planned in `kanban-import-satellites.ts` (`<descent feature id>/<att id>.<ext>` → `attachmentsRoot()/<card id>/<att id>.<ext>` through `resolveUnderRoot`) and placed by `placeAttachmentBytes` after the commit, skipping a file already there and recording a missing source without thro]
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · fix-passes 0 of 2 · spec_sha 5697c903d5ea · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session 3dce024f-cd13-46aa-84c0-44c162facb35 · 924s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_6/

### Phase 6 Ship Log — ↻ REPLANNED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · replan 5 of 6 · spec_sha 5697c903d5ea → b2fa4e2e6336 · replanner odysseus/claude-opus-5 · session a8c71a8f-ef08-4000-90a3-db8a9439fe2a · 422s · cost $2.87
- cause: builder-blocked: step 4: the copy planned in `kanban-import-satellites.ts` (`<descent feature id>/<att id>.<ext>` → `attachmentsRoot()/<card id>/<att id>.<ext>` through `resolveUnderRoot`) and placed by `placeAttachmentBytes` after the commit, skipping a file already there and recording a missing source without thro
- changed: **Proofs** — `lint` exit 0 · `gate` first line `RUNNER` · `walk` renders (Phase 6 first unshipped, deps met) · `enforce_intent_lock.py lock` prints `lock:d9a58ac4e9`. spec_sha moved `5697c903d5ea → b2fa4e2e6336`; head and tail of the file are byte-identical to the snapshot, so only Phase 6 changed. All five step checks run green on the real tree. I cured three spec defects. The manifest gained the four files the child's divergence named — `routes/import.routes.ts`, `kanban-import.db.ts`, `kanban-import-rows.db.ts`, `database/index.ts` — and a new step 5 makes the post-commit slot a plan-time decision rather than a discovery: `placeAttachmentBytes(result.attachmentCopies)` is called synchron
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_6/

### Phase 6 Ship Log — ✅ SHIPPED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · cycle 11 · spawns 34/300 · fix-passes 1 of 2 · cost $1.71 (run $26.78) · resumed 0×
- builder: hephaestus/deepseek-flash · session 9e636b36-03ec-4812-9422-a4154566ceca · 90s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 2 · LOW 4 → fix-pass 1/deepseek-flash (217s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 5/5 steps OK · verify 2/2 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 2 files
- residue: BLOCKING 0 · HIGH 0 · MED 2 · LOW 4 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_6/

### Phase 7 Ship Log — ⛔ BLOCKED 2026-09-17
- [BLOCKED: builder-blocked: DIVERGENCE: step 2's brief reads "Add the list_features_all tool of Interfaces §9 — mcp_tools_xboard.py:33-47's schema exactly, both parameters optional — answering every NON-ARCHIVED board's cards with each card's board {id, name}" at path server/modules/kanban-metis/mcp/kanban-pm-board-reads.ts, b]
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · fix-passes 0 of 2 · spec_sha 7cbb2fc1fdc5 · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session 7d3010e2-97c3-4eac-8de9-341c2fde27a6 · 469s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_7/

### Phase 7 Ship Log — ↻ REPLANNED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · replan 6 of 6 · spec_sha 7cbb2fc1fdc5 → 604679d95168 · replanner odysseus/claude-opus-5 · session 30839111-9ff1-4223-8d62-e2e3f2c0eacc · 920s · cost $7.56
- cause: builder-blocked: DIVERGENCE: step 2's brief reads "Add the list_features_all tool of Interfaces §9 — mcp_tools_xboard.py:33-47's schema exactly, both parameters optional — answering every NON-ARCHIVED board's cards with each card's board {id, name}" at path server/modules/kanban-metis/mcp/kanban-pm-board-reads.ts, b
- changed: Re-authored Phase 7 in place. The block was `list_features_all`: the spec ordered it *added* to `kanban-pm-board-reads.ts`, but the tool already ships in `kanban-pm-tools-cards.ts` (descriptor :61, handler :159) with §9's exact schema, so the check could only pass by planting a name in a helper. Step 2 is now a verification of the tool where it lives — `kanban-pm-tools-cards.ts` (named in the divergence) joins the manifest, as does `kanban-pm-tools-lessons.ts`, the split attempt 1 made under Constraint 4. Every check now reads the running MCP program over stdio (schemas, pre-HTTP refusals, the anti-plant guard) and the verify exercises the cross-board read against a retired probe board — all
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_7/

### Phase 7 Ship Log — ✅ SHIPPED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · cycle 13 · spawns 40/300 · fix-passes 1 of 2 · cost $1.93 (run $36.43) · resumed 0×
- builder: hephaestus/deepseek-flash · session f2824baf-c45e-406c-bf58-64af72c6fd9b · 61s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 1 · LOW 2 → fix-pass 1/deepseek-flash (97s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 4/4 steps OK · verify 2/2 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 2 files
- residue: BLOCKING 0 · HIGH 0 · MED 1 · LOW 2 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_7/

### Phase 8 Ship Log — ⛔ BLOCKED 2026-09-17
- [BLOCKED: builder-blocked: step 3: `npm run typecheck` → TYPECHECK-OK]
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · fix-passes 0 of 2 · spec_sha 6a63aacc87b5 · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session 302b049b-8094-4f72-af01-7d7c24b67cfb · 351s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_8/

### Phase 8 Ship Log — ⚒ UNBLOCK 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · unblock 1 of 4 · key 8:builder-blocked:6a63aacc87b5 · result failed
- reason: THE ONLY CURE IS A SPEC CHANGE INSIDE A MUST-NOT PATH: the one-character flag-form fix (`--tsconfig <path>` → `--tsconfig=<path>`, 18 verify commands) lives in `docs/plans/descent-sunset.plan.md`, which is fenced MUST-NOT, owned by the runner, and marked "frozen — change nothing in it", with replans
- unblock: hephaestus/deepseek-flash · session 8c57a3c4-a13d-4bf6-bdf8-b148452624b8 · RESULT: BLOCKED · moved 4 paths during the outing (ours or a neighbour's)
- review: BLOCKING 0 · HIGH 0 · MED 0 · LOW 1
- guard: clean
- heal: queued → /home/lyphe/.claude/state/heal_queue/descent-sunset-plan-20260917-134600-fe5d-8-1.json
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_8/unblock-1.json

### Phase 9 Ship Log — ⛔ BLOCKED 2026-09-17
- [BLOCKED: depends: not SHIPPED: Phase 8]
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 0 of 3 (never dispatched) · fix-passes 0 of 2 · spec_sha 173532ce1e8d · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_9/

### Phase 10 Ship Log — ⛔ BLOCKED 2026-09-17
- [BLOCKED: budget: halted: 2 attempts since the last SHIPPED phase passed no check]
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 0 of 3 (never dispatched) · fix-passes 0 of 2 · spec_sha 7ef2c6799dc6 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_10/

### Run descent-sunset-plan-20260917-134600-fe5d — HALTED 2026-09-17
- shipped: 1, 2, 3, 4, 5, 6, 7
- blocked: 8: builder-blocked, 9: depends, 10: budget, 8: skipped, spec unchanged
- next: plan-runner resume descent-sunset-plan-20260917-134600-fe5d
- brief: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/resume_brief.md

### Phase 8 Ship Log — ✅ SHIPPED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · cycle 15 · spawns 47/300 · fix-passes 1 of 2 · cost $0.53 (run $37.19) · resumed 1×
- builder: hephaestus/deepseek-flash · session 998e75b9-1997-43ad-b2d2-0e56cf173f13 · 219s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 1 · LOW 2 → fix-pass 1/deepseek-flash (133s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 3/3 steps OK · verify 2/2 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 1 · LOW 2 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_8/

### Phase 9 Ship Log — ⛔ BLOCKED 2026-09-17
- [BLOCKED: builder-blocked: DIVERGENCE: verify #2 reads 7, never 0 — docs/ holds docs/plans/descent-sunset.plan.md (MUST-NOT, runner-owned), whose line 2066 is this verify's own cmd, plus 5 other runs' plans and docs/verification.md (Phase 25's); the twin verify at line 3747 filters docs/plans/, this one omits that filter.]
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · fix-passes 0 of 2 · spec_sha 173532ce1e8d · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session 0c3df7d6-8c09-47fa-a0ee-9f9fb0939d6d · 965s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_9/

### Phase 9 Ship Log — ⚒ UNBLOCK 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · unblock 2 of 4 · key 9:builder-blocked:173532ce1e8d · result failed
- reason: The cure is a re-authored verify #2 — scoped like its twin at line 3747 (`docs/plans/` filtered, `docs/verification.md` excluded) — which is a frozen-spec change inside a MUST-NOT runner-owned file, so I change nothing.
- unblock: hephaestus/deepseek-flash · session 7bd8c2cf-731a-421b-b95a-bfdf6a67c97a · RESULT: BLOCKED · moved 173 paths during the outing (ours or a neighbour's)
- review: BLOCKING 0 · HIGH 0 · MED 1 · LOW 3
- guard: clean
- heal: queued → /home/lyphe/.claude/state/heal_queue/descent-sunset-plan-20260917-134600-fe5d-9-2.json
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_9/unblock-2.json

### Phase 10 Ship Log — ✅ SHIPPED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · cycle 17 · spawns 55/300 · fix-passes 2 of 2 · cost $2.28 (run $39.96) · resumed 1×
- builder: hephaestus/deepseek-flash · session ad8822ed-653f-4de2-b6d2-0bfabf5ff34c · 487s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 3 · LOW 4 → fix-pass 1/deepseek-flash (290s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 3/4 steps OK · verify 2/2 OK → fix-pass 2/deepseek-flash (125s) → 4/4 steps OK · verify 2/2 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 1 files
- residue: BLOCKING 0 · HIGH 0 · MED 3 · LOW 4 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_10/

### Phase 11 Ship Log — ⛔ BLOCKED 2026-09-17
- [BLOCKED: builder-blocked: DIVERGENCE: verify 2 cannot be made true — `npm run lint` (after `npm run typecheck`, which exits 0) writes 2 errors to `/tmp/sunset-lint-11.txt`, verbatim `src/modules/universe/utils/universeGraph.ts:2:30: error import(no-cycle): Dependency cycle detected` and `src/modules/universe/utils/universeRe]
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · fix-passes 0 of 2 · spec_sha 10132226373b · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session 1656513d-a2ff-4d1d-a393-2f086e0080ba · 598s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_11/

### Phase 11 Ship Log — ⚒ UNBLOCK 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · unblock 3 of 4 · key 11:builder-blocked:10132226373b · result failed
- reason: DIVERGENCE: verify 2's `npm run lint` is a whole-repo gate; its 2 ` error ` lines are an import(no-cycle) cycle in another session's uncommitted src/modules/universe/ edits, outside this phase's manifest; the cure is a re-authored scoped verify 2 in the MUST-NOT runner-owned plan, so I change nothin
- unblock: hephaestus/deepseek-flash · session dc4f3804-2151-4ebc-9b50-dcd0b4c4f73d · RESULT: BLOCKED · moved 9 paths during the outing (ours or a neighbour's)
- review: BLOCKING 0 · HIGH 3 · MED 1 · LOW 2
- guard: clean
- heal: queued → /home/lyphe/.claude/state/heal_queue/descent-sunset-plan-20260917-134600-fe5d-11-3.json
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_11/unblock-3.json

### Phase 12 Ship Log — ✅ SHIPPED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · cycle 19 · spawns 62/300 · fix-passes 1 of 2 · cost $2.37 (run $42.68) · resumed 1×
- builder: hephaestus/deepseek-flash · session e5287b10-70d1-4d6e-96c8-7b62d75f7036 · 377s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 1 · LOW 4 → fix-pass 1/deepseek-flash (137s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 4/4 steps OK · verify 2/2 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 1 files
- residue: BLOCKING 0 · HIGH 0 · MED 1 · LOW 4 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_12/

### Phase 13 Ship Log — ✅ SHIPPED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · cycle 20 · spawns 66/300 · fix-passes 1 of 2 · cost $1.41 (run $44.08) · resumed 1×
- builder: hephaestus/deepseek-flash · session 84e2f1a6-baa7-4e6e-9beb-0f666042573f · 452s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 → fix-pass 1/deepseek-flash (50s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 3/3 steps OK · verify 2/2 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 1 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_13/

### Phase 14 Ship Log — ✅ SHIPPED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · cycle 21 · spawns 69/300 · fix-passes 0 of 2 · cost $1.84 (run $45.92) · resumed 1×
- builder: hephaestus/deepseek-flash · session 35d8ca11-19a0-4f30-862c-06938ba8e3ea · 437s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 0 — CLEARED
- checks: 6/6 steps OK · verify 3/3 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 3 files
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_14/

### Phase 15 Ship Log — ✅ SHIPPED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · cycle 22 · spawns 73/300 · fix-passes 1 of 2 · cost $12.29 (run $58.21) · resumed 1×
- builder: iris/fable · session 35a852ca-332f-4be9-87fc-90d03c3d4da8 · 985s · RESULT: DONE
- athena: pass 1/fable BLOCKING 0 · HIGH 0 · MED 1 · LOW 3 → fix-pass 1/fable (139s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 3/3 steps OK · verify 2/2 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 1 · LOW 3 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_15/

### Phase 16 Ship Log — ✅ SHIPPED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · cycle 23 · spawns 77/300 · fix-passes 1 of 2 · cost $1.36 (run $59.57) · resumed 1×
- builder: hephaestus/deepseek-flash · session e03d7b1a-4b63-49db-b2ea-8f2ee492fd89 · 213s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 2 · LOW 1 → fix-pass 1/deepseek-flash (91s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 3/3 steps OK · verify 2/2 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 2 · LOW 1 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_16/

### Phase 16b Ship Log — ✅ SHIPPED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · cycle 24 · spawns 81/300 · fix-passes 1 of 2 · cost $0.73 (run $60.30) · resumed 1×
- builder: hephaestus/deepseek-flash · session 23841679-66f9-4a12-b106-1df6e54a46af · 112s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 → fix-pass 1/deepseek-flash (32s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 2/2 steps OK · verify 2/2 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_16b/

### Phase 17 Ship Log — ✅ SHIPPED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · cycle 25 · spawns 85/300 · fix-passes 1 of 2 · cost $24.99 (run $85.29) · resumed 1×
- builder: iris/fable · session 10d0fa01-bc11-43db-8b05-70616f5b0363 · 1091s · RESULT: DONE
- athena: pass 1/fable BLOCKING 0 · HIGH 0 · MED 3 · LOW 4 → fix-pass 1/fable (197s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 3/3 steps OK · verify 3/3 OK
- forbidden: unchanged (2 declared, 1 present)
- docs: Prometheus returned · 2 files
- residue: BLOCKING 0 · HIGH 0 · MED 3 · LOW 4 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_17/

### Phase 18 Ship Log — ✅ SHIPPED 2026-09-17
- run: descent-sunset-plan-20260917-134600-fe5d · attempt 1 of 3 · cycle 26 · spawns 90/300 · fix-passes 2 of 2 · cost $1.21 (run $86.50) · resumed 1×
- builder: hephaestus/deepseek-flash · session a33fe8d5-6f36-4578-b9dc-86a34fb998b5 · 492s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 1 · LOW 1 → fix-pass 1/deepseek-flash (343s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 3/4 steps OK · verify 2/2 OK → fix-pass 2/deepseek-flash (114s) → 4/4 steps OK · verify 2/2 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 1 files
- residue: BLOCKING 0 · HIGH 0 · MED 1 · LOW 1 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/phase_18/

### Run descent-sunset-plan-20260917-134600-fe5d — RATE-LIMITED 2026-09-17
- shipped: 8, 10, 12, 13, 14, 15, 16, 16b, 17, 18
- blocked: 9: builder-blocked, 11: builder-blocked, 9: skipped, spec unchanged, 11: skipped, spec unchanged
- next: plan-runner resume descent-sunset-plan-20260917-134600-fe5d (runner-watchdog does this itself at 2026-09-22 00:01 PDT)
- brief: /home/lyphe/.claude/state/runner/descent-sunset-plan-20260917-134600-fe5d/resume_brief.md
