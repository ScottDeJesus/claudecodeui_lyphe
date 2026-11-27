#!/usr/bin/env bash
# Keep the Docker bridges off client ports: the rules the client units insert at start
# (INPUT, tcp, --dport <port>, -i docker0 and -i br-+, DROP), two per port.
# check reads the chain once and says how many are in place; fix puts the missing ones back.
# Usage: bridge-drop.sh check|fix <port>...
set -u

readonly IPTABLES=/usr/sbin/iptables
readonly BRIDGE_INTERFACES=(docker0 'br-+')

usage() {
  echo "usage: $0 check|fix <port>..." >&2
  exit 2
}

[ "$#" -ge 2 ] || usage
mode=$1
shift
case "$mode" in check|fix) ;; *) usage ;; esac
for port in "$@"; do
  [[ "$port" =~ ^[0-9]+$ ]] || { echo "not a port: $port" >&2; exit 2; }
done
# A port named twice would have its rules inserted twice and counted twice.
mapfile -t ports < <(printf '%s\n' "$@" | awk '!seen[$0]++')

read_chain() {
  sudo -n "$IPTABLES" -S INPUT || { echo "could not read the INPUT chain" >&2; exit 2; }
}

# A rule counts when it carries exactly the inserted rule's options, in any order: a negated
# rule (! -i docker0) or a narrowed one (-s 172.17.0.9/32) drops something else.
rule_in_chain() {
  local chain=$1 interface=$2 port=$3 line wanted
  wanted=$(option_pairs "-A INPUT -i $interface -p tcp -m tcp --dport $port -j DROP")
  while IFS= read -r line; do
    [ "$(option_pairs "$line")" = "$wanted" ] && return 0
  done <<< "$chain"
  return 1
}

# One rule line as its sorted "option value" pairs; nothing when it cannot be read as pairs
# (a "!" leaves an option without its partner), so a negated rule never matches.
option_pairs() {
  local -a words
  read -ra words <<< "$1"
  (( ${#words[@]} % 2 == 0 )) || return 0
  local k
  for ((k = 0; k < ${#words[@]}; k += 2)); do
    [ "${words[k]}" = "!" ] && return 0
    printf '%s %s\n' "${words[k]}" "${words[k+1]}"
  done | sort | tr '\n' ';'
}

# Prints the check line and answers 0 when every rule is in place.
report() {
  local chain=$1 in_place=0 wanted=0 port interface
  for port in "${ports[@]}"; do
    for interface in "${BRIDGE_INTERFACES[@]}"; do
      wanted=$((wanted + 1))
      rule_in_chain "$chain" "$interface" "$port" && in_place=$((in_place + 1))
    done
  done
  echo "$in_place of $wanted bridge drops in place"
  [ "$in_place" -eq "$wanted" ]
}

chain=$(read_chain) || exit 2
if [ "$mode" = "fix" ]; then
  for port in "${ports[@]}"; do
    for interface in "${BRIDGE_INTERFACES[@]}"; do
      rule_in_chain "$chain" "$interface" "$port" && continue
      if sudo -n "$IPTABLES" -I INPUT -p tcp --dport "$port" -i "$interface" -j DROP; then
        echo "put back the drop of tcp port $port from $interface"
      else
        echo "could not put back the drop of tcp port $port from $interface"
      fi
    done
  done
  chain=$(read_chain) || exit 2
fi
report "$chain"
