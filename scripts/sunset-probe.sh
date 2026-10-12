#!/usr/bin/env bash
#
# The real-system probe harness, as four sourceable functions and the helpers they share.
#
# A phase's probe sources this file and calls what it needs:
#
#   set -e
#   export SUNSET_SLOT=3        # optional: a slot of your own, set ONCE, before the trap
#   source scripts/sunset-probe.sh
#   trap stop_probe_server EXIT
#   probe_db
#   boot_probe_server
#   ... curl against "$SUNSET_API" (http://127.0.0.1:7893) with "$(mint_token)" ...
#
# THE SLOT. Plans of this arc run side by side, and several of their phases boot a scratch center at
# the same moment, so the harness has slots. `SUNSET_SLOT` unset is the default slot: API on
# 7893, warden gateway on 7894, every scratch path beginning `/tmp/sunset-`. `SUNSET_SLOT=N`, one
# digit 1 to 9, moves the API to 7893+2N, the gateway to 7894+2N and every scratch path to
# `/tmp/sunset<N>-` (`/tmp/sunset3-probe.db`, `/tmp/sunset3-state`, ...). Any other value — an
# empty one included, because an empty slot silently collapsing onto the default is exactly the
# collision a slot exists to prevent — makes the function print one sentence and return 2.
# Export the slot once, before the trap, and never prefix a single call
# (`SUNSET_SLOT=1 boot_probe_server`): the prefix is gone when the call returns, and the bare
# `stop_probe_server` the trap then runs names the DEFAULT slot, which this shell never claimed.
# `sunset_paths` computes the slot's values and EXPORTS what a probe reads afterwards:
#
#   SUNSET_API        http://127.0.0.1:<api port>          — curl this
#   SUNSET_GATEWAY    127.0.0.1:<gateway port>             — the warden gateway's listen address
#   SUNSET_PREFIX     /tmp/sunset-  or  /tmp/sunset<N>-    — every scratch path begins with this
#   SUNSET_SLOT_NAME  "slot <N>" or "the default slot"     — what a sentence calls the slot
#
# THE CLAIM. A slot is claimed before anything of it is touched, and the claim is what tells a probe's own
# boot from another plan's. `probe_db` claims it with `mkdir "${SUNSET_PREFIX}claim"`, which is atomic: of
# two probes that start together on one slot exactly one succeeds. The winner holds `SUNSET_CLAIMED=yes` in
# ITS shell (never exported, so a child process never inherits a claim it did not make) until
# `stop_probe_server` ends it. The loser's `probe_db` prints "slot <N> is held by another probe", names the
# claim's path and touches nothing; its `boot_probe_server`, were it reached, refuses too, and its
# `stop_probe_server` acts on nothing, so a probe whose claim was refused still exits through its own trap
# without touching the holder's server or files. A listener bound on the slot's API or gateway port without a claim
# (an older harness's probe, one started by hand, an orphan) is the holder too, whatever it answers: `probe_db` gives
# its claim back and refuses, because the copy would otherwise overwrite that server's database before
# `boot_probe_server`'s own refusal could speak. A leftover FILE with nothing listening is a crashed run's, and is
# overwritten.
#   - `boot_probe_server` refuses a shell that holds no claim. The pid it starts is kept in the shell
#     (`SUNSET_BOOTED_PID`) as well as in `<prefix>server.pid`.
#   - `stop_probe_server` acts only for the shell that holds the claim, and signals only `SUNSET_BOOTED_PID` —
#     never whatever `<prefix>server.pid` happens to name. It then removes the scratch roots and last of all
#     the claim (`rmdir`), so the slot is free only once it is clean.
#   - The claim lives until `stop_probe_server`, not until the server stops: a probe that stops its server by
#     hand and boots again (`boot_probe_server --keep-store`) keeps its claim across the restart.
#   - A shell holds ONE claim: `probe_db` for a second slot in a shell that holds another refuses (the flag names a
#     single prefix, and a second claim would leave both slots unreleasable).
#   - Call `probe_db`, `boot_probe_server` and `stop_probe_server` directly in the probe's own shell, never inside
#     `$( )`, a pipeline or `( … )`: the claim is the shell's. A subshell's stop removes the roots and the claim
#     but cannot clear its parent's flag, and the parent's later trap would then remove a successor's claim and
#     roots; the claim carries no owner token to tell them apart.
#   - A probe SIGKILLed past its trap leaves its claim, and perhaps its server and files. After checking
#     that nothing of it still runs, kill its server by hand and remove the claim the refusal names with
#     `rmdir`.
#
# WHAT IT TOUCHES: a SCRATCH copy of the database at <prefix>probe.db (disarmed, so no board on it
# can spawn a Metis), a second server on the slot's API port with the warden gateway on the slot's
# gateway port, and scratch roots under /tmp — among them the three Cerberus roots the server
# reads: `CERBERUS_DB_PATH` (<prefix>cerberus.db, with its -wal/-shm), `CERBERUS_KEY_PATH`
# (<prefix>cerberus.key) and `CERBERUS_LISTEN` (127.0.0.1:<gateway port>). The live database, the
# live state root, the live attachments root, `~/.cloudcli/cerberus.db` and port 3012 are never
# opened — every runtime root the server reads is redirected by an environment variable
# (Interfaces §10), and `probe_db` copies rather than opens the live file.
#
# WHAT IT LEAVES BEHIND ON A BAD DAY: nothing. `stop_probe_server` runs on every exit path, the
# aborted one included, and deletes the scratch database, every scratch root, the Cerberus store and
# key, and the server's pid and log (read `<prefix>server.log` before the stop when a boot fails).
# The operator's `~/.cloudcli/local-server.json` marker is never touched: the probe writes its own
# to a scratch path (`CLOUDCLI_LOCAL_SERVER_MARKER`), because a probe that wrote the real one
# deleted it at shutdown.
#
# This file has NO top-level side effects and sets no shell options of its own: a sourced file that
# called `set -e` would change the sourcing script's failure semantics, and one that booted on
# source could never be sourced twice. It defines functions, and that is all it does; each of the
# four calls `sunset_paths` first, so no state exists before a function is asked for something.
#
# `mint_token` reads the JWT secret out of the SCRATCH database, never the live one, so a token it
# prints is valid only against the probe server it was minted alongside.

# (z) The slot's ports and scratch prefix, exported. Called first by every function below.
sunset_paths() {
  local slot_offset=0
  if [ -n "${SUNSET_SLOT+set}" ]; then
    case "$SUNSET_SLOT" in
      # Spelled out, not `[1-9]`: in a UTF-8 locale a range also matches `٣` or `③`, and the
      # arithmetic below would then abort the caller's shell instead of answering with rc 2.
      1|2|3|4|5|6|7|8|9) slot_offset=$((2 * SUNSET_SLOT)); SUNSET_PREFIX="/tmp/sunset${SUNSET_SLOT}-"; SUNSET_SLOT_NAME="slot ${SUNSET_SLOT}" ;;
      *) echo "SUNSET_SLOT must be unset or a single digit from 1 to 9." >&2; return 2 ;;
    esac
  else
    SUNSET_PREFIX="/tmp/sunset-"
    SUNSET_SLOT_NAME="the default slot"
  fi
  SUNSET_API="http://127.0.0.1:$((7893 + slot_offset))"
  SUNSET_GATEWAY="127.0.0.1:$((7894 + slot_offset))"
  export SUNSET_PREFIX SUNSET_API SUNSET_GATEWAY SUNSET_SLOT_NAME
}

# (y) Whether THIS shell holds the claim on the slot `sunset_paths` just computed. The claimed prefix is kept beside the
#     flag so a shell that claimed one slot and then names another (a prefixed call, a changed `SUNSET_SLOT`) holds
#     nothing of the second: it must never stop, or clean, a slot it did not claim.
sunset_holds_claim() {
  [ "${SUNSET_CLAIMED:-}" = yes ] && [ "${SUNSET_CLAIMED_PREFIX:-}" = "$SUNSET_PREFIX" ]
}

# (a) CLAIM the slot, then make a scratch copy of the database, DISARMED so no board can spawn a Metis from a probe.
#     The claim comes before any write: `mkdir` is atomic, so of two probes starting together one wins, and the loser
#     touches nothing — not the database, not a journal, not the winner's server.
probe_db() {
  sunset_paths || return $?
  local claim="${SUNSET_PREFIX}claim" path listening
  # One claim per shell: the flag names a single prefix, so a second slot claimed here would orphan the first — the
  # shell's own stop could then release neither.
  if [ "${SUNSET_CLAIMED:-}" = yes ] && ! sunset_holds_claim; then
    echo "This shell already holds the claim ${SUNSET_CLAIMED_PREFIX}claim — one slot per shell: stop that slot first (stop_probe_server, under its own SUNSET_SLOT), then claim $SUNSET_SLOT_NAME." >&2
    return 1
  fi
  if ! mkdir -- "$claim" 2>/dev/null; then
    if sunset_holds_claim; then
      echo "$SUNSET_SLOT_NAME is already claimed by this shell — run stop_probe_server before claiming it again." >&2
    elif [ -e "$claim" ] || [ -L "$claim" ]; then
      echo "$SUNSET_SLOT_NAME is held by another probe — its claim is $claim. A SIGKILLed probe leaves its claim: once nothing of it still runs, remove it with: rmdir $claim" >&2
    else
      echo "Could not create the claim $claim for $SUNSET_SLOT_NAME." >&2
    fi
    return 1
  fi
  SUNSET_CLAIMED=yes
  SUNSET_CLAIMED_PREFIX="$SUNSET_PREFIX"
  # A listener bound on the slot's API or gateway port that holds no claim — a probe of an older harness, one started
  # by hand, an orphan — is still the slot's holder, whatever it answers (a 404, a wedge, nothing in 2 s), and the copy
  # below would overwrite ITS database: boot's own "something already answers" refusal comes too late for that. The
  # output is read first and matched after, so `set -o pipefail` cannot turn a `grep -q` that exits early into a
  # false "free". The claim just made is given back, and nothing else was touched.
  listening="$(ss -ltn 2>/dev/null)"
  if grep -qE ":(${SUNSET_API##*:}|${SUNSET_GATEWAY##*:}) " <<< "$listening"; then
    rmdir -- "$claim" 2>/dev/null || true
    unset SUNSET_CLAIMED SUNSET_CLAIMED_PREFIX
    echo "Port ${SUNSET_API##*:} or ${SUNSET_GATEWAY##*:} of $SUNSET_SLOT_NAME is already listening and no claim holds it — stop that server or pick another SUNSET_SLOT. Nothing was touched." >&2
    return 1
  fi
  # A hot journal or WAL a killed run left beside the old copy would be replayed onto the new one.
  for path in "${SUNSET_PREFIX}probe.db-journal" "${SUNSET_PREFIX}probe.db-wal" "${SUNSET_PREFIX}probe.db-shm"; do
    case "$path" in /tmp/sunset-*|/tmp/sunset[1-9]-*) rm -rf -- "$path" ;; esac
  done
  cp ~/.cloudcli/auth.db "${SUNSET_PREFIX}probe.db"
  python3 -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('update kanban_boards set autonomy=0'); c.commit(); c.close()" "${SUNSET_PREFIX}probe.db"
}

# (b) A JWT for the first user, minted from the SCRATCH database's own secret.
mint_token() {
  sunset_paths || return $?
  # sqlite3.connect creates a missing file, which would plant an empty database in the slot's namespace.
  [ -f "${SUNSET_PREFIX}probe.db" ] || { echo "No scratch database at ${SUNSET_PREFIX}probe.db — run probe_db first." >&2; return 1; }
  python3 - "${SUNSET_PREFIX}probe.db" <<'PY'
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

# (c) Boot a SECOND server on the slot's API port against the scratch database and scratch roots.
#     Two of them guard the operator's own server rather than the data: its marker file
#     (`CLOUDCLI_LOCAL_SERVER_MARKER`) and its chat sessions (`CLOUDCLI_SESSIONS_DIR`). A server
#     booted without a supervisor claims the keepalive whenever the operator's server is not holding
#     it — across its restart on every `server/` save — and then re-adopts every host in the
#     directory: on this scratch database it finds no session row and RETIRES the operator's chats
#     (measured nine times, `readopt.ts`). The three CERBERUS_* roots do the same for the Cerberus
#     store, its signing key and the warden gateway's listener, so a probe never opens
#     `~/.cloudcli/cerberus.db` or binds 3012. The roots are cleared before the boot: a crashed
#     run's enrolled nodes and leftover state must not reach the next one.
#     `boot_probe_server --keep-store` clears everything EXCEPT the Cerberus store and key: the call
#     for a probe that stops its server and boots it again to see what a restart does to the nodes
#     already enrolled (a warden's reconnect needs both its node row and center's signing key). The
#     claim `probe_db` made is kept across that restart; only `stop_probe_server` ends it.
#     A shell that holds no claim boots nothing: its slot may be another probe's.
boot_probe_server() {
  sunset_paths || return $?
  local prefix="$SUNSET_PREFIX" path i keep_store=0
  [ "${1:-}" = "--keep-store" ] && keep_store=1
  if ! sunset_holds_claim; then
    echo "$SUNSET_SLOT_NAME is not claimed by this shell — run probe_db first, directly in this shell: it claims the slot." >&2
    return 1
  fi
  # A slot whose port already answers is held by another server (a probe of another plan, or this
  # slot's own left running): booting over it would delete its roots and report a success the
  # squatter's answers satisfy. Refuse before anything is cleared.
  if curl -sf --max-time 2 "$SUNSET_API/api/auth/status" > /dev/null; then
    echo "Something already answers at $SUNSET_API — stop that server or pick another SUNSET_SLOT." >&2
    return 1
  fi
  for path in "${prefix}state" "${prefix}att" "${prefix}sessions" "${prefix}spill" "${prefix}accounts"; do
    case "$path" in /tmp/sunset-*|/tmp/sunset[1-9]-*) rm -rf -- "$path" ;; esac
  done
  if [ "$keep_store" = 0 ]; then
    for path in "${prefix}cerberus.db" "${prefix}cerberus.db-wal" "${prefix}cerberus.db-shm" "${prefix}cerberus.key"; do
      case "$path" in /tmp/sunset-*|/tmp/sunset[1-9]-*) rm -rf -- "$path" ;; esac
    done
  fi
  mkdir -p "${prefix}state" "${prefix}att" "${prefix}sessions" "${prefix}spill"
  CLOUDCLI_LOCAL_SERVER_MARKER="${prefix}marker.json" CLOUDCLI_SESSIONS_DIR="${prefix}sessions" \
  SERVER_PORT="${SUNSET_API##*:}" DATABASE_PATH="${prefix}probe.db" KANBAN_METIS_STATE_ROOT="${prefix}state" \
  KANBAN_ATTACHMENTS_ROOT="${prefix}att" CLOUDCLI_ACCOUNTS_ROOT="${prefix}accounts" \
  CLOUDCLI_SPILL_ROOT="${prefix}spill" CLOUDCLI_RATE_LIMIT_PATH="${prefix}ratelimit.json" \
  CERBERUS_DB_PATH="${prefix}cerberus.db" CERBERUS_KEY_PATH="${prefix}cerberus.key" \
  CERBERUS_LISTEN="$SUNSET_GATEWAY" \
    node_modules/.bin/tsx --tsconfig server/tsconfig.json server/index.ts > "${prefix}server.log" 2>&1 &
  SUNSET_BOOTED_PID=$!
  echo "$SUNSET_BOOTED_PID" > "${prefix}server.pid"
  for i in $(seq 1 90); do curl -sf "$SUNSET_API/api/auth/status" > /dev/null && break; sleep 1; done
}

# (d) Stop it and delete every scratch root. Runs on EVERY exit path, including the aborted one.
#     It acts only for the shell that holds the claim, and answers 0 for any other, so the trap of a probe whose
#     claim was refused ends quietly instead of cutting the rest of its own cleanup short under `set -e`.
#     The server's exit is awaited before anything is removed: a store removed under a process that
#     is still shutting down is recreated by its last write, and the next probe inherits it.
stop_probe_server() {
  sunset_paths || return $?
  if ! sunset_holds_claim; then
    if [ "${SUNSET_CLAIMED:-}" = yes ]; then
      echo "This shell holds the claim on ${SUNSET_CLAIMED_PREFIX}claim, not on $SUNSET_SLOT_NAME — nothing was stopped. Name the slot as it was when the claim was made." >&2
    fi
    return 0
  fi
  local prefix="$SUNSET_PREFIX" pid path i command_line=""
  # Only the pid this shell's own boot recorded: the pid file is a record for readers, and one a killed run left
  # behind can name a recycled pid or another plan's server.
  pid="${SUNSET_BOOTED_PID:-}"
  # Only a real process number is ever signalled: `kill -- -1` reaches every process this user owns
  # and `kill 0` this shell's own group (2026-10-05: a pid file holding -1 took down every service on
  # the box). The digits are spelled out, not a range, so no locale widens what counts as one.
  case "$pid" in ''|*[!0123456789]*|0*|1) pid="" ;; esac
  # And only a probe server: even a pid this shell recorded can be recycled once its server is gone. The `2>/dev/null`
  # stands BEFORE the `<`: bash opens the file first, and its own "No such file or directory" for a server that
  # already exited is written to the stderr in force at that moment (a redirect after the `<` came too late).
  if [ -n "$pid" ]; then command_line="$(tr '\0' ' ' 2>/dev/null < "/proc/$pid/cmdline")" || command_line=""; fi
  case "$command_line" in *server/index.ts*) ;; *) pid="" ;; esac
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    for i in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
    if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi
  fi
  for path in "${prefix}state" "${prefix}att" "${prefix}accounts" "${prefix}spill" "${prefix}sessions" \
              "${prefix}probe.db" "${prefix}probe.db-journal" "${prefix}probe.db-wal" "${prefix}probe.db-shm" \
              "${prefix}cerberus.db" "${prefix}cerberus.db-wal" "${prefix}cerberus.db-shm" \
              "${prefix}cerberus.key" "${prefix}ratelimit.json" "${prefix}marker.json" "${prefix}server.pid" "${prefix}server.log"; do
    case "$path" in /tmp/sunset-*|/tmp/sunset[1-9]-*) rm -rf -- "$path" ;; esac
  done
  # The claim goes last: the slot is free only once it is clean. A claim already removed by hand is no error.
  rmdir -- "${prefix}claim" 2>/dev/null || true
  unset SUNSET_CLAIMED SUNSET_CLAIMED_PREFIX SUNSET_BOOTED_PID
}
