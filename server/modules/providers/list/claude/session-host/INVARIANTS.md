<!-- docstore export; edit rows with docstore write, never this file -->

## INV-8059 — probe — LOW — the type this diff added to `cerberus-types.ts` is on one 125-column line; the file passed `prettier --check` at HEAD

LOW — the type this diff added to `cerberus-types.ts` is on one 125-column line; the file passed `prettier --check` at HEAD

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
npx prettier --single-quote --print-width 100 server/shared/cerberus-types.ts | diff - server/shared/cerberus-types.ts | head -8
echo "differing: ${PIPESTATUS[1]} (1 = the file is not as prettier writes it, 0 = it is)"
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.??????) rm -r "$D";; esac
echo "[probe exit $?]"
expect: a 5-line `<` block starting `request: {` against one `>` line at 404, then `differing: 1`; cured when it prints only `differing: 0`
```

measured 2026-10-13 by chain chain-node-release-0-12-1-20261013-120248-645d, finding L1, LOW
probe-key: 2c759943c58d8436521dec54e4975ceceefea0fc

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host-registry.js, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/last-turn.mjs

## INV-8060 — probe — LOW — MAN-685's `sessions.listed` line says a `CerberusNodeHost` is "a `LiveHost` plus `lastTurnFinishedAt`"; the warden also lists `lastTurn`

LOW — MAN-685's `sessions.listed` line says a `CerberusNodeHost` is "a `LiveHost` plus `lastTurnFinishedAt`"; the warden also lists `lastTurn`

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
L=$(~/.claude/scripts/docstore get MAN-685 --text | grep -F 'sessions.listed` | warden → center')
printf 'line: %s\n' "${L:0:230}"
printf 'names the lastTurn field (not lastTurnFinishedAt): '; printf '%s\n' "$L" | grep -cE 'lastTurn([^F]|$)'
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.??????) rm -r "$D";; esac
echo "[probe exit $?]"
expect: the line ending `plus `lastTurnFinishedAt: number\|null`` and `names the lastTurn field (not lastTurnFinishedAt): 0`; cured when the count is above 0
```

measured 2026-10-13 by chain chain-node-release-0-12-1-20261013-120248-645d, finding L2, LOW
probe-key: 4953c9ff450d0bc74cf504fd0f6d5ffcf8f33f98

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host-registry.js, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/last-turn.mjs
