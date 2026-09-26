<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-695 — session-host

The Claude turn's CLI kept outside the API's cgroup: a tmux session on the private cloudcli-sessions server, a host process owning the CLI, journalling every line, brokering a unix socket, and re-adopting what survived the API's restart.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/

## MAN-682 — What this does
section: README/000 What this does

By default the Claude Agent SDK spawns the `claude` CLI as a child of the API process, so every
in-flight turn dies with the process that started it — with every `server/` save, since each one
retires that process. This package puts the CLI somewhere else: a
`tmux` session on the private `-L cloudcli-sessions` server (`TMUX_SOCKET_NAME` in `hosts.ts`),
which `cloudcli-sessions-tmux.service` holds up with a do-nothing `_keepalive` session
(`KEEPALIVE_SESSION`). That is a different cgroup from the API's, so `systemctl restart
cloudcli-server-dev` leaves the CLI running. A small **host** process owns the CLI there, journals
every line it writes, and brokers a unix socket to whichever API process is attached at the
moment. On its next boot the API re-adopts what survived.

This directory is the mechanism's one home; every other doc describes what an operator sees and points here.

## MAN-683 — Public surface
section: README/001 Public surface

`index.ts` is the whole public surface; nothing outside this directory imports past it:

| Export | Consumer | What it is |
|---|---|---|
| `armKeepaliveSpawn(sdkOptions, ctx)` | `claude-runtime.provider.js` | Sets `sdkOptions.spawnClaudeCodeProcess` and returns the handle a `result` is acked through, or `null` when the gate is off or the turn has no app session id |
| `keepaliveReadopt(reattach, appSessionId)` | `claude-runtime.provider.js` | The same armed/not-armed answer, asked before `sdkOptions` exists, so the two can never disagree |
| `readoptKeepaliveSessions({ runtime })` | `server/index.ts`, through the providers barrel | The boot step (below) — before `server.listen` on a plain boot, deferred to the supervisor's takeover on a handover boot |
| `retireStaleIdleHosts(hosts, installed)`, `watchInstalledCliVersionChanges()` | `.verify` probes only | The version sweep and its subscription (§"The idle host an install leaves behind"); the boot step calls the subscription itself, and a probe cannot — it never holds the keepalive claim |
| `KeepaliveHandle`, `KeepaliveReattach` | `claude-runtime.provider.js` | The two types those calls traffic in |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts

## MAN-684 — Where things live
section: README/002 Where things live

Under `sessionsDir` — `CLOUDCLI_SESSIONS_DIR`, else `~/.cloudcli/sessions`, created `0700`
(D-1: on disk rather than `/run`'s tmpfs, so a long turn's journal is not held in RAM):

| File | Owner | Life |
|---|---|---|
| `<hostId>.sock` | the host | Unlinked by the host on its way out; a stale one is probed and removed before `listen` |
| `<hostId>.ndjson` | the host | The `out`/`exit` frames verbatim, one per line, `0600` — replay is "stream the file" |
| `<hostId>.json` | the host | The meta below, written by atomic rename |

`hostId` is `<appSessionId>-<Date.now().toString(36)>`, never the bare app session id: a retirement
(a message whose launch argument the running process cannot take) puts two hosts on one session for seconds and `tmux new-session -s <name>` refuses a
duplicate (D-8). The tmux session, the socket, the journal and the meta all carry that id. A
socket path is ~81 bytes here, under the 108-byte limit — a `$HOME` longer than ~40 bytes needs
`CLOUDCLI_SESSIONS_DIR` pointed somewhere shorter.

## MAN-685 — The socket protocol
section: README/003 The socket protocol

Newline-delimited JSON (NDJSON) both ways, one object per line, `t` is the discriminator. One
client at a time: a second connection replaces the first (the newer API wins, the older socket is
ended).

Client → host:

| Frame | Meaning |
|---|---|
| `{"t":"spawn","command","args","cwd","env","appSessionId","userId"}` | First frame on a FRESH host: spawn the CLI with exactly these, write the meta, attach this client from seq 0. `env` is held in memory only — it never reaches the meta or the journal |
| `{"t":"hello","fromSeq":number\|"acked"}` | First frame on a RE-ATTACH: replay journal frames past that cursor, then `live`, then attach |
| `{"t":"stdin","b64":string}` | Bytes for the CLI's stdin, base64 so no frame boundary can split a character. Buffered to complete lines; a trailing partial line waits |
| `{"t":"end_input"}` | `child.stdin.end()` — the only path by which the CLI ever sees end-of-file |
| `{"t":"kill","signal":"SIGTERM"\|"SIGKILL"}` | `child.kill(signal)` |
| `{"t":"note","turnCompleteSent","heldForBackgroundWork"}` | One per `result` the provider has finished handling: shifts `pendingResults` and writes both bits in the same rename. With `"ack":false` — sent when a message joins the running process — it writes the bits and shifts nothing; a host from before the field ignores it, and retires nothing anyway since no result is outstanding then |

Host → client:

| Frame | Meaning |
|---|---|
| `{"t":"out","seq","at","line"}` | One CLI stdout line, journaled; `seq` is 1-based and monotonic per host |
| `{"t":"out","seq":0,…}` | A cached `initialize` response for THIS client; never journaled (seq 0 keeps it out of the cursor's arithmetic) |
| `{"t":"live"}` | Replay finished |
| `{"t":"exit","seq","at","code","signal"}` | The CLI exited; the journal's last line, then the host unlinks its socket and leaves |
| `{"t":"err","message"}` | Protocol error; the host ends that connection |

The CLI's `initialize` control request is answered once and cached: the first such line is
forwarded and its `request_id` remembered, every later one is answered from the cache with the id
rewritten, and one that arrives before the cache is filled is queued rather than forwarded. The
SDK sends that request from its `Query` constructor, so every re-attach sends another — a second
one reaching the CLI would be a second initialization of a session already running.

## MAN-686 — The replay cursor, and the ack that moves it
section: README/004 The replay cursor, and the ack that moves it

`cursorFor` (`host-journal.js`) resolves `"acked"` to
`Math.min(deliveredSeq, pendingResults[0] - 1, pendingControl[0].seq - 1)`, and to plain
`deliveredSeq` when nothing is outstanding. `deliveredSeq` is the last frame written to a client
socket; `pendingResults` holds every delivered `result` seq no `note` has confirmed yet;
`pendingControl` holds every delivered `control_request` — every subtype: a `can_use_tool`
waiting on a person, a `hook_callback`, an `mcp_message` — that is still open. Two things close
one: the API's `control_response` reaching the CLI's stdin (`host-conn.js` reads each stdin line
for exactly that, and releases only a line the CLI actually took), and the CLI's own
`control_cancel_request` on ITS output (it withdraws a request it stopped waiting on — its abort
listener, or after consuming the answer — and `markDelivered` releases on that line).

The hold lives in `host.js` and `host-journal.js`, which are exec'd once per CLI: a host already
running when this ships keeps the cursor it was born with until its CLI exits, and only a host
spawned afterwards carries the rule. Case G's `cursor_held` reads `pendingControl` out of the
live host's own meta, which is the one proof that the running host is a new one.

The reason is asymmetric damage. A re-delivered stream delta is cosmetic — the browser refetches
the transcript over REST anyway — while a LOST `result` wedges the run with no terminal event to
release it. So the ack is sent after the provider has finished handling the result, never at the
head of the loop: an ack that preceded the state flip would confirm a result a SIGKILL then loses.
A graceful restart is therefore exactly-once; a hard kill between delivery and processing is
at-least-once, for the `result` line alone (D-3).

An unanswered `control_request` is the same asymmetry from the other side. The CLI waits on that
request id and on nothing else, and the API that received it holds the only promise that can
answer it; an API retired between the question and the answer — a dev-supervisor handover lands
in under two seconds — leaves the CLI waiting forever, the browser's re-subscribe finds no pending
prompt, and the card falls to its answered-looking summary. So the cursor holds at the oldest
unanswered request until the answer is on stdin, and the successor replays it: the SDK's read loop
handles a `control_request` whenever it arrives, `canUseTool` runs again, and the person is asked
again under a fresh request id. A replay re-delivers the request under its original seq, which is
why the entry is keyed by request id and not duplicated. A `hook_callback` replayed to a `Query`
whose callback ids differ gets the SDK's error response — still a `control_response`, so it
releases the entry rather than pinning the cursor for the life of the host.

The browser's side of the same race: the person may have tapped the dead prompt in the gap, and a
decision for a request no live API holds is a silent no-op on the server (logged, nothing more).
The card that sent it would look answered and refuse the re-issued prompt — so, for the one
purpose of offering a newer request for the same question, the card counts its own answer as
delivered only once the run stream has settled it (`permission_resolved` or
`permission_cancelled`), and while it is unsettled the card lets exactly ONE later request through;
the settlement of that one closes the door (`QuestionAnswerContent.tsx`, `toolOutcome.ts`). The
answer it shows in the meantime is still the one it sent. One window stays: a SIGKILL between the
live API's `permission_resolved` and its `control_response` reaching stdin — microseconds, since
both sit in one microtask chain — settles the id in the tab while the host still holds the
request, and the prompt the successor re-issues then has no surface; only a re-issue tag on the
`permission_request` would close it, and that is in the friction ledger, not here.

The `note` carries both turn-state bits with it, so the ack and the bits land in one atomic
rename (D-4) — a SIGKILL between them cannot leave an acked result beside stale bits. Correlation
is FIFO: the host's `seq` never reaches the provider, so a note can only mean "the oldest unacked
result is done". A note with nothing outstanding warns and retires nothing rather than moving the
cursor silently.

## MAN-687 — The meta file
section: README/005 The meta file

```json
{ "hostId": "…", "appSessionId": "…", "userId": null, "cwd": "…", "startedAt": 0, "pid": 0,
  "turnCompleteSent": false, "heldForBackgroundWork": false, "deferredTools": [], "profile": {},
  "deliveredSeq": 0, "pendingResults": [], "pendingControl": [], "exited": null }
```

`exited` becomes `{code, signal, at}` when the CLI ends. The two bits are the provider's own
(`turnCompleteSent` decides whether the next `result` emits `complete`; `heldForBackgroundWork`
decides whether the CLI is held after it) — persisted rather than re-derived, because re-deriving
them from the journal's content would be a second copy of the loop's result/phantom/background
decisions. A re-adopted run initializes both from here.

`profile` is what the API launched the CLI with, and its `cliVersion` is **null when the meta is
written** — the meta is written at spawn, before the CLI has said anything. What the CLI later said
is in the journal (`system/init`'s `claude_code_version`), and THAT is what a re-adoption reads
(`hosts.ts`'s `lastReportedCliVersion`) and hands the provider as `KeepaliveReattach.cliVersion`.
Two records by two hands on purpose: the meta is the launch, the journal is the answer.

Liveness is always the tmux session, never this file: a meta says what a host believed when it
last wrote, and only `tmux has-session` says whether anything is still running.

## MAN-688 — `apiExiting` — the invariant this package exists for
section: README/006 `apiExiting` — the invariant this package exists for

The SDK registers a global reaper on its first spawn that SIGTERMs every process it spawned when
the API's `process 'exit'` fires. Forwarding that would kill every session on every restart — the
exact defect being cured. So `facade.ts` sets a module-level `apiExiting` from
`process.once('exit')`, `process.on('SIGTERM')` and `process.on('SIGINT')` registered at module
import, strictly before that reaper exists, and while it is set **neither `kill` nor `end_input`
is sent to the host**. It is asked again when a transport attaches late, since the API may have
begun exiting during the connect.

The host's side of the same invariant: a client socket closing is a DETACH, never end-of-file.
Only an explicit `end_input` frame closes the CLI's stdin. A socket that closes with no `exit`
frame while the API is *not* exiting is a real loss, and the facade reports it as
`'exit'(null, 'SIGHUP')`.

## MAN-689 — The fallback
section: README/007 The fallback

`CLOUDCLI_SESSION_KEEPALIVE` (`GATE_ENV`) is read once per boot and is **on unless set to `0`,
`off` or `false`**; flipping that default is the whole feature's reversal. Availability is then
re-asked per spawn — `tmux has-session -t _keepalive` — because the unit can be stopped between
two turns. When the server is down, or the host cannot be reached before the first frame leaves,
the turn falls back to an in-process spawn identical to the SDK's own (`stdio:['pipe','pipe',
'ignore']`, `signal`, `env`, `windowsHide`), logged once per boot as `[keepalive] unavailable (…) —
spawning in-process`. Falling back is allowed only BEFORE the first frame reaches a host; past that
point the host has a CLI, and a second local spawn would put two CLIs on one session.

One asymmetry: a **re-attach** that cannot reach its host does not fall back. It carries no prompt
(the provider empties it), so a local CLI would be asked nothing, never reach a `result`, and
leave the run `running` for ever. That path ends the turn instead and always says so — never
silenced by the once-gate, because it strands a session.

## MAN-690 — Re-adoption, on boot
section: README/008 Re-adoption, on boot

On a plain boot `readoptKeepaliveSessions` runs inside `startServer` *before* `server.listen`,
because `dispatchRun` registers its run synchronously and a browser that subscribes into a registry
which has not re-adopted yet reads a live session as idle (D-11).

On a **handover boot** it is deferred instead. `CLOUDCLI_HANDOVER=1` — set by
`deploy/dev-supervisor` on a child it spawns beside a server that is still serving, and read only
alongside a live IPC channel — holds this pass back until the supervisor's `takeover` message,
which is sent only after the previous API's `exit` event. Re-adopting sooner would take hosts the
predecessor is still serving and end its runs with SIGHUP, which is the failure this order exists
to prevent; the deferred process says so once, with
`[keepalive] re-adoption deferred until the previous server exits (handover boot)`, and
`[keepalive] taking over` when it is released. The listener is up throughout either way, because
the retiring server is still answering `:3011` for the whole window. Why the message can only come
then, and what happens when it never comes, is in
[`deploy/dev-supervisor/README.md`](../../../../../../deploy/dev-supervisor/README.md).

In order, once it runs:

1. `sweepDeadHosts()` — delete all three files of any host whose tmux session is gone. This runs
   even with the gate off; dead files are litter either way.
2. `retireOlderHosts(listLiveHosts())` — newest `startedAt` per app session wins, exactly as the
   provider's supersede branch decides it at run time. The losers get `end_input`, then `SIGTERM`
   after `RETIRE_KILL_DELAY_MS`, over their own socket rather than by signal.
3. `retireStaleIdleHosts(keepers, installed)` — the version test, on the survivors: a host idle
   between turns whose journal reports a build BEHIND the installed one is retired here rather than
   handed back (`idle-version-sweep.ts`, §"The idle host an install leaves behind"). The reading is
   the shared cached one, taken with the send path's 1.5 s bound; `null` retires nothing. The
   process that took the keepalive claim is also the one that subscribes to the next install.
4. Per keeper: no session row left → retire it (nothing to re-adopt into). Otherwise
   `runDetachedChatTurn` with `content: ''` and `options.keepalive = { reattach: true, hostId, …
   }`, not awaited. `beforeRun` completes the registry run at once when `turnCompleteSent` was
   already true, so a finished turn is never observable as `running`.
5. One line: `[keepalive] re-adopted N host(s), swept M dead host file(s)` — `M` is
   `sweepDeadHosts`' litter, never a version sweep; a host retired by the version test above logs its
   own `retiring idle host …` line.

It composes `runDetachedChatTurn` rather than re-implementing `dispatchRun`: the session row
lookup, the busy check and the run-completion safety net stay in one place. Anything addressed to
a host — a note, a kill, an `end_input` — goes through that run's own handle, never through the
app session id, because a supersede overlap would address the wrong host.

governs: /home/lyphe/.claude/claudecodeui_lyphe/deploy/dev-supervisor/README.md

## MAN-691 — The idle host an install leaves behind
section: README/009 The idle host an install leaves behind

A CLI process runs the build it was started with, so a message that would reuse a host older than
the binary on disk retires it and spawns afresh (`chat-process.ts`). Until this existed that was the
ONLY thing that acted on a stale host: one between turns sat on the old build for up to the idle
closer's two hours, and nothing in the UI said so — the version report lists `running[]`, and an
idle host has no run.

`idle-version-sweep.ts` closes that gap with the same test the message path applies — both sides a
version string, the process BEHIND the binary (the ordered comparison, so a downgrade retires
nothing ahead of it), and no work in flight — on two triggers:

| Trigger | When it fires | What it covers |
|---|---|---|
| The installed reading MOVES | The shared probe's cache goes from one version string to a different one (`cli-version-change.ts`); the sweep subscribes once per boot, in the process that holds the keepalive | The operator who leaves the app open across an upgrade: the client polls the version route about once a minute, the poll re-probes, and the sweep rides that — no timer of its own |
| Boot re-adoption | `retireStaleIdleHosts` on the keepers, step 3 above | A server that was down when the install happened, and a machine with no browser open |

A retired host is wound down exactly like a superseded one — `end_input`, then `SIGTERM` over its own
socket — so its conversation is untouched: the next message spawns fresh and resumes. One line per
host, `[keepalive] retiring idle host <hostId>: cli <old> → <new>`, and the walk is DEFERRED one turn
of the event loop so the version poll and the message send that asked for the reading never wait on
tmux. The sweep is registered after the keepalive claim, so a second API beside the serving one
sweeps nothing — the same rule that stops it adopting.

What the two triggers still do not reach: a host idle and stale at boot whose turn is in flight (it
is not retired, correctly), with no further version change while the server lives. Its next message
retires it, which is the rule the sweep was built on rather than a replacement for it.

"In flight" is answered in two places, because the boot trigger cannot use the runtime's one. At a
boot the run registry is empty — per-process memory, and this step runs before the port is listening
— so `chatRunRegistry.isProcessing` says *no* for every host on the machine. The host's own meta is
then the only witness, and it carries the two bits the runtime's own idle closer reads
(`claude-runtime.provider.js`): `turnCompleteSent` false, meaning a turn was accepted and has not
reported, and `heldForBackgroundWork` (or the non-empty `deferredTools` it is derived from), meaning
the result did not wait for work still running. A socket retirement interrupts FIRST and then ends
the CLI's stdin: the EOF, not the interrupt, is what takes the background work still running in that
CLI down, and the exit frame that follows deletes the journal — so both bits are the difference
between ending a process and destroying an answer. A Stop, by contrast, ends only the turn: a process
with background work still in flight is left alive and idle, on purpose, so that work still reports
back (`abortClaudeSDKSession`). A host
kept for either reason logs one line, `[keepalive] keeping host <hostId> on cli <old>: <why>`, so the
near-miss is visible; the sweep is otherwise unchanged, and a host that is genuinely idle is still
retired the moment the reading moves.

## MAN-692 — Why three files here are plain JavaScript
section: README/010 Why three files here are plain JavaScript

`host.js`, `host-conn.js` and `host-journal.js` are exec'd by bare `node` from a tmux server that
has no `tsx` loader — in dev from source, in production from `dist-server/` (`allowJs` plus the
`**/*.js` include in `server/tsconfig.json` emit them). Loading `tsx` per host would cost roughly
200 ms and 30 MB per session for nothing. This is the deliberate exception to
`$backend-module-standards`' "use TypeScript for every file inside `server/modules/`" (D-9), and
it is scoped to those three files: everything else here is ordinary TypeScript running inside the
API. Two consequences — `checkJs` is off, so `npm run typecheck` proves nothing about them; and
because each runs in its own process, an edit takes effect on the next host process that starts,
never on one already running. Saving one of the three still hands the API over — the supervisor
watches the `server/` tree, not an import graph — and that handover changes nothing for a live
host.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/tsconfig.json

## MAN-693 — Failure modes, and how each ends
section: README/011 Failure modes, and how each ends

| Situation | Ending |
|---|---|
| API SIGKILLed between a line's delivery and the provider handling it | The `result` is re-delivered on re-attach; other lines are lost from the live stream but present in the transcript the browser refetches |
| A `result` the provider deliberately skipped (the reconciliation phantom) | Acked by the skip branch's own note, bits unchanged; no re-delivery |
| Hook callbacks after a re-attach | The CLI keeps the first `initialize`'s hook registrations; if the SDK's callback ids differ per `Query`, a Notification `hook_callback` gets an error response and that `agent.notification` is lost for the rest of that process. Accepted; re-registering hooks on re-attach is the cure, and a follow-up |
| A permission request in flight across the gap — emitted during it, or delivered to the API that then died without answering it | Held by the cursor until its `control_response` has reached stdin or the CLI withdraws it, so the successor replays it, `canUseTool` runs again and the prompt is re-issued under a fresh request id; the browser's re-subscribe drops the dead prompt and takes the live one, and a card whose answer to the dead prompt was never resolved offers the live one too; the `TOOL_APPROVAL_TIMEOUT_MS` window starts at re-attach. Case G of `.verify/keepalive-cases-p4.mjs` drives it |
| `systemctl stop cloudcli-sessions-tmux` with live sessions | Every host and CLI dies. Each facade sees its socket close and emits `'exit'(null,'SIGHUP')`, and the client is told with an error frame rather than left hanging. This is the deliberate kill-everything switch |
| API boots while the keepalive unit is down | Every meta's tmux session is dead, so all are swept; new turns run in fallback mode |
| Two API processes at once (a manual `npm run server:dev` beside the unit) | The second connection replaces the first, and the first facade errors its run. Unsupported. The supervisor's own handover overlap is not this case: there the successor is spawned as a handover child and re-adopts nothing until the first process has exited |
| The host process itself dies | The CLI's stdin pipe closes, so the CLI sees end-of-file and winds down; the facade errors the run. The same loss as before this package, and visible |
| A session row deleted while its host lives | Re-adoption finds no row: `end_input`, then SIGTERM; the files are swept next boot |
| Journal growth | Bounded by one CLI lifetime — one per CONVERSATION, since every message joins the process already running for its session (`claude-runtime.provider.js`, `chat-process.ts`). Deleted by the attached adapter on `exit` or by the next boot's sweep. A CLI ends after two hours without a message (`CLAUDE_CHAT_IDLE_CLOSE_MS`, or `options.idleCloseMs` on the turn), never while a task or watcher is running in it; after its EOF, `BG_WAIT_CEILING_MS` (30 min) bounds anything that slipped in |

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/keepalive-cases-p4.mjs

## MAN-694 — See also
section: README/012 See also

- [`docs/MANUAL.md (hosting)`](../../../../../../docs/MANUAL.md) §"What runs", §"Rules that bite" — the
  unit, the stop switch, what a restart now costs a turn
- [`docs/MANUAL.md (verification)`](../../../../../../docs/MANUAL.md) §"The keepalive cases" — how
  each ending above is driven against the real units
- [`docs/architecture/MANUAL.md (02-realtime-stream)`](../../../../../../docs/architecture/MANUAL.md)
  §"One run, end to end" — why a re-adopted run restarts `seq` at 1
