#!/usr/bin/env bash
# Installs Rhubarb Lip Sync 1.14.0, the program that finds the timed mouth shapes in Kaylee's own
# synthesized audio (server/modules/companion/mouth/). It kept: the `rhubarb` binary (7 MB), the
# speech models it reads from `res/` beside it (83 MB) and its LICENSE.md (MIT): 90 MB. The zip's
# tests/, extras/, README and CHANGELOG are left out.
#
# Where: COMPANION_RHUBARB_DIR (default /opt/rhubarb, beside /opt/comfyui where this box keeps its
# third-party tools). Rhubarb is a native program with no browser build, run on the server's CPU: the
# page runs no model and no GPU (the face's ruling 3). Its binary and models are a download, not
# source, so they live outside the tracked tree; the server finds the binary at `<dir>/rhubarb`. The
# folder is made once, with sudo, as lyphe's own, and everything after that runs as lyphe.
#
# One-time and idempotent: every step prints `ran` or `skip`. A run that finds install.json naming
# the pinned version, the binary answering `--version` with it, and `res/` and LICENSE.md in place,
# skips every step and says so. The way back after a restore is this script again: it fetches the
# pinned zip and finds nothing else to do.
#
# The download is checked before anything is installed. The zip is fetched from the pinned release
# URL (curl fails on an HTTP error) into a folder of its own, and a sha256 other than the pinned
# one stops the script with the two sums, installing nothing. install.json (the version, the zip's
# sha256 and the files kept) is written last: its presence means the whole install is there.
#
# What it deletes: only its own download folder. That folder is made by `mktemp -d` in the same run,
# a failed `mkdir` aborts the script, and it is removed on exit by its literal path, behind a `case`
# on the pattern `mktemp` made it from, with the shell outside it. Nothing else is deleted: an old
# install.json is renamed to install.json.previous, and files are overwritten in place, so a file an
# older version had and a newer one lacks stays where it was.
set -euo pipefail

# --- what is installed: named constants, the one place any of it changes ---------------------------
RHUBARB_VERSION="1.14.0"
RHUBARB_ZIP_URL="https://github.com/DanielSWolf/rhubarb-lip-sync/releases/download/v1.14.0/Rhubarb-Lip-Sync-1.14.0-Linux.zip"
RHUBARB_ZIP_SHA256="a9a9074862cff47b2d59b8bf399a678a3b0b74f9452ad6ad94cb292913dd8667"
RHUBARB_ZIP_FOLDER="Rhubarb-Lip-Sync-1.14.0-Linux" # the one folder the zip holds

# --- output --------------------------------------------------------------------------------------
fail() { echo "install-rhubarb: $*" >&2; exit 1; }
ran() { printf 'ran   %s\n' "$*"; }
skipped() { printf 'skip  %s\n' "$*"; }

# The only deletion of this script. Runs on every exit, so a failed run leaves no download behind.
# WORK is set only from the `mktemp -d` of make_work_folder, and the shell never enters it; the
# `cd /` makes "from outside it" true even if a caller ran this function from somewhere odd. The
# case pattern is what that template makes: the literal prefix and exactly six random characters.
remove_work_folder() {
  cd /
  case "${WORK:-}" in
    /tmp/install-rhubarb.??????) rm -rf "$WORK" ;;
  esac
}

make_work_folder() {
  WORK=$(mktemp -d /tmp/install-rhubarb.XXXXXX) || fail "could not make a download folder under /tmp."
  trap remove_work_folder EXIT
}

# --- steps ---------------------------------------------------------------------------------------
ensure_folder() {
  if [ -d "$DIR" ]; then
    [ -w "$DIR" ] || fail "$DIR is not writable by $(id -un)."
    skipped "folder $DIR"
    return
  fi
  if [ -w "$(dirname "$DIR")" ]; then
    install -d "$DIR"
  else
    sudo -n install -d -o "$(id -un)" -g "$(id -gn)" "$DIR" || fail "could not create $DIR with sudo."
  fi
  ran "folder $DIR created, owned by $(id -un)"
}

# True when the binary in DIR answers `--version` with the pinned version. It prints that line
# between blank lines, so the line is matched whole and the blanks are not compared.
binary_answers_version() {
  "$DIR/rhubarb" --version 2>&1 | grep -Fxq "Rhubarb Lip Sync version $RHUBARB_VERSION"
}

# True when this folder already is the pinned install, judged from what is in it and not from
# install.json alone: the file must name the version, and the binary must answer it.
installed_current() {
  [ -f "$DIR/install.json" ] && grep -Fq "\"version\": \"$RHUBARB_VERSION\"" "$DIR/install.json" || return 1
  [ -x "$DIR/rhubarb" ] && [ -d "$DIR/res" ] && [ -f "$DIR/LICENSE.md" ] || return 1
  binary_answers_version
}

preflight() {
  local tool
  for tool in curl unzip sha256sum python3; do
    command -v "$tool" >/dev/null || fail "$tool is required and is not installed."
  done
}

# Into WORK, and checked against the pinned sha256 before a byte of it is unpacked. A transfer that
# stalls under 1 KB/s for a minute is a failure.
fetch_zip() {
  local got out
  curl --fail --location --silent --show-error --retry 3 --retry-delay 2 --connect-timeout 20 \
    --speed-limit 1024 --speed-time 60 --output "$WORK/rhubarb.zip" "$RHUBARB_ZIP_URL" ||
    fail "could not download $RHUBARB_ZIP_URL; the network may be down. Nothing was installed."
  out=$(sha256sum -- "$WORK/rhubarb.zip")
  got=${out%% *}
  [ "$got" = "$RHUBARB_ZIP_SHA256" ] ||
    fail "the download has sha256 $got, not the $RHUBARB_ZIP_SHA256 this script names. Nothing was installed."
  ran "download of Rhubarb $RHUBARB_VERSION, sha256 ${got:0:12} matches"
}

# Only the three kept members come out of the zip, into WORK, and then into DIR over whatever is
# there. `install` replaces the binary by a new file, so a Rhubarb run in flight keeps its old one.
unpack_zip() {
  local top="$RHUBARB_ZIP_FOLDER" src="$WORK/unpacked/$RHUBARB_ZIP_FOLDER"
  unzip -q "$WORK/rhubarb.zip" "$top/rhubarb" "$top/res/*" "$top/LICENSE.md" -d "$WORK/unpacked" ||
    fail "could not unpack $top/rhubarb, res/ and LICENSE.md from the zip."
  [ ! -f "$DIR/install.json" ] || mv -f "$DIR/install.json" "$DIR/install.json.previous"
  install -m 0755 "$src/rhubarb" "$DIR/rhubarb"
  install -m 0644 "$src/LICENSE.md" "$DIR/LICENSE.md"
  mkdir -p "$DIR/res"
  cp -a "$src/res/." "$DIR/res/"
  binary_answers_version ||
    fail "$DIR/rhubarb does not answer 'Rhubarb Lip Sync version $RHUBARB_VERSION' to --version; install.json is not written."
  ran "rhubarb, res/ and LICENSE.md unpacked into $DIR"
}

# What was kept, read back from the folder and not from the constants above.
render_install_json() {
  local kept
  kept=$(cd "$DIR" && find rhubarb LICENSE.md res -type f | LC_ALL=C sort)
  python3 -I - "$RHUBARB_VERSION" "$RHUBARB_ZIP_URL" "$RHUBARB_ZIP_SHA256" "$kept" <<'PY'
import json, sys
version, url, sha256, kept = sys.argv[1:]
print(json.dumps({
    "version": version,
    "url": url,
    "zipSha256": sha256,
    "kept": kept.split("\n"),
    "installer": "scripts/install-rhubarb.sh",
}, indent=2))
PY
}

# Written last: its presence means the whole install is there.
write_install_json() {
  local target="$DIR/install.json" wanted
  wanted=$(render_install_json)
  printf '%s\n' "$wanted" >"$target.part"
  mv -f "$target.part" "$target"
  ran "install.json written"
}

main() {
  DIR="${COMPANION_RHUBARB_DIR:-/opt/rhubarb}"
  DIR="${DIR%/}"
  case "$DIR" in /?*) ;; *) fail "COMPANION_RHUBARB_DIR must be an absolute path other than /; got '$DIR'." ;; esac

  command -v flock >/dev/null || fail "flock is required and is not installed."
  ensure_folder
  # A second run waits for the first and then finds every step done.
  exec 9>>"$DIR/.install.lock"
  flock 9

  if installed_current; then
    skipped "Rhubarb $RHUBARB_VERSION is installed in $DIR: install.json names it and rhubarb --version answers it"
    skipped "download, unpack and install.json"
    return
  fi
  preflight
  make_work_folder
  fetch_zip
  unpack_zip
  write_install_json
}

if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  main "$@"
fi
