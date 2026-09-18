#!/usr/bin/env bash
#
# The real-system probe harness, as four sourceable functions.
#
# A phase's probe sources this file and calls what it needs:
#
#   set -e
#   source scripts/sunset-probe.sh
#   trap stop_probe_server EXIT
#   probe_db
#   boot_probe_server
#   ... curl against http://127.0.0.1:7893 with "$(mint_token)" ...
#
# WHAT IT TOUCHES: a SCRATCH copy of the database at /tmp/sunset-probe.db (disarmed, so no board
# on it can spawn a Metis), a second server on port 7893, and scratch roots under /tmp. The live
# database, the live state root and the live attachments root are never opened — every runtime root
# the server reads is redirected by an environment variable (Interfaces §10), and `probe_db` copies
# rather than opens the live file.
#
# WHAT IT LEAVES BEHIND ON A BAD DAY: nothing. `stop_probe_server` runs on every exit path, the
# aborted one included, and deletes the scratch database and every scratch root. The operator's
# `~/.cloudcli/local-server.json` marker is never touched: the probe writes its own to a scratch path
# (`CLOUDCLI_LOCAL_SERVER_MARKER`), because a probe that wrote the real one deleted it at shutdown.
#
# This file has NO top-level side effects and sets no shell options of its own: a sourced file that
# called `set -e` would change the sourcing script's failure semantics, and one that booted on
# source could never be sourced twice. It defines four functions, and that is all it does.
#
# `mint_token` reads the JWT secret out of the SCRATCH database, never the live one, so a token it
# prints is valid only against the probe server it was minted alongside.

# (a) A scratch copy of the database, DISARMED so no board can spawn a Metis from a probe.
probe_db() {
  cp ~/.cloudcli/auth.db /tmp/sunset-probe.db
  python3 -c "import sqlite3; c=sqlite3.connect('/tmp/sunset-probe.db'); c.execute('update kanban_boards set autonomy=0'); c.commit(); c.close()"
}

# (b) A JWT for the first user, minted from the SCRATCH database's own secret.
mint_token() {
  python3 - /tmp/sunset-probe.db <<'PY'
import sqlite3, json, hmac, hashlib, base64, time, sys
conn = sqlite3.connect(sys.argv[1])
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

# (c) Boot a SECOND server on 7893 against the scratch database and scratch roots. Two of them guard
#     the operator's own server rather than the data: its marker file (`CLOUDCLI_LOCAL_SERVER_MARKER`)
#     and its chat sessions (`CLOUDCLI_SESSIONS_DIR`). A server booted without a supervisor claims the
#     keepalive whenever the operator's server is not holding it — across its restart on every
#     `server/` save — and then re-adopts every host in the directory: on this scratch database it
#     finds no session row and RETIRES the operator's chats (measured nine times, `readopt.ts`).
boot_probe_server() {
  rm -rf /tmp/sunset-state /tmp/sunset-att /tmp/sunset-sessions && mkdir -p /tmp/sunset-state /tmp/sunset-att /tmp/sunset-sessions
  rm -rf /tmp/sunset-spill && mkdir -p /tmp/sunset-spill
  CLOUDCLI_LOCAL_SERVER_MARKER=/tmp/sunset-marker.json CLOUDCLI_SESSIONS_DIR=/tmp/sunset-sessions \
  SERVER_PORT=7893 DATABASE_PATH=/tmp/sunset-probe.db KANBAN_METIS_STATE_ROOT=/tmp/sunset-state \
  KANBAN_ATTACHMENTS_ROOT=/tmp/sunset-att CLOUDCLI_ACCOUNTS_ROOT=/tmp/sunset-accounts \
  CLOUDCLI_SPILL_ROOT=/tmp/sunset-spill CLOUDCLI_RATE_LIMIT_PATH=/tmp/sunset-ratelimit.json \
    node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > /tmp/sunset-server.log 2>&1 &
  echo $! > /tmp/sunset-server.pid
  for i in $(seq 1 90); do curl -sf http://127.0.0.1:7893/api/auth/status > /dev/null && break; sleep 1; done
}

# (d) Stop it and delete every scratch root. Runs on EVERY exit path, including the aborted one.
stop_probe_server() {
  kill "$(cat /tmp/sunset-server.pid 2>/dev/null)" 2>/dev/null || true
  sleep 1
  rm -rf /tmp/sunset-state /tmp/sunset-att /tmp/sunset-accounts /tmp/sunset-spill /tmp/sunset-probe.db /tmp/sunset-ratelimit.json /tmp/sunset-sessions /tmp/sunset-marker.json
}
