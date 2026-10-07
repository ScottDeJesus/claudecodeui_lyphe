<!-- docstore export; edit rows with docstore write, never this file -->

## INV-7017 — Warden probe kinds — rules an edit must keep: the dsn holds no password, `.partial` is not a file, one timer conversion, no credential in `value` or `data`

Subject map and grammar: MAN-7818.

| rule | why |
|---|---|
| A `sql` dsn never carries a password: `dsnHoldsPassword` refuses a `password=` key, or a `:` or `/` ahead of the last `@` after `//`, BEFORE psql runs — "The definition's dsn must not hold a password; it comes from ~/.pgpass". | libpq quotes an unparseable password back in its error line, bare and unfindable by pattern; a password in `-d` also shows in `ps`. A refusal beats a scrub. |
| `postgresql://docstore@127.0.0.1:5433/docstore` (role only, at most one `@`) stays accepted. | eis1's own dsn. |
| No kind puts a credential into `value` or `data`; `describeNetworkError` answers the code, never the error message. | a message can carry a URL. |
| `health_doc` words a failed read only from `READ_FAILURE_WORDS` (a closed table keyed by `error.cause.code`, one fixed phrase for any other); a new failure word is a new table row, never `error.message`, `error.cause.message` or a raw code. | fetch's userinfo refusal is a `TypeError` quoting the whole url; the center stores `value`. |
| `health_doc` takes `checked_at` only as an ISO-8601 string with an offset (`ISO_TIME_WITH_OFFSET`) and refuses one past `MAX_FUTURE_SKEW_MS` BEFORE it touches `memory`. | `Date.parse` reads `12345` as a year; center drops results stamped further ahead, so the document would read green with every component lost. |
| A `health_doc` component whose key equals `spec.key` is not published; `own` fails. | center takes a probe's own key from the probe alone: a second writer would interleave. |
| `file_age` does not count `*.partial` (`PARTIAL_SUFFIX`) when it reads a directory. A directory holding only a `.partial` reads "No file in <path>", `failing`. | `docstore/bin/backup` writes `<name>.partial` and renames it after `pg_dump` exits 0; a failed `pg_dump`, even a refused login, leaves a fresh 0-byte `.partial`. Counting it keeps a nightly-failing backup green. |
| `deadlineMs(spec)` is the only conversion of `timeout` to a timer delay; a new kind uses it. | `setTimeout` past 2 147 483 647 ms fires after 1 ms; center allows 30 days (2 592 000 s). |
| `runProcess` never rejects: a thrown `spawn` resolves `{ ended: 'error', code }`. | the caller `await`s without a catch. |
| The group-kill signal goes only to an integer pid above 1. | `kill -1` reaches every process the user owns. |
| `COMPARISON` keeps ONE `\s*` between any two tokens. | two in a row backtrack quadratically on a long failing run of spaces. |
| `clip(text, max)` cuts the `exec` sentence, and the `sql` first column and stderr line. | a plain `slice` can leave half of a surrogate pair. |

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/expr.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-kinds/exec.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-kinds/file-age.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-kinds/health-doc.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-kinds/http.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-kinds/sql.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-kinds/tcp.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-support.mjs

## INV-7018 — probe — `scrubCredentials` lets a password through in the two libpq messages a real password produces

`scrubCredentials` lets a password through in the two libpq messages a real password produces

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
node --input-type=module <<'JS'
const R = '/home/lyphe/.claude/claudecodeui_lyphe/warden/src/';
const { run } = await import(R + 'probe-kinds/sql.mjs');
for (const dsn of ['postgresql://docstore:SECRETPW9x%zz@127.0.0.1:5433/docstore', 'postgresql://docstore:ab@SECRETPW9x@127.0.0.1:5433/docstore']) {
  const r = await run({ key: 'scratch/db', service: 'scratch', kind: 'sql', every: 30, timeout: 5, dsn, query: 'select 1' });
  console.log(JSON.stringify(r.value), JSON.stringify(r).includes('SECRETPW9x') ? 'LEAK' : 'clean');
}
JS
EOF
bash "$D/p.sh"
expect: two lines; today each ends LEAK (the value quotes "SECRETPW9x%zz" and "SECRETPW9x@127.0.0.1"); cured, each ends clean
```

measured 2026-10-06 by chain chain-cerberus--warden--kinds-20261006-113710-7e79, finding M1, MEDIUM
probe-key: d4a13bbaa31b4da685ba8c57a3b177668622e9eb

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/expr.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-support.mjs

## INV-7019 — probe — `runProcess` rejects on a NUL byte, though its comment says it "Resolves, never rejects"

`runProcess` rejects on a NUL byte, though its comment says it "Resolves, never rejects"

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
node --input-type=module <<'JS'
const R = '/home/lyphe/.claude/claudecodeui_lyphe/warden/src/';
const { runProcess } = await import(R + 'probe-support.mjs');
try { const r = await runProcess('/bin/sh', ['-c', 'echo a\0b'], { cwd: '/tmp', timeoutMs: 2000 }); console.log('resolved', JSON.stringify({ ended: r.ended, code: r.code })); }
catch (e) { console.log('REJECTED', e.code); }
JS
EOF
bash "$D/p.sh"
expect: today REJECTED ERR_INVALID_ARG_VALUE; cured, resolved {"ended":"error","code":"ERR_INVALID_ARG_VALUE"}
```

measured 2026-10-06 by chain chain-cerberus--warden--kinds-20261006-113710-7e79, finding L1, LOW
probe-key: e9f8b65ba0d3e57fdc9eed7304fda7ce948092c4

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/expr.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-support.mjs

## INV-7020 — probe — a `timeout` above 2,147,483 s times out at once

a `timeout` above 2,147,483 s times out at once

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
node --input-type=module 2>/dev/null <<'JS'
const R = '/home/lyphe/.claude/claudecodeui_lyphe/warden/src/';
const { run } = await import(R + 'probe-kinds/exec.mjs');
const r = await run({ key: 'scratch/x', service: 'scratch', kind: 'exec', every: 30, timeout: 2592000, cmd: 'sleep 1; echo 5' });
console.log(r.status, JSON.stringify(r.value), r.tookMs + ' ms');
JS
EOF
bash "$D/p.sh"
expect: today failing "Did not finish within 2592000 s" in about 4 ms; cured, ok "5" after about 1000 ms
```

measured 2026-10-06 by chain chain-cerberus--warden--kinds-20261006-113710-7e79, finding L2, LOW
probe-key: c7c89740dee03b91622b7170691e34ad0df0d101

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/expr.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-support.mjs

## INV-7021 — probe — `parseExpr` is quadratic in the whitespace after a number

`parseExpr` is quadratic in the whitespace after a number

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
node --input-type=module <<'JS'
const R = '/home/lyphe/.claude/claudecodeui_lyphe/warden/src/';
const { parseExpr } = await import(R + 'expr.mjs');
const t0 = performance.now();
const r = parseExpr('value < 5' + ' '.repeat(30000) + 'x');
console.log('parseExpr of 30,000 interior spaces:', r, Math.round(performance.now() - t0) + ' ms');
JS
EOF
bash "$D/p.sh"
expect: today null after 800–1200 ms; cured, null after under 5 ms
```

measured 2026-10-06 by chain chain-cerberus--warden--kinds-20261006-113710-7e79, finding L3, LOW
probe-key: 45282d76c9c0bd98af112021cdfae1e1db398090

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/expr.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-support.mjs

## INV-7028 — Warden scheduler — rules an edit must keep: one run per probe, an unchanged probe is left alone, `prevAt` is stamped at flush, a frame never exceeds 500 results or 4 MiB, no ticking timer

Subject map: MAN-7821.

| rule | why |
|---|---|
| A probe never overlaps itself. The in-flight set is keyed by probe KEY, not by schedule entry. | a redefined probe is a new entry; keyed by entry, its first turn would run beside the old run (a `sleep`ing exec, a 15 s health read). |
| A set that repeats a probe unchanged leaves its timer, `memory` and in-flight run alone. A set never restarts every timer. | restarting gives every probe a new random first delay, up to 300 s: one edited definition would open a hole in the cadence of the rest, and a 300 s probe's gap would near `staleAfter`. |
| A run's result is sent only if the schedule still holds the entry that started it. | a probe that left stops; its late answer must not reach center as a check the operator removed. |
| `chain.json` keeps, per check, only the `at` of a result center has ACKED: a result still in the outbox is replaced by its own `prevAt` (the result before it), and what cannot be known falls back to the older saved value. `chain.mjs` writes it on an ack (coalesced to one write per 30 s) and at a clean stop, and does not load an `at` in the future or older than 30 days. The daemon seeds the scheduler's `previousAt` from it. | the outbox lives in memory, so a chain that named a result lost with it would, center never comparing `prevAt` with what it stored, read as an unbroken stretch for minutes center never heard. Saved this way the chain errs short (a lapse), never long (an invented stretch); saved at flush, a restart would blank the minutes before it for every quiet check, which store a row only every five minutes. |
| `prevAt` is stamped at FLUSH, from the last result flushed for the check, and forgotten for every check whose results were dropped: all of them at an overflow flush, the checks of a frame whose `link.send` threw. Never stamped at enqueue. | the chain is of what was sent; a stamp at enqueue would link results that `keepLatest` later drops, and would not restart after a drain. Center judges a lapse as `prevAt === null || at − prevAt > staleAfter` and never compares `prevAt` with what it stored, so a chain that names a lost result reads as an unbroken stretch and its freshness vouches for the old status across the gap. |
| Every result frame holds at most 500 results (`BATCH_LIMIT`) AND 4 MiB (`FRAME_BYTES_LIMIT`); a flush drains the whole batch in frames, leaving no remainder waiting a second. A result alone over 1 MiB (`RESULT_BYTES_LIMIT`) goes as `failing`, "The result was too large to send (<n> MB)", `data` `{ error: 'oversize', bytes }`. | center's gateway closes a socket on a frame past 8 MiB, and the frame at the head of the outbox is resent at every reconnect and never acked: one oversize frame silences the node for good. A component's `data` and `reason` are unbounded by the kind, so the count alone bounds nothing. |
| The flush timer is armed by the first result into an empty batch and disarmed by the flush. No interval ticks while nothing waits. | the house recovers and reacts on events; an idle tick is a poll. |
| A probe's `every` is waited out by `waitFor`, in steps of at most `MAX_TIMER_MS`, re-armed by each turn; never `setInterval` and never a clamp. | center allows `every` up to 2 592 000 s; `setTimeout` past 2 147 483 647 ms fires after 1 ms, and a clamp would run a 30-day probe every 24.86 days. |
| `enqueue` pushes results one at a time, never `batch.push(...results)`. | a spread of about 130 000 arguments overflows the stack, and the probe's own check would go stale instead of reading what the document is. |
| A kind's error is logged by `code ?? name` only, and the `failing` value is a fixed sentence. | a library message can quote a url with its userinfo; center stores `value`. |
| `fire` runs behind a `.catch` (`turn`). | an unawaited rejection ends the whole daemon under Node 22. |
| `runNow` (`probe.run`) never starts a second run of a probe: a key in `running` is put in `runAgain`, a Set, and `fire` starts ONE more run from its `finally`, on the schedule's current entry. Its result is flushed at once (`sendNow`). | the recheck after a fix must read after the fix, not be the read that was already going; a Set makes any number of asks one run, and a recheck waits no 1 s batch window |

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/chain.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probes.mjs

## INV-7039 — Warden link — rules an edit must keep: a seq is never handed out twice, a failed `takeSeq` leaves the counter, `onWelcome` throws before the deadline is cleared, verify before parse, nothing unsigned acted on, key on disk before the enroll socket

Behaviour: MAN-7824 (link, wire), MAN-7835 (outbox), MAN-7825 (enroll), MAN-7836 (home).

| rule | why |
|---|---|
| A sequence number is never handed out twice, across a restart or a crash: `takeSeq` writes the number about to be handed out `+ 1000` (fsynced) before handing out a number at or past the floor. | center treats a `seq` at or below its acked as a resend and answers without storing: a repeat silently loses a batch |
| `ack(n)` raises the counter above `n`, and frames queued under numbers center already holds are renumbered above it (`renumberAbove`), never trimmed as stored. | a lost `state.json` must not swallow results |
| A failed `takeSeq` leaves the counter where it was: `renumberAbove` takes every number inside a `try` and restores `nextSeq` before it rethrows. | a raised counter with unrenumbered frames makes the next `welcome` find nothing to renumber and trim them as stored |
| Anything in `onWelcome` that can throw runs BEFORE `clearTimeout(deadlineTimer)`; `attempt` and `lastLoggedRefusal` reset only after it succeeded. | a throw after the cancel leaves the socket open, never linked and with no deadline; a failing `welcome` must not reset the backoff |
| A reliable frame sent on a LINKED socket starts `ackWatch` only while `linked`, an `ack` settles it, any verified frame from center starts it over, `goDown` and `welcome` stop it, and only `flushUnsent` starts it. | a `welcome` re-settles the whole account: the watch it leaves running would drop an idle healthy link 90 s later when that `welcome` acked everything. `expect` on a down link arms a timer for a socket that is gone: its expiry would abandon `null` and schedule a second reconnect beside the pending one; a watch that ignored other frames would drop a link to a center that is alive but has not acked a frame it has no handler for |
| Every stage of an attempt has a deadline (`ATTEMPT_DEADLINE_MS`) that abandons the socket into the normal backoff: the upgrade, then the `welcome`. | a center that takes the connection and goes silent must not hold the link for good |
| Nothing is sent from the outbox before `welcome`; `flushUnsent` runs only while `linked`, from `sentUpto`. | a `welcome` raises the counter and trims the queue to what center holds: a frame sent before it can carry a number center already has |
| Every frame from center is verified over the exact bytes of `env` with the pinned `centerKey` BEFORE it is parsed, never over a re-serialisation; a failure, or a frame for another node, is dropped and logged once per kind. | a parse and a stringify can respace the same object; a signature over other text proves nothing. The type of an unverified frame is not read |
| `at` and the signature of a connect are fresh on every attempt, including the `readRefusal` request. | center refuses a (node, at) pair it has seen in the last two minutes |
| `overflowing` is read by the caller, which chooses `push` or `keepLatest`; `keepLatest` forces `prevAt` null; a failed release push keeps `overflowing` true. | the outbox cannot know which results a frame holds; the chain before a kept result is gone and center must see a lapse |
| `enroll` refuses a home holding `identity.json` before writing anything, and writes BOTH key halves before the socket opens; a key already in the home is reused, never replaced. | a second enrollment replaces keys center knows; a death after center wrote the node but before `welcome` must leave its key on disk |
| `enroll` pins the key from the `welcome`'s certificate only after the frame verifies against THAT key and the certificate names this node, this key's fingerprint and carries a valid signature; `identity.json` is written last. | a hostile center must not choose whom the node trusts |
| Words from a peer not yet trusted (a refusal, an `error` frame before the key is pinned) reach a terminal only through `oneLine`: first line, control characters removed, 200 characters. | an escape sequence in a refusal body must not run in a person's terminal |
| The warden runs on bare `node` ≥ 22: no dependency, no loader, no TypeScript. | `main.mjs`'s posture, the same as `deploy/dev-supervisor/*.mjs` |

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/ack-watch.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/enroll.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/outbox.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/state.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/wire.mjs

## INV-7040 — probe — LOW — a floor write that fails inside `onWelcome` leaves the socket open, never linked and with no deadline; when it is the L1 renumber, the next welcome trims the queued frames as stored

LOW — a floor write that fails inside `onWelcome` leaves the socket open, never linked and with no deadline; when it is the L1 renumber, the next welcome trims the queued frames as stored

```probe
D=$(mktemp -d /tmp/athena-w.XXXXXX) || exit 1
cat > "$D/c.mjs" <<'JS'
import crypto from 'node:crypto'; import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path';
const R = '/home/lyphe/.claude/claudecodeui_lyphe/';
const { WebSocketServer } = await import(R + 'node_modules/ws/wrapper.mjs');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const res = (c, v) => ({ check: c, source: c, at: Date.now(), fetchedAt: Date.now(), status: 'ok', docStatus: null, value: v, data: null, tookMs: 1, prevAt: null });
export async function center(home, { ackedUpto = 0 } = {}) {
  const pair = () => crypto.generateKeyPairSync('ed25519'), node = pair(), key = pair(), st = { got: [], rows: [], open: new Set(), acked: ackedUpto };
  fs.mkdirSync(path.join(home, 'keys'), { recursive: true });
  fs.writeFileSync(path.join(home, 'keys/node.key'), node.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  process.env.CERBERUS_WARDEN_HOME = home;
  const frame = (type, body) => { const env = JSON.stringify({ type, id: 'x', node: 'probe', seq: null, at: Date.now(), body }); return JSON.stringify({ env, sig: crypto.sign(null, Buffer.from(env), key.privateKey).toString('base64') }); };
  const wss = new WebSocketServer({ noServer: true }), server = http.createServer();
  server.on('upgrade', (req, sock, head) => wss.handleUpgrade(req, sock, head, (ws) => {
    st.open.add(ws); ws.on('close', () => st.open.delete(ws)); ws.on('error', () => {});
    ws.on('message', (data) => { const env = JSON.parse(data.toString());
      if (env.type === 'hello') ws.send(frame('welcome', { node: 'probe', ackedUpto: st.acked }));   // center's rules (warden-link.ts): seq <= acked is acked and NOT stored
      if (env.type === 'result') { st.got.push(env.seq); if (env.seq > st.acked) { st.acked = env.seq; for (const r of env.body.results) st.rows.push(r.value); } ws.send(frame('ack', { upto: env.seq })); } }); }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const identity = { node: 'probe', center: `http://127.0.0.1:${server.address().port}`, centerKey: key.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  const w = await Promise.all(['link', 'outbox'].map((f) => import(R + `warden/src/${f}.mjs`)));
  return { identity, st, dropAll: () => { for (const ws of st.open) ws.terminate(); }, createLink: w[0].createLink, createOutbox: w[1].createOutbox };
}
JS
cat > "$D/p.mjs" <<'JS'
import fs from 'node:fs';
import { center, res, sleep } from './c.mjs';
const home = process.argv[2], c = await center(home, { ackedUpto: 5000 });     // center holds 5000; this home has lost its state.json
const outbox = c.createOutbox({ home }), link = c.createLink({ identity: c.identity, outbox, home });
for (let i = 0; i < 3; i++) link.send('result', { results: [res('svc/c', 'r' + i)] }, { reliable: true });   // queued before the first welcome: seqs 1-3
fs.rmSync(home + '/state.json'); fs.mkdirSync(home + '/state.json'); fs.writeFileSync(home + '/state.json/x', 'x');   // the next floor write cannot land (a full disk would do the same)
link.start(); await sleep(3000);
console.log('welcome while the floor write fails: linked =', link.linked, '| socket still open at center =', c.st.open.size, '| frames queued =', outbox.size);
fs.rmSync(home + '/state.json', { recursive: true });                           // the disk heals
c.dropAll(); await sleep(4500);                                                  // the link reconnects and is welcomed again
console.log('after the disk heals: linked =', link.linked, '| results center stored =', c.st.rows.join(',') || 'none', '| frames queued =', outbox.size);
process.exit(0);
JS
cat > "$D/p.sh" <<'SH'
H=$(mktemp -d /tmp/athena-w.XXXXXX) || exit 1
timeout 60 node "$D/p.mjs" "$H" 2>&1 | grep -v '^\[warden\]'
case "$H" in /tmp/athena-w.*) rm -rf "$H";; esac
SH
export D; bash "$D/p.sh"; case "$D" in /tmp/athena-w.*) rm -rf "$D";; esac
expect: "welcome while the floor write fails: linked = false | socket still open at center = 1 | frames queued = 3" then "after the disk heals: linked = true | results center stored = none | frames queued = 0" (cured: the link is recycled or linked after the first failure, and the second line stores r0,r1,r2)
```

measured 2026-10-06 by chain chain-cerberus--warden--link-20261006-113710-b85d, finding L5, LOW
probe-key: 72ee66ae1949913cf99c28059c667d5ff7538ead

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/enroll.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/outbox.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/wire.mjs

## INV-7042 — Warden install path — rules an edit must keep: one marker, a vetted address, remove only your own mktemp, a whole script before it runs, a refused version, a raw-path name check

Subject map: MAN-7826.

| rule | why |
|---|---|
| `warden/enroll.sh` holds its address marker ONCE, on the `CENTER` line, and tests the result with `case "$CENTER" in http://* \| https://*)`, never against the marker's own text. | the route replaces EVERY occurrence; a test that names the marker is rewritten with it and passes on any copy. |
| `registerWardenFileRoutes` writes `http://<CERBERUS_LISTEN>` into the script only when `SAFE_LISTEN` (letters, digits, `.` `:` `[` `]` `-`) accepts it; otherwise it registers nothing. | the script is piped into a ROOT shell; an address that could close the single quote would run its own commands there. |
| `enroll.sh` removes only `TMP`, inside `case "$TMP" in /tmp/cerberus-warden.*) rm -rf -- "$TMP";; esac`, and `TMP=$(mktemp -d …) \|\| exit 1`. `build.mjs` removes only its own `mkdtemp` stage, and only while its path begins `dist-warden/stage-`. No other path is removed. | 2026-09-20: an empty variable in `rm -rf "$STATE/$RUN"` deleted about 622 run directories. A release is never pruned for the same reason. |
| The whole of `enroll.sh` sits in `main()`, called on the last line, and nothing inside reads stdin. | `curl \| sh` feeds the file as it arrives: a download cut short must not run half a script, and a child that reads stdin eats the rest of it. |
| `latest.json`'s `version`, `file` and `sha256` are checked (`major.minor.patch`; `file` is exactly `cerberus-warden-<version>.tar.gz`; 64 hex) before any path or command is built from them. | the file comes over HTTP into a script that runs as root. |
| The release is extracted AS the account, and `current` is swapped by a temporary symlink and `mv -T`. A release whose `warden/src/main.mjs` did not appear is never swapped in. | the account owns its home and keys; a reader of `current` sees the old release or the new, never neither. |
| `--refresh` refuses unless `identity.json` exists, takes no name or token, and never touches identity or keys; it renders every `warden/systemd/*.service` the release carries, enables each not yet enabled, and restarts `cerberus-warden` — never `cerberus-warden-sessions`, whose restart kills every live session on the node, and whose failure to start is a warning and not the end of the script (INV-7095). A first install enables every rendered unit the same way. | the first release that adds a second unit must reach nodes that were installed before it. |
| The account, its home and `node`'s path are checked to `A-Za-z0-9._/+@-` before `sed` writes them into a unit; a rendered unit that still holds a `__WORD__` marker stops the install. | a `\|` or `&` in a path would rewrite the unit; an unfilled marker is a unit that cannot start. |
| The file route matches the RAW path against `^cerberus-warden-\d+\.\d+\.\d+\.tar\.gz$` and decodes nothing. | `..`, `%2e%2e`, an encoded slash and `.sha256` all fail the match before a filesystem path is built. |
| `build.mjs` writes the tarball to `<name>.partial` and renames it over its final name only after `tar` exits 0; `latest.json` is renamed in last. | a half file under the final name is served by the route, is called "already built" by the next run, and on a `--force` rebuild has already overwritten the good tarball every node's `latest.json` still names. |
| `enroll.sh` in the enroll branch refuses an existing `identity.json` BEFORE `install_release`. | the swap of `current` moves a running daemon's release, and the refusal that followed was worded "no unit was installed" on a machine that has one. |
| `build.mjs` stages the four session-host files (`host.js`, `host-conn.js`, `host-journal.js`, `host-registry.js`) at their repo paths beside `warden/`, and a release-root `package.json` of `type: module`; `enroll.sh` refuses a machine without `tmux` at `/usr/bin/tmux`. | `sessions.mjs` imports the registry by a relative path that only holds where the files sit as they do in the checkout; the `.js` files take their module type from the nearest package.json, and a release has none of the app's; the sessions unit starts that tmux by absolute path. |
| `build.mjs` refuses a `warden/package.json` with no one-line `cerberus.note` and copies it into `latest.json`; `enroll.sh` copies `warden/src/launcher.mjs` out of `current` to `~/.cerberus-warden/launcher.mjs` on install and on every `--refresh`, BEFORE it renders the units, and the unit's `ExecStart` is that file. | the note is what the Cerberus tab and `update.offer` show for a release; the launcher lives outside every release (INV-7131), and a unit that named a launcher the install never wrote could not start. |
| `build.mjs` refuses a version already built unless `--force`; a plan that changes `warden/` bumps the minor version in `warden/package.json` before it builds. | `--refresh` installs only a newer version, so an unbumped change would never reach a node. |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-files.ts, /home/lyphe/.claude/claudecodeui_lyphe/warden/build.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/enroll.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/systemd/cerberus-warden.service

## INV-7043 — Warden daemon — rules an edit must keep: run.json from the link's events never a timer, stop flushes before it closes, a report never ends the daemon, a bad home is refused before anything is created

Behaviour: MAN-7825 (`run`, `run.json`), MAN-7824 (the link's `onReport`).

| rule | why |
|---|---|
| `run.json` is written only at start, at stop and on the link's own events — `onReport` (a heartbeat, a scheduled retry) and the `welcome` / `checks.set` handlers registered AFTER `createProbes` — never by a timer that reads `link.linked`. | an interval that polls for a change is a watchdog; the link already announces every moment the file is worth rewriting. Registered before `createProbes`, a handler writes the record before the scheduler has applied the checks |
| `onReport` fires after every heartbeat and every scheduled retry (a loss, a failed connect, a missed deadline), and never from `stop()`. | a down link has no heartbeat: each failed attempt is the only event that moves its record, so the queue is seen filling; a stop is not a loss |
| `probes.stop()` runs before `link.stop()`. | the flush at stop needs the link up to carry the last batch |
| `report()` catches its own write failure and logs one line, at start, at a beat and at stop alike; the link catches a throw from `onReport` besides. | a full disk must not end the daemon: under `Restart=always` a daemon that dies at start loops every 5 s and never links, and the node with the full disk is the one Cerberus most needs to hear from |
| `state()` sends `probesRunning: probes.scheduled`, never the in-flight count. | the wire contract (`cerberus-types.ts`) says "how many probes it has scheduled"; between turns nothing is in flight, so a consumer built to the type read 0 |
| `run` takes the home's one-daemon lock (`home-lock.mjs`) before it writes anything; a taken lock is one sentence and exit 1, any other lock error is logged and the daemon goes on. | center closes the older link of a node when a newer one connects: two daemons took it from each other about once a second and both rewrote `state.json`; a platform that cannot bind the lock must still report |
| `probes.stop()` kills the probe commands still going (`killLiveProcesses`), and `runner.stop()` the commands of runs in flight. | a hand-run `run` has no cgroup to take them with it |
| The updater's restart is the daemon's own stop with exit code 75, and `hello.update` is composed into `state()` (INV-7131). | the batch is flushed and the chain saved as for a SIGTERM; the launcher reads 75 as "start the release `current` now names, under probation". |
| The link's `state()` is composed in `daemon.mjs` from the scheduler, the catalog and the runner, and a later plan's field goes there; a frame handler is `link.on(type, fn)` registered before `link.start()`. | a handler registered after the first `welcome` misses it |
| `run` refuses a home with no identity, an incomplete identity or no key with one sentence and exit 1, before it creates or opens anything. | systemd restarts a crashing unit forever; a stray `run` must not leave a home behind |
| The status record's `linked: true` older than 45 s is reported as a daemon that is gone; a `linked: false` record is never judged by its age. | while linked a heartbeat is due every 15 s; with the link down nothing is due, and the age says only how long it has been down |

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/daemon.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/home-lock.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/status.mjs

## INV-7080 — Warden runner — rules an edit must keep: verify version, id, command in order, run only the acked string, one process group, TERM then KILL, bounded output, nothing ticking

Behaviour: the catalog and runner manual row of this package (`run.start`, the run, the output). Link and outbox: MAN-7824, MAN-7835. Daemon: MAN-7832.

| rule | why |
|---|---|
| `run.start` is verified in this order — version, id, command — and the first failure is the whole outcome: `run.refused`, nothing spawned. | the spec's rule (§4); the sentences are what the tab draws in red, so their wording is a contract with `server/modules/cerberus` |
| The command that runs is the catalog's own string (`held.cmd`), never the frame's, and the check is `===`. | a normalised comparison (trimmed, collapsed, case-folded) is a way to run a command nobody acked |
| The catalog is replaced whole by each `catalog.set`, held in memory only, and the ack is sent after it is applied. | a copy on disk could only be a second, staler truth: a restart says `catalogVersion: null` and center answers with the catalog |
| A `catalog.set` below the held version is ignored and not acked; only the catalog in a `welcome` may go to a lower one. | a signature proves who sent a frame, not when: a late older set would roll the catalog back, ack the lower number and run a retired command |
| A one-off's expiry is read when it is looked up; no timer ends it. | a timer that polls for a change is a watchdog; the run that asks is the event |
| The timeout is the smaller of the catalog's and the frame's. | a run is never given longer than was acked |
| A child leads its own process group (`detached`); every signal goes to `-pid`, and only after the pid is checked to be an integer above 1. | a pipeline's every stage must go, and `kill -1` reaches every process the user owns |
| A timed-out run gets SIGTERM, SIGKILL 5 s later, and one more SIGKILL to the group as it is settled; it ends `timed_out` whatever the exit was. | a command that ignores the TERM must not outlive a run reported as ended |
| A run ends at the child's `close`, or 1 s after its `exit`. | a command that leaves a daemon holding its stdout would otherwise keep the run open until the timeout, and then kill what was meant to stay |
| Output batches are armed by a line and never ticked; every run frame goes through the outbox (`reliable`), and a frame the outbox cannot number is one log line, not the end of the run. | a silent run wakes nothing; a full disk must not turn a fix into a crash |
| Output is bounded: 2000 characters a line, 5000 lines or 512 KiB a run, and the count of what was dropped is one last line. | `yes` prints 25 million lines a second; the outbox holds frames in memory until center acks them |
| Escape sequences and control characters are stripped from every line. | a NUL truncates the line in center's SQLite; an escape is drawn as noise |
| `stop()` kills every child and sends nothing more, and runs before `link.stop()` in the daemon. | no command outlives its warden; center reconciles the runs it still counts with the next `hello` (`active.runs`, `active.owed`: MAN-7904) |
| The log carries ids and refusal reasons, never a command or its output. | a fix may carry a secret in its text or print one |
| A run id starts one child, ever: `active` and the last 500 ended ids (`settled`) both turn a repeated `run.start` away with a log line. | center → warden frames carry no freshness and a reconnect can repeat one; a fix that restarts a service or runs a backup must not run twice for one ask |
| The timeout timer is cleared when the shell exits; only the 1 s pipe drain remains. | a deadline landing in that second blamed a command that finished in time for a child it left behind (`timed_out`, exit 0) |
| A command starts in `home` (the account's home directory), never in the warden's state home. | `keys/node.key` lives there |

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/catalog.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/run-lines.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/runner.mjs

## INV-7095 — Warden session host — rules an edit keeps: one implementation, a lost link only detaches, no outbox, no secret in a line, no timer, the sessions unit is never restarted by a refresh

Subject map: MAN-7897.

| rule | why |
|---|---|
| `warden/src/sessions.mjs` imports `host-registry.js` by the relative path `../../server/modules/providers/list/claude/session-host/host-registry.js` and execs that directory's `host.js`; nothing of either is copied or rewritten under `warden/`. `build.mjs` stages `host.js`, `host-conn.js`, `host-journal.js` and `host-registry.js` at their repo paths. | the session host stays ONE implementation: a second copy drifts from the API's, and the host protocol is only as good as its two ends agreeing. The path is the same in the checkout and in a release only because the files sit at the same place in both. |
| A lost link ends every channel's socket and writes nothing to a host: no `end_input`, no `kill`. `end_input` and `kill` go to a host only when center sent that frame on that channel. | a client socket closing is a DETACH (MAN-688); end-of-input is the one thing that ends a CLI, and a link blink must never end a turn. |
| A channel leaves the map BEFORE its socket is ended; `session.closed` is said only for a channel still in the map. | a socket's `close` lands after the link may have come back, and a `session.closed` for a channel center has already given up on closes the NEXT holder of that name. |
| A `session.*` frame is never sent through the outbox (`reliable`), and the warden keeps no queue of host frames. | the host's journal and its cursor are the replay (`hello { fromSeq }`); a second one here would disagree with it. |
| No log line, reason or frame the warden makes names a `spawn` frame, a command or an environment. | the frame carries the CLI's whole environment, secrets included. |
| `sweepDeadHosts()` runs on an event — start, `welcome`, an attach that finds its host dead, a socket that closed with no `exit` — never on a timer. | residue of an ended host is harmless until something says it is there (`listLiveHosts` reads tmux, never the files), and a polling sweep is the lazy watchdog this house does not build. |
| `cerberus-warden-sessions.service` is rendered and enabled by `enroll.sh` and is never restarted by it: `--refresh` restarts `cerberus-warden` alone. `enroll.sh` requires `tmux` at `/usr/bin/tmux`, the path the unit starts. | a restart of that unit kills every live session on the node (its `ExecStop` is `kill-server`); a refresh is not that switch. |
| A host line too big for one frame (8 MiB less 16 KiB of envelope) is never sent: its channel ends with `session.closed` naming the size, the host is detached and the link stands. `MAX_FRAME_MIB` in `sessions.mjs` copies the gateway's `MAX_FRAME_BYTES` (`warden-gateway.ts`) and changes with it. | the gateway closes the WHOLE link on a frame past 8 MiB with no `error`, and the host replays the line from its journal at every attach — a flap that blinds every channel and probe on the node for as long as the host lives. |
| `enroll.sh` treats a sessions unit that will not start as a warning; only the warden's own unit failing to start ends the script. | `set -e` there would stop a refresh with `current` already swapped and `cerberus-warden` never restarted. |
| `.verify/warden-sessions.sh` refuses to run when a server already answers on `-L cerberus-warden`, and its `kill-server` runs only for a server this run started. | that socket is the installed unit's, and the script's last step is `kill-server`; a holder that appears between the check and the start is left standing. |

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/build.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/enroll.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/sessions.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/systemd/cerberus-warden-sessions.service

## INV-7130 — Warden diagnosis tools — rules an edit must keep: no tool runs a string, a unit never starts with `-`, the denylist on the path and its realpath, every text masked, 10 s and 64 KB, one diagnosis, it ends with its link

Behaviour: the diagnosis-tools manual row of this package (`diag.*`, the three tools, the denylist, the mask). Link: MAN-7824. Daemon: MAN-7832. Runner (the other thing that runs on center's word): INV-7080.

| rule | why |
|---|---|
| There is no tool that runs a string. A read is a row of `STATUS_MENU`, `journalctl` for one validated unit, or this process opening a path that passed `resolveReadable`; every spawn is `spawn(binary, argv)` with no `shell`, never `sh -c`. | the diagnosis agent is a model reading what is on a node; a shell would make every sentence it was shown a command |
| A unit name matches `^[A-Za-z0-9@._-]+$` and does not start with `-`. | `systemctl status -H <host>` reaches another machine, and `journalctl -u -<option>` is an option; the pattern alone lets both through |
| A read of a path is refused on the path as asked AND on its `realpath`, before a byte is read: a basename ending `.env` (`.env`, `.eis_backend.env`) or holding `.env.`, `*.pem`, `*.key`, `*.p12`, `id_*`, `.pgpass`, `.netrc`, `credentials*` and `.credentials*`, `.git-credentials`, `auth.json` and `auth-profiles.json`, `.claude.json*` (copies too), a history file (`.bash_history` …), and everything under `~/.ssh`, `~/.cerberus-warden/keys`, this warden's `<home>/keys`, `~/.claude/.credentials.json`, `~/.docker/config.json`, `~/.npmrc`, `/etc/shadow`, `/etc/ssh`, `/root`, and the operator's session transcripts (`~/.cerberus-warden/sessions` and `<home>/sessions`, `~/.claude/projects`, `~/.claude/history.jsonl`, `~/.codex/sessions`, `~/.openclaw/agents/<agent>/sessions`, `~/.cloudcli`). | a symlink named `notes.txt` that points at `.env` is the `.env`; a service's env file is named `<name>.env` as often as `.env`, and an agent's provider keys sit in `auth.json` under a `"key"` field no mask word names; the node key must stay unreadable on a scratch home too, where it is not under `~/.cerberus-warden`; a history file holds the `Authorization: Bearer …` and `postgres://user:pw@` that were typed, and a session journal or a Claude, Codex or OpenClaw transcript is the operator's own conversation — no key word beside either, so the mask cannot be the only guard |
| Every text a `diag.result` carries passes `maskSecrets` — the refusals too — and `contains` filters the MASKED text. Any text cut to a cap is masked BEFORE the cut (a log tail included: the whole window is masked before its last `lines` lines are taken, so a private-key block cannot be cut away from its `BEGIN` line). `maskSecrets` is idempotent — a text is masked at its source and again as it leaves — and every pattern added to it is too. Every quantifier of `maskSecrets` that can start at many places is bounded. | a diagnosis's reads go to a model and into center's store; a filter on the raw text would let a model confirm a guess at a secret one line at a time; a cut before the mask can halve a secret and leave its value's tail with no key word to find; `a.a.a.a…` under an unbounded scheme pattern is a quadratic scan on the event loop the heartbeat shares |
| Every spawn is killed at 10 s and its output capped at 64 KB, the child killed at the cap and `truncated: true`; a `file.read` is capped at 64 KB too; the text SENT is cut to 64 KB after masking. The call is answered at the kill, never at the pipes' `close`. | `yes` prints 25 million lines a second; `diag.result` is one frame on the link; masking lengthens text, so a cap judged before it is not a cap; a child the program forked holds the pipes open and an answer that waited for `close` would wait for it |
| A file is read to its end (up to the cap), never to `stat().size`; an empty read says "(the file is empty)". | `/proc` files stat as 0 and `/sys` ones as a page: a size-bounded read answers `ok: true` with no text for a file that has 1 500 bytes, and "what was found" is the evidence rule |
| A `contains` miss names how many lines it looked at and that the read covers only the latest ones. | "no line contains X" is the sentence a diagnosis cites as "no such error", and absence is never evidence |
| A file is opened read-only and non-blocking (`O_RDONLY` with `O_NONBLOCK`), and only after `stat` says it is a regular file or a directory. | a FIFO opened blocking would hold the warden's event loop for good |
| One diagnosis is open on a node. A second open is answered `diag.opened` and every call under it is `ok: false`, "Another diagnosis is open on this node"; a call under no open diagnosis is refused. | the node's reads are a shared door; center's loop learns on its first read that it does not hold it |
| The open diagnosis ends on `diag.close`, on `link.down` and on `stop()`, and the reads it had going are killed; a read that ends after that is answered to no one. | none of these frames rides the outbox: a link lost mid-diagnosis fails it at center, which never sends `diag.close`, and a ghost would block every later diagnosis and the updater |
| `activeWork()` names the open diagnosis, `onWorkChange` tells when it begins or ends, and nothing ticks. | the updater waits on it; an event wakes it, a timer that polled would be a watchdog |
| The log carries diagnosis ids, check keys, tool names and error codes — never an argument, a path's contents or a result. | the reads are exactly the text that may hold a secret |

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-diag-tools.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-argv.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-guard.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-reads.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-tools.mjs

## INV-7131 — Warden updater and launcher — rules an edit must keep: the launcher imports nothing from a release, a swap is a symlink rename, a welcome proves a start, no release is deleted, nothing polls

Subject map and behaviour: MAN-7929.

| rule | why |
|---|---|
| `launcher.mjs` imports only `node:` built-ins, never a file of a release; the few lines it shares with `update.mjs` (the durable write, the `current` swap) are repeated there. The file names `pending-update.json` and `hello-ok.json` and the shape of the pending record are the contract between the two. | it lives in `~/.cerberus-warden/`, outside every release, so a release that cannot start cannot take its own rescue with it; a copy that imported `current/…/state.mjs` would die with the release it is meant to rescue |
| `current` is changed only by a temporary symlink (`current.next`) renamed over it — by the updater to swap forward and by the launcher to roll back; the rollback swaps `current` BEFORE it rewrites `pending-update.json`. | a reader sees the old release or the new, never neither; a crash between the two rollback steps leaves `current` on the old release and a record not yet marked, which the next launcher finishes as `failed`, whereas the other order would leave a record that says `failed` over a `current` that is still the bad release. The swap is made only onto a release whose `warden/src/main.mjs` is on disk: a `current` that dangles starts nothing every five seconds for ever. |
| A pending record is a trial only while `current` names its `to`; an exit 75 with no record on trial is an ordinary exit, not an immediate restart. An `update.offer` for a version older than the running one is `failed`. | a record about a release `current` is not would roll back whatever `current` is (a refresh inside the minute) for an update that never ran; a release that exits 75 with no update behind it would be restarted dozens of times a second where the unit paces every other failing exit at 5 s; an offer is signed but has no freshness, so a replayed old one must not downgrade the node |
| A release counts as welcomed only by a `hello-ok.json` whose `version` is `pending.to` AND whose `at` is no earlier than `pending.swappedAt`; the release writes it after every `welcome`, before it removes `pending-update.json`. | a leftover from an earlier run of the same version proves nothing; a `welcome` is center letting the release in, so a release that starts and cannot link is rolled back too |
| A record that says `failed` is never put on trial again; a pending record whose names are not one path segment is ignored. | the old release's `hello` still has to carry the reason; a path is never built from a name read off disk without that check |
| `update.mjs` writes `pending-update.json` only after `releases/<to>/` is complete and `releases/<from>/` still exists, and removes it if the swap throws. | a record with nothing to roll back to is a promise ("<from> kept for rollback") that is false; a record over a swap that never happened would be judged by a launcher for a release that never ran |
| No release directory is ever removed by the warden, the launcher or `enroll.sh`. | the previous release is the rollback target; 2026-09-20: an empty variable in `rm -rf` deleted about 622 run directories |
| The updater waits for the fixes in flight on events (`onWorkChange`, the runner's and the diagnosis tools'), with one 10-minute timer; the launcher ends a probation on an `fs.watch` of the home with one 60-second timer and a final read. No sleep loop polls either. | operator, 2026-10-06: "Always event driven, no lazy watchdog checks ever" |
| The restart is the daemon's own clean stop with exit code 75 (`exit` passed to `createUpdater`), after at most 2 s for center's ack of the `restarting` frame. | the batch is flushed and `chain.json` saved as for a SIGTERM; `process.exit(75)` is only the default for a caller with no daemon |

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/launcher.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/release-files.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/update.mjs

## INV-7163 — probe — the launcher "rolls back" onto a release that is not on disk (`launcher.mjs` `revert()`, L164–179)

the launcher "rolls back" onto a release that is not on disk (`launcher.mjs` `revert()`, L164–179)

```probe
D=$(mktemp -d /tmp/athena-probe-l1.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
# launcher: rollback target gone
W=/home/lyphe/.claude/claudecodeui_lyphe/warden
S=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
H=$S/home; mkdir -p "$H/releases/d/warden/src" "$S/bin"; export CERBERUS_WARDEN_HOME=$H
echo 'setInterval(() => {}, 1000)' > "$H/releases/d/warden/src/main.mjs"
ln -s releases/d "$H/current"
printf '{"updateId":"u1","from":"a","to":"d","swappedAt":1}\n' > "$H/pending-update.json"   # releases/a does not exist
cp "$W/src/launcher.mjs" "$S/bin/launcher.mjs"
node "$S/bin/launcher.mjs" > "$S/log" 2>&1 & LP=$!
sleep 3
case "$LP" in ''|*[!0123456789]*|0*|1) ;; *) kill "$LP" 2>/dev/null;; esac
echo "current -> $(readlink "$H/current"); main.mjs reachable: $([ -f "$H/current/warden/src/main.mjs" ] && echo yes || echo no)"
grep -E "rolled back|cannot roll|Cannot find module|no kept" "$S/log" | head -3 | cut -c1-110
case "$S" in /tmp/athena-probe.*) rm -rf "$S";; esac
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe-l1.*) rm -rf "$D";; esac
expect: `current -> releases/a; main.mjs reachable: no` with `[launcher] rolled back to a: no hello within 60 s` and a `Cannot find module` stack while the defect stands; once cured the launcher names the missing release and prints `main.mjs reachable: yes`.
```

measured 2026-10-07 by chain chain-cerberus--updates--warden-update-20261007-023832-67f7, finding L1, LOW
probe-key: 46f94dace7ad050cd484cfc86c20d5b29288bf47

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/launcher.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/release-files.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/update.mjs

## INV-7164 — probe — a child that exits 75 with no update on trial is restarted with no pause (`launcher.mjs` L199–206)

a child that exits 75 with no update on trial is restarted with no pause (`launcher.mjs` L199–206)

```probe
D=$(mktemp -d /tmp/athena-probe-l2.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
# launcher: a release that exits 75 with no pending record is restarted with no pause
W=/home/lyphe/.claude/claudecodeui_lyphe/warden
S=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
H=$S/home; mkdir -p "$H/releases/a/warden/src" "$S/bin"; export CERBERUS_WARDEN_HOME=$H
echo "console.log('up'); process.exit(75);" > "$H/releases/a/warden/src/main.mjs"
ln -s releases/a "$H/current"
cp "$W/src/launcher.mjs" "$S/bin/launcher.mjs"
node "$S/bin/launcher.mjs" > "$S/log" 2>&1 & LP=$!
sleep 3
case "$LP" in ''|*[!0123456789]*|0*|1) ;; *) kill "$LP" 2>/dev/null;; esac
echo "starts in 3 s: $(grep -c '^up' "$S/log")"
case "$S" in /tmp/athena-probe.*) rm -rf "$S";; esac
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe-l2.*) rm -rf "$D";; esac
expect: `starts in 3 s: ` a number in the dozens or more (97–134 measured) while the defect stands; 1–2 once the restart is paced.
```

measured 2026-10-07 by chain chain-cerberus--updates--warden-update-20261007-023832-67f7, finding L2, LOW
probe-key: b8636a9d4ce9f7adaf6d61478f8efb4f017282c5

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/launcher.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/release-files.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/update.mjs

## INV-7165 — probe — a trial is not tied to `current` (`launcher.mjs` L238–246 and L199–206)

a trial is not tied to `current` (`launcher.mjs` L238–246 and L199–206)

```probe
D=$(mktemp -d /tmp/athena-probe-l3.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
# launcher: an unfailed pending record for `b` while `current` is the welcomed release `c` rolls c back to a
W=/home/lyphe/.claude/claudecodeui_lyphe/warden
S=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
H=$S/home; mkdir -p "$S/bin" "$H/releases"; export CERBERUS_WARDEN_HOME=$H
for R in a c; do mkdir -p "$H/releases/$R/warden/src"; cat > "$H/releases/$R/warden/src/main.mjs" <<JS
import fs from 'node:fs';
console.log('up $R');
fs.writeFileSync('$H/hello-ok.json', JSON.stringify({ version: '$R', at: Date.now() }));
setInterval(() => {}, 1000);
JS
done
ln -s releases/c "$H/current"
printf '{"updateId":"u1","from":"a","to":"b","swappedAt":%s}\n' "$(( $(date +%s%3N) - 58000 ))" > "$H/pending-update.json"
cp "$W/src/launcher.mjs" "$S/bin/launcher.mjs"
node "$S/bin/launcher.mjs" > "$S/log" 2>&1 & LP=$!
sleep 5
case "$LP" in ''|*[!0123456789]*|0*|1) ;; *) kill "$LP" 2>/dev/null;; esac
echo "current -> $(readlink "$H/current")"
grep -E "^up|rolled back|resuming|probation over" "$S/log" | cut -c1-110
for P in $(pgrep -f "$H/current/warden/src/main.mjs"); do case "$P" in ''|*[!0123456789]*|0*|1) ;; *) kill "$P" 2>/dev/null;; esac; done
case "$S" in /tmp/athena-probe.*) rm -rf "$S";; esac
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe-l3.*) rm -rf "$D";; esac
expect: `current -> releases/a` with `up c` then `rolled back to a: no hello within 60 s` while the defect stands; `current -> releases/c` and no rollback once a record for another release is treated as stale.
```

measured 2026-10-07 by chain chain-cerberus--updates--warden-update-20261007-023832-67f7, finding L3, LOW
probe-key: 76a0145bdeee4bc35e69afd93a398b996ae38c2f

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/launcher.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/release-files.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/update.mjs

## INV-7166 — probe — an offer for an OLDER version is installed (`update.mjs` `runOffer`, L172–200)

an offer for an OLDER version is installed (`update.mjs` `runOffer`, L172–200)

```probe
D=$(mktemp -d /tmp/athena-probe-l4.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
# updater: an offer for a version OLDER than the running one is taken (a replayed old signed offer downgrades the node)
W=/home/lyphe/.claude/claudecodeui_lyphe/warden
S=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
H=$S/home; mkdir -p "$H/releases" "$S/rel/warden/src" "$S/srv"; export CERBERUS_WARDEN_HOME=$H
RV=$(node -p "require('$W/package.json').version")
mkdir -p "$H/releases/$RV/warden/src"; echo '' > "$H/releases/$RV/warden/src/main.mjs"; ln -s "releases/$RV" "$H/current"
printf '{"name":"cerberus-warden","version":"0.0.1","type":"module"}\n' > "$S/rel/warden/package.json"; echo '' > "$S/rel/warden/src/main.mjs"
tar -czf "$S/srv/old.tar.gz" -C "$S/rel" .
SHA=$(sha256sum "$S/srv/old.tar.gz" | cut -d' ' -f1); SIZE=$(stat -c %s "$S/srv/old.tar.gz")
cat > "$S/drive.mjs" <<'JS'
import http from 'node:http'; import fs from 'node:fs';
const [S, SHA, SIZE] = process.argv.slice(2);
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-length': SIZE }); fs.createReadStream(S + '/srv/old.tar.gz').pipe(r); });
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
const real = process.exit.bind(process), handlers = new Map(); let seq = 0;
process.exit = (code) => { console.log('EXIT ' + code); real(0); };
const link = { on(t, h) { handlers.set(t, [...(handlers.get(t) ?? []), h]); return () => {}; },
  send(t, b, o = {}) { console.log(t, b.step, '-', b.text); return { seq: o.reliable ? ++seq : null }; } };
const { createUpdater } = await import('/home/lyphe/.claude/claudecodeui_lyphe/warden/src/update.mjs');
createUpdater({ link, home: process.env.CERBERUS_WARDEN_HOME, activeWork: () => ({ runs: [] }) });
const offer = { updateId: 'u-old', version: '0.0.1', url: `http://127.0.0.1:${srv.address().port}/old.tar.gz`, sha256: SHA, size: Number(SIZE), note: 'n' };
for (const h of handlers.get('update.offer')) await h(offer);
setTimeout(() => real(0), 3000);
JS
node "$S/drive.mjs" "$S" "$SHA" "$SIZE" 2>&1 | grep -v '^\[warden\]'
echo "running $RV; current -> $(readlink "$H/current")"
case "$S" in /tmp/athena-probe.*) rm -rf "$S";; esac
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe-l4.*) rm -rf "$D";; esac
expect: `EXIT 75` and `current -> releases/0.0.1` while downgrades are accepted; a `failed` step and `current -> releases/<running>` once refused.
```

measured 2026-10-07 by chain chain-cerberus--updates--warden-update-20261007-023832-67f7, finding L4, LOW
probe-key: 84a467bd8ad9530ff572c678362789e73c6e8b60

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/launcher.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/release-files.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/update.mjs

## INV-7184 — probe — LOW — `MAN-7826` (and `warden/MANUAL.md`) give one refusal sentence for two refusals

LOW — `MAN-7826` (and `warden/MANUAL.md`) give one refusal sentence for two refusals

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
SRC=/home/lyphe/.claude/claudecodeui_lyphe
D=$1
mkdir -p "$D/r/warden" && cp "$SRC/warden/build.mjs" "$D/r/warden/" || exit 1
printf '{"name":"x","version":"9.9.9","cerberus":{"note":"line one\\nline two"}}\n' > "$D/r/warden/package.json"
echo "build prints: $(node "$D/r/warden/build.mjs" | head -1)"
echo "rows naming that sentence: $(~/.claude/scripts/docstore get MAN-7826 --text | grep -c 'must be one line')"
EOF
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-probe.?*) cd / && rm -rf -- "$D";; esac
expect: build prints "The note in warden/package.json must be one line." and "rows naming that sentence: 0" while the row names one sentence for both refusals
```

measured 2026-10-07 by chain chain-cerberus--updates--docs-20261007-053846-b365, finding L1, LOW
probe-key: 8e2396044cc1ca953673c1b3bf601b33a675843a

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/

## INV-7185 — probe — LOW — `build.mjs` L9–11 still says center serves from `dist-warden/`, which this plan made the default

LOW — `build.mjs` L9–11 still says center serves from `dist-warden/`, which this plan made the default

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "build.mjs lines naming CERBERUS_WARDEN_DIST: $(grep -c 'CERBERUS_WARDEN_DIST' warden/build.mjs)"
grep -n 'Center serves these three' warden/build.mjs | cut -c1-120
EOF
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-probe.?*) cd / && rm -rf -- "$D";; esac
expect: "build.mjs lines naming CERBERUS_WARDEN_DIST: 0" and line 9 "Center serves these three from `dist-warden/`" while the comment is unqualified
```

measured 2026-10-07 by chain chain-cerberus--updates--docs-20261007-053846-b365, finding L2, LOW
probe-key: ad18b77a8969b5257631bff8caace86a560014f9

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/build.mjs

## INV-7186 — probe — LOW — the note rule is not reachable from `warden/package.json`, the file a builder edits to satisfy it (S7)

LOW — the note rule is not reachable from `warden/package.json`, the file a builder edits to satisfy it (S7)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "rows in the first ten of govern warden/package.json that state the note rule: $(~/.claude/scripts/docstore govern warden/package.json --limit 10 --text | awk '{print $1}' | grep -c -x 'MAN-7949\|MAN-7839\|INV-7042\|MAN-7826')"
EOF
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-probe.?*) cd / && rm -rf -- "$D";; esac
expect: "rows in the first ten … that state the note rule: 0" while no row stating the rule governs warden/package.json (a cure prints 1 or more)
```

measured 2026-10-07 by chain chain-cerberus--updates--docs-20261007-053846-b365, finding L3, LOW
probe-key: 1c98f688aedc8c45c1c2476eb5cd37afe11d6c11

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/package.json
