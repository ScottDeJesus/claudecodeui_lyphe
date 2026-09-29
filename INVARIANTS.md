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

## INV-5694 — probe — On a Claude-route plan, the `On` button's tooltip promises width the route forbids, and the Claude line is hidden behind it

On a Claude-route plan, the `On` button's tooltip promises width the route forbids, and the Claude line is hidden behind it

```probe
node /tmp/pipeline-reviews/swarm-per-plan/athena-probes/athena-swarm-hint.mjs
expect: over the `On` button of the Claude-route `agent-launch-config` card the tooltip names the one-Claude-phase rule (today: `"pointsShowingHint": 34` of 160, and the `On` button's 32 px read "Every independent phase of this plan at once, up to its ceiling")
```

measured 2026-09-28 by chain chain-swarm-per-plan-20260928-184148-98ae, finding L1, LOW
probe-key: dde89ac328be8dca8744164b17e5ebd12825d4d1

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
