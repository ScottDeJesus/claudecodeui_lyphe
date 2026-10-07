<!-- docstore export; edit rows with docstore write, never this file -->

## INV-7078 — probe — Step 4's "built after the newest source file" compares the swap, not the build's start, and ignores `.env`

Step 4's "built after the newest source file" compares the swap, not the build's start, and ignores `.env`

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
export D
cat > "$D/p.sh" <<'EOF'
S=/tmp/heph-p19/cerberus-whole-tab.mjs
B=/home/lyphe/.claude/claudecodeui_lyphe/scripts/prod-client-build.sh
[ -f "$S" ] || { echo "script gone: nothing to read"; exit 0; }
R="$D/repo"; mkdir -p "$R/.prod-client/builds/b1" || exit 1
INPUTS=$(sed -n '/^INPUTS=(/,/)$/p' "$B" | tr -d '()\n' | sed 's/INPUTS=//')
for n in $INPUTS; do
  case "$n" in src|public|shared|vite-plugins) mkdir -p "$R/$n";; *) : > "$R/$n";; esac
done
{
  echo "import { execFileSync } from 'node:child_process'; import { lstatSync, readlinkSync } from 'node:fs';"
  echo "const REPO = process.argv[2]; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));"
  grep -m1 '^const BUILD_INPUTS' "$S"
  awk '/^async function builtClientIsCurrent/{p=1} p{print} p && /^}$/{exit}' "$S"
  echo "console.log(String((await builtClientIsCurrent(1500)).current));"
} > "$D/fn.mjs"
echo "script's build inputs: $(grep -m1 '^const BUILD_INPUTS' "$S" | grep -o "\[.*\]")"
echo "build timer's inputs:  $INPUTS"
find "$R" -type f -exec touch -d '-60 seconds' {} +
touch -d '-30 seconds' "$R/.prod-client/.built"
touch -d '-10 seconds' "$R/src/edit.ts"
ln -sfn builds/b1 "$R/.prod-client/current"
echo "A. edit mid-build:  script says current=$(node "$D/fn.mjs" "$R");  timer's own test (find -newer .built) finds: $(cd "$R" && find $INPUTS -type f -newer .prod-client/.built -print -quit)"
touch -d '-60 seconds' "$R/src/edit.ts"
touch "$R/.env"
echo "B. .env edited:     script says current=$(node "$D/fn.mjs" "$R");  timer's own test (find -newer .built) finds: $(cd "$R" && find $INPUTS -type f -newer .prod-client/.built -print -quit)"
EOF
cd /tmp && timeout 100 bash "$D/p.sh"; case "$D" in /tmp/athena-probe.*) rm -r "$D" ;; esac
expect: while the defect stands, line A reads `script says current=true;  timer's own test … finds: src/edit.ts` and line B `script says current=true; … finds: .env` (and the script's build inputs list has no `.env`); cured, both A and B read `current=false`.
```

measured 2026-10-06 by chain chain-cerberus--tab--whole-20261006-194705-372d, finding L1, LOW
probe-key: 9825cd87ba8b9c7eeb81e6e92230a878039bec98

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/CheckRows.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/SelectedCheck.tsx

## INV-7079 — probe — Ctrl-C can still leave the 15-minute mute: the script's SIGINT handler races Playwright's own

Ctrl-C can still leave the 15-minute mute: the script's SIGINT handler races Playwright's own

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
export D
cat > "$D/p.sh" <<'EOF'
S=/tmp/heph-p19/cerberus-whole-tab.mjs
[ -f "$S" ] || { echo "script gone: nothing to read"; exit 0; }
PORT=$((30000 + $$ % 20000))
cat > "$D/fake.mjs" <<'EOS1'
import http from 'node:http';
import { appendFileSync } from 'node:fs';
http.createServer((req, res) => {
  appendFileSync(process.argv[2], `${req.method} ${req.url}\n`);
  setTimeout(() => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/api/auth/login')) res.end(JSON.stringify({ token: 'fake' }));
    else if (req.url.startsWith('/api/cerberus/overview')) res.end(JSON.stringify({ muted: [{ key: 'k', mute: { id: 'fake-1', reason: 'Proving the Cerberus mute dialog' } }] }));
    else res.end('{}');
  }, 300);
}).listen(Number(process.argv[3]), '127.0.0.1');
EOS1
{
  echo "import { openConsole } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';"
  echo "const API_URL = 'http://127.0.0.1:$PORT'; const DEV_USER = { username: 'x', password: 'y' }; const MUTE_REASON = 'Proving the Cerberus mute dialog'; const DESK = { width: 1440, height: 900 };"
  sed -n '/^let jwt = null;/,/^const overviewNow/p' "$S"
  awk '/^async function liftStandingMute/{p=1} p{print} /^for \(const signal/{f=1} f && /^}$/{exit}' "$S"
  echo "await overviewNow();"
  grep -m1 '^const desk = await openConsole' "$S"
  echo "console.error('READY'); await new Promise((r) => setTimeout(r, 90000));"
} > "$D/standin.mjs"
echo "stand-in opens the browser with: $(grep -m1 '^const desk = await openConsole' "$S")"
: > "$D/hits.log"; : > "$D/err.log"
node "$D/fake.mjs" "$D/hits.log" "$PORT" & FAKE=$!
node "$D/standin.mjs" 2> "$D/err.log" & PID=$!
case "$PID$FAKE" in *[!0-9]*|'') echo "bad pid"; exit 1;; esac
[ "$PID" -gt 1 ] && [ "$FAKE" -gt 1 ] || exit 1
timeout 90 bash -c "until grep -q READY '$D/err.log'; do sleep 1; done" || { echo "stand-in never ready"; kill "$PID" "$FAKE"; exit 1; }
: > "$D/hits.log"
kill -INT "$PID"; wait "$PID"; code=$?
sleep 1
echo "Ctrl-C (SIGINT) with a center that answers in 300 ms: exit code $code, lift POSTs that landed: $(grep -c 'POST /api/cerberus/mutes/fake-1/lift' "$D/hits.log")"
kill "$FAKE"; wait "$FAKE" 2>/dev/null
EOF
cd /tmp && timeout 150 bash "$D/p.sh"; case "$D" in /tmp/athena-probe.*) rm -r "$D" ;; esac
expect: while the defect stands, `exit code 130, lift POSTs that landed: 0` (Playwright's handler exits first); cured, `exit code 1, lift POSTs that landed: 1`.
```

measured 2026-10-06 by chain chain-cerberus--tab--whole-20261006-194705-372d, finding L2, LOW
probe-key: a4a955fd3ed626d64b190be86451fc3c81650b3f

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/CheckRows.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/sheet/SelectedCheck.tsx

## INV-7118 — probe — `useRunOutput.ts`: a 5,000-line run replays in 18.8 s, not in 10 s, and freezes the tab for most of it

`useRunOutput.ts`: a 5,000-line run replays in 18.8 s, not in 10 s, and freezes the tab for most of it

```probe
D=$(mktemp -d)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/state/pipeline-reviews/cerberus--fixes--fixes-fill/probes && timeout 150 node replay-5000.mjs
EOF
bash "$D/p.sh"
expect: `replay-5000: last-line-ms=<n> longtask-sum-ms=<n>` with last-line-ms at most about 10400 once cured; today about 18800 and longtask-sum-ms above 10000
```

measured 2026-10-07 by chain chain-cerberus--fixes--fixes-fill-20261006-234909-a012, finding M1, MEDIUM
probe-key: f37121bd317ced64837ade71689a61f4ace7322b

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useCatalogRead.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunLastLine.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunOutput.ts

## INV-7119 — probe — `useCatalogRead.ts` with the provider's `refresh`: a hung catalog read holds every write's verdict for 30 s

`useCatalogRead.ts` with the provider's `refresh`: a hung catalog read holds every write's verdict for 30 s

```probe
D=$(mktemp -d)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/state/pipeline-reviews/cerberus--fixes--fixes-fill/probes && timeout 120 node hung-catalog-mute.mjs
EOF
bash "$D/p.sh"
expect: `hung-catalog-mute: dialog-closed-ms=<n>` with n under 2000 once cured; today about 30000 (or `no-mute-button` when the fleet has no card needing you)
```

measured 2026-10-07 by chain chain-cerberus--fixes--fixes-fill-20261006-234909-a012, finding L1, LOW
probe-key: abccf0a1e0bbcfdf4dd0e307c828c8ad013cc048

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useCatalogRead.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunLastLine.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunOutput.ts

## INV-7120 — probe — `useRunLastLine.ts`: an overview read that left before a frame and lands after it puts the older line back

`useRunLastLine.ts`: an overview read that left before a frame and lands after it puts the older line back

```probe
D=$(mktemp -d)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/state/pipeline-reviews/cerberus--fixes--fixes-fill/probes && timeout 120 node stale-overview-lastline.mjs
EOF
bash "$D/p.sh"
expect: `stale-overview-lastline: before-landing=L6 after-landing=<line>`, with after-landing=L6 once cured; today L5
```

measured 2026-10-07 by chain chain-cerberus--fixes--fixes-fill-20261006-234909-a012, finding L2, LOW
probe-key: 8c4563f3f688ccd24f4a678e34b762af7ab1bc42

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useCatalogRead.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunLastLine.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunOutput.ts

## INV-7121 — probe — `useRunOutput.ts` / `FixOutput.tsx`: while a failed run replays, its closing sentence is on screen first

`useRunOutput.ts` / `FixOutput.tsx`: while a failed run replays, its closing sentence is on screen first

```probe
D=$(mktemp -d)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/state/pipeline-reviews/cerberus--fixes--fixes-fill/probes && timeout 120 node note-first.mjs
EOF
bash "$D/p.sh"
expect: `note-first: rows-at-200ms=[...]` holding no "The warden restarted" row once cured; today the note is the only row
```

measured 2026-10-07 by chain chain-cerberus--fixes--fixes-fill-20261006-234909-a012, finding L3, LOW
probe-key: b7d12b6acb3689dde436c62294d685ccd2d874ae

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useCatalogRead.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunLastLine.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunOutput.ts

## INV-7122 — probe — `CerberusProvider.tsx` (outside the 7 paths): `starting` holds one id, so the first press's button reads "Run now" while its POST is out

`CerberusProvider.tsx` (outside the 7 paths): `starting` holds one id, so the first press's button reads "Run now" while its POST is out

```probe
D=$(mktemp -d)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/state/pipeline-reviews/cerberus--fixes--fixes-fill/probes && timeout 120 node two-presses.mjs
EOF
bash "$D/p.sh"
expect: `two-presses: A-reads="Running…" B-reads="Running…"` once cured; today A-reads="Run now"
```

measured 2026-10-07 by chain chain-cerberus--fixes--fixes-fill-20261006-234909-a012, finding L4, LOW
probe-key: c6293f82511f1f77f7dbba98af813918c3fc2370

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useCatalogRead.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunLastLine.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunOutput.ts

## INV-7123 — probe — `fleetModel.ts` / `isOverview` (outside the 7 paths): an overview with no `running` takes the whole Cerberus panel down

`fleetModel.ts` / `isOverview` (outside the 7 paths): an overview with no `running` takes the whole Cerberus panel down

```probe
D=$(mktemp -d)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/state/pipeline-reviews/cerberus--fixes--fixes-fill/probes && timeout 120 node no-running-field.mjs
EOF
bash "$D/p.sh"
expect: `no-running-field: cerberus-panel=1 pageerrors=0` once cured; today cerberus-panel=0 pageerrors=2 with "Cannot read properties of undefined (reading 'find')"
```

measured 2026-10-07 by chain chain-cerberus--fixes--fixes-fill-20261006-234909-a012, finding L5, LOW
probe-key: 7af96a83507289dd58e94a442f418157ba125f76

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useCatalogRead.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunLastLine.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunOutput.ts

## INV-7124 — probe — `WhatHappenedCard.tsx` (outside the 7 paths): two lines of one run in one millisecond share a row key, and the second row opens the first

`WhatHappenedCard.tsx` (outside the 7 paths): two lines of one run in one millisecond share a row key, and the second row opens the first

```probe
D=$(mktemp -d)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/state/pipeline-reviews/cerberus--fixes--fixes-fill/probes && timeout 120 node same-ms-activity.mjs
EOF
bash "$D/p.sh"
expect: `same-ms-activity: pressed-row=1 opened-row0=0 opened-row1=1` once cured; today opened-row0=1 opened-row1=0
```

measured 2026-10-07 by chain chain-cerberus--fixes--fixes-fill-20261006-234909-a012, finding L6, LOW
probe-key: e5be42987bc3ef10100496cf5c0c1304da7a1500

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useCatalogRead.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunLastLine.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunOutput.ts

## INV-7125 — probe — `/tmp/heph-fixes-report.mjs`: the replay step needs a run under an hour old, and fails with a Playwright timeout when there is none

`/tmp/heph-fixes-report.mjs`: the replay step needs a run under an hour old, and fails with a Playwright timeout when there is none

```probe
D=$(mktemp -d)
cat > "$D/p.sh" <<'EOF'
D2=$(mktemp -d)
sed "s#/tmp/heph-fixes-shots#$D2#" /tmp/heph-fixes-report.mjs > "$D2/r.mjs"
timeout 150 node "$D2/r.mjs" desktop-light 2>&1 | grep -E "Fix output head|LEG FAILED" || echo "no-answer"
EOF
bash "$D/p.sh"
expect: a `-- Fix output head:` line while a run under an hour old exists; `LEG FAILED: locator.innerText: Timeout 30000ms exceeded.` today, an hour after the last run — it must say "no run within the hour" instead once cured
```

measured 2026-10-07 by chain chain-cerberus--fixes--fixes-fill-20261006-234909-a012, finding L7, LOW
probe-key: 7d56642dd7aa9dbca98c97100a8eae3a24acc029

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useCatalogRead.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunLastLine.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunOutput.ts

## INV-7126 — probe — `/tmp/heph-fixes-scratch-ui.mjs`: one photograph is not of what its name says, one printed line names the wrong button, and a failed proof exits 0

`/tmp/heph-fixes-scratch-ui.mjs`: one photograph is not of what its name says, one printed line names the wrong button, and a failed proof exits 0

```probe
D=$(mktemp -d)
cat > "$D/p.sh" <<'EOF'
grep -n "shoot('8b-finished-strip')" -B3 /tmp/heph-fixes-scratch-ui.mjs | cut -c1-150
echo "exitCode lines: $(grep -c 'process.exitCode' /tmp/heph-fixes-scratch-ui.mjs)"
EOF
bash "$D/p.sh"
expect: a `waitForTimeout` of at least 500 ms before `shoot('8b-finished-strip')`, and `exitCode lines: 1` or more, once cured; today neither
```

measured 2026-10-07 by chain chain-cerberus--fixes--fixes-fill-20261006-234909-a012, finding L8, LOW
probe-key: 06fb7c7c254e8a60e07e876ccb6e413e5097f54e

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useCatalogRead.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunLastLine.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useRunOutput.ts
