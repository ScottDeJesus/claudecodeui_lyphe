# The real-system harness for the application switcher, SOURCED by its verify commands — never
# executed as a program, and imported by no application code. It is a library: `. scripts/apps-probe-env.sh` and call its three functions.
#
#   mint_token         an HS256 JWT for the first user, read from the real database's own secret
#   boot_probe_server  a SECOND server on $PROBE_PORT, reusing one only when this script started it
#   stop_probe_server  kills that server and deletes its pid file, log, scratch marker, sessions dir and Cerberus store
#
# A second server on another port runs beside the first. Everything this script keeps per server —
# pid file, log, marker, sessions dir, Cerberus store and key — follows `PROBE_PORT`: with it unset or
# 7893 the paths are the bare ones below (`/tmp/apps-server.pid`, `/tmp/apps-sessions`, …) that every
# older caller reads, and with any other port each carries `-<port>` (`/tmp/apps-server-7894.pid`,
# `/tmp/apps-sessions-7894`, …). So `PROBE_PORT=7895` boots, reuses and stops a server of its own
# while the one on 7893 keeps running, and neither `stop_probe_server` can reach the other's files.
#
# Why a second server and not the operator's: the operator's own API runs on 3011 under
# `cloudcli-server-dev.service`, which hot-restarts it on any save under `server/`. A phase that
# changed server code must not be verified against a process an older phase left running — so the
# boot reuses ONLY a process whose pid this script wrote to "$APPS_PID_FILE" itself, and every
# phase's first verify calls `stop_probe_server` before it boots.
#
# `bash -n` is not the proof; the proof is the verifies in the phase that ships, and later phases,
# each of which runs this against the box.

PROBE_PORT="${PROBE_PORT:-7893}"
# The port becomes part of a path that `stop_probe_server` later removes, so anything but ASCII digits
# is refused here, before a single variable is derived or function defined: the caller's next call to
# `boot_probe_server` then fails as "command not found" instead of running on a path made of a typo.
# The digits are spelled out because `[0-9]` is collation-ranged in a UTF-8 locale and admits other
# scripts' digits. A leading zero is refused too: the server reads `SERVER_PORT` as a number, so
# `03011` would name 3011 — the operator's API, answering the status check — under a path of its own.
# And 3011 itself is refused: a server that cannot bind it dies unseen while the operator's API answers
# the status check, so `boot_probe_server` would return 0 on the very process this harness must never test.
case "$PROBE_PORT" in
  0* | *[!0123456789]*)
    echo "apps-probe-env.sh: PROBE_PORT must be ASCII digits with no leading zero, got '$PROBE_PORT'" >&2
    return 1 2>/dev/null || exit 1
    ;;
  3011)
    echo "apps-probe-env.sh: PROBE_PORT 3011 is the operator's own API, not a probe server's port" >&2
    return 1 2>/dev/null || exit 1
    ;;
esac

# 7893 is the port every caller written before the paths followed it reads at the bare names.
if [ "$PROBE_PORT" = "7893" ]; then APPS_PATH_SUFFIX=""; else APPS_PATH_SUFFIX="-${PROBE_PORT}"; fi
APPS_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPS_PID_FILE="/tmp/apps-server${APPS_PATH_SUFFIX}.pid"
APPS_LOG="/tmp/apps-server${APPS_PATH_SUFFIX}.log"
APPS_MARKER="/tmp/apps-marker${APPS_PATH_SUFFIX}.json"
APPS_SESSIONS_DIR="/tmp/apps-sessions${APPS_PATH_SUFFIX}"
APPS_CERBERUS_DB="/tmp/apps-cerberus${APPS_PATH_SUFFIX}.db"
APPS_CERBERUS_KEY="/tmp/apps-cerberus${APPS_PATH_SUFFIX}.key"
APPS_STATUS_URL="http://127.0.0.1:${PROBE_PORT}/api/auth/status"

# Two redirects protect the operator's own server. The server writes its marker on boot and DELETES
# it on exit, so the probe's goes to a scratch path (`CLOUDCLI_LOCAL_SERVER_MARKER`) and the
# operator's `~/.cloudcli/local-server.json` is never touched — the backup-and-copy-back this
# replaced also copied a days-old backup over a live marker whenever a verify called the stop blind.
# And a server booted without a supervisor claims the keepalive (`readopt.ts`'s `.owner` claim,
# which fails closed only while the operator's server holds it — not across its restart on every
# `server/` save): once claimed, it re-adopts every host in the sessions directory and either takes
# its socket (newest wins) or, finding no session row, retires it. So the probe gets an empty
# sessions directory of its own (`CLOUDCLI_SESSIONS_DIR`). The tmux server is still the shared one
# (its socket name is a constant), so the scratch directory is deleted at stop.
# NOTE: this harness still runs against the LIVE auth database — neither redirect isolates that.
# The Cerberus roots ARE redirected (`APPS_CERBERUS_*` below): `.env` carries `CERBERUS_LISTEN`, which
# every server booted from this repo reads, and the store defaults to "beside the auth database" — so
# without them this server would open the live `cerberus.db`, try to bind the live tailnet address
# and tick its own self-checks into the operator's store. Port 0 gives its gateway any free port.
#
# mint_token: proven on this box during the Kanban build (2026-09-15). `jwt_secret` and the first
# `users` row come from the real `~/.cloudcli/auth.db`, so the token is one the live
# `authenticateToken` accepts. The claim shape is `auth.middleware.ts`'s own (`userId`,
# `username`), with an hour of life rather than the app's seven days.
mint_token() {
  python3 - <<'PY'
import sqlite3, json, hmac, hashlib, base64, time, os
conn = sqlite3.connect(os.path.expanduser('~/.cloudcli/auth.db'))
secret = conn.execute("select value from app_config where key='jwt_secret'").fetchone()[0].encode()
uid, uname = conn.execute('select id, username from users order by id limit 1').fetchone()
enc = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(',', ':')).encode()).rstrip(b'=')
now = int(time.time())
head = enc({'alg': 'HS256', 'typ': 'JWT'})
body = enc({'userId': uid, 'username': uname, 'iat': now, 'exp': now + 3600})
sig = base64.urlsafe_b64encode(hmac.new(secret, head + b'.' + body, hashlib.sha256).digest()).rstrip(b'=')
print((head + b'.' + body + b'.' + sig).decode())
PY
}

# probe_pid_is_signalable <pid>: whether a number read from a pid file may be handed to `kill` or
# `kill -0` — a plain decimal above 1, no sign, no leading zero, nothing else. `kill -1` reaches every
# process the user owns and `kill 0` the caller's own group, so a file holding `-1`, `0` or garbage
# must not turn a cleanup into an outage.
probe_pid_is_signalable() {
  [[ "$1" =~ ^[123456789][0123456789]*$ ]] && [ "${#1}" -le 9 ] && [ "$1" -gt 1 ]
}

# boot_probe_server: idempotent for the length of one phase's verifies, and never idempotent
# across phases. A call returns at once ONLY when "$APPS_PID_FILE" names a LIVE process AND the
# port answers: a port answering by itself proves nothing, because another phase's server — or a
# stray one — holds it while the code under test is stale.
#
# The environment is inherited whole, so a caller writing `APPS_FILE=/tmp/x boot_probe_server`
# boots a server on that registry (bash keeps the assignment for the length of the call and
# exports it to the child) without this script naming the variable.
boot_probe_server() {
  if [ -f "$APPS_PID_FILE" ]; then
    local running_pid
    running_pid="$(cat "$APPS_PID_FILE" 2>/dev/null || true)"
    if probe_pid_is_signalable "$running_pid" && kill -0 "$running_pid" 2>/dev/null &&
      curl -sf "$APPS_STATUS_URL" >/dev/null; then
      return 0
    fi
  fi

  mkdir -p "$APPS_SESSIONS_DIR"

  # `exec` inside the subshell, so "$!" IS the server's pid rather than a wrapper's: a kill that
  # reached only the wrapper would leave an orphan holding $PROBE_PORT and poison every later
  # reuse decision.
  (
    cd "$APPS_REPO_ROOT" || exit 1
    export SERVER_PORT="$PROBE_PORT"
    export CLOUDCLI_LOCAL_SERVER_MARKER="$APPS_MARKER"
    export CLOUDCLI_SESSIONS_DIR="$APPS_SESSIONS_DIR"
    export CERBERUS_DB_PATH="$APPS_CERBERUS_DB"
    export CERBERUS_KEY_PATH="$APPS_CERBERUS_KEY"
    export CERBERUS_LISTEN="127.0.0.1:0"
    exec node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts
  ) >"$APPS_LOG" 2>&1 &
  echo $! >"$APPS_PID_FILE"

  local attempt
  for attempt in $(seq 1 90); do
    curl -sf "$APPS_STATUS_URL" >/dev/null && return 0
    sleep 1
  done

  # The caller's exit trap usually stops this server next, and the stop removes the log: so what the log
  # says is printed here, where it outlives the trap.
  echo "boot_probe_server: $APPS_STATUS_URL never answered in 90s — the end of $APPS_LOG:" >&2
  tail -n 20 "$APPS_LOG" 2>/dev/null | sed 's/^/  /' >&2
  return 1
}

# stop_probe_server: kills the pid this script wrote, removes the pid file (so the next
# `boot_probe_server` can never reuse a corpse), and waits for the port to fall silent. Safe to call
# when nothing is running — the verifies call it first, blind, for exactly that reason. It touches
# only the files of THIS $PROBE_PORT, and each removal sits in a `case` that matches that path's two
# literal shapes (the bare name, the `-<digits>` name) so a path that drifted from them is left alone.
# Every `case` opens with an arm that turns away a path holding a second slash or a `..`: the
# `-[0-9]*` shape ends in a `*`, which takes a `/`, and would otherwise pass `/tmp/apps-sessions-1/../x`.
stop_probe_server() {
  if [ -f "$APPS_PID_FILE" ]; then
    local running_pid
    running_pid="$(cat "$APPS_PID_FILE" 2>/dev/null || true)"
    if probe_pid_is_signalable "$running_pid"; then
      kill "$running_pid" 2>/dev/null || true
      local attempt
      for attempt in $(seq 1 20); do
        kill -0 "$running_pid" 2>/dev/null || break
        sleep 0.5
      done
    fi
    case "$APPS_PID_FILE" in
      /tmp/*/* | *..*) ;;
      /tmp/apps-server.pid | /tmp/apps-server-[0-9]*.pid) rm -f "$APPS_PID_FILE" ;;
    esac
  fi
  # The log goes with the server it described: it is per port now, so a kept one would outlive its
  # port's last server with nothing to say which run it was. A caller that wants it copies it BEFORE the stop.
  case "$APPS_LOG" in
    /tmp/*/* | *..*) ;;
    /tmp/apps-server.log | /tmp/apps-server-[0-9]*.log) rm -f "$APPS_LOG" ;;
  esac
  case "$APPS_MARKER" in
    /tmp/*/* | *..*) ;;
    /tmp/apps-marker.json | /tmp/apps-marker-[0-9]*.json) rm -f "$APPS_MARKER" ;;
  esac
  case "$APPS_SESSIONS_DIR" in
    /tmp/*/* | *..*) ;;
    /tmp/apps-sessions | /tmp/apps-sessions-[0-9]*) rm -rf "$APPS_SESSIONS_DIR" ;;
  esac
  local cerberus_suffix
  for cerberus_suffix in "" -wal -shm; do
    case "${APPS_CERBERUS_DB}${cerberus_suffix}" in
      /tmp/*/* | *..*) ;;
      /tmp/apps-cerberus.db | /tmp/apps-cerberus.db-wal | /tmp/apps-cerberus.db-shm \
        | /tmp/apps-cerberus-[0-9]*.db | /tmp/apps-cerberus-[0-9]*.db-wal | /tmp/apps-cerberus-[0-9]*.db-shm)
        rm -f "${APPS_CERBERUS_DB}${cerberus_suffix}" ;;
    esac
  done
  case "$APPS_CERBERUS_KEY" in
    /tmp/*/* | *..*) ;;
    /tmp/apps-cerberus.key | /tmp/apps-cerberus-[0-9]*.key) rm -f "$APPS_CERBERUS_KEY" ;;
  esac
}
