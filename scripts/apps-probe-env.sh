# The real-system harness for the application switcher, SOURCED by every verify command in
# `docs/plans/application-switcher.plan.md` — never executed as a program, and imported by no
# application code. It is a library: `. scripts/apps-probe-env.sh` and call its three functions.
#
#   mint_token         an HS256 JWT for the first user, read from the real database's own secret
#   boot_probe_server  a SECOND server on $PROBE_PORT, reusing one only when this script started it
#   stop_probe_server  kills that server and puts the operator's server marker back
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
APPS_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPS_PID_FILE="/tmp/apps-server.pid"
APPS_LOG="/tmp/apps-server.log"
APPS_MARKER_BAK="/tmp/apps-marker.bak"
APPS_MARKER_LIVE="$HOME/.cloudcli/local-server.json"
APPS_STATUS_URL="http://127.0.0.1:${PROBE_PORT}/api/auth/status"

# The server writes ~/.cloudcli/local-server.json on boot and DELETES it on exit when the pid in it
# is its own (server/index.ts:322,350-366), so a second server erases the operator's marker just by
# stopping. The backup copy taken at boot and copied back at stop is this repo's alternative to a
# `git restore` — the runs hold no git writes at all.
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
    if [ -n "$running_pid" ] && kill -0 "$running_pid" 2>/dev/null &&
      curl -sf "$APPS_STATUS_URL" >/dev/null; then
      return 0
    fi
  fi

  cp "$APPS_MARKER_LIVE" "$APPS_MARKER_BAK" 2>/dev/null || true

  # `exec` inside the subshell, so "$!" IS the server's pid rather than a wrapper's: a kill that
  # reached only the wrapper would leave an orphan holding $PROBE_PORT and poison every later
  # reuse decision.
  (
    cd "$APPS_REPO_ROOT" || exit 1
    export SERVER_PORT="$PROBE_PORT"
    exec node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts
  ) >"$APPS_LOG" 2>&1 &
  echo $! >"$APPS_PID_FILE"

  local attempt
  for attempt in $(seq 1 90); do
    curl -sf "$APPS_STATUS_URL" >/dev/null && return 0
    sleep 1
  done

  echo "boot_probe_server: $APPS_STATUS_URL never answered in 90s — see $APPS_LOG" >&2
  return 1
}

# stop_probe_server: kills the pid this script wrote, removes the pid file (so the next
# `boot_probe_server` can never reuse a corpse), waits for the port to fall silent, then puts the
# operator's marker back. Safe to call when nothing is running — the verifies call it first,
# blind, for exactly that reason.
stop_probe_server() {
  if [ -f "$APPS_PID_FILE" ]; then
    local running_pid
    running_pid="$(cat "$APPS_PID_FILE" 2>/dev/null || true)"
    if [ -n "$running_pid" ]; then
      kill "$running_pid" 2>/dev/null || true
      local attempt
      for attempt in $(seq 1 20); do
        kill -0 "$running_pid" 2>/dev/null || break
        sleep 0.5
      done
    fi
    rm -f "$APPS_PID_FILE"
  fi

  cp "$APPS_MARKER_BAK" "$APPS_MARKER_LIVE" 2>/dev/null || true
}
