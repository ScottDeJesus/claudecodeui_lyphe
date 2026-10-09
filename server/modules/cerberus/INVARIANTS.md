<!-- docstore export; edit rows with docstore write, never this file -->

## INV-7004 — Cerberus store — edits that break it

Behaviour of each: MAN-7805 (connection, steps), MAN-7806 (repositories, updates included), MAN-7896 (catalog and runs), MAN-7927 (diagnoses).

| Edit | Breaks | Why |
|---|---|---|
| Edit, reorder or remove a step in `CERBERUS_MIGRATIONS` that has run on the live store | the live store keeps the old shape while every scratch file builds the new one | position is the version; a change is a new step appended |
| Run a step in a deferred transaction, or read `user_version` outside `BEGIN IMMEDIATE` | the overlapping process of a handover fails on its first `CREATE TABLE` | measured 2026-10-06: 6 processes, 4 rounds — deferred failed 20 of 24 with `database is locked`, `.immediate()` opened 24 of 24 |
| Replace the two `CROSS JOIN`s in `rowsInWindow` with plain `JOIN` | a window read walks every row of the node | no `ANALYZE` ever runs on this store, so the planner drives from `results` on `node` alone: 200 ms a part against 0.1 ms pinned, 466k rows |
| Turn `results.insert`'s `ON CONFLICT … DO NOTHING` into `INSERT OR IGNORE` | a malformed row answers `false` exactly as a resend does, so a lost row is acked as a duplicate | a `false` is a resend, which the caller acks |
| Change `transitions`' whole-instant return or the activity cursor (`before = last.at`, strict `<`) without the other | rows sharing one `at` are skipped at a page boundary | a health document stamps every component with one `at` |
| Edit `transitions`' CTE WHERE (`kind = 'change' AND prev_status IS NOT NULL AND ${statusDiffers()}`) or `pruneKeepalivesBefore`'s (`kind = 'keepalive'`) so it no longer carries its partial index's terms, or edit `ix_results_moves` / `ix_results_keepalives` in step 4 | What happened walks every row of `results` again, and the 04:10 prune scans the table to find keep-alives | SQLite uses a partial index only when the query states the index's WHERE, so the two sides are spelled to match word for word (`statusDiffers()` spells the third term); step 4 has run on the live store, so a changed index is a step 5 |
| Start the prune at `start()` or on a timer measured from the last run, instead of at the next 04:10 (`nextPruneAt`) | every handover pays a full `DELETE` (the server hands over about 170 times a day: 56 runs measured 2026-10-06), and a daylight-saving change moves the hour | an hour of the day is a fixed point, not a wait a restart resets; each run arms the next from the clock |
| Pass an unclamped `limit` to SQL | `LIMIT -1` dumps the table | SQLite reads a negative limit as no limit |
| Let a new `results.at` be a string or fraction | that row is the check's latest for ever | TEXT sorts above every number; the column's affinity cannot refuse it |
| Drop the JS line check or the run-exists read in `cerberusRunsDb.insertOutput` | a malformed line answers as a resend; output filed under no `runs` row is kept for ever | `INSERT OR IGNORE` swallows a NOT NULL / CHECK violation; the prune reaches output only through `runs.requested_at` |
| Delete a `runs` row, or let `cerberusRunsDb.pruneOutputBefore` delete one | the run-exists read in `insertOutput` goes stale; a run's history loses its name | runs are kept for ever; only their lines expire at 90 days |
| Split `cerberusCatalogDb.setAuto` into a read then a write, or let `insert` store `auto` 1 with `capped` set | a capped fix switches on and runs on its own | the cap is checked inside the one `UPDATE` / the `INSERT`'s `CASE` |
| Let `cerberusDiagnosesDb.end` store a proposal on a `failed` end, a proposal that is not `{ name, cmd, general }`, or an `endedAt` that is not whole epoch ms, or drop its throws | a failed diagnosis's command, or a `null` / `{}` proposal, is offered to a warden as a one-off; a NaN `endedAt` stores NULL and the first end wins, so the row is never repaired; an `Infinity` one is offered for ever | `openOneOffs` reads the proposal and the clock only, so the guarantee lives in `end`; the column's affinity refuses nothing |
| Move `cerberusDiagnosesDb.insert`'s `WHERE NOT EXISTS (… status = 'running')` out of the statement into a read before it | two API processes overlapping at a handover both start a diagnosis of one check | the step is frozen and carries no unique index; a read-then-insert is atomic in one process only |
| Turn `cerberusDiagnosesDb.insertStep`'s `ON CONFLICT … DO NOTHING` into `INSERT OR IGNORE`, or drop its diagnosis read | a malformed step answers as a repeat; a step filed under no diagnosis is kept for ever; a step lands under a "Ready" pill | `OR IGNORE` swallows a NOT NULL violation; `diag_steps` has no foreign key; the read is also what answers `false` for an ended diagnosis |
| Cut `cerberusCatalogDb.changes` or `cerberusRunsDb.recent` at `limit` inside a group sharing one instant | a feed cursor (`before` = last row's moment, strict `<`) skips the rest of the group | a health document that flips many checks starts several runs in one millisecond |
| Delete an `updates` or `update_steps` row, prune either table, or turn `cerberusUpdatesDb.insertStep`'s `ON CONFLICT … DO NOTHING` into `INSERT OR IGNORE` | an update loses its history, or a malformed step answers `false` exactly as a resent one does and is lost | updates are kept for ever (spec Table 4); the primary key is the only conflict a resend may meet |
| Drop `result = 'updated' AND ended_at >= @since` from `cerberusUpdatesDb.rolledBackAfterUpdated`, write its step outside its transaction or when the statement changed nothing, or move `ended_at` in it | an `updated` of any age turns `rolled_back` on a stale or resent hello, a second step per resent hello, a `rolled_back` update with no `failed` step, or an activity feed and pause window that lose the moment center heard the release | the guard is the statement's own, so two processes cannot amend twice; it is the one verb that moves an ended update (MAN-7957) |
| Drop the `ended_at IS NULL` guard in `cerberusUpdatesDb.insertStep`, the `MAX(…)` clamp in `end`, or the id / `result` checks in `insert` / `end` | a `restarting` step filed after the end, or an end stored before the start, gives `pauseWindows` a span that ends before it begins; a NULL `result` ends an update with no verdict; a NULL id makes a live update nothing can end, which blocks every later batch | the table lets all four through: no `NOT NULL` on a `PRIMARY KEY`, a `CHECK … IN` passes NULL, and the step 2 DDL that has run on the live store is never edited |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-connection.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-catalog.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-diagnoses.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-mutes.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-results.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-runs.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-updates.db.ts

## INV-7081 — probe — MEDIUM — `insertOutput` trusts `run`: output for an unknown or non-string run is stored where the 90-day prune can never reach it, or silently dropped

MEDIUM — `insertOutput` trusts `run`: output for an unknown or non-string run is stored where the 90-day prune can never reach it, or silently dropped

```probe
P=$(mktemp /tmp/athena-p.XXXXXX) || exit 1
cat > "$P" <<'EOF'
S=$(mktemp -d /tmp/athena-probe-s.XXXXXX) || exit 1
cat > "$S/q.mjs" <<'JS'
const m = await import('/home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts');
const R = m.cerberusRunsDb, db = m.getCerberusConnection();
const w = (run) => { try { return R.insertOutput(run, [{ n: 0, t: 0, stream: 'out', line: 'x' }]); } catch (e) { return 'threw ' + (e.code || e.message); } };
console.log('unknown run:', w('ghost'), '| null run:', w(null), '| number run:', w(5));
R.pruneOutputBefore(9e15);
console.log('orphan lines left after prune:', db.prepare('select count(*) c from run_output').get().c);
JS
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
CERBERUS_DB_PATH="$S/c.db" DATABASE_PATH="$S/a.db" TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx "$S/q.mjs" 2>&1 | grep -v '^Cerberus store'
cd /tmp && case "$S" in /tmp/athena-probe-s.*) rm -rf "$S";; esac
EOF
bash "$P"; rm -f "$P"
```

measured 2026-10-06 by chain chain-cerberus--fixes--store-20261006-205329-d176, finding M1, MEDIUM
probe-key: 95cada9c412bbdb1630a2b8aafe588e1abb5613e

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/store-prune.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-catalog.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-runs.db.ts

## INV-7082 — probe — LOW — the step leaves "five repositories" and "a statement pair" written where there are now seven and three

LOW — the step leaves "five repositories" and "a statement pair" written where there are now seven and three

```probe
P=$(mktemp /tmp/athena-p.XXXXXX) || exit 1
cat > "$P" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
grep -n "the five \`cerberus-\*\.db\.ts\`\|synchronous statement pair" server/modules/database/cerberus-connection.ts server/modules/cerberus/store-prune.service.ts || echo "healed: none left"
EOF
bash "$P"; rm -f "$P"
```

measured 2026-10-06 by chain chain-cerberus--fixes--store-20261006-205329-d176, finding L1, LOW
probe-key: 6ce3f3f394bd08249bffe6220eef095e1ca1ea39

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/store-prune.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-catalog.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-runs.db.ts

## INV-7089 — probe — LOW — `insert` can create the one state `setAuto` is written to refuse: a capped entry with `auto = 1`

LOW — `insert` can create the one state `setAuto` is written to refuse: a capped entry with `auto = 1`

```probe
P=$(mktemp /tmp/athena-p.XXXXXX) || exit 1
cat > "$P" <<'EOF'
S=$(mktemp -d /tmp/athena-probe-s.XXXXXX) || exit 1
cat > "$S/q.mjs" <<'JS'
const m = await import('/home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts');
const C = m.cerberusCatalogDb;
const e = { id: 'cap', node: 'eis1', check_key: 'a/x', name: 'E', run_when: 'failing', cmd: 'true', timeout: 60, auto: 1, limit_runs: 1, limit_per: 3600, capped: 'Reaches outside the fleet', recheck: 1, origin: '{}', created_at: 1 };
let r; try { C.insert(e); r = 'inserted'; } catch (x) { r = 'threw ' + (x.code || x.message); }
const row = C.get('cap');
console.log('capped entry inserted with auto 1 ->', r, '| stored auto:', row ? row.auto : 'no row', '| setAuto(cap,false):', C.setAuto('cap', false));
JS
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
CERBERUS_DB_PATH="$S/c.db" DATABASE_PATH="$S/a.db" TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx "$S/q.mjs" 2>&1 | grep -v '^Cerberus store'
cd /tmp && case "$S" in /tmp/athena-probe-s.*) rm -rf "$S";; esac
EOF
bash "$P"; rm -f "$P"
```

measured 2026-10-06 by chain chain-cerberus--fixes--store-20261006-205329-d176, finding L3, LOW
probe-key: 298f7cc7cdc73c7f85df7510fc7eb049529f76e5

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/store-prune.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-catalog.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-runs.db.ts

## INV-7090 — probe — MEDIUM — `CerberusHelloBody.active` tells center a run the warden does not name was killed by a restart; the warden's own outbox makes that false for every run that ended with its frames unacked

MEDIUM — `CerberusHelloBody.active` tells center a run the warden does not name was killed by a restart; the warden's own outbox makes that false for every run that ended with its frames unacked

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
case "$D" in /tmp/athena-p.*) ;; *) exit 1;; esac
cat > "$D/p.sh" <<'EOF'
D="$(cd "$(dirname "$0")" && pwd)"
R=/home/lyphe/.claude/claudecodeui_lyphe
mkdir "$D/home" || exit 1
cat > "$D/a.mjs" <<'JS'
// The REAL warden runner and outbox behind a stub link that never acks: a run that has ended.
const R = '/home/lyphe/.claude/claudecodeui_lyphe/warden/src/';
const { createOutbox } = await import(R + 'outbox.mjs');
const { createCatalog } = await import(R + 'catalog.mjs');
const { createRunner } = await import(R + 'runner.mjs');
const home = process.argv[2];
const outbox = createOutbox({ home });
const handlers = new Map();
const link = { on: (t, h) => handlers.set(t, h), send: (type, body, opts) => (opts?.reliable ? outbox.push(type, body) : undefined) };
const runner = createRunner({ link, catalog: createCatalog({ link }), home });
handlers.get('catalog.set')({ version: 1, entries: [{ id: 'e', cmd: 'echo hi', timeout: 10 }], oneOffs: [] });
handlers.get('run.start')({ runId: 'r1', catalogVersion: 1, entryId: 'e', proposalId: null, cmd: 'echo hi', timeout: 10, by: 'you' });
await new Promise((r) => setTimeout(r, 1500));
console.log('hello.active.runs would be:', JSON.stringify(runner.activeWork().runs));
console.log('outbox holds, unacked:', outbox.pending(0).map((f) => `${f.seq}:${f.type}`).join(' '));
runner.stop();
process.exit(0);
JS
node "$D/a.mjs" "$D/home" 2>&1 | grep -v '^\[warden\]'
grep -n -o "that the warden does not name here is over[^.]*" "$R/server/shared/cerberus-types.ts" || echo "contract: that sentence is gone"
EOF
bash "$D/p.sh"
cd /tmp && case "$D" in /tmp/athena-p.*) rm -r "$D";; esac
```

measured 2026-10-06 by chain chain-cerberus--fixes--contract-20261006-205328-d4ab, finding M1, MEDIUM
probe-key: e0a85e31b5d84fb4ae1aeb9a9528a6986894d6ae

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/activity.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/check-detail.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/WhatHappenedCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts

## INV-7092 — probe — LOW — the `NODE SESSIONS` banner still defines the outbox as `result` frames, a sentence this change made false

LOW — the `NODE SESSIONS` banner still defines the outbox as `result` frames, a sentence this change made false

```probe
grep -n -F 'The outbox (`result` frames, `seq`, `ack`)' /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts || echo none
```

measured 2026-10-06 by chain chain-cerberus--fixes--contract-20261006-205328-d4ab, finding L2, LOW
probe-key: a11fe6657a3d8b28159967ff97ca18e75fdc88e2

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/activity.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/check-detail.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/WhatHappenedCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts

## INV-7094 — probe — LOW — `recheck` fires on "a run ends", which the contract's own words make include a refusal, and the `runs` phase text says only `ok`

LOW — `recheck` fires on "a run ends", which the contract's own words make include a refusal, and the `runs` phase text says only `ok`

```probe
grep -n -F 'recheck` asks for' /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts | cut -c1-110; grep -n 'result is `ok`' ~/.claude/plans/cerberus--fixes.phases.toml | cut -c1-90
```

measured 2026-10-06 by chain chain-cerberus--fixes--contract-20261006-205328-d4ab, finding L4, LOW
probe-key: 85c063ab2da9117e0f8d9eb402a8eded8c3687ef

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/activity.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/check-detail.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/WhatHappenedCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts

## INV-7096 — The catalog service — edits that break it

Behaviour of each: MAN-7900 (the catalog service), MAN-7803 (the link).

| Edit | Breaks | Why |
|---|---|---|
| Publish a node's set (`recordNextSet`) outside the transaction that writes the entry, retires it or changes it | a crash between the two leaves an entry no set carries; `run.start` is then refused `No entry 'x' in catalog vN` until some unrelated publish | the set and the change that made it commit together; only the `catalog.set` frame goes out after the commit |
| Make `setAuto` publish a set, or send a frame | every toggle burns a version and waits on an ack for a change the warden cannot see | the warden verifies, center decides: auto-run, limit and `when` are never in a set (spec Table 6) |
| Drop the hello stamp in `catalogForWelcome`, or stamp a version at or below the newest acked | an ack lost with the previous link is never repeated (a welcome carries a set only when the versions DIFFER), so `ackedCatalogVersion` trails the warden's own and every `run.start` is refused `not the one this warden acked`; or a late hello moves an older version's ack | the warden's `hello.catalogVersion` is the version it last acked |
| Let `freeEntryId` skip retired entries | a new fix takes a retired fix's id and inherits its runs and its change rows | `cerberusCatalogDb.get` finds retired entries on purpose; a run's history names its entry by id |
| Trim, reflow or re-encode `cmd` anywhere between `POST /catalog` and the set | the warden refuses the run: it compares the command byte for byte | the command is the person's, stored and signed as written; `refuseLoneSurrogate` keeps half a character out of `name`, `cmd` and `capped` because SQLite stores it as U+FFFD |
| Register `catalog.ack` anywhere but once at `start()` before the gateway binds | a second registration throws at boot; a late one loses the first warden's ack | `wardenLinks.registerHandler` refuses a repeat |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/catalog-entry-input.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/catalog.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-link.ts

## INV-7106 — Runs and the auto-run rule — edits that break them

Behaviour of each: MAN-7904 (runs), MAN-7803 (the link that acks run frames), MAN-7814 (the registry).

| Edit | Breaks | Why |
|---|---|---|
| Put the auto-run rule, a limit or the auto switch anywhere but `auto-run.ts`, or send one to a warden | a second place decides what runs unprompted; the warden, which only verifies, starts to hold a trigger it can be argued out of | Cerberus decides, never the warden (spec §4): the catalog set carries `{ id, cmd, timeout }` and nothing else |
| Count only runs that succeeded (or only ended ones) in `autoRunsSince`, or count manual runs | a fix that keeps failing loops past its limit; or a person's press eats the entry's automatic budget | every AUTO run asked for counts, whatever came of it; a manual run never does |
| Let `startRun` insert its row before the ack wait ends, or drop `starting` | `catalog_version` is a guess, or a second press during the wait reads "no active run" and two children run for one check | the row names the version the warden acked, and the 409 reads the in-flight set as well as the store |
| Make the ack wait poll, or lengthen it past what a person waits for | a timer decides what an event already knows; a press hangs | `notifyCatalogAcked` ends the wait the moment the ack is stamped; 10 s is the bound |
| Send the entry's `cmd` through any transformation, or send the warden anything but the acked version | the warden refuses the run (or, worse, a normalised command is the one that runs) | `run.start` carries the `catalog` row's command byte for byte and the newest ACKED version; the warden's three checks stay the only judge |
| Handle a run frame whose run is not this node's, or take `run.end` after `run.refused` | one warden ends or feeds another node's run; a refused run grows an exit | `runOfFrame` checks the node; `markEnded` fires once, the first end wins |
| Skip the link's ack for a numbered frame, or ack before its handler returned | the warden's outbox never drains (every reconnect resends every run line), or a frame that threw is never seen again | `run.*` frames share `result`'s sequence: acked after the handler, a resend at or below `acked_seq` is answered and not handled twice |
| Recheck on anything but a first `ok` end of an entry with `recheck`, or run any probe but the run's own check's | a failed fix re-measures nothing worth measuring; one fix triggers other checks (entries never chain) | one check, one fix, one probe; `reporting_probe` is the probe that reports the check |
| Conclude from a hello that does not say (`active.runs` null), end a run the hello names in `runs` or `owed`, or end an unnamed run by the process's start when the warden DOES report `owed` | a warden older than the runner has every live run ended `failed`; a run that ended while the link was down loses the outbox frames that would have ended it; a `run.start` lost on a dropped link while the process lived on holds its check for ever | `owed` is the warden's own account of what it still owes: with it, a run named in neither list is lost; without it (an older build) only a run of a process that is gone, told by `startedAt`, is ended |
| Drop `owed` from the warden's `state()` (`daemon.mjs` `runsOwed`), or name in it a run whose frames center already acked | every lost `run.start` is back to holding its check until a warden restart, or a finished run is left live for ever | the list is exactly the run ids in unacked `run.*` frames of the outbox that are not running |
| Act on every move ingest hands over (`auto-run.ts` without the net-move-per-check and staleness tests) | a failure that healed hours ago, replayed from a warden's outbox, runs a fix on a healthy node and spends one of the entry's runs | a move is an event only while it is news: a frame's moves of one check are judged as ONE net move (the first `from` to the last `to`: `[ok, failing, ok]` is no move, `[ok, warn, failing]` is ok into failing, which a `when: warn` entry must see), and a result older than the check's `stale_after` is history |
| Store a warden's `startedAt` / `endedAt` as it sent them, or stop clamping them (`run-frames.ts` `onCenterClock`) | a warden clock behind by more than a run's length loses the run's `ended` line when the feed is paged; one reading far ahead keeps the run on its need for ever | all of a run's moments are center's clock, between the request and now |
| Let `ackedVersionCovering` answer from the newest ACKED set instead of the newest set | a press in the round trip after a catalog write names a version the warden has already moved past and is refused, and an auto run spends its slot | a `run.start` reaches the warden behind the `catalog.set` sent before it |
| Hint a run's check before its write commits, or coalesce `cerberus_run_output` | a screen re-reads before the row exists; a running fix's lines arrive a second late and in clumps | output is a picture sent once per stored batch; the hint is coalesced and follows the write |
| Hint a run's check on every `run.output` batch | an open sheet re-reads three routes once a second for as long as a fix prints; a 12-line run costs a round trip per second | a run's start and end hint; its lines are the `cerberus_run_output` frame (`useRunOutput`, `useRunLastLine`) |
| Start an auto run on the entry as the rule chose it, without reading it again after the ack wait (`startRun`) | an entry switched off, capped or retired in the 10 s wait still runs, or is written `failed`: a run that never was is in the history and spends the entry's limit | `startRun` reads the entry after the wait; an auto run whose entry is off, capped or retired is not written or sent, and leaves one log line |
| Bound a need's going run by the check's `since` (`needRuns` in `run-views.ts`) | a status that moves while its fix runs (warn to failing as the service restarts) takes `since` past the run's request, and the card offers Run beside a fix that is running: the press meets a 409 | an active run (`ended_at` NULL) always shows; `since` bounds only an ended run's linger |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/auto-run.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/catalog-ack.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/run-views.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-ending.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-frames.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-reconcile.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/runs.service.ts

## INV-7132 — probe — MEDIUM — the repository writes any value for its two clocks: `insert`'s `started_at` and `end`'s `endedAt` (cure: one whole-millisecond check in each, as the sibling repositories carry)

MEDIUM — the repository writes any value for its two clocks: `insert`'s `started_at` and `end`'s `endedAt` (cure: one whole-millisecond check in each, as the sibling repositories carry)

```probe
P=$(mktemp /tmp/athena-probe.XXXXXX) || exit 1
cat > "$P" <<'EOF'
S=$(mktemp -d /tmp/athena-probe-s.XXXXXX) || exit 1
case "$S" in /tmp/athena-probe-s.*) ;; *) exit 1;; esac
cat > "$S/q.mjs" <<'JS'
const m = await import('/home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts');
const D = m.cerberusDiagnosesDb;
const t = (f) => { try { return f(); } catch (e) { return 'threw ' + (e.code || e.name); } };
const ins = (o) => D.insert({ id: 'd', node: 'eis1', check_key: 'a/x', asked_by: 'op', model: 'haiku', started_at: 1000, ...o });
const P = '{"name":"n","cmd":"c","general":"c"}';
ins({ id: 'ok1' });
console.log('insert started_at zzz:', t(() => { ins({ id: 'bad', started_at: 'zzz' }); return 'accepted'; }), '| latestForCheck since 0:', D.latestForCheck('eis1', 'a/x', 0)?.id);
ins({ id: 'n1', check_key: 'n' });
console.log('end endedAt NaN:', t(() => D.end('n1', 'done', { endedAt: NaN, summary: 's', evidence: '[]', proposal: P })), '| ended_at:', JSON.stringify(D.get('n1')?.ended_at ?? null), '| re-end:', t(() => D.end('n1', 'done', { endedAt: 5000, summary: 's' })), '| openOneOffs(6000):', D.openOneOffs('eis1', 6000).length);
ins({ id: 'i1', check_key: 'i' });
console.log('end endedAt Infinity:', t(() => D.end('i1', 'done', { endedAt: Infinity, summary: 's', evidence: '[]', proposal: P })), '| open at 9e15:', D.openOneOffs('eis1', 9e15).map((r) => r.id).join(',') || 'none');
JS
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
CERBERUS_DB_PATH="$S/c.db" DATABASE_PATH="$S/a.db" TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx "$S/q.mjs" 2>&1 | grep -v '^Cerberus store'
cd /tmp && rm -rf "$S"
EOF
bash "$P"; rm -f "$P"
expect: while the defect stands — `insert started_at zzz: accepted | latestForCheck since 0: bad`, `end endedAt NaN: true | ended_at: null | re-end: false | openOneOffs(6000): 0`, `end endedAt Infinity: true | open at 9e15: i1`; cured — `threw RangeError` on each write, `latestForCheck … ok1`, nothing open at 9e15
```

measured 2026-10-07 by chain chain-cerberus--diagnosis--store-20261007-023833-2ac9, finding M1, MEDIUM
probe-key: 35b809551f9883370bd40930adc61c0899f95395

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-diagnoses.db.ts

## INV-7133 — probe — LOW — `end` stores a conclusion its docblock says cannot exist: a `done` with no summary, a `failed` with no error, a proposal that is not `{ name, cmd, general }`

LOW — `end` stores a conclusion its docblock says cannot exist: a `done` with no summary, a `failed` with no error, a proposal that is not `{ name, cmd, general }`

```probe
P=$(mktemp /tmp/athena-probe.XXXXXX) || exit 1
cat > "$P" <<'EOF'
S=$(mktemp -d /tmp/athena-probe-s.XXXXXX) || exit 1
case "$S" in /tmp/athena-probe-s.*) ;; *) exit 1;; esac
cat > "$S/q.mjs" <<'JS'
const m = await import('/home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts');
const D = m.cerberusDiagnosesDb;
const t = (f) => { try { return f(); } catch (e) { return 'threw ' + (e.code || e.name); } };
const ins = (o) => D.insert({ id: 'd', node: 'eis1', check_key: 'a/x', asked_by: 'op', model: 'haiku', started_at: 1000, ...o });
for (const [id, text] of [['e1', 'null'], ['e2', 'not json'], ['e3', '{}'], ['e4', '']]) { ins({ id, check_key: id }); console.log('proposal', JSON.stringify(text), '->', t(() => { D.end(id, 'done', { endedAt: 5000, summary: 's', evidence: '[]', proposal: text }); return 'stored'; })); }
console.log('openOneOffs:', D.openOneOffs('eis1', 6000).map((r) => r.id + '=' + JSON.stringify(r.proposal)).join(' ') || 'none');
ins({ id: 'f1', check_key: 'f1' }); ins({ id: 'f2', check_key: 'f2' });
console.log('done w/o summary:', t(() => D.end('f1', 'done', { endedAt: 5000 })), JSON.stringify(D.get('f1')?.summary ?? null), '| failed w/o error:', t(() => D.end('f2', 'failed', { endedAt: 5000 })), JSON.stringify(D.get('f2')?.error ?? null));
JS
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
CERBERUS_DB_PATH="$S/c.db" DATABASE_PATH="$S/a.db" TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx "$S/q.mjs" 2>&1 | grep -v '^Cerberus store'
cd /tmp && rm -rf "$S"
EOF
bash "$P"; rm -f "$P"
expect: while the defect stands — four `-> stored` lines, `openOneOffs: e1="null" e2="not json" e3="{}" e4=""`, `done w/o summary: true null | failed w/o error: true null`; cured — each refused (`threw …`) or `openOneOffs: none`
```

measured 2026-10-07 by chain chain-cerberus--diagnosis--store-20261007-023833-2ac9, finding L1, LOW
probe-key: bd12071a17c63358b00a704bd4ccc067169adcb7

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-diagnoses.db.ts

## INV-7134 — probe — LOW — a step is accepted after its diagnosis has ended

LOW — a step is accepted after its diagnosis has ended

```probe
P=$(mktemp /tmp/athena-probe.XXXXXX) || exit 1
cat > "$P" <<'EOF'
S=$(mktemp -d /tmp/athena-probe-s.XXXXXX) || exit 1
case "$S" in /tmp/athena-probe-s.*) ;; *) exit 1;; esac
cat > "$S/q.mjs" <<'JS'
const m = await import('/home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts');
const D = m.cerberusDiagnosesDb;
const t = (f) => { try { return f(); } catch (e) { return 'threw ' + (e.code || e.name); } };
D.insert({ id: 's', node: 'eis1', check_key: 's/z', asked_by: 'op', model: 'haiku', started_at: 1000 });
D.end('s', 'done', { endedAt: 50, summary: 's', evidence: '[]' });
console.log('step filed after the end:', t(() => D.insertStep('s', 0, 60, 'late')), '| steps:', D.steps('s').length);
JS
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
CERBERUS_DB_PATH="$S/c.db" DATABASE_PATH="$S/a.db" TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx "$S/q.mjs" 2>&1 | grep -v '^Cerberus store'
cd /tmp && rm -rf "$S"
EOF
bash "$P"; rm -f "$P"
expect: while the defect stands — `step filed after the end: true | steps: 1`; cured — `threw RangeError` / `false` and `steps: 0`, or the docblock names the service as owner
```

measured 2026-10-07 by chain chain-cerberus--diagnosis--store-20261007-023833-2ac9, finding L2, LOW
probe-key: 5e6152caea1cbe8d95dbd8610cca185ae5d2bb4c

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-diagnoses.db.ts

## INV-7135 — probe — LOW — no statement lists the running diagnoses, so a restart's orphan can never be found and ended (flag for the service phase)

LOW — no statement lists the running diagnoses, so a restart's orphan can never be found and ended (flag for the service phase)

```probe
P=$(mktemp /tmp/athena-probe.XXXXXX) || exit 1
cat > "$P" <<'EOF'
S=$(mktemp -d /tmp/athena-probe-s.XXXXXX) || exit 1
case "$S" in /tmp/athena-probe-s.*) ;; *) exit 1;; esac
cat > "$S/q.mjs" <<'JS'
const m = await import('/home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts');
m.cerberusDiagnosesDb.insert({ id: 'orphan', node: 'eis1', check_key: 'o/y', asked_by: 'op', model: 'haiku', started_at: 1 });
m.closeCerberusConnection();
const D2 = (await import('/home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts')).cerberusDiagnosesDb;
console.log('after reopen runningForCheck:', D2.runningForCheck('eis1', 'o/y')?.id ?? 'none', '| statements that list running rows:', Object.keys(D2).filter((k) => /running|active|unended/i.test(k) && k !== 'runningForCheck').join(',') || 'none');
JS
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
CERBERUS_DB_PATH="$S/c.db" DATABASE_PATH="$S/a.db" TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx "$S/q.mjs" 2>&1 | grep -v '^Cerberus store'
cd /tmp && rm -rf "$S"
EOF
bash "$P"; rm -f "$P"
expect: while the defect stands — `after reopen runningForCheck: orphan | statements that list running rows: none`; cured — a listing statement is named, or `runningForCheck: none`
```

measured 2026-10-07 by chain chain-cerberus--diagnosis--store-20261007-023833-2ac9, finding L3, LOW
probe-key: d0b385f075607aaa041948a22cff2695be132019

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-diagnoses.db.ts

## INV-7136 — probe — LOW — two `running` rows for one check across the handover overlap

LOW — two `running` rows for one check across the handover overlap

```probe
P=$(mktemp /tmp/athena-probe.XXXXXX) || exit 1
cat > "$P" <<'EOF'
S=$(mktemp -d /tmp/athena-probe-s.XXXXXX) || exit 1
case "$S" in /tmp/athena-probe-s.*) ;; *) exit 1;; esac
cat > "$S/q.mjs" <<'JS'
const m = await import('/home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts');
const D = m.cerberusDiagnosesDb, db = m.getCerberusConnection();
const t = (f) => { try { return f(); } catch (e) { return 'threw ' + (e.code || e.name); } };
const ins = (o) => D.insert({ id: 'd', node: 'eis1', check_key: 'tw', asked_by: 'op', model: 'haiku', started_at: 1000, ...o });
ins({ id: 'twin' });
console.log('second running insert for one check:', t(() => { ins({ id: 'twin2', started_at: 2000 }); return 'accepted'; }), '| running rows:', db.prepare("select count(*) c from diagnoses where check_key = 'tw' and status = 'running'").get().c);
JS
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
CERBERUS_DB_PATH="$S/c.db" DATABASE_PATH="$S/a.db" TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx "$S/q.mjs" 2>&1 | grep -v '^Cerberus store'
cd /tmp && rm -rf "$S"
EOF
bash "$P"; rm -f "$P"
expect: while the defect stands — `second running insert for one check: accepted | running rows: 2`; cured — refused or `running rows: 1`
```

measured 2026-10-07 by chain chain-cerberus--diagnosis--store-20261007-023833-2ac9, finding L4, LOW
probe-key: 5a24a47fef946825d17665f3cbdffd0e14cb64a0

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-diagnoses.db.ts

## INV-7137 — probe — LOW — MAN-7927 sends the reader to MAN-7806 for the row types, and MAN-7806's list does not hold them

LOW — MAN-7927 sends the reader to MAN-7806 for the row types, and MAN-7806's list does not hold them

```probe
docstore get MAN-7806 --text | grep -c "CerberusDiagnosis" || true
expect: while the defect stands — `0`; cured — a number of 1 or more
```

measured 2026-10-07 by chain chain-cerberus--diagnosis--store-20261007-023833-2ac9, finding L5, LOW
probe-key: 66c60707bc6378ffe2580b5f4a505286e381eb36

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-diagnoses.db.ts

## INV-7138 — probe — [MEDIUM] `hello.active.diags` is described two ways; the `hello` doc is the one that is wrong

[MEDIUM] `hello.active.diags` is described two ways; the `hello` doc is the one that is wrong

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && echo "hello doc says kept: $(grep -c 'kept across a reconnect' server/shared/cerberus-types.ts); close doc says dropped with socket: $(grep -c 'drops the session with the socket' server/shared/cerberus-types.ts); warden ends on link.down: $(grep -c "link.on('link.down'" warden/src/diag-tools.mjs)"
expect: three counts of 1 while the defect stands (the contract says both "kept" and "dropped with the socket"); after the cure `kept` is 0
```

measured 2026-10-07 by chain chain-cerberus--diagnosis--contract-20261007-023833-5787, finding M1, MEDIUM
probe-key: 66a6e4fe01db239d2fc7f1f84775ecb2197fd926

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/check-detail.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts

## INV-7139 — probe — [MEDIUM] No rule says what center does with a diagnosis it holds `running` when the node's link is replaced or says hello again — the one trigger "a link lost mid-diagnosis fails it" has no case for

[MEDIUM] No rule says what center does with a diagnosis it holds `running` when the node's link is replaced or says hello again — the one trigger "a link lost mid-diagnosis fails it" has no case for

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && awk '/^\/\*\*/{b=""} {b=b $0 "\n"} /^export type CerberusHelloBody/{print b; exit}' server/shared/cerberus-types.ts | tr '\n' ' ' | grep -c -i "ends it .failed.[^.]*diagnos\|diagnos[^.]*ends it .failed"
expect: 0 while the hello doc names no rule that ends a held diagnosis (its only `ends it failed` sentences are about runs); 1 once it does
```

measured 2026-10-07 by chain chain-cerberus--diagnosis--contract-20261007-023833-5787, finding M2, MEDIUM
probe-key: 98b5a418c4af251fe1fff0ca81a5fb3b3be43eba

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/check-detail.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts

## INV-7140 — probe — [MEDIUM] `ok` and `truncated` are defined three ways in the contract and the warden does a fourth

[MEDIUM] `ok` and `truncated` are defined three ways in the contract and the warden does a fourth

```probe
D=$(mktemp -d /tmp/athena-pr.XXXXXX) || exit 1; case "$D" in /tmp/athena-pr.*) ;; *) exit 1;; esac
cat > "$D/p.sh" <<'EOF'
D=$(cd "$(dirname "$0")" && pwd)
mkdir "$D/home" "$D/data" || exit 1
printf 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n' > "$D/data/ten.log"
cat > "$D/p.mjs" <<'JS'
const dir = process.argv[2];
let mod; try { mod = await import('/home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-tools.mjs'); } catch (e) { console.log('PROBE warden module: none (' + (e.code ?? e.message) + ')'); process.exit(0); }
const handlers = new Map(); const sent = [];
const link = { on: (t, h) => handlers.set(t, h), send: (type, body) => sent.push({ type, body }) };
const tools = mod.createDiagTools({ link, home: `${dir}/home` });
const emit = (t, b) => handlers.get(t)?.(b); const take = () => sent.splice(0);
emit('diag.open', { diagId: 'd1', check: 'a/b' }); take();
emit('diag.open', { diagId: 'd2', check: 'a/c' });
console.log('PROBE second diag.open answered with frames:', JSON.stringify(take().map((f) => f.type)));
emit('diag.call', { diagId: 'd1', callId: 'c1', tool: 'log.read', args: { path: `${dir}/data/ten.log`, lines: 2 } });
await new Promise((r) => setTimeout(r, 400));
const cut = take()[0]?.body;
console.log('PROBE log.read lines=2 of a 10-line file: ok=%s truncated=%s', cut?.ok, cut?.truncated);
emit('diag.call', { diagId: 'd1', callId: 'c2', tool: 'log.read', args: { path: `${dir}/data/ten.log`, contains: 'zzz-absent' } });
await new Promise((r) => setTimeout(r, 400));
const none = take()[0]?.body;
console.log('PROBE log.read contains matches nothing: ok=%s', none?.ok);
emit('link.down', {});
console.log('PROBE hello diags after link.down:', JSON.stringify(tools.activeWork().diags));
tools.stop(); process.exit(0);
JS
cd /tmp && timeout 60 node "$D/p.mjs" "$D" 2>&1 | grep '^PROBE'
EOF
bash "$D/p.sh"; cd /tmp && case "$D" in /tmp/athena-pr.*) rm -rf "$D";; esac
expect: `log.read lines=2 …: ok=true truncated=false` and `contains matches nothing: ok=true` (the banner says found-nothing is ok:false and the field doc says a line limit makes truncated true), and `hello diags after link.down: []`
```

measured 2026-10-07 by chain chain-cerberus--diagnosis--contract-20261007-023833-5787, finding M3, MEDIUM
probe-key: 4d317e8c8bfbab6e6c7531c23af2bace9600f35d

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/check-detail.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts

## INV-7141 — probe — [MEDIUM] A second `diag.open` is acknowledged by the real warden and "answered with no `diag.opened`" by the contract

[MEDIUM] A second `diag.open` is acknowledged by the real warden and "answered with no `diag.opened`" by the contract

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && echo "contract says refused open gets no opened: $(grep -c 'sends none for the refused id' server/shared/cerberus-types.ts); warden acks after the refusal branch: $(grep -c "say('diag.opened'" warden/src/diag-tools.mjs)"
expect: `1` and `1` while the two disagree; the same probe in M3 prints `["diag.opened"]` for the second open
```

measured 2026-10-07 by chain chain-cerberus--diagnosis--contract-20261007-023833-5787, finding M4, MEDIUM
probe-key: ac7b4aeea9870fbe61fb00b398c6dd9f992c4753

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/check-detail.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts

## INV-7142 — probe — [LOW] `CerberusDiagnosisStep` credits the wrong author for most steps

[LOW] `CerberusDiagnosisStep` credits the wrong author for most steps

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && awk '/^\/\*\*/{b=""} {b=b $0 "\n"} /^export type CerberusDiagnosisStep/{print b; exit}' server/shared/cerberus-types.ts | grep -c -i "fixed words\|each tool call\|per tool call\|closing step\|opening step"
expect: 0 while the doc names only `note` and "when it has something to say"; 1 or more once center's opening, per-call and closing steps are named
```

measured 2026-10-07 by chain chain-cerberus--diagnosis--contract-20261007-023833-5787, finding L1, LOW
probe-key: 83b8cb9edc5dfd71877c24085ce0051e3cf1e575

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/check-detail.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts

## INV-7143 — probe — [LOW] The fate of a `diag.result` or `diag.close` center cannot place is not stated, and "ALWAYS a `diag.result`" overclaims

[LOW] The fate of a `diag.result` or `diag.close` center cannot place is not stated, and "ALWAYS a `diag.result`" overclaims

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && echo "result doc names an unplaceable result: $(awk '/^\/\*\*/{b=""} {b=b $0 "\n"} /^export type CerberusDiagResultBody/{print b; exit}' server/shared/cerberus-types.ts | grep -c -i 'never issued\|cannot place\|after .diag.close\|dropped')"
expect: 0 while the doc is silent; 1 or more once it says what center does with one
```

measured 2026-10-07 by chain chain-cerberus--diagnosis--contract-20261007-023833-5787, finding L2, LOW
probe-key: a79d5dedc97e32db392b881255ad7192187c7ff2

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/check-detail.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts

## INV-7144 — probe — [LOW] Two reads of the view the panel has to resolve are unsaid: the name behind `promotedTo`, and a sheet diagnosis older than its need

[LOW] Two reads of the view the panel has to resolve are unsaid: the name behind `promotedTo`, and a sheet diagnosis older than its need

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && echo "promotedTo doc says how the name is found: $(awk '/^\/\*\*/{b=""} {b=b $0 "\n"} /^export type CerberusDiagnosisView/{print b; exit}' server/shared/cerberus-types.ts | grep -c -i 'resolves\|looks up\|against the catalog')"
expect: 0 while the doc is silent; 1 or more once it says where the panel's catalog name comes from
```

measured 2026-10-07 by chain chain-cerberus--diagnosis--contract-20261007-023833-5787, finding L3, LOW
probe-key: 2f45e7b77ba8eb5221934c7cad36806fcf59e685

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/check-detail.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts

## INV-7145 — probe — (MEDIUM) — an offer for the version a warden already runs has no ending: the row can only end `failed`, after holding the batch lock 3 minutes

(MEDIUM) — an offer for the version a warden already runs has no ending: the row can only end `failed`, after holding the batch lock 3 minutes

```probe
D=$(mktemp -d /tmp/athena-p1.XXXXXX) || exit 1
case "$D" in /tmp/athena-p1.*) ;; *) exit 1;; esac
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
f=server/shared/cerberus-types.ts
echo "offer doc:"; grep -n -F 'Already on' "$f" | cut -c1-110
view=$(awk '/^\/\*\*/{b=""} {b=b $0 "\n"} /^export type CerberusUpdateView /{printf "%s", b; exit}' "$f" | tr '\n' ' ' | sed 's/ \* / /g; s/  */ /g')
echo "view doc, what ends an update updated:"; printf '%s\n' "$view" | grep -oE '`updated` \([^)]*\)' || echo 'none'
printf 'view doc words about an offer for the running version: '; printf '%s\n' "$view" | grep -ciE 'already|same version|running version'
echo "warden (the real updater) on a same-version offer:"; grep -n "SAME " warden/src/update.mjs | cut -c1-130
EOF
bash "$D/p.sh"
cd /tmp && case "$D" in /tmp/athena-p1.*) rm -r "$D";; esac
expect: the view doc defines `updated` only as `(the node's next hello named `to`)` and mentions "already" 0 times, while the offer doc says "Already on <version>" and the warden's SAME line says nothing else happens; cured when the view doc names what ends that answer (count above 0)
```

measured 2026-10-07 by chain chain-cerberus--updates--contract-20261007-023832-1d31, finding M1, MEDIUM
probe-key: 16ab54d5a6702f301f4767e34bac0a87f8f4bf97

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-7146 — probe — (LOW) — the hello's `update` sentence claims "never on a later one" and says nothing of a repeat or a stranger

(LOW) — the hello's `update` sentence claims "never on a later one" and says nothing of a repeat or a stranger

```probe
D=$(mktemp -d /tmp/athena-p2.XXXXXX) || exit 1
case "$D" in /tmp/athena-p2.*) ;; *) exit 1;; esac
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
f=server/shared/cerberus-types.ts
para=$(awk '/^\/\*\*/{b=""} {b=b $0 "\n"} /^export type CerberusHelloBody /{printf "%s", b; exit}' "$f" | tr '\n' ' ' | sed 's/ \* / /g; s/  */ /g' | grep -oE '`update` is how an update ends.*')
printf '%s\n' "$para" | grep -oE 'never on a later one' || echo 'no "never on a later one" claim'
printf 'words in the update paragraph that settle a repeated or a stranger updateId: '; printf '%s\n' "$para" | grep -oiE 'repeat|again|already ended|ended already|does not hold|stranger|first end|unknown updateId' | wc -l
echo "the real updater repeats update on every hello until a welcome has followed:"; grep -n "hello of this process carried it" warden/src/update.mjs | cut -c1-120
EOF
bash "$D/p.sh"
cd /tmp && case "$D" in /tmp/athena-p2.*) rm -r "$D";; esac
expect: prints `never on a later one`, a word count of 0, and the warden's comment line 22; cured when the claim is qualified and the count is above 0
```

measured 2026-10-07 by chain chain-cerberus--updates--contract-20261007-023832-1d31, finding L1, LOW
probe-key: d253681ad1a2a0b9d85c4a72dcfa7f79213fa24c

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-7147 — probe — (LOW) — the clock of the update times is unsaid

(LOW) — the clock of the update times is unsaid

```probe
D=$(mktemp -d /tmp/athena-p3.XXXXXX) || exit 1
case "$D" in /tmp/athena-p3.*) ;; *) exit 1;; esac
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
f=server/shared/cerberus-types.ts
for t in CerberusUpdateView CerberusUpdateProgressBody; do
  printf '%s clock words: ' "$t"
  awk -v t="$t" '/^\/\*\*/{b=""} {b=b $0 "\n"} $0 ~ "^export type " t " " {printf "%s", b; exit}' "$f" | grep -ciE "clock|center.s time|offset"
done
echo "the store's own wording:"; grep -n "stamped with the center" server/modules/database/cerberus-schema.ts | cut -c1-140
EOF
bash "$D/p.sh"
cd /tmp && case "$D" in /tmp/athena-p3.*) rm -r "$D";; esac
expect: both clock-word counts print 0 and the store's comment line prints; cured when the view doc's count is above 0
```

measured 2026-10-07 by chain chain-cerberus--updates--contract-20261007-023832-1d31, finding L2, LOW
probe-key: 3d102d3eb7e21ccc46f72db32906f0d66e78f0b8

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-7148 — probe — (LOW) — `CerberusUpdateOfferBody.url` is "where to fetch its tarball", its form unsaid

(LOW) — `CerberusUpdateOfferBody.url` is "where to fetch its tarball", its form unsaid

```probe
D=$(mktemp -d /tmp/athena-p4.XXXXXX) || exit 1
case "$D" in /tmp/athena-p4.*) ;; *) exit 1;; esac
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
awk '/^\/\*\*/{b=""} {b=b $0 "\n"} /^export type CerberusUpdateOfferBody /{printf "%s", b; exit}' server/shared/cerberus-types.ts | tr '\n' ' ' | sed 's/ \* / /g; s/  */ /g' | grep -oE '`url`[^,]*,' || echo 'no url sentence'
echo "the warden accepts both forms:"; grep -n "a path is read against the center" warden/src/update.mjs | cut -c1-150
EOF
bash "$D/p.sh"
cd /tmp && case "$D" in /tmp/athena-p4.*) rm -r "$D";; esac
expect: prints "`url` where to fetch its tarball," and the warden's offerAddress line; cured when the url sentence names its form
```

measured 2026-10-07 by chain chain-cerberus--updates--contract-20261007-023832-1d31, finding L3, LOW
probe-key: e26592455ec836f9058157231fbe4fc6b1ce1929

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-7149 — probe — (LOW) — two sentences that list the outbox's members still stop at `result` and run frames

(LOW) — two sentences that list the outbox's members still stop at `result` and run frames

```probe
D=$(mktemp -d /tmp/athena-p5.XXXXXX) || exit 1
case "$D" in /tmp/athena-p5.*) ;; *) exit 1;; esac
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
f=server/shared/cerberus-types.ts
grep -n -F -e "or a run frame's)" -e "outbox (\`result\` and run frames" "$f" | cut -c1-130
echo "[lines that list the outbox's members without update.progress: $(grep -c -F -e "or a run frame's)" -e "outbox (\`result\` and run frames" "$f")]"
EOF
bash "$D/p.sh"
cd /tmp && case "$D" in /tmp/athena-p5.*) rm -r "$D";; esac
expect: two lines (the `ackedUpto` doc and the NODE SESSIONS banner) and a count of 2; cured at 0
```

measured 2026-10-07 by chain chain-cerberus--updates--contract-20261007-023832-1d31, finding L4, LOW
probe-key: 7948e198a2c88c584ec500a3db868ee344ba27a8

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-7150 — probe — (LOW) — nothing says where `paused` sits against a real reading inside one cell

(LOW) — nothing says where `paused` sits against a real reading inside one cell

```probe
D=$(mktemp -d /tmp/athena-p6.XXXXXX) || exit 1
case "$D" in /tmp/athena-p6.*) ;; *) exit 1;; esac
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
f=server/shared/cerberus-types.ts
cell=$(awk '/^\/\*\*/{b=""} {b=b $0 "\n"} /^export type CerberusCell /{printf "%s", b; exit}' "$f" | tr '\n' ' ' | sed 's/ \* / /g; s/  */ /g')
printf 'paused in the CerberusCell doc: '; printf '%s\n' "$cell" | grep -c paused
echo "the read model's ranking (paused 1 < unknown 2 < warn 3 < failing 4):"; grep -n -E "^  (paused|unknown|warn|failing):" server/modules/cerberus/read-model/status-rules.ts
echo "silence today overrides every status in its window:"; grep -n "windowEnd > silentSince" server/modules/cerberus/read-model/overlays.ts | cut -c1-120
EOF
bash "$D/p.sh"
cd /tmp && case "$D" in /tmp/athena-p6.*) rm -r "$D";; esac
expect: `paused in the CerberusCell doc: 0` plus the four ranking lines and the overlay line; cured when the count is above 0
```

measured 2026-10-07 by chain chain-cerberus--updates--contract-20261007-023832-1d31, finding L5, LOW
probe-key: e2021d6038429f57dffeba0b9aa0e4026e45ebb4

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-7151 — probe — (LOW) — neither contract file passes the file's own formatter

(LOW) — neither contract file passes the file's own formatter

```probe
D=$(mktemp -d /tmp/athena-p7.XXXXXX) || exit 1
case "$D" in /tmp/athena-p7.*) ;; *) exit 1;; esac
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
npx prettier --single-quote --print-width 100 --check server/shared/cerberus-types.ts src/shared/cerberus-types.ts 2>&1 | tail -3
echo "rc=${PIPESTATUS[0]}"
EOF
bash "$D/p.sh"
cd /tmp && case "$D" in /tmp/athena-p7.*) rm -r "$D";; esac
expect: `[warn]` lines for both files and rc=1; cured when it prints "All matched files use Prettier code style!" and rc=0
```

measured 2026-10-07 by chain chain-cerberus--updates--contract-20261007-023832-1d31, finding L6, LOW
probe-key: b86ac2877bd19c60d3ff4917a12b4afd3ce29cc9

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-7152 — probe — (LOW) — two claims about the step vocabulary are wrong against the real updater, and the word of center's own last step is unsaid

(LOW) — two claims about the step vocabulary are wrong against the real updater, and the word of center's own last step is unsaid

```probe
D=$(mktemp -d /tmp/athena-p8.XXXXXX) || exit 1
case "$D" in /tmp/athena-p8.*) ;; *) exit 1;; esac
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
f=server/shared/cerberus-types.ts
awk '/^\/\*\*/{b=""} {b=b $0 "\n"} /^export type CerberusUpdateStep /{printf "%s", b; exit}' "$f" | tr '\n' ' ' | sed 's/ \* / /g; s/  */ /g' | grep -oE 'in the order a healthy update says them[^:]*:' || echo 'no order claim'
echo "the real updater waits for idle a second time, after upload and verify:"; grep -n "waitForIdle(updateId)" warden/src/update.mjs | cut -c1-120
echo "words naming which step word center itself writes for a rollback or a 3-minute silence:"
awk '/^\/\*\*/{b=""} {b=b $0 "\n"} /^export type CerberusUpdateView /{printf "%s", b; exit}' "$f" | grep -ciE "center writes|written by center|center adds|center's own step"
EOF
bash "$D/p.sh"
cd /tmp && case "$D" in /tmp/athena-p8.*) rm -r "$D";; esac
expect: the order claim prints, the updater shows `waitForIdle(updateId)` called twice (lines 178 and 183, the second after `install`) besides its definition, and the center-writes count is 0; cured when the claim admits `waiting` after `verified` and the count is above 0
```

measured 2026-10-07 by chain chain-cerberus--updates--contract-20261007-023832-1d31, finding L7, LOW
probe-key: 920bb65935f100656203123447596d85d64b400e

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overview.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-7153 — Diagnosing agent — edits that break it

Behaviour of each: MAN-7930 (the agent), MAN-7806 (the history statements). The warden's half has its own rules: INV-7130.

| Edit | Breaks | Why |
|---|---|---|
| Drop `tools: []` from `runDiagnosisAgent`'s `query()` options, or add a tool name to `allowedTools` by hand | the agent has a shell or a file editor: "read-only by construction" becomes "read-only if the model behaves" | the six MCP tools are everything it has; `allowedTools` is DERIVED from the tools it was built with, so a tool is never one prompt away |
| Drop `strictMcpConfig: true` | the account's claude.ai connectors load into the session — measured 2026-10-07 on `init`: Google Drive `share_file`, `trash_file`, `update_file`, `create_file` and Claude Docs `create`, `delete`, `update` beside `mcp__cerberus__…` | `settingSources: []` does not keep them out; only the strict flag does |
| Drop the `init` tool-list check (`unexpected_tools`) | the next tool a CLI or a plugin adds to a session reaches the agent unseen | the options are a promise; the CLI's own list of what the session holds is the proof |
| Drop `settingSources: []` | the house hooks, the user's CLAUDE.md and skills run inside a diagnosis; a hook can write, and a setting can widen what the agent may do | each source is read from disk as the server's user |
| Drop `persistSession: false`, or move `cwd` out of a hidden project root | a diagnosis becomes a chat in a project list, and its prompt is walked by the heal reading as if the operator had said it | the prompt is Cerberus's, not the operator's (`hidden-project-paths.ts`, AGENTS.md) |
| Build the node's three reads when `deps.linked` is false, or add a tool that runs a command, writes a file or reaches another node | a diagnosis of an unreachable node asks a link that is not there, or the agent can change something | the node's reads are a fixed menu of argv reads that exist only while the node's diagnosis is open; `history_read` is the only thing read across nodes (spec Table 7) |
| Make `submit_diagnosis` a plain tool whose argument the loop reads off the stream, or count a submission its handler refused | the loop answers a conclusion the store's `end` or the service refused, or one the schema never validated | `captureSubmission` counts only a call the tool's own handler accepted |
| Return `keepalive` or value-only rows from `history_read`'s `results`, or fetch `limit` and no more per kind | a long-red check's window is a page of the same ticking line and never reaches the moment it went red; an exact fit reads as a cut | measured 2026-10-07: `servpro_kpm_reference` stored 1 341 change rows in 14 h, 1 of them a status move; rows stored before that day's rule (a moved value is no change) stay in the store |
| Let a tool throw instead of answering an error result, or interpolate an argument into SQL | the SDK reports a failed tool as a protocol error the agent cannot work around; or the agent's text reaches the store as SQL | `historyConditions` binds every value and interpolates only the repository's own column |
| Let a text reach the agent without `oneMaskedLine` (a new field in the prompt or in a history line), or change the warden's `maskSecrets` without `diagnosis-text.ts` | a credential-looking value in a check's value, a result, a fix's command, a run or a summary reaches the model, which can quote it into `evidence` or a `proposal` that is stored for ever and drawn on the sheet | the two doors are masked by two copies of one set of patterns; the warden's file cannot be imported here |
| Drop `submit_diagnosis`'s once-guard or its `submitting` guard, its "no proposal without evidence" refusal, or let `captureSubmission` overwrite the first accepted call | two parallel submissions reach `deps.submit` and the agent answers the second while a first-end-wins store keeps the first; a fix proposed with no cause found is stored and offered as a one-off | the gate is the only place that can refuse a conclusion the agent can still correct; `deps.submit` awaits the summary audit, so the second call of a pair arrives while the first is still being checked |
| Make the summary audit (`diagnosis-audit.ts`) refuse without a cap, or fail a submission when the auditor cannot answer; or give its session tools, MCP servers or a visible cwd | a diagnosis that can never land because a second model keeps naming clauses, or one that fails for want of a courtesy check; or a read-only auditor with hands | the audit is a courtesy to the sheet's reader: `AUDIT_REFUSALS_ALLOWED = 2`, null (logged) when it cannot answer, and the same options as the agent (`tools: []`, `strictMcpConfig`, `settingSources: []`, `persistSession: false`, the hidden `cwd`, the `init` tool-list check) |
| Let `callNode` run unbounded in `readFromNode` | a read the warden never answers (a lost frame) blocks the agent until the loop's 3-minute ceiling, and it never learns to go on with history | the warden answers a read at 10 s, so 15 s of silence is a lost frame |
| Add a read the budget does not count, drop `DIAGNOSIS_READ_BUDGET`'s refusal, or put the probe's `dsn` in `describeMeasurement` | an exploring model reads until its turns end and the diagnosis "failed" for want of a conclusion (measured 2026-10-07: 24 turns on Haiku, never submitted); or a connection string reaches the model | the budget and the refusal bound the reads well inside the turn ceiling; the prompt names what a check measures so the first read has somewhere to go, and a credential is never among the fields |
| Pass `model` through a second default | the row says one model and the run used another | `resolveDiagnosisModel` is the one place `CERBERUS_DIAG_MODEL` and `sonnet` are named |
| Drop `keepAnswersInline` (`_meta['anthropic/maxResultSizeChars']` 72 000 on a tool definition), or return a definition without it | an answer past the CLI's default per-tool limit is written under `~/.claude/projects/<cwd>/<session>/tool-results/` and the model gets a preview and a path it has no Read tool to open; measured 2026-10-07: a 64 KB `file_read` left 65 514 bytes of masked text there and the next step re-read the log as a 100-line tail | the warden caps an answer at 64 KiB and the tool frames it, so 72 000 holds the largest read; the limit is put on once where the list returns, so a seventh tool cannot miss it |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-agent.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-audit.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-history.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-measurement.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-prompt.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-text.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-tools.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-history-filter.ts

## INV-7167 — Warden updates (center) — edits that break them

Behaviour of each: MAN-7933 (center's updates), MAN-7929 (the warden's updater and launcher), MAN-7808 (the read model).

| Edit | Breaks | Why |
|---|---|---|
| Send an `update.offer` from a link change (`wardenLinks.onChange`) instead of after the `hello`, or queue one for a node with no link | the warden gets an offer before its `welcome`, or an old offer lands on a new process | a hello is the one event that says a warden is back and ready; an offer is never queued, and `onHelloForUpdates` re-sends it while the active update has no step |
| Let `onUpdateProgress` (or any `update.*` handler) throw for a frame it will never understand | the link leaves the numbered frame unacked and the warden resends it for ever, behind every frame after it | a handler that threw is left unacked; a stranger's or malformed frame is logged and returned from, so it is acked |
| Let the silence callback throw, or drop its `try`/`catch` | a store error inside a timer ends the whole API process | the clock is the net under every other way an update ends |
| Arm the silence clock at 3 minutes after a `waiting` step | a warden legitimately waiting on a fix for more than 3 minutes is failed, its batch moves a second node on while it is still working, and it then restarts onto the release with no `restarting` step stored, no pause laid and the row `failed` | `waiting` is the warden's promise of another step for up to 10 minutes (`WAIT_LIMIT_MS`); `armSilenceTimer` reads the newest stored step, so a restarted center arms the long limit too |
| Write the closing step (a rollback's, the silence's) after `cerberusUpdatesDb.end`, or outside its transaction | the step is refused (`insertStep` writes nothing for an ended update), or the update shows its last step while still running | the step and the end are one transaction, step first |
| End an update from a hello that does not name a LIVE update of THIS node and its own `to` / `failed`, or take `reason` from anywhere but the hello | another node's, a repeated or a pre-restart hello ends an update that is still running, or ends it with a reason it never had | `settleFromHello`: the first end wins, and a hello naming an ended or unknown update ends nothing — but a `failed` one for an update that ended `updated` under 120 s ago whose `to` it names (`amendLateRollback`) |
| Amend an ended update by any path but `cerberusUpdatesDb.rolledBackAfterUpdated`, widen `LATE_ROLLBACK_WINDOW_MS`, or write its step apart from the `result` change | a stale or resent hello rewrites history: an `updated` from days ago turns `rolled_back`, a second step per resent hello, or a `rolled_back` update with no `failed` step | the statement's own guard (`result = 'updated' AND ended_at >= since`) and the step in the same transaction; `ended_at` stays, so the activity feed and the pause window keep the moment center heard the new release |
| Start a run (`startRun`, `auto-run.ts`) or open a diagnosis session (`openSession`) on a node without asking `cerberusUpdatesDb.activeNode()`, or keep that answer in the driver's memory | a run or `diag.open` lands after the warden's last idle check and dies in its clean stop; a handover's two processes disagree on which node is closed | `activeNode()` reads the oldest live update from the store; the update behind it in its batch is not closed until its turn |
| Offer a release other than the update's `to_version`, or read `latest.json` once and keep it | a batch toward N is offered N+1's hash, or a build that landed is not seen until a restart | `readLatestBuild` reads the disk on every call and the driver ends the update `failed` when the latest has moved on |
| Move the `running()` check of `startBatch` out of its transaction | two presses both pass it and two batches run at once | the check and the inserts are one synchronous transaction |
| Drop the 90 s cut of `pauseWindows`, or `buildNodeOverlay`'s move of a silence out of a pause | a rollback that takes longer reads `paused` for ever instead of silent, or a node is silent inside a pause | a node is silent after 90 s unheard; the pause is for a restart, not for an outage |
| Give the CURRENT status the window rule (keep a `failing` reading under a pause), or the windows the current rule (hide a `warn` cell) | a failing check keeps showing a reading from before the restart, or a restart hides a reading that needs a person | `layerCurrent` is the engine's `eff` (paused wins), `layerWindow` its `windowStatus` (below `warn` only) |
| Count a `paused` node as failing in `cerberus/wardens.fresh` | every update turns the hub's own check red for the seconds of a restart, and may start a fix | `wardensFreshOutcome` reads the screen's own link word, `paused` included |
| Send a warden update's start, step or end through `hintChanged` (the 1 s window) instead of `hintUpdateMoved`, or drop `updates: true` from its frame | the tab hears the update after it ended: no step in the dialog, no restart pill, no paused minute drawn, because an update on a node beside center lasts about 0.4 s | `hintUpdateMoved` closes the window at once and flags the frame; the browser reads a flagged frame without its gap (`readForUpdateFrame`) |
| Add an `update.*` handler outside `registerUpdatesService`, or register `update.progress` twice | the module's start throws ("a handler … is already registered") | `registerHandler` refuses a second claim of one frame type |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/hello-update.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/node-links.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/overlays.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/update-views.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/self-checks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/update-driver.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/updates.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/updates.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-release.ts

## INV-7177 — The diagnosis service — edits that break it

Behaviour of each: MAN-7936 (the lifecycle), MAN-7937 (the one-off, run, promotion), MAN-7938 (routes, read model), MAN-7904 (runs). The agent's own rules: INV-7153. The warden's half: INV-7130.

| Edit | Breaks | Why |
|---|---|---|
| End a diagnosis anywhere but `conclude` (the ceiling, the link handlers or the agent's catch calling `cerberusDiagnosesDb.end` themselves) | the closing step lands after the end and is refused; a proposal is published for a row that ended `failed`; the agent keeps running after a failure; two triggers each write an outcome | `conclude` is the one door: guard, abandon the reads, stop the agent, `diag.close` and the closing step, the row's end, publish, hint — in that order |
| Write "Opened a read-only session" before `diag.opened`, or build the node's three reads without a receipt | a warden from before diagnoses (it ignores `diag.open`) gets an agent whose every read hangs; the first step lies | the receipt is the only proof the warden heard the open; no receipt in 5 s runs on history and says so |
| Write the closing step, or send `diag.close`, after a LOST link (`sessionLost`) | "Closed the session" is said of a session that died with its link; a close reaches a new link's warden that holds no such session | a session lives and dies with its link; the warden ends it on `link.down` |
| Push a step before storing it, coalesce `cerberus_diag_step`, or file a step after `end` | a sheet shows a step a re-read cannot find; two steps arrive as one; a step appears under a "Ready" pill | a step is stored (`insertStep`, which refuses an ended diagnosis), THEN pushed — a picture, never a hint |
| Route `diag.result` by anything but `callId` AND the node it went to AND its `diagId`, or answer a result center cannot place | one warden answers another node's read; a late result after `diag.close` is stored or acked | the wire's banner: center drops what it cannot place, silently |
| Drop the node's `onChange` / `onHello` listeners or the boot sweep in `registerDiagnosisService` | a link lost mid-diagnosis, or a restart, leaves the row `running` for ever — and the store's `insert` then refuses every later diagnosis of the check with 409 | a diagnosis whose loop is gone can only be ended by an event: the link going down, the next hello, the next boot |
| Open a session on a node another live diagnosis already holds one on (drop `sessionHeldByAnother`), or take the warden's `diag.opened` for proof the session is this diagnosis's | the second diagnosis's sheet says "Opened a read-only session" and "Closed the session · nothing was changed" though the warden refused it, its three reads each come back refused with nothing saying so, and it ends `done` on history alone with evidence quoting the other diagnosis (measured 2026-10-07: two ordinary clicks on two red checks of one node) | a warden holds one open diagnosis and sends the receipt for every `diag.open`; only center knows which of its own diagnoses holds the node, and the first step says it reads history only |
| Let `storeOutcome` drop the verdict of `cerberusDiagnosesDb.end`, or publish on a `done` the row does not hold | a row ended out of band (a boot sweep, an older process at a handover) is followed by a spurious catalog version and `catalog.set` for a conclusion it never stored | `end` answers whether THIS call ended the row; `conclude` publishes only on that |
| Hand the agent a `diag.result` text unbounded (drop `holdToContractCap`) | a warden that missed its 64 KB cap turns sixteen reads into up to 128 MiB of model context in one diagnosis (the gateway admits 8 MiB frames) | the cap is the contract's; center holds it too, as defence in depth |
| Replace an event with a poll (a timer that looks for a dead link or a stuck diagnosis) | a lazy watchdog decides what an event already knows | the waits are the receipt (5 s), a call (20 s) and the ceiling (3 min) — deadlines on work in flight, `unref`'d |
| Publish a one-off's `cmd` from `general`, or build the set's one-offs from anything but `openOneOffs` | `run.start` carries `proposal.cmd`, the warden compares byte for byte, and the set holds another text: every Run it once is refused; or a failed diagnosis's command is offered | one text on both sides; `general` is what a PROMOTION saves, and only `end` guarantees a stored proposal is well-formed |
| Let a run of a one-off write `catalog`, `catalog_changes`, or ask `auto-run` anything | running a proposal once changes the catalog | spec §3: "Running a proposal once never touches the catalog" — the run row's `diagnosis` is the whole of its trace |
| Make `ackedVersionCovering` look only at `entries`, or end the wait before the NEWEST set is acked | a one-off run waits the full 10 s and ends `failed`, or its `run.start` names a version the warden has not acked and is refused | the warden holds entries and one-offs in one table by id; a `run.start` names the newest ACKED set that holds the id |
| Read a promotion's `when` from the check's status now, or promote a diagnosis twice | a fix that worked (the check is green) is written as `failing`-for-ever or `warn` by accident; the same fix is in the catalog twice | `when` is the STORED status at the moment the diagnosis began; `promotedFrom` (retired entries included) is the once-only guard |
| Judge a promotion's 409s before its 400s, or let `limit` through unchecked | a bad body is answered with the diagnosis's state; a limit the dialog never offers reaches the catalog | the body is judged first: 404, 400 (`limit.runs` 1, 2 or 4, `limit.per` 3600), then 409 |
| Remove the hub's `canRunFixes` refusal in `submit` | a hub diagnosis proposes a fix no warden can run, and a promotion of it fails at `node` | `center` runs no warden; `proposal: null` is the only honest ending |
| Put text the agent typed (a path, a `contains`, a unit) into a step without `oneMaskedLine` | a credential-looking value is stored for ever and drawn on the sheet | the step is the one stored text that comes straight from the model's arguments |
| File a `note` as a step without `oneMaskedLine`, or store a submission's summary, evidence or fix-button name without `maskedConclusion` (`diagnosis.service.ts`) | a credential the model reassembled from pieces is drawn on the sheet and kept for ever | every input the model sees is masked, but its own words are not; the mask runs on the way out too, before any cut |
| Mask a proposal's `cmd` or `general` instead of refusing it, or drop the `carriesCredential` refusal in `submit` | the masked command does not run; an unmasked one is stored and offered to a warden | `submit` throws "A proposed command may not carry a credential" to the agent, which resubmits without it; a proposal the mask would change is never stored |
| Drop `submit`'s `unquotedLines` refusal (`diagnosis-absence.ts`), hold an evidence line to the prompt as a source, count a read's own empty sentence (`EMPTY_ANSWERS`, `ABSENCE_PHRASES`) as a line, or accept a line that is a share of a line, a label before one, or a word list's idea of what is not an absence | a run files the read's own empty answer ("journal: -- No entries --", "Nothing recorded since …"), the check's own value, a count of what was not there ("zero approval-engine sweep entries found"), a paraphrase of a file, a journal line cut in the middle with `...`, its time moved or two lines spliced, or "approval sweeper silent;" before a real line, as evidence, and may propose a fix on it | measured 2026-10-07 (INV-7169): three Haiku runs on empty reads filed 0, 0 and 3 absence lines, one proposing a restart; a live diagnosis of `shadow-connector/approval_engine` filed "zero approval-engine sweep entries found" and a paraphrase of a drift report; a gate on "a quoted piece of 8 characters" passed the check's own value, another engine's line decorated with its dict keys and an absence behind one quoted identifier; a gate on a share of the line plus a negative-word list passed a line cut with `...`, its time moved and its own conclusion on the end. An absence has nothing to copy and an edited line is not a line of a read, so an evidence line is held to ONE rule: one verbatim stretch of one line of an answer of a read that SUCCEEDED (never the prompt, the reads' empty sentences dropped), at least 20 characters, the punctuation at its two ends let go, nothing of the agent's own on it |
| Send a read after the diagnosis ended (drop `isOver`), or write a `diag.call` frame from anywhere but `diagnosis-wire.ts` | a late tool call reaches a warden that closed the session; a second place speaks the wire | one file owns the five frames' center side |
| Recheck only entries (drop `run.diagnosis !== null` in `run-frames.ts`) | a one-off that fixed the check leaves it red until its next cadence, and the sheet shows a green fix beside a red check | a one-off was proposed for this very check |
| Name the run of a one-off by its diagnosis id | the sheet and the feed say "ran 61d4ee4f…" | `run-views.ts` reads the proposal's name |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-absence.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-deps.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-promotion.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-proposal.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-steps.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-step-words.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-wire.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/diagnosis-views.ts

## INV-7231 — The hub and ingest — edits that break them: `start()` before READY, the re-seed at hello, the storage rule, the newest value

Behaviour of each: MAN-7804 (the hub, READY), MAN-7801 (the storage rule), MAN-7811 (ingest, `reseedNode`), MAN-7955 (`newest`), MAN-7808 (the read model).

| Edit | Breaks | Why |
|---|---|---|
| Move `cerberus.start()` after `signalReady()`, take the 3 s race out of `Promise.race([cerberus.start(), delay(3_000)])`, or make it an unbounded `await` | the successor's gateway binds after the supervisor retired the predecessor: `CERBERUS_LISTEN` is unbound 0.74–1.21 s a handover (six handovers, 2026-10-06) and a warden's first redial is refused; unbounded, a store that blocks holds READY for ever | READY is the supervisor's cue to retire the old process; `start()` first stands the successor's gateway beside it under `reusePort`; the 3 s bounds the wait for the bind and nothing before it |
| Ingest a connect hello's results before `ingest.reseedNode(node)` has run (it follows `recordHello` and precedes `wardenLinks.attach` and the `welcome`), skip it for `center` before the first self-check tick, open a transaction in it, or let it lower `lastReceivedAt` | a result is judged against a retiring process's memory: a wrong `prev_status`, a `since` and an auto-run move that never happened (measured 2026-10-06: `eis1 shadow-connector/system_resources` stored `ok` where the real previous was `warn`); a lowered `lastReceivedAt` throws away the boot vouch | the retiring process keeps its warden links until it exits and stores rows after its successor seeded; the re-seed runs in whichever process takes the hello, and `seedMemory` stays once per process |
| Put `value` back into `storeFrame`'s change test, or store a keep-alive without the result's newest `value` and `data` | a value that moves under an unchanged status is a `change` row again (≈ 26 000 a day on eis1, 97 % of the `change` rows) and What happened, Needs you, `since` and auto-run read noise; or the only stored copy of a value goes stale | a `change` is a move of status or document status, a lapse (`prevAt` null, or `at − prevAt > staleAfter`) or a first sight; a value rides the 300 s keep-alive and `newest` in memory |
| Show a check's value, or answer a lookup, from the stored row alone, or let `newest` move `status`, `stored`, `since` or staleness | the screen shows a value up to five minutes old; or a status move that nothing stored | `newest` is the newest accepted result, stored or not; it speaks for `value`, `at` and `resultAt` only, and only while newer than the stored row; a boot starts it empty |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/ingest.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/check-views.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/lookup.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/self-checks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-link.ts

## INV-7232 — probe — LOW — the `start()` and `readInputs` comments name a window that cannot happen

LOW — the `start()` and `readInputs` comments name a window that cannot happen

```probe
D=$(mktemp -d /tmp/athena-p1.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$(dirname "$0")
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
F=server/modules/cerberus/cerberus.module.ts
echo "comment lines naming the window: $(grep -c 'opening the store; unseeded\|first read, whichever comes first' $F)"
echo "awaits in start() up to the gateway bind: $(awk '/async function start\(\)/,/startWardenGateway/' $F | grep -c '^[^/]*await ')"
cat > "$D/listen.mjs" <<'JS'
import http from 'node:http';
let t0 = 0, syncEnd = null, handlerAt = null;
const server = http.createServer((req, res) => { handlerAt = Date.now() - t0; res.end('ok'); });
async function start() { const until = Date.now() + 300; while (Date.now() < until) {} syncEnd = Date.now() - t0; await new Promise((r) => setTimeout(r, 30)); }
server.once('listening', () => {
  t0 = Date.now();
  http.get({ port: server.address().port, host: '127.0.0.1', path: '/' }, (res) => { res.resume(); res.on('end', () => {
    console.log(handlerAt >= syncEnd ? 'request dialed at the bind was handled AFTER start() synchronous part' : 'request was handled DURING start() synchronous part'); process.exit(0); }); });
});
server.listen({ port: 0, host: '127.0.0.1' }, async () => { await Promise.race([start(), new Promise((r) => setTimeout(r, 3000))]); });
JS
node "$D/listen.mjs"
EOF
bash "$D/p.sh"
expect: "comment lines naming the window: 2" (0 once the comment is cured), "awaits in start() up to the gateway bind: 1" (the bind itself), and "request dialed at the bind was handled AFTER start() synchronous part"
```

measured 2026-10-07 by chain chain-cerberus--judgment--docs-20261007-123144-1ebe, finding L1, LOW
probe-key: 3284ecf3b0b61fa5a3cf29880606c0c55bd7da6a

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/local-time.mjs

## INV-7233 — probe — LOW — `CerberusDiagnosisToolDeps` says `linked` is "whether its warden is connected"; it is whether the node's session opened

LOW — `CerberusDiagnosisToolDeps` says `linked` is "whether its warden is connected"; it is whether the node's session opened

```probe
D=$(mktemp -d /tmp/athena-p2.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
grep -n 'and `linked` whether its warden is connected' server/shared/cerberus-types.ts || echo "doc line: none"
grep -n -A1 "historyOnlyStep(node, '\(updating\|busy\)')" server/modules/cerberus/diagnosis/diagnosis.service.ts
EOF
bash "$D/p.sh"
expect: the doc line at 1613 (reads "doc line: none" once cured) and, beside it, the `updating` and `busy` branches each followed by `return false`
```

measured 2026-10-07 by chain chain-cerberus--judgment--docs-20261007-123144-1ebe, finding L2, LOW
probe-key: 0e066b757f6b19a455290a570020ac001ebb931d

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/local-time.mjs

## INV-7234 — probe — LOW — `localStamp(null)` prints the epoch, against its own header's promise

LOW — `localStamp(null)` prints the epoch, against its own header's promise

```probe
D=$(mktemp -d /tmp/athena-p3.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
TZ=UTC node --input-type=module -e "
import { localStamp } from './warden/src/local-time.mjs';
for (const v of [undefined, null]) { try { console.log(String(v).padEnd(10), '->', localStamp(v)); } catch (e) { console.log(String(v).padEnd(10), '-> throws', e.constructor.name); } }"
EOF
bash "$D/p.sh"
expect: "undefined  -> throws RangeError" and "null       -> 1970-01-01 00:00:00 +00:00" (the second reads "-> throws RangeError" once cured)
```

measured 2026-10-07 by chain chain-cerberus--judgment--docs-20261007-123144-1ebe, finding L3, LOW
probe-key: d793f7a3c84a4a09e27107bd75b6d6db2a4fd6b1

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/local-time.mjs

## INV-7235 — probe — LOW — the tree's `warden/` no longer equals the shipped 0.11.0

LOW — the tree's `warden/` no longer equals the shipped 0.11.0

```probe
D=$(mktemp -d /tmp/athena-p4.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
diff -rq warden ~/.cerberus-warden/releases/0.11.0/warden | grep -v '^Only in warden' || echo none
EOF
bash "$D/p.sh"
expect: "Files warden/src/local-time.mjs and …/releases/0.11.0/warden/src/local-time.mjs differ" ("none" once a warden release carries the edit)
```

measured 2026-10-07 by chain chain-cerberus--judgment--docs-20261007-123144-1ebe, finding L4, LOW
probe-key: ea86ab2f73f3f49218b46aad57b7834158f6596f

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/local-time.mjs
