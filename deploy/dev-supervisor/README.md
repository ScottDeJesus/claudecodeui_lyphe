# dev-supervisor — handover restarts for the dev API

`ExecStart` of `cloudcli-server-dev.service`. It watches `server/`, and when something changes it
boots the edited server **beside** the running one, then retires the old one only once the new one
is listening. A save under `server/` therefore never leaves `:3011` unanswered, and a save that
does not compile leaves the previous server serving.

This replaces `tsx watch`, which killed first and booted after. Two costs came out of that order:

- every edit was a gap on the port — one to two seconds in which the browser's WebSocket dropped
  and any request in flight was refused;
- a broken edit was an **outage**, not a warning: the old server was already dead when the new one
  failed to parse, and nothing was listening until the syntax error was fixed.

Both are properties of the ORDER, not of the watcher, so the fix is the order: boot, prove, retire.

## The state machine

Three variables in `supervisor.mjs` hold everything:

| Variable  | Meaning |
| --------- | ------- |
| `serving` | the child that answered READY and holds the port |
| `pending` | a child still booting; nothing listens on its behalf yet |
| `queued`  | an edit arrived while a boot or a retirement was in flight |

```
       ┌──────────────────────── change (debounced) ────────────────────────┐
       │                                                                    │
       ▼                                                                    │
  spawn child ──► READY? ──yes──► predecessor? ──no──► serving pid ─────────┤
  (pending)         │                   │                                   │
                    │                   └──yes──► SIGTERM old               │
                    │                              └─ old exit ──► takeover ┤
                    │                                              (serving)│
                    └──no (exit / 30 s)──► keep the old, log, wait ──────────┘
```

- **on change** — if a child is already booting, that child is stopped and the boot restarts (it
  loaded the previous version of the edited file, so there is nothing to salvage). If a retirement
  is finishing, the edit is queued and the running cycle picks it up. Otherwise a boot starts.
- **on READY with a predecessor** — the old child gets SIGTERM. In **its exit handler**, and only
  there, the new child is sent `takeover`. Not one moment earlier: until the old process is gone
  its keepalive hosts are live, and the successor's re-adoption would end those sessions with
  SIGHUP (`session-host/host.js:198-204`, `spawner.ts:200-208`).
- **on READY with no predecessor left** — what the child was TOLD at spawn decides this, never the
  supervisor's state at READY. A first boot was told nothing and ran its duties before it listened,
  so nothing is sent. A child spawned *beside* a predecessor that then died on its own mid-boot is
  still holding those duties with nobody left to release it, so it gets its `takeover` here — the
  rule was only ever "after the old process is gone", and it is gone.
- **on exit-before-READY or timeout** — the old server is untouched and keeps serving. One line.
- **on a serving child's exit** — one line, then wait for the next change. No automatic restart.
- **on SIGTERM / SIGINT** — close the watcher, stop every child, *await* their exits, exit 0.

Readiness is the child's own word over IPC and nothing else. With two servers sharing the port an
HTTP probe cannot say **which** of them answered, so a probe can never be the retirement trigger.

## The two environment bits

Both are read once at load by `server/supervised-boot.ts`, and both count **only** alongside a live
IPC channel (`typeof process.send === 'function'`). A bit left exported in a shell, or inherited by
a by-hand `npm run server:dev`, must never make a plain boot share `:3011` with the unit's child.

| Bit | Set on | Effect in the child |
| --- | ------ | ------------------- |
| `CLOUDCLI_SUPERVISED=1` | every child | listens with `reusePort: true`, and sends `ready` as the first statement of the listen callback |
| `CLOUDCLI_HANDOVER=1` | only a child spawned beside a serving one | defers re-adoption, the scheduled-message dispatcher and plugin startup until `takeover` |

`child.mjs` **deletes** the handover bit when it does not apply rather than leaving it unset: a
stray one in the unit's environment would park every first boot forever, waiting on a takeover no
predecessor exists to trigger.

`TSX_TSCONFIG_PATH=<repo>/server/tsconfig.json` is set on every child too — that is how tsx's
loader resolves the `@/*` alias. `--tsconfig` is a flag of the tsx *CLI*, which is not in play here.

## The two IPC messages

`stdio: ['ignore', 'inherit', 'pipe', 'ipc']`.

- child → supervisor: `{ type: 'ready', pid }` — exactly once, from the listen callback.
- supervisor → child: `{ type: 'takeover' }` — exactly once per handover child, after the previous
  child's `exit` event.

Any other shape is ignored on both sides. stdout stays **inherited** so the child's own pid remains
on its journal entries (`_PID`); only stderr is piped, so a failed boot can be explained in one
line, and it is relayed unedited.

## Every log line

All on stdout, all prefixed `[supervisor] `:

```
watching <abs dir>
change: <rel path>
boot: pid <n>
serving pid <n>                                  first boot ready — it holds the port
handover: pid <new> ready — retiring pid <old>
retired pid <old> (<exit code|signal>)
handover complete — serving pid <new>             only once the takeover has landed
boot failed — previous server kept: <first error line>
boot failed — no previous server: <first error line>
boot timed out after 30 s — <previous server kept|no previous server>
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

Three more go to stderr, kept out of the list above because they report on the machinery rather
than on the state: `watch error on <dir>: …` (the tree became unwatchable — the API serves on,
blind to further edits), `child pid <n>: …` (a ChildProcess error after READY, when there is no
boot left to fail) and `takeover to pid <n> failed: …` (the channel closed before the message
landed — a successor that died inside the retirement window, whose own exit line and empty `serving`
slot already tell the truth; the completion line above is withheld rather than name a dead pid). Everything the children themselves write is relayed untouched.

## The three constants

| Constant | Value | Home | Why |
| -------- | ----- | ---- | --- |
| `DEBOUNCE_MS` | 300 | `watch.mjs` | one save is several inotify events; a checkout is hundreds |
| `BOOT_TIMEOUT_MS` | 30 000 | `child.mjs` | a healthy boot is ~1-4 s here; this only has to outlast the slowest honest one |
| `STOP_TIMEOUT_MS` | 10 000 | `child.mjs` | SIGTERM, then SIGKILL — a server that will not close its sockets still has to go |

Each lives in the module that consumes it, because `watchServerDir(dir, onChange)` and
`spawnServer({ repo, handover })` take no tuning arguments. One line each to change.

## When things go wrong

| Situation | What happens |
| --------- | ------------ |
| **Broken edit** (syntax error) | the child exits before READY; `boot failed — previous server kept: Error: Transform failed with 1 error:`; the old server keeps serving; the next save boots again (measured) |
| **Coalesced edits** (save, save, save) | the 300 ms trailing debounce makes one boot; an edit landing mid-boot stops that child and restarts the boot (`change during boot`) |
| **Boot timeout** | after 30 s the pending child is stopped and the old one kept; `boot timed out after 30 s` |
| **Crash after READY** | one line, then the supervisor waits for the next change. It never auto-restarts — a server that crashes on this code crashes again on it, and a crash loop is what the watchdog's three-heal rule exists to catch |
| **First boot fails** (nothing serving) | `boot failed — no previous server: …`. The supervisor stays alive, so `Restart=always` does not turn a broken edit into a 5-second crash loop. Nothing is listening, so the API canary fails and `/usr/local/bin/cloudcli-dev-watchdog.sh` heals the unit on its own 60 s timer — that script is never edited by this package |
| **Predecessor crashes mid-boot** | its exit line prints, then the booting child — which deferred its duties on the word it was given at spawn — is released the moment it is READY (`handover complete — serving pid <n>`, then `[keepalive] taking over`). Measured against a stand-in: without that release the API serves with its keepalive hosts unadopted for good |
| **`systemctl restart`** | `KillMode=control-group` (the default) ends the supervisor and both children together. Accepted: a restart is a restart, and chat sessions survive it through the tmux keepalive |
| **Supervisor dies mid-boot** | the child's `signalReady()` finds the channel gone, logs once and serves anyway; a deferred child logs `supervisor channel closed before takeover` and stays deferred rather than stealing the predecessor's hosts |

At rest there is exactly one child: `ps -o pid= --ppid $(systemctl show -p MainPID --value
cloudcli-server-dev)` prints one line. Two is the handover window and lasts about a second.

## SO_REUSEPORT

The overlap is possible because both children bind with `reusePort: true`, so the kernel lets two
sockets share `:3011` and load-balances new connections across them. **Linux-only** — as is the
recursive `fs.watch` in `watch.mjs`. This whole package targets this host's systemd unit.

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
sudo cp /home/lyphe/.claude/claudecodeui_lyphe/deploy/systemd/cloudcli-server-dev.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl restart cloudcli-server-dev
systemctl status cloudcli-server-dev            # → active
journalctl -u cloudcli-server-dev -f            # → [supervisor] serving pid <n>
```

Prove a handover: `bash .verify/handover/smoke.sh` → `HANDOVER old=<pid> new=<pid> seconds=<n>`.

## See also

- [docs/hosting.md](../../docs/hosting.md) §"Rules that bite" — the one rule this puts on a person
  editing `server/`, and §"What runs" for the unit's place among the dev services and the watchdog
  that heals a first boot this package deliberately does not retry.
- [docs/verification.md](../../docs/verification.md) §"The handover cases" — the five cases that
  drive every row of the failure table above against the live unit, what each one edits, and the
  seam probe that reaches the modes a working supervisor never produces.
- [`session-host/README.md`](../../server/modules/providers/list/claude/session-host/README.md)
  §"Re-adoption, on boot" — the duty `takeover` releases, and why it cannot be released sooner.
