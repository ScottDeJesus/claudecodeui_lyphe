#!/usr/bin/env bash
# Builds the production client served on :5184 and swaps it in atomically.
#
# Run by cloudcli-client-prod-build-watch.service (deploy/prod-client-watch/watch-build.mjs) at the
# watcher's own start and after each settled burst of saves to an input; it builds only when a client
# input changed since the last build (`--force` builds regardless; `--inputs` prints the inputs, one
# per line, for the watcher, and exits before the lock). One build at a time: a second run
# while one is building exits at once; the watcher's, run with `--wait-lock`, waits for it. Each build lands in its own directory and
# `.prod-client/current` is re-pointed at it in one rename, so the server never sees a half-written
# tree. The previous build's hashed assets are carried forward for two days: a tab opened before
# the swap still asks for its old chunk names when it first opens a lazy tab.
set -euo pipefail

cd "$(dirname "$0")/.."

# Everything `vite build` reads: sources, styling config, the VITE_* values inlined from .env, the
# shared helpers vite.config.js imports, and the dependency set. The build watcher reads this list.
INPUTS=(src public shared index.html vite.config.js vite-plugins tailwind.config.js postcss.config.js
  tsconfig.json .env package.json package-lock.json)
if [ "${1:-}" = "--inputs" ]; then
  printf '%s\n' "${INPUTS[@]}"
  exit 0
fi

ROOT=.prod-client
STAMP="$ROOT/.built"
mkdir -p "$ROOT/builds"

exec 9>"$ROOT/.lock"
# The build watcher passes --wait-lock: a save it saw must be built after a build already running (a
# manual --force) ends, and the lock's release is the event that says so. Any other run skips at once.
if [ "${1:-}" = "--wait-lock" ]; then
  shift
  flock 9
elif ! flock -n 9; then
  echo "a prod client build is already running; skipping"
  exit 0
fi

if [ "${1:-}" != "--force" ] && [ -f "$STAMP" ] && [ -L "$ROOT/current" ] &&
  [ -z "$(find "${INPUTS[@]}" -newer "$STAMP" -print -quit 2>/dev/null)" ]; then
  exit 0
fi

# The stamp is the build's START: an edit landing mid-build is newer than it and triggers the next run.
touch "$ROOT/.building"
ID=$(date +%Y%m%d-%H%M%S)
OUT="$ROOT/builds/$ID"
# A build that fails leaves no directory behind; the stamp is untouched, so the next run retries.
trap 'rm -rf "$OUT"' ERR
CLOUDCLI_PRECOMPRESS=1 node_modules/.bin/vite build --outDir "$OUT" --emptyOutDir --logLevel error
trap - ERR

PREVIOUS=$(readlink "$ROOT/current" 2>/dev/null || true)
if [ -n "$PREVIOUS" ] && [ -d "$ROOT/$PREVIOUS/assets" ]; then
  find "$ROOT/$PREVIOUS/assets" -type f -mtime -2 -exec cp -p --update=none -t "$OUT/assets" {} +
fi

ln -sfn "builds/$ID" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"
mv -f "$ROOT/.building" "$STAMP"

# Keep the live build and the one it replaced; anything else has been carried forward or aged out.
for dir in "$ROOT"/builds/*/; do
  name="builds/$(basename "$dir")"
  [ "$name" = "builds/$ID" ] || [ "$name" = "$PREVIOUS" ] || rm -rf "$dir"
done
echo "prod client built: $ID"
