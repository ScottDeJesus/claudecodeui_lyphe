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
node /home/lyphe/.claude/state/pipeline-reviews/arc-dismiss/athena-probes/arc-hide-5xx-reload.mjs
expect: the "after reload + 8 s" line reads `decks 0` and `server hides` holding every restorly lane plan (today: `decks 1 … server hides []`); needs restorly on the lane (until 2026-09-29T19:02Z) — else set the arc to one the lane carries
```

measured 2026-09-28 by chain chain-arc-dismiss-20260928-151015-a6a2, finding M1, MEDIUM
probe-key: 116798434903a6b93c1992fd480b7b74d505ddf2

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/user-preferences.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hiddenPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useDispatcherPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useCardFold.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/preferenceEntryPatch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/userSettings.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dismiss-done.mjs

## INV-5664 — probe — A hide already sent is erased locally by a sign-in read that lands after it; the new comment and INV-4406 claim otherwise

A hide already sent is erased locally by a sign-in read that lands after it; the new comment and INV-4406 claim otherwise

```probe
node /home/lyphe/.claude/state/pipeline-reviews/arc-dismiss/athena-probes/arc-hide-races.mjs s5
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
node /home/lyphe/.claude/state/pipeline-reviews/done-cards-leave/athena-probes/athena-dcl.mjs s9
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
node /home/lyphe/.claude/state/pipeline-reviews/done-cards-leave/athena-probes/athena-dcl.mjs s13
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
cd /home/lyphe/.claude/claudecodeui_lyphe && T=$(mktemp -d) && sed -e "s#'../src/#'$PWD/src/#" -e "s#^async function openTab(page, viewport) {#&\n  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '[data-card-description]{display:none !important}'; document.head.appendChild(s); }));#" .verify/probe-card-description.mjs > $T/p.mjs && npx tsx $T/p.mjs --tag hidden-lead | grep -E "painted on|reading\(s\) failed" | sort | uniq -c; echo "exit ${PIPESTATUS[0]}"
expect: exit 1, with a FAIL on the "starts folded to one line" check for a lead painted on 0 lines (2026-10-02: 4× that FAIL, "8 reading(s) failed", exit 1)
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

## INV-5688 — probe — with no reading yet, the pane offers nothing at all for up to a poll (LOW)

with no reading yet, the pane offers nothing at all for up to a poll (LOW)

```probe
node /tmp/athena-probe-claude-updates/probe4.mjs
expect: "pane with no reading: \"Claude updates | Reading the update report…\"" / "its buttons: []" / "pane filled after 51 s" — no manual retry anywhere in the branch
```

measured 2026-09-28 by chain chain-claude-update-pipeline--fill-20260928-171627-a599, finding L2, LOW
probe-key: d8df40e2919b689a77d33f8ffd61032e5bfa0430

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/claude-updates/ClaudeUpdatesSettingsTab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/claude-updates/hooks/useClaudeUpdates.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

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

## INV-5693 — probe — The dispatcher stores a swarm count that CloudCLI's reader refuses, and one such plan freezes the entire Runner board

The dispatcher stores a swarm count that CloudCLI's reader refuses, and one such plan freezes the entire Runner board

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && H=$(mktemp -d /tmp/athena-probe-swarm-XXXX) && DISPATCHER_HOME=$H PYTHONPATH=$HOME/.claude/hooks python3 -c "from dispatcher import store, store_write; c=store.connect(); store_write.open_plan(c,'athena-big',repo='/tmp',session=None); c.commit()" && DISPATCHER_HOME=$H ~/.claude/scripts/dispatcher swarm athena-big on 9007199254740993; DISPATCHER_HOME=$H ~/.claude/scripts/dispatcher status --json > $H/s.json; H=$H TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx -e "const {planOf}=await import('./server/modules/dispatcher/dispatcher-plan.reader.ts');const {each,field}=await import('./server/modules/dispatcher/dispatcher-state.transport.ts');const d=JSON.parse((await import('node:fs')).readFileSync(process.env.H+'/s.json','utf8'));try{each(field(d,'plans'),'plans',planOf);console.log('READ')}catch(e){console.log('THROW',e.message)}"; DISPATCHER_HOME=$H ~/.claude/scripts/dispatcher swarm athena-big "on $(printf '9%.0s' $(seq 5000))" | cut -c1-60
expect: `REFUSED swarm 'on 9007199254740993': …` (exit 2), then `READ`, then a `REFUSED swarm …` line for the 5000-digit word (today: `SWARM athena-big swarm=on 9007199254740993`, `THROW dispatcher status --json answered the plan.swarm on 9007199254740993`, `dispatcher swarm: ValueError: Exceeds the limit (4300 digits)…`)
```

measured 2026-09-28 by chain chain-swarm-per-plan-20260928-184148-98ae, finding M1, MEDIUM
probe-key: e16078533cfaaada7d84b5b0a038ab0455356b54

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/SwarmControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/constants.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Stepper.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/controls.css, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-plan-swarm.mjs, /home/lyphe/.claude/hooks/dispatcher/cmd/swarm.py, /home/lyphe/.claude/hooks/dispatcher/swarm_word.py, /home/lyphe/.claude/hooks/dispatcher/width.py, /home/lyphe/.claude/hooks/plan_runner/swarm.py

## INV-5697 — probe — After a Rework, the re-cut's fresh Accept prompt comes back silently: no phone push, no lane bell (`DispatcherAskBell`, MAN-7540)

After a Rework, the re-cut's fresh Accept prompt comes back silently: no phone push, no lane bell (`DispatcherAskBell`, MAN-7540)

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/plan-prompt-in-chat/athena-probes/rework_key.sh
expect: `same prompt key: false` (today: `first ask: token 634745e991 asked {'id': 8 …}` / `re-cut ask: token 634745e991 asked {'id': 11 …}` / `same prompt key: true | re-cut prompt suppressed by the phone push memory: true`)
```

measured 2026-09-28 by chain chain-plan-prompt-in-chat-20260928-183429-267d, finding M1, MEDIUM
probe-key: 74af5a4f5ee80876547473078c98d616f0b65148

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-answer.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask-reads.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask.transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-prompts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-raise.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/InteractiveRenderers/QuestionTextField.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/hooks/dispatcher/ask.py, /home/lyphe/.claude/hooks/dispatcher/cmd/ask.py, /home/lyphe/.claude/hooks/dispatcher/owed.py, /home/lyphe/.claude/hooks/dispatcher_stop_planners.py, /home/lyphe/.claude/hooks/dispatcher_stop.py, /home/lyphe/.claude/hooks/intent_lock.py, /home/lyphe/.claude/skills/arc/SKILL.md, /home/lyphe/.claude/skills/plan/SKILL.md

## INV-5698 — probe — Two servers can both record the same landing's ask; the raise service claims the second hears `nothing`

Two servers can both record the same landing's ask; the raise service claims the second hears `nothing`

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/plan-prompt-in-chat/athena-probes/double_ask.sh
expect: `runs recording TWO asks for one landing: 0/10` (today: 9/10)
```

measured 2026-09-28 by chain chain-plan-prompt-in-chat-20260928-183429-267d, finding L1, LOW
probe-key: 26bcadb0c241191691e2917d8fd62a43db0ab6eb

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-answer.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask-reads.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask.transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-prompts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-raise.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/InteractiveRenderers/QuestionTextField.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/hooks/dispatcher/ask.py, /home/lyphe/.claude/hooks/dispatcher/cmd/ask.py, /home/lyphe/.claude/hooks/dispatcher/owed.py, /home/lyphe/.claude/hooks/dispatcher_stop_planners.py, /home/lyphe/.claude/hooks/dispatcher_stop.py, /home/lyphe/.claude/hooks/intent_lock.py, /home/lyphe/.claude/skills/arc/SKILL.md, /home/lyphe/.claude/skills/plan/SKILL.md

## INV-5699 — probe — The Stop hold's stand-down reads the store, not the screen, and `dispatcher ask` runs inside a Claude session

The Stop hold's stand-down reads the store, not the screen, and `dispatcher ask` runs inside a Claude session

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/plan-prompt-in-chat/athena-probes/mute.sh
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

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-claude-swarm.mjs, /home/lyphe/.claude/hooks/dispatcher/width.py, /home/lyphe/.claude/scripts/runner_fixtures/claude_swarm.py, /home/lyphe/.claude/skills/arc/SKILL.md

## INV-5702 — probe — `probe-claude-swarm.mjs` cannot tell a DeepSeek caption from a Claude one, so its "Claude route" precondition proves less than it says

`probe-claude-swarm.mjs` cannot tell a DeepSeek caption from a Claude one, so its "Claude route" precondition proves less than it says

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node -e "const s=require('fs').readFileSync('.verify/probe-claude-swarm.mjs','utf8');const g=new RegExp(/const SWARM_GRAMMAR = \/(.*)\/;/.exec(s)[1]);console.log(g.test('0 of 10 done · 0 rounds · deepseek route, swarm on — all at once'), /\.provider/.test(s))"
expect: false false — the gate rejects a caption that is not a Claude-route posture, or the probe reads route.provider (today: true false)
```

measured 2026-09-28 by chain chain-claude-swarm-20260928-195521-ce60, finding L2, LOW
probe-key: f4758479bffab72a143c3321a70bdb15ecd8af44

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-claude-swarm.mjs, /home/lyphe/.claude/hooks/dispatcher/width.py, /home/lyphe/.claude/scripts/runner_fixtures/claude_swarm.py, /home/lyphe/.claude/skills/arc/SKILL.md

## INV-5709 — probe — Every replay of a spent-out, genuine ntfy token costs a full store read, uncapped, on a public route

Every replay of a spent-out, genuine ntfy token costs a full store read, uncapped, on a public route

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/plan-ask-survives-restart/athena-probes/stale_token_flood.sh
expect: `store reads for 40 taps of ONE stale token:` at most 2 and `one more tap of the same token afterwards, extra store reads: 0` (today: 40 and 1)
```

measured 2026-09-28 by chain chain-plan-ask-survives-restart-20260928-202000-d5a0, finding M1, MEDIUM
probe-key: dbe8f63b937a83ceb33b5a3bb9141a8707744f69

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask-names.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-prompts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/ntfy-action.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/services/ntfy-action-token.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/provider-runtime.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-5710 — probe — `answer()`'s settle chain has no catch, and the server has no `unhandledRejection` handler

`answer()`'s settle chain has no catch, and the server has no `unhandledRejection` handler

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/plan-ask-survives-restart/athena-probes/settle_throw.sh
expect: `still alive after the settle chain threw` and `process exit code 0` (today: `process exit code 1` and the thrown `SqliteError: database is locked` trace)
```

measured 2026-09-28 by chain chain-plan-ask-survives-restart-20260928-202000-d5a0, finding L1, LOW
probe-key: 0a2314ada3ac501357c89a2d38bf3c95d1f8b3ca

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask-names.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-prompts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/ntfy-action.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/services/ntfy-action-token.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/provider-runtime.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-5712 — probe — The durable ask name is unique per record, not per ask over time

The durable ask name is unique per record, not per ask over time

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/plan-ask-survives-restart/athena-probes/id_reuse.sh
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
bash /home/lyphe/.claude/state/pipeline-reviews/accept-once/athena-probes/hold_then_refuse.sh
expect: `hour armed on the Queued plan: None` (today: `2026-09-29T10:00:00Z`, with the second answer's text still reading "This answer recorded nothing")
```

measured 2026-09-28 by chain chain-accept-once-20260928-214132-9473, finding H1, HIGH
probe-key: c6944f8dd646713cca7f890fbc04d9ba0f7f59c5

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
sh /home/lyphe/.claude/state/pipeline-reviews/agent-launch-config--metis/scn/stagger2.sh now resume 40
expect: resume stagger 40 ms -> ["took","refused 409"] and "--resume children actually started: 1"   (measured on this tree: ["took","took"], 2, three runs out of three; HEAD gives ["took","refused 409"], 1)
```

measured 2026-09-28 by chain chain-agent-launch-config--metis-20260928-230031-e11a, finding M1, MEDIUM
probe-key: 8fe0de5199e8f2955f04724593709a8ab908628b

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/kanban-metis.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/metis-env.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/metis-registry.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/metis-spawn.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts

## INV-5743 — probe — a table outage is charged by the driver as a failed launch, and parks the board for ten minutes

a table outage is charged by the driver as a failed launch, and parks the board for ten minutes

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && S=$(mktemp -d /tmp/athena-drv.XXXXXX) && mkdir -p "$S/home" "$S/st" "$S/bin" && printf '#!/bin/sh\necho boom >&2\nexit 1\n' > "$S/bin/launch-table" && chmod +x "$S/bin/launch-table" && cp ~/.claude/charters/launch.toml "$S/table.toml" && env HOME="$S/home" DATABASE_PATH="$S/db.sqlite" KANBAN_METIS_STATE_ROOT="$S/st" LAUNCH_TABLE_PATH="$S/table.toml" LAUNCH_TABLE_BIN="$S/bin/launch-table" TSX_TSCONFIG_PATH=$PWD/server/tsconfig.json node --import tsx /home/lyphe/.claude/state/pipeline-reviews/agent-launch-config--metis/scn/drv.mts 2>&1 | grep "launch failed\|relaunchAllowed"; case "$S" in /tmp/athena-drv.*) rm -r "$S";; esac
expect: `launch failed: Metis's launch table could not be read: … (boom)` and `"relaunchAllowed":false` after one failed tick   (this pins the assumption; it is not a claimed defect)
```

measured 2026-09-28 by chain chain-agent-launch-config--metis-20260928-230031-e11a, finding L1, LOW
probe-key: 7c92631fa3d5838604abd32e8efe3f7b95ac7a0b

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/kanban-metis.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/metis-env.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/metis-registry.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/metis-spawn.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts

## INV-5744 — probe — Two saves in flight: `saving` is one string, so the second overwrites the first's hold and the first to finish releases the other's

Two saves in flight: `saving` is one string, so the second overwrites the first's hold and the first to finish releases the other's

```probe
cd /home/lyphe/.claude/state/pipeline-reviews/agent-launch-config--fill/athena-probes && node s12.mjs
expect: the line `held=-` is printed BEFORE the line `hermes answered` (today ≈2.1 s vs ≈4.7 s); held once means hermes stays `held=hermes` until its own answer
```

measured 2026-09-28 by chain chain-agent-launch-config--fill-20260928-232057-5938, finding M1, MEDIUM
probe-key: b0bc55a3044296cd33bf19125dbaf5d614725005

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/hooks/useAgentLaunch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-5745 — probe — A non-JSON answer reaches the tab as a JSON parser's fragment

A non-JSON answer reaches the tab as a JSON parser's fragment

```probe
cd /home/lyphe/.claude/state/pipeline-reviews/agent-launch-config--fill/athena-probes && node s6b.mjs
expect: the `html-502` and `html-200` lines print an unreadable banner carrying `Unexpected token '<'` (a readable sentence would carry no parser text)
```

measured 2026-09-28 by chain chain-agent-launch-config--fill-20260928-232057-5938, finding L1, LOW
probe-key: ee466fa289d9437e0dc09b553323423be5fc7e3e

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/hooks/useAgentLaunch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-5746 — probe — A 200 whose body is not a census blanks the workspace region

A 200 whose body is not a census blanks the workspace region

```probe
cd /home/lyphe/.claude/state/pipeline-reviews/agent-launch-config--fill/athena-probes && node s6b.mjs
expect: the `json {}` line prints `panel never mounted (region blanked)` (a guarded hook prints `unreadable` with a banner and boundary: 0)
```

measured 2026-09-28 by chain chain-agent-launch-config--fill-20260928-232057-5938, finding L2, LOW
probe-key: 1e8b5d6825644d34103414b36b573ffff92f9789

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/hooks/useAgentLaunch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-5747 — probe — A save that outlives the browser's 30 s deadline says "Not saved" and holds the old picture

A save that outlives the browser's 30 s deadline says "Not saved" and holds the old picture

```probe
cd /home/lyphe/.claude/state/pipeline-reviews/agent-launch-config--fill/athena-probes && node s13.mjs
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
bash /home/lyphe/.claude/state/pipeline-reviews/chat-image-results/athena-probes/history_size.sh
expect: `under 3 MB: true` (HEAD: 2,034,059 bytes; today: 9,866,660 and `false`)
```

measured 2026-09-29 by chain chain-chat-image-results-20260929-064842-edca, finding M1, MEDIUM
probe-key: efe96c67a1a69d1908c92d137ef88f9fc6c07fa7

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/file-tree/file-tree-read-path.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-image-blocks.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-image-results.mjs

## INV-5760 — probe — LOW — the preview offers Edit on an outside text file, and Edit dead-ends

LOW — the preview offers Edit on an outside text file, and Edit dead-ends

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/chat-image-results/athena-probes/outside_text_open.sh
expect: `Edit offered on the outside file: false` (today: `true`, then `editor says: Couldn't open note.txt for editing`)
```

measured 2026-09-29 by chain chain-chat-image-results-20260929-064842-edca, finding L2, LOW
probe-key: 0db12e1711c350bb93039bc41d842ab91eba6643

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/file-tree/file-tree-read-path.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-image-blocks.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-image-results.mjs

## INV-5761 — probe — LOW — every open of an outside file requests a listing the server always refuses; it logs a console error and shows an amber refusal, and the probe's console gate is closed before that step

LOW — every open of an outside file requests a listing the server always refuses; it logs a console error and shows an amber refusal, and the probe's console gate is closed before that step

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/chat-image-results/athena-probes/outside_text_open.sh
expect: `403s []` and `console errors 0` on the "after opening the chip" line (today: `403s ["/list"] | console errors 1 | folder pane refusal shown: true`)
```

measured 2026-09-29 by chain chain-chat-image-results-20260929-064842-edca, finding L3, LOW
probe-key: 88ac5ad1d85b492ebb6eb738b8216f5cfaa1be5a

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/file-tree/file-tree-read-path.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-image-blocks.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-image-results.mjs

## INV-5762 — probe — LOW — a picture is not on the page when the Read sits in a collapsed run, even with Show work on

LOW — a picture is not on the page when the Read sits in a collapsed run, even with Show work on

```probe
node /home/lyphe/.claude/state/pipeline-reviews/chat-image-results/athena-probes/grouped_read_hides.mjs
expect: the "group collapsed" line lists a picture, or the collapsed row signals one (today: `[]`, then two pictures only after the group opens)
```

measured 2026-09-29 by chain chain-chat-image-results-20260929-064842-edca, finding L4, LOW
probe-key: da814a8d85dc3c9abb20dbea7f14619299037dde

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/file-tree/file-tree-read-path.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-image-blocks.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-image-results.mjs

## INV-5763 — probe — LOW — a picture the assistant read is announced as "Attached image"

LOW — a picture the assistant read is announced as "Attached image"

```probe
node /home/lyphe/.claude/state/pipeline-reviews/chat-image-results/athena-probes/grouped_read_hides.mjs
expect: the picture's label names the file, not "Attached image" (today: `["Expand Attached image","Expand Attached image"]`)
```

measured 2026-09-29 by chain chain-chat-image-results-20260929-064842-edca, finding L5, LOW
probe-key: 05948b28491557b1487b7e35ce4e17ced0c6e8dc

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/file-tree/file-tree-read-path.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-image-blocks.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-image-results.mjs

## INV-5764 — probe — LOW — `.verify/chat-image-results.mjs` cannot fail

LOW — `.verify/chat-image-results.mjs` cannot fail

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/chat-image-results/athena-probes/probe_exit_code.sh
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
cd /home/lyphe/.claude/state/pipeline-reviews/diagram-lightbox && node athena-zindex.mjs
expect: {"dialogMounted":true,"dialogZ":"100","hostZ":"200","topmostAtCentre":"PRD-EDITOR","topmostAtCorner":"PRD-EDITOR","topmostAtCloseBtn":"PRD-EDITOR"} then "after Esc: dialog still mounted = false"
```

measured 2026-09-29 by chain chain-diagram-lightbox-20260929-082654-343c, finding H1, HIGH
probe-key: 56d8db3d3e17f9a037b459e7628a1c517a7fd1df

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/ChatMessageImages.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/markdown-preview/MermaidDiagram.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Lightbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/useZoomPan.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lightbox-zoom.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/pwa-notch-close-controls.mjs

## INV-5770 — probe — the id rename breaks mermaid's end-anchored id selectors, so the viewer's copy loses paint on some markers

the id rename breaks mermaid's end-anchored id selectors, so the viewer's copy loses paint on some markers

```probe
cd /home/lyphe/.claude/state/pipeline-reviews/diagram-lightbox && A_THEME=dark node athena-stick.mjs
expect: INLINE lists "-crosshead path fill=rgb(211, 211, 211) stroke=rgb(211, 211, 211)"; VIEWER lists "-crosshead-viewer path fill=none stroke=rgb(0, 0, 0)"
```

measured 2026-09-29 by chain chain-diagram-lightbox-20260929-082654-343c, finding M1, MEDIUM
probe-key: abacbeb4650072034f187b2620a4c7fcf6ccc6c0

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/ChatMessageImages.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/markdown-preview/MermaidDiagram.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Lightbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/useZoomPan.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lightbox-zoom.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/pwa-notch-close-controls.mjs

## INV-5771 — probe — a resize or a phone rotation while zoomed leaves the content outside its pan clamp

a resize or a phone rotation while zoomed leaves the content outside its pan clamp

```probe
cd /home/lyphe/.claude/state/pipeline-reviews/diagram-lightbox && node athena-interact.mjs
expect: the "(d)" line ends with a content box whose "top":190 (a band above it) and "bottom":2397 against "dialog [ 700, 500 ]"
```

measured 2026-09-29 by chain chain-diagram-lightbox-20260929-082654-343c, finding L1, LOW
probe-key: 331b383baa6c2f643fd1ff510bd98adc39bb5f8c

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/ChatMessageImages.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/markdown-preview/MermaidDiagram.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Lightbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/useZoomPan.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lightbox-zoom.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/pwa-notch-close-controls.mjs

## INV-5772 — probe — pressing a toolbar button and sliding off it onto the backdrop closes the viewer

pressing a toolbar button and sliding off it onto the backdrop closes the viewer

```probe
cd /home/lyphe/.claude/state/pipeline-reviews/diagram-lightbox && node athena-interact.mjs
expect: (c) press on "+" then release over the backdrop: viewer open = false
```

measured 2026-09-29 by chain chain-diagram-lightbox-20260929-082654-343c, finding L2, LOW
probe-key: 760b030a6ce3e247ae92d2aa278a2ac433b50b68

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/ChatMessageImages.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/markdown-preview/MermaidDiagram.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Lightbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/useZoomPan.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lightbox-zoom.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/pwa-notch-close-controls.mjs

## INV-5773 — probe — one Ctrl+mouse-wheel notch zooms 2.7×

one Ctrl+mouse-wheel notch zooms 2.7×

```probe
cd /home/lyphe/.claude/state/pipeline-reviews/diagram-lightbox && node athena-interact.mjs
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
cd /home/lyphe/.claude/state/pipeline-reviews/diagram-lightbox && node athena-focus.mjs
expect: after Enter opens the viewer, focus: {"insideDialog":false,"active":"DIV[role=button][aria-label=Open diagram full screen]"}
```

measured 2026-09-29 by chain chain-diagram-lightbox-20260929-082654-343c, finding L6, LOW
probe-key: f4e0aaa849312734dbaddfb2db3bfb22e1190cba

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/ChatMessageImages.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/markdown-preview/MermaidDiagram.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Lightbox.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/useZoomPan.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lightbox-zoom.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/pwa-notch-close-controls.mjs

## INV-5777 — probe — the plugin tab's "Install from git" button is cut off at the operator's own width, and the probe cannot see it

the plugin tab's "Install from git" button is cut off at the operator's own width, and the probe cannot see it

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && A_WIDTHS=341 A_SCALES=1.072 node /home/lyphe/.claude/state/pipeline-reviews/settings-mobile-round2/athena-r2-cards.mjs | grep '^Plugins'
expect: the line ends installForm:{"form":"17-324","input":"238w","btn":"288-368(79w)","cut":44,"label":"Install"} — cut > 0; healed when cut is -1 at 320, 341 and 360 × 1, 1.072, 1.2
```

measured 2026-09-29 by chain chain-settings-mobile-round2-20260929-081949-f36c, finding M1, MEDIUM
probe-key: 9714e0560e36c947e4222c26a9917408463ef863

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/plugins/PluginSettingsTab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/SettingRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/settings-rows-measure.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/settings-rows-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-settings-rows.mjs

## INV-5778 — probe — the uninstall-confirm banner clips its Remove button on phones

the uninstall-confirm banner clips its Remove button on phones

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node /home/lyphe/.claude/state/pipeline-reviews/settings-mobile-round2/athena-r2-banner.mjs | grep -E '^w=(320|341) x1\.(072|2):'
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
cd /home/lyphe/.claude/claudecodeui_lyphe && T=$(mktemp -d) && sed -e "s#'../src/#'$PWD/src/#" -e "s#^async function openTab(page, viewport) {#&\n  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '[data-card-description]{white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important}'; document.head.appendChild(s); }));#" .verify/probe-card-description.mjs > $T/p.mjs && npx tsx $T/p.mjs --tag ellipsis | grep -E "lead opens whole|reading\(s\) failed" | sed -E 's/^(PASS|FAIL) tab [0-9]+ (light|dark)/\1 tab/' | sort | uniq -c; echo "exit ${PIPESTATUS[0]}"
expect: exit 1 and a FAIL on the judged card's "opens whole" line, its lead painted on 1 line with its scrollWidth past its clientWidth (2026-10-02: 4× that FAIL, "4 reading(s) failed", exit 1)
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
node /home/lyphe/.claude/state/pipeline-reviews/card-description-full/athena-probes/fold.mjs | grep -E "^390"
expect: either the fold's rationale no longer says "at a glance", or every folded loose card at 390 reads under ~250px (today: folded 151 / 470 / 206 / 338, arc 539)
```

measured 2026-09-29 by chain chain-card-description-full-20260929-105755-1234, finding L2, LOW
probe-key: f77ce2f9cabcc4086a663f85bfa98a8bea965f0f

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcDeck.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/LaneCardHead.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-description.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dispatch-arc-word.mjs

## INV-5796 — probe — three lines still describe the old prompt shape

three lines still describe the old prompt shape

```probe
cd ~/.claude/claudecodeui_lyphe && grep -c "census word for word" server/shared/types.ts; grep -c "single newlines only" src/modules/chat/tools/ContentRenderers/QuestionText.tsx
expect: 1 and 1 — both still describe the old shape (0 once healed)
```

measured 2026-09-29 by chain chain-lock-prompt-glance-20260929-110148-17f8, finding L2, LOW
probe-key: a2e8cb06d0adeaa9543eea5c39d72cc3ce71ed19

governs: /home/lyphe/.claude/hooks/dispatcher/lock_glance.py, /home/lyphe/.claude/hooks/dispatcher/lock.py, /home/lyphe/.claude/skills/plan/SKILL.md

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

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-ask.mjs, /home/lyphe/.claude/hooks/dispatcher/lock_glance.py, /home/lyphe/.claude/hooks/dispatcher/lock.py, /home/lyphe/.claude/skills/plan/SKILL.md

## INV-5885 — probe — the showing left its scratch id in the operator's icon cache

the showing left its scratch id in the operator's icon cache

```probe
grep -c registry-project-check /home/lyphe/.claude/claudecodeui_lyphe/apps.icons.local.json
expect: 0 once the cache has pruned it; 1 while the showing's residue is still there (measured 1 at ~00:40Z)
```

measured 2026-09-29 by chain chain-app-drawer-chat--registry-project-20260929-165635-4197, finding L1, LOW
probe-key: 4b19fc6a219588baed3b8fe2cb269bedbf8cc72e

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/app-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/app-types.ts

## INV-5887 — probe — `useHostMove` calls the listener from the render BEFORE the one that committed the move

`useHostMove` calls the listener from the render BEFORE the one that committed the move

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node /home/lyphe/.claude/state/pipeline-reviews/app-drawer-chat--host-window/athena-probe-s6.mjs
expect: `listener closure heard (n after the change is 1): [0]` while the defect stands; `[1]` once the ref is written in a layout effect ahead of the subscription
```

measured 2026-09-29 by chain chain-app-drawer-chat--host-window-20260929-165634-a050, finding M1, MEDIUM
probe-key: 38e830cbd0bf67fdf0635c47446420fbf936f47e

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/context/HostWindowContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/overlayEscape.ts

## INV-5888 — probe — the header docblock contradicts itself and the settled design

the header docblock contradicts itself and the settled design

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -nE "mount no provider|only writer|ChatHostSlot" src/shared/context/HostWindowContext.tsx | cut -c1-140
expect: a `mount no provider` line (line 14), an `only writer` line (line 18) and the `ChatHostSlot ... around the live chat's portal` line (line 23) together, while the defect stands
```

measured 2026-09-29 by chain chain-app-drawer-chat--host-window-20260929-165634-a050, finding L1, LOW
probe-key: 26c84f69dfdb02bc42ab9d973c7c18e116143729

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/context/HostWindowContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/overlayEscape.ts

## INV-5889 — the newest conversation has one spelling — src/shared/sessionRecency.ts

Which timestamp dates a session and the order a project's sessions list in are defined only in `src/shared/sessionRecency.ts`: `getCreatedTimestamp`, `getUpdatedTimestamp`, `getSessionDate`, `getSessionProvider`, `getAllSessions`. `getAllSessions(project)[0]` is "the newest conversation". Never re-derive the date, the provider default or the sort in a second file.

why: the sidebar's top row and the conversation `openProjectChat` opens must be the same session; a second copy drifts.

how it holds:
- Readers import from `@/shared/sessionRecency`: `SidebarContent.tsx`, `useSidebarController.ts` (`getAllSessions`), `sidebarProjectFormatting.ts` (`getCreatedTimestamp`, `getUpdatedTimestamp`, `getSessionDate`), `useProjectsState.ts` (`getSessionProvider`), `useOpenProjectChat.ts` (`getAllSessions`).
- `sortedSessionsByProject` is a module-private `WeakMap` keyed on the project object; `useProjectsState` replaces a project, never mutates it, so a stale entry is unreachable.
- The cache is what keeps the sidebar's memo boundary: `getAllSessions` must return the same array reference for the same project object.

```probe
grep -rn "export const getAllSessions" src
expect: exactly one line, src/shared/sessionRecency.ts
```

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useOpenProjectChat.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useProjectsState.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSidebarController.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/utils/sidebarProjectFormatting.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/sessionRecency.ts

## INV-5890 — a new top-level src/shared/*.ts file must join .oxlintrc.json's frontend-shared-file list

`boundaries/include` covers every `src/shared/*.ts`, but only the files named in the `frontend-shared-file` element's `pattern` array are known elements. A file in `src/shared/` outside that array is an unknown element; every importer errors `boundaries(no-unknown)`.

- symptom: `npx oxlint src/` reports `error boundaries(no-unknown): Dependencies to unknown elements are not allowed` on the import line of each importer, not on the new file.
- fix: add the file's path to the `frontend-shared-file` `pattern` array in `.oxlintrc.json` in the same change that creates it.
- `src/shared/hooks`, `src/shared/context` and `src/shared/ui` are `frontend-shared-folder` entries: files there need no listing.
- measured 2026-09-29: `src/shared/sessionRecency.ts` removed from a scratch copy of the config → errors on its three importers; `src/shared/authTrace` unlisted → errors at `src/shared/authToken.ts:10` and `src/modules/auth/context/AuthContext.tsx:7`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json

## INV-5891 — probe — In simple-list mode (the operator's own setting) `openProjectChat(B, 'new')` answers `true` and the workspace ends on the saved project, not B

In simple-list mode (the operator's own setting) `openProjectChat(B, 'new')` answers `true` and the workspace ends on the saved project, not B

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node /home/lyphe/.claude/state/pipeline-reviews/app-drawer-chat--projects-door/probe-door-simple-list.mjs simple
expect: `new in ArchPulse: answered true; project .claude → .claude; url /; trigger 0→1` and `latest in keepalive-proof (no conversation): … project .claude → .claude` (a door that held reads `→ ArchPulse` and `→ keepalive-proof`, which is what `… tree` prints). Needs the verve account to list `.claude`, `ArchPulse` and one project with no sessions.
```

measured 2026-09-29 by chain chain-app-drawer-chat--projects-door-20260929-171607-249f, finding M1, MEDIUM
probe-key: e58ba3ce7986fa70dd0c73b2c22e54aaf33ebec4

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/context/ProjectsStateContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useOpenProjectChat.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useProjectsState.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSidebarController.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/utils/sidebarProjectFormatting.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/sessionRecency.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-5892 — probe — `ProjectChatContext` has no why-comment above its declaration

`ProjectChatContext` has no why-comment above its declaration

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n -B1 "const ProjectChatContext = createContext" src/modules/project-workspace/context/ProjectsStateContext.tsx
expect: the line above is `const ProjectActiveSessionContext = createContext…`, not a comment
```

measured 2026-09-29 by chain chain-app-drawer-chat--projects-door-20260929-171607-249f, finding L1, LOW
probe-key: c5e4f8710c1c0b5195fc0fd14f4bd392283f37e3

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/context/ProjectsStateContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useOpenProjectChat.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useProjectsState.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSidebarController.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/utils/sidebarProjectFormatting.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/sessionRecency.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-5902 — probe — When the registry loses the row of the left slot, the layer draws the right application under `data-pane-side="left"`, and every act over it is greyed

When the registry loses the row of the left slot, the layer draws the right application under `data-pane-side="left"`, and every act over it is greyed

```probe
node /home/lyphe/.claude/state/pipeline-reviews/app-drawer-chat--switcher-acts/athena-probes/s10b.mjs
expect: the "after delete" line reads front left, cur null, disabled [false,false,true,true,true] while the layer still draws EIS App; the run ends "registry BASELINE RESTORED"
```

measured 2026-09-29 by chain chain-app-drawer-chat--switcher-acts-20260929-172332-8408, finding M2, MEDIUM
probe-key: c6f09bfc38b11189d453e9f377cd16d3e1ebb412

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/hooks/useCurrentApplication.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/hooks/useFrontPane.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/hooks/useSwitcherActions.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/utils/paneSlots.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/utils/radialLayout.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/constants.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts

## INV-5903 — probe — `radialLayout(fab, viewport, 0)` returns one centre

`radialLayout(fab, viewport, 0)` returns one centre

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && npx tsx -e "import { radialLayout as r } from './src/modules/app-switcher/utils/radialLayout.ts'; console.log(r({left:300,top:400,width:28,height:28},{width:1440,height:900},0).length)"
expect: 1 — asked for zero items, got one centre (held value: 0)
```

measured 2026-09-29 by chain chain-app-drawer-chat--switcher-acts-20260929-172332-8408, finding L1, LOW
probe-key: 29c50f047fb867b34b031760dabf9ce23c689cb8

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/hooks/useCurrentApplication.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/hooks/useFrontPane.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/hooks/useSwitcherActions.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/utils/paneSlots.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/utils/radialLayout.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/constants.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts

## INV-5914 — probe — `stop()` leaves its clones behind, so a second mirror into the same document doubles every sheet, and the orphaned first set wins the cascade

`stop()` leaves its clones behind, so a second mirror into the same document doubles every sheet, and the orphaned first set wins the cascade

```probe
node --input-type=module -e 'import pw from "/opt/shadow-connector/node_modules/playwright/index.js"; const b=await pw.chromium.launch(); const p=await b.newPage(); await p.goto("http://localhost:5183/",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(1500); console.log(JSON.stringify(await p.evaluate(async()=>{ const {mirrorDocument}=await import("/src/modules/chat-host/utils/mirrorDocument.ts"); const t=()=>new Promise(r=>setTimeout(r,0)); const f=document.createElement("iframe"); f.srcdoc="<!doctype html><html><head></head><body></body></html>"; document.body.append(f); await new Promise(r=>f.addEventListener("load",r,{once:true})); const hm=document.createElement("style"); hm.textContent=".zz{color:rgb(255,0,0)}"; document.head.append(hm); const a=mirrorDocument(document,f.contentDocument); a.stop(); const c=mirrorDocument(document,f.contentDocument); await c.ready; await t(); const el=f.contentDocument.createElement("div"); el.className="zz"; f.contentDocument.body.append(el); hm.textContent=".zz{color:rgb(0,0,255)}"; await t(); return {srcSheets:document.styleSheets.length,frameSheets:f.contentDocument.styleSheets.length,colorAfterRewriteToBlue:f.contentWindow.getComputedStyle(el).color}; }))); process.exit(0)'
expect: frameSheets is exactly 2x srcSheets (e.g. 24 vs 12) and colorAfterRewriteToBlue is "rgb(255, 0, 0)"; after the fix frameSheets equals srcSheets and the colour is "rgb(0, 0, 255)"
```

measured 2026-09-29 by chain chain-app-drawer-chat--host-geometry-20260929-175650-f840, finding M1, MEDIUM
probe-key: d244b288196319e12051131d0d289c7f2738f3bf

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/chatHostStorage.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/mirrorDocument.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/panelGeometry.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/placeNode.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-host-pure-parts.mjs

## INV-5915 — probe — `ready` after `stop()` is undocumented and inconsistent: it may resolve later, or never

`ready` after `stop()` is undocumented and inconsistent: it may resolve later, or never

```probe
node --input-type=module -e 'import pw from "/opt/shadow-connector/node_modules/playwright/index.js"; const b=await pw.chromium.launch(); const p=await (await b.newContext({serviceWorkers:"block"})).newPage(); await p.route(/athena-hang\.css/,()=>{}); await p.route(/athena-slow\.css/,async r=>{await new Promise(x=>setTimeout(x,2500)); r.fulfill({status:200,contentType:"text/css",body:"a{}"}).catch(()=>{});}); await p.goto("http://localhost:5183/",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(1500); console.log(JSON.stringify(await p.evaluate(async()=>{ const {mirrorDocument}=await import("/src/modules/chat-host/utils/mirrorDocument.ts"); const mk=async()=>{const f=document.createElement("iframe"); f.srcdoc="<!doctype html><html><head></head><body></body></html>"; document.body.append(f); await new Promise(r=>f.addEventListener("load",r,{once:true})); return f;}; const race=async(pr,ms)=>{const t0=performance.now(); const r=await Promise.race([pr.then(()=>"settled"),new Promise(x=>setTimeout(()=>x("pending"),ms))]); return [r,Math.round(performance.now()-t0)];}; const one=async(href)=>{const s=await mk(); const l=s.contentDocument.createElement("link"); l.rel="stylesheet"; l.href=href; s.contentDocument.head.append(l); const t=await mk(); const m=mirrorDocument(s.contentDocument,t.contentDocument); m.stop(); return race(m.ready,6000);}; return {stopBeforeReady_linkNeverLoads:await one("/athena-hang.css"),stopBeforeReady_linkLoadsAt2500ms:await one("/athena-slow.css")}; }))); process.exit(0)'
expect: {"stopBeforeReady_linkNeverLoads":["pending",6000],"stopBeforeReady_linkLoadsAt2500ms":["settled",~2500]} — two different outcomes for the same call sequence
```

measured 2026-09-29 by chain chain-app-drawer-chat--host-geometry-20260929-175650-f840, finding L1, LOW
probe-key: a78fd6925c365f37bce0cd878a9fb4ed114cf2f5

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/chatHostStorage.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/mirrorDocument.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/panelGeometry.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/placeNode.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-host-pure-parts.mjs

## INV-5916 — probe — the mirror rewrites the target `<body>`'s `style` and `class` wholesale, so anything else written there is dropped on the next unrelated opener change

the mirror rewrites the target `<body>`'s `style` and `class` wholesale, so anything else written there is dropped on the next unrelated opener change

```probe
node --input-type=module -e 'import pw from "/opt/shadow-connector/node_modules/playwright/index.js"; const b=await pw.chromium.launch(); const p=await b.newPage(); await p.goto("http://localhost:5183/",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(1500); console.log(JSON.stringify(await p.evaluate(async()=>{ const {mirrorDocument}=await import("/src/modules/chat-host/utils/mirrorDocument.ts"); const t=()=>new Promise(r=>setTimeout(r,0)); const f=document.createElement("iframe"); f.srcdoc="<!doctype html><html><head></head><body></body></html>"; document.body.append(f); await new Promise(r=>f.addEventListener("load",r,{once:true})); const m=mirrorDocument(document,f.contentDocument); await m.ready; const tb=f.contentDocument.body; tb.style.overflow="hidden"; const before=tb.style.overflow; document.documentElement.style.setProperty("--keyboard-height","1px"); await t(); const r={targetBodyOverflowBefore:before,targetBodyOverflowAfterUnrelatedOpenerChange:tb.style.overflow}; document.documentElement.style.removeProperty("--keyboard-height"); m.stop(); return r; }))); process.exit(0)'
expect: {"targetBodyOverflowBefore":"hidden","targetBodyOverflowAfterUnrelatedOpenerChange":""}
```

measured 2026-09-29 by chain chain-app-drawer-chat--host-geometry-20260929-175650-f840, finding L2, LOW
probe-key: ebf3e85df2a52c05a9b8ac433f8fba9c17b062ba

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/chatHostStorage.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/mirrorDocument.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/panelGeometry.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/placeNode.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-host-pure-parts.mjs

## INV-5917 — probe — a NaN in any input passes straight through the geometry

a NaN in any input passes straight through the geometry

```probe
npx tsx -e "import('./src/modules/chat-host/utils/panelGeometry.ts').then(m=>console.log(JSON.stringify(m.panelPlacement({left:10,top:10,width:28,height:28},{width:420,height:640},{width:1440,height:NaN})), JSON.stringify(m.clampPanelSize({width:NaN,height:NaN},{width:1440,height:900}))))"
expect: {"left":50,"top":null,"width":420,"height":null,"grip":"top-right"} {"width":null,"height":null}  (nulls are NaN)
```

measured 2026-09-29 by chain chain-app-drawer-chat--host-geometry-20260929-175650-f840, finding L3, LOW
probe-key: 1befb393421df243160762e9a6be4eef092aa596

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/chatHostStorage.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/mirrorDocument.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/panelGeometry.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/placeNode.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-host-pure-parts.mjs

## INV-5918 — probe — a mouse press held on a node in the edge fade is lost (desktop, gutter)

a mouse press held on a node in the edge fade is lost (desktop, gutter)

```probe
node /home/lyphe/.claude/state/pipeline-reviews/flow-scroll/athena-press-edge.mjs
expect: PRESS-OK on both edges (today: PRESS-LOST leading n7 [] and PRESS-LOST trailing n18 [], exit 1)
```

measured 2026-09-29 by chain chain-flow-scroll-20260929-170014-ed7d, finding M1, MEDIUM
probe-key: f961cec6b22f651e36fe44ee2a19032be8e9f9c1

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useFlowTrack.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/StatusFlow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-status-flow-scroll.mjs

## INV-5919 — probe — on WebKit the track's end padding is not scrollable overflow: the last node sits flush and its ring is cut

on WebKit the track's end padding is not scrollable overflow: the last node sits flush and its ring is cut

```probe
node /home/lyphe/.claude/state/pipeline-reviews/flow-scroll/athena-webkit-end.mjs
expect: roomRight px {"webkit":10,"chromium":10} (today: {"webkit":0,"chromium":10}, exit 1)
```

measured 2026-09-29 by chain chain-flow-scroll-20260929-170014-ed7d, finding M2, MEDIUM
probe-key: 6a42b9093c77d000fb32191a3dfd2db1dfb5e172

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useFlowTrack.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/StatusFlow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-status-flow-scroll.mjs

## INV-5920 — probe — Tab into an overflowing flow throws the track back to phase 1

Tab into an overflowing flow throws the track back to phase 1

```probe
node /home/lyphe/.claude/state/pipeline-reviews/flow-scroll/athena-tab-jump.mjs
expect: the current phase stays in view after the Tab (today: opened {"scrollLeft":246,"liveInView":true} → after Tab {"scrollLeft":0,"liveInView":false,"focus":"n1"}, exit 1)
```

measured 2026-09-29 by chain chain-flow-scroll-20260929-170014-ed7d, finding L1, LOW
probe-key: 31cdb372e94bb03ea86f20eada09414242717ee4

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useFlowTrack.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/StatusFlow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-status-flow-scroll.mjs

## INV-5921 — probe — `taken` is set by touches and wheels that never scroll the track, and outlives the element

`taken` is set by touches and wheels that never scroll the track, and outlives the element

```probe
node /home/lyphe/.claude/state/pipeline-reviews/flow-scroll/athena-wheel-taken.mjs
expect: the landed phase is in view (today: {"scrollLeft":0,"landedInView":false}, exit 1)
```

measured 2026-09-29 by chain chain-flow-scroll-20260929-170014-ed7d, finding L2, LOW
probe-key: 9dda15a292bd778d5d976e2f61818e84f22dc48d

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useFlowTrack.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/StatusFlow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-status-flow-scroll.mjs

## INV-5931 — probe — (MED) — a corrupt-payload token now locks the person out instead of signing them out

(MED) — a corrupt-payload token now locks the person out instead of signing them out

```probe
curl -s -o /dev/null -D - -H "Authorization: Bearer $(node -e "const b=s=>Buffer.from(s).toString('base64url');process.stdout.write(b('{\"alg\":\"HS256\",\"typ\":\"JWT\"}')+'.'+b('{\"userId\":1')+'.'+b('sig'))")" http://127.0.0.1:3011/api/auth/user | grep -iE '^HTTP|x-auth-error'
expect: HTTP/1.1 401 and X-Auth-Error: invalid-token (measured: HTTP/1.1 503 and no X-Auth-Error)
```

measured 2026-09-29 by chain chain-signed-out-20260929-173238-19f4, finding M1, MEDIUM
probe-key: 9626bd3fb37ee2275512044ba5c86cae05737eb4

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/auth/auth.middleware.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/auth/context/AuthContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/auth/hooks/useSharedSessionFollower.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/file-tree/hooks/useFileTreeUpload.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/authToken.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/signout-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-signed-out.mjs

## INV-5932 — probe — (MED) — a sign-out caused by emptied storage leaves no client trace

(MED) — a sign-out caused by emptied storage leaves no client trace

```probe
node /home/lyphe/.claude/state/pipeline-reviews/signed-out/athena-probes/storage-wiped-no-trace.mjs
expect: page trace records: 1 or more, naming why the session ended (measured: 0)
```

measured 2026-09-29 by chain chain-signed-out-20260929-173238-19f4, finding M2, MEDIUM
probe-key: 311bc0c067d615548137dc72e0fde468dc5582e2

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/auth/auth.middleware.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/auth/context/AuthContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/auth/hooks/useSharedSessionFollower.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/file-tree/hooks/useFileTreeUpload.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/authToken.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/signout-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-signed-out.mjs

## INV-5933 — probe — (LOW) — the 503 journal line quotes a piece of the token's payload

(LOW) — the 503 journal line quotes a piece of the token's payload

```probe
curl -s -o /dev/null -H "Authorization: Bearer $(node -e "const b=s=>Buffer.from(s).toString('base64url');process.stdout.write(b('{\"alg\":\"HS256\",\"typ\":\"JWT\"}')+'.'+b('not json at all SECRETFRAGMENT')+'.'+b('sig'))")" http://127.0.0.1:3011/api/auth/user; sleep 1; journalctl -u cloudcli-server-dev.service --since "-1 min" --no-pager -o cat | grep -c 'not json at'
expect: 0 (measured: 1 — the line carries the payload's first characters)
```

measured 2026-09-29 by chain chain-signed-out-20260929-173238-19f4, finding L1, LOW
probe-key: f96bc8598c3ed06e28e0fec441e921263e6412ce

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/auth/auth.middleware.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/auth/context/AuthContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/auth/hooks/useSharedSessionFollower.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/file-tree/hooks/useFileTreeUpload.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/authToken.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/signout-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-signed-out.mjs

## INV-5934 — probe — (LOW) — the proof command dies at import about one run in ten

(LOW) — the proof command dies at import about one run in ten

```probe
for i in $(seq 1 40); do sqlite3 "$HOME/.cloudcli/auth.db" "select value from app_config where key='jwt_secret'" >/dev/null 2>&1 || echo locked; done | wc -l
expect: 0 (measured: 4 of 40 locked). A busy timeout on that read (`sqlite3 -cmd ".timeout 5000" …`) is what the kit needs.
```

measured 2026-09-29 by chain chain-signed-out-20260929-173238-19f4, finding L2, LOW
probe-key: 743354f5b56df8b0a788ffa36d59e63e9fd8b80e

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/auth/auth.middleware.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/auth/context/AuthContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/auth/hooks/useSharedSessionFollower.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/file-tree/hooks/useFileTreeUpload.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/authToken.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/signout-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-signed-out.mjs

## INV-5935 — probe — . `host-window-home.mjs`: the useDeviceSettings row cannot fail

. `host-window-home.mjs`: the useDeviceSettings row cannot fail

```probe
/home/lyphe/.claude/state/pipeline-reviews/app-drawer-chat--seam-kit/mutants/run-mutant.sh host-window-home '[{"glob":"**/src/shared/hooks/useDeviceSettings.ts*","from":"hostWindow.innerWidth < mobileBreakpoint","to":"false"}]' | tail -1
expect: ALL PASS (with useDeviceSettings forced to "wide" at 390px; a discriminating row prints a FAIL)
```

measured 2026-09-29 by chain chain-app-drawer-chat--seam-kit-20260929-183302-c8d1, finding M1, MEDIUM
probe-key: 98c1cc42df5145720d91e3b31dd510aff5469a3b

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/host-window-home.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/host-window-kit.mjs

## INV-5936 — probe — . `host-window-kit.mjs`: reverting four of its subjects leaves it on ALL PASS

. `host-window-kit.mjs`: reverting four of its subjects leaves it on ALL PASS

```probe
/home/lyphe/.claude/state/pipeline-reviews/app-drawer-chat--seam-kit/mutants/run-mutant.sh host-window-kit '[{"glob":"**/src/shared/ui/Dialog.tsx*","from":"hostWindow.requestAnimationFrame(","to":"requestAnimationFrame("},{"glob":"**/src/shared/ui/Dialog.tsx*","from":"hostWindow.cancelAnimationFrame(","to":"cancelAnimationFrame("},{"glob":"**/src/shared/ui/Tooltip.tsx*","from":"isNodeLike(target) && ","to":"(target instanceof Node) && "},{"glob":"**/src/shared/ui/useZoomPan.ts*","from":"resizeObserverIn(hostWindow, ","to":"((cb) => new ResizeObserver(cb))("}]' | tail -1
expect: ALL PASS (with the Dialog frame back on the global window, Tooltip's isNodeLike reverted to instanceof, and useZoomPan's observer built by the opener's constructor)
```

measured 2026-09-29 by chain chain-app-drawer-chat--seam-kit-20260929-183302-c8d1, finding M2, MEDIUM
probe-key: 4a7f025d87c8f4d794b09113c7f4a5aaddedba01

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/host-window-home.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/host-window-kit.mjs

## INV-5937 — probe — . `useZoomPan`: a press held across a move poisons the next click

. `useZoomPan`: a press held across a move poisons the next click

```probe
cd /home/lyphe/.claude/state/pipeline-reviews/app-drawer-chat--seam-kit/athena-scaffold && node lightbox.mjs 2>&1 | grep '^VIOLATED L9'
expect: a line reading VIOLATED L9 (adversarial) … {"stillThere":true}  (fixed: HELD L9 … {"stillThere":false})
```

measured 2026-09-29 by chain chain-app-drawer-chat--seam-kit-20260929-183302-c8d1, finding L3, LOW
probe-key: f8df98b1c8786e0e6655fa9ebfafeaa4fc4c2d14

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/host-window-home.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/host-window-kit.mjs

## INV-5952 — probe — . Standing proof G5 no longer notices a ChatInterface remount at the gutter threshold (outside the 7 target paths)

. Standing proof G5 no longer notices a ChatInterface remount at the gutter threshold (outside the 7 target paths)

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe/.verify && node --input-type=module -e "import { openConsole } from './lib/console.mjs'; import { createScratchChat, deleteScratchChat } from './lib/scratch-chat.mjs'; const s = await openConsole({ viewport: { width: 1440, height: 900 } }); const id = await createScratchChat(s); await s.page.goto(s.appUrl + '/session/' + id, { waitUntil: 'networkidle' }); await s.page.waitForSelector('textarea'); console.log(await s.page.evaluate(() => document.querySelector('[data-testid=chat-gutter-chat]').firstElementChild.hasAttribute('data-chat-host-home'))); await deleteScratchChat(s, id); await s.browser.close();"
expect: true (the tagged element is the home div, not ChatInterface); G5 passes with the tag on it whatever ChatInterface does
```

measured 2026-09-29 by chain chain-app-drawer-chat--chat-host-home-20260929-195616-ce23, finding L3, LOW
probe-key: ab1111a059fa88306050146402440fdd26080bf5

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/ChatHostSlot.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/context/ChatHostContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/ProjectWorkspaceShell.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/WorkspaceFrame.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-host-home.mjs

## INV-5953 — probe — . `chat-host-home.mjs` `before` overwrites the irreplaceable pre-change record unguarded

. `chat-host-home.mjs` `before` overwrites the irreplaceable pre-change record unguarded

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && awk '/MODE === .before.\) continue/{c=NR} /data-chat-host-node/{if(!f)f=NR} END{print c, f}' .verify/chat-host-home.mjs; grep -n "writeFileSync(RECORD" .verify/chat-host-home.mjs
expect: "101 108" (no node check before the continue) and one unguarded `writeFileSync(RECORD` at line 141
```

measured 2026-09-29 by chain chain-app-drawer-chat--chat-host-home-20260929-195616-ce23, finding L4, LOW
probe-key: d34f39a67bd3d3b14c18be4e72e9e4c16b52515b

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/ChatHostSlot.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/context/ChatHostContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/ProjectWorkspaceShell.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/WorkspaceFrame.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-host-home.mjs

## INV-5954 — probe — Two of `CommandMenu`'s three viewport reads survive a mutant in the window probe (a 420-px window cannot reach line 117)

Two of `CommandMenu`'s three viewport reads survive a mutant in the window probe (a 420-px window cannot reach line 117)

```probe
cd /home/lyphe/.claude/state/pipeline-reviews/app-drawer-chat--seam-chat-surfaces/athena-probes && MUT='[{"glob":"**/src/modules/chat/composer/CommandMenu.tsx*","from":"hostWindow.innerWidth - 440","to":"innerWidth - 440"}]' node --import ./preload.mjs /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-surfaces-window.mjs | grep -E "FAIL|all checks"
expect: a "[FAIL] the command menu is placed against the window's width" line; today "all checks passed" (the same mutant against `node wide.mjs` — the probe with a 700-px window — prints that FAIL with "right":740)
```

measured 2026-09-29 by chain chain-app-drawer-chat--seam-chat-surfaces-20260929-193540-fce5, finding L1, LOW
probe-key: 95e3498d7f6051f22800fe42cb35dc9607a8140b

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/widgets/hooks/useWidgetHost.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-surfaces-home.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-surfaces-window.mjs

## INV-5955 — probe — `useWidgetHost.ts:113-115` says the theme tokens are read from the window's document; the code reads the opener's — and the window probe cannot see the difference

`useWidgetHost.ts:113-115` says the theme tokens are read from the window's document; the code reads the opener's — and the window probe cannot see the difference

```probe
sed -n 113,116p /home/lyphe/.claude/claudecodeui_lyphe/src/modules/widgets/hooks/useWidgetHost.ts
expect: no sentence saying the tokens are read from the window's document (they are read from the opener's, line 176); today line 115 ends "are read from its document."
```

measured 2026-09-29 by chain chain-app-drawer-chat--seam-chat-surfaces-20260929-193540-fce5, finding L2, LOW
probe-key: e1d729832beb76a9bf65f3fa9b1d437f5c11af3c

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/widgets/hooks/useWidgetHost.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-surfaces-home.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-surfaces-window.mjs

## INV-6002 — probe — The updated proof script cannot fail for the regression it names, and nothing in it guards H1

The updated proof script cannot fail for the regression it names, and nothing in it guards H1

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node /home/lyphe/.claude/state/pipeline-reviews/app-drawer-chat--float-panel/probes/guard-vacuous.mjs
expect: the mutant line (`hidden`, display none) does not read the same assertionValue as the as-built line (today both read "assertionValue":0, with display flex vs none)
```

measured 2026-09-30 by chain chain-app-drawer-chat--float-panel-20260929-224731-39b9, finding M1, MEDIUM
probe-key: 3d2505355b432dfaed5d0ad22452cf30cffe063d

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-gutters/ChatGutterLayout.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/ChatHostPlaceholder.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/ChatHostSlot.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/hooks/useFloatingPanel.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/placeNode.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useChatDoor.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-floats-panel.mjs

## INV-6003 — probe — `ChatHostContext.tsx:152` still says `moveBefore` keeps the composer's caret

`ChatHostContext.tsx:152` still says `moveBefore` keeps the composer's caret

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n 'then keeps' src/modules/chat-host/context/ChatHostContext.tsx
expect: no output (today: line 152, "`moveBefore` then keeps / the composer's caret and the widget frames alive")
```

measured 2026-09-30 by chain chain-app-drawer-chat--float-panel-20260929-224731-39b9, finding L1, LOW
probe-key: ce23ae3d8f64fb75b7e69b209f95595d083951f1

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-gutters/ChatGutterLayout.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/ChatHostPlaceholder.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/ChatHostSlot.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/hooks/useFloatingPanel.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/utils/placeNode.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useChatDoor.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-floats-panel.mjs

## INV-6010 — WorkspaceFrame's reportCovered is a layout effect — a passive one loses the race with a reply

`WorkspaceFrame` reports whether an application covers the main region with `useLayoutEffect(() => reportCovered(covered), [covered, reportCovered])`. Keep it a layout effect.

why: chat-host's unread rule judges a frame against `covered`. A passive effect runs after the paint that draws the application, and a reply landing in that gap is judged against a chat still in sight. Measured 2026-09-30: as a passive effect it lost the race with a reply that landed 0ms after the drawer closed; as a layout effect that reply lights the dot.

Proof: `.verify/fab-radial-door.mjs`, dot leg (MAN-7481). The rule: MAN-7482.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/WorkspaceFrame.tsx

## INV-6011 — probe — a double activation of a radial item inside the close fade runs the act twice (Open in a new tab: two pages; Reload: two document requests)

a double activation of a radial item inside the close fade runs the act twice (Open in a new tab: two pages; Reload: two document requests)

```probe
node /home/lyphe/.claude/state/pipeline-reviews/app-drawer-chat--radial-fill/athena-radial-dblclick.mjs
expect: every row prints newPages 1 (today: gapMs 0, 30, 60 print newPages 2)
```

measured 2026-09-30 by chain chain-app-drawer-chat--radial-fill-20260930-002344-4ad4, finding L1, LOW
probe-key: d0acbb8cd3549ac83ed13eaec368502feb5d83e0

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/AppSwitcherFab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/hooks/useUnreadReply.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/fab-radial-door.mjs

## INV-6012 — probe — three checks in `.verify/fab-radial-door.mjs` cannot fail

three checks in `.verify/fab-radial-door.mjs` cannot fail

```probe
sed -n 325,336p /home/lyphe/.claude/claudecodeui_lyphe/.verify/fab-radial-door.mjs | grep -c "frame("
expect: at least 1 (a frame delivered before the check that claims a reply landed on screen; today 0)
```

measured 2026-09-30 by chain chain-app-drawer-chat--radial-fill-20260930-002344-4ad4, finding L2, LOW
probe-key: 41705d7e6e2e0f2f60aa2258d74911df0ba6c6fb

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/fab-radial-door.mjs

## INV-6016 — probe — a `requestWindow` that throws synchronously, or returns a non-promise, wedges the door for the life of the page

a `requestWindow` that throws synchronously, or returns a non-promise, wedges the door for the life of the page

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node --input-type=module -e "
import { openConsole } from './.verify/lib/console.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const s = await openConsole({ viewport: { width: 1440, height: 900 } });
await s.page.unrouteAll({ behavior: 'ignoreErrors' }); await s.page.context().unrouteAll({ behavior: 'ignoreErrors' });
await s.page.waitForSelector('textarea'); const errs = []; s.page.on('pageerror', (e) => errs.push(String(e).slice(0, 40)));
await s.page.evaluate(() => { window.documentPictureInPicture.requestWindow = () => { throw new Error('sync boom'); }; });
await s.page.keyboard.press('Control+.'); await sleep(400);
await s.page.evaluate(() => { delete window.documentPictureInPicture.requestWindow; });
await s.page.keyboard.press('Control+.'); await sleep(1500);
console.log('pages', s.page.context().pages().length, JSON.stringify(errs)); await s.browser.close();"
expect: pages 1 ["Error: sync boom"]   (a healthy door would show pages 2 after the second, good press)
```

measured 2026-09-30 by chain chain-app-drawer-chat--float-window-20260930-002344-4b26, finding M1, MEDIUM
probe-key: 24f5e1c8ad434587d730bcfcc15bc55278fe9914

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/ChatHostWindow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/context/ChatHostContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/hooks/usePictureInPicture.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-floats-window.mjs

## INV-6017 — probe — a window closed between the browser making it and the app attaching its `pagehide` listener strands the tab: placement `'window'`, no window, the door dead, sometimes the chat lost in the dead document

a window closed between the browser making it and the app attaching its `pagehide` listener strands the tab: placement `'window'`, no window, the door dead, sometimes the chat lost in the dead document

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node --input-type=module -e "
import { openConsole } from './.verify/lib/console.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 6; i++) {
  const s = await openConsole({ viewport: { width: 1440, height: 900 } });
  await s.page.unrouteAll({ behavior: 'ignoreErrors' }); await s.page.context().unrouteAll({ behavior: 'ignoreErrors' });
  await s.page.waitForSelector('textarea');
  s.page.context().on('page', (p) => setTimeout(() => p.close().catch(() => {}), 0));
  await s.page.keyboard.press('Control+.'); await sleep(1500); await s.page.keyboard.press('Control+.'); await sleep(800);
  console.log(i, JSON.stringify(await s.page.evaluate(() => ({ ph: document.querySelector('[data-chat-host-placeholder]')?.getAttribute('data-chat-host-placeholder') ?? null, nodeHere: !!document.querySelector('[data-chat-host-node]') }))));
  await s.browser.close(); }"
expect: every run prints {"ph":null,"nodeHere":true}; a stranded run prints {"ph":"window","nodeHere":false} and stays so after the second press (measured on 1 of 6; probabilistic, so run it a few times)
```

measured 2026-09-30 by chain chain-app-drawer-chat--float-window-20260930-002344-4b26, finding M2, MEDIUM
probe-key: 30bfc02ef14eeebc4cd0bf43ccbd0e69e4244d80

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/ChatHostWindow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/context/ChatHostContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat-host/hooks/usePictureInPicture.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-floats-window.mjs

## INV-6025 — probe — (MEDIUM) — the forget effect fires on a transient `null` while an application is still up, so a press re-routes inside a visit that never ended

(MEDIUM) — the forget effect fires on a transient `null` while an application is still up, so a press re-routes inside a visit that never ended

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node /home/lyphe/.claude/state/pipeline-reviews/app-drawer-chat--routing/athena-probes/dual-close.mjs dualclose
expect: exit 1 with `VIOLATED the left application was up the whole time (one visit)…` whose `s.url` is /session/0f01a88c-b726-42e9-9b75-7236641b603b (ArchPulse) and whose press log holds two pushState entries; fixed, it prints `HELD` with the URL on the .claude conversation and an empty log
```

measured 2026-09-30 by chain chain-app-drawer-chat--routing-20260930-022953-8cd0, finding M1, MEDIUM
probe-key: a9eb2f3cb817cb2ad86e348f6b470ef96bdb172c

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useChatDoor.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-door-application.mjs

## INV-6026 — probe — (LOW) — with no chat mounted, the first press routes but does not float

(LOW) — with no chat mounted, the first press routes but does not float

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node /home/lyphe/.claude/state/pipeline-reviews/app-drawer-chat--routing/athena-probes/routing-door.mjs nomount
expect: exit 1 with `VIOLATED a press with an application linked to ArchPulse: the chat ends up FLOATING…` showing `"ph":null,"panel":false` on the ArchPulse newest URL, then `(info) a SECOND press then floats it: true`
```

measured 2026-09-30 by chain chain-app-drawer-chat--routing-20260930-022953-8cd0, finding L1, LOW
probe-key: d0b3c8d20d5f66ea286510e85dff5736be4d6b39

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useChatDoor.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-door-application.mjs

## INV-6027 — probe — (LOW) — MAN-7444 still says the project-chat door has no readers

(LOW) — MAN-7444 still says the project-chat door has no readers

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n "Readers: none yet" MANUAL.md
expect: no output (today: line 525)
```

measured 2026-09-30 by chain chain-app-drawer-chat--routing-20260930-022953-8cd0, finding L2, LOW
probe-key: ca5d0b773d982253b0e18fe281c57fa05ec5e420

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useChatDoor.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-door-application.mjs

## INV-6043 — A cold `/session/<id>` in simple-list mode is replaced by `/` when the projects list lands before the session lookup, so the chat opens the new-chat screen on the saved project

`SidebarSimpleList.tsx`'s effect "Keeps Files/Git/Shell pointed at the saved project whenever no chat is open" and fires whenever `selectedSession` is null. On a cold deep link `selectedSession` IS null until `useProjectsState`'s URL effect finishes its lookup (`api.sessionDetails`, one lookup per URL id). If the projects list has loaded first, `useSimpleChatProject` answers a project, the effect calls `onProjectSelect(saved project)`, and `handleProjectSelect` ends in `navigate('/')`. The URL loses the session; the lookup then answers into "the user navigated elsewhere while the lookup was in flight" and is discarded. Nothing re-runs: `sessionLookupRef` allows one lookup per id, and the effect's deps do not change.

What a reader sees: reloading (or opening a link to) a conversation lands on `/`, the new-chat screen, on the saved project; the floating chat's header reads "New Session" beside that project. Tree mode has no such effect and keeps the deep link. With a fast lookup (the box idle) the lookup wins and nothing shows, which is why it looks intermittent: measured 2026-09-30 in the whole-check runs at 390x844, two misses in about eight cold loads, then reproduced on demand by holding ONLY the lookup back 2.5s (tree kept the link; simple lost it, header "New Session .claude").

A fix has to keep the unknown-id case alive: when the lookup fails and no project is selected, `useProjectsState` leaves the workspace with no project (its placeholder needs `selectedProjectRef.current`), and today this very effect is what lands such a URL on `/` in the saved project. So the guard cannot be "skip while the URL names a session" alone; it needs to wait for the lookup to SETTLE (answered, or failed), then act. The same effect is the one INV-5891 names for `openProjectChat(B, 'new')` ending on the saved project.

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node .verify/simple-list-deep-link.mjs
expect: exit 1 with `VIOLATED: in simple-list mode the deep link is replaced by / while tree mode keeps it` (today: simple `url=/ deep link LOST, header="New Session .claude"`, tree `KEPT`); a fixed tree prints `held:` and exits 0
```

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useProjectsState.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatProject.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-deep-link.mjs

## INV-6047 — probe — "no console error while signed in, in the tab or in the window" cannot fail for a server 5xx or a failed resource load

"no console error while signed in, in the tab or in the window" cannot fail for a server 5xx or a failed resource load

```probe
/home/lyphe/.claude/state/pipeline-reviews/app-drawer-chat--whole/athena-probes/mut500.sh
expect: two " 500 GET /api/providers/sessions/<id>/token-usage" lines, "console errors while signed in (404s, aborted fetches and blocked font loads aside): 0", then "ALL CHECKS PASS" and "exit=0"
```

measured 2026-09-30 by chain chain-app-drawer-chat--whole-20260930-040206-0899, finding M1, MEDIUM
probe-key: b0dffed85ca37351871965ac08b685cb19ac0254

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-inpage-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-window-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-deep-link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/whole-check.mjs

## INV-6048 — probe — a leg name the harness does not know, or a `WIDTH` it does not draw, is a green run

a leg name the harness does not know, or a `WIDTH` it does not draw, is a green run

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && WIDTH=500 node .verify/whole-check.mjs > /tmp/athena-vac.log 2>&1; echo "exit=$?"; grep -c '^ok' /tmp/athena-vac.log; grep -c '=== \[' /tmp/athena-vac.log; tail -1 /tmp/athena-vac.log
expect: exit=0, 4 ok lines, 0 leg headers, last line "ALL CHECKS PASS" (`node .verify/whole-check.mjs windw` ends the same at both widths)
```

measured 2026-09-30 by chain chain-app-drawer-chat--whole-20260930-040206-0899, finding L1, LOW
probe-key: ba71fafb5cfb380cf380634166debaca2a8ffd75

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-inpage-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-window-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-deep-link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/whole-check.mjs

## INV-6049 — probe — `windowGone` has no timeout: a window that does not close hangs the run for ever

`windowGone` has no timeout: a window that does not close hangs the run for ever

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node /home/lyphe/.claude/state/pipeline-reviews/app-drawer-chat--whole/athena-probes/probe-d-windowgone.mjs
expect: "windowGone on a window that stays open: STILL PENDING after 45000ms"
```

measured 2026-09-30 by chain chain-app-drawer-chat--whole-20260930-040206-0899, finding L2, LOW
probe-key: 9426e39b720c75b3d77ebd412488b5115a12a877

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-inpage-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-window-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-deep-link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/whole-check.mjs

## INV-6050 — probe — `simple-list-deep-link.mjs` prints "held" while it exits 1, and exits 0 when tree mode is the one that lost the link

`simple-list-deep-link.mjs` prints "held" while it exits 1, and exits 0 when tree mode is the one that lost the link

```probe
cd /home/lyphe/.claude/state/pipeline-reviews/app-drawer-chat--whole/athena-probes && ./deeplink-stub.sh / / ; ./deeplink-stub.sh /session/x /
expect: first prints "held: the deep link survives a late session lookup in both modes" with exit=1; second prints the same line with exit=0 although tree mode lost the link
```

measured 2026-09-30 by chain chain-app-drawer-chat--whole-20260930-040206-0899, finding L3, LOW
probe-key: fa3d7358fd45ad38453c886d20d1e4b9f0f4a61c

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-inpage-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-window-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-deep-link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/whole-check.mjs

## INV-6051 — probe — the run's "registry back at its hash" leaves its scratch id in `apps.icons.local.json`

the run's "registry back at its hash" leaves its scratch id in `apps.icons.local.json`

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && python3 -c "import json;print('whole-check' in json.load(open('apps.icons.local.json')))"; sha256sum apps.local.json
expect: True, while the registry hash equals 1c0b0a97c828b1bdc0a6e933fbaaede89a3e744014917c8f8ca22de8417cb7c8
```

measured 2026-09-30 by chain chain-app-drawer-chat--whole-20260930-040206-0899, finding L4, LOW
probe-key: 4366e1384a404d427ae03f79a526b79295349c30

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-inpage-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-window-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-deep-link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/whole-check.mjs

## INV-6052 — probe — a run that is killed leaves its scratch chat behind

a run that is killed leaves its scratch chat behind

```probe
/home/lyphe/.claude/state/pipeline-reviews/app-drawer-chat--whole/athena-probes/kill-midrun.sh
expect: "scratch chat deleted: false" and "threw: page.waitForTimeout: Target page, context or browser has been closed"; afterwards `DELETE /api/providers/sessions/<the printed id>?force=true` answers 200 (the chat was still there)
```

measured 2026-09-30 by chain chain-app-drawer-chat--whole-20260930-040206-0899, finding L5, LOW
probe-key: 464b0f3ffa93fc62ef8bc40bedd7f4b1551de8ae

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-inpage-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-window-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-deep-link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/whole-check.mjs

## INV-6053 — probe — the harness's Google Fonts accommodation hides an 8.4 s blank window, and the report does not flag it

the harness's Google Fonts accommodation hides an 8.4 s blank window, and the report does not flag it

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node /home/lyphe/.claude/state/pipeline-reviews/app-drawer-chat--whole/athena-probes/probe-c-fonts.mjs
expect: "window page at +<100ms, composer in window at +8xxxms" (8397 measured)
```

measured 2026-09-30 by chain chain-app-drawer-chat--whole-20260930-040206-0899, finding L6, LOW
probe-key: 081f20c7642fd50a5f29f72f8e615e48aea6120e

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-inpage-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-window-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-deep-link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/whole-check.mjs

## INV-6057 — radial at 100px on a narrow phone — five items near the screen's centre put a label on another item's disc

`RADIAL_RADIUS_PX` (100) and `RADIAL_STEP_DEG` (34°) were measured over 1440×900 and 390×844 only. Narrower phones are unmeasured, and five items with the FAB near the screen's centre fail there.

| viewport | five items, FAB positions that put a label on another item's disc or the FAB's catch (2026-09-30) |
| --- | --- |
| 336×746 (the operator's 360×800 phone read as a 1.072 zoom; inferred, not read off the device) | 90 of 51,744 at a 2px step; x 150–186, y 354–392 |
| 320×568 | 182 in a 29×29 window round the centre; x 134–186, y 254–314 |
| 360×800 | 10; x 174–186, y 396–404 |

- Two items: clean everywhere swept.
- Cause: near the centre "faces the viewport's centre" has no open side, the arc lands sideways, and about 68px is left between the FAB and the wall for a label.
- A larger radius clears it and brings the reach back up (170px cut every word instead, 2026-09-30).
- Before changing `RADIAL_RADIUS_PX` or `RADIAL_STEP_DEG`, re-measure at 336×746 and 320×568 as well as the two measured viewports. Sweep tooling is not saved in `.verify/`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/utils/radialLabels.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/utils/radialLayout.ts

## INV-6058 — probe — MED — the probe widens the LIVE dial with no look at the queue, so one run can launch a real planner outing on Opus

MED — the probe widens the LIVE dial with no look at the queue, so one run can launch a real planner outing on Opus

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -c -i "queued" .verify/probe-planner-lanes.mjs
expect: a count above 0 — the probe reads the frame's planner rows and declines to widen the live dial over a queued one (today: 0; its `+` launched eupalinos `tell coi-send-switch` on opus, launch dispatch-eupalinos-20260930-103743-6e23)
```

measured 2026-09-30 by chain chain-planner-lanes-dial-20260930-102233-3f63, finding M1, MEDIUM
probe-key: 86c8b4a67472b7e879259416e084e8ed82b73f38

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-planner-lanes.mjs, /home/lyphe/.claude/hooks/dispatcher/planner_lanes.py, /home/lyphe/.claude/skills/arc/SKILL.md

## INV-6059 — probe — LOW — `planner_lanes.width_of` has no length bound, so `dispatcher planners <64+ digits>` writes a flag the dispatcher itself ignores, and `width_of` does raise

LOW — `planner_lanes.width_of` has no length bound, so `dispatcher planners <64+ digits>` writes a flag the dispatcher itself ignores, and `width_of` does raise

```probe
D=$(mktemp -d /tmp/athena-w-XXXXXX) || exit 1; case "$D" in /tmp/athena-w-*) DISPATCHER_PLANNERS_FLAG_PATH="$D/planners.flag" DISPATCHER_HOME="$D/home" ~/.claude/scripts/dispatcher planners "$(python3 -c 'print("9"*70)')" | cut -c1-30; DISPATCHER_PLANNERS_FLAG_PATH="$D/planners.flag" DISPATCHER_HOME="$D/home" ~/.claude/scripts/dispatcher planners; rm -r "$D";; esac
expect: a `REFUSED planners '…'` line for the 70-digit word, then `PLANNERS lanes=2` (today: `PLANNERS lanes=99999999999999999999999…` exit 0, a 71-byte file, then `PLANNERS lanes=2`; a 5000-digit word today ends in a ValueError line, exit 1)
```

measured 2026-09-30 by chain chain-planner-lanes-dial-20260930-102233-3f63, finding L1, LOW
probe-key: 558664d07bfe8d30ef15ff40745f5a8dd0a2a866

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-planner-lanes.mjs, /home/lyphe/.claude/hooks/dispatcher/planner_lanes.py, /home/lyphe/.claude/skills/arc/SKILL.md

## INV-6060 — probe — LOW — the probe's `-` press and its final restore overwrite a change the operator (or another session) made during the run

LOW — the probe's `-` press and its final restore overwrite a change the operator (or another session) made during the run

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && [ "$(../scripts/dispatcher status --json | python3 -c 'import json,sys; print(sum(1 for p in json.load(sys.stdin)["planners"] if p["state"]=="queued"))')" = 0 ] && { node .verify/probe-planner-lanes.mjs >/dev/null 2>&1 & P=$!; until [ "$(tr -d '\n' < ../state/planners.flag)" = 3 ]; do sleep 0.05; done; ../scripts/dispatcher planners 5 >/dev/null; wait $P; tr -d '\n' < ../state/planners.flag; echo; ../scripts/dispatcher planners 2; }
expect: `5` — the probe leaves a mid-run change alone (today: `2`)
```

measured 2026-09-30 by chain chain-planner-lanes-dial-20260930-102233-3f63, finding L2, LOW
probe-key: 9159d350d908ed93e2c655fde217aa30f513bfd4

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-planner-lanes.mjs, /home/lyphe/.claude/hooks/dispatcher/planner_lanes.py, /home/lyphe/.claude/skills/arc/SKILL.md

## INV-6061 — probe — `update` can answer `undefined`, a third state its declared type and its docblock both exclude

`update` can answer `undefined`, a third state its declared type and its docblock both exclude

```probe
DIR=$(mktemp -d); case "$DIR" in /tmp/tmp.*) ;; *) echo "refusing: $DIR"; exit 1;; esac
sqlite3 ~/.cloudcli/auth.db ".backup '$DIR/auth.db'"
cd /home/lyphe/.claude/claudecodeui_lyphe
DATABASE_PATH=$DIR/auth.db TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx -e 'import("@/modules/database/index.js").then(async (m) => { await m.initializeDatabase(); const db = m.getConnection(); db.exec("CREATE TRIGGER probe_vanishing AFTER UPDATE ON notes BEGIN DELETE FROM notes WHERE id = NEW.id; END"); const a = m.notesDb.create({ userId: 1, title: "probe-vanish", description: "" }); const r = m.notesDb.update(1, a.id, { title: "edited", description: "edited" }); console.log("returned:", r, "| undefined:", r === undefined, "| null:", r === null); });'
cd /tmp && rm -rf "$DIR"
expect: `returned: undefined | undefined: true | null: false` — the UPDATE matched (its `changes` was 1) and the read-back found nothing.
```

measured 2026-09-30 by chain chain-simple-notes--store-20260930-104837-cb87, finding L1, LOW
probe-key: 1da15b7a807b88e93d4c921913d9b11a49c005db

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/migrations.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/notes-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/notes.db.ts

## INV-6062 — probe — three pre-existing values were rewritten: `simpleList.stopBody` in ja, zh-CN, zh-TW. [LOW]

three pre-existing values were rewritten: `simpleList.stopBody` in ja, zh-CN, zh-TW. [LOW]

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && python3 -c '
import json, subprocess
for l in ["ja","zh-CN","zh-TW"]:
    p = "src/modules/i18n/locales/%s/sidebar.json" % l
    old = json.loads(subprocess.run(["git","show","HEAD:"+p], capture_output=True, text=True).stdout)["simpleList"]
    new = json.load(open(p))["simpleList"]
    print(l, [(k, old[k], new[k]) for k in old if old[k] != new.get(k)])
'
```

measured 2026-09-30 by chain chain-simple-chat-folders--words-20260930-104836-bc61, finding L1, LOW
probe-key: d7ede4d01b23de65dbe1d9355479b60613e50a8a

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/de/sidebar.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/sidebar.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/es/sidebar.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/fr/sidebar.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/it/sidebar.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/ja/sidebar.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/ko/sidebar.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/ru/sidebar.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/tr/sidebar.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/zh-CN/sidebar.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/zh-TW/sidebar.json, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-folders-words.py

## INV-6063 — probe — the report's own count of its `types.ts` hunk is one high (report accuracy, not the build)

the report's own count of its `types.ts` hunk is one high (report accuracy, not the build)

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && git diff HEAD -U0 -- src/shared/types.ts | grep -n '^@@ -2213,0'; printf 'hunk lines=%s\n' "$(git diff HEAD -U0 -- src/shared/types.ts | sed -n '/^@@ -2213,0/,/^@@ -24/p' | grep -c '^+[^+]')" ; printf 'blank added lines=%s\n' "$(git diff HEAD -U0 -- src/shared/types.ts | sed -n '/^@@ -2213,0/,/^@@ -24/p' | grep -c '^+$')"
```

measured 2026-09-30 by chain chain-simple-notes--contract-20260930-104837-0a18, finding L1, LOW
probe-key: 6e6c997d5ea86ba47d757da883492a08e838562f

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/de/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/es/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/fr/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/it/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/ja/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/ko/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/ru/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/tr/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/zh-CN/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/zh-TW/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-6064 — probe — `npm run typecheck` reads exit 2; both errors are another chain's files, timestamped after this build's run

`npm run typecheck` reads exit 2; both errors are another chain's files, timestamped after this build's run

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && npx tsc --noEmit -p tsconfig.json; echo "client exit:$?"; npx tsc --noEmit -p server/tsconfig.json; echo "server exit:$?"
expect: client exit:0, then the two claude-updates errors above and server exit:2 — no error names src/shared/api.ts or src/shared/types.ts
```

measured 2026-09-30 by chain chain-simple-chat-folders--contract-20260930-104835-68a5, finding M1, MEDIUM
probe-key: c40e78bb262cc99351787404e1bf0197ad44d1da

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-list-contract.mjs

## INV-6065 — probe — `npm run lint` reads exit 1 (three errors, 175 warnings); same foreign files, target files clean

`npm run lint` reads exit 1 (three errors, 175 warnings); same foreign files, target files clean

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && npm run lint 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E ': error ' | sed 's/:.*//' | sort -u; npm run lint:client >/dev/null 2>&1; echo "client lint exit:$?"; npm run lint 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -cE '^src/shared/(api|types)\.ts'
expect: exactly the three files above; `client lint exit:0`; and `0` lines naming either target file
```

measured 2026-09-30 by chain chain-simple-chat-folders--contract-20260930-104835-68a5, finding M2, MEDIUM
probe-key: 8e9f1db80c3fdab48bd771bceb87943211425938

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-list-contract.mjs

## INV-6066 — probe — the standing proof reds on the POST status the route table promises

the standing proof reds on the POST status the route table promises

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && python3 - <<'PY'
src = open('.verify/probe-simple-list-contract.mjs').read()
old = """    await route.fulfill({
      status: 200,"""
new = """    await route.fulfill({
      status: request.method() === 'POST' ? 201 : 200,"""
assert src.count(old) == 1
open('.verify/athena-probe-copy-201.mjs', 'w').write(src.replace(old, new))
PY
node .verify/athena-probe-copy-201.mjs | tail -3; rm .verify/athena-probe-copy-201.mjs
expect: C1–C5 PASS, then `[FAIL] C6 all four calls read their answer back — {"createFolder":201,…}` and `SIMPLE-LIST-CONTRACT FAIL (1)`; delete the copy in the same breath
```

measured 2026-09-30 by chain chain-simple-chat-folders--contract-20260930-104835-68a5, finding L1, LOW
probe-key: 16268f4bbdc480b0583367a1e96ba7064fac5fd1

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-list-contract.mjs

## INV-6069 — probe — The last-job hold forgets the moment any later job replaces `job.json`: a rolled-back (or failed) release is reinstalled automatically

The last-job hold forgets the moment any later job replaces `job.json`: a rolled-back (or failed) release is reinstalled automatically

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && F=$(mktemp /tmp/athena-probe-cascade-XXXXXX.mts) && cat > "$F" <<'X'
import { createAutoInstall } from '/home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-auto-install.service.ts';
const pkg = (key: string, label: string, installed: string, latest: string) => ({ key, label, name: key, installed, loaded: null, latest, updateAvailable: installed !== latest, updatable: true, reason: null, notes: [], notesReason: null, changelogUrl: '' });
const job = (kind: string, state: string, key: string, from: string, to: string) => ({ id: 'j', kind, state, steps: [{ key, from, to, state: 'done' }], logTail: [] });
let last: any = job('rollback', 'done', 'sdk', '0.3.285', '0.3.284'); let cli = '2.1.285'; const calls: unknown[] = []; console.log = () => {};
const svc = createAutoInstall({ config: { get: () => null, set: () => {} }, readActivity: async () => ({ busy: false, reasons: [] }),
  readReadings: async () => ({ checkedAt: 1, checking: false, checkError: null, nextCheckAt: 2, supervised: true, job: last, packages: [pkg('cli', 'Claude Code', cli, '2.1.286'), pkg('sdk', 'Claude Agent SDK', '0.3.284', '0.3.285')] }) as any,
  applyUpdate: async (t) => { calls.push(t); if ((t as any).cli) { last = job('update', 'done', 'cli', '2.1.285', '2.1.286'); cli = '2.1.286'; } return { ok: true } as any; } });
await svc.tick(); await svc.tick(); process.stdout.write(JSON.stringify(calls) + '\n'); process.exit(0);
X
timeout 60 node_modules/.bin/tsx --tsconfig server/tsconfig.json "$F"; case "$F" in /tmp/athena-probe-cascade-*) rm -f "$F";; esac
expect: [{"cli":"2.1.286"}] only — the rolled-back SDK 0.3.285 must not be offered again; measured: [{"cli":"2.1.286"},{"sdk":"0.3.285"}]
```

measured 2026-09-30 by chain chain-claude-updates-auto-install-20260930-110043-48df, finding M1, MEDIUM
probe-key: 8a8701ac557bab28972d95adecfe31cf7329fc20

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-activity/claude-activity.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-auto-install.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-held-versions.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/claude-activity-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/claude-updates/ClaudeUpdatesSettingsTab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/claude-updates/hooks/useClaudeUpdates.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/claude-updates-auto-install.mjs

## INV-6070 — probe — A report without `autoInstall` blanks the whole Updates tab: permanent spinner, and the manual "Update and restart" is gone

A report without `autoInstall` blanks the whole Updates tab: permanent spinner, and the manual "Update and restart" is gone

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && F=$(mktemp /tmp/athena-probe-old-XXXXXX.mjs) && cat > "$F" <<'X'
import { chromium } from '/home/lyphe/.claude/claudecodeui_lyphe/node_modules/playwright/index.mjs';
import { HARNESS_PREFERENCES, pinPreferences } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/prefs-pin.mjs';
const token = (await (await fetch('http://127.0.0.1:3011/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'verve', password: 'verve-dev-2026' }) })).json()).token;
const browser = await chromium.launch(); const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
await context.addInitScript((v) => localStorage.setItem('auth-token', v), token);
await pinPreferences(context, { ...HARNESS_PREFERENCES, theme: 'light', themeFollowsSun: false }, { writes: 'abort' });
const page = await context.newPage(); await page.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.route((u) => u.pathname === '/api/claude-updates', async (route) => { if (route.request().method() !== 'GET') return route.fallback(); const r = await route.fetch(); const b = await r.json(); delete b.autoInstall; await route.fulfill({ response: r, body: JSON.stringify(b) }); });
await page.goto('http://localhost:5183', { waitUntil: 'domcontentloaded' });
const s = page.locator('button[aria-label="Settings"]:visible, button:has-text("Settings"):visible').first(); await s.waitFor({ state: 'visible', timeout: 45000 }); await s.click();
await page.getByRole('button', { name: 'Updates', exact: true }).click(); await page.waitForTimeout(4000);
const text = await page.locator('.modal-backdrop').innerText();
console.log(JSON.stringify({ updateAndRestartButton: /Update and restart/.test(text), stuckOnSpinner: /Reading the update report/.test(text) })); await browser.close(); process.exit(0);
X
timeout 120 node "$F"; case "$F" in /tmp/athena-probe-old-*) rm -f "$F";; esac
expect: {"updateAndRestartButton":true,"stuckOnSpinner":false} — measured: {"updateAndRestartButton":false,"stuckOnSpinner":true}
```

measured 2026-09-30 by chain chain-claude-updates-auto-install-20260930-110043-48df, finding L1, LOW
probe-key: 4315f9fdb9d338748c32a9bf073de83aea1dc40c

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-activity/claude-activity.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-auto-install.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-held-versions.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/claude-activity-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/claude-updates/ClaudeUpdatesSettingsTab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/claude-updates/hooks/useClaudeUpdates.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/claude-updates-auto-install.mjs

## INV-6071 — probe — `.verify/claude-updates-auto-install.mjs` leaves the operator's LIVE switch OFF when a cell fails between its two presses, and its header says it does not

`.verify/claude-updates-auto-install.mjs` leaves the operator's LIVE switch OFF when a cell fails between its two presses, and its header says it does not

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n "finally" .verify/claude-updates-auto-install.mjs
expect: a restore of the switch on every exit path — measured: one `finally`, and it only runs `browser.close()`
```

measured 2026-09-30 by chain chain-claude-updates-auto-install-20260930-110043-48df, finding L2, LOW
probe-key: ee261bd85314737e61744922604d0d610f5fa454

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/claude-updates-auto-install.mjs

## INV-6073 — probe — one press costs two reads under the app's real frame traffic

one press costs two reads under the app's real frame traffic

```probe
node /tmp/athena-prov.EWQzOh/press.mjs
expect: `(a) one press: POSTs=1 GETs=2 resolved=true` — the press's own post-write re-read plus the read the server's own broadcast provokes when its frame arrives.
```

measured 2026-09-30 by chain chain-simple-notes--provider-20260930-112739-1ce0, finding L2, LOW
probe-key: 7fd9e84a057d5fba1f3c54ea1d3a8000a2e5a4b1

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/App.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/notes/context/NotesContext.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/notes/context/NotesProvider.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/notes/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-6074 — probe — two `removeLocal` calls in one tick lose the first removal, while both `total` decrements land

two `removeLocal` calls in one tick lose the first removal, while both `total` decrements land

```probe
node /tmp/athena-feed-probe.TVw6LK/athena-feed-hook5.mjs   # dev app on 5183 + API on 3011; mounts two live instances of the real hook
expect: "[NOTE] two removeLocal calls in one tick: <id> still held: true; <id> still held: false" and "(before: a held true, b held true; total 11 -> 9)" — the first chat survives its own removal while both total decrements stand.
```

measured 2026-09-30 by chain chain-simple-chat-folders--feed-20260930-115952-45b5, finding L1, LOW
probe-key: 7175afb920515f8679c505c592a216f802f3b0e3

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatList.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-feed.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-reorder.mjs

## INV-6075 — probe — MEDIUM — the last drawn chat cannot be dropped at the end: a release past every row is read as its own place and prints nothing

MEDIUM — the last drawn chat cannot be dropped at the end: a release past every row is read as its own place and prints nothing

```probe
node .verify/athena-carry-endzone.mjs
expect: `END-ZONE: the last chat of the last open folder, released below the last block -> target={"at":"end"} endLine=true edge=[] moves=[{"item":{"kind":"chat","id":"e1"},"position":{"folderId":null,"after":{"kind":"folder","id":"f2"}}}]` — today it prints `target={"at":"row","item":{"kind":"chat","id":"e1"},"edge":"before"} endLine=false edge=["e1:before"] moves=[]`, and the same probe's controls (`R1`/`R2`/`G2` quiet, `R4` end + one move, `G3` the top-level slot after the first folder reachable) must keep holding
```

measured 2026-09-30 by chain chain-simple-chat-folders--carry-20260930-115952-5297, finding M1, MEDIUM
probe-key: cf07cd9ea7e3e39fdbdbc5a2917648fe4c002018

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-drag.mjs

## INV-6076 — probe — `.verify/probe-simple-folders.mjs`'s live-list chrome gate is stale, and no brief item schedules it

`.verify/probe-simple-folders.mjs`'s live-list chrome gate is stale, and no brief item schedules it

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node .verify/probe-simple-folders.mjs 2>&1 | tail -4
expect: FAILED (1): - [live@1440-light] the live list draws no folder chrome — no header, no block — {"folders":0,"blocks":8}; exit 1
```

measured 2026-09-30 by chain chain-simple-chat-folders--list-20260930-124502-46be, finding M1, MEDIUM
probe-key: c8ac595b52a14b2ade074b1f1490fa92f995dae5

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-folders.mjs

## INV-6078 — probe — the phase's "part 2" evidence is vacuous by construction (copy taken after the fills)

the phase's "part 2" evidence is vacuous by construction (copy taken after the fills)

```probe
stat -c '%y %n' /tmp/heph-p11/iris.aJ8IGZ/*.tsx src/modules/sidebar/SidebarSimpleFolderRow.tsx src/modules/sidebar/SidebarSimpleFolderPicker.tsx src/modules/sidebar/SidebarSimpleListItems.tsx src/modules/sidebar/SidebarSimpleListRow.tsx
diff -q /tmp/heph-p11/iris.aJ8IGZ/SidebarSimpleListItems.tsx src/modules/sidebar/SidebarSimpleListItems.tsx
expect: copy 12:45:07 vs sources 11:26–12:23 (all before the 12:45:02 dispatch); diff quiet
```

measured 2026-09-30 by chain chain-simple-chat-folders--list-20260930-124502-46be, finding L2, LOW
probe-key: bda06115c0a506556bba83f48348409debe638ce

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatFolders.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-folder-composer.mjs

## INV-6079 — probe — the walk probe prints its selection claim but never gates it, and never observes the app's `scrollIntoView`

the walk probe prints its selection claim but never gates it, and never observes the app's `scrollIntoView`

```probe
sed -n '275,281p;307,310p' .verify/probe-simple-folder-composer.mjs
node /tmp/athena-folders-verbs/verbs.mjs   # S8, same ground
expect: sed shows the print at 281 and the pass at 307-310 with no selectionStart/End in it; S8 PASS — `selected 0…10 of 10`, one scrollIntoView (block nearest), first keystroke replaces the name
```

measured 2026-09-30 by chain chain-simple-chat-folders--list-20260930-124502-46be, finding L3, LOW
probe-key: 8bd45923c90a0a792d9f584ef06d5cb7dca43e1a

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatFolders.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-folder-composer.mjs

## INV-6082 — A push payload's landing path is untrusted at every opener

Every opener of a push's `data.path` opens it only when it is a rooted, same-origin path: a string matching `/^\/(?!\/)[^\s\\]*$/`. Anything else falls back to `/session/<sessionId>`, or `/` with no session.

- Refused: a non-string, an absolute `https://…`, a protocol-relative `//host/x`, a backslash escape `/\host/x`, any whitespace the URL parser would strip into a separator.
- Openers that hold the guard: `public/sw.js` `notificationclick`; `electron/main.js` `openNotificationTarget`. A new opener adds the same guard.
- why: a payload can come from a remote environment's box, and the desktop app navigates its view to whatever URL it is handed. `landingPathOf` output always passes: it emits a rooted path with every value encoded (`%20`, `%5C`).
- `src/modules/project-workspace/controllers/ProjectEffects.tsx` checks `startsWith('/')` only, which accepts `//host/x`. It is fed by the worker's validated `urlPath`; feed it from anywhere else and it needs the same regex.

governs: /home/lyphe/.claude/claudecodeui_lyphe/electron/main.js, /home/lyphe/.claude/claudecodeui_lyphe/public/sw.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/services/notification-landing.service.ts

## INV-6084 — probe — `/?runner=<plan>` at the root never lands after the project is picked (scenario S6)

`/?runner=<plan>` at the root never lands after the project is picked (scenario S6)

```probe
node /home/lyphe/.claude/state/pipeline-reviews/prompts-in-cards--reveal/athena-probes/landing-attacks-2.mjs   # dev client on 127.0.0.1:5183
expect: [FAIL] S6 the pick never lands: the tab stays Chat and the landing URL is gone (navigate('/') in handleProjectSelect) — rootPick.after `/ | tab Chat | stored chat | pane no cards 0 | target false`, while beforePick the same page holds `/?runner=coi-backend-conformance | tab null | tabs []`; S6b prints [OK] on the already-picked page
```

measured 2026-09-30 by chain chain-prompts-in-cards--reveal-20260930-133613-4585, finding M1, MEDIUM
probe-key: 7176ac370388533667b3d08cf94c59333e01a442

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/controllers/ProjectEffects.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useRunnerLanding.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/WorkspaceMain.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/runner-tab/RunnerPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-runner-landing.mjs

## INV-6085 — probe — an empty `?runner=` is read as a plan name (scenario S7)

an empty `?runner=` is read as a plan name (scenario S7)

```probe
node /home/lyphe/.claude/state/pipeline-reviews/prompts-in-cards--reveal/athena-probes/landing-attacks-2.mjs
expect: [FAIL] S7 an EMPTY `?runner=` lands on the Runner tab and strips the param — emptyParam.series[1] `/session/e609dd36-… | tab Runner | stored runner | pane no cards 0`, and the param is gone from the URL
```

measured 2026-09-30 by chain chain-prompts-in-cards--reveal-20260930-133613-4585, finding L1, LOW
probe-key: 9b3a969a5eb2d2c04c66bf5e0ab83ac50dba5aa1

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/controllers/ProjectEffects.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useRunnerLanding.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/WorkspaceMain.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/runner-tab/RunnerPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-runner-landing.mjs

## INV-6086 — probe — the reveal is not retired over an empty lane; it stays pending and fires late (scenario S21)

the reveal is not retired over an empty lane; it stays pending and fires late (scenario S21)

```probe
node /home/lyphe/.claude/state/pipeline-reviews/prompts-in-cards--reveal/athena-probes/landing-attacks-2.mjs
expect: [FAIL] S21 the reveal was still PENDING over the empty lane: after the lane drew 8 cards the pane moved to 2970px (target top 464px) with no landing
```

measured 2026-09-30 by chain chain-prompts-in-cards--reveal-20260930-133613-4585, finding L2, LOW
probe-key: 63ba668cb176b779e21f795140b570dba7b1d7cb

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/controllers/ProjectEffects.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useRunnerLanding.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/WorkspaceMain.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/runner-tab/RunnerPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-runner-landing.mjs

## INV-6090 — probe — a title of two ZERO WIDTH SPACEs is accepted: a card that draws as nothing

a title of two ZERO WIDTH SPACEs is accepted: a card that draws as nothing

```probe
T=$(curl -s -X POST http://127.0.0.1:3011/api/auth/login -H 'content-type: application/json' -d '{"username":"verve","password":"verve-dev-2026"}' | jq -r .token)
BODY=$(python3 -c "import json;print(json.dumps({'title':chr(0x200b)*2,'description':''}))")   # a title of two U+200B ZERO WIDTH SPACEs
curl -s -w ' <- %{http_code}\n' -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' -d "$BODY" http://127.0.0.1:3011/api/notes
# with the id the answer carries: curl -s -o /dev/null -w '%{http_code}\n' -X DELETE -H "Authorization: Bearer $T" http://127.0.0.1:3011/api/notes/<id>
expect: `201 {"success":true,"data":{"id":"…","title":"<two U+200B>","description":"","createdAt":"…","updatedAt":"…"}} <- 201` — a card whose title is two invisible characters; the cleanup DELETE answers 200 and leaves no row behind.
```

measured 2026-09-30 by chain chain-simple-notes--whole-20260930-134952-8535, finding L1, LOW
probe-key: ac54f2f112f88267d461c10e585dd21b1fe97d12

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/shots/p9-page-a-step2-light.png, /home/lyphe/.claude/claudecodeui_lyphe/.verify/shots/p9-page-b-step3-light.png

## INV-6091 — probe — a draft typed during its own add's flight is discarded when the write lands

a draft typed during its own add's flight is discarded when the write lands

```probe
node /tmp/athena-p9-ui-b.mjs
expect: the line `[!!] S39 a draft typed during its own add: typed during the flight "typed while the save was in flight" → after the write landed ""` — the field is emptied although the person typed after the press. The script deletes every note it made and ends with the account holding 0 cards.
```

measured 2026-09-30 by chain chain-simple-notes--whole-20260930-134952-8535, finding L2, LOW
probe-key: 8cf24c6327736f004c14f6df80e827895b99764a

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/shots/p9-page-a-step2-light.png, /home/lyphe/.claude/claudecodeui_lyphe/.verify/shots/p9-page-b-step3-light.png

## INV-6093 — probe — the ladder's two consumer lists are still short, in the same class this phase fixed

the ladder's two consumer lists are still short, in the same class this phase fixed

```probe
grep -n "NEXT_TOP_SIMPLE_LIST_RANK_SQL\|renumberLadder" server/modules/database/repositories/simple-list.db.ts server/modules/database/repositories/simple-list-ladder.db.ts
expect: consumers at simple-list.db.ts:77 (createFolder) and :148 (deleteFolder) — neither named by the ladder's docblocks at :41 and :174
```

measured 2026-09-30 by chain chain-simple-chat-folders--old-door-20260930-133741-c3a2, finding L2, LOW
probe-key: 9deb5ad49393aee36e155aeb108c00c231a5044c

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/session-user-state.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/simple-list-ladder.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/session-user-state.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/session-user-state.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-sidebar-state-api.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-reorder.mjs

## INV-6094 — probe — the A7/A8 repair is justified, but it steps aside from the suite's only feed-unread gate, and that gate cannot pass

the A7/A8 repair is justified, but it steps aside from the suite's only feed-unread gate, and that gate cannot pass

```probe
node .verify/probe-simple-icons-unread.mjs
expect: "[FAIL] setup the simple list never drew C (<id>) within 20 s", "gates passed 0/8", "SIMPLE-ICONS-UNREAD FAIL", exit 1 — measured 2026-09-30 21:25Z; its cleanup still removes its 3 chats and leaves the preference at false
```

measured 2026-09-30 by chain chain-simple-chat-folders--old-door-20260930-133741-c3a2, finding L3, LOW
probe-key: 5ab6902890cacb730a984a344dc7b77ec75aa07b

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/session-user-state.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/simple-list-ladder.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/session-user-state.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/session-user-state.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-sidebar-state-api.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-simple-reorder.mjs

## INV-6141 — probe — INV-6095: "the card's door … never consults it" no longer reproduces

INV-6095: "the card's door … never consults it" no longer reproduces

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --input-type=module -e "
const { createDispatcherAsks } = await import('./server/modules/dispatcher/dispatcher-asks.service.ts');
let reads = 0;
const ask = { kind: 'accept', plan: 'athena-h', plans: ['athena-h'], header: 'athena-h', question: 'q', token: 't', options: [{ label: 'Accept', description: '' }, { label: 'Queue', description: '' }, { label: 'Rework', description: '' }], rework: [], asked: { id: 1, at: '2026-09-30T10:00:00Z' } };
const asks = createDispatcherAsks({ sessionOf: () => ({ sessionId: 's', provider: 'c', sessionName: 'n' }), push() {}, forgetButtons() {}, carry: async () => ({ outcome: 'took', said: '' }), read: async () => { reads += 1; return { plans: [{ name: 'athena-h', asking: null, session_app_id: null }], generated_at: '2026-09-30T10:00:00Z' }; }, log() {} });
const d = { allow: true, updatedInput: { answers: { q: 'Accept' } } };
const a = await asks.answer(ask, d), b = await asks.answer(ask, d);
console.log('outcomes', a.outcome, b.outcome, 'reads=' + reads);
"
expect: `outcomes not-open not-open reads=1` — the second replay pays no store read, so the row's `reads=2` and "never consults it" no longer reproduce
```

measured 2026-09-30 by chain chain-prompts-in-cards--docs-app-20260930-175729-5966, finding L1, LOW
probe-key: f2bf8b27aa9596ace057e3fe46fe2a7ebc88ad55

governs: /home/lyphe/.claude/claudecodeui_lyphe/

## INV-6143 — probe — INV-6130: "four probes die before their scenario" no longer reproduces

INV-6130: "four probes die before their scenario" no longer reproduces

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/plan-ask-survives-restart/athena-probes/{settle_throw,read_fail_silent,stale_token_flood,id_reuse}.sh
expect: all four reach their own scenario, rc=0 — `still alive after the settle chain threw` / `process exit code 0`; `plan approved by the answer: false`; `store reads for 40 taps of ONE stale token: 1` and `extra store reads: 0`; `two different asks share one key …: false` — no TypeError at composition, so the row's "four probes die" no longer reproduces
```

measured 2026-09-30 by chain chain-prompts-in-cards--docs-app-20260930-175729-5966, finding L3, LOW
probe-key: a8b0e04fefd37861c549129a8f30c94aef7d6428

governs: /home/lyphe/.claude/claudecodeui_lyphe/

## INV-6317 — probe — MEDIUM — a reorder re-inserts the *neighbours'* DOM nodes, so a moved deck's strip shows plan 1 under a counter that says "Card 2 of 2", and a moved card's census scroll is lost

MEDIUM — a reorder re-inserts the *neighbours'* DOM nodes, so a moved deck's strip shows plan 1 under a counter that says "Card 2 of 2", and a moved card's census scroll is lost

```probe
node /home/lyphe/.claude/state/pipeline-reviews/card-order-drag/athena-probes/a5.mjs
expect: the "right after" line reads "scrollLeft":1049 with "planShownInStrip":"probe-order--arc-two" under "label":"Card 2 of 2" (today: "scrollLeft":0 … "planShownInStrip":"probe-order--arc-one", and the "4 s later" line is unchanged)
```

measured 2026-10-01 by chain chain-card-order-drag-20261001-152353-c269, finding M1, MEDIUM
probe-key: d5bd7fb89caf7ac8ab9fa9f37163fffb4454e386

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/cardOrder.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/motion.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/useSortable.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/usePointerDrag.ts

## INV-6318 — probe — LOW — a cancelled touch commits the drop

LOW — a cancelled touch commits the drop

```probe
node /home/lyphe/.claude/state/pipeline-reviews/card-order-drag/athena-probes/a6.mjs
expect: the "after touchCancel" line reads the wall as it began, `p6 p5 p4 p3 p2 p1`, and `local cardOrder []` (today: `p4 p6 p5 p3 p2 p1` and `[{"name":"probe-order--p4","rank":1790755561000}]`)
```

measured 2026-10-01 by chain chain-card-order-drag-20261001-152353-c269, finding L1, LOW
probe-key: 7b6392f0467e28adba17f74ad914d539f0a68ecd

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/cardOrder.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/motion.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/useSortable.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/usePointerDrag.ts

## INV-6319 — probe — LOW — grabbing a card again inside its 200 ms settle slide strips the new carry's marks

LOW — grabbing a card again inside its 200 ms settle slide strips the new carry's marks

```probe
node /home/lyphe/.claude/state/pipeline-reviews/card-order-drag/athena-probes/r1.mjs
expect: the "400 ms later, still holding" line keeps `position: relative; z-index: 30; will-change: transform; background-color: …; border-radius: …` (today: `transform: translate(13.3333px, 13.3333px);` alone)
```

measured 2026-10-01 by chain chain-card-order-drag-20261001-152353-c269, finding L2, LOW
probe-key: 86f054f104378a3860ee59ad1c06ea9e087d7735

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/cardOrder.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/motion.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/useSortable.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/usePointerDrag.ts

## INV-6320 — probe — LOW — the tied-rank branch of `ranksForMove` moves cards the operator did not touch, against the other kind

LOW — the tied-rank branch of `ranksForMove` moves cards the operator did not touch, against the other kind

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && TSX_TSCONFIG_PATH=tsconfig.json npx tsx /home/lyphe/.claude/state/pipeline-reviews/card-order-drag/athena-probes/tie.mts
expect: "widget column after" keeps c-wall before d-deck (today: `a-wall b-deck d-deck e-wall c-wall`, with `c-wall` — never carried — now below the deck that stood below it)
```

measured 2026-10-01 by chain chain-card-order-drag-20261001-152353-c269, finding L3, LOW
probe-key: 44e21d54a9185ed78094e1ebb08b12ce9801a104

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/cardOrder.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/motion.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/useSortable.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/usePointerDrag.ts

## INV-6321 — probe — LOW — a second finger lifts the wrong card

LOW — a second finger lifts the wrong card

```probe
node /home/lyphe/.claude/state/pipeline-reviews/card-order-drag/athena-probes/t2.mjs
expect: "lifted after the hold" names the card under finger 1, `["p5"]`, or nothing (today: `["p4"]`)
```

measured 2026-10-01 by chain chain-card-order-drag-20261001-152353-c269, finding L4, LOW
probe-key: 64c83ba4015088ad80ae19fccecb474581aa4359

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/cardOrder.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/motion.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/useSortable.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/usePointerDrag.ts

## INV-6326 — probe — MEDIUM — `status=running` + "wait again" is an instant-return loop when a soul outlived its walker

MEDIUM — `status=running` + "wait again" is an instant-return loop when a soul outlived its walker

```probe
D=$(mktemp -d /tmp/athena-probe-held-XXXXXX) || exit 1
case "$D" in /tmp/athena-probe-held-*) ;; *) echo refusing; exit 1;; esac
S="$D/state"; C=chain-x-20261001-000000-aaaa
mkdir -p "$S/dispatcher" "$S/runner" "$S/dispatch-chains/$C" "$S/dispatch-souls/dispatch-x-1" || exit 1
export DISPATCHER_HOME="$S/dispatcher" EXECUTE_LEDGER_STATE_DIR="$S" PLAN_RUNNER_STATE_DIR="$S/runner"
python3 -c "import time; time.sleep(60)" soul-run dispatch-x-1 & SOUL=$!
echo $SOUL > "$S/dispatch-souls/dispatch-x-1/launcher.pid"
python3 - "$S/dispatch-chains/$C" "$C" <<'PY'
import json, sys, time
d, i = sys.argv[1:3]
json.dump({"id": i, "slug": "x", "agent": "hephaestus", "cwd": "/tmp", "add_dirs": [], "docs": True, "pause": True,
           "builder_brief": d + "/b.md", "break_it": None, "rulings": None, "fix_round": 0, "status": "running",
           "stage": "builder", "targets": [], "flags": [], "cause": "", "failed_stage": None, "started_at": time.time(),
           "updated_at": time.time(), "unattributed": [], "resume_at": None, "ruled": False,
           "stages": [{"name": "builder", "attempt": 1, "launch": "dispatch-x-1", "provider": "claude",
                       "status": "waiting", "at": time.time()}]}, open(d + "/chain.json", "w"))
PY
for n in 1 2 3; do ( time timeout 60 ~/.claude/scripts/soul-back "$C" ) 2>&1 | grep -oE "STILL RUNNING|real.*"; done
kill $SOUL; wait 2>/dev/null
case "$D" in /tmp/athena-probe-held-*) rm -r "$D";; esac
```

measured 2026-10-01 by chain chain-metis-foreground-wait-20261001-165407-e80a, finding M1, MEDIUM
probe-key: a687bea1bcba6afd52d5005b40205ef04d58ad0a

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/brief/chapters/recovery.md, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/brief/METIS.md, /home/lyphe/.claude/hooks/plan_runner/solo/chain_adopt.py, /home/lyphe/.claude/scripts/soul-back, /home/lyphe/.claude/skills/inline/SKILL.md

## INV-6327 — probe — MEDIUM — `blocked` is a `--resume` case in one rule and a `file_issue` case in another, inside her one prompt

MEDIUM — `blocked` is a `--resume` case in one rule and a `file_issue` case in another, inside her one prompt

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/brief && grep -c '`dead` or `blocked`' chapters/recovery.md; grep -c '\*\*`nothing-changed`\*\* or \*\*`blocked`\*\* → `file_issue`' METIS.md
```

measured 2026-10-01 by chain chain-metis-foreground-wait-20261001-165407-e80a, finding M2, MEDIUM
probe-key: 140b2e8b70c77888e713f170dea02952fe789488

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/brief/chapters/recovery.md, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/brief/METIS.md, /home/lyphe/.claude/hooks/plan_runner/solo/chain_adopt.py, /home/lyphe/.claude/scripts/soul-back, /home/lyphe/.claude/skills/inline/SKILL.md

## INV-6328 — probe — LOW — claims this diff made false, left in place (healed means deleted)

LOW — claims this diff made false, left in place (healed means deleted)

```probe
cd /home/lyphe/.claude && grep -c 'imports no `plan_runner`' hooks/plan_runner/solo/chain_adopt.py hooks/INVARIANTS.md; scripts/docstore get INV-40 | python3 -c "import json,sys; b=json.load(sys.stdin)['row']['body']; print('10800' in b, '#29 holds' in b)"
```

measured 2026-10-01 by chain chain-metis-foreground-wait-20261001-165407-e80a, finding L2, LOW
probe-key: 883e8e89df2f74eaeb5d571680ac69ed8e156a37

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/brief/chapters/recovery.md, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/brief/METIS.md, /home/lyphe/.claude/hooks/plan_runner/solo/chain_adopt.py, /home/lyphe/.claude/scripts/soul-back, /home/lyphe/.claude/skills/inline/SKILL.md

## INV-6329 — probe — INV-4355 and a `store_arcs.py` docstring still say a fenced typo becomes `deepseek`

INV-4355 and a `store_arcs.py` docstring still say a fenced typo becomes `deepseek`

```probe
cd /home/lyphe/.claude && docstore get INV-4355 | python3 -c "import sys,json,re; b=json.load(sys.stdin)['row']['body']; print(re.findall(r'silent .deepseek.', b))"; rg -n "never a silent" hooks/dispatcher/store_arcs.py; PYTHONPATH=$HOME/.claude/hooks python3 -c "from dispatcher import model; print(model.clean('deepseekk'))"
expect: [] , then a store_arcs.py line that does not name `deepseek`, then `claude` (today: `['silent `deepseek`']`, then line 522 ending "never a silent `deepseek`.", then `claude`)
```

measured 2026-10-01 by chain chain-plan-model-default-claude-20261001-165404-dcb1, finding L1, LOW
probe-key: 64905667859c70b3b1fe440f60d1fe69f8225173

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/hooks/dispatcher/model.py, /home/lyphe/.claude/hooks/dispatcher/store_arcs.py, /home/lyphe/.claude/hooks/dispatcher/width.py

## INV-6331 — probe — a keyboard reader cannot reach a page's options: focus never follows the strip, and Tab always enters page 1

a keyboard reader cannot reach a page's options: focus never follows the strip, and Tab always enters page 1

```probe
node /home/lyphe/.claude/state/pipeline-reviews/round-questions-strip/probe-kb-focus.mjs
expect: `(1) after one Tab from the strip: focus is "Option A1" on page 0; the strip now shows page [0]` and `(2) next Tab: focus "Option B1" on page 0; the strip now shows page [0]` (page numbers 0-based)
```

measured 2026-10-01 by chain chain-round-questions-strip-20261001-185557-37ce, finding M1, MEDIUM
probe-key: 8cb50b01d1d0c126e77e0d66379ab2583f0f21b1

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/DeckStrip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useSnapStrip.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/RoundAnswer.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/SnapStrip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/deck-strip.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/round-strip.mjs

## INV-6332 — probe — `Other…` pressed with its page ending at the fold: the field it focused ends up below the fold

`Other…` pressed with its page ending at the fold: the field it focused ends up below the fold

```probe
node /home/lyphe/.claude/state/pipeline-reviews/round-questions-strip/probe-other-clip.mjs
expect: `field focused: true; field fully on screen: false; field inside the strip: true`
```

measured 2026-10-01 by chain chain-round-questions-strip-20261001-185557-37ce, finding L2, LOW
probe-key: a5bee074e70adb8020be57e8b30dd91d330a442e

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/DeckStrip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useSnapStrip.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/RoundAnswer.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/SnapStrip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/deck-strip.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/round-strip.mjs

## INV-6333 — probe — a second tap on the same spot after a pick answers the NEXT question, unread

a second tap on the same spot after a pick answers the NEXT question, unread

```probe
node /home/lyphe/.claude/state/pipeline-reviews/round-questions-strip/attack3.mjs
expect: `[tap again after 300ms] radios chosen: ["Beta","Epsilon"]; marks=✓ ✓ 3; inView=[2]`
```

measured 2026-10-01 by chain chain-round-questions-strip-20261001-185557-37ce, finding L3, LOW
probe-key: 9c331f8473e0061d9935cf9e2eca03f5d0ae6362

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/DeckStrip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useSnapStrip.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/RoundAnswer.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/SnapStrip.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/deck-strip.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/round-strip.mjs

## INV-6334 — probe — `.verify/lib/round-strip.mjs` waits a fixed 500ms for the live door and fails when it is slower

`.verify/lib/round-strip.mjs` waits a fixed 500ms for the live door and fails when it is slower

```probe
node /home/lyphe/.claude/state/pipeline-reviews/round-questions-strip/rerun-libs.mjs
expect: `[FAIL] desktop · typed words answer it again, and the strip is still on question 2` and `[FAIL] phone · …` then `libs re-run: 178 OK, 2 FAIL` — environment-dependent: needs the live door's first refusal of the fixture ask to take over ~500ms (a cold store read, ~1.1s here); on a warm door it prints `0 FAIL`
```

measured 2026-10-01 by chain chain-round-questions-strip-20261001-185557-37ce, finding L4, LOW
probe-key: 54149458d07cbcddbee02204782fba2fc01824b0

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/round-strip.mjs

## INV-6335 — The purple dot's launcher reader restates four launcher rules — change each with its source

`running-launchers.service.ts` and `chain-record.transport.ts` read records the launcher owns (INV-36). Each restated rule below moves with its source, or the dot goes dark or lights over a corpse with nothing failing.

| Reader copy | Source | Breaks if they drift |
|---|---|---|
| `SAFE_RECORD_ID` = `^[A-Za-z0-9_-]+$`, no length cap | `SAFE_ID_RE` in `hooks/plan_runner/state_lock.py` | A looser launcher id is skipped, so its chain lights no dot; a stricter one lets the reader join an id the launcher refuses. A length cap here drops every chain with a long slug. |
| `isWalkerAlive`: `/proc/<pid>/cmdline` carries `chain-run` AND the chain id | `walker_alive` in `hooks/plan_runner/solo/chain_state.py` | A weaker test pins the dot on over a killed walker; a stronger one blinks it. |
| `RUNNING_WINDOW_S` = 6 h | `LAUNCH_KEEP_S` in `dispatch-souls.module.ts`; stays above `HOUR_S` and `PLANNER_CAP_S` in `solo/record.py` | Raise either cap past 6 h and a live soul leaves the dot mid-run. |
| `chainsRootBeside(soulsRoot)` = sibling `dispatch-chains` | `chains_dir()` in `solo/chain_state.py` | A probe's `DISPATCH_SOULS_STATE_DIR` stops moving the chains with the souls. |

- The souls root comes only from `dispatchSoulsStateDir()` (`server/shared/utils.ts`); never re-read `DISPATCH_SOULS_STATE_DIR` or hardcode the default.
- Ownership is the `launched_by` stamp on `spec.json`, nothing else; a chain is owned by every session stamped on any of its stages.
- A planner outing or phase chain is stamped with the plan's session, so it lights that plan's chat up to the 4 h planner cap; there is no role filter.
- A chain started with no session to name carries no stamp and lights nothing (follow-up: stamp `launched_by` in `chain_state.blank()`, a `chain.json` schema change).

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/chain-record.transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/running-launchers.service.ts

## INV-6336 — probe — a fresh chain owns nothing until its first stage has a spec; the dot is dark for seconds

a fresh chain owns nothing until its first stage has a spec; the dot is dark for seconds

```probe
python3 /home/lyphe/.claude/state/pipeline-reviews/purple-dot-souls/athena-probes/chain-start-lag.py
expect: `chains 200 | seconds with a chain running and no stage launch to name an owner: median 4.8 p90 17.1 max 62.2` (figures drift a little; median several seconds, max a minute)
```

measured 2026-10-02 by chain chain-purple-dot-souls-20261002-043723-dbad, finding L1, LOW
probe-key: a74ae0c43e064715765e05748c71d907c75ecf68

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/chain-record.transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/running-launchers.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/utils.ts

## INV-6337 — probe — the reader's id fence is tighter than the launcher's: a chain id over 120 characters is never counted

the reader's id fence is tighter than the launcher's: a chain id over 120 characters is never counted

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && TSX_TSCONFIG_PATH=server/tsconfig.json timeout 90 node --import tsx /home/lyphe/.claude/state/pipeline-reviews/purple-dot-souls/athena-probes/long-chain-id.mjs
expect: `id length 127: launcher walker_alive=True | dot reader counts it=false` — and `id length 32: … counts it=true`
```

measured 2026-10-02 by chain chain-purple-dot-souls-20261002-043723-dbad, finding L2, LOW
probe-key: 9686bb9886de60f111e500376e0adfb69f7376ff

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/chain-record.transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/running-launchers.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/utils.ts

## INV-6338 — probe — the MANUAL says planner outings are stamped with no chat and not counted; 75 of 75 are stamped, and the reader has no role filter

the MANUAL says planner outings are stamped with no chat and not counted; 75 of 75 are stamped, and the reader has no role filter

```probe
python3 /home/lyphe/.claude/state/pipeline-reviews/purple-dot-souls/athena-probes/planner-stamp.py
expect: `75 planner specs; 75 stamped with a chat id` (the doc says planner outings are stamped with no chat)
```

measured 2026-10-02 by chain chain-purple-dot-souls-20261002-043723-dbad, finding L3, LOW
probe-key: ffc32abe2911d78e293fa4b8a6bb821583317862

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/chain-record.transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/running-launchers.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/utils.ts

## INV-6339 — probe — three exports lack the consumer comment the backend standards ask for

three exports lack the consumer comment the backend standards ask for

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -rn "ChainRecord\b" server --include=*.ts | grep -v "chain-record.transport.ts"; echo "[probe exit $?]"
expect: no lines and `[probe exit 1]` — no importer of the exported type
```

measured 2026-10-02 by chain chain-purple-dot-souls-20261002-043723-dbad, finding L4, LOW
probe-key: 6f13394c38a4241eed44f442e0fe08293b18f959

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/chain-record.transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/running-launchers.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/utils.ts

## INV-6340 — probe — A page that has been open a while never sees another device's draft, and its first keystroke replaces that draft whole

A page that has been open a while never sees another device's draft, and its first keystroke replaces that draft whole

```probe
node /home/lyphe/.claude/state/pipeline-reviews/ask-drafts/athena-probes/s6.mjs
expect: `[FAIL] LONG-LIVED phone page, 8 s after the desktop saved: shows the desktop's draft? -> {"rework":true,"notes":null}` and `[FAIL] after the phone typed, the account's draft is "phone note" (desktop's words GONE)`; after a reload the phone page shows `"notes":"phone note"`
```

measured 2026-10-02 by chain chain-ask-drafts-20261002-042748-c2a8, finding L1, LOW
probe-key: d0db172d5740b6438abd2c8c598432ab72545a8f

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/AskDraftPrune.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/askDrafts.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useAskDraft.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-ask-drafts.mjs

## INV-6341 — probe — The prune deletes a draft on the first frame without its ask, but an open ask can leave the lane and come back under the same identity; two comments say it cannot

The prune deletes a draft on the first frame without its ask, but an open ask can leave the lane and come back under the same identity; two comments say it cannot

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/ask-drafts/athena-probes/gap.sh && node /home/lyphe/.claude/state/pipeline-reviews/ask-drafts/athena-probes/s9.mjs
expect: `asking while the outing is live: null`, then `SAME identity as before the gap: true`; then `entries while the ask was off the lane: 0; after the SAME ask (910001-2026-10-01T12:00:00Z) returned: entries=0, notes field=null`
```

measured 2026-10-02 by chain chain-ask-drafts-20261002-042748-c2a8, finding L2, LOW
probe-key: 72ec8cd169ddae4ac49fef2a4430c3e93cf8b51f

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/AskDraftPrune.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/askDrafts.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useAskDraft.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-ask-drafts.mjs

## INV-6342 — probe — The builder's probe writes whole lists to the shared account, which wipes any concurrent writer's entries (INV-4406 says never whole)

The builder's probe writes whole lists to the shared account, which wipes any concurrent writer's entries (INV-4406 says never whole)

```probe
node /home/lyphe/.claude/state/pipeline-reviews/ask-drafts/athena-probes/s11.mjs
expect: `bystander entry present before: true`, then `bystander entry present after the probe's whole-list write: false`
```

measured 2026-10-02 by chain chain-ask-drafts-20261002-042748-c2a8, finding L3, LOW
probe-key: 0b072066a79008946c0e4064ce981cff325817f1

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/AskDraftPrune.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/askDrafts.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useAskDraft.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-ask-drafts.mjs

## INV-6394 — The operator's words — CloudCLI names an arc an epic, a plan a feature, a phase a task; the house's code keeps arc, plan, phase

CloudCLI's text names arcs, plans and phases as epics, features and tasks. Identifiers, store words, CLI verbs and their stdout, hook names, plan files and charters keep arc, plan and phase. The house's text to the operator — its prompt and the roadmap's DocSpace page — carries his words (below).

| the house's word | CloudCLI's text | plurals, possessives and counted plurals follow |
|---|---|---|
| arc | epic | arcs → epics, arc's → epic's, arc(s) → epic(s) |
| plan | feature | plans → features, plan(s) → feature(s) |
| phase | task | phases → tasks, phase(s) → task(s) |
| plan runner, plan chains | the runner, runner chains | — |

**CloudCLI's own words — where they are written**
- The en locale: `src/modules/i18n/locales/en/{common,chat,settings}.json`.
- The roadmap screen: the `roadmap` block of `en/common.json` (MAN-7634) and the Roadmap tab's `tabs.runner`, `runner.title`, `runner.empty` (MAN-7654). It says milestone, epic, feature and task everywhere, and shows a slug only as the `Name for Claude: <name>` line of a feature's dialog (MAN-7645).
- The `defaultValue` beside a key: the drawn text when its key is absent, the fallback when present — both carry the new words (`ComposerDeepSeekSwitch.tsx`, `RunnerModelContent.tsx` with its five `agents.runnerSwarm.*` keys no locale holds, `RunnerParkAtPeakRow.tsx`).
- The command palette's `Go to Roadmap` keywords carry both vocabularies (`CommandPalette.tsx`).
- The ten other locales hold none of the dispatcher keys and fall back to English. Their values whose English changed say what the new English says: `chat.json` `input.deepseekFlashTooltip`, `settings.json` `agents.runnerModel.description`, fr `agents.runnerParkAtPeak.*`. "plan runner" is "runner" in them, left in English.
- The push copy: `notification-copy.service.ts` — `Feature finished`, `Epic finished`, `Feature paused`, `Features paused …`, `Task relaunched`, `Task <key> was taken up again`, `<done>/<n> tasks`.
- The server's two sentences: `NO_ANSWER.timeout` (`server/shared/dispatcher-command.ts`), `OTHER_PROCESS_EXAMPLES` (`claude-activity.service.ts`).

**A house sentence a dispatcher surface relays verbatim** passes through `operatorWords` (MAN-7596) where it is drawn, and nowhere else:
- `useDispatcherVerbs` — the verb toast.
- `PlanFace` — the caption's posture.
- `PlannerBadge` — the cause a planner outing ended on.
- `useRoadmapWrites` — the refusal toast of a roadmap write (its success toasts are written in the locale, `roadmap.toast.*`).
- The dispatcher's own bytes never change.

**The house's text to the operator** carries his words at its own home:
- `lock._count` — `<N> tasks`, `, <K> done`.
- `lock_glance.facts_line` — `Epic <arc>`, `<N> tasks in <W> waves`.
- `intent_lock.DESCRIPTIONS` — the Accept and Rework descriptions.
- `roadmap_mirror` — the DocSpace copy of each roadmap: the page says milestone, epic, feature and task, and states each feature's step as a plain phrase composed in `_STEP_PHRASES` and `step_phrase` (MAN-7624).
- Untouched in the prompt: `LOCK_HEADER`, `OPTIONS` and their labels, `TOKEN_RE`, `names_of`, and every input of `lock.token`. why: the vet reads the first line and the last token; an outstanding token must stand.

**The slash doors**: `/feature` is `/plan`, `/epic` is `/arc` (`skills/feature/SKILL.md`, `skills/epic/SKILL.md`). Each loads its skill and runs that sequence; nothing of the sequence lives in the door.

**Authored text is drawn as written**: a plan's name, goal, `delivers`, phase titles, the events feed, the stage lines, a roadmap's, milestone's, epic's and feature's title and goal.

**Keeps arc, plan, phase**
- Identifiers and store words: `plans`, `phases`, `arcs`, `plan.arc`, `DispatcherPlan`.
- CLI verbs and their stdout: `LOADED phases <name> — <N> phases`, `RESUMED <arc>.arc — 2 plan(s)`.
- Hook names, plan files (`plans/<arc>.arc.toml`), charters, the `plan-runner` command.
- A row's prose about the code.

**Other senses stay**
- Plan mode: `plan.*`, `codex.modes.plan`, `composer.editMode.*.plan` in `chat.json`, the ExitPlanMode push (`Plan ready for approval`).
- Plan limits: `pluginSettings.claudeUsagePlugin.description`, `pluginSettings.codexUsagePlugin.description`.
- A kanban card's plan: `kanban.approve.blockedByEmptiness`.
- The planner role: `Planner lanes`, `Resume planner`.

| when | do |
|---|---|
| a new CloudCLI string names an arc, plan or phase | write epic, feature, task, in the locale and in its `defaultValue` |
| a house sentence reaches the DOM verbatim | draw it through `operatorWords` where it is drawn; add the reader to MAN-7596 |
| the house prompts the operator | write his words at the sentence's own home; leave every input of the token alone |
| the house writes the operator a page (the DocSpace roadmap) | write his words where the page is composed (`roadmap_mirror`); no token is involved |
| a row quotes an operator string | quote the new word; prose about the code keeps the code word |

Proof — prints exactly the eight other-sense keys above:
`cd claudecodeui_lyphe && python3 -c "import json,re,glob;w=lambda d,p='':[x for k,v in d.items() for x in (w(v,p+k+'.') if isinstance(v,dict) else [(p+k,v)])];print(sorted(k for f in glob.glob('src/modules/i18n/locales/en/*.json') for k,v in w(json.load(open(f))) if isinstance(v,str) and re.search(r'\b(plans?|arcs?|phases?)\b',re.sub(r'\{\{[^}]*\}\}','',v),re.I)))"`

Translator contract: MAN-7596. Push wording: MAN-622. The prompt's census and facts line: MAN-6047, MAN-1475.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/services/notification-copy.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/operatorWords.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/, /home/lyphe/.claude/hooks/dispatcher/lock_glance.py, /home/lyphe/.claude/hooks/dispatcher/lock.py, /home/lyphe/.claude/hooks/dispatcher/roadmap_mirror.py, /home/lyphe/.claude/hooks/intent_lock.py, /home/lyphe/.claude/skills/epic/, /home/lyphe/.claude/skills/feature/

## INV-6398 — probe — `.verify/probe-dismiss-done.mjs` cannot run, and its edited labels were never run (LOW)

`.verify/probe-dismiss-done.mjs` cannot run, and its edited labels were never run (LOW)

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && timeout 60 node .verify/probe-dismiss-done.mjs >/dev/null 2>&1; echo rc=$?
expect: rc=1 (throws "the lane carries no wholly done restorly arc" at probe-dismiss-done.mjs:393 while the lane holds no done restorly arc); it writes nothing before that throw
```

measured 2026-10-02 by chain chain-vocab-epics-features--whole-20261002-174523-3a6d, finding L2, LOW
probe-key: 5984e86a1cdc1efcb750386267e414d32efad24a

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dismiss-done.mjs

## INV-6508 — probe — MAN-6358, which governs `probe-swarm-ceiling.mjs`, still describes the ladder the builder removed

MAN-6358, which governs `probe-swarm-ceiling.mjs`, still describes the ladder the builder removed

```probe
cd /home/lyphe/.claude && docstore get MAN-6358 | python3 -c "import sys,json; b=json.load(sys.stdin)['row']['body']; print({k: (k in b) for k in ['no upper bound', 'Unlimited\` action', 'first count']})"
echo "[probe exit $?]"
expect: {'no upper bound': False, 'Unlimited` action': False, 'first count': False} (today: True for all three)
```

measured 2026-10-03 by chain chain-swarm-ladder-20261003-135357-11f2, finding M1, MEDIUM
probe-key: 7122ea9a970501d9f3937c9fc0d186dd2d965332

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/SwarmControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/RunnerModelContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/constants.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useSwarmSwitch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Stepper.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/controls.css, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/settings-rows-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/swarm-stub.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-plan-swarm.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-settings-rows.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-swarm-ceiling.mjs

## INV-6509 — probe — a screen reader hears the default marker glued to the number: "Alldefault"

a screen reader hears the default marker glued to the number: "Alldefault"

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node /home/lyphe/.claude/state/pipeline-reviews/swarm-ladder/athena-probes/marker.mjs a11y 2>&1 | grep -v Bearer | tail -2
echo "[probe exit $?]"
expect: accessible text of the value: ["- text: All default"] (today: ["- text: Alldefault"]); the page is stubbed, witness UNCHANGED
```

measured 2026-10-03 by chain chain-swarm-ladder-20261003-135357-11f2, finding L1, LOW
probe-key: 5a6f8e02adaf53afa259314d233acf1f8dbcbf9c

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/SwarmControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/RunnerModelContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/constants.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useSwarmSwitch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Stepper.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/controls.css, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/settings-rows-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/swarm-stub.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-plan-swarm.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-settings-rows.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-swarm-ceiling.mjs

## INV-6510 — probe — the default marker is 3.34:1 in light and 4.32:1 in dark, at 10px

the default marker is 3.34:1 in light and 4.32:1 in dark, at 10px

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node /home/lyphe/.claude/state/pipeline-reviews/swarm-ladder/athena-probes/marker.mjs contrast 2>&1 | grep -v Bearer | tail -3
echo "[probe exit $?]"
expect: both lines read ≥ 4.50:1 (today: `marker contrast light: 3.34:1 at 10px`, `marker contrast dark: 4.32:1 at 10px`)
```

measured 2026-10-03 by chain chain-swarm-ladder-20261003-135357-11f2, finding L2, LOW
probe-key: 46dad8a0b3462e4ac64ecf80ccf5d38e05c76eb0

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/SwarmControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/RunnerModelContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/constants.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useSwarmSwitch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Stepper.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/controls.css, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/settings-rows-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/swarm-stub.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-plan-swarm.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-settings-rows.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-swarm-ceiling.mjs

## INV-6511 — probe — `.verify/lib/settings-rows-walk.mjs:64` names the removed ghost `Unlimited` button, and its stub is no longer the widest swarm row

`.verify/lib/settings-rows-walk.mjs:64` names the removed ghost `Unlimited` button, and its stub is no longer the widest swarm row

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && (grep -n "ghost" .verify/lib/settings-rows-walk.mjs || echo none); node /home/lyphe/.claude/state/pipeline-reviews/swarm-ladder/athena-probes/row-width.mjs 2>&1 | grep -v Bearer | grep "^3 lanes 390\|^Unlimited 390" | cut -c1-70
echo "[probe exit $?]"
expect: `none`, and the stub the walk answers (`lanes: 3`) is the widest state, i.e. its stepperW ≥ the Unlimited row's (today: line 64 names the ghost; stepperW 122 against 138)
```

measured 2026-10-03 by chain chain-swarm-ladder-20261003-135357-11f2, finding L3, LOW
probe-key: 766b23f13ec49c5a3ef27094517bcf237da76553

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/settings-rows-walk.mjs

## INV-6512 — probe — the new probes narrate the retired control

the new probes narrate the retired control

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && (grep -n "retired\|used to draw\|previous form" .verify/probe-plan-swarm.mjs .verify/probe-swarm-ceiling.mjs || echo none)
echo "[probe exit $?]"
expect: `none` (today: four lines — probe-plan-swarm.mjs:23, :24, :337 and probe-swarm-ceiling.mjs:30)
```

measured 2026-10-03 by chain chain-swarm-ladder-20261003-135357-11f2, finding L4, LOW
probe-key: 75d20a8f01bbe3701187b5709175a175bec3f439

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/SwarmControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/RunnerModelContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/constants.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useSwarmSwitch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Stepper.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/controls.css, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/settings-rows-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/swarm-stub.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-plan-swarm.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-settings-rows.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-swarm-ceiling.mjs

## INV-6513 — probe — three comments say a wide count stays reachable both ways, and on the Settings row it isn't

three comments say a wide count stays reachable both ways, and on the Settings row it isn't

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && timeout 100 node /home/lyphe/.claude/state/pipeline-reviews/swarm-ladder/athena-probes/wide-roundtrip.mjs 2>&1 | grep -v Bearer | tail -2; grep -n "reachable both ways\|out of reach in either direction" src/shared/constants.ts src/shared/utils.ts src/modules/settings/tabs/agents-settings/sections/content/RunnerModelContent.tsx | cut -c1-90
echo "[probe exit $?]"
expect: either the round trip reads `9 lanes | − → 8 lanes | + → 9 lanes`, or the grep prints no line (today: `+ → Unlimited`, and three lines; the box is stubbed, swarm.flag UNCHANGED)
```

measured 2026-10-03 by chain chain-swarm-ladder-20261003-135357-11f2, finding L5, LOW
probe-key: aa8eaedbd9cdb361aafbc13b377aa7539a02bf49

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/SwarmControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/RunnerModelContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/constants.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useSwarmSwitch.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Stepper.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/controls.css, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/settings-rows-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/swarm-stub.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-plan-swarm.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-settings-rows.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-swarm-ceiling.mjs

## INV-6519 — probe — MEDIUM — the builder's docs edits did not survive; the estate again teaches `ArcMark`, `data-arc-mark` and `dispatcher.arcMark`, and the new standing proof is undocumented

MEDIUM — the builder's docs edits did not survive; the estate again teaches `ArcMark`, `data-arc-mark` and `dispatcher.arcMark`, and the new standing proof is undocumented

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && echo "kind-tag mentions in docs/MANUAL.md: $(grep -c 'data-kind-tag\|probe-kind-tags' docs/MANUAL.md)"; echo "lines naming the deleted ArcMark / data-arc-mark / dispatcher.arcMark: $(grep -c 'data-arc-mark\|arcMark\|ArcMark' docs/MANUAL.md)"; for t in MAN-5706 MAN-5716 MAN-6797 MAN-6810; do printf '%s deleted-name hits: ' $t; (cd ~/.claude && docstore get $t | python3 -c "import sys,json; b=json.load(sys.stdin)['row']['body']; print(b.count('data-arc-mark')+b.count('arcMark')+b.count('ArcMark'))"); done
echo "[probe exit $?]"
expect: kind-tag mentions of 3 or more, then 0 deleted-name lines, and 0 hits in each of the four rows (today: 0, 4, and 3 / 1 / 2 / 1)
```

measured 2026-10-03 by chain chain-kind-tags-20261003-140320-3897, finding M1, MEDIUM
probe-key: 9cbff8c793881d65d595db195c0d67ee7da0745b

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/controls.css, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/tokens.css, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-kind-tags.mjs

## INV-6548 — a new top-level server/shared/*.ts file must join .oxlintrc.json's backend-shared-utils list

`boundaries/include` covers every `server/**/*.ts`, but a file directly in `server/shared/` is a known element only when `.oxlintrc.json` names it: `types`, `interfaces`, `index.ts` and the `backend-shared-utils` `pattern` array hold the list. A file outside it is an unknown element; every importer errors `boundaries(no-unknown)`.

- symptom: `npx oxlint server/` reports `error boundaries(no-unknown): Dependencies to unknown elements are not allowed` on the import line of each importer, not on the new file.
- fix: add the file's path to the `backend-shared-utils` `pattern` array in the same change that creates it. `server/shared/roadmap-types.ts`, `dispatcher-command.ts` and `document-fields.ts` are listed this way.
- measured 2026-10-03: `server/shared/roadmap-types.ts` removed from a copy of the config → `server/modules/roadmap/roadmap-write.service.ts:1:46: error boundaries(no-unknown)`, exit 1; with the entry, exit 0.
- measure with the scratch copy beside `.oxlintrc.json` and remove it by its literal name: 2026-10-03, the same copy under a `mktemp -d` directory exited 0 with and without the entry.
- frontend counterpart: INV-5890.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json

## INV-6549 — probe — two 400 sentences say "a arc"

two 400 sentences say "a arc"

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && TSX_TSCONFIG_PATH=server/tsconfig.json npx tsx -e "import('./server/modules/roadmap/roadmap-write.service.ts').then((m) => console.log(m.writeArgv('add', { kind: 'arc', title: 'T' }), '|', m.writeArgv('add', { kind: 'arc', title: 'T', parent: 'x', project: 'p' })))"
expect: parent is required: the milestone a arc belongs to | a arc takes no project
```

measured 2026-10-03 by chain chain-roadmap--lane--contract-20261003-164520-4b5e, finding L1, LOW
probe-key: fd2c4fcc2acd6bc8e84e627948163ceab03bf0e4

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap-write.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/roadmap-types.ts

## INV-6551 — probe — six of the 14 exported types name no consumer

six of the 14 exported types name no consumer

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && python3 -c "
import re
t=open('server/shared/roadmap-types.ts').read()
print([m.group(2) for m in re.finditer(r'(/\*\*(?:(?!\*/).)*?\*/)\s*export type (\w+)', t, re.S) if not re.search(r'onsumer', m.group(1))] or 'none')"
expect: ['RoadmapTask', 'RoadmapFeature', 'RoadmapEpic', 'RoadmapMilestone', 'Roadmap', 'RoadmapPicture']
```

measured 2026-10-03 by chain chain-roadmap--lane--contract-20261003-164520-4b5e, finding L3, LOW
probe-key: 2c908dd059142b1c7344624ad97139f4e7bb5103

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap-write.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/roadmap-types.ts

## INV-6552 — probe — an oversized document is reported as a prefix of itself, and the moved comment claims otherwise (carried from HEAD, now in the shared file)

an oversized document is reported as a prefix of itself, and the moved comment claims otherwise (carried from HEAD, now in the shared file)

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && D=$(mktemp -d /tmp/athena-probe-XXXXXX) && case "$D" in /tmp/athena-probe-*) ;; *) exit 1;; esac; printf '#!/bin/sh\nprintf "{\\"plans\\":[],\\"pad\\":\\""\nhead -c 4300000 /dev/zero | tr "\\0" " "\nprintf "\\"}"\n' > $D/big && chmod +x $D/big && printf "import { readDispatcherJson } from '/home/lyphe/.claude/claudecodeui_lyphe/server/shared/dispatcher-command.ts';\ntry { await readDispatcherJson(['status','--json'], { bin: '$D/big', timeoutMs: 8000, env: { PATH: process.env.PATH ?? '' } }, 4*1024*1024); console.log('read ok'); } catch (e) { console.log((e as Error).message); }\n" > $D/p.mts && TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx $D/p.mts; cd /tmp && case "$D" in /tmp/athena-probe-*) rm -r "$D";; esac
expect: it prints `dispatcher status --json did not answer: {"plans":[],"pad":"` — the body's prefix with no word about the buffer; cured when the sentence names the exceeded buffer
```

measured 2026-10-03 by chain chain-roadmap--lane--shared-20261003-164519-da13, finding L1, LOW
probe-key: f1778cd254d156aee051e86598cd6ed9f5dedbbb

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-verb.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/dispatcher-command.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/document-fields.ts

## INV-6559 — probe — the row's Traps section quotes a hub refusal the hub does not give

the row's Traps section quotes a hub refusal the hub does not give

```probe
D=$(mktemp -d /tmp/roadmap-probe.XXXXXX) && mkdir -p "$D/state" && printf 'DP=$HOME/.claude/scripts/dispatcher\n$DP roadmap add roadmap pr --title P >/dev/null\n$DP roadmap add milestone goal --roadmap pr --title G >/dev/null\n$DP roadmap mirror 2>&1 >/dev/null | grep "refused page-roadmap-pr" || echo "no refusal"\n' > "$D/p.sh" && DISPATCHER_HOME="$D/state" ~/.claude/docstore/bin/scratch-archpulse 8049 http://127.0.0.1:1 bash "$D/p.sh"; case "$D" in /tmp/roadmap-probe.*) rm -rf "$D";; esac; ~/.claude/scripts/docstore get MAN-7624 --text | grep -n 'goal` or `about' | cut -c1-200 || echo "row line gone"
expect: the first line is `refused page-roadmap-pr: the hub answered 400: invalid: page "page-roadmap-pr": two blocks share the id "blk-roadmap-pr-goal"`; the defect stands while the row's line (82) quotes `UNIQUE constraint failed: blocks.id` for this case; cured when the row quotes the "two blocks share the id" text for `goal`/`about` and gives the UNIQUE text to the cross-page collision
```

measured 2026-10-03 by chain chain-roadmap--mirror--docs-20261003-170800-0dca, finding M1, MEDIUM
probe-key: a9ee10e6e793fba7abbb699de4dd5a34fbdd356d

governs: /home/lyphe/.claude/claudecodeui_lyphe/

## INV-6560 — probe — "`dry_run` counts what a write would do" is false for a refusal

"`dry_run` counts what a write would do" is false for a refusal

```probe
D=$(mktemp -d /tmp/roadmap-probe.XXXXXX) && mkdir -p "$D/state" && printf 'DP=$HOME/.claude/scripts/dispatcher\n$DP roadmap add roadmap probe-mirror --title P >/dev/null\necho "dry:  $($DP roadmap mirror --dry-run 2>/dev/null)"\necho "real: $($DP roadmap mirror 2>/dev/null)"\n' > "$D/p.sh" && DISPATCHER_HOME="$D/state" ~/.claude/docstore/bin/scratch-archpulse 8049 http://127.0.0.1:1 bash "$D/p.sh"; case "$D" in /tmp/roadmap-probe.*) rm -rf "$D";; esac; ~/.claude/scripts/docstore get MAN-7624 --text | grep -n 'dry_run` counts' | cut -c1-160 || echo "row line gone"
expect: `dry:` prints `created 1 · … · refused 0` and `real:` prints `created 0 · … · refused 1` (the two differ for the same store); the defect stands while the row says a dry run counts what a write would do with no exception for a refusal
```

measured 2026-10-03 by chain chain-roadmap--mirror--docs-20261003-170800-0dca, finding L1, LOW
probe-key: cb7e0e9611342c8c5d7f045bda1449c03583655f

governs: /home/lyphe/.claude/claudecodeui_lyphe/

## INV-6561 — probe — "No page is ever deleted" does not carry its why, and the consequence the phase itself hit is not in the row

"No page is ever deleted" does not carry its why, and the consequence the phase itself hit is not in the row

```probe
~/.claude/scripts/docstore get MAN-7624 --text | python3 -c "
import sys
t=sys.stdin.read().splitlines()
line=[l for l in t if l.startswith('- No page is ever deleted')]
print('bullet:',[l[:110] for l in line] or 'gone')
print('why on the bullet:', any('tombston' in l or 'refuses it' in l for l in line))
print('burnt-name consequence in row:', any(('same name' in l or 'name is burnt' in l or 'burnt' in l or 'never be recreated' in l) for l in t))"
expect: `bullet:` prints the line; the defect stands while `why on the bullet: False` and `burnt-name consequence in row: False`; cured when the bullet carries its why and the row names the burnt-name consequence
```

measured 2026-10-03 by chain chain-roadmap--mirror--docs-20261003-170800-0dca, finding L2, LOW
probe-key: d72b3b33953d8cd742f3fa1eb16221773bf2dce4

governs: /home/lyphe/.claude/claudecodeui_lyphe/

## INV-6562 — probe — INV-6394's new bullet sits under a heading, a lede and a when/do row that say "prompt"

INV-6394's new bullet sits under a heading, a lede and a when/do row that say "prompt"

```probe
~/.claude/scripts/docstore get INV-6394 --text | grep -n -E "^\*\*The house's prompt to the operator\*\*|^- \`roadmap_mirror\`|^\| the house prompts the operator|^The house's prompt|prompt to the operator carries his words \(below\)" | cut -c1-170
expect: lines 5 (the lede that says "prompt"), 28 (the heading that says "prompt"), 32 (the `roadmap_mirror` bullet under it) and 55 (the when/do row that says "prompts the operator") all print; the defect stands while the heading names only the prompt; cured when the heading and the when/do row name text to the operator (prompt and page), or the bullet says why it belongs
```

measured 2026-10-03 by chain chain-roadmap--mirror--docs-20261003-170800-0dca, finding L3, LOW
probe-key: 45690ac0df834e60c26f0bc4352f93c71c803c56

governs: /home/lyphe/.claude/claudecodeui_lyphe/

## INV-6563 — probe — MAN-7624 governs a third path the intent does not name

MAN-7624 governs a third path the intent does not name

```probe
~/.claude/scripts/docstore get MAN-7624 | python3 -c "import sys,json; g=json.load(sys.stdin)['row']['governs']; print(len(g), g)"
expect: prints `3` and the two `.py` paths plus `/home/lyphe/.claude/state/dispatcher/roadmap-mirror.log`; the intent names two; cured when it prints `2` (or the third is ruled a deliberate third)
```

measured 2026-10-03 by chain chain-roadmap--mirror--docs-20261003-170800-0dca, finding L4, LOW
probe-key: 31d1ed41dc86d1d1e39110f466ccc43ef130be61

governs: /home/lyphe/.claude/claudecodeui_lyphe/

## INV-6574 — probe — the module's "said once per distinct message" bound does not hold for the failure it is most likely to meet as the store grows: a document past the 1 MiB ceiling is reported as a prefix of itself, and that prefix carries `generated_at`, so every tick is a new line and a new Set entry

the module's "said once per distinct message" bound does not hold for the failure it is most likely to meet as the store grows: a document past the 1 MiB ceiling is reported as a prefix of itself, and that prefix carries `generated_at`, so every tick is a new line and a new Set entry

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && P=$(mktemp -d /tmp/athena-flood-XXXXXX) && case "$P" in /tmp/athena-flood-*) ;; *) exit 1;; esac && cat > $P/bin <<'EOF'
#!/bin/sh
printf '{"generated_at":"%s","pad":"' "$(date -u +%FT%TZ)"; head -c 1200000 /dev/zero | tr '\0' ' '; printf '"}'
EOF
chmod +x $P/bin && cat > $P/p.mts <<'EOF'
const lines: string[] = [];
console.error = (...a: unknown[]) => { lines.push(a.join(' ')); };
const { createRoadmapModule } = await import('/home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/index.ts');
const roadmap = createRoadmapModule();
roadmap.start();
await new Promise((r) => setTimeout(r, 6500));
roadmap.stop();
console.log('journal lines:', lines.length, '| distinct:', new Set(lines).size);
process.exit(0);
EOF
DATABASE_PATH=$P/db.sqlite DISPATCHER_BIN=$P/bin TSX_TSCONFIG_PATH=/home/lyphe/.claude/claudecodeui_lyphe/server/tsconfig.json node --import tsx $P/p.mts 2>&1 | tail -1; case "$P" in /tmp/athena-flood-*) rm -rf "$P";; esac
expect: prints `journal lines: 4 | distinct: 4` (one new line per tick) while the failure sentence quotes the document's opening; `journal lines: 1` once it names the buffer
```

measured 2026-10-03 by chain chain-roadmap--lane--module-20261003-171345-f0be, finding L2, LOW
probe-key: 12b2c45f141fbdbc3a1583e8aa2f0b652a137b81

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap-relay.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap-state.service.ts

## INV-6579 — probe — `roadmap.step.idea` and `roadmap.step.proposed` have no phrase; a generic `t(`roadmap.step.${step}`)` draws the key path

`roadmap.step.idea` and `roadmap.step.proposed` have no phrase; a generic `t(`roadmap.step.${step}`)` draws the key path

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node -e "const i=require('i18next');const en=require('./src/modules/i18n/locales/en/common.json');i.init({lng:'en',resources:{en:{common:en}},defaultNS:'common',interpolation:{escapeValue:false}});console.log(JSON.stringify(['idea','proposed'].map(s=>i.t('roadmap.step.'+s))))"
expect: two phrases, neither a key path (the gap stands while it prints ["roadmap.step.idea","roadmap.step.proposed"])
```

measured 2026-10-03 by chain chain-roadmap--screen--words-20261003-192010-cf69, finding L2, LOW
probe-key: 0ea525bb4a1dda8afcd8edb9d046ed4419cbd3a4

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json

## INV-6581 — probe — `useRoadmap().selected` reads the FIRST roadmap, then flips, until the preference mirror hydrates, and nothing tells a consumer which it holds

`useRoadmap().selected` reads the FIRST roadmap, then flips, until the preference mirror hydrates, and nothing tells a consumer which it holds

```probe
cd /home/lyphe/.claude/state/pipeline-reviews/roadmap--screen--data/athena-probes && timeout 110 node cold-mirror.mjs
expect: mid.selected is "restorly" with hydrated:false (the defect); once cured mid.selected is null (or "lyphecli") and end.selected is "lyphecli"
```

measured 2026-10-03 by chain chain-roadmap--screen--data-20261003-192009-0fdf, finding M1, MEDIUM
probe-key: 2218c7b3eadbeeeba76b0ff9b4711d8f2ac66190

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/celebrationContext.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useRoadmap.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useRoadmapWrites.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapFeed.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/roadmap-types.ts

## INV-6582 — probe — A reconnect re-seed republishes an unchanged picture as a new reading

A reconnect re-seed republishes an unchanged picture as a new reading

```probe
cd /home/lyphe/.claude/state/pipeline-reviews/roadmap--screen--data/athena-probes && timeout 110 node reseed.mjs
expect: "extra renders +N" with N >= 1 and identity kept in fewer than 3 of 3 while the defect stands; "+0 … 3 of 3" once cured
```

measured 2026-10-03 by chain chain-roadmap--screen--data-20261003-192009-0fdf, finding L1, LOW
probe-key: e12061712edd1c26c8831dc49b8cac9dba575b3d

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/celebrationContext.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useRoadmap.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useRoadmapWrites.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapFeed.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/roadmap-types.ts

## INV-6583 — probe — `edit`'s `title` is both the wire field and the toast's name for the item

`edit`'s `title` is both the wire field and the toast's name for the item

```probe
cd /home/lyphe/.claude/state/pipeline-reviews/roadmap--screen--data/athena-probes && timeout 110 node edit-title.mjs
expect: "edit {goal} only" prints wire without title and toast "feat-1 saved"; "edit {goal, title}" prints wire WITH "title":"Real Title" (answers are stubbed)
```

measured 2026-10-03 by chain chain-roadmap--screen--data-20261003-192009-0fdf, finding L2, LOW
probe-key: ab77bf2b5d8639e841217b39520ed6c9355245bc

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/celebrationContext.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useRoadmap.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useRoadmapWrites.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapFeed.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/roadmap-types.ts

## INV-6584 — probe — The stamp write the brief spells out does not typecheck against `PreferenceListEntry`

The stamp write the brief spells out does not typecheck against `PreferenceListEntry`

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/roadmap--screen--data/athena-probes/stamp-typecheck.sh
expect: a TS2322 line ("'at' does not exist in type '{ name: string; }'") and "tsc exit 2"; once cured "tsc exit 0"
```

measured 2026-10-03 by chain chain-roadmap--screen--data-20261003-192009-0fdf, finding L3, LOW
probe-key: 02b657ca63eddcbb14315366ce1870e4fce1fe39

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/celebrationContext.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useRoadmap.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useRoadmapWrites.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapFeed.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/roadmap-types.ts

## INV-6585 — probe — A stale device's retry rewinds a roadmap's stamp

A stale device's retry rewinds a roadmap's stamp

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/roadmap--screen--data/athena-probes/stamp-rewind.sh
expect: "stored restorly stamp after a stale retry" prints at 2026-10-01T00:00:00Z while the defect stands (rewound); 2026-10-04T00:00:00Z once a stamp can no longer go backward
```

measured 2026-10-03 by chain chain-roadmap--screen--data-20261003-192009-0fdf, finding L4, LOW
probe-key: 5245ac0c86cd5b8771d1af9ce64e6d0c0b9f290e

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/celebrationContext.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useRoadmap.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useRoadmapWrites.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapFeed.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/roadmap-types.ts

## INV-6586 — A file created under src/ after the dev client starts gets no Tailwind classes until src/index.css is touched

Symptom: a new component's classes are absent on the shared dev client (`:5183`): its title renders at about 16px and nothing animates. Creating or editing the file does not cure it.

Cause: Vite 7.1.8 turns Tailwind 3's content glob (a postcss `dir-dependency` message) into the list of files that EXIST when `src/index.css` is built (`globSync` in `node_modules/vite/dist/node/chunks/dep-CuuNgwUk.js`, near line 32184). A file created later is not on the list, so no change to it rebuilds the stylesheet.

| when | do |
|---|---|
| a new file under `src/` shows unstyled on the dev client | `touch src/index.css` once, no content change: the stylesheet rebuilds and hot-swaps |
| the fix has to be lasting | a dev-server plugin that rebuilds `index.css` on a file created under `src/`; editing `vite.config.js` restarts the shared client and reloads every open tab |

measured 2026-10-03: `src/modules/roadmap/CelebrationLayer.tsx`, every class absent until the `index.css` mtime bump; the plugin is unwritten.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/index.css, /home/lyphe/.claude/claudecodeui_lyphe/vite.config.js

## INV-6587 — The reduced-motion reset in src/index.css turns every fade into a pop unless the fade restates its own duration

`@media (prefers-reduced-motion: reduce)` in `src/index.css` sets `animation-duration`, `transition-duration` to `0.01ms !important` and `animation-iteration-count: 1` on `*`, `::before`, `::after`.

Effect: a fade a piece means to keep under reduced motion plays as a pop.

| when | do |
|---|---|
| a piece keeps a fade under reduced motion | restate its durations with `!` under `motion-reduce:`: `motion-reduce:![animation-duration:250ms] motion-reduce:!duration-300` |
| a piece keeps motion that only changes opacity or blur | the same restatement; anything that moves stays cut |

Instance: `src/modules/roadmap/CelebrationLayer.tsx` (MAN-7636) keeps its layer fade (250 ms in, 300 ms out) and banner dissolve (200 ms) this way.
measured 2026-10-03: the layer's fade read as a pop under reduced motion until restated.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/index.css

## INV-6588 — probe — `src/modules/roadmap/FeatureRow.tsx` — in a row that waits on you, the project chip drops under the amber sentence and reads as a second button

`src/modules/roadmap/FeatureRow.tsx` — in a row that waits on you, the project chip drops under the amber sentence and reads as a second button

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node ~/.claude/state/pipeline-reviews/roadmap--screen--feature-scaffold/review-2-probe/measure2.mjs waiting light
expect: no "focus1440" or "focus390" entry prints "chipBesideAnswer":true or "chipOwnLine":true (the defect stands while fake-drying-goals prints "chipBesideAnswer":true,"rowH":120 and fake-readings-sync prints "chipOwnLine":true,"rowH":103)
```

measured 2026-10-03 by chain chain-roadmap--screen--feature-scaffold-20261003-201228-6841, finding L3, LOW
probe-key: a257e298c326179c609182887d5cb4b8be9489c5

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/FeatureRow.tsx

## INV-6589 — probe — `src/modules/roadmap/FeatureRow.tsx` — a compact row writes what it owes you, and why it is blocked, in its smallest type

`src/modules/roadmap/FeatureRow.tsx` — a compact row writes what it owes you, and why it is blocked, in its smallest type

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node ~/.claude/state/pipeline-reviews/roadmap--screen--feature-scaffold/review-2-probe/measure2.mjs compact light
expect: every "waiting" and "blocked" entry prints a "px" no smaller than "phrase" (the defect stands while each prints "px":"10px" beside "phrase":"12px")
```

measured 2026-10-03 by chain chain-roadmap--screen--feature-scaffold-20261003-201228-6841, finding L4, LOW
probe-key: bf3752d689a6fa501d5febcccda656a5387f1ff6

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/FeatureRow.tsx

## INV-6590 — probe — During a milestone moment the solid rail drops back to the station before the reached one, then snaps forward unanimated when the moment clears (MEDIUM)

During a milestone moment the solid rail drops back to the station before the reached one, then snaps forward unanimated when the moment clears (MEDIUM)

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node ~/.claude/state/pipeline-reviews/roadmap--screen--path-scaffold/review-1-probe/rail-moment.mjs light
expect: every "moment t=" line prints "beyondLeg":1 (the defect stands while they print "beyondLeg":0 between a "before" and a "cleared" that print 1)
```

measured 2026-10-03 by chain chain-roadmap--screen--path-scaffold-20261003-215256-0fda, finding M1, MEDIUM
probe-key: c787db8484a4d4338e2aff7d7fe18e86d0c24117

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/CelebrationLayer.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useStepPhrase.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/MilestonePath.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapHeader.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapPath.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapPicker.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapRail.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapTab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts

## INV-6591 — probe — When a milestone is reached, the stage follows `current` past it, so that milestone's epic and feature moments play on cards and rows the face does not draw (MEDIUM)

When a milestone is reached, the stage follows `current` past it, so that milestone's epic and feature moments play on cards and rows the face does not draw (MEDIUM)

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node ~/.claude/state/pipeline-reviews/roadmap--screen--path-scaffold/review-1-probe/offstage.mjs
expect: "epic moment (runner-cards)" prints "stage":"lyphecli-workspace","epicCard":true with "epic:runner-cards" in "celebrating" (the defect stands while it prints "stage":"lyphecli-command-center","epicCard":false,"celebrating":[])
```

measured 2026-10-03 by chain chain-roadmap--screen--path-scaffold-20261003-215256-0fda, finding M2, MEDIUM
probe-key: d9884c0c15d351d451a36253762a8d9af9703a1b

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/CelebrationLayer.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useStepPhrase.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/MilestonePath.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapHeader.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapPath.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapPicker.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapRail.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapTab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts

## INV-6592 — probe — The bloom's three rings go out together: their stagger is overridden (LOW)

The bloom's three rings go out together: their stagger is overridden (LOW)

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node ~/.claude/state/pipeline-reviews/roadmap--screen--path-scaffold/review-1-probe/rail-moment.mjs light
expect: every "moment t=" line prints "delays":["0s","0.15s","0.3s"] (the defect stands while they print "delays":["0s","0s","0s"])
```

measured 2026-10-03 by chain chain-roadmap--screen--path-scaffold-20261003-215256-0fda, finding L1, LOW
probe-key: 351bf6fa001f4c35294771438ae605154b3ac592

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/CelebrationLayer.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useStepPhrase.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/MilestonePath.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapHeader.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapPath.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapPicker.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapRail.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapTab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts

## INV-6593 — probe — The milestone-word constant is now written twice (LOW)

The milestone-word constant is now written twice (LOW)

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -rln "'roadmap.milestoneWord.notStarted'" src/
expect: one line, src/shared/constants.ts (the defect stands while it prints MilestonePath.tsx and MilestoneFocus.tsx)
```

measured 2026-10-03 by chain chain-roadmap--screen--path-scaffold-20261003-215256-0fda, finding L2, LOW
probe-key: 1f81b2bb28ef8979db4f1b1aa5e29b0381f9270a

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/CelebrationLayer.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useStepPhrase.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/MilestonePath.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapHeader.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapPath.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapPicker.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapRail.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapTab.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts

## INV-6620 — probe — The stamp moves past the epic and the milestone before they play, so any interruption swallows them for good (S24)

The stamp moves past the epic and the milestone before they play, so any interruption swallows them for good (S24)

```probe
node /home/lyphe/.claude/state/pipeline-reviews/roadmap--screen--celebration-fill/athena-probes/p1-interrupt.mjs
expect: "reload: epic/milestone rows played = 0" stands (the epic runner-cards and the milestone lyphecli-workspace are swallowed); a number above 0 means cured
```

measured 2026-10-04 by chain chain-roadmap--screen--celebration-fill-20261003-231515-d4e1, finding M1, MEDIUM
probe-key: 3674b756081bcf826460813a295429dcdeea1fd4

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useCelebrations.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/utils/celebrationMoments.ts

## INV-6621 — probe — A page signed in earlier replays what another device already played (S31)

A page signed in earlier replays what another device already played (S31)

```probe
node /home/lyphe/.claude/state/pipeline-reviews/roadmap--screen--celebration-fill/athena-probes/p2-stale-mirror.mjs
expect: "device B replayed 4 moment rows A already played" stands; 0 means cured
```

measured 2026-10-04 by chain chain-roadmap--screen--celebration-fill-20261003-231515-d4e1, finding M2, MEDIUM
probe-key: ec2cc752e8b73cc6bff1972abb9daa7e47bab931

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useCelebrations.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/utils/celebrationMoments.ts

## INV-6622 — probe — A live task moment yanks the stage off the milestone the reader pressed, remounting the focus panel (this build × the scaffold's `playing`)

A live task moment yanks the stage off the milestone the reader pressed, remounting the focus panel (this build × the scaffold's `playing`)

```probe
node /home/lyphe/.claude/state/pipeline-reviews/roadmap--screen--celebration-fill/athena-probes/p3-task-stage.mjs
expect: "stands: the stage left the pressed milestone for the task moment" stands; "cured: the stage stayed on the pressed milestone" means cured
```

measured 2026-10-04 by chain chain-roadmap--screen--celebration-fill-20261003-231515-d4e1, finding M3, MEDIUM
probe-key: 38a11db617f3b765c02ea52abe7af4ea728bae49

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useCelebrations.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/utils/celebrationMoments.ts

## INV-6623 — probe — The "four or more features become one" rule exists only in the catch-up; a live burst plays every feature

The "four or more features become one" rule exists only in the catch-up; a live burst plays every feature

```probe
node /home/lyphe/.claude/state/pipeline-reviews/roadmap--screen--celebration-fill/athena-probes/p4-live-burst.mjs
expect: "played 5 separate feature moments" stands; 1 means a summary, as the catch-up makes
```

measured 2026-10-04 by chain chain-roadmap--screen--celebration-fill-20261003-231515-d4e1, finding L1, LOW
probe-key: 41314de06f23560debfc66ff5882678ba7469238

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useCelebrations.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/utils/celebrationMoments.ts

## INV-6624 — probe — The builder's fixture prints "played nothing: true" over zero sampled rows

The builder's fixture prints "played nothing: true" over zero sampled rows

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/roadmap--screen--celebration-fill/athena-probes/p5-fixture-vacuous.sh
expect: "timeline rows: 0" beside "reload played nothing: true" stands; rows above 0 means cured
```

measured 2026-10-04 by chain chain-roadmap--screen--celebration-fill-20261003-231515-d4e1, finding L2, LOW
probe-key: 92224e31781f704f26c98c8f45e6a78adccdc393

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useCelebrations.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/utils/celebrationMoments.ts

## INV-6625 — probe — `inPlay` has no comment above it

`inPlay` has no comment above it

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/roadmap--screen--celebration-fill/athena-probes/p6-ref-comment.sh
expect: "line above inPlay:" printing a `const timer = …` line stands; a `//` comment line means cured
```

measured 2026-10-04 by chain chain-roadmap--screen--celebration-fill-20261003-231515-d4e1, finding L3, LOW
probe-key: 366a2faec9c3c317b0b0d26455ddd47212962099

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useCelebrations.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/utils/celebrationMoments.ts

## INV-6626 — probe — The catch-up's headline sentence reaches only a screen reader (the design's gap, S11)

The catch-up's headline sentence reaches only a screen reader (the design's gap, S11)

```probe
node /home/lyphe/.claude/state/pipeline-reviews/roadmap--screen--celebration-fill/athena-probes/p7-summary-sr-only.mjs
expect: every node reading sr-only=true stands; a node reading sr-only=false means cured
```

measured 2026-10-04 by chain chain-roadmap--screen--celebration-fill-20261003-231515-d4e1, finding L4, LOW
probe-key: 68f8f17497364919242d1c98bc85414116809b5c

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useCelebrations.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/utils/celebrationMoments.ts

## INV-6642 — probe — LOW: a carry begun while a drop's write is in flight snaps the list back to its pre-drop order, and its drop is written against an order the operator never saw

LOW: a carry begun while a drop's write is in flight snaps the list back to its pre-drop order, and its drop is written against an order the operator never saw

```probe
cd ~/.claude/state/pipeline-reviews/roadmap--screen--path-fill/athena-probes && timeout 200 node hold2.mjs 2>&1 | grep -E "after drop 1|2nd carry begun|mid-carry 2|^bodies"
expect: the "2nd carry begun" line reads ["C","A","B","D"] (the held order) when cured; it reads ["A","B","C","D"] while the defect stands
```

measured 2026-10-04 by chain chain-roadmap--screen--path-fill-20261004-001959-121c, finding L1, LOW
probe-key: 5a1eff40f87d6cf05fb2dba1c0331753490dadd6

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/faceContext.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useRevealCard.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/OpenDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/railSections.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/useSortable.ts

## INV-6643 — probe — LOW: another writer's change to the same list ends the hold early, so the snap-back the hold exists to prevent comes back

LOW: another writer's change to the same list ends the hold early, so the snap-back the hold exists to prevent comes back

```probe
cd ~/.claude/state/pipeline-reviews/roadmap--screen--path-fill/athena-probes && timeout 200 node hold3.mjs 2>&1 | grep -E "other writer added|order over time"
expect: "order over time" holds no entry whose order starts A,B,C,D,E when cured; the defect prints one between the two C-first orders
```

measured 2026-10-04 by chain chain-roadmap--screen--path-fill-20261004-001959-121c, finding L2, LOW
probe-key: 4b635fcba8c2a60ace5516833815113c95da34cd

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/faceContext.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useRevealCard.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/OpenDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/railSections.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/useSortable.ts

## INV-6644 — probe — LOW: `useRevealCard`'s URL fallback pushes a history entry that the landing then replaces, leaving two identical entries and a dead Back

LOW: `useRevealCard`'s URL fallback pushes a history entry that the landing then replaces, leaving two identical entries and a dead Back

```probe
cd ~/.claude/state/pipeline-reviews/roadmap--screen--path-fill/athena-probes && timeout 200 node bare.mjs 2>&1 | grep -E "^before|after Answer|after ONE Back"
expect: "after Answer" shows len equal to "before"'s len when cured (a replace); it shows len one higher while the defect stands, and the Back line reads "Back moved to a different URL: false"
```

measured 2026-10-04 by chain chain-roadmap--screen--path-fill-20261004-001959-121c, finding L3, LOW
probe-key: bdd8472b09d55113d853866dfbba55b5afd842f0

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/faceContext.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useRevealCard.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/OpenDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/railSections.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/useSortable.ts

## INV-6645 — probe — LOW: Escape on the dialog "New roadmap…" opens from the picker leaves the keyboard on `<body>`

LOW: Escape on the dialog "New roadmap…" opens from the picker leaves the keyboard on `<body>`

```probe
cd ~/.claude/state/pipeline-reviews/roadmap--screen--path-fill/athena-probes && timeout 120 node picker-focus.mjs 2>&1 | tail -2
expect: "activeElement = BUTTON[Roadmap]" when cured; "activeElement = BODY" while the defect stands
```

measured 2026-10-04 by chain chain-roadmap--screen--path-fill-20261004-001959-121c, finding L4, LOW
probe-key: f2531bdf15ef48a50978eb76159dfc76fd26f7c9

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/faceContext.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useRevealCard.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/OpenDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/railSections.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/useSortable.ts

## INV-6658 — probe — fixture: single-tenant by title; a run after a killed run walks the stale roadmap and exits 1 (`/tmp/heph-roadmap-dialogs-fixture.mjs`)

fixture: single-tenant by title; a run after a killed run walks the stale roadmap and exits 1 (`/tmp/heph-roadmap-dialogs-fixture.mjs`)

```probe
node /home/lyphe/.claude/state/pipeline-reviews/roadmap--screen--dialogs-fill/athena-probes/probe-fixture-stale.mjs
expect: fixture-stale: exit=1 left=none   (cured: exit=0 — the fixture clears a standing probe of its title before it starts; ~90 s)
```

measured 2026-10-04 by chain chain-roadmap--screen--dialogs-fill-20261004-005742-be07, finding L1, LOW
probe-key: dad6d2e0ac141b490e1b4a6640e42130e82b26b6

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json

## INV-6659 — probe — fixture/report: the walk's footprint in the house is not stated (`result.md`, the fixture header)

fixture/report: the walk's footprint in the house is not stated (`result.md`, the fixture header)

```probe
grep -c '^orphan page-roadmap-heph-probe-dialogs-walk$' /home/lyphe/.claude/state/dispatcher/roadmap-mirror.log || true
expect: a number of 1 or more (the page the mirror composed while the builder's probe lived; it is never deleted)
```

measured 2026-10-04 by chain chain-roadmap--screen--dialogs-fill-20261004-005742-be07, finding L2, LOW
probe-key: 3eeb92cc3912320d47c023a7d956ddd6ab7a1980

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json

## INV-6660 — probe — fixture transcript does not carry some of what the report states (`/tmp/heph-roadmap-dialogs-fixture.mjs`, `/tmp/heph-roadmap-dialogs-run.log`)

fixture transcript does not carry some of what the report states (`/tmp/heph-roadmap-dialogs-fixture.mjs`, `/tmp/heph-roadmap-dialogs-run.log`)

```probe
grep -c 'data-tone\|dataset.tone' /tmp/heph-roadmap-dialogs-fixture.mjs || true
expect: 0 (the fixture never reads a toast's tone; cured: 1 or more)
```

measured 2026-10-04 by chain chain-roadmap--screen--dialogs-fill-20261004-005742-be07, finding L3, LOW
probe-key: b1deeda86adaaed48d92e4e42ddf0c156fa67378

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json

## INV-6666 — probe — `row`'s doc comment is stranded above the new `isWholeCount`

`row`'s doc comment is stranded above the new `isWholeCount`

```probe
grep -n -B3 '^function row(' /home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap-state.service.ts || echo none
expect: the three lines above `function row(` end in ` */` (row's own doc) once cured; while the defect stands they show `const isWholeCount = …` there instead
```

measured 2026-10-04 by chain chain-regression-cases--screen--shapes-20261004-023246-2502, finding L1, LOW
probe-key: 05314ea0a61a868cc5735fdd43880da1f206e75d

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap-state.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/roadmap-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/roadmap-types.ts

## INV-6667 — probe — the three containers that gain `cases` do not say what it is, and the epic/roadmap roll-up is told nowhere

the three containers that gain `cases` do not say what it is, and the epic/roadmap roll-up is told nowhere

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && python3 -c "
import re
t = open('server/shared/roadmap-types.ts').read()
for n in ('RoadmapFeature','RoadmapEpic','Roadmap'):
    d = re.search(r'(/\*\*(?:(?!\*/).)*?\*/)\s*export type ' + n + r'\b', t, re.S)
    print(n, 'container doc names cases:', bool(d and 'cases' in d.group(1)))"
expect: three lines; `container doc names cases: False` for each while the defect stands, `True` once the containers say it
```

measured 2026-10-04 by chain chain-regression-cases--screen--shapes-20261004-023246-2502, finding L2, LOW
probe-key: 70a4193179035e6ba9a58b28c4c87a4edae14ac9

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap-state.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/roadmap-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/roadmap-types.ts

## INV-6670 — probe — LOW — a cases-door failure leads with `dispatcher list …`, a verb that does not exist, while the same route's field refusals lead with `cases list …`

LOW — a cases-door failure leads with `dispatcher list …`, a verb that does not exist, while the same route's field refusals lead with `cases list …`

```probe
T=$(curl -s -X POST http://127.0.0.1:3011/api/auth/login -H 'Content-Type: application/json' -d '{"username":"verve","password":"verve-dev-2026"}' | jq -r .token); curl -s -H "Authorization: Bearer $T" 'http://127.0.0.1:3011/api/roadmap/cases?feature=no-such-plan' | jq -r '.error // "none"'
expect: prints `dispatcher list --plan no-such-plan --state active --json exited 2: REFUSED list: no plan no-such-plan in the store` while the defect stands (cured: it leads with `cases list`)
```

measured 2026-10-04 by chain chain-regression-cases--screen--route-20261004-024905-8a65, finding L1, LOW
probe-key: 4f48f6094ea1d423feecc4713bfb0c4450308bf6

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap-cases.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-6671 — probe — LOW — a failed cases read leaves no server-side trace

LOW — a failed cases read leaves no server-side trace

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && D=$(mktemp -d /tmp/athena-cases-XXXXXX) && case "$D" in /tmp/athena-cases-*) ;; *) exit 1;; esac && printf '#!/bin/sh\necho "Traceback (most recent call last):" >&2\nexit 1\n' > $D/stub && chmod +x $D/stub && cat > $D/j.mts <<'EOF'
import express from 'express';
import { createRoadmapRouter } from '/home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap.routes.ts';
import { readFeatureCases } from '/home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap-cases.service.ts';
const lines: string[] = [];
for (const k of ['log', 'warn', 'error', 'info'] as const) (console as any)[k] = (...a: unknown[]) => { lines.push(`${k}: ${a.join(' ')}`); };
const deps = { bin: process.env.STUB as string, timeoutMs: 3000, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } };
const app = express();
app.use('/api/roadmap', createRoadmapRouter({ current: async () => null, relay: async () => { throw new Error('no'); }, poke() {}, cases: (f: string) => readFeatureCases(deps, f) }));
const server = app.listen(0, '127.0.0.1', async () => {
  const port = (server.address() as { port: number }).port;
  const r = await fetch(`http://127.0.0.1:${port}/api/roadmap/cases?feature=x`);
  process.stdout.write(`status ${r.status} | console lines from route: ${lines.length}\n`);
  server.close(); process.exit(0);
});
EOF
STUB=$D/stub TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx $D/j.mts 2>&1 | tail -1; cd /tmp && case "$D" in /tmp/athena-cases-*) rm -r "$D";; esac
expect: prints `status 502 | console lines from route: 0` while the defect stands (cured: a non-zero count, one `[Roadmap]`-style line naming the sentence)
```

measured 2026-10-04 by chain chain-regression-cases--screen--route-20261004-024905-8a65, finding L2, LOW
probe-key: e386c334fe7399513c0af47b0284513cf0d462f7

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap-cases.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-6672 — probe — LOW — "Healed means deleted": the words that describe the lane still describe the smaller lane

LOW — "Healed means deleted": the words that describe the lane still describe the smaller lane

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && echo "module head: $(grep -c 'reads one document' server/modules/roadmap/roadmap.module.ts)"; echo "MAN-7631 names the route or the binary: $(~/.claude/scripts/docstore get MAN-7631 --text | grep -c 'CASES_BIN\|GET /cases\|roadmap-cases')"
expect: prints `module head: 1` and `MAN-7631 names the route or the binary: 0` while the defect stands (cured: `0` and a non-zero count)
```

measured 2026-10-04 by chain chain-regression-cases--screen--route-20261004-024905-8a65, finding L3, LOW
probe-key: dc84606e183ceb3031121c5bccad0df3eda4c15b

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap-cases.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/roadmap/roadmap.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-6676 — probe — LOW — MAN-7635 names `api.roadmap` but does not govern `src/shared/api.ts`; its composes cells leave some pieces out

LOW — MAN-7635 names `api.roadmap` but does not govern `src/shared/api.ts`; its composes cells leave some pieces out

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && docstore get MAN-7635 | python3 -c "import sys,json; r=json.load(sys.stdin)['row']; print(any(g.endswith('src/shared/api.ts') for g in r['governs']))"
expect: `False` while the row describes `api.roadmap` without governing the file; `True` once added
```

measured 2026-10-04 by chain chain-roadmap--screen--docs-20261004-024747-4fa8, finding L4, LOW
probe-key: 46813f06eaff8bee39bedc632ea23d0153b6fa51

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-6678 — probe — MEDIUM — the dialog's re-read: the marker departs from the fill phase, and the section as composed wipes its list on every re-read

MEDIUM — the dialog's re-read: the marker departs from the fill phase, and the section as composed wipes its list on every re-read

```probe
cd ~/.claude/state/pipeline-reviews/regression-cases--screen--scaffold/review-1-probe && node probe.mjs refetch light 2>&1 | grep '^refetch 1440'
expect: prints `refetch 1440 light: read=loading cases drawn=0` while the defect stands (cured: `read=listed cases drawn=6`)
```

measured 2026-10-04 by chain chain-regression-cases--screen--scaffold-20261004-024906-f45e, finding M1, MEDIUM
probe-key: 0c99d89492ce14513012e0add3387d1caf154cdb

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/EpicCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/fakeCases.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/FeatureRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureCases.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureFacts.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapHeader.tsx

## INV-6679 — probe — MEDIUM — the header's case facts come between the feature facts and "1 blocked · 1 waiting on you", which then read as if they counted cases

MEDIUM — the header's case facts come between the feature facts and "1 blocked · 1 waiting on you", which then read as if they counted cases

```probe
cd ~/.claude/state/pipeline-reviews/regression-cases--screen--scaffold/review-1-probe && node probe.mjs header light 2>&1 | grep '^header 390'
expect: prints the order `… cases="5 cases" · casesHolding="all holding" · blocked="1 blocked" · waiting="1 waiting on you"` while the defect stands (cured: `blocked` and `waiting` before `cases` and `casesHolding`)
```

measured 2026-10-04 by chain chain-regression-cases--screen--scaffold-20261004-024906-f45e, finding M2, MEDIUM
probe-key: 1de71ea5e0c5a65b1c27d0e118b83048b8dd78aa

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/EpicCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/fakeCases.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/FeatureRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureCases.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureFacts.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapHeader.tsx

## INV-6680 — probe — MEDIUM — the dialog lists what broke wherever the door's name order puts it, so a broken case can sit below the first view

MEDIUM — the dialog lists what broke wherever the door's name order puts it, so a broken case can sit below the first view

```probe
cd ~/.claude/state/pipeline-reviews/regression-cases--screen--scaffold/review-1-probe && node probe.mjs order light 2>&1 | grep '^order 390'
expect: prints `case words in order: holding, holding, holding, holding, holding, broken; an amber case in the dialog's first view: no` while the defect stands (cured: `broken, holding, …` and `yes`)
```

measured 2026-10-04 by chain chain-regression-cases--screen--scaffold-20261004-024906-f45e, finding M3, MEDIUM
probe-key: 4e75d1b30e8ee2e8a40125cd51a64efaa786a150

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/EpicCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/fakeCases.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/FeatureRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureCases.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureFacts.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapHeader.tsx

## INV-6681 — probe — LOW — a broken case whose run saw nothing draws a bare "It saw:"; a case's name alone may not be a unique key

LOW — a broken case whose run saw nothing draws a bare "It saw:"; a case's name alone may not be a unique key

```probe
cd ~/.claude/state/pipeline-reviews/regression-cases--screen--scaffold/review-1-probe && node probe.mjs saw light 2>&1 | grep '^saw 390'
expect: prints `saw 390 light: broken case with an empty saw draws: "It saw:"` while the defect stands (cured: `no saw line`)
```

measured 2026-10-04 by chain chain-regression-cases--screen--scaffold-20261004-024906-f45e, finding L1, LOW
probe-key: 80f96dcdf8bfe68bd2a0269af2049f1b86ceb86b

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/EpicCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/fakeCases.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/FeatureRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureCases.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureFacts.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapHeader.tsx

## INV-6682 — probe — LOW — on a building row the amber case badge splits the step words from their meter, and the row's two warn lines from each other

LOW — on a building row the amber case badge splits the step words from their meter, and the row's two warn lines from each other

```probe
cd ~/.claude/state/pipeline-reviews/regression-cases--screen--scaffold/review-1-probe && node probe.mjs rowOrder light 2>&1 | grep '^rowOrder 1440'
expect: prints `row pieces top to bottom: step → caseMark → meter → blocked` while the defect stands (cured: `step → meter → caseMark → blocked`)
```

measured 2026-10-04 by chain chain-regression-cases--screen--scaffold-20261004-024906-f45e, finding L2, LOW
probe-key: 6e9b76609d8f8863767442c62f0d1f40ccc7f281

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/EpicCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/fakeCases.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/FeatureRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureCases.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureFacts.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapHeader.tsx

## INV-6683 — probe — LOW — the photographed failure is not the line the operator will see, and the report's flag about it is stale

LOW — the photographed failure is not the line the operator will see, and the report's flag about it is stale

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -c "dispatcher list --plan" src/modules/roadmap/fakeCases.ts
expect: prints `1` while the defect stands (cured: `0`)
```

measured 2026-10-04 by chain chain-regression-cases--screen--scaffold-20261004-024906-f45e, finding L3, LOW
probe-key: 467916bdffc7713b8e54e051c6ce66c2a5951978

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/EpicCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/fakeCases.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/FeatureRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureCases.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureFacts.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapHeader.tsx

## INV-6684 — probe — LOW — three comments say something the code does not

LOW — three comments say something the code does not

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -c 'inside the height the project chip already gives the line' src/modules/roadmap/FeatureRow.tsx; grep -c 'is its words under' src/modules/roadmap/FeatureRow.tsx
expect: prints `1` and `1` while the defect stands (cured: `0` and `0`)
```

measured 2026-10-04 by chain chain-regression-cases--screen--scaffold-20261004-024906-f45e, finding L4, LOW
probe-key: ff3aedf69de360de41fc07955203411f8f64196f

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/EpicCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/fakeCases.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/FeatureRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureCases.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureFacts.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapHeader.tsx

## INV-6685 — probe — LOW — the scaffold's two new surfaces have no doc home, and the report says a phase will give them one that is not scheduled to

LOW — the scaffold's two new surfaces have no doc home, and the report says a phase will give them one that is not scheduled to

```probe
~/.claude/scripts/docstore get MAN-7643 --text | grep -c 'FeatureCases'; ~/.claude/scripts/docstore get MAN-7643 --text | grep -c '{ feature, picture, onWriteGoal() }'
expect: prints `0` and `1` while the defect stands (cured: a non-zero count and `0`)
```

measured 2026-10-04 by chain chain-regression-cases--screen--scaffold-20261004-024906-f45e, finding L5, LOW
probe-key: be27479a0204efd06edd15f4d30f85825dfa127c

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/EpicCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/fakeCases.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/FeatureRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureCases.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureFacts.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapHeader.tsx

## INV-6687 — probe — LOW — A failed cases read is final for the life of the dialog

LOW — A failed cases read is final for the life of the dialog

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node /home/lyphe/.claude/state/pipeline-reviews/regression-cases--screen--fill/athena-probes/sticky.mjs 2>&1 | tail -1
expect: requests after the failure = 0 | section now: cases list exited 2: transient   (cured when it prints a request count above 0 and section now: RECOVERED)
```

measured 2026-10-04 by chain chain-regression-cases--screen--fill-20261004-035620-ec86, finding L1, LOW
probe-key: 6969eaac99ebefef884d04d796dfeddab0365bc2

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/caseMark.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useFeatureCases.ts

## INV-6688 — probe — LOW — The failure line speaks the dispatcher's command, with the feature's slug

LOW — The failure line speaks the dispatcher's command, with the feature's slug

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node /home/lyphe/.claude/state/pipeline-reviews/regression-cases--screen--fill/athena-probes/fx.mjs 502 2>&1 | grep -E '^dialog Cases' | cut -c1-260
expect: the text contains `cases list --plan restorly--shell` (the stubbed route sentence reaches the screen as it came); cured when it carries neither `--plan` nor `restorly--shell`
```

measured 2026-10-04 by chain chain-regression-cases--screen--fill-20261004-035620-ec86, finding L2, LOW
probe-key: fca73ec3421d5b2d8d9aab48e39ef24596903c6b

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/caseMark.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useFeatureCases.ts

## INV-6689 — probe — MEDIUM — H2's cure taught the sweep about a run beside it, but not the walks: overlapping runs still turn each other red and clobber the account

MEDIUM — H2's cure taught the sweep about a run beside it, but not the walks: overlapping runs still turn each other red and clobber the account

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe
DP=~/.claude/scripts/dispatcher
$DP roadmap add roadmap probe-screen-athena-fx --title "Probe screen athena fx" --by cli >/dev/null 2>&1
node .verify/probe-roadmap-screen.mjs --only=look > /tmp/athena-n1.log 2>&1 &
P=$!
timeout 120 bash -c 'until grep -q "picker light\] lists" /tmp/athena-n1.log; do sleep 0.5; done'
$DP roadmap remove roadmap probe-screen-athena-fx --by cli >/dev/null 2>&1
timeout 500 bash -c "while kill -0 $P 2>/dev/null; do sleep 2; done"
echo "failures: $(grep -cE '^\[FAIL\]' /tmp/athena-n1.log)"; tail -1 /tmp/athena-n1.log | cut -c1-80
$DP roadmap --json | python3 -c "import sys,json;print('left in store:',[r['name'] for r in json.load(sys.stdin)['roadmaps'] if r['name'].startswith('probe-screen-')])"
expect: "failures: 3" and a "FAIL — … 3 failed" line (the walk stopped waiting for the vanished roadmap's option, twice, plus "every roadmap of the store is listed"); cured: "failures: 0" and "PASS"
```

measured 2026-10-04 by chain chain-roadmap--screen--whole-20261004-032012-391b, finding M1, MEDIUM
probe-key: 8f9b6677537832061ae07e1fd286ad90c7b1f8ea

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/report.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-catchup-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-dialogs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-live-walks.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-look-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-motion.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-page.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-store.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-ui.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-build.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-tidy.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-words.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-roadmap-screen.mjs

## INV-6690 — probe — LOW — an interrupt still races the `finally`: the stamp stays rewound about one time in five, a dead `seen` entry and the walk's pick can stay behind

LOW — an interrupt still races the `finally`: the stamp stays rewound about one time in five, a dead `seen` entry and the walk's pick can stay behind

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe
grep -n "SIGINT\|SIGTERM" .verify/probe-roadmap-screen.mjs .verify/lib/roadmap-*.mjs || echo none
expect: "none" (no handler restores the account before Playwright's exit(130)); cured: a SIGINT/SIGTERM handler line that restores the stamp, the pick and the dead entry before exiting
```

measured 2026-10-04 by chain chain-roadmap--screen--whole-20261004-032012-391b, finding L1, LOW
probe-key: fbe31717568fcd6bc19b26985edb711cd7f4a50c

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/report.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-catchup-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-dialogs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-live-walks.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-look-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-motion.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-page.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-store.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-ui.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-build.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-tidy.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-words.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-roadmap-screen.mjs

## INV-6691 — probe — LOW — "in view" now means "a top edge inside the window and half the card on screen": the transcript's own 32 px cut still passes

LOW — "in view" now means "a top edge inside the window and half the card on screen": the transcript's own 32 px cut still passes

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node --input-type=module -e "
import { cardInView } from './.verify/lib/roadmap-page.mjs';
const w = { found: true, left: 29, right: 361, width: 390, height: 844 };
console.log('y 454-876 of 844:', cardInView({ ...w, top: 454, bottom: 876 }), '| 1 px at the bottom edge:', cardInView({ ...w, top: 843, bottom: 1265 }), '| 20 px foot:', cardInView({ ...w, top: -400, bottom: 20 }));
"
expect: "true false false" (the measured 32 px cut passes, the two extremes are cured); cured, if the card's whole body is required: "false false false"
```

measured 2026-10-04 by chain chain-roadmap--screen--whole-20261004-032012-391b, finding L2, LOW
probe-key: 27d70e329e0abebbc121a1020e6165466fd0c3cd

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/report.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-catchup-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-dialogs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-live-walks.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-look-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-motion.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-page.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-store.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-ui.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-build.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-tidy.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-words.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-roadmap-screen.mjs

## INV-6692 — probe — LOW — the mirror orphan count the writes walk prints is always 0, and the mirror's lines fill the transcript

LOW — the mirror orphan count the writes walk prints is always 0, and the mirror's lines fill the transcript

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe
node --input-type=module -e "import {mirrorOrphanProbePages as m} from './.verify/lib/roadmap-store.mjs'; console.log('probe says', m())" 2>/dev/null
~/.claude/scripts/dispatcher roadmap mirror --dry-run 2>&1 >/dev/null | grep -c "orphan page-roadmap-probe-screen-"
expect: "probe says 0" then a number ≥ 1 (6 today); cured: both numbers equal
```

measured 2026-10-04 by chain chain-roadmap--screen--whole-20261004-032012-391b, finding L3, LOW
probe-key: 225b98a47a4c7cd0aa9d6b74bd1020e71b676371

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/report.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-catchup-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-dialogs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-live-walks.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-look-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-motion.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-page.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-store.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-ui.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-build.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-tidy.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-writes-words.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-roadmap-screen.mjs

## INV-6694 — probe — The "when it last ran" oracle has no branch past 24 h, so the standing proof false-FAILs on a correct screen once the shell case's newest run ages out; and the oracle is read once and never refreshed

The "when it last ran" oracle has no branch past 24 h, so the standing proof false-FAILs on a correct screen once the shell case's newest run ages out; and the oracle is read once and never refreshed

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && sed -n '/^function agoWords/,/^}/p' .verify/lib/roadmap-cases-walk.mjs | grep -c -E "yesterday|days ago"; ~/.claude/scripts/cases list --plan restorly--shell --json | jq -r '.[0].newest_run.at'
expect: first line `0` while the oracle has no day phrase (cured when 1 or more); second line is the newest run's stamp the 24 h clock counts from (a stamp 24 h or older with a first line of 0 is the false FAIL).
```

measured 2026-10-04 by chain chain-regression-cases--screen--whole-20261004-050431-851f, finding M1, MEDIUM
probe-key: ab1b09a446d9c58b94c9b4572e799353b89be8de

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-cases-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-roadmap-cases.mjs

## INV-6695 — probe — The 390 dialog capture is asserted by nothing: the intent's three things (sentence, word, when it last ran) are not checked to be in the capture

The 390 dialog capture is asserted by nothing: the intent's three things (sentence, word, when it last ran) are not checked to be in the capture

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && sed -n '/^async function readDialog/,/^}/p' .verify/lib/roadmap-cases-walk.mjs | grep -c -E "getBoundingClientRect|boundingBox|isIntersecting"
expect: `0` while no step asserts the case's sentence, badge and "Last ran" lie inside `[data-roadmap-dialog-body]` before the capture; 1 or more once they are asserted per capture.
```

measured 2026-10-04 by chain chain-regression-cases--screen--whole-20261004-050431-851f, finding L1, LOW
probe-key: affb24668dfbc2ce492c5f8163a12604021e757f

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-cases-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-roadmap-cases.mjs

## INV-6696 — probe — A vacuous `[OK]` about a gutter widget that does not exist is counted in "83 ok"

A vacuous `[OK]` about a gutter widget that does not exist is counted in "83 ok"

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -E '^\[(OK|SKIP)\] +\[gutter\]' .verify/artifacts/roadmap-cases/transcript.txt | cut -c1-120
expect: a `[SKIP]` line for the missing widget AND an `[OK]   [gutter] no amber case mark stands in the gutter either` line beside it while the defect stands; no `[OK]` about the gutter while no widget is drawn once cured.
```

measured 2026-10-04 by chain chain-regression-cases--screen--whole-20261004-050431-851f, finding L2, LOW
probe-key: 300a98f2d596f88834e19aec2abd1d3a3737d541

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-cases-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-roadmap-cases.mjs

## INV-6697 — probe — The probe's header says "WRITES. None", but every `openConsole` it makes PATCHes the account

The probe's header says "WRITES. None", but every `openConsole` it makes PATCHes the account

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n "WRITES" .verify/probe-roadmap-cases.mjs | cut -c1-60; sed -n '/^async function parkOnProjectTree/,/^}/p' .verify/lib/console.mjs | grep -n -E "PATCH|simpleChatList"
expect: the header line says "WRITES. None." and the second command prints the PATCH of `{ simpleChatList: false }` made by every session the probe opens (cured when the header names it, or the PATCH is skipped when the value already holds).
```

measured 2026-10-04 by chain chain-regression-cases--screen--whole-20261004-050431-851f, finding L3, LOW
probe-key: 2c054d43bea8c8625ca7a6468ac961562e5a4e4e

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-cases-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-roadmap-cases.mjs

## INV-6698 — probe — No manual governs the new probe or its helper

No manual governs the new probe or its helper

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && for f in .verify/probe-roadmap-cases.mjs .verify/lib/roadmap-cases-walk.mjs; do echo "$f manuals: $(docstore govern "$PWD/$f" --text | grep -c '^MAN-')"; done
expect: `manuals: 0` for both while no manual governs them; 1 or more once MAN-7660's governs line names them.
```

measured 2026-10-04 by chain chain-regression-cases--screen--whole-20261004-050431-851f, finding L4, LOW
probe-key: 0cd4841adf75e320ace09f2bc77e0ab8f76f9367

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-cases-walk.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-roadmap-cases.mjs

## INV-6720 — probe — Rows this phase owns carry history and process voice, and one says "not measured" about a thing that was measured

Rows this phase owns carry history and process voice, and one says "not measured" about a thing that was measured

```probe
cd ~/.claude && echo "$(docstore get MAN-7668 --text | grep -c -i -E "reviewer'?s reading|builder'?s count") $(docstore get MAN-7665 --text | grep -c "predates the fix-pass") $(docstore get MAN-7640 --text | grep -c "not re-run")"
expect: 0 0 0 (today it prints "2 1 1")
```

measured 2026-10-04 by chain chain-roadmap--widget--docs-20261004-081056-7d30, finding M1, MEDIUM
probe-key: 488f91f90247b35baab3dc452a6747a690c5f9c2

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/OpenDialog.tsx

## INV-6721 — probe — `src/modules/chat/index.ts:5` still says Subagents is "the third widget"

`src/modules/chat/index.ts:5` still says Subagents is "the third widget"

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n "as the third widget" src/modules/chat/index.ts || echo none
expect: none (today: 5:// opens. Its consumer is the chat-gutters module, which mounts it as the third widget.)
```

measured 2026-10-04 by chain chain-roadmap--widget--docs-20261004-081056-7d30, finding L1, LOW
probe-key: 5f0926fcfb6ab6ce2c3fb292c3881caa4c443792

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/index.ts

## INV-6722 — probe — MAN-7650 says `RoadmapPath` holds the one dialog state, against its own line 31 and the comment this diff changed

MAN-7650 says `RoadmapPath` holds the one dialog state, against its own line 31 and the comment this diff changed

```probe
cd ~/.claude && docstore get MAN-7650 --text | grep -c "is the one dialog state .RoadmapPath. holds"
expect: 0 (today 1)
```

measured 2026-10-04 by chain chain-roadmap--widget--docs-20261004-081056-7d30, finding L2, LOW
probe-key: 1ceda3f239971f8c1814612bee57e63ca846569e

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/OpenDialog.tsx

## INV-6723 — probe — MAN-7665 is the only row of the roadmap lane in the `cloudcli:.` package

MAN-7665 is the only row of the roadmap lane in the `cloudcli:.` package

```probe
cd ~/.claude && docstore get MAN-7665 | python3 -c "import sys,json;p=json.load(sys.stdin)['row']['package'];print(p['repo']+':'+p['path'])"
expect: cloudcli:docs (today cloudcli:.)
```

measured 2026-10-04 by chain chain-roadmap--widget--docs-20261004-081056-7d30, finding L3, LOW
probe-key: 7e480a2c247126c9591ce31c868cf0f62ddf1859

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/OpenDialog.tsx

## INV-6724 — probe — The report's "Shown" line is met for three rows of seven, as excerpts

The report's "Shown" line is met for three rows of seven, as excerpts

```probe
cd ~/.claude && for n in 421 7527 7648 7656; do docstore history MAN-$n --text | head -1 | cut -c1-40; done
expect: four lines dated 2026-10-04T15:14 to 15:15, rows the report names without printing
```

measured 2026-10-04 by chain chain-roadmap--widget--docs-20261004-081056-7d30, finding L4, LOW
probe-key: 92ac425f298c18086f3684c6e8cccd540c4bf31b

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/OpenDialog.tsx

## INV-6725 — probe — LOW — "captured as frames every 150 ms" has a 0.72–0.75 s hole where the milestone banner arrives, in both plays, and the report and MAN-7671 say otherwise

LOW — "captured as frames every 150 ms" has a 0.72–0.75 s hole where the milestone banner arrives, in both plays, and the report and MAN-7671 say otherwise

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe/.verify/shots/roadmap-widget && for d in frames-catchup frames-unfold; do ls $d 2>/dev/null | python3 -c "import sys,re;o=sorted(int(re.search(r'-(\d+)ms',l).group(1)) for l in sys.stdin);g=[b-a for a,b in zip(o,o[1:])];print('$d',len(o),'median',sorted(g)[len(g)//2] if g else 0,'max',max(g or [0]))"; done
expect: max ≤ 300 in both folders; it stands at 748 (frames-catchup) and 720 (frames-unfold)
```

measured 2026-10-04 by chain chain-roadmap--widget--whole-20261004-084914-d809, finding L1, LOW
probe-key: e887c94942b77fca35f4ad1afb78b28e2333f00c

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-live-walks.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-widget-prod.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-widget-walks.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-roadmap-widget.mjs

## INV-6726 — probe — LOW — the `:5184` capture can show a catch-up playing over the widget and the walk still passes

LOW — the `:5184` capture can show a catch-up playing over the widget and the walk still passes

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -cE "data-roadmap-moment|data-roadmap-summary|data-celebrating|settleStamp" .verify/lib/roadmap-widget-prod.mjs || true
expect: 0 today (the prod walk guards nothing against a moment playing over the widget); cured when it is at least 1
```

measured 2026-10-04 by chain chain-roadmap--widget--whole-20261004-084914-d809, finding L2, LOW
probe-key: c4bc8e13f306f950a59a335a265155e012079326

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-live-walks.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-widget-prod.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-widget-walks.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-roadmap-widget.mjs

## INV-6749 — probe — (LOW) — the screen is still called "Runner" in other words the three-phrase grep cannot see

(LOW) — the screen is still called "Runner" in other words the three-phrase grep cannot see

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -rn -E "Runner (homes|lane's memory|card|readout)|opens the Runner at|Runner and Memory panes|Memory and Runner panels|Heal, Memory and Runner" src server docs/MANUAL.md docs/architecture/MANUAL.md | wc -l
expect: 12 now; 0 once these read as the Roadmap tab's In flight face / the Runs widget (the panels sentences may stay if read as component names)
```

measured 2026-10-04 by chain chain-roadmap--judgment--names-app-20261004-110113-6ede, finding L2, LOW
probe-key: cf2235f7cd2664d7ac664e22e6cd013fe402b6b2

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts
