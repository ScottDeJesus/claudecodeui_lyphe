#!/bin/bash
# The stand-in sudo of lib/heal_scripts.mjs. It answers only what deploy/heal's scripts ask, against the
# case's scratch state ($CASE_HEAL_STATE), and runs nothing real:
#   -n /usr/sbin/iptables -S INPUT        prints state/chain (refused while state/refuse-read is there)
#   -n /usr/sbin/iptables -I INPUT <rule> inserts the rule into state/chain as iptables -S spells it, and notes
#                                         "insert <proto> <port> <iface> <target>" in state/inserts
#                                         (refused while state/refuse-insert is there; any other argument refused)
#   -n systemctl <verb> <unit>            noted only; a restart marks state/restarted
# Every call is one line of state/sudo.log.
S=$CASE_HEAL_STATE
[ -n "$S" ] || exit 1
printf '%s\n' "$*" >> "$S/sudo.log"
[ "$1" = -n ] || exit 1
shift
if [ "$1" = /usr/sbin/iptables ]; then
  shift
  if [ "$#" -eq 2 ] && [ "$1" = -S ] && [ "$2" = INPUT ]; then
    [ -f "$S/refuse-read" ] && { echo "sudo: a password is required" >&2; exit 1; }
    cat "$S/chain"
    exit 0
  fi
  { [ "$1" = -I ] && [ "$2" = INPUT ]; } || exit 1
  [ -f "$S/refuse-insert" ] && exit 1
  shift 2
  p=; port=; i=; j=
  while [ "$#" -gt 0 ]; do
    [ "$#" -ge 2 ] || exit 1
    case "$1" in
      -p) p=$2 ;;
      --dport) port=$2 ;;
      -i) i=$2 ;;
      -j) j=$2 ;;
      -m) ;;
      *) exit 1 ;;
    esac
    shift 2
  done
  printf 'insert %s %s %s %s\n' "$p" "$port" "$i" "$j" >> "$S/inserts"
  { printf -- '-A INPUT -i %s -p %s -m %s --dport %s -j %s\n' "$i" "$p" "$p" "$port" "$j"; cat "$S/chain"; } > "$S/chain.next"
  mv "$S/chain.next" "$S/chain"
  exit 0
fi
if [ "$1" = systemctl ]; then
  [ "$2" = restart ] && : > "$S/restarted"
  exit 0
fi
exit 1
