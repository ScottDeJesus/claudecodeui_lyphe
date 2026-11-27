#!/bin/bash
# The stand-in systemctl of lib/heal_scripts.mjs: show prints state/entered (the case's
# ActiveEnterTimestampMonotonic); every other verb is refused, so nothing reaches a real unit.
S=$CASE_HEAL_STATE
[ -n "$S" ] || exit 1
printf '%s\n' "$*" >> "$S/systemctl.log"
[ "$1" = show ] || exit 1
cat "$S/entered"
