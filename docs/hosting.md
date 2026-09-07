# Hosting — the dev server, as a service

CloudCLI is hosted as a **development** build, on purpose: the operator asked for edits to land
instantly rather than through a rebuild. Nothing here runs `npm run build`; the production
`dist/` path is unused.

## What runs

| Unit | What it is | Bind |
|---|---|---|
| `cloudcli-server-dev.service` | `node_modules/.bin/tsx watch --tsconfig server/tsconfig.json server/index.ts` — the API and WebSocket gateway | `127.0.0.1:3011` (loopback only) |
| `cloudcli-client-dev.service` | `node_modules/.bin/vite --host 0.0.0.0 --port 5183 --strictPort` — the client with HMR | `0.0.0.0:5183`, minus the Docker bridges (see below) |
| `cloudcli-dev-watchdog.timer` → `.service` | every 60 s, `/usr/local/bin/cloudcli-dev-watchdog.sh` re-asserts the bridge drop, probes `/api/cli-version` on :3011 (any HTTP answer = alive; three misses 5 s apart = dead) and `/src/main.tsx` on :5183 (200; two misses), and restarts the one unit whose canary failed — `tsx watch` outlives a crashed API and Vite's transform can wedge, and in both cases systemd still reads `active`. After three heals in a row it stops healing and leaves the unit `failed` with one distinct journal line | — |

Both units read `.env` (`SERVER_PORT=3011`, `VITE_PORT=5183`, `HOST=127.0.0.1`, `CLAUDE_CLI_PATH`,
…), run as `lyphe` with `NODE_ENV=development`, the interactive shell's full `PATH` (the app's
shell tab and every spawned Claude session inherit the unit's environment), `Restart=always`,
`StartLimitBurst=5` in a 120 s window (a crash loop latches `failed` instead of restarting
unseen forever; the watchdog resets and retries), and start at boot. Unit files live in
`/etc/systemd/system/`; there is no copy in this repo.

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
- **A client edit is instant** (HMR over the page's own host); **a server edit restarts the
  API process** (`tsx watch`, one to two seconds). The WebSocket drops and reconnects; the
  git-delegation run store re-subscribes on `websocket_reconnected` (see `git-panel.md`).
  Sessions in flight on the Claude side are not affected — the CLI processes are children of
  the API and are re-attached, but a turn mid-stream may show a reconnect.
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
- **A server heal kills in-flight Claude sessions.** The CLI processes are children of the API
  and live in its cgroup; `systemctl restart cloudcli-server-dev` SIGTERMs them all. That is why
  the API canary counts any HTTP status as alive and needs three misses ten seconds apart before
  it acts — a stall under load must never read as death.
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
  on the box — Descent's `/pm` tmux keepalive is one of them (its watchdog restores it, but the
  board's MCP server drops in the meantime). Use `systemctl restart cloudcli-client-dev`.

## Runbook

```
systemctl status cloudcli-server-dev cloudcli-client-dev cloudcli-dev-watchdog.timer
sudo iptables -S INPUT | grep 5183           # the two bridge drops (docker0, br-+)
cat /run/cloudcli-dev-watchdog/*.heals 2>/dev/null   # consecutive heals per unit, absent when healthy
sudo systemctl restart cloudcli-server-dev      # API only; the client keeps HMR
sudo systemctl restart cloudcli-client-dev      # Vite only
sudo journalctl -u cloudcli-client-dev -f       # HMR lines: "[vite] (client) hmr update …"
sudo journalctl -u cloudcli-server-dev -f       # "Server URL: http://localhost:3011" after each restart
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5183/            # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5183/api/cli-version  # 401 = alive, auth-gated
```

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
