# Hosting — the dev server, as a service

CloudCLI is hosted as a **development** build, on purpose: the operator asked for edits to land
instantly rather than through a rebuild. Nothing here runs `npm run build`; the production
`dist/` path is unused.

## What runs

| Unit | What it is | Bind |
|---|---|---|
| `cloudcli-server-dev.service` | `/usr/bin/node deploy/dev-supervisor/supervisor.mjs` — the handover supervisor: it boots each edited server beside the running one and retires the old one only when the new one reports READY; the API and WebSocket gateway are its child | `127.0.0.1:3011` (loopback only) |
| `cloudcli-client-dev.service` | `node_modules/.bin/vite --host 0.0.0.0 --port 5183 --strictPort` — the client with HMR | `0.0.0.0:5183`, minus the Docker bridges (see below) |
| `cloudcli-dev-watchdog.timer` → `.service` | every 60 s, `/usr/local/bin/cloudcli-dev-watchdog.sh` re-asserts the bridge drop, probes `/api/cli-version` on :3011 (any HTTP answer = alive; three misses 5 s apart = dead) and `/src/main.tsx` on :5183 (200; two misses), and restarts the one unit whose canary failed — the supervisor survives a boot that never listened and never boots a replacement of its own, so a FIRST boot that fails leaves `:3011` unanswered with the supervisor still running (a later boot that fails is harmless: the previous server keeps serving), and Vite's transform can wedge, and in every case systemd still reads `active`. After three heals in a row it stops healing and leaves the unit `failed` with one distinct journal line | — |
| `cloudcli-sessions-tmux.service` | `/usr/bin/tmux -L cloudcli-sessions -f /dev/null new-session -d -s _keepalive sleep infinity` — a do-nothing session holding the tmux server that every chat CLI is spawned into, in a cgroup of its own so the API's restart cannot reach them. Each live turn adds a `<app session id>-<base36>` session beside `_keepalive`, with its socket, journal and meta under `~/.cloudcli/sessions` (mode 0700; `CLOUDCLI_SESSIONS_DIR` moves the directory). `sudo systemctl stop cloudcli-sessions-tmux` is the deliberate "end every live chat session" switch, and `CLOUDCLI_SESSION_KEEPALIVE=0` (or `off`/`false`) in the API's `.env` — unset here, so the feature is on — puts new turns back inside the API process | — (unix sockets under `~/.cloudcli/sessions`) |

The first two units read `.env` (`SERVER_PORT=3011`, `VITE_PORT=5183`, `HOST=127.0.0.1`,
`CLAUDE_CLI_PATH`, …), run as `lyphe` with `NODE_ENV=development`, the interactive shell's full
`PATH` (the app's shell tab and every spawned Claude session inherit the API unit's environment —
a chat CLI sits in the keepalive's cgroup but is handed that same environment when it is spawned),
`Restart=always`, `StartLimitBurst=5` in a 120 s window (a crash loop latches `failed` instead of
restarting unseen forever; the watchdog resets and retries), and start at boot. The client and
the watchdog live in `/etc/systemd/system/` only — no copy of either is kept in this repo. Two
units this repo does ship, each installed by copying into `/etc/systemd/system/` and each
carrying its own exact commands in its header comment:
[`deploy/systemd/cloudcli-server-dev.service`](../deploy/systemd/cloudcli-server-dev.service) —
the `ExecStart` that runs the supervisor, an *existing* unit, so `daemon-reload` + `restart`
rather than `enable --now` — and
[`deploy/systemd/cloudcli-sessions-tmux.service`](../deploy/systemd/cloudcli-sessions-tmux.service),
which is new to systemd and therefore `enable --now`. Both commands are in the Runbook below.

The client is the only port the LAN needs: `vite.config.js` proxies `/api`, `/ws`, `/shell` and
`/plugin-ws` to the API on loopback, so the API never faces the LAN. The app is reachable at
`http://<this host>:5183` on the LAN and over Tailscale, and as the **CloudCLI** tile in the
Applications Hub (`~/.claude/hub/apps.json`, `http://{host}:5183`).

## Rules that bite

- **Vite 7 quits on end-of-file on stdin.** Its CLI treats EOF as "the parent went away";
  systemd hands services `/dev/null`, which is EOF at once, so a plain `ExecStart=npx vite …`
  exits 0 within half a second and restart-loops forever. The client unit therefore runs
  `bash -c 'exec node_modules/.bin/vite … < <(sleep infinity)'` — the bin itself, not `npx`, so
  the main PID is node running Vite and `Restart=` sees Vite die; the `sleep` is a sibling in the
  cgroup and dies with it on stop. The EIS dev unit needs none of this because it runs Vite 5.
- **A client edit is instant** (HMR over the page's own host); **a server edit hands the API
  over.** The supervisor boots the edited server *beside* the running one and retires the old one
  only once the new one reports READY, so `:3011` is never unanswered: the journal reads
  `[supervisor] change:` → `boot:` → `handover:` → `retired` → `handover complete — serving pid
  <n>`. A broken edit never reaches READY, so the previous server goes on serving and the whole
  event is one line — `[supervisor] boot failed — previous server kept: <first error line>` — with
  the next save booting again. The retired process still takes its WebSocket connections with it,
  so the browser drops and reconnects in about 3 s — onto a port that is already answering — and
  the git-delegation run store re-subscribes on `websocket_reconnected` (see `git-panel.md`). The
  state machine, every log line, the two environment bits and the failure table are in
  [`deploy/dev-supervisor/README.md`](../deploy/dev-supervisor/README.md), the mechanism's one
  home. What the same handover costs a Claude turn already in flight is its own rule below.
- **`--strictPort` is deliberate.** The `.verify/` harness and the Hub tile are pinned to 5183;
  a drift to 5184 would pass silently and break both.
- **Vite 7 refuses any `Host` header that is not an IP or `localhost`.** The Hub frames the app
  under whatever name the Hub was opened on, so `vite.config.js` allows `eis1` and this
  tailnet's MagicDNS name, `eis1.tail8717cd.ts.net` (`server.allowedHosts`); any other name
  renders Vite's "Blocked request" page in the tile.
- **The wildcard bind reaches the Docker bridges too** (`172.17-20.0.1`, 19 containers, several
  third-party images, no host firewall). The client unit's root `ExecStartPre` inserts
  `iptables -I INPUT -p tcp --dport 5183 -s 172.16.0.0/12 -j DROP` idempotently before Vite
  binds, so a container cannot reach the login. What sits behind that login is a pty as `lyphe`,
  a file browser rooted at `/`, the real `/git` push and the operator's Claude credentials, and
  the server has no login throttle — the LAN and Tailscale are trusted; nothing else is. The
  rules are by INTERFACE (`-i docker0`, `-i br-+`), not by subnet: Docker's allocator walks
  `172.17-31.0.0/16` and then falls back to `192.168.0.0/16` — the LAN's own range — so a subnet
  rule could neither cover a 16th network nor be widened. The watchdog re-inserts the two rules
  every minute, so a `ufw enable`, an `iptables-restore` or a Docker daemon restart reopens the
  port for at most 60 s.
- **A server heal no longer kills an in-flight Claude session, and the API that comes back
  re-adopts it.** A turn's CLI is now exec'd inside the `cloudcli-sessions` tmux server rather
  than as a child of the API, so `systemctl restart cloudcli-server-dev` tears down only the
  API's own cgroup and the CLI keeps running: the socket it loses is read as a detach, never as
  end-of-input. On the way back up — *before* `server.listen` on a plain boot, so a browser
  cannot subscribe into a registry that has not caught up and read a live session as idle; on a
  handover boot, held back until the retiring server has actually exited, because two APIs
  re-adopting the same host would end the first one's runs — the API sweeps every host whose tmux
  session is gone, keeps the newest host per app session, and hands each keeper a fresh run. One line per boot says what it did:
  `[keepalive] re-adopted N host(s), swept M`. Two kinds of host do not survive that pass and
  are wound down instead: one whose app session was deleted while the API was down (nothing left
  to re-adopt it into), and the older of two hosts racing for the same session. A turn that fell
  back to an in-process spawn — the gate closed, or the tmux server down — still dies with the
  API as every turn used to. Which of the two you get, and the `CLOUDCLI_SESSION_KEEPALIVE`
  gate that decides it — the same one variable also decides whether this boot pass re-adopts at
  all, though it sweeps dead files either way — is in
  [`session-host/README.md`](../server/modules/providers/list/claude/session-host/README.md),
  the mechanism's one home. Either way the API canary counts any HTTP status as alive and
  needs three misses ten seconds apart before it acts — a stall under load must never read as
  death.
- **A crash loop ends in `failed`, not in a thrash.** `StartLimitBurst=5` in 120 s latches the
  unit; the watchdog resets and retries at most three times in a row, then stands down and says
  so. `systemctl is-failed cloudcli-server-dev` is then a truthful signal; clear the cause and
  `systemctl reset-failed` + `restart` by hand (which also clears the watchdog's count on the
  next passing probe).
- **The `.verify/` probes drive this same instance** and mutate its state — theme, preferences,
  sessions, the sealed `/git` press, the login modal. Run them only when nobody is using the
  app, and always solo (`ps -eo cmd | grep '^node .verify/'` empty first). The app is
  single-operator; a second port pair for the harness was judged not worth two Vite optimizers.
- **Never kill the client by pattern.** `pkill -f 'sleep infinity'` reaches every such process
  on the box, and two tmux keepalives now hold one each: Descent's `/pm` server
  (`descent-pm-tmux.service` — its own `descent-pm-tmux-watchdog.timer` restores it, but the
  board's MCP server drops in the meantime) and this fork's chat-session server on the private
  `-L cloudcli-sessions` socket, which nothing watches. Use
  `systemctl restart cloudcli-client-dev` instead.
- **A dead tmux keepalive still reads `active`.** Both keepalive units above set
  `Restart=always` *and* `RemainAfterExit=yes`, and the second defeats the first: kill the
  `sleep` and the tmux server exits, but systemd parks the unit at `active (exited)` with
  `MainPID=0` and never restarts it. `systemctl is-active` then answers `active` with nothing
  behind it, and `systemctl start` is a no-op on a unit already reading `active` — exit 0,
  nothing revived. The truthful probe is `tmux -L <socket> ls` (`no server running on
  /tmp/tmux-1000/<socket>` when it is gone), and `systemctl restart` is the only cure. Measured
  on this host 2026-09-08. Descent's twin carries a watchdog timer for exactly this failure;
  this fork's keepalive has no watcher — `cloudcli-dev-watchdog.sh` does not know it — so it
  stays silently dead until a human restarts it.

## Runbook

```
systemctl status cloudcli-server-dev cloudcli-client-dev cloudcli-dev-watchdog.timer cloudcli-sessions-tmux
sudo iptables -S INPUT | grep 5183           # the two bridge drops (docker0, br-+)
cat /run/cloudcli-dev-watchdog/*.heals 2>/dev/null   # consecutive heals per unit, absent when healthy
tmux -L cloudcli-sessions ls                 # the truthful liveness probe (see "A dead tmux keepalive…"); `_keepalive` alone = no chat CLI running
                                             # one `<app session id>-<base36>` per live turn; a restart re-adopts or retires the rest, so a lingering one means the gate is off (see "A server heal…")
ls -A ~/.cloudcli/sessions                   # `.sock`/`.ndjson`/`.json` per host above, so empty only when that list is `_keepalive` alone
                                             # `probe-*` here = an interrupted `.verify/keepalive-host-case.mjs`
sudo systemctl restart cloudcli-server-dev      # API only; the client keeps HMR — KillMode=control-group, so this ends
                                                # the supervisor AND every child under it, unlike a handover
ps -o pid=,stat= --ppid $(systemctl show -p MainPID --value cloudcli-server-dev)   # one child at rest; two = the handover second
sudo systemctl restart cloudcli-client-dev      # Vite only
sudo journalctl -u cloudcli-client-dev -f       # HMR lines: "[vite] (client) hmr update …"
sudo journalctl -u cloudcli-server-dev -f       # the handover: `[supervisor] change:` → `boot:` → `handover:` → `retired` → `handover complete — serving pid <n>`
                                                # `boot failed — previous server kept:` = the edit did not compile and the old server still serves
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5183/            # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5183/api/cli-version  # 401 = alive, auth-gated
sudo systemctl restart cloudcli-sessions-tmux   # the only cure for a silently dead keepalive — takes every live chat CLI with it
sudo systemctl stop cloudcli-sessions-tmux      # deliberate: end every live chat session at once
# installing the keepalive (new to systemd, so enable --now):
sudo cp deploy/systemd/cloudcli-sessions-tmux.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now cloudcli-sessions-tmux
tmux -L cloudcli-sessions ls                    # proves the install: `_keepalive` is there
# redeploying the API unit (already enabled, so daemon-reload + restart — never enable):
sudo cp deploy/systemd/cloudcli-server-dev.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl restart cloudcli-server-dev
journalctl -u cloudcli-server-dev -n 5 --no-pager  # proves it: `[supervisor] serving pid <n>`
```

Two things put a turn back inside the API's own process, and each says so once per API process in
`journalctl -u cloudcli-server-dev`. The gate closed — `CLOUDCLI_SESSION_KEEPALIVE` set to `0`,
`off` or `false` in `.env` — logs `[keepalive] disabled by CLOUDCLI_SESSION_KEEPALIVE=0`. The
keepalive being down when a turn starts logs `[keepalive] unavailable (…) — spawning in-process`.
Either way that turn is a child of the API and dies with the next restart, so starting the unit
again does not rescue what is already running in-process: only turns spawned after it comes back
go to the tmux server.

Known and left: the API's fall-through redirect (`server/index.ts:255`) sends a LAN browser to
`http://localhost:5183` on an unmatched route (only reachable on routes the client never calls);
API responses carry `access-control-allow-origin: *` (bearer auth, so a foreign origin reads
nothing authed); the fork's source is readable unauthenticated on :5183 as on every Vite dev
server (`.env`, `.git` and `/@fs/` outside the root are 403); the stale `mission-control`
registration logs three git errors per poll and stays because two probes use it as their
"directory gone" fixture.

Proven 2026-09-06: both units active after boot-enable; `192.168.1.95:5183` and
`100.103.222.79:5183` answer 200 with the API 401 through the proxy; a `touch` on a client
file logged `[vite] (client) hmr update … GitStatusHeader.tsx` within 3 s; a `touch` on
`server/index.ts` restarted the API through `tsx watch` with the systemd MainPID unchanged and
`/api/cli-version` back at 401 within 2 s; the former `cloudcli-dev` tmux session is gone.

Proven 2026-09-08, restart survival: a turn holding a foreground shell command kept its CLI pid
across a `systemctl restart cloudcli-server-dev` that changed the API's pid, the new boot logged
`[keepalive] re-adopted 1 host(s)`, the probe client's reconnect was acked as still processing,
and the turn's own `complete` arrived once on the far side — then the host's tmux session and
its `~/.cloudcli/sessions` files were gone. Background work started before the restart also
delivered its notification and its second `result` afterwards, and a boot with two dead hosts
on disk swept both and left nothing behind. Driven by `.verify/keepalive-cases-p4.mjs`, whose
per-case contract is in [verification.md](verification.md) §"The keepalive cases".
