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
| `prevAt` is stamped at FLUSH, from the last result flushed for the check, and forgotten for every check whose results were dropped: all of them at an overflow flush, the checks of a frame whose `link.send` threw. Never stamped at enqueue. | the chain is of what was sent; a stamp at enqueue would link results that `keepLatest` later drops, and would not restart after a drain. Center judges a lapse as `prevAt === null || at − prevAt > staleAfter` and never compares `prevAt` with what it stored, so a chain that names a lost result reads as an unbroken stretch and its freshness vouches for the old status across the gap. |
| Every result frame holds at most 500 results (`BATCH_LIMIT`) AND 4 MiB (`FRAME_BYTES_LIMIT`); a flush drains the whole batch in frames, leaving no remainder waiting a second. A result alone over 1 MiB (`RESULT_BYTES_LIMIT`) goes as `failing`, "The result was too large to send (<n> MB)", `data` `{ error: 'oversize', bytes }`. | center's gateway closes a socket on a frame past 8 MiB, and the frame at the head of the outbox is resent at every reconnect and never acked: one oversize frame silences the node for good. A component's `data` and `reason` are unbounded by the kind, so the count alone bounds nothing. |
| The flush timer is armed by the first result into an empty batch and disarmed by the flush. No interval ticks while nothing waits. | the house recovers and reacts on events; an idle tick is a poll. |
| A probe's `every` is waited out by `waitFor`, in steps of at most `MAX_TIMER_MS`, re-armed by each turn; never `setInterval` and never a clamp. | center allows `every` up to 2 592 000 s; `setTimeout` past 2 147 483 647 ms fires after 1 ms, and a clamp would run a 30-day probe every 24.86 days. |
| `enqueue` pushes results one at a time, never `batch.push(...results)`. | a spread of about 130 000 arguments overflows the stack, and the probe's own check would go stale instead of reading what the document is. |
| A kind's error is logged by `code ?? name` only, and the `failing` value is a fixed sentence. | a library message can quote a url with its userinfo; center stores `value`. |
| `fire` runs behind a `.catch` (`turn`). | an unawaited rejection ends the whole daemon under Node 22. |

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probes.mjs

## INV-7039 — Warden link — rules an edit must keep: a seq is never handed out twice, a failed `takeSeq` leaves the counter, `onWelcome` throws before the deadline is cleared, verify before parse, nothing unsigned acted on, key on disk before the enroll socket

Behaviour: MAN-7824 (link, outbox, wire), MAN-7825 (enroll, home).

| rule | why |
|---|---|
| A sequence number is never handed out twice, across a restart or a crash: `takeSeq` writes `seqFloor + 1000` (fsynced) before handing out a number at or past the floor. | center treats a `seq` at or below its acked as a resend and answers without storing: a repeat silently loses a batch |
| `ack(n)` raises the counter above `n`, and frames queued under numbers center already holds are renumbered above it (`renumberAbove`), never trimmed as stored. | a lost `state.json` must not swallow results |
| A failed `takeSeq` leaves the counter where it was: `renumberAbove` takes every number inside a `try` and restores `nextSeq` before it rethrows. | a raised counter with unrenumbered frames makes the next `welcome` find nothing to renumber and trim them as stored |
| Anything in `onWelcome` that can throw runs BEFORE `clearTimeout(deadlineTimer)`; `attempt` and `lastLoggedRefusal` reset only after it succeeded. | a throw after the cancel leaves the socket open, never linked and with no deadline; a failing `welcome` must not reset the backoff |
| Every stage of an attempt has a deadline (`ATTEMPT_DEADLINE_MS`) that abandons the socket into the normal backoff: the upgrade, then the `welcome`. | a center that takes the connection and goes silent must not hold the link for good |
| Nothing is sent from the outbox before `welcome`; `flushUnsent` runs only while `linked`, from `sentUpto`. | a `welcome` raises the counter and trims the queue to what center holds: a frame sent before it can carry a number center already has |
| Every frame from center is verified over the exact bytes of `env` with the pinned `centerKey` BEFORE it is parsed, never over a re-serialisation; a failure, or a frame for another node, is dropped and logged once per kind. | a parse and a stringify can respace the same object; a signature over other text proves nothing. The type of an unverified frame is not read |
| `at` and the signature of a connect are fresh on every attempt, including the `readRefusal` request. | center refuses a (node, at) pair it has seen in the last two minutes |
| `overflowing` is read by the caller, which chooses `push` or `keepLatest`; `keepLatest` forces `prevAt` null; a failed release push keeps `overflowing` true. | the outbox cannot know which results a frame holds; the chain before a kept result is gone and center must see a lapse |
| `enroll` refuses a home holding `identity.json` before writing anything, and writes BOTH key halves before the socket opens; a key already in the home is reused, never replaced. | a second enrollment replaces keys center knows; a death after center wrote the node but before `welcome` must leave its key on disk |
| `enroll` pins the key from the `welcome`'s certificate only after the frame verifies against THAT key and the certificate names this node, this key's fingerprint and carries a valid signature; `identity.json` is written last. | a hostile center must not choose whom the node trusts |
| Words from a peer not yet trusted (a refusal, an `error` frame before the key is pinned) reach a terminal only through `oneLine`: first line, control characters removed, 200 characters. | an escape sequence in a refusal body must not run in a person's terminal |
| The warden runs on bare `node` ≥ 22: no dependency, no loader, no TypeScript. | `main.mjs`'s posture, the same as `deploy/dev-supervisor/*.mjs` |

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/enroll.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/outbox.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/state.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/wire.mjs

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

## INV-7041 — probe — LOW — an established link whose peer goes silent is never recycled (open; the builder declared it a follow-up)

LOW — an established link whose peer goes silent is never recycled (open; the builder declared it a follow-up)

```probe
D=$(mktemp -d /tmp/athena-w.XXXXXX) || exit 1
cat > "$D/c.mjs" <<'JS'
import crypto from 'node:crypto'; import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path';
const R = '/home/lyphe/.claude/claudecodeui_lyphe/';
const { WebSocketServer } = await import(R + 'node_modules/ws/wrapper.mjs');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const res = (c, v) => ({ check: c, source: c, at: Date.now(), fetchedAt: Date.now(), status: 'ok', docStatus: null, value: v, data: null, tookMs: 1, prevAt: null });
export async function center(home) {
  const pair = () => crypto.generateKeyPairSync('ed25519'), node = pair(), key = pair(); let connections = 0;
  fs.mkdirSync(path.join(home, 'keys'), { recursive: true });
  fs.writeFileSync(path.join(home, 'keys/node.key'), node.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  process.env.CERBERUS_WARDEN_HOME = home;
  const frame = (type, body) => { const env = JSON.stringify({ type, id: 'x', node: 'probe', seq: null, at: Date.now(), body }); return JSON.stringify({ env, sig: crypto.sign(null, Buffer.from(env), key.privateKey).toString('base64') }); };
  const wss = new WebSocketServer({ noServer: true }), server = http.createServer();
  server.on('upgrade', (req, sock, head) => wss.handleUpgrade(req, sock, head, (ws) => {            // welcomes, then never says another word
    connections += 1; ws.on('error', () => {});
    ws.on('message', (data) => { if (JSON.parse(data.toString()).type === 'hello') ws.send(frame('welcome', { node: 'probe', ackedUpto: 0 })); }); }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const identity = { node: 'probe', center: `http://127.0.0.1:${server.address().port}`, centerKey: key.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  const w = await Promise.all(['link', 'outbox'].map((f) => import(R + `warden/src/${f}.mjs`)));
  return { identity, connections: () => connections, createLink: w[0].createLink, createOutbox: w[1].createOutbox };
}
JS
cat > "$D/p.mjs" <<'JS'
import { center, res, sleep } from './c.mjs';
const home = process.argv[2], c = await center(home), outbox = c.createOutbox({ home }), link = c.createLink({ identity: c.identity, outbox });
link.start(); await sleep(2000);
for (let i = 0; i < 3; i++) link.send('result', { results: [res('svc/c', String(i))] }, { reliable: true });
await sleep(36000);
console.log('after 38 s with no ack and no answer to 2 heartbeats: link.linked =', link.linked, '| connections made =', c.connections(), '| unacked frames =', outbox.size); process.exit(0);
JS
cat > "$D/p.sh" <<'SH'
H=$(mktemp -d /tmp/athena-w.XXXXXX) || exit 1
timeout 90 node "$D/p.mjs" "$H" 2>&1 | grep -v '^\[warden\]'
case "$H" in /tmp/athena-w.*) rm -rf "$H";; esac
SH
export D; bash "$D/p.sh"; case "$D" in /tmp/athena-w.*) rm -rf "$D";; esac
expect: "… link.linked = true | connections made = 1 | unacked frames = 3" (cured: more than one connection)
```

measured 2026-10-06 by chain chain-cerberus--warden--link-20261006-113710-b85d, finding L3, LOW
probe-key: 564d14a8b59788493026e0b6f3bc31a2bcf7e05d

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
| `--refresh` refuses unless `identity.json` exists, takes no name or token, and never touches identity or keys; it renders every `warden/systemd/*.service` the release carries and restarts `cerberus-warden`. | the first release that adds a second unit must reach nodes that were installed before it. |
| The account, its home and `node`'s path are checked to `A-Za-z0-9._/+@-` before `sed` writes them into a unit; a rendered unit that still holds a `__WORD__` marker stops the install. | a `\|` or `&` in a path would rewrite the unit; an unfilled marker is a unit that cannot start. |
| The file route matches the RAW path against `^cerberus-warden-\d+\.\d+\.\d+\.tar\.gz$` and decodes nothing. | `..`, `%2e%2e`, an encoded slash and `.sha256` all fail the match before a filesystem path is built. |
| `build.mjs` writes the tarball to `<name>.partial` and renames it over its final name only after `tar` exits 0; `latest.json` is renamed in last. | a half file under the final name is served by the route, is called "already built" by the next run, and on a `--force` rebuild has already overwritten the good tarball every node's `latest.json` still names. |
| `enroll.sh` in the enroll branch refuses an existing `identity.json` BEFORE `install_release`. | the swap of `current` moves a running daemon's release, and the refusal that followed was worded "no unit was installed" on a machine that has one. |
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
| `probes.stop()` kills the probe commands still going (`killLiveProcesses`). | a hand-run `run` has no cgroup to take them with it |
| The link's `state()` is composed in `daemon.mjs` from the scheduler, and a later plan's field goes there; a frame handler is `link.on(type, fn)` registered before `link.start()`. | a handler registered after the first `welcome` misses it |
| `run` refuses a home with no identity, an incomplete identity or no key with one sentence and exit 1, before it creates or opens anything. | systemd restarts a crashing unit forever; a stray `run` must not leave a home behind |
| The status record's `linked: true` older than 45 s is reported as a daemon that is gone; a `linked: false` record is never judged by its age. | while linked a heartbeat is due every 15 s; with the link down nothing is due, and the age says only how long it has been down |

governs: /home/lyphe/.claude/claudecodeui_lyphe/warden/src/daemon.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/home-lock.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/status.mjs
