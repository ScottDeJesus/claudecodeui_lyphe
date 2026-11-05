# dev-supervisor — handover restarts for the dev API

`ExecStart` of `cloudcli-server-dev.service`. It watches `server/`, and when something changes it
boots the edited server **beside** the running one, then retires the old one only once the new one
is listening. A save under `server/` therefore never leaves `:3011` unanswered, and a save that
does not compile leaves the previous server serving.

A builder's save is also **held while the running server is busy**. Kaylee in a turn, a chat run
streaming, his press open or her voice sounding on her panel, and the quiet tail after anything said or
typed to her: a swap in the middle of any of those cuts him off mid-sentence, so the server tells the
supervisor when it turns busy and when it turns quiet, and a save waits for the quiet. Every save made
meanwhile joins the same wait, so one restart carries every change since the last. His own **Restart
server** press, the update pipeline's reboot, `systemctl restart` and a deploy are never held — only
saves are. What counts as busy, and why each part does, is [`server/modules/restart-hold`](../../server/modules/restart-hold/restart-hold.service.ts).

This replaces `tsx watch`, which killed first and booted after. Two costs came out of that order:

- every edit was a gap on the port — one to two seconds in which the browser's WebSocket dropped
  and any request in flight was refused;
- a broken edit was an **outage**, not a warning: the old server was already dead when the new one
  failed to parse, and nothing was listening until the syntax error was fixed.

Both are properties of the ORDER, not of the watcher, so the fix is the order: boot, prove, retire.

## The state machine

Six variables in `supervisor.mjs` hold everything (the save queue is `createSaveHold` in `hold.mjs`):

| Variable          | Meaning |
| ----------------- | ------- |
| `serving`         | the child that answered READY and holds the port |
| `pending`         | a child still booting; nothing listens on its behalf yet |
| `queued`          | a reboot request arrived while a boot or a retirement was in flight |
| `rebootRequester` | the serving child that asked for the cycle now running; it is owed an answer if that cycle's boot fails |
| `reportedReasons` | per child, what it last said it is busy with (`busy` reasons, or `[]` for `quiet`); absent until it reports, and absent counts as quiet |
| `saves`           | the settled saves waiting for a quiet server: how many, when the first settled (the ceiling's clock), and whether the journal has said what they wait on |

```
   save (debounced) ──► saves ──serving quiet?──yes──┐         reboot request ─────────┐
                          ▲            │no           │                                 │
                          │     "change held" ◄──── a report / a cycle's end / ceiling│
                          │                          ▼                                 ▼
  spawn child ──► READY? ──yes──► [save: serving busy again? stop it, saves wait] ─► predecessor? ──no──► serving pid
  (pending)         │              (a boot carries the saves settled before it)         │
                    │                                                                   └──yes──► SIGTERM old
                    │                                                                          └─ old exit ──► takeover
                    └──no (exit / 30 s)──► keep the old, log, wait
```

- **on a settled save** — the watcher's trailing debounce has passed. The save joins `saves`. If the
  serving child reports quiet, never reported, or none is serving, the saves go at once: a boot
  starts. Otherwise the journal says what they wait on (`change held`), once per wait, and they stay
  until the serving child reports quiet. Nothing polls: the question is asked again on a save, on
  every report from the serving child, when a cycle ends and when the serving child dies; the one
  timer is the ceiling below.
- **a boot carries the saves settled before its spawn** — it loads the code on disk, which already holds
  them, so they wait no more, whichever kind of boot it is: a reboot request's boot (his **Restart
  server** press) carries the held saves and the cycle's end does not release them into a second
  restart. A save that settles while a cycle runs waits for the cycle to end and is then asked about
  again; the server it is asked of is the new serving child, which says it is busy until its takeover
  duties are done (below), so the cycle's end never reads a false quiet.
- **a boot for a save** — when its successor is READY the serving child is asked again. If it went
  busy during those few seconds, the successor is **stopped** and the saves wait again, on their old
  clock (`pid <new> is ready, but the server went busy while it booted — stopping it`): two servers
  never share the port for as long as a conversation lasts, and the successor's duties wait for a
  takeover that only a retirement sends. The cost is one more boot, a few seconds, when it is quiet.
- **the ceiling** — chat runs survive a handover on their keepalive hosts, so they are the one reason a
  child marks `yields`: once a save has been held `CEILING_MS` (30 minutes) they stop counting, and the
  save goes as soon as nothing else is busy. Kaylee's turn, his press, her voice and the quiet tail
  never stop counting. Measured over the last day: chat runs alone would have held 11 of 23 saves
  past 30 minutes, the longest 128 (`.verify/restart-hold-waits.mjs`).
- **on a serving child's `reboot`** — a boot started at once, asked for over IPC instead of by the
  watcher, and never held: it enters at the same point and follows the same three rules. If a boot
  is already pending that child is stopped and the boot restarts (it loaded code from before the
  request). This is how the update pipeline and the **Restart server** press restart the API, and
  the one case where the requester is owed an answer (see the messages below).
- **on READY with a predecessor** — the old child gets SIGTERM. In **its exit handler**, and only
  there, the new child is sent `takeover`. Not one moment earlier: until the old process is gone
  its keepalive hosts are live, and the successor's re-adoption would end those sessions with
  SIGHUP (`attach` in `session-host/host.js` ends the older socket; the socket `close` handler in
  `session-host/spawner.ts` settles that turn with `SIGHUP`). The old child does not exit at once
  when Kaylee is mid-turn: it lets that turn finish (60 s at most) and only then exits, so the
  `takeover` can come that much later. The successor serves meanwhile and holds Kaylee's pushes
  until it (see the failure table).
- **on READY with no predecessor left** — what the child was TOLD at spawn decides this, never the
  supervisor's state at READY. A first boot was told nothing and ran its duties before it listened,
  so nothing is sent. A child spawned *beside* a predecessor that then died on its own mid-boot is
  still holding those duties with nobody left to release it, so it gets its `takeover` here — the
  rule was only ever "after the old process is gone", and it is gone.
- **on exit-before-READY or timeout** — the old server is untouched and keeps serving. One line.
- **on a serving child's exit** — one line, then wait for the next change. No automatic restart.
- **on SIGTERM / SIGINT** — close the watcher, stop every child, *await* their exits, exit 0. A
  serving child gets `STOP_TIMEOUT_MS` (75 s: a turn of Kaylee's in flight is let to finish first)
  before SIGKILL, inside systemd's own 90 s stop window; a child that never became ready gets the
  short `BOOT_STOP_TIMEOUT_MS` (10 s).

Readiness is the child's own word over IPC and nothing else. With two servers sharing the port an
HTTP probe cannot say **which** of them answered, so a probe can never be the retirement trigger.

## The two environment bits

Both are read once at load by `server/supervised-boot.ts`, and both count **only** alongside a live
IPC channel (`typeof process.send === 'function'`). A bit left exported in a shell, or inherited by
a by-hand `npm run server:dev`, must never make a plain boot share `:3011` with the unit's child.

| Bit | Set on | Effect in the child |
| --- | ------ | ------------------- |
| `CLOUDCLI_SUPERVISED=1` | every child | listens with `reusePort: true`, and sends `ready` from the listen callback once `cerberus.start()` has bound the warden gateway (waited for at most 3 s; MAN-7804) |
| `CLOUDCLI_HANDOVER=1` | only a child spawned beside a serving one | defers `soleServerDuties` (`server/index.ts`) until `takeover`: re-adoption, the sleep-time auto-close of unpinned chats, the scheduled-message dispatcher, plugin startup, the update reconciler, Center's own checks and red watch and Kaylee's re-send of the words her last process never answered. Until `takeover` Kaylee's sessions also launch nothing (a second CLI on the conversation the retiring child is still finishing would fork it): what he says meanwhile is kept on disk and said by the takeover, in order |

`child.mjs` **deletes** the handover bit when it does not apply rather than leaving it unset: a
stray one in the unit's environment would park every first boot forever, waiting on a takeover no
predecessor exists to trigger.

`TSX_TSCONFIG_PATH=<repo>/server/tsconfig.json` is set on every child too — that is how tsx's
loader resolves the `@/*` alias. `--tsconfig` is a flag of the tsx *CLI*, which is not in play here.

## The six IPC messages

`stdio: ['ignore', 'inherit', 'pipe', 'ipc']`.

- child → supervisor: `{ type: 'ready', pid }` — exactly once, from the listen callback.
- supervisor → child: `{ type: 'takeover' }` — exactly once per handover child, after the previous
  child's `exit` event.
- child → supervisor: `{ type: 'reboot', reason }` — the serving child asking to be replaced by a
  fresh boot of its own code, which is how the update pipeline's **Restart server** restarts the
  API. Honoured **only** from the child that is `serving` when the message arrives, and only when
  `reason` is a string: any other shape, and the same message from any other child, is ignored. The
  boot it starts is the edit cycle exactly, and the reason reaches the journal on one line whatever
  it holds.
- supervisor → child: `{ type: 'reboot-failed', detail }` — the answer owed to that requester when
  the boot its request started did not come up: the first error line of that boot, or
  `boot timed out after 30 s` when it hung. The requester keeps serving throughout. A request whose
  boot succeeds is answered by the handover instead — retire, `takeover`, `handover complete`.

- child → supervisor: `{ type: 'busy', reasons: [{ why, yields }] }` and `{ type: 'quiet' }` — what the
  child is busy with, told at once when it turns busy and (after 3 s of staying empty, so work that
  hands on to more work is not read as a quiet instant) when it turns quiet, and **once right after
  `ready`** with the current picture, quiet included. `why` is a plain sentence the journal prints
  as given (bounded, line breaks flattened); `yields` is the ceiling's flag. Read from any child,
  acted on only for the serving one, and a `busy` that names nothing valid is ignored whole, never
  read as quiet. A child that never sends one (an older build) counts as quiet. A handover child
  says `busy` (`this server is still taking over from the previous one`) from `ready` until its
  `takeover` duties — re-adopting the chat runs, saying Kaylee's unanswered words again — are done,
  and quiet after the usual settle. The server's picture
  is also readable at any moment as `GET /api/restart-hold` → `{ busy, reasons }` (authenticated), which
  is how a restart of the whole unit picks a quiet moment.

Any other shape is ignored on both sides. stdout stays **inherited** so the child's own pid remains
on its journal entries (`_PID`); only stderr is piped, so a failed boot can be explained in one
line, and it is relayed unedited.

## Every log line

All on stdout, all prefixed `[supervisor] `:

```
watching <abs dir>
watching <n> directories under <dir>             the watches the watcher holds open
change: <rel path>                               a save settled (the debounce passed)
change held — waiting on: <reasons>              the serving child is busy; once per wait
held 30 min — chat runs no longer hold the restart   the ceiling passed and something else still holds
quiet — restarting for <n> held saves after <s> s    the serving child reported quiet; the cycle follows
nothing is serving — restarting for <n> held saves after <s> s   the serving child died; nothing is left to protect
this boot carries the <n> held saves             a reboot request's boot was spawned while they waited
reboot requested by pid <n>: <reason>            the serving child asked for this cycle
boot: pid <n>
serving pid <n>                                  first boot ready — it holds the port
pid <new> is ready, but the server went busy while it booted — stopping it; the saves wait again on: <reasons>
handover: pid <new> ready — retiring pid <old>
retired pid <old> (<exit code|signal>)
handover complete — serving pid <new>            only once the takeover has landed
boot failed — previous server kept: <first error line>
boot failed — no previous server: <first error line>
boot timed out after 30 s — <previous server kept|no previous server>
reboot failed — told pid <n>                     the requester keeps serving
change during boot — restarting boot
server pid <n> exited (<code|signal>) — waiting for the next change
boot aborted: <message>                          never expected: see below
stopping (<signal>)
```

The first error line is the first stderr line matching `/\b[A-Za-z]*Error\b/`, else the first
non-blank line, which lifts the reason out of the `node:internal/modules/run_main` frame that
precedes it. A failed boot's verdict waits for whichever lands second — the child's exit or the end
of its stderr — because the reason travels a pipe that need not be drained by the time the process
is reaped. That wait is bounded at 250 ms (`STDERR_DRAIN_MS` in `child.mjs`): a grandchild which
inherited the pipe can hold it open long after the API is gone, and a verdict must never hang on
one. It delays nothing but the losing boot's own log line — the previous server serves throughout. Know its one limit: a syntax error in a `server/` file reports as the esbuild wrapper
`Error: Transform failed with 1 error:`, and the line that names the file, line and column follows
it — esbuild spells that one `ERROR:`, which the pattern deliberately does not match, so the
summary is always the wrapper and never the location. The location is one line further down the
journal: `journalctl -u cloudcli-server-dev -n 20`.

`boot aborted` is defect insurance, not part of the protocol. A boot resolves its own failures into
the `boot failed` lines above, so this line can only mean a bug in the supervisor itself — and
without the catch behind it that bug would surface as an unhandled rejection, end this process, and
let `Restart=always` turn one bad edit into a five-second crash loop. Seeing it means read the code.

Five more go to stderr, kept out of the list above because they report on the machinery rather
than on the state: `cannot watch <dir>: …` (the watch could not be opened at all, so that directory
is invisible from the start — its parent reports an event naming it and it is walked again),
`watch error on <dir>: …` (an existing watch became unwatchable — that one watch is finished, the
rest of the tree serves on and the API stays blind to further edits there), `child pid <n>: …` (a
ChildProcess error after READY, when there is no boot left to fail), `takeover to pid <n> failed: …`
(the channel closed before the message landed — a successor that died inside the retirement window,
whose own exit line and empty `serving` slot already tell the truth; the completion line above is
withheld rather than name a dead pid) and `reboot-failed to pid <n> failed: …` (the requester's
channel closed between the connected check and the send — the request is dropped rather than retried,
because a child that has just lost its channel is on its way out and there is nothing left to
answer). Everything the children themselves write is relayed untouched.

## The constants

| Constant | Value | Home | Why |
| -------- | ----- | ---- | --- |
| `DEBOUNCE_MS` | 120000 | `watch.mjs` | two quiet minutes: a builder's burst of saves, or a checkout's hundreds of events, becomes one boot (operator, 2026-11-03) |
| `CEILING_MS` | 1 800 000 | `hold.mjs` | a save held this long stops counting the reasons marked `yields` (chat runs). Measured, not guessed: over the last day chat runs alone would have held 11 of 23 saves past it |
| `QUIET_TAIL_MS` | 90 000 | `server/modules/restart-hold` | the child's: how long after anything said or typed to Kaylee the server still counts as busy. Measured from her transcripts (`.verify/restart-hold-tail.mjs`): 85.4% of his returns to an idle her come within 90 s, half within 9 s |
| `BOOT_TIMEOUT_MS` | 30 000 | `child.mjs` | a healthy boot is ~1-4 s here; this only has to outlast the slowest honest one |
| `STOP_TIMEOUT_MS` | 75 000 | `child.mjs` | SIGTERM, then SIGKILL, for a SERVING child. Most of it is Kaylee's: the child lets her turn in flight finish before it exits (`COMPANION_TURN_BOUND_MS` 60 s, then her CLI's 5 s grace; `server/index.ts`), and the rest of its shutdown runs beside that wait. Inside systemd's 90 s stop window. With no turn in flight the exit takes 1-2 s. **Read once, at unit start**: a change here is live after `sudo systemctl restart cloudcli-server-dev` |
| `BOOT_STOP_TIMEOUT_MS` | 10 000 | `child.mjs` | the same for a child that never became ready (a failed or superseded boot): it holds no conversation, so a boot that ignores SIGTERM still goes quickly |

Each lives in the module that consumes it, because `watchServerDir(dir, onChange)` and
`spawnServer({ repo, handover })` take no tuning arguments. One line each to change. The child's 3 s
settle before it tells `quiet` (`QUIET_SETTLE_MS`) is the only other number in the protocol.

## When things go wrong

| Situation | What happens |
| --------- | ------------ |
| **Broken edit** (syntax error) | the child exits before READY; `boot failed — previous server kept: Error: Transform failed with 1 error:`; the old server keeps serving; the next save boots again (measured) |
| **Coalesced edits** (save, save, save) | the two-minute trailing debounce makes one settled save once no save has landed for two minutes. A save restarts that wait, and a boot (30 s at most) and a retirement (75 s at most: 1-2 s unless a turn of Kaylee's is finishing) both end inside it, so a save rarely settles mid-cycle; one that does waits for the cycle to end and is asked about again. `change during boot` is reached only by a `reboot` request from the serving API while a boot is pending |
| **Save while the server is busy** | `change: <path>`, then `change held — waiting on: <reasons>` (once). More saves add `change:` lines and nothing else. When the serving child reports quiet: `quiet — restarting for <n> held saves after <s> s`, then one ordinary cycle that carries every change since the last. Nothing restarts, and nothing is stopped or cut, while it waits |
| **Server goes busy while the successor boots** | the successor is stopped and the old server keeps serving alone: `pid <new> is ready, but the server went busy while it booted — stopping it; the saves wait again on: …`. The saves keep their clock (so the 30-minute ceiling still counts from the first), and the next quiet boots again. Nothing ever waits with two servers on the port |
| **Held more than 30 minutes** | chat runs stop counting (`held 30 min — chat runs no longer hold the restart` if anything else still holds); the save goes as soon as Kaylee's turn, his press, her voice and the tail are all clear |
| **A child that never reports** (an older build, or one that crashed before its first report) | counts as quiet: the save restarts it at once, which is how every save behaved before the hold |
| **Boot timeout** | after 30 s the pending child is stopped and the old one kept; `boot timed out after 30 s` |
| **Crash after READY** | one line, then the supervisor waits for the next change. It never auto-restarts — a server that crashes on this code crashes again on it, and a crash loop is what the watchdog's three-heal rule exists to catch |
| **First boot fails** (nothing serving) | `boot failed — no previous server: …`. The supervisor stays alive, so `Restart=always` does not turn a broken edit into a 5-second crash loop. Nothing is listening, so the API canary fails and `/usr/local/bin/cloudcli-dev-watchdog.sh` heals the unit on its own 60 s timer — that script is never edited by this package |
| **Predecessor crashes mid-boot** | its exit line prints, then the booting child — which deferred its duties on the word it was given at spawn — is released the moment it is READY (`handover complete — serving pid <n>`, then `[keepalive] taking over`). Measured against a stand-in: without that release the API serves with its keepalive hosts unadopted for good |
| **Requested reboot** (a serving child asking for its own handover: the update pipeline's restart, and his **Restart server** press) | never held. The cycle exactly: boot beside, READY, retire the requester, `handover complete — serving pid <new>`. Honoured only while the requester is still the `serving` child, so an answer can never land on a child that has already been replaced. With a save held, the cycle runs anyway and its boot carries the held save (`this boot carries the <n> held saves`): one restart, not two |
| **Requested reboot that fails to boot** | the requester is still serving, so it is told: `reboot-failed` carrying the boot's first error line (or `boot timed out after 30 s`), and the journal says `reboot failed — told pid <n>`. Nothing was retired and `:3011` keeps its server. What the requester does with that answer is its own affair — the update pipeline rolls the Agent SDK back from its `restarting` state; nothing in this package rolls anything back |
| **`systemctl restart`** and a deploy | never held. `KillMode=control-group` (the default) ends the supervisor and both children together; the supervisor's hold state goes with it. Accepted: a restart is a restart, and chat sessions survive it through the tmux keepalive |
| **Retiring server with Kaylee mid-turn** (his **Restart server** press, the update pipeline's restart, or a save whose quiet verdict was overtaken by a turn) | the old child lets her turn finish instead of cutting it: its journal says `the server is stopping; her turn in flight is let to finish (at most 60 s)`, then `her turn finished before her process closed`, and it exits; `retired pid <old> (0)` and `handover complete` follow, up to ~70 s after `handover: pid <new> ready`. Her sentences keep reaching the page over its socket (websockets close at the exit), the page's speech pulls are answered by the successor (the old listener is closed), and what he says meanwhile is kept and said by the successor at the takeover. A turn that does not end in 60 s is interrupted as before and his words are said again. Her own compaction turn is not waited for. The successor holds `GET /api/providers/sessions/running` for the whole window (`RUNS_READOPTED_WAIT_MS`, 76 s). Measured 2026-11-04 (`.verify/kaylee-restart-turn.mjs`). With an older supervisor process still holding the 10 s bound, the old child is `retired pid <old> (SIGKILL)` at 10 s and the turn is replayed |
| **Supervisor dies mid-boot** | the child's `signalReady()` finds the channel gone, logs once and serves anyway; a deferred child logs `supervisor channel closed before takeover` and stays deferred rather than stealing the predecessor's hosts |

At rest there is exactly one child: `ps -o pid= --ppid $(systemctl show -p MainPID --value
cloudcli-server-dev)` prints one line. Two is the handover window: near-instant with nothing in
flight on the retiring child, stretching up to its own drain bound (`HTTP_DRAIN_BOUND_MS`,
[`server/http-drain.ts`](../../server/http-drain.ts)) while an HTTP request it already accepted is
still finishing, and up to ~70 s while a turn of Kaylee's is finishing (the exit waits for her; the
rest of its shutdown does not).

## SO_REUSEPORT

The overlap is possible because both children bind with `reusePort: true`, so the kernel lets two
sockets share `:3011` and load-balances new connections across them. **Linux-only** — as are the
inotify semantics `watch.mjs` assumes. This whole package targets this host's systemd unit.

## The watcher is per directory, not `recursive: true`

`watch.mjs` keeps one plain `fs.watch` per directory under `server/` and adds one for each
directory that appears. It does not use Node's `recursive: true`: on Linux that is Node's own
walker with one watch per file, and an editor's atomic save (temp name, rename over the file)
replaces the inode and races that watch away — after which every in-place save of that file is
invisible until it is renamed again. Measured 2026-09-10: 343 watches held, none on a file an
editor had replaced an hour earlier, and three saves of it unseen while `touch` on a neighbour
handed over at once. A directory watch reports its children by name whatever their inode, so this
cannot recur. The journal says how many directories are watched on start:
`[supervisor] watching <n> directories under …/server`.

Each directory's watch is armed BEFORE it is listed (`watchTree`): a subdirectory born during the
walk is then in the listing, or reported by its parent's watch, or both — never neither. The other
order (list the tree, arm afterwards) loses a directory born in between for good; measured
2026-10-28, `server/modules/companion/session/` was created 1 ms after its parent and no save to
its files restarted the API for two days. The count in that journal line should equal the number
of directories under `server/` (node_modules aside).

One rough edge: a connection already queued on the retiring listener's accept queue when it closes
can see a reset instead of being served. The host-level cure is `net.ipv4.tcp_migrate_req=1`, which
migrates queued connections to a surviving listener. **This plan does not set it** — it is a
sysctl, not a repo change, and one reset in the handover second is cheaper than the browser's own
reconnect, which happens anyway.

## The child argv

Exactly what the previous watcher spawned, measured with `ps`:

```
/usr/bin/node \
  --require <repo>/node_modules/tsx/dist/preflight.cjs \
  --import  file://<repo>/node_modules/tsx/dist/loader.mjs \
  server/index.ts
```

`cwd` is the repo. The loader pair is used directly rather than the tsx CLI on purpose: through the
CLI the pid held here would be tsx's, the IPC channel would be tsx's, and SIGTERM would reach the
server through one more relay. tsx's `preflight.cjs` installs no signal handler when its parent is
not tsx, so the child's SIGTERM reaches `server/index.ts`'s own handler unchanged.

## Install

```sh
deploy/systemd/install.sh cloudcli-server-dev.service
sudo systemctl restart cloudcli-server-dev
systemctl status cloudcli-server-dev            # → active
journalctl -u cloudcli-server-dev -f            # → [supervisor] serving pid <n>
```

Prove a handover: `bash .verify/handover/smoke.sh` → `HANDOVER old=<pid> new=<pid> seconds=<n>`. It reads `DEBOUNCE_MS` from `watch.mjs` and waits that plus 30 s, so `<n>` is at least the debounce (120 on the two-minute setting). It saves a file, so it is a save like any other and waits for a quiet server: run it when `GET /api/restart-hold` (authenticated) says `busy: false`, or its window is too short.

## See also

- [docs/MANUAL.md (hosting)](../../docs/MANUAL.md) §"Rules that bite" — the one rule this puts on a person
  editing `server/`, and §"What runs" for the unit's place among the dev services and the watchdog
  that heals a first boot this package deliberately does not retry.
- [docs/MANUAL.md (verification)](../../docs/MANUAL.md) §"The handover cases" — the five cases that
  drive every row of the failure table above against the live unit, what each one edits, and the
  seam probe that reaches the modes a working supervisor never produces.
- [`server/modules/providers/list/claude/session-host/MANUAL.md (README)`](../../server/modules/providers/list/claude/session-host/MANUAL.md)
  §"Re-adoption, on boot" — the duty `takeover` releases, and why it cannot be released sooner.
