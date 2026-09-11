# session-host — a Claude turn's CLI, outside the API's cgroup

## What this does

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

## Public surface

`index.ts` is the whole public surface; nothing outside this directory imports past it:

| Export | Consumer | What it is |
|---|---|---|
| `armKeepaliveSpawn(sdkOptions, ctx)` | `claude-runtime.provider.js` | Sets `sdkOptions.spawnClaudeCodeProcess` and returns the handle a `result` is acked through, or `null` when the gate is off or the turn has no app session id |
| `keepaliveReadopt(reattach, appSessionId)` | `claude-runtime.provider.js` | The same armed/not-armed answer, asked before `sdkOptions` exists, so the two can never disagree |
| `readoptKeepaliveSessions({ runtime })` | `server/index.ts`, through the providers barrel | The boot step (below) — before `server.listen` on a plain boot, deferred to the supervisor's takeover on a handover boot |
| `KeepaliveHandle`, `KeepaliveReattach` | `claude-runtime.provider.js` | The two types those calls traffic in |

## Where things live

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

## The socket protocol

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

## The replay cursor, and the ack that moves it

`cursorFor` (`host-journal.js`) resolves `"acked"` to `Math.min(deliveredSeq, pendingResults[0] - 1)`,
and to plain `deliveredSeq` when nothing is outstanding. `deliveredSeq` is the last frame written to
a client socket; `pendingResults` holds every delivered `result` seq no `note` has confirmed yet.

The reason is asymmetric damage. A re-delivered stream delta is cosmetic — the browser refetches
the transcript over REST anyway — while a LOST `result` wedges the run with no terminal event to
release it. So the ack is sent after the provider has finished handling the result, never at the
head of the loop: an ack that preceded the state flip would confirm a result a SIGKILL then loses.
A graceful restart is therefore exactly-once; a hard kill between delivery and processing is
at-least-once, for the `result` line alone (D-3).

The `note` carries both turn-state bits with it, so the ack and the bits land in one atomic
rename (D-4) — a SIGKILL between them cannot leave an acked result beside stale bits. Correlation
is FIFO: the host's `seq` never reaches the provider, so a note can only mean "the oldest unacked
result is done". A note with nothing outstanding warns and retires nothing rather than moving the
cursor silently.

## The meta file

```json
{ "hostId": "…", "appSessionId": "…", "userId": null, "cwd": "…", "startedAt": 0, "pid": 0,
  "turnCompleteSent": false, "heldForBackgroundWork": false,
  "deliveredSeq": 0, "pendingResults": [], "exited": null }
```

`exited` becomes `{code, signal, at}` when the CLI ends. The two bits are the provider's own
(`turnCompleteSent` decides whether the next `result` emits `complete`; `heldForBackgroundWork`
decides whether the CLI is held after it) — persisted rather than re-derived, because re-deriving
them from the journal's content would be a second copy of the loop's result/phantom/background
decisions. A re-adopted run initializes both from here.

Liveness is always the tmux session, never this file: a meta says what a host believed when it
last wrote, and only `tmux has-session` says whether anything is still running.

## `apiExiting` — the invariant this package exists for

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

## The fallback

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

## Re-adoption, on boot

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
3. Per keeper: no session row left → retire it (nothing to re-adopt into). Otherwise
   `runDetachedChatTurn` with `content: ''` and `options.keepalive = { reattach: true, hostId, …
   }`, not awaited. `beforeRun` completes the registry run at once when `turnCompleteSent` was
   already true, so a finished turn is never observable as `running`.
4. One line: `[keepalive] re-adopted N host(s), swept M`.

It composes `runDetachedChatTurn` rather than re-implementing `dispatchRun`: the session row
lookup, the busy check and the run-completion safety net stay in one place. Anything addressed to
a host — a note, a kill, an `end_input` — goes through that run's own handle, never through the
app session id, because a supersede overlap would address the wrong host.

## Why three files here are plain JavaScript

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

## Failure modes, and how each ends

| Situation | Ending |
|---|---|
| API SIGKILLed between a line's delivery and the provider handling it | The `result` is re-delivered on re-attach; other lines are lost from the live stream but present in the transcript the browser refetches |
| A `result` the provider deliberately skipped (the reconciliation phantom) | Acked by the skip branch's own note, bits unchanged; no re-delivery |
| Hook callbacks after a re-attach | The CLI keeps the first `initialize`'s hook registrations; if the SDK's callback ids differ per `Query`, a Notification `hook_callback` gets an error response and that `agent.notification` is lost for the rest of that process. Accepted; re-registering hooks on re-attach is the cure, and a follow-up |
| A permission request emitted during the outage | Journaled, delivered on re-attach, surfaced as usual; its `TOOL_APPROVAL_TIMEOUT_MS` window starts at re-attach |
| `systemctl stop cloudcli-sessions-tmux` with live sessions | Every host and CLI dies. Each facade sees its socket close and emits `'exit'(null,'SIGHUP')`, and the client is told with an error frame rather than left hanging. This is the deliberate kill-everything switch |
| API boots while the keepalive unit is down | Every meta's tmux session is dead, so all are swept; new turns run in fallback mode |
| Two API processes at once (a manual `npm run server:dev` beside the unit) | The second connection replaces the first, and the first facade errors its run. Unsupported. The supervisor's own handover overlap is not this case: there the successor is spawned as a handover child and re-adopts nothing until the first process has exited |
| The host process itself dies | The CLI's stdin pipe closes, so the CLI sees end-of-file and winds down; the facade errors the run. The same loss as before this package, and visible |
| A session row deleted while its host lives | Re-adoption finds no row: `end_input`, then SIGTERM; the files are swept next boot |
| Journal growth | Bounded by one CLI lifetime — one per CONVERSATION, since every message joins the process already running for its session (`claude-runtime.provider.js`, `chat-process.ts`). Deleted by the attached adapter on `exit` or by the next boot's sweep. A CLI ends after two hours without a message (`CLAUDE_CHAT_IDLE_CLOSE_MS`, or `options.idleCloseMs` on the turn), never while a task or watcher is running in it; after its EOF, `BG_WAIT_CEILING_MS` (30 min) bounds anything that slipped in |

## See also

- [`docs/hosting.md`](../../../../../../docs/hosting.md) §"What runs", §"Rules that bite" — the
  unit, the stop switch, what a restart now costs a turn
- [`docs/verification.md`](../../../../../../docs/verification.md) §"The keepalive cases" — how
  each ending above is driven against the real units
- [`docs/architecture/02-realtime-stream.md`](../../../../../../docs/architecture/02-realtime-stream.md)
  §"One run, end to end" — why a re-adopted run restarts `seq` at 1
