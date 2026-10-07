#!/bin/sh
# Installs, enrolls and refreshes the Cerberus warden on this machine.
#
# Center serves this file at /cerberus/enroll.sh with the address it listens on written into the
# CENTER line below, so the copy that reaches a machine already knows whom it is installing for. The
# command Cerberus prints when a node is added is
#
#   curl -fsSL http://<center>/cerberus/enroll.sh | sudo sh -s -- --name <node> --token <token>
#
# and a newer warden is installed on an enrolled machine with
#
#   curl -fsSL http://<center>/cerberus/enroll.sh | sudo sh -s -- --refresh
#
# WHY SUDO, AND WHY THE ACCOUNT. Writing a systemd unit takes root; the warden itself must not be root.
# The script runs as root through sudo and treats the account that ran sudo (SUDO_USER) as the warden's
# own: it unpacks the release, creates the keys and runs `enroll` AS that account, so
# ~/.cerberus-warden belongs to it. A root login (SUDO_USER empty or root) is refused: there would be
# no account to run the warden as.
#
# WHAT EACH RUN DOES.
#   enroll   (--name, --token)  refused when identity.json already exists (that is a refresh). Fetches
#            latest.json and the release from center, checks the SHA-256, unpacks into
#            ~/.cerberus-warden/releases/<version>/, points `current` at it, runs `enroll`, then
#            writes every unit the release carries, enables them and restarts cerberus-warden so the
#            daemon reads the identity just made.
#   refresh  (--refresh)        refused unless identity.json exists. Fetches a release only when it is
#            NEWER than `current`'s, points `current` at it, writes every unit template the release
#            carries, enables (and so starts) any unit not yet enabled, restarts cerberus-warden — and only
#            that: cerberus-warden-sessions holds the node's running chat sessions and is never restarted by
#            a refresh. Identity and keys are never touched.
#
# TOOLS. node 22+, curl, tar, sha256sum, systemctl, and tmux at /usr/bin/tmux (the sessions unit's ExecStart).
#
# The whole body sits in main(), called on the last line: `curl | sh` feeds this file to the shell as
# it arrives, so a download cut short must not run half a script, and no command inside may read what
# is left of the file from stdin.
#
# POSIX sh. The only non-POSIX tools are `mv -T`, `ln -n` and `install`, which every systemd machine has.
set -eu

CENTER='__CENTER__'
TMP=''

say() { printf '%s\n' "$*"; }
die() { printf '%s\n' "$*" >&2; exit 1; }
usage() {
  printf '%s\nUsage: sudo sh -s -- --name <node> --token <token>\n       sudo sh -s -- --refresh\n' "$1" >&2
  exit 2
}

# TMP is this run's own mktemp directory; it is removed only while it still carries that prefix.
cleanup() {
  case "$TMP" in /tmp/cerberus-warden.*) rm -rf -- "$TMP";; esac
}

# Runs a command as the account the warden belongs to.
as_account() { sudo -n -H -u "$ACCOUNT" -- env HOME="$ACCOUNT_HOME" "$@"; }

# Downloads <url> into <file>; any answer but 200 stops the install with center's own one-line reason.
fetch() {
  fetch_code=$(curl -sS --max-time 180 -o "$2" -w '%{http_code}' "$1") ||
    die "Cerberus did not answer at $CENTER — is it running, and is this machine on its network?"
  if [ "$fetch_code" != 200 ]; then
    fetch_reason=$(head -n 1 "$2" | head -c 200)
    die "Cerberus at $CENTER answered HTTP $fetch_code for ${1#"$CENTER"}: $fetch_reason"
  fi
}

# Reads latest.json into VERSION, FILE and SHA256, each checked before anything is built from it.
read_latest() {
  fetch "$CENTER/cerberus/warden/latest.json" "$TMP/latest.json"
  latest_fields=$("$NODE" -e '
    const latest = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    console.log([latest.version, latest.file, latest.sha256].join(" "));
  ' "$TMP/latest.json" 2> /dev/null) || die "Cerberus's latest.json cannot be read."
  IFS=' ' read -r VERSION FILE SHA256 <<EOF
$latest_fields
EOF
  printf '%s\n' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "Cerberus's latest.json carries no usable version."
  [ "$FILE" = "cerberus-warden-$VERSION.tar.gz" ] || die "Cerberus's latest.json names a file that is not the warden release."
  printf '%s\n' "$SHA256" | grep -Eq '^[0-9a-f]{64}$' || die "Cerberus's latest.json carries no usable SHA-256."
}

# The version `current` points at, or nothing when there is no release yet.
installed_version() {
  [ -f "$WARDEN_HOME/current/warden/package.json" ] || return 0
  "$NODE" -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version' \
    "$WARDEN_HOME/current/warden/package.json" 2>/dev/null || true
}

# Succeeds when version $1 is newer than version $2, compared as major.minor.patch numbers.
version_is_newer() {
  "$NODE" -e '
    const parse = (text) => String(text).split(".").map(Number);
    const [candidate, installed] = [parse(process.argv[1]), parse(process.argv[2])];
    for (let place = 0; place < 3; place += 1) {
      if (candidate[place] !== installed[place]) process.exit(candidate[place] > installed[place] ? 0 : 1);
    }
    process.exit(1);
  ' "$1" "$2"
}

# Downloads, verifies and unpacks the release in VERSION, then points `current` at it. Nothing is
# swapped until the unpack has produced the entry point.
install_release() {
  say "Fetching the warden $VERSION from $CENTER"
  fetch "$CENTER/cerberus/warden/$FILE" "$TMP/$FILE"
  actual_sha256=$(sha256sum "$TMP/$FILE" | cut -d ' ' -f 1)
  [ "$actual_sha256" = "$SHA256" ] || die "The download does not match the SHA-256 in latest.json — nothing was installed."

  release_dir="$WARDEN_HOME/releases/$VERSION"
  as_account mkdir -p -m 0700 "$WARDEN_HOME"
  as_account mkdir -p "$release_dir"
  as_account tar -xzf - -C "$release_dir" < "$TMP/$FILE"
  [ -f "$release_dir/warden/src/main.mjs" ] || die "The release carries no warden/src/main.mjs — nothing was installed."

  # A symlink made beside `current`, then renamed over it: a reader sees the old release or the new, never neither.
  as_account ln -sfn "releases/$VERSION" "$WARDEN_HOME/current.next"
  as_account mv -T "$WARDEN_HOME/current.next" "$WARDEN_HOME/current"
}

# Writes every unit template of the current release into /etc/systemd/system; RENDERED names them.
render_units() {
  RENDERED=''
  for template in "$WARDEN_HOME"/current/warden/systemd/*.service; do
    [ -f "$template" ] || continue
    unit=${template##*/}
    case "$unit" in *[!A-Za-z0-9._@-]*) die "The release carries a unit with an unusable name: $unit" ;; esac
    sed -e "s|__USER__|$ACCOUNT|g" -e "s|__HOME__|$ACCOUNT_HOME|g" -e "s|__NODE__|$NODE|g" "$template" > "$TMP/$unit"
    if grep -Eq '__[A-Z]+__' "$TMP/$unit"; then die "The unit $unit carries a marker this script does not fill in."; fi
    install -m 0644 "$TMP/$unit" "/etc/systemd/system/$unit"
    RENDERED="$RENDERED $unit"
  done
  [ -n "$RENDERED" ] || die "The release carries no unit to install."
}

# Enables, and so starts, every rendered unit that is not enabled yet — the warden's, and the session keepalive that
# holds the node's chat sessions. A unit that is already enabled is left running: only the warden is restarted, below.
# The keepalive failing to start (another tmux server already holds its socket, say) is a warning and not the end of
# the script: `set -e` would stop here with `current` already swapped and the warden still the old one, never restarted.
enable_units() {
  for unit in $RENDERED; do
    systemctl is-enabled --quiet "$unit" && continue
    case "$unit" in
      cerberus-warden.service) systemctl enable --now "$unit" ;;
      *) systemctl enable --now "$unit" ||
           printf '%s\n' "Warning: $unit did not start — read why with: journalctl -u ${unit%.service} -n 20. The warden goes on without it; once the cause is gone: systemctl start $unit" >&2 ;;
    esac
  done
}

# The last line claims the warden is reporting, so it waits for the daemon's own word that center let it in:
# `run.json` is rewritten on every welcome, heartbeat and close, and a record written after the restart that
# says `linked: true` is that word. A unit that falls over, or runs but is refused (a clock more than 60 s off
# is the usual reason, and the enrollment itself does not check it), stops the script with the reason center gave.
# Called straight after the restart returns, when only the new daemon is alive to write the record.
require_linked() {
  restarted_ms=$(( $(date +%s) * 1000 ))
  linked_waited=0
  while [ "$linked_waited" -lt 30 ]; do
    systemctl is-active --quiet cerberus-warden.service ||
      die "The cerberus-warden unit did not stay up — read why with: journalctl -u cerberus-warden -n 20"
    if "$NODE" -e '
      const run = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
      process.exit(run.linked === true && run.at >= Number(process.argv[2]) ? 0 : 1);
    ' "$WARDEN_HOME/run.json" "$restarted_ms" 2> /dev/null; then
      return 0
    fi
    sleep 1
    linked_waited=$((linked_waited + 1))
  done
  refusal=$(journalctl -u cerberus-warden.service --since "@$((restarted_ms / 1000))" --no-pager -o cat 2> /dev/null |
    grep -E '^\[warden\] center (refused|answered|is unreachable|did not)' | tail -n 1) || refusal=''
  die "The warden is installed and running but has not linked to Cerberus at $CENTER${refusal:+ — ${refusal#\[warden\] }} — read more with: journalctl -u cerberus-warden -n 20"
}

main() {
  MODE=enroll
  NAME=''
  TOKEN=''
  while [ $# -gt 0 ]; do
    case "$1" in
      --refresh) MODE=refresh; shift ;;
      --name | --token)
        [ $# -ge 2 ] || usage "$1 needs a value"
        case "$2" in --*) usage "$1 needs a value" ;; esac
        if [ "$1" = --name ]; then NAME=$2; else TOKEN=$2; fi
        shift 2 ;;
      *) usage "Unknown argument \"$1\"" ;;
    esac
  done
  if [ "$MODE" = refresh ]; then
    [ -z "$NAME$TOKEN" ] || usage "--refresh takes no --name and no --token: the machine already has both"
  else
    [ -n "$NAME" ] && [ -n "$TOKEN" ] || usage "Enrolling needs --name and --token"
  fi

  [ "$(id -u)" -eq 0 ] || die "This installs a systemd unit, so it needs root: run it with sudo, from the account the warden should run as."
  ACCOUNT=${SUDO_USER:-}
  case "$ACCOUNT" in
    '' | root) die "Run it with sudo from your own account, not from a root login: the warden runs as the account that ran sudo, and that account must not be root." ;;
  esac
  case "$CENTER" in
    http://* | https://*) ;;
    *) die "This copy of enroll.sh does not know where Cerberus is — fetch it from Cerberus: curl -fsSL http://<center>/cerberus/enroll.sh | sudo sh -s -- ..." ;;
  esac

  ACCOUNT_HOME=$(getent passwd "$ACCOUNT" | cut -d : -f 6)
  [ -n "$ACCOUNT_HOME" ] && [ -d "$ACCOUNT_HOME" ] || die "Cannot find the home directory of $ACCOUNT with getent passwd."
  WARDEN_HOME="$ACCOUNT_HOME/.cerberus-warden"

  missing=''
  for tool in node curl tar sha256sum systemctl tmux; do
    command -v "$tool" > /dev/null 2>&1 || missing="$missing $tool"
  done
  [ -z "$missing" ] || die "This machine is missing:$missing — install what is missing, then run this again."
  # cerberus-warden-sessions starts tmux by this absolute path, as the API's own sessions unit does.
  [ -x /usr/bin/tmux ] || die "tmux is installed as $(command -v tmux), but the cerberus-warden-sessions unit starts /usr/bin/tmux — install tmux with the system's package manager."
  NODE=$(command -v node)
  case "$NODE" in /*) ;; *) die "node was found as \"$NODE\", which is not an absolute path." ;; esac
  node_major=$("$NODE" -p 'process.versions.node.split(".")[0]')
  [ "$node_major" -ge 22 ] || die "The warden needs node 22 or newer; $NODE is version $("$NODE" -p 'process.versions.node')."
  # These three are written into a systemd unit with sed; a character outside this set would need quoting there.
  case "$ACCOUNT$ACCOUNT_HOME$NODE" in
    *[!A-Za-z0-9._/+@-]*) die "The account, its home and node's path must be plain letters, digits and . _ / + @ - to go into a systemd unit." ;;
  esac

  trap cleanup EXIT
  trap 'exit 1' HUP INT TERM
  TMP=$(mktemp -d /tmp/cerberus-warden.XXXXXX) || exit 1

  if [ "$MODE" = refresh ]; then
    [ -f "$WARDEN_HOME/identity.json" ] ||
      die "No warden is enrolled for $ACCOUNT here ($WARDEN_HOME/identity.json is missing) — enroll it with the command Cerberus printed."
    NODE_NAME=$("$NODE" -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).node' "$WARDEN_HOME/identity.json") ||
      die "$WARDEN_HOME/identity.json cannot be read."
    read_latest
    installed=$(installed_version)
    if [ -z "$installed" ] || version_is_newer "$VERSION" "$installed"; then
      install_release
    else
      say "The warden $installed is already the newest Cerberus has built."
    fi
    render_units
    systemctl daemon-reload
    enable_units
    systemctl restart cerberus-warden.service
    require_linked
    say "The warden on $NODE_NAME runs $(installed_version)."
    return 0
  fi

  # A home that is already enrolled is refreshed, not enrolled again: refuse before a release is swapped in under a running daemon.
  [ ! -f "$WARDEN_HOME/identity.json" ] ||
    die "A warden is already enrolled for $ACCOUNT here ($WARDEN_HOME/identity.json exists) — to install a newer one, run this again with --refresh."
  say "Installing the Cerberus warden for $ACCOUNT, from $CENTER"
  read_latest
  install_release
  as_account "$NODE" "$WARDEN_HOME/current/warden/src/main.mjs" enroll --center "$CENTER" --name "$NAME" --token "$TOKEN" < /dev/null ||
    die "Cerberus did not enroll this machine, so no unit was installed."
  render_units
  systemctl daemon-reload
  enable_units
  # `enable --now` starts nothing on a unit that is already running; the restart makes it read the identity just written.
  systemctl restart cerberus-warden.service
  require_linked
  say "The warden on $NAME is reporting to Cerberus at $CENTER."
}

main "$@"
