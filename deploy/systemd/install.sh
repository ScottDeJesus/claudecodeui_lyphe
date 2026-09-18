#!/usr/bin/env bash
# Renders the unit templates beside this file for THIS checkout and THIS user, and installs them.
#   deploy/systemd/install.sh cloudcli-server-dev.service [more units…]
# The templates carry __REPO__, __HOME__ and __USER__; nothing in them names a machine.
# Run it AS the user the app runs as — it calls sudo itself for the two steps that need it.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"

if [ "$(id -u)" -eq 0 ]; then
  echo "run this as the app's own user, not as root: the units would be rendered with User=root" >&2
  exit 2
fi
if [ "$#" -eq 0 ]; then
  echo "usage: deploy/systemd/install.sh <unit file> [more units…]" >&2
  exit 2
fi
user="$(id -un)"
for value in "$repo" "$HOME" "$user"; do
  case "$value" in
    *[\ \|\&\\]*) echo "cannot render \"$value\": a space, |, & or \\ in it would corrupt the unit" >&2; exit 2 ;;
  esac
done
# Every name is checked BEFORE the first write, so a typo cannot leave half a set installed.
for unit in "$@"; do
  [ -f "$here/$unit" ] || { echo "no such unit template: $here/$unit" >&2; exit 2; }
done

for unit in "$@"; do
  sed -e "s|__REPO__|$repo|g" -e "s|__HOME__|$HOME|g" -e "s|__USER__|$user|g" "$here/$unit" \
    | sudo tee "/etc/systemd/system/$unit" >/dev/null
  echo "installed $unit"
done
sudo systemctl daemon-reload
