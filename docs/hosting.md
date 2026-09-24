# Hosting — the dev server and the production client, as services

CloudCLI is hosted twice from one API. The **development** client on :5183 is where an edit lands
instantly, through HMR. The **production** client on :5184 is the built app, rebuilt in the
background, for fast everyday loads. Nothing here runs `npm run build`: the :5184 build goes into
`.prod-client/`, and the `dist/` path stays unused.

## What runs

| Unit | What it is | Bind |
|---|---|---|
| `cloudcli-server-dev.service` | `/usr/bin/node deploy/dev-supervisor/supervisor.mjs` — the handover supervisor: it boots each edited server beside the running one and retires the old one only when the new one reports READY; the API and WebSocket gateway are its child | `127.0.0.1:3011` (loopback only) |
| `cloudcli-client-dev.service` | `node_modules/.bin/vite --host 0.0.0.0 --port 5183 --strictPort` — the client with HMR, its responses compressed by `vite-plugins/compressResponses.js` (see Rules) | `0.0.0.0:5183`, minus the Docker bridges (see below) |
| `cloudcli-client-prod.service` | `vite preview --host 0.0.0.0 --port 5184 --strictPort --outDir .prod-client/current` — the BUILT client: ~50 requests on a fresh load instead of ~700 unbundled modules, Brotli-precompressed at build time (the page document included), every `/assets/*` file cached for a year and everything else revalidated by ETag, by `vite-plugins/precompressedAssets.js`. Same `.env`, so it proxies `/api`, `/ws`, `/shell` and `/plugin-ws` to :3011 exactly as :5183 does. No HMR: an edit reaches it through the rebuild below | `0.0.0.0:5184`, minus the Docker bridges |
| `cloudcli-client-prod-build.timer` → `.service` | every 2 min, `scripts/prod-client-build.sh`: builds only when a build input (`src`, `public`, `shared`, `index.html`, `vite.config.js`, `vite-plugins`, `tailwind.config.js`, `postcss.config.js`, `tsconfig.json`, `.env`, `package.json`, `package-lock.json`) changed since the last build's START (~30 s, `Nice=10`; one build at a time under `flock`, a failed build leaves nothing behind), into `.prod-client/builds/<id>`, then re-points the `.prod-client/current` symlink in one rename. The previous build's hashed assets are carried forward for two days, so a tab opened before a swap can still load its lazy chunks. `--force` builds regardless | — |
| `cloudcli-dev-watchdog.timer` → `.service` | every 60 s, `/usr/local/bin/cloudcli-dev-watchdog.sh` re-asserts the bridge drops on :5183 and :5184, probes `/api/cli-version` on :3011 (any HTTP answer = alive; three misses 5 s apart = dead) `/src/main.tsx` on :5183 (200; two misses) and `/` on :5184 (200; two misses), and restarts the one unit whose canary failed — the supervisor survives a boot that never listened and never boots a replacement of its own, so a FIRST boot that fails leaves `:3011` unanswered with the supervisor still running (a later boot that fails is harmless: the previous server keeps serving), and Vite's transform can wedge, and in every case systemd still reads `active`. After three heals in a row it stops healing and leaves the unit `failed` with one distinct journal line | — |
| `cloudcli-sessions-tmux.service` | `/usr/bin/tmux -L cloudcli-sessions -f /dev/null new-session -d -s _keepalive sleep infinity` — a do-nothing session holding the tmux server that every chat CLI is spawned into, in a cgroup of its own so the API's restart cannot reach them. Each live turn adds a `<app session id>-<base36>` session beside `_keepalive`, with its socket, journal and meta under `~/.cloudcli/sessions` (mode 0700; `CLOUDCLI_SESSIONS_DIR` moves the directory). `sudo systemctl stop cloudcli-sessions-tmux` is the deliberate "end every live chat session" switch, and `CLOUDCLI_SESSION_KEEPALIVE=0` (or `off`/`false`) in the API's `.env` — unset here, so the feature is on — puts new turns back inside the API process | — (unix sockets under `~/.cloudcli/sessions`) |

The API and both client units read `.env` (`SERVER_PORT=3011`, `VITE_PORT=5183`, `HOST=127.0.0.1`,
`CLAUDE_CLI_PATH`, …), run as the host's own user with `NODE_ENV=development` (the production client: `production`), the interactive shell's full
`PATH` (the app's shell tab and every spawned Claude session inherit the API unit's environment —
a chat CLI sits in the keepalive's cgroup but is handed that same environment when it is spawned),
`Restart=always`, `StartLimitBurst=5` in a 120 s window (a crash loop latches `failed` instead of
restarting unseen forever; the watchdog resets and retries), and start at boot. The dev client and
the watchdog live in `/etc/systemd/system/` only — no copy of either is kept in this repo. Two
more units this repo ships (the three production-client units are covered above), each installed
with [`deploy/systemd/install.sh`](../deploy/systemd/install.sh) and each carrying its own exact
commands in its header comment:
[`deploy/systemd/cloudcli-server-dev.service`](../deploy/systemd/cloudcli-server-dev.service) —
the `ExecStart` that runs the supervisor, an *existing* unit, so `daemon-reload` + `restart`
rather than `enable --now` — and
[`deploy/systemd/cloudcli-sessions-tmux.service`](../deploy/systemd/cloudcli-sessions-tmux.service),
which is new to systemd and therefore `enable --now`. Both commands are in the Runbook below.

The three `cloudcli-client-prod*` units ship in `deploy/systemd/`, installed with `install.sh` and
the commands in the service's header. The dev client (:5183) is for watching an edit land live; the production
client (:5184) is the fast one for everyday use, at most one rebuild (≈2.5 min) behind the source.

The clients are the only ports the LAN needs: `vite.config.js` proxies `/api`, `/ws`, `/shell` and
`/plugin-ws` to the API on loopback, so the API never faces the LAN. The app is reachable at
`http://<this host>:5183` on the LAN and over Tailscale, and as the **CloudCLI** row of the
application drawer this app serves — `apps.local.json`, git-ignored; the drawer's one
documentation home is [`docs/MANUAL.md (applications)`](MANUAL.md).

## Rules that bite

- **Vite 7 quits on end-of-file on stdin.** Its CLI treats EOF as "the parent went away";
  systemd hands services `/dev/null`, which is EOF at once, so a plain `ExecStart=npx vite …`
  exits 0 within half a second and restart-loops forever. The client unit therefore runs
  `bash -c 'exec node_modules/.bin/vite … < <(sleep infinity)'` — the bin itself, not `npx`, so
  the main PID is node running Vite and `Restart=` sees Vite die; the `sleep` is a sibling in the
  cgroup and dies with it on stop. A sibling app's dev unit on this host needs none of this
  because it runs Vite 5.
- **A dropped HMR socket does not reload the page unless it has to.** Vite's client reloads the
  whole page whenever its socket drops and the server answers again, and a phone drops that
  socket every time it puts a background tab to sleep. `vite-plugins/keepPageOnReconnect.js`
  gives the dev server a run id and a count of `src/` changes (`GET /__dev-state`) and rewrites
  that one reload in the served client: after the reconnect the page reloads only if the server
  restarted or code changed since the page last applied an update; otherwise it stays, and the
  app's own socket reconnect catches the data up. A kept page has no HMR socket, so it re-checks
  each time the reader returns to the tab and reloads then if code changed — never on a timer,
  where another session's edit would reload it mid-read. If a Vite upgrade changes the client
  text it rewrites, the plugin warns and Vite's own reload stands.
- **Every response Vite compiles or generates is compressed** — transformed modules, `index.html`,
  source maps, `@vite/client`. Vite frames nothing — no `Content-Encoding`, no `Vary` — so the
  transformed module graph went out raw, and on a phone's 120ms Tailscale link that is most of the
  load. Measured on one cold boot: 1,177 requests moving **19.5 MB**, 48.6s, of which ~39s was pure
  transfer. `vite-plugins/compressResponses.js` wraps `res.end` and brotli/gzips any compressible
  body ≥1 KB handed to `res.end` before its headers are written, resetting `Content-Length` and
  appending `Vary: Accept-Encoding` — to the 304 that revalidates such a module too (Vite's own
  `Vary: Origin` is preserved; a coding sent with `q=0`, or no `Accept-Encoding` at all, gets the
  raw body). Two kinds of response stream past it raw, by construction: files served off disk from
  `public/` (`api-docs.html`, `sw.js`, `manifest.json`, the icons), and everything proxied to the API
  (`/api`, `/ws`) — so no proxied or streamed response is ever buffered or framed twice. Measured after,
  same harness and profile: **5.9 MB, 29.2s**. This is not a build and does not touch the choice at
  the top of this file — the same transformed bytes go out in a smaller envelope, HMR is untouched,
  and a save still lands instantly. It does **not** help a warm load: a warm boot is 588 conditional
  revalidations carrying no body at all, 176 KB, and that cost is the request count, not the bytes.
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
- **`--strictPort` is deliberate.** The `.verify/` harness and the application drawer's CloudCLI
  row are pinned to 5183; a drift to 5184 would pass silently and break both.
- **Vite 7 refuses any `Host` header that is not an IP or `localhost`.** The app is opened
  directly under those names on the LAN and the VPN, so `vite.config.js` allows the
  comma-separated `VITE_ALLOWED_HOSTS` — for example the host's plain name, `myhost`, and its
  VPN's MagicDNS name, `myhost.example.ts.net` (`server.allowedHosts`); any other name renders
  Vite's "Blocked request" page.
- **The wildcard bind reaches the Docker bridges too** (`172.17-20.0.1`, 19 containers, several
  third-party images, no host firewall). The client unit's root `ExecStartPre` inserts
  `iptables -I INPUT -p tcp --dport 5183 -s 172.16.0.0/12 -j DROP` idempotently before Vite
  binds, so a container cannot reach the login. What sits behind that login is a pty as the
  host's own user, a file browser rooted at `/`, the real `/git` push and the operator's Claude
  credentials, and the server has no login throttle — the LAN and the VPN are trusted; nothing
  else is. The
  rules are by INTERFACE (`-i docker0`, `-i br-+`), not by subnet: Docker's allocator walks
  `172.17-31.0.0/16` and then falls back to `192.168.0.0/16` — the LAN's own range — so a subnet
  rule could neither cover a 16th network nor be widened. The watchdog re-inserts the two rules
  every minute, so a `ufw enable`, an `iptables-restore` or a Docker daemon restart reopens the
  port for at most 60 s.
- **`.env` now carries a live credential, and the API unit hands its whole environment on.**
  `DEEPSEEK_API_KEY` is the only secret in that file — everything else in it is a port, a path or a
  window size — and the server unit loads the file with `EnvironmentFile=`, so the key is in the API
  process's environment and therefore in the environment of the app's shell tab and of every Claude
  session spawned from it: `userFacingEnv()` in `server/shared/child-env.ts` — the one funnel every
  such spawn goes through — removes exactly one variable, `TSX_TSCONFIG_PATH`, and hands the rest
  over, so anyone already past the login can read the key from a prompt. That is the same
  trust boundary as the pty itself rather than a new hole, but it is a new thing to lose behind it,
  so the file stays mode 600 and git-ignored, and a key that reaches a log or a transcript is
  rotated at the vendor rather than deleted from whatever recorded it. Who reads the key, and the
  boot-once mechanism that decides which copy of it wins, is
  [`.env.example`](../.env.example) and [docs/MANUAL.md (deepseek-balance)](MANUAL.md).
- **ArchPulse's port 8005 must never be proxied through this app.** The chat can embed a live
  DocSpace block, and that iframe is the one frame here that carries `allow-same-origin` — it has
  to, or the block cannot write the reader's edit back through ArchPulse's own API. What keeps
  that safe is only that the frame's origin is not this app's, because CloudCLI's login JWT sits
  in `localStorage['auth-token']` (`src/shared/authToken.ts`) and a same-origin frame reads it as
  easily as the page does. Adding an `/archpulse` entry beside the four proxies above — the
  obvious-looking way to "reach it from the phone" — is exactly what collapses the two origins
  into one and hands the frame the token. The phone reaches `http://<this host>:8005` directly,
  which is the default the embed resolves to on the LAN and over Tailscale alike; `.env.example`
  documents the `VITE_DOCSPACE_EMBED_ORIGIN` override for an ArchPulse on another host, and a
  value that resolves back onto this app's own origin draws an error card instead of a frame. The
  invariant and the gate that enforces it are at
  [docs/architecture/MANUAL.md (07-live-widgets)](docs/architecture/MANUAL.md (07-live-widgets)) §"The DocSpace kind".
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
  [`server/modules/providers/list/claude/session-host/MANUAL.md (README)`](../server/modules/providers/list/claude/session-host/MANUAL.md),
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
  **One probe now reaches outside this app.** `phase-29.mjs` creates and deletes a real page in
  ArchPulse's DocSpace store on :8005, so the harness needs `archpulse.service` up and the state
  at risk is no longer only this app's — the check is in
  [docs/MANUAL.md (verification)](MANUAL.md) §"The dev server", the page's title fence and what an
  ArchPulse restart mid-run does are in its §"What bites people".
- **Never kill the client by pattern.** `pkill -f 'sleep infinity'` reaches every such process
  on the box, and this fork's chat-session server holds one on the private `-L cloudcli-sessions`
  socket, which nothing watches. Use
  `systemctl restart cloudcli-client-dev` instead.
- **A dead tmux keepalive still reads `active`.** The keepalive unit above sets
  `Restart=always` *and* `RemainAfterExit=yes`, and the second defeats the first: kill the
  `sleep` and the tmux server exits, but systemd parks the unit at `active (exited)` with
  `MainPID=0` and never restarts it. `systemctl is-active` then answers `active` with nothing
  behind it, and `systemctl start` is a no-op on a unit already reading `active` — exit 0,
  nothing revived. The truthful probe is `tmux -L <socket> ls` (`no server running on
  /tmp/tmux-1000/<socket>` when it is gone), and `systemctl restart` is the only cure. Measured
  on this host 2026-09-08. Nothing watches this fork's keepalive — `cloudcli-dev-watchdog.sh`
  does not know it — so it stays silently dead until a human restarts it.

## Runbook

```
systemctl status cloudcli-server-dev cloudcli-client-dev cloudcli-dev-watchdog.timer cloudcli-sessions-tmux
sudo iptables -S INPUT | grep -E '518[34]'   # the bridge drops (docker0, br-+) on both client ports
systemctl status cloudcli-client-prod cloudcli-client-prod-build.timer
scripts/prod-client-build.sh --force            # rebuild :5184 now instead of waiting for the timer
readlink .prod-client/current                   # the build :5184 is serving
cat /run/cloudcli-dev-watchdog/*.heals 2>/dev/null   # consecutive heals per unit, absent when healthy
tmux -L cloudcli-sessions ls                 # the truthful liveness probe (see "A dead tmux keepalive…"); `_keepalive` alone = no chat CLI running
                                             # one `<app session id>-<base36>` per live CONVERSATION (every message joins it; it closes two hours after the last one, never mid-task); a restart re-adopts or retires the rest, so a lingering one means the gate is off (see "A server heal…")
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
# installing the keepalive (new to systemd, so enable --now — install.sh renders the template and
# daemon-reloads on its own):
deploy/systemd/install.sh cloudcli-sessions-tmux.service
sudo systemctl enable --now cloudcli-sessions-tmux
tmux -L cloudcli-sessions ls                    # proves the install: `_keepalive` is there
# redeploying the API unit (already enabled, so restart — never enable):
deploy/systemd/install.sh cloudcli-server-dev.service
sudo systemctl restart cloudcli-server-dev
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

Proven 2026-09-06: both units active after boot-enable; `10.0.0.5:5183` answers 200 with the
API 401 through the proxy on both the LAN and the VPN; a `touch` on a client
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
per-case contract is in [docs/MANUAL.md (verification)](MANUAL.md) §"The keepalive cases".
