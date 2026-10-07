<!-- docstore export; edit rows with docstore write, never this file -->

## INV-7004 — Cerberus store — edits that break it

Behaviour of each: MAN-7805 (connection, steps), MAN-7806 (repositories), MAN-7896 (catalog and runs).

| Edit | Breaks | Why |
|---|---|---|
| Edit, reorder or remove a step in `CERBERUS_MIGRATIONS` that has run on the live store | the live store keeps the old shape while every scratch file builds the new one | position is the version; a change is a new step appended |
| Run a step in a deferred transaction, or read `user_version` outside `BEGIN IMMEDIATE` | the overlapping process of a handover fails on its first `CREATE TABLE` | measured 2026-10-06: 6 processes, 4 rounds — deferred failed 20 of 24 with `database is locked`, `.immediate()` opened 24 of 24 |
| Replace the two `CROSS JOIN`s in `rowsInWindow` with plain `JOIN` | a window read walks every row of the node | no `ANALYZE` ever runs on this store, so the planner drives from `results` on `node` alone: 200 ms a part against 0.1 ms pinned, 466k rows |
| Turn `results.insert`'s `ON CONFLICT … DO NOTHING` into `INSERT OR IGNORE` | a malformed row answers `false` exactly as a resend does, so a lost row is acked as a duplicate | a `false` is a resend, which the caller acks |
| Change `transitions`' whole-instant return or the activity cursor (`before = last.at`, strict `<`) without the other | rows sharing one `at` are skipped at a page boundary | a health document stamps every component with one `at` |
| Pass an unclamped `limit` to SQL | `LIMIT -1` dumps the table | SQLite reads a negative limit as no limit |
| Let a new `results.at` be a string or fraction | that row is the check's latest for ever | TEXT sorts above every number; the column's affinity cannot refuse it |
| Drop the JS line check or the run-exists read in `cerberusRunsDb.insertOutput` | a malformed line answers as a resend; output filed under no `runs` row is kept for ever | `INSERT OR IGNORE` swallows a NOT NULL / CHECK violation; the prune reaches output only through `runs.requested_at` |
| Delete a `runs` row, or let `cerberusRunsDb.pruneOutputBefore` delete one | the run-exists read in `insertOutput` goes stale; a run's history loses its name | runs are kept for ever; only their lines expire at 90 days |
| Split `cerberusCatalogDb.setAuto` into a read then a write, or let `insert` store `auto` 1 with `capped` set | a capped fix switches on and runs on its own | the cap is checked inside the one `UPDATE` / the `INSERT`'s `CASE` |
| Cut `cerberusCatalogDb.changes` or `cerberusRunsDb.recent` at `limit` inside a group sharing one instant | a feed cursor (`before` = last row's moment, strict `<`) skips the rest of the group | a health document that flips many checks starts several runs in one millisecond |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-connection.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-catalog.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-mutes.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-results.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-runs.db.ts

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

## INV-7093 — probe — LOW — the clock of the run times is unsaid, and `CerberusNeed.run` compares two of them

LOW — the clock of the run times is unsaid, and `CerberusNeed.run` compares two of them

```probe
awk '/^\/\*\*/{b=""; n=0} {b=b"\n"$0; n++} /^export type CerberusRunView = \{/{c=gsub(/[Cc]lock/,"",b); print "RunView doc lines: " n-1 ", mentions of a clock: " c; exit}' /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts; grep -n "staged.since.set" /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/ingest.service.ts
```

measured 2026-10-06 by chain chain-cerberus--fixes--contract-20261006-205328-d4ab, finding L3, LOW
probe-key: a07818c3d0bb945c58136465ffeb777f2a1288ff

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
| Act on every move ingest hands over (`auto-run.ts` without the last-move-per-check and staleness tests) | a failure that healed hours ago, replayed from a warden's outbox, runs a fix on a healthy node and spends one of the entry's runs | a move is an event only while it is news: the last move of a frame is the state it left, and a result older than the check's `stale_after` is history |
| Store a warden's `startedAt` / `endedAt` as it sent them, or stop clamping them (`run-frames.ts` `onCenterClock`) | a warden clock behind by more than a run's length loses the run's `ended` line when the feed is paged; one reading far ahead keeps the run on its need for ever | all of a run's moments are center's clock, between the request and now |
| Let `ackedVersionCovering` answer from the newest ACKED set instead of the newest set | a press in the round trip after a catalog write names a version the warden has already moved past and is refused, and an auto run spends its slot | a `run.start` reaches the warden behind the `catalog.set` sent before it |
| Hint a run's check before its write commits, or coalesce `cerberus_run_output` | a screen re-reads before the row exists; a running fix's lines arrive a second late and in clumps | output is a picture sent once per stored batch; the hint is coalesced and follows the write |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/auto-run.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/catalog-ack.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/run-views.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-ending.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-frames.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-reconcile.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/runs.service.ts
