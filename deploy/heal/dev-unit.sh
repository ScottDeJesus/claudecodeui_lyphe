#!/usr/bin/env bash
# Restart a dev unit whose canary stopped answering, unless it is still starting or has
# recovered on its own. Cerberus runs this as a catalog command; every echo below is a line
# its dashboard shows for the run, so the sentences are part of the interface.
# Usage: dev-unit.sh <unit> <canary-url> <wanted-status>
set -u

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <unit> <canary-url> <wanted-status>" >&2
  exit 2
fi
unit=$1
canary_url=$2
wanted_status=$3

readonly STARTUP_GRACE_SECONDS=40   # a unit younger than this is still booting, not broken
readonly SETTLE_SECONDS=3           # one breath before judging, so a blip is not a restart
readonly PROBE_TIMEOUT_SECONDS=10
readonly RECOVERY_SECONDS=30
readonly ACTIVATING_WAIT_SECONDS=30 # a unit still in ExecStartPre is starting, not broken
readonly RESTART_WAIT_SECONDS=30    # how long to sit in a blocking restart before watching the start ourselves
readonly TIMED_OUT=124              # timeout(1)'s exit when the time ran out

# A fresh token per probe, so Vite compiles the module instead of answering from its cache.
fresh_token() {
  od -An -N8 -tx1 /dev/urandom | tr -d ' \n'
}

# Prints the HTTP status of one GET of the canary, or nothing when no answer came.
probe_status() {
  local separator='?'
  case "$canary_url" in *\?*) separator='&' ;; esac
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time "${1:-$PROBE_TIMEOUT_SECONDS}" \
    "${canary_url}${separator}t=$(fresh_token)") || true
  [ "$status" = "000" ] && status=""
  printf '%s' "$status"
}

# Whole seconds since the unit last became active; a large number when it never did.
unit_age_seconds() {
  local entered_us uptime_s
  entered_us=$(systemctl show -p ActiveEnterTimestampMonotonic --value "$unit")
  uptime_s=$(cut -d' ' -f1 /proc/uptime)
  awk -v up="$uptime_s" -v ent="${entered_us:-0}" 'BEGIN { printf "%d", up - ent / 1000000 }'
}

# While a unit is activating, ActiveEnterTimestampMonotonic is still the previous start's
# (or 0), so its age says nothing: wait for the start to end instead of restarting into it.
waited=0
while [ "$(systemctl show -p ActiveState --value "$unit")" = "activating" ]; do
  if [ "$waited" -ge "$ACTIVATING_WAIT_SECONDS" ]; then
    echo "$unit is still starting after ${waited}s; not restarting"
    exit 1
  fi
  [ "$waited" -eq 0 ] && echo "$unit is still starting, waiting for it to finish starting"
  sleep 1
  waited=$((waited + 1))
done

age=$(unit_age_seconds)
if [ "$age" -lt "$STARTUP_GRACE_SECONDS" ]; then
  echo "$unit has been up only ${age}s, waiting for it to finish starting"
  # Time spent waiting out an activating start already counts toward the grace, so the
  # whole run fits the catalog entry's 120 s timeout.
  grace_left=$((STARTUP_GRACE_SECONDS - age - waited))
  [ "$grace_left" -gt 0 ] && sleep "$grace_left"
fi

sleep "$SETTLE_SECONDS"
status=$(probe_status)
if [ "$status" = "$wanted_status" ]; then
  echo "$unit answers again; not restarting"
  exit 0
fi

echo "restarting $unit ($canary_url answered ${status:-nothing}, wanted $wanted_status)"
# reset-failed fails harmlessly on a unit that is not in the failed state; restart must not.
sudo -n systemctl reset-failed "$unit" 2>/dev/null
# A blocking restart waits out the unit's whole TimeoutStartSec (3 min for the prod client), past
# the run's 120 s timeout. After RESTART_WAIT_SECONDS the wait is cut short; systemd's restart job
# keeps going, and the recovery loop below watches the start.
timeout "$RESTART_WAIT_SECONDS" sudo -n systemctl restart "$unit"
restart_exit=$?
if [ "$restart_exit" -ne 0 ] && [ "$restart_exit" -ne "$TIMED_OUT" ]; then
  echo "restarting $unit failed"
  exit 1
fi

SECONDS=0
while [ "$SECONDS" -lt "$RECOVERY_SECONDS" ]; do
  # The last probe gets only the time left, so the loop ends at RECOVERY_SECONDS.
  probe_budget=$((RECOVERY_SECONDS - SECONDS))
  [ "$probe_budget" -gt "$PROBE_TIMEOUT_SECONDS" ] && probe_budget=$PROBE_TIMEOUT_SECONDS
  if [ "$(probe_status "$probe_budget")" = "$wanted_status" ]; then
    echo "$unit answers again after ${SECONDS}s"
    exit 0
  fi
  sleep 1
done
echo "$unit was restarted but $canary_url still does not answer"
exit 1
