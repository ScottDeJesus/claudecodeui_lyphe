<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-695 — session-host

The Claude turn's CLI kept outside the API's cgroup: a tmux session on the private cloudcli-sessions server, a host process owning the CLI, journalling every line, brokering a unix socket, and re-adopting what survived the API's restart — on this machine's keepalive, or through a Cerberus node's warden for a project assigned there.

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
moment. On its next boot the API re-adopts what survived. The node-side half — where hosts live, which are alive, how one is started, reached and retired — is `host-registry.js`; `hosts.ts` is the API's instance of it. A project assigned to a Cerberus node has its turns placed through that node's warden instead — a second transport for the same host protocol (§"The node transport").

This directory is the mechanism's one home; every other doc describes what an operator sees and points here.

## MAN-683 — Public surface
section: README/001 Public surface

`index.ts` is the surface the API imports from this directory; nothing outside the directory imports past it except `warden/src/sessions.mjs`, which imports `host-registry.js` by relative path. The other files in §"Past `index.ts`" are imported only from inside the directory.

| Export | Consumer | What it is |
|---|---|---|
| `armKeepaliveSpawn(sdkOptions, ctx)` | `claude-runtime.provider.js` | Sets `sdkOptions.spawnClaudeCodeProcess` and returns the handle a `result` is acked through, or `null` when the gate is off or the turn has no app session id — except a turn with `ctx.node`, which is always armed: placed on that node's warden or refused, never left to the SDK's own spawn |
| `keepaliveReadopt(reattach, appSessionId)` | `claude-runtime.provider.js` | The same armed/not-armed answer, asked before `sdkOptions` exists, so the two can never disagree |
| `readoptKeepaliveSessions({ runtime })`, `releaseKeepaliveOwnership()` | `server/index.ts`, through the providers barrel | The boot step (below) — before `server.listen` on a plain boot, deferred to the supervisor's takeover on a handover boot; the release drops this process's keepalive claim at shutdown |
| `whenNodeSessionsReadopted()` | `server/index.ts`, through the providers barrel | Resolves once every co-located node heard in the ten minutes before this boot has linked and been re-adopted (§"Node hosts come back"); the running-sessions hold waits for it beside the boot step |
| `listLiveHosts()`, `LiveHost`, `busyReason(host)` | the claude-activity module, through the providers barrel | This machine's live hosts and the one test of whether a host is mid-work, asked of every host so an update never installs under a conversation the idle sweep would leave alone |
| `listColocatedNodeHosts()`, `refreshColocatedNodeHosts()` | the claude-activity module, through the providers barrel | The hosts a co-located node's warden holds, read beside `listLiveHosts()`; the refresh asks each linked warden when the reading is taken |
| `retireStaleIdleHosts(hosts, installed, retire = retireHost)`, `watchInstalledCliVersionChanges()` | none outside the directory today | The version sweep and its subscription (§"The idle host an install leaves behind"), called by `readopt.ts` and `node-readopt.ts`. Exported for a `.verify` probe, which cannot get the subscription any other way — it never holds the keepalive claim |
| `sessionHostLivenessSnapshot()` | the websocket module's chat gateway, through the providers barrel | The `session_host_liveness` snapshot frame — every chat with a live host — that a socket is sent once the keepalive hosts are re-adopted (§"Which chats have a live host"). The push that keeps a page current after it is `host-liveness.ts`'s own and not exported |
| `KeepaliveHandle`, `KeepaliveReattach` | `claude-runtime.provider.js` | The two types those calls traffic in. `KeepaliveReattach` = `{ hostId, turnCompleteSent, heldForBackgroundWork, profile, cliVersion, deferredTools, node }`; `node` is the warden that holds the host, `null` for a host on this machine's own keepalive |

## Past `index.ts`
| File | Exports | Imported by |
|---|---|---|
| `host-registry.js` | `createHostRegistry({ tmuxSocketName, keepaliveSession, sessionsDir })` → `{ sessionsDir, hostSocketPath, hostJournalPath, hostMetaPath, tmuxCommand, isTmuxSessionAlive, isServerUp, liveSessionNames, readHostMeta, listHostIds, listLiveHosts, lastTurnFinishedAt, lastReportedCliVersion, removeHostJournal, retireHost(hostId, onEnded?), retireOlderHosts(hosts, retire = retireHost), sweepDeadHosts, spawnHostSession(hostId, cwd), connectToHost(hostId, timeoutMs) }` — `spawnHostSession` is ONE tmux command line, `has-session -t <keepalive> ; new-session …`: with no keepalive server it throws (`error.code === 'HOST_SERVER_DOWN'`) instead of letting `new-session` start a server inside the caller's process group, so a caller's own `isServerUp` check only says so early; `HOST_SCRIPT` (this directory's `host.js`) | `hosts.ts`; `warden/src/sessions.mjs` by relative path (MAN-692) |
| `hosts.ts` | `registry` and every registry member under its own name and TypeScript type (`isServerUp` is `isKeepaliveServerUp`), `TMUX_SOCKET_NAME`, `KEEPALIVE_SESSION`, `sessionsDir`, `HostMeta`, `LiveHost`, `TmuxResult` | `spawner.ts` (`registry.spawnHostSession`, `registry.connectToHost`), `readopt.ts`, `readopt-host.ts`, `idle-version-sweep.ts`, `node-readopt.ts`, `colocated-hosts.ts` (the type), `index.ts` (`listLiveHosts`, `LiveHost`) |
| `host-frames.ts` | `deliverHostFrame(facade, frame, hostId)` → `true` on the host's `exit`; `hostTransport(send)` → the facade's `write` / `endInput` / `kill` / `note`; `plainEnv(env)` | `spawner.ts` (`bindSocket`), `node-transport.ts` |
| `node-transport.ts` | `placeInNodeHost(facade, options, ctx)` → `Promise<void>`, settled at the host's first frame and rejected with the refusal sentence; `waitingHostIds()`; `gateFreshNodeHosts(gate)` | `spawner.ts` (`armNodeSpawn`), `node-readopt.ts` |
| `node-readopt.ts` | `watchNodeLinks(deps)`, `releaseNodeReadoptionWait()`, `whenNodeSessionsReadopted()` | `readopt.ts`, `index.ts` |
| `host-liveness.ts` | `trackHostLiveness(facade, appSessionId, hostId)`; `sessionHostLivenessSnapshot()` | `spawner.ts` (`bindSocket`), `node-transport.ts` (`onHostFrame`); `index.ts` (the snapshot) |

The two registry instances:

| Instance | `tmux -L` server | Keepalive session | `sessionsDir` | Made by |
|---|---|---|---|---|
| the API's | `cloudcli-sessions` | `_keepalive` | `CLOUDCLI_SESSIONS_DIR`, else `~/.cloudcli/sessions` | `hosts.ts` |
| the warden's | `cerberus-warden` | `_keepalive` | `<warden home>/sessions` (`~/.cerberus-warden/sessions`) | `warden/src/sessions.mjs` (MAN-7897) |

The session host reaches the relay only as `nodeSessions` from `@/modules/cerberus/index.js` (MAN-7901); the cerberus module imports nothing from providers.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host-frames.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host-registry.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/hosts.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/node-transport.ts

## MAN-684 — Where things live
section: README/002 Where things live

Under `sessionsDir` — the API's is `CLOUDCLI_SESSIONS_DIR`, else `~/.cloudcli/sessions`; a node's warden keeps its own at `~/.cerberus-warden/sessions` (MAN-7897) — created `0700`
(D-1: on disk rather than `/run`'s tmpfs, so a long turn's journal is not held in RAM):

| File | Owner | Life |
|---|---|---|
| `<hostId>.sock` | the host | Unlinked by the host on its way out; a stale one is probed and removed before `listen` |
| `<hostId>.ndjson` | the host | The `out`/`exit` frames verbatim, one per line, `0600` — replay is "stream the file" |
| `<hostId>.json` | the host | The meta below, written by atomic rename |

`hostId` is `<appSessionId>-<Date.now().toString(36)>`, never the bare app session id: a retirement
(a message whose launch argument the running process cannot take) puts two hosts on one session for seconds and `tmux new-session -s <name>` refuses a
duplicate (D-8). The tmux session, the socket, the journal and the meta all carry that id.

A socket path (`<sessionsDir>/<hostId>.sock`, a 45-character host id) must stay at or under 108 bytes; past it the host exits with `listen EINVAL`:

| Instance | Path | Breaks at | Moved by |
|---|---|---|---|
| the API's | `$HOME` + 70 bytes (81 here) | a `$HOME` of 39 bytes or more | `CLOUDCLI_SESSIONS_DIR`, pointed somewhere shorter |
| the warden's | `$HOME` + 77 bytes | a `$HOME` of 32 bytes or more | nothing: `CLOUDCLI_SESSIONS_DIR` is the API's variable, and neither `enroll.sh` nor the unit passes `CERBERUS_WARDEN_HOME` (MAN-7836) |

A node whose account home is that long cannot run a session. The warden's `connectToHost` retries to its bound and the chat reads `socket <hostId>.sock: connect EINVAL`, with no word of length.

## MAN-685 — The socket protocol
section: README/003 The socket protocol

Newline-delimited JSON (NDJSON) both ways, one object per line, `t` is the discriminator. One client at a time: a second connection replaces the first (the newer API wins, the older socket is ended). A node's host speaks the same frames through its warden (§"Across a node's warden"); `host-frames.ts` is the one reading of them both transports use (§"The node transport").

Client → host:

| Frame | Meaning |
|---|---|
| `{"t":"spawn","command","args","cwd","env","appSessionId","userId","profile"}` | First frame on a FRESH host: spawn the CLI with exactly these, write the meta, attach this client from seq 0. `env` is held in memory only — it never reaches the meta or the journal; `profile` (the launch profile) goes to the meta |
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
| `{"t":"exit","seq","at","code":null,"signal":null,"error"}` | The CLI never started (Node's `spawn` failed: a missing binary or cwd, EACCES). `error` is Node's own message, e.g. `spawn /nonexistent/claude ENOENT`, except when the cause is the `cwd` (missing, not a directory, not enterable): then it names the folder and keeps Node's words after it (`the working folder <cwd> does not exist or cannot be entered (spawn … ENOENT)`). There is no exit code to report. Still the journal's last line, so a replay carries the cause too. `deliverHostFrame` hands `error` to `facade.emitError` BEFORE `settleExit`, so the SDK throws `Failed to spawn Claude Code process: <error>`, as `attachLocalSpawn` already does. A host from before the field sends a plain exit, and the API settles it as it always did |
| `{"t":"err","message"}` | Protocol error; the host ends that connection |

The CLI's `initialize` control request is answered once and cached: the first such line is
forwarded and its `request_id` remembered, every later one is answered from the cache with the id
rewritten, and one that arrives before the cache is filled is queued rather than forwarded. The
SDK sends that request from its `Query` constructor, so every re-attach sends another — a second
one reaching the CLI would be a second initialization of a session already running.

## Across a node's warden
The warden is the host's client on its machine: it holds the unix socket and relays each NDJSON line as one frame of its link to center. Body types: `server/shared/cerberus-types.ts` (MAN-7807); center's end: `nodeSessions` (MAN-7901); the warden's end: `warden/src/sessions.mjs` (MAN-7897). `chan` is one center-side holder of one host.

| Frame | Direction | Body | Meaning |
|---|---|---|---|
| `session.open` | center → warden | `{ chan, op: 'spawn'\|'attach', hostId, cwd: string\|null, frame }` | Opens the channel. `spawn`: a fresh host in the warden's tmux server, `cwd` absolute, `frame` is the host's `spawn`. `attach`: a running host, `cwd` null, `frame` is `hello`. The warden writes `frame` as the host's first line |
| `session.frame` | both | `{ chan, frame }` | The host protocol's object verbatim. Down: a client frame (`stdin`, `end_input`, `kill`, `note`) written to the host socket. Up: a line the host wrote (`out`, `live`, `exit`, `err`) |
| `session.detach` | center → warden | `{ chan }` | `socket.end()`. Never `end_input`; nothing is answered |
| `session.closed` | warden → center | `{ chan, reason }` | The open failed; the host's socket closed with no `exit`; or a host line was too big for one frame (past 8 MiB less 16 KiB of envelope: the host is detached, the link stands). `reason` is a sentence for a person, and a standing link's `closed` ends the turn at once with it (MAN-7905). Never follows an `exit` |
| `sessions.list` | center → warden | `{}` | Asks which hosts run there |
| `sessions.listed` | warden → center | `{ re, hosts: CerberusNodeHost[] }` | `re` is the request envelope's `id`; a `CerberusNodeHost` is a `LiveHost` plus `lastTurnFinishedAt: number\|null` |
| `session.retire` | center → warden | `{ hostId }` | `retireHost(hostId, onEnded)`; nothing is answered at once |
| `sessions.changed` | warden → center | `{ hostId }` | Said once when that retire is over (the host's `exit` and its files gone, the host already gone, or the registry gave up waiting): center lists the node again, so a host that took long to leave stops being counted |

- A dropped link is a DETACH. The warden ends every channel socket and writes nothing to a host; center calls each channel's `closed('link lost')`. The host keeps the CLI and its journal, and the next attach resumes at a `hello` cursor (MAN-686). `session.closed` for any other loss is the warden speaking on a standing link: the channel is over.
- None is an outbox frame: the journal and its cursor are the replay, so no queue on the warden or on center holds a `session.*` frame.
- The host's `exit` is relayed as a `session.frame`; the warden then removes the journal (it was the attached client) and drops the channel.
- A `spawn` frame carries the CLI's whole environment: no log line on either side names a frame.

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

## The cursor a node's attach carries
`hello.fromSeq` is `"acked"` or a number. `cursorFor` takes a number as given (a positive integer, else 0); `node-transport.ts` picks which:

| Attach | `fromSeq` | Why |
|---|---|---|
| a re-adoption — a new API process, an SDK that has read nothing | `"acked"` | the host's own cursor replays a `result` the old process never confirmed handling and a `control_request` it never answered, and nothing it already did |
| the same facade after a link blink — its SDK has read every `out` line delivered | the number: the last `out` frame with `seq > 0` this facade received | `"acked"` replays from the oldest unacked `result` or unanswered request — lines this SDK already has; the number replays no line twice and misses none |
| a re-adopted facade that has heard `live` but no `out`, then loses the link | `"acked"` | `0` would replay the whole journal into an SDK that read none of it, and every replayed `result` is marked delivered again, so each retired `result` returns to `pendingResults` |

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
(`host-registry.js`'s `lastReportedCliVersion`) and hands the provider as `KeepaliveReattach.cliVersion`.
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
a turn with no `node` falls back to an in-process spawn identical to the SDK's own (`stdio:['pipe','pipe',
'ignore']`, `signal`, `env`, `windowsHide`), logged once per boot as `[keepalive] unavailable (…) —
spawning in-process`. Falling back is allowed only BEFORE the first frame reaches a host; past that
point the host has a CLI, and a second local spawn would put two CLIs on one session.

One asymmetry: a **re-attach** that cannot reach its host does not fall back. It carries no prompt
(the provider empties it), so a local CLI would be asked nothing, never reach a `result`, and
leave the run `running` for ever. That path ends the turn instead and always says so — never
silenced by the once-gate, because it strands a session.

A turn in a project assigned to a node (`options.node`) never falls back, before the first frame or after: its CLI runs on that node's warden or the turn ends with the reason (`armNodeSpawn`). The reason is emitted as the spawn error, then `settleExit(null, 'SIGTERM')`; nothing is spawned here. The gate does not disarm it — the spawn function exists with the gate off and refuses.

| Refused when | Sentence | Raised by |
|---|---|---|
| `nodeSessions.isLinked(node)` is false | `<node>'s warden is not connected — this project's sessions run on <node>` | `placeInNodeHost` |
| the gate is off | `Session keepalive is off on this server (CLOUDCLI_SESSION_KEEPALIVE), and <node>'s sessions only run hosted` | `armNodeSpawn` |
| the turn has no app session id | `This turn has no session id to host, and <node>'s sessions only run hosted` | `armNodeSpawn` |

The placement's other refusals are listed in §"The node transport".

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
`[keepalive] taking over` when it is released. The listener is up throughout either way: from the retiring server's SIGTERM on
it takes every new connection, while the retiring server only finishes the HTTP requests it had
already accepted — at most 4 s, [`server/http-drain.ts`](../../../../../http-drain.ts) — and keeps
its websockets until it exits, so no chat re-subscribes before this pass. The one
takeover-dependent read the tabs poll, `GET /api/providers/sessions/running`, is held until this
pass has run AND every co-located node heard in the ten minutes before this boot has linked and been
re-adopted (`whenNodeSessionsReadopted`), at most 11 s for the two together
(`RUNS_READOPTED_WAIT_MS` in [`server/index.ts`](../../../../../index.ts)), so a live keepalive
session is never answered as idle. The bound lapsing ends the hold for every later poll too: a
warden that stays down costs one wait, not one per poll. Why the message can only come
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

A node's hosts are not in this list: their warden links after this step (the gateway opens in `listen`'s callback), so they are re-adopted at the node's link-up, in the claim-holding process only — `watchNodeLinks` is registered after the claim is taken and the gate is on, never by a process that took no claim (§"Node hosts come back — re-adoption at link-up"). The running-sessions hold above waits for them.

It composes `runDetachedChatTurn` rather than re-implementing `dispatchRun` (`readopt-host.ts`): the session row
lookup, the busy check and the run-completion safety net stay in one place. Anything addressed to
a host — a note, a kill, an `end_input` — goes through that run's own handle, never through the
app session id, because a supersede overlap would address the wrong host.

governs: /home/lyphe/.claude/claudecodeui_lyphe/deploy/dev-supervisor/README.md, /home/lyphe/.claude/claudecodeui_lyphe/server/http-drain.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts

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

## MAN-692 — Why four files here are plain JavaScript
section: README/010 Why four files here are plain JavaScript

Four files here are plain JavaScript — the one exception to `$backend-module-standards`' "use TypeScript for every file inside `server/modules/`" (D-9). Everything else here is ordinary TypeScript running inside the API.

| File | Why it is plain | Runs in |
|---|---|---|
| `host.js`, `host-conn.js`, `host-journal.js` | exec'd by bare `node` from a tmux server that has no `tsx` loader; loading `tsx` per host would cost roughly 200 ms and 30 MB per session for nothing | one process per CLI, the host |
| `host-registry.js` | node builtins only, no `@/` import: the node-side half of the host — where a host's files live, which hosts are alive, how one is started (`spawnHostSession`), reached (`connectToHost`) and retired — so a process that is not the API runs the same code by relative path. The API (`hosts.ts`) and the Cerberus warden (`warden/src/sessions.mjs`, the registry's second runner) each make their own instance with `createHostRegistry` | the API; the warden |

- Emit: dev runs the source; production runs `dist-server/`, where `allowJs` plus the `**/*.js` include in `server/tsconfig.json` emit all four.
- `checkJs` is off, so `npm run typecheck` proves nothing about the three host files. `host-registry.js` opts in with `// @ts-check` as its first line: a typo in its bodies fails the typecheck, and the annotated re-exports in `hosts.ts` fail it when the JSDoc types stop matching `HostMeta` and `LiveHost`.
- An edit takes effect on the next process that loads the file: for the three host files, the next host that starts, never one already running; for `host-registry.js`, the API's next handover and the warden's next release (`warden/build.mjs` stages all four at their repo paths, MAN-7826).
- Saving one of the four still hands the API over — the supervisor watches the `server/` tree, not an import graph — and that handover changes nothing for a live host.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host-conn.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host-journal.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host-registry.js, /home/lyphe/.claude/claudecodeui_lyphe/server/tsconfig.json

## MAN-7905 — The node transport
section: README/0105 The node transport

A project assigned to a Cerberus node (`projects.node`, set by `PUT /api/projects/:id/node`) has its CLI spawned by that node's warden, never anywhere else. `dispatchRun` reads the assignment on every turn (`projectsDb.nodeForPath`) and hands it to the Claude runtime as `options.node`; the runtime passes `reattach ? reattach.node : options.node ?? null` to `armKeepaliveSpawn`. Only Claude has a session host: a Codex, Cursor or OpenCode turn in the same project runs where it runs today and never reads `node`. A CLI already running when the assignment changes keeps running where it started, and later messages in its chat join it until it ends.

| File | What it holds |
|---|---|
| `host-frames.ts` | `deliverHostFrame(facade, frame, hostId)` and `hostTransport(send)` (write, endInput, kill, note) — the one reading of the host protocol. `bindSocket` (the unix socket) and the node transport both use them, so the two cannot drift. `deliverHostFrame` answers true on the host's `exit` (after emitting the frame's `error`, when it carries one, as the spawn error): the unix socket then removes the journal and ends itself; the node channel leaves both to the warden, which was the attached client there |
| `node-transport.ts` | `placeInNodeHost(facade, options, ctx)`, `waitingHostIds()` and `gateFreshNodeHosts(gate)` |
| `refused-hosts.ts` | the hosts of fresh placements refused after their `spawn`: `retireRefusedHost(node, hostId)`, `sendPendingRetires(node)`, `withoutRefusedHosts(node, listed)` |
| `spawner.ts` | `armNodeSpawn`: with `node` the spawn function places in the node host, and a failure ends the turn with the reason — emitted as the spawn error, then `settleExit(null, 'SIGTERM')` — instead of `attachLocalSpawn` |

`placeInNodeHost`, in order:

1. Refuses, fresh and re-attach alike, with "<node> is no longer this machine — move this project back to this server from its card on the Cerberus tab" unless `nodeSessions.isColocated(node)` (a store that cannot be read refuses too, with a sentence of its own). why: the assignment checked co-location once (MAN-7920), and a node can move machines after; the CLI runs this machine's command and environment, in a folder that is a path on this machine's disk. Then refuses, throwing "<node>'s warden is not connected — this project's sessions run on <node>", unless `nodeSessions.isLinked(node)`. A fresh turn (no `reattach`) with no working folder is refused with "This turn has no working folder to start in on <node>". A fresh turn is also refused with the sentence the gate answers, when one stands: `gateFreshNodeHosts(gate)` is set once by the keepalive claim holder's node re-adoption, and a process without it has none (§"Node hosts come back — re-adoption at link-up", "A message in the window"). A re-adoption's own attach is never gated.
2. Fresh turn: `hostId = <appSessionId>-<base36 time>` (D-8) and `open { op: 'spawn', hostId, cwd, frame: { t: 'spawn', command, args, cwd, env, appSessionId, userId, profile } }`. Re-adoption: `open { op: 'attach', hostId, cwd: null, frame: { t: 'hello', fromSeq: 'acked' } }`. Client frames written before the channel answers ride the same channel; the warden holds them until its socket to the host connects.
3. Every `out` frame with `seq > 0` moves the resume cursor (`resumeFrom`). The first frame of any kind settles the placement; none within 15 s ends the turn with "<node>'s warden did not start the session within 15 s". A `closed` before the first frame fails the placement as the spawn error: `closed('link lost')` reads "The link to <node>'s warden was lost before the session started", any other reason is the warden's own sentence. why: the SDK's first stdin may have been lost with the link, so a re-open could hang. A FRESH placement refused this way, or by the 15 s, has already put its `spawn` on the wire, so it also asks the node to retire the host (`nodeSessions.retireHost(node, hostId)`) and lists the node again (`noteNodeHostsChanged`); a refused re-attach keeps its host, which still belongs to a live session. why: detaching the channel leaves the CLI running, the person is told the turn failed, and the next link-up would re-adopt the orphan as a live run. When the refusal IS the link going away (`closed('link lost')`) the retire cannot go: `refused-hosts.ts` remembers the host by node (`retireRefusedHost`), sends the retire at the node's next link-up BEFORE the re-adoption asks for its list (`sendPendingRetires`, and its own `onLinkUp` listener in a process that runs no re-adoption), and the re-adoption reads that list WITHOUT the refused hosts (`withoutRefusedHosts`), because a retired host stays listed until its CLI has exited and a replacement link's retire goes out just before its link-up's list. A host is forgotten once a list no longer names it.
4. `closed` does nothing when the facade is settled or the API is exiting (D-10, MAN-688). `closed('link lost')` — the relay's word that the link went — starts a 60 s grace: the facade stays unsettled and client frames are buffered; when `nodeSessions.onLinkUp(node)` fires the channel re-opens `hello { fromSeq: <last out seq delivered> }`, a number, because this facade's SDK already consumed everything up to it (MAN-686); a re-adoption that has heard no `out` yet (only `live`) re-opens at `"acked"` instead, since `0` would replay the host's whole journal into an SDK that read none of it. Past 60 s: the error `<node>'s warden was not reachable again within 60 s`, then `settleExit(null, 'SIGHUP')`. Any other `closed` is the warden speaking on a standing link, so it ends the turn at once: the warden's own sentence is emitted as the process error (the chat shows it, not a bare SIGHUP) then `settleExit(null, 'SIGHUP')` after a host had spoken, and the same sentence as the spawn error before.
5. `waitingHostIds()` answers the hosts a grace is holding, for the node re-adoption (§"Node hosts come back") to skip.

No frame is ever logged: a `spawn` frame carries the CLI's whole environment. A restart of this API ends nothing (the host keeps the CLI); the run is registered again when the node's warden links to the new process (§"Node hosts come back — re-adoption at link-up").

## MAN-7915 — Node hosts come back — re-adoption at link-up
section: README/0106 Node re-adoption

A node's hosts live in its warden's tmux server, not in this machine's keepalive, and the warden's link comes up AFTER the boot step has run (the gateway opens in `listen`'s callback). So they cannot be handed back at the boot; they are handed back when their warden is heard. The files: `node-readopt.ts` (the link-up pipeline and the hold's promise), `readopt-host.ts` (handing ONE host back — the step the local boot ends in too, moved out of `readopt.ts` unchanged apart from the node it answers to), `colocated-hosts.ts` (the activity reading's view of the same hosts).

**Who registers.** `watchNodeLinks(deps)`, called by `readoptKeepaliveSessions` right after `watchInstalledCliVersionChanges()` — that is, once the process HOLDS the keepalive claim and the D-7 gate is on, and never otherwise. A scratch probe server never holds the claim (measured 2026-09-15: probe servers retired the operator's chats), so it never watches a node's link either. It registers `nodeSessions.onLinkUp(listener, { replay: true })` once: `replay` tells the listener of every node already linked, which is a handover's takeover finding its warden already on the new gateway.

**What a co-located node's link runs** — the boot pipeline, on the warden's own answer:

1. `sendPendingRetires(node)` (`refused-hosts.ts`: the retire of a refused fresh placement's host that the link could not carry, MAN-7905), then `nodeSessions.listHosts(node)` (10 s bound); the answer is read WITHOUT the refused hosts (`withoutRefusedHosts`) and the node is listed again when any was left out, so an orphan is never adopted as a live run. A failure is one logged line and nothing is adopted until the node's next link-up; the running-sessions hold keeps waiting for it (below).
2. `retireOlderHosts(hosts, id => nodeSessions.retireHost(node, id))` — the newest host per app session wins, as at the local boot.
3. `retireStaleIdleHosts(keepers, installed, sameRetire)` — an idle host on a build behind the installed one is retired rather than handed back. Each retirement of 2 and 3 also tells `noteNodeHostsChanged(node)`, because the list of 1 still names the host just retired and the node card's "N sessions" is that list (measured 2026-10-07: the handover boot's version sweep retired eis1's only host at 08:57:33 and the overview still read `sessions: 1` at 09:08). A host that takes longer to leave than that settle (a CLI mid-tool-call, SIGTERM only after 5 s) is listed again when its warden says `sessions.changed`: `watchNodeLinks` subscribes `noteNodeHostsChanged` to `nodeSessions.onHostsChanged`.
4. `readoptHost(host, deps, node)` for each keeper not in `waitingHostIds()`. The ids are read before the list is asked and again after: a facade whose turn lost the link re-attaches by itself on this very link-up, at the exact seq its SDK last read, and a second adoption of its host would race it. `reattach.node` carries the node, so the provider rejoins the CLI where it lives (`placeInNodeHost`, `attach`, `hello { fromSeq: "acked" }`, MAN-686) and `beforeRun` completes the run at once when the host's turn had already reported. A host with no session row left is retired through the warden (`session.retire`), and the node is listed again.
5. One line: `[keepalive] node <node>: re-adopted N host(s)`.

A node that is not co-located is not adopted: its CLIs are not on this machine and its projects cannot be assigned. A link-up that arrives while an earlier one is still working yields the older run to the newer, which lists afresh. A pass that finds the process exiting (D-10) adopts nothing and attaches nothing at `"acked"`: its successor does.

**A message in the window.** Between a node's link-up and the registration of its runs this process holds neither a run nor a facade for the node's live sessions, so a message that starts a turn then would spawn a fresh host beside the live one, orphan it, and put two CLIs on one transcript. `gateFreshNodeHosts` (`node-transport.ts`) lets this file refuse a FRESH host on the node, never a re-adoption's own attach: with the sentence "<node>'s sessions are being re-adopted — send the message again in a moment" while a pass is between its link-up and its runs, and for a session whose live host the pass could not register because a turn already held the session — that host waits (`[keepalive] node <node>: host <id> waits for the turn running on session <s> to end, then is re-adopted`) and is re-adopted on the run registry's `onRunCompleted` for that session, which the refused turn raises as it ends. A newer pass of the node drops the wait and decides afresh. The person sends the message again.

A relay that cannot arm (`onLinkUp` throws, e.g. a frame type another plan already holds) is logged and releases the hold: it costs the node hosts their re-adoption, never the local one that follows it in the boot step.

**The running-sessions hold.** `whenNodeSessionsReadopted()` (providers barrel) resolves once every co-located node whose `last_heartbeat_at` lies within the ten minutes before this boot has linked and been re-adopted — at once when no such node exists, or when this process takes no claim or has the gate off (`releaseNodeReadoptionWait`). `server/index.ts`'s hold on `GET /api/providers/sessions/running` waits for it beside `whenRunsReadopted`, inside the same `RUNS_READOPTED_WAIT_MS` (MAN-690, D-11): a browser that subscribes into a registry that has not re-adopted yet reads a live session as idle. A node that never links is not a reason to hold every poll: the bound lapsing ends the hold for the polls after it too.

**The activity reading.** The hosts a co-located node's warden holds have CLIs that are this machine's `claude` processes, so the claude-activity module counts them where it counts Claude work: `listColocatedNodeHosts()` (the linked co-located nodes' `nodeSessions.lastListed`) is read beside `listLiveHosts()` with the same `busyReason` test, and their CLI pids are dropped from the "other Claude processes" leg. The list moves on events and never on a clock: a clock-refreshed cache is wrong between its ticks, in the one direction the reading may never be wrong in. The relay keeps every `sessions.listed`, so the cache is current after (1) a node's link-up (the re-adoption lists), (2) a host placed on, ended on or retired from a node (`node-transport.ts` and the re-adoption's retirements tell `noteNodeHostsChanged`, which lists the node once the burst has settled, 1.5 s, and tells open Fleet screens — the node card's "N sessions running here" reads the same cache; a retire that outlasts the settle is told by the warden's `sessions.changed`), and (3) the reading itself: `refreshColocatedNodeHosts()` runs `listHosts` on each linked co-located warden at the head of `readClaudeActivity()`. A warden that cannot answer is a reason of its own (the reading fails closed), and a co-located node whose link is down contributes nothing, so its CLIs show up as "other Claude processes" and hold an install exactly as a process nothing here knows about does.

**The install sweep stays local.** `watchInstalledCliVersionChanges` walks this machine's keepalive only. A node host left on an older build is retired at its next message by `chat-process.ts`'s own rule, which works through any transport.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-activity/claude-activity.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/colocated-hosts.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/node-readopt.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/readopt-host.ts

## MAN-7916 — Node re-adoption probe — .verify/cerberus-node-readopt.mjs
section: README/0107 Node re-adoption probe

Two Haiku turns in the scratch project assigned to `eis1`, each asked for a numbered list of 120 sentences so it runs about a minute, against the real units (`cloudcli-server-dev`, `cerberus-warden`, `cerberus-warden-sessions`). Proves the node re-adoption (§"Node hosts come back — re-adoption at link-up") and the activity reading's count of a node's hosts.

```
node .verify/cerberus-node-readopt.mjs --evidence <dir>
```

Needs what `cerberus-node-chat.mjs` needs (the scratch project `~/.claude/state/test-projects/cerberus-node-probe` with a `projects` row, `eis1` enrolled and co-located, `sudo -n systemctl` for `cerberus-warden`) and `journalctl -u cloudcli-server-dev`. No `--evidence` exits 2. Each line prints as `KEY value`; `results.json` and per-step files land in `<dir>`.

| Key | True when |
|---|---|
| `assigned`, `model_chip`, `touched` | the project was put on `eis1` (`PUT /api/projects/:id/node` answered 204); the chat's composer is on Haiku; the time of `touch server/index.ts` |
| `host_in_warden`, `host_in_local` | the chat's host is in `tmux -L cerberus-warden ls`, and not in `-L cloudcli-sessions` |
| `handover_readopted` | `touch server/index.ts` mid-turn, then the journal holds `[keepalive] node eis1: re-adopted 1 host(s)` |
| `turn1_complete`, `turn1_repeats` | the turn ended with item 120 written; `turn1_repeats` is the number of lines the transcript holds twice word for word (0). Not a number repeated over two different sentences — that is the model's own slip, and Haiku makes it now and then |
| `same_cli_pid` | the host's CLI pid is one pid before the handover and after the turn |
| `activity_baseline`, `activity_mid_turn`, `activity_idle` | the auto-install block's `waiting` (it carries `readClaudeActivity()`'s reasons while an update is on offer) before the chat, mid-turn 2 and once the host is idle. With the host counted, the "other Claude processes" figure does not move across the three; without it, the host's CLI is one more |
| `claude_processes_mid_turn`, `claude_processes_idle` | the `claude` processes `ps` lists at those moments, and whether the host's CLI is among them, to reconcile that figure by hand |
| `warden_restarted`, `reattached_line`, `linkup_readopted_zero` | `sudo systemctl restart cerberus-warden` mid-turn 2; the journal says the facade re-attached its host after the link returned; the link-up re-adoption ran and adopted nothing, the host being the facade's |
| `turn2_complete`, `turn2_repeats`, `same_cli_pid_2`, `transcript_uuid_repeats` | turn 2 finished with no item repeated, on one CLI pid, and no transcript entry twice |
| `chat_deleted`, `node_restored` | cleanup ran |

`cleanup()` is idempotent, synchronous, and runs from `finally` and from `SIGINT`/`SIGTERM`/`SIGHUP` (the console is opened with Playwright's own three signal handlers off, because its SIGINT handler exits before any async cleanup runs): it starts the warden FIRST, puts the project's node back, deletes the chat — both on a token of the proof's own (`loginToken()`), never the page's — and kills what is left of the chat's `<chatId>-*` hosts by name. The same holds for `cerberus-node-readopt-boot.mjs` and `cerberus-node-chat.mjs`. The `activity_*` keys need an update on offer and the auto-install switch on; with either missing the block's `waiting` is null.

`.verify/cerberus-node-readopt-boot.mjs --evidence <dir>` is the same chat through the unit's PLAIN restart (`sudo -n systemctl restart cloudcli-server-dev`, not a handover), the path where the hold matters: the warden links after `listen`. Mid-turn it restarts the unit and polls `GET /api/providers/sessions/running` every 200 ms (`polls.txt`). `first_answer` is the first 200 — how long after the restart, how long the request was held, and whether it lists the chat as running (it must: a tab that subscribed there would otherwise read a live session as idle); `restart_readopted` is `[keepalive] node eis1: re-adopted 1 host(s)` in the journal; `turn_complete`, `turn_repeats` and `same_cli_pid` as above; `again_answered` and `same_cli_pid_again` say a second message, "Reply with the word again.", is answered by the same CLI.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-node-readopt-boot.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-node-readopt.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/node-probe.mjs

## MAN-8122 — Which chats have a live host
section: README/0107 Which chats have a live host

A chat with no live host is ASLEEP: no CLI runs for it, and its next message starts a fresh one. The simple chat list grays such a row; the server tells every open page the moment a chat gains or loses its last host, and a page that connects is sent the whole set once. Nothing polls.

`host-liveness.ts` holds the set: `Map<appSessionId, Set<hostId>>`, in memory, this process's own. A chat is live while its set is non-empty, so a supersede overlap (two hosts on one chat for seconds) never reads as the chat falling asleep.

| Moment | Where | Effect |
|---|---|---|
| A host is bound | `bindSocket` (`spawner.ts`) for this machine's keepalive — a fresh spawn and a re-adoption alike; `onHostFrame`'s first frame in `node-transport.ts` for a node's host | `trackHostLiveness(facade, appSessionId, hostId)` adds it. The chat's FIRST host pushes `live` |
| The host ends, however | the facade's `exit` event, which every end reaches through `settleExit` | The host leaves the set. The chat's LAST host pushes `asleep` |
| A socket connects to `/ws` | `handleChatConnection` (websocket module): the socket joins `connectedClients` at once, and the snapshot waits for `whenHostsReadopted` (below) | `sessionHostLivenessSnapshot()` is built at the moment it is sent and goes to that socket alone |

Why the facade's `exit` and not a second listener per cause: the CLI's `exit` frame (an idle close, a `kill-session`, a `kill-server` — tmux SIGHUPs the host, which winds its CLI down and reports it), a socket closed with no `exit`, a node channel closed for good, and a retirement over a second socket each settle the facade, so one listener covers all of them and the boot's re-adoption defines the set after a restart by binding what survived. A node's link blink leaves the facade unsettled for its 60 s grace, so a node chat stays live through one.

The frame, `SessionHostLivenessEvent` in `server/shared/types.ts`: `{ kind: 'session_host_liveness', change: 'snapshot' | 'live' | 'asleep', sessionIds: string[], at }`. The ids ride an array and not a `sessionId` key on purpose: `useProjectsState` marks a chat for attention when any frame carries a `sessionId` that is not the one on screen, and a host ending is no news in the chat. No `seq` and no `sessionId`, so it never becomes a transcript row or a mark. The fan-out copies `broadcastKanbanEvent`.

Silence while the API exits: a facade that settles under `isApiExiting()` was detached (D-10), not ended, so `asleep` is not pushed; the successor's snapshot, held until it has re-adopted, tells the pages.

Boundaries:
- A page whose socket reconnects (a token refresh does it) is sent a fresh snapshot by the new connection, so it never stands on a set the old socket left behind.
- The snapshot is HELD until the hosts are re-adopted: `whenHostsReadopted` is `server/index.ts`'s `whenHostsHeld`, the two events the running-sessions read waits behind (`whenRunsReadopted`, `whenNodeSessionsReadopted()`) with the same 11 s bound, one deadline per held socket and no polling. Without it a handover boot, which serves before its takeover while the predecessor drains, sent the empty set while tmux held every host, and every live row blinked gray for about half a second until re-adoption's `live` frames landed. A `live` that reaches a page before its snapshot is ignored (the set is unknown, so nothing is gray) and the snapshot, built after it, holds it. Past the bound the snapshot goes as it stands and late hosts arrive as `live` frames.
- A turn that falls back to an in-process CLI (the keepalive unit down) has no tmux session, so its chat reads asleep while it runs. The rule is "no live tmux session".
- Only Claude chats have hosts. The client grays a Claude row only; another provider's chat is never grayed.
- The client's set is `SessionHostLivenessContext` (mounted by App directly under `WebSocketProvider`, above the auth gate, so it has subscribed before the one snapshot a connection brings); `SidebarSimpleListRow` draws `data-asleep="true"` with the hover title `simpleList.asleep`.

Proof: `.verify/simple-list-live-gray-event.mjs` (a probe chat's own tmux session ended: the `asleep` frame on the page's socket, the row grayed, no page request in between, the next turn un-grays it) and `.verify/simple-list-live-gray-gate.mjs` (the real list, desktop and mobile, light and dark, held against `tmux ls`). A chat in a scratch folder under `/tmp` is kept out of every feed by `hidden-project-paths.ts`, so the event probe splices its own row into the page's feed response; the frames, the host and the set are real.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host-liveness.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/spawner.ts

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
| The host cannot start the CLI (a missing binary, EACCES) | Node's `spawn` error message rides the host's `exit` frame as `error` (`code`/`signal` null); the API emits it as the spawn error, so the client reads `Failed to spawn Claude Code process: spawn … ENOENT`, not a bare "exited with code N". On this machine a project folder that is gone never gets this far: the run loop refuses it first, in plain words, naming the folder (providers MANUAL, "A chat whose project folder is gone"). Where that check does not run (a node's project, a folder removed after it), the host itself names the folder when the spawn error is ENOENT, EACCES or ENOTDIR and its `cwd` is not a directory it can enter: `the working folder <cwd> does not exist or cannot be entered (spawn … ENOENT)` (`explainSpawnError`, host.js), because Node's own `spawn <binary> ENOENT` blames a binary that is fine |
| A session row deleted while its host lives | Re-adoption finds no row: `end_input`, then SIGTERM; the files are swept next boot |
| Journal growth | Bounded by one CLI lifetime — one per CONVERSATION, since every message joins the process already running for its session (`claude-runtime.provider.js`, `chat-process.ts`). Deleted by the attached adapter on `exit` or by the next boot's sweep. A CLI ends after two hours without a message (`CLAUDE_CHAT_IDLE_CLOSE_MS`, or `options.idleCloseMs` on the turn), never while a task or watcher is running in it; after its EOF, `BG_WAIT_CEILING_MS` (30 min) bounds anything that slipped in |
| A node's warden link drops mid-turn (`systemctl restart cerberus-warden`, a tailnet blip) | The channel closes `link lost`; the turn stays unsettled and client frames are held for 60 s. When the node's link returns the channel re-opens `hello { fromSeq: <last seq this facade saw> }` (`"acked"` for a re-adoption that has heard no line yet) and the stream resumes with no line twice and none missed. Past 60 s: the error `<node>'s warden was not reachable again within 60 s`, then `'exit'(null,'SIGHUP')` — the host, still alive on the node, is an idle CLI no API holds |
| This API restarts, or is handed over, while a node's turn runs | The warden ends its channel sockets with the lost link (a detach: the host keeps the CLI and journals). When the warden links to the new process, `[keepalive] node <node>: re-adopted N host(s)` registers each host's run and the turn resumes from `"acked"`; a host whose turn had already reported completes at once. Until then the running-sessions read is held (at most 11 s). A node that does not link in time is answered without — and its hosts are adopted whenever it does |
| A message starts a turn on a node's session between the node's link-up and its re-adoption | Refused as the spawn error with "<node>'s sessions are being re-adopted — send the message again in a moment"; nothing is spawned beside the live host. If the message's turn already held the session when the pass registered its runs, the live host waits and is re-adopted when that turn ends (§"Node hosts come back" — "A message in the window") |
| A node host closes its socket with no `exit`, or its warden refuses the open (no session server, host gone) | Not a link loss, so no grace: the warden's own sentence as the error, then `'exit'(null,'SIGHUP')`, at once for a host that had spoken; the same sentence as the spawn error for one that had not |
| A turn needs a NEW CLI and the node's warden is not connected | Refused with "<node>'s warden is not connected — this project's sessions run on <node>", delivered as the spawn error (`Failed to spawn Claude Code process: …`); nothing runs locally. A message to a chat whose CLI already runs joins it and is held by the grace above instead |
| The warden sends no frame within 15 s of an open | "<node>'s warden did not start the session within 15 s", the same ending as the refusal above |
| A node's warden link drops before its first frame | "The link to <node>'s warden was lost before the session started" as the spawn error; no grace, no re-open |

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/keepalive-cases-p4.mjs

## MAN-694 — See also
section: README/012 See also

- [`docs/MANUAL.md (hosting)`](../../../../../../docs/MANUAL.md) §"What runs", §"Rules that bite" — the
  unit, the stop switch, what a restart now costs a turn
- [`docs/MANUAL.md (verification)`](../../../../../../docs/MANUAL.md) §"The keepalive cases" — how
  each ending above is driven against the real units
- [`docs/architecture/MANUAL.md (02-realtime-stream)`](../../../../../../docs/architecture/MANUAL.md)
  §"One run, end to end" — why a re-adopted run restarts `seq` at 1
- MAN-7897 (`cloudcli:warden`) — the warden's sessions module, the host registry's second runner, and
  `cerberus-warden-sessions.service`
- MAN-7901 (`cloudcli:server/modules/cerberus`) — `nodeSessions`, center's relay, and a project's node
  (`projects.node`, `PUT /api/projects/:projectId/node`)
- MAN-7807 (`cloudcli:server/modules/cerberus`) — the node frames' body types

## MAN-7911 — Node chat probe — .verify/cerberus-node-chat.mjs

A Haiku chat in a project assigned to `eis1`, through eis1's warden, against the real units (`cerberus-warden`, `cerberus-warden-sessions`, `cloudcli-server-dev`). Proves the node transport (§"The node transport").

```
node .verify/cerberus-node-chat.mjs --evidence <dir>
```

Needs: the scratch project `~/.claude/state/test-projects/cerberus-node-probe` with a `projects` row (open one chat there first, else it throws); `eis1` enrolled and co-located; `sudo -n systemctl` for `cerberus-warden`. No `--evidence` exits 2. Each line prints as `KEY value`; `results.json` and per-step files land in `<dir>`.

| Key | True when |
|---|---|
| `assigned` | `PUT /api/projects/<id>/node` answered 204 |
| `host_in_warden` | `tmux -L cerberus-warden ls` lists the chat's host while the turn runs |
| `host_in_local` | `tmux -L cloudcli-sessions ls` lists it too — must be `false` |
| `host_meta` | the host's meta sits in `~/.cerberus-warden/sessions` |
| `reply_ready` | the transcript holds the reply to "Reply with the word ready." |
| `grace_held` | warden stopped: a message in the live chat is held, no reply, no refusal |
| `grace_delivered` | warden started again: that message is answered |
| `ready_reply_count` | how many `ready` replies the transcript holds; 1 means the first was not repeated |
| `refused` | warden stopped past 60 s: the next message shows "eis1's warden is not connected — this project's sessions run on eis1" |
| `chat_deleted`, `node_restored` | cleanup ran; `node_restored` is the project's original node, `false(status=…)` when the PUT failed |

`cleanup()` is idempotent, synchronous, and runs from `finally` and from `SIGINT`/`SIGTERM`/`SIGHUP`. The console is opened with `launchOptions: { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }`: Playwright's own SIGINT handler exits the process before any async cleanup runs, which left the real warden stopped. The signal handler runs `cleanup()` to its end and exits 130. Its order puts the one thing whose absence the fleet feels at once first:
1. `sudo -n systemctl start cerberus-warden`;
2. kills the tmux sessions named `<chatId>-*` in the warden's server (the warden sweeps a dead host's files at its next start or link-up, never on a timer);
3. PUTs the node the project had at start;
4. deletes the chat.

Steps 3 and 4 use a token of the proof's own (`loginToken()`, `.verify/lib/whole-check-kit.mjs`), never the page's, so a signal that lands while the page is mid-navigation still gives the node back.

The `refused` step sleeps 66 s past the 60 s grace. Chats are launched in the scratch project, never in a real one (AGENTS.md "Probes run on Haiku").

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-node-chat.mjs

## MAN-7924 — Node proof on /opt/eis-app — .verify/cerberus-eis-proof.mjs

The sessions plan's ruling 5, end to end on the REAL project `/opt/eis-app`: assigned to `eis1` from the node card, a Haiku chat whose CLI the warden spawned, `sudo systemctl restart cloudcli-server-dev`, and the same CLI answering the next message. Against the real units (`cloudcli-server-dev`, `cerberus-warden`, `cerberus-warden-sessions`). Proves the node transport (MAN-7911) and re-adoption (MAN-7916) on a project the operator owns.

```
node .verify/cerberus-eis-proof.mjs --evidence <dir> [--project <path>] [--assign card|api] [--cleanup]
```

| flag | meaning |
|---|---|
| `--evidence <dir>` | required; `steps.txt` (every command and its answer) and the screenshots land here |
| `--project` | default `/opt/eis-app`; the only other value allowed is a normalised path under `~/.claude/state/test-projects/` (no `..`, no `'`: it is interpolated into the `sqlite3` SQL) |
| `--assign card\|api` | default `card`; `api` is `PUT /api/projects/<id>/node`, required for a scratch project (a hidden root is not offered by the card's menu) |
| `--cleanup` | scratch project only: kills the chat's hosts, deletes the chat, puts the node back. Refused on `/opt/eis-app` — it would undo the deliverable |

Exit 0 pass, 1 a step failed, 2 usage. A valueless flag reads as `''` and is refused, never defaulted. why: AGENTS.md "Probes run on Haiku" keeps turns out of real projects; this driver is the one named exception.

## Needs

- A `projects` row for the project in `~/.cloudcli/auth.db`; `sqlite3`, `tmux`, `journalctl -u cloudcli-server-dev`, `sudo -n systemctl restart cloudcli-server-dev`.
- `eis1` enrolled, its warden live, and co-located (MAN-7920).
- Two turns are ever sent, "Reply with the word ready." then "Reply with the word again.", both on Haiku.
- Both go out BARE. The dev account stores `plainMode: true`, which sends each as `/plain <prompt>` with the whole skill text in the project's permanent transcript. The driver pins `plainMode: false` for its page only (`openConsole({ preferences: { ...HARNESS_PREFERENCES, plainMode: false } })`, nothing written to the account) and `requireBareComposer()` refuses to send unless the composer's Plain chip reads `aria-pressed="false"`.

## Steps

| step | does | fails when |
|---|---|---|
| 1 | `projectRow()` before; Cerberus tab, `eis1` expanded, project picked from "Run a project here"; `projectRow()` after | the row does not read `<project>\|eis1` |
| 2 | `createScratchChat` in the project, Haiku, send "ready"; `tmux -L cerberus-warden ls`, `tmux -L cloudcli-sessions ls`, `ps` of the host and its CLI; transcript | no host in the warden's tmux in 60 s; no CLI pid in the host's meta in 20 s; the chat's id is in `cloudcli-sessions`; no `ready` reply in 90 s |
| 3 | `sudo -n systemctl restart cloudcli-server-dev`; journal `[keepalive]` lines | no `[keepalive] node eis1: re-adopted 1 host(s)` in 120 s |
| 4 | reopen the chat, reselect Haiku, send "again"; CLI pid before, right after the restart, after the reply; `ps -o pid,lstart=` | no `again` reply in 90 s; the pids differ |
| 5 | node card's warden line; screenshots at 1440×900 and 390×844 | the line never reads `1 session running here` in 60 s |

Evidence in `<dir>`: `steps.txt`, `step1-card-assigned.png`, `step5-node-card-<1440x900|390x844>-top.png`, and `…-projects.png` when the card is taller than the viewport minus 80 px. After step 5 `steps.txt` lists every failed response (`>= 400`) and failed request, and every signed-in console error, the login `token=` redacted.

- The transcript is read from `~/.claude/projects/<project path with / and . as ->/*.jsonl`, the file that holds the first prompt.
- A fresh chat answers `GET /api/providers/sessions/<id>/token-usage` with 404 until it has a transcript; two console 404s are that.

## `cleanup()`

1. Only with `--cleanup`.
2. A passing run: kills `tmux -L cerberus-warden` sessions named `<chatId>-*`, waits 3 s, deletes the chat. why: a CLI alive at the delete writes a transcript stub back into the project's folder.
3. A failing run keeps its chat and host (the transcript says why).
4. PUTs the node the project had at start.

## `.verify/lib/node-card.mjs`

| export | does |
|---|---|
| `openCerberusTab(page)` | `openTab(page, 'Cerberus')`, else `More views` menu → `Cerberus` (the tab is last on the house row, behind the menu at the sidebar's width) |
| `openNodeCard(page, nodeId)` | opens the tab, closes then presses open the node's header button (`aria-expanded`), answers the card locator |
| `findOpenCard(page, nodeId)` | the open card, no navigation |
| `assignFromCard(page, card, projectPath)` | "Run a project here" → the menu row whose path line is exactly `projectPath` → waits for the tile; throws naming the offered rows when absent |
| `wardenLineText(card)` | the header button's text, ending in the counted sentence while hosts live there |

- The "Run a project here" menu is portalled and closes on the page's first scroll, and a click that scrolls its trigger into view makes that scroll. `assignFromCard` scrolls the trigger into view, waits 900 ms, clicks, and retries up to 4 times until the menu stays open.
- Every selector is the visible English label, which `openConsole` pins (`prefs-pin.mjs`).
- The page restores the last workspace tab, so after the card the chat's link opens onto the Cerberus tab: `openScratchChatOnHaiku` clicks the `Chat` tab (MAN-7452).

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-eis-proof.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/node-card.mjs
