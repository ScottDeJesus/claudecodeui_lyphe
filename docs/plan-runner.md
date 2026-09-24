# The plan-runner lane

Six routes under `/api/plan-runner`, behind `authenticateToken` in `server/index.ts`, wired in
`plan-runner.module.ts`, plus two websocket frames pushed to every open `/ws` socket whenever the
picture changes — `kind: 'runner_state'` for the runs, `kind: 'arc_state'` for the arc deck
(§"The arc deck"), both through one door — and one notification each time a run ends (§"Pushes on an
ending").

The plan runner is a separate program. It writes `~/.claude/state/runner/<run_id>/` and it may be
executing right now; this lane only ever READS those files and shells out to the runner's own three
verbs — `stop`, `resume`, and the arc deck's `arc reorder`. Nothing here writes a state file, takes a
lock, signals a process or starts a run — a second writer would race the runner's own atomic rewrite,
and starting a run needs a plan and an intent lock, which is `/execute`'s act and not a button's.

**Two files under `~/.claude/state/` ARE written from this server, and neither is this lane's or a
run's** (§"The DeepSeek switch" and §"The swarm switch" below).

## What the runner writes, and where

The root is `$PLAN_RUNNER_STATE_DIR` when set, else `~/.claude/state/runner` — the name the runner's own
`hooks/plan_runner/state_lock.py` resolves at import, and with it `scripts/runner_watchdog.py`,
`scripts/runner_statusline.py:205` and the quiet checkpoint's `scripts/quiet_checkpoint_runs.py`. Pointing one at a hermetic tree
therefore moves the runner's run directories AND the lock store under them, the terminal bar, the watchdog's ticks and this lane
together. `locks/` is that store under whatever root is in play and is skipped when listing runs; anything that
is not a directory is skipped. Four files per run are this lane's:

| File | What it is |
|---|---|
| `progress.json` | The whole picture: position, phases, spend, and the composed ◆ line. REPLACED whole through `atomic_write` (`hooks/plan_runner/state_lock.py:77`, a per-write `mkstemp` scratch plus `os.replace`), called at `progress.py:270`, so a read caught mid-write is a decode error on the old bytes or a clean read of the new ones — never half a record. |
| `run.json` | The run's own state. This lane reads six fields: `start_at` — the operator's SCHEDULED Start on a queued run (`plan-runner schedule`, epoch seconds, `null`/absent when none), carried raw as the snapshot's `start_at`; `model` — the run's own model word (`deepseek`, the runner's default, written at birth; `claude`; or `auto` = follow the chat's switch; a record born before the default has none and the runner reads it as `deepseek` — `hooks/plan_runner/run_model.py`), carried as the snapshot's `model` through `readRunnerModelChoice`, `null` for a record with no word; `stopped_at`; `status` and `queued_until` — the runner's own words for a run CREATED PARKED (`start --queue`, or a fresh launch inside DeepSeek's peak hours for a run bound for DeepSeek — its word `deepseek`, the default, or `auto` with the chat's switch on) rather than stopped mid-walk, which is what separates the `queued` state from `paused` below, `queued_until` riding the snapshot raw as the epoch it waits for, or `null` when nothing named one; and `launched_by_session` — the Claude transcript uuid whose turn launched the run, which `plan-runner.module.ts` resolves to the app session id (`sessionsDb.resolveAppSessionId`) before any snapshot leaves the server; the chat gutter's Runner widget pins on it. |
| `receipt.json` | Its PRESENCE is the whole signal: the run is over. A resume renames it, so a continued run returns. |
| `runner.log` | One appended line per lane event — the CHANGED phase's own line, in the ◆ shape with a local ISO timestamp in front — and only when that line moves. |

A fifth file lives OUTSIDE the run directory and belongs to the PLAN, not the run: `~/.claude/state/plan_costs/<slug>.json`, the hooks tree's plan-cost ledger (`hooks/plan_runner/costs.py`; `plan-runner cost <plan>` prints it). It books what no receipt ever carried — the planner (Odysseus), the reviewer (Eupalinos) and every scout wave — and `readPlanLedger` folds those three kinds into the snapshot as `plan_planning_usd`, `plan_review_usd`, `plan_scouts_usd`; `plan_total_usd` is their sum plus the build spend the receipts already tallied over every run of the plan; `plan_tokens` is the same fold in tokens (the ledger's `tokens` per entry plus `run.json`'s `tokens` over every run), printed on the card as `⛁ 94.9M tok`. The card leads with that total the moment anything outside the run was spent (operator, 2026-09-12: "I'd like to see totals"). Absent ledger, unreadable ledger, a `build` row in it: all read as zero here, never as an error.

A run directory holds more than those four, and the rest are ignored on purpose rather than missed.
`progress.txt` is the same ◆ line plus one row per phase, rendered for a human reading it in a
terminal (`progress.py:152`) — this lane already holds those facts structured, so parsing the prose
back would be a second and worse decoder of the file sitting beside it. `runner.out` is the daemon's
raw stderr (`hooks/plan_runner/cmd/daemon.py:47,196`) and `phase_<n>/` holds each soul's transcript:
both are unbounded, unstructured, and carry whatever a soul happened to print, which is not
something to fan out to every open tab on a two-second poll. If a run's souls ever need reading,
that is a lane of its own with its own paging — not a field on this snapshot.

Every read is best-effort. A missing file, an unreadable one, a directory that vanished between the
listing and the read: all of them are "absent for this tick", never a thrown error — the poll runs
every two seconds and one bad directory must never cost the others their reading. An unchanged file
is not decoded again: `runner-state.transport.ts` gates each read on the file's `mtime`, `size` and
inode, the last because `os.replace` always lands a new one and so catches a rewrite that kept the
same size inside the same millisecond.

**It is a poll, not `fs.watch`, and that is deliberate.** Three of the four things this lane must
notice emit no usable watch event: a whole-file replacement arrives as a rename on a path that keeps
being recreated; a new run directory can appear at any moment under a root that would need its own
recursive watch; and a run going stale is a *lapsed* heartbeat — the absence of a write, which no
filesystem event can ever report.

**The poll itself is no longer this lane's own.** `server/shared/polled-lane.service.ts`
(`createPolledLane`) is the read-picture / compare / broadcast-on-change loop every state lane on
this server runs, and `runner-watcher.service.ts` is now a thin adapter over it that supplies this
lane's `snapshot` and its `runner_state` frame and nothing else. The reasoning above, the
broadcast-after-send dedup order, and why a failing tick never takes the interval down with it live
there, in one copy. The siblings are the launcher-souls lane
([docs/MANUAL.md (dispatch-souls)](MANUAL.md)), which reads `~/.claude/state/dispatch-souls/` on the same
cadence, a board's own Metis sessions (`kanban-metis/kanban-metis.module.ts`, the
`kanban_metis_state` frame), and this module's own arc deck lane (`arc-lane.ts`, the `arc_state`
frame, reading `~/.claude/state/arcs/`) — a different root and a different frame each time, the same loop.

## The plan-archive sweep

The plans corpus grows unbounded — every `/plan` session and every runner plan lands in it, and nothing
prunes it — so this module moves the FINISHED ones into the corpus's `archive/` subdirectory
(`plan-archive.service.ts`). It is armed where the module is constructed, it speaks to no socket, and it
does no work a request pays for.

**The selection rule is four clauses, and all four must hold AFFIRMATIVELY.** Anything else STAYS PUT,
because every doubt here costs a kept file and a wrong answer costs a plan:

1. **COLD** — the file's mtime is older than 48 h (`COLD_HOURS`), which protects the plan being written
   now.
2. **ZERO UNSHIPPED PHASES** — per the runner's own classifier, which protects a paused build.
3. **NO LIVE LEASE** — no card's plan or build lease holds that path (below).
4. **POSITIVE DONE-EVIDENCE** — the file carries a ship-log date stamp (`SHIPPED_DATE_RE`). Cold and
   unshipped are absences; this is the one PRESENCE the sweep requires, and without it a notes file that
   happens to be `.md` and happens to be old would be swept away from a person still reading it.

**Clause 2 is not implemented in this file.** The count comes from `~/.claude/hooks/auto_execute_plan.py`'s
`_count_unshipped_phases` — the exact reader `/execute` trusts — run as a CHILD PROCESS against the plan's
text, with the hooks directory passed as argv and the plan arriving on stdin, so a plan containing
quotes, backticks or a `#!` line is data and never code. That reader changes whenever the plan format
changes, and a TypeScript copy of it would answer differently from the thing that walks the file. A child
that cannot be reached at all moves NOTHING: an unanswerable clause 2 keeps every plan, which is the
port's own fail-safe.

**Clause 3 arrives as a PARAMETER, and the sweep never learns where it came from.** Age alone does not
cover this clause — a build can hold a fresh lease on a plan nobody has touched for a week — and the paths
the board's leases hold are handed IN (`heldPlanPaths`, read afresh on every pass) rather than read by this
module: the board answers what its own leases hold, and no other module reads those rows sideways to find
out. A lease is fresh by the same window a claim is granted by (`KANBAN_LEASE_STALE_SECONDS`, compared the
way `kanban-leases.db.ts` compares it for a claim), so a card whose builder died holds no plan forever and
one whose builder is working does; a stamp that will not parse is not fresh. The paths arrive as the
card's `plan` column spells them, `~` and all, because the caller is what joins them to the corpus's own
paths. `server/index.ts` is the single place the two modules meet — the sweep opens no database, reads no
table and imports nothing from the board.

**The cadence is settle-then-daily.** The first pass runs 120 s after construction and arms a 24 h interval
from there: the settle is what actually fires on a server that restarts far more often than once a day (a
daily timer measured from boot would be reset by the next restart before it ever fired), and the interval
is the backstop under one that lives long. Both timers are `unref`'d so neither keeps the process alive,
`stop()` clears both, and a pass that threw is logged once and swallowed — a sweep that ended its own
interval would silently stop archiving for the life of the process.

**The only write is the MOVE, and it is reversible — never a delete.** `archive/<name>` that already exists
is HELD rather than clobbered, so a second copy of a plan is never lost to a name collision, and a dry run
(`apply: false`) writes nothing at all, not even the destination directory.

## The plan-cost read

`plan-cost.service.ts` answers what a whole PLAN cost — the reading behind the card drawer's cost line,
handed to the board as `kanbanReadings.planCost` and served by `GET /api/kanban/cards/:cardId/plan-cost`
([docs/MANUAL.md (kanban)](MANUAL.md) §"The routes"). It is a READ of books that already exist, and it keeps no books of
its own: a second ledger would be a second answer to "what did this cost", and two answers drift.

**Every row it sums is ALREADY PRICED.** A `claude -p` child reports its own bill, and a ledger row was
priced from its transcript when its outing stopped — so nothing here prices a token and nothing here writes
a ledger. Three sources make one number:

- `planning` · `review` · `scouts` — the plan's own ledger's sums
  (`~/.claude/state/plan_costs/<slug>.json`, `readPlanLedger`), the live truth while the file is there,
  read on every call.
- `build` — every matching run's own `cost_usd`, summed: a receipted run from its `receipt.json`, a live run
  (no receipt yet) from its `progress.json`.
- the NEWEST matching receipt's own `plan_cost` — the runner's precomputed whole-plan reading, taken at
  close by the same code, and the only copy that survives the ledger's pruning. It is read as a FLOOR under
  all four kinds: a run directory that has left the state root, a pruned ledger, a run scanned while its own
  file is mid-rewrite — each of those would silently shrink a sum, and the receipt still holds what was
  spent. Spend only grows, so of two readings of one quantity the larger is the later, and a floor can never
  double-count: it either agrees with the sum or replaces a reading that has lost ground.

**A plan is its PATH, and matching a run to a plan is the one place a bare string comparison is WRONG.** A
card stores `~/.claude/plans/foo.md`; a receipt stores whatever absolute path the runner was launched with,
and `~` expanded after a `realpath` resolves under the CALLER's cwd — a different answer per process. So the
home is expanded FIRST and resolved second, and both sides of the comparison go through that one door
(`_plan_key`).

**The result is cached per plan for 20 seconds** (`COST_TTL_MS`, the same TTL the hooks tree's
`plan_costs.py` uses): opening a drawer must not walk two hundred run directories on every click, and a
reading twenty seconds stale on a surface that reports dollars is not a lie. The reading never throws — a
plan with nothing behind it answers `null`, which is what the route hands the drawer, so a card whose plan
was never run reads "no cost yet" rather than `$0.00`.

## The DeepSeek switch — the first of three state files this server writes

`~/.claude/state/deepseek_flash.flag` is written by `server/modules/settings/deepseek-flash-switch.ts`,
reached through `GET`/`PUT /api/settings/deepseek-flash` (`{"enabled": boolean}`; anything else is
400, unauthenticated is 401 — the whole `/api/settings` mount is behind `authenticateToken`). Both
verbs answer with what was READ BACK off the file, never with the input: the file belongs to another
daemon, and the position the UI draws should be the one on disk.

**The reader and writer behind this switch are now generalised, and this file is no longer the
only one either is asked to touch.** `readFlagFile`/`writeFlagFile` in the same source file take a
path and answer the question above for ANY flag file; `readDeepseekFlashSwitch`/
`writeDeepseekFlashSwitch` are the two calls above them, fixed to this switch's own path. The
generalisation exists for a per-board flag a Kanban board carries as its own DeepSeek switch,
reached through the same barrel from `server/modules/settings/index.ts` ([docs/MANUAL.md (kanban)](MANUAL.md)
§"The panel") — a board writes its OWN file rather than this one, because two boards on one host
must run different models and a switch that is one file the whole box shares cannot say that.
`server/modules/kanban-metis/metis-env.service.ts`'s `writeBoardFlag` is that second caller: it
calls the generalised writer with a board's own path, `~/.claude/state/kanban-deepseek/<boardId>.flag`,
at every Metis spawn — and the precedence a plan-runner started from there then reads by is stated
in §"The DeepSeek switch" below.

Two client surfaces draw it, and neither holds a fetch of its own: **Settings → Agents → Claude** —
`RunnerModelContent.tsx`, a `SettingsRow` + `SettingsToggle` — and the chat composer's own footer,
immediately after the Plain chip — `ComposerDeepSeekSwitch.tsx`, a `Chip` wearing the DeepSeek whale
while on and Claude Code's pixel mascot (`ClaudeCodeMark`) while off, icon-only below `sm` and
mark-plus-word ("Flash" / "Claude") from `sm` up, standing down entirely on a row too narrow
to hold it beside the model pill at its widest label (the composer's own layout, measured rather
than guessed). Both compose `src/shared/hooks/useDeepSeekFlashSwitch.ts`, the one client reader and
writer of the switch: a MODULE-level coordinator rather than a store, because the file on disk is
the only truth and this carries nothing but the last answer from it. One epoch counts every
authoritative position established — a write issued, an answer published — so a read still crossing
the wire when a flip lands elsewhere is retired rather than drawn: a measured defect before this
existed, where the composer's own re-read landed after a flip made in Settings and put the chip back
on for seven straight samples while the file read `off`. At most one read is ever in flight for the
whole tab; a second ask arriving while one is out is folded into the run already under way rather
than firing a request of its own. A write is optimistic, then corrected by whatever the server read
back off the file — never inverted on failure, since the switch is host-wide and a failed write can
perfectly well have landed on a file another operator had already set to the same side. `enabled:
null` means no read has yet succeeded; `unreadable` marks a read that came back with nothing,
distinct from an on-disk OFF, so neither surface paints "unknown" as "off" — the Settings row says so
in words with a Retry button, the composer chip draws a dashed ring with `aria-pressed="mixed"`. A
window `focus` re-read covers the one gap the epoch cannot: a second tab, left open since before a
flip made elsewhere. It belongs to the settings module and the chat module, not to this lane: no
run's file is ever written, and this lane still reads and shells out and nothing more.

**Host-wide, not per-user — with exactly one exception, and it is a board's own file.** The routes
read no `userId`, because the switch steers one plan-runner daemon and there is only one of it. It
is a file rather than a row in `auth.db` for the same reason the lane shells out instead of
importing: the runner is a separate program that must be able to read the switch from cron, with no
database and no HTTP. The exception is a matter of PRECEDENCE, not a second route: a plan-runner
STARTED BY A BOARD'S METIS reads that board's own flag file,
`~/.claude/state/kanban-deepseek/<boardId>.flag`, because the board hands its child the variable
`PLAN_RUNNER_DEEPSEEK_FLAG_PATH`, and `flag_path()` in `~/.claude/hooks/plan_runner/deepseek.py`
reads that variable **at call time** — so every plan-runner that child starts, and every re-read
inside one of its runs, asks the board's file; this host-wide one is consulted only when the
variable is unset. The board side of that rule — what writes the per-board file, and what a board's
switch means for the sessions it launches — is stated once, in
[docs/MANUAL.md (kanban)](MANUAL.md) §"The two switches".

**The write is a rename, and each of its three parts answers a measured failure.** A plain
`writeFile` is a truncate followed by a write, and the runner reads this file from another process —
a reader landing between the two sees an empty file and reads OFF, a phantom flip in the log of a run
nobody touched. So: write a scratch, then `rename` (atomic within one directory). The scratch name
carries a UUID and not just the pid, because `writeFile` yields and two concurrent PUTs in ONE node
process interleaved on a single per-process scratch path — measured, 4 of 20 concurrent PUTs returned
500 ENOENT; the rename was atomic with respect to its destination, and it was the SOURCE that had to
be unique. The destination is resolved through `realpath` first, because `rename` onto a symlink
replaces the link with a regular file and a flag the operator had symlinked elsewhere would silently
stop being shared after the first toggle. The `finally` unlinks the scratch, which only still exists
when the rename failed.

**Both readers must answer the same question.** `readDeepseekFlashSwitch` is the runner's own
predicate — present, at most 256 bytes (`state._FLAG_MAX_BYTES`; a longer file is OFF rather than
read as a prefix), trimmed content exactly `on`. `String.trim()` and Python's `str.strip()` are
different sets and were measured diverging in BOTH directions: `trim()` drops the UTF-8 BOM that
`strip()` keeps — the reachable half, since a flag saved by a Windows editor or PowerShell `Out-File`
carries one, and this reader then said ON while the runner went on spending Claude — and `strip()`
drops the C0 separators `\x1c`–`\x1f` that `trim()` keeps. Closed on both sides: an explicit trim
class here, `utf-8-sig` there. Change either and change the other.

**What the switch DOES is the runner's rule and lives there**, not in this repository. It is
re-read at every builder spawn, so a flip here reaches the next phase with nothing restarted on
either side; a phase already in flight keeps the provider its builder opened. The whole rule, its
fallbacks and its cost accounting: `~/.claude/hooks/plan_runner/deepseek.py`, surfaced in
MAN-838, with its invariants at INV-34.

The same switch also steers a hand-launched soul through `plan-runner soul`, and THAT is
where the operator sees it take effect: each such soul draws a pin in the chat it was launched from,
wearing the mark of the endpoint that was actually billed ([docs/MANUAL.md (dispatch-souls)](MANUAL.md)).
So the switch has three surfaces on this box, and only two of them touch DeepSeek — the switch's own
controls, which write the flag (here), the account readout that asks the vendor what is left
([docs/MANUAL.md (deepseek-balance)](MANUAL.md)), and the pin, which asks nobody and paints what a
finished soul's own receipt says it ran on.

**This LANE never talks to DeepSeek, and owns the switch alone.** Nothing under `/api/plan-runner`
loads `DEEPSEEK_API_KEY`, sends it or logs it. Two programs on this box spend that key: the plan
runner reads it straight out of `.env` at each soul spawn, so a runner restarted from cron still
finds it; and ONE module on this server — `server/modules/deepseek/`, behind
`GET /api/deepseek/balance` — reads it per request to report the money left on that account under
the sidebar's account row ([docs/MANUAL.md (deepseek-balance)](MANUAL.md)). The two are siblings and
neither is a route into the other: this lane still reads run files and shells out, and the balance
route knows nothing about runs. Where the key lives and who reads it is declared once, in
`.env.example`.

## The swarm switch — the second

`~/.claude/state/swarm.flag` is written by `server/modules/settings/swarm-switch.ts`, reached through
`GET`/`PUT /api/settings/swarm` (`{enabled: boolean, lanes?: number | null}`; the ceiling is
OPTIONAL — an omitted or `null` `lanes` writes the bare `on`, which is no ceiling at all, and a
count is written as `on <N>` exactly as given; `enabled` not a boolean, or a present `lanes` that
is not a whole number of lanes inside the safe-integer range, is 400 `INVALID_SWARM_STATE` — that
range is the floor because past it this server's double and the runner's int stop agreeing about
the number, and `1e21` would be written as `1e+21`, a token neither grammar accepts). Host-wide,
no `userId` read, for the same reason as the DeepSeek switch above: it steers one plan-runner
daemon and there is only one of it. Both verbs
answer with what was read back off the file, never the input — `null` reading back as `null` and a
count as the count, because neither side narrows one.

**A sibling of the DeepSeek switch's file, deliberately not built on its generaliser.**
`readFlagFile`/`writeFlagFile` (§"The DeepSeek switch" above) answer one question — is the file
exactly `on`? — and this flag carries a SECOND field, the lane count, so `swarm-switch.ts` is its own
module with its own `parse`, written to agree clause for clause with the runner's own grammar
(`~/.claude/hooks/plan_runner/swarm.py`'s `read()`) rather than stretching a helper neither module
alone should have to extend. The write is the same three-part shape as the DeepSeek switch's — a
scratch file, a `realpath`'d destination, an atomic `rename`, the scratch unlinked in a `finally` —
for the identical reason: another process reads this file while this one writes it.

**One client surface:** Settings → Agents → Claude, a second row in `RunnerModelContent.tsx` beneath
the DeepSeek one, wearing the swarm mark — the Lucide `Network` glyph, the same one a swarming run's
card draws beside its lanes — with a `Stepper` whose `Unlimited` is the TOP of its scale rather than
a dead state: `−` on it chooses the first ceiling (two lanes, `FIRST_CEILING` in the row, the
smallest count that runs phases beside each other), `+` on it is refused because nothing is wider,
`+` on any count raises it with no upper bound, `−` stops at one lane, and the `Unlimited` action
drawn beside the stepper whenever a ceiling is set clears it — with both presses live while the
switch is OFF as well as on, where the chosen count is held by the row and written by the next ON
press, because `off` is a file with no count in it.
It composes `src/shared/hooks/useSwarmSwitch.ts`, a module-level reader/writer shaped after
`useDeepSeekFlashSwitch.ts` (§"The DeepSeek switch" above) — the same epoch counter retiring a stale
read, the same one-read-at-a-time for the whole tab, the same optimistic write corrected by whatever
the server reads back off the file, the same `unreadable` kept distinct from an on-disk off, the same
`focus`/`visibilitychange` re-read — and DELIBERATELY its own module rather than the same one: two
switches sharing a coordinator move together the first time either is edited, and these two must
never.

**What the switch DOES is the runner's rule and lives there, not in this repository.** The flag's
whole grammar, the optional lane ceiling, and what makes two phases independent enough to run inside
it, are `~/.claude/hooks/plan_runner/swarm.py` and `independence.py`, surfaced in
`~/.claude/hooks/MANUAL.md` at its `swarm <plan>` verb entry. What a run walking on this switch looks
like once it is live is §"The runner card" below, the lane block a card grows once `progress.json`
carries more than one — led by the same swarm mark this row wears.

**Every phase row says whether it can swarm, and with whom.** Each `progress.json.phases[]` row
carries `wave`: the phase's 1-based wave in the plan's whole map (`independence.waves(plan)`,
exactly what `plan-runner swarm <plan>` prints), `null` for a phase no wave can place, and absent in
a file from a daemon that predates the field — `readPhaseRow` reads both as `null`, the boundary
rule `lanes` follows. It is a property of the PLAN, so it shows whatever the switch reads.
`waveCompanions(run)` (`runState.ts`) groups the rows by it, never re-deriving it, and `PhaseRow`
puts the swarm mark on a phase whose wave holds more than one phase: a neutral `Badge` with the
`Network` glyph reading `runner.wave` (`wave 3`), titled `runner.waveAlongside` (`runs alongside
Phase 6, Phase 7, Phase 8`). A phase alone in its wave wears nothing. The list keeps plan order,
ungrouped. On a phone, where no title shows, the shared number is what groups the rows. The mark
and its row carry `data-runner-wave="N"`, which `.verify/probe-phase-wave-mark.mjs` checks against
the swarm verb on the live heal-reflex run. `progress.txt` adds the same ` · wave N` to the same
rows.

## The heal reflex's switches — the third, and the one that stops work

Four flag files under `~/.claude/state/`, read and written by `server/modules/settings/heal-switch.ts`
(the model switch in its sibling `heal-model-switch.ts`, the cycle schedule in its sibling
`heal-cycle-switch.ts`, each through that file's own reader and writer) and parsed at every ending by
the reflex's worker (`scripts/heal_switches.py`, which also holds `read_cycle_switch` for the schedule,
read through `scripts/heal_reflex_decide.py` and its own sibling `scripts/heal_model_switch.py` for the
model) — so a flip here reaches the next ending with nothing restarted on either side, exactly like the
two switches above, and for the same reason they are not rows in `auth.db`: the worker runs detached
from a hook, with no database and no HTTP.

| file | what it carries | ABSENT means |
| --- | --- | --- |
| `heal.flag` | THE MASTER — may an ending ASK to launch a heal at all | **ON**, which is today's behaviour: it ships absent |
| `heal_daily_cap.flag` | the day's ceiling, a plain decimal dollar amount | **NO CEILING** |
| `heal_model.flag` | WHICH MODEL a heal's souls run on — `deepseek` or `claude`, one word; the HEAL's own choice, unrelated to the chat composer's `deepseek_flash.flag` | **`deepseek`**, the side it ships on |
| `heal_cycle.flag` | WHEN the maintenance cycle opens — `off`, or `on <hour>` (the UTC hour); a pressed cycle (typed `/heal`) is the operator's own hand and is never gated by it | **ON at hour 10**, the side it ships on |
| `deepseek_flash.flag` | the CHAT COMPOSER's own switch — a fifth file, and the one this row is here to rule OUT: no heal door reads or writes it, for any reason, not even as a fallback | not applicable — never read by any of the four above |

`GET`/`PUT /api/settings/heal-master` (`{"enabled": boolean}`; anything else is 400
`INVALID_HEAL_MASTER_STATE`) is the master's door, beside the cap's `/api/settings/heal-cap`
(`{usd}`, `null` clears it), the model's `/api/settings/heal-model` (`{"model": "deepseek" |
"claude"}`, one of the two words and no third value; anything else is 400
`INVALID_HEAL_MODEL_STATE`), and the cycle's `/api/settings/heal-cycle` (`{"enabled": boolean, "hour":
0..23}`, `hour` required — a whole hour of the day; anything else is 400
`INVALID_HEAL_CYCLE_STATE`). All four are host-wide with no `userId` read, and every verb answers
with what was READ BACK off the file, never with the input.

**The master is the one of the three that does not fail closed, deliberately.** Only the exact word
`off` stops anything — `on`, `ON`, a typo, an oversized or unreadable file all read ON — because ON is
what the file shipping absent has always meant, and a flag that cannot be read must never be the thing
that disarms a reflex that is running. Its neighbour the model switch fails the other way (it names a
side in every state), which is why the parses in `heal-switch.ts` are written to agree clause for
clause with the Python rather than to be lenient in one direction: a reader that took `on3`, or a
writer that emitted it, would leave the operator pressing a switch the worker does not see move.

**THE DAILY CAP IS A DEEPSEEK FIGURE, and so is the peak park.** The worker sums the day's heals whose
row says they ran on DeepSeek — each booked at its chain's DeepSeek stages alone — plus a reserve for
the ones still walking (`spend_today` landed + `spend_reserved`: running heals × the mean of the last
five landed). Claude is the operator's own subscription, so it carries no cap, no dollar figure and no
warning anywhere, and neither park is weighed against a heal whose model is Claude. That is the whole reason the model switch exists: leftover Claude usage at the end of a week
can be spent on heals that would otherwise be parked behind a cap, without moving a single session's
builds, because `heal_model.flag` is the HEAL's own choice and never the chat's.

**Two shapes a HAND-TYPED cap file can hold read differently on the two sides, and the row answers the
safer side in both:** Python's `float()` takes digit-grouping underscores, so `1_000` is $1000 and
`1_0.5` is $10.50 to the worker while this server's cap reader answers NO CEILING; and a cap in
non-ASCII decimal digits (`on ٢`, `٢٥`) or past `Number.isSafeInteger` (twenty digits and up) is the
worker's own number — its `float()` takes every Unicode decimal digit and narrows nothing — while the
row answers NO CEILING, the line where a double and an arbitrary-precision float stop agreeing about
which number was written. Fail-closed is the deliberate half: a row that guessed a hand-typed cap
would raise it past the file's own word. Neither shape is reachable from the row's own writer, which
emits ASCII and a plain decimal alone.

**What `off` stops is the LAUNCH, and only the launch — for BOTH doors.** Every ending still indexes
the friction it saw, so nothing is lost while the switch is off, but the typed `/heal` door and the
watchdog's tick are gated by it exactly alike: the master sits ABOVE the daily cap
in the ladder, so it gates every launch attempt before the cap is even consulted. NO WALK BARS A
LAUNCH — a heal starts beside any plan or chain alike (operator, 2026-09-23: "Heals shouldn't have
to wait for because a plan is in progress"); the cap and the one-drain-per-box lock are spend and
one-worker guards, not walk guards.

**One client surface for the master, two for the model.** Settings → Agents → Claude carries the
master as a third row in `RunnerModelContent.tsx` beneath the swarm one, wearing the heal panel's own
`HeartPulseIcon`, composed through `src/shared/hooks/useHealMasterSwitch.ts` — its own module-level
reader/writer, for the same reason the swarm hook is not the DeepSeek one. A row that could not be read
draws the unknown state and a Retry press, never an off, because a master drawn OFF while the reflex is
launching is a reader told to stop looking for the switch that would stop it.

The MODEL switch is drawn by ONE component on two surfaces — `src/modules/heal/HealModelSwitch.tsx`,
in the Heal tab's toolbar (`HealActions.tsx`, the row under the tab's header) beside the cycle's Start/Stop and as the fourth row of that same Settings block
(`sections/content/RunnerHealModelRow.tsx`, which owns the row's three descriptions and reads the
summary off the app's one heal poller) —
composed through `src/shared/hooks/useHealModelSwitch.ts`. Both read the position off the same
module-level reader, so a press on either moves the other, and both draw the side the worker reported
(`switches.model`) rather than a rule of their own: the chip wears DeepSeek's whale and price while
DeepSeek is the side and Claude Code's mascot and the word "Claude" while Claude is. There is no third
state and no caption: the file names a side in every state (absent is `deepseek`), and the chip's own
name says whose switch it is — the heal's souls, not the session chat's, whose composer chip writes a
different file and never moves with this one. A press writes the OTHER word explicitly. The
Heal tab's own Start/Stop (`HealStartStopButton.tsx`) is the CYCLE's door, never the master's: no open
cycle reads "Run a cycle now" (`POST /api/heal/cycle`, disabled while the master is off, captioned where
the master lives) and opens one — Chiron ranks the live friction, heals walk his list; an open cycle
reads "End cycle" (`POST /api/heal/cycle/stop`, pressable regardless of the master) and closes it,
running heals finishing on their own. Both doors ask the same gate the watchdog's tick asks, so a
press fires at once and, refused, answers with the worker's own sentence (e.g.
"heal switch off") under the button. Which word the button shows is `cycle_open` off the
summary, never an optimistic flip — every press ends in a re-read.

## The Jev switches — the flags this server reads and writes

Beside the DeepSeek row, **Settings → Agents → Claude** carries the switches for TypeSafe's Jev,
the house semantic-judgment primitive (`~/.claude/hooks/jev_client.py`): `JevContent.tsx`, mounted
directly under `RunnerModelContent`, drawn from `useJevSwitches.ts`, whose state is the one module
in `src/shared/hooks/jevSwitchesStore.ts` — the reader, the writer, the in-flight write guard and
the focus/visibility re-read all live there, because these rows are drawn in TWO places: this
Settings page and the API tab's Jev view. A flip on either reaches the other the moment the server confirms
it (the overlay means no focus event fires when Settings closes over the tab behind it).
`server/modules/settings/jev-switches.ts` reads and writes the same files the Python side reads
through `plan_runner.state.reads_on`: `~/.claude/state/jev.flag`, the MASTER (off, and nothing
leaves the box), plus one file per narrow opt-in — `jev_prompts.flag`, for the operator's own
prompt text (`route_artifact_word.py` is the one caller today), and `jev_tool_output.flag`, for a
command's output, which a post-tool hook may send to decide whether a clean exit really was one
(never from a no-send path). `GET`/`PUT /api/settings/jev` answer `{master, …scope, …scopeLive}`,
the live fields derived server-side once rather than by each reader (`promptsLive = master &&
prompts`); `PUT` validates every named field before writing any of them, so a malformed body
(`{"prompts":"on"}`) writes nothing, and a partial-write failure puts every file this request moved
back where it was rather than leaving a scope armed under a master that has gone on — the restore runs
whenever anything was written, including for a body that names scopes and no master, which with more
than one scope is no longer the same thing as nothing having been written.

**The scopes are a table, not a set of pairs.** `JEV_SCOPES` in `jev-switches.ts` is the one list
of them — key, live field and flag path — and `readJevSwitches`, `writeJevScopeSwitch`, `setJev`
and the panel's rows all walk it. A scope added there is one entry in that table, one in
`jevSwitchesStore.ts`'s matching list (re-exported by `useJevSwitches.ts`), and one row in each
panel's own table; nothing else branches on which scope it is holding.

**The gating rule the panel enforces is the one `jev_client.switch_on` enforces:** a scope row is
disabled (never hidden — its stored value still shows) while the master is off, so an operator can
arm an opt-in ahead of time without it taking effect until the master also reads on, and turning
the master off never silently discards a stored on. The master row warns, before the press that
would do it, when ANY stored opt-in is on below it. Every file is written the same way
`deepseek_flash.flag` is — a scratch file, realpath'd destination, atomic rename — through the
shared `readFlagFile`/`writeFlagFile` this module reuses rather than re-implementing.

**Settings draws no Jev reading; one line of copy points at the tab.** The rows above and that line
are the whole card: `JevContent.tsx` says the per-caller context Jev kept out is on the API tab,
under Jev, and draws nothing else off the ledger (D11). Every Jev number the app shows — the API
tab's Jev view, and the footer balance beside the DeepSeek one — comes from ONE reader, the Python package
`hooks/jev_stats/`, whose `summarize()` is the single home of each figure `jev stats` prints and of
the payload `/api/jev/summary` serves, so the command and the screen cannot drift. It opens
`~/.claude/state/jev_ledger.jsonl` read-only and consumes it only through its last complete line, so
an append in flight is never half-read. A `saved` line is a report about a call, so it counts towards
the net and not towards `calls`, exactly as the command counts it — and neither does a `cache_hit`
line, which records an ask the replay cache answered without sending anything (`hooks/jev_cache.py`),
nor a `budget` line, which records an ask a spent per-soul ceiling refused to send, since a request
that was never made is the opposite of a call. The reader only reads: the one mutation the panel
exposes, clearing the replay cache, rides the existing `jev cache clear` verb.

**The CLI and the screen are two doors onto the same files, not two switches.**
`~/.claude/scripts/jev switch on|off|status [--scope prompts|tool_output]` and the panel both read
and write `jev.flag` and the scope flags directly — flipping one is visible from the other on the
next read, with no daemon or lock between them. `jev switch status` prints every file's live state
and whether each scope is actually LIVE (master and that scope both on) or merely stored, the same
distinction the panel draws.

## How a run is classified

In order, mirroring `runner_statusline.py`'s `read_run` and `segment`, plus one rule of the reaper's:

1. No readable `progress.json` → **skipped**. There is nothing honest to say about that directory.
2. `receipt.json` present → **`ended`**, carrying the receipt's `status` as `outcome` and its `ended_at` —
   for 24 hours after `ended_at` (`ENDED_KEEP_S`, beside `STALE_AFTER_S`), then **omitted**. The
   operator asked to SEE a run finish and dismiss it themselves (2026-09-09), so the receipt keeps the
   run on the lane instead of taking it off; dismissal is the client's, per user (see the card below),
   and never a write into the runner's directory. A receipt caught mid-write still ends the run —
   presence is the signal — and reads `unknown` until the next tick reads its bytes. `receipt.prev.json`
   is what a resume leaves behind and is not a receipt. **One ended card per plan**: an ended run is
   carried only while it is the newest run of its plan — a later run of the same plan, ended or
   moving, supersedes it (`supersedeEnded`) — so a plan re-walked eight times shows its last ending
   once, and none while it is walking again.
3. `plan_path` does not exist on disk → **omitted**. This is what `reap` retires
   (`hooks/plan_runner/cmd/observe.py:210-212`) and what `resume` refuses with exit 4, so carrying
   them would flood the tab with runs nothing can continue. Existence is the whole test; the plan's
   CONTENT is never read.
4. `run.json.stopped_at` is non-null AND `run.json.status` is `"queued"` → **`queued`**. The runner
   writes this shape itself — `start --queue`, or a fresh launch landing inside DeepSeek's peak hours
   with the switch on (`hooks/plan_runner/cmd/queueing.py`) — never the operator's `stop`, and it is
   classified BEFORE `paused` because the two carry different words on the card (Start, never Resume)
   for a run that has never walked. `run.json.queued_until` rides the snapshot as the epoch it waits
   for, or `null` when nothing named one.
5. `run.json.stopped_at` is non-null → **`paused`**.
6. `now − beat ≥ 900` (`STALE_AFTER_S`, the statusline's own number at
   `runner_statusline.py:25`) → **`stale`**. Which `beat` — see below.
7. Otherwise → **`live`**.

**Paused wins over stale, and queued wins over paused.** Rule 5 is the ONE deliberate difference from
the statusline, and rule 4 is a second, narrower one layered on top of it. `read_run` returns `None`
for a parked run, because the bar is for what is moving; this lane carries it so the tab can list it
and offer Resume — or, for a queued run, Start. A run parked for a day, or queued through the night,
has a lapsed heartbeat by definition, and reading either as stale would offer the operator a recovery
for a state the clock or their own `stop` chose. Do not "fix" the lane to match the bar.

### The liveness beat

Rule 6 is **not** aged against `progress.json.heartbeat_at`, and this is the second deliberate
divergence from the terminal bar. That field is set to "now" at `hooks/plan_runner/progress.py:185`,
inside `_assemble`, which is reached only through `write` (`:139`, whose contract at `:141` is
"Called after every stage change") and written at `:151` — so it advances on a stage change and at no
other moment. A healthy phase spending twenty minutes in one fix-pass therefore carries a
twenty-minute-old progress heartbeat and reads *stale* while it is working. Measured on this host
while this very lane was being built: 96 s of progress age against 6 s of lock age, on a phase whose
own budget is 5400 s.

The beat is the **lock**, `~/.claude/state/runner/locks/<sha256(realpath(plan_path))[:16]>.json`,
whose `heartbeat_at` a daemon thread rewrites every 30 s for as long as it lives
(`state_lock.py:249-267`, `HEARTBEAT_S = 30`) regardless of what any phase is doing. `plan-runner status` reads
liveness the same way (`cmd/observe.py`, `_liveness`).

That path is **absolute and follows the one state-root seam**. `state_lock.py:38-43` expands the state root at import — the root
being `$PLAN_RUNNER_STATE_DIR` when set — and joins `locks` onto it, and every reader in `hooks/plan_runner/` goes through that
same resolution (`costs.py`, the gate's `scripts/quiet_checkpoint_runs.py`, `scripts/runner_watchdog.py`). So the runs and the
locks move TOGETHER: a root that moved one and not the other would read the other tree's locks, which is why the gate refuses to
resolve them separately too.
**This lane does not follow yet.** `runner-state.transport.ts`'s `LOCK_DIR` is still the literal
`~/.claude/state/runner/locks`, while `plan-runner.module.ts:157` and `plan-cost.service.ts:76` read the runs from
`$PLAN_RUNNER_STATE_DIR`. In the default configuration both name the same directory and nothing is wrong; under a moved env every
lock lookup misses, every run drops to the progress-file fallback, and every healthy long phase reads *stale* — silently, and
only under the configuration meant to be the safe one. Deriving the lock directory from the same root this lane already resolves
for the runs is the cure; it needs the root threaded through `readLockFile`/`pruneVanishedReads` and a server rebuild, so it is
the operator's call and not this lane's.

Two conditions, both required:

- the lock file exists, and
- its `run_id` **is this run's**. A lock is keyed by PLAN, not by run, so the file at that path may
  belong to a later run of the same plan that took this one over; borrowing its beat would show a
  dead run as live forever.

When no lock names the run — every fixture, a crashed daemon, a released lock — the beat falls back
to `progress.json.heartbeat_at`, and the run is judged by its own last write. That is a *real* lapse
for something nothing is beating for, not an artefact. `RunnerRunSnapshot.heartbeat_at` carries the
**effective** beat, whichever of the two it came from. `runner_statusline.py` ages the progress field
alone and has the same misnomer; that is a follow-up on the bar, and not the model for this lane.

**What this lane consequently cannot see.** The beat thread's independence from any phase cuts both
ways. A run that is alive but **wedged** — a phase blocked forever on a subprocess that never returns
— keeps its lock beaten every 30 s (`state_lock.py:245-250`), so it reads `live` indefinitely, where
aging the progress file would have raised `stale` after 900 s. The trade is deliberate: a false
`stale` on every long healthy phase is constant and misleading, a wedge is rare, and
`position.stage_since` still shows it — a stage that has not moved in an hour is the cue this lane
leaves the reader, and the one a future panel should surface.

Runs come back ordered by `started_at` ascending, the bar's own order, with the directory listing
sorted by name underneath so two runs that started in the same second keep a stable order rather
than swapping places between ticks — which would announce a change that is not one.

The timeline is `runner.log` parsed against
`^(\S+) ◆ (\d+) of (\d+) · Phase ([\w.]+) — .*? · stage: (\S+)(?: (.*))?$`, last 200 entries kept. A
line that does not match is skipped rather than guessed at: the log is append-only and its last line
can be half-written when we read it. The timestamp is kept as the runner's own local ISO string —
it carries no zone, so re-parsing it into an epoch would invent an offset. The ` · lanes: 5, 6` tail
is cut before matching — it names the run's lanes, not this stage's detail — and an entry that
repeats the one KEPT BEFORE IT exactly collapses into it: same second, same phase, same stage, same
detail. A second is the runner's own resolution, and a sibling lane's stage change used to re-print
the current phase's line, so a phase read `08:16:35 builder` four times over one unchanged stage. The
writer no longer appends those, and the collapse keeps every log already on disk clean without a
rewrite. It is CONSECUTIVE rows only — a stage re-entered after another in the same second is a real
event and is served — and an identical stage at a LATER second is kept for the same reason: a
builder re-spawned after a retry.

**Every timestamp inside a snapshot is epoch SECONDS**, because that is what the runner's Python
wrote with `time.time()`. Only the frame's own `at` is milliseconds. Read one as the other and every
run on the host renders live, forever.

## The snapshot shape

`RunnerRunSnapshot`, `RunnerPosition`, `RunnerPhaseRow`, `RunnerTimelineEntry`, `RunnerRunState`,
`RunnerPhaseState`, `RunnerStateEvent`, `RunnerVerb`, `RunnerVerbResult` and `RunnerModelChoice` are declared in
`server/shared/types.ts` § PLAN RUNNER CONTRACTS, documented field by field against the runner file
each one is read from. Read them there, not a copy here.

## The twelve routes

| Route | Answers |
|---|---|
| `GET /api/plan-runner/runs` | 200 `{runs, at}` — the watcher's last reading, never a fresh scan. |
| `GET /api/plan-runner/runs/offpeak` | 200 `{at}` — the runner's next DeepSeek off-peak moment, epoch seconds (`plan-runner offpeak`: the end of the latest `deepseek.PEAK_UTC` window, 10:00 UTC), or `null` when the runner did not answer. Cached server-side until that moment passes (`runner-offpeak.service.ts`); registered BEFORE `/runs/:id`, which would otherwise read `offpeak` as a run id. The one clock the `Start at …` button shows — neither the server nor the browser computes DeepSeek's windows. |
| `GET /api/plan-runner/runs/:id` | 200 `{run}`, or 404 `{error:'no such run'}`. A malformed id gets the same answer an unknown one gets, and gets it without a lookup. |
| `POST /api/plan-runner/runs/:id/stop` | The verb relay below. |
| `POST /api/plan-runner/runs/:id/resume` | The same. |
| `POST /api/plan-runner/runs/:id/model` | Body `{model: 'deepseek'\|'claude'\|'auto'}` — the same relay, as `plan-runner model <id> <word>`. The word is matched against exactly those three (`readRunnerModelChoice`, `server/shared/utils.ts`) and the argv carries OUR constant, never the request's string; anything else is 400 `{error:'model must be one of deepseek, claude, auto'}` before anything is spawned. |
| `POST /api/plan-runner/runs/:id/schedule` | Body `{when: 'offpeak'\|'none'\|'<iso>'}` — the same relay, as `plan-runner schedule <id> <when>`. The word is checked as exactly one of those shapes (`readRunnerScheduleWhen`, `server/shared/utils.ts`: an ISO string must be a strict timestamp WITH `Z` or an offset), never passed through as free text; anything else is 400 `{error:'when must be offpeak, none, or an ISO-8601 timestamp with a zone'}`. The runner refuses a run that is not queued and a time already past — a 409 carrying its sentence. |
| `GET /api/plan-runner/arcs` | 200 `{arcs, at}` — the arc lane's last reading, never a fresh scan. |
| `POST /api/plan-runner/arcs/:arc/model` | Body `{model}`, fenced exactly as the run's model route above; relays `plan-runner arc model <arc> <word>`, which writes `arc.json:model` and re-pins every minted, unfinished card's run. Answers as the reorder route does. |
| `POST /api/plan-runner/arcs/:arc/start` | No body; relays `plan-runner arc start <arc>` — never `--now`. The runner runs the whole ladder (lints, switch, intent lock) and creates card 1; a refusal is the 409, answered as the reorder route does. |
| `POST /api/plan-runner/arcs/:arc/schedule` | Body `{when}`, fenced exactly as the run's schedule route; relays `plan-runner arc schedule <arc> <when>`, which writes `arc.json:start_at` and is refused once the arc has started. |
| `POST /api/plan-runner/arcs/:arc/reorder` | Body `{from, to}`. 200 `ArcVerbResult` `ok:true`; **409** `ok:false` — the runner's refusal, its `stdout` and `stderr` carried whole; 504 `reason:'timeout'`; 503 `reason:'spawn-failed'`; 400 `{error:'arc name is required'}` for a name outside `/^[A-Za-z0-9_-]{1,64}$/`, `{error:'from and to are required'}` for a position outside 1..999. |

The routes validate and translate and do nothing else: no file is read in a handler, no process is
started in one, and no route names a path from the request. The state directory and the runner
binary are the module's, fixed at composition; a request can only ever choose a run id.

The three arc routes are the arc lane's, and they answer to the same law. `arc-lane.ts` runs them over
the same `createPolledLane` the run lane uses: a 2 s poll (`POLL_MS`) taking `arc-state.service.ts`'s
`snapshotArcs` — every `<name>/arc.json` under `$PLAN_RUNNER_ARCS_DIR`, else `~/.claude/state/arcs` —
and broadcasting `ArcStateEvent`, `{kind:'arc_state', arcs, at}`, whenever the picture changes.
`test_arc` is `isHiddenProjectPath(arc_path)`: the client's switch to hide (§"The arc deck"), never
the lane's to drop. The reorder route shells `plan-runner arc reorder <arc> <from> <to>` and the model route
`plan-runner arc model <arc> <word>`, through the one `execFile` helper that lives in the lane module
itself (`runArcVerb`) rather than behind the relay the run verbs share (§"The verb relay") — and the
runner takes the arc's own lock and rewrites the arc file (or, for a word, the arc's record), so the
arc file stays the ONE truth and the deck stays a view of it; no handler writes an arc. A request
still names an id and nothing else — on these, an arc name the route fences with the regex above
before anything runs, and a model word matched against our own three. An unknown path under `/api/plan-runner/` answers the SPA's HTML with status
**200** (measured 2026-09-22), so every verify reads the JSON body, never the status alone.

## The verb relay

`:id` must match `/^[A-Za-z0-9._-]{1,120}$/` or the answer is 400 `{error:'run id is required'}` —
refused at the route, before anything is spawned. Then the runner is run as an argv array,
`execFile(bin, [verb, runId, ...verbArgs])` — `verbArgs` empty for `stop`/`resume`, the fenced word for `model`: no shell parses any of it, so an id carrying a space or a semicolon
is one argument the runner rejects rather than a second command. `bin` is `$PLAN_RUNNER_BIN`, else
`~/.claude/scripts/plan-runner`; `cwd` is the home directory, never this repository; `PATH` gains the
directory holding the Claude CLI, because a resumed run spawns souls that look it up on their own
`PATH` and the server's is whatever its unit was given.

| Outcome | Status | Body |
|---|---|---|
| The runner exited 0 | 200 | `RunnerVerbResult`, `ok:true` |
| The runner exited non-zero | **409** | `RunnerVerbResult`, `ok:false`, the runner's own `stdout` and `stderr` carried whole |
| The runner was torn down before it answered | 504 | `reason:'timeout'` |
| The runner never started | 503 | `reason:'spawn-failed'` |

The last two are told apart by whether the child carried a SIGNAL, measured rather than assumed
(node v24.14.0): our own 20 s ceiling arrives `killed:true, signal:'SIGTERM'` and a kill from
outside this process arrives `killed:false, signal:'SIGKILL'`, while a missing binary is `ENOENT`
and an output overflow `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`, neither with a signal. So 504 means the
command ran and was cut off — our ceiling and an operator's `kill` alike — and 503 means it never
ran. `killed` is the wrong test: it is false for the outside kill, which would then be reported as
"could not be started" about a verb that started, ran, and may already have un-parked the run.

One residue, named at `runner-verb.service.ts`: an output overflow has no signal and so answers 503
though the command did start. It is honestly neither word — the vocabulary is sealed at two and
mirrored client-side — and `VERB_MAX_BUFFER`, a thousand times the real output, is what keeps it
unreachable rather than merely unlikely.

**A refusal is a RESULT, not an error.** The runner already knows what a pause means and what a
resume may decline; its own sentence is the single most useful thing in the answer — `no lock names
run <id> — nothing to stop` (`hooks/plan_runner/cmd/launch.py:234`), `plan-runner stop: no such run
or file — …` (`hooks/plan_runner/cmd/__init__.py:75`) — so it travels untouched and the status
says "conflict", not "we broke". Nothing thrown ever enters the body: no stack, no thrown message.
On the two cases where the runner never spoke, a plain sentence of ours stands in, so the reader is
never handed a blank refusal — and the timeout sentence does NOT claim nothing happened, because
`resume` takes the lock, clears `stopped_at` and saves `run.json` before it detaches
(`hooks/plan_runner/cmd/launch.py:209-223`), so a ceiling that lands late can land after the run is
already un-parked.

## Pushes on an ending

When a run ends, the lane says so once, through the same notification orchestrator every chat run
uses ([docs/MANUAL.md (notifications)](MANUAL.md)), so web push, the desktop app and the ntfy phone push
all hear it under each user's own switches. `runner-endings.service.ts` decides;
`plan-runner.module.ts` hands it the watcher's frame, so an ending is read off the exact picture the
tabs receive, and only when that picture changed.

| The ending | Code | Kind — the switch it rides | ntfy |
|---|---|---|---|
| `complete`, no phase blocked or pending | `runner.finished` | `stop` — Run stopped | priority 3, ✅ |
| `complete` with phases left, `all-blocked`, `budget`, `flag-off`, `unreadable` | `runner.blocked` | `error` — Run failed | priority 4, ⚠️ |
| `rate-limited`, `dry-run`, a receipt caught mid-write (`unknown`) | none | — | — |
| a fixture walk — the plan in a scratch folder — `~/.claude/state/test-projects/runner-fixtures/`, anywhere else under `~/.claude/state`, or the OS temp dir (`scripts/runner_fixtures/*.sh`) | none | — | — |

"Phases left" is the card's own `runUnfinished` rule — a blocked or pending phase — read off the
phases, never off the receipt's word. A rate-limited park says nothing because nothing is wrong with
the plan: `runner_watchdog.py` resumes the same run when its window lifts. `unreadable` DOES push —
nothing takes up a run that ended there (`_verdict` answers `done` over one: its `blocked` is empty
and no phase owes an unblock), so the operator's own `resume` is the whole remedy and the push says
`Plan unreadable`. The title is the headline
and the plan's title (`Plan blocked · <plan title>`); the body counts shipped of total. A finish adds
the run's walk time — `ended_at - started_at` — and the plan's spend over every run of it. `started_at`
is the START press, never a queue wait: a run created PARKED is stamped by the press that lifts it out
of the queue (`launch._resume`), while a run merely STOPPED and resumed keeps its original start, so a
pause counts and the hours it spent waiting for a window do not. Anything else adds how many phases are blocked and
left, and names the first blocked phase with its cause. Blocked means the row says `blocked` OR the
receipt's `blocked` map names the phase (`blocked_causes` on the snapshot): a phase the walk left standing
on a crash or on the run's budget is in that map while its row still reads `running` or `pending`. A tap opens
the app root: the push goes to every active user, so it names no chat.

**A run belongs to no login, so every active user is told**, each through their own event switches
and channels. The dedupe key carries the user id, because the orchestrator's 20-second dedupe is
process-wide and would otherwise drop the second user's push as a repeat. One user's failure is
logged and costs that user's push only: the mark still advances, because a retry would push again to
every user already told.

**Once is a watermark in the database, not a memory in the process.**
`app_config.plan_runner_announced_through` holds the newest `ended_at` already announced, in epoch
seconds. The dev server restarts on every edit through a handover that runs two servers side by
side: a set held in memory would re-announce every ending of the last day on each boot, or, seeded
at boot, lose the ending that landed during the restart. The mark is read again just before anything
is sent, so the two servers of a handover do not both push one ending, and advanced after each
announcement, so a failure leaves the rest due instead of marked. On a database that has never held
the key, the first picture seeds it with the current time and announces nothing — the receipts
already on disk are history.

**A watchdog restart is a new ending.** `runner_watchdog.py` restarts a run whose every remaining
block is transient (`crash`, `timeout`, `budget`, …), or whose run still owes an unblock outing for
a spec-bound one — the watchdog's `_owed` arm, which turns a spec-bound block from a wall into a
restart while a door is still open (INV-41); if the restart blocks again,
the run ends again with a later `ended_at`, and that is another push. The watchdog's own cap on
restarts that ship nothing bounds how many.

## The fixture

`.verify/lib/runner-fixture.mjs` writes a fake run into the REAL state directory on purpose: a fake
run has to travel the exact path a real one does, and a hermetic tree under
`PLAN_RUNNER_STATE_DIR` would prove the classification and nothing about the lane that is running,
since the server reads the root it was started with and nothing restarts it mid-probe. What makes
that safe is one fence kept at both ends — every id begins `fixture-live-widgets-`,
`createFixtureRun` refuses to build another, `removeRun` refuses to delete a directory not named
that way, and every caller removes it in a `finally`.

`createFixtureRun()` → `{runId, dir, planPath}`, a five-phase run at phase 2 of 5, stage `builder`,
with three `runner.log` lines. Then `touchStage(run, stage, detail)` moves it and appends a line,
`pauseRun` / `unpauseRun` set and clear `run.json.stopped_at`, `queueRun(run, untilEpoch = null)` parks
it the same way plus the runner's own `status: 'queued'` and `queued_until` — the shape `start --queue`
or DeepSeek's peak hours creates, told apart from a plain pause by those two fields alone — and
`unpauseRun` clears its marks too, the way a real Start does, `staleRun` ages the heartbeat past
the 900 s cut, `endRun(run, status = 'complete', endedAt = now)` writes a receipt shaped like the
runner's own — an old `endedAt` proves the 24-hour window — `reopenRun` renames it aside the way a
resume does, and `removeRun` takes the directory and the fixture plan away. `run.json` carries the runner's FULL record rather than the five fields this lane reads,
because `plan-runner stop` loads it through `state.load` before it looks for a lock: a record short
of a field fails with a decode error instead of the refusal a probe is there to observe.

One visible side effect, and it is expected: while the fixture exists, the terminal status bar lists
it beside the real runs, for the seconds it lives.

## Consumers

The frame goes out over `connectedClients` — every open `/ws` socket — and not over the raw
`wss.clients` set, which would also deliver it to `/shell`, `/plugin-ws` and
`/desktop-notifications`, where it would be parsed and dropped, and on `/plugin-ws` handed to
third-party plugin frontends that have no business seeing it (the reasoning at
`taskmaster.routes.ts:30-50`). It is `kind`-keyed and declared in `GatewayEventKind`, unlike Task
Master's `type`-keyed frames, so the protocol tables in
[docs/architecture/MANUAL.md (01-websocket-transport)](docs/architecture/MANUAL.md (01-websocket-transport)) stay honest.

`useChatRealtimeHandlers.ts` carries `case 'runner_state': return;`, and it must RETURN rather than
break: without the case the frame falls through the switch's `default`, inherits the viewed
session's id and is appended to the open transcript as a message row. It is a box-wide picture, and
no transcript owns it.

### The feed

`RunnerFeed.tsx` is this lane's door into the client's live bus, and the only place in the client
that names the `runner_state` frame. `App` mounts it exactly once — inside `LiveBusProvider`,
because it publishes into that bus; inside the auth gate, so its seed never fires against the login
screen; and below `WebSocketProvider`, because it subscribes to the one socket and never opens a
second. It is headless: it renders its children unchanged and owns no state.

On every `runner_state` frame it republishes the whole picture: `runner:*` carries the `runs` array,
and `runner:<run_id>` carries each snapshot on its own topic, so a reader interested in one run does
not re-render on every other run's heartbeat. A run that ends simply stops appearing in `runs` —
nothing announces its departure — so the feed keeps the id set it last published and RETIRES every
id that has left by publishing `null` on its topic. Without that, the last snapshot of a finished
run would stay retained forever and the next subscriber would be replayed a run that ended hours
ago as though it were still going.

A run id the topic vocabulary does not admit is the one refusal this feed can provoke, and the feed
does not pre-check for it: the allowlist is the bus's to enforce, not a rule restated here. Such a
run keeps its place in the `runner:*` array and its own `runner:<run_id>` topic is simply never
created — which would leave a run visible in the list whose topic stays empty forever, with no cause
attached anywhere, so the bus names it in a `console.warn` the first time it refuses it. That
warning has exactly one source: a producer publishing an id the vocabulary never described.

The push is authoritative, but it only fires on a CHANGE, so a quiet lane would leave a freshly
loaded page blank for as long as nothing moves. That gap is closed by a REST seed — `api.planRunner`
— read on mount and again on every `websocket_reconnected` frame, since frames missed during an
outage are never re-sent. A seed overwrites a retained value only when its `at` is NEWER than what
the bus already holds: a request in flight while a frame arrives would otherwise land after it and
put the older picture back on screen until the lane next moved. A seed that fails is a gap rather
than a failure — the next frame fills it — and is logged, not surfaced.

The bus itself — the topic allowlist, the retained values, the synchronous replay, and why it knows
no producer — is documented on
[docs/architecture/MANUAL.md (07-live-widgets)](docs/architecture/MANUAL.md (07-live-widgets)). This lane was simply its first
publisher. **Three more have arrived and all three kept the shape**: `ArcFeed.tsx` publishes `arc:*`
beside it in this same module (§"The arc deck" below), `SoulLaunchFeed.tsx` in
`src/modules/dispatch-souls/` publishes `souls:*` the same way, and `UniverseFeed.tsx` in
`src/modules/universe/` publishes `universe:*` as a once-a-second digest rather than the raw stream —
all four mounted NESTED inside one another in
`App` rather than beside it — a feed is a wrapper, not a sibling, so the innermost thing in that
stack is still the router. Every further lane arrives as one more `*Feed.tsx` and never as a line
inside `live-bus/` — usually in its own module, though `ArcFeed.tsx` is the exception: the arc deck
reads the runner's own state directory rather than owning one of its own, so its feed lives beside
`RunnerFeed.tsx` instead.

### The runner card

`RunCard` is the lane's first screen: one plan-runner run, whole. The runner card has two homes —
the Runner tab (`RunnerPanel`), and the desktop chat gutter's Runner widget (`RunnerWidgetBody`),
which sits beside the transcript and never over it. The arc deck has the same two homes, drawn
above the runs in each (§"The arc deck" → "The gallery"), and the widget's badge counts both: the
runs plus the arcs not yet complete. The widget's empty state shows only when there is neither a
run nor an arc — the tab's own rule.

**It was pinned above the transcript once, and that is why the rule is written down.** The card was
built into a `flex-none` band between the CLI-version banner and the messages in
`src/modules/chat/ChatInterface.tsx`, and then looked at on a phone: it took half a 390px screen,
and with the keyboard open the conversation was down to one visible line (operator ruling
2026-09-09). Nothing renders over the transcript — not a card, not a strip, not a chip, not a
banner of the runner's. The transcript keeps the whole height the composer and the CLI banner leave
it, and `phase-25.mjs` MEASURES that rather than trusting it: it puts a real run on the lane,
proves the server is broadcasting it, then holds the chat view open for five seconds and asserts
nothing drew it, and that the pane still fills its root exactly. A future region above the
transcript fails that gate whatever it is named.

**Which run comes first.** `useRunnerRuns` reads the bus through `useLiveTopic(RUNNER_ALL_TOPIC)` —
never the socket or the API, since `RunnerFeed` is still the only thing in the client that names the
frame — and answers `{ runs, count, pinned, others }`. `pinned` is the newest LIVE run, else the
newest STALE one, else none; a PAUSED or QUEUED run is never it — both are parks the app would be
arguing with by raising them to the front, whether the operator pressed `stop` or the run parked
itself on DeepSeek's clock. A parked run is not in motion, and raising it to the front every time the
operator opens the app would be the app arguing with a decision that was made for it; it stays in
`runs`, counts toward `others`, and the tab lists it with Resume — or, for a queued run, Start. A
stale run DOES come first, because a lapsed heartbeat is exactly the thing worth a glance. The tab's
own order follows `STATE_ORDER` (`runState.ts`): live, then stale, then queued, then paused, then
ended, newest first inside each — queued outranks paused because its Start is the card's whole point,
where a paused run can wait.

**What it composes.** `RunCard` pulls the library together and declares nothing of its own:
`Card` / `CardHeader` / `CardTitle` / `CardContent` / `CardFooter` for the shell, `Badge` for the
run and phase states, `Meter` for shipped-of-total with spawns and spend beneath it, `Chip` +
`Shimmer` for the stage strip (`PipelineStrip`), `Collapsible` + `CollapsibleTrigger` +
`CollapsibleContent` twice — once around the phase list, once inside each `PhaseRow` around its
timeline — `Banner` + `Spinner` for the repair strip (`RepairBanner`: the replan or unblock outing on a
blocked phase, or the heal item a spent ladder filed (`by`), read off `progress.json.repair` —
repairing with its step and clock while its process lives (the run's for a replan or an unblock, the
drain's pid for a heal — the drain is the heal side's own process, launched by the watchdog's
`heal-due` beat, never by the run), paused while a replan or unblock waits out a rate limit with the
run, and a heal item no drain is working REPORTED as filed (`runner.repair.filedHeal`, "heal item
filed — the heal cycle takes it up"): a run reports what to heal and never waits on a heal (operator
ruling 2026-09-24), so the card never says a run or its heal is waiting on anything — then the
ending: unblocked and running again, healed with the phase still standing (`resumed` false), or
still blocked with the reason)
— and `Button` for the one verb. Every string reaches the DOM as a text node: a plan
title, a phase title, a stage word and the runner's own stderr are all free text written by a
program this app does not control, so none of it is ever handed to a raw-HTML sink or rendered as
markdown.

**Colour, and the word beside it.** `runState.ts` holds the whole map, and it is pure: `live` →
`positive`, `paused` and `queued` → `neutral`, `stale` → `warn`; `shipped` → `positive`, `running` → `info`,
`blocked` → `warn`, `deferred` and `pending` → `neutral`. Nothing is `danger` — red is destructive
or denied, and a blocked phase is neither. Tone travels as `Badge tone=` and reaches the paint
through the token blocks, so no file under `src/modules/plan-runner/` spells a colour. Every state
also carries a WORD (`LIVE`, `running`) and a GLYPH — `PHASE_GLYPH`, the runner's own five from
`PLAN_FORMAT_V2.md` §8: ✅ shipped, ▶ running, ⛔ blocked, ≡ deferred, `·` pending — so the card is
readable in a screenshot and by somebody who cannot tell the tones apart.

A card is rendered with `key={run.run_id}`, which is load-bearing rather than a lint habit: the run
in a given slot changes when one ends or a newer one starts, `defaultOpen` is read once by
`Collapsible`, and an unkeyed swap would reconcile the same `RunCard` instance — opening the new
run's card on the previous run's unfolded phases, with a verb still in flight for the old run
leaving the new one's button disabled.

**The stage strip** draws `pipelineForRun(run)`, the inverse of the runner's own `pipeline_chain`:
a phase whose `position.pipeline` lacks the word `athena` changes no code, so `athena`, `fix-pass`
and `prometheus` are dropped whole rather than drawn as though still to come. A chip is marked ✅
only when `seenStages(run)` — the distinct stage words the runner LOGGED for the phase it is
standing in — contains it, never because it sits left of the active one. The runner skips
`fix-pass` whenever Athena finds nothing, which is the common case, and a strip marking by position
would report a review that never ran. The active chip's label sits inside `Shimmer` and is followed
by `position.stage_detail`; the row scrolls sideways rather than wrapping, so a run moving from
stage to stage never changes the card's height under whatever is beside it. It scrolls, so it is
also a focusable region with a name (`runner.pipeline`) — the chips are static spans by design, and
without a tab stop of its own a keyboard-only reader could not reach the stages that start
off-screen at 390px.

`position.stage` is **not always one of the six**. `progress.py::_stage` falls back to the RUN's own
status — `running`, `complete`, `blocked`, `all-blocked`, `budget`, `flag-off`, `rate-limited`,
`dry-run`, `unreadable` — whenever no phase holds a stage, which is every start-up and every gap
between phases. That word is drawn after the
chain behind a `·` separator rather than dropped (which would blank the card's one "what is
happening now" signal) or appended to the chain (which would claim it is a link in it).

A blocked phase is marked on the SURFACE, not only inside the disclosure: a card may be handed
`defaultOpen={false}`, so a `⛔ blocked` badge sits beside the phase count next to the meter's
amber. Colour never travels alone (design doctrine `:147-149`), and the phase rows underneath carry
their own glyph and word as well.

**A swarmed run grows a lane block beneath the strip.** `runLanes(run)` (`runState.ts`) answers the
run's live lanes off `progress.json.lanes[]` — `[]` on every serial run, which is every run until
§"The swarm switch" above is on — and once it holds more than one row (a single lane says nothing
the stage strip does not) a `data-runner-lanes` group renders one `data-runner-lane={lane.lane}` row
per lane, keyed by the lane id and never by index so a finished lane's row cannot slide onto its
neighbour's mark. The group is LED by the swarm mark — a `data-runner-swarm` line holding the same
Lucide `Network` glyph §"The swarm switch" above puts on its row, with `runner.lanesAtOnce` beside
it, `{{count}} phases at once` — because the rows alone say the run has several phases while
the mark and its count are what say it is walking them TOGETHER. Each row spells
`PHASE_GLYPH.running`, the phase's rank, its title (or its `phase_id` when the runner has not
composed one yet), and — toned through `phaseStateTone('running')` — its own `stage` /
`stage_detail` `Badge`, the card's own vocabulary rather than a new one. The phase list below
still holds every phase of the run in plan order, each shared wave marked on its rows
(§"The swarm switch" above). Field-by-field detail for the row is
`RunnerLaneRow` in `server/shared/types.ts` (§"The snapshot shape" above); the client's own mirror,
`RunnerLane` in `runState.ts`, reads the field defensively rather than through `RunnerRunSnapshot`
because that mirror has not been widened to carry `lanes` yet — read both there, not copied here.

**Elapsed ticks locally, and is spelled in the app's own words.** `useElapsed` runs one interval
per hook instance and none at all for `null`, so a five-phase card holds two timers — its header,
and the single phase actually running. It is SHARED, at `src/shared/hooks/useElapsed.ts`: it moved
out of this module when the chat's pinned soul row became its second consumer
([docs/MANUAL.md (dispatch-souls)](MANUAL.md)), and a clock this lane changes now changes that one too. It counts from `started_at` and `stage_since`, never from
`heartbeat_at`, which is a liveness beat rather than a start. The words come from
`claudeStatus.elapsed.seconds` / `minutesSeconds` / `hoursMinutes` in the `chat` namespace — the
same three keys the composer's own clock reads (`src/modules/chat/composer/ActivityIndicator.tsx`).
There is no private formatter here on purpose: two clocks in one app spell elapsed one way, from
one key block, and a hardcoded spelling would be a second one that drifts and cannot be translated.
`hoursMinutes` is the one this lane added, because a run can last hours and a composer turn cannot.

**The verbs.** `useRunnerVerbs` calls `api.planRunner.stop` / `resume` / `model` / `schedule` and reads
the RAW response, because a 409 carries the runner's verdict in its body. The footer offers ONE verb,
chosen by state rather than by disabling the other (a queued run's Start comes with its scheduled twin,
below): only a LIVE run can be stopped, since
`plan-runner stop` looks for a lock naming the run and a stale run's daemon is gone, so offering
Stop there would be inviting a refusal. A parked or dead run offers Resume, over the same `resume`
call — EXCEPT a QUEUED run, whose button reads Start instead
(`queued ? t('runner.start') : t('runner.resume')` in `RunCard.tsx`) though it fires the identical
`resume` request underneath: `resume` un-parks a run the operator stopped exactly as it un-parks one
DeepSeek's clock parked, and the word on the button is the only difference — the operator never types
`plan-runner resume` for either. Start is the operator's press — made now, or made ahead of time through
Schedule. An ENDED run offers
Dismiss — always — and Resume whenever a phase is still blocked or pending, read off the PHASES and
never off the receipt's word: the runner's `complete` means something shipped, not that nothing is
left (`runUnfinished`; 14 of 21 `complete` receipts on this host carried blocked phases). Its badge
carries the outcome word (`COMPLETE` in the positive tone only when nothing is left; `INCOMPLETE`,
`ALL BLOCKED`, `BUDGET`, `FLAG OFF` in warn, never red) and how long ago it ended — re-read
once a minute, not once a second — and its strip lights no active stage. Dismissal is
`dismissRun` in `modules/plan-runner/dismissedRuns.ts`, and it is of one ENDING: `{run_id, ended_at}`
joins `dismissedEndings` under the `planRunner` key of the server-synced user preferences — a MERGED
write, capped at 100 and pruned against the WHOLE lane — so a run dismissed on the phone is gone on
the desktop on its next load (the store hydrates on sign-in, not by push). `useRunnerRuns` drops a
dismissed ending from both the list and the count; a dismissed run that resumes is back while it
moves, and back as a new card if it ends again. **No dialog guards Stop** —
it is a pause, reversible by the button that replaces it, and a dialog in front of a reversible act
teaches the reader to dismiss dialogs. On 200 the toast is `runner.toast.stopping` /
`runner.toast.resumed` in `positive`; on 409, 503 or 504 it is the FIRST LINE of the response's
`stderr` — the runner's own sentence, which is the most useful thing in the answer — in `warn`,
never red, because a refused verb denied nothing and destroyed nothing. `busy` holds the verb in
flight so a second press cannot race two processes at the same run directory.

**The model control.** The footer's right edge carries `RunModelControl` — three `Button`s with
`aria-pressed` in one `role="group"` (DeepSeek · Claude · Chat switch; no segmented primitive exists
in `src/shared/ui`, and the pressed one is the `secondary` variant, the rest `ghost`, so no colour is
spelled by hand). It shows the run's OWN word (`effectiveModelWord(run.model)`, `src/shared/utils.ts`: a `null` word presses
DeepSeek, the runner's default, and Chat switch is pressed only when the record says `auto`) on a queued,
live, stale or paused run and on an ENDED one that is still unfinished — the ones a next phase can
still reach — and is absent on a finished one. A press relays `POST /runs/:id/model` through
`useRunnerVerbs.setModel`, under the same `busy` as Stop/Start, so every button refuses while one verb
is out; pressing the option already pressed sends nothing. NOTHING OPTIMISTIC: the control re-draws
from the next `runner_state` frame, which reads `run.json:model` back — a refusal leaves it on the
truth, with the runner's sentence in a `warn` toast under `runner.model.refused`. What it NEVER does:
restart, stop or resume the run, or touch the chat's DeepSeek switch (`deepseek_flash.flag`) — the
word takes the run's NEXT phase (the walker re-reads it at every phase entry), while a phase already
building keeps the model its builder opened. Handles: `data-runner-model="<deepseek|claude|auto>"` on
the group, `data-runner-model-choice` on each option. Proof: `.verify/probe-runner-model-pin.mjs`.

**The schedule control.** A QUEUED run's footer carries `ScheduleControl` beside Start: `Start at <time>`,
the runner's next DeepSeek off-peak moment (`useOffpeak` → `GET /runs/offpeak`, ONE ask shared by every
card and deck, re-asked when the moment passes) rendered in the reader's clock by `runState.scheduleClock` —
`3:00 AM` today, `Sep 23, 3:00 AM` any other day, since 3 AM Pacific falls past the operator's midnight.
The card NEVER computes DeepSeek's windows; until the runner answers, the button waits. A press relays
`POST /runs/:id/schedule {when:'offpeak'}` through `useRunnerVerbs.schedule` under the same `busy`; the next
frame carries `start_at`, the header's note leads with `starts <time>` (the DeepSeek-peak sentence stays
beside it when both apply; "queued — not started" gives way to the time) and the button becomes Cancel,
which relays `{when:'none'}`. The runner-watchdog's two-minute tick presses Start when the time comes
(`plan-runner due` — MAN-838), so the note names the operator's time and the press lands
within one tick of it. Nothing optimistic; a refusal is the runner's sentence in a `warn` toast under
`runner.schedule.refused`. Handles: `data-runner-schedule="<start_at epoch|empty>"` on the group,
`data-runner-schedule-set` on `Start at …`, `data-runner-schedule-cancel` on Cancel. Proof:
`.verify/probe-runner-schedule.mjs`.

Its strings live under `runner.*` in `src/modules/i18n/locales/en/common.json`, English only; every
other locale falls back.

The tab that mounts it is the next section.

### The Runner tab

`RunnerPanel` is where every run on the lane is drawn — one of `RunCard`'s two callers now that the
desktop chat gutter's Runner widget is the other (§"The runner card"). It reads `useRunnerRuns` (and
`useArcs`, for whether the gallery above the runs has anything to draw) and nothing else — no fetch on mount, no state of its own — so selecting the tab paints on the FIRST
render with whatever the bus was already holding rather than blanking until the runner next moves.

**The gate rule is the memory tab's, and the Runner tab is the second tab to take it.**
`useWorkspaceTabGates` computes
`shouldShowRunnerTab: runnerCount > 0 || arcCount > 0 || activeTab === 'runner'` beside the memory
line — `arcCount` is the arc deck's own count (§"The arc deck" below), off the same bus the runs come
from, because the deck's gallery lives in this same tab's pane — and that ONE reading is what the
three call sites share — `WorkspaceMain`, `ProjectSidebarRegion` and `ProjectCommandPalette` each
pass their own `activeTab` and none of them recomputes the rule. The tab therefore appears while a
run is in motion OR an arc the runner has not finished is open, and is STICKY: it holds while it is
the selected tab even after the last run ends and the last arc completes, so a run finishing under
someone reading its phases empties the panel instead of taking the tab out from under them. There is
consequently
**no snap-back effect** for it in `WorkspaceMain` — the three effects there belong to the
PREFERENCE-gated tabs, whose gates really can turn off mid-act; a data-gated tab's gate is written
never to. `VALID_TABS` names `runner`, so a restored `runner` tab lands on the panel rather than an empty
pane; switching session returns to chat from it as from every tab (`handleSessionSelect`).

**The badge.** `runnerCount` travels to `WorkspaceTabs` as a prop — the strip never calls
`useRunnerRuns` itself, which would be a second source for a decision already made — and is drawn
only above zero. The workspace tabs are icon-only, so the number does not reach a `.vv-tabs__count`
pill at all: `Tabs` renders that pill for word tabs only, and marks an icon tab with a
`.vv-tabs__dot` while carrying the count in words in the tab's `title` (`Runner (2)`). Anything
reading this strip's count reads the title.

**The panel.** A header carrying `runner.title` and the count, then one `<RunCard defaultOpen />`
per run — `defaultOpen` is the one variance the card offers, and the tab is what wants it: a person
who navigated here has already asked for the runs. Order is live → stale → paused, newest first
inside each: live because something is happening to it, stale because a lapsed heartbeat is the one
state that may want a hand, paused last because a parked run is parked on purpose. Paused runs ARE
counted and ARE listed — that is the whole reason the lane carries them where the statusline drops
them. The count and the panel cannot disagree: both read `count` off the same hook. `EmptyState`
(`runner.empty`) shows only when the count is zero AND `useArcs()`'s own `arcs` array is empty too
— not `arcCount` (§"The arc deck" below) — reachable precisely because the tab is sticky. `ArcGallery`
mounts above the run list in the same scroll when an arc exists (§"The arc deck" below).

**The palette.** `CommandPalette`'s `NAV_TABS` carries a `Go to Runner` row, and the Navigate group
filters that static list through `visibleTabs` — which `ProjectCommandPalette` builds from the same
gate. The row therefore appears exactly when the tab does, and never while the gate is off.

### The arc deck

The runner's second lane, in this same module — a stack of plans walked one card after another,
each card a plan of its own. Field-by-field detail lives with the types (`src/shared/types.ts`
§ ARC DECK, mirrored in `server/shared/types.ts`) and the pure rules (`arcState.ts`); read them
there, not a copy here.

**The gallery.** `ArcGallery.tsx` (`data-arc-gallery="tab|gutter"`) draws one `ArcDeck` per arc,
one under another — each deck a full-width row, since each is itself a horizontal strip — above the
run list in the same scroll — and NOTHING at zero arcs: no empty frame, no heading over nothing. It
has two homes, the run card's two, chosen by its one prop `home`: the Runner tab (`'tab'`, the
default — a centred `max-w-2xl` column with its own inset, as the run list under it) and the chat
gutter's Runner widget (`'gutter'`, mounted by `RunnerWidgetBody` — flush, since the widget card
owns the inset). One gallery, one deck, one set of handles in both. In the gutter every card takes
the strip's whole width (`ArcDeck`'s `cardFillsStrip`) instead of 18rem: the column is 300px at its
floor and 346px at 1920×1080 (a 294px strip, measured 2026-09-22), less than one 18rem card and its
snap gutters, so one whole card is in view and the arrows page it. The "Arcs" heading stays in both
homes. It adds no age rule of its own, so a finished deck leaves on the run list's
own schedule: the server's snapshot drops a complete arc once its `ended_at` is `ENDED_KEEP_S` old
(§"How a run is classified"). The tab is shown while a run OR an arc that is not complete exists —
`arcCount` is `useArcs()`'s unfinished-arc count (§"The Runner tab").

**The header.** The arc's title and its status badge, then — while the arc is not complete — the
arc's ONE model word in the same `RunModelControl` the run card uses (`data-arc-model` on the group,
`data-arc-model-choice` on each option), relayed through `useArcModel` to `POST /arcs/:arc/model`.
The runner records it in `arc.json:model`, mints every later card `start --model <word>`, and re-pins
every minted, unfinished card, so the card walking now follows from its next phase. `ArcCard` carries
no control of its own (operator, 2026-09-22: "an arc plan should have 1 toggle"). Nothing optimistic:
the header redraws from the next `arc_state` frame, and shows `effectiveModelWord(arc.model)` — DeepSeek
for a record with no word, as `arc sync` now writes it. While the arc has NOT STARTED, the header also offers
its Start (`data-arc-start`, `useArcStart` → `POST /arcs/:arc/start`, relaying `arc start` with no
`--now`) and the same `ScheduleControl` the run card uses (`data-arc-schedule`, `data-arc-schedule-set`,
`data-arc-schedule-cancel` → `POST /arcs/:arc/schedule`), with `starts <time>` beside it once
`arc.json:start_at` is set; the watchdog's `due` presses `arc start` then. A refusal — a lint, the switch,
the intent lock, a plan not on disk — is the runner's own sentence in a `warn` toast, shown, never
swallowed. Then the nav row: the arrows and the viewing line.

**The strip.** `ArcDeck.tsx` (`data-arc-deck="<arc>"`, `data-arc-status`) draws every card in ONE
horizontal strip (`data-arc-strip`), in position order from `deckLayers`: the finished cards on the
left, the live card, then the cards still to come — past → present → future, the walk's own order.
Each card carries `data-arc-layer` (`done|top|beneath` — `top` is the live card; nothing is stacked,
the word is the harness's handle); a `done` card wears `opacity-60` — the tone still says `complete`
and the dimness says "behind you", so no sixth colour is invented for it. Every card on the tab is 18rem wide
(never wider than the strip, so a phone shows one card with its neighbours peeking; the gutter's
cards are the strip's own width, per "The gallery") and the row
stretches every card to the tallest, so the strip never jumps as it scrolls. The strip moves three
ways: a swipe or a trackpad through CSS scroll snap (`snap-x snap-mandatory`, each card
`snap-center`; the native scrollbar hidden by the app's `scrollbar-hide`; `overflow-y-hidden`, so
the strip never becomes a vertical scroller that takes the page's wheel), the arrow buttons at both
ends of the nav row (`data-arc-prev` / `data-arc-next`, one card each, disabled at their end), and
Left/Right on the focused strip. The nav row reads "Card N of M · D of M done" — N is the card whose
centre is nearest the strip's centre, or the end card once the strip is scrolled to that end. A
one-card deck shows no arrows. **The scroll-into-view rule** (`hooks/useDeckStrip.ts`): the live card
— the last card once every card is complete — is centred on mount (instant) and again whenever the
runner moves `arc.current` (smooth, so a hand-over is seen to happen); a poll that changes nothing
else never moves the strip, a strip mounted while its tab is hidden is centred the moment it gets a
width, and a width change keeps the card the reader was on centred. Centring scrolls the strip only,
never the page.

**The face.** `ArcCard.tsx` (`data-arc-card="<position>"`, `data-arc-card-state`) draws the card's
number, title, state badge, charter and phases: the number is a `Chip` (`runner.arcCard`,
`Card {{n}}`), the title sits in `[data-arc-card-title]`, the badge is toned by `cardTone`, and the
charter is clamped to two lines. BESIDE THE BADGE a card with a shipped or ⛔ phase AND a phase still
unshipped draws its count over the very rows beneath it — `10 of 18 · 8 blocked`
(`data-arc-card-phases`, `runner.arcPhaseCount` · `runner.arcBlockedPhases`; the `blocked` half only
while a ⛔ stands). No count line for a card nothing has happened to (`queued`, `unminted`), a card
whose every phase shipped, or a card with no phases. Under the charter,
`ArcPhaseList.tsx` draws one compact row per phase
(`data-arc-phase="<id>"`, `data-arc-phase-state`): the run card's own mark (`PHASE_GLYPH` — ✅ shipped,
⛔ blocked, `·` still to come), the phase id and its title, with the state's word for a screen reader. The list
comes from the RECORD: the runner writes each card's `phases` (`[{id, title, shipped, blocked}]`) into
`arc.json` on every sync (`hooks/plan_runner/arc_phases.py` — the list and verdicts from
`plan_census.phase_census`, the titles from `plan_v2.phase_headings` or, for a phase with no H2
heading, the census mention's own line; a hand-written ship stamp is cut off a title; `blocked` is
set for a phase the ship log's LATEST entry for it holds ⛔), and `readCard` copies it
through, so a plan that lands, or a phase that ships or blocks, reaches the deck within one watchdog tick. A
`walking`/`paused` card with its run on the lane draws its LIVE run's phases instead, which carry the
real state, so the card that has a run never shows two answers — until that run has composed any
phases, when the record's list stands in. A plan not written yet (`[]`) draws
one muted line, `runner.arcNoPhases` (`data-arc-no-phases`). Past eight rows the rest folds behind a
`Collapsible` "+N more", so a long plan does not tower over its neighbours. It is not `PhaseRow`:
that row discloses a run's timeline, which a card without a run does not have. A `walking` or
`paused` card adds its own run strip below (§"The run strip").

**The feed.** `ArcFeed.tsx` is `RunnerFeed`'s twin and the only place in the client that names the
`arc_state` frame. `App` mounts it nested directly inside `RunnerFeed` — never beside it — because
the deck reads the runner's own state directory rather than owning one of its own. It republishes
`ARC_ALL_TOPIC` (`arc:*`) whole on every frame, with no per-arc topic and no retirement list: the
deck is one gallery, and the server dropping a finished arc from the array IS the retirement — the
next reading is simply shorter. Seed and reconnect follow `RunnerFeed`'s own rule: a REST seed
(`api.planRunner.arcs()`) fires on mount and on every `websocket_reconnected`, and never overwrites a
reading newer than itself.

**The hook.** `useArcs()` reads `ARC_ALL_TOPIC` off the bus — never the socket or the API — and
answers `{arcs, count}`. `count` is arcs whose `status !== 'complete'`, the number the tab gate above
reads as `arcCount`; a finished arc keeps its place in `arcs` until the server drops it from the
frame. `test_arc` arcs are filtered through the same `cloudcli:show-test-runs` `localStorage` switch
`useRunnerRuns` reads, copied rather than imported so the two hooks stay independent readings of one
convention.

**The pure rules**, `arcState.ts`, no React in it. `deckLayers(arc)` answers every card in position
order with its layer: `done` (complete), `top` (the card at `arc.current`; none once every card is
complete) or `beneath` (every other card — still to come, since `current` is the first non-complete
position). `cardDraggable(arc, card)` is true only for a
`queued` or `unminted` card past `arc.last_started`. `reorderAllowed(arc, from, to)` asks that same
line of BOTH ends of a move, plus the deck's bounds and `from !== to` — what keeps the deck from
offering a drop the runner's own `arcs.reorder` would only refuse (§"The drag" below).
`cardTone(state)` maps a card's state to a `Badge` tone and is never `danger`: a `stalled` card is
one the runner presses again the moment its spec moves, not a fault. `arcProgress(arc)`
counts complete CARDS against the total — not
`useArcs()`'s `count`, which is unfinished ARCS across the whole deck. `current` and `last_started`
are always read off the snapshot, never recomputed from the card states — the runner's own
decisions, and a card walked out of order (`--now`) would disagree with a client that tried to
guess them.

**The stalled card.** A run never parks on a ⛔ (runner ruling 2026-09-11): it walks past it and ends
`blocked` (or `all-blocked`) with the phase in its `blocked` map. `arcs.card_state` calls a card `complete` only when
`arc_stalled.landed(receipt)` — `status == "complete"` with empty `blocked` and `skipped_unchanged`;
any other card whose newest run has a receipt is `stalled`. The runner writes `run_status` on the entry (the receipt's word
plus what it left: `blocked — 8 blocked`); the server copies it and the face draws the count
(§"The face").

`stalled` is not a resting state: the arc's tick presses the card again the moment the plan's SPEC
moves, once per spec change (the card's `repress_key` in `arc.json`), and the arc never advances past
an unfinished card. The key is the plan's spec and nothing else — never the heal queue (runner ruling
2026-09-24: "runs should only report what to heal, never wait on a heal"); the operator's Start on the
card is the other door. It is read over the phases the card still OWES — the plan's unshipped ones,
not the receipt's books alone, since a run can end non-`complete` with empty books (`unreadable`,
`flag-off`, `rate-limited`) — and it moves when:

- an owed phase's `spec_sha` moved
- a plan the runner names no phase in: its bytes changed

The tick's line for a held card REPORTS: `stalled <n> — <k> phases to heal, items filed: <m>`.

The deck draws; the runner presses.

**The run strip.** `ArcCard`'s live card, while `walking` or `paused`, joins the lane by `run_id` —
never by plan path, since a plan can have been walked more than once — and, when found, draws the
same `PipelineStrip` and `PhaseRow` `RunCard` draws (§"The runner card" above), filtered to the
card's own current phase. A card whose run is not on the lane draws no strip at all; one whose run
has ended or is still queued draws the strip muted — no active stage, no clock — exactly as
`RunCard` does. `data-arc-card-run` on the wrapping node names the run the strip was drawn from,
the harness's handle for proving the join.

**The drag.** A card's `draggable` handler puts three things on the `DataTransfer`: the dragged
card's position as a decimal string under `ARC_CARD_DRAG_TYPE` (`application/x-cloudcli-arc-card`,
`arcState.ts`), the `<arc>:<position>` copy under `text/plain`, and a per-arc SCOPE type
(`ARC_CARD_DRAG_TYPE + '/' + hex(arc) + ':' + position`) a `dragover` reads to tell one deck's cards
from another's without ever reading a value — `dragover` fires before the drop and Chromium keeps a
drag's values hidden until then. The contract is spelled out beside `dragScopePosition` in
`ArcCard.tsx`, the function `ArcDeck.tsx` calls to read it; read it there, not a copy here.

**The drop.** Only a card not yet started and past the runner's own `last_started` can be picked up
(`cardDraggable`, §"The pure rules") — a card that cannot move is not `draggable` and promises
nothing — and a drop lands only inside the one deck the drag names, at a position `reorderAllowed`
allows. A drop calls `api.planRunner.arcReorder` and changes NOTHING locally: the arc file is the
truth, and the deck redraws from the next `arc_state` frame — at most one poll away — in the order
the runner just wrote. A refused reorder is logged with the runner's own sentence and changes nothing
either.

**The copy** lives under `runner.*` in `src/modules/i18n/locales/en/common.json`: `arcs`, `arcCards`,
`arcCard`, `arcWalking`, `arcStalled`, `arcComplete`, `arcNotStarted`, `arcQueued`, `arcPaused`,
`arcDragHint`, `arcViewing`, `arcPrevious`, `arcNextCard`, `arcStrip`, `arcNoPhases`,
`arcPhaseCount`, `arcBlockedPhases`, `arcMorePhases`, `arcFewerPhases` — English only, the runner
card's own fallback rule (§"The runner card" above).

**The API.** `api.planRunner.arcs()` (`GET /api/plan-runner/arcs`) and
`api.planRunner.arcReorder(arc, from, to)` (`POST /api/plan-runner/arcs/:arc/reorder`) are read from
the RAW response, like the two run verbs above: a 409 carries the runner's own refusal sentence
whole.

## Proving it

`node .verify/phase-23.mjs`, fetch- and socket-driven against the running dev server — no browser;
see [docs/MANUAL.md (verification)](MANUAL.md). Twelve gates: the mount's auth on a read and a write, the
live list, a fixture run carried whole and addressable, a stage change arriving unasked on an open
socket, paused beating stale, a lapsed heartbeat, the runner's own refusal as a 409 with no stack, a
malformed id refused at the route, an unknown id answered in the runner's words, a receipt taking a
run off the lane, and nothing left behind.

`node .verify/phase-27.mjs` proves the ended card in Chromium: a receipted fixture stays listed as
ENDED with its outcome word and its count, Stop gone and Dismiss offered; a `budget` ending in the
warn tone with Resume beside Dismiss; Dismiss taking the card and the count and HOLDING across a
reload, because the dismissal rides the synced preferences; a receipt a day old not listed at all; a
live fixture untouched by any of it. See [docs/MANUAL.md (verification)](MANUAL.md).

`node .verify/phase-24.mjs` proves the client half in Chromium, reading the far end of the chain:
a stage written to disk arriving inside a sandboxed widget's own callback, through the feed, the
bus and the widget bridge. Eleven gates; see [docs/MANUAL.md (verification)](MANUAL.md).

`node .verify/phase-25.mjs` proves the ruling in Chromium, at 390px, and it proves an absence the
only way an absence can be proved: a real fixture run is put on the lane and the server is watched
until it lists it, and only THEN is the chat view read — held open for five seconds, because the
frame travels on the watcher's own 2 s poll and a single early sample would find an empty view and
call it a ruling upheld. No card, no pinned band, and nothing carrying the fixture's id anywhere in
chat; the transcript measured filling its root exactly, with nothing above it but the CLI-version
banner. Seven gates and one shot; see [docs/MANUAL.md (verification)](MANUAL.md). The card's own visual gates
belong to the surface that renders it — the Runner tab, and `phase-26.mjs`.

`node .verify/phase-26.mjs` proves the tab itself in Chromium. ABSENCE IS A `[NOTE]` THERE, NEVER A
GATE: the program executing this plan is a plan-runner run, so the lane is never empty on this host
and the tab is already on the bar before the fixture is written. NO GATE THERE IS WRITTEN AGAINST
THE LANE'S ABSOLUTE TOTAL either, for the same reason turned around — the operator's own runs come
and go inside the probe's window. The fixture's arrival is the one count delta; every other reading
about it is scoped to its own card by `data-run-id`; and a gate that must know whether anything is
running reads the lane over the API rather than the tab's count. Seventeen gates and three shots;
see [docs/MANUAL.md (verification)](MANUAL.md).

The operator's own runs are read by every gate and NEVER named in a request — the plan being
executed while the probe runs is one of them, and a verb sent to it would stop the run that is
running the probe.

The arc deck's own three probes, each printing exactly one final line:

- `node .verify/probe-arc-deck.mjs` → `ARC DECK PASS walks=4 gutter=2 reorder=ok shots=6` — the strip at a
  desktop and a phone viewport, light and dark: position order, layers, the live card scrolled into
  view, one right-arrow step, each card's phase rows (one list folded past eight; card 2's ten shipped
  and eight ⛔), the stalled card's `stalled` badge beside `10 of 18 · 8 blocked` and the landed card's
  missing count line, one height, no vertical scroll in the strip (a wheel over it moves the page),
  the same deck in the chat gutter's Runner widget in both themes, and a drag of card 4 onto card 3
  written into the arc file by the runner. Its six shots land in `.verify/artifacts/`.
- `node .verify/probe-arc-fill.mjs` → `ARC FILL PASS deck=fixture-arc reorder=ok shots=2` — a drop
  reordering a fixture deck through the runner.
- `bash ~/.claude/scripts/runner_fixtures/arc_proof.sh` → `ARC PROOF PASS cards=2/2
  receipt=complete handover=<s>s pressed-by=<landing-door|watchdog> shots=2` — the live two-card arc
  under the real runner, driving `probe-arc-stack.mjs`.
