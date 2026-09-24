# The launcher-souls lane

Two routes under `/api/dispatch-souls`, behind `authenticateToken` in `server/index.ts`, wired in
`dispatch-souls.module.ts`, plus one websocket frame — `kind: 'soul_launch_state'` — pushed to every
open `/ws` socket whenever the picture changes. The seed route (`/launches`) and the frame carry the
lane's own liveness picture; the second route (`/launches/:launchId/transcript`) is a sibling read
with nothing to do with polling — see §"The routes and the frame" below.

What it feeds is a PIN: one row among the chat's pinned subagent rows — drawn in the strip above the
composer when the desktop chat gutters are not showing, and in the gutter's Subagents widget while
they are — for a soul a session started by hand or `/inline`'s chain launched, drawn beside the `Agent`-tool agents already there. The
row itself belongs to the chat module — derived by
`src/modules/chat/hooks/usePinnedSubagentRows.ts` and drawn by
`src/modules/chat/transcript/PinnedSubagents.tsx` (the same row, in the gutter, by
`src/modules/chat/subagents/SubagentWidgetBody.tsx`),
[docs/architecture/MANUAL.md (06-tool-view)](docs/architecture/MANUAL.md (06-tool-view)) §Subagents; this lane is the half of
the row that knows whether the soul is still alive.

The launcher is a separate program — `~/.claude/hooks/plan_runner/solo/`, reached as
`plan-runner soul` — and it may be forking a child right now. This lane only ever READS
`~/.claude/state/dispatch-souls/`. Nothing here starts a soul, resumes one, signals one, or writes a
byte under that root: a launch needs a brief, a shim and a role gate, which is a conductor's act and
not a button's.

## What a pin is, and why it takes two halves

An `Agent`-tool subagent is a ROW in the transcript, so the pinned rows can read everything about it —
what it was asked, what it has done, what it has spent — from the conversation it is already
rendering. A launcher soul is a DETACHED CHILD. It streams nothing into this transcript, and it
outlives the turn that started it.

So a soul's pin is a JOIN, and neither half can draw it alone:

| Half | Source | Answers |
|---|---|---|
| **Ownership** | the transcript's own tool results | *did THIS conversation start that soul?* |
| **Liveness** | this lane, polling the launch root | *is it still out, and what did it cost?* |

They meet client-side by launch id, in the row hook (`usePinnedSubagentRows.ts`): for every id the transcript anchored, ask
the lane's map (`useSoulLaunches`) whether it carries that launch. **An id the lane does not answer
for draws nothing at all** — which is also what ages a pin out for good, since the lane drops a
launch six hours after it ends while the receipt stays in the transcript forever.

### The ownership test, and why it is a test rather than a search

The receipt is one line the launcher prints, captured as the result of the `Bash` call that started
it:

```
SOUL LAUNCHED launch=<lid> agent=<aid> role=… shim=… provider=… pid=…
```

**RULE: a receipt counts only when the command that produced its result IS the launcher.** A launch
id is a string like any other, and a tool result that dumped another conversation carries that
conversation's receipts — which is exactly what a handoff, a review and a `/resume` do. Measured
2026-09-13: one session anchored seven ids it had never launched, every one traced to a
`python3 - <<'PY'` heredoc printing a sibling session's transcript.

So the test is on the COMMAND, not on the text:

- the row is a `Bash` call, and its result contains the marker;
- the command is split on `&&`, `||`, `;` and newlines, and at least one segment must OPEN with the
  launcher — leading env assignments and a leading path are read as part of the segment they prefix
  (`LAUNCH_SEGMENT`);
- `plan-runner soul ` requires the space: `plan-runner soul-run <id>` is the internal detached half
  and prints no receipt.

Prose, a pasted transcript fence, and a `grep` for the marker all fail that test — and failing it is
safe: an id that is not anchored is merely not pinned, where an id anchored wrongly is a confident
lie on someone else's wall.

**The rule is written twice and must agree**, because the two trees cannot import each other:
`src/modules/chat/utils/soulLaunchAnchors.ts` (the client scan) and
`server/modules/providers/services/session-soul-launches.service.ts` (the server collector). One
regex, one marker constant, one segment rule, in both files. Change one and change the other.

### The stamp: ownership recorded at the door, for a launch the receipt scan cannot see

A launch is now ALSO pinned when its `spec.json`'s `launched_by` equals the chat's own provider
session id, stamped by the launcher itself (`hooks/plan_runner/solo/launch.py`, from
`CLAUDE_CODE_SESSION_ID`) at the moment it mints the launch — never read back from the transcript.
`collectStampedSoulLaunches` (`server/modules/providers/services/session-soul-launches.service.ts`)
walks the newest `dispatch-*` dirs under the launch root, reads each `spec.json`, and keeps the ids
whose `launched_by` matches the session asking; `sessions.service.ts` merges its result into
`soulLaunches` beside `collectSessionSoulLaunches`'s transcript scan on every LATEST page.

This is what makes a **wrapper-script launch** visible: the ownership test above requires a `Bash`
command segment that OPENS with the launcher, so a launch made through a wrapper's own name (the
Bash result carries the wrapper's command, not `plan-runner soul …`) fails that test and is never
anchored by the receipt scan alone — however plainly the receipt itself printed inside the wrapper's
output. The stamp does not read the command at all: it is written by the process that minted the id,
so it holds regardless of how the launcher was invoked, and a transcript that merely quotes an id
cannot forge it.

### Whole history, not the loaded page

A page loads history from the TAIL, twenty rows at a time, and a soul runs for minutes after the row
that started it has scrolled out of the window — which is exactly when it most needs pinning.
Measured 2026-09-13: at the client's real first page, a session with seven live launches anchored
none of them.

Every LATEST page (offset 0) therefore carries `soulLaunches`, collected from the full cached history
by `collectSessionSoulLaunches`, capped at the newest 40 and held per slot by `useSessionStore`
(`getSoulLaunchIds`). `useChatSessionState` merges it with the live scan of the loaded rows
(`mergeSoulLaunchIds`), so a launch appears the second it happens and survives the reload that
follows.

**On `FetchHistoryResult`, `undefined` and `[]` are different facts.** Absent means "not on this
page" — a non-latest page never carries the key — and an empty array means "this history started no
soul". Collapsing them would let an older page wipe the ids a latest page had already established.

## What the lane reads — the launcher's layout is a read contract

One directory per launch under `~/.claude/state/dispatch-souls/<launch id>/`, the launcher's own
shape (`hooks/plan_runner/solo/`). `soul-launch.transport.ts` owns the bytes; nothing in it decides
what a launch MEANS.

| File | What this lane takes from it |
|---|---|
| `spec.json` | `started_at`, `role`, `agent`, `brief_path`, and `provider` — the switch's reading at launch time. **No spec, or no `started_at`, and the directory is not a launch**: it draws nothing rather than a phantom. |
| `result.json` | Its ABSENCE is how "still out" is spelled. Present: `status`, `ended_at`, `duration_s`, `cost_usd`, `tokens`, `cause`, `provider`, `provider_blocked` — and `session_id`, the Claude session the transcript read follows, once the soul has ended. |
| `child.log` | The transcript read ONLY: its first `session_id`, when `result.json` has none yet, is handed to the providers module (`readClaudeTranscriptBySessionId`), which `GET /api/dispatch-souls/launches/:launchId/transcript` serves to the chat's Subagents widget. Nothing else in it is parsed. |
| `launcher.pid` / `child.pid` | Liveness, proved through `/proc/<pid>/cmdline` against a needle (`soul-run`, `claude`) — a pid is reused, so the number alone proves nothing. |
| `brief.md` (via `spec.json`'s `brief_path`) | ONE line: the task, for the pin's second row. |

**RULE: these are a contract the launcher does not know it has.** The receipt's wording, `result.json`'s
`provider` and `status`, `spec.json`'s `provider`, and the directory layout are all read from here,
by a program in another repository, on a two-second poll. Reword the receipt line and every soul
unpins; rename a field and the pin paints the wrong vendor. The estate carries the same rule from
its own side: INV-36, surfaced in MAN-838.

**Every timestamp in a launch directory is epoch SECONDS**, because the launcher's Python wrote them
with `time.time()`. Only the frame's own `at` is milliseconds. Read one as the other and every launch
on the host renders as having started in 1970.

Reads are best-effort and never throw: a directory being written while it is read is a normal event
on a live state root, and one torn read must never cost the lane its other launches. A launch that
cannot be read at all is reported once per distinct message and omitted — never silently dropped,
since a launch missing from both the list and the frame is indistinguishable from one that never
existed.

### The brief's first line is not its first line

A conductor's brief opens with a STACK of banner blocks — the estate's constraints, then the repo's
guidance, then the project's context — each a line ending in a colon with bulleted items under it.
`readBriefLine` walks past every such block and takes the first line that is not one, or the
document's own first heading when the brief is nothing but banners. Without the walk the pin reads
`CloudCLI repository guidance (…, verbatim)` where the task should be.

Four kilobytes is read for that one line. When those four kilobytes are ALL preamble the head is
re-read at sixteen — the only path here that reads twice, and it exists because one of four real
briefs put its task line 232 bytes past the smaller cap.

## How a launch is classified

`soul-launch.service.ts`, given the bytes and a clock. It touches no socket, no request and no
process, which is what lets the whole classification be proven against a fixture tree with no soul
in existence.

| `state` | When |
|---|---|
| `running` | no receipt, and either the wrapper or the child is still alive in `/proc` |
| `completed` | receipt with `status: done` |
| `stopped` | receipt with `idle`, `timeout` or `orphan` — a CAP, not a fault, painted the same amber the pinned agents give the reader's own Stop |
| `failed` | every other receipt word (`crash`, `api_error`, `incomplete`, **or one this lane does not recognise**), and the no-receipt case where both processes are gone |

An unrecognised status reads as `failed` deliberately: it is not `done`, and saying "finished" about
a launch nobody can classify is the one answer that could mislead. The no-receipt-both-dead case is
short-lived by design — the launcher's next sweep writes a stub receipt — but it must not read as
`running` in the meantime: a pinned row that never finishes is worse than one that says it died.

### Which provider the pin paints

**The receipt outranks the launch-time pin wherever it speaks.** `spec.json` records what the switch
settled at launch; `result.json` records the endpoint the child actually ran on. The two disagree
exactly when a DeepSeek key is refused mid-flight and the launcher sends the soul back to Claude so
the run finishes.

*Wherever it speaks* is the load-bearing half. `result.json` is written by paths that never ran a
child to an endpoint — the crash stub the launcher leaves when a wrapper is killed, and the reaper's
stub — and both carry `status` and no `provider` at all. Reading those as Claude painted six real
crashes with the Claude mark while their own `launch.out` said `provider=deepseek` and their
`child.log` was full of `deepseek-flash` models (measured 2026-09-13, 7 of 49 launch directories). So
a stub with no provider says nothing, and the row falls back to the launch-time pin, which the
launcher always wrote before the fork.

`blocked` — the row's `DeepSeek refused this soul — it finished on Claude` note — takes EITHER
witness: `result.json`'s `provider_blocked` once there is a receipt, or the fallback child's own log
file while the soul is still out. Neither is sufficient alone; without the log a live fallback paints
a healthy DeepSeek pin for hours.

This is the third surface on this box where a reader meets DeepSeek, and the only one that spends no
key: the switch's controls write the flag ([docs/MANUAL.md (plan-runner)](MANUAL.md) §"The DeepSeek switch"),
the account readout asks the vendor ([docs/MANUAL.md (deepseek-balance)](MANUAL.md)), and the pin simply
paints the mark of the endpoint that was billed.

## The windows

Four, and they are not the same clock:

| Window | Where | What it bounds |
|---|---|---|
| **6 h** | `LAUNCH_KEEP_S` (`dispatch-souls.module.ts`) | how long an ENDED launch stays on the lane after its receipt — measured from its own end, or from its start when it died without one |
| **2 h** | `FINISHED_SHOWN_FOR_MS` (`usePinnedSubagentRows.ts`) | how long a finished row stays offered for dismissal |
| **4 h** | `RUNNING_BELIEVED_FOR_MS` | how long an AGENT's stored `running` flag is believed. **Not a soul's**: a soul's `running` is a `/proc` reading the server took two seconds ago, so a soul that is out is simply out |
| **14 d** | the launcher's `KEEP_DAYS` | how long the launch DIRECTORY survives. The lane is a pin list, not an archive — it deliberately shows a fraction of what is on disk |

**RULE: the launcher's per-child kill cap must stay BELOW the 6 h lane window.** The cap is one hour
(`solo/record.py`, `HOUR_S`); the window is six. `listLaunchDirs` ages a directory out by its own
`mtime` BEFORE opening a file in it, and that stamp is frozen at the launch's start for as long as it
runs — writing a file does not touch its parent's mtime, only creating or renaming one there does.
Raise the cap past the window and a soul still out is dropped from the lane mid-run, taking its pin
with it.

Dismissals are the reader's own act and outlive all of it: one `localStorage` list for BOTH kinds of
pin, capped at 500 ids (`src/modules/chat/utils/pinnedDismissals.ts`). A pin's id is unique on its
own — an `Agent` tool id or a launch id — and the reader's act is the same either way, so a second
store would only be a second thing to remember to write. The list is read through a module-scope
store (`useDismissedPins()`, `dismissPin()`) rather than a per-component `useState`, so a dismissal
made in one copy of the rows reaches every other copy — the strip and, once it claims them, the
gutter's Subagents widget — in the same frame; a `storage` listener folds in another tab's
dismissal too.

## The routes and the frame

| Route | Answers |
|---|---|
| `GET /api/dispatch-souls/launches` | 200 `{launches, at}` — the lane's LAST reading, never a fresh scan. The poll already owns the disk. |
| `GET /api/dispatch-souls/launches/:launchId/transcript` | 200 `SubagentTranscriptResult` raw, for the Subagents widget's transcript view. Same shape and same never-an-error rule as the providers transcript route; the launch id is validated in the route before the service joins it under the module's fixed state directory. A launch id that is not a plain name is 400. |

The frame is `{ kind: 'soul_launch_state', launches, at }`, declared in `server/shared/types.ts`
(`SoulLaunchSnapshot`, `SoulLaunchStateEvent`) and documented field by field where it is declared —
read it there, not a copy here. `launches` is ordered by `started_at` ascending; the directory
listing is sorted by name underneath, and the launcher mints `<stem>-<YYYYmmdd-HHMMSS>-<hex>`, so two
launches of the same second keep a stable order rather than swapping places between ticks and
announcing a change that is not one.

It goes out over `connectedClients` — every open `/ws` socket — and not the raw `wss.clients` set,
which would also deliver it to `/shell`, `/plugin-ws` and `/desktop-notifications`, where it would be
parsed and dropped, and on `/plugin-ws` handed to third-party plugin frontends that have no business
seeing it. `useChatRealtimeHandlers` carries `case 'soul_launch_state': return;` in the shared
box-wide `case` group beside `runner_state`, `universe_map` and `universe_activity`
(MAN-315), and it must RETURN
rather than break: without the case the frame falls through the switch's `default`, inherits the
viewed session's id, and is appended to the open transcript as a message row.

## The mechanism it shares with the plan runner, the arc deck and a board's Metis

The poll itself is not this lane's. `server/shared/polled-lane.service.ts` (`createPolledLane`) is
the read-picture / compare / broadcast-on-change loop that every state lane on this server runs:
this one, the plan runner's (`plan-runner/runner-watcher.service.ts`, now a thin adapter that
supplies its own `snapshot` and `frame` and nothing else), the arc deck's
(`plan-runner/arc-lane.ts`, the `arc_state` frame, over the same broadcast closure the run lane
uses), and a board's own Metis sessions (`kanban-metis/kanban-metis.module.ts`, the
`kanban_metis_state` frame). Why it polls rather than watches, when it speaks, why the dedup records
a picture as sent only AFTER the send returns, and why a failing tick never takes the interval down
with it are documented once, there.

What is THIS lane's and not the mechanism's: the launch root (`DISPATCH_SOULS_STATE_DIR`, defaulting
to `~/.claude/state/dispatch-souls`), the two-second cadence, the six-hour window, and the frame.
The env var is a seam for pointing a probe at a hermetic tree — **it moves this READER only**. A
dispatch still writes to the real root, because that is the launcher's and not something a server
env var may reach. It is read once, at composition, so moving it means restarting the server.

## The client

| Piece | What it is |
|---|---|
| `src/modules/dispatch-souls/SoulLaunchFeed.tsx` | The lane's one door into the live bus, and the ONLY place in the client that names the `soul_launch_state` frame. Headless: it renders its children unchanged. `App` mounts it inside `LiveBusProvider`, inside the auth gate, below `WebSocketProvider` — nested inside `RunnerFeed`, because a feed is a wrapper and not a sibling. |
| `hooks/useSoulLaunches.ts` | The read side: the retained `souls:*` topic as a `Map` keyed by launch id. A map rather than the array because the reader asks one lookup per anchored id. `undefined` (nothing retained) and `[]` (the lane is empty) collapse to an empty map — to a screen they are the same instruction. |
| `src/modules/chat/transcript/SoulLaunchPinRow.tsx` | One soul's row, drawn to be indistinguishable in SHAPE from the agent rows beside it. Its mark is `LLMProviderLogo` on the launch's provider — the DeepSeek whale, or Claude's mascot — centred beside its two lines, as an `Agent` subagent's row carries its own provider's mark. The row is also a button: an `onOpen` prop, given by both the strip (in a dialog) and the gutter's Subagents widget (in place), opens this soul's transcript live through the second route above ([docs/architecture/MANUAL.md (06-tool-view)](docs/architecture/MANUAL.md (06-tool-view)) §Subagents). |

The row lives in the CHAT module, not in `dispatch-souls/`: the pinned rows it lands among are the chat's, and
a lane must not reach back into it.

`useElapsed` is shared, at `src/shared/hooks/useElapsed.ts` — the runner card and this pin are its two
consumers, and it moved out of `plan-runner/hooks/` when the second one arrived. It holds NO interval
for a `null` start, so a strip of a dozen ended souls costs nothing per second.

The `souls:*` topic is declared in `src/modules/live-bus/topics.ts` (`SOULS_ALL_TOPIC`). There is no
per-launch topic: the only reader wants the whole picture, and a topic nothing subscribes to has no
way to tell it has gone stale.

The seed exists for the gap the push cannot cover. The frame is sent only on a CHANGE, so a state
root nothing is moving in would leave a fresh page blank until the next dispatch started; the REST
read fills it, and re-fills it on `websocket_reconnected`, since frames missed during an outage are
never re-sent. A seed never overwrites a reading NEWER than itself — a request in flight while a
frame arrives would otherwise land after it and put the older picture back on screen.

## Known residuals

- **A transcript can still anchor a soul it did not start**, if one chain segment of a `Bash` command
  opens with the launcher AND that same call's result carries someone else's receipt. The test is on
  the command, and a command can both launch and print. The proper cure is on the launcher's side: a
  session field in `spec.json`, so ownership is a fact the launch RECORDS rather than one the reader
  infers.
- **The pinned rows' expiry timer only runs while the tab is awake.** One `setTimeout` is armed for the
  moment the next row crosses its own window; a backgrounded tab is throttled, so a row can outstay
  its two hours until the tab is looked at again. Without the timer at all a finished row sat there
  until an unrelated repaint, up to four hours past its window — this is the smaller of the two.
- **Nothing in `all.mjs` measures the pin.** See [docs/MANUAL.md (verification)](MANUAL.md) §"What bites
  people".

## Proving it

The lane reads a real state root and the pin is a join, so proving it means launching a real soul and
looking at the real client — not asserting the shapes:

1. `cat ~/.claude/state/deepseek_flash.flag` — the whale only appears when the switch sent that soul
   to DeepSeek.
2. From a chat, launch one: `~/.claude/scripts/plan-runner soul --role builder --agent hephaestus
   --brief <file> --cwd <dir>`. It prints the receipt and returns at once.
3. `curl -s -H "Authorization: Bearer <token>" localhost:3011/api/dispatch-souls/launches | jq` —
   the launch must be in `launches` with `state: running` within one poll (2 s).
4. In the app, the chat's pinned rows draw the row — the strip above the composer on a region too
   narrow for the gutters, the gutter's Subagents widget on a wide one: the provider mark,
   `<Soul> / <role>`, `running · <elapsed>` ticking, the brief's task line.
   `data-testid="pinned-soul-row"` carries `data-status`, `data-provider` and `data-launch-id`.
5. Reload the tab. The row must still be there — that is the server-side collector, not the scan.
6. When the soul returns, the row flips to `finished <time>` with its cost, and `X` dismisses it for
   good in this browser.

`ls ~/.claude/state/dispatch-souls/<lid>/` is the ground truth behind every one of those readings.

## Cross-references

- [docs/architecture/MANUAL.md (06-tool-view)](docs/architecture/MANUAL.md (06-tool-view)) §Subagents — the pinned rows themselves,
  and the `Agent`-tool pin this one sits beside.
- [docs/architecture/MANUAL.md (01-websocket-transport)](docs/architecture/MANUAL.md (01-websocket-transport)) — the frame tables
  and the broadcaster set.
- [docs/MANUAL.md (plan-runner)](MANUAL.md) — the sibling lane, the shared feed pattern, and the DeepSeek
  switch this lane paints the result of.
- [docs/MANUAL.md (deepseek-balance)](MANUAL.md) — the account those souls spend.
- MAN-838(`soul`) and INV-35, INV-36 — the
  launcher's own side, and the contract this lane binds it to.
- `~/.claude/skills/heal/sections/deepseek.md` (the DeepSeek-door procedure, attached to
  `/heal`'s own `Skill` call by `~/.claude/hooks/skill_router.py` when the switch reads
  `on`) — the door for ONE hand-launched soul.
