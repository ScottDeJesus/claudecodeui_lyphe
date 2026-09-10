# The plan-runner lane

Four routes under `/api/plan-runner`, behind `authenticateToken` in `server/index.ts`, wired in
`plan-runner.module.ts`, plus one websocket frame — `kind: 'runner_state'` — pushed to every open
`/ws` socket whenever the picture changes.

The plan runner is a separate program. It writes `~/.claude/state/runner/<run_id>/` and it may be
executing right now; this lane only ever READS those files and shells out to the runner's own two
verbs. Nothing here writes a state file, takes a lock, signals a process or starts a run — a second
writer would race the runner's own atomic rewrite, and starting a run needs a plan and an intent
lock, which is `/execute`'s act and not a button's.

## What the runner writes, and where

The root is `$PLAN_RUNNER_STATE_DIR` when set, else `~/.claude/state/runner` — the same name
`scripts/runner_statusline.py:98-118` reads, so pointing one at a hermetic tree moves the terminal
bar and this lane together. It moves READERS only — the runner itself honours no such variable and
writes where it writes, and the lock store does not move with the env either (see §"The liveness
beat"). `locks/` is that store under the default root and is skipped when listing runs; anything that
is not a directory is skipped. Four files per run are this lane's:

| File | What it is |
|---|---|
| `progress.json` | The whole picture: position, phases, spend, and the composed ◆ line. REPLACED whole through `atomic_write` (`hooks/plan_runner/state_lock.py:72-90`, a per-write `mkstemp` scratch plus `os.replace`), called at `progress.py:151`, so a read caught mid-write is a decode error on the old bytes or a clean read of the new ones — never half a record. |
| `run.json` | The run's own state. This lane reads exactly one field: `stopped_at`. |
| `receipt.json` | Its PRESENCE is the whole signal: the run is over. A resume renames it, so a continued run returns. |
| `runner.log` | One appended line per stage change, in the ◆ shape with a local ISO timestamp in front. |

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
4. `run.json.stopped_at` is non-null → **`paused`**.
5. `now − beat ≥ 900` (`STALE_AFTER_S`, the statusline's own number at
   `runner_statusline.py:25`) → **`stale`**. Which `beat` — see below.
6. Otherwise → **`live`**.

**Paused wins over stale**, and rule 4 is the ONE deliberate difference from the statusline. Its
`read_run` returns `None` for a parked run, because the bar is for what is moving; this lane carries
it so the tab can list it and offer Resume. A run parked for a day has a lapsed heartbeat by
definition, and reading that as stale would offer the operator a recovery for a state they chose. Do
not "fix" the lane to match the bar.

### The liveness beat

Rule 5 is **not** aged against `progress.json.heartbeat_at`, and this is the second deliberate
divergence from the terminal bar. That field is set to "now" at `hooks/plan_runner/progress.py:185`,
inside `_assemble`, which is reached only through `write` (`:139`, whose contract at `:141` is
"Called after every stage change") and written at `:151` — so it advances on a stage change and at no
other moment. A healthy phase spending twenty minutes in one fix-pass therefore carries a
twenty-minute-old progress heartbeat and reads *stale* while it is working. Measured on this host
while this very lane was being built: 96 s of progress age against 6 s of lock age, on a phase whose
own budget is 5400 s.

The beat is the **lock**, `~/.claude/state/runner/locks/<sha256(realpath(plan_path))[:16]>.json`,
whose `heartbeat_at` a daemon thread rewrites every 30 s for as long as it lives
(`state_lock.py:239-250`, `HEARTBEAT_S = 30`) regardless of what any phase is doing. `follow` reads
liveness the same way (`cmd/observe.py:140-141`).

That path is **absolute and not `<state dir>/locks/`**, which is a distinction worth keeping
straight because the two coincide in the default configuration and diverge in the one that matters.
`state_lock.py:36-37` expands `~/.claude/state/runner` at import and joins `locks` onto it, and
nothing under `hooks/plan_runner/` reads `PLAN_RUNNER_STATE_DIR` — `runner_statusline.py:101` is the
only reader of that variable in the whole runner, and it moves the *run directories* alone. So
setting the env moves where runs are read from and leaves locks exactly where they were. This lane
mirrors that split rather than assuming symmetry: `PLAN_RUNNER_STATE_DIR` moves its scan, and the
lock directory is a fixed constant (`runner-state.transport.ts`, `LOCK_DIR`). Deriving the lock path
from the state root instead makes every lock lookup miss under a moved env, drops every run to the
progress-file fallback, and reads every healthy long phase as *stale* — silently, and only under the
configuration meant to be the safe one.

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
it carries no zone, so re-parsing it into an epoch would invent an offset.

**Every timestamp inside a snapshot is epoch SECONDS**, because that is what the runner's Python
wrote with `time.time()`. Only the frame's own `at` is milliseconds. Read one as the other and every
run on the host renders live, forever.

## The snapshot shape

`RunnerRunSnapshot`, `RunnerPosition`, `RunnerPhaseRow`, `RunnerTimelineEntry`, `RunnerRunState`,
`RunnerPhaseState`, `RunnerStateEvent`, `RunnerVerb` and `RunnerVerbResult` are declared in
`server/shared/types.ts` § PLAN RUNNER CONTRACTS, documented field by field against the runner file
each one is read from. Read them there, not a copy here.

## The four routes

| Route | Answers |
|---|---|
| `GET /api/plan-runner/runs` | 200 `{runs, at}` — the watcher's last reading, never a fresh scan. |
| `GET /api/plan-runner/runs/:id` | 200 `{run}`, or 404 `{error:'no such run'}`. A malformed id gets the same answer an unknown one gets, and gets it without a lookup. |
| `POST /api/plan-runner/runs/:id/stop` | The verb relay below. |
| `POST /api/plan-runner/runs/:id/resume` | The same. |

The routes validate and translate and do nothing else: no file is read in a handler, no process is
started in one, and no route names a path from the request. The state directory and the runner
binary are the module's, fixed at composition; a request can only ever choose a run id.

## The verb relay

`:id` must match `/^[A-Za-z0-9._-]{1,120}$/` or the answer is 400 `{error:'run id is required'}` —
refused at the route, before anything is spawned. Then the runner is run as an argv array,
`execFile(bin, [verb, runId])`: no shell parses any of it, so an id carrying a space or a semicolon
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
`pauseRun` / `unpauseRun` set and clear `run.json.stopped_at`, `staleRun` ages the heartbeat past
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
[architecture/01-websocket-transport.md](architecture/01-websocket-transport.md) stay honest.

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
[architecture/07-live-widgets.md](architecture/07-live-widgets.md). This lane is simply its first
publisher; a second (git delegation, Task Master) arrives as a sibling `*Feed.tsx` in its own
module and never as a line inside `live-bus/`.

### The runner card

`RunCard` is the lane's first screen: one plan-runner run, whole. Its ONE home is the Runner tab
(`RunnerPanel`), and it renders nowhere else — never over the chat transcript.

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
newest STALE one, else none; a PAUSED run is never it. A parked run is not in motion — the operator
stopped it — and raising it to the front every time they open the app would be the app arguing with
a decision they made; it stays in `runs`, counts toward `others`, and the tab lists it with a
Resume. A stale run DOES come first, because a lapsed heartbeat is exactly the thing worth a glance.
The tab's own order follows from the same rule: live, then stale, then paused, newest first inside
each.

**What it composes.** `RunCard` pulls the library together and declares nothing of its own:
`Card` / `CardHeader` / `CardTitle` / `CardContent` / `CardFooter` for the shell, `Badge` for the
run and phase states, `Meter` for shipped-of-total with spawns and spend beneath it, `Chip` +
`Shimmer` for the stage strip (`PipelineStrip`), `Collapsible` + `CollapsibleTrigger` +
`CollapsibleContent` twice — once around the phase list, once inside each `PhaseRow` around its
timeline — and `Button` for the one verb. Every string reaches the DOM as a text node: a plan
title, a phase title, a stage word and the runner's own stderr are all free text written by a
program this app does not control, so none of it is ever handed to a raw-HTML sink or rendered as
markdown.

**Colour, and the word beside it.** `runState.ts` holds the whole map, and it is pure: `live` →
`positive`, `paused` → `neutral`, `stale` → `warn`; `shipped` → `positive`, `running` → `info`,
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
status — `running`, `complete`, `all-blocked`, `budget`, `halted`, `dry-run` — whenever no phase
holds a stage, which is every start-up and every gap between phases. That word is drawn after the
chain behind a `·` separator rather than dropped (which would blank the card's one "what is
happening now" signal) or appended to the chain (which would claim it is a link in it).

A blocked phase is marked on the SURFACE, not only inside the disclosure: a card may be handed
`defaultOpen={false}`, so a `⛔ blocked` badge sits beside the phase count next to the meter's
amber. Colour never travels alone (design doctrine `:147-149`), and the phase rows underneath carry
their own glyph and word as well.

**Elapsed ticks locally, and is spelled in the app's own words.** `useElapsed` runs one interval
per hook instance and none at all for `null`, so a five-phase card holds two timers — its header,
and the single phase actually running. It counts from `started_at` and `stage_since`, never from
`heartbeat_at`, which is a liveness beat rather than a start. The words come from
`claudeStatus.elapsed.seconds` / `minutesSeconds` / `hoursMinutes` in the `chat` namespace — the
same three keys the composer's own clock reads (`src/modules/chat/composer/ActivityIndicator.tsx`).
There is no private formatter here on purpose: two clocks in one app spell elapsed one way, from
one key block, and a hardcoded spelling would be a second one that drifts and cannot be translated.
`hoursMinutes` is the one this lane added, because a run can last hours and a composer turn cannot.

**The two verbs.** `useRunnerVerbs` calls `api.planRunner.stop` / `resume` and reads the RAW
response, because a 409 carries the runner's verdict in its body. The footer offers exactly one
button, chosen by state rather than by disabling the other: only a LIVE run can be stopped, since
`plan-runner stop` looks for a lock naming the run and a stale run's daemon is gone, so offering
Stop there would be inviting a refusal. A parked or dead run offers Resume. An ENDED run offers
Dismiss — always — and Resume whenever a phase is still blocked or pending, read off the PHASES and
never off the receipt's word: the runner's `complete` means something shipped, not that nothing is
left (`runUnfinished`; 14 of 21 `complete` receipts on this host carried blocked phases). Its badge
carries the outcome word (`COMPLETE` in the positive tone only when nothing is left; `INCOMPLETE`,
`HALTED`, `ALL BLOCKED`, `BUDGET`, `FLAG OFF` in warn, never red) and how long ago it ended — re-read
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

Its strings live under `runner.*` in `src/modules/i18n/locales/en/common.json`, English only; every
other locale falls back.

The tab that mounts it is the next section.

### The Runner tab

`RunnerPanel` is where every run on the lane is drawn, and it is `RunCard`'s only caller. It reads
`useRunnerRuns` and nothing else — no fetch on mount, no state of its own — so selecting the tab
paints on the FIRST render with whatever the bus was already holding rather than blanking until the
runner next moves.

**The gate rule is the memory tab's, and the Runner tab is the second tab to take it.**
`useWorkspaceTabGates` computes `shouldShowRunnerTab: runnerCount > 0 || activeTab === 'runner'`
beside the memory line, and that ONE reading is what the three call sites share — `WorkspaceMain`,
`ProjectSidebarRegion` and `ProjectCommandPalette` each pass their own `activeTab` and none of them
recomputes the rule. The tab therefore appears while a run is in motion and is STICKY: it holds
while it is the selected tab even after the last run ends, so a run finishing under someone reading
its phases empties the panel instead of taking the tab out from under them. There is consequently
**no snap-back effect** for it in `WorkspaceMain` — the three effects there belong to the
PREFERENCE-gated tabs, whose gates really can turn off mid-act; a data-gated tab's gate is written
never to. `VALID_TABS` and the `handleSessionSelect` reset in `useProjectsState` both name `runner`,
so a restored `runner` tab lands on the panel rather than an empty pane, and switching session
returns to chat the way it does from memory and tasks.

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
(`runner.empty`) shows at a count of zero, which is reachable precisely because the tab is sticky.

**The palette.** `CommandPalette`'s `NAV_TABS` carries a `Go to Runner` row, and the Navigate group
filters that static list through `visibleTabs` — which `ProjectCommandPalette` builds from the same
gate. The row therefore appears exactly when the tab does, and never while the gate is off.

## Proving it

`node .verify/phase-23.mjs`, fetch- and socket-driven against the running dev server — no browser;
see [verification.md](verification.md). Twelve gates: the mount's auth on a read and a write, the
live list, a fixture run carried whole and addressable, a stage change arriving unasked on an open
socket, paused beating stale, a lapsed heartbeat, the runner's own refusal as a 409 with no stack, a
malformed id refused at the route, an unknown id answered in the runner's words, a receipt taking a
run off the lane, and nothing left behind.

`node .verify/phase-27.mjs` proves the ended card in Chromium: a receipted fixture stays listed as
ENDED with its outcome word and its count, Stop gone and Dismiss offered; a `halted` ending in the
warn tone with Resume beside Dismiss; Dismiss taking the card and the count and HOLDING across a
reload, because the dismissal rides the synced preferences; a receipt a day old not listed at all; a
live fixture untouched by any of it. See [verification.md](verification.md).

`node .verify/phase-24.mjs` proves the client half in Chromium, reading the far end of the chain:
a stage written to disk arriving inside a sandboxed widget's own callback, through the feed, the
bus and the widget bridge. Eleven gates; see [verification.md](verification.md).

`node .verify/phase-25.mjs` proves the ruling in Chromium, at 390px, and it proves an absence the
only way an absence can be proved: a real fixture run is put on the lane and the server is watched
until it lists it, and only THEN is the chat view read — held open for five seconds, because the
frame travels on the watcher's own 2 s poll and a single early sample would find an empty view and
call it a ruling upheld. No card, no pinned band, and nothing carrying the fixture's id anywhere in
chat; the transcript measured filling its root exactly, with nothing above it but the CLI-version
banner. Seven gates and one shot; see [verification.md](verification.md). The card's own visual gates
belong to the surface that renders it — the Runner tab, and `phase-26.mjs`.

`node .verify/phase-26.mjs` proves the tab itself in Chromium. ABSENCE IS A `[NOTE]` THERE, NEVER A
GATE: the program executing this plan is a plan-runner run, so the lane is never empty on this host
and the tab is already on the bar before the fixture is written. NO GATE THERE IS WRITTEN AGAINST
THE LANE'S ABSOLUTE TOTAL either, for the same reason turned around — the operator's own runs come
and go inside the probe's window. The fixture's arrival is the one count delta; every other reading
about it is scoped to its own card by `data-run-id`; and a gate that must know whether anything is
running reads the lane over the API rather than the tab's count. Seventeen gates and three shots;
see [verification.md](verification.md).

The operator's own runs are read by every gate and NEVER named in a request — the plan being
executed while the probe runs is one of them, and a verb sent to it would stop the run that is
running the probe.
