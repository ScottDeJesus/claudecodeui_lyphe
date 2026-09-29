<!-- docstore export; edit rows with docstore write, never this file -->

## INV-5646 — probe — the stored notes window, and the invariant two comments claim, are false: an installed

the stored notes window, and the invariant two comments claim, are false: an installed

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && P=$(mktemp -d /tmp/athena-narrow.XXXXXX) && cp ~/.cloudcli/claude-updates/check.json "$P/check.json" && env TSX_TSCONFIG_PATH=server/tsconfig.json P=$P node --import tsx --input-type=module -e '
const { createUpdateCheckService } = await import("./server/modules/claude-updates/update-check.service.ts");
const svc = createUpdateCheckService({ dir: process.env.P, appRoot: process.cwd(), readInstalledCli: async () => ({ version: "2.0.0", reason: null }) });
const a = (await svc.report(null, false)).packages[0];
console.log("before:", a.installed, a.latest, a.notes.length, JSON.stringify(a.notesReason));
await svc.checkNow();
const b = (await svc.report(null, false)).packages[0];
console.log("after a real check:", b.installed, b.latest, b.notes.length, JSON.stringify(b.notesReason));'
expect: `before: 2.0.0 2.1.284 1 null` then `after a real check: 2.0.0 2.1.284 1 null` — updateAvailable true, one section shown, no reason, and a real check does not repair it
```

measured 2026-09-28 by chain chain-claude-update-pipeline--check-20260928-145042-f6c4, finding M1, MEDIUM
probe-key: 2005db1105619d59bd2739d8702dbade75c91d50

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/changelog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/claude-updates.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/claude-updates.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.report.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.store.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/version-order.ts

## INV-5647 — probe — on a registry outage the check's failure text is execFile's own message: the `npm error`

on a registry outage the check's failure text is execFile's own message: the `npm error`

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && SCRATCH=$(mktemp -d /tmp/athena-deadreg.XXXXXX) && env TSX_TSCONFIG_PATH=server/tsconfig.json SCRATCH=$SCRATCH npm_config_registry=http://127.0.0.1:9/ node --import tsx --input-type=module -e '
const { createUpdateCheckService } = await import("./server/modules/claude-updates/update-check.service.ts");
const svc = createUpdateCheckService({ dir: process.env.SCRATCH, appRoot: process.cwd(), readInstalledCli: async () => ({ version: "2.1.283", reason: null }) });
const t = Date.now(); await svc.checkNow();
console.log("ms:", Date.now() - t, "| checkError:", (await svc.report(null, false)).checkError);'
expect: `ms: ~30000` and `checkError: npm could not read @anthropic-ai/claude-code: Command failed: npm view @anthropic-ai/claude-code dist-tags.latest --json` — no ECONNREFUSED, no proxy hint, no cause; contrast `npm_config_registry=http://127.0.0.1:9/ npm view @anthropic-ai/claude-code dist-tags.latest --json` run directly, which exits 1 after ~70 s carrying 1096 bytes of `npm error …` the module never sees
```

measured 2026-09-28 by chain chain-claude-update-pipeline--check-20260928-145042-f6c4, finding M2, MEDIUM
probe-key: e92dd3b8726c08aed038ee78da5e79b861a768aa

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/changelog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/claude-updates.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/claude-updates.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.report.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.store.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/version-order.ts

## INV-5648 — probe — when both registry reads fail, the SDK row's `reason` names the *CLI* package

when both registry reads fail, the SDK row's `reason` names the *CLI* package

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && SCRATCH=$(mktemp -d /tmp/athena-blame.XXXXXX) && env TSX_TSCONFIG_PATH=server/tsconfig.json SCRATCH=$SCRATCH npm_config_registry=http://127.0.0.1:9/ node --import tsx --input-type=module -e '
const { createUpdateCheckService } = await import("./server/modules/claude-updates/update-check.service.ts");
const svc = createUpdateCheckService({ dir: process.env.SCRATCH, appRoot: process.cwd(), readInstalledCli: async () => ({ version: "2.1.283", reason: null }) });
await svc.checkNow();
const r = await svc.report(null, false);
console.log(JSON.stringify(r.packages.map((p) => [p.key, p.reason])));'
expect: both entries carrying `npm could not read @anthropic-ai/claude-code: …` — the sdk row naming the cli package
```

measured 2026-09-28 by chain chain-claude-update-pipeline--check-20260928-145042-f6c4, finding L1, LOW
probe-key: 34ea214b0c24576f41c739c7b8b8a84ed8d7cab0

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/changelog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/claude-updates.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/claude-updates.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.report.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.store.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/version-order.ts

## INV-5649 — probe — a `checkedAt` in the future stalls the cadence for as long as the skew lasts

a `checkedAt` in the future stalls the cadence for as long as the skew lasts

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && SCRATCH=$(mktemp -d /tmp/athena-future.XXXXXX) && env TSX_TSCONFIG_PATH=server/tsconfig.json SCRATCH=$SCRATCH node --import tsx --input-type=module -e '
import fs from "node:fs";
import path from "node:path";
const dir = process.env.SCRATCH;
const future = Date.now() + 365 * 24 * 3600 * 1000;
fs.writeFileSync(path.join(dir, "check.json"), JSON.stringify({ checkedAt: future, error: null, cli: { latest: "2.1.284", notes: [], notesError: null, updatable: true, updatableReason: null }, sdk: { latest: "0.3.284", notes: [], notesError: null } }));
const { createUpdateCheckService } = await import("./server/modules/claude-updates/update-check.service.ts");
const svc = createUpdateCheckService({ dir, appRoot: process.cwd(), readInstalledCli: async () => ({ version: "2.1.283", reason: null }) });
svc.start(); await new Promise((r) => setTimeout(r, 7000)); svc.stop();
const after = JSON.parse(fs.readFileSync(path.join(dir, "check.json"), "utf8"));
console.log("unmoved:", after.checkedAt === future, "| nextCheckAt in days:", Math.round(((await svc.report(null, false)).nextCheckAt - Date.now()) / 86400000));'
expect: `unmoved: true | nextCheckAt in days: 365` — the first tick ran and the cadence decided nothing was due
```

measured 2026-09-28 by chain chain-claude-update-pipeline--check-20260928-145042-f6c4, finding L2, LOW
probe-key: 5043e634b986eeae4dc1ad85ce72405303ece530

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/changelog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/claude-updates.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/claude-updates.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.report.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.store.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/version-order.ts

## INV-5650 — probe — the 300 cap bounds sections, not bytes; the comment claims a byte bound it does not deliver

the 300 cap bounds sections, not bytes; the comment claims a byte bound it does not deliver

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && timeout 90 env TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --input-type=module -e '
const { fetchChangelog, notesBetween } = await import("./server/modules/claude-updates/changelog.ts");
const f = await fetchChangelog("https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md");
const w = notesBetween(f.notes, "1.0.0", "2.1.284");
console.log("in the file:", f.notes.length, "| in the window:", w.length, "| first 300 as JSON bytes:", JSON.stringify(w.slice(0, 300)).length, "| dropped from:", w[300]?.version);'
expect: `in the file: 406 | in the window: 368 | first 300 as JSON bytes: 828005 | dropped from: 1.0.97`
```

measured 2026-09-28 by chain chain-claude-update-pipeline--check-20260928-145042-f6c4, finding L3, LOW
probe-key: 3394d964d7409643c96ee14a7037b1410fe594b2

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/changelog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/claude-updates.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/claude-updates.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.report.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-check.store.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/version-order.ts

## INV-5651 — probe — `steps: []` is written green

`steps: []` is written green

```probe
S=$(mktemp -d); cd /home/lyphe/.claude/claudecodeui_lyphe && TSX_TSCONFIG_PATH=server/tsconfig.json npx tsx -e "
import('./server/modules/claude-updates/update-job.ts').then((j) => {
  const job = j.createJob('$S', { kind: 'update', targets: { cli: '2.1.283' }, installed: { cli: '2.1.283' }, cleanAtStart: false });
  job.steps = [];
  const pid = j.spawnUpdateRunner(process.cwd(), '$S', 'install');
  job.runnerPid = pid; j.writeJob('$S', job);
  setTimeout(() => process.exit(0), 2500);
})" && sleep 3 && cat "$S/job.json"
expect: {"state":"installed","endedAt":null,"steps":[]} — green with nothing run
```

measured 2026-09-28 by chain chain-claude-update-pipeline--runner-20260928-145043-ee33, finding L1, LOW
probe-key: 6ec577b043efd818ee44f4840f4169be4e7160fd

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/runner-command.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-job.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-runner.ts

## INV-5652 — probe — an unknown mode is a pre-flight refusal, so S28's "job failed with the thrown message" is unreachable

an unknown mode is a pre-flight refusal, so S28's "job failed with the thrown message" is unreachable

```probe
S=$(mktemp -d); cd /home/lyphe/.claude/claudecodeui_lyphe && TSX_TSCONFIG_PATH=server/tsconfig.json \
  node --require node_modules/tsx/dist/preflight.cjs --import file://$PWD/node_modules/tsx/dist/loader.mjs \
  server/modules/claude-updates/update-runner.ts "$S" wipe; echo "exit=$?"; ls -A "$S"
expect: log "usage: update-runner.ts <dir> <install|rollback> — got '<dir> wipe'", exit=1, $S empty (nothing written)
```

measured 2026-09-28 by chain chain-claude-update-pipeline--runner-20260928-145043-ee33, finding L2, LOW
probe-key: 9390eba61b49575d0f6c828e09ffc5a729f2afe9

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/runner-command.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-job.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-runner.ts

## INV-5653 — probe — a command that cannot start reads as `exit -2`

a command that cannot start reads as `exit -2`

```probe
S=$(mktemp -d); mkdir -p "$S/bin"; cd /home/lyphe/.claude/claudecodeui_lyphe && PATH="$S/bin" TSX_TSCONFIG_PATH=server/tsconfig.json npx tsx -e "
import('./server/modules/claude-updates/update-job.ts').then((j) => {
  const job = j.createJob('$S', { kind: 'update', targets: { cli: '2.1.283' }, installed: { cli: '2.1.283' }, cleanAtStart: false });
  const pid = j.spawnUpdateRunner(process.cwd(), '$S', 'install');
  job.runnerPid = pid; j.writeJob('$S', job);
  setTimeout(() => process.exit(0), 2500);
})" && sleep 2 && tail -3 "$S/job.log" && jq -c '.steps[0].detail' "$S/job.json"
expect: log ends "spawn npm ENOENT" then "exit -2"; step detail "spawn npm ENOENT"
```

measured 2026-09-28 by chain chain-claude-update-pipeline--runner-20260928-145043-ee33, finding L3, LOW
probe-key: 0a341e59b1c408855e4198815e43a302b189e46c

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/runner-command.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-job.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-runner.ts

## INV-5654 — probe — the 10-minute ceiling kills the command, not its descendants

the 10-minute ceiling kills the command, not its descendants

```probe
bash /tmp/cu-probe/s19.sh   # shim npm that backgrounds `sleep 660` then blocks; wait for the verdict at T+600s
expect: job.json step failed with "npm did not finish within 10 minutes" and the runner exited, while `sleep 660` (ppid 1) is still alive at T+647s
```

measured 2026-09-28 by chain chain-claude-update-pipeline--runner-20260928-145043-ee33, finding L4, LOW
probe-key: b6189d25952c05f1aab5f0bd48a6718426e64a7e

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/runner-command.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-job.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-runner.ts

## INV-5655 — probe — The estate's descriptions still teach both deleted behaviors

The estate's descriptions still teach both deleted behaviors

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n "the \`initial\` picture\|plays the sound only on the" docs/MANUAL.md docs/architecture/MANUAL.md; for t in MAN-534 MAN-5633 MAN-332; do printf '%s ' $t; docstore get $t | grep -c 'initial` picture\|plays the sound only on the'; done
expect: no grep lines, and each MAN row prints 0 — the prose describes `current()` answering null, `whenLanded` and the 503, and one bell per `promptKey`
```

measured 2026-09-28 by chain chain-restart-flicker-20260928-141550-44fc, finding M1, MEDIUM
probe-key: cdc80c32b962f111be1df6bd4a4ba75e39480c1a

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-watcher.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/dispatch-souls.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/polled-lane.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/park-restart-flicker-cleanup.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/park-restart-flicker-stage.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-restart-flicker.mjs

## INV-5656 — probe — PROVE IT's "0 console errors" is not met, and the cause is the app's own shutdown, not "not an app defect"

PROVE IT's "0 console errors" is not met, and the cause is the app's own shutdown, not "not an app defect"

```probe
journalctl -u cloudcli-client-dev.service --since "-2h" --no-pager | grep -c "http proxy error"
expect: 0 — no proxied request is severed by a handover (today: 12 in the last 2 h)
```

measured 2026-09-28 by chain chain-restart-flicker-20260928-141550-44fc, finding M2, MEDIUM
probe-key: c9f434af46132258b85ccdda078d0fe0b941a64f

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/http-drain.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-watcher.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/dispatch-souls.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/polled-lane.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/park-restart-flicker-cleanup.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/park-restart-flicker-stage.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-restart-flicker.mjs

## INV-5657 — probe — The not-ready 503 logs a console error in every tab that seeds during the gap

The not-ready 503 logs a console error in every tab that seeds during the gap

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && TSX_TSCONFIG_PATH=server/tsconfig.json timeout 90 node --import tsx -e "const express=(await import('express')).default;const {chromium}=await import('playwright');const {createDispatcherRouter}=await import('./server/modules/dispatcher/dispatcher.routes.ts');const {createPolledLane}=await import('./server/shared/polled-lane.service.ts');const lane=createPolledLane({snapshot:()=>new Promise(()=>{}),frame:p=>p,broadcast:()=>{},pollMs:1e9,logError:()=>{}});const app=express();app.get('/',(q,r)=>r.send('<p>x'));app.use('/api/dispatcher',createDispatcherRouter({current:()=>lane.whenLanded(300),runVerb:async()=>({}),offpeak:async()=>null}));const s=app.listen(0,'127.0.0.1',async()=>{const b=await chromium.launch();const p=await b.newPage();const e=[];p.on('console',m=>m.type()==='error'&&e.push(m.text()));await p.goto('http://127.0.0.1:'+s.address().port+'/');const st=await p.evaluate(()=>fetch('/api/dispatcher/plans').then(r=>r.status));await p.waitForTimeout(300);console.log('status',st,'console errors',JSON.stringify(e));await b.close();s.close();process.exit(0)});"
expect: console errors [] with the refusal still unpublished by DispatcherFeed (today: status 503, one "Failed to load resource … 503" error)
```

measured 2026-09-28 by chain chain-restart-flicker-20260928-141550-44fc, finding L1, LOW
probe-key: 96089ca98643ec85c70b50d7536e0079a9106a8b

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-watcher.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/dispatch-souls.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/polled-lane.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/park-restart-flicker-cleanup.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/park-restart-flicker-stage.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-restart-flicker.mjs

## INV-5658 — probe — Code comments point at the deleted shape and at correction history

Code comments point at the deleted shape and at correction history

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n "There was once\|now carries it\|before the push learned it\|older one-bell-per-attempt" server/shared/polled-lane.service.ts server/modules/providers/list/claude/claude-runtime.provider.js src/modules/chat/hooks/useChatRealtimeHandlers.ts
expect: no output
```

measured 2026-09-28 by chain chain-restart-flicker-20260928-141550-44fc, finding L2, LOW
probe-key: 67ea13f6339837760f043fcf0c58faf088edba1e

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-watcher.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/dispatch-souls.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/polled-lane.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/park-restart-flicker-cleanup.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/park-restart-flicker-stage.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-restart-flicker.mjs

## INV-5659 — probe — The `complete`-path comment cites a measurement that saw no completion, and names the wrong gate

The `complete`-path comment cites a measurement that saw no completion, and names the wrong gate

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n "measured across the same restarts\|the registry replays a run's buffer only while it runs" src/modules/chat/hooks/useChatRealtimeHandlers.ts
expect: no output — the comment names handleChatSubscribe's isProcessing gate and states no measurement that saw zero completions
```

measured 2026-09-28 by chain chain-restart-flicker-20260928-141550-44fc, finding L3, LOW
probe-key: 8bc71665e477c5161a2f85c6a3f20f952f344989

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-watcher.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/dispatch-souls.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/polled-lane.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/park-restart-flicker-cleanup.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/park-restart-flicker-stage.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-restart-flicker.mjs

## INV-5660 — probe — The PROVE IT probe's instrument miscounts, mislabels, and depends on scratch files outside `.verify/`

The PROVE IT probe's instrument miscounts, mislabels, and depends on scratch files outside `.verify/`

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -c "playTone(context" src/shared/utils.ts; grep -n "generated_at === '' ? 'EMPTY' : 'set'\|?? '425ccf78" .verify/probe-restart-flicker.mjs; ls .verify/ | grep -c -i park
expect: the probe counts one chime per playNotificationSound (utils plays 2 tones), logs a non-OK seed as a refusal, and a park stage/cleanup script sits in .verify/ (count ≥ 1); the probe exits non-zero when runner reads 0, a subagent row drops, or a chime has no new ask/completion behind it
```

measured 2026-09-28 by chain chain-restart-flicker-20260928-141550-44fc, finding L4, LOW
probe-key: 46550e10cf01923043e5131083655919a2bf988b

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-watcher.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/dispatch-souls.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/polled-lane.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/park-restart-flicker-cleanup.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/park-restart-flicker-stage.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-restart-flicker.mjs

## INV-5661 — probe — a malformed JSON body answers `500 INTERNAL_ERROR` on `/apply` and `/restart`, not the intent's `400 bad-request`

a malformed JSON body answers `500 INTERNAL_ERROR` on `/apply` and `/restart`, not the intent's `400 bad-request`

```probe
T=$(curl -s -X POST http://127.0.0.1:3011/api/auth/login -H 'content-type: application/json' -d '{"username":"verve","password":"verve-dev-2026"}' | jq -r .token)
B=http://127.0.0.1:3011/api/claude-updates
curl -s -w '\n%{http_code}\n' -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{' $B/apply
curl -s -w '\n%{http_code}\n' -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{"a":' $B/restart
curl -s -w '\n%{http_code}\n' -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{}' $B/apply
```

measured 2026-09-28 by chain chain-claude-update-pipeline--pipeline-20260928-152615-8000, finding M1, MEDIUM
probe-key: 75452b4df19dfd386194c542c7fef4e7712c8e89

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/claude-updates.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/claude-updates.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-actions.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-commit.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-git.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-job.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-reconciler.states.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-reconciler.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-runner.ts

## INV-5662 — probe — two `POST /apply` in one burst are BOTH accepted and BOTH spawn a runner; the job-active guard is read-then-act

two `POST /apply` in one burst are BOTH accepted and BOTH spawn a runner; the job-active guard is read-then-act

```probe
TSX_TSCONFIG_PATH=server/tsconfig.json timeout 90 node --import tsx /tmp/athena-pipe.j6IrS0/race-real.ts
```

measured 2026-09-28 by chain chain-claude-update-pipeline--pipeline-20260928-152615-8000, finding M2, MEDIUM
probe-key: 7a5138f8838c03b1ed10107f16c3cb6ba03ce2da

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/claude-updates.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/claude-updates.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-actions.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-commit.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-git.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-job.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-reconciler.states.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-reconciler.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-runner.ts

## INV-5663 — probe — A Hide lives only in the page's memory until its PATCH lands

A Hide lives only in the page's memory until its PATCH lands

```probe
node /tmp/pipeline-reviews/arc-dismiss/athena-probes/arc-hide-5xx-reload.mjs
expect: the "after reload + 8 s" line reads `decks 0` and `server hides` holding every restorly lane plan (today: `decks 1 … server hides []`); needs restorly on the lane (until 2026-09-29T19:02Z) — else set the arc to one the lane carries
```

measured 2026-09-28 by chain chain-arc-dismiss-20260928-151015-a6a2, finding M1, MEDIUM
probe-key: 116798434903a6b93c1992fd480b7b74d505ddf2

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/user-preferences.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hiddenPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useDispatcherPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useCardFold.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/preferenceEntryPatch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/userSettings.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dismiss-done.mjs

## INV-5664 — probe — A hide already sent is erased locally by a sign-in read that lands after it; the new comment and INV-4406 claim otherwise

A hide already sent is erased locally by a sign-in read that lands after it; the new comment and INV-4406 claim otherwise

```probe
node /tmp/pipeline-reviews/arc-dismiss/athena-probes/arc-hide-races.mjs s5
expect: the "S5b in-flight" line reads `decks after hydrate: 0` (today: `decks after hydrate: 1` with the server holding all 4 hides); the "S5a queued" line reads `decks after hydrate: 0`
```

measured 2026-09-28 by chain chain-arc-dismiss-20260928-151015-a6a2, finding L1, LOW
probe-key: ea048678796afbab7cea4179c18634f8dc9cd949

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/user-preferences.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hiddenPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useDispatcherPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useCardFold.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/preferenceEntryPatch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/userSettings.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dismiss-done.mjs

## INV-5665 — probe — PROVE IT fails, and the leftover 500 hits the operator's path; the builder's stated cause is wrong and the real one is not established

PROVE IT fails, and the leftover 500 hits the operator's path; the builder's stated cause is wrong and the real one is not established

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && timeout 90 node -e '
const D=require("better-sqlite3"),jwt=require("jsonwebtoken"),fs=require("fs");
const db=new D(process.env.HOME+"/.cloudcli/auth.db",{readonly:true});
const T=jwt.sign({userId:db.prepare("SELECT id FROM users WHERE username=?").get("verve").id,username:"verve"},db.prepare("SELECT value FROM app_config WHERE key=?").get("jwt_secret").value,{expiresIn:"10m"});
const RUN=Number(process.env.RUN_MS||30000),T0=Date.now(),out=[];
if(!process.env.NO_TOUCH)setTimeout(()=>fs.utimesSync("server/modules/providers/provider.routes.ts",new Date(),new Date()),5000);
(async()=>{while(Date.now()-T0<RUN){const s=Date.now();let st;try{const r=await fetch("http://127.0.0.1:5183/api/projects",{headers:{authorization:"Bearer "+T}});st=r.status;await r.text()}catch(e){st=e.cause?.code||e.message}out.push([new Date(s).toISOString().slice(11,23),Date.now()-s,st]);await new Promise(r=>setTimeout(r,250))}
console.log(out.map(o=>o.join(" ")).join("\n"));console.log("slowest /api/projects ms:",Math.max(...out.map(o=>o[1])),"| over the 4000 ms drain bound:",out.filter(o=>o[1]>4000).length,"| non-200:",out.filter(o=>o[2]!==200).length)})()'
expect: over the 4000 ms drain bound: 0 across the one handover it triggers (today: 1 — a 7171 ms /api/projects right after the successor's takeover)
```

measured 2026-09-28 by chain chain-drain-on-retire-20260928-153033-541f, finding H1, HIGH
probe-key: 83f935439eee375c6b13456935402d1fbabf3cf0

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/http-drain.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/inflight-hammer.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-restart-flicker.mjs

## INV-5666 — probe — the drain stretches the successor's pre-takeover window from about 74 ms to seconds, and inside it `/sessions/running` tells every tab its live runs are idle

the drain stretches the successor's pre-takeover window from about 74 ms to seconds, and inside it `/sessions/running` tells every tab its live runs are idle

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && timeout 90 node -e '
const D=require("better-sqlite3"),jwt=require("jsonwebtoken"),fs=require("fs"),http=require("http");
const db=new D(process.env.HOME+"/.cloudcli/auth.db",{readonly:true});
const T=jwt.sign({userId:db.prepare("SELECT id FROM users WHERE username=?").get("verve").id,username:"verve"},db.prepare("SELECT value FROM app_config WHERE key=?").get("jwt_secret").value,{expiresIn:"10m"});
const RUN=Number(process.env.RUN_MS||30000),T0=Date.now(),reads=[];
const hold=()=>{const b=JSON.stringify({pad:"x".repeat(30)});const q=http.request({host:"127.0.0.1",port:5183,path:"/api/auth/status",method:"GET",headers:{"content-type":"application/json","content-length":b.length}},s=>s.resume());q.on("error",()=>{});let i=0;const iv=setInterval(()=>{q.write(b[i++]);if(i>=b.length){clearInterval(iv);q.end()}},100)};
const holds=setInterval(hold,500);
if(!process.env.NO_TOUCH)setTimeout(()=>fs.utimesSync("server/modules/providers/provider.routes.ts",new Date(),new Date()),3000);
(async()=>{while(Date.now()-T0<RUN){try{const r=await fetch("http://127.0.0.1:5183/api/providers/sessions/running",{headers:{authorization:"Bearer "+T}});const d=(await r.json()).data;reads.push([Date.now()-T0,d.sessions.length,d.awaitingInputSessionIds.length])}catch(e){reads.push([Date.now()-T0,-1,-1])}await new Promise(r=>setTimeout(r,100))}
clearInterval(holds);const steady=Math.max(...reads.filter(r=>r[0]<3000).map(r=>r[1])),after=reads.filter(r=>r[0]>=3000);
console.log(JSON.stringify({reads:reads.length,steadyRuns:steady,minRunsAfterTouch:Math.min(...after.map(r=>r[1])),dips:after.filter(r=>r[1]<steady).map(r=>r[0])}))})()'
expect: with steadyRuns ≥ 1, dips: [] and minRunsAfterTouch == steadyRuns across the drained handover it triggers (vacuous when steadyRuns is 0 — run it while a keepalive run is live)
```

measured 2026-09-28 by chain chain-drain-on-retire-20260928-153033-541f, finding M1, MEDIUM
probe-key: 9fe9b6e67e7a9c14cac197df5b25595e689a7c55

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/http-drain.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/inflight-hammer.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-restart-flicker.mjs

## INV-5667 — probe — `http-drain.ts`'s header states evidence the journal contradicts, and records a superseded bound

`http-drain.ts`'s header states evidence the journal contradicts, and records a superseded bound

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n "13 such lines\|~50 ms\|a 2 s bound cut" server/http-drain.ts; journalctl -u cloudcli-client-dev --since "2026-09-28 00:00" --until "2026-09-28 15:58:15" --no-pager | grep -c "http proxy error"
expect: no grep lines from http-drain.ts (today: 3), or figures that match the journal's count (24, 21 at exit, 38–152 ms after SIGTERM)
```

measured 2026-09-28 by chain chain-drain-on-retire-20260928-153033-541f, finding L1, LOW
probe-key: daf0c132e18d29c270a4f2ab42eb59de46cf62d3

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/http-drain.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/inflight-hammer.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-restart-flicker.mjs

## INV-5668 — probe — the line that names cut requests does not say which process cut them

the line that names cut requests does not say which process cut them

```probe
journalctl -u cloudcli-server-dev --since "2026-09-28 16:00" --no-pager | grep "drain bound"
expect: each line names the retiring child's pid, in its text or its node[<pid>] tag (today: node[3971575], the supervisor, and no pid in the text)
```

measured 2026-09-28 by chain chain-drain-on-retire-20260928-153033-541f, finding L2, LOW
probe-key: b2846206cb213ae48d415ad6eac63c116f22b353

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/http-drain.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/inflight-hammer.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-restart-flicker.mjs

## INV-5669 — probe — services that start new work keep running through the drain on the retiring pid

services that start new work keep running through the drain on the retiring pid

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && sed -n '/const shutdownRuntimeServices/,/await drained/p' server/index.ts | grep -c "closeSessionsWatcher\|closeScheduledMessageDispatcher"; journalctl -u cloudcli-server-dev --since "2026-09-28 16:01" --no-pager -o short-unix | python3 -c 'import sys,re;r={};n=0
for l in sys.stdin:
    t=float(l.split(" ",1)[0]);m=re.search(r"retiring pid (\d+)",l)
    if m:r[m.group(1)]=t;continue
    m=re.search(r"node\[(\d+)\]: Session synchronization triggered",l);n+=bool(m and m.group(1) in r and t>r[m.group(1)])
print("syncs by a retiring pid after SIGTERM:",n)'
expect: 2, then "syncs by a retiring pid after SIGTERM: 0" for handovers after the fix (today: 0 closers called; 4 syncs)
```

measured 2026-09-28 by chain chain-drain-on-retire-20260928-153033-541f, finding L3, LOW
probe-key: f4866c4e2dde7fe3fcb60f27a618777d43ff9be7

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/http-drain.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/inflight-hammer.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-restart-flicker.mjs

## INV-5670 — probe — Hide on a MIXED arc silently dismisses its done plans, and Show brings back a truncated deck

Hide on a MIXED arc silently dismisses its done plans, and Show brings back a truncated deck

```probe
node /tmp/pipeline-reviews/done-cards-leave/athena-probes/athena-dcl.mjs s9
expect: the "S9 round trip" line reads `[HOLD] … returns the deck with 4 of its 4 cards (progress 3/4 → 3/4)` (today: `[BREAK] … 1 of its 4 cards (progress 3/4 → 0/1)`); needs restorly on the lane (until 2026-09-29T19:02Z)
```

measured 2026-09-28 by chain chain-done-cards-leave-20260928-160626-ad80, finding M1, MEDIUM
probe-key: 8734efe63225eeacfb3de1416303af86f7100857

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcDeck.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/DeletePlanDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hiddenPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useDispatcherPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/putAwayFocus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useWorkspaceTabGates.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useCardFold.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-arc-nest.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-arc-strip-return.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dismiss-done.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-runner-widget-list.mjs, /home/lyphe/.claude/state/dispatch-souls/dispatch-hephaestus-20260928-161608-f892/result.md

## INV-5671 — probe — The one-command proof exits 1 on a correct build

The one-command proof exits 1 on a correct build

```probe
node .verify/probe-dismiss-done.mjs
expect: last line `ALL PASS`, exit 0 (today: `2 FAILURE(S)` — `[FAIL] done-only lane: a reload does not bring the Runner tab back` and a `tab-390-dark` console error)
```

measured 2026-09-28 by chain chain-done-cards-leave-20260928-160626-ad80, finding M2, MEDIUM
probe-key: b87b80549775caac71892b521eaae808104335ca

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcDeck.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/DeletePlanDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hiddenPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useDispatcherPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/putAwayFocus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useWorkspaceTabGates.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useCardFold.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-arc-nest.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-arc-strip-return.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dismiss-done.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-runner-widget-list.mjs, /home/lyphe/.claude/state/dispatch-souls/dispatch-hephaestus-20260928-161608-f892/result.md

## INV-5672 — probe — The builder's report is a placeholder

The builder's report is a placeholder

```probe
cat ~/.claude/state/dispatch-souls/dispatch-hephaestus-20260928-161608-f892/result.md
expect: a report naming the files changed, the put-away design decision, the proof's actual output and the re-aimed probes (today: the single line "The probe is still in its final passes … I'll report once it completes.")
```

measured 2026-09-28 by chain chain-done-cards-leave-20260928-160626-ad80, finding M3, MEDIUM
probe-key: a09ec39296b03d4ae59750cdcec2df89c135ef8c

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcDeck.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/DeletePlanDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hiddenPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useDispatcherPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/putAwayFocus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useWorkspaceTabGates.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useCardFold.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-arc-nest.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-arc-strip-return.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dismiss-done.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-runner-widget-list.mjs, /home/lyphe/.claude/state/dispatch-souls/dispatch-hephaestus-20260928-161608-f892/result.md

## INV-5673 — probe — Dismiss is dead on a slow browser clock (S13)

Dismiss is dead on a slow browser clock (S13)

```probe
node /tmp/pipeline-reviews/done-cards-leave/athena-probes/athena-dcl.mjs s13
expect: `[HOLD] S13: after Dismiss with a 6 h slow clock the judgment card is gone (count 0)` (today: `[BREAK] … (count 1)`)
```

measured 2026-09-28 by chain chain-done-cards-leave-20260928-160626-ad80, finding L1, LOW
probe-key: 33eb8d9e775793acfaafad16da9708e35571eed4

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcDeck.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/DeletePlanDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hiddenPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useDispatcherPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/putAwayFocus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useWorkspaceTabGates.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useCardFold.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-arc-nest.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-arc-strip-return.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dismiss-done.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-runner-widget-list.mjs, /home/lyphe/.claude/state/dispatch-souls/dispatch-hephaestus-20260928-161608-f892/result.md

## INV-5674 — probe — `probe-arc-nest.mjs` still carries the old ending rule while claiming the hook's

`probe-arc-nest.mjs` still carries the old ending rule while claiming the hook's

```probe
grep -n "const ended = epochOf(plan.completed_at)" /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-arc-nest.mjs
expect: no hit — `hidden()` dates a complete plan by its newest phase `done_at`, as `latestEnding` does (today: line 199)
```

measured 2026-09-28 by chain chain-done-cards-leave-20260928-160626-ad80, finding L2, LOW
probe-key: c885cbc840485be044b43329affbd18c92aef23e

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcDeck.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/DeletePlanDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hiddenPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useDispatcherPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/putAwayFocus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useWorkspaceTabGates.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useCardFold.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-arc-nest.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-arc-strip-return.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dismiss-done.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-runner-widget-list.mjs, /home/lyphe/.claude/state/dispatch-souls/dispatch-hephaestus-20260928-161608-f892/result.md

## INV-5675 — probe — `DeletePlanDialog`'s head states a mechanism that is not there

`DeletePlanDialog`'s head states a mechanism that is not there

```probe
grep -n "Hidden and dismissed plans count as well" /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/DeletePlanDialog.tsx
expect: no hit — the head says hidden plans count and a dismissed plan, being complete, can wait on nothing (today: line 41)
```

measured 2026-09-28 by chain chain-done-cards-leave-20260928-160626-ad80, finding L3, LOW
probe-key: f3ff63caf2e96c5fa159780d73802de96d9fccdd

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcDeck.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/DeletePlanDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hiddenPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useDispatcherPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/putAwayFocus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useWorkspaceTabGates.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useCardFold.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-arc-nest.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-arc-strip-return.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dismiss-done.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-runner-widget-list.mjs, /home/lyphe/.claude/state/dispatch-souls/dispatch-hephaestus-20260928-161608-f892/result.md

## INV-5680 — probe — The standing proof passes a lead that paints nothing

The standing proof passes a lead that paints nothing

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && T=$(mktemp -d) && sed -e "s#'../src/#'$PWD/src/#" -e "s#^async function openTab(page, viewport) {#&\n  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '[data-card-description]{display:none !important}'; document.head.appendChild(s); }));#" .verify/probe-card-description.mjs > $T/p.mjs && node $T/p.mjs --tag hidden-lead | grep -E "painted on|reading\(s\) failed" | sort | uniq -c; echo "exit ${PIPESTATUS[0]}"
expect: exit 1, with a FAIL on the clamp line for a lead painted on 0 lines (today: 8× "painted on 0 line(s)", "0 reading(s) failed", exit 0)
```

measured 2026-09-28 by chain chain-card-description-20260928-165807-7220, finding L1, LOW
probe-key: 97ead18614765315f7387937ac19f5cc982cfe5f

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/dispatcherState.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-description.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dispatch-card-version-word.mjs

## INV-5681 — probe — The standing proof is hard-wired to a plan that will leave the lane

The standing proof is hard-wired to a plan that will leave the lane

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n "^const PLAN = \|'--plan'" .verify/probe-card-description.mjs
expect: a `'--plan'` option line prints beside the default (today only `const PLAN = 'claude-update-pipeline';` prints)
```

measured 2026-09-28 by chain chain-card-description-20260928-165807-7220, finding L2, LOW
probe-key: 13f34f5a39ba264ea9e838d51fb2c18bc270a926

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/dispatcherState.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-description.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dispatch-card-version-word.mjs

## INV-5682 — probe — A probe comment still says the arc header holds the operator's goal

A probe comment still says the arc header holds the operator's goal

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n "arc's goal lives in it\|operator's own brief" .verify/probe-dispatch-arc-word.mjs
expect: no output
```

measured 2026-09-28 by chain chain-card-description-20260928-165807-7220, finding L3, LOW
probe-key: 1e896b2f3d6c0e65a922724c3d649847ff91328b

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/dispatcherState.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-description.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dispatch-card-version-word.mjs

## INV-5683 — probe — The rewritten version-word comment misstates what that probe scans

The rewritten version-word comment misstates what that probe scans

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n "data-flow-caption>" src/modules/dispatcher/PlanFace.tsx; grep -n "querySelectorAll('p, \[data-dispatcher-phase\]')\|every other mark keeps its text" .verify/probe-dispatch-card-version-word.mjs
expect: the second grep does not print both lines. Either the scan drops only `[data-card-description]`, which keeps `<p data-flow-caption>` in the reading, or the comment says every `<p>` goes.
```

measured 2026-09-28 by chain chain-card-description-20260928-165807-7220, finding L4, LOW
probe-key: 94bee09a1f0b740e7c583a2b2f1a2c0d2d2737a5

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/dispatcherState.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-description.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dispatch-card-version-word.mjs

## INV-5684 — probe — The fallback is promised "while it is being designed", but a plan being designed has no goal either

The fallback is promised "while it is being designed", but a plan being designed has no goal either

```probe
T=$(mktemp -d) && DISPATCHER_HOME="$T" python3 -c "import sys; sys.path.insert(0,'/home/lyphe/.claude/hooks'); from dispatcher import store; c=store.connect(); assert store.db_path().startswith('/tmp/'); store.open_plan(c,'athena-probe-designing',repo='/home/lyphe/.claude/claudecodeui_lyphe',session=None); c.commit(); print(dict(c.execute('select state, goal, delivers from plans').fetchone()))"; grep -n "while its designer is out\|goal's while it is being designed" /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/*.ts /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/*.tsx
expect: the store row prints goal None and delivers None, and the grep prints nothing, because no comment promises a goal line while an ordinary plan is being designed
```

measured 2026-09-28 by chain chain-card-description-20260928-165807-7220, finding L5, LOW
probe-key: 5d988dee9f1772f2f0d1b2143485404f86bfa8cd

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/dispatcherState.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-description.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dispatch-card-version-word.mjs

## INV-5685 — probe — the CLI card prints a mid-turn sentence with the version hole in it (MED)

the CLI card prints a mid-turn sentence with the version hole in it (MED)

```probe
node /tmp/athena-probe-claude-updates/probe8b.mjs
expect: the CLI card reads "Claude Code | the Claude CLI did not answer --version | 1 conversation mid-turn on an older Claude Code moves to when its turn ends | Full changelog" — the sentence with the version hole
```

measured 2026-09-28 by chain chain-claude-update-pipeline--fill-20260928-171627-a599, finding M1, MEDIUM
probe-key: d44df19ee6cfb716eeb5cfd3783a7d7855682d57

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/claude-updates/ClaudeUpdatesSettingsTab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/claude-updates/hooks/useClaudeUpdates.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-5686 — probe — the docstore row that governs this module still describes the fake (MED)

the docstore row that governs this module still describes the fake (MED)

```probe
docstore get MAN-7404 | python3 -c "import sys,json,re; t=json.load(sys.stdin)['row']['text']; print('\n'.join(l for l in t.splitlines() if re.search(r'fake|FILL|#updates=', l)))" ; grep -n "fake\.ts\|#updates=\|FILL:" MANUAL.md | head -8
expect: the row still reads "reading a fake report only — nothing here calls the real routes yet", still lists `fake.ts` / `FAKE_REPORT` as live, still counts "11" FILL markers, still documents `#updates=<name>` — and the exported MANUAL.md repeats it
```

measured 2026-09-28 by chain chain-claude-update-pipeline--fill-20260928-171627-a599, finding M2, MEDIUM
probe-key: af44bd97e966b3100c99c5b74a3f4a96591e0dd7

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/claude-updates/ClaudeUpdatesSettingsTab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/claude-updates/hooks/useClaudeUpdates.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-5687 — probe — the new `api.ts` comment points at a section that does not exist (LOW)

the new `api.ts` comment points at a section that does not exist (LOW)

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n "claude-updates" src/shared/api.ts ; grep -c "claude-updates" docs/MANUAL.md
expect: api.ts names "docs/MANUAL.md (claude-updates)" and docs/MANUAL.md contains 0 occurrences of "claude-updates"
```

measured 2026-09-28 by chain chain-claude-update-pipeline--fill-20260928-171627-a599, finding L1, LOW
probe-key: 97363355f9a12f221ec609c2fec666013995c735

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/claude-updates/ClaudeUpdatesSettingsTab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/claude-updates/hooks/useClaudeUpdates.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-5688 — probe — with no reading yet, the pane offers nothing at all for up to a poll (LOW)

with no reading yet, the pane offers nothing at all for up to a poll (LOW)

```probe
node /tmp/athena-probe-claude-updates/probe4.mjs
expect: "pane with no reading: \"Claude updates | Reading the update report…\"" / "its buttons: []" / "pane filled after 51 s" — no manual retry anywhere in the branch
```

measured 2026-09-28 by chain chain-claude-update-pipeline--fill-20260928-171627-a599, finding L2, LOW
probe-key: d8df40e2919b689a77d33f8ffd61032e5bfa0430

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/claude-updates/ClaudeUpdatesSettingsTab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/claude-updates/hooks/useClaudeUpdates.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-5689 — probe — The catalog read loads all settings sources from world-writable `/tmp`: another user's `.claude/settings.json` there runs as the server user, and the operator's own session hooks fire on every read

The catalog read loads all settings sources from world-writable `/tmp`: another user's `.claude/settings.json` there runs as the server user, and the operator's own session hooks fire on every read

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1; mkdir -p "$D/cwd/.claude" || exit 1; printf '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"touch %s/PLANTED"}]}]}}' "$D" > "$D/cwd/.claude/settings.json"; printf "import { readClaudeModelsDefinition } from '/home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-model-catalog.ts';\nawait readClaudeModelsDefinition();\n" > "$D/r.mts"; cd /home/lyphe/.claude/claudecodeui_lyphe && TMPDIR="$D/cwd" CLOUDCLI_CLAUDE_MODEL_CATALOG_PATH="$D/cat.json" strace -f -qq -s 300 -e trace=execve -e signal=none -o "$D/trace" npx tsx --tsconfig server/tsconfig.json "$D/r.mts"; sleep 3; ls "$D/PLANTED"; echo "hooks run: $(grep -cE 'execve\("/bin/sh", \["/bin/sh", "-c", "[^"]*hooks/' "$D/trace")"; case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: `ls` reports no such file for PLANTED and `hooks run: 0` (today: PLANTED exists and `hooks run: 4` — dispatcher_stop, docstore_start, heal_trigger, load_main_shelves)
```

measured 2026-09-28 by chain chain-claude-model-catalog-20260928-173328-cec2, finding H1, HIGH
probe-key: 24eeb7a439b56f74f8f82a74f0baac3a50dc8fce

governs: /home/lyphe/.claude/claudecodeui_lyphe/.claude/settings.json

## INV-5690 — probe — A null version reading overwrites the version-keyed record: one transient `--version` failure costs two catalog spawns

A null version reading overwrites the version-keyed record: one transient `--version` failure costs two catalog spawns

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1; printf '#!/bin/sh\nif [ "$1" = "--version" ]; then [ -f %s/fail ] && exit 1; echo "2.1.284 (Claude Code)"; exit 0; fi\necho x >> %s/spawns\nexec /home/lyphe/.npm-global/bin/claude "$@"\n' "$D" "$D" > "$D/claude" && chmod +x "$D/claude" && touch "$D/spawns" && cp ~/.cloudcli/claude-model-catalog.json "$D/cat.json"; printf "import fs from 'node:fs';\nimport { readClaudeModelsDefinition as r } from '/home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-model-catalog.ts';\nconst D = '%s', bump = () => { const t = new Date(Date.now() + Math.random() * 1e6); fs.utimesSync(D + '/claude', t, t); };\nconst say = (s: string) => console.log(s, 'spawns=' + fs.readFileSync(D + '/spawns', 'utf8').split('\\\\n').filter(Boolean).length, 'disk=' + JSON.parse(fs.readFileSync(D + '/cat.json', 'utf8')).cliVersion);\nawait r(); say('keyed:'); fs.writeFileSync(D + '/fail', ''); bump(); await r(); say('--version failed:'); fs.unlinkSync(D + '/fail'); bump(); await r(); say('--version back:');\n" "$D" > "$D/n.mts"; cd /home/lyphe/.claude/claudecodeui_lyphe && CLAUDE_CLI_PATH="$D/claude" CLOUDCLI_CLAUDE_MODEL_CATALOG_PATH="$D/cat.json" npx tsx --tsconfig server/tsconfig.json "$D/n.mts" 2>&1 | grep -v '^\[Claude models\]'; case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: the `--version failed:` line still reads `spawns=0 disk=2.1.284` (today: `spawns=1 disk=null`, then `spawns=2` once --version answers)
```

measured 2026-09-28 by chain chain-claude-model-catalog-20260928-173328-cec2, finding L1, LOW
probe-key: dd0a2efc1160028611ad23a567f37a22490e65af

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-model-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-model-options.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/utils/modelLabels.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-claude-catalog-picker.mjs

## INV-5691 — probe — A catalog without `resolvedModel` offers `default` as its own row, "Default (recommended)"

A catalog without `resolvedModel` offers `default` as its own row, "Default (recommended)"

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && npx tsx -e "import('/home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-model-options.ts').then(({buildClaudeModelsDefinition:b})=>{const m=JSON.parse(require('fs').readFileSync(process.env.HOME+'/.cloudcli/claude-model-catalog.json','utf8')).models.map(({resolvedModel,...r})=>r);console.log(b(m).OPTIONS.map(o=>o.value+'='+o.label).join(', '))})"
expect: no `default=` entry in the printed list (today: `default=Default (recommended), opus[1m]=Opus 5.5, fable=Fable 5.1, sonnet[1m]=Sonnet 5.5, haiku=Haiku 4.5`)
```

measured 2026-09-28 by chain chain-claude-model-catalog-20260928-173328-cec2, finding L2, LOW
probe-key: 9c5a0b10a091733a3a774a77800310216aaa0ef5

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-model-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-model-options.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/utils/modelLabels.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-claude-catalog-picker.mjs

## INV-5692 — probe — `server/modules/database/schema.ts:188-189` still says predefined models are source-controlled in each `-models.provider.ts`

`server/modules/database/schema.ts:188-189` still says predefined models are source-controlled in each `-models.provider.ts`

```probe
grep -n "remain source-" -A1 /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/schema.ts
expect: no output (today: line 188 "Predefined models remain source-" / 189 "controlled in each provider's `-models.provider.ts` adapter …")
```

measured 2026-09-28 by chain chain-claude-model-catalog-20260928-173328-cec2, finding L3, LOW
probe-key: 583edec4be7c8403338cefaa55b8de2de143e403

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/schema.ts

## INV-5693 — probe — The dispatcher stores a swarm count that CloudCLI's reader refuses, and one such plan freezes the entire Runner board

The dispatcher stores a swarm count that CloudCLI's reader refuses, and one such plan freezes the entire Runner board

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && H=$(mktemp -d /tmp/athena-probe-swarm-XXXX) && DISPATCHER_HOME=$H PYTHONPATH=$HOME/.claude/hooks python3 -c "from dispatcher import store, store_write; c=store.connect(); store_write.open_plan(c,'athena-big',repo='/tmp',session=None); c.commit()" && DISPATCHER_HOME=$H ~/.claude/scripts/dispatcher swarm athena-big on 9007199254740993; DISPATCHER_HOME=$H ~/.claude/scripts/dispatcher status --json > $H/s.json; H=$H TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx -e "const {planOf}=await import('./server/modules/dispatcher/dispatcher-plan.reader.ts');const {each,field}=await import('./server/modules/dispatcher/dispatcher-state.transport.ts');const d=JSON.parse((await import('node:fs')).readFileSync(process.env.H+'/s.json','utf8'));try{each(field(d,'plans'),'plans',planOf);console.log('READ')}catch(e){console.log('THROW',e.message)}"; DISPATCHER_HOME=$H ~/.claude/scripts/dispatcher swarm athena-big "on $(printf '9%.0s' $(seq 5000))" | cut -c1-60
expect: `REFUSED swarm 'on 9007199254740993': …` (exit 2), then `READ`, then a `REFUSED swarm …` line for the 5000-digit word (today: `SWARM athena-big swarm=on 9007199254740993`, `THROW dispatcher status --json answered the plan.swarm on 9007199254740993`, `dispatcher swarm: ValueError: Exceeds the limit (4300 digits)…`)
```

measured 2026-09-28 by chain chain-swarm-per-plan-20260928-184148-98ae, finding M1, MEDIUM
probe-key: e16078533cfaaada7d84b5b0a038ab0455356b54

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/SwarmControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/constants.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Stepper.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/controls.css, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-plan-swarm.mjs, /home/lyphe/.claude/hooks/dispatcher/cmd/swarm.py, /home/lyphe/.claude/hooks/dispatcher/swarm_word.py, /home/lyphe/.claude/hooks/dispatcher/width.py, /home/lyphe/.claude/hooks/plan_runner/swarm.py

## INV-5695 — probe — Two statements still describe the box's switch as every plan's bound

Two statements still describe the box's switch as every plan's bound

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n "exactly as it always has\|runs up to {{lanes}} independent phases" src/modules/settings/tabs/agents-settings/sections/content/RunnerModelContent.tsx; grep -c "\`ceiling\`, the most phases that may walk at once" src/shared/types.ts server/shared/types.ts
expect: no RunnerModelContent lines, and both type files count 0 — the box row says a plan with its own swarm word follows that word, and `ceiling` is described as the box's number for plans with none (today: lines 163 and 169, and a count of 1 in each types file)
```

measured 2026-09-28 by chain chain-swarm-per-plan-20260928-184148-98ae, finding L2, LOW
probe-key: 15332941c1203bf0feb98371dac680940517b0f4

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/SwarmControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/constants.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Stepper.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/controls.css, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-plan-swarm.mjs, /home/lyphe/.claude/hooks/dispatcher/cmd/swarm.py, /home/lyphe/.claude/hooks/dispatcher/swarm_word.py, /home/lyphe/.claude/hooks/dispatcher/width.py, /home/lyphe/.claude/hooks/plan_runner/swarm.py

## INV-5696 — probe — A real plan's Accept prompt can't be answered on a phone, and it hides the composer until it is answered

A real plan's Accept prompt can't be answered on a phone, and it hides the composer until it is answered

```probe
cd /tmp/pipeline-reviews/plan-prompt-in-chat/athena-probes && node census-fit.mjs claude-update-pipeline 390x844 mobile && node census-fit.mjs claude-update-pipeline 1280x720 desktop
expect: both lines end `answerable and composer reachable: true` (today: false — 390x844: card 1245px, Submit bottom 1282 → 1282, composer bottom 1368; 1280x720: Submit bottom 791 in a 720px viewport). Any plan of ≥6 phases can stand in for claude-update-pipeline if it has since walked.
```

measured 2026-09-28 by chain chain-plan-prompt-in-chat-20260928-183429-267d, finding H1, HIGH
probe-key: 35eb978ec49f385acff7b913ab237e76afb9a1ac

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-answer.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask.transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-prompts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-raise.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/InteractiveRenderers/QuestionTextField.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/hooks/dispatcher/ask.py, /home/lyphe/.claude/hooks/dispatcher/cmd/ask.py, /home/lyphe/.claude/hooks/dispatcher/owed.py, /home/lyphe/.claude/hooks/dispatcher_stop_planners.py, /home/lyphe/.claude/hooks/dispatcher_stop.py, /home/lyphe/.claude/hooks/intent_lock.py, /home/lyphe/.claude/skills/arc/SKILL.md, /home/lyphe/.claude/skills/plan/SKILL.md

## INV-5697 — probe — After a Rework, the re-cut's fresh Accept prompt comes back silently: no phone push, no tab bell

After a Rework, the re-cut's fresh Accept prompt comes back silently: no phone push, no tab bell

```probe
bash /tmp/pipeline-reviews/plan-prompt-in-chat/athena-probes/rework_key.sh
expect: `same prompt key: false` (today: `first ask: token 634745e991 asked {'id': 8 …}` / `re-cut ask: token 634745e991 asked {'id': 11 …}` / `same prompt key: true | re-cut prompt suppressed by the phone push memory: true`)
```

measured 2026-09-28 by chain chain-plan-prompt-in-chat-20260928-183429-267d, finding M1, MEDIUM
probe-key: 74af5a4f5ee80876547473078c98d616f0b65148

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-answer.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask.transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-prompts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-raise.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/InteractiveRenderers/QuestionTextField.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/hooks/dispatcher/ask.py, /home/lyphe/.claude/hooks/dispatcher/cmd/ask.py, /home/lyphe/.claude/hooks/dispatcher/owed.py, /home/lyphe/.claude/hooks/dispatcher_stop_planners.py, /home/lyphe/.claude/hooks/dispatcher_stop.py, /home/lyphe/.claude/hooks/intent_lock.py, /home/lyphe/.claude/skills/arc/SKILL.md, /home/lyphe/.claude/skills/plan/SKILL.md

## INV-5698 — probe — Two servers can both record the same landing's ask; the raise service claims the second hears `nothing`

Two servers can both record the same landing's ask; the raise service claims the second hears `nothing`

```probe
bash /tmp/pipeline-reviews/plan-prompt-in-chat/athena-probes/double_ask.sh
expect: `runs recording TWO asks for one landing: 0/10` (today: 9/10)
```

measured 2026-09-28 by chain chain-plan-prompt-in-chat-20260928-183429-267d, finding L1, LOW
probe-key: 26bcadb0c241191691e2917d8fd62a43db0ab6eb

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-answer.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask.transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-prompts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-raise.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/InteractiveRenderers/QuestionTextField.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/hooks/dispatcher/ask.py, /home/lyphe/.claude/hooks/dispatcher/cmd/ask.py, /home/lyphe/.claude/hooks/dispatcher/owed.py, /home/lyphe/.claude/hooks/dispatcher_stop_planners.py, /home/lyphe/.claude/hooks/dispatcher_stop.py, /home/lyphe/.claude/hooks/intent_lock.py, /home/lyphe/.claude/skills/arc/SKILL.md, /home/lyphe/.claude/skills/plan/SKILL.md

## INV-5699 — probe — The Stop hold's stand-down reads the store, not the screen, and `dispatcher ask` runs inside a Claude session

The Stop hold's stand-down reads the store, not the screen, and `dispatcher ask` runs inside a Claude session

```probe
bash /tmp/pipeline-reviews/plan-prompt-in-chat/athena-probes/mute.sh
expect: `hold after:` still names the Accept order, or the in-session `ask` is refused (today: `ask inside a Claude session: exit 0` and `hold after:   (no order)`)
```

measured 2026-09-28 by chain chain-plan-prompt-in-chat-20260928-183429-267d, finding L2, LOW
probe-key: fe6d7103d88f1c1ee9fa2ec5dd75af2c64bd3197

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-answer.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask.transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-prompts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-raise.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/InteractiveRenderers/QuestionTextField.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/hooks/dispatcher/ask.py, /home/lyphe/.claude/hooks/dispatcher/cmd/ask.py, /home/lyphe/.claude/hooks/dispatcher/owed.py, /home/lyphe/.claude/hooks/dispatcher_stop_planners.py, /home/lyphe/.claude/hooks/dispatcher_stop.py, /home/lyphe/.claude/hooks/intent_lock.py, /home/lyphe/.claude/skills/arc/SKILL.md, /home/lyphe/.claude/skills/plan/SKILL.md

## INV-5701 — probe — the builder's docs hand-off omits INV-4355, which now names a deleted function and a reader that no longer reads

the builder's docs hand-off omits INV-4355, which now names a deleted function and a reader that no longer reads

```probe
cd /home/lyphe/.claude && docstore get INV-4355 | python3 -c "import sys,json; b=json.load(sys.stdin)['row']['body']; print([l[:70]+'…' for l in b.splitlines() if 'word_of' in l])"
expect: [] — the Enforced line names neither the deleted `word_of` nor `reason` as a reader of the model word (today: one line, the Enforced line naming `route_of`/`word_of`/`reason`)
```

measured 2026-09-28 by chain chain-claude-swarm-20260928-195521-ce60, finding L1, LOW
probe-key: 60d2230d13605ada2fae5d4f237d4d3e83cff8c1

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-claude-swarm.mjs, /home/lyphe/.claude/hooks/dispatcher/width.py, /home/lyphe/.claude/hooks/planner_spend.py, /home/lyphe/.claude/scripts/runner_fixtures/claude_swarm.py, /home/lyphe/.claude/skills/arc/SKILL.md

## INV-5702 — probe — `probe-claude-swarm.mjs` cannot tell a DeepSeek caption from a Claude one, so its "Claude route" precondition proves less than it says

`probe-claude-swarm.mjs` cannot tell a DeepSeek caption from a Claude one, so its "Claude route" precondition proves less than it says

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node -e "const s=require('fs').readFileSync('.verify/probe-claude-swarm.mjs','utf8');const g=new RegExp(/const SWARM_GRAMMAR = \/(.*)\/;/.exec(s)[1]);console.log(g.test('0 of 10 done · 0 rounds · deepseek route, swarm on — all at once'), /\.provider/.test(s))"
expect: false false — the gate rejects a caption that is not a Claude-route posture, or the probe reads route.provider (today: true false)
```

measured 2026-09-28 by chain chain-claude-swarm-20260928-195521-ce60, finding L2, LOW
probe-key: f4758479bffab72a143c3321a70bdb15ecd8af44

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-claude-swarm.mjs, /home/lyphe/.claude/hooks/dispatcher/width.py, /home/lyphe/.claude/hooks/planner_spend.py, /home/lyphe/.claude/scripts/runner_fixtures/claude_swarm.py, /home/lyphe/.claude/skills/arc/SKILL.md

## INV-5709 — probe — Every replay of a spent-out, genuine ntfy token costs a full store read, uncapped, on a public route

Every replay of a spent-out, genuine ntfy token costs a full store read, uncapped, on a public route

```probe
bash /tmp/pipeline-reviews/plan-ask-survives-restart/athena-probes/stale_token_flood.sh
expect: `store reads for 40 taps of ONE stale token:` at most 2 and `one more tap of the same token afterwards, extra store reads: 0` (today: 40 and 1)
```

measured 2026-09-28 by chain chain-plan-ask-survives-restart-20260928-202000-d5a0, finding M1, MEDIUM
probe-key: dbe8f63b937a83ceb33b5a3bb9141a8707744f69

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask-names.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-prompts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/ntfy-action.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/services/ntfy-action-token.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/provider-runtime.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-5710 — probe — `answer()`'s settle chain has no catch, and the server has no `unhandledRejection` handler

`answer()`'s settle chain has no catch, and the server has no `unhandledRejection` handler

```probe
bash /tmp/pipeline-reviews/plan-ask-survives-restart/athena-probes/settle_throw.sh
expect: `still alive after the settle chain threw` and `process exit code 0` (today: `process exit code 1` and the thrown `SqliteError: database is locked` trace)
```

measured 2026-09-28 by chain chain-plan-ask-survives-restart-20260928-202000-d5a0, finding L1, LOW
probe-key: 0a2314ada3ac501357c89a2d38bf3c95d1f8b3ca

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask-names.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-prompts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/ntfy-action.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/services/ntfy-action-token.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/provider-runtime.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-5711 — probe — A click whose catch-up read fails is dropped silently to the operator

A click whose catch-up read fails is dropped silently to the operator

```probe
bash /tmp/pipeline-reviews/plan-ask-survives-restart/athena-probes/read_fail_silent.sh
expect: the tab receives a frame naming the undone answer (today: `frames the operator's tab receives after its click: NONE`, plan not approved, one journal line)
```

measured 2026-09-28 by chain chain-plan-ask-survives-restart-20260928-202000-d5a0, finding L2, LOW
probe-key: e9a7e9ecfc1e0e2f475306377e039b470e2235ee

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask-names.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-prompts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/ntfy-action.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/services/ntfy-action-token.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/provider-runtime.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-5712 — probe — The durable ask name is unique per record, not per ask over time

The durable ask name is unique per record, not per ask over time

```probe
bash /tmp/pipeline-reviews/plan-ask-survives-restart/athena-probes/id_reuse.sh
expect: `two different asks share one key (phone push memory and tab bell key on it): false` (today: true)
```

measured 2026-09-28 by chain chain-plan-ask-survives-restart-20260928-202000-d5a0, finding L3, LOW
probe-key: 8fa53d1bac9f9cec9c9d2c27e055571fbe5bc7a7

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask-names.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-prompts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/ntfy-action.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/services/ntfy-action-token.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/provider-runtime.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-5713 — probe — Two comments now say the opposite of `resolveToolApproval`

Two comments now say the opposite of `resolveToolApproval`

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n "hears every answer\|Every gateway hears" server/shared/types.ts server/modules/providers/list/claude/claude-runtime.provider.js
expect: no output — both comments say the first gateway that claims a key settles it (today: two lines, server/shared/types.ts:816 and claude-runtime.provider.js:240)
```

measured 2026-09-28 by chain chain-plan-ask-survives-restart-20260928-202000-d5a0, finding L4, LOW
probe-key: 895a0f6a64f0ae719ff6b4d83f7a4e2d11c62560

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask-names.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-prompts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/ntfy-action.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/services/ntfy-action-token.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/provider-runtime.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-5714 — probe — The stale-answer notice reaches every tab of that chat, and its copy says "your answer"

The stale-answer notice reaches every tab of that chat, and its copy says "your answer"

```probe
node /tmp/pipeline-reviews/plan-ask-survives-restart/athena-probes/toast-shot.mjs 390x844 mobile
expect: no toast in a tab that sent no answer (today: the `light` and `dark` lines print the "Prompt already answered" toast; the `other-chat` line prints [] as it should)
```

measured 2026-09-28 by chain chain-plan-ask-survives-restart-20260928-202000-d5a0, finding L5, LOW
probe-key: ba588a565c064530119a7ef989c943ff7c53cc89

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask-names.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-prompts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/ntfy-action.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/services/ntfy-action-token.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/provider-runtime.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-5718 — probe — `restart-after-light.png` / `tabAfter` are captioned "the tab on the new server", but the tab has not re-read yet

`restart-after-light.png` / `tabAfter` are captioned "the tab on the new server", but the tab has not re-read yet

```probe
grep -n "const POLL_MS\|waitForTimeout(6000)" src/modules/claude-updates/hooks/useClaudeUpdates.ts .verify/claude-updates-final.mjs
expect: POLL_MS = 60_000 in the hook and waitForTimeout(6000) in the driver's restart tail — so the tab's pane 6 s after the press is still the pre-restart picture (staged: only GETs at load and press+13 ms)
```

measured 2026-09-28 by chain chain-claude-update-pipeline--final-20260928-212031-af1e, finding M1, MEDIUM
probe-key: d24d7fd0a03eb06421805c6499e0066fdd40cd03

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/claude-updates-final.mjs

## INV-5719 — probe — `record.md` §3 and §5 print a reshaped object under the `$ node .verify/claude-updates-final.mjs …` lines

`record.md` §3 and §5 print a reshaped object under the `$ node .verify/claude-updates-final.mjs …` lines

```probe
jq -r 'keys_unsorted|join(",")' .verify/artifacts/claude-updates-final/tab-observations.json
expect: mode,shots,checks,errors,reportBefore,blockedWrites,checkNow — while record.md §3 under the same command shows shots,tab-light,tab-dark,sidebarExpanded,rail,consoleErrors,blockedWrites and a "paneLines" string
```

measured 2026-09-28 by chain chain-claude-update-pipeline--final-20260928-212031-af1e, finding L1, LOW
probe-key: 60ef1843fd0d9f06e026df2a8a98f15456e1c9d7

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/claude-updates-final.mjs

## INV-5720 — probe — `handoverSeen` (and the loop that ends on it) is cause-blind

`handoverSeen` (and the loop that ends on it) is cause-blind

```probe
journalctl -u cloudcli-server-dev --since "2026-09-28 21:30:50" --until "2026-09-28 21:35:40" --no-pager | grep -c 'handover complete'
expect: 4 — all from other sessions' edits (zero "reboot requested" in that window), each one the driver's /handover complete/ gate would count
```

measured 2026-09-28 by chain chain-claude-update-pipeline--final-20260928-212031-af1e, finding L2, LOW
probe-key: c4a153faf954a45362c67244b279e561a14df8ef

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/claude-updates-final.mjs

## INV-5727 — probe — HIGH — the chat door arms the park-at-peak hour BEFORE the store refuses, so a refused second Accept still schedules a Start for the plan the operator Queued

HIGH — the chat door arms the park-at-peak hour BEFORE the store refuses, so a refused second Accept still schedules a Start for the plan the operator Queued

```probe
bash /tmp/pipeline-reviews/accept-once/athena-probes/hold_then_refuse.sh
expect: `hour armed on the Queued plan: None` (today: `2026-09-29T10:00:00Z`, with the second answer's text still reading "This answer recorded nothing")
```

measured 2026-09-28 by chain chain-accept-once-20260928-214132-9473, finding H1, HIGH
probe-key: c6944f8dd646713cca7f890fbc04d9ba0f7f59c5

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/hooks/dispatcher/accept.py, /home/lyphe/.claude/hooks/dispatcher/cmd/run.py, /home/lyphe/.claude/hooks/dispatcher/judgment_accept.py, /home/lyphe/.claude/hooks/dispatcher/store.py, /home/lyphe/.claude/hooks/dispatcher/store_write.py, /home/lyphe/.claude/hooks/intent_lock.py

## INV-5728 — probe — MEDIUM — the "Already answered" toast reaches every tab of the chat, including the tab whose own answer won, and says "before your answer arrived"

MEDIUM — the "Already answered" toast reaches every tab of the chat, including the tab whose own answer won, and says "before your answer arrived"

```probe
node /tmp/pipeline-reviews/accept-once/athena-probes/already-toast.mjs 390x844 mobile dark
expect: the bystander tab prints `toasts -> []`, and the sender's toast does not say its own answer arrived late (today: both lines print the "Already answered / … before your answer arrived …" toast)
```

measured 2026-09-28 by chain chain-accept-once-20260928-214132-9473, finding M1, MEDIUM
probe-key: 69492cc18675a99b6dfc41bc6bf8f3b61e96e5c1

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/hooks/dispatcher/accept.py, /home/lyphe/.claude/hooks/dispatcher/cmd/run.py, /home/lyphe/.claude/hooks/dispatcher/judgment_accept.py, /home/lyphe/.claude/hooks/dispatcher/store.py, /home/lyphe/.claude/hooks/dispatcher/store_write.py, /home/lyphe/.claude/hooks/intent_lock.py

## INV-5729 — probe — LOW — a repeated name in one Accept now fails the whole Accept with a false "already approved"

LOW — a repeated name in one Accept now fails the whole Accept with a false "already approved"

```probe
cd /home/lyphe/.claude && S=$(mktemp -d /tmp/athena-dup-XXXX) || exit 1; case "$S" in /tmp/athena-dup-*) ;; *) exit 1;; esac; git init -q "$S/r"; export DISPATCHER_HOME="$S/h" XDG_RUNTIME_DIR="$S/none"; PYTHONPATH=hooks python3 -c "
from dispatcher import store
R='$S/r'; D={'repo':R,'goal':'g','delivers':'d','architecture':'a','interfaces':'i','constraints':'c','waits_on':[],'decisions':[],'questions':[]}
PH=[{'key':'a','title':'t','goal':'g','assignee':'hephaestus','waits_on':[],'start_here':[]}]
c=store.connect()
with c: store.open_plan(c,'dupname',repo=R,session='athena-probe'); store.put_design(c,'dupname',D); store.put_phases(c,'dupname',PH,'-')"; env -u CLAUDE_CODE_SESSION_ID scripts/dispatcher accept --paused dupname dupname; echo "exit $?"; scripts/dispatcher status dupname 2>&1 | grep -i "approved\|unapproved" | head -2; case "$S" in /tmp/athena-dup-*) rm -rf "$S";; esac
expect: one `ACCEPTED dupname — paused` (the name deduplicated), or a refusal that does not call the plan already approved — today: `REFUSED accept dupname: dupname is already approved (… by cli, now paused) …`, exit 3, and the plan unapproved
```

measured 2026-09-28 by chain chain-accept-once-20260928-214132-9473, finding L1, LOW
probe-key: 865e41d8b4312cc946816bfea9e36790345505cd

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/hooks/dispatcher/accept.py, /home/lyphe/.claude/hooks/dispatcher/cmd/run.py, /home/lyphe/.claude/hooks/dispatcher/judgment_accept.py, /home/lyphe/.claude/hooks/dispatcher/store.py, /home/lyphe/.claude/hooks/dispatcher/store_write.py, /home/lyphe/.claude/hooks/intent_lock.py

## INV-5740 — probe — an oversized but shape-valid `effort` map on `PUT /defaults` is answered 503 "could not be asked (E2BIG)", blaming the CLI for the client's body

an oversized but shape-valid `effort` map on `PUT /defaults` is answered 503 "could not be asked (E2BIG)", blaming the CLI for the client's body

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --input-type=module -e "import express from 'express'; const {createAgentLaunchRouter}=await import('./server/modules/agent-launch/agent-launch.routes.ts'); const {createAgentLaunchService}=await import('./server/modules/agent-launch/agent-launch.service.ts'); const app=express(); app.use(express.json({limit:'50mb'})); app.use('/x',createAgentLaunchRouter(createAgentLaunchService({bin:'/bin/true'}))); const s=app.listen(0); const effort={}; for(let i=0;i<30000;i++) effort['a'.repeat(52)+i]='high'; const r=await fetch('http://127.0.0.1:'+s.address().port+'/x/defaults',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({effort})}); console.log(r.status, await r.text()); process.exit(0)"
expect: `503 {"error":"the launch table could not be asked (E2BIG)"}` today; a healed lane prints a 400 with a sentence about the map
```

measured 2026-09-28 by chain chain-agent-launch-config--relay-20260928-223830-6d7b, finding L1, LOW
probe-key: d10f470a7307bd7fb2aaafec444e5d7ecc959cee

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/agent-launch/agent-launch.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/agent-launch/agent-launch.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts

## INV-5741 — probe — `failedRun`'s comment describes an argparse failure this CLI cannot produce, so an unfenced bad call is `refused`, not `unreachable`

`failedRun`'s comment describes an argparse failure this CLI cannot produce, so an unfenced bad call is `refused`, not `unreachable`

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && ~/.claude/scripts/launch-table bogus 2>/dev/null; echo "exit $?"
expect: a `{"error": "launch-table: argument verb: invalid choice: 'bogus' …"}` line on stdout and `exit 2` — a usage error the service classifies as `refused`, not the stderr-only exit 2 its comment describes
```

measured 2026-09-28 by chain chain-agent-launch-config--relay-20260928-223830-6d7b, finding L2, LOW
probe-key: 0ec42f7f7c1c08bb1c3b5f0e9fddd9eef0631d5a

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/agent-launch/agent-launch.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/agent-launch/agent-launch.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts

## INV-5742 — probe — the gates are checked before the launch-table ask and never after, and the ask makes the window about ten times wider

the gates are checked before the launch-table ask and never after, and the ask makes the window about ten times wider

```probe
sh /tmp/pipeline-reviews/agent-launch-config--metis/scn/stagger2.sh now resume 40
expect: resume stagger 40 ms -> ["took","refused 409"] and "--resume children actually started: 1"   (measured on this tree: ["took","took"], 2, three runs out of three; HEAD gives ["took","refused 409"], 1)
```

measured 2026-09-28 by chain chain-agent-launch-config--metis-20260928-230031-e11a, finding M1, MEDIUM
probe-key: 8fe0de5199e8f2955f04724593709a8ab908628b

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/kanban-metis.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/metis-env.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/metis-registry.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/metis-spawn.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts

## INV-5743 — probe — a table outage is charged by the driver as a failed launch, and parks the board for ten minutes

a table outage is charged by the driver as a failed launch, and parks the board for ten minutes

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && S=$(mktemp -d /tmp/athena-drv.XXXXXX) && mkdir -p "$S/home" "$S/st" "$S/bin" && printf '#!/bin/sh\necho boom >&2\nexit 1\n' > "$S/bin/launch-table" && chmod +x "$S/bin/launch-table" && cp ~/.claude/charters/launch.toml "$S/table.toml" && env HOME="$S/home" DATABASE_PATH="$S/db.sqlite" KANBAN_METIS_STATE_ROOT="$S/st" LAUNCH_TABLE_PATH="$S/table.toml" LAUNCH_TABLE_BIN="$S/bin/launch-table" TSX_TSCONFIG_PATH=$PWD/server/tsconfig.json node --import tsx /tmp/pipeline-reviews/agent-launch-config--metis/scn/drv.mts 2>&1 | grep "launch failed\|relaunchAllowed"; case "$S" in /tmp/athena-drv.*) rm -r "$S";; esac
expect: `launch failed: Metis's launch table could not be read: … (boom)` and `"relaunchAllowed":false` after one failed tick   (this pins the assumption; it is not a claimed defect)
```

measured 2026-09-28 by chain chain-agent-launch-config--metis-20260928-230031-e11a, finding L1, LOW
probe-key: 7c92631fa3d5838604abd32e8efe3f7b95ac7a0b

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/kanban-metis.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/metis-env.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/metis-registry.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/metis-spawn.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts

## INV-5744 — probe — Two saves in flight: `saving` is one string, so the second overwrites the first's hold and the first to finish releases the other's

Two saves in flight: `saving` is one string, so the second overwrites the first's hold and the first to finish releases the other's

```probe
cd /tmp/pipeline-reviews/agent-launch-config--fill/athena-probes && node s12.mjs
expect: the line `held=-` is printed BEFORE the line `hermes answered` (today ≈2.1 s vs ≈4.7 s); held once means hermes stays `held=hermes` until its own answer
```

measured 2026-09-28 by chain chain-agent-launch-config--fill-20260928-232057-5938, finding M1, MEDIUM
probe-key: b0bc55a3044296cd33bf19125dbaf5d614725005

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/hooks/useAgentLaunch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-5745 — probe — A non-JSON answer reaches the tab as a JSON parser's fragment

A non-JSON answer reaches the tab as a JSON parser's fragment

```probe
cd /tmp/pipeline-reviews/agent-launch-config--fill/athena-probes && node s6b.mjs
expect: the `html-502` and `html-200` lines print an unreadable banner carrying `Unexpected token '<'` (a readable sentence would carry no parser text)
```

measured 2026-09-28 by chain chain-agent-launch-config--fill-20260928-232057-5938, finding L1, LOW
probe-key: ee466fa289d9437e0dc09b553323423be5fc7e3e

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/hooks/useAgentLaunch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-5746 — probe — A 200 whose body is not a census blanks the workspace region

A 200 whose body is not a census blanks the workspace region

```probe
cd /tmp/pipeline-reviews/agent-launch-config--fill/athena-probes && node s6b.mjs
expect: the `json {}` line prints `panel never mounted (region blanked)` (a guarded hook prints `unreadable` with a banner and boundary: 0)
```

measured 2026-09-28 by chain chain-agent-launch-config--fill-20260928-232057-5938, finding L2, LOW
probe-key: 1e8b5d6825644d34103414b36b573ffff92f9789

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/hooks/useAgentLaunch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-5747 — probe — A save that outlives the browser's 30 s deadline says "Not saved" and holds the old picture

A save that outlives the browser's 30 s deadline says "Not saved" and holds the old picture

```probe
cd /tmp/pipeline-reviews/agent-launch-config--fill/athena-probes && node s13.mjs
expect: after ≈30.5 s the banner reads `Not saved — the launch table refused the change to hermes:` then `signal timed out`
```

measured 2026-09-28 by chain chain-agent-launch-config--fill-20260928-232057-5938, finding L3, LOW
probe-key: aca292b8e713a7e861028798961c5e483ac3824e

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/hooks/useAgentLaunch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-5748 — probe — (LOW) — `MAN-7418` quotes the mount and Metis's resolve, and governs neither `server/index.ts` nor the kanban-metis files

(LOW) — `MAN-7418` quotes the mount and Metis's resolve, and governs neither `server/index.ts` nor the kanban-metis files

```probe
cd ~/.claude/claudecodeui_lyphe && docstore get MAN-7418 | python3 -c "import sys,json; g=json.load(sys.stdin)['row']['governs']; print(any(x.endswith('server/index.ts') for x in g), [x for x in g if 'kanban-metis' in x])"
expect: False [] today
```

measured 2026-09-29 by chain chain-agent-launch-config--docs-cloudcli-20260928-234507-38b5, finding L2, LOW
probe-key: 9d0f1d6765e00c290f340834ae842db81b3d9695

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts

## INV-5758 — probe — MEDIUM — a picture bypasses `MAX_TOOL_RESULT_CONTENT`; an image-heavy session's history page is 4.85× larger

MEDIUM — a picture bypasses `MAX_TOOL_RESULT_CONTENT`; an image-heavy session's history page is 4.85× larger

```probe
bash /tmp/pipeline-reviews/chat-image-results/athena-probes/history_size.sh
expect: `under 3 MB: true` (HEAD: 2,034,059 bytes; today: 9,866,660 and `false`)
```

measured 2026-09-29 by chain chain-chat-image-results-20260929-064842-edca, finding M1, MEDIUM
probe-key: efe96c67a1a69d1908c92d137ef88f9fc6c07fa7

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/file-tree/file-tree-read-path.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-image-blocks.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-image-results.mjs

## INV-5759 — probe — LOW — `files/content` has no regular-file guard, and the diff made every FIFO under the home dir reachable

LOW — `files/content` has no regular-file guard, and the diff made every FIFO under the home dir reachable

```probe
bash /tmp/pipeline-reviews/chat-image-results/athena-probes/fifo_content.sh
expect: `refused instead of hung: true` (today: answered `000`, the request hung)
```

measured 2026-09-29 by chain chain-chat-image-results-20260929-064842-edca, finding L1, LOW
probe-key: 5034d4f2e62faed52d721a2efe95405f3bf14dfa

governs: /home/lyphe/.claude/claudecodeui_lyphe/files/content

## INV-5760 — probe — LOW — the preview offers Edit on an outside text file, and Edit dead-ends

LOW — the preview offers Edit on an outside text file, and Edit dead-ends

```probe
bash /tmp/pipeline-reviews/chat-image-results/athena-probes/outside_text_open.sh
expect: `Edit offered on the outside file: false` (today: `true`, then `editor says: Couldn't open note.txt for editing`)
```

measured 2026-09-29 by chain chain-chat-image-results-20260929-064842-edca, finding L2, LOW
probe-key: 0db12e1711c350bb93039bc41d842ab91eba6643

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/file-tree/file-tree-read-path.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-image-blocks.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-image-results.mjs

## INV-5761 — probe — LOW — every open of an outside file requests a listing the server always refuses; it logs a console error and shows an amber refusal, and the probe's console gate is closed before that step

LOW — every open of an outside file requests a listing the server always refuses; it logs a console error and shows an amber refusal, and the probe's console gate is closed before that step

```probe
bash /tmp/pipeline-reviews/chat-image-results/athena-probes/outside_text_open.sh
expect: `403s []` and `console errors 0` on the "after opening the chip" line (today: `403s ["/list"] | console errors 1 | folder pane refusal shown: true`)
```

measured 2026-09-29 by chain chain-chat-image-results-20260929-064842-edca, finding L3, LOW
probe-key: 88ac5ad1d85b492ebb6eb738b8216f5cfaa1be5a

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/file-tree/file-tree-read-path.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-image-blocks.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-image-results.mjs

## INV-5762 — probe — LOW — a picture is not on the page when the Read sits in a collapsed run, even with Show work on

LOW — a picture is not on the page when the Read sits in a collapsed run, even with Show work on

```probe
node /tmp/pipeline-reviews/chat-image-results/athena-probes/grouped_read_hides.mjs
expect: the "group collapsed" line lists a picture, or the collapsed row signals one (today: `[]`, then two pictures only after the group opens)
```

measured 2026-09-29 by chain chain-chat-image-results-20260929-064842-edca, finding L4, LOW
probe-key: da814a8d85dc3c9abb20dbea7f14619299037dde

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/file-tree/file-tree-read-path.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-image-blocks.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-image-results.mjs

## INV-5763 — probe — LOW — a picture the assistant read is announced as "Attached image"

LOW — a picture the assistant read is announced as "Attached image"

```probe
node /tmp/pipeline-reviews/chat-image-results/athena-probes/grouped_read_hides.mjs
expect: the picture's label names the file, not "Attached image" (today: `["Expand Attached image","Expand Attached image"]`)
```

measured 2026-09-29 by chain chain-chat-image-results-20260929-064842-edca, finding L5, LOW
probe-key: 05948b28491557b1487b7e35ce4e17ced0c6e8dc

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/file-tree/file-tree-read-path.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-image-blocks.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-image-results.mjs

## INV-5764 — probe — LOW — `.verify/chat-image-results.mjs` cannot fail

LOW — `.verify/chat-image-results.mjs` cannot fail

```probe
bash /tmp/pipeline-reviews/chat-image-results/athena-probes/probe_exit_code.sh
expect: `phases that drew no picture: 4` followed by a non-zero exit code (today: `exit code: 0`; needs a client build without the fix, `:3011` today)
```

measured 2026-09-29 by chain chain-chat-image-results-20260929-064842-edca, finding L6, LOW
probe-key: a2960221dedc3a915d0fbca25079be66405dd76b

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-image-results.mjs

## INV-5767 — probe — the old name is still in two plan records

the old name is still in two plan records

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -rlI "SettingsRow\|ControlRow" src server docs .verify/probe-settings-rows.mjs .verify/lib
expect: no output (today: docs/plans/ntfy-notifications.plan.md and docs/plans/simple-chat-list.plan.md)
```

measured 2026-09-29 by chain chain-settings-rows-mobile-20260929-070652-edde, finding L2, LOW
probe-key: 2e3080b66a8632af85684e1a4786726b0ff7f8f0

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/NtfySettingsCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/SettingRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-settings-rows.mjs

## INV-5768 — the sidebar keeps one place in the tree across 768px

`ProjectSidebarRegion` returns ONE tree for the docked sidebar (from 768px) and the mobile drawer; only classes and the scrim change. Never give the two layouts separate `return`s, nor wrap `Sidebar` in a different element type per layout.

why: `Sidebar` hosts `SidebarModals`, which renders the Settings dialog. Two returns put `Sidebar` at two positions in the React tree, so crossing 768px (a phone turning to landscape, a window dragged over the line, a tablet) unmounts the whole sidebar and mounts a new one. The dialog stays open (its flag lives in `useProjectsState`, above) but every bit of its state starts again: `useSettingsController` seeds `activeTab` from `initialTab`, so the open tab snapped back to Agents, and the sidebar's own draft state was lost with it. Measured before the fix: the `.modal-backdrop` node and the sidebar root were replaced on a 1440 → 700 resize; after it they are the same nodes. `Settings.tsx`'s `key={activeTab}` remounts the pane on a tab change only and is not part of this.

how it holds: slot 0 of the wrapper is the scrim or nothing, slot 1 is the panel, and the drawer's `stopPropagation` handlers are attached on the drawer only.

```probe
node .verify/probe-settings-rows.mjs after
expect: the "open Settings tab across a resize over 768" section reads `pane kept=true` on every leg (the two window crossings and the two rotations, both themes), and the run ends settings-rows=pass
```

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/ProjectSidebarRegion.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/Settings.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarModals.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/Sidebar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-settings-rows.mjs

## INV-5769 — probe — the viewer opens INVISIBLY behind the PRD editor (`z-[200]` over the viewer's `z-[100]`)

the viewer opens INVISIBLY behind the PRD editor (`z-[200]` over the viewer's `z-[100]`)

```probe
cd /tmp/pipeline-reviews/diagram-lightbox && node athena-zindex.mjs
expect: {"dialogMounted":true,"dialogZ":"100","hostZ":"200","topmostAtCentre":"PRD-EDITOR","topmostAtCorner":"PRD-EDITOR","topmostAtCloseBtn":"PRD-EDITOR"} then "after Esc: dialog still mounted = false"
```

measured 2026-09-29 by chain chain-diagram-lightbox-20260929-082654-343c, finding H1, HIGH
probe-key: 56d8db3d3e17f9a037b459e7628a1c517a7fd1df

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/ChatMessageImages.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/markdown-preview/MermaidDiagram.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Lightbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/useZoomPan.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lightbox-zoom.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/pwa-notch-close-controls.mjs

## INV-5770 — probe — the id rename breaks mermaid's end-anchored id selectors, so the viewer's copy loses paint on some markers

the id rename breaks mermaid's end-anchored id selectors, so the viewer's copy loses paint on some markers

```probe
cd /tmp/pipeline-reviews/diagram-lightbox && A_THEME=dark node athena-stick.mjs
expect: INLINE lists "-crosshead path fill=rgb(211, 211, 211) stroke=rgb(211, 211, 211)"; VIEWER lists "-crosshead-viewer path fill=none stroke=rgb(0, 0, 0)"
```

measured 2026-09-29 by chain chain-diagram-lightbox-20260929-082654-343c, finding M1, MEDIUM
probe-key: abacbeb4650072034f187b2620a4c7fcf6ccc6c0

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/ChatMessageImages.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/markdown-preview/MermaidDiagram.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Lightbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/useZoomPan.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lightbox-zoom.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/pwa-notch-close-controls.mjs

## INV-5771 — probe — a resize or a phone rotation while zoomed leaves the content outside its pan clamp

a resize or a phone rotation while zoomed leaves the content outside its pan clamp

```probe
cd /tmp/pipeline-reviews/diagram-lightbox && node athena-interact.mjs
expect: the "(d)" line ends with a content box whose "top":190 (a band above it) and "bottom":2397 against "dialog [ 700, 500 ]"
```

measured 2026-09-29 by chain chain-diagram-lightbox-20260929-082654-343c, finding L1, LOW
probe-key: 331b383baa6c2f643fd1ff510bd98adc39bb5f8c

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/ChatMessageImages.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/markdown-preview/MermaidDiagram.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Lightbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/useZoomPan.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lightbox-zoom.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/pwa-notch-close-controls.mjs

## INV-5772 — probe — pressing a toolbar button and sliding off it onto the backdrop closes the viewer

pressing a toolbar button and sliding off it onto the backdrop closes the viewer

```probe
cd /tmp/pipeline-reviews/diagram-lightbox && node athena-interact.mjs
expect: (c) press on "+" then release over the backdrop: viewer open = false
```

measured 2026-09-29 by chain chain-diagram-lightbox-20260929-082654-343c, finding L2, LOW
probe-key: 760b030a6ce3e247ae92d2aa278a2ac433b50b68

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/ChatMessageImages.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/markdown-preview/MermaidDiagram.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Lightbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/useZoomPan.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lightbox-zoom.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/pwa-notch-close-controls.mjs

## INV-5773 — probe — one Ctrl+mouse-wheel notch zooms 2.7×

one Ctrl+mouse-wheel notch zooms 2.7×

```probe
cd /tmp/pipeline-reviews/diagram-lightbox && node athena-interact.mjs
expect: (e) one ctrl+mouse-wheel notch (deltaY -100): scale 2.718   and   one plain wheel notch (deltaY -100): scale 1.246
```

measured 2026-09-29 by chain chain-diagram-lightbox-20260929-082654-343c, finding L3, LOW
probe-key: 23ea081ceceda910eba3ca8b789d58243841957a

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/ChatMessageImages.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/markdown-preview/MermaidDiagram.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Lightbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/useZoomPan.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lightbox-zoom.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/pwa-notch-close-controls.mjs

## INV-5774 — probe — stale pointers to where the close button's offsets live

stale pointers to where the close button's offsets live

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n "ChatMessageImages" src/index.css
expect: no output (today: line 175)
```

measured 2026-09-29 by chain chain-diagram-lightbox-20260929-082654-343c, finding L4, LOW
probe-key: 8ecaf9ba35204a4b07920b5a179cde9efc4c64ba

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/ChatMessageImages.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/markdown-preview/MermaidDiagram.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Lightbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/useZoomPan.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lightbox-zoom.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/pwa-notch-close-controls.mjs

## INV-5775 — probe — the builder's gate does not reproduce green on the phone phases

the builder's gate does not reproduce green on the phone phases

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node .verify/lightbox-zoom.mjs athena2 mobile-dark
expect: FAIL mobile-dark: the transcript's diagram rendered  (today; the gate is meant to end PROBE OK)
```

measured 2026-09-29 by chain chain-diagram-lightbox-20260929-082654-343c, finding L5, LOW
probe-key: f5e68ada55d0782b88d57b3ea9765725f85a962a

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/ChatMessageImages.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/markdown-preview/MermaidDiagram.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Lightbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/useZoomPan.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lightbox-zoom.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/pwa-notch-close-controls.mjs

## INV-5776 — probe — focus does not move into the dialog when the viewer opens

focus does not move into the dialog when the viewer opens

```probe
cd /tmp/pipeline-reviews/diagram-lightbox && node athena-focus.mjs
expect: after Enter opens the viewer, focus: {"insideDialog":false,"active":"DIV[role=button][aria-label=Open diagram full screen]"}
```

measured 2026-09-29 by chain chain-diagram-lightbox-20260929-082654-343c, finding L6, LOW
probe-key: f4e0aaa849312734dbaddfb2db3bfb22e1190cba

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/ChatMessageImages.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/markdown-preview/MermaidDiagram.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Lightbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/useZoomPan.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lightbox-zoom.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/pwa-notch-close-controls.mjs

## INV-5777 — probe — the plugin tab's "Install from git" button is cut off at the operator's own width, and the probe cannot see it

the plugin tab's "Install from git" button is cut off at the operator's own width, and the probe cannot see it

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && A_WIDTHS=341 A_SCALES=1.072 node /tmp/pipeline-reviews/settings-mobile-round2/athena-r2-cards.mjs | grep '^Plugins'
expect: the line ends installForm:{"form":"17-324","input":"238w","btn":"288-368(79w)","cut":44,"label":"Install"} — cut > 0; healed when cut is -1 at 320, 341 and 360 × 1, 1.072, 1.2
```

measured 2026-09-29 by chain chain-settings-mobile-round2-20260929-081949-f36c, finding M1, MEDIUM
probe-key: 9714e0560e36c947e4222c26a9917408463ef863

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/plugins/PluginSettingsTab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/SettingRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/settings-rows-measure.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/settings-rows-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-settings-rows.mjs

## INV-5778 — probe — the uninstall-confirm banner clips its Remove button on phones

the uninstall-confirm banner clips its Remove button on phones

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node /tmp/pipeline-reviews/settings-mobile-round2/athena-r2-banner.mjs | grep -E '^w=(320|341) x1\.(072|2):'
expect: w=320 x1.072 reads "Usage Dashbo:REMOVE-CUT-7px Session Mana:REMOVE-CUT-11px snake_case_p:REMOVE-CUT-325px Extraordinar:REMOVE-CUT-31px"; healed when every name reads ok
```

measured 2026-09-29 by chain chain-settings-mobile-round2-20260929-081949-f36c, finding L1, LOW
probe-key: 2b6e674875c6788262734d2592c59f84e955b85f

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/plugins/PluginSettingsTab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/SettingRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/settings-rows-measure.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/settings-rows-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-settings-rows.mjs

## INV-5779 — probe — the probe's fixtures do not cover three shapes the intent names

the probe's fixtures do not cover three shapes the intent names

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -c "command:\|Cancel\|844" .verify/probe-settings-rows.mjs .verify/lib/settings-rows-walk.mjs .verify/lib/settings-rows-measure.mjs
expect: 0 for each of the three files (a stdio MCP fixture with a `command:`, a confirm-uninstall step that presses `Cancel` and a 844-wide landscape leg would each add a match)
```

measured 2026-09-29 by chain chain-settings-mobile-round2-20260929-081949-f36c, finding L3, LOW
probe-key: 494170834dc325482ac2573275fac7e1f9a3bd48

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/plugins/PluginSettingsTab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/SettingRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/settings-rows-measure.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/settings-rows-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-settings-rows.mjs

## INV-5790 — probe — The standing proof cannot see a lead cut by an ellipsis or by a clipping ancestor

The standing proof cannot see a lead cut by an ellipsis or by a clipping ancestor

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && T=$(mktemp -d) && sed -e "s#'../src/#'$PWD/src/#" -e "s#^async function openTab(page, viewport) {#&\n  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '[data-card-description]{white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important}'; document.head.appendChild(s); }));#" .verify/probe-card-description.mjs > $T/p.mjs && node $T/p.mjs --tag ellipsis | grep -E "arc restorly's lead is drawn whole|reading\(s\) failed" | sed -E 's/^(PASS|FAIL) tab [0-9]+ (light|dark)/\1 tab/' | sort | uniq -c; echo "exit ${PIPESTATUS[0]}"
expect: exit 1 and a FAIL on the arc restorly's "drawn whole" line for a 1,367-character lead painted on 1 line (today: 4× PASS "painted on 1 line(s)", "0 reading(s) failed", exit 0)
```

measured 2026-09-29 by chain chain-card-description-full-20260929-105755-1234, finding M1, MEDIUM
probe-key: 3cbc33de2fe16b8b75d50c03ee129c05f614d28a

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcDeck.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/LaneCardHead.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-description.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dispatch-arc-word.mjs

## INV-5791 — probe — MANUAL.md still says the standing proof's rule is the old clamp, and the builder's report says no leftover exists

MANUAL.md still says the standing proof's rule is the old clamp, and the builder's report says no leftover exists

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n 'computes `-webkit-line-clamp: 2` and paints one or two lines' docs/MANUAL.md | cut -c1-60
expect: no output (today: line 3014 prints)
```

measured 2026-09-29 by chain chain-card-description-full-20260929-105755-1234, finding M2, MEDIUM
probe-key: 47d8307d23c46999a1685bc02b4eb4829502d29e

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcDeck.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/LaneCardHead.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-description.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dispatch-arc-word.mjs

## INV-5792 — probe — The standing proof's shots are capped at 480px, so the head of a long description is cut in the one picture a human checks

The standing proof's shots are capped at 480px, so the head of a long description is cut in the one picture a human checks

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node .verify/probe-card-description.mjs --tag capcheck > /dev/null; python3 -c "import struct;d=open('.verify/shots/card-description-capcheck-390-dark-arc.png','rb').read(24);print(struct.unpack('>II',d[16:24]))"
expect: a height above 496, the whole 525px arc head at 390 (today: (348, 496), cut at the 480px cap)
```

measured 2026-09-29 by chain chain-card-description-full-20260929-105755-1234, finding L1, LOW
probe-key: a26a3eb60633ae8b179cacbd33b3e64e29752446

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcDeck.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/LaneCardHead.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-description.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dispatch-arc-word.mjs

## INV-5793 — probe — PlanCard's fold rationale still promises a compact head, and a folded card is no longer one

PlanCard's fold rationale still promises a compact head, and a folded card is no longer one

```probe
node /tmp/pipeline-reviews/card-description-full/athena-probes/fold.mjs | grep -E "^390"
expect: either the fold's rationale no longer says "at a glance", or every folded loose card at 390 reads under ~250px (today: folded 151 / 470 / 206 / 338, arc 539)
```

measured 2026-09-29 by chain chain-card-description-full-20260929-105755-1234, finding L2, LOW
probe-key: f77ce2f9cabcc4086a663f85bfa98a8bea965f0f

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcDeck.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/LaneCardHead.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-description.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dispatch-arc-word.mjs

## INV-5794 — probe — the longest real prompt is the arc lock, not `coi-backend-conformance`; the panel proof stops at a fifth of it

the longest real prompt is the arc lock, not `coi-backend-conformance`; the panel proof stops at a fifth of it

```probe
cd ~/.claude && PYTHONPATH=hooks python3 -c "
from dispatcher import store, lock
c=store.connect(); a=c.execute(\"SELECT id FROM arcs WHERE name='restorly'\").fetchone()[0]
n=[p['name'] for p in store.arc_plans(c,a)]; print(len(n), len(lock.question_text(c,n)))"
expect: 14 plans and ~39.8k characters — 5x the 7,451-char prompt the panel proof used (moves with the store; the shape is what matters)
```

measured 2026-09-29 by chain chain-lock-prompt-glance-20260929-110148-17f8, finding M1, MEDIUM
probe-key: c6145a3457e6d12ef4613f3ac632435aedb1d64f

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-intent-lock-prompt.mjs, /home/lyphe/.claude/hooks/dispatcher/lock_glance.py, /home/lyphe/.claude/hooks/dispatcher/lock.py, /home/lyphe/.claude/skills/plan/SKILL.md

## INV-5795 — probe — an unclosed code fence in a plan's `delivers` swallows the facts line, the phase list and the token into the code block

an unclosed code fence in a plan's `delivers` swallows the facts line, the phase list and the token into the code block

```probe
cd ~/.claude && PYTHONPATH=hooks python3 -c "
from dispatcher import lock_glance as g
x=g.Glance('p','see:\n\`\`\`sh\nrun','/tmp',None,None,(),1,1,0,'',(),'')
print(sum(1 for b in g.blocks([x]) for l in b.splitlines() if l.startswith('\`\`\`')) % 2)"
expect: 1 — the prompt's blocks carry an odd number of fence lines, so nothing closes the fence before the facts, phase list and token
```

measured 2026-09-29 by chain chain-lock-prompt-glance-20260929-110148-17f8, finding L1, LOW
probe-key: f761e8f6129637e561901ea900beaa317b2e4d1c

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-intent-lock-prompt.mjs, /home/lyphe/.claude/hooks/dispatcher/lock_glance.py, /home/lyphe/.claude/hooks/dispatcher/lock.py, /home/lyphe/.claude/skills/plan/SKILL.md

## INV-5796 — probe — three lines still describe the old prompt shape

three lines still describe the old prompt shape

```probe
cd ~/.claude/claudecodeui_lyphe && grep -c "census word for word" server/shared/types.ts; grep -c "single newlines only" src/modules/chat/tools/ContentRenderers/QuestionText.tsx
expect: 1 and 1 — both still describe the old shape (0 once healed)
```

measured 2026-09-29 by chain chain-lock-prompt-glance-20260929-110148-17f8, finding L2, LOW
probe-key: a2e8cb06d0adeaa9543eea5c39d72cc3ce71ed19

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-intent-lock-prompt.mjs, /home/lyphe/.claude/hooks/dispatcher/lock_glance.py, /home/lyphe/.claude/hooks/dispatcher/lock.py, /home/lyphe/.claude/skills/plan/SKILL.md

## INV-5797 — probe — "read ONCE for the text and the token" is not what runs; the two can part under a concurrent write

"read ONCE for the text and the token" is not what runs; the two can part under a concurrent write

```probe
cd ~/.claude && PYTHONPATH=hooks python3 -c "
from dispatcher import store, lock, lock_glance as g
c=store.connect(); n=[]; o=g.read; g.read=lambda c_,r:(n.append(1),o(c_,r))[1]
lock.question_text(c,['agent-launch-config']); print(len(n))"
expect: 2 for one plan's prompt (the docstring, MANUAL and MAN-1443 say once)
```

measured 2026-09-29 by chain chain-lock-prompt-glance-20260929-110148-17f8, finding L3, LOW
probe-key: e5c97527ca014e1398bcf3be3e1557e755bb9143

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-intent-lock-prompt.mjs, /home/lyphe/.claude/hooks/dispatcher/lock_glance.py, /home/lyphe/.claude/hooks/dispatcher/lock.py, /home/lyphe/.claude/skills/plan/SKILL.md

## INV-5798 — probe — `Arc <arc>, plan <i> of <n>` shows the store's id order, which is wrong for the real `restorly` arc

`Arc <arc>, plan <i> of <n>` shows the store's id order, which is wrong for the real `restorly` arc

```probe
cd ~/.claude && scripts/dispatcher question restorly--vendors | grep -o "Arc restorly, plan [0-9]* of [0-9]*"; python3 -c "import tomllib; o=[p['name'] for p in tomllib.load(open('plans/restorly.arc.toml','rb'))['plan']]; print(o.index('restorly--vendors')+1, len(o))"
expect: the prompt says "plan 9 of 14" while the arc file lists it 7th of 13
```

measured 2026-09-29 by chain chain-lock-prompt-glance-20260929-110148-17f8, finding L4, LOW
probe-key: f96881d501a30e609e660221eb73cc93c2d093e7

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-intent-lock-prompt.mjs, /home/lyphe/.claude/hooks/dispatcher/lock_glance.py, /home/lyphe/.claude/hooks/dispatcher/lock.py, /home/lyphe/.claude/skills/plan/SKILL.md
