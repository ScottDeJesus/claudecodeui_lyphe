# Metis on the Kanban board — the board's own autonomy driver, secluded

## INTENT LOCK

**ORIGINAL REQUEST** (the operator's own words, verbatim):
> can we start the transfer over in a new plan, i'd like to keep pm/metis secluded in that kanban board. meaning it's not picked up by session context or suggested routing. it's exclusive autonomy for kanban. please include its own deepseek flash toggle in the board as well that's specific to kanban board.

And the ruling he gave when asked what the board's DeepSeek switch moves (2026-09-16):
> it moves METIS HERSELF as well as the builders — when the board's switch is on, the Metis session itself runs on DeepSeek Flash, and so do the builder / fix-pass / Athena roles of every plan-runner she starts from that board.

**THIS PLAN DELIVERS:**
The LypheCLI Kanban board gains an autonomy driver of its own. A new server module,
`server/modules/kanban-metis/`, launches and owns **Metis sessions that exist only for this
board**: it spawns a detached `claude` child per board, hands it a board-private MCP tool
surface (`kanban-pm`, 25 tools over the board's own HTTP verbs) and a board-owned copy of her
brief, keeps up to N alive while claimable work exists, reaps the quiet and the stalled, and
re-adopts what survived a server restart. Those sessions are **structurally invisible** to the
rest of the app: the session synchroniser refuses their transcripts, so no `sessions` row, no
`projects` row, no sidebar entry, no session search hit, no recent-conversation card ever
exists for one. Nothing in `~/.claude/commands`, `~/.claude/agents`, `skill_router.py` or
`soul_routing.py` names them. They are visible in exactly one place: a **Metis pilot panel**
inside the Kanban tab — live sessions, the card each holds, the provider each is actually
spending, a transcript tail, stop and resume.

A **second `Switch`** joins Autonomy in the board header: the board's own DeepSeek Flash
toggle, a column on `kanban_boards` and never the host-wide flag file. When it is on, the next
Metis session this board spawns runs on `deepseek-flash` itself, **and** every `plan-runner`
she starts from that board sends its builder, fix-pass and Athena there too — through a
per-board flag file handed to her as `PLAN_RUNNER_DEEPSEEK_FLAG_PATH`. The host-wide switch is
never consulted for anything this board launches.

This is phase one of sunsetting Descent. **It removes nothing from Descent** — `~/.claude/descent/`,
`~/.claude/commands/pm.md`, the `descent-pm` MCP and Descent's own daemon all keep running,
untouched, in parallel.

**OPERATOR VERDICT:** CONFIRMED -- 2026-09-16 -- Scott: "Accept — run it"

## Runner

```toml
plan_format = 2
cwd = "/home/lyphe/.claude/claudecodeui_lyphe"
add_dirs = ["/home/lyphe/.claude/hooks", "/home/lyphe/.claude/commands", "/home/lyphe/.claude/descent"]

[budget]
max_cycles = 40
max_spawns = 220
max_fix_passes = 2
max_attempts = 2
max_review_passes = 1
max_replans = 6
```

## Interfaces

Contracts only. Signatures, shapes and paths — never bodies.

**The board column.** `kanban_boards` gains `deepseek_flash INTEGER NOT NULL DEFAULT 0`,
declared in `kanban-schema.ts`'s `CREATE TABLE IF NOT EXISTS kanban_boards` **and** added to a
live database by a new function in `migrations.ts`:

```ts
const migrateKanbanBoardsColumns = (db: Database): void => { /* tableExists + getTableInfo + addColumnToTableIfNotExists */ };
```

built in the shape of `rebuildProjectsTableWithPrimaryKeySchema` (`migrations.ts:122-131`) — its
own `tableExists` guard, its own `getTableInfo` column read, then
`addColumnToTableIfNotExists(db, 'kanban_boards', columnNames, 'deepseek_flash', 'INTEGER NOT NULL DEFAULT 0')`
— and called on the line immediately after `db.exec(KANBAN_SCHEMA_SQL)` (`migrations.ts:577`).
**The projects and sessions migration bodies are never extended to carry a kanban column**: they
are already the longest functions in a 608-line file, and a board column filed under a projects
rebuild is a column nobody finds. Both edits are required: the schema file is `IF NOT EXISTS`
only and changes nothing on an existing file (`kanban-schema.ts` header, lines 9-16). It surfaces as `deepseekFlash: boolean` on
`KanbanBoard` in `server/shared/kanban-types.ts` and its mirror `src/shared/kanban-types.ts`,
and as an optional `deepseekFlash?: boolean` on `updateBoard`'s patch, the board `PATCH` route's
parse, and `KanbanBoardPatch` in `src/modules/kanban/hooks/useKanbanBoards.ts`.

**The claimable read.** `kanbanBoardsService.claimableCount(boardId: string): number`, over
`kanbanBoardsDb.countClaimable(boardId: string, staleSeconds: number): number`:

```sql
SELECT COUNT(*) AS n FROM kanban_cards
WHERE board_id = ? AND archived = 0
  AND ( status = 'todo'
     OR (status = 'active' AND (build_lease_at IS NULL OR build_lease_at < ?)) )
```

The second parameter is `new Date(Date.now() - staleSeconds * 1000).toISOString()`; the column
is ISO-8601 UTC seconds TEXT, so the comparison is lexicographic and correct. Reached over
`GET /api/kanban/boards/:boardId/claimable -> { claimable: number }`. It is a READ and takes no
write seam, exactly like `laneCounts`.

**The flag-file writer, generalised.** `server/modules/settings/deepseek-flash-switch.ts` keeps
`readDeepseekFlashSwitch()` / `writeDeepseekFlashSwitch(enabled)` byte-for-byte in behaviour and
gains the two they are now built from, both exported through `server/modules/settings/index.ts`:

```ts
export async function readFlagFile(filePath: string): Promise<boolean>
export async function writeFlagFile(filePath: string, enabled: boolean): Promise<void>
```

`writeFlagFile` carries the same three parts the existing writer has and for the same measured
reasons: `realpath` the destination, a scratch named with `process.pid` + `randomUUID()`,
`rename` onto the destination, `unlink` the scratch in a `finally`. `readFlagFile` keeps the
256-byte ceiling and the explicit `/^[\s-]+|[\s-]+$/g` trim class that matches Python's
`str.strip()` + `utf-8-sig`.

**The board's DeepSeek flag file.** `~/.claude/state/kanban-deepseek/<boardId>.flag`, written by
`writeFlagFile` at every spawn from the board row, and handed to the Metis child as
`PLAN_RUNNER_DEEPSEEK_FLAG_PATH`. `~/.claude/hooks/plan_runner/deepseek.py:99-105`'s `flag_path()`
reads that variable **at call time**, so every `plan-runner` the child starts reads the board's
file and never `~/.claude/state/deepseek_flash.flag`.

**The MCP surface.** Server name `kanban-pm`; the twenty-five tool names are **identical to
`descent-pm`'s**, so the brief's prose and the hook matchers port by changing the server word
alone. Client-facing prefix `mcp__kanban-pm__<tool>`. Entry point
`server/modules/kanban-metis/kanban-pm-mcp.ts`, a `#!/usr/bin/env node` stdio program in the
shape of `server/modules/browser-use/browser-use-mcp.ts` — hand-rolled newline-delimited
JSON-RPC 2.0 over stdin/stdout, **no new dependency** (Descent's own `mcp_server.py` is built the
same way). It is wired into `cli.service.ts`'s command table as `kanban-pm-mcp` beside
`browser-use-mcp`.

**The command resolver is EXTRACTED, not copied.** `browser-use.service.ts:161-188`'s
`getMcpCommand()` — `dist` `.js` first, then `node_modules/.bin/tsx` + the `.ts` source, then the
`cloudcli` bin — moves to `server/shared/mcp-command.ts` as

```ts
export function resolveMcpCommand(scriptBaseName: string, cliVerb: string): { command: string; args: string[] }
```

a PURE MOVE with zero behaviour change; `browser-use.service.ts` is rewritten to compose it, and
`getKanbanPmMcpCommand()` is a one-line caller. Two callers of one resolver, never two copies of
one resolver.

It reads four variables from its own environment and nothing else:

```
KANBAN_PM_API_URL    the running server's own origin        (required)
KANBAN_PM_TOKEN      a bearer, sent as Authorization        (required)
KANBAN_PM_BOARD_ID   e.g. b-90                              (required)
KANBAN_PM_OWNER      16 lowercase hex, the lease owner      (required)
```

**`KANBAN_PM_API_URL` is the running server's OWN origin, resolved at spawn** from the port this
process is actually listening on — the shape `browser-use.service.ts:190-193`'s `getMcpApiUrl()`
uses (`SERVER_PORT` ‖ `PORT` ‖ `3001`) — and never a constant. Two servers share one database on
this box (the operator's on 3011, a probe on 7893), and a child that talks to the other one
writes to the right rows through the wrong process, so its websocket frames reach nobody. The
origin is resolved ONCE in `kanban-metis.module.ts` at construction and passed down as a
parameter; an explicit `KANBAN_PM_API_URL` already in the server's environment is honoured as an
override seam and nothing else.

Every tool is one or more calls to the board's existing HTTP verbs — it opens no database and
imports nothing from `server/modules/kanban/`. Handshake `serverInfo.name` is `kanban-pm`,
matching the registration key (Descent's own handshake says `descent` while its prefix is
`descent-pm`; that drift is not copied).

**The twenty-five tools, and the board verb behind each.** Reads first:

| Tool | Board verb |
|---|---|
| `list_features` | `GET /boards/:b/cards?status=…` across the five statuses, `+ GET /cards/:id` for tags |
| `list_features_all` | the same, once per non-archived board from `GET /boards` |
| `get_feature_plan` | `GET /cards/:id` |
| `open_design_questions` | `GET /cards/:id`, its `questions` |
| `get_learned_selections` | `GET /cards/:id` decisions, filtered by `tags`/`q` |
| `list_actionable` | `GET /boards/:b/lanes` + the `todo` / `questions` / `active` pages; `lessons` is always `[]` |
| `list_active_builds` | `GET /boards/:b/cards?status=active`, `is_stale` from `leaseState`, `is_mine` from the owner |
| `search_history` | `GET /events?boardId=` + a substring pass over card titles, descriptions, bodies and closing remarks |
| `list_lessons` · `get_lesson` | **honest stub** (below) |

Writes:

| Tool | Board verb |
|---|---|
| `create_feature` | `POST /boards/:b/cards` then `POST /cards/:id/tags` per tag |
| `attach_plan` | `PATCH /cards/:id { plan, body }` |
| `post_design_questions` | `POST /cards/:id/questions` per question, then `POST /cards/:id/move { status: 'questions' }` |
| `answer_design_question` | `POST /questions/:qid/answer { selected, other }` |
| `set_status` | `POST /cards/:id/move { status }`, and on `active` also `POST /cards/:id/build-lease/claim { owner }` |
| `set_tags` | `GET /cards/:id`, then `DELETE`/`POST /cards/:id/tags` to reach the named set |
| `file_issue` | `POST /cards/:id/issues`, then `PATCH /cards/:id { plan: '' }` and `POST /cards/:id/move { status: 'todo' }` |
| `resolve_issue` | `POST /issues/:iid/resolve` |
| `archive_feature` | `POST /cards/:id/archive` |
| `set_checklist` | `DELETE /checklist/:k` for each existing item, then `POST /cards/:id/checklist` per text |
| `set_checklist_item` | `PATCH /checklist/:k { state, note }` |
| `set_closing_remarks` | `PATCH /cards/:id { closingRemarks }` |
| `approve_feature` | `POST /cards/:id/approve` |
| `claim_plan` | `POST /cards/:id/plan-lease/claim { owner }` |
| `stage_lesson` | **honest stub** (below) |

**The four honest stubs.** `stage_lesson`, `list_lessons`, `get_lesson` and
`get_learned_selections`-for-lessons have no store on this board. `stage_lesson`, `list_lessons`
and `get_lesson` each answer, with `isError: true`:

```
lessons are not on this board yet — the lesson corpus is Descent-only until sunset. Record what
you learned in the card's closing remarks instead (set_closing_remarks).
```

`get_learned_selections` is NOT a stub — the board has `kanban_decisions`, so it answers from
them. `search_history` is NOT a stub — the board has `kanban_events` and the card text. Both are
mapped above.

**The lease owner is DERIVED, never minted.** `owner = sha256(sessionId).hex().slice(0, 16)`,
computed in `metis-env.service.ts` and handed over as `KANBAN_PM_OWNER`. A minted token lives only
in the process that minted it, so a resumed or re-adopted Metis would come back unable to refresh
the leases she already holds and would be reaped by her own stall rule. A derived one is the same
sixteen hex characters every time that session id is seen, by any process, after any restart. It
keeps Descent's shape — sixteen lowercase hex, `mcp_server.py:298` — and drops its one property
the board cannot afford.

**The lease heartbeat lives in the MCP process**, not in the driver, because the lease verbs are
compare-and-set on the owner and a refresh from a process that is not acting as that owner
defeats the CAS. A `setInterval` at **10 000 ms** (`descent/mcp_server.py:205`'s
`HEARTBEAT_SECS = 10`) calls `POST /cards/:id/build-lease/refresh { owner }` and the plan-lease
sibling for the ids it holds. The in-memory list of claimed ids is an OPTIMISATION only — the
owner is derivable, so a process that lost that list can still re-read `list_active_builds` and
refresh what is its own.

**The brief.** `server/modules/kanban-metis/brief/METIS.md` plus
`server/modules/kanban-metis/brief/chapters/{autonomy-cadence,learning,mcp-fallback,parallelism,plan-template,recovery}.md`,
resolved at runtime through `findApplicationRoot(getModuleDirectory(import.meta.url))`
(`server/shared/utils.ts:1394-1400`, which already unwraps `dist-server`) — so it reads from the
source tree whether the server runs under `tsx` or from `dist-server`. It is handed to the child
as `--append-system-prompt`, one string, brief then chapters concatenated under their own
headings. **`~/.claude/commands/pm.md` and `~/.claude/descent/pm-chapters/` are not touched by
this plan.**

**The child's opening turn.** The brief is the system prompt; it is not a turn, and `claude -p`
with nothing written to stdin waits for input forever. The child therefore receives ONE literal
string on stdin, which is then closed — `souls.py:310-312` does exactly this, prompt then EOF:

```
Work board `<boardId>`. Call `list_actionable`, take the top claimable card, and end the turn
when nothing is claimable.
```

`<boardId>` is the only substitution. The string is recorded VERBATIM in `spec.json` so a reader
months later knows what she was actually asked, and so a resume sends the same words.

**The Metis session record**, in `server/shared/types.ts` beside `SoulLaunchSnapshot`:

```ts
export type KanbanMetisSession = {
  sessionId: string;            // the uuid handed to `claude --session-id`
  boardId: string;
  boardName: string;
  provider: 'deepseek' | 'claude';
  model: string;                // 'deepseek-flash' | 'opus'
  owner: string;                // 16 lowercase hex, sha256(sessionId) truncated
  launchedBy: 'operator' | 'driver';
  state: 'running' | 'completed' | 'stopped' | 'failed';
  pid: number | null;
  startedAt: number;            // epoch ms
  endedAt: number | null;       // epoch ms
  lastActivityAt: number;       // epoch ms, the child.log mtime
  exitCode: number | null;
};

export type KanbanMetisStateEvent = {
  kind: 'kanban_metis_state';
  sessions: KanbanMetisSession[];
  at: number;
};
```

`'kanban_metis_state'` joins `GatewayEventKind` beside `'soul_launch_state'`, and the type is
mirrored into `src/shared/types.ts`.

**The session home on disk.** `~/.claude/state/kanban-metis/<sessionId>/` holding
`spec.json`, `result.json`, `child.log`, `child.pid` — the layout of
`~/.claude/state/dispatch-souls/<launch id>/`, deliberately, so `classifyLaunch`'s liveness
shape can be copied rather than invented. The child's **cwd** is
`~/.claude/kanban-metis/<boardId>/`, a directory the driver creates; that path is what the
seclusion predicate keys on.

**The child owns its own log — the parent pipes nothing.** The child is detached and outlives the
server, so a piped stdout is a contradiction: the moment the server restarts, the read end is
gone, the child blocks on a full 64 KB pipe buffer or dies on `EPIPE`, and `child.log`'s mtime
freezes — which the quiescence rule then reads as a quiet session and reaps a Metis that is
mid-build. So the file descriptor IS the child's stdout and stderr:

```ts
const fd = await open(childLogPath, 'a');
const child = spawn(bin, argv, { detached: true, stdio: ['pipe', fd.fd, fd.fd], cwd, env });
child.stdin.write(openingTurn);
child.stdin.end();
await fd.close();          // the PARENT's handle; the child keeps its own
child.unref();
```

`result.json` is written by the parent's `exit` handler while the server is alive, and by
re-adoption when it is not — never by the child.

**The child's argv**, in the shape of `~/.claude/hooks/plan_runner/souls.py:172-184`:

```
claude -p --output-format stream-json --verbose
       --permission-mode bypassPermissions
       --session-id <uuid>            # FIRST spawn only
       --resume <uuid>                # RESUME only, INSTEAD of --session-id, never both
       --model <deepseek-flash | opus>
       --append-system-prompt <the brief>
       --mcp-config <one JSON string naming kanban-pm>
       --strict-mcp-config
       [--add-dir <the board's project path>]
```

`--session-id` mints a conversation and `--resume` continues one; the two name the same uuid for
opposite purposes and a child handed both is a child arguing with itself. Exactly one is present
on any spawn. `--strict-mcp-config` is what makes `kanban-pm` the **only** MCP the session can
see: no `descent-pm`, no user-scope servers. Every flag exists in CLI 2.1.269.

**`--add-dir` is derived from the board, not enumerated.** `kanban_boards.project_id` resolves
through `projectsDb` to that project's path and becomes ONE `--add-dir`. A board whose
`project_id` is null gets NO `--add-dir` at all and the child works only inside its own cwd. This
is the first thing on this board that reads `project_id` as more than a label, and Phase 11
corrects `docs/kanban.md`'s two sentences that say otherwise.

**The child's env is `userFacingEnv(extra)`**, imported from `server/shared/child-env.ts:16-22` —
the server's own environment minus `SERVER_ONLY_VARIABLES` (`TSX_TSCONFIG_PATH`, `:14`). That
subtraction is not cosmetic: measured 2026-09-11, a plan-runner started from a CloudCLI session
inherited the server's `TSX_TSCONFIG_PATH`, ran a client probe through `tsx`, and died with
`ERR_MODULE_NOT_FOUND '@/modules'` because every `@/…` resolved against the SERVER's folder. A
Metis who starts plan-runners is exactly that path. **`metis-env.service.ts` never spells
`{ ...process.env }`** — it never mentions `process.env` at all; what it needs from the
environment arrives as parameters. The `extra` it passes:

```
MAIN_SHELVES_LOADER_DISABLE = "1"          # the shelves loader's own bypass (souls.py:186-202)
KANBAN_METIS_BOARD_ID       = <boardId>
KANBAN_METIS_SESSION_ID     = <uuid>
PLAN_RUNNER_DEEPSEEK_FLAG_PATH = ~/.claude/state/kanban-deepseek/<boardId>.flag
```

and, when the board's switch is on, the runner's own recipe:

```
ANTHROPIC_BASE_URL   = DEEPSEEK_BASE_URL   // "https://api.deepseek.com/anthropic"
ANTHROPIC_AUTH_TOKEN = <the key, from the deepseek barrel>
```

Both values are named constants in `metis-env.service.ts` — `DEEPSEEK_BASE_URL` and
`DEEPSEEK_MODEL` (`"deepseek-flash"`) — each carrying a comment naming
`~/.claude/hooks/plan_runner/deepseek.py:56-57` as the canonical home they mirror. When the switch
is off, both keys are **deleted** from the `extra` before `userFacingEnv` is called, so an
`ANTHROPIC_BASE_URL` the server itself happens to carry cannot leak into a Claude child.

**The DeepSeek key comes from the deepseek module's barrel, never from a second `.env` reader.**
`server/modules/deepseek/deepseek-key.ts`'s `createDeepseekKeyReader` is already the one reader on
the TypeScript side; Phase 1 exports a ready-built `readDeepseekApiKey(): Promise<string | null>`
from `server/modules/deepseek/index.ts`, composed the way `deepseek.module.ts:24-33` composes it
(`findApplicationRoot` + `.env` + `process.env`), with a consumer comment naming
`server/modules/kanban-metis`. Nothing in `kanban-metis` opens `.env` or reads `DEEPSEEK_API_KEY`.

**The driver's dials.** Four are liveness and live in `metis-liveness.ts` beside the predicates
that read them; three are cadence and live beside the tick in `metis-driver.service.ts`. A
constant belongs next to the decision it makes.

| Constant | Home | Value | Ported from |
|---|---|---|---|
| `QUIESCE_MIN_AGE_MS` | `metis-liveness.ts` | 300 000 | `pm_capacity.py:121` |
| `QUIESCE_QUIET_MS` | `metis-liveness.ts` | 180 000 | `pm_capacity.py:118` |
| `STALL_MS` | `metis-liveness.ts` | 2 700 000 | `pm_capacity_stall.py`'s `STALL_SECS` |
| `LEASE_STALE_SECONDS` | `metis-liveness.ts`, re-exported from `server/shared/kanban-types.ts` | **40** | `KANBAN_LEASE_STALE_SECONDS` |
| `TICK_MS` | `metis-driver.service.ts` | 15 000 | `pm_capacity.py:111` (45 s there; this tick is in-process and cheap) |
| `DEFAULT_CONCURRENCY` | `metis-driver.service.ts` | 1 | `pm_capacity.py` dial, clamped `[0, 4]` |
| `CHURN_COOLDOWN_MS` | `metis-driver.service.ts` | 60 000 | `pm_capacity.py:479-488` |

One tick, in `pm_capacity.py:640-667`'s order — **reap before spawn, always**: read the live
set; mark exited children; reap the quiescent and the stalled; then, per non-archived board with
`autonomy = 1`, spawn while `live < concurrency` and `claimableCount(boardId) > 0` and no spawn
landed within `CHURN_COOLDOWN_MS`.

**The driver's routes**, mounted at `/api/kanban-metis` behind `authenticateToken`:

```
GET  /api/kanban-metis/sessions                          -> { sessions, at }
POST /api/kanban-metis/boards/:boardId/launch            -> { session }
POST /api/kanban-metis/sessions/:sessionId/stop          -> { session }
POST /api/kanban-metis/sessions/:sessionId/resume        -> { session }
GET  /api/kanban-metis/sessions/:sessionId/transcript    -> SubagentTranscriptResult
```

**The transcript route has no service of its own.** The board MINTS the session id, so there is no
launch-id-to-session-id translation to perform — the identity is the whole mapping. The route
confirms the registry knows that id (which is the authorization, and it belongs in the route),
then calls `readClaudeTranscriptBySessionId` from `server/modules/providers/index.ts:25`. That
reader already falls back to `scanProjectsRoot` when the sessions table holds no row
(`claude-transcript-activity.ts:190-197`) — and a board Metis having no row is precisely the
secluded case, so the fallback path is not an edge case here, it is the only path.

**The second mount, for the MCP child alone.** `server/index.ts` mounts the kanban router a
second time: `app.use('/api/kanban-pm', kanbanMetisSecretGuard, createKanbanModule())`. No verb is
duplicated — it is the same router over the same services, behind a different door.

**The child's credential is DERIVED, never stored.**

```
secret = HMAC-SHA256(<the app's jwt_secret>, sessionId)  ->  hex
```

`kanbanMetisSecretGuard` recomputes that HMAC for the session id the bearer claims and accepts it
only when the registry holds that session id in state `running`. Nothing is kept in memory
between restarts, because a map in memory is a map that empties on restart — and every live
Metis's next tool call would then 401 against a server that had simply forgotten her, mid-build,
with no way to recover but to kill her. Revocation is the registry's `running` set: a session that
leaves `running` stops being accepted on its next call, without anything being erased.

**The guard denies the importer at the door.** Any request path matching `/import/` is refused
`403` before the router sees it, with a comment saying why: `POST /api/kanban/import/descent`
reads a foreign database and can rewrite four hundred cards in one transaction, and no autonomous
session has business calling it. The operator's own authenticated mount still has it.

**The seclusion predicate** lives in ONE place, `claude-session-synchronizer.provider.ts`'s
`processSessionFile` (`:146`), immediately after `projectPath` is read from the transcript's own
`cwd` at `:153`:

```ts
export const KANBAN_METIS_SESSION_ROOT = path.join(os.homedir(), '.claude', 'kanban-metis');
// inside processSessionFile, right after projectPath is read:
if (isUnder(projectPath, KANBAN_METIS_SESSION_ROOT)) return null;
```

**It is keyed on the authoritative `cwd` and on nothing else.** The two call sites at `:70-71` and
`:103-105` already handle a `null` return and both do so BEFORE `sessionsDb.createSession`, which
is what keeps `projectsDb.createProjectPath` from minting a `projects` row
(`sessions.db.ts:113-115`). The earlier sites (`:66`, `:98`) are the wrong place: `cwd` has not
been parsed yet there, and a path-leaf test would have to guess the CLI's dash-encoding of a
directory name — an encoding this repository does not own and has no forward encoder for. There is
no second, path-shaped half of this predicate.

**The hooks seam.** One new module `~/.claude/hooks/kanban_metis.py`:

```python
SESSION_ROOT = os.path.expanduser("~/.claude/kanban-metis")
def board_id(payload_or_cwd) -> str | None   # the leaf under SESSION_ROOT, else None
def is_board_session(payload_or_cwd) -> bool
```

It never raises. Three consumers, one early return each:
`metis_session.maybe_stamp` gains a THIRD create trigger — a `SessionStart` (or any event) whose
`cwd` is a board session stamps the marker, which is the board-issued identity replacing a typed
`/pm`; `enforce_metis_contract._guard_stop` (G4) and the G4b autonomy branch **stand down** when
`kanban_metis.is_board_session(payload)` — both read Descent's store and would judge a board
session against the wrong board.

**Descent-only until sunset, and why each needs no change.** G3 (`metis_footprint`), G6
(`metis_honesty`), G7 (`metis_freshness`), G8 (`metis_followup`) and G9
(`metis_followup_questions`) all trigger on a literal `mcp__descent-pm__*` tool name; a board
session's tools are `mcp__kanban-pm__*`, so none of them ever fires. G1 (`metis_plan_lint`),
G2 (`metis_git_detect`), G5 (the terminal-prompt gate) and G10 (`metis_sql_gate`) carry no
Descent coupling and **do** apply to a board session, which is what this plan wants: G5 in
particular is what keeps her from asking the operator through a chat prompt.

**The client.** `api.kanbanMetis` joins `src/shared/api.ts` beside `api.kanban`;
`src/modules/kanban/hooks/useKanbanMetis.ts` seeds once by REST and then listens for the
`kanban_metis_state` frame, the way `SoulLaunchFeed.tsx:46-79` does;
`src/modules/kanban/KanbanMetisPanel.tsx` is a sibling of `KanbanCardDrawer` inside
`KanbanPanel.tsx`. `SubagentTranscriptTarget` gains a third kind, `'metis'`, so
`useSubagentTranscript` and `SubagentTranscriptView` are reused rather than copied.

## Project Constraints

Copied verbatim to every child. These are the rules and the mechanics, both.

1. **No test files, ever.** No `*.test.ts`, no `*.spec.ts`, no vitest or `node:test` file, no new
   entry under any `tests/` directory. This repository's backend and frontend standards
   documents each ask for tests; that clause is **OVERRIDDEN** by the operator's standing rule,
   and the `check` and `[[verify]]` commands in this plan are the verification. Where a standards
   document and this line disagree, this line wins.
2. **No branches, and no git writes of any kind inside the run** — no `add`, `commit`, `stash`,
   `checkout`, `restore`, `reset`, `clean`, `push`. The work ends in the working tree. A probe is
   undone from a backup copy taken by the same command, never with `git checkout --`.
3. **Healed means deleted.** No SUPERSEDED block, no "previously this was…", no pointer to
   removed text, no dead tempting code left behind.
4. **Module size.** 300 LOC is the default ceiling, 500 soft, 800 hard. Several splits are made
   FOR you at plan time and are not yours to re-merge: the `kanban-metis` module's service files,
   the `mcp/` directory under it, the brief's chapters. Never append a hundred lines to
   `server/shared/types.ts` or `src/shared/types.ts` — those two take exactly four small edits in
   this whole plan (`'kanban_metis_state'` on `GatewayEventKind` and the two session types on the
   server side, the mirror on the client side). Everything else lives in
   `server/shared/kanban-types.ts` and `src/shared/kanban-types.ts` or in the new module.
5. **Descent is not touched.** `~/.claude/descent/`, `~/.claude/commands/pm.md` and
   `~/.claude/descent/pm-chapters/` are READ-ONLY in every phase of this plan — read them, copy
   from them, never edit or delete them. Descent keeps running in parallel until it is sunset by
   some later plan. `server/modules/descent/` in this repo is the memory-intake and accounts
   proxy; it is unrelated to this work and is never imported here.
6. **`~/.claude/CLAUDE.md` is the operator's file and is never edited by this plan.**
7. **Cross-module imports go through barrels.** `server/modules/kanban-metis/` reaches the board
   only through `server/modules/kanban/index.ts`, the settings writer only through
   `server/modules/settings/index.ts`, the DeepSeek key only through
   `server/modules/deepseek/index.ts`, and the transcript reader only through
   `server/modules/providers/index.ts`. It never deep-imports a route, a repository or an internal
   service. On the client, `src/modules/kanban/index.ts` still exports `KanbanPanel` and nothing
   else.
7a. **The MCP program is a LEAF.** `kanban-pm-mcp.ts` and everything under
   `server/modules/kanban-metis/mcp/` import only from `mcp/` itself, from `node:` builtins, and
   from `server/shared/`. Never this module's own barrel, never `@/modules/*`, never a service.
   It runs as a separate PROCESS with no server in it: an import reaching back into the module
   would drag a database handle, a router and a websocket fan-out into a stdio child that must
   start in milliseconds and hold nothing.
8. **The real-system harness.** These three snippets are proven working on this box (2026-09-15);
   use them verbatim rather than inventing a variant.

```bash
# (a) Mint a JWT for the first user, from the real database's own secret.
mint_token() {
  python3 - <<'PY'
import sqlite3, json, hmac, hashlib, base64, time, os
conn = sqlite3.connect(os.path.expanduser('~/.cloudcli/auth.db'))
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

# (b) Boot a SECOND server on port 7893 against the real database, wait for it, and keep the
#     operator's local-server.json marker intact.
boot_probe_server() {
  cp ~/.cloudcli/local-server.json /tmp/metis-marker.bak 2>/dev/null || true
  SERVER_PORT=7893 node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts \
    > /tmp/metis-server.log 2>&1 &
  echo $! > /tmp/metis-server.pid
  for i in $(seq 1 90); do curl -sf http://127.0.0.1:7893/api/auth/status > /dev/null && break; sleep 1; done
}

# (c) Stop it and put the marker back.
stop_probe_server() {
  kill "$(cat /tmp/metis-server.pid)" 2>/dev/null || true
  sleep 1
  cp /tmp/metis-marker.bak ~/.cloudcli/local-server.json 2>/dev/null || true
}
```

9. **Probe data is cleaned up by the command that made it.** A phase that creates a board names it
   `probe-metis<N>` and archives it before the command ends (`PATCH /api/kanban/boards/<id>` with
   a JSON body setting `archived` true), so a re-run finds exactly one live probe board again.
   A phase that spawns a Metis child kills it and removes its state directory before the command
   ends.
10. **Never run `npm run dev`** (it starts Vite and the server together and never exits). Use
    `npm run build:client`, `npm run typecheck`, `npm run lint` and the boot snippet above. Any
    command that can exceed two minutes carries a `timeout` or runs in the background.
11. **A second server writing the same SQLite file is expected and fine.** The operator's own
    server may be running on port 3011 against the same `auth.db`. On a `SQLITE_BUSY` run the
    command once more; if it fails again, file `[BLOCKED: sqlite busy]` rather than changing the
    pragma or the file path.
12. **`docs/kanban.md` is the ONE documentation home for this board and its driver.** No phase
    creates `server/modules/kanban-metis/README.md`, `docs/kanban-metis.md` or any other new
    document about this work. Phase 11 updates `docs/kanban.md`, `docs/plan-runner.md` and
    `~/.claude/hooks/README.md`, and nothing else.
13. **The divergence rule.** If reality differs from this plan — a file is not where it says, a
    signature differs, a check fails for a reason the plan does not name — STOP, report the
    divergence verbatim, and do not improvise a fix.

## Phase 1 — The board column, the claimable read, and the generalised flag writer
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
  "server/modules/database/kanban-schema.ts",
  "server/modules/database/migrations.ts",
  "server/modules/database/repositories/kanban-boards.db.ts",
  "server/modules/kanban/kanban-boards.service.ts",
  "server/modules/kanban/routes/board.routes.ts",
  "server/shared/kanban-types.ts",
  "src/shared/kanban-types.ts",
  "server/modules/settings/deepseek-flash-switch.ts",
  "server/modules/settings/index.ts",
  "server/modules/deepseek/index.ts",
]
forbidden = [
  "server/modules/kanban/kanban-write.service.ts",
  "server/modules/settings/settings.routes.ts",
  "server/modules/settings/settings.service.ts",
  "src/modules/kanban",
]
athena = [
  "The column was added to kanban-schema.ts only, so an existing ~/.cloudcli/auth.db never grows it and every read of board.deepseekFlash is undefined on the operator's real database",
  "updateBoard writes deepseek_flash but the row-to-board mapper never reads it back, so the PATCH answers with the old value and the UI switch springs back",
  "countClaimable compares build_lease_at against a JavaScript Date rather than an ISO-8601 string, so the stale test is always false and the driver never sees orphaned active cards",
  "writeFlagFile was factored out but writeDeepseekFlashSwitch no longer realpaths the destination, so a symlinked host-wide flag silently stops being shared after one toggle",
  "The board PATCH route accepts a non-boolean deepseekFlash and coerces it instead of answering 400, breaking the type contract every other field on that route keeps",
  "The ALTER was appended to the projects or sessions migration body instead of its own function, so a kanban column now runs inside a projects rebuild nobody reading this table would think to open",
  "readDeepseekApiKey was exported from the deepseek barrel but built with a different .env path than deepseek.module.ts uses, so the balance route and the Metis spawn read two different keys",
  "migrateKanbanBoardsColumns is not idempotent, so a boot against a database that already carries deepseek_flash throws 'duplicate column name' and the server never listens",
  "The ALTER declares the column differently from kanban-schema.ts (nullable, or without DEFAULT 0), so a fresh database and the operator's migrated one disagree and a pre-existing board reads deepseekFlash from NULL",
]

[[steps]]
kind = "edit"
path = "server/modules/database/kanban-schema.ts"
what = "Add `deepseek_flash INTEGER NOT NULL DEFAULT 0` to the CREATE TABLE IF NOT EXISTS kanban_boards body, directly after the `autonomy` column, per Interfaces."
check = "grep -c 'deepseek_flash INTEGER NOT NULL DEFAULT 0' server/modules/database/kanban-schema.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/database/migrations.ts"
what = "Add a new migrateKanbanBoardsColumns(db: Database): void, built in the shape of rebuildProjectsTableWithPrimaryKeySchema at migrations.ts:122-131 — its own tableExists guard, its own getTableInfo column read, then addColumnToTableIfNotExists(db, 'kanban_boards', columnNames, 'deepseek_flash', 'INTEGER NOT NULL DEFAULT 0'). Call it on the line immediately after db.exec(KANBAN_SCHEMA_SQL) at migrations.ts:577. Do NOT extend the projects or sessions migration bodies. You WILL see ~/.cloudcli/auth.db carry deepseek_flash within seconds of saving this file: deploy/dev-supervisor restarts the API on every working-tree edit and runs your migration against the live database (measured 2026-09-16, attempt 1: `Running migration: Adding deepseek_flash column to kanban_boards table` at 15:45:50). That is the migration working, not a divergence. Do NOT drop the column from the live database, do NOT stop or pause the supervisor, and do NOT copy or restore auth.db to recreate a column-less state; the last [[verify]] reads the live column's definition after the boot, and nothing in this phase needs the column absent."
check = "grep -c 'migrateKanbanBoardsColumns' server/modules/database/migrations.ts"
expect = "2"

[[steps]]
kind = "edit"
path = "server/modules/database/repositories/kanban-boards.db.ts"
what = "Add deepseek_flash to BOARD_COLUMNS and to BOARD_PATCH_COLUMNS (mapping the camelCase deepseekFlash), map it to a boolean in the row-to-KanbanBoard mapper, and add countClaimable(boardId, staleSeconds) with the SQL given in Interfaces verbatim."
check = "grep -c 'deepseek_flash' server/modules/database/repositories/kanban-boards.db.ts"
expect_re = "^[3-9]$|^[1-9][0-9]$"

[[steps]]
kind = "edit"
path = "server/shared/kanban-types.ts"
what = "Add `deepseekFlash: boolean;` to the KanbanBoard type with a doc comment saying it is the board's own DeepSeek Flash switch and that the host-wide flag file is never consulted for anything this board launches."
check = "grep -c 'deepseekFlash: boolean' server/shared/kanban-types.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "src/shared/kanban-types.ts"
what = "Mirror the same `deepseekFlash: boolean;` field onto the client's KanbanBoard type, with the same comment."
check = "grep -c 'deepseekFlash: boolean' src/shared/kanban-types.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/kanban/kanban-boards.service.ts"
what = "Add `deepseekFlash?: boolean` to updateBoard's patch parameter type and pass it through to the repository. Add claimableCount(boardId: string): number, which calls kanbanBoardsDb.countClaimable with KANBAN_LEASE_STALE_SECONDS imported from server/shared/kanban-types.js. It is a READ and takes no write seam."
check = "grep -c 'claimableCount' server/modules/kanban/kanban-boards.service.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban/routes/board.routes.ts"
what = "Parse an optional boolean deepseekFlash on PATCH /boards/:boardId exactly as autonomy is parsed (400 on a non-boolean), and add GET /boards/:boardId/claimable answering { claimable: number } from boards.claimableCount."
check = "grep -c 'deepseekFlash\\|claimable' server/modules/kanban/routes/board.routes.ts"
expect_re = "^[3-9]$|^[1-9][0-9]$"

[[steps]]
kind = "edit"
path = "server/modules/settings/deepseek-flash-switch.ts"
what = "Extract readFlagFile(filePath) and writeFlagFile(filePath, enabled) per Interfaces, carrying the 256-byte ceiling, the SWITCH_TRIM class, the realpath, the pid+randomUUID scratch, the rename and the finally-unlink. Rebuild readDeepseekFlashSwitch and writeDeepseekFlashSwitch as one-line callers over SWITCH_PATH. Their behaviour must not change."
check = "grep -c 'export async function writeFlagFile\\|export async function readFlagFile' server/modules/settings/deepseek-flash-switch.ts"
expect = "2"

[[steps]]
kind = "edit"
path = "server/modules/settings/index.ts"
what = "Export readFlagFile and writeFlagFile through the settings barrel, each with the consumer comment the standards require, naming server/modules/kanban-metis as the consumer and why."
check = "grep -c 'writeFlagFile' server/modules/settings/index.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/deepseek/index.ts"
what = "Export a ready-built readDeepseekApiKey(): Promise<string | null> from the deepseek barrel, composed EXACTLY the way deepseek.module.ts:24-33 composes createDeepseekKeyReader — findApplicationRoot(getModuleDirectory(import.meta.url)) for the .env path, () => process.env for the environment, readFile for the file — so the balance route and this new consumer can never read two different keys. Give it the consumer comment the standards require, naming server/modules/kanban-metis and saying it is the ONE TypeScript-side reader of DEEPSEEK_API_KEY."
check = "grep -c 'readDeepseekApiKey' server/modules/deepseek/index.ts"
expect = "1"

[[steps]]
kind = "run"
cmd = "npm run typecheck"
check = "npm run typecheck > /tmp/metis-p1-tc.log 2>&1; echo $?"
expect = "0"
timeout_s = 420

[[verify]]
cmd = '''
set -e
cd /home/lyphe/.claude/claudecodeui_lyphe
source /dev/stdin <<'HARNESS'
mint_token() {
  python3 - <<'PY'
import sqlite3, json, hmac, hashlib, base64, time, os
conn = sqlite3.connect(os.path.expanduser('~/.cloudcli/auth.db'))
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
HARNESS
cp ~/.cloudcli/local-server.json /tmp/metis-marker.bak 2>/dev/null || true
SERVER_PORT=7893 node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > /tmp/metis-server.log 2>&1 &
echo $! > /tmp/metis-server.pid; cp /tmp/metis-server.pid /tmp/metis-server.pid.last
for i in $(seq 1 90); do curl -sf http://127.0.0.1:7893/api/auth/status > /dev/null && break; sleep 1; done
T=$(mint_token)
B=$(curl -sf -X POST http://127.0.0.1:7893/api/kanban/boards -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"name":"probe-metis1"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["board"]["id"])')
ON=$(curl -sf -X PATCH http://127.0.0.1:7893/api/kanban/boards/$B -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"deepseekFlash":true}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["board"]["deepseekFlash"])')
BAD=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH http://127.0.0.1:7893/api/kanban/boards/$B -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"deepseekFlash":"yes"}')
CL=$(curl -sf http://127.0.0.1:7893/api/kanban/boards/$B/claimable -H "Authorization: Bearer $T" | python3 -c 'import sys,json; print(json.load(sys.stdin)["claimable"])')
curl -sf -X PATCH http://127.0.0.1:7893/api/kanban/boards/$B -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"archived":true}' > /dev/null
kill "$(cat /tmp/metis-server.pid)" 2>/dev/null || true
sleep 1
cp /tmp/metis-marker.bak ~/.cloudcli/local-server.json 2>/dev/null || true
echo "FLAG=$ON BAD=$BAD CLAIMABLE=$CL"
'''
expect = "FLAG=True BAD=400 CLAIMABLE=0"
timeout_s = 420

[[verify]]
cmd = '''
set -e
cd /home/lyphe/.claude/claudecodeui_lyphe
python3 - <<'PY'
import sqlite3, os
conn = sqlite3.connect(os.path.expanduser('~/.cloudcli/auth.db'))
rows = [r for r in conn.execute('PRAGMA table_info(kanban_boards)') if r[1] == 'deepseek_flash']
print('COLUMN', len(rows), ' '.join(f'type={r[2]} notnull={r[3]} default={r[4]}' for r in rows))
PY
'''
expect = "COLUMN 1 type=INTEGER notnull=1 default=0"
timeout_s = 120
```

**What to build.** One column, its migration, its two type mirrors, its route parse, one board
read, and one honest extraction in the settings writer. Nothing spawns anything in this phase.

**Why both schema edits.** `kanban-schema.ts` is `IF NOT EXISTS` end to end, which is what makes
it safe to re-run at every boot — and is exactly why editing it alone does nothing to the
operator's live `~/.cloudcli/auth.db`, which already has this table. The first `[[verify]]`
proves the server can write and read the column after the migration ran at boot; the second reads
the live file's own `PRAGMA table_info` and proves the column is there with the schema's exact
definition — a table that predates this phase can only have gained it through the `ALTER`. A
"before" probe cannot live in a post-build verify: `deploy/dev-supervisor` runs the migration
against the live file the moment `migrations.ts` is saved (attempt 1, 2026-09-16).

**Sirens.** You will want to write the per-board flag FILE here, when the PATCH lands. Do not —
the flag file is derived at spawn time from the board row (Phase 7), and a listener here would
couple the board's data lane to a file-writing concern the board does not own. You will want to
add `deepseekFlash` to the `board.updated` event payload; do not, the event payload shape is not
yours this phase. You will want to "fix" `kanban-schema.ts`'s header comment about needing a
migration; it is correct and it is the reason this phase has two edits. You will see the live
`auth.db` already carrying `deepseek_flash` before you run a single verify; do not drop it, do not
stop the supervisor, do not restore the file — that is your migration having run, and step 2 says
so.

## Phase 2 — The board's DeepSeek switch, composed
Depends on: Phase 1

```toml
[phase]
id = "2"
builder = "iris"
model = "fable"
kind = "scaffold"
code_change = true
doc_sweep = "foreground"
expected_s = 1800
manifest = [
  "src/modules/kanban/KanbanBoardHeader.tsx",
  "src/modules/i18n/locales/en/common.json",
]
forbidden = [
  "src/modules/kanban/KanbanPanel.tsx",
  "src/modules/kanban/hooks/useKanbanBoards.ts",
  "src/shared/api.ts",
  "src/i18n",
]
athena = [
  "The DeepSeek control was drawn as a second bare Switch with no mark, so a reader cannot tell the two toggles apart at a glance in the header's cramped right edge",
  "A FILL: marker was left on a prop the scaffold actually needs to render, so the header does not paint at all until Phase 3 lands",
  "The new control has no disabled state for the no-board case, so it reads as interactive on an empty board where Autonomy correctly reads as dead",
  "New copy was hard-coded in English instead of going through the t() call every other string in this header uses",
  "A raw hex or var(--token) colour was spelled instead of a Tailwind name, breaking the one-source rule in src/shared/ui/verve/README.md",
  "A key the header calls through t('kanban.board.…') is absent from src/modules/i18n/locales/en/common.json, or was spelled differently there, so the header paints the raw key path instead of the words",
  "The new strings were also written into one of the ten non-English common.json bundles, when config.ts's fallbackLng 'en' is what carries them to every other language",
]

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanBoardHeader.tsx"
what = "Compose a second control in the header's right-edge cluster, directly after the Autonomy Switch: the board's DeepSeek Flash toggle. It is a `Switch` from '@/shared/ui' wearing the DeepSeek mark — render `LLMProviderLogo` with provider=\"deepseek\" (src/shared/ui/LLMProviderLogo.tsx, which branches to DeepSeekLogo) as the label glyph beside it, the way ComposerDeepSeekSwitch.tsx pairs the two. Give it checked, onChange and disabled props exactly as the Autonomy Switch has them, a t('kanban.board.deepseekFlash') label, and a Tooltip from '@/shared/ui' whose content is t('kanban.board.deepseekFlashTooltip'). Draw every state: off, on, and disabled with no board. Use FILL: markers for the two handlers only — `// FILL: deepseekFlash` for the checked value and `// FILL: onToggleDeepseekFlash` for the change handler — and give them fake literal props so the header renders as-is. Add deepseekFlash: boolean and onToggleDeepseekFlash: (next: boolean) => void to KanbanBoardHeaderProps. Do not touch the ActionMenu items. ATTEMPT 1 ALREADY LANDED THIS STEP IN THE WORKING TREE: the header is 196 lines, the two markers sit on the destructuring lines (`deepseekFlash = false, // FILL: deepseekFlash` and `onToggleDeepseekFlash = () => {}, // FILL: onToggleDeepseekFlash`), the Switch reads `checked={deepseekFlash}` / `onChange={onToggleDeepseekFlash}`, and the Tooltip is a fixed `w-56`, `position=\"bottom\"`, anchored on the mark+word pair. The line numbers `106-119` the first draft of this step named are therefore stale — find the Autonomy Switch by its `t('kanban.board.autonomy')` call. When this step's check already reads 2 and `grep -c LLMProviderLogo`, `grep -c \"t('kanban.board.deepseekFlash')\"` and `grep -c \"t('kanban.board.deepseekFlashTooltip')\"` on the header are each at least 1, the composition is present: read it against the states above, correct only what fails them, and do not recompose it from scratch."
check = "grep -c 'FILL:' src/modules/kanban/KanbanBoardHeader.tsx"
expect = "2"

[[steps]]
kind = "edit"
path = "src/modules/i18n/locales/en/common.json"
what = "The English locale bundle is src/modules/i18n/locales/en/common.json — there is no src/i18n in this repository; the first draft of this step named that path wrongly. Inside the `kanban` → `board` object, on the two lines directly after `\"autonomy\": \"Autonomy\",` (line 48 today), add exactly these two entries, in this order, each followed by a comma: `\"deepseekFlash\": \"DeepSeek Flash\"` and `\"deepseekFlashTooltip\": \"Puts this board's Metis, and every plan runner she starts, on DeepSeek Flash.\"`. The label is the visible word beside the whale and the Switch's aria-label, so it stays two words. The tooltip is 77 characters on purpose: the bubble is a fixed `w-56` and measured three lines tall at that length at 390px and 1280px — do not lengthen it. Keep the file valid JSON with its existing two-space indentation. Add nothing to any other language file: src/modules/i18n/config.ts:220 sets `fallbackLng: 'en'`, so every other language renders these English words until it is translated."
check = '''python3 -c 'import json; b=json.load(open("src/modules/i18n/locales/en/common.json"))["kanban"]["board"]; print(b.get("deepseekFlash"), "|", b.get("deepseekFlashTooltip"))' '''
expect = "DeepSeek Flash | Puts this board's Metis, and every plan runner she starts, on DeepSeek Flash."

[[steps]]
kind = "run"
cmd = "npm run build:client"
check = "npm run build:client > /tmp/metis-p2-build.log 2>&1; echo $?"
expect = "0"
timeout_s = 420

[[verify]]
cmd = "grep -c 'LLMProviderLogo' src/modules/kanban/KanbanBoardHeader.tsx"
expect_re = "^[1-9][0-9]*$"

[[verify]]
cmd = "{ grep -cE \"#[0-9a-fA-F]{3,6}|var\\\\(--\" src/modules/kanban/KanbanBoardHeader.tsx || true; }"
expect = "0"
timeout_s = 120

[[verify]]
cmd = '''python3 -c 'import json,re,functools; b=json.load(open("src/modules/i18n/locales/en/common.json")); src=open("src/modules/kanban/KanbanBoardHeader.tsx").read(); keys=sorted(set(re.findall(r"t\(\x27([A-Za-z0-9_.]+)\x27", src))); miss=[k for k in keys if not isinstance(functools.reduce(lambda d, p: d.get(p) if isinstance(d, dict) else None, k.split("."), b), str)]; print(len(miss), "missing:", *miss)' '''
expect = "0 missing:"

[[verify]]
cmd = "{ grep -l 'deepseekFlash' src/modules/i18n/locales/*/common.json || true; } | wc -l"
expect = "1"
```

**What to build.** The screen only: composition, states, copy. No data, no wiring, no hook.

**Sirens.** You will want to reach into `useKanbanBoards` and wire the toggle while you are here
— that is Phase 3's whole job and its files are forbidden to you. You will want to add a menu
item for it in the ActionMenu; the operator asked for a `Switch` beside Autonomy, not a menu
entry. You will want to give the DeepSeek control a colour of its own to distinguish it; the
mark is the distinction, and a new colour is a second palette.

You will find the header already composed by the first attempt. Do not tear it down to rebuild
it your own way; read it against step 1's states, fix only what fails them, and spend the
attempt on the two strings. You will see ten other `common.json` bundles beside the English one,
each carrying `autonomy` in its own language, and want to translate the new strings into them —
do not; `fallbackLng: 'en'` covers them and the last verify counts exactly one bundle. You will
want to create `src/i18n` because an older line of this plan named it — it is forbidden now; the
English bundle is the one file named in step 2. If you run `npm run typecheck`, it reports that
`KanbanPanel` does not pass `deepseekFlash` / `onToggleDeepseekFlash` — Vite's build does not
typecheck and passes; that red is Phase 3's step to cure, `KanbanPanel.tsx` is forbidden to you,
so note it in your report and keep rowing. Never make the two props optional to silence it.

## Phase 3 — The switch, wired to the board row
Depends on: Phase 2

```toml
[phase]
id = "3"
builder = "hephaestus"
model = "opus"
kind = "fill"
scaffold_of = "2"
code_change = true
doc_sweep = "foreground"
expected_s = 1800
manifest = [
  "src/modules/kanban/KanbanBoardHeader.tsx",
  "src/modules/kanban/KanbanPanel.tsx",
  "src/modules/kanban/hooks/useKanbanBoards.ts",
]
forbidden = [
  "src/shared/kanban-types.ts",
  "server/modules/kanban",
]
athena = [
  "The optimistic paint was left in place on a refused PATCH, so a 400 leaves the switch showing a position the board row does not hold",
  "deepseekFlash was added to KanbanBoardPatch but useKanbanBoards never re-reads after the write, so a second surface keeps the old value until a refresh",
  "The toggle fires with currentBoardId null and sends a PATCH to /boards/null",
  "A FILL: token survives in the shipped file",
  "The composition outside the FILL markers was rewritten rather than filled, so the scaffold's states and copy no longer match what was reviewed",
]

[[steps]]
kind = "edit"
path = "src/modules/kanban/hooks/useKanbanBoards.ts"
what = "Add `deepseekFlash?: boolean` to KanbanBoardPatch (lines 25-30) and add a deepseekFlash boolean to the KanbanBoards return shape, read off the current board the same way `autonomy` is. updateBoard already carries an arbitrary patch to api.kanban.updateBoard, so no new write path is needed — add the toast wording for this field to saidFor."
check = "grep -c 'deepseekFlash' src/modules/kanban/hooks/useKanbanBoards.ts"
expect_re = "^[2-9]$|^[1-9][0-9]$"

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanBoardHeader.tsx"
what = "Replace the two FILL: markers with the real props: the checked value comes from the new deepseekFlash prop, and onChange calls onToggleDeepseekFlash. Change nothing else in the file — the composition, states and copy outside the marker lines stay byte-identical."
check = "{ grep -c 'FILL:' src/modules/kanban/KanbanBoardHeader.tsx || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanPanel.tsx"
what = "Pass deepseekFlash and onToggleDeepseekFlash to KanbanBoardHeader at its call site (lines 174-195), in the same shape onToggleAutonomy uses: guard on currentBoardId, then void updateBoard(currentBoardId, { deepseekFlash: next })."
check = "grep -c 'onToggleDeepseekFlash' src/modules/kanban/KanbanPanel.tsx"
expect = "1"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint:client"
check = "npm run typecheck > /tmp/metis-p3-tc.log 2>&1 && npm run lint:client >> /tmp/metis-p3-tc.log 2>&1; echo $?"
expect = "0"
timeout_s = 480

[[verify]]
cmd = '''
set -e
cd /home/lyphe/.claude/claudecodeui_lyphe
cp ~/.cloudcli/local-server.json /tmp/metis-marker.bak 2>/dev/null || true
SERVER_PORT=7893 node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > /tmp/metis-server.log 2>&1 &
echo $! > /tmp/metis-server.pid
for i in $(seq 1 90); do curl -sf http://127.0.0.1:7893/api/auth/status > /dev/null && break; sleep 1; done
T=$(python3 - <<'PY'
import sqlite3, json, hmac, hashlib, base64, time, os
conn = sqlite3.connect(os.path.expanduser('~/.cloudcli/auth.db'))
secret = conn.execute("select value from app_config where key='jwt_secret'").fetchone()[0].encode()
uid, uname = conn.execute('select id, username from users order by id limit 1').fetchone()
enc = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(',', ':')).encode()).rstrip(b'=')
now = int(time.time())
head = enc({'alg': 'HS256', 'typ': 'JWT'})
body = enc({'userId': uid, 'username': uname, 'iat': now, 'exp': now + 3600})
sig = base64.urlsafe_b64encode(hmac.new(secret, head + b'.' + body, hashlib.sha256).digest()).rstrip(b'=')
print((head + b'.' + body + b'.' + sig).decode())
PY
)
B=$(curl -sf -X POST http://127.0.0.1:7893/api/kanban/boards -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"name":"probe-metis3"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["board"]["id"])')
node scripts/kanban-ui-probe.mjs http://127.0.0.1:7893 "$T" "claudecodeui_lyphe" "Kanban" "DeepSeek" > /tmp/metis-p3-probe.log 2>&1 && R=PROBE-OK || R=PROBE-FAILED
curl -sf -X PATCH http://127.0.0.1:7893/api/kanban/boards/$B -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"archived":true}' > /dev/null
kill "$(cat /tmp/metis-server.pid)" 2>/dev/null || true
sleep 1
cp /tmp/metis-marker.bak ~/.cloudcli/local-server.json 2>/dev/null || true
echo "$R"
'''
expect = "PROBE-OK"
timeout_s = 560
```

**What to build.** The two handlers and the one prop hop. The scaffold's composition is finished
and is not yours to re-draw.

**Sirens.** You will want to write the per-board flag file from the client or from the PATCH
handler; it is derived at spawn (Phase 7) and nothing writes it here. You will want to invert
the switch on a failed write; `useKanbanMutations`' rule is that the SERVER's answer is what
paints, and `updateBoard` already re-reads.

## Phase 4 — The kanban-pm MCP server, twenty-five tools over the board's own verbs
Depends on: none

```toml
[phase]
id = "4"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 3600
manifest = [
  "server/modules/kanban-metis/kanban-pm-mcp.ts",
  "server/modules/kanban-metis/mcp",
  "server/modules/kanban-metis/index.ts",
  "server/modules/cli/cli.service.ts",
  "server/shared/mcp-command.ts",
  "server/modules/browser-use/browser-use.service.ts",
]
forbidden = [
  "server/modules/kanban",
  "server/modules/browser-use/browser-use-mcp.ts",
  "package.json",
]
athena = [
  "A tool answers with a fabricated success shape when the HTTP call returned a non-2xx, so Metis records work the board never did",
  "set_status to active moves the card but never claims the build lease, so two sessions can hold one card",
  "The heartbeat interval keeps the process alive after stdin closes, leaving an orphan node process per Metis session",
  "The four lesson stubs answer with isError false and an empty list, so Metis reads 'no lessons yet' as fact instead of 'not on this board'",
  "search_history or list_actionable pages a lane without a limit and pulls the whole board into one tool result",
  "A tool name drifted from descent-pm's spelling, so the ported brief calls a tool that does not exist",
  "resolveMcpCommand was extracted but its dist-first / tsx / cloudcli order changed, so browser-use silently stops resolving in one of the two layouts",
  "browser-use.service.ts kept its own private copy of the resolver beside the extracted one, so there are now two",
  "kanban-pm-mcp.ts or a file under mcp/ imports this module's barrel or an @/modules path, dragging a database handle and a router into a stdio child",
]

[[steps]]
kind = "edit"
path = "server/shared/mcp-command.ts"
what = "A PURE MOVE, zero behaviour change: lift browser-use.service.ts:161-188's getMcpCommand() into resolveMcpCommand(scriptBaseName: string, cliVerb: string): { command: string; args: string[] }, keeping its three branches and their order exactly — the compiled <base>.js beside the caller first, then node_modules/.bin/tsx with server/tsconfig.json and the <base>.ts source, then the cloudcli bin with cliVerb. Give it the shared-utility doc comment the backend standards require, naming both consumers."
check = "grep -c 'export function resolveMcpCommand' server/shared/mcp-command.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/browser-use/browser-use.service.ts"
what = "Delete the private getMcpCommand() and compose resolveMcpCommand('browser-use-mcp', 'browser-use-mcp') in its place. Nothing else in this file changes, and no second copy of the resolver survives."
check = "{ grep -c 'function getMcpCommand' server/modules/browser-use/browser-use.service.ts || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/mcp/mcp-protocol.ts"
what = "The stdio JSON-RPC 2.0 transport, in the shape of server/modules/browser-use/browser-use-mcp.ts's own loop: read newline-delimited JSON off process.stdin, answer initialize with protocolVersion and serverInfo { name: 'kanban-pm' }, answer notifications/initialized with nothing, route tools/list and tools/call to a handler table, and write every response with a trailing newline on stdout. Nothing but a JSON-RPC message ever reaches stdout; diagnostics go to stderr."
check = "grep -c \"name: 'kanban-pm'\" server/modules/kanban-metis/mcp/mcp-protocol.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/mcp/kanban-pm-client.ts"
what = "The board's HTTP client and nothing else: read KANBAN_PM_API_URL, KANBAN_PM_TOKEN, KANBAN_PM_BOARD_ID and KANBAN_PM_OWNER from process.env, refuse to start if any is missing, and expose typed get/post/patch/del helpers that send Authorization: Bearer and throw a named error carrying the status and the body on any non-2xx. It opens no database and imports nothing from server/modules/kanban."
check = "grep -c 'KANBAN_PM_API_URL\\|KANBAN_PM_OWNER' server/modules/kanban-metis/mcp/kanban-pm-client.ts"
expect_re = "^[2-9]$|^[1-9][0-9]$"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/mcp/kanban-pm-tools-cards.ts"
what = "The card tools, each exactly per the Interfaces table: list_features, list_features_all, get_feature_plan, create_feature, attach_plan, set_status, set_tags, archive_feature, set_closing_remarks. Each declares a raw JSON-Schema inputSchema with the same argument names, types and required set descent-pm uses. set_status to 'active' also claims the build lease and records the card id for the heartbeat."
check = "grep -c \"'list_features'\\|'set_status'\\|'create_feature'\" server/modules/kanban-metis/mcp/kanban-pm-tools-cards.ts"
expect_re = "^[3-9]$|^[1-9][0-9]$"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/mcp/kanban-pm-tools-detail.ts"
what = "The detail tools per the Interfaces table: open_design_questions, post_design_questions, answer_design_question, get_learned_selections, file_issue, resolve_issue, set_checklist, set_checklist_item, approve_feature."
check = "grep -c \"'post_design_questions'\\|'approve_feature'\\|'set_checklist_item'\" server/modules/kanban-metis/mcp/kanban-pm-tools-detail.ts"
expect_re = "^[3-9]$|^[1-9][0-9]$"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/mcp/kanban-pm-tools-board.ts"
what = "The board-level tools per the Interfaces table: list_actionable, list_active_builds, claim_plan, search_history, and the three honest lesson stubs stage_lesson, list_lessons and get_lesson, each answering isError true with the exact sentence the Interfaces section quotes. list_actionable's `lessons` key is always an empty array."
check = "grep -c 'lessons are not on this board yet' server/modules/kanban-metis/mcp/kanban-pm-tools-board.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/mcp/kanban-pm-heartbeat.ts"
what = "A 10000 ms setInterval that refreshes the build and plan leases for the card ids this process claimed, over POST /cards/:id/build-lease/refresh and the plan-lease route, with the owner from KANBAN_PM_OWNER. It writes nothing to stdout, swallows every error, and unref()s its timer so a closed stdin ends the process."
check = "grep -c '10000' server/modules/kanban-metis/mcp/kanban-pm-heartbeat.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/kanban-pm-mcp.ts"
what = "The entry point: a #!/usr/bin/env node shebang, the tool table assembled from the three tools modules, the transport started, the heartbeat started, and an exit when stdin closes. Keep it under 120 lines — it composes, it does not implement."
check = "head -1 server/modules/kanban-metis/kanban-pm-mcp.ts"
expect = "#!/usr/bin/env node"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/index.ts"
what = "The module barrel. This phase exports nothing but the MCP command resolver: getKanbanPmMcpCommand(): { command: string; args: string[] }, a copy of browser-use.service.ts:161-188's getMcpCommand shape pointed at kanban-pm-mcp.js / kanban-pm-mcp.ts / the cloudcli bin. Give it the consumer comment the standards require."
check = "grep -c 'getKanbanPmMcpCommand' server/modules/kanban-metis/index.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/modules/cli/cli.service.ts"
what = "Add `case 'kanban-pm-mcp':` to the command table beside the existing 'browser-use-mcp' case at line 238, in the same shape, so the cloudcli bin can start this server."
check = "grep -c \"case 'kanban-pm-mcp'\" server/modules/cli/cli.service.ts"
expect = "1"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint:server"
check = "npm run typecheck > /tmp/metis-p4-tc.log 2>&1 && npm run lint:server >> /tmp/metis-p4-tc.log 2>&1; echo $?"
expect = "0"
timeout_s = 480

[[verify]]
cmd = '''
set -e
cd /home/lyphe/.claude/claudecodeui_lyphe
printf '%s\n%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
| node_modules/.bin/tsx --tsconfig server/tsconfig.json server/modules/browser-use/browser-use-mcp.ts 2>/dev/null \
| python3 -c '
import sys, json
n = 0
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    msg = json.loads(line)
    if msg.get("id") == 2: n = len(msg["result"]["tools"])
print("BROWSER_USE_TOOLS=%d" % n)
'
'''
expect_re = "BROWSER_USE_TOOLS=[1-9][0-9]*"
timeout_s = 300

[[verify]]
cmd = "python3 -c \"import glob; fs = glob.glob('server/modules/kanban-metis/mcp/*.ts') + ['server/modules/kanban-metis/kanban-pm-mcp.ts']; bad = sum(t.count('@/modules') + t.count('../index') for t in (open(f).read() for f in fs)); print('LEAF_VIOLATIONS=%d' % bad)\""
expect = "LEAF_VIOLATIONS=0"
timeout_s = 120

[[verify]]
cmd = '''
set -e
cd /home/lyphe/.claude/claudecodeui_lyphe
printf '%s\n%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
| KANBAN_PM_API_URL=http://127.0.0.1:7893 KANBAN_PM_TOKEN=probe KANBAN_PM_BOARD_ID=b-0 KANBAN_PM_OWNER=0123456789abcdef \
  node_modules/.bin/tsx --tsconfig server/tsconfig.json server/modules/kanban-metis/kanban-pm-mcp.ts 2>/dev/null \
| python3 -c '
import sys, json
names = []
server = ""
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    msg = json.loads(line)
    if msg.get("id") == 1: server = msg["result"]["serverInfo"]["name"]
    if msg.get("id") == 2: names = sorted(t["name"] for t in msg["result"]["tools"])
want = sorted("answer_design_question approve_feature archive_feature attach_plan claim_plan create_feature file_issue get_feature_plan get_learned_selections get_lesson list_actionable list_active_builds list_features list_features_all list_lessons open_design_questions post_design_questions resolve_issue search_history set_checklist set_checklist_item set_closing_remarks set_status set_tags stage_lesson".split())
print("SERVER=%s TOOLS=%d MATCH=%s" % (server, len(names), names == want))
'
'''
expect = "SERVER=kanban-pm TOOLS=25 MATCH=True"
timeout_s = 300

[[verify]]
cmd = '''
set -e
cd /home/lyphe/.claude/claudecodeui_lyphe
cp ~/.cloudcli/local-server.json /tmp/metis-marker.bak 2>/dev/null || true
SERVER_PORT=7893 node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > /tmp/metis-server.log 2>&1 &
echo $! > /tmp/metis-server.pid
for i in $(seq 1 90); do curl -sf http://127.0.0.1:7893/api/auth/status > /dev/null && break; sleep 1; done
T=$(python3 - <<'PY'
import sqlite3, json, hmac, hashlib, base64, time, os
conn = sqlite3.connect(os.path.expanduser('~/.cloudcli/auth.db'))
secret = conn.execute("select value from app_config where key='jwt_secret'").fetchone()[0].encode()
uid, uname = conn.execute('select id, username from users order by id limit 1').fetchone()
enc = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(',', ':')).encode()).rstrip(b'=')
now = int(time.time())
head = enc({'alg': 'HS256', 'typ': 'JWT'})
body = enc({'userId': uid, 'username': uname, 'iat': now, 'exp': now + 3600})
sig = base64.urlsafe_b64encode(hmac.new(secret, head + b'.' + body, hashlib.sha256).digest()).rstrip(b'=')
print((head + b'.' + body + b'.' + sig).decode())
PY
)
B=$(curl -sf -X POST http://127.0.0.1:7893/api/kanban/boards -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"name":"probe-metis4"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["board"]["id"])')
OUT=$(printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_feature","arguments":{"title":"probe card from mcp","priority":"low"}}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_lessons","arguments":{}}}' \
  | KANBAN_PM_API_URL=http://127.0.0.1:7893 KANBAN_PM_TOKEN="$T" KANBAN_PM_BOARD_ID="$B" KANBAN_PM_OWNER=0123456789abcdef \
    node_modules/.bin/tsx --tsconfig server/tsconfig.json server/modules/kanban-metis/kanban-pm-mcp.ts 2>/dev/null \
  | python3 -c '
import sys, json
made = lessons = ""
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    msg = json.loads(line)
    if msg.get("id") == 2: made = "ERR" if msg["result"].get("isError") else "OK"
    if msg.get("id") == 3: lessons = "STUB" if msg["result"].get("isError") else "NOTSTUB"
print("CREATE=%s LESSONS=%s" % (made, lessons))
')
N=$(curl -sf "http://127.0.0.1:7893/api/kanban/boards/$B/cards?status=not_ready,todo" -H "Authorization: Bearer $T" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["cards"]))')
curl -sf -X PATCH http://127.0.0.1:7893/api/kanban/boards/$B -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"archived":true}' > /dev/null
kill "$(cat /tmp/metis-server.pid)" 2>/dev/null || true
sleep 1
cp /tmp/metis-marker.bak ~/.cloudcli/local-server.json 2>/dev/null || true
echo "$OUT CARDS=$N"
'''
expect = "CREATE=OK LESSONS=STUB CARDS=1"
timeout_s = 560
```

**What to build.** One stdio program, twenty-five tools, one HTTP client, one heartbeat. Every
tool is HTTP against the board's existing routes — this process never opens SQLite and never
imports a kanban service.

**The precedent to copy.** `server/modules/browser-use/browser-use-mcp.ts` is already exactly
this kind of program in this repository — a `#!/usr/bin/env node` hand-rolled JSON-RPC stdio MCP
server. Read it and follow its transport shape. Do not add `@modelcontextprotocol/sdk`: it is on
disk only as a transitive dependency of the Agent SDK, `package.json` is forbidden to you this
phase, and Descent's own 25-tool server is hand-rolled too.

**Sirens.** You will want to import `kanbanCardsService` and skip the HTTP hop — you cannot, and
the reason is simpler than a seam argument: this program runs as a separate PROCESS, a stdio child
of the CLI, so there is no in-process call available to it at all. (`writeKanban` and the
`kanban_event` fan-out live in the SERVICE and fire either way; the HTTP hop is not what buys
them.) You will want to rename a tool to something
clearer than `create_feature`; the twenty-five names are frozen so the ported brief and the hook
matchers work by changing one word. You will want to implement the lesson tools against
`kanban_decisions`; they are stubs on purpose and the exact refusal sentence is in Interfaces.
You will want to fix the drift you will notice in Descent's `mcp_server.py` docstring (it says 24
tools); Descent is read-only in this plan.

## Phase 5 — Metis's brief, in a home the board owns
Depends on: Phase 4

```toml
[phase]
id = "5"
builder = "prometheus"
model = "sonnet"
code_change = false
doc_sweep = "foreground"
expected_s = 3000
manifest = [
  "server/modules/kanban-metis/brief",
]
forbidden = [
  "server/modules/kanban-metis/mcp",
  "server/modules/kanban-metis/index.ts",
  "docs/kanban.md",
]
athena = [
  "A descent-pm tool name or a ~/.claude/descent path survived the port, so the brief tells Metis to call a tool her session cannot see",
  "The port dropped one of the six chapters, so a cross-reference in METIS.md points at a file that is not there",
  "ABSOLUTE RULES were trimmed rather than carried, so the no-tests and no-branches rules Metis enforces on her builders went missing",
  "The seam section still describes a sqlite store Metis may read directly, when this board is reachable only through the kanban-pm MCP",
  "The source file ~/.claude/commands/pm.md was edited rather than copied",
  "A chapter describes a Descent mechanism this board lacks (the keep-flowing nudge, a lease token a restart replaces, a direct store read) as if it ran here",
  "A re-walk copied Descent's original chapters over an earlier attempt's ported ones, so a port that was done is silently undone",
]

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/brief/METIS.md"
what = "Port the LIVE text of ~/.claude/commands/pm.md into this file, read as it stands when the phase starts and whatever its line count: another session edits that file (it read 847 lines on 2026-09-16), and the pm.md line numbers below are from an older 846-line reading, so find each named section by its heading and content, never by its number. If this file already exists from an earlier attempt of this phase, it is that attempt's port: read it against the live source, complete what is missing, and never start over by re-copying. The source is read-only (Constraint 5) — never edit it, and never trim or pad the port to meet a number. Port it keeping its structure, its voice and every ABSOLUTE RULE. Drop the YAML frontmatter (this is a system-prompt append, not a slash command). The rewrites: `descent-pm` becomes `kanban-pm` and `mcp__descent-pm__` becomes `mcp__kanban-pm__` everywhere; `~/.claude/descent/descent.db` and every claim that Metis may read a store directly becomes the statement that this board is reachable ONLY through the kanban-pm MCP, which is injected fresh at every launch with --strict-mcp-config and is the session's only MCP; `~/.claude/descent/pm-chapters/` becomes `server/modules/kanban-metis/brief/chapters/`; `~/.claude/descent/README.md` becomes `docs/kanban.md`; the word Descent, where it names the product, becomes `the Kanban board`. Rewrite the §'The seam' section (pm.md L90-163) against the tool table in this plan's Interfaces section, including the four lesson tools' honest refusal and what to do instead. Rewrite the board-homes table (pm.md L808-827) to name this board. Keep pm.md L770-806 (the operator's psql and notification infrastructure) verbatim — it is his infrastructure and it has not moved. Add one new ABSOLUTE RULE at the end of that list: this session is the Kanban board's and only the Kanban board's; it never reads or writes Descent, never asks the operator anything through a prompt (questions go on the card through post_design_questions), and when `plan-runner start` refuses a plan with exit 5 because the INTENT LOCK is not confirmed, it files an issue on the card, moves the card back to todo, and takes the next one."
check = "{ grep -c 'descent-pm\\|descent\\.db\\|/\\.claude/descent' server/modules/kanban-metis/brief/METIS.md || true; }"
expect = "0"

[[steps]]
kind = "run"
cmd = "mkdir -p server/modules/kanban-metis/brief/chapters && for f in autonomy-cadence learning mcp-fallback parallelism plan-template recovery; do d=\"server/modules/kanban-metis/brief/chapters/$f.md\"; [ -e \"$d\" ] || cp \"$HOME/.claude/descent/pm-chapters/$f.md\" \"$d\"; done"
check = "ls server/modules/kanban-metis/brief/chapters | wc -l"
expect = "6"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/brief/chapters/mcp-fallback.md"
what = "Port this chapter: on this board there is no sqlite fallback and no direct store read. Rewrite it to say what Metis does when the kanban-pm MCP is dark — stop, say so plainly, and end the turn, because the board is unreachable and there is no second door. Keep it short, in the chapter's own voice."
check = "{ grep -c 'descent' server/modules/kanban-metis/brief/chapters/mcp-fallback.md || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/brief/chapters/recovery.md"
what = "Port this chapter's tool names and paths to kanban-pm and to this board's lease semantics, keeping its resume and idempotency model intact. The board's stale window is 40 seconds (KANBAN_LEASE_STALE_SECONDS), the same number Descent uses. Where Descent's lease model contradicts this plan's Interfaces, the Interfaces win and the chapter says what this board does: the owner is DERIVED from the session id (Interfaces, 'The lease owner is DERIVED, never minted'), so it survives a restart and a re-adoption; the heartbeat lives in the MCP process. A Descent mechanism this board lacks is removed from the chapter, never described as if it ran here."
check = "{ grep -c 'descent-pm\\|descent\\.db' server/modules/kanban-metis/brief/chapters/recovery.md || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/brief/chapters/parallelism.md"
what = "Port this chapter's tool names and paths. Add one paragraph: on this board the concurrency dial is per board and lives on the driver, not on a setting Metis can read, and a session never spawns a sibling — the board's driver decides how many of her run."
check = "{ grep -c 'descent-pm\\|descent\\.db' server/modules/kanban-metis/brief/chapters/parallelism.md || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/brief/chapters/learning.md"
what = "Port this chapter honestly: on this board only ONE of the two learning substrates exists. Decisions are real (get_learned_selections reads them); the lesson corpus is not on this board yet, and what would have been a lesson goes into the card's closing remarks instead. Say so plainly rather than describing a store that is not there."
check = "grep -c 'closing remarks' server/modules/kanban-metis/brief/chapters/learning.md"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/brief/chapters/plan-template.md"
what = "Port this chapter's tool names and paths. The plan shape itself does not change — it is the same format-v2 plan the same runner walks."
check = "{ grep -c 'descent-pm' server/modules/kanban-metis/brief/chapters/plan-template.md || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/brief/chapters/autonomy-cadence.md"
what = "Port this chapter's tool names and paths. Add one line to the quiescence section: when the board has nothing claimable, she says so and ends the turn — the board's driver is what brings her back, and she never idles waiting. The chapter's keep-flowing nudge section describes the G4b autonomy branch, which stands down for a board session (Interfaces, 'The hooks seam'): remove that section and let the quiescence line carry the statement that the driver is the mechanism, rather than porting a nudge that never fires on this board."
check = "{ grep -c 'descent-pm' server/modules/kanban-metis/brief/chapters/autonomy-cadence.md || true; }"
expect = "0"

[[verify]]
cmd = '''
cd /home/lyphe/.claude/claudecodeui_lyphe
python3 - <<'PY'
import os, re
root = 'server/modules/kanban-metis/brief'
text = open(os.path.join(root, 'METIS.md')).read()
for name in os.listdir(os.path.join(root, 'chapters')):
    text += open(os.path.join(root, 'chapters', name)).read()
tools = "answer_design_question approve_feature archive_feature attach_plan claim_plan create_feature file_issue get_feature_plan get_learned_selections get_lesson list_actionable list_active_builds list_features list_features_all list_lessons open_design_questions post_design_questions resolve_issue search_history set_checklist set_checklist_item set_closing_remarks set_status set_tags stage_lesson".split()
missing = [t for t in tools if t not in text]
leaks = len(re.findall(r'descent-pm|descent\.db|/\.claude/descent', text))
chapters = len(os.listdir(os.path.join(root, 'chapters')))
lines = len(open(os.path.join(root, 'METIS.md')).read().splitlines())
print("MISSING=%d LEAKS=%d CHAPTERS=%d LINES_OK=%s" % (len(missing), leaks, chapters, lines >= 700))
PY
'''
expect = "MISSING=0 LEAKS=0 CHAPTERS=6 LINES_OK=True"
timeout_s = 180

[[verify]]
cmd = '''
cd /home/lyphe/.claude/claudecodeui_lyphe
python3 - <<'PY'
import os
pm = open(os.path.expanduser('~/.claude/commands/pm.md')).read()
root = os.path.expanduser('~/.claude/descent/pm-chapters')
names = sorted(n for n in os.listdir(root) if not n.startswith('.'))
chapters = ''.join(open(os.path.join(root, n)).read() for n in names if n.endswith('.md'))
print("PM_FRONTMATTER=%s PM_DESCENT_PM=%s PM_KANBAN_PM=%d CHAPTERS=%d CH_DESCENT_PM=%s CH_KANBAN_PM=%d" % (
    pm.startswith('---\n'), pm.count('descent-pm') > 0, pm.count('kanban-pm'),
    len(names), chapters.count('descent-pm') > 0, chapters.count('kanban-pm')))
PY
'''
expect = "PM_FRONTMATTER=True PM_DESCENT_PM=True PM_KANBAN_PM=0 CHAPTERS=6 CH_DESCENT_PM=True CH_KANBAN_PM=0"
timeout_s = 120
```

**What to write.** One 800-plus-line brief and six chapters, ported — not summarised. Metis's
competence is in the length of this file; a shortened brief is a weaker Metis, and the operator's
whole reason for this plan is that she works.

**Sirens.** You will want to compress the ABSOLUTE RULES because they are long; they are the
part that must arrive whole. You will want to edit `~/.claude/commands/pm.md` in place rather
than copying — it is read-only in this plan and Descent's own sessions still run on it. You will
want to delete the psql and notification infrastructure at pm.md L770-806 as Descent-specific; it
is the operator's infrastructure, it has not moved, and it stays. You will see `pm.md` carry a
different line count from the one an older reading of this phase named — another session edits
it; port the text as it stands, never edit it, and never trim or pad the port to meet a number.
You will find `METIS.md` and the six chapters already on disk from an earlier attempt; complete
them against the live source, and never copy Descent's originals over them. You will want to
port the keep-flowing nudge and Descent's minted lease token because the chapters describe them;
neither runs on this board, and the steps above say what replaces them. You will want to write a
`README.md` next to the brief explaining it; Constraint 12 forbids it, and Phase 11 is where this
work is documented.

## Phase 6 — Seclusion: the synchroniser refuses, and the hooks learn the board
Depends on: none

```toml
[phase]
id = "6"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "server/modules/providers/list/claude/claude-session-synchronizer.provider.ts",
  "/home/lyphe/.claude/hooks/kanban_metis.py",
  "/home/lyphe/.claude/hooks/metis_session.py",
  "/home/lyphe/.claude/hooks/enforce_metis_contract.py",
]
forbidden = [
  "server/modules/database/repositories/sessions.db.ts",
  "server/modules/database/repositories/projects.db.ts",
  "server/modules/projects",
]
athena = [
  "The refusal was placed at :66 or :98 where cwd has not been parsed yet, so it guesses at a dash-encoded directory name and misses the transcript it exists to refuse",
  "processSessionFile returns null for a board session but one of the two call sites does not handle null before sessionsDb.createSession, so the row is created anyway",
  "isUnder was written as a startswith on raw strings, so ~/.claude/kanban-metis-old is refused too and a real project silently stops being enrolled",
  "kanban_metis.board_id raises on a payload with no cwd, and enforce_metis_contract fails closed, taking every guard down in every session on the box",
  "The G4/G4b stand-down was keyed on the marker rather than on cwd, so a board session that has not yet been stamped is still judged against Descent's board",
  "The new SessionStart stamp trigger creates a metis marker for ANY session, dragging ordinary chat sessions into the autonomy guards",
  "A regression in the existing isSubagentTranscript path: subagent transcripts start being enrolled again",
]

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/hooks/kanban_metis.py"
what = "A new module, under 80 lines, exporting SESSION_ROOT = os.path.expanduser('~/.claude/kanban-metis'), board_id(payload_or_cwd) -> str | None returning the single path leaf directly under that root, and is_board_session(payload_or_cwd) -> bool. It accepts either a hook payload dict (reading its 'cwd' key) or a plain string. It NEVER raises: every path is wrapped so any exception yields None / False, per the hooks' fail-open rule."
check = "cd /home/lyphe/.claude/hooks && python3 -c \"import kanban_metis as k; print(k.board_id({'cwd': k.SESSION_ROOT + '/b-90'}), k.is_board_session({}), k.is_board_session(None), k.is_board_session('/tmp'))\""
expect = "b-90 False False False"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/hooks/metis_session.py"
what = "Add a THIRD create trigger to maybe_stamp, beside the /pm prompt and the Skill(pm) ones: a payload whose cwd is a board session (kanban_metis.is_board_session) stamps the marker, on any event. This is the board-issued identity that replaces a typed /pm. Import kanban_metis fail-open, exactly as the orchestrator imports its siblings: a missing or broken module means the trigger is simply absent, never an exception."
check = "grep -c 'kanban_metis' /home/lyphe/.claude/hooks/metis_session.py"
expect_re = "^[2-9]$|^[1-9][0-9]$"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/hooks/enforce_metis_contract.py"
what = "Give the Stop guards one early return each: _guard_stop (G4, the board-consistency scan) and the G4b autonomy branch both stand down, returning 0, when kanban_metis.is_board_session(payload) is true. Both read Descent's sqlite store and would judge a board session against the wrong board. Register kanban_metis in the _SIBLINGS table so it imports fail-open like every other sibling, and say in a comment beside each early return which board the guard would otherwise have read."
check = "grep -c 'kanban_metis' /home/lyphe/.claude/hooks/enforce_metis_contract.py"
expect_re = "^[3-9]$|^[1-9][0-9]$"

[[steps]]
kind = "edit"
path = "server/modules/providers/list/claude/claude-session-synchronizer.provider.ts"
what = "Export KANBAN_METIS_SESSION_ROOT = path.join(os.homedir(), '.claude', 'kanban-metis') beside CLAUDE_PROJECTS_ROOT. Inside processSessionFile (:146), on the line immediately after projectPath is read from the transcript's own cwd at :153, return null when projectPath resolves under that root. Containment is a resolved-path test — equal to the root, or starting with the root plus a path separator — never a bare startsWith, so a sibling directory whose name merely begins with the same characters is not caught. ONE site and ONE key: do not touch :66 or :98, where cwd has not been parsed yet, and write no path-leaf or dash-encoded test — this repository does not own the CLI's directory encoding and carries no forward encoder for it. Both call sites already handle a null return before sessionsDb.createSession. Leave isSubagentTranscript exactly as it is."
check = "grep -c 'KANBAN_METIS_SESSION_ROOT' server/modules/providers/list/claude/claude-session-synchronizer.provider.ts"
expect_re = "^[2-9]$|^[1-9][0-9]$"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint:server"
check = "npm run typecheck > /tmp/metis-p6-tc.log 2>&1 && npm run lint:server >> /tmp/metis-p6-tc.log 2>&1; echo $?"
expect = "0"
timeout_s = 480

[[verify]]
cmd = '''
set -e
cd /home/lyphe/.claude/claudecodeui_lyphe
SID=$(python3 -c 'import uuid; print(uuid.uuid4())')
CWD="$HOME/.claude/kanban-metis/probe-b6"
SLUG=$(python3 -c "
import os, re
p = os.path.expanduser('~/.claude/kanban-metis/probe-b6')
print(re.sub(r'[/.]', '-', p))
")
DIR="$HOME/.claude/projects/$SLUG"
mkdir -p "$CWD" "$DIR"
python3 - "$DIR/$SID.jsonl" "$CWD" "$SID" <<'PY'
import json, sys
path, cwd, sid = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, 'w') as fh:
    fh.write(json.dumps({"type": "user", "sessionId": sid, "cwd": cwd,
                         "message": {"role": "user", "content": "probe"},
                         "timestamp": "2026-09-16T00:00:00.000Z"}) + "\n")
PY
cp ~/.cloudcli/local-server.json /tmp/metis-marker.bak 2>/dev/null || true
SERVER_PORT=7893 node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > /tmp/metis-server.log 2>&1 &
echo $! > /tmp/metis-server.pid
for i in $(seq 1 90); do curl -sf http://127.0.0.1:7893/api/auth/status > /dev/null && break; sleep 1; done
T=$(python3 - <<'PY'
import sqlite3, json, hmac, hashlib, base64, time, os
conn = sqlite3.connect(os.path.expanduser('~/.cloudcli/auth.db'))
secret = conn.execute("select value from app_config where key='jwt_secret'").fetchone()[0].encode()
uid, uname = conn.execute('select id, username from users order by id limit 1').fetchone()
enc = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(',', ':')).encode()).rstrip(b'=')
now = int(time.time())
head = enc({'alg': 'HS256', 'typ': 'JWT'})
body = enc({'userId': uid, 'username': uname, 'iat': now, 'exp': now + 3600})
sig = base64.urlsafe_b64encode(hmac.new(secret, head + b'.' + body, hashlib.sha256).digest()).rstrip(b'=')
print((head + b'.' + body + b'.' + sig).decode())
PY
)
curl -sf http://127.0.0.1:7893/api/projects -H "Authorization: Bearer $T" > /dev/null
sleep 3
kill "$(cat /tmp/metis-server.pid)" 2>/dev/null || true
sleep 1
cp /tmp/metis-marker.bak ~/.cloudcli/local-server.json 2>/dev/null || true
N=$(python3 - "$SID" "$CWD" <<'PY'
import sqlite3, os, sys
sid, cwd = sys.argv[1], sys.argv[2]
c = sqlite3.connect(os.path.expanduser('~/.cloudcli/auth.db'))
s = c.execute('select count(*) from sessions where provider_session_id = ? or session_id = ?', (sid, sid)).fetchone()[0]
p = c.execute('select count(*) from projects where project_path = ?', (cwd,)).fetchone()[0]
print('%d %d' % (s, p))
PY
)
rm -rf "$DIR" "$CWD"
echo "ROWS=$N"
'''
expect = "ROWS=0 0"
timeout_s = 560

[[verify]]
cmd = '''
cd /home/lyphe/.claude/hooks
python3 - <<'PY'
import json, os, subprocess, sys, uuid
root = os.path.expanduser('~/.claude/kanban-metis/probe-guard')
os.makedirs(root, exist_ok=True)
state = os.path.expanduser('~/.claude/state')
sid_plain, sid_board = str(uuid.uuid4()), str(uuid.uuid4())
def run(payload):
    p = subprocess.run([sys.executable, 'enforce_metis_contract.py'],
                       input=json.dumps(payload), text=True, capture_output=True, timeout=60)
    return p.returncode
plain = run({"hook_event_name": "Stop", "session_id": sid_plain, "cwd": "/tmp"})
board = run({"hook_event_name": "Stop", "session_id": sid_board, "cwd": root})
import kanban_metis as k
print("PLAIN=%d BOARD=%d ISBOARD=%s" % (plain, board, k.is_board_session({"cwd": root})))
os.rmdir(root)
for sid in (sid_plain, sid_board):
    for name in os.listdir(state):
        if sid[:8] in name:
            os.remove(os.path.join(state, name))
PY
'''
expect = "PLAIN=0 BOARD=0 ISBOARD=True"
timeout_s = 240
```

**What to build.** One tiny Python module, three early returns, one TypeScript predicate. This is
the phase the operator's word "secluded" lives in, and its whole strength is that a board
session's row is never CREATED — not filtered afterwards. The house already learned that lesson:
`runner-transcripts` first tried a `<slug>/runner/` subfolder and it hid nothing, because the
synchroniser walks the projects root recursively.

**Sirens.** You will want to add a `hidden` or `origin` column to `sessions` and filter on it;
`sessions.db.ts` and `projects.db.ts` are forbidden to you, and a WHERE clause is a filter a
future query forgets. You will want to refuse the transcript early, at `:66` or `:98`, because
that is where `isSubagentTranscript` sits and it looks like the matching place — it is not: those
sites have only a file PATH, and the only authoritative `cwd` is the one `processSessionFile`
parses out of the transcript at `:153`. You will want to make the guards stand down by checking the metis marker;
key on `cwd`, because the marker may not exist yet on the session's first event. You will want to
give `load_main_shelves.py` its own early return; it already has an env bypass —
`MAIN_SHELVES_LOADER_DISABLE`, which `souls.py:186-202` uses — and Phase 7 sets it in the child's
env. Do not edit that hook.

## Phase 7 — Spawning a Metis: the registry, the routes, the frame
Depends on: Phase 1, Phase 5, Phase 6

```toml
[phase]
id = "7"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 4200
manifest = [
  "server/modules/kanban-metis/metis-spawn.service.ts",
  "server/modules/kanban-metis/metis-registry.service.ts",
  "server/modules/kanban-metis/metis-env.service.ts",
  "server/modules/kanban-metis/kanban-metis.routes.ts",
  "server/modules/kanban-metis/kanban-metis.module.ts",
  "server/modules/kanban-metis/index.ts",
  "server/shared/types.ts",
  "src/shared/types.ts",
  "server/index.ts",
  "server/modules/kanban-metis/mcp",
]
forbidden = [
  "server/modules/kanban-metis/brief",
  "server/modules/kanban",
  "server/modules/dispatch-souls",
  "server/modules/deepseek",
  ".env",
]
athena = [
  "The DeepSeek env pair is layered on without being deleted when the board switch is off, so a Metis spawned with the switch off still bills DeepSeek",
  "metis-env.service.ts spells process.env somewhere, so TSX_TSCONFIG_PATH rides into the child and every tsx run inside her plan-runners resolves @/ against the server folder",
  "The per-board flag file is written to the host-wide path, so launching one board's Metis flips every plan-runner on the box",
  "The child's stdout is piped to the parent instead of to its own file descriptor, so a server restart blocks the child on a full pipe and freezes child.log's mtime into a false quiesce",
  "Nothing is written to the child's stdin, or stdin is never closed, so claude -p waits for input forever and the session reads as running while doing nothing",
  "The secret is stored in a map instead of recomputed, so a server restart 401s every live Metis mid-build",
  "The guard accepts a recomputed secret for a session that has already left running, or lets an ordinary user JWT through, or lets a session secret reach the authenticated /api/kanban mount",
  "A request path under /import/ reaches the kanban router through the kanban-pm door",
  "KANBAN_PM_API_URL is a hard-coded port, so a child launched by the probe server on 7893 writes through the operator's server on 3011 and its frames reach nobody",
  "A resume passes both --session-id and --resume, or passes --session-id alone and starts a fresh conversation that loses the card she was building",
  "The owner is minted at random instead of derived from the session id, so a re-adopted Metis cannot refresh the leases she already holds",
  "spec.json records the brief inline, so the state directory grows by 900 lines per session and the operator's ~/.claude/state fills",
  "Re-adoption on boot trusts a stale child.pid whose number has been recycled by an unrelated process",
  "kanban-pm-client.ts still builds its URLs on /api/kanban, so every tool a launched Metis calls sends her derived bearer to the user door, 401s, and she reads running while doing nothing",
  "The mount fix keeps a fallback to /api/kanban or makes the mount an environment variable, so a child's session credential can still be offered to the authenticated user door",
  "A file under server/modules/kanban-metis/mcp other than kanban-pm-client.ts changed, or the client gained an import from outside mcp/, node: builtins and server/shared/",
  "Stopping a session leaves the claude child or its kanban-pm MCP grandchild alive, or leaves its bearer accepted at /api/kanban-pm after it has exited",
]

[[steps]]
kind = "edit"
path = "server/shared/types.ts"
what = "Add 'kanban_metis_state' to GatewayEventKind beside 'soul_launch_state', and declare KanbanMetisSession and KanbanMetisStateEvent exactly as the Interfaces section gives them, in their own commented group. Three edits to this file, no more."
check = "grep -c 'kanban_metis_state' server/shared/types.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/shared/types.ts"
what = "Mirror KanbanMetisSession and KanbanMetisStateEvent onto the client, field for field, in their own commented group."
check = "grep -c 'KanbanMetisSession' src/shared/types.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/metis-env.service.ts"
what = "Build the child's environment and its argv, per the Interfaces blocks. The env is userFacingEnv(extra) imported from @/shared/child-env.js -- NEVER a { ...process.env } of its own, and this file must not mention process.env at all: the apiOrigin and the DeepSeek key arrive as PARAMETERS from the module root. The extra is MAIN_SHELVES_LOADER_DISABLE=1, KANBAN_METIS_BOARD_ID, KANBAN_METIS_SESSION_ID, PLAN_RUNNER_DEEPSEEK_FLAG_PATH, and when the board's deepseekFlash is true also ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN; when it is false those two keys are DELETED from the extra before userFacingEnv is called. DEEPSEEK_BASE_URL and DEEPSEEK_MODEL are two named constants, each with a comment naming hooks/plan_runner/deepseek.py:56-57 as the canonical home they mirror; the Claude side is METIS_CLAUDE_MODEL = 'opus'. Derive the lease owner as sha256(sessionId) hex sliced to 16 chars and hand it over as KANBAN_PM_OWNER. Write the board's flag file with writeFlagFile from @/modules/settings/index.js. The --mcp-config value is one JSON string naming kanban-pm with the command from resolveMcpCommand and the four KANBAN_PM_* variables in its own env block, --strict-mcp-config always beside it. argv carries --session-id on a first spawn and --resume INSTEAD of it on a resume, never both. --add-dir is present only when the board's projectId resolves through projectsDb to a path."
check = "{ grep -c 'process\\.env' server/modules/kanban-metis/metis-env.service.ts || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/metis-registry.service.ts"
what = "The live-session registry: an in-memory map of KanbanMetisSession keyed by sessionId, backed by ~/.claude/state/kanban-metis/<sessionId>/{spec.json,result.json,child.log,child.pid} in the layout ~/.claude/state/dispatch-souls/<launch id>/ uses. It stores NO credential: it exposes isRunning(sessionId): boolean -- the running set the guard consults -- and the secret is recomputed on demand, never kept. On construction it RE-ADOPTS: read every directory under that root, and for each with no result.json check child.pid's liveness by process.kill(pid, 0) AND by confirming /proc/<pid>/cmdline still names that session id, so a recycled pid is never mistaken for a live Metis; a dead one is recorded 'failed' with its result.json written then."
check = "grep -c 'cmdline' server/modules/kanban-metis/metis-registry.service.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/metis-spawn.service.ts"
what = "Spawn one detached Metis for a board: mint a uuid for --session-id, create ~/.claude/kanban-metis/<boardId>/ as the child's cwd, read the brief through findApplicationRoot, build argv and env from metis-env.service. The CHILD OWNS ITS LOG: open child.log for append and spawn with { detached: true, stdio: ['pipe', fd, fd] } -- never a piped stdout, which a server restart turns into a blocked child and a frozen child.log mtime that the quiescence rule reads as quiet. Then write the opening turn of the Interfaces section to the child's stdin and END it, because claude -p with unwritten stdin waits forever (souls.py:310-312 writes the prompt then closes); close the PARENT's fd; child.unref(). Record spec.json before the spawn carrying the opening turn verbatim, the resolved API origin, and the brief's PATH and sha256 rather than its text; result.json is written by the exit handler while the server lives and by re-adoption when it does not. Also expose stop(sessionId) -- SIGTERM, then SIGKILL 15 s later -- and resume(sessionId), which spawns with --resume in place of --session-id."
check = "{ grep -c 'stdout: ' server/modules/kanban-metis/metis-spawn.service.ts || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/kanban-metis.routes.ts"
what = "The five routes of the Interfaces section, thin: parse, call one service, format. The transcript route has NO service of its own: confirm the registry knows the id -- that is the authorization and it belongs here -- then call readClaudeTranscriptBySessionId from @/modules/providers/index.js, whose scanProjectsRoot fallback (claude-transcript-activity.ts:190-197) is the only path a secluded session can take. Plus the exported kanbanMetisSecretGuard: it recomputes HMAC-SHA256(<the app jwt_secret>, sessionId) for the session id the bearer claims and accepts only when registry.isRunning(sessionId); it stores nothing. Before the router, it refuses any request path matching /import/ with 403, carrying a comment saying why -- the Descent importer reads a foreign database and can rewrite four hundred cards in one transaction, and no autonomous session has business calling it."
check = "grep -c 'kanbanMetisSecretGuard' server/modules/kanban-metis/kanban-metis.routes.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/kanban-metis.module.ts"
what = "The composition root: resolve the server's OWN origin once, from the port this process listens on -- the shape browser-use.service.ts:190-193's getMcpApiUrl uses, SERVER_PORT then PORT then 3001, with an explicit KANBAN_PM_API_URL honoured as an override seam -- and pass it down, so metis-env.service.ts never reads an environment. Resolve the DeepSeek key reader from @/modules/deepseek/index.js and pass that down too. Then build the registry and the spawner, mount the router, and start a createPolledLane at 2000 ms over the registry that broadcasts { kind: 'kanban_metis_state', sessions, at } to connectedClients ON CHANGE ONLY — the exact shape dispatch-souls.module.ts:30,67-115 uses. Export createKanbanMetisModule() and the guard."
check = "grep -c 'createPolledLane' server/modules/kanban-metis/kanban-metis.module.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/index.ts"
what = "Extend the barrel: createKanbanMetisModule, kanbanMetisSecretGuard, the registry's reader for the driver to use in Phase 10, and the getKanbanPmMcpCommand already there. Each with its consumer comment. Nothing else leaves this module."
check = "grep -c 'createKanbanMetisModule' server/modules/kanban-metis/index.ts"
expect = "1"

[[steps]]
kind = "edit"
path = "server/index.ts"
what = "Mount two things beside the existing kanban mount: app.use('/api/kanban-metis', authenticateToken, createKanbanMetisModule()) and app.use('/api/kanban-pm', kanbanMetisSecretGuard, createKanbanModule()). The second is the same kanban router behind a different door — the MCP child's only way in — and it must NOT carry authenticateToken."
check = "grep -c \"'/api/kanban-pm'\\|'/api/kanban-metis'\" server/index.ts"
expect = "2"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/mcp/kanban-pm-client.ts"
what = "Point the MCP client at the door this phase opens for it. Change line 119, const KANBAN_API_MOUNT = '/api/kanban'; to const KANBAN_API_MOUNT = '/api/kanban-pm'; and correct the two comments that still name the user mount -- the file header's `/api/kanban` at line 7, and the doc comment directly above line 119 -- so each says the child reaches the board through the /api/kanban-pm door carrying her derived session credential, and that the user mount refuses that credential by design. WHY: the client was written in Phase 4, before this mount existed; measured 2026-09-16 in attempt 1, a launched child's mcp__kanban-pm__list_actionable failed `GET /boards 401 AUTH_TOKEN_INVALID` because her derived bearer went to authenticateToken on /api/kanban, while the same bearer on /api/kanban-pm/boards/<b>/lanes answered 200. That constant and those two comments are the WHOLE edit under server/modules/kanban-metis/mcp/: no other file there, no new import, no environment variable for the mount, no fallback to /api/kanban. The mcp/ directory sits in this phase's manifest for this one line and a verify hashes every sibling file."
check = "grep -c \"^const KANBAN_API_MOUNT = '/api/kanban-pm';$\" server/modules/kanban-metis/mcp/kanban-pm-client.ts"
expect = "1"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint:server"
check = "npm run typecheck > /tmp/metis-p7-tc.log 2>&1 && npm run lint:server >> /tmp/metis-p7-tc.log 2>&1; echo $?"
expect = "0"
timeout_s = 480

[[verify]]
cmd = '''
set -e
cd /home/lyphe/.claude/claudecodeui_lyphe
B=; SID=; PID=; T=
# Teardown runs on EVERY exit, the aborted one included: a read that fails under `set -e` must
# never strand the probe server on 7893, the child, or the probe board (Project Constraint 9).
cleanup() {
  if [ -n "$SID" ] && [ -n "$T" ]; then
    curl -s -X POST "http://127.0.0.1:7893/api/kanban-metis/sessions/$SID/stop" -H "Authorization: Bearer $T" > /dev/null 2>&1 || true
  fi
  if [ -n "$PID" ]; then kill -KILL -- "-$PID" 2>/dev/null || true; fi
  if [ -n "$B" ] && [ -n "$T" ]; then
    curl -s -X PATCH "http://127.0.0.1:7893/api/kanban/boards/$B" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"archived":true}' > /dev/null 2>&1 || true
  fi
  kill "$(cat /tmp/metis-server.pid)" 2>/dev/null || true
  sleep 1
  cp /tmp/metis-marker.bak ~/.cloudcli/local-server.json 2>/dev/null || true
  if [ -n "$SID" ]; then rm -rf "$HOME/.claude/state/kanban-metis/$SID"; fi
  if [ -n "$B" ]; then
    rm -rf "$HOME/.claude/kanban-metis/$B" "$HOME/.claude/state/kanban-deepseek/$B.flag" "$HOME"/.claude/projects/*-kanban-metis-"$B"
  fi
}
trap cleanup EXIT
cp ~/.cloudcli/local-server.json /tmp/metis-marker.bak 2>/dev/null || true
SERVER_PORT=7893 node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > /tmp/metis-server.log 2>&1 &
echo $! > /tmp/metis-server.pid
for i in $(seq 1 90); do curl -sf http://127.0.0.1:7893/api/auth/status > /dev/null && break; sleep 1; done
T=$(python3 - <<'PY'
import sqlite3, json, hmac, hashlib, base64, time, os
conn = sqlite3.connect(os.path.expanduser('~/.cloudcli/auth.db'))
secret = conn.execute("select value from app_config where key='jwt_secret'").fetchone()[0].encode()
uid, uname = conn.execute('select id, username from users order by id limit 1').fetchone()
enc = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(',', ':')).encode()).rstrip(b'=')
now = int(time.time())
head = enc({'alg': 'HS256', 'typ': 'JWT'})
body = enc({'userId': uid, 'username': uname, 'iat': now, 'exp': now + 3600})
sig = base64.urlsafe_b64encode(hmac.new(secret, head + b'.' + body, hashlib.sha256).digest()).rstrip(b'=')
print((head + b'.' + body + b'.' + sig).decode())
PY
)
HOSTFLAG_FILE="$HOME/.claude/state/deepseek_flash.flag"
H0=$( (stat -c '%i %Y' "$HOSTFLAG_FILE" 2>/dev/null; sha256sum "$HOSTFLAG_FILE" 2>/dev/null) | tr -d '\n')
B=$(curl -sf -X POST http://127.0.0.1:7893/api/kanban/boards -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"name":"probe-metis7"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["board"]["id"])')
curl -sf -X POST "http://127.0.0.1:7893/api/kanban/boards/$B/cards" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"title":"probe card seven","status":"todo","description":"a card for the launch probe"}' > /dev/null
curl -sf -X PATCH "http://127.0.0.1:7893/api/kanban/boards/$B" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"deepseekFlash":true}' > /dev/null
S=$(curl -sf -X POST "http://127.0.0.1:7893/api/kanban-metis/boards/$B/launch" -H "Authorization: Bearer $T" | python3 -c 'import sys,json; d=json.load(sys.stdin)["session"]; print(d["sessionId"], d["provider"], d["model"], d["state"])')
SID=$(echo "$S" | cut -d' ' -f1)
PID=$(cat "$HOME/.claude/state/kanban-metis/$SID/child.pid")
FLAG=$(cat "$HOME/.claude/state/kanban-deepseek/$B.flag" 2>/dev/null | tr -d '[:space:]')
# The four KANBAN_PM_* variables exactly as the LIVE child carries them: read from its own argv.
PMENV=$(python3 - "$PID" <<'PY'
import sys, json
argv = open('/proc/%s/cmdline' % sys.argv[1], 'rb').read().split(b'\0')
env = json.loads(argv[argv.index(b'--mcp-config') + 1])['mcpServers']['kanban-pm']['env']
print(' '.join('%s=%s' % kv for kv in sorted(env.items())))
PY
)
PMTOKEN=$(echo "$PMENV" | tr ' ' '\n' | sed -n 's/^KANBAN_PM_TOKEN=//p')
MCP=$(printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_actionable","arguments":{}}}' \
  | env $PMENV timeout 90 node_modules/.bin/tsx --tsconfig server/tsconfig.json server/modules/kanban-metis/kanban-pm-mcp.ts 2>/dev/null \
  | python3 -c '
import sys, json
out = "NONE"
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    msg = json.loads(line)
    if msg.get("id") == 2:
        out = "ERR" if (msg.get("error") or (msg.get("result") or {}).get("isError")) else "OK"
print(out)
')
UNAUTH=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:7893/api/kanban-pm/boards")
JWTPM=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:7893/api/kanban-pm/boards" -H "Authorization: Bearer $T")
PMDOOR=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:7893/api/kanban-pm/boards/$B/lanes" -H "Authorization: Bearer $PMTOKEN")
SECRETUSER=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:7893/api/kanban/boards" -H "Authorization: Bearer $PMTOKEN")
IMPORT=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:7893/api/kanban-pm/import/descent" -H "Authorization: Bearer $PMTOKEN")
sleep 25
ROWS=$(python3 - "$SID" <<'PY'
import sqlite3, os, sys
c = sqlite3.connect(os.path.expanduser('~/.cloudcli/auth.db'))
print(c.execute('select count(*) from sessions where provider_session_id = ? or session_id = ?', (sys.argv[1], sys.argv[1])).fetchone()[0])
PY
)
API=$(python3 -c "import json,os; d=json.load(open(os.path.expanduser('~/.claude/state/kanban-metis/$SID/spec.json'))); print('7893' in str(d))")
TR=$(curl -sf "http://127.0.0.1:7893/api/kanban-metis/sessions/$SID/transcript" -H "Authorization: Bearer $T" | python3 -c 'import sys,json; print(isinstance(json.load(sys.stdin).get("activity"), list))')
H1=$( (stat -c '%i %Y' "$HOSTFLAG_FILE" 2>/dev/null; sha256sum "$HOSTFLAG_FILE" 2>/dev/null) | tr -d '\n')
HOST=$([ "$H0" = "$H1" ] && echo same || echo moved)
curl -sf -X POST "http://127.0.0.1:7893/api/kanban-metis/sessions/$SID/stop" -H "Authorization: Bearer $T" > /dev/null
for i in $(seq 1 30); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
sleep 2
STOP=$(kill -0 "$PID" 2>/dev/null && echo alive || echo gone)
REVOKED=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:7893/api/kanban-pm/boards" -H "Authorization: Bearer $PMTOKEN")
echo "SESSION=$(echo $S | cut -d' ' -f2-) FLAG=$FLAG HOSTFLAG=$HOST UNAUTH=$UNAUTH JWT_ON_PM=$JWTPM SECRET_ON_USER=$SECRETUSER IMPORT=$IMPORT MCP=$MCP PM_DOOR=$PMDOOR ROWS=$ROWS API7893=$API TRANSCRIPT=$TR STOP=$STOP REVOKED=$REVOKED"
'''
expect = "SESSION=deepseek deepseek-flash running FLAG=on HOSTFLAG=same UNAUTH=401 JWT_ON_PM=401 SECRET_ON_USER=401 IMPORT=403 MCP=OK PM_DOOR=200 ROWS=0 API7893=True TRANSCRIPT=True STOP=gone REVOKED=401"
timeout_s = 580

[[verify]]
cmd = "python3 -c \"src = open('server/modules/kanban-metis/metis-env.service.ts').read(); print('PROCESS_ENV=%d USER_FACING=%d SHELVES=%d DEEPSEEK_URL=%d' % (src.count('process.env'), src.count('userFacingEnv'), src.count('MAIN_SHELVES_LOADER_DISABLE'), src.count('api.deepseek.com/anthropic')))\""
expect_re = "PROCESS_ENV=0 USER_FACING=[1-9][0-9]* SHELVES=[1-9][0-9]* DEEPSEEK_URL=[1-9][0-9]*"
timeout_s = 180

[[verify]]
cmd = '''
cd /home/lyphe/.claude/claudecodeui_lyphe
python3 - <<'PROBE'
import re
src = open('server/modules/kanban-metis/metis-spawn.service.ts').read()
piped = len(re.findall(r'stdout\s*:', src))
stdin_end = len(re.findall(r'stdin[^;\n]{0,40}end\s*\(', src))
unref = src.count('unref')
print('PIPED_STDOUT=%d STDIN_END=%d UNREF=%d' % (piped, stdin_end, unref))
PROBE
'''
expect_re = "PIPED_STDOUT=0 STDIN_END=[1-9][0-9]* UNREF=[1-9][0-9]*"
timeout_s = 180
[[verify]]
cmd = '''
cd /home/lyphe/.claude/claudecodeui_lyphe
python3 - <<'PROBE'
import re
src = open('server/modules/kanban-metis/metis-env.service.ts').read()
sid = len(re.findall(r'--session-id', src))
res = len(re.findall(r'--resume', src))
# the two must never be pushed in the same branch: one argv builder, an either/or
both = len(re.findall(r'--session-id[^\n]{0,120}--resume|--resume[^\n]{0,120}--session-id', src))
print('SESSION_ID=%d RESUME=%d SAME_LINE=%d' % (min(sid, 1), min(res, 1), both))
PROBE
'''
expect = "SESSION_ID=1 RESUME=1 SAME_LINE=0"
timeout_s = 180

[[verify]]
cmd = '''
cd /home/lyphe/.claude/claudecodeui_lyphe
D=$(find server/modules/kanban-metis/mcp -type f ! -name kanban-pm-client.ts | sort | xargs sha256sum | sha256sum | cut -c1-64)
L=$(python3 -c "import glob; fs = glob.glob('server/modules/kanban-metis/mcp/*.ts') + ['server/modules/kanban-metis/kanban-pm-mcp.ts']; print(sum(t.count('@/modules') + t.count('../index') for t in (open(f).read() for f in fs)))")
U=$(grep -c "'/api/kanban'" server/modules/kanban-metis/mcp/kanban-pm-client.ts)
P=$(grep -c "^const KANBAN_API_MOUNT = '/api/kanban-pm';$" server/modules/kanban-metis/mcp/kanban-pm-client.ts)
echo "SIBLINGS_SHA=$D LEAF_VIOLATIONS=$L USER_MOUNT_LITERALS=$U PM_MOUNT=$P"
'''
expect = "SIBLINGS_SHA=48498a3560a9165c2e15d75c78a8810a0c674d6b19e566125390590efa4b2604 LEAF_VIOLATIONS=0 USER_MOUNT_LITERALS=0 PM_MOUNT=1"
timeout_s = 120
```

**What to build.** The machine that starts one Metis and can find her again. No tick loop yet —
Phase 10 owns that. This phase's milestone is the operator's: a Metis that can be launched by
hand and watched.

**The two mounts are not a duplicate.** `/api/kanban-pm` is the SAME router over the SAME
services behind a derived per-session credential, with the importer refused at the door.
Duplicating the verbs is what would be a defect. The MCP client is that door's only caller, so
its mount constant moves to `/api/kanban-pm` in this phase: Phase 4 wrote it before the door
existed, and a door with no caller is a Metis whose every tool call 401s.

**The first verify reads before it tears down.** Its teardown is a `cleanup` function on
`trap cleanup EXIT`, so it runs after the result line is printed AND on any aborted read: the
state directory, the server and the child are all still there for every read, and a failed read
never strands the probe server on 7893, a live child, or an unarchived probe board. The MCP probe
runs the stdio program with the four `KANBAN_PM_*` values read from the LIVE child's own
`/proc/<pid>/cmdline`, so it proves the credential the child really carries, not a copy of the
formula. Run the block exactly as written; `MCP=ERR` means the client edit is missing or wrong.

**Three shapes here exist because the child OUTLIVES this process.** It is detached, so its log
is its own file descriptor rather than a pipe the server's restart would break; its credential is
recomputed from the app secret rather than held in a map the restart would empty; and its lease
owner is `sha256(sessionId)` rather than a random token only the spawning process ever knew. Each
one answers the same question the same way, and the question is what survives a server restart
against what the restart quietly destroys.

**Sirens.** You will want to give the MCP child the operator's user JWT so you can skip the guard;
a credential that outlives the session is exactly what the derived secret exists to avoid. You
will want to keep that secret in a `Map` because recomputing an HMAC per request feels wasteful —
it is nanoseconds, and the map is empty after every restart while the children are not. You will
want to pipe the child's stdout so you can parse its stream-json as it arrives; the child outlives
this process and a dead read end is a blocked child. You will want to write the brief into
`spec.json` for debuggability; record its PATH and its sha256, never its text. You will want to
read `process.env` in `metis-env.service.ts` because the origin and the key are right there;
they arrive as parameters, and a verify counts the words. You will want the switch flip to restart a live session; it does not —
the flip applies at the next spawn, exactly as the plan-runner's own switch does, and the pilot
panel paints what each live session is actually spending. You will want to build the tick loop
while the spawner is fresh in your hands; its files are Phase 10's. You will see
`server/modules/kanban-metis/mcp/` in your manifest and nine sibling files beside the client
that could be tidied; do not touch them — the mount constant and its two comments are the
whole edit there, and a verify hashes every sibling. You will want to keep `/api/kanban` as a
fallback so Phase 4's user-JWT probe still passes; that probe is shipped and is never re-run, and
a fallback offers her session credential to the user door. You will want to make the mount an
environment variable; the door is fixed, and a verify counts the literal.

## Phase 8 — The Metis pilot panel, composed
Depends on: Phase 7

```toml
[phase]
id = "8"
builder = "iris"
model = "fable"
kind = "scaffold"
code_change = true
doc_sweep = "foreground"
expected_s = 2100
manifest = [
  "src/modules/kanban/KanbanMetisPanel.tsx",
  "src/modules/kanban/KanbanMetisRow.tsx",
  "src/modules/i18n/locales/en/common.json",
]
forbidden = [
  "src/modules/kanban/KanbanPanel.tsx",
  "src/modules/kanban/KanbanBoardHeader.tsx",
  "src/shared/api.ts",
  "src/i18n",
]
athena = [
  "The panel has no empty state, so a board with no live Metis paints a blank slab that reads as broken",
  "A running session and a finished one look identical, so the operator cannot tell what is spending money",
  "The provider is shown as a word instead of the mark every other surface in this app uses, so the board disagrees with the composer and the soul pins",
  "Stop and Resume are drawn side by side with equal weight, so the destructive one is as easy to hit as the safe one",
  "A FILL: marker sits on something structural, so the panel does not render until Phase 9",
  "New copy was hard-coded instead of going through t()",
  "A key the panel or the row names as 'kanban.metis.…' is absent from src/modules/i18n/locales/en/common.json, or spelled differently there, so the panel paints the raw key path instead of the words",
  "The kanban.metis copy was also written into one of the ten non-English common.json bundles, when config.ts's fallbackLng 'en' is what carries it to every other language",
  "The kanban.metis object was nested inside kanban.board, or the edit broke the kanban.board keys Phase 2 shipped, so either the new keys or the DeepSeek switch's words stop resolving",
]

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanMetisRow.tsx"
what = "One row per live or recent Metis session, composed from '@/shared/ui': LLMProviderLogo with the session's provider for the mark, a Badge for the state word (running, completed, stopped, failed) carrying the right data-tone, the model word, the board name, the elapsed time, a Button opening the transcript, and Stop / Resume controls where only the safe one is prominent. Draw every state: running, completed, stopped, failed. Fake props only; mark the four handlers with FILL: onStop, FILL: onResume, FILL: onOpenTranscript and FILL: session. ATTEMPT 1 ALREADY LANDED THIS STEP IN THE WORKING TREE: the row is 148 lines, the four markers sit on `const { session } = props; // FILL: session` and the three handler consts `stop`, `resume`, `openTranscript` (each `() => undefined`), the state words come from a literal map whose keys are 'kanban.metis.state.running' / '.completed' / '.stopped' / '.failed', and every other string is a literal t('kanban.metis.…') call. When this step's check already reads 4 and `grep -c LLMProviderLogo` on the row is at least 1, the composition is present: read it against the four states above, correct only what fails them, and do not recompose it from scratch."
check = "grep -c 'FILL:' src/modules/kanban/KanbanMetisRow.tsx"
expect = "4"

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanMetisPanel.tsx"
what = "The panel that holds the rows: a heading naming the board, a Launch Metis Button, the list of rows, an EmptyState from '@/shared/ui' for a board with no sessions, a Spinner for the first read, and a place for the transcript view to take over the panel body when a row is opened. Mark the data with FILL: sessions, the launch handler with FILL: onLaunch and the transcript body with FILL: transcript. It is a sibling of the card drawer, so compose it as a panel that can sit beside the board rather than as a modal. ATTEMPT 1 ALREADY LANDED THIS STEP IN THE WORKING TREE: the panel is 244 lines with props `{ boardId: string; boardName: string }`, a foldable strip whose header (title, board name, running count, Launch) stays through every state, the three markers on `const metis = metisPreview(boardId, boardName); // FILL: sessions`, `const launch = () => undefined; // FILL: onLaunch` and the JSX comment `{/* FILL: transcript */}`, and `metisPreview` exported on purpose (an unreferenced module const is an oxlint error; an unreferenced export is a warning). When this step's check already reads 3, the composition is present: read it against the states above, correct only what fails them, and do not recompose it from scratch."
check = "grep -c 'FILL:' src/modules/kanban/KanbanMetisPanel.tsx"
expect = "3"

[[steps]]
kind = "edit"
path = "src/modules/i18n/locales/en/common.json"
what = '''The English locale bundle is src/modules/i18n/locales/en/common.json — there is no src/i18n in this repository; the first draft of this step named that path wrongly, and it is forbidden now. The copy lives at kanban.metis.*, so it is a NEW object named `metis` inside the top-level `kanban` object, a SIBLING of `board` — never nested inside `board`. Place it directly after the `board` object's closing `},` (line 65 today, the line after `"questionsFolded_other": …`) and directly before `"lanes": {`. Its content is exactly this, pretty-printed with the file's existing two-space indentation, keys in this order: `"metis": { "title": "Metis", "launch": "Launch Metis", "loading": "Reading the fleet…", "empty": { "title": "No Metis on this board", "message": "Nothing is running here and nothing has run recently. Launch one to start working the board." }, "state": { "running": "Running", "completed": "Completed", "stopped": "Stopped", "failed": "Failed" }, "stop": "Stop", "resume": "Resume", "transcript": "Transcript", "ago": "{{elapsed}} ago", "exitCode": "exit {{code}}", "runningCount_one": "{{count}} running", "runningCount_other": "{{count}} running", "collapse": "Hide the fleet", "expand": "Show the fleet" },`. These are the seventeen keys the row and panel from steps 1 and 2 name: `runningCount` is called with `{ count }`, so i18next resolves it through the `_one` / `_other` pair and a bare `runningCount` key is not added; `ago` interpolates `elapsed` and `exitCode` interpolates `code`, the parameter names the row passes today. Keep the file valid JSON and touch no existing key — Phase 2's `kanban.board.deepseekFlash` / `deepseekFlashTooltip` stay byte-identical. Add nothing to any other language file: src/modules/i18n/config.ts:220 sets `fallbackLng: 'en'`, so every other language renders these English words until it is translated. If steps 1 or 2 changed a key name, the bundle follows the TSX: this step's check lists every key the two files name that the bundle does not resolve.'''
check = '''python3 -c 'import json,re,functools; b=json.load(open("src/modules/i18n/locales/en/common.json")); src="".join(open(f).read() for f in ["src/modules/kanban/KanbanMetisPanel.tsx","src/modules/kanban/KanbanMetisRow.tsx"]); keys=sorted(set(re.findall(r"\x27(kanban\.metis\.[A-Za-z0-9_.]+)\x27", src))); get=lambda k: functools.reduce(lambda d, p: d.get(p) if isinstance(d, dict) else None, k.split("."), b); ok=lambda k: isinstance(get(k), str) or (isinstance(get(k + "_one"), str) and isinstance(get(k + "_other"), str)); miss=[k for k in keys if not ok(k)]; print("keys=%d missing=%d" % (len(keys), len(miss)), *miss)' '''
expect_re = "^keys=[1-9][0-9]* missing=0$"

[[steps]]
kind = "run"
cmd = "npm run build:client"
check = "npm run build:client > /tmp/metis-p8-build.log 2>&1; echo $?"
expect = "0"
timeout_s = 420

[[verify]]
cmd = "grep -c 'LLMProviderLogo' src/modules/kanban/KanbanMetisRow.tsx"
expect_re = "^[1-9][0-9]*$"

[[verify]]
cmd = "python3 -c \"import re; print('LITERAL_COLOURS=%d' % sum(len(re.findall(r'#[0-9a-fA-F]{3,6}|var[(]--', open(f).read())) for f in ['src/modules/kanban/KanbanMetisPanel.tsx','src/modules/kanban/KanbanMetisRow.tsx']))\""
expect = "LITERAL_COLOURS=0"
timeout_s = 120

[[verify]]
cmd = "{ grep -l '\"metis\"' src/modules/i18n/locales/*/common.json || true; } | wc -l"
expect = "1"

[[verify]]
cmd = '''python3 -c 'import json; k=json.load(open("src/modules/i18n/locales/en/common.json"))["kanban"]; print("metis" in k, "metis" in k["board"], k["board"].get("deepseekFlash"))' '''
expect = "True False DeepSeek Flash"

[[verify]]
cmd = "test -e src/i18n && echo PRESENT || echo ABSENT"
expect = "ABSENT"
```

**What to build.** The screen the operator watches his fleet from. It is an operational surface:
dense, scannable, and honest about which sessions are spending which vendor's money.

**Sirens.** You will want to fetch the sessions here; the data is Phase 9's. You will want to
render the transcript yourself; the chat already has `SubagentTranscriptView` and Phase 9 wires
it — leave a marked place for it. You will want to put the panel in the board header's ActionMenu
as a dialog; the operator asked for a panel, and a dialog cannot be watched while the board moves.

You will find the row and the panel already composed by the first attempt. Do not tear them down
to rebuild them your own way; read them against steps 1 and 2, fix only what fails, and spend the
attempt on the English bundle. You will want to create `src/i18n` because an older line of this
plan named it — it is forbidden now; the English bundle is the one file named in step 3. You will
see ten other `common.json` bundles beside the English one and want to translate the new copy
into them — do not; `fallbackLng: 'en'` covers them and a verify counts exactly one bundle
carrying `"metis"`. You will want to tidy the `kanban.board` keys around the insertion point — do
not; Phase 2 shipped them and a verify reads `deepseekFlash` back. You will see `metisPreview`
exported with no reader and want to delete it — do not; it is the scaffold's fake data, and
Phase 9's fill replaces it.

## Phase 9 — The pilot panel, wired
Depends on: Phase 8

```toml
[phase]
id = "9"
builder = "hephaestus"
model = "opus"
kind = "fill"
scaffold_of = "8"
code_change = true
doc_sweep = "foreground"
expected_s = 2700
manifest = [
  "src/modules/kanban/KanbanMetisPanel.tsx",
  "src/modules/kanban/KanbanMetisRow.tsx",
  "src/modules/kanban/hooks/useKanbanMetis.ts",
  "src/modules/kanban/KanbanPanel.tsx",
  "src/shared/api.ts",
  "src/modules/chat/subagents/SubagentTranscriptView.tsx",
  "src/shared/types.ts",
  "src/modules/chat/hooks/useSubagentTranscript.ts",
  "src/modules/chat/index.ts",
]
forbidden = [
  "src/modules/kanban/KanbanBoardHeader.tsx",
  "server/modules/kanban-metis",
  "src/modules/dispatch-souls",
]
athena = [
  "useKanbanMetis polls on an interval instead of listening for the kanban_metis_state frame, so the board fights the server's own 2 s lane",
  "The hook does not re-seed on websocket_reconnected, so a dropped socket leaves the panel frozen on a stale fleet",
  "The panel renders sessions from every board instead of the selected one",
  "A FILL: token survives in a shipped file",
  "The new 'metis' transcript target broke the existing 'agent' or 'soul' paths in SubagentTranscriptView",
  "Stop fires without confirmation and without disabling itself, so a double click sends two SIGTERMs and the second races the SIGKILL",
  "useSubagentTranscript still sends a 'metis' target down the 'agent' route (api.subagentTranscripts.agent with a null chat session), so an opened Metis row reads the wrong route and never renders",
  "KanbanMetisPanel reaches SubagentTranscriptView by a deep '@/modules/chat/subagents/...' import instead of the chat barrel, or the barrel export carries no consumer comment",
  "The opened transcript's running flag is a constant instead of the opened session's state, so a finished Metis is polled every 2 s forever or a live one never refreshes",
  "The 'agent' or 'soul' call in useSubagentTranscript changed its arguments while the third branch was added",
]

[[steps]]
kind = "edit"
path = "src/shared/api.ts"
what = "Add an api.kanbanMetis group beside api.kanban with the five routes of the Interfaces section, built on the same get/post helpers, and add a `metis` member to api.subagentTranscripts pointing at the kanban-metis transcript route in the same shape as its existing `soul` member. Attempt 1 already landed this in the tree (the one reader `readKanbanMetisTranscript` at src/shared/api.ts:212-215, named by `subagentTranscripts.metis` at :755, and the `kanbanMetis` group): read it, confirm it carries the five routes, and leave it as it is when it does — never write a second copy."
check = "grep -c 'kanbanMetis' src/shared/api.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/shared/types.ts"
what = "Add 'metis' to the SubagentTranscriptTarget kind union, with a comment naming the kanban module as its consumer. Attempt 1 already landed this at src/shared/types.ts:2227-2228; confirm it reads `kind: 'agent' | 'soul' | 'metis'` and leave it when it does."
check = "grep -c \"'metis'\" src/shared/types.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "src/modules/kanban/hooks/useKanbanMetis.ts"
what = "The hook: one REST seed on mount and on the websocket_reconnected event, then listen for the kanban_metis_state frame through useWebSocket() and filter to the current board — the exact shape SoulLaunchFeed.tsx:46-79 uses. Expose { sessions, loading, launch, stop, resume } and no interval of its own. Comment every state declaration with why it is essential, per the frontend standards. Attempt 1 already created this file (198 LOC); confirm it against this step and leave it when it matches."
check = "{ grep -c 'setInterval' src/modules/kanban/hooks/useKanbanMetis.ts || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "src/modules/chat/hooks/useSubagentTranscript.ts"
what = "THE ROUTE SELECTION. At src/modules/chat/hooks/useSubagentTranscript.ts:78-80 the read is one ternary, `kind === 'soul' ? await api.subagentTranscripts.soul(id) : await api.subagentTranscripts.agent(agentSessionId, id)`, which sends EVERY non-soul kind — a 'metis' target included — down the agent route. Replace that one expression with a three-way selection on `kind`: 'soul' reads `api.subagentTranscripts.soul(id)`, 'metis' reads `api.subagentTranscripts.metis(id)`, 'agent' reads `api.subagentTranscripts.agent(agentSessionId, id)`. Write each of the three calls on ONE line with exactly that text, so the check below can count them. Leave the guard at :67 (`if (kind === 'agent' && sessionId === null) return;`) exactly as it is: a Metis is addressed by the session id the board minted, which is its target id, and needs no chat session. Leave the effect's dependency list at :108, the poll timer, the catch branch and the keying untouched — the 'agent' and 'soul' paths must behave byte-identically. Extend the doc sentence at :48 (`Read by the chat module's subagents/SubagentTranscriptView.tsx.`) to say that view is also opened by the kanban module's KanbanMetisPanel.tsx for a 'metis' target."
check = '''for s in 'api.subagentTranscripts.soul(id)' 'api.subagentTranscripts.agent(agentSessionId, id)' 'api.subagentTranscripts.metis(id)'; do grep -cF "$s" src/modules/chat/hooks/useSubagentTranscript.ts || true; done | paste -sd,'''
expect = "1,1,1"

[[steps]]
kind = "edit"
path = "src/modules/chat/subagents/SubagentTranscriptView.tsx"
what = "Accept the third target kind 'metis' so the existing view and useSubagentTranscript render a Metis transcript unchanged. This is a union widening and a route selection, nothing more — the 'agent' and 'soul' paths must behave byte-identically. MEASURED after attempt 1: the view needs NO logic change — its `target` prop is typed `SubagentTranscriptTarget` (src/modules/chat/subagents/SubagentTranscriptView.tsx:47), which already carries 'metis' since src/shared/types.ts:2228, and it hands `sessionId, target, running` straight to the hook (:54), whose route selection is the step above. The one edit here is its doc comment's closing `Drawn by …` sentence (:35-36, currently naming `subagents/SubagentWidgetBody.tsx` and `transcript/PinnedSubagents.tsx`): add the third drawer, the kanban module's `KanbanMetisPanel.tsx`, which opens a board Metis's fleet row into this view with a 'metis' target and no chat session. Do not change the props, the hook call at :54, or any line of the render."
check = '''{ grep -c 'KanbanMetisPanel' src/modules/chat/subagents/SubagentTranscriptView.tsx || true; grep -cF 'useSubagentTranscript(sessionId, target, running)' src/modules/chat/subagents/SubagentTranscriptView.tsx; } | paste -sd,'''
expect_re = "^[1-9][0-9]*,1$"

[[steps]]
kind = "edit"
path = "src/modules/chat/index.ts"
what = "THE BARREL EXPORT. src/modules/chat/index.ts does not export SubagentTranscriptView today (it exports SubagentWidgetBody, useSubagentWidgetCount and useClaimSubagentStrip for chat-gutters), and the kanban module reaches another module only through its barrel. Append ONE export at the end of the file, `export { SubagentTranscriptView } from '@/modules/chat/subagents/SubagentTranscriptView';`, preceded by a `//` comment in the style of the file's existing ones (lines 4-5 are the pattern) naming its consumer: the kanban module's KanbanMetisPanel.tsx, which opens a board Metis's row into the same transcript view the chat's subagent rows use. Add nothing else to the barrel — not useSubagentTranscript, not the target type."
check = '''grep -cF "export { SubagentTranscriptView } from '@/modules/chat/subagents/SubagentTranscriptView';" src/modules/chat/index.ts'''
expect = "1"

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanMetisRow.tsx"
what = "Replace the four FILL: markers with the real session prop and the three handlers. Change nothing else — the composition, states and copy outside the marker lines stay byte-identical."
check = "{ grep -c 'FILL:' src/modules/kanban/KanbanMetisRow.tsx || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanMetisPanel.tsx"
what = "Replace the three FILL: markers with useKanbanMetis's sessions, its launch handler, and SubagentTranscriptView for the opened row. Change nothing else outside the marker lines. MEASURED after attempt 1: the first two are filled (useKanbanMetis at :92, the header's Launch); ONE marker stands, `{/* FILL: transcript */}` at src/modules/kanban/KanbanMetisPanel.tsx:109, inside the scroller div. Replace that marker line with `<SubagentTranscriptView sessionId={null} target={{ kind: 'metis', id: openedId }} label={…} running={…} onBack={() => setOpenedId(null)} />`, and import the view as `import { SubagentTranscriptView } from '@/modules/chat';` — the barrel the step above exports it from, never the deep '@/modules/chat/subagents/…' path. The props, decided: `sessionId={null}` because that prop addresses an 'agent' row through its chat and a Metis belongs to no chat; `target` is `{ kind: 'metis', id: openedId }` (openedId is non-null inside the `if (openedId !== null)` branch at :100); the opened session is `metis.sessions.find((session) => session.sessionId === openedId)`, and `running` is true exactly when that session exists with `state === 'running'` (a session missing from the list reads false, so nothing polls a Metis the board no longer shows); `label` is that session's `model`, or `t('kanban.metis.transcript')` when it is missing (the key KanbanMetisRow.tsx:128 already uses); `onBack` sets openedId back to null. The copy-from pattern for these props is src/modules/chat/transcript/PinnedSubagents.tsx:129-135."
check = "{ grep -c 'FILL:' src/modules/kanban/KanbanMetisPanel.tsx || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "src/modules/kanban/KanbanPanel.tsx"
what = "Mount KanbanMetisPanel as a sibling of KanbanCardDrawer and KanbanImportDialog, after line 229 and before the aria-live region, passing the current board id and name. It renders only while a board is selected."
check = "grep -c 'KanbanMetisPanel' src/modules/kanban/KanbanPanel.tsx"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint:client && npm run build:client"
check = "npm run typecheck > /tmp/metis-p9-tc.log 2>&1 && npm run lint:client >> /tmp/metis-p9-tc.log 2>&1 && npm run build:client >> /tmp/metis-p9-tc.log 2>&1; echo $?"
expect = "0"
timeout_s = 560

[[verify]]
cmd = '''
set -e
cd /home/lyphe/.claude/claudecodeui_lyphe
cp ~/.cloudcli/local-server.json /tmp/metis-marker.bak 2>/dev/null || true
SERVER_PORT=7893 node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > /tmp/metis-server.log 2>&1 &
echo $! > /tmp/metis-server.pid
for i in $(seq 1 90); do curl -sf http://127.0.0.1:7893/api/auth/status > /dev/null && break; sleep 1; done
T=$(python3 - <<'PY'
import sqlite3, json, hmac, hashlib, base64, time, os
conn = sqlite3.connect(os.path.expanduser('~/.cloudcli/auth.db'))
secret = conn.execute("select value from app_config where key='jwt_secret'").fetchone()[0].encode()
uid, uname = conn.execute('select id, username from users order by id limit 1').fetchone()
enc = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(',', ':')).encode()).rstrip(b'=')
now = int(time.time())
head = enc({'alg': 'HS256', 'typ': 'JWT'})
body = enc({'userId': uid, 'username': uname, 'iat': now, 'exp': now + 3600})
sig = base64.urlsafe_b64encode(hmac.new(secret, head + b'.' + body, hashlib.sha256).digest()).rstrip(b'=')
print((head + b'.' + body + b'.' + sig).decode())
PY
)
node scripts/kanban-ui-probe.mjs http://127.0.0.1:7893 "$T" "claudecodeui_lyphe" "Kanban" "Metis" > /tmp/metis-p9-probe.log 2>&1 && R=PROBE-OK || R=PROBE-FAILED
kill "$(cat /tmp/metis-server.pid)" 2>/dev/null || true
sleep 1
cp /tmp/metis-marker.bak ~/.cloudcli/local-server.json 2>/dev/null || true
echo "$R"
'''
expect = "PROBE-OK"
timeout_s = 560

[[verify]]
cmd = "{ grep -rc 'FILL:' src/modules/kanban/ | grep -v ':0' | wc -l; }"
expect = "0"
timeout_s = 120

[[verify]]
cmd = '''{ grep -rn "from '@/modules/chat/" src/modules/kanban/ || true; } | wc -l'''
expect = "0"
timeout_s = 60

[[verify]]
cmd = '''grep -cF "from '@/modules/chat';" src/modules/kanban/KanbanMetisPanel.tsx'''
expect = "1"
timeout_s = 60
```

**What to build.** One hook, four handlers, one union widening, one route selection in the chat's
transcript hook, one barrel export from the chat module, one mount point. Attempt 1 left the api
group, the union, `useKanbanMetis`, the row and the mount in the tree; they are confirmed, not
rewritten. What remains is the chat side (`useSubagentTranscript.ts`'s three-way read, the view's
consumer sentence, `index.ts`'s export) and the panel's last marker.

**Sirens.** You will want to poll `GET /sessions` on a timer because it is simpler than the frame;
the server already polls its own disk at 2 s and pushes on change, and a second poll doubles the
work for no freshness. You will want to copy `SubagentTranscriptView` rather than widen it; one
view, three kinds.

You will want to import `SubagentTranscriptView` from `@/modules/chat/subagents/SubagentTranscriptView`
because that path already resolves and the barrel does not export it yet; do not — export it from
`src/modules/chat/index.ts` in this phase and import it from `@/modules/chat`. You will want to pass
the Metis session id as the view's `sessionId`; do not — that prop is the CHAT's session for an
'agent' row, the Metis id travels in `target.id`, and `sessionId={null}` is decided. You will want
to also export `useSubagentTranscript` or the target type from the chat barrel while you are there;
do not — one export, one consumer. You will see `npm run lint:client` report findings in files
outside this manifest (173 measured after attempt 1) and `src/modules/kanban/KanbanBoardHeader.tsx`
already modified in the working tree by another session; do not fix those findings and do not touch
that forbidden file — note them and keep rowing. If the build or the probe reports a circular
import through `@/modules/chat`, or any check fails for a reason this phase does not name, stop and
report the divergence verbatim; do not improvise a fix.

## Phase 10 — The driver: one tick, reap before spawn
Depends on: Phase 1, Phase 7

```toml
[phase]
id = "10"
builder = "hephaestus"
model = "opus"
code_change = true
doc_sweep = "foreground"
expected_s = 3600
manifest = [
  "server/modules/kanban-metis/metis-driver.service.ts",
  "server/modules/kanban-metis/metis-liveness.ts",
  "server/modules/kanban-metis/kanban-metis.module.ts",
  "server/modules/kanban-metis/kanban-metis.routes.ts",
  "server/modules/kanban-metis/index.ts",
]
forbidden = [
  "server/modules/kanban-metis/metis-spawn.service.ts",
  "server/modules/kanban-metis/mcp",
  "server/modules/kanban-metis/brief",
  "server/modules/kanban",
  "server/index.ts",
]
athena = [
  "The tick spawns before it reaps, so the live count it reads is stale and the board overshoots its concurrency dial",
  "claimableCount is read once per tick for every board including archived and autonomy-off ones, so an idle box spends a query per board per 15 s forever",
  "A board with autonomy on and zero claimable cards still spawns, so Metis wakes, finds nothing and exits, in a loop that never stops",
  "The churn cooldown is keyed globally rather than per board, so one busy board starves every other",
  "The quiescence rule reaps a session that is mid-build but quiet because its plan-runner child is doing the talking, killing a live build",
  "The driver tick throws on one board and takes the whole interval down with it, silently, so autonomy stops without a word in the log",
]

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/metis-liveness.ts"
what = "The pure predicates, no I/O beyond an fs.stat the caller may pass in: quiescent(session, now) and stalled(session, now) exactly as the Interfaces dial table gives them — a session is reapable only when it is older than QUIESCE_MIN_AGE_MS AND ( its child is dead, OR its child.log has not moved for QUIESCE_QUIET_MS and its owner holds no fresh lease, OR its child.log has not moved for STALL_MS ). Export exactly FOUR constants — QUIESCE_MIN_AGE_MS, QUIESCE_QUIET_MS, STALL_MS and LEASE_STALE_SECONDS (re-exported from server/shared/kanban-types.js) — the ones these predicates read. TICK_MS, DEFAULT_CONCURRENCY and CHURN_COOLDOWN_MS are cadence, not liveness, and belong beside the tick in metis-driver.service.ts; do not declare them here. Every function is total: no throw, no undefined return. The check spells the flag `--tsconfig=server/tsconfig.json` with an `=` on purpose and must be run exactly as written: tsx 4.21.0 drops the `-e` eval pair when `--tsconfig` and its value are separated by a space, and node then runs scriptless — rc 0, empty stdout, a false failure (measured 2026-09-17). A space-separated `--tsconfig` in front of a script PATH (the server boot in the verify) is unaffected; leave that line as it is."
check = "cd /home/lyphe/.claude/claudecodeui_lyphe && node_modules/.bin/tsx --tsconfig=server/tsconfig.json -e \"import('./server/modules/kanban-metis/metis-liveness.js').then(m => console.log(m.QUIESCE_MIN_AGE_MS, m.QUIESCE_QUIET_MS, m.STALL_MS, m.LEASE_STALE_SECONDS, m.TICK_MS))\""
expect = "300000 180000 2700000 40 undefined"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/metis-driver.service.ts"
what = "The tick loop, and the three cadence constants it reads — TICK_MS = 15000, DEFAULT_CONCURRENCY = 1 and CHURN_COOLDOWN_MS = 60000, declared HERE beside the decision each one makes. The tick runs in pm_capacity.py:640-667's order and never another: read the live set; mark exited children; reap the quiescent and the stalled through the spawner's stop; then, for each board from kanbanBoardsService.listBoards({}) that is NOT archived and has autonomy true, spawn while live-for-that-board is under its concurrency and claimableCount(boardId) is above zero and no spawn for that board landed within CHURN_COOLDOWN_MS. Every tick is wrapped so one board's failure is logged and the interval survives. start() and stop() are exported; the interval is unref()'d."
check = "grep -c 'claimableCount' server/modules/kanban-metis/metis-driver.service.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/kanban-metis.routes.ts"
what = "Add GET /api/kanban-metis/boards/:boardId/driver answering { autonomy: boolean, concurrency: number, claimable: number, live: number, lastSpawnAt: number | null } — the driver's own reading for that board, so its decision is observable rather than inferred from behaviour."
check = "grep -c 'lastSpawnAt' server/modules/kanban-metis/kanban-metis.routes.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/kanban-metis.module.ts"
what = "Start the driver from the composition root, after the registry has re-adopted, and stop it on the module's teardown path if one exists. The driver is constructed with the registry and the spawner it already builds."
check = "grep -c 'metisDriver\\|startDriver' server/modules/kanban-metis/kanban-metis.module.ts"
expect_re = "^[1-9][0-9]*$"

[[steps]]
kind = "edit"
path = "server/modules/kanban-metis/index.ts"
what = "Export nothing new unless server/index.ts needs it — the driver is started inside the module. Update the barrel's consumer comments to name the driver as a module-internal service."
check = "{ grep -c 'metis-driver' server/modules/kanban-metis/index.ts || true; }"
expect = "0"

[[steps]]
kind = "run"
cmd = "npm run typecheck && npm run lint:server"
check = "npm run typecheck > /tmp/metis-p10-tc.log 2>&1 && npm run lint:server >> /tmp/metis-p10-tc.log 2>&1; echo $?"
expect = "0"
timeout_s = 480

[[verify]]
cmd = '''
set -e
cd /home/lyphe/.claude/claudecodeui_lyphe
cp ~/.cloudcli/local-server.json /tmp/metis-marker.bak 2>/dev/null || true
B=""
cleanup() {
  # Runs on EVERY exit (trap), so a stopped run or a failed step leaves no probe server, no orphan
  # Metis, no scratch pair, and none of the three roots the child writes into regardless of the
  # state root (its cwd root, its flag file, the transcript the CLI keys on that cwd) -- nothing in
  # the repo removes those otherwise (measured 2026-09-17: six probe boards, 5 MB of transcripts).
  if [ -n "$B" ] && [ -f /tmp/metis-server.pid ] && kill -0 "$(cat /tmp/metis-server.pid)" 2>/dev/null; then
    for S in $(curl -sf http://127.0.0.1:7893/api/kanban-metis/sessions -H "Authorization: Bearer $T" 2>/dev/null | python3 -c 'import sys,json; [print(s["sessionId"]) for s in json.load(sys.stdin)["sessions"] if s["state"]=="running"]' 2>/dev/null); do
      curl -sf -X POST "http://127.0.0.1:7893/api/kanban-metis/sessions/$S/stop" -H "Authorization: Bearer $T" > /dev/null 2>&1 || true
    done
    sleep 2
  fi
  kill "$(cat /tmp/metis-server.pid 2>/dev/null)" 2>/dev/null || true
  sleep 1
  rm -rf /tmp/metis-p10-state /tmp/metis-p10.db /tmp/metis-p10.db-wal /tmp/metis-p10.db-shm /tmp/metis-server.pid
  if [ -n "$B" ]; then
    rm -rf "$HOME/.claude/kanban-metis/$B" "$HOME/.claude/state/kanban-deepseek/$B.flag" "$HOME/.claude/projects/"*"kanban-metis-$B"
  fi
  # The probe server's boot overwrote the operator's marker; put the backup back ONLY if the file
  # still names the probe's pid -- a dev-supervisor restart inside the window wrote a fresh one.
  python3 - <<'PY' || true
import json, os
m = os.path.expanduser('~/.cloudcli/local-server.json'); bak = '/tmp/metis-marker.bak'
try:
    cur = json.load(open(m)); probe_pid = int(open('/tmp/metis-server.pid.last').read())
except Exception:
    raise SystemExit(0)
if int(cur.get('pid') or 0) == probe_pid and os.path.exists(bak):
    os.replace(bak, m)
PY
}
trap cleanup EXIT
# The probe runs on a SCRATCH copy of the database and a SCRATCH state root: the operator's dev
# server (a second long-lived server on the same code and the same DATABASE_PATH) would otherwise
# tick the probe board too, spawn its own Metis, and its sessions would be adopted -- and stopped --
# by this probe's registry (measured 2026-09-17: b-137, b-138, b-139 each got two Metises).
rm -rf /tmp/metis-p10-state; mkdir -p /tmp/metis-p10-state
python3 -c "import sqlite3, os; sqlite3.connect('file:' + os.path.expanduser('~/.cloudcli/auth.db') + '?mode=ro', uri=True).execute(\"VACUUM INTO '/tmp/metis-p10.db'\")"
DATABASE_PATH=/tmp/metis-p10.db KANBAN_METIS_STATE_ROOT=/tmp/metis-p10-state SERVER_PORT=7893 node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > /tmp/metis-server.log 2>&1 &
echo $! > /tmp/metis-server.pid
for i in $(seq 1 90); do curl -sf http://127.0.0.1:7893/api/auth/status > /dev/null && break; sleep 1; done
T=$(python3 - <<'PY'
import sqlite3, json, hmac, hashlib, base64, time, os
conn = sqlite3.connect('/tmp/metis-p10.db')
secret = conn.execute("select value from app_config where key='jwt_secret'").fetchone()[0].encode()
uid, uname = conn.execute('select id, username from users order by id limit 1').fetchone()
enc = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(',', ':')).encode()).rstrip(b'=')
now = int(time.time())
head = enc({'alg': 'HS256', 'typ': 'JWT'})
body = enc({'userId': uid, 'username': uname, 'iat': now, 'exp': now + 3600})
sig = base64.urlsafe_b64encode(hmac.new(secret, head + b'.' + body, hashlib.sha256).digest()).rstrip(b'=')
print((head + b'.' + body + b'.' + sig).decode())
PY
)
B=$(curl -sf -X POST http://127.0.0.1:7893/api/kanban/boards -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"name":"probe-metis10"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["board"]["id"])')
OFF=$(curl -sf "http://127.0.0.1:7893/api/kanban-metis/boards/$B/driver" -H "Authorization: Bearer $T" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["autonomy"], d["claimable"], d["live"])')
sleep 20
IDLE=$(curl -sf "http://127.0.0.1:7893/api/kanban-metis/boards/$B/driver" -H "Authorization: Bearer $T" | python3 -c 'import sys,json; print(json.load(sys.stdin)["live"])')
curl -sf -X POST "http://127.0.0.1:7893/api/kanban/boards/$B/cards" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"title":"driver probe card one","status":"todo","description":"work for the driver probe"}' > /dev/null
curl -sf -X POST "http://127.0.0.1:7893/api/kanban/boards/$B/cards" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"title":"driver probe card two","status":"todo","description":"more work for the driver probe"}' > /dev/null
# The claimable count is read BEFORE autonomy turns on (PRE): once the driver spawns a Metis she
# claims the cards and moves them to `questions`, and whether that lands inside the window is a
# RACE (measured 2026-09-16: 2.3 s to spare), so no post-spawn count is a fact this phase owns.
PRE=$(curl -sf "http://127.0.0.1:7893/api/kanban-metis/boards/$B/driver" -H "Authorization: Bearer $T" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["autonomy"], d["claimable"], d["live"])')
curl -sf -X PATCH "http://127.0.0.1:7893/api/kanban/boards/$B" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"autonomy":true}' > /dev/null
sleep 40
# After the window the only reading the driver itself DECIDES is lastSpawnAt: stamped when a launch
# landed, never cleared, immune to a child that exits early or a record left running.
ON=$(curl -sf "http://127.0.0.1:7893/api/kanban-metis/boards/$B/driver" -H "Authorization: Bearer $T" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["autonomy"], "spawned" if d.get("lastSpawnAt") else "never-spawned")')
curl -sf -X PATCH "http://127.0.0.1:7893/api/kanban/boards/$B" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"autonomy":false}' > /dev/null
# Cleanup is the trap's (every exit path). The probe's registry holds ONLY the sessions this probe
# spawned, so it stops nothing of the operator's; nothing of this probe ever touches the live database.
echo "OFF=[$OFF] IDLE=$IDLE PRE=[$PRE] ON=[$ON]"
'''
expect = "OFF=[False 0 0] IDLE=0 PRE=[False 2 0] ON=[True spawned]"
timeout_s = 580

[[verify]]
cmd = '''
cd /home/lyphe/.claude/claudecodeui_lyphe
python3 - <<'PY'
src = open('server/modules/kanban-metis/metis-driver.service.ts').read()
reap = src.find('reap')
spawn = src.find('spawn', src.find('tick'))
print("REAP_BEFORE_SPAWN=%s" % (0 <= reap < spawn))
PY
'''
expect = "REAP_BEFORE_SPAWN=True"
timeout_s = 120
```

**What to build.** One interval, one ordered tick, six named constants, one observable reading.
Everything the driver does is a decision the `/driver` route can be asked about — a daemon whose
reasoning cannot be read is a daemon nobody can debug at 3 a.m.

**Reap before spawn, always.** `pm_capacity.py:654-658` says why in its own comment: the live
count the spawner reads has to be the tick's POST-reap snapshot, or the board overshoots its dial
every time a session is dying.

**Sirens.** You will want to make the tick faster than 15 s because the probe waits are long; the
dials are ported numbers and changing one changes the reap semantics. You will want to reap a
quiet session mid-build — a Metis whose `plan-runner` is doing the work is quiet by design, which
is exactly why quiescence requires BOTH a quiet log AND no fresh lease. You will want to add a
global governor like Descent's `allow_spawn`; the board's governor is the autonomy switch, and a
second one is a second place to be turned off. The verify's probe server runs on a scratch copy of
the database and a scratch state root, so no other server ever sees its board; its trap removes
its own sessions, the scratch pair and the three roots the child writes into. Do not add a sweep
that signals sessions by board name -- that shape once stopped the operator's own Metises.

## Phase 11 — The lane's documentation
Depends on: Phase 3, Phase 9, Phase 10

```toml
[phase]
id = "11"
builder = "prometheus"
model = "sonnet"
code_change = false
doc_sweep = "foreground"
expected_s = 2400
manifest = [
  "docs/kanban.md",
  "docs/plan-runner.md",
  "/home/lyphe/.claude/hooks/README.md",
]
forbidden = [
  "docs/dispatch-souls.md",
  "docs/deepseek-balance.md",
  "server/modules/kanban-metis",
]
athena = [
  "docs/kanban.md still says nothing here schedules, builds or resumes anything, which stopped being true in Phase 10",
  "The project_id sentences at :42 and :371 still say the column is never anything but a label, when it now decides the child's one --add-dir",
  "The per-board DeepSeek precedence is documented in kanban.md but not in plan-runner.md, so a reader of the switch's own home still believes it is host-wide",
  "The seclusion mechanism is described as a filter on the session list rather than as a refusal to enrol, which is the opposite of what shipped",
  "A new document about this work was created instead of the three named files being updated",
  "~/.claude/CLAUDE.md was edited",
]

[[steps]]
kind = "edit"
path = "docs/kanban.md"
what = "Correct THREE claims this plan made false. Line 25's 'nothing here schedules, builds or resumes anything', because the driver now does. And the two sentences that call a board's project_id a label and never a filter (:42 and the paragraph at :371): it is still not a lane filter, but it is no longer inert — it is what resolves to the one --add-dir a board's Metis is given, and a board with a null project_id gives her none, so she works only inside her own session directory. Say both things in the same sentence so neither reading is lost. Add sections for: the driver and its six dials and its tick order; the kanban-pm MCP surface and its 25 tools and the four honest lesson stubs; the board's Metis brief and where it lives; the seclusion mechanism, stated as what it is — the synchroniser refuses to ENROL a board session's transcript, so no row is ever created, and the three hook seams; the pilot panel; and the two switches with the precedence rule spelled out: a board-launched Metis and every plan-runner she starts read ~/.claude/state/kanban-deepseek/<boardId>.flag, and the host-wide ~/.claude/state/deepseek_flash.flag is NEVER consulted for them. Name which guards apply to a board Metis (G1, G2, G5, G10) and which stay Descent-only until sunset (G3, G4, G4b, G6, G7, G8, G9), with one line each on why."
check = "{ grep -c 'nothing here schedules, builds or resumes anything' docs/kanban.md || true; }"
expect = "0"

[[steps]]
kind = "edit"
path = "docs/plan-runner.md"
what = "In the section 'The DeepSeek switch — the one state file this server writes', correct 'Host-wide, not per-user' — it is now host-wide EXCEPT for a plan-runner started by a board's Metis, which reads that board's own flag file through PLAN_RUNNER_DEEPSEEK_FLAG_PATH. State the precedence in one paragraph, name the file path, name where the variable is read (flag_path() in hooks/plan_runner/deepseek.py, at call time), and point at docs/kanban.md for the board side. Do not restate the board's rules here."
check = "grep -c 'kanban-deepseek\\|PLAN_RUNNER_DEEPSEEK_FLAG_PATH' docs/plan-runner.md"
expect_re = "^[2-9]$|^[1-9][0-9]$"

[[steps]]
kind = "edit"
path = "/home/lyphe/.claude/hooks/README.md"
what = "In the 'Metis-session scoping' section, add the kanban seam: a FOURTH stamp trigger — a session whose cwd is under ~/.claude/kanban-metis/ is a board-launched Metis and stamps the marker without a typed /pm — and the two Stop guards that stand down for one (G4 and G4b, because both read Descent's store and would judge it against the wrong board). Name kanban_metis.py in the Module map table. Say in one line which guards still apply (G1, G2, G5, G10) and that the rest never fire because a board session's tools are mcp__kanban-pm__* rather than mcp__descent-pm__*."
check = "grep -c 'kanban_metis' /home/lyphe/.claude/hooks/README.md"
expect_re = "^[2-9]$|^[1-9][0-9]$"

[[verify]]
cmd = '''
cd /home/lyphe/.claude/claudecodeui_lyphe
A=$(grep -c 'kanban-deepseek' docs/kanban.md || true)
B=$(grep -c 'kanban-deepseek' docs/plan-runner.md || true)
C=$(grep -c 'kanban_metis' "$HOME/.claude/hooks/README.md" || true)
echo "KANBAN=$([ "$A" -ge 1 ] && echo ok) RUNNER=$([ "$B" -ge 1 ] && echo ok) HOOKS=$([ "$C" -ge 2 ] && echo ok)"
'''
expect = "KANBAN=ok RUNNER=ok HOOKS=ok"
timeout_s = 180

[[verify]]
cmd = "grep -c 'G4b' docs/kanban.md"
expect_re = "^[1-9][0-9]*$"
timeout_s = 120
```

**What to write.** Three existing files, corrected. `docs/kanban.md` carries a sentence that this
plan makes false; correcting it is the point, not an aside.

**Sirens.** You will want to write `docs/kanban-metis.md` because the subject is large; Constraint
12 forbids a second home. You will want to explain the DeepSeek rules again in `plan-runner.md`;
one home, one paragraph, a pointer.

## Goal

*Goal:* a board with autonomy ON keeps a Metis session alive against **that board and nothing
else**, she claims a lease, asks a question on a card, plans, and builds through a `plan-runner`
whose provider the board's own switch decides — and no session she runs is visible anywhere in
the app but the Kanban tab.

*Verify by:* the acceptance walk in "Proving the whole thing" below, run once end to end.

## Proving the whole thing

The per-phase `[[verify]]` blocks are what the runner checks. This is the walk a person does
afterwards, once, against the operator's own server:

1. Make a scratch board, put two To Do cards on it, turn the board's DeepSeek switch ON and
   autonomy ON.
2. Watch the pilot panel: within one tick a Metis appears, `provider` reading `deepseek` and
   `model` reading `deepseek-flash`.
3. `GET /api/kanban/boards/<b>/cards?status=active` shows a card with a build owner and a fresh
   lease; refresh it 60 s later and the lease stamp has moved — the MCP heartbeat is alive.
4. She posts a question; it appears in the board's Open questions lane. Answer it on the board;
   `answered` flips and a `kanban_decisions` row exists.
5. She attaches a plan and runs it. `~/.claude/state/runner/<run>/phase_*/child.log` names
   `deepseek-flash` for the builder, the fix-pass and Athena, and
   `~/.claude/state/kanban-deepseek/<b>.flag` reads `on` while
   `~/.claude/state/deepseek_flash.flag` is untouched.
6. Turn the board's DeepSeek switch OFF. The live session keeps its provider (by design); stop it
   and let the driver spawn the next — it reads `claude` / `opus`.
7. `select count(*) from sessions where session_id in (…her uuids…)` is 0, the sidebar lists
   nothing new, the command palette finds nothing, and `~/.claude/projects/` has her transcript
   but the app has no row for it.
8. In an ordinary chat session in this repo, ask for `/pm` — there is no such command in this
   app's session, `skill_router.py` and `soul_routing.py` suggest nothing, and
   `~/.claude/state/metis_session_<that sid>.marker` does not exist.

## Waves

Wave 1: Phase 1, Phase 4, Phase 6 — the column, the MCP server and the seclusion seam; none reads another's output and their manifests are disjoint
Wave 2: Phase 2, Phase 5 — the header scaffold and the brief
Wave 3: Phase 3 — the switch wiring
Wave 4: Phase 7 — the spawner; consumes the column, the brief, the MCP command and the seclusion seam
Wave 5: Phase 8 — the panel scaffold
Wave 6: Phase 9, Phase 10 — the panel fill and the driver; the panel is client, the driver is server
Wave 7: Phase 11 — the docs

Phase 4 and Phase 6 open `Depends on: none`: the MCP program reads the board over HTTP and needs
no column that is not already there, and the seclusion seam touches the synchroniser and the hooks,
which the column never enters. The manual launch (Phase 7) still lands before the daemon (Phase 10),
which is the operator's own ordering — a Metis you can start by hand and watch, before one that
starts herself.

The plan is ONE file. Wave 1 holds three independent phases of a sitting each; ask for the split
and it becomes three sessions. It is not split here because the concurrency mode was not requested.

## Decisions already made, with their reversals

1. **The driver lives in a NEW module, `server/modules/kanban-metis/`, not inside
   `server/modules/kanban/`.** The board's module is 3 321 LOC of data and verbs whose stated
   identity is that it schedules nothing (`docs/kanban.md:25`); a process-spawning daemon is a
   different concern and would push that module past every ceiling. It reaches the board only
   through `server/modules/kanban/index.ts`. *Reversal:* a directory move and an import rewrite.
2. **The MCP server is a separate PROCESS speaking HTTP to the board, not an in-process SDK
   server.** `createSdkMcpServer` exists in the installed Agent SDK but is used nowhere here, and
   the CLI child is not an SDK `query()`; a stdio child is the only surface it has. HTTP is not
   chosen over an in-process call — **there is no in-process call available to a separate
   process.** (`writeKanban` and the `kanban_event` fan-out live in the SERVICE and fire on either
   path; the hop does not buy them, and saying it did would be a reason that survives its own
   premise being false.) *Reversal:* if the board ever drives Metis through the chat provider
   instead of a CLI child, the tools become `tool()` definitions over the same client.
3. **Hand-rolled JSON-RPC, no new dependency.** `server/modules/browser-use/browser-use-mcp.ts` is
   already exactly this program in this repository, and Descent's own 25-tool server is hand-rolled
   too. `@modelcontextprotocol/sdk` is on disk at 1.29.0 only as a transitive dependency of the
   Agent SDK. *Reversal:* add `"@modelcontextprotocol/sdk": "^1.29.0"` to `dependencies` and use
   its low-level `Server` + `StdioServerTransport` with the same raw JSON-Schema tool table.
4. **Server name `kanban-pm`; the twenty-five tool NAMES are identical to `descent-pm`'s.** The
   names carry the brief's prose and the hook matchers unchanged; the distinct server word lets the
   two surfaces coexist on one host and lets a guard tell which store a call touched.
   *Reversal:* a find-and-replace in the brief and in the tool table.
5. **Seclusion is a refusal to ENROL, not a filter.** The synchroniser skips a board session's
   transcript before `sessionsDb.createSession` is reached, so no `sessions` row and no `projects`
   row is ever minted and every downstream reader is secluded by construction. The house already
   learned that filtering fails here: `runner-transcripts`' first cut was a `<slug>/runner/`
   subfolder and all 27 "swept" transcripts were still rows. *Reversal:* an `origin` column on
   `sessions` plus a `WHERE origin IS NULL` in the three list queries.
6. **The board-issued identity is the child's `cwd`, not an env var or a typed `/pm`.** Every hook
   payload carries `cwd`; `~/.claude/kanban-metis/<boardId>/` is unambiguous, survives a resume,
   and needs no cooperation from the CLI. *Reversal:* a `KANBAN_METIS_BOARD_ID` env check beside
   it — the variable is already in the child's environment.
7. **`CLAUDE_CONFIG_DIR` is NOT used to relocate the transcript.** It would also relocate
   `~/.claude/settings.json` and `~/.claude/.credentials.json`, taking every hook dark and breaking
   Claude authentication. The synchroniser skip achieves the same seclusion at none of that cost.
8. **The lease heartbeat lives in the MCP process, not in the driver — and the owner is DERIVED,
   `sha256(sessionId)[:16]`, not minted.** The lease verbs are compare-and-set on the owner, so a
   refresh from a process not acting as that owner defeats the CAS; the heartbeat therefore stays
   where the owner acts (Descent's own design, `mcp_server.py:303-345`). But Descent MINTS its
   token (`mcp_server.py:298`) and keeps it in one process's memory, which the board cannot
   afford: a resumed or re-adopted Metis would come back unable to refresh leases she still holds
   and would be reaped by her own stall rule. Derivation keeps the shape — sixteen lowercase hex —
   and drops the property that made it unrecoverable. The heartbeat's in-memory list of claimed
   card ids is an OPTIMISATION only; the owner being derivable means a process that lost the list
   can re-read `list_active_builds` and refresh what is its own. *Reversal:* a
   `refreshLeasesForOwner(owner)` verb on the kanban module and a driver-side beat.
9. **A DeepSeek flip does NOT restart a live session.** It applies at the next spawn, exactly as
   the plan-runner's own switch does, and the pilot panel paints what each live session is actually
   spending. *Reversal:* a `RESTART_ON_FLIP` constant in `metis-driver.service.ts`.
10. **The per-board flag file is DERIVED at spawn from the board row, never written when the PATCH
    lands.** It only matters to a process the driver starts, and a listener on the board's write
    path would couple the data lane to a file-writing concern. *Reversal:* write it in the module's
    own websocket listener for `board.updated`.
11. **Metis runs `opus` when the board's switch is off.** *Reversal:* one constant,
    `METIS_CLAUDE_MODEL`, in `metis-env.service.ts`.
12. **Default per-board concurrency is 1**, clamped `[0, 4]` like Descent's dial. *Reversal:*
    `DEFAULT_CONCURRENCY` in `metis-liveness.ts`; a per-board column is the next step up and is
    excluded below.
13. **Four lesson tools are honest stubs; `search_history` and `get_learned_selections` are real.**
    The board has `kanban_events` and `kanban_decisions`; it has no lesson corpus. The stubs say so
    and name what to do instead. *Reversal:* a `kanban_lessons` table and three real tools.
14. **The brief lives at `server/modules/kanban-metis/brief/` and is resolved through
    `findApplicationRoot`**, which already unwraps `dist-server` (`server/shared/utils.ts:1394-1400`),
    so it reads from the source tree under `tsx` and under `npm run server` alike, with no build
    change. *Reversal:* a copy step in `build:server`.

## Edge cases and their endings

- **`plan-runner start` exits 5 — the plan's INTENT LOCK is not CONFIRMED.** Metis files an issue
  on the card, moves it back to `todo`, and takes the next one. She never waits, and she never
  confirms her own lock. This ending is written into the brief as an ABSOLUTE RULE in Phase 5.
- **`DEEPSEEK_API_KEY` is absent while the board's switch is ON.** The spawn fails loudly: no child
  is started, the session is recorded `failed` with that reason in `result.json`, and the pilot
  panel shows it. It never silently falls back to Claude — a switch that lies about which vendor is
  billing is worse than a refusal.
- **Two servers are running against one `auth.db`** (the operator's on 3011 and a probe on 7893).
  Both drivers tick every non-archived autonomy board -- selection is never consulted -- and the
  concurrency dial is each process's own memory, so two Metises land on one board (measured
  2026-09-17, three probe boards). A shared state root then lets the second process ADOPT the
  first's sessions and a cleanup stop them. So a probe never shares either: it runs on a scratch
  copy of the database (`DATABASE_PATH`) and a scratch state root (`KANBAN_METIS_STATE_ROOT`),
  and discards both.
- **A board is archived while its Metis is running.** The driver stops spawning for it on the next
  tick; the live session is left to finish and is reaped by the ordinary quiescence rule.
- **The child's transcript never appears** (the CLI died before writing one). The transcript route
  answers the same empty `SubagentTranscriptResult` the soul route answers, and the panel draws its
  loading-then-empty state. It is not an error.
- **A recycled pid.** Re-adoption checks `process.kill(pid, 0)` AND that `/proc/<pid>/cmdline`
  still names the session id; a pid that passes the first and fails the second is dead.
- **The MCP child cannot reach the server** (the port moved). Every tool answers `isError` with the
  transport failure; `mcp-fallback.md` tells Metis to say so plainly and end the turn, because on
  this board there is no second door.
- **A card's build lease goes stale under a live Metis** (her MCP process died but the CLI lives).
  `claimableCount` counts that card again, and the stall leg of the reap rule takes the session at
  `STALL_MS`.

## Exclusions — named, not deferred into a step

- **Nothing is removed from Descent.** `~/.claude/descent/`, `pm.md`, `pm-chapters/`, the
  `descent-pm` MCP and `pm_capacity.py` all keep running. Sunset is a later plan.
- **No per-board concurrency column.** The dial is one constant for every board. Adding a column is
  Phase 1's shape repeated and is a follow-up.
- **No lesson corpus on this board.** Four tools are honest stubs; see Decision 13.
- **G3's footprint collision guard does not reach this board.** It triggers on
  `mcp__descent-pm__set_status`, so a board Metis is never footprint-checked against an in-flight
  build. Two Metis sessions on one board are prevented by the build lease, not by footprint. A
  kanban-aware G3 is a follow-up.
- **No board scoping on the `/api/kanban-pm` mount.** A session's secret reaches every board's
  READ and WRITE verbs, which is what `list_features_all` wants. A board-scoping middleware is a
  follow-up. The one verb that is not deferred is the importer: **`/import/` is denied at the
  door, 403, before the router** — it reads a foreign database and can rewrite four hundred cards
  in one transaction, which is not something a follow-up should be asked to remember.
- **No Eupalinos pass is scheduled by this plan.** The module boundary in Decision 1 is the shape
  question he judges; it is recorded here as a default with its reversal, and the run waits on no
  counsel.
- **No commit and no push.** The run ends with its work in the working tree.
- **`migrations.ts` is not split.** It is 608 LOC and this plan adds one function to it rather
  than reorganising it; a per-table split is a follow-up on its own checkpoint. (Eupalinos's flag,
  not this plan's work.)
- **The repository's existing test files are not deleted here.** `server/modules/settings/tests/`
  and `server/modules/providers/tests/` exist and the operator's standing no-tests rule forbids
  them; a deletion sweep is its own checkpoint, and folding it into this run would put unrelated
  deletions inside phases that have nothing to do with them. (Eupalinos's flag, not this plan's
  work.)

## Doctrine citations

- `~/.claude/CLAUDE.md` — no branches; no unit tests; healed means deleted; root cause before fix;
  a plan never involves the operator.
- `AGENTS.md` → `.agents/skills/backend-module-standards/SKILL.md` and
  `.agents/skills/frontend-module-standards/SKILL.md` — module layout, barrels, `@/` imports,
  `type` over `interface`, shared-vs-local placement. Their "Test within the module" clauses are
  overridden by Project Constraint 1.
- `src/shared/ui/verve/README.md` — colour reaches a screen through Tailwind names, never a literal
  or a bare `var()`; tone is a `data-tone` swap; no second palette.
- `charters/odysseus/PLAN_FORMAT_V2.md` §5 `kind` — a UI phase is cut into a scaffold and a fill.
- `charters/odysseus/DOCTRINE.md` §9 — git is never a phase, a gate or a boundary; §10 — the
  operator is never an actor in a plan.
- `docs/kanban.md` §"The one write seam" — every write goes through `writeKanban`; the MCP server
  reaches it by going through the routes.
- `~/.claude/hooks/README.md` §"Metis-session scoping" and §"How to add a guard" — fail-open
  siblings, the `_SIBLINGS` table, and why a Stop guard must not trap the operator.

## Scout findings behind this plan

Twelve scouts, two waves, `~/.claude/state/scout-waves/kanban-metis-1/` and `…-2/`. The findings
that decided something:

- `claude-session-synchronizer.provider.ts` **creates** a `projects` row and a `sessions` row for
  any transcript whose cwd it has never seen (`sessions.db.ts:113-115` → `projects.db.ts:19-38`).
  There is no opt-in registry to stay out of — which is why Decision 5 is a refusal to enrol.
- `souls.py:186-202` already sets `MAIN_SHELVES_LOADER_DISABLE=1`, so the shelves need no hook edit.
- CLI 2.1.269 carries `--session-id`, `--mcp-config`, `--strict-mcp-config`,
  `--append-system-prompt` and `--output-format stream-json`; none is missing.
- `browser-use-mcp.ts` is a hand-rolled stdio MCP server already living under `server/modules/`,
  reached through `cli.service.ts`'s command table, with `getMcpCommand()` at
  `browser-use.service.ts:161-188` solving dist-vs-source. That is Phase 4's whole shape.
- `deepseek.py:99-105`'s `flag_path()` reads `PLAN_RUNNER_DEEPSEEK_FLAG_PATH` **at call time**, and
  the child env is `{"ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
  "ANTHROPIC_AUTH_TOKEN": key}` (`:159`), roles `("builder", "fix-pass", "athena")`.
- `metis_session.py:253-260` creates the marker on exactly two triggers and a board-MCP call can
  only REFRESH one; a third create trigger is required and is Phase 6's.
- Five Metis guards trigger on a literal `mcp__descent-pm__*` tool name and therefore never fire
  for `mcp__kanban-pm__*`; only G4 and G4b, which are Stop guards keyed on the session marker, had
  to be taught to stand down.
- `pm_capacity.py:640-667` reaps before it spawns, deliberately; `:118,121` and
  `pm_capacity_stall.py` gave the four reap numbers; `mcp_server.py:205` gave the 10 s heartbeat
  and `:298` the 16-hex owner token.
- `dispatch-souls.module.ts:30,67-115` is the polled-lane-plus-frame pattern Phase 7 copies, and
  `SoulLaunchPinRow.tsx:94` is the provider paint.
- `pm.md` is 846 lines, ~93 % Descent-coupled, and its coupling is overwhelmingly tool names and
  paths — which is what makes Phase 5 a port rather than a rewrite.

## Open Questions

None. Every fork is decided above with its reversal.

## Ship Logs

### Phase 1 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: builder-blocked: step 11: `npm run typecheck` exit 0.]
- run: kanban-metis-autonomy-plan-20260916-154519-7332 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha 5e43e66b88de · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session ef7b44a6-c038-429d-bc11-5ea4c56c531d · 247s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-154519-7332/phase_1/

### Phase 1 Ship Log — ↻ REPLANNED 2026-09-16
- run: kanban-metis-autonomy-plan-20260916-154519-7332 · replan 1 of 3 · spec_sha 5e43e66b88de → ad7583b2f529 · replanner odysseus/claude-opus-5 · session 0b6d03ef-5986-4a73-8a30-53ffb8ef44f0 · 107s · cost $1.15
- cause: builder-blocked: step 11: `npm run typecheck` exit 0.
- changed: I rewrote Phase 1's plan and it's ready to run again. Nothing was wrong with the build: the builder's work passed every check except one, and that check could never pass. It expected the live `~/.cloudcli/auth.db` to be missing the new `deepseek_flash` column, but it ran after the build. By then `deploy/dev-supervisor` had already restarted the API and run the new migration against that database. - **The check:** I removed that impossible "before" check and added one that runs after the server-boot check. It reads the live table's column list and expects `COLUMN 1 type=INTEGER notnull=1 default=0`. The table existed before this phase, so the column can only be there if the migration added i
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-154519-7332/phase_1/

### Phase 1 Ship Log — ✅ SHIPPED 2026-09-16
- run: kanban-metis-autonomy-plan-20260916-154519-7332 · attempt 1 of 2 · cycle 2 · spawns 6/220 · fix-passes 1 of 2 · cost $1.67 (run $2.91) · resumed 0×
- builder: hephaestus/deepseek-flash · session 6d18d3e5-a27a-43b1-a531-9ae75e6c6a27 · 59s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 → fix-pass 1/deepseek-flash (29s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 11/11 steps OK · verify 2/2 OK
- forbidden: unchanged (4 declared, 4 present)
- docs: Prometheus returned · 2 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-154519-7332/phase_1/

### Phase 2 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: builder-blocked: DIVERGENCE: src/i18n does not exist in this repo (not in the tree, git ls-files or any alias); the locale bundles live under src/modules/i18n/locales and the English one is src/modules/i18n/locales/en/common.json, so step 2 and its check cannot be made true inside the manifest.]
- run: kanban-metis-autonomy-plan-20260916-154519-7332 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha 87ad76739f7c · retry: on-spec-change
- builder: iris/fable · session 7763930d-a87b-4efd-a9ab-58195173a214 · 1440s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-154519-7332/phase_2/

### Phase 2 Ship Log — ↻ REPLANNED 2026-09-16
- run: kanban-metis-autonomy-plan-20260916-154519-7332 · replan 2 of 3 · spec_sha 87ad76739f7c → ec2375044ae9 · replanner odysseus/claude-opus-5 · session 43def1fa-a744-431c-92e3-fb5acff41766 · 180s · cost $1.69
- cause: builder-blocked: DIVERGENCE: src/i18n does not exist in this repo (not in the tree, git ls-files or any alias); the locale bundles live under src/modules/i18n/locales and the English one is src/modules/i18n/locales/en/common.json, so step 2 and its check cannot be made true inside the manifest.
- changed: Flags for later phases (I didn't touch them; the rules for this run limit me to Phase 2): - **Phase 8** names `src/i18n` too, around lines 1702, 1734 and 1736, so it will block the same way. - **Phase 3's check script:** the builder found that `scripts/kanban-ui-probe.mjs` loses its freshly written login token on reload. It happened in 4 of 4 runs: a late 401 from the app's first request logs the session out. - **Type check:** `npm run typecheck` stays red until Phase 3 passes the two new props from `KanbanPanel`. The client build doesn't type-check, so it still passes. I rewrote Phase 2 because there is no `src/i18n` in this repo; the English strings live in `src/modules/i18n/locales/en/co
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-154519-7332/phase_2/

### Phase 2 Ship Log — ✅ SHIPPED 2026-09-16
- run: kanban-metis-autonomy-plan-20260916-154519-7332 · attempt 1 of 2 · cycle 4 · spawns 12/220 · fix-passes 1 of 2 · cost $10.79 (run $23.17) · resumed 0×
- builder: iris/fable · session 52ef8293-b708-4c92-be2a-9e58a326c30a · 386s · RESULT: DONE
- athena: pass 1/fable BLOCKING 0 · HIGH 0 · MED 0 · LOW 3 → fix-pass 1/fable (169s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 3/3 steps OK · verify 4/4 OK
- forbidden: unchanged (4 declared, 3 present)
- docs: Prometheus returned · 1 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 3 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-154519-7332/phase_2/

### Phase 3 Ship Log — ✅ SHIPPED 2026-09-16
- run: kanban-metis-autonomy-plan-20260916-154519-7332 · attempt 1 of 2 · cycle 5 · spawns 15/220 · fix-passes 0 of 2 · cost $0.96 (run $24.13) · resumed 0×
- builder: hephaestus/deepseek-flash · session c68e006c-b7ac-4a4a-9e4b-4bcc99003fe7 · 210s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 0 · LOW 0 — CLEARED
- checks: 4/4 steps OK · verify 1/1 OK
- forbidden: unchanged (2 declared, 2 present)
- docs: Prometheus returned · 1 files
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-154519-7332/phase_3/

### Phase 4 Ship Log — ✅ SHIPPED 2026-09-16
- run: kanban-metis-autonomy-plan-20260916-154519-7332 · attempt 1 of 2 · cycle 6 · spawns 19/220 · fix-passes 1 of 2 · cost $1.95 (run $26.08) · resumed 0×
- builder: hephaestus/deepseek-flash · session 807b0f5f-06c0-4fa7-9907-a110e1586508 · 807s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 3 · MED 3 · LOW 2 → fix-pass 1/deepseek-flash (915s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 12/12 steps OK · verify 4/4 OK
- forbidden: unchanged (3 declared, 3 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 3 · MED 3 · LOW 2 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-154519-7332/phase_4/

### Phase 5 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: builder-blocked: step 8: ported autonomy-cadence.md plus the "nothing claimable → say so and end the turn" line; the keep-flowing nudge section deleted (G4b stands down for a board session)]
- run: kanban-metis-autonomy-plan-20260916-154519-7332 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha 52576b63e275 · retry: on-spec-change
- builder: prometheus/deepseek-flash · session 859ddbf6-4898-4db1-a596-7f489b0fbc5b · 404s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-154519-7332/phase_5/

### Phase 5 Ship Log — ↻ REPLANNED 2026-09-16
- run: kanban-metis-autonomy-plan-20260916-154519-7332 · replan 3 of 3 · spec_sha 52576b63e275 → 79b63a80c510 · replanner odysseus/claude-opus-5 · session e17137df-719e-4e7f-a1eb-dc652e51c861 · 135s · cost $1.52
- cause: builder-blocked: step 8: ported autonomy-cadence.md plus the "nothing claimable → say so and end the turn" line; the keep-flowing nudge section deleted (G4b stands down for a board session)
- changed: Phase 5's second verify expected `pm.md` to be 846 lines, but another session edited it to 847. The builder copied the file without changing it, so the plan's expected value was out of date. I replaced that check with one that reads the source's own markers: its YAML header is still there, it still says `descent-pm` and never `kanban-pm`, and there are still six chapters. Run against the real files, it prints exactly the new expected line. Step 2 no longer copies over chapters an earlier attempt already ported. Steps 1, 4 and 8, Sirens and two new athena items now cover what the builder had to decide alone. I left `pm.md` out of the manifest: it is only read, and Constraint 5 makes it read-o
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-154519-7332/phase_5/

### Phase 5 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: forbidden-changed: docs]
- run: kanban-metis-autonomy-plan-20260916-154519-7332 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha 79b63a80c510 · retry: on-spec-change
- builder: prometheus/deepseek-flash · session ea296cc4-5fa8-4b47-8d97-b6baa0092d1d · 229s · RESULT: DONE
- forbidden: CHANGED: docs
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-154519-7332/phase_5/

### Phase 6 Ship Log — ✅ SHIPPED 2026-09-16
- run: kanban-metis-autonomy-plan-20260916-154519-7332 · attempt 1 of 2 · cycle 9 · spawns 26/220 · fix-passes 1 of 2 · cost $1.86 (run $29.73) · resumed 0×
- builder: hephaestus/deepseek-flash · session f0cede92-952f-475b-8213-e48045d52c84 · 333s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 2 · LOW 4 → fix-pass 1/deepseek-flash (180s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 5/5 steps OK · verify 2/2 OK
- forbidden: unchanged (3 declared, 3 present)
- docs: Prometheus returned · 2 files
- residue: BLOCKING 0 · HIGH 0 · MED 2 · LOW 4 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-154519-7332/phase_6/

### Phase 7 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 5]
- run: kanban-metis-autonomy-plan-20260916-154519-7332 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha 16df7bcae916 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-154519-7332/phase_7/

### Phase 8 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 7]
- run: kanban-metis-autonomy-plan-20260916-154519-7332 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha 62a2bbcd9604 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-154519-7332/phase_8/

### Phase 9 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 8]
- run: kanban-metis-autonomy-plan-20260916-154519-7332 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha bb780b0fbcc5 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-154519-7332/phase_9/

### Phase 10 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 7]
- run: kanban-metis-autonomy-plan-20260916-154519-7332 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha 5df2025ab7d4 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-154519-7332/phase_10/

### Phase 11 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 9, Phase 10]
- run: kanban-metis-autonomy-plan-20260916-154519-7332 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha 18ef5a9efa64 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-154519-7332/phase_11/

### Run kanban-metis-autonomy-plan-20260916-154519-7332 — COMPLETE 2026-09-16
- shipped: 1, 2, 3, 4, 6
- blocked: 5: forbidden-changed, 7: depends, 8: depends, 9: depends, 10: depends, 11: depends, 5: skipped, spec unchanged
- next: re-author the phase spec each ⛔ entry names, then plan-runner start /home/lyphe/.claude/claudecodeui_lyphe/docs/plans/kanban-metis-autonomy.plan.md — until a phase's `spec_sha` moves it is skipped, so a run started before the edit repeats this one exactly
- brief: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-154519-7332/resume_brief.md

### Phase 5 Ship Log — ✅ SHIPPED 2026-09-16
- run: kanban-metis-autonomy-plan-20260916-194621-d311 · attempt 1 of 2 · cycle 1 · spawns 1/220 · fix-passes 0 of 2 · cost $0.07 (run $0.07) · resumed 0×
- builder: prometheus/deepseek-flash · session 35842f37-e6a1-460f-a5f5-a637ef8e9519 · 141s · RESULT: DONE
- athena: n/a — code_change = false
- checks: 8/8 steps OK · verify 2/2 OK
- forbidden: unchanged (3 declared, 3 present)
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-194621-d311/phase_5/

### Phase 7 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: builder-blocked: DIVERGENCE: VERIFY 1 cannot pass as written — running the plan's block from lines 1612-1655 verbatim gave EXITCODE=1 and aborted at line 1653 with FileNotFoundError: [Errno 2] No such file or directory: '/home/lyphe/.claude/state/kanban-metis/7d0f660e-4efd-4d7e-a243-af550279aa91/spec.json', because]
- run: kanban-metis-autonomy-plan-20260916-194621-d311 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha 16df7bcae916 · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session 8c271873-a3fd-4a52-806f-2dcab1cf7c05 · 1457s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-194621-d311/phase_7/

### Phase 7 Ship Log — ↻ REPLANNED 2026-09-16
- run: kanban-metis-autonomy-plan-20260916-194621-d311 · replan 1 of 3 · spec_sha 16df7bcae916 → cfad8fee8d8d · replanner odysseus/claude-opus-5 · session bdca59da-fb39-4369-8daf-6d603279f990 · 434s · cost $3.29
- cause: builder-blocked: DIVERGENCE: VERIFY 1 cannot pass as written — running the plan's block from lines 1612-1655 verbatim gave EXITCODE=1 and aborted at line 1653 with FileNotFoundError: [Errno 2] No such file or directory: '/home/lyphe/.claude/state/kanban-metis/7d0f660e-4efd-4d7e-a243-af550279aa91/spec.json', because
- changed: I rewrote only Phase 7. VERIFY 1 failed because it deleted the session folder and killed the server before reading them. Reads now come first, teardown runs on every exit (a failed read included), and I ran the new block twice against the real system. Everything matched except `MCP=ERR`, which proves the builder's flag: `mcp/kanban-pm-client.ts` still calls `/api/kanban`, so the child's calls 401. The same credential gets 200 on `/api/kanban-pm`. So `mcp` moved from forbidden to manifest, with a one-constant step and a check that hashes the nine files beside it. I added athena items and a Sirens passage. I skipped the two named paths because they are runtime files, not builder ground. Lint,
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-194621-d311/phase_7/

### Phase 7 Ship Log — ✅ SHIPPED 2026-09-16
- run: kanban-metis-autonomy-plan-20260916-194621-d311 · attempt 1 of 2 · cycle 3 · spawns 7/220 · fix-passes 1 of 2 · cost $4.88 (run $8.65) · resumed 0×
- builder: hephaestus/deepseek-flash · session d9b56144-9971-486b-a525-6547ed1da767 · 133s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 2 · MED 1 · LOW 4 → fix-pass 1/deepseek-flash (310s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 11/11 steps OK · verify 5/5 OK
- forbidden: unchanged (5 declared, 5 present)
- docs: Prometheus returned · 6 files
- residue: BLOCKING 0 · HIGH 2 · MED 1 · LOW 4 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-194621-d311/phase_7/

### Phase 8 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: builder-blocked: DIVERGENCE: step 3 path src/i18n does not exist in this repo (not in the tree, git ls-files, tsconfig paths or vite alias); the English locale bundle is src/modules/i18n/locales/en/common.json, outside this phase's manifest, so step 3 and its check `grep -rc 'kanban.metis\|"metis"' src/i18n | grep -]
- run: kanban-metis-autonomy-plan-20260916-194621-d311 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha 62a2bbcd9604 · retry: on-spec-change
- builder: iris/fable · session 4186731d-7605-429f-a4f3-5d614f8703a3 · 1587s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-194621-d311/phase_8/

### Phase 8 Ship Log — ↻ REPLANNED 2026-09-16
- run: kanban-metis-autonomy-plan-20260916-194621-d311 · replan 2 of 3 · spec_sha 62a2bbcd9604 → d5b0cb026ba8 · replanner odysseus/claude-opus-5 · session 1bec4e42-9528-4e65-b8be-705cbab6944d · 139s · cost $1.48
- cause: builder-blocked: DIVERGENCE: step 3 path src/i18n does not exist in this repo (not in the tree, git ls-files, tsconfig paths or vite alias); the English locale bundle is src/modules/i18n/locales/en/common.json, outside this phase's manifest, so step 3 and its check `grep -rc 'kanban.metis\|"metis"' src/i18n | grep -
- changed: Phase 8 is rewritten and should now pass the runner. Its locale step pointed at a folder, `src/i18n`, that doesn't exist; it now points at the real English file, `src/modules/i18n/locales/en/common.json`. **What changed in Phase 8:** - **Files it may touch:** `src/modules/i18n/locales/en/common.json` is added. `src/i18n` moves to the forbidden list, the same fix Phase 2 got. - **Step 3:** now gives the exact 17-key `kanban.metis` object from the builder's notes, where it goes (after `board`, not inside it, before `lanes`), and the plural pair for `runningCount`. - **Step 3's check:** it collects every `kanban.metis.*` key the row and panel files use and lists any the English file lacks. On
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-194621-d311/phase_8/

### Phase 8 Ship Log — ✅ SHIPPED 2026-09-16
- run: kanban-metis-autonomy-plan-20260916-194621-d311 · attempt 1 of 2 · cycle 5 · spawns 13/220 · fix-passes 1 of 2 · cost $7.04 (run $26.35) · resumed 0×
- builder: iris/fable · session 4b4a4174-6c59-4448-ace5-9f28a8d6edfc · 324s · RESULT: DONE
- athena: pass 1/fable BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 → fix-pass 1/fable (80s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 4/4 steps OK · verify 5/5 OK
- forbidden: unchanged (4 declared, 3 present) · ⚠ NOT WATCHED: src/shared/api.ts (every file owned by another live run) · narrowed by 1 file(s) another live run owns
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 0 · MED 0 · LOW 1 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-194621-d311/phase_8/

### Phase 9 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: builder-blocked: DIVERGENCE: the phase cannot finish inside its FILE MANIFEST; two paths outside it are needed, neither on MUST-NOT: src/modules/chat/hooks/useSubagentTranscript.ts (the third kind's route selection) and src/modules/chat/index.ts (must export the transcript view the panel's last FILL marker owes).]
- run: kanban-metis-autonomy-plan-20260916-194621-d311 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha bb780b0fbcc5 · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session 33fef46d-70d1-4ada-b2c3-83f2c19e3a2f · 711s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-194621-d311/phase_9/

### Phase 9 Ship Log — ↻ REPLANNED 2026-09-16
- run: kanban-metis-autonomy-plan-20260916-194621-d311 · replan 3 of 3 · spec_sha bb780b0fbcc5 → 995cf7517ade · replanner odysseus/claude-opus-5 · session 04382def-c76b-4682-a195-4b50a62ae5e7 · 222s · cost $1.78
- cause: builder-blocked: DIVERGENCE: the phase cannot finish inside its FILE MANIFEST; two paths outside it are needed, neither on MUST-NOT: src/modules/chat/hooks/useSubagentTranscript.ts (the third kind's route selection) and src/modules/chat/index.ts (must export the transcript view the panel's last FILL marker owes).
- changed: I rewrote Phase 9 and it's ready to re-run. All four required checks pass: the lint exits 0, the gate prints `RUNNER`, the walk renders, and the lock still reads `lock:7b57dc2b8e`. Only lines inside the Phase 9 section changed. **What went wrong:** the builder was right to stop. Two files it needed weren't on its list, and without them the panel's last `FILL:` marker could not be filled: - **`useSubagentTranscript.ts`:** its read at lines 78-80 is a two-way choice, so a `metis` transcript would be sent to the chat subagent route instead of its own. - **`src/modules/chat/index.ts`:** the chat module's public exports don't include `SubagentTranscriptView`, so the kanban panel had no allowed w
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-194621-d311/phase_9/

### Phase 9 Ship Log — ✅ SHIPPED 2026-09-16
- run: kanban-metis-autonomy-plan-20260916-194621-d311 · attempt 1 of 2 · cycle 7 · spawns 19/220 · fix-passes 1 of 2 · cost $1.87 (run $30.23) · resumed 0×
- builder: hephaestus/deepseek-flash · session b6206ebd-fb96-421d-809d-d8a0df03f237 · 162s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 0 · MED 3 · LOW 2 → fix-pass 1/deepseek-flash (548s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 10/10 steps OK · verify 4/4 OK
- forbidden: unchanged (3 declared, 3 present)
- docs: Prometheus returned · 2 files
- residue: BLOCKING 0 · HIGH 0 · MED 3 · LOW 2 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-194621-d311/phase_9/

### Phase 10 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: builder-blocked: verify 2: REAP_BEFORE_SPAWN=True OK]
- run: kanban-metis-autonomy-plan-20260916-194621-d311 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha 5df2025ab7d4 · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session df455044-dcf0-4152-ad42-464c0365dd0e · 686s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-194621-d311/phase_10/

### Phase 11 Ship Log — ⛔ BLOCKED 2026-09-16
- [BLOCKED: depends: not SHIPPED: Phase 10]
- run: kanban-metis-autonomy-plan-20260916-194621-d311 · attempt 0 of 2 (never dispatched) · fix-passes 0 of 2 · spec_sha 18ef5a9efa64 · retry: allowed
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-194621-d311/phase_11/

### Run kanban-metis-autonomy-plan-20260916-194621-d311 — COMPLETE 2026-09-16
- shipped: 5, 7, 8, 9
- blocked: 10: builder-blocked, 11: depends, 10: skipped, spec unchanged
- next: re-author the phase spec each ⛔ entry names, then plan-runner start /home/lyphe/.claude/claudecodeui_lyphe/docs/plans/kanban-metis-autonomy.plan.md — until a phase's `spec_sha` moves it is skipped, so a run started before the edit repeats this one exactly
- brief: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260916-194621-d311/resume_brief.md

### Phase 10 Ship Log — ⛔ BLOCKED 2026-09-17
- [BLOCKED: builder-blocked: tsx 4.21.0 drops the `-e` eval pair when `--tsconfig` is spelled with a space, so step 1's check runs node scriptless (rc=0, empty stdout, stdin=/dev/null); with `--tsconfig=server/tsconfig.json` it prints `300000 180000 2700000 40 undefined`. Cure: that `=` form — no file write reaches it.]
- run: kanban-metis-autonomy-plan-20260917-070839-7999 · attempt 1 of 2 · fix-passes 0 of 2 · spec_sha c13d01a46540 · retry: on-spec-change
- builder: hephaestus/deepseek-flash · session 8c96d8b9-6c47-4108-9281-2fc0ae195b9e · 342s · RESULT: BLOCKED
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260917-070839-7999/phase_10/

### Phase 10 Ship Log — ↻ REPLANNED 2026-09-17
- run: kanban-metis-autonomy-plan-20260917-070839-7999 · replan 1 of 6 · spec_sha c13d01a46540 → 77c9bc832847 · replanner odysseus/claude-opus-5 · session f75db96e-d305-44aa-a376-37110114ad42 · 132s · cost $1.36
- cause: builder-blocked: tsx 4.21.0 drops the `-e` eval pair when `--tsconfig` is spelled with a space, so step 1's check runs node scriptless (rc=0, empty stdout, stdin=/dev/null); with `--tsconfig=server/tsconfig.json` it prints `300000 180000 2700000 40 undefined`. Cure: that `=` form — no file write reaches it.
- changed: I fixed Phase 10's step 1 check, which was broken. All four proofs pass: `lint` exits 0, `gate` prints `RUNNER`, `walk` renders, and the lock still reads `lock:7b57dc2b8e`. I ran the corrected check and it prints `300000 180000 2700000 40 undefined`. I also added cleanup to the first verify and haven't run it, since a full run spawns a real Metis. A dry run of the cleanup matched the right leftovers and deleted nothing. It passes `bash -n`. I changed only Phase 10: the check now spells the flag `--tsconfig=server/tsconfig.json`, since tsx 4.21.0 ignores `-e` when the value follows a space. Step 1's `what` explains why. The verify's cleanup now clears everything the probe leaves: the operato
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260917-070839-7999/phase_10/

### Phase 10 Ship Log — ✅ SHIPPED 2026-09-17
- run: kanban-metis-autonomy-plan-20260917-070839-7999 · attempt 1 of 2 · cycle 3 · spawns 7/220 · fix-passes 1 of 2 · cost $1.03 (run $2.49) · resumed 1×
- builder: hephaestus/deepseek-flash · session 6bc119ac-c484-402d-b795-e90121c2b336 · 197s · RESULT: DONE
- athena: pass 1/deepseek-flash BLOCKING 0 · HIGH 1 · MED 0 · LOW 2 → fix-pass 1/deepseek-flash (281s) — fixed, not re-reviewed (max_review_passes 1)
- checks: 6/6 steps OK · verify 2/2 OK
- forbidden: unchanged (5 declared, 5 present)
- docs: Prometheus returned · 0 files
- residue: BLOCKING 0 · HIGH 1 · MED 0 · LOW 2 handed to fix-pass 1, not re-reviewed
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260917-070839-7999/phase_10/

### Phase 11 Ship Log — ✅ SHIPPED 2026-09-17
- run: kanban-metis-autonomy-plan-20260917-070839-7999 · attempt 1 of 2 · cycle 4 · spawns 8/220 · fix-passes 0 of 2 · cost $0.13 (run $2.62) · resumed 1×
- builder: prometheus/deepseek-flash · session ef539eae-34b2-4f68-a144-df09bc901178 · 247s · RESULT: DONE
- athena: n/a — code_change = false
- checks: 3/3 steps OK · verify 2/2 OK
- forbidden: unchanged (3 declared, 3 present)
- evidence: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260917-070839-7999/phase_11/

### Run kanban-metis-autonomy-plan-20260917-070839-7999 — COMPLETE 2026-09-17
- shipped: 10, 11
- blocked: none
- next: run complete — the checkpoint is Scott's /git, on his clock
- brief: /home/lyphe/.claude/state/runner/kanban-metis-autonomy-plan-20260917-070839-7999/resume_brief.md
