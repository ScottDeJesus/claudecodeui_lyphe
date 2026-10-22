<!-- docstore export; edit rows with docstore write, never this file -->

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

## INV-5654 — probe — the 10-minute ceiling kills the command, not its descendants

the 10-minute ceiling kills the command, not its descendants

```probe
bash /tmp/cu-probe/s19.sh   # shim npm that backgrounds `sleep 660` then blocks; wait for the verdict at T+600s
expect: job.json step failed with "npm did not finish within 10 minutes" and the runner exited, while `sleep 660` (ppid 1) is still alive at T+647s
```

measured 2026-09-28 by chain chain-claude-update-pipeline--runner-20260928-145043-ee33, finding L4, LOW
probe-key: b6189d25952c05f1aab5f0bd48a6718426e64a7e

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/runner-command.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-job.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/claude-updates/update-runner.ts

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

## INV-5670 — probe — Hide on a MIXED arc silently dismisses its done plans, and Show brings back a truncated deck

Hide on a MIXED arc silently dismisses its done plans, and Show brings back a truncated deck

```probe
node /home/lyphe/.claude/state/pipeline-reviews/done-cards-leave/athena-probes/athena-dcl.mjs s9
expect: the "S9 round trip" line reads `[HOLD] … returns the deck with 4 of its 4 cards (progress 3/4 → 3/4)` (today: `[BREAK] … 1 of its 4 cards (progress 3/4 → 0/1)`); needs restorly on the lane (until 2026-09-29T19:02Z)
```

measured 2026-09-28 by chain chain-done-cards-leave-20260928-160626-ad80, finding M1, MEDIUM
probe-key: 8734efe63225eeacfb3de1416303af86f7100857

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcDeck.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/DeletePlanDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hiddenPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useDispatcherPlans.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/putAwayFocus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/project-workspace/hooks/useWorkspaceTabGates.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useCardFold.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-arc-nest.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-arc-strip-return.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dismiss-done.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-runner-widget-list.mjs

## INV-5680 — probe — The standing proof passes a lead that paints nothing

The standing proof passes a lead that paints nothing

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && T=$(mktemp -d) && sed -e "s#'../src/#'$PWD/src/#" -e "s#^async function openTab(page, viewport) {#&\n  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '[data-card-description]{display:none !important}'; document.head.appendChild(s); }));#" .verify/probe-card-description.mjs > $T/p.mjs && npx tsx $T/p.mjs --tag hidden-lead | grep -E "painted on|reading\(s\) failed" | sort | uniq -c; echo "exit ${PIPESTATUS[0]}"
expect: exit 1, with a FAIL on the "starts folded to one line" check for a lead painted on 0 lines (2026-10-02: 4× that FAIL, "8 reading(s) failed", exit 1)
```

measured 2026-09-28 by chain chain-card-description-20260928-165807-7220, finding L1, LOW
probe-key: 97ead18614765315f7387937ac19f5cc982cfe5f

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/dispatcherState.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-description.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dispatch-card-version-word.mjs

## INV-5697 — probe — After a Rework, the re-cut's fresh Accept prompt comes back silently: no phone push, no lane bell (`DispatcherAskBell`, MAN-7540)

After a Rework, the re-cut's fresh Accept prompt comes back silently: no phone push, no lane bell (`DispatcherAskBell`, MAN-7540)

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/plan-prompt-in-chat/athena-probes/rework_key.sh
expect: `same prompt key: false` (today: `first ask: token 634745e991 asked {'id': 8 …}` / `re-cut ask: token 634745e991 asked {'id': 11 …}` / `same prompt key: true | re-cut prompt suppressed by the phone push memory: true`)
```

measured 2026-09-28 by chain chain-plan-prompt-in-chat-20260928-183429-267d, finding M1, MEDIUM
probe-key: 74af5a4f5ee80876547473078c98d616f0b65148

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-answer.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask-reads.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask.transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-prompts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-raise.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/InteractiveRenderers/QuestionTextField.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/hooks/dispatcher/ask.py, /home/lyphe/.claude/hooks/dispatcher/cmd/ask.py, /home/lyphe/.claude/hooks/dispatcher/owed.py, /home/lyphe/.claude/hooks/dispatcher_stop_planners.py, /home/lyphe/.claude/hooks/dispatcher_stop.py, /home/lyphe/.claude/hooks/intent_lock.py, /home/lyphe/.claude/skills/epic/SKILL.md, /home/lyphe/.claude/skills/feature/SKILL.md

## INV-5698 — probe — Two servers can both record the same landing's ask; the raise service claims the second hears `nothing`

Two servers can both record the same landing's ask; the raise service claims the second hears `nothing`

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/plan-prompt-in-chat/athena-probes/double_ask.sh
expect: `runs recording TWO asks for one landing: 0/10` (today: 9/10)
```

measured 2026-09-28 by chain chain-plan-prompt-in-chat-20260928-183429-267d, finding L1, LOW
probe-key: 26bcadb0c241191691e2917d8fd62a43db0ab6eb

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-answer.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask-reads.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask.transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-prompts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-raise.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/InteractiveRenderers/QuestionTextField.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/hooks/dispatcher/ask.py, /home/lyphe/.claude/hooks/dispatcher/cmd/ask.py, /home/lyphe/.claude/hooks/dispatcher/owed.py, /home/lyphe/.claude/hooks/dispatcher_stop_planners.py, /home/lyphe/.claude/hooks/dispatcher_stop.py, /home/lyphe/.claude/hooks/intent_lock.py, /home/lyphe/.claude/skills/epic/SKILL.md, /home/lyphe/.claude/skills/feature/SKILL.md

## INV-5699 — probe — The Stop hold's stand-down reads the store, not the screen, and `dispatcher ask` runs inside a Claude session

The Stop hold's stand-down reads the store, not the screen, and `dispatcher ask` runs inside a Claude session

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/plan-prompt-in-chat/athena-probes/mute.sh
expect: `hold after:` still names the Accept order, or the in-session `ask` is refused (today: `ask inside a Claude session: exit 0` and `hold after:   (no order)`)
```

measured 2026-09-28 by chain chain-plan-prompt-in-chat-20260928-183429-267d, finding L2, LOW
probe-key: fe6d7103d88f1c1ee9fa2ec5dd75af2c64bd3197

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-answer.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-ask.transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-prompts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-raise.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/tools/InteractiveRenderers/QuestionTextField.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/hooks/dispatcher/ask.py, /home/lyphe/.claude/hooks/dispatcher/cmd/ask.py, /home/lyphe/.claude/hooks/dispatcher/owed.py, /home/lyphe/.claude/hooks/dispatcher_stop_planners.py, /home/lyphe/.claude/hooks/dispatcher_stop.py, /home/lyphe/.claude/hooks/intent_lock.py, /home/lyphe/.claude/skills/epic/SKILL.md, /home/lyphe/.claude/skills/feature/SKILL.md

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

## INV-5727 — probe — HIGH — the chat door arms the park-at-peak hour BEFORE the store refuses, so a refused second Accept still schedules a Start for the plan the operator Queued

HIGH — the chat door arms the park-at-peak hour BEFORE the store refuses, so a refused second Accept still schedules a Start for the plan the operator already answered

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/accept-once/athena-probes/hold_then_refuse.sh
expect: `hour armed on the answered plan: None` (today: `2026-09-29T10:00:00Z`, with the second answer's text still reading "This answer recorded nothing")
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
with c: store.open_plan(c,'dupname',repo=R,session='athena-probe'); store.put_design(c,'dupname',D); store.put_phases(c,'dupname',PH,'-')"; env -u CLAUDE_CODE_SESSION_ID scripts/dispatcher accept --hidden dupname dupname; echo "exit $?"; scripts/dispatcher status dupname 2>&1 | grep -i "approved\|unapproved" | head -2; case "$S" in /tmp/athena-dup-*) rm -rf "$S";; esac
expect: one `ACCEPTED dupname — hidden` (the name deduplicated), or a refusal that does not call the plan already approved — today: `REFUSED accept dupname: dupname is already approved (… by cli, now hidden) …`, exit 3, and the plan unapproved
```

measured 2026-09-28 by chain chain-accept-once-20260928-214132-9473, finding L1, LOW
probe-key: 865e41d8b4312cc946816bfea9e36790345505cd

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-asks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatRealtimeHandlers.ts, /home/lyphe/.claude/hooks/dispatcher/accept.py, /home/lyphe/.claude/hooks/dispatcher/cmd/run.py, /home/lyphe/.claude/hooks/dispatcher/judgment_accept.py, /home/lyphe/.claude/hooks/dispatcher/store.py, /home/lyphe/.claude/hooks/dispatcher/store_write.py, /home/lyphe/.claude/hooks/intent_lock.py

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

## INV-5790 — probe — The standing proof cannot see a lead cut by an ellipsis or by a clipping ancestor

The standing proof cannot see a lead cut by an ellipsis or by a clipping ancestor

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && T=$(mktemp -d) && sed -e "s#'../src/#'$PWD/src/#" -e "s#^async function openTab(page, viewport) {#&\n  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '[data-card-description]{white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important}'; document.head.appendChild(s); }));#" .verify/probe-card-description.mjs > $T/p.mjs && npx tsx $T/p.mjs --tag ellipsis | grep -E "lead opens whole|reading\(s\) failed" | sed -E 's/^(PASS|FAIL) tab [0-9]+ (light|dark)/\1 tab/' | sort | uniq -c; echo "exit ${PIPESTATUS[0]}"
expect: exit 1 and a FAIL on the judged card's "opens whole" line, its lead painted on 1 line with its scrollWidth past its clientWidth (2026-10-02: 4× that FAIL, "4 reading(s) failed", exit 1)
```

measured 2026-09-29 by chain chain-card-description-full-20260929-105755-1234, finding M1, MEDIUM
probe-key: 3cbc33de2fe16b8b75d50c03ee129c05f614d28a

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcDeck.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/LaneCardHead.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-description.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dispatch-arc-word.mjs

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

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-ask.mjs, /home/lyphe/.claude/hooks/dispatcher/lock_glance.py, /home/lyphe/.claude/hooks/dispatcher/lock.py, /home/lyphe/.claude/skills/feature/SKILL.md

## INV-5887 — probe — `useHostMove` calls the listener from the render BEFORE the one that committed the move

`useHostMove` calls the listener from the render BEFORE the one that committed the move

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node /home/lyphe/.claude/state/pipeline-reviews/app-drawer-chat--host-window/athena-probe-s6.mjs
expect: `listener closure heard (n after the change is 1): [0]` while the defect stands; `[1]` once the ref is written in a layout effect ahead of the subscription
```

measured 2026-09-29 by chain chain-app-drawer-chat--host-window-20260929-165634-a050, finding M1, MEDIUM
probe-key: 38e830cbd0bf67fdf0635c47446420fbf936f47e

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

## INV-5902 — probe — When the registry loses the row of the left slot, the layer draws the right application under `data-pane-side="left"`, and every act over it is greyed

When the registry loses the row of the left slot, the layer draws the right application under `data-pane-side="left"`, and every act over it is greyed

```probe
node /home/lyphe/.claude/state/pipeline-reviews/app-drawer-chat--switcher-acts/athena-probes/s10b.mjs
expect: the "after delete" line reads front left, cur null, disabled [false,false,true,true,true] while the layer still draws EIS App; the run ends "registry BASELINE RESTORED"
```

measured 2026-09-29 by chain chain-app-drawer-chat--switcher-acts-20260929-172332-8408, finding M2, MEDIUM
probe-key: c6f09bfc38b11189d453e9f377cd16d3e1ebb412

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/hooks/useCurrentApplication.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/hooks/useFrontPane.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/hooks/useSwitcherActions.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/utils/paneSlots.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/app-switcher/utils/radialLayout.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/constants.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts

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

## INV-5932 — probe — (MED) — a sign-out caused by emptied storage leaves no client trace

(MED) — a sign-out caused by emptied storage leaves no client trace

```probe
node /home/lyphe/.claude/state/pipeline-reviews/signed-out/athena-probes/storage-wiped-no-trace.mjs
expect: page trace records: 1 or more, naming why the session ended (measured: 0)
```

measured 2026-09-29 by chain chain-signed-out-20260929-173238-19f4, finding M2, MEDIUM
probe-key: 311bc0c067d615548137dc72e0fde468dc5582e2

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

## INV-5954 — probe — Two of `CommandMenu`'s three viewport reads survive a mutant in the window probe (a 420-px window cannot reach line 117)

Two of `CommandMenu`'s three viewport reads survive a mutant in the window probe (a 420-px window cannot reach line 117)

```probe
cd /home/lyphe/.claude/state/pipeline-reviews/app-drawer-chat--seam-chat-surfaces/athena-probes && MUT='[{"glob":"**/src/modules/chat/composer/CommandMenu.tsx*","from":"hostWindow.innerWidth - 440","to":"innerWidth - 440"}]' node --import ./preload.mjs /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-surfaces-window.mjs | grep -E "FAIL|all checks"
expect: a "[FAIL] the command menu is placed against the window's width" line; today "all checks passed" (the same mutant against `node wide.mjs` — the probe with a 700-px window — prints that FAIL with "right":740)
```

measured 2026-09-29 by chain chain-app-drawer-chat--seam-chat-surfaces-20260929-193540-fce5, finding L1, LOW
probe-key: 95e3498d7f6051f22800fe42cb35dc9607a8140b

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

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-planner-lanes.mjs, /home/lyphe/.claude/hooks/dispatcher/planner_lanes.py, /home/lyphe/.claude/skills/epic/SKILL.md

## INV-6059 — probe — LOW — `planner_lanes.width_of` has no length bound, so `dispatcher planners <64+ digits>` writes a flag the dispatcher itself ignores, and `width_of` does raise

LOW — `planner_lanes.width_of` has no length bound, so `dispatcher planners <64+ digits>` writes a flag the dispatcher itself ignores, and `width_of` does raise

```probe
D=$(mktemp -d /tmp/athena-w-XXXXXX) || exit 1; case "$D" in /tmp/athena-w-*) DISPATCHER_PLANNERS_FLAG_PATH="$D/planners.flag" DISPATCHER_HOME="$D/home" ~/.claude/scripts/dispatcher planners "$(python3 -c 'print("9"*70)')" | cut -c1-30; DISPATCHER_PLANNERS_FLAG_PATH="$D/planners.flag" DISPATCHER_HOME="$D/home" ~/.claude/scripts/dispatcher planners; rm -r "$D";; esac
expect: a `REFUSED planners '…'` line for the 70-digit word, then `PLANNERS lanes=2` (today: `PLANNERS lanes=99999999999999999999999…` exit 0, a 71-byte file, then `PLANNERS lanes=2`; a 5000-digit word today ends in a ValueError line, exit 1)
```

measured 2026-09-30 by chain chain-planner-lanes-dial-20260930-102233-3f63, finding L1, LOW
probe-key: 558664d07bfe8d30ef15ff40745f5a8dd0a2a866

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-planner-lanes.mjs, /home/lyphe/.claude/hooks/dispatcher/planner_lanes.py, /home/lyphe/.claude/skills/epic/SKILL.md

## INV-6060 — probe — LOW — the probe's `-` press and its final restore overwrite a change the operator (or another session) made during the run

LOW — the probe's `-` press and its final restore overwrite a change the operator (or another session) made during the run

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && [ "$(../scripts/dispatcher status --json | python3 -c 'import json,sys; print(sum(1 for p in json.load(sys.stdin)["planners"] if p["state"]=="queued"))')" = 0 ] && { node .verify/probe-planner-lanes.mjs >/dev/null 2>&1 & P=$!; until [ "$(tr -d '\n' < ../state/planners.flag)" = 3 ]; do sleep 0.05; done; ../scripts/dispatcher planners 5 >/dev/null; wait $P; tr -d '\n' < ../state/planners.flag; echo; ../scripts/dispatcher planners 2; }
expect: `5` — the probe leaves a mid-run change alone (today: `2`)
```

measured 2026-09-30 by chain chain-planner-lanes-dial-20260930-102233-3f63, finding L2, LOW
probe-key: 9159d350d908ed93e2c655fde217aa30f513bfd4

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-planner-lanes.mjs, /home/lyphe/.claude/hooks/dispatcher/planner_lanes.py, /home/lyphe/.claude/skills/epic/SKILL.md

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

## INV-6320 — probe — LOW — the tied-rank branch of `ranksForMove` moves cards the operator did not touch, against the other kind

LOW — the tied-rank branch of `ranksForMove` moves cards the operator did not touch, against the other kind

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && TSX_TSCONFIG_PATH=tsconfig.json npx tsx /home/lyphe/.claude/state/pipeline-reviews/card-order-drag/athena-probes/tie.mts
expect: "widget column after" keeps c-wall before d-deck (today: `a-wall b-deck d-deck e-wall c-wall`, with `c-wall` — never carried — now below the deck that stood below it)
```

measured 2026-10-01 by chain chain-card-order-drag-20261001-152353-c269, finding L3, LOW
probe-key: 44e21d54a9185ed78094e1ebb08b12ce9801a104

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
cd /home/lyphe/.claude && docstore get INV-4355 | python3 -c "import sys,json,re; b=json.load(sys.stdin)['row']['body']; print(re.findall(r'silent .deepseek.', b))"; rg -n "never a silent" hooks/dispatcher/store_arcs.py; PYTHONPATH=$HOME/.claude/hooks python3 -c "from dispatcher import model; print(model.own('deepseekk'))"
expect: [] , then a store_arcs.py line that does not name `deepseek`, then `None` (a word nobody wrote is no word of its own: the row follows the house switch, and is never read as `claude` or `deepseek`)
```

measured 2026-10-01 by chain chain-plan-model-default-claude-20261001-165404-dcb1, finding L1, LOW
probe-key: 64905667859c70b3b1fe440f60d1fe69f8225173

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/hooks/dispatcher/model.py, /home/lyphe/.claude/hooks/dispatcher/store_arcs.py, /home/lyphe/.claude/hooks/dispatcher/width.py

## INV-6332 — probe — `Other…` pressed with its page ending at the fold: the field it focused ends up below the fold

`Other…` pressed with its page ending at the fold: the field it focused ends up below the fold

```probe
node /home/lyphe/.claude/state/pipeline-reviews/round-questions-strip/probe-other-clip.mjs
expect: `field focused: true; field fully on screen: false; field inside the strip: true`
```

measured 2026-10-01 by chain chain-round-questions-strip-20261001-185557-37ce, finding L2, LOW
probe-key: a5bee074e70adb8020be57e8b30dd91d330a442e

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
- Ownership is the `launched_by` stamp on `spec.json`, minus the dispatcher's own launches; a chain is owned by every session stamped on any of its stages that is not the dispatcher's.
- A planner outing or phase chain is stamped with the plan's session — the chat the plan was started from, which launched none of it — and lights nothing: both readings skip what `isDispatcherWork` calls the dispatcher's (the mark, the `planner` role, a stage of an `until_pass` chain), over one `readDispatcherChainLaunchIds` pass per call (INV-7062).
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
- The `defaultValue` beside a key: the drawn text when its key is absent, the fallback when present — both carry the new words (`ComposerDeepSeekSwitch.tsx`, `RunnerParkAtPeakRow.tsx`).
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
- `roadmap_mirror_blocks` — the DocSpace copy of each roadmap: the blocks' own words (titles, tile labels, the closing note) say milestone, epic, feature and task, and the Features database carries each row's `where` phrase from `report_roadmap_words` (`_STEP_PHRASES`, `step_phrase`, `milestone_where`; MAN-7621), the phrases' one home on the dispatcher's side.
- Untouched in the prompt: `LOCK_HEADER`, `OPTIONS` and their labels, `TOKEN_RE`, `names_of`, and every input of `lock.token`. why: the vet reads the first line and the last token; an outstanding token must stand.

**The slash doors** are `/feature` and `/epic`: each is the skill itself (`skills/feature/SKILL.md`, `skills/epic/SKILL.md`) and carries its own sequence.

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
| the house writes the operator a page (the DocSpace roadmap) | write his words where the page's blocks are spelled (`roadmap_mirror_blocks`) and in `report_roadmap_words`, the one home of the phrases; no token is involved |
| a row quotes an operator string | quote the new word; prose about the code keeps the code word |

Proof — prints exactly the eight other-sense keys above:
`cd claudecodeui_lyphe && python3 -c "import json,re,glob;w=lambda d,p='':[x for k,v in d.items() for x in (w(v,p+k+'.') if isinstance(v,dict) else [(p+k,v)])];print(sorted(k for f in glob.glob('src/modules/i18n/locales/en/*.json') for k,v in w(json.load(open(f))) if isinstance(v,str) and re.search(r'\b(plans?|arcs?|phases?)\b',re.sub(r'\{\{[^}]*\}\}','',v),re.I)))"`

Translator contract: MAN-7596. Push wording: MAN-622. The prompt's census and facts line: MAN-6047, MAN-1475.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/services/notification-copy.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/operatorWords.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/, /home/lyphe/.claude/hooks/dispatcher/lock_glance.py, /home/lyphe/.claude/hooks/dispatcher/lock.py, /home/lyphe/.claude/hooks/dispatcher/report_roadmap_words.py, /home/lyphe/.claude/hooks/dispatcher/roadmap_mirror_blocks.py, /home/lyphe/.claude/hooks/intent_lock.py

## INV-6398 — probe — `.verify/probe-dismiss-done.mjs` cannot run, and its edited labels were never run (LOW)

`.verify/probe-dismiss-done.mjs` cannot run, and its edited labels were never run (LOW)

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && timeout 60 node .verify/probe-dismiss-done.mjs >/dev/null 2>&1; echo rc=$?
expect: rc=1 (throws "the lane carries no wholly done restorly arc" at probe-dismiss-done.mjs:393 while the lane holds no done restorly arc); it writes nothing before that throw
```

measured 2026-10-02 by chain chain-vocab-epics-features--whole-20261002-174523-3a6d, finding L2, LOW
probe-key: 5984e86a1cdc1efcb750386267e414d32efad24a

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-dismiss-done.mjs

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

## INV-6559 — probe — the row's Traps section quotes a hub refusal the hub does not give

the row's Traps section quotes a hub refusal the hub does not give

```probe
D=$(mktemp -d /tmp/roadmap-probe.XXXXXX) && mkdir -p "$D/state" && printf 'DP=$HOME/.claude/scripts/dispatcher\n$DP roadmap add roadmap pr --title P >/dev/null\n$DP roadmap add milestone goal --roadmap pr --title G >/dev/null\n$DP roadmap mirror 2>&1 >/dev/null | grep "refused page-roadmap-pr" || echo "no refusal"\n' > "$D/p.sh" && DISPATCHER_HOME="$D/state" ~/.claude/docstore/bin/scratch-archpulse 8049 http://127.0.0.1:1 bash "$D/p.sh"; case "$D" in /tmp/roadmap-probe.*) rm -rf "$D";; esac; ~/.claude/scripts/docstore get MAN-7624 --text | grep -n 'goal` or `about' | cut -c1-200 || echo "row line gone"
expect: the first line is `refused page-roadmap-pr: the hub answered 400: invalid: page "page-roadmap-pr": two blocks share the id "blk-roadmap-pr-goal"`; the defect stands while the row's line (82) quotes `UNIQUE constraint failed: blocks.id` for this case; cured when the row quotes the "two blocks share the id" text for `goal`/`about` and gives the UNIQUE text to the cross-page collision
```

measured 2026-10-03 by chain chain-roadmap--mirror--docs-20261003-170800-0dca, finding M1, MEDIUM
probe-key: a9ee10e6e793fba7abbb699de4dd5a34fbdd356d

governs: /home/lyphe/.claude/hooks/dispatcher/roadmap_mirror_blocks.py, /home/lyphe/.claude/hooks/dispatcher/roadmap_mirror_orphans.py, /home/lyphe/.claude/hooks/dispatcher/roadmap_mirror.py, /home/lyphe/.claude/hooks/dispatcher/roadmap_mirror_wire.py

## INV-6560 — probe — "`dry_run` counts what a write would do" is false for a refusal

"`dry_run` counts what a write would do" is false for a refusal

```probe
D=$(mktemp -d /tmp/roadmap-probe.XXXXXX) && mkdir -p "$D/state" && printf 'DP=$HOME/.claude/scripts/dispatcher\n$DP roadmap add roadmap probe-mirror --title P >/dev/null\necho "dry:  $($DP roadmap mirror --dry-run 2>/dev/null)"\necho "real: $($DP roadmap mirror 2>/dev/null)"\n' > "$D/p.sh" && DISPATCHER_HOME="$D/state" ~/.claude/docstore/bin/scratch-archpulse 8049 http://127.0.0.1:1 bash "$D/p.sh"; case "$D" in /tmp/roadmap-probe.*) rm -rf "$D";; esac; ~/.claude/scripts/docstore get MAN-7624 --text | grep -n 'dry_run` counts' | cut -c1-160 || echo "row line gone"
expect: `dry:` prints `created 1 · … · refused 0` and `real:` prints `created 0 · … · refused 1` (the two differ for the same store); the defect stands while the row says a dry run counts what a write would do with no exception for a refusal
```

measured 2026-10-03 by chain chain-roadmap--mirror--docs-20261003-170800-0dca, finding L1, LOW
probe-key: cb7e0e9611342c8c5d7f045bda1449c03583655f

governs: /home/lyphe/.claude/hooks/dispatcher/roadmap_mirror_blocks.py, /home/lyphe/.claude/hooks/dispatcher/roadmap_mirror_orphans.py, /home/lyphe/.claude/hooks/dispatcher/roadmap_mirror.py, /home/lyphe/.claude/hooks/dispatcher/roadmap_mirror_wire.py

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

governs: /home/lyphe/.claude/hooks/dispatcher/roadmap_mirror_blocks.py, /home/lyphe/.claude/hooks/dispatcher/roadmap_mirror_orphans.py, /home/lyphe/.claude/hooks/dispatcher/roadmap_mirror.py, /home/lyphe/.claude/hooks/dispatcher/roadmap_mirror_wire.py

## INV-6562 — probe — INV-6394's new bullet sits under a heading, a lede and a when/do row that say "prompt"

INV-6394's new bullet sits under a heading, a lede and a when/do row that say "prompt"

```probe
~/.claude/scripts/docstore get INV-6394 --text | grep -n -E "^\*\*The house's prompt to the operator\*\*|^- \`roadmap_mirror\`|^\| the house prompts the operator|^The house's prompt|prompt to the operator carries his words \(below\)" | cut -c1-170
expect: lines 5 (the lede that says "prompt"), 28 (the heading that says "prompt"), 32 (the `roadmap_mirror` bullet under it) and 55 (the when/do row that says "prompts the operator") all print; the defect stands while the heading names only the prompt; cured when the heading and the when/do row name text to the operator (prompt and page), or the bullet says why it belongs
```

measured 2026-10-03 by chain chain-roadmap--mirror--docs-20261003-170800-0dca, finding L3, LOW
probe-key: 45690ac0df834e60c26f0bc4352f93c71c803c56

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/services/notification-copy.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/operatorWords.ts, /home/lyphe/.claude/hooks/dispatcher/lock_glance.py, /home/lyphe/.claude/hooks/dispatcher/lock.py, /home/lyphe/.claude/hooks/dispatcher/report_roadmap_words.py, /home/lyphe/.claude/hooks/dispatcher/roadmap_mirror_blocks.py, /home/lyphe/.claude/hooks/intent_lock.py

## INV-6563 — probe — MAN-7624 governs a third path the intent does not name

MAN-7624 governs a third path the intent does not name

```probe
~/.claude/scripts/docstore get MAN-7624 | python3 -c "import sys,json; g=json.load(sys.stdin)['row']['governs']; print(len(g), g)"
expect: prints `3` and the two `.py` paths plus `/home/lyphe/.claude/state/dispatcher/roadmap-mirror.log`; the intent names two; cured when it prints `2` (or the third is ruled a deliberate third)
```

measured 2026-10-03 by chain chain-roadmap--mirror--docs-20261003-170800-0dca, finding L4, LOW
probe-key: 31d1ed41dc86d1d1e39110f466ccc43ef130be61

governs: /home/lyphe/.claude/hooks/dispatcher/roadmap_mirror_blocks.py, /home/lyphe/.claude/hooks/dispatcher/roadmap_mirror_orphans.py, /home/lyphe/.claude/hooks/dispatcher/roadmap_mirror.py, /home/lyphe/.claude/hooks/dispatcher/roadmap_mirror_wire.py

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
expect: a number of 1 or more (the log line the mirror wrote for the page it composed while the builder's probe lived)
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

## INV-6685 — probe — LOW — the scaffold's two new surfaces have no doc home, and the report says a phase will give them one that is not scheduled to

LOW — the scaffold's two new surfaces have no doc home, and the report says a phase will give them one that is not scheduled to

```probe
~/.claude/scripts/docstore get MAN-7643 --text | grep -c 'FeatureCases'; ~/.claude/scripts/docstore get MAN-7643 --text | grep -c '{ feature, picture, onWriteGoal() }'
expect: prints `0` and `1` while the defect stands (cured: a non-zero count and `0`)
```

measured 2026-10-04 by chain chain-regression-cases--screen--scaffold-20261004-024906-f45e, finding L5, LOW
probe-key: be27479a0204efd06edd15f4d30f85825dfa127c

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureCases.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/FeatureFacts.tsx

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

## INV-6721 — probe — `src/modules/chat/index.ts:5` still says Subagents is "the third widget"

`src/modules/chat/index.ts:5` still says Subagents is "the third widget"

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n "as the third widget" src/modules/chat/index.ts || echo none
expect: none (today: 5:// opens. Its consumer is the chat-gutters module, which mounts it as the third widget.)
```

measured 2026-10-04 by chain chain-roadmap--widget--docs-20261004-081056-7d30, finding L1, LOW
probe-key: 5f0926fcfb6ab6ce2c3fb292c3881caa4c443792

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/index.ts

## INV-6724 — probe — The report's "Shown" line is met for three rows of seven, as excerpts

The report's "Shown" line is met for three rows of seven, as excerpts

```probe
cd ~/.claude && for n in 421 7527 7648 7656; do docstore history MAN-$n --text | head -1 | cut -c1-40; done
expect: four lines dated 2026-10-04T15:14 to 15:15, rows the report names without printing
```

measured 2026-10-04 by chain chain-roadmap--widget--docs-20261004-081056-7d30, finding L4, LOW
probe-key: 92ac425f298c18086f3684c6e8cccd540c4bf31b

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/modals/OpenDialog.tsx

## INV-6749 — probe — (LOW) — the screen is still called "Runner" in other words the three-phrase grep cannot see

(LOW) — the screen is still called "Runner" in other words the three-phrase grep cannot see

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -rn -E "Runner (homes|lane's memory|card|readout)|opens the Runner at|Runner and Memory panes|Memory and Runner panels|Heal, Memory and Runner" src server docs/MANUAL.md docs/architecture/MANUAL.md | wc -l
expect: 12 now; 0 once these read as the Roadmap tab's In flight face / the Runs widget (the panels sentences may stay if read as component names)
```

measured 2026-10-04 by chain chain-roadmap--judgment--names-app-20261004-110113-6ede, finding L2, LOW
probe-key: cf2235f7cd2664d7ac664e22e6cd013fe402b6b2

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-6809 — probe — LOW — the purge grep looks for `swarm` only, so the other deleted name, `ceiling`, still stands in two places

LOW — the purge grep looks for `swarm` only, so the other deleted name, `ceiling`, still stands in two places

```probe
cd /home/lyphe/.claude && grep -c 'width.route`/`ceiling`' hooks/dispatcher/report.py; echo "MAN-5604 route-and-ceiling lines: $(docstore get MAN-5604 | grep -c 'route and ceiling from')"
echo "[probe exit $?]"
expect: `0` and `0` (today: `1` and `1`) — neither names `ceiling` as something `width` hands the report
```

measured 2026-10-04 by chain chain-wip-3-retire-swarm-20261004-160207-cd7a, finding L1, LOW
probe-key: 489b2fdafd17128b9c0d8202563ca59d607402c4

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/cardOrder.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/dispatcherState.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/order-lane.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-order.mjs, /home/lyphe/.claude/hooks/dispatcher/report.py

## INV-6811 — probe — LOW — INV-6509 and INV-6510 are executable probe rows of the retired swarm ladder; both crash on the deleted harness. The report filed them as "provenance identifiers".

LOW — INV-6509 and INV-6510 are executable probe rows of the retired swarm ladder; both crash on the deleted harness. The report filed them as "provenance identifiers".

```probe
cd /home/lyphe/.claude && for t in INV-6509 INV-6510; do docstore get $t >/dev/null 2>&1 && echo "$t still filed" || echo "$t retired"; done; for m in a11y contrast; do printf 'marker.mjs %s: ERR_MODULE_NOT_FOUND lines: ' $m; (cd claudecodeui_lyphe && timeout 100 node /home/lyphe/.claude/state/pipeline-reviews/swarm-ladder/athena-probes/marker.mjs $m 2>&1 | grep -c ERR_MODULE_NOT_FOUND); done
echo "[probe exit $?]"
expect: both rows `retired` (today: `still filed` twice, and the crash-line count `3` for each mode)
```

measured 2026-10-04 by chain chain-wip-3-retire-swarm-20261004-160207-cd7a, finding L3, LOW
probe-key: 7042a8fadf0f2d26e08ca0a7f1156feddcf11451

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/cardOrder.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/dispatcherState.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/order-lane.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-order.mjs, /home/lyphe/.claude/hooks/dispatcher/report.py

## INV-6812 — probe — LOW — the one-command proof cannot fail: `exit 0` carries nothing, and the report's headline leans on it

LOW — the one-command proof cannot fail: `exit 0` carries nothing, and the report's headline leans on it

```probe
D=$(mktemp -d /tmp/athena-proofcopy-XXXXXX) || exit 1
case "$D" in /tmp/athena-proofcopy-*) ;; *) echo "refusing $D"; exit 1;; esac
sed -n '1,75p' /tmp/wip-3-proof.sh | sed 's/"swarm" not in route/"provider" not in route/' > "$D/head.sh"
bash "$D/head.sh" 2>&1 | grep -E "^  (PASS|FAIL)  route has no .swarm"
echo "script exit with that FAIL printed: ${PIPESTATUS[0]}"
case "$D" in /tmp/athena-proofcopy-*) rm -r "$D";; esac
echo "[probe exit $?]"
expect: `FAIL  route has no \`swarm\`` and `script exit with that FAIL printed: 1` once the script carries a failing check out (today: `0`)
```

measured 2026-10-04 by chain chain-wip-3-retire-swarm-20261004-160207-cd7a, finding L4, LOW
probe-key: 0ad01e788ea50828c6b9b80249d8ffc426e5a3a2

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/cardOrder.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/dispatcherState.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/order-lane.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-order.mjs, /home/lyphe/.claude/hooks/dispatcher/report.py

## INV-6961 — probe — MEDIUM — a try's end is the chain's closing moment, not the soul's: a limit wait is counted as agents working

MEDIUM — a try's end is the chain's closing moment, not the soul's: a limit wait is counted as agents working

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/elapsed-runtime/athena-probes/capped_gap.sh
echo "[probe exit $?]"
expect: `overstated by 0 s` (the figure closes each try at its launch's own end); the defect reads `dispatcher runtime_s: 96814 | union with each try closed at its launch's own end: 92675 | overstated by 4139 s`
```

measured 2026-10-05 by chain chain-elapsed-runtime-20261005-141903-e942, finding M1, MEDIUM
probe-key: 356d17e0d6f6649da51d76929d8b3005bebdab32

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useWorkedSeconds.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/workingTime.ts, /home/lyphe/.claude/hooks/dispatcher/report_runtime.py, /home/lyphe/.claude/hooks/dispatcher/store_planners.py, /home/lyphe/.claude/hooks/dispatcher/store.py

## INV-6962 — probe — LOW — the tick subtracts the server's stamp from the browser's clock; a browser ahead of the server paints a larger figure at once

LOW — the tick subtracts the server's stamp from the browser's clock; a browser ahead of the server paints a larger figure at once

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/elapsed-runtime/athena-probes/skew.sh
echo "[probe exit $?]"
expect: all three lines read `paints 10m` (the figure is the server's, whatever the browser's clock says); the defect reads `+5 min … paints 15m`
```

measured 2026-10-05 by chain chain-elapsed-runtime-20261005-141903-e942, finding L1, LOW
probe-key: 60ac130b3bd02a8b4b7040d07f6b7a23ebe6fdce

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useWorkedSeconds.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/workingTime.ts, /home/lyphe/.claude/hooks/dispatcher/report_runtime.py, /home/lyphe/.claude/hooks/dispatcher/store_planners.py, /home/lyphe/.claude/hooks/dispatcher/store.py

## INV-6963 — probe — LOW — a feature's first agent can read `runtime_s` 0, and `runtime_s > 0 &&` then never mounts the pill that would tick it up

LOW — a feature's first agent can read `runtime_s` 0, and `runtime_s > 0 &&` then never mounts the pill that would tick it up

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/elapsed-runtime/athena-probes/first_launch_zero.sh
echo "[probe exit $?]"
expect: `runtime_s = 1` or more with the outing `out`, or a `card gate:` line that names `running`/`planAgentOut` ahead of the figure; the defect reads `runtime_s = 0 | planner outing out: out` and `card gate: … plan.runtime_s > 0 && <WorkingPill …`
```

measured 2026-10-05 by chain chain-elapsed-runtime-20261005-141903-e942, finding L2, LOW
probe-key: f6a18bc5eec889e87415a54e9f421ff48d94596e

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useWorkedSeconds.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/workingTime.ts, /home/lyphe/.claude/hooks/dispatcher/report_runtime.py, /home/lyphe/.claude/hooks/dispatcher/store_planners.py, /home/lyphe/.claude/hooks/dispatcher/store.py

## INV-6966 — probe — MEDIUM — `cerberusResultsDb.insert` answers `false` ("a row was already there") for a row that was REJECTED, so a malformed row is acked and lost; and nothing guards `at`'s type

MEDIUM — `cerberusResultsDb.insert` answers `false` ("a row was already there") for a row that was REJECTED, so a malformed row is acked and lost; and nothing guards `at`'s type

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && D=$(mktemp -d /tmp/athena-probe.XXXXXX) && CERBERUS_DB_PATH=$D/c.db DATABASE_PATH=$D/auth.db TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --input-type=module -e "
const m = await import('@/modules/database/index.js');
const row = { node:'eis1', check_key:'a/x', at:1, source:null, seq:null, fetched_at:null, status:'ok', doc_status:null, value:null, data:null, took_ms:null, prev_at:null, prev_status:null, kind:'bogus' };
let r; try { r = m.cerberusResultsDb.insert(row); } catch (e) { r = 'threw ' + e.code; }
console.log('F1 bogus-kind insert ->', r, '| rows stored', m.getCerberusConnection().prepare('select count(*) c from results').get().c);
" 2>&1 | grep '^F1'; case "$D" in /tmp/athena-probe.*) cd /tmp && rm -rf "$D";; esac
expect: "F1 bogus-kind insert -> false | rows stored 0" while the defect stands; cured, it prints "threw SQLITE_CONSTRAINT_CHECK | rows stored 0"
```

measured 2026-10-06 by chain chain-cerberus--center--store-20261005-204446-a5ee, finding M1, MEDIUM
probe-key: e96cb29c35fa8eb622db776da38c68343f92d9c5

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-connection.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-definitions.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-enroll.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-mutes.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-nodes.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-results.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-open-race.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-store.mjs

## INV-6967 — probe — MEDIUM — `transitions(before, limit)` cannot be paged through a same-millisecond group: the rows past `limit` at a tied `at` are skipped for ever

MEDIUM — `transitions(before, limit)` cannot be paged through a same-millisecond group: the rows past `limit` at a tied `at` are skipped for ever

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && D=$(mktemp -d /tmp/athena-probe.XXXXXX) && CERBERUS_DB_PATH=$D/c.db DATABASE_PATH=$D/auth.db TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --input-type=module -e "
const m = await import('@/modules/database/index.js');
const R = m.cerberusResultsDb;
const row = (o) => ({ node:'eis1', check_key:'a/x', at:1, source:null, seq:null, fetched_at:null, status:'failing', doc_status:null, value:null, data:null, took_ms:null, prev_at:null, prev_status:'ok', kind:'change', ...o });
for (let i = 0; i < 5; i++) R.insert(row({ check_key:'k' + i, at:1000 }));
R.insert(row({ check_key:'k9', at:900 }));
const seen = []; let before = 2000;
for (let p = 0; p < 8; p++) { const page = R.transitions(before, 2); if (!page.length) break; seen.push(...page.map((r) => r.check_key + '@' + r.at)); before = page[page.length - 1].at; }
console.log('F2 paged union', seen.length, 'of 6:', seen.join(','));
" 2>&1 | grep '^F2'; case "$D" in /tmp/athena-probe.*) cd /tmp && rm -rf "$D";; esac
expect: "F2 paged union 3 of 6: k0@1000,k1@1000,k9@900" while the defect stands; cured, 6 of 6
```

measured 2026-10-06 by chain chain-cerberus--center--store-20261005-204446-a5ee, finding M2, MEDIUM
probe-key: c2b3f6af3f18bfa680fc04706790162accda1de1

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-connection.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-definitions.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-enroll.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-mutes.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-nodes.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-results.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-open-race.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-store.mjs

## INV-6968 — probe — LOW — `transitions` has no index to read: it scans every `results` row, 135–162 ms per call at the 90-day volume

LOW — `transitions` has no index to read: it scans every `results` row, 135–162 ms per call at the 90-day volume

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && D=$(mktemp -d /tmp/athena-probe.XXXXXX) && CERBERUS_DB_PATH=$D/c.db DATABASE_PATH=$D/auth.db TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --input-type=module -e "
const m = await import('@/modules/database/index.js');
const db = m.getCerberusConnection(); const orig = db.prepare.bind(db);
db.prepare = (sql) => { if (/prev_status IS NOT NULL/.test(sql) && /ORDER BY at DESC/.test(sql)) console.log('F3 transitions plan', JSON.stringify(orig('EXPLAIN QUERY PLAN ' + sql).all(1e15, 7).map((r) => r.detail))); return orig(sql); };
m.cerberusResultsDb.transitions(1e15, 7);
" 2>&1 | grep '^F3'; case "$D" in /tmp/athena-probe.*) cd /tmp && rm -rf "$D";; esac
expect: 'F3 transitions plan ["SCAN results","USE TEMP B-TREE FOR ORDER BY"]' while no index serves it; cured, a SEARCH ... USING INDEX line
```

measured 2026-10-06 by chain chain-cerberus--center--store-20261005-204446-a5ee, finding L1, LOW
probe-key: 9976e5c1ab3b21243d27e85797b35584d0917343

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-connection.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-definitions.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-enroll.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-mutes.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-nodes.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-results.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-open-race.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-store.mjs

## INV-6969 — probe — LOW — a non-positive or non-integer `limit` is not defined: `-1` dumps every row, `NaN`/`2.5`/`Infinity` throw `datatype mismatch`

LOW — a non-positive or non-integer `limit` is not defined: `-1` dumps every row, `NaN`/`2.5`/`Infinity` throw `datatype mismatch`

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && D=$(mktemp -d /tmp/athena-probe.XXXXXX) && CERBERUS_DB_PATH=$D/c.db DATABASE_PATH=$D/auth.db TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --input-type=module -e "
const m = await import('@/modules/database/index.js');
const R = m.cerberusResultsDb;
const row = (o) => ({ node:'eis1', check_key:'a/x', at:1, source:null, seq:null, fetched_at:null, status:'ok', doc_status:null, value:null, data:null, took_ms:null, prev_at:null, prev_status:null, kind:'change', ...o });
for (const at of [10, 20, 30, 40, 50]) R.insert(row({ at }));
const tryLimit = (limit) => { try { return R.recentChanges('eis1', 'a/x', 0, limit).length; } catch (e) { return 'threw ' + e.message; } };
console.log('F4 recentChanges of 5 rows, limit 2 / -1 / NaN ->', tryLimit(2), '/', tryLimit(-1), '/', tryLimit(NaN));
" 2>&1 | grep '^F4'; case "$D" in /tmp/athena-probe.*) cd /tmp && rm -rf "$D";; esac
expect: "F4 recentChanges of 5 rows, limit 2 / -1 / NaN -> 2 / 5 / threw datatype mismatch" while the defect stands; cured, -1 answers 0 or throws
```

measured 2026-10-06 by chain chain-cerberus--center--store-20261005-204446-a5ee, finding L2, LOW
probe-key: e7716a0525bc5d921f830be6da2238be5d346c3a

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-connection.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-definitions.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-enroll.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-mutes.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-nodes.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-results.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-open-race.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-store.mjs

## INV-6970 — probe — LOW — `rowsInWindow` returns a neighbour row once per repeat of its key

LOW — `rowsInWindow` returns a neighbour row once per repeat of its key

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && D=$(mktemp -d /tmp/athena-probe.XXXXXX) && CERBERUS_DB_PATH=$D/c.db DATABASE_PATH=$D/auth.db TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --input-type=module -e "
const m = await import('@/modules/database/index.js');
const R = m.cerberusResultsDb;
const row = (o) => ({ node:'eis1', check_key:'a/x', at:1, source:null, seq:null, fetched_at:null, status:'ok', doc_status:null, value:null, data:null, took_ms:null, prev_at:null, prev_status:null, kind:'change', ...o });
for (const at of [100, 200, 300, 400, 500]) R.insert(row({ at }));
console.log('F5 rowsInWindow keys [a/x,a/x] 201..399 ->', R.rowsInWindow('eis1', ['a/x', 'a/x'], 201, 399).map((r) => r.check_key + ':' + r.at).join(','));
" 2>&1 | grep '^F5'; case "$D" in /tmp/athena-probe.*) cd /tmp && rm -rf "$D";; esac
expect: "F5 rowsInWindow keys [a/x,a/x] 201..399 -> a/x:200,a/x:200,a/x:300,a/x:400,a/x:400" while the defect stands; cured, a/x:200,a/x:300,a/x:400
```

measured 2026-10-06 by chain chain-cerberus--center--store-20261005-204446-a5ee, finding L3, LOW
probe-key: b4cfb5cf2f1f295b6be0ebb50f142283376260a2

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-connection.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-definitions.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-enroll.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-mutes.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-nodes.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-results.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-open-race.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-store.mjs

## INV-6972 — probe — MEDIUM — `CerberusLookup`'s `stale` clause states the rule the arc's design replaced, and contradicts the brief's own shown proof

MEDIUM — `CerberusLookup`'s `stale` clause states the rule the arc's design replaced, and contradicts the brief's own shown proof

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe
doc() { awk -v t="$1" '/^\/\*\*/{b=""} {b=b $0 "\n"} /^export type /{ if ($3==t) {printf "%s", b; exit} b="" }' server/shared/cerberus-types.ts | tr '\n' ' ' | sed 's/ \* / /g; s/  */ /g'; }
echo "stale clause: $(doc CerberusLookup | grep -oE '`stale` \([^)]*\)' || echo none)"
echo "doc names prevAt/lastReceived/continuity: $(doc CerberusLookup | grep -ciE 'prevAt|prev_at|lastReceived|continuity')"
EOF
bash "$D/p.sh"; rm -f "$D/p.sh" && rmdir "$D"
```

measured 2026-10-06 by chain chain-cerberus--center--contract-20261005-204445-dbf6, finding M1, MEDIUM
probe-key: 09c028156b87247c171a781376869b1dc757813d

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts

## INV-6973 — probe — LOW — the header states a size for `server/shared/types.ts` that is wrong, and moves

LOW — the header states a size for `server/shared/types.ts` that is wrong, and moves

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe
echo "header claim: $(grep -n 'is [0-9]* lines' server/shared/cerberus-types.ts | cut -c1-90 || true) | wc -l says: $(wc -l < server/shared/types.ts)"
EOF
bash "$D/p.sh"; rm -f "$D/p.sh" && rmdir "$D"
```

measured 2026-10-06 by chain chain-cerberus--center--contract-20261005-204445-dbf6, finding L1, LOW
probe-key: 12334cdf683c2f24c87106b48705efa3805ba041

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts

## INV-6974 — probe — LOW — `CerberusProbeSpec` says the spec is "kept as the `probes` table's row"; `pass`, `warn` and `staleAfter` have no column there

LOW — `CerberusProbeSpec` says the spec is "kept as the `probes` table's row"; `pass`, `warn` and `staleAfter` have no column there

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe
doc() { awk -v t="$1" '/^\/\*\*/{b=""} {b=b $0 "\n"} /^export type /{ if ($3==t) {printf "%s", b; exit} b="" }' server/shared/cerberus-types.ts | tr '\n' ' ' | sed 's/ \* / /g; s/  */ /g'; }
echo "comment claims the probes row: $(doc CerberusProbeSpec | grep -cE "probes. table's row")"
echo "columns of probes/checks holding pass|warn|stale_after:"; grep -nE '^\s+(pass|warn|stale_after) ' server/modules/database/cerberus-schema.ts | cut -c1-60
EOF
bash "$D/p.sh"; rm -f "$D/p.sh" && rmdir "$D"
```

measured 2026-10-06 by chain chain-cerberus--center--contract-20261005-204445-dbf6, finding L2, LOW
probe-key: 9c8171cdaed4f27b11849db517b8c5cfe5c3ead7

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts

## INV-6975 — probe — LOW — what a node reports when it has not been heard since boot, and what the hub reports, are left to the reader

LOW — what a node reports when it has not been heard since boot, and what the hub reports, are left to the reader

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe
doc() { awk -v t="$1" '/^\/\*\*/{b=""} {b=b $0 "\n"} /^export type /{ if ($3==t) {printf "%s", b; exit} b="" }' server/shared/cerberus-types.ts | tr '\n' ' ' | sed 's/ \* / /g; s/  */ /g'; }
echo "overlapping phrases: $(doc CerberusNodeView | grep -oE 'every node from boot until its warden is heard again|has not yet sent a first heartbeat' | tr '\n' '|')"
echo "NodeView sentences naming the hub:"; doc CerberusNodeView | grep -oE '[^.]*\bhub\b[^.]*' | sed 's/^ */  - /'
echo "names last_heartbeat_at / before boot: $(doc CerberusNodeView | grep -ciE 'last_heartbeat_at|before (this|the) boot')"
EOF
bash "$D/p.sh"; rm -f "$D/p.sh" && rmdir "$D"
```

measured 2026-10-06 by chain chain-cerberus--center--contract-20261005-204445-dbf6, finding L3, LOW
probe-key: 6045e62056134f95d5b51a4f65f788d7787087f2

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts

## INV-6976 — probe — LOW — `CerberusNodeCert.sig` is "over the other fields"; the design says what is signed, and the two differ

LOW — `CerberusNodeCert.sig` is "over the other fields"; the design says what is signed, and the two differ

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe
doc() { awk -v t="$1" '/^\/\*\*/{b=""} {b=b $0 "\n"} /^export type /{ if ($3==t) {printf "%s", b; exit} b="" }' server/shared/cerberus-types.ts | tr '\n' ' ' | sed 's/ \* / /g; s/  */ /g'; }
echo "contract: $(doc CerberusNodeCert | grep -oE 'sig. is center.s[^.]*\.' || echo none)"
echo "design names a three-field statement: $(grep -c 'signed statement `{node, fingerprint, issuedAt}`' /home/lyphe/.claude/plans/cerberus--center.design.toml)"
echo "contract names the signed text's layout: $(doc CerberusNodeCert | grep -ciE 'signed text|canonical|serialis|serializ|newline|joined')"
EOF
bash "$D/p.sh"; rm -f "$D/p.sh" && rmdir "$D"
```

measured 2026-10-06 by chain chain-cerberus--center--contract-20261005-204445-dbf6, finding L4, LOW
probe-key: facd5a5dafc7c4434e5d68f3d1e64c8fcc00a299

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts

## INV-6977 — probe — LOW — `CerberusStoredStatus` says no status word beyond the four is ever written and `not_enabled` is "never spelled"; the store spells it in `prev_status`

LOW — `CerberusStoredStatus` says no status word beyond the four is ever written and `not_enabled` is "never spelled"; the store spells it in `prev_status`

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe
doc() { awk -v t="$1" '/^\/\*\*/{b=""} {b=b $0 "\n"} /^export type /{ if ($3==t) {printf "%s", b; exit} b="" }' server/shared/cerberus-types.ts | tr '\n' ' ' | sed 's/ \* / /g; s/  */ /g'; }
echo "comment says never spelled: $(doc CerberusStoredStatus | grep -c 'never spelled') ; mentions prev_status: $(doc CerberusStoredStatus | grep -c 'prev_status')"
echo "store spells not_enabled in prev_status: $(grep -c "COALESCE(\${prefix}status, 'not_enabled')" server/modules/database/repositories/cerberus-results.db.ts)"
EOF
bash "$D/p.sh"; rm -f "$D/p.sh" && rmdir "$D"
```

measured 2026-10-06 by chain chain-cerberus--center--contract-20261005-204445-dbf6, finding L5, LOW
probe-key: 98fa745784c99d709a7ed658c410c21eedc1520e

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts

## INV-6980 — probe — a result dated in the future is stored, and from then on every honest result is dropped and acked (MEDIUM)

a result dated in the future is stored, and from then on every honest result is dropped and acked (MEDIUM)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
S=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$S/s.mjs" <<'JS'
const db = await import("@/modules/database/index.js");
const ws = await import("@/modules/websocket/index.js");
const D = await import("@/modules/cerberus/definitions.service.js");
const { ingest } = await import("@/modules/cerberus/ingest.service.js");
const { wardenLinks } = await import("@/modules/cerberus/warden-links.js");
const conn = db.getCerberusConnection();
db.cerberusNodesDb.insert({ id: "probe-node", desc: null, public_key: "k", cert_fingerprint: "f", warden_version: null, machine_id: null, facts: null, enrolled_at: Date.now() });
const doc = () => ({ services: [{ service: "svc", label: null, probes: [{ key: "svc/health", kind: "health_doc", every: 30, timeout: 5, cadence: 30, url: "http://127.0.0.1:1/h" }] }] });
const w = (check, at, o = {}) => ({ check, source: "svc/health", at, fetchedAt: at, status: "ok", docStatus: "green", value: "fine", data: null, tookMs: 5, prevAt: null, ...o });
const T = (fn) => { try { return fn(); } catch (e) { return "THREW " + (e.code ?? e.name) + ": " + String(e.message).slice(0, 60); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
T(() => D.putDefinition("probe-node", doc()));
const now = Date.now();
T(() => ingest.ingestResults("probe-node", 1, [w("svc/clk", now - 60_000)]));
const skew = T(() => ingest.ingestResults("probe-node", 2, [w("svc/clk", now + 3_600_000, { prevAt: now - 60_000 })]));
const honest = T(() => ingest.ingestResults("probe-node", 3, [w("svc/clk", now, { status: "failing", docStatus: "red", prevAt: now - 30_000 })]));
console.log("PROBE skewed(+1h) result:", JSON.stringify(skew), "| honest FAILING result after the clock came back:", JSON.stringify(honest), "| lastReceivedAt - now (ms):", ingest.memory("probe-node", "svc/clk").lastReceivedAt - now);
JS
( cd /home/lyphe/.claude/claudecodeui_lyphe && CERBERUS_DB_PATH="$S/c.db" DATABASE_PATH="$S/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 60 node --import tsx "$S/s.mjs" 2>&1 | grep '^PROBE' )
case "$S" in /tmp/athena-probe.*) rm -r "$S" ;; esac
EOF
bash "$D/p.sh"; case "$D" in /tmp/athena-probe.*) rm -r "$D" ;; esac
expect: honest FAILING result … {"stored":0,"changed":[]} and lastReceivedAt - now ≈ 3600000 while the defect stands; a refused skewed result, or an honest one with "stored":1, once cured
```

measured 2026-10-06 by chain chain-cerberus--center--write-path-20261006-080105-6b69, finding M1, MEDIUM
probe-key: 3e0c168296fe3a7efebcf7fe1873c8255020994e

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus-broadcast.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definition-document.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definition-rows.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definitions.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/ingest.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-links.ts

## INV-6981 — probe — `labels` for a component not yet seen are dropped, and the PUT answers success (MEDIUM)

`labels` for a component not yet seen are dropped, and the PUT answers success (MEDIUM)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
S=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$S/s.mjs" <<'JS'
const db = await import("@/modules/database/index.js");
const ws = await import("@/modules/websocket/index.js");
const D = await import("@/modules/cerberus/definitions.service.js");
const { ingest } = await import("@/modules/cerberus/ingest.service.js");
const { wardenLinks } = await import("@/modules/cerberus/warden-links.js");
const conn = db.getCerberusConnection();
db.cerberusNodesDb.insert({ id: "probe-node", desc: null, public_key: "k", cert_fingerprint: "f", warden_version: null, machine_id: null, facts: null, enrolled_at: Date.now() });
const doc = () => ({ services: [{ service: "svc", label: null, probes: [{ key: "svc/health", kind: "health_doc", every: 30, timeout: 5, cadence: 30, url: "http://127.0.0.1:1/h" }] }] });
const w = (check, at, o = {}) => ({ check, source: "svc/health", at, fetchedAt: at, status: "ok", docStatus: "green", value: "fine", data: null, tookMs: 5, prevAt: null, ...o });
const T = (fn) => { try { return fn(); } catch (e) { return "THREW " + (e.code ?? e.name) + ": " + String(e.message).slice(0, 60); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const d = doc(); d.services[0].labels = { "proc.up": "Process is up" };
const put = T(() => D.putDefinition("probe-node", d));
T(() => ingest.ingestResults("probe-node", 1, [w("svc/proc.up", Date.now() - 60_000)]));
const stored = conn.prepare("SELECT label FROM checks WHERE key = ?").get("svc/proc.up");
const got = T(() => D.getDefinition("probe-node").services.find((s) => s.service === "svc").labels ?? "none");
console.log("PROBE PUT answered", JSON.stringify(put), "| label stored after first sighting:", JSON.stringify(stored), "| GET labels:", JSON.stringify(got));
JS
( cd /home/lyphe/.claude/claudecodeui_lyphe && CERBERUS_DB_PATH="$S/c.db" DATABASE_PATH="$S/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 60 node --import tsx "$S/s.mjs" 2>&1 | grep '^PROBE' )
case "$S" in /tmp/athena-probe.*) rm -r "$S" ;; esac
EOF
bash "$D/p.sh"; case "$D" in /tmp/athena-probe.*) rm -r "$D" ;; esac
expect: PUT answered {"version":1} | label stored after first sighting: {"label":null} | GET labels: "none"
```

measured 2026-10-06 by chain chain-cerberus--center--write-path-20261006-080105-6b69, finding M2, MEDIUM
probe-key: a3c60317e6dccf42f3eef7c5d96d29c2c23e4e20

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus-broadcast.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definition-document.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definition-rows.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definitions.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/ingest.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-links.ts

## INV-6982 — probe — discovery hints inside ingest's transaction, so a rolled-back frame announces a check that does not exist (LOW)

discovery hints inside ingest's transaction, so a rolled-back frame announces a check that does not exist (LOW)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
S=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$S/s.mjs" <<'JS'
const db = await import("@/modules/database/index.js");
const ws = await import("@/modules/websocket/index.js");
const D = await import("@/modules/cerberus/definitions.service.js");
const { ingest } = await import("@/modules/cerberus/ingest.service.js");
const { wardenLinks } = await import("@/modules/cerberus/warden-links.js");
const conn = db.getCerberusConnection();
db.cerberusNodesDb.insert({ id: "probe-node", desc: null, public_key: "k", cert_fingerprint: "f", warden_version: null, machine_id: null, facts: null, enrolled_at: Date.now() });
const doc = () => ({ services: [{ service: "svc", label: null, probes: [{ key: "svc/health", kind: "health_doc", every: 30, timeout: 5, cadence: 30, url: "http://127.0.0.1:1/h" }] }] });
const w = (check, at, o = {}) => ({ check, source: "svc/health", at, fetchedAt: at, status: "ok", docStatus: "green", value: "fine", data: null, tookMs: 5, prevAt: null, ...o });
const T = (fn) => { try { return fn(); } catch (e) { return "THREW " + (e.code ?? e.name) + ": " + String(e.message).slice(0, 60); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
T(() => D.putDefinition("probe-node", doc()));
await sleep(1200);
const frames = [];
ws.connectedClients.add({ readyState: 1, send(m) { frames.push(JSON.parse(m).checks); } });
conn.exec("CREATE TRIGGER boom BEFORE INSERT ON results WHEN NEW.check_key = 'svc/boom' BEGIN SELECT RAISE(ABORT, 'boom'); END");
const r = T(() => ingest.ingestResults("probe-node", 1, [w("svc/newcomp", Date.now() - 60_000), w("svc/boom", Date.now() - 60_000)]));
await sleep(1500);
console.log("PROBE frame rolled back:", r, "| checks row for svc/newcomp:", conn.prepare("SELECT count(*) n FROM checks WHERE key = 'svc/newcomp'").get().n, "| hint frames sent:", JSON.stringify(frames));
JS
( cd /home/lyphe/.claude/claudecodeui_lyphe && CERBERUS_DB_PATH="$S/c.db" DATABASE_PATH="$S/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 60 node --import tsx "$S/s.mjs" 2>&1 | grep '^PROBE' )
case "$S" in /tmp/athena-probe.*) rm -r "$S" ;; esac
EOF
bash "$D/p.sh"; case "$D" in /tmp/athena-probe.*) rm -r "$D" ;; esac
expect: frame rolled back: THREW SQLITE_CONSTRAINT_TRIGGER … | checks row for svc/newcomp: 0 | hint frames sent: [["probe-node/svc/newcomp","probe-node/svc/boom"]] while the defect stands; hint frames sent: [] once cured
```

measured 2026-10-06 by chain chain-cerberus--center--write-path-20261006-080105-6b69, finding L1, LOW
probe-key: 321c17290838901a23bb685b26ec13552671b076

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus-broadcast.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definition-document.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definition-rows.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definitions.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/ingest.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-links.ts

## INV-6983 — probe — the registry calls into a link without isolating it (LOW)

the registry calls into a link without isolating it (LOW)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
S=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$S/s.mjs" <<'JS'
const db = await import("@/modules/database/index.js");
const ws = await import("@/modules/websocket/index.js");
const D = await import("@/modules/cerberus/definitions.service.js");
const { ingest } = await import("@/modules/cerberus/ingest.service.js");
const { wardenLinks } = await import("@/modules/cerberus/warden-links.js");
const conn = db.getCerberusConnection();
db.cerberusNodesDb.insert({ id: "probe-node", desc: null, public_key: "k", cert_fingerprint: "f", warden_version: null, machine_id: null, facts: null, enrolled_at: Date.now() });
const doc = () => ({ services: [{ service: "svc", label: null, probes: [{ key: "svc/health", kind: "health_doc", every: 30, timeout: 5, cadence: 30, url: "http://127.0.0.1:1/h" }] }] });
const w = (check, at, o = {}) => ({ check, source: "svc/health", at, fetchedAt: at, status: "ok", docStatus: "green", value: "fine", data: null, tookMs: 5, prevAt: null, ...o });
const T = (fn) => { try { return fn(); } catch (e) { return "THREW " + (e.code ?? e.name) + ": " + String(e.message).slice(0, 60); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
wardenLinks.attach({ node: "probe-node", send() { throw new Error("socket closing"); }, close() {}, version: "1", clockOffsetMs: null });
const put = T(() => D.putDefinition("probe-node", doc()));
console.log("PROBE PUT while the link's send throws:", JSON.stringify(put), "| committed anyway: checks_version", conn.prepare("SELECT checks_version v FROM nodes WHERE id = 'probe-node'").get().v);
const told = []; wardenLinks.onChange((n) => told.push(n));
wardenLinks.attach({ node: "n2", send: () => true, close() { throw new Error("dead socket"); }, version: null, clockOffsetMs: null }); told.length = 0;
const again = T(() => wardenLinks.attach({ node: "n2", send: () => true, close() {}, version: null, clockOffsetMs: null }));
console.log("PROBE attach over a link whose close() throws:", again ?? "returned", "| listeners told:", told.length);
JS
( cd /home/lyphe/.claude/claudecodeui_lyphe && CERBERUS_DB_PATH="$S/c.db" DATABASE_PATH="$S/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 60 node --import tsx "$S/s.mjs" 2>&1 | grep '^PROBE' )
case "$S" in /tmp/athena-probe.*) rm -r "$S" ;; esac
EOF
bash "$D/p.sh"; case "$D" in /tmp/athena-probe.*) rm -r "$D" ;; esac
expect: PUT while the link's send throws: "THREW Error: socket closing" | committed anyway: checks_version 1, and attach over a link whose close() throws: THREW … | listeners told: 0 while the defect stands
```

measured 2026-10-06 by chain chain-cerberus--center--write-path-20261006-080105-6b69, finding L2, LOW
probe-key: 2c1ae5ec79b7d48ddb6b4d3ab3521a4b2d21de21

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus-broadcast.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definition-document.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definition-rows.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definitions.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/ingest.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-links.ts

## INV-6984 — probe — `setLabel` answers a bare `TypeError` for a label that is not a string (LOW)

`setLabel` answers a bare `TypeError` for a label that is not a string (LOW)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
S=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$S/s.mjs" <<'JS'
const db = await import("@/modules/database/index.js");
const ws = await import("@/modules/websocket/index.js");
const D = await import("@/modules/cerberus/definitions.service.js");
const { ingest } = await import("@/modules/cerberus/ingest.service.js");
const { wardenLinks } = await import("@/modules/cerberus/warden-links.js");
const conn = db.getCerberusConnection();
db.cerberusNodesDb.insert({ id: "probe-node", desc: null, public_key: "k", cert_fingerprint: "f", warden_version: null, machine_id: null, facts: null, enrolled_at: Date.now() });
const doc = () => ({ services: [{ service: "svc", label: null, probes: [{ key: "svc/health", kind: "health_doc", every: 30, timeout: 5, cadence: 30, url: "http://127.0.0.1:1/h" }] }] });
const w = (check, at, o = {}) => ({ check, source: "svc/health", at, fetchedAt: at, status: "ok", docStatus: "green", value: "fine", data: null, tookMs: 5, prevAt: null, ...o });
const T = (fn) => { try { return fn(); } catch (e) { return "THREW " + (e.code ?? e.name) + ": " + String(e.message).slice(0, 60); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
T(() => D.putDefinition("probe-node", doc()));
for (const [tag, label] of [["number", 5], ["null", null], ["undefined", undefined]]) console.log("PROBE setLabel label =", tag, "→", T(() => D.setLabel({ node: "probe-node", key: "svc/health", label })) ?? "ok");
JS
( cd /home/lyphe/.claude/claudecodeui_lyphe && CERBERUS_DB_PATH="$S/c.db" DATABASE_PATH="$S/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 60 node --import tsx "$S/s.mjs" 2>&1 | grep '^PROBE' )
case "$S" in /tmp/athena-probe.*) rm -r "$S" ;; esac
EOF
bash "$D/p.sh"; case "$D" in /tmp/athena-probe.*) rm -r "$D" ;; esac
expect: setLabel label = number/null/undefined → THREW TypeError … while the defect stands; THREW CERBERUS_BAD_LABEL once cured
```

measured 2026-10-06 by chain chain-cerberus--center--write-path-20261006-080105-6b69, finding L3, LOW
probe-key: 2c136028a5bac49b473e795d1b27733507f1d7fe

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus-broadcast.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definition-document.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definition-rows.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definitions.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/ingest.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-links.ts

## INV-6985 — probe — a result with `value` or `docStatus` ABSENT is refused, while the same absence is tolerated in four other fields (LOW)

a result with `value` or `docStatus` ABSENT is refused, while the same absence is tolerated in four other fields (LOW)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
S=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$S/s.mjs" <<'JS'
const db = await import("@/modules/database/index.js");
const ws = await import("@/modules/websocket/index.js");
const D = await import("@/modules/cerberus/definitions.service.js");
const { ingest } = await import("@/modules/cerberus/ingest.service.js");
const { wardenLinks } = await import("@/modules/cerberus/warden-links.js");
const conn = db.getCerberusConnection();
db.cerberusNodesDb.insert({ id: "probe-node", desc: null, public_key: "k", cert_fingerprint: "f", warden_version: null, machine_id: null, facts: null, enrolled_at: Date.now() });
const doc = () => ({ services: [{ service: "svc", label: null, probes: [{ key: "svc/health", kind: "health_doc", every: 30, timeout: 5, cadence: 30, url: "http://127.0.0.1:1/h" }] }] });
const w = (check, at, o = {}) => ({ check, source: "svc/health", at, fetchedAt: at, status: "ok", docStatus: "green", value: "fine", data: null, tookMs: 5, prevAt: null, ...o });
const T = (fn) => { try { return fn(); } catch (e) { return "THREW " + (e.code ?? e.name) + ": " + String(e.message).slice(0, 60); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
T(() => D.putDefinition("probe-node", doc()));
const at = Date.now() - 600_000; const bare = (check, a, prevAt) => { const r = w(check, a, { prevAt }); delete r.value; delete r.docStatus; return r; };
const first = T(() => ingest.ingestResults("probe-node", 1, [w("svc/with-null", at, { value: null, docStatus: null }), bare("svc/no-key", at, null)]));
console.log("PROBE one result with explicit nulls + one with the keys absent:", JSON.stringify(first), "| rows:", JSON.stringify(conn.prepare("SELECT check_key FROM results ORDER BY check_key").all().map((r) => r.check_key)));
JS
( cd /home/lyphe/.claude/claudecodeui_lyphe && CERBERUS_DB_PATH="$S/c.db" DATABASE_PATH="$S/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 60 node --import tsx "$S/s.mjs" 2>&1 | grep '^PROBE' )
case "$S" in /tmp/athena-probe.*) rm -r "$S" ;; esac
EOF
bash "$D/p.sh"; case "$D" in /tmp/athena-probe.*) rm -r "$D" ;; esac
expect: one result with explicit nulls + one with the keys absent: {"stored":1,"changed":["svc/with-null"]} | rows: ["svc/with-null"] while the defect stands; "stored":2 once cured
```

measured 2026-10-06 by chain chain-cerberus--center--write-path-20261006-080105-6b69, finding L4, LOW
probe-key: 9e0f0513393e97d29819c1ba88447a8782fe04d7

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus-broadcast.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definition-document.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definition-rows.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definitions.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/ingest.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-links.ts

## INV-6986 — probe — a health-document component and a sibling probe with the same id write one check (LOW)

a health-document component and a sibling probe with the same id write one check (LOW)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
S=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$S/s.mjs" <<'JS'
const db = await import("@/modules/database/index.js");
const ws = await import("@/modules/websocket/index.js");
const D = await import("@/modules/cerberus/definitions.service.js");
const { ingest } = await import("@/modules/cerberus/ingest.service.js");
const { wardenLinks } = await import("@/modules/cerberus/warden-links.js");
const conn = db.getCerberusConnection();
db.cerberusNodesDb.insert({ id: "probe-node", desc: null, public_key: "k", cert_fingerprint: "f", warden_version: null, machine_id: null, facts: null, enrolled_at: Date.now() });
const doc = () => ({ services: [{ service: "svc", label: null, probes: [{ key: "svc/health", kind: "health_doc", every: 30, timeout: 5, cadence: 30, url: "http://127.0.0.1:1/h" }] }] });
const w = (check, at, o = {}) => ({ check, source: "svc/health", at, fetchedAt: at, status: "ok", docStatus: "green", value: "fine", data: null, tookMs: 5, prevAt: null, ...o });
const T = (fn) => { try { return fn(); } catch (e) { return "THREW " + (e.code ?? e.name) + ": " + String(e.message).slice(0, 60); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const d = { services: [{ service: "svc", label: null, probes: [
  { key: "svc/health", kind: "health_doc", every: 30, timeout: 5, cadence: 30, url: "http://127.0.0.1:1/h" },
  { key: "svc/api", kind: "http", every: 30, timeout: 5, url: "http://127.0.0.1:1/api" }] }] };
T(() => D.putDefinition("probe-node", d));
const base = Date.now() - 600_000; let prevOwn = null, prevDoc = null; const moves = []; ingest.onChange((e) => moves.push(e.changed.length));
for (let i = 0; i < 4; i++) {
  const at = base + i * 30_000;
  T(() => ingest.ingestResults("probe-node", 2 * i + 1, [w("svc/api", at, { source: "svc/api", prevAt: prevOwn })])); prevOwn = at;
  T(() => ingest.ingestResults("probe-node", 2 * i + 2, [w("svc/api", at + 1, { source: "svc/health", status: "failing", docStatus: "red", prevAt: prevDoc })])); prevDoc = at + 1;
}
console.log("PROBE rows of svc/api written by the probe and by the health document:", conn.prepare("SELECT count(*) n FROM results WHERE check_key = 'svc/api'").get().n, "| distinct sources:", JSON.stringify(conn.prepare("SELECT DISTINCT source FROM results WHERE check_key = 'svc/api' ORDER BY source").all().map((r) => r.source)), "| status moves told to listeners:", moves.length);
JS
( cd /home/lyphe/.claude/claudecodeui_lyphe && CERBERUS_DB_PATH="$S/c.db" DATABASE_PATH="$S/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 60 node --import tsx "$S/s.mjs" 2>&1 | grep '^PROBE' )
case "$S" in /tmp/athena-probe.*) rm -r "$S" ;; esac
EOF
bash "$D/p.sh"; case "$D" in /tmp/athena-probe.*) rm -r "$D" ;; esac
expect: rows of svc/api written by the probe and by the health document: 8 | distinct sources: ["svc/api","svc/health"] | status moves told to listeners: 8 while the defect stands; 4 rows, ["svc/api"] once cured
```

measured 2026-10-06 by chain chain-cerberus--center--write-path-20261006-080105-6b69, finding L5, LOW
probe-key: 79c96471ef9d30e16b3f818f4695a55d2a67d820

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus-broadcast.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definition-document.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definition-rows.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/definitions.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/ingest.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-links.ts

## INV-6987 — probe — An async route handler that rejects ends the API process

An async route handler that rejects ends the API process

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
export CERBERUS_DB_PATH="$D/cerberus.db" CERBERUS_KEY_PATH="$D/center.key" DATABASE_PATH="$D/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json
cat > "$D/child.mjs" <<'MJS'
const { startWardenGateway, wardenHttpRoutes } = await import('/home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-gateway.ts');
wardenHttpRoutes.set('/cerberus/asyncboom', async () => { throw new Error('async handler rejected'); });
const g = await startWardenGateway({ listen: '127.0.0.1:7905', supervised: false });
console.log('listening', g.address, g.error);
setInterval(() => {}, 1 << 30);
MJS
node --import tsx "$D/child.mjs" > "$D/child.log" 2>&1 &
CHILD=$!
case "$CHILD" in ''|*[!0-9]*|0|1) echo "no child pid"; exit 1;; esac
timeout 60 bash -c "until grep -q listening '$D/child.log'; do sleep 0.5; done"
curl -s -m 5 -o /dev/null http://127.0.0.1:7905/cerberus/asyncboom
sleep 1
if kill -0 "$CHILD" 2>/dev/null; then echo "gateway process after an async route handler rejected: alive"; kill "$CHILD"; else echo "gateway process after an async route handler rejected: DEAD"; fi
EOF
export D
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: gateway process after an async route handler rejected: DEAD
```

measured 2026-10-06 by chain chain-cerberus--center--gateway-20261006-084510-45cb, finding M1, MEDIUM
probe-key: 4e33372ff160c69fb6531f1f4bc9f4fd22875262

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/center-key.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-auth.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-enrollment.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-gateway.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-link.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-gateway.mjs

## INV-6988 — probe — An enrollment whose `welcome` is lost strands the node for good

An enrollment whose `welcome` is lost strands the node for good

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
export CERBERUS_DB_PATH="$D/cerberus.db" CERBERUS_KEY_PATH="$D/center.key" DATABASE_PATH="$D/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json
cat > "$D/p.mjs" <<'MJS'
import crypto from 'node:crypto';
const R = '/home/lyphe/.claude/claudecodeui_lyphe/';
const WS = (await import(R + 'node_modules/ws/wrapper.mjs')).default;
const { cerberusEnrollDb, cerberusNodesDb } = await import(R + 'server/modules/database/index.ts');
const { startWardenGateway } = await import(R + 'server/modules/cerberus/warden-gateway.ts');
await startWardenGateway({ listen: '127.0.0.1:7906', supervised: false });
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const key = crypto.generateKeyPairSync('ed25519');
const pub = key.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const TOKEN = 'STRN-0000-0001';
cerberusEnrollDb.insert({ token_hash: sha(TOKEN), name: 'stranded', desc: null, issued_at: Date.now(), expires_at: Date.now() + 600000 });
const hello = { version: '0', startedAt: Date.now(), facts: { hostname: 'h', platform: 'linux', arch: 'x64', nodeVersion: 'v', machineId: null, cpus: 1, memMb: 1 }, checksVersion: null, catalogVersion: null, active: { runs: [], diags: [] } };
const say = (ws, type, body) => ws.send(JSON.stringify({ type, id: 'x', node: 'stranded', seq: null, at: Date.now(), body }));
// 1. enroll, and lose the connection in the same tick as the hello: the welcome never arrives
const e = new WS('ws://127.0.0.1:7906/cerberus/ws', { headers: { 'X-Cerberus-Enroll': TOKEN, 'X-Cerberus-Node': 'stranded', 'X-Cerberus-Key': pub } });
await new Promise((r) => e.on('open', r)); say(e, 'hello', hello); e.terminate();
await new Promise((r) => setTimeout(r, 500));
console.log('node row exists:', cerberusNodesDb.get('stranded') !== null, '| token spent:', cerberusEnrollDb.find(sha(TOKEN)).used_at !== null);
// 2. the warden comes back with its key: does center ever hand it the certificate?
const at = String(Date.now());
const sig = crypto.sign(null, Buffer.from(`cerberus-connect\nstranded\n${at}`), key.privateKey).toString('base64');
const c = new WS('ws://127.0.0.1:7906/cerberus/ws', { headers: { 'X-Cerberus-Node': 'stranded', 'X-Cerberus-At': at, 'X-Cerberus-Sig': sig } });
await new Promise((r) => c.on('open', r)); say(c, 'hello', hello);
const welcome = await new Promise((r) => c.on('message', (d) => r(JSON.parse(JSON.parse(d.toString()).env))));
console.log('connect welcome carries a cert:', welcome.body.cert !== undefined ? 'present' : 'absent', '| body keys:', Object.keys(welcome.body).join(','));
process.exit(0);
MJS
node --import tsx "$D/p.mjs" 2>&1 | grep -E '^(node row|connect welcome)' || echo "probe printed nothing"
EOF
export D
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: node row exists: true | token spent: true   then   connect welcome carries a cert: absent | body keys: node,ackedUpto,checks
```

measured 2026-10-06 by chain chain-cerberus--center--gateway-20261006-084510-45cb, finding M2, MEDIUM
probe-key: e015dc8a920a62f7f9d33f09c9e7ea4b76cdebd2

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/center-key.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-auth.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-enrollment.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-gateway.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-link.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-gateway.mjs

## INV-6989 — probe — `loadCenterKey` accepts a key that is not ed25519; the first enrollment is then half done

`loadCenterKey` accepts a key that is not ed25519; the first enrollment is then half done

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
export CERBERUS_DB_PATH="$D/cerberus.db" CERBERUS_KEY_PATH="$D/x.key" DATABASE_PATH="$D/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json
cat > "$D/p.mjs" <<'MJS'
import crypto from 'node:crypto';
import fs from 'node:fs';
fs.writeFileSync(process.env.CERBERUS_KEY_PATH, crypto.generateKeyPairSync('x25519').privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const { loadCenterKey, signText } = await import('/home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/center-key.ts');
try {
  console.log('center key at load: accepted, type', loadCenterKey().asymmetricKeyType);
  try { signText('x'); console.log('first signText: ok'); } catch { console.log('first signText: threw'); }
} catch { console.log('center key at load: refused'); }
process.exit(0);
MJS
node --import tsx "$D/p.mjs" 2>&1 | grep -E '^(center key|first signText)' || echo "probe printed nothing"
EOF
export D
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: center key at load: accepted, type x25519   then   first signText: threw
```

measured 2026-10-06 by chain chain-cerberus--center--gateway-20261006-084510-45cb, finding L1, LOW
probe-key: ec739257879d7eaf448bee5e06ecbcd71890dff8

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/center-key.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-auth.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-enrollment.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-gateway.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-link.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-gateway.mjs

## INV-6990 — probe — `clock skew 60 s` is printed for a skew the gateway refuses for exceeding 60 s

`clock skew 60 s` is printed for a skew the gateway refuses for exceeding 60 s

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
export CERBERUS_DB_PATH="$D/cerberus.db" CERBERUS_KEY_PATH="$D/center.key" DATABASE_PATH="$D/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json
cat > "$D/p.mjs" <<'MJS'
import crypto from 'node:crypto';
const R = '/home/lyphe/.claude/claudecodeui_lyphe/server/modules/';
const { authenticateUpgrade } = await import(R + 'cerberus/warden-auth.ts');
const { cerberusNodesDb } = await import(R + 'database/index.ts');
const key = crypto.generateKeyPairSync('ed25519');
const now = 1759766400000;
cerberusNodesDb.insert({ id: 'skew-node', desc: null, public_key: key.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), cert_fingerprint: 'x', warden_version: '0', machine_id: null, facts: '{}', enrolled_at: now });
for (const skewMs of [60000, 60001, 60400]) {
  const at = String(now + skewMs);
  const sig = crypto.sign(null, Buffer.from(`cerberus-connect\nskew-node\n${at}`), key.privateKey).toString('base64');
  const verdict = authenticateUpgrade({ headers: { 'x-cerberus-node': 'skew-node', 'x-cerberus-at': at, 'x-cerberus-sig': sig } }, now);
  console.log(`skew ${skewMs} ms:`, 'refused' in verdict ? `refused "${verdict.refused}"` : verdict.kind);
}
process.exit(0);
MJS
node --import tsx "$D/p.mjs" 2>&1 | grep -E '^skew ' || echo "probe printed nothing"
EOF
export D
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: skew 60000 ms: connect   then   skew 60001 ms: refused "clock skew 60 s"
```

measured 2026-10-06 by chain chain-cerberus--center--gateway-20261006-084510-45cb, finding L2, LOW
probe-key: 243c2c19a79b7caa3e2ac6ef9c8de94689797207

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/center-key.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-auth.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-enrollment.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-gateway.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-link.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-gateway.mjs

## INV-6998 — probe — MEDIUM — a deploy paints the hub "No result", twice: for ~30 s on the live reading, and for minutes in its history

MEDIUM — a deploy paints the hub "No result", twice: for ~30 s on the live reading, and for minutes in its history

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
TOKEN=$(node --input-type=module -e "import {loginToken} from './.verify/lib/whole-check-kit.mjs'; process.stdout.write(await loginToken())")
sqlite3 -readonly ~/.cloudcli/cerberus.db "select a.at, b.at from results a join results b on b.node=a.node and b.check_key=a.check_key and b.at=(select min(at) from results where node=a.node and check_key=a.check_key and at>a.at) where a.node='center' and a.check_key='cerberus/store.write' and b.prev_at is null and b.at-a.at>120000 order by a.at desc limit 1" > "$(dirname "$0")/gap.txt"
if [ -s "$(dirname "$0")/gap.txt" ]; then
  IFS='|' read A B < "$(dirname "$0")/gap.txt"
  echo "restart gap: last row to successor's first row = $(( (B-A)/1000 )) s"
  curl -s -H "Authorization: Bearer $TOKEN" "127.0.0.1:3011/api/cerberus/lookup?node=center&key=cerberus/store.write&at=$((A+100000))" | jq -c '{verdict}'
else
  echo "no restart gap in the store"
fi
EOF
bash "$D/p.sh"
expect: for the newest restart gap, a lookup 100 s after the old process's last stored row prints {"verdict":"stale"}; cured, it prints {"verdict":"result"} (or "no restart gap in the store")
```

measured 2026-10-06 by chain chain-cerberus--center--module-20261006-091640-41a4, finding M1, MEDIUM
probe-key: ff45650c590a43991a8a1c384275db82871e275a

governs: /home/lyphe/.claude/claudecodeui_lyphe/.env.example, /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/enrollments.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/mutes.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/self-checks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/store-prune.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-gateway.ts

## INV-6999 — probe — MEDIUM — `scripts/apps-probe-env.sh` boots a full server with none of the three Cerberus roots, so it writes into the LIVE store and tries the live gateway address

MEDIUM — `scripts/apps-probe-env.sh` boots a full server with none of the three Cerberus roots, so it writes into the LIVE store and tries the live gateway address

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "apps-probe-env.sh names a Cerberus root: $(grep -c 'CERBERUS_' scripts/apps-probe-env.sh)"
echo ".env carries CERBERUS_LISTEN: $(grep -c '^CERBERUS_LISTEN=' .env)"
EOF
bash "$D/p.sh"
expect: "apps-probe-env.sh names a Cerberus root: 0" while ".env carries CERBERUS_LISTEN: 1" — the stand-in boots against the live store; cured, the first line is 3 or more (all three roots set)
```

measured 2026-10-06 by chain chain-cerberus--center--module-20261006-091640-41a4, finding M2, MEDIUM
probe-key: 65c175203bf2ed3843daaa8d92a0149814bff624

governs: /home/lyphe/.claude/claudecodeui_lyphe/scripts/apps-probe-env.sh

## INV-7000 — probe — LOW — `CERBERUS_LISTEN=localhost:<the API's port>` passes the "API's own address" refusal

LOW — `CERBERUS_LISTEN=localhost:<the API's port>` passes the "API's own address" refusal

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/rp.mjs" <<'EOF'
import http from 'node:http';
const port = 7981;
const api = http.createServer((q, r) => r.end('API\n'));
api.listen({ host: '127.0.0.1', port, reusePort: true }, () => {
  const gw = http.createServer((q, r) => { r.writeHead(404); r.end('Not found\n'); });
  gw.on('error', (e) => { console.log('gateway bind error:', e.code); process.exit(0); });
  gw.listen({ host: 'localhost', port, reusePort: true }, async () => {
    const out = {};
    for (let i = 0; i < 40; i++) {
      const t = await new Promise((res) => http.get({ host: '127.0.0.1', port, agent: false, headers: { Connection: 'close' } }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(b.trim())); }));
      out[t] = (out[t] || 0) + 1;
    }
    console.log('listen({host:"localhost"}) beside the API on its port, 40 requests to the API address:', JSON.stringify(out)); process.exit(0);
  });
});
EOF
cat > "$D/p.sh" <<'EOF'
node "$(dirname "$0")/rp.mjs"
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "module compares host text only: $(grep -c 'target.host === apiHost' server/modules/cerberus/cerberus.module.ts)"
EOF
bash "$D/p.sh"
expect: a split like {"Not found":20,"API":20} and "module compares host text only: 1" — this shows the bind the gateway makes succeeds; cured, the second line reads 0 (the module no longer relies on the host text)
```

measured 2026-10-06 by chain chain-cerberus--center--module-20261006-091640-41a4, finding L1, LOW
probe-key: ae326f1d943b8864a1cac7842cd31fa766382306

governs: /home/lyphe/.claude/claudecodeui_lyphe/.env.example, /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/enrollments.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/mutes.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/self-checks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/store-prune.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-gateway.ts

## INV-7001 — probe — LOW — a foreign write lock freezes the whole API for 5 s per self-check tick

LOW — a foreign write lock freezes the whole API for 5 s per self-check tick

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
export SUNSET_SLOT=4; source scripts/sunset-probe.sh; trap stop_probe_server EXIT
probe_db && boot_probe_server || exit 1
DB=${SUNSET_PREFIX}cerberus.db
python3 - "$DB" <<'PY' &
import sqlite3, sys, time
c = sqlite3.connect(sys.argv[1], timeout=0, isolation_level=None); c.execute('BEGIN IMMEDIATE'); time.sleep(40); c.execute('ROLLBACK')
PY
HOLD=$!
for i in $(seq 70); do curl -s -m 20 -o /dev/null -w '%{time_total}\n' $SUNSET_API/api/auth/status; sleep 0.5; done | sort -rn | head -1 | sed 's/^/slowest auth\/status during a 40 s foreign write lock (s): /'
wait "$HOLD"
EOF
bash "$D/p.sh"
expect: "slowest auth/status during a 40 s foreign write lock (s): 5.0x" (measured 5.07 and 5.04); cured, a few hundredths
```

measured 2026-10-06 by chain chain-cerberus--center--module-20261006-091640-41a4, finding L2, LOW
probe-key: 8effe0787e8f2122acd523e4458482b3162e86d1

governs: /home/lyphe/.claude/claudecodeui_lyphe/.env.example, /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/enrollments.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/mutes.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/self-checks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/store-prune.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-gateway.ts

## INV-7002 — probe — LOW — a bracketed IPv6 `CERBERUS_LISTEN` reads `::1:7973` in the hub check and in `/overview.gateway.address`

LOW — a bracketed IPv6 `CERBERUS_LISTEN` reads `::1:7973` in the hub check and in `/overview.gateway.address`

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/v6.mjs" <<'EOF'
import { startWardenGateway } from '/home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-gateway.ts';
const g = await startWardenGateway({ listen: '[::1]:7975', supervised: false });
console.log('address:', g.address, 'error:', g.error);
g.stop();
process.exit(0);
EOF
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
TSX_TSCONFIG_PATH=server/tsconfig.json timeout 60 node --import tsx "$(dirname "$0")/v6.mjs" 2>&1 | grep -E '^address:' || echo "no address line"
EOF
bash "$D/p.sh"
expect: "address: ::1:7975 error: null"; cured, "address: [::1]:7975 error: null"
```

measured 2026-10-06 by chain chain-cerberus--center--module-20261006-091640-41a4, finding L3, LOW
probe-key: 966c4758308e3803d11c4958a63cf952f02da618

governs: /home/lyphe/.claude/claudecodeui_lyphe/.env.example, /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/enrollments.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/mutes.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/self-checks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/store-prune.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-gateway.ts

## INV-7003 — probe — LOW — `DELETE /checks/center/cerberus/<hub check>` answers 204 and the next boot quietly undoes it

LOW — `DELETE /checks/center/cerberus/<hub check>` answers 204 and the next boot quietly undoes it

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
export SUNSET_SLOT=4; source scripts/sunset-probe.sh; trap stop_probe_server EXIT
probe_db && boot_probe_server || exit 1
TOKEN=$(mint_token)
curl -s -o /dev/null -w 'DELETE of the hub check cerberus/store.write: %{http_code}\n' -X DELETE -H "Authorization: Bearer $TOKEN" "$SUNSET_API/api/cerberus/checks/center/cerberus/store.write"
curl -s -H "Authorization: Bearer $TOKEN" "$SUNSET_API/api/cerberus/overview" | jq -c '[.nodes[0].services[0].checks[].key]'
EOF
bash "$D/p.sh"
expect: "DELETE … 204" and a two-key list (store.write gone); cured, a 4xx and all three keys
```

measured 2026-10-06 by chain chain-cerberus--center--module-20261006-091640-41a4, finding L4, LOW
probe-key: 42d5c32f2aca3f798a94c768fb02a38d1c542707

governs: /home/lyphe/.claude/claudecodeui_lyphe/.env.example, /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/enrollments.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/mutes.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/self-checks.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/store-prune.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-gateway.ts

## INV-7005 — probe — LOW — the new comment (and MAN-7805) says the probes "reopen the store between scenarios"; only one of the three callers does

LOW — the new comment (and MAN-7805) says the probes "reopen the store between scenarios"; only one of the three callers does

```probe
D=$(mktemp -d /tmp/athena-probe-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "-- the comment's claim:"; grep -n "reopen the store between scenarios" server/modules/database/cerberus-connection.ts || echo none
echo "-- each probe, the line after its close call:"
grep -n -A1 'closeCerberusConnection();' .verify/probe-cerberus-*.mjs | grep -v '^--$'
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe-p.*) rm -r "$D";; esac
```

measured 2026-10-06 by chain chain-cerberus--center--docs-20261006-103725-3260, finding L1, LOW
probe-key: 1f2c1fea5cfbabadd8920cf26a41811e5b5c60e4

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-connection.ts

## INV-7006 — probe — LOW — the search the report must show leaves two of the intent's subjects out (the builder disclosed it)

LOW — the search the report must show leaves two of the intent's subjects out (the builder disclosed it)

Cause (2026-10-07): a four-topic query embeds as one blend, and the first stage keeps the nearest rows by best-chunk cosine, `max(6, limit)` of them; MAN-7801 sits 32nd and MAN-7803 67th by cosine, while the cross-encoder puts MAN-7801 4th (logit 4.24) and MAN-7803 16th (−0.55, above the floor −2.295) of the 150 nearest. So the default call (limit 3, a pool of 6, set by the rerank's measured latency, MAN-5422) can never show them, and `--limit 40` shows both once the door runs the `hnsw.ef_search` fix in `rank.candidates` (before it, any `--limit` came back with at most 12 rows from a 40-chunk scan). The default width stands; a multi-topic question is asked as one question per topic, or with `--limit 40`.

```probe
D=$(mktemp -d /tmp/athena-probe-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
~/.claude/scripts/docstore search "cerberus gateway storage rule read model" --text | cut -d' ' -f1 | sort | tr '\n' ' '; echo
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe-p.*) rm -r "$D";; esac
```

measured 2026-10-06 by chain chain-cerberus--center--docs-20261006-103725-3260, finding L2, LOW
probe-key: fb8411576b537f1e74b9a20c711719110b161e7c

governs: /home/lyphe/.claude/docstore/rank.py

## INV-7007 — probe — LOW — the probe's WebKit gate is a substring check; a wrong thumb colour passes it, and the claim that the rules "cannot be read off a computed style" is false

LOW — the probe's WebKit gate is a substring check; a wrong thumb colour passes it, and the claim that the rules "cannot be read off a computed style" is false

```probe
D=$(mktemp -d /tmp/athena-wk.XXXXXX) || exit 1
cat > "$D/m.mjs" <<'EOF2'
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const R = '/home/lyphe/.claude/claudecodeui_lyphe';
const require = createRequire(`${R}/package.json`);
const esbuild = require('esbuild');
const { chromium } = require('playwright');
const D = process.argv[2];
await esbuild.build({ entryPoints: [`${R}/src/modules/widgets/buildWidgetDocument.ts`], bundle: true, format: 'esm', outfile: `${D}/now.mjs`, alias: { '@': `${R}/src` }, logLevel: 'error' });
const { buildWidgetDocument } = await import(`${D}/now.mjs`);
const tokens = { '--canvas': '#fff', '--ink': '#1a1a1a', '--ink-muted': 'rgb(107, 110, 124)', '--font-body': 'sans-serif', '--text-body': '14px' };
const rows = '<div style="height:300px"></div>';
const body = `<style>.fat::-webkit-scrollbar{width:18px}</style>
<div id="b" style="height:50px;overflow:auto">${rows}</div>
<div id="fat" class="fat" style="height:50px;overflow:auto">${rows}</div>
<div id="esc" style="height:50px;overflow:auto;scrollbar-width:auto;scrollbar-color:auto">${rows}</div>`;
const good = buildWidgetDocument({ body, dark: false, tokens });
const mutant = good.replace('thumb{background-color:var(--ink-muted);', 'thumb{background-color:var(--ink);');
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const read = async (doc) => {
  const page = await browser.newPage();
  await page.setContent('<iframe sandbox="allow-scripts" style="width:400px;height:400px"></iframe>');
  await page.evaluate((d) => { document.querySelector('iframe').srcdoc = d; }, doc);
  await page.waitForTimeout(500);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  const out = await frame.evaluate(() => {
    const g = (id) => { const e = document.getElementById(id); return e.offsetWidth - e.clientWidth; };
    return { thumb: getComputedStyle(document.getElementById('b'), '::-webkit-scrollbar-thumb').backgroundColor, plain: g('b'), fat: g('fat'), esc: g('esc') };
  });
  await page.close();
  return out;
};
const probeSrc = readFileSync(`${R}/.verify/probe-widget-scrollbars.mjs`, 'utf8');
console.log('probe reads a ::-webkit-scrollbar pseudo computed style:', /getComputedStyle\([^)]*['"]::-webkit-scrollbar/.test(probeSrc));
const g = await read(good);
const m = await read(mutant);
console.log('thumb colour readable off computed style — good:', g.thumb, '| thumb written var(--ink):', m.thumb);
console.log(`author ".fat::-webkit-scrollbar{width:18px}" gutter: ${g.fat}px (plain box ${g.plain}px; author reset to auto/auto: ${g.esc}px)`);
await browser.close();
EOF2
cat > "$D/p.sh" <<'EOF2'
cd /home/lyphe/.claude/claudecodeui_lyphe && timeout 100 node "$1/m.mjs" "$1"
EOF2
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-wk.*) rm -rf "$D";; esac
echo "[probe exit $?]"
expect: line 1 `probe reads a ::-webkit-scrollbar pseudo computed style: false` while the gap stands (cured when it prints `true`); line 2 `good: rgb(107, 110, 124) | thumb written var(--ink): rgb(26, 26, 26)` — the thumb colour is readable and a wrong one is distinguishable
```

measured 2026-10-06 by chain chain-widget-scrollbars-20261006-104551-7805, finding L1, LOW
probe-key: ca83c69ac958c860f30659c11e43e2984db9d167

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/widgets/buildWidgetDocument.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-widget-scrollbars.mjs

## INV-7008 — probe — LOW — an author's own `::-webkit-scrollbar` styling is now silently ignored in Chromium, and the comment/row do not say so

LOW — an author's own `::-webkit-scrollbar` styling is now silently ignored in Chromium, and the comment/row do not say so

```probe
D=$(mktemp -d /tmp/athena-wk.XXXXXX) || exit 1
cat > "$D/m.mjs" <<'EOF2'
import { createRequire } from 'node:module';
const R = '/home/lyphe/.claude/claudecodeui_lyphe';
const require = createRequire(`${R}/package.json`);
const esbuild = require('esbuild');
const { chromium } = require('playwright');
const D = process.argv[2];
await esbuild.build({ entryPoints: [`${R}/src/modules/widgets/buildWidgetDocument.ts`], bundle: true, format: 'esm', outfile: `${D}/now.mjs`, alias: { '@': `${R}/src` }, logLevel: 'error' });
const { buildWidgetDocument } = await import(`${D}/now.mjs`);
const tokens = { '--canvas': '#fff', '--ink': '#1a1a1a', '--ink-muted': 'rgb(107, 110, 124)', '--font-body': 'sans-serif', '--text-body': '14px' };
const rows = '<div style="height:300px"></div>';
const body = `<style>.fat::-webkit-scrollbar{width:18px}</style>
<div id="b" style="height:50px;overflow:auto">${rows}</div>
<div id="fat" class="fat" style="height:50px;overflow:auto">${rows}</div>
<div id="esc" style="height:50px;overflow:auto;scrollbar-width:auto;scrollbar-color:auto">${rows}</div>`;
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage();
await page.setContent('<iframe sandbox="allow-scripts" style="width:400px;height:400px"></iframe>');
await page.evaluate((d) => { document.querySelector('iframe').srcdoc = d; }, buildWidgetDocument({ body, dark: false, tokens }));
await page.waitForTimeout(500);
const frame = page.frames().find((f) => f !== page.mainFrame());
const g = await frame.evaluate(() => {
  const w = (id) => { const e = document.getElementById(id); return e.offsetWidth - e.clientWidth; };
  return { plain: w('b'), fat: w('fat'), esc: w('esc') };
});
console.log(`author ".fat::-webkit-scrollbar{width:18px}" gutter: ${g.fat}px (plain box ${g.plain}px; author reset to auto/auto: ${g.esc}px)`);
await browser.close();
EOF2
cat > "$D/p.sh" <<'EOF2'
cd /home/lyphe/.claude/claudecodeui_lyphe && timeout 100 node "$1/m.mjs" "$1"
EOF2
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-wk.*) rm -rf "$D";; esac
grep -c "webkit-scrollbar.*loses\|own .::-webkit-scrollbar" /home/lyphe/.claude/claudecodeui_lyphe/src/modules/widgets/buildWidgetDocument.ts
echo "[probe exit $?]"
expect: `author ".fat::-webkit-scrollbar{width:18px}" gutter: 10px (plain box 10px; author reset to auto/auto: 6px)` — the author's 18px is ignored; the second line is the comment grep count, `0` while the comment is silent about it
```

measured 2026-10-06 by chain chain-widget-scrollbars-20261006-104551-7805, finding L2, LOW
probe-key: e1d436d03e4849fe1997c1eacbf57e370288d2bf

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/widgets/buildWidgetDocument.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-widget-scrollbars.mjs

## INV-7009 — probe — `.verify/cerberus-whole.sh` destroys another plan's scratch center when the default slot is held

`.verify/cerberus-whole.sh` destroys another plan's scratch center when the default slot is held

```probe
D=$(mktemp -d /tmp/athena-pin-XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
#!/usr/bin/env bash
# Another plan's scratch server holds slot 8 (a stand-in); run the verify script on that slot.
D="$1"
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
ss -ltn | grep -qE ':(7909|7910) ' && { echo "slot 8 is busy; try later"; exit 0; }
cat > "$D/squatter.mjs" <<'JS'
import http from 'node:http';
http.createServer((req, res) => res.end('{"needsSetup":false}')).listen(7909, '127.0.0.1');
JS
node "$D/squatter.mjs" server/index.ts &
SQ=$!
echo "$SQ" > /tmp/sunset8-server.pid
echo "other plan's scratch db" > /tmp/sunset8-probe.db
sleep 1
SUNSET_SLOT=8 bash .verify/cerberus-whole.sh > "$D/run.out" 2>&1
echo "verify script exit: $?   last line: $(tail -1 "$D/run.out")"
if kill -0 "$SQ" 2>/dev/null; then echo "other plan's server after the script: ALIVE"; kill "$SQ"; else echo "other plan's server after the script: KILLED"; fi
[ -f /tmp/sunset8-probe.db ] && echo "other plan's db: still there" || echo "other plan's db: GONE"
EOF
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-pin-?*) rm -rf -- "$D" ;; esac
expect: "other plan's server after the script: KILLED" and "other plan's db: GONE" while the defect stands; ALIVE and "still there" once the script refuses before arming the trap
```

measured 2026-10-06 by chain chain-cerberus--center--whole-20261006-110230-1753, finding M1, MEDIUM
probe-key: ef7fcf0d654fa6c2108a48e2b6d8e17ba79b808d

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-whole.sh

## INV-7011 — probe — the cure for INV-6998 (the stop-time keep-alive) covers one handover, not a burst; the doc and the live half promise more

the cure for INV-6998 (the stop-time keep-alive) covers one handover, not a burst; the doc and the live half promise more

```probe
D=$(mktemp -d /tmp/athena-pin-XXXXXX) || exit 1
cat > "$D/short-life.mjs" <<'EOF'
const R = '/home/lyphe/.claude/claudecodeui_lyphe/server/modules/';
const { getCerberusConnection } = await import(R + 'database/index.ts');
const { seedHub } = await import(R + 'cerberus/definitions.service.ts');
const { ingest } = await import(R + 'cerberus/ingest.service.ts');
const { startSelfChecks, stopSelfChecks } = await import(R + 'cerberus/self-checks.service.ts');
const db = getCerberusConnection(); seedHub(); ingest.seedMemory();
const gw = { listen: '127.0.0.1:1', address: '127.0.0.1:1', error: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
startSelfChecks(() => gw); await sleep(3000); stopSelfChecks();
console.log('PROBE rows a 3 s process leaves for the hub:', db.prepare("select count(*) n from results where node='center'").get().n);
process.exit(0);
EOF
cat > "$D/p.sh" <<'EOF'
#!/usr/bin/env bash
D="$1"
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
CERBERUS_DB_PATH="$D/c.db" DATABASE_PATH="$D/auth.db" CERBERUS_KEY_PATH="$D/k" TSX_TSCONFIG_PATH=server/tsconfig.json \
  timeout 60 node --import tsx "$D/short-life.mjs" 2>&1 | grep '^PROBE' || echo "PROBE no answer"
EOF
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-pin-?*) rm -rf -- "$D" ;; esac
expect: "PROBE rows a 3 s process leaves for the hub: 0" while a process that lives under 30 s leaves nothing for the successor to chain to (a cure by a tick at start reads ≥ 1; a cure by chaining is judged by the 3-minute `athena-probes/burst-sim.sh`: no `stale` inside a burst)
```

measured 2026-10-06 by chain chain-cerberus--center--whole-20261006-110230-1753, finding M3, MEDIUM
probe-key: c45c8e1538a7348f731bd4a325daba001657fa58

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/self-checks.service.ts

## INV-7012 — probe — MAN-7804 misstates what `prevAt` is on a self-check row

MAN-7804 misstates what `prevAt` is on a self-check row

```probe
D=$(mktemp -d /tmp/athena-pin-XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
#!/usr/bin/env bash
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "hub keepalive rows: seconds from each row to its prev_at (a tick that itself stored nothing):"
sqlite3 -readonly ~/.cloudcli/cerberus.db "select datetime(at/1000,'unixepoch'), (at-prev_at)/1000 from results where node='center' and check_key='cerberus/store.write' and kind='keepalive' and prev_at is not null order by at desc limit 3"
echo "MANUAL lines saying prevAt is the last tick that WAS STORED: $(grep -c 'the last tick that WAS STORED' server/modules/cerberus/MANUAL.md)"
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-pin-?*) rm -rf -- "$D" ;; esac
expect: keepalive rows with 30 (or 29) s to prev_at and "MANUAL lines saying prevAt is the last tick that WAS STORED: 1" while the doc misstates it; 0 after the wording is corrected
```

measured 2026-10-06 by chain chain-cerberus--center--whole-20261006-110230-1753, finding L1, LOW
probe-key: 895c6b99ba902a58e08e5d2e71a9dbef0ddf9019

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/self-checks.service.ts

## INV-7013 — probe — `.verify/cerberus-whole-live.mjs` crashes on any non-overview answer instead of printing its status and body

`.verify/cerberus-whole-live.mjs` crashes on any non-overview answer instead of printing its status and body

```probe
D=$(mktemp -d /tmp/athena-pin-XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
#!/usr/bin/env bash
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
node --input-type=module -e "
import { curlJson } from './.verify/lib/whole-check-kit.mjs';
const a = curlJson('GET', '/api/cerberus/overview', undefined, 'not-a-token');
console.log('a refused overview answers', a.status, JSON.stringify(a.body), '- has .nodes:', Array.isArray(a.body?.nodes));
"
echo "unguarded .nodes.map in the live script: $(grep -c 'overview.body.nodes.map' .verify/cerberus-whole-live.mjs)"
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-pin-?*) rm -rf -- "$D" ;; esac
expect: `401 {"error":"Invalid token","code":"AUTH_TOKEN_INVALID"} - has .nodes: false` and "unguarded .nodes.map in the live script: 1" while the script would throw on it; 0 once it guards the shape
```

measured 2026-10-06 by chain chain-cerberus--center--whole-20261006-110230-1753, finding L2, LOW
probe-key: 9c58150d5e02c519c684cbb200ce80bc2678a321

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-whole-live.mjs

## INV-7014 — probe — `.verify/cerberus-whole.mjs` exits 0 when the center closes with 1000 before the run is done

`.verify/cerberus-whole.mjs` exits 0 when the center closes with 1000 before the run is done

```probe
D=$(mktemp -d /tmp/athena-pin-XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
#!/usr/bin/env bash
# A center that takes the upgrade, reads the hello and closes 1000 with no welcome: what does the stand-in's exit say?
D="$1"
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
ss -ltn | grep -q ':7991 ' && { echo "7991 busy; try later"; exit 0; }
cat > "$D/fake-center.mjs" <<'JS'
import { WebSocketServer } from '/home/lyphe/.claude/claudecodeui_lyphe/node_modules/ws/wrapper.mjs';
const wss = new WebSocketServer({ host: '127.0.0.1', port: 7991 });
wss.on('connection', (ws) => ws.on('message', () => ws.close(1000, 'bye')));
wss.on('listening', () => console.log('up'));
JS
node "$D/fake-center.mjs" > "$D/fc.out" 2>&1 &
FC=$!
for i in 1 2 3 4 5 6 7 8 9 10; do grep -q up "$D/fc.out" && break; sleep 0.3; done
timeout 30 node .verify/cerberus-whole.mjs enroll 127.0.0.1:7991 AAAA-BBBB-CCCC "$D/state.json" > "$D/out.txt" 2>&1
echo "enroll mode exit: $?  welcome frames printed: $(grep -c '"type":"welcome"' "$D/out.txt")"
kill "$FC" 2>/dev/null
EOF
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-pin-?*) rm -rf -- "$D" ;; esac
expect: "enroll mode exit: 0  welcome frames printed: 0" while the stand-in treats a close 1000 as success; exit 1 once it requires the welcome
```

measured 2026-10-06 by chain chain-cerberus--center--whole-20261006-110230-1753, finding L3, LOW
probe-key: d93feed5d3d894a5a33d093fb34e4683451f3772

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-whole.mjs

## INV-7015 — probe — MEDIUM — the hub's own checks get sentences that are false: no hub / no-warden form in `sheet` and `lookup`

MEDIUM — the hub's own checks get sentences that are false: no hub / no-warden form in `sheet` and `lookup`

```probe
D=$(mktemp -d /tmp/athena-probe-XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe
node -e '
const i18n=require("i18next");const c=require("./src/modules/i18n/locales/en/common.json").cerberus;
i18n.init({lng:"en",resources:{en:{common:{cerberus:c}}},defaultNS:"common",interpolation:{escapeValue:false}});
const hub=[...Object.keys(c.sheet),...Object.keys(c.lookup)].filter(k=>/hub|self|center|noWarden|noVersion/i.test(k));
console.log("hub/self/no-warden forms in sheet+lookup:",hub.join(",")||"none");
console.log(JSON.stringify(i18n.t("cerberus.sheet.raw",{service:"Cerberus itself",node:"center",version:null})));
console.log(JSON.stringify(i18n.t("cerberus.sheet.checked",{time:"12:00:00",every:"30 s",node:"center"})));
console.log(JSON.stringify(i18n.t("cerberus.lookup.meta",{time:"12:00:00",node:"center"})));
'
EOF
bash "$D/p.sh"
```

measured 2026-10-06 by chain chain-cerberus--tab--words-20261006-113711-3a39, finding M1, MEDIUM
probe-key: 3eb5a877df770d3d06d1361c30f401f49b7b3ba5

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json

## INV-7016 — probe — LOW — a result with no value draws a dangling dash and an empty "now"

LOW — a result with no value draws a dangling dash and an empty "now"

```probe
D=$(mktemp -d /tmp/athena-probe-XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe
node -e '
const i18n=require("i18next");const c=require("./src/modules/i18n/locales/en/common.json").cerberus;
i18n.init({lng:"en",resources:{en:{common:{cerberus:c}}},defaultNS:"common",interpolation:{escapeValue:false}});
console.log("lookup keys that are a value-less form of the result sentence:",Object.keys(c.lookup).filter(k=>/^was.+/i.test(k)).join(",")||"none");
console.log(JSON.stringify(i18n.t("cerberus.lookup.was",{time:"17:52:10",word:"passing",value:null})));
console.log(JSON.stringify(i18n.t("cerberus.mute.raw",{service:"S",key:"k/id",value:null})));
'
EOF
bash "$D/p.sh"
```

measured 2026-10-06 by chain chain-cerberus--tab--words-20261006-113711-3a39, finding L1, LOW
probe-key: dd8a1c019ee2b42875e45cefbf9ebab47328a669

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json

## INV-7023 — probe — LOW — a cut line is shorter than the limit (the builder's disclosed trim differs from the intent's "cut to the limit")

LOW — a cut line is shorter than the limit (the builder's disclosed trim differs from the intent's "cut to the limit")

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
cat > "$(dirname "$0")/y.ts" <<'TS'
import { execFileSync } from 'node:child_process';
import { layoutTree } from '@/modules/roadmap/utils/treeLayout';
const doc = JSON.parse(execFileSync(`${process.env.HOME}/.claude/scripts/dispatcher`, ['roadmap', 'show', '--json'], { encoding: 'utf8', maxBuffer: 1 << 26 }));
const rm = doc.roadmaps.find((r: any) => r.name === 'restorly');
const epic = layoutTree(rm, rm.goal ?? 'g').milestones.flatMap((m) => m.epics).find((e) => e.epic.title.startsWith('Every approval a job needs'));
console.log(epic ? `${epic.titleLines[1].length} ${JSON.stringify(epic.titleLines[1])}` : 'epic not in document');
TS
npx --no-install tsx --tsconfig tsconfig.json "$(dirname "$0")/y.ts"
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -rf -- "$D";; esac
```

measured 2026-10-06 by chain chain-roadmap-tree-view--layout-20261006-115222-d264, finding L2, LOW
probe-key: 44d8f8f2804affe3ab073d73f16ba52dcf7ce84e

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/utils/treeLayout.ts

## INV-7024 — probe — LOW — a cut can split a surrogate pair

LOW — a cut can split a surrogate pair

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
cat > "$(dirname "$0")/x.ts" <<'TS'
import { layoutTree } from '@/modules/roadmap/utils/treeLayout';
const rm: any = { name: 'r', goal: null, milestones: [{ name: 'm', title: '😀'.repeat(30), blocked: null, epics: [] }] };
const line = layoutTree(rm, 'g').milestones[0].titleLines[0];
console.log(/[\ud800-\udbff](?![\udc00-\udfff])/.test(line) ? 'lone-surrogate' : 'clean', line.length);
TS
npx --no-install tsx --tsconfig tsconfig.json "$(dirname "$0")/x.ts"
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -rf -- "$D";; esac
```

measured 2026-10-06 by chain chain-roadmap-tree-view--layout-20261006-115222-d264, finding L3, LOW
probe-key: 892d75d3c68d1a79c17e2564fde3fb5c0c0a3d27

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/utils/treeLayout.ts

## INV-7025 — probe — An unbroken title pushes the Sheet's ✕ off the panel, and on a phone nothing else closes it

An unbroken title pushes the Sheet's ✕ off the panel, and on a phone nothing else closes it

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX); cat > "$D/p.sh" <<'PROBE_EOF'
set -u
P=$(mktemp -d /tmp/athena-probe-run.XXXXXX) || exit 1
cat > "$P/run.mjs" <<'JS'
import { openConsole } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { installReactHarness } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/mountReact.mjs';
const s = await openConsole({ dark: false, viewport: { width: 390, height: 844 } });
await installReactHarness(s.page);
const r = await s.page.evaluate(async () => {
  const m = window.__mountReact;
  const spec = await m.readSpecifier('/src/modules/app-switcher/AppDrawerRow.tsx', /from "(\/src\/shared\/ui\/index\.ts[^"]*)"/);
  const ui = await m.importModule(spec); const h = m.h;
  await m.mount('k', h(ui.Sheet, { open: true, onClose() {}, title: 'shadow_connector_dispatcher_backup_verifier_svc' }, 'x'), 'position:fixed;inset:0;z-index:40;padding:24px');
  await new Promise((r) => setTimeout(r, 900));
  const p = document.querySelector('.vv-sheet__panel').getBoundingClientRect(), c = document.querySelector('.vv-sheet__close').getBoundingClientRect();
  return { viewport: innerWidth, panelRight: Math.round(p.right), closeRight: Math.round(c.right), closeInside: c.right <= p.right + 1 };
});
console.log(JSON.stringify(r));
await s.browser.close();
JS
( cd /home/lyphe/.claude/claudecodeui_lyphe/.verify && timeout 150 node "$P/run.mjs" 2>&1 | tail -3 )
case "$P" in /tmp/athena-probe-run.*) rm -r "$P";; esac
PROBE_EOF
bash "$D/p.sh"
```

measured 2026-10-06 by chain chain-cerberus--tab--kit-20261006-113711-c288, finding M1, MEDIUM
probe-key: 663f504055a3dc094d36f60bec088bacccb656f9

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Sheet.tsx

## INV-7026 — probe — Timeline in full density overflows at phone width on a long unbroken token, and the title column is squeezed

Timeline in full density overflows at phone width on a long unbroken token, and the title column is squeezed

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX); cat > "$D/p.sh" <<'PROBE_EOF'
set -u
P=$(mktemp -d /tmp/athena-probe-run.XXXXXX) || exit 1
cat > "$P/run.mjs" <<'JS'
import { openConsole } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { installReactHarness } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/mountReact.mjs';
const s = await openConsole({ dark: false, viewport: { width: 390, height: 844 } });
await installReactHarness(s.page);
const r = await s.page.evaluate(async () => {
  const m = window.__mountReact;
  const spec = await m.readSpecifier('/src/modules/app-switcher/AppDrawerRow.tsx', /from "(\/src\/shared\/ui\/index\.ts[^"]*)"/);
  const ui = await m.importModule(spec); const h = m.h; const out = {};
  for (const [k, title] of [['dotted30', 'disk.used.percent.rootfs.mount'], ['plain', 'Disk is nearly full']]) {
    const events = [{ tone: 'warn', source: 'shadow-connector', title, summary: 'close to the limit', when: '17:52:10' }];
    await m.mount('k', h('div', { id: 'w', style: { width: 342 } }, h(ui.Timeline, { events })), 'position:fixed;inset:0;z-index:40;padding:24px');
    await new Promise((r) => setTimeout(r, 300));
    const w = document.getElementById('w'); out[k] = { scrollWidth: w.scrollWidth, clientWidth: w.clientWidth, overflows: w.scrollWidth > w.clientWidth };
    m.unmount('k'); await new Promise((r) => setTimeout(r, 150));
  }
  return out;
});
console.log(JSON.stringify(r));
await s.browser.close();
JS
( cd /home/lyphe/.claude/claudecodeui_lyphe/.verify && timeout 150 node "$P/run.mjs" 2>&1 | tail -3 )
case "$P" in /tmp/athena-probe-run.*) rm -r "$P";; esac
PROBE_EOF
bash "$D/p.sh"
```

measured 2026-10-06 by chain chain-cerberus--tab--kit-20261006-113711-c288, finding L1, LOW
probe-key: a372e36cabcfa109b5ec1a7a3b0fe3d12a86d936

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Timeline.tsx

## INV-7027 — probe — In uncontrolled mode a newly prepended event moves the open row onto a different event

In uncontrolled mode a newly prepended event moves the open row onto a different event

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX); cat > "$D/p.sh" <<'PROBE_EOF'
set -u
P=$(mktemp -d /tmp/athena-probe-run.XXXXXX) || exit 1
cat > "$P/run.mjs" <<'JS'
import { openConsole } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { installReactHarness } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/mountReact.mjs';
const s = await openConsole({ dark: false, viewport: { width: 1440, height: 900 } });
await installReactHarness(s.page);
const r = await s.page.evaluate(async () => {
  const m = window.__mountReact;
  const spec = await m.readSpecifier('/src/modules/app-switcher/AppDrawerRow.tsx', /from "(\/src\/shared\/ui\/index\.ts[^"]*)"/);
  const ui = await m.importModule(spec); const h = m.h; const React = m.React; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ tone: 'info', source: 's', title: 'Event ' + i, when: 't', meta: 'meta ' + i }));
  let setE; function App() { const [e, s2] = React.useState(mk(6)); setE = s2; return h(ui.Timeline, { events: e }); }
  await m.mount('k', h(App), 'position:fixed;inset:0;z-index:40;padding:24px'); await sleep(200);
  const tg = () => [...document.querySelectorAll('#k [aria-expanded]')];
  tg()[2].click(); await sleep(150);
  const before = tg().find((x) => x.getAttribute('aria-expanded') === 'true').querySelector('.vv-timeline__title').textContent;
  setE((e) => [{ tone: 'warn', source: 's', title: 'NEWEST', when: 't', meta: 'meta NEW' }, ...e]); await sleep(200);
  const open = tg().find((x) => x.getAttribute('aria-expanded') === 'true');
  return { openedBefore: before, openAfter: open ? open.querySelector('.vv-timeline__title').textContent : null, sameEvent: !!open && open.querySelector('.vv-timeline__title').textContent === before };
});
console.log(JSON.stringify(r));
await s.browser.close();
JS
( cd /home/lyphe/.claude/claudecodeui_lyphe/.verify && timeout 150 node "$P/run.mjs" 2>&1 | tail -3 )
case "$P" in /tmp/athena-probe-run.*) rm -r "$P";; esac
PROBE_EOF
bash "$D/p.sh"
```

measured 2026-10-06 by chain chain-cerberus--tab--kit-20261006-113711-c288, finding L2, LOW
probe-key: 3d3e2832272f7dd93794b48e5ce1925d780734cc

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Timeline.tsx

## INV-7029 — probe — a failed flush leaves the `prevAt` chain naming results center never received; center reads that as continuity, not a lapse

a failed flush leaves the `prevAt` chain naming results center never received; center reads that as continuity, not a lapse

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
node --input-type=module <<'JS'
import http from 'node:http';
const R = '/home/lyphe/.claude/claudecodeui_lyphe/warden/src/';
Math.random = () => 0;
const { createProbes } = await import(R + 'probes.mjs');
const srv = http.createServer((q, r) => r.end('ok'));
await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
const handlers = new Map(); const delivered = []; const lost = new Set(); let calls = 0;
const link = { on: (t, f) => handlers.set(t, f), send: (type, body) => {
  if (type !== 'result') return { seq: null, sent: true };
  calls += 1;
  if (calls === 1) { for (const r of body.results) lost.add(r.at); throw new Error('ENOSPC'); } // the outbox could not number the first frame
  delivered.push(...body.results); return { seq: calls, sent: true };
} };
const p = createProbes({ link });
handlers.get('checks.set')({ version: 1, probes: [{ key: 't/a', service: 't', kind: 'http', url: `http://127.0.0.1:${srv.address().port}/`, every: 1, timeout: 3 }] });
await new Promise((resolve) => setTimeout(resolve, 3300));
p.stop(); srv.close();
const first = delivered[0];
console.log('first delivered result chains to a result center never received:', lost.has(first?.prevAt), `prevAt=${first?.prevAt} lost=${[...lost].join(',')}`);
JS
EOF
bash "$D/p.sh" 2>&1 | grep -v "^\[warden\] now"
expect: today `chains to a result center never received: true` (prevAt is one of the lost ats); cured `false` and prevAt=null
```

measured 2026-10-06 by chain chain-cerberus--warden--probes-20261006-121106-277a, finding M1, MEDIUM
probe-key: 01babeac457d959ee27633f136eff6a08fa24d1c

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-warden-probes-edges.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-warden-probes.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probes.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-support.mjs

## INV-7030 — probe — the batch is bounded by count only; a read whose components carry large `data` makes a result frame past center's 8 MiB cap, which center closes the socket on

the batch is bounded by count only; a read whose components carry large `data` makes a result frame past center's 8 MiB cap, which center closes the socket on

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
node --input-type=module <<'JS'
import fs from 'node:fs';
import http from 'node:http';
const R = '/home/lyphe/.claude/claudecodeui_lyphe/';
Math.random = () => 0;
const limit = Number(/MAX_FRAME_BYTES = (\d+) \* 1024 \* 1024/.exec(fs.readFileSync(R + 'server/modules/cerberus/warden-gateway.ts', 'utf8'))?.[1]) * 1024 * 1024;
const { createProbes } = await import(R + 'warden/src/probes.mjs');
const components = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`c${i}`, { status: 'green', reason: 'fine', detail: 'x'.repeat(40_000) }]));
const srv = http.createServer((q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ overall: 'green', checked_at: '2026-10-06T12:00:00+00:00', components })); });
await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
const handlers = new Map(); const sizes = [];
const link = { on: (t, f) => handlers.set(t, f), send: (type, body) => { if (type === 'result') sizes.push(JSON.stringify(body).length); return { seq: 1, sent: true }; } };
const p = createProbes({ link });
handlers.get('checks.set')({ version: 1, probes: [{ key: 't/health', service: 't', kind: 'health_doc', url: `http://127.0.0.1:${srv.address().port}/`, every: 30, timeout: 10, cadence: 100 }] });
await new Promise((resolve) => setTimeout(resolve, 4000));
p.stop(); srv.close();
console.log('largest result frame', Math.max(0, ...sizes), 'bytes; center closes a socket at', limit, '— a frame past it:', Math.max(0, ...sizes) > limit);
JS
EOF
bash "$D/p.sh" 2>&1 | grep -v "^\[warden\] now"
expect: today `largest result frame 16072942 bytes; center closes a socket at 8388608 — a frame past it: true`; cured `… a frame past it: false` (the batch cut by bytes as well as count, or the oversize component refused with a sentence)
```

measured 2026-10-06 by chain chain-cerberus--warden--probes-20261006-121106-277a, finding M2, MEDIUM
probe-key: b21ad5d59473942d0cab04744d17006bb564968f

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-warden-probes-edges.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-warden-probes.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probes.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-support.mjs

## INV-7031 — probe — a document of about 130 000 components makes no result at all, not even the probe's own, and no `failing` word

a document of about 130 000 components makes no result at all, not even the probe's own, and no `failing` word

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
node --input-type=module <<'JS'
import http from 'node:http';
Math.random = () => 0;
const { createProbes } = await import('/home/lyphe/.claude/claudecodeui_lyphe/warden/src/probes.mjs');
const components = Object.fromEntries(Array.from({ length: 130000 }, (_, i) => [`c${i}`, { status: 'green' }]));
const srv = http.createServer((q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ overall: 'green', checked_at: '2026-10-06T12:00:00+00:00', components })); });
await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
const handlers = new Map(); let sent = 0; const logs = [];
const say = console.log; console.log = (...a) => logs.push(a.join(' '));
const link = { on: (t, f) => handlers.set(t, f), send: (type, body) => { if (type === 'result') sent += body.results.length; return { seq: 1, sent: true }; } };
const p = createProbes({ link });
handlers.get('checks.set')({ version: 1, probes: [{ key: 't/health', service: 't', kind: 'health_doc', url: `http://127.0.0.1:${srv.address().port}/`, every: 30, timeout: 20, cadence: 100 }] });
await new Promise((resolve) => setTimeout(resolve, 6000));
p.stop(); srv.close(); console.log = say;
console.log(`130000-component document: ${sent} results sent;`, logs.filter((l) => /turn failed/.test(l)).join(' ') || 'no turn failure');
JS
EOF
bash "$D/p.sh"
expect: today `130000-component document: 0 results sent; [warden] probe t/health turn failed: RangeError`; cured `130001 results sent; no turn failure`
```

measured 2026-10-06 by chain chain-cerberus--warden--probes-20261006-121106-277a, finding L1, LOW
probe-key: 7c5352d405ac81436dedbfe205b6123268a211b4

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-warden-probes-edges.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-warden-probes.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probes.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-support.mjs

## INV-7032 — probe — a probe with `every` past 2 147 483 s runs about a sixth too often (30 days becomes 24.86 days)

a probe with `every` past 2 147 483 s runs about a sixth too often (30 days becomes 24.86 days)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
node --input-type=module <<'JS'
const { secondsToTimerMs } = await import('/home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-support.mjs');
const every = 2_592_000; // center's longest `every`: 30 days
console.log(`every ${every} s (${every / 86400} d) is scheduled every ${(secondsToTimerMs(every) / 86_400_000).toFixed(2)} d`);
JS
EOF
bash "$D/p.sh"
expect: today `every 2592000 s (30 d) is scheduled every 24.86 d`; cured `… every 30.00 d` (a re-arming timer, not a clamp)
```

measured 2026-10-06 by chain chain-cerberus--warden--probes-20261006-121106-277a, finding L2, LOW
probe-key: 1d9f742b2e150a9823f2f2c45229799031db2a15

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-warden-probes-edges.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-warden-probes.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probes.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/probe-support.mjs

## INV-7033 — probe — LOW — `MANUAL.md` and two code comments still describe the strip and `recent` as ending now

LOW — `MANUAL.md` and two code comments still describe the strip and `recent` as ending now

```probe
grep -n "newest 100 .change. rows of the last 3 h\|a 60-cell strip ending now\|own strip draws, ending now" /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/MANUAL.md /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/cells.ts /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/check-detail.ts || echo none
```

measured 2026-10-06 by chain chain-cerberus--tab--client-20261006-115718-5af5, finding L1, LOW
probe-key: 690e09da46ceb21aec48cb3066c73fba7c866e7a

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/cells.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/check-detail.ts

## INV-7034 — probe — LOW — a newer read that fails makes the provider drop an older read that answered well

LOW — a newer read that fails makes the provider drop an older read that answered well

```probe
D=$(mktemp -d /tmp/athena-ticket.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'EOF'
import { openConsole } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const s = await openConsole();
const { page } = s;
await page.addInitScript(() => {
  window.__snap = () => {
    const el = document.getElementById('root'); const key = el && Object.keys(el).find((k) => k.startsWith('__reactContainer$'));
    if (!key) return null; const stack = [el[key].stateNode.current];
    while (stack.length) { const f = stack.pop(); const v = f.memoizedProps?.value;
      if (v && typeof v === 'object' && 'overview' in v && 'unreachable' in v && typeof v.liftMute === 'function') return { has: v.overview !== null, needs: v.overview?.counts.needsYou ?? null, unreachable: v.unreachable };
      if (f.sibling) stack.push(f.sibling); if (f.child) stack.push(f.child); }
    return null;
  };
});
const sockets = [];
await page.routeWebSocket(/\/ws(\?|$)/, (ws) => { sockets.push(ws); ws.connectToServer(); });
const frame = () => { for (const w of sockets) w.send(JSON.stringify({ kind: 'cerberus_changed', at: Date.now(), nodes: [], checks: [] })); };
let n = 0; let plan = null;
await page.route('**/api/cerberus/overview', async (route) => { n += 1; return plan ? plan(n, route) : route.continue(); });
const withNeeds = async (route, needs) => { const r = await route.fetch(); const body = await r.json(); body.counts = { ...body.counts, needsYou: needs }; return route.fulfill({ response: r, json: body }); };
const bad = (route) => route.fulfill({ status: 502, contentType: 'text/html', body: '<html>bad gateway</html>' });
const snap = () => page.evaluate(() => window.__snap());
await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(3500);
const base = n;
plan = async (k, route) => (k === base + 1 ? (await sleep(2500), withNeeds(route, 5)) : bad(route));
frame(); await sleep(1200); frame(); await sleep(3600);
console.log('A held overview, slow good read (needs=5) overtaken by a failed read -> needs =', (await snap()).needs, '(5 = cured, 0 = defect stands)');
plan = async (k, route) => (k <= 2 ? (await sleep(2500), withNeeds(route, 5)) : bad(route));
await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(600); frame(); await sleep(4200);
const b = await snap();
console.log('B first read slow-good, frame read failed -> has =', b.has, 'unreachable =', b.unreachable, '(has=true = cured, unreachable=true = defect stands)');
await s.browser.close();
EOF
node "$D/p.mjs"
```

measured 2026-10-06 by chain chain-cerberus--tab--client-20261006-115718-5af5, finding L2, LOW
probe-key: 8f9a005cbff0fb0717a598b28a9bd21709fe11da

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/App.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/context/CerberusContext.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/context/CerberusProvider.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useCheckDetail.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/cerberusTime.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-7037 — probe — a search that crosses the id and a service name misses when the description is empty

a search that crosses the id and a service name misses when the description is empty

```probe
D=$(mktemp -d) && cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
Q="$(dirname "$0")/q.mts"
cat > "$Q" <<'TS'
import * as M from '@/modules/cerberus/fleet/fleetModel';
const svc = { node: 'center', service: 'cerberus', label: 'Cerberus itself', status: 'ok', checks: [], cells: [], counts: { total: 2, passing: 2, needsYou: 0, muted: 0, notEnabled: 1, unknown: 0 } };
const hub = { id: 'center', desc: null, role: 'hub', link: 'reporting', wardenVersion: null, lastHeardAt: 1, silentSince: null, enrolledAt: null, services: [svc] };
const items = M.fleetItems({ now: 1, nodes: [hub], needsYou: [], muted: [], counts: { checks: 2, passing: 2, needsYou: 0, muted: 0, nodes: 1 }, activity: [], lastResultAt: 1, gateway: { listening: true, address: null } } as never);
const hit = (q: string) => M.applyFilter(items, 'all', q).length;
console.log('search text:', JSON.stringify(items[0].search));
console.log('"center cerberus":', hit('center cerberus'), '| "center  cerberus" (two spaces):', hit('center  cerberus'));
TS
npx tsx --tsconfig tsconfig.json "$Q"
EOF
bash "$D/p.sh"
```

measured 2026-10-06 by chain chain-cerberus--tab--model-20261006-121414-99f2, finding L1, LOW
probe-key: dd0d1e2358c588d2f554338e2905389f9756b695

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/fleetModel.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/activityEvents.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/cerberusTime.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-7038 — probe — "muted until HH:MM" drops the day when the mute lifts tomorrow

"muted until HH:MM" drops the day when the mute lifts tomorrow

```probe
D=$(mktemp -d) && cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
Q="$(dirname "$0")/q.mts"
cat > "$Q" <<'TS'
import * as A from '@/modules/cerberus/utils/activityEvents';
const t = ((k: string, o?: Record<string, string>) => `${k}|${Object.values(o ?? {}).join('|')}`) as never;
const at = new Date(2026, 9, 5, 17, 52, 10).getTime();
const until = new Date(2026, 9, 6, 8, 0, 0).getTime();
const e = A.toTimelineEvent({ kind: 'mute', event: 'muted', at, until, node: 'center', check: 'a/b', label: 'L', serviceLabel: 'S', reason: 'r', by: 'v' } as never, t, at + 60_000);
console.log('when:', e.when, '| title args:', e.title);
TS
npx tsx --tsconfig tsconfig.json "$Q"
EOF
bash "$D/p.sh"
```

measured 2026-10-06 by chain chain-cerberus--tab--model-20261006-121414-99f2, finding L2, LOW
probe-key: 2ee9f987392cbe01d553239790f45b59d13a56e3

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/fleetModel.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/activityEvents.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/cerberusTime.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-7044 — probe — The heartbeat's `probesRunning` counts runs in flight; the wire contract says probes scheduled

The heartbeat's `probesRunning` counts runs in flight; the wire contract says probes scheduled

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$(cd "$(dirname "$0")" && pwd)
REPO=/home/lyphe/.claude/claudecodeui_lyphe
okpid() { case "$1" in ''|*[!0123456789]*|0*|1) return 1;; esac; }
stop_pid() { if okpid "$1"; then kill "$1" 2>/dev/null; fi; }
cat > "$D/fc.mjs" <<'JS'
import crypto from 'node:crypto'; import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path';
const [repo, home, checks, replace] = process.argv.slice(2);
const { WebSocketServer } = await import(path.join(repo, 'node_modules/ws/wrapper.mjs'));
const pair = () => crypto.generateKeyPairSync('ed25519'), node = pair(), key = pair(), NODE = 'fake-node';
const der = (k) => k.export({ type: 'spki', format: 'der' });
fs.mkdirSync(path.join(home, 'keys'), { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(home, 'keys/node.key'), node.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const frame = (type, body) => { const env = JSON.stringify({ type, id: 'x', node: NODE, seq: null, at: Date.now(), body }); return JSON.stringify({ env, sig: crypto.sign(null, Buffer.from(env), key.privateKey).toString('base64') }); };
const spec = checks ? JSON.parse(fs.readFileSync(checks, 'utf8')) : null;
const wss = new WebSocketServer({ noServer: true }), server = http.createServer();
server.on('upgrade', (req, sock, head) => wss.handleUpgrade(req, sock, head, (ws) => {
  if (replace) for (const other of wss.clients) if (other !== ws) other.close(4000, 'replaced by a newer link');
  ws.on('error', () => {});
  ws.on('message', (data) => { const env = JSON.parse(data.toString());
    console.log(JSON.stringify({ in: env.type, seq: env.seq, body: env.type === 'result' ? { n: env.body.results.length } : env.body }));
    if (env.type === 'hello') ws.send(frame('welcome', { node: NODE, ackedUpto: 0, ...(spec && env.body.checksVersion !== spec.version ? { checks: spec } : {}) }));
    if (env.type === 'result') ws.send(frame('ack', { upto: env.seq })); });
}));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port, fp = crypto.createHash('sha256').update(der(node.publicKey)).digest('hex'), issuedAt = Date.now();
const cert = { node: NODE, fingerprint: fp, issuedAt, centerKey: der(key.publicKey).toString('base64'), sig: crypto.sign(null, Buffer.from(`cerberus-cert\n${NODE}\n${fp}\n${issuedAt}`), key.privateKey).toString('base64') };
fs.writeFileSync(path.join(home, 'identity.json'), JSON.stringify({ node: NODE, center: `http://127.0.0.1:${port}`, centerKey: cert.centerKey, cert, enrolledAt: issuedAt }), { mode: 0o600 });
console.log(`PORT ${port}`);
JS
cat > "$D/two.json" <<'JS'
{ "version": 7, "probes": [
  { "key": "fx/a.ok", "service": "fx", "kind": "exec", "cmd": "echo 1", "every": 1, "timeout": 5 },
  { "key": "fx/b.ok", "service": "fx", "kind": "exec", "cmd": "echo 2", "every": 1, "timeout": 5 } ] }
JS
mkdir "$D/home"
fc() { node "$D/fc.mjs" "$REPO" "$D/home" "$@" > "$D/fc.log" 2>&1 & FCPID=$!; timeout 10 bash -c 'until grep -q ^PORT "$0"; do sleep 0.2; done' "$D/fc.log"; }
warden() { CERBERUS_WARDEN_HOME="$D/home" node "$REPO/warden/src/main.mjs" "$@"; }
fc "$D/two.json"
CERBERUS_WARDEN_HOME="$D/home" node "$REPO/warden/src/main.mjs" run > "$D/w.log" 2>&1 & WPID=$!
sleep 20
echo "heartbeat probesRunning=$(grep '"in":"heartbeat"' "$D/fc.log" | tail -1 | jq -c .body.probesRunning) run.json probes=$(jq -c .probes "$D/home/run.json")"
stop_pid "$WPID"; stop_pid "$FCPID"; wait
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-p.*) rm -rf "$D";; esac
expect: heartbeat probesRunning equals run.json probes (both 2); while the defect stands it prints `heartbeat probesRunning=0 run.json probes=2`
```

measured 2026-10-06 by chain chain-cerberus--warden--daemon-20261006-124527-7f08, finding M1, MEDIUM
probe-key: 4aa09adedb36c8e592982b992c383fa63fac6320

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-daemon.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/enroll.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/daemon.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/status.mjs

## INV-7045 — probe — Nothing keeps a second `run` off a home that already has one; on a real center the two daemons take the link from each other about once a second

Nothing keeps a second `run` off a home that already has one; on a real center the two daemons take the link from each other about once a second

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$(cd "$(dirname "$0")" && pwd)
REPO=/home/lyphe/.claude/claudecodeui_lyphe
okpid() { case "$1" in ''|*[!0123456789]*|0*|1) return 1;; esac; }
stop_pid() { if okpid "$1"; then kill "$1" 2>/dev/null; fi; }
cat > "$D/fc.mjs" <<'JS'
import crypto from 'node:crypto'; import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path';
const [repo, home, checks, replace] = process.argv.slice(2);
const { WebSocketServer } = await import(path.join(repo, 'node_modules/ws/wrapper.mjs'));
const pair = () => crypto.generateKeyPairSync('ed25519'), node = pair(), key = pair(), NODE = 'fake-node';
const der = (k) => k.export({ type: 'spki', format: 'der' });
fs.mkdirSync(path.join(home, 'keys'), { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(home, 'keys/node.key'), node.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const frame = (type, body) => { const env = JSON.stringify({ type, id: 'x', node: NODE, seq: null, at: Date.now(), body }); return JSON.stringify({ env, sig: crypto.sign(null, Buffer.from(env), key.privateKey).toString('base64') }); };
const spec = checks ? JSON.parse(fs.readFileSync(checks, 'utf8')) : null;
const wss = new WebSocketServer({ noServer: true }), server = http.createServer();
server.on('upgrade', (req, sock, head) => wss.handleUpgrade(req, sock, head, (ws) => {
  if (replace) for (const other of wss.clients) if (other !== ws) other.close(4000, 'replaced by a newer link');
  ws.on('error', () => {});
  ws.on('message', (data) => { const env = JSON.parse(data.toString());
    console.log(JSON.stringify({ in: env.type, seq: env.seq, body: env.type === 'result' ? { n: env.body.results.length } : env.body }));
    if (env.type === 'hello') ws.send(frame('welcome', { node: NODE, ackedUpto: 0, ...(spec && env.body.checksVersion !== spec.version ? { checks: spec } : {}) }));
    if (env.type === 'result') ws.send(frame('ack', { upto: env.seq })); });
}));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port, fp = crypto.createHash('sha256').update(der(node.publicKey)).digest('hex'), issuedAt = Date.now();
const cert = { node: NODE, fingerprint: fp, issuedAt, centerKey: der(key.publicKey).toString('base64'), sig: crypto.sign(null, Buffer.from(`cerberus-cert\n${NODE}\n${fp}\n${issuedAt}`), key.privateKey).toString('base64') };
fs.writeFileSync(path.join(home, 'identity.json'), JSON.stringify({ node: NODE, center: `http://127.0.0.1:${port}`, centerKey: cert.centerKey, cert, enrolledAt: issuedAt }), { mode: 0o600 });
console.log(`PORT ${port}`);
JS
cat > "$D/two.json" <<'JS'
{ "version": 7, "probes": [
  { "key": "fx/a.ok", "service": "fx", "kind": "exec", "cmd": "echo 1", "every": 1, "timeout": 5 },
  { "key": "fx/b.ok", "service": "fx", "kind": "exec", "cmd": "echo 2", "every": 1, "timeout": 5 } ] }
JS
mkdir "$D/home"
fc() { node "$D/fc.mjs" "$REPO" "$D/home" "$@" > "$D/fc.log" 2>&1 & FCPID=$!; timeout 10 bash -c 'until grep -q ^PORT "$0"; do sleep 0.2; done' "$D/fc.log"; }
warden() { CERBERUS_WARDEN_HOME="$D/home" node "$REPO/warden/src/main.mjs" "$@"; }
fc "$D/two.json" replace
run() { CERBERUS_WARDEN_HOME="$D/home" node "$REPO/warden/src/main.mjs" run > "$D/$1.log" 2>&1 & }
run one; P1=$!; sleep 2; run two; P2=$!; sleep 8
SECOND=gone; kill -0 "$P2" 2>/dev/null && SECOND=running
echo "second daemon: $SECOND; link-lost lines in the first daemon's log: $(grep -c 'link lost' "$D/one.log")"
stop_pid "$P1"; stop_pid "$P2"; stop_pid "$FCPID"; wait
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-p.*) rm -rf "$D";; esac
expect: `second daemon: gone` and `0` link-lost lines in the first daemon's log (the second refused); while the defect stands it prints `second daemon: running` and a count of 4 or more
```

measured 2026-10-06 by chain chain-cerberus--warden--daemon-20261006-124527-7f08, finding M2, MEDIUM
probe-key: ef01c73e00fbe55976d3b1eff3ecd18aa1b2f1b1

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-daemon.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/enroll.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/daemon.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/status.mjs

## INV-7046 — probe — `run.json` (and so `status`) is stale at the two moments it is read

`run.json` (and so `status`) is stale at the two moments it is read

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$(cd "$(dirname "$0")" && pwd)
REPO=/home/lyphe/.claude/claudecodeui_lyphe
okpid() { case "$1" in ''|*[!0123456789]*|0*|1) return 1;; esac; }
stop_pid() { if okpid "$1"; then kill "$1" 2>/dev/null; fi; }
cat > "$D/fc.mjs" <<'JS'
import crypto from 'node:crypto'; import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path';
const [repo, home, checks, replace] = process.argv.slice(2);
const { WebSocketServer } = await import(path.join(repo, 'node_modules/ws/wrapper.mjs'));
const pair = () => crypto.generateKeyPairSync('ed25519'), node = pair(), key = pair(), NODE = 'fake-node';
const der = (k) => k.export({ type: 'spki', format: 'der' });
fs.mkdirSync(path.join(home, 'keys'), { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(home, 'keys/node.key'), node.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const frame = (type, body) => { const env = JSON.stringify({ type, id: 'x', node: NODE, seq: null, at: Date.now(), body }); return JSON.stringify({ env, sig: crypto.sign(null, Buffer.from(env), key.privateKey).toString('base64') }); };
const spec = checks ? JSON.parse(fs.readFileSync(checks, 'utf8')) : null;
const wss = new WebSocketServer({ noServer: true }), server = http.createServer();
server.on('upgrade', (req, sock, head) => wss.handleUpgrade(req, sock, head, (ws) => {
  if (replace) for (const other of wss.clients) if (other !== ws) other.close(4000, 'replaced by a newer link');
  ws.on('error', () => {});
  ws.on('message', (data) => { const env = JSON.parse(data.toString());
    console.log(JSON.stringify({ in: env.type, seq: env.seq, body: env.type === 'result' ? { n: env.body.results.length } : env.body }));
    if (env.type === 'hello') ws.send(frame('welcome', { node: NODE, ackedUpto: 0, ...(spec && env.body.checksVersion !== spec.version ? { checks: spec } : {}) }));
    if (env.type === 'result') ws.send(frame('ack', { upto: env.seq })); });
}));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port, fp = crypto.createHash('sha256').update(der(node.publicKey)).digest('hex'), issuedAt = Date.now();
const cert = { node: NODE, fingerprint: fp, issuedAt, centerKey: der(key.publicKey).toString('base64'), sig: crypto.sign(null, Buffer.from(`cerberus-cert\n${NODE}\n${fp}\n${issuedAt}`), key.privateKey).toString('base64') };
fs.writeFileSync(path.join(home, 'identity.json'), JSON.stringify({ node: NODE, center: `http://127.0.0.1:${port}`, centerKey: cert.centerKey, cert, enrolledAt: issuedAt }), { mode: 0o600 });
console.log(`PORT ${port}`);
JS
cat > "$D/two.json" <<'JS'
{ "version": 7, "probes": [
  { "key": "fx/a.ok", "service": "fx", "kind": "exec", "cmd": "echo 1", "every": 1, "timeout": 5 },
  { "key": "fx/b.ok", "service": "fx", "kind": "exec", "cmd": "echo 2", "every": 1, "timeout": 5 } ] }
JS
mkdir "$D/home"
fc() { node "$D/fc.mjs" "$REPO" "$D/home" "$@" > "$D/fc.log" 2>&1 & FCPID=$!; timeout 10 bash -c 'until grep -q ^PORT "$0"; do sleep 0.2; done' "$D/fc.log"; }
warden() { CERBERUS_WARDEN_HOME="$D/home" node "$REPO/warden/src/main.mjs" "$@"; }
fc "$D/two.json"
CERBERUS_WARDEN_HOME="$D/home" node "$REPO/warden/src/main.mjs" run > "$D/w.log" 2>&1 & WPID=$!
sleep 3
echo "3 s after start (checks arrived, 2 probes armed): run.json probes=$(jq -c .probes "$D/home/run.json") checksVersion=$(jq -c .checksVersion "$D/home/run.json")"
stop_pid "$FCPID"; sleep 14
echo "14 s into a center outage (2 results queue every second): $(CERBERUS_WARDEN_HOME="$D/home" node "$REPO/warden/src/main.mjs" status | grep -E 'outbox')"
stop_pid "$WPID"; wait
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-p.*) rm -rf "$D";; esac
expect: both lines show the daemon's real state — `probes=2 checksVersion=7` 3 s after start and a queued-frames figure above 3 on the `outbox:` line 14 s into the outage; while the defect stands they print `probes=0 checksVersion=null` and `outbox:    0 queued`
```

measured 2026-10-06 by chain chain-cerberus--warden--daemon-20261006-124527-7f08, finding L1, LOW
probe-key: e372b2f966b2ed523c2b48f24e1142297a680480

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-daemon.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/enroll.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/daemon.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/status.mjs

## INV-7047 — probe — The first `run.json` write at start is unguarded; the same failure later is one log line

The first `run.json` write at start is unguarded; the same failure later is one log line

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$(cd "$(dirname "$0")" && pwd)
REPO=/home/lyphe/.claude/claudecodeui_lyphe
okpid() { case "$1" in ''|*[!0123456789]*|0*|1) return 1;; esac; }
stop_pid() { if okpid "$1"; then kill "$1" 2>/dev/null; fi; }
cat > "$D/fc.mjs" <<'JS'
import crypto from 'node:crypto'; import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path';
const [repo, home, checks, replace] = process.argv.slice(2);
const { WebSocketServer } = await import(path.join(repo, 'node_modules/ws/wrapper.mjs'));
const pair = () => crypto.generateKeyPairSync('ed25519'), node = pair(), key = pair(), NODE = 'fake-node';
const der = (k) => k.export({ type: 'spki', format: 'der' });
fs.mkdirSync(path.join(home, 'keys'), { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(home, 'keys/node.key'), node.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const frame = (type, body) => { const env = JSON.stringify({ type, id: 'x', node: NODE, seq: null, at: Date.now(), body }); return JSON.stringify({ env, sig: crypto.sign(null, Buffer.from(env), key.privateKey).toString('base64') }); };
const spec = checks ? JSON.parse(fs.readFileSync(checks, 'utf8')) : null;
const wss = new WebSocketServer({ noServer: true }), server = http.createServer();
server.on('upgrade', (req, sock, head) => wss.handleUpgrade(req, sock, head, (ws) => {
  if (replace) for (const other of wss.clients) if (other !== ws) other.close(4000, 'replaced by a newer link');
  ws.on('error', () => {});
  ws.on('message', (data) => { const env = JSON.parse(data.toString());
    console.log(JSON.stringify({ in: env.type, seq: env.seq, body: env.type === 'result' ? { n: env.body.results.length } : env.body }));
    if (env.type === 'hello') ws.send(frame('welcome', { node: NODE, ackedUpto: 0, ...(spec && env.body.checksVersion !== spec.version ? { checks: spec } : {}) }));
    if (env.type === 'result') ws.send(frame('ack', { upto: env.seq })); });
}));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port, fp = crypto.createHash('sha256').update(der(node.publicKey)).digest('hex'), issuedAt = Date.now();
const cert = { node: NODE, fingerprint: fp, issuedAt, centerKey: der(key.publicKey).toString('base64'), sig: crypto.sign(null, Buffer.from(`cerberus-cert\n${NODE}\n${fp}\n${issuedAt}`), key.privateKey).toString('base64') };
fs.writeFileSync(path.join(home, 'identity.json'), JSON.stringify({ node: NODE, center: `http://127.0.0.1:${port}`, centerKey: cert.centerKey, cert, enrolledAt: issuedAt }), { mode: 0o600 });
console.log(`PORT ${port}`);
JS
cat > "$D/two.json" <<'JS'
{ "version": 7, "probes": [
  { "key": "fx/a.ok", "service": "fx", "kind": "exec", "cmd": "echo 1", "every": 1, "timeout": 5 },
  { "key": "fx/b.ok", "service": "fx", "kind": "exec", "cmd": "echo 2", "every": 1, "timeout": 5 } ] }
JS
mkdir "$D/home"
fc() { node "$D/fc.mjs" "$REPO" "$D/home" "$@" > "$D/fc.log" 2>&1 & FCPID=$!; timeout 10 bash -c 'until grep -q ^PORT "$0"; do sleep 0.2; done' "$D/fc.log"; }
warden() { CERBERUS_WARDEN_HOME="$D/home" node "$REPO/warden/src/main.mjs" "$@"; }
fc "$D/two.json"; mkdir "$D/home/run.json"
CERBERUS_WARDEN_HOME="$D/home" node "$REPO/warden/src/main.mjs" run > "$D/w.log" 2>&1 & WPID=$!
sleep 4
if kill -0 "$WPID" 2>/dev/null; then echo "daemon: running, $(grep -c 'linked to' "$D/w.log") link(s) made"; stop_pid "$WPID"; else wait "$WPID"; echo "daemon: exited $? — $(tail -1 "$D/w.log" | cut -c1-60)"; fi
stop_pid "$FCPID"; wait
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-p.*) rm -rf "$D";; esac
expect: `daemon: running, 1 link(s) made`; while the defect stands it prints `daemon: exited 1 — [warden] run failed: EISDIR…`
```

measured 2026-10-06 by chain chain-cerberus--warden--daemon-20261006-124527-7f08, finding L2, LOW
probe-key: 63168d75a9df1c665205678c2b122e829eb8c82e

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-daemon.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/enroll.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/daemon.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/status.mjs

## INV-7048 — probe — SIGTERM leaves a running exec probe's process behind

SIGTERM leaves a running exec probe's process behind

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$(cd "$(dirname "$0")" && pwd)
REPO=/home/lyphe/.claude/claudecodeui_lyphe
okpid() { case "$1" in ''|*[!0123456789]*|0*|1) return 1;; esac; }
stop_pid() { if okpid "$1"; then kill "$1" 2>/dev/null; fi; }
cat > "$D/fc.mjs" <<'JS'
import crypto from 'node:crypto'; import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path';
const [repo, home, checks, replace] = process.argv.slice(2);
const { WebSocketServer } = await import(path.join(repo, 'node_modules/ws/wrapper.mjs'));
const pair = () => crypto.generateKeyPairSync('ed25519'), node = pair(), key = pair(), NODE = 'fake-node';
const der = (k) => k.export({ type: 'spki', format: 'der' });
fs.mkdirSync(path.join(home, 'keys'), { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(home, 'keys/node.key'), node.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const frame = (type, body) => { const env = JSON.stringify({ type, id: 'x', node: NODE, seq: null, at: Date.now(), body }); return JSON.stringify({ env, sig: crypto.sign(null, Buffer.from(env), key.privateKey).toString('base64') }); };
const spec = checks ? JSON.parse(fs.readFileSync(checks, 'utf8')) : null;
const wss = new WebSocketServer({ noServer: true }), server = http.createServer();
server.on('upgrade', (req, sock, head) => wss.handleUpgrade(req, sock, head, (ws) => {
  if (replace) for (const other of wss.clients) if (other !== ws) other.close(4000, 'replaced by a newer link');
  ws.on('error', () => {});
  ws.on('message', (data) => { const env = JSON.parse(data.toString());
    console.log(JSON.stringify({ in: env.type, seq: env.seq, body: env.type === 'result' ? { n: env.body.results.length } : env.body }));
    if (env.type === 'hello') ws.send(frame('welcome', { node: NODE, ackedUpto: 0, ...(spec && env.body.checksVersion !== spec.version ? { checks: spec } : {}) }));
    if (env.type === 'result') ws.send(frame('ack', { upto: env.seq })); });
}));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port, fp = crypto.createHash('sha256').update(der(node.publicKey)).digest('hex'), issuedAt = Date.now();
const cert = { node: NODE, fingerprint: fp, issuedAt, centerKey: der(key.publicKey).toString('base64'), sig: crypto.sign(null, Buffer.from(`cerberus-cert\n${NODE}\n${fp}\n${issuedAt}`), key.privateKey).toString('base64') };
fs.writeFileSync(path.join(home, 'identity.json'), JSON.stringify({ node: NODE, center: `http://127.0.0.1:${port}`, centerKey: cert.centerKey, cert, enrolledAt: issuedAt }), { mode: 0o600 });
console.log(`PORT ${port}`);
JS
cat > "$D/two.json" <<'JS'
{ "version": 7, "probes": [
  { "key": "fx/a.ok", "service": "fx", "kind": "exec", "cmd": "echo 1", "every": 1, "timeout": 5 },
  { "key": "fx/b.ok", "service": "fx", "kind": "exec", "cmd": "echo 2", "every": 1, "timeout": 5 } ] }
JS
mkdir "$D/home"
fc() { node "$D/fc.mjs" "$REPO" "$D/home" "$@" > "$D/fc.log" 2>&1 & FCPID=$!; timeout 10 bash -c 'until grep -q ^PORT "$0"; do sleep 0.2; done' "$D/fc.log"; }
warden() { CERBERUS_WARDEN_HOME="$D/home" node "$REPO/warden/src/main.mjs" "$@"; }
cat > "$D/slow.json" <<JS
{ "version": 3, "probes": [ { "key": "fx/slow", "service": "fx", "kind": "exec", "cmd": "echo \$\$ > $D/child.pid; exec sleep 600", "every": 2, "timeout": 60 } ] }
JS
fc "$D/slow.json"
CERBERUS_WARDEN_HOME="$D/home" node "$REPO/warden/src/main.mjs" run > "$D/w.log" 2>&1 & WPID=$!
sleep 6; stop_pid "$WPID"; wait "$WPID"; CODE=$?
CHILD=$(cat "$D/child.pid"); ALIVE=gone; okpid "$CHILD" && kill -0 "$CHILD" 2>/dev/null && ALIVE=running
echo "warden exit $CODE; its exec probe's process afterwards: $ALIVE"
if [ "$ALIVE" = running ]; then stop_pid "$CHILD"; fi
stop_pid "$FCPID"; wait
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-p.*) rm -rf "$D";; esac
expect: `its exec probe's process afterwards: gone`; while the defect stands it prints `running`
```

measured 2026-10-06 by chain chain-cerberus--warden--daemon-20261006-124527-7f08, finding L3, LOW
probe-key: cba61fdb3f0c1538dfede476ee739c8df1713dce

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-daemon.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/enroll.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/daemon.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/status.mjs

## INV-7049 — probe — `status` prints `undefined` for a `run.json` that lacks fields

`status` prints `undefined` for a `run.json` that lacks fields

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$(cd "$(dirname "$0")" && pwd)
REPO=/home/lyphe/.claude/claudecodeui_lyphe
okpid() { case "$1" in ''|*[!0123456789]*|0*|1) return 1;; esac; }
stop_pid() { if okpid "$1"; then kill "$1" 2>/dev/null; fi; }
cat > "$D/fc.mjs" <<'JS'
import crypto from 'node:crypto'; import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path';
const [repo, home, checks, replace] = process.argv.slice(2);
const { WebSocketServer } = await import(path.join(repo, 'node_modules/ws/wrapper.mjs'));
const pair = () => crypto.generateKeyPairSync('ed25519'), node = pair(), key = pair(), NODE = 'fake-node';
const der = (k) => k.export({ type: 'spki', format: 'der' });
fs.mkdirSync(path.join(home, 'keys'), { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(home, 'keys/node.key'), node.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const frame = (type, body) => { const env = JSON.stringify({ type, id: 'x', node: NODE, seq: null, at: Date.now(), body }); return JSON.stringify({ env, sig: crypto.sign(null, Buffer.from(env), key.privateKey).toString('base64') }); };
const spec = checks ? JSON.parse(fs.readFileSync(checks, 'utf8')) : null;
const wss = new WebSocketServer({ noServer: true }), server = http.createServer();
server.on('upgrade', (req, sock, head) => wss.handleUpgrade(req, sock, head, (ws) => {
  if (replace) for (const other of wss.clients) if (other !== ws) other.close(4000, 'replaced by a newer link');
  ws.on('error', () => {});
  ws.on('message', (data) => { const env = JSON.parse(data.toString());
    console.log(JSON.stringify({ in: env.type, seq: env.seq, body: env.type === 'result' ? { n: env.body.results.length } : env.body }));
    if (env.type === 'hello') ws.send(frame('welcome', { node: NODE, ackedUpto: 0, ...(spec && env.body.checksVersion !== spec.version ? { checks: spec } : {}) }));
    if (env.type === 'result') ws.send(frame('ack', { upto: env.seq })); });
}));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port, fp = crypto.createHash('sha256').update(der(node.publicKey)).digest('hex'), issuedAt = Date.now();
const cert = { node: NODE, fingerprint: fp, issuedAt, centerKey: der(key.publicKey).toString('base64'), sig: crypto.sign(null, Buffer.from(`cerberus-cert\n${NODE}\n${fp}\n${issuedAt}`), key.privateKey).toString('base64') };
fs.writeFileSync(path.join(home, 'identity.json'), JSON.stringify({ node: NODE, center: `http://127.0.0.1:${port}`, centerKey: cert.centerKey, cert, enrolledAt: issuedAt }), { mode: 0o600 });
console.log(`PORT ${port}`);
JS
cat > "$D/two.json" <<'JS'
{ "version": 7, "probes": [
  { "key": "fx/a.ok", "service": "fx", "kind": "exec", "cmd": "echo 1", "every": 1, "timeout": 5 },
  { "key": "fx/b.ok", "service": "fx", "kind": "exec", "cmd": "echo 2", "every": 1, "timeout": 5 } ] }
JS
mkdir "$D/home"
fc() { node "$D/fc.mjs" "$REPO" "$D/home" "$@" > "$D/fc.log" 2>&1 & FCPID=$!; timeout 10 bash -c 'until grep -q ^PORT "$0"; do sleep 0.2; done' "$D/fc.log"; }
warden() { CERBERUS_WARDEN_HOME="$D/home" node "$REPO/warden/src/main.mjs" "$@"; }
fc; stop_pid "$FCPID"; wait
printf '{"linked":true}' > "$D/home/run.json"
echo "status prints 'undefined' on $(CERBERUS_WARDEN_HOME="$D/home" node "$REPO/warden/src/main.mjs" status | grep -c undefined) line(s)"
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-p.*) rm -rf "$D";; esac
expect: `status prints 'undefined' on 0 line(s)`; while the defect stands it prints 4
```

measured 2026-10-06 by chain chain-cerberus--warden--daemon-20261006-124527-7f08, finding L4, LOW
probe-key: 61334a847169025e0efa45f6261be29832cb92a0

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-daemon.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/enroll.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/daemon.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/status.mjs

## INV-7053 — `animate-shape-rise` — a stagger's delay goes inline, never an `[animation-delay:…]` class

`shape-rise` (`tailwind.config.js` `animation`) is the house's one spelling of Verve's `vv-rise` for any screen's arriving block; the transcript was its first wearer, not its owner. A screen never adds a second `vv-rise` utility.

| trap | do |
|---|---|
| `motion-safe:animate-shape-rise [animation-delay:60ms]` rises with no delay. Measured 2026-10-06 (Tailwind CLI on `tailwind.config.js`): the `[animation-delay:60ms]` rule is emitted before the `@media (prefers-reduced-motion: no-preference)` block, whose `animation:` shorthand then resets the delay to 0 | set the delay inline, `style={{ animationDelay: '60ms' }}`; the check sheet's stagger does (MAN-7878) |
| a stagger item must hold invisible before its turn | `shape-item` wears `backwards`; `shape-rise` wears `both` |

governs: /home/lyphe/.claude/claudecodeui_lyphe/tailwind.config.js

## INV-7056 — probe — `export type BootVouch` has no importer

`export type BootVouch` has no importer

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -rn "BootVouch" server src --include=*.ts --include=*.tsx | cut -c1-100
```

measured 2026-10-06 by chain chain-cerberus--warden--whole-20261006-143758-038d, finding L3, LOW
probe-key: ed637001d84570db780d10aaa5ca616bd7af9e0e

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/boot-vouch.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/cerberus.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/ingest.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/freshness.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/series.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts

## INV-7058 — probe — a re-read that lands after more than a page of new events leaves a silent hole in the feed

a re-read that lands after more than a page of new events leaves a silent hole in the feed

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cat > "$(dirname "$0")/p.mjs" <<'JS'
import { openConsole } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { installReactHarness, unmountReactHost } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/mountReact.mjs';
const { page, browser } = await openConsole({ viewport: { width: 1440, height: 900 } });
const sockets = [];
await page.routeWebSocket(/\/ws(\?|$)/, (ws) => { sockets.push(ws); ws.connectToServer(); });
await page.reload({ waitUntil: 'load' });
for (let i = 0; i < 100 && sockets.length === 0; i++) await page.waitForTimeout(100);
await page.waitForTimeout(1500);
const now = Date.now();
const all = Array.from({ length: 200 }, (_, i) => ({ kind: 'node', at: now - 5000 - i * 1000, node: `n${i}`, event: 'enrolled', wardenVersion: null }));
let world = all.slice(60); // the record as the view first sees it: n60 is the newest line
await page.route('**/api/cerberus/activity**', (route) => {
  const q = new URL(route.request().url()).searchParams; const before = q.get('before'); const limit = Number(q.get('limit') ?? 40);
  const rows = world.filter((r) => before === null || r.at < Number(before));
  let cut = Math.min(limit, rows.length);
  while (cut > 0 && cut < rows.length && rows[cut].at === rows[cut - 1].at) cut++; // the server's own rule (read-model/activity.ts): a page runs on to the end of its last instant
  route.fulfill({ json: rows.slice(0, cut) });
});
try {
  await installReactHarness(page);
  await page.evaluate(async () => {
    const m = window.__mountReact; const h = m.h;
    const imp = (re) => m.readSpecifier('/src/App.tsx', new RegExp(`from\\s+["']([^"']*${re}[^"']*)["']`)).then((s) => m.importModule(s));
    const [i18nR, i18n, theme, toast, prefs, auth, ws, cerb] = await Promise.all(['react-i18next', '\\/modules\\/i18n', 'ThemeContext', 'ToastContext', 'UiPreferencesContext', '\\/modules\\/auth', 'WebSocketContext', '\\/modules\\/cerberus'].map(imp));
    const { HistoryView } = await m.importModule('/src/modules/cerberus/history/HistoryView.tsx');
    await m.mount('athena-host', h(i18nR.I18nextProvider, { i18n: i18n.i18n }, h(theme.ThemeProvider, null, h(toast.ToastProvider, null, h(prefs.UiPreferencesProvider, null, h(auth.AuthProvider, null, h(ws.WebSocketProvider, null, h(cerb.CerberusProvider, null, h('div', { style: { containerType: 'inline-size' } }, h(HistoryView))))))))), 'position:fixed;inset:0;z-index:2147483000;background:var(--canvas);overflow:auto');
  });
  await page.waitForSelector('.vv-timeline__row', { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Show earlier' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#athena-host .vv-timeline__row').length >= 80);
  world = all; // 60 newer lines (n0..n59) land before the next read: more than one page of them
  for (const s of sockets) { try { s.send(JSON.stringify({ kind: 'cerberus_changed', at: Date.now(), nodes: [], checks: [] })); } catch { /* a socket the app already closed */ } }
  await page.waitForTimeout(2000);
  const ids = (await page.locator('#athena-host .vv-timeline__title').allInnerTexts()).map((x) => Number(/^n(\d+)/.exec(x)?.[1]));
  const jumps = ids.flatMap((v, i) => (i > 0 && v !== ids[i - 1] + 1 ? [[ids[i - 1], v]] : []));
  console.log(`rows=${ids.length} first=n${ids[0]} last=n${ids[ids.length - 1]} jumps=${JSON.stringify(jumps)} showEarlierButton=${await page.getByRole('button', { name: 'Show earlier' }).count()}`);
} finally { await unmountReactHost(page, 'athena-host').catch(() => {}); await browser.close(); }
JS
cd /tmp && timeout 120 node "$(dirname "$0")/p.mjs" 2>&1 | tail -5
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -rf "$D" ;; esac
```

measured 2026-10-06 by chain chain-cerberus--tab--history-fill-20261006-153313-a521, finding M1, MEDIUM
probe-key: 091d0893afb49976ad8f0340f0ddeb3935582a1e

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/EventsCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/HistoryView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useActivityFeed.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-7059 — probe — a late good first page is thrown away by the newer read that failed (INV-7034's shape, third copy)

a late good first page is thrown away by the newer read that failed (INV-7034's shape, third copy)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cat > "$(dirname "$0")/p.mjs" <<'JS'
import { openConsole } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { installReactHarness, unmountReactHost } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/mountReact.mjs';
const { page, browser } = await openConsole({ viewport: { width: 1440, height: 900 } });
const sockets = [];
await page.routeWebSocket(/\/ws(\?|$)/, (ws) => { sockets.push(ws); ws.connectToServer(); });
await page.reload({ waitUntil: 'load' });
for (let i = 0; i < 100 && sockets.length === 0; i++) await page.waitForTimeout(100);
await page.waitForTimeout(1500);
let reads = 0;
await page.route('**/api/cerberus/activity?limit=40', async (route) => {
  reads += 1;
  if (reads === 1) { await new Promise((r) => setTimeout(r, 2500)); return route.continue(); } // the first read answers, late and good
  return route.fulfill({ status: 502, contentType: 'text/html', body: '<html>bad gateway</html>' }); // the read a frame starts answers 502
});
try {
  await installReactHarness(page);
  await page.evaluate(async () => {
    const m = window.__mountReact; const h = m.h;
    const imp = (re) => m.readSpecifier('/src/App.tsx', new RegExp(`from\\s+["']([^"']*${re}[^"']*)["']`)).then((s) => m.importModule(s));
    const [i18nR, i18n, theme, toast, prefs, auth, ws, cerb] = await Promise.all(['react-i18next', '\\/modules\\/i18n', 'ThemeContext', 'ToastContext', 'UiPreferencesContext', '\\/modules\\/auth', 'WebSocketContext', '\\/modules\\/cerberus'].map(imp));
    const { HistoryView } = await m.importModule('/src/modules/cerberus/history/HistoryView.tsx');
    await m.mount('athena-host', h(i18nR.I18nextProvider, { i18n: i18n.i18n }, h(theme.ThemeProvider, null, h(toast.ToastProvider, null, h(prefs.UiPreferencesProvider, null, h(auth.AuthProvider, null, h(ws.WebSocketProvider, null, h(cerb.CerberusProvider, null, h('div', { style: { containerType: 'inline-size' } }, h(HistoryView))))))))), 'position:fixed;inset:0;z-index:2147483000;background:var(--canvas);overflow:auto');
  });
  await page.waitForTimeout(1000);
  for (const s of sockets) { try { s.send(JSON.stringify({ kind: 'cerberus_changed', at: Date.now(), nodes: [], checks: [] })); } catch { /* a socket the app already closed */ } }
  await page.waitForTimeout(4500);
  const rows = await page.locator('#athena-host .vv-timeline__row').count();
  const alerts = await page.locator('#athena-host [role=alert]').count();
  console.log(`activity reads=${reads} rows=${rows} banners=${alerts}`);
} finally { await unmountReactHost(page, 'athena-host').catch(() => {}); await browser.close(); }
JS
cd /tmp && timeout 120 node "$(dirname "$0")/p.mjs" 2>&1 | tail -5
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -rf "$D" ;; esac
```

measured 2026-10-06 by chain chain-cerberus--tab--history-fill-20261006-153313-a521, finding L1, LOW
probe-key: 6365f4409090094bc538f737156badc5710e0135

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/EventsCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/HistoryView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useActivityFeed.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-7060 — probe — frames are not coalesced: 50 frames cost 50 feed reads (the provider's own gap is 1/s)

frames are not coalesced: 50 frames cost 50 feed reads (the provider's own gap is 1/s)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cat > "$(dirname "$0")/p.mjs" <<'JS'
import { openConsole } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { installReactHarness, unmountReactHost } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/mountReact.mjs';
const { page, browser } = await openConsole({ viewport: { width: 1440, height: 900 } });
const sockets = [];
await page.routeWebSocket(/\/ws(\?|$)/, (ws) => { sockets.push(ws); ws.connectToServer(); });
await page.reload({ waitUntil: 'load' });
for (let i = 0; i < 100 && sockets.length === 0; i++) await page.waitForTimeout(100);
await page.waitForTimeout(1500);
const seen = [];
page.on('request', (r) => { const u = r.url(); if (u.includes('/api/cerberus/activity')) seen.push('activity'); else if (u.includes('/api/cerberus/overview')) seen.push('overview'); });
try {
  await installReactHarness(page);
  await page.evaluate(async () => {
    const m = window.__mountReact; const h = m.h;
    const imp = (re) => m.readSpecifier('/src/App.tsx', new RegExp(`from\\s+["']([^"']*${re}[^"']*)["']`)).then((s) => m.importModule(s));
    const [i18nR, i18n, theme, toast, prefs, auth, ws, cerb] = await Promise.all(['react-i18next', '\\/modules\\/i18n', 'ThemeContext', 'ToastContext', 'UiPreferencesContext', '\\/modules\\/auth', 'WebSocketContext', '\\/modules\\/cerberus'].map(imp));
    const { HistoryView } = await m.importModule('/src/modules/cerberus/history/HistoryView.tsx');
    await m.mount('athena-host', h(i18nR.I18nextProvider, { i18n: i18n.i18n }, h(theme.ThemeProvider, null, h(toast.ToastProvider, null, h(prefs.UiPreferencesProvider, null, h(auth.AuthProvider, null, h(ws.WebSocketProvider, null, h(cerb.CerberusProvider, null, h('div', { style: { containerType: 'inline-size' } }, h(HistoryView))))))))), 'position:fixed;inset:0;z-index:2147483000;background:var(--canvas);overflow:auto');
  });
  await page.waitForSelector('.vv-timeline__row', { timeout: 20000 });
  await page.waitForTimeout(1500);
  seen.length = 0;
  for (let i = 0; i < 50; i++) { // 50 frames in 2 s: a flapping node's burst
    for (const s of sockets) { try { s.send(JSON.stringify({ kind: 'cerberus_changed', at: Date.now(), nodes: ['eis1'], checks: [] })); } catch { /* a socket the app already closed */ } }
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(5000);
  console.log(`50 frames in 2 s -> activity reads=${seen.filter((x) => x === 'activity').length} overview reads=${seen.filter((x) => x === 'overview').length}`);
} finally { await unmountReactHost(page, 'athena-host').catch(() => {}); await browser.close(); }
JS
cd /tmp && timeout 120 node "$(dirname "$0")/p.mjs" 2>&1 | tail -5
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -rf "$D" ;; esac
```

measured 2026-10-06 by chain chain-cerberus--tab--history-fill-20261006-153313-a521, finding L2, LOW
probe-key: 9db26f5dfafdef7ae7fb3f67ef90503e0074c767

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/EventsCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/HistoryView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useActivityFeed.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-7061 — probe — the opening look-up is the BROWSER's now, so a browser clock ahead of center's opens on "That hasn't happened yet."

the opening look-up is the BROWSER's now, so a browser clock ahead of center's opens on "That hasn't happened yet."

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cat > "$(dirname "$0")/p.mjs" <<'JS'
import { openConsole } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { installReactHarness, unmountReactHost } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/mountReact.mjs';
const { page, browser } = await openConsole({ viewport: { width: 1440, height: 900 } });
const sentence = async () => ((await page.locator('#athena-host [aria-live=polite]').first().innerText()).split('\n').find((l) => /(At .*it was|That hasn't|No result)/.test(l)) ?? '(none)');
await page.clock.setFixedTime(Date.now() + 3000); // this browser's clock runs 3 s ahead of center's
try {
  await installReactHarness(page);
  await page.evaluate(async () => {
    const m = window.__mountReact; const h = m.h;
    const imp = (re) => m.readSpecifier('/src/App.tsx', new RegExp(`from\\s+["']([^"']*${re}[^"']*)["']`)).then((s) => m.importModule(s));
    const [i18nR, i18n, theme, toast, prefs, auth, ws, cerb] = await Promise.all(['react-i18next', '\\/modules\\/i18n', 'ThemeContext', 'ToastContext', 'UiPreferencesContext', '\\/modules\\/auth', 'WebSocketContext', '\\/modules\\/cerberus'].map(imp));
    const { HistoryView } = await m.importModule('/src/modules/cerberus/history/HistoryView.tsx');
    await m.mount('athena-host', h(i18nR.I18nextProvider, { i18n: i18n.i18n }, h(theme.ThemeProvider, null, h(toast.ToastProvider, null, h(prefs.UiPreferencesProvider, null, h(auth.AuthProvider, null, h(ws.WebSocketProvider, null, h(cerb.CerberusProvider, null, h('div', { style: { containerType: 'inline-size' } }, h(HistoryView))))))))), 'position:fixed;inset:0;z-index:2147483000;background:var(--canvas);overflow:auto');
  });
  await page.waitForSelector('.vv-timeline__row', { timeout: 20000 });
  await page.waitForFunction(() => /(At .*it was|That hasn't|No result)/.test(document.querySelector('#athena-host [aria-live="polite"]')?.innerText ?? ''), null, { timeout: 20000 });
  console.log(`browser clock 3 s ahead of center -> opening sentence: ${await sentence()}`);
} finally { await unmountReactHost(page, 'athena-host').catch(() => {}); await browser.close(); }
JS
cd /tmp && timeout 120 node "$(dirname "$0")/p.mjs" 2>&1 | tail -5
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -rf "$D" ;; esac
```

measured 2026-10-06 by chain chain-cerberus--tab--history-fill-20261006-153313-a521, finding L3, LOW
probe-key: e67504a9adaf107cc33cd800a7285b6c7081a857

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/EventsCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/history/HistoryView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useActivityFeed.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-7062 — A chat's soul list leaves out the dispatcher's own work — the mark decides, two restated launcher rules bridge the launches written before it

The stamp `launched_by` is the chat an epic was STARTED from, and the dispatcher runs every soul of the epic under it, so a chat's own list cannot tell an epic's soul from one the chat launched. `isDispatcherWork` (`dispatch-souls/dispatcher-work.service.ts`) is the one answer, asked by BOTH ways a chat pins a launch by its stamp: `collectStampedSoulLaunches` (latest page, before its 40-launch cap) and the lane's `dispatcher_work` flag that `readStampedLaunchIds` skips. A third reader asks it too: the sidebar's purple dot (`running-launchers.service.ts`, both its soul and its chain reading), so a chat that only started an epic lights nothing for the epic's souls; the file-ownership rail is the one reader that still takes `launched_by` as written.

| Reading | Where it is decided | Source it restates | Breaks if it drifts |
|---|---|---|---|
| THE MARK: `spec.json` `dispatcher` is a record with a non-empty string `plan` | `carriesMark` | `hooks/plan_runner/solo/dispatch_mark.py` (`mark`; the two env names are `souls.DISPATCHER_WORK_ENV`, also in `SCRUB_ENV`) | A reader that also demands a non-null `phase` hides no planner (a planner's phase is null); a launcher that writes the mark under another key leaves every new epic soul in the chat's list. |
| A chain whose `chain.json` says `until_pass: true` is the dispatcher's, and so is each of its stages | `readDispatcherChainLaunchIds` | `plan-runner chain --until-pass` (INV-169): the mode the dispatcher walks a phase's chain in | Measured 2026-10-06: 447 chains carry it, 447 chains are named by `phases.chain_id`, the same ones. NOT EXACT: `cases cure` (`hooks/cases/cure.py:argv_for`, slug `cure-<case>-<stamp>`) walks in the same mode with no mark and no `phases` row, so while the bridge lasts a cure walk's stages, and a hand-run `--until-pass` chain's, are hidden from the chat that started it and light no dot (no cure walk existed on disk on 2026-10-06). Exact would be `phases.chain_id`, which needs the server to read the dispatcher's SQLite. |
| A launch with `role: planner` is the dispatcher's | `isDispatcherWork` | `solo/launch.py:prepare` admits `planner` in the daemon's process only; `cmd/soul.py` keeps it off the public verb | Measured the same day: the 50 launches `planners.launch_id` names on disk are exactly the launches wearing the role. A public door that admits it would hide a hand's planner launch. |

- WHO WRITES THE MARK: `phase_chain.launch_env` overlays the plan and phase on the environment of every chain it starts or resumes, and each stage's `prepare` reads them back (the walker is forked from that environment); `planners._start` passes the mark to `prepare` directly. A dispatcher daemon or a walker started before the marking build writes unmarked specs, which the two bridge readings above still recognise.
- THE TWO BRIDGE READINGS ARE DELETED WITH THEIR LAST LAUNCH: a launch directory is kept 14 days (`solo/record.py:KEEP_DAYS`), so once the daemon and every walker run the marking build and a fortnight has passed, only the mark clause is needed — remove `readDispatcherChainLaunchIds` (and its one call in `listRunningLaunchers`, with the index argument of the dot's two readings), the `role` clause, `chain-record.transport.ts`'s `untilPass` and the chain-index argument of `classifyLaunch` and `isDispatcherWork`.
- The filter runs BEFORE the 40-launch cap on a latest page, so an epic's launches cannot push the chat's own out of it.
- The reader opens only the newest 200 launch directories (`MAX_SPECS_READ`), so a chat's hand launches older than that window were never in its list.
- Proof: `cd /home/lyphe/.claude/claudecodeui_lyphe && TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx .verify/probe-subagent-epic-work.mjs` — the HEAD reader and the current one for the chat an epic was started from and for one that launched souls by hand, against the dispatcher's own database as ground truth.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/chain-record.transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/dispatcher-work.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/soul-launch.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/session-soul-launches.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/utils/soulLaunchAnchors.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-subagent-epic-work.mjs, /home/lyphe/.claude/hooks/dispatcher/phase_chain.py, /home/lyphe/.claude/hooks/dispatcher/planners.py, /home/lyphe/.claude/hooks/plan_runner/solo/dispatch_mark.py, /home/lyphe/.claude/hooks/plan_runner/solo/launch.py, /home/lyphe/.claude/hooks/plan_runner/solo/record.py, /home/lyphe/.claude/hooks/plan_runner/souls.py

## INV-7063 — probe — `lowerFirst` lowers the first letter of CamelCase brand names, and five real labels have one

`lowerFirst` lowers the first letter of CamelCase brand names, and five real labels have one

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
SRC=/home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/MuteDialog.tsx
sqlite3 -readonly ~/.cloudcli/cerberus.db "select label from checks where label is not null and retired_at is null" | SRC="$SRC" node -e '
const fs = require("fs");
const src = fs.readFileSync(process.env.SRC, "utf8");
const m = src.match(/function lowerFirst[\s\S]*?\.test\(label\)/);
const lit = m && m[0].match(/\/(\^[^\n]*?)\/u\.test/);
if (!lit) { console.log("lowerFirst rule not found in source (cured or moved)"); process.exit(0); }
const re = new RegExp(lit[1], "u");
const lower = (l) => (re.test(l) ? l.charAt(0).toLowerCase() + l.slice(1) : l);
let bad = 0;
for (const l of fs.readFileSync(0, "utf8").split("\n").filter(Boolean)) {
  const first = l.split(/\s+/)[0];
  if (lower(l) !== l && /\p{Lu}/u.test(first.slice(1))) { bad += 1; console.log("mangled:", JSON.stringify(lower(l))); }
}
console.log("rule", re.source, "| camel-cased first words lowered:", bad);
'
EOF
bash "$D/p.sh"
```

measured 2026-10-06 by chain chain-cerberus--tab--dialogs-fill-20261006-162733-4f4a, finding L1, LOW
probe-key: 86bc40543e9fc7620876780a03080fdb2bdb1c67

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useEnrollmentStatus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/MuteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/enrollAsk.ts

## INV-7064 — probe — A refused press drops keyboard focus to `<body>` in both dialogs (a gap the manual already lists as Open)

A refused press drops keyboard focus to `<body>` in both dialogs (a gap the manual already lists as Open)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
M=/home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals
grep -n 'type="submit"' "$M/MuteDialog.tsx" "$M/EnrollDialog.tsx" | cut -c1-210
EOF
bash "$D/p.sh"
```

measured 2026-10-06 by chain chain-cerberus--tab--dialogs-fill-20261006-162733-4f4a, finding L2, LOW
probe-key: 18780930707c64fcf20f6ab60da295d3952bda07

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollDialog.tsx

## INV-7065 — probe — A second Copy while "✓ Copied" is showing does not restart the two seconds

A second Copy while "✓ Copied" is showing does not restart the two seconds

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
F=/home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollDialog.tsx
grep -n -A4 "if (!copied) return undefined" "$F" | grep -E "\}, \[" || echo "no copied-hold effect found"
grep -n "if (landed) setCopied" "$F" || echo "no setCopied-on-landed line"
EOF
bash "$D/p.sh"
```

measured 2026-10-06 by chain chain-cerberus--tab--dialogs-fill-20261006-162733-4f4a, finding L3, LOW
probe-key: 41c61e377b15cbd3195dfeda4e1756fed29409a6

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollDialog.tsx

## INV-7068 — probe — "Until 08:00" posts a time the server refuses for one hour a year, and the manual puts that hour on the wrong side of the change

"Until 08:00" posts a time the server refuses for one hour a year, and the manual puts that hour on the wrong side of the change

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
F=/home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/MuteDialog.tsx
TZ=America/Los_Angeles F="$F" node -e '
const fs = require("fs");
const src = fs.readFileSync(process.env.F, "utf8");
const fn = src.match(/function liftsAt[\s\S]*?\n}\n/);
if (!fn) { console.log("liftsAt not found (moved or cured)"); process.exit(0); }
const body = fn[0].replace(/\(choice: CerberusMuteDuration, from: number\): number/, "(choice, from)");
const MORNING_HOUR = 8; const SPAN_MS = { min15: 9e5, hour1: 36e5, hours4: 144e5 };
eval(body + ";globalThis.liftsAt = liftsAt");
const from = new Date(2026, 9, 31, 8, 30).getTime();
console.log("Until 08:00 pressed at 08:30 on 2026-10-31 lifts", (liftsAt("morning", from) - from) / 36e5, "h ahead (server cap: 24 h)");
'
grep -n "86_400_000\|24 \* 60 \* MINUTE_MS\|DAY_MS\|MAX_MUTE" "$F" || echo "no 24 h clamp in the dialog"
EOF
bash "$D/p.sh"
```

measured 2026-10-06 by chain chain-cerberus--tab--dialogs-fill-20261006-162733-4f4a, finding L6, LOW
probe-key: 528c96305b04e24664a3a31324052b9bca766d5a

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useEnrollmentStatus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/MuteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/enrollAsk.ts

## INV-7069 — probe — The report's evidence: no `diff -u`, an `until` table that is not the dialog's, and "two tokens"

The report's evidence: no `diff -u`, an `until` table that is not the dialog's, and "two tokens"

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
FX=/tmp/cerberus-dialogs-fill-fixture
grep -n "expectedUntil(duration, openedAt)\|iso(expected)" "$FX/fixture.mjs" | head -3 | cut -c1-150
printf 'page.route calls on the mutes path in the fixture: '; grep -n "page.route" "$FX/fixture.mjs" | grep -ci "mutes"
printf 'node-2 rows in enroll_tokens (report says two): '; sqlite3 -readonly ~/.cloudcli/cerberus.db "select count(*) from enroll_tokens where name = 'node-2'"
EOF
bash "$D/p.sh"
```

measured 2026-10-06 by chain chain-cerberus--tab--dialogs-fill-20261006-162733-4f4a, finding L7, LOW
probe-key: 3df5648250a681ee0247107d6d8ba52240c4eb3f

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/hooks/useEnrollmentStatus.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/MuteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/utils/enrollAsk.ts

## INV-7070 — probe — LOW — A gutter widget whose roadmap changes while it is hidden opens on the left edge, not on the current milestone

LOW — A gutter widget whose roadmap changes while it is hidden opens on the left edge, not on the current milestone

```probe
D=$(mktemp -d /tmp/athena-fprobe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'OUTER'
#!/bin/bash
D=$(mktemp -d /tmp/athena-hidden.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'EOF'
import { openConsole } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { hideSidebar, WIDE } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-page.mjs';
import { HARNESS_PREFERENCES } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/prefs-pin.mjs';
const c = await openConsole({ viewport: WIDE, preferences: { ...HARNESS_PREFERENCES, roadmapSelected: 'restorly' } });
const page = c.page;
await page.context().route(/\/api\/(roadmap|dispatcher|user\/preferences)(\/|$|\?)/, (route) => route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"success":true}' }));
const read = () => {
  const w = document.querySelector('[data-roadmap-widget]');
  const pane = w?.querySelector('[data-roadmap-tree]');
  const ring = w?.querySelector('[aria-current="step"]')?.firstElementChild;
  if (!pane || !ring) return null;
  const p = pane.getBoundingClientRect(); const r = ring.getBoundingClientRect(); const x = r.left + r.width / 2;
  return { roadmap: w.querySelector('[data-roadmap-header]').getAttribute('data-roadmap-header'), ringInsidePane: x >= p.left && x <= p.right, scrollLeft: Math.round(pane.scrollLeft) };
};
try {
  await hideSidebar(page);
  await page.locator('[data-roadmap-widget-open]').click();
  await page.waitForSelector('[data-roadmap-tab] [data-roadmap-milestone]', { timeout: 20000 });
  await page.waitForTimeout(1500);
  console.log('headers while the Roadmap tab is open:', await page.evaluate(() => document.querySelectorAll('[data-roadmap-header]').length));
  await page.locator('[data-roadmap-face] [data-roadmap-header] [aria-haspopup="listbox"]').click();
  await page.locator('[role="option"]', { hasText: /^lyphecli$/ }).click();
  await page.waitForTimeout(1200);
  await page.keyboard.press('Control+k'); await page.waitForTimeout(500);
  await page.keyboard.type('chat'); await page.waitForTimeout(400);
  await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  console.log('gutter widget after returning to chat:', JSON.stringify(await page.evaluate(read)));
} catch (e) { console.log('probe could not run:', e.message.split('\n')[0]); }
await c.browser.close();
EOF
( cd "$D" && node p.mjs 2>&1 | tail -4 )
case "$D" in /tmp/athena-hidden.*) rm -rf -- "$D";; esac
OUTER
bash "$D/p.sh"
expect: the second line reads {"roadmap":"lyphecli","ringInsidePane":true,...} once the opening runs when the pane gains a width; while the defect stands it reads {"roadmap":"lyphecli","ringInsidePane":false,"scrollLeft":0}
```

measured 2026-10-06 by chain chain-roadmap-tree-view--face-20261006-153849-ee8f, finding L1, LOW
probe-key: 2413c5094f06dd144ffdab5d71ab4ac2b173ae2a

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useRevealCard.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useTreeRoom.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapTreeFace.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapWidgetBody.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/UnplacedBanner.tsx

## INV-7071 — probe — LOW — The column fit's picker row carries `data-roadmap-header`, so two exist whenever the gutter and the Roadmap tab are both mounted

LOW — The column fit's picker row carries `data-roadmap-header`, so two exist whenever the gutter and the Roadmap tab are both mounted

```probe
D=$(mktemp -d /tmp/athena-fprobe2.XXXXXX) || exit 1
cat > "$D/p.sh" <<'OUTER'
#!/bin/bash
D=$(mktemp -d /tmp/athena-headers.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'EOF'
import { openConsole } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { hideSidebar, WIDE } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/roadmap-page.mjs';
const c = await openConsole({ viewport: WIDE });
const page = c.page;
await page.context().route(/\/api\/(roadmap|dispatcher|user\/preferences)(\/|$|\?)/, (route) => route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"success":true}' }));
try {
  await hideSidebar(page);
  await page.locator('[data-roadmap-widget-open]').click();
  await page.waitForSelector('[data-roadmap-tab] [data-roadmap-milestone]', { timeout: 20000 });
  await page.waitForTimeout(1500);
  console.log('headers with the gutter widget and the Roadmap tab both mounted:', await page.evaluate(() => document.querySelectorAll('[data-roadmap-header]').length));
} catch (e) { console.log('probe could not run:', e.message.split('\n')[0]); }
await c.browser.close();
EOF
( cd "$D" && node p.mjs 2>&1 | tail -3 )
case "$D" in /tmp/athena-headers.*) rm -rf -- "$D";; esac
OUTER
bash "$D/p.sh"
expect: the line ends in 1 once only one fit draws the attribute; it ends in 2 while the column fit draws it too
```

measured 2026-10-06 by chain chain-roadmap-tree-view--face-20261006-153849-ee8f, finding L2, LOW
probe-key: fecf7a9434d39a6d28e522549ac0a6949544a170

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useRevealCard.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useTreeRoom.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapTreeFace.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/RoadmapWidgetBody.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/UnplacedBanner.tsx

## INV-7072 — probe — LOW: a node the filter leaves out stays selected and its panel returns when the filter clears; Iris's comment says the filter "closes it"

LOW: a node the filter leaves out stays selected and its panel returns when the filter clears; Iris's comment says the filter "closes it"

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/cerberus--tab--rings-fill/probes/p1-ghost-selection.sh
expect: the line `filter All again …` prints `"pressed":["syn-4"]` (defect stands); `"pressed":[]` once the selection is cleared with the filter, or the comment says it waits and returns
```

measured 2026-10-06 by chain chain-cerberus--tab--rings-fill-20261006-171705-2df9, finding L1, LOW
probe-key: 7948c50366329bf844d8e591393928626ff75063

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetRings.tsx

## INV-7073 — probe — LOW: `fakeRingsLayout` has no reader left but is still exported, with a docblock that says FleetRings draws it

LOW: `fakeRingsLayout` has no reader left but is still exported, with a docblock that says FleetRings draws it

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/cerberus--tab--rings-fill/probes/p2-dead-fake-rings.sh
expect: `readers: 0` with the `export const fakeRingsLayout` line and the "draws until its fill lays them out" docblock line both still printing (defect stands); `export gone` / `docblock gone` once purged
```

measured 2026-10-06 by chain chain-cerberus--tab--rings-fill-20261006-171705-2df9, finding L2, LOW
probe-key: 8e7bb65012a45c14a01e1d17c8000cacec22fb1f

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/fleet/FleetRings.tsx

## INV-7074 — probe — MEDIUM — eleven live probe rows still pin a reproducer that dies on a piece this build removed; one is a live HIGH

MEDIUM — eleven live probe rows still pin a reproducer that dies on a piece this build removed; one is a live HIGH

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/roadmap-tree-view--docs/probes/dead-probe-rows.sh
expect: eleven lines `INV-…: dead` (INV-6620 6621 6623 6626 6644 6645 6678 6680 6681 6996 7057) while the defect stands; a row retired or re-pointed reads `alive` or `script-gone` (the script walks each probe's own file, unfiltered, one at a time — about two minutes; run in parallel the browser probes collide and read alive)
```

measured 2026-10-06 by chain chain-roadmap-tree-view--docs-20261006-172418-9d84, finding M1, MEDIUM
probe-key: 42ed6ac892d10ebc4ebfa95a6eab7b79424d5feb

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/hooks/useStepPhrase.ts

## INV-7075 — On a phone, a container that scrolls both ways loses its sideways swipe to the mobile pan-y rule

Symptom: the roadmap tree cannot be swiped sideways on a phone, while the same swipe works on a desktop and in a phone-sized landscape window.

Cause: `src/index.css` at `max-width: 768px` sets `touch-action: pan-y` on `.overflow-y-auto`. The tree's pane (`[data-roadmap-tree]`, `RoadmapTree.tsx`) is `overflow-x-auto` always and gains `overflow-y-auto` once the drawing is floored at 0.6 scale, which a phone's height does. `pan-y` then forbids the sideways pan. Measured 2026-10-06 at 390×660: a CDP touch swipe moved `scrollLeft` 179 → 179 of 386 before the cure and 179 → 386 after.

Cure: the rule reads `.overflow-y-auto:not(.overflow-x-auto)`, so a container that scrolls sideways as well keeps both axes; the second copy of the same rule lower in the block was removed.

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -c 'overflow-y-auto:not(.overflow-x-auto)' src/index.css && grep -cE '^\s*\.overflow-y-auto\s*\{' src/index.css || true
expect: 1 then 0 — the narrowed rule is present once and the bare `.overflow-y-auto {` rule is gone; a 0 then 1 means the blanket rule is back and the tree's sideways swipe is dead on phones again
```

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/index.css, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/roadmap/tree/RoadmapTree.tsx

## INV-7083 — probe — MEDIUM — a late older signed `catalog.set` replaces the held catalog and is acked: a retired command runs again

MEDIUM — a late older signed `catalog.set` replaces the held catalog and is acked: a retired command runs again

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOP'
D=$(dirname "$0")
cat > "$D/p.mjs" <<'EOJ'
const R = '/home/lyphe/.claude/claudecodeui_lyphe/warden/src/', dir = process.argv[2];
const { createCatalog } = await import(R + 'catalog.mjs'), { createRunner } = await import(R + 'runner.mjs'), fs = await import('node:fs');
const handlers = new Map(), sent = [];
const link = { on: (t, f) => handlers.set(t, [...(handlers.get(t) ?? []), f]), send: (t, b) => { sent.push({ t, b }); return { seq: 1, sent: true }; } };
const catalog = createCatalog({ link }); createRunner({ link, catalog, home: dir });
const deliver = (t, b) => Promise.all((handlers.get(t) ?? []).map((f) => f(b)));
await deliver('catalog.set', { version: 5, entries: [{ id: 'echo', cmd: 'echo hi', timeout: 5 }], oneOffs: [] });
const mark = dir + '/retired-ran', old = 'touch ' + mark;
await deliver('catalog.set', { version: 3, entries: [{ id: 'old', cmd: old, timeout: 5 }], oneOffs: [] });
await deliver('run.start', { runId: 'v3', catalogVersion: 3, entryId: 'old', proposalId: null, cmd: old, timeout: 5, by: 'you' });
await new Promise((r) => setTimeout(r, 600));
console.log('held version:', catalog.version, '| acks sent:', JSON.stringify(sent.filter((s) => s.t === 'catalog.ack').map((s) => s.b.version)), '| retired v3 command ran:', fs.existsSync(mark));
process.exit(0);
EOJ
node "$D/p.mjs" "$D" 2>&1 | grep -v '^\[warden\]'
EOP
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: `held version: 3 | acks sent: [5,3] | retired v3 command ran: true` while the defect stands; cured reads `held version: 5 | acks sent: [5] | retired v3 command ran: false`
```

measured 2026-10-06 by chain chain-cerberus--fixes--warden-runner-20261006-205329-df76, finding M1, MEDIUM
probe-key: 0a47849076ce1d986cc5b0b1a4207a56d1fb607e

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-catalog-runner.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/catalog.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/run-lines.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/runner.mjs

## INV-7084 — probe — MEDIUM — a run id is remembered only while it runs: the same signed `run.start` delivered again after the run ended starts another child

MEDIUM — a run id is remembered only while it runs: the same signed `run.start` delivered again after the run ended starts another child

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOP'
D=$(dirname "$0")
cat > "$D/p.mjs" <<'EOJ'
const R = '/home/lyphe/.claude/claudecodeui_lyphe/warden/src/', dir = process.argv[2];
const { createCatalog } = await import(R + 'catalog.mjs'), { createRunner } = await import(R + 'runner.mjs'), fs = await import('node:fs');
const handlers = new Map(), sent = [];
const link = { on: (t, f) => handlers.set(t, [...(handlers.get(t) ?? []), f]), send: (t, b) => { sent.push({ t, b }); return { seq: 1, sent: true }; } };
const catalog = createCatalog({ link }); createRunner({ link, catalog, home: dir });
const deliver = (t, b) => Promise.all((handlers.get(t) ?? []).map((f) => f(b)));
const count = dir + '/count', cmd = `echo x >> ${count}`;
await deliver('catalog.set', { version: 1, entries: [{ id: 'cnt', cmd, timeout: 5 }], oneOffs: [] });
for (let i = 0; i < 3; i++) { await deliver('run.start', { runId: 'same', catalogVersion: 1, entryId: 'cnt', proposalId: null, cmd, timeout: 5, by: 'auto' }); await new Promise((r) => setTimeout(r, 500)); }
console.log('one runId delivered 3 times, each after the last ended → child starts:', fs.readFileSync(count, 'utf8').trim().split('\n').length, '| run.accepted frames:', sent.filter((s) => s.t === 'run.accepted').length);
process.exit(0);
EOJ
node "$D/p.mjs" "$D" 2>&1 | grep -v '^\[warden\]'
EOP
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: `child starts: 3 | run.accepted frames: 3` while the defect stands; cured reads `child starts: 1 | run.accepted frames: 1`
```

measured 2026-10-06 by chain chain-cerberus--fixes--warden-runner-20261006-205329-df76, finding M2, MEDIUM
probe-key: 76b4be07af6d44d03e6f45ca698533dc6639497b

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-catalog-runner.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/catalog.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/run-lines.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/runner.mjs

## INV-7085 — probe — LOW — a command that finished in time is called `timed_out` when a background child still holds its pipes

LOW — a command that finished in time is called `timed_out` when a background child still holds its pipes

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOP'
D=$(dirname "$0")
cat > "$D/p.mjs" <<'EOJ'
const R = '/home/lyphe/.claude/claudecodeui_lyphe/warden/src/', dir = process.argv[2];
const { createCatalog } = await import(R + 'catalog.mjs'), { createRunner } = await import(R + 'runner.mjs');
const handlers = new Map(), sent = [];
const link = { on: (t, f) => handlers.set(t, [...(handlers.get(t) ?? []), f]), send: (t, b) => { sent.push({ t, b }); return { seq: 1, sent: true }; } };
const catalog = createCatalog({ link }); createRunner({ link, catalog, home: dir });
const deliver = (t, b) => Promise.all((handlers.get(t) ?? []).map((f) => f(b)));
const cmd = '(sleep 3) & sleep 0.9; echo finished';
await deliver('catalog.set', { version: 1, entries: [{ id: 'e', cmd, timeout: 1 }], oneOffs: [] });
await deliver('run.start', { runId: 'r', catalogVersion: 1, entryId: 'e', proposalId: null, cmd, timeout: 1, by: 'you' });
await new Promise((r) => setTimeout(r, 3500));
const end = sent.find((s) => s.t === 'run.end')?.b;
console.log('shell exited 0 at 0.9 s of a 1 s timeout, a background child still holding the pipes → result:', end?.result ?? 'no run.end', '| exit:', end?.exit ?? 'none');
process.exit(0);
EOJ
node "$D/p.mjs" "$D" 2>&1 | grep -v '^\[warden\]'
EOP
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: `result: timed_out | exit: 0` while the defect stands; cured reads `result: ok | exit: 0`
```

measured 2026-10-06 by chain chain-cerberus--fixes--warden-runner-20261006-205329-df76, finding L1, LOW
probe-key: f1859ae990f9a92882016cd6b301a39bc2cc8b42

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-catalog-runner.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/catalog.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/run-lines.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/runner.mjs

## INV-7086 — probe — LOW — before any catalog, `catalogVersion: null` passes the version check and the sentence reads "catalog vnull"

LOW — before any catalog, `catalogVersion: null` passes the version check and the sentence reads "catalog vnull"

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOP'
D=$(dirname "$0")
cat > "$D/p.mjs" <<'EOJ'
const R = '/home/lyphe/.claude/claudecodeui_lyphe/warden/src/', dir = process.argv[2];
const { createCatalog } = await import(R + 'catalog.mjs'), { createRunner } = await import(R + 'runner.mjs');
const handlers = new Map(), sent = [];
const link = { on: (t, f) => handlers.set(t, [...(handlers.get(t) ?? []), f]), send: (t, b) => { sent.push({ t, b }); return { seq: 1, sent: true }; } };
const catalog = createCatalog({ link }); createRunner({ link, catalog, home: dir });
for (const f of handlers.get('run.start')) await f({ runId: 'pre', catalogVersion: null, entryId: 'echo', proposalId: null, cmd: 'echo hi', timeout: 5, by: 'you' });
console.log('run.start naming catalogVersion null, before any catalog.set →', sent.find((s) => s.t === 'run.refused')?.b.reason ?? 'no refusal');
process.exit(0);
EOJ
node "$D/p.mjs" "$D" 2>&1 | grep -v '^\[warden\]'
EOP
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: `→ No entry 'echo' in catalog vnull` while the defect stands; cured reads `→ Catalog version null is not the one this warden acked (none)`
```

measured 2026-10-06 by chain chain-cerberus--fixes--warden-runner-20261006-205329-df76, finding L2, LOW
probe-key: a5d4fa5331fef3d93ec554defec9c89e05862172

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-catalog-runner.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/catalog.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/run-lines.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/runner.mjs

## INV-7087 — probe — LOW — the proof script's "changed command" is `rm -rf /`, run from the operator's real home

LOW — the proof script's "changed command" is `rm -rf /`, run from the operator's real home

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n 'rm -rf' .verify/warden-catalog-runner.mjs || echo "no rm -rf in the proof script"
expect: `55:await deliver('run.start', start('r-command', { entryId: 'echo', cmd: ...; rm -rf /...` while it stands; cured reads `no rm -rf in the proof script`
```

measured 2026-10-06 by chain chain-cerberus--fixes--warden-runner-20261006-205329-df76, finding L3, LOW
probe-key: aa375554c87274db9c1385b7b23193164ec8beb3

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-catalog-runner.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/catalog.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/run-lines.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/runner.mjs

## INV-7088 — probe — LOW — `.verify/probe-cerberus-open-race.mjs` now FAILs on a correct build, because it pins a literal `user_version=1`

LOW — `.verify/probe-cerberus-open-race.mjs` now FAILs on a correct build, because it pins a literal `user_version=1`

```probe
P=$(mktemp /tmp/athena-p.XXXXXX) || exit 1
cat > "$P" <<'EOF'
S=$(mktemp -d /tmp/cerberus-race.XXXXXX) || exit 1
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
CERBERUS_DB_PATH="$S/cerberus.db" DATABASE_PATH="$S/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 170 node --import tsx .verify/probe-cerberus-open-race.mjs 2>&1 | grep -E "^REAL"
grep -n "user_version=1'" .verify/probe-cerberus-open-race.mjs || echo "pin: derived, no literal"
cd /tmp && case "$S" in /tmp/cerberus-race.*) rm -rf "$S";; esac
EOF
bash "$P"; rm -f "$P"
```

measured 2026-10-06 by chain chain-cerberus--fixes--store-20261006-205329-d176, finding L2, LOW
probe-key: d3f02407e7e69ccf03d780149a2507b1c55b74ef

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-cerberus-open-race.mjs

## INV-7091 — probe — LOW — `prettier --check` fails on `server/shared/cerberus-types.ts` (the contract's own formatting rule)

LOW — `prettier --check` fails on `server/shared/cerberus-types.ts` (the contract's own formatting rule)

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && npx prettier --single-quote --print-width 100 --check server/shared/cerberus-types.ts src/shared/cerberus-types.ts 2>&1 | tail -3; echo "rc=${PIPESTATUS[0]}"
```

measured 2026-10-06 by chain chain-cerberus--fixes--contract-20261006-205328-d4ab, finding L1, LOW
probe-key: fd2cfa2d647d1a029ef13d0fdfa6fdfb30c3b36b

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts

## INV-7097 — probe — a host `out` line over center's 8 MiB frame cap is forwarded whole; center closes the link, the warden redials, center re-attaches and replays the same line — a permanent flap that blinds the node

a host `out` line over center's 8 MiB frame cap is forwarded whole; center closes the link, the warden redials, center re-attaches and replays the same line — a permanent flap that blinds the node

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) && cat > "$D/p.sh" <<'EOF'
#!/usr/bin/env bash
# A host `out` line over the center gateway's per-frame cap is forwarded whole by sessions.mjs (no refusal, no chunking).
set -u
REPO=/home/lyphe/.claude/claudecodeui_lyphe
if tmux -L cerberus-warden ls >/dev/null 2>&1; then echo "REFUSED: a cerberus-warden server is already up"; exit 0; fi
W=$(mktemp -d /tmp/athena-probe-home.XXXXXX) || exit 1
tmux -L cerberus-warden -f /dev/null new-session -d -s _keepalive sleep infinity || { rmdir "$W"; exit 1; }
CAP=$(grep -oE 'MAX_FRAME_BYTES = [0-9* ]+' "$REPO/server/modules/cerberus/warden-gateway.ts" | head -1 | sed 's/.*= //' | awk '{print $1*$3*$5}')
cat > "$W/run.mjs" <<'JS'
const { createSessions } = await import(`${process.env.REPO}/warden/src/sessions.mjs`);
const { makeEnvelope } = await import(`${process.env.REPO}/warden/src/wire.mjs`);
const keep = setInterval(() => {}, 1000);
const handlers = new Map(); let biggest = 0; const closed = [];
const link = { on(t, f) { handlers.set(t, f); },
  send(type, body) { if (type === 'session.closed') closed.push(body.reason);
    if (type === 'session.frame') biggest = Math.max(biggest, JSON.stringify(makeEnvelope('n', type, null, body)).length); return { seq: null, sent: true }; } };
createSessions({ link, home: process.env.H_HOME });
await handlers.get('session.open')({ chan: 'c1', op: 'spawn', hostId: 'athena-probe-big', cwd: '/tmp',
  frame: { t: 'spawn', command: process.execPath, args: ['-e', "process.stdout.write('a'.repeat(9e6) + '\\n'); setTimeout(() => {}, 3000)"], cwd: '/tmp', appSessionId: 'p', userId: 1, profile: null, env: { PATH: process.env.PATH } } });
await new Promise((r) => setTimeout(r, 3500));
console.log(`largest session.frame envelope handed to the link: ${biggest} bytes | gateway cap: ${process.env.CAP} | over the cap: ${biggest > Number(process.env.CAP)} | session.closed: ${JSON.stringify(closed)}`);
clearInterval(keep); process.exit(0);
JS
REPO="$REPO" CAP="$CAP" H_HOME="$W/home" timeout 60 node "$W/run.mjs" 2>&1 | tail -3
tmux -L cerberus-warden kill-server 2>/dev/null
case "$W" in /tmp/athena-probe-home.*) rm -rf "$W";; esac
EOF
bash "$D/p.sh"; case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: `largest session.frame envelope handed to the link: 9000163 bytes | gateway cap: 8388608 | over the cap: true | session.closed: []` while the defect stands; `over the cap: false` (or a non-empty `session.closed`) once the warden refuses or splits the line
```

measured 2026-10-06 by chain chain-cerberus--sessions--warden-sessions-20261006-212226-1b30, finding M1, MEDIUM
probe-key: 62b3efb447177511299eac4e52f0edfb50bf46eb

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions-link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/enroll.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/sessions.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/systemd/cerberus-warden-sessions.service

## INV-7098 — probe — `.verify/warden-sessions.sh` kills a server it did not start when its guard loses a race

`.verify/warden-sessions.sh` kills a server it did not start when its guard loses a race

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) && cat > "$D/p.sh" <<'EOF'
#!/usr/bin/env bash
# A foreign keepalive appears on -L cerberus-warden between warden-sessions.sh's `ls` guard and its own new-session:
# a tmux shim answers the guard's first `ls` as "no server" (the race), everything else passes through.
set -u
REPO=/home/lyphe/.claude/claudecodeui_lyphe
if tmux -L cerberus-warden ls >/dev/null 2>&1; then echo "REFUSED: a cerberus-warden server is already up"; exit 0; fi
S=$(mktemp -d /tmp/athena-shim.XXXXXX) || exit 1
REAL=$(command -v tmux)
cat > "$S/tmux" <<SH
#!/bin/sh
if [ "\$1 \$2 \$3" = "-L cerberus-warden ls" ] && [ ! -e "$S/seen" ]; then : > "$S/seen"; exit 1; fi
exec "$REAL" "\$@"
SH
chmod +x "$S/tmux"
"$REAL" -L cerberus-warden -f /dev/null new-session -d -s _keepalive sleep infinity   # the other holder's server
PATH="$S:$PATH" bash "$REPO/.verify/warden-sessions.sh" 2>&1 | head -5
if "$REAL" -L cerberus-warden ls >/dev/null 2>&1; then echo "foreign server: STILL UP"; else echo "foreign server: KILLED by the script's cleanup"; fi
"$REAL" -L cerberus-warden kill-server 2>/dev/null
case "$S" in /tmp/athena-shim.*) rm -rf "$S";; esac
EOF
bash "$D/p.sh"; case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: `duplicate session: _keepalive` then `foreign server: KILLED by the script's cleanup` while the defect stands; `foreign server: STILL UP` once cleanup kills only a server this run started
```

measured 2026-10-06 by chain chain-cerberus--sessions--warden-sessions-20261006-212226-1b30, finding L1, LOW
probe-key: eb18d9d1244d539bc3c201f5c4f90538493c643c

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions.sh

## INV-7099 — probe — `enroll.sh --refresh` dies half-done under `set -e` when the new sessions unit cannot start

`enroll.sh --refresh` dies half-done under `set -e` when the new sessions unit cannot start

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) && cat > "$D/p.sh" <<'EOF'
#!/bin/sh
# enroll.sh's refresh: when `enable --now` of the sessions unit fails (a foreign server already holds -L cerberus-warden,
# so the unit's `new-session -s _keepalive` says "duplicate session"), `set -e` ends the script inside enable_units():
# the warden restart and require_linked after it never run, though `current` was already swapped.
REPO=/home/lyphe/.claude/claudecodeui_lyphe
S=$(mktemp -d /tmp/athena-enable.XXXXXX) || exit 1
{
  echo 'set -eu'
  sed -n '/^enable_units() {/,/^}/p' "$REPO/warden/enroll.sh"
  cat <<'SH'
systemctl() {
  echo "systemctl $*"
  case "$*" in
    "is-enabled --quiet "*) return 1 ;;
    "enable --now cerberus-warden-sessions.service") echo "Job failed: duplicate session: _keepalive" >&2; return 1 ;;
  esac
  return 0
}
RENDERED=' cerberus-warden-sessions.service cerberus-warden.service'
enable_units
echo "enable_units returned; the script goes on to: systemctl restart cerberus-warden.service"
SH
} > "$S/t.sh"
sh "$S/t.sh" 2>&1; echo "exit status $?  (a 0 with the 'goes on' line above would mean the refresh survives)"
case "$S" in /tmp/athena-enable.*) rm -rf "$S";; esac
EOF
sh "$D/p.sh"; case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: `Job failed: duplicate session: _keepalive` then `exit status 1` with no `goes on` line while the defect stands; the `goes on` line and exit status 0 once a sessions unit that will not start no longer ends the refresh before the warden restart
```

measured 2026-10-06 by chain chain-cerberus--sessions--warden-sessions-20261006-212226-1b30, finding L2, LOW
probe-key: 450ad0fbe7032b2af98e667badeadb046c75e06d

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions-link.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-sessions.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/enroll.sh, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/sessions.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/systemd/cerberus-warden-sessions.service

## INV-7100 — probe — `listByNode`'s `name` is not "the name the sidebar shows" for a project whose custom name was reset

`listByNode`'s `name` is not "the name the sidebar shows" for a project whose custom name was reset

```probe
D=$(mktemp -d /tmp/athena-pin.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
#!/usr/bin/env bash
W=$(mktemp -d /tmp/athena-pin2.XXXXXX) || exit 1
mkdir -p "$W/myfolder" && echo '{"name":"pkg-display-name"}' > "$W/myfolder/package.json"
cat > "$W/n.mjs" <<JS
const m = await import("@/modules/database/index.js"); await m.initializeDatabase(); const p = m.projectsDb;
const { generateDisplayName } = await import("@/modules/projects/services/projects-with-sessions-fetch.service.js");
const dir = "$W/myfolder";
const id = p.createProjectPath(dir, null).project.project_id; p.setNode(id, "eis1");
p.updateCustomProjectNameById(id, null);
console.log("PROBE sidebar:", await generateDisplayName(dir.split("/").pop(), dir), "| card:", p.listByNode("eis1")[0].name);
JS
: > "$W/auth.db"
( cd /home/lyphe/.claude/claudecodeui_lyphe && DATABASE_PATH="$W/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 90 node --import tsx "$W/n.mjs" 2>&1 | grep -E '^PROBE|Error' || echo "PROBE: no output" )
case "$W" in /tmp/athena-pin2.*) rm -rf "$W";; esac
EOF
bash "$D/p.sh"; case "$D" in /tmp/athena-pin.*) rm -rf "$D";; esac
expect: PROBE sidebar: pkg-display-name | card: myfolder   (the defect stands while the two names differ; cured when they match or the claim is gone from the doc)
```

measured 2026-10-06 by chain chain-cerberus--sessions--project-node-20261006-215420-fadd, finding L1, LOW
probe-key: bb7e695842749df4ad233864e6b3bba1da280daa

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/migrations.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/projects.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/projects/services/project-node.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-7102 — probe — the assignment sends no `cerberus_changed` hint, so a second tab keeps the old project list

the assignment sends no `cerberus_changed` hint, so a second tab keeps the old project list

```probe
grep -rn "hintChanged\|cerberus_changed" /home/lyphe/.claude/claudecodeui_lyphe/server/modules/projects || echo none
expect: none   (the defect stands while it prints none; cured when the projects path hints)
```

measured 2026-10-06 by chain chain-cerberus--sessions--project-node-20261006-215420-fadd, finding L3, LOW
probe-key: b24dfb6e6726df2ea14bf71304a2c173f835dc13

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/migrations.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/projects.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/projects/services/project-node.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-7103 — probe — LOW — `setAuto` throws `SQLITE_CONSTRAINT_PRIMARYKEY` after about 6 same-millisecond flips, while the manual says "never refused"

LOW — `setAuto` throws `SQLITE_CONSTRAINT_PRIMARYKEY` after about 6 same-millisecond flips, while the manual says "never refused"

```probe
D=$(mktemp -d /tmp/athena-p1.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$1
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
cat > "$D/s.mjs" <<'JS'
const db = await import("@/modules/database/index.js");
const Defs = await import("@/modules/cerberus/definitions.service.js");
const C = await import("@/modules/cerberus/catalog.service.js");
db.cerberusNodesDb.insert({ id: "probe-node", desc: null, public_key: "k", cert_fingerprint: "f", warden_version: null, machine_id: null, facts: null, enrolled_at: Date.now() });
Defs.putDefinition("probe-node", { services: [{ service: "scratch", label: null, probes: [{ key: "scratch/file.age", kind: "file_age", every: 5, timeout: 5, path: "/tmp/x", pass: "age < 1m" }] }] });
const e = C.writeEntry({ node: "probe-node", check: "scratch/file.age", name: "Flip", when: "failing", cmd: "true", timeout: 30, limit: { runs: 2, per: 3600 } }, { kind: "written", by: "athena", at: Date.now() });
let threw = "none";
for (let i = 0; i < 200 && threw === "none"; i++) { try { C.setAuto(e.id, i % 2 === 0, "athena"); } catch (error) { threw = `flip ${i}: ${error.code}`; } }
console.log("PROBE back-to-back setAuto flips, first throw:", threw);
process.exit(0);
JS
CERBERUS_DB_PATH="$D/c.db" DATABASE_PATH="$D/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 120 node --import tsx "$D/s.mjs" 2>&1 | grep '^PROBE\|Error' | cut -c1-200
EOF
bash "$D/p.sh" "$D"; case "$D" in /tmp/athena-p1.*) rm -r "$D" ;; esac
expect: "first throw: flip 9: SQLITE_CONSTRAINT_PRIMARYKEY" while the defect stands (measured at flip 9 and flip 11 on two runs); "first throw: none" once cured
```

measured 2026-10-06 by chain chain-cerberus--fixes--catalog-20261006-212355-a991, finding L1, LOW
probe-key: a4169d24531889d0387d0358b946b390e421b3fc

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/catalog-entry-input.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/catalog.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/catalog-views.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-catalog.sh

## INV-7104 — probe — LOW — a set that was superseded before the warden saw it stays `sent_at NULL, acked_at NULL` for ever, so "every set acked" cannot hold after any write made while the link was down

LOW — a set that was superseded before the warden saw it stays `sent_at NULL, acked_at NULL` for ever, so "every set acked" cannot hold after any write made while the link was down

```probe
D=$(mktemp -d /tmp/athena-p2.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$1
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
cat > "$D/s.mjs" <<'JS'
const db = await import("@/modules/database/index.js");
const Defs = await import("@/modules/cerberus/definitions.service.js");
const C = await import("@/modules/cerberus/catalog.service.js");
const { wardenLinks } = await import("@/modules/cerberus/warden-links.js");
db.cerberusNodesDb.insert({ id: "probe-node", desc: null, public_key: "k", cert_fingerprint: "f", warden_version: null, machine_id: null, facts: null, enrolled_at: Date.now() });
Defs.putDefinition("probe-node", { services: [{ service: "scratch", label: null, probes: [{ key: "scratch/file.age", kind: "file_age", every: 5, timeout: 5, path: "/tmp/x", pass: "age < 1m" }] }] });
const origin = { kind: "written", by: "athena", at: Date.now() };
const input = (name) => ({ node: "probe-node", check: "scratch/file.age", name, when: "failing", cmd: "true", timeout: 30, limit: { runs: 2, per: 3600 } });
for (const name of ["One", "Two", "Three"]) C.writeEntry(input(name), origin);
const carried = C.catalogForWelcome("probe-node", null, Date.now());
C.registerCatalogHandlers();
wardenLinks.handlerFor("catalog.ack")("probe-node", { version: carried.version });
const rows = db.getCerberusConnection().prepare("select version, sent_at is not null s, acked_at is not null a from catalog_sets order by version").all();
console.log("PROBE sets after the warden acked the newest:", rows.map((r) => `v${r.version}:${r.a}`).join(" "), "| never acked:", rows.filter((r) => !r.a).length);
process.exit(0);
JS
CERBERUS_DB_PATH="$D/c.db" DATABASE_PATH="$D/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 120 node --import tsx "$D/s.mjs" 2>&1 | grep '^PROBE\|Error' | cut -c1-200
EOF
bash "$D/p.sh" "$D"; case "$D" in /tmp/athena-p2.*) rm -r "$D" ;; esac
expect: "v1:0 v2:0 v3:1 | never acked: 2" while it stands; "never acked: 0" once the superseded versions are covered or a decision is documented
```

measured 2026-10-06 by chain chain-cerberus--fixes--catalog-20261006-212355-a991, finding L2, LOW
probe-key: 094fbe54ba740cf5d43291a0182b6e2733f2f4d0

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/catalog-entry-input.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/catalog.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/catalog-views.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-catalog.sh

## INV-7105 — probe — LOW — text holding a lone surrogate is accepted and stored as U+FFFD, so the command the person typed is not the one that is signed

LOW — text holding a lone surrogate is accepted and stored as U+FFFD, so the command the person typed is not the one that is signed

```probe
D=$(mktemp -d /tmp/athena-p3.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$1
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
cat > "$D/s.mjs" <<'JS'
const db = await import("@/modules/database/index.js");
const Defs = await import("@/modules/cerberus/definitions.service.js");
const C = await import("@/modules/cerberus/catalog.service.js");
db.cerberusNodesDb.insert({ id: "probe-node", desc: null, public_key: "k", cert_fingerprint: "f", warden_version: null, machine_id: null, facts: null, enrolled_at: Date.now() });
Defs.putDefinition("probe-node", { services: [{ service: "scratch", label: null, probes: [{ key: "scratch/file.age", kind: "file_age", every: 5, timeout: 5, path: "/tmp/x", pass: "age < 1m" }] }] });
const typed = "echo \ud83d";
let answer;
try {
  const view = C.writeEntry({ node: "probe-node", check: "scratch/file.age", name: "Lone", when: "failing", cmd: typed, timeout: 30, limit: { runs: 2, per: 3600 } }, { kind: "written", by: "athena", at: Date.now() });
  answer = `accepted; stored cmd equals the typed one: ${view.cmd === typed} (code points ${[...view.cmd].map((c) => c.codePointAt(0).toString(16)).join(",")})`;
} catch (error) { answer = `refused ${error.code} at ${error.details?.field}`; }
console.log("PROBE a cmd holding a lone surrogate:", answer);
process.exit(0);
JS
CERBERUS_DB_PATH="$D/c.db" DATABASE_PATH="$D/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 120 node --import tsx "$D/s.mjs" 2>&1 | grep '^PROBE\|Error' | cut -c1-240
EOF
bash "$D/p.sh" "$D"; case "$D" in /tmp/athena-p3.*) rm -r "$D" ;; esac
expect: "accepted; stored cmd equals the typed one: false (code points 65,63,68,6f,20,fffd)" while it stands; "refused CERBERUS_BAD_ENTRY at cmd" once cured
```

measured 2026-10-06 by chain chain-cerberus--fixes--catalog-20261006-212355-a991, finding L3, LOW
probe-key: 5410b49d02a6bebc20b1fa2747dce370427d91d6

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/catalog-entry-input.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/catalog.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/catalog-views.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-catalog.sh

## INV-7107 — probe — A re-adopted facade that has heard only `live` re-opens at `fromSeq: 0`, which replays the host's whole journal

A re-adopted facade that has heard only `live` re-opens at `fromSeq: 0`, which replays the host's whole journal

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$1
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
cat > "$D/f1.mjs" <<'JS'
const db = await import('@/modules/database/index.js');
const { wardenLinks } = await import('@/modules/cerberus/index.js');
const { createFacade } = await import('@/modules/providers/list/claude/session-host/facade.js');
const { placeInNodeHost } = await import('@/modules/providers/list/claude/session-host/node-transport.js');
db.cerberusNodesDb.insert({ id: 'hn', desc: null, public_key: 'k', cert_fingerprint: 'f', warden_version: null, machine_id: (await import('node:fs')).readFileSync('/etc/machine-id', 'utf8').split('\n')[0].trim(), facts: null, enrolled_at: Date.now() });
const sent = []; let n = 0, link;
const up = () => { const k = ++n; link = { node: 'hn', send: (t, b) => { sent.push([k, t, b]); return true; }, close() {}, version: '0.4.0', clockOffsetMs: 0 }; wardenLinks.attach(link); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
up();
placeInNodeHost(createFacade(), { command: '/bin/true', args: [], cwd: '/tmp', env: { PATH: '/bin' }, signal: new AbortController().signal },
  { appSessionId: 'athena-probe', userId: 1, reattach: { hostId: 'athena-probe-abc' }, profile: null, node: 'hn' }).catch(() => {});
await sleep(100);
const chan = sent.find(([, t]) => t === 'session.open')[2].chan;
wardenLinks.handlerFor('session.frame')('hn', { chan, frame: { t: 'live' } }, { id: 'x', seq: null, at: Date.now() });
await sleep(50); wardenLinks.detach(link); await sleep(50); up(); await sleep(200);
console.log('F1 opens:', sent.filter(([, t]) => t === 'session.open').map(([, , b]) => `${b.op}:${JSON.stringify(b.frame)}`).join(' ; '));
process.exit(0);
JS
CERBERUS_DB_PATH="$D/c.db" DATABASE_PATH="$D/a.db" CLOUDCLI_SESSIONS_DIR="$D/s" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 60 node --import tsx "$D/f1.mjs" 2>&1 | grep '^F1'
EOF
bash "$D/p.sh" "$D"
cd /tmp && case "$D" in /tmp/athena-probe.*) rm -r "$D";; esac
expect: F1 opens: attach:{"t":"hello","fromSeq":"acked"} ; attach:{"t":"hello","fromSeq":0}   (the second open is `"fromSeq":"acked"` once cured)
```

measured 2026-10-06 by chain chain-cerberus--sessions--transport-20261006-223106-10a2, finding M1, MEDIUM
probe-key: 1ca99d69b5cada11627bd7a369d779605f1b24c3

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host-frames.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/node-transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-node-chat.mjs

## INV-7108 — probe — After the first frame, the warden's reason for ending a channel is logged and never shown: the turn ends with a bare `SIGHUP`

After the first frame, the warden's reason for ending a channel is logged and never shown: the turn ends with a bare `SIGHUP`

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$1
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
cat > "$D/f2.mjs" <<'JS'
const db = await import('@/modules/database/index.js');
const { wardenLinks } = await import('@/modules/cerberus/index.js');
const { armKeepaliveSpawn } = await import('@/modules/providers/list/claude/session-host/spawner.js');
db.cerberusNodesDb.insert({ id: 'hn', desc: null, public_key: 'k', cert_fingerprint: 'f', warden_version: null, machine_id: (await import('node:fs')).readFileSync('/etc/machine-id', 'utf8').split('\n')[0].trim(), facts: null, enrolled_at: Date.now() });
const sent = [];
wardenLinks.attach({ node: 'hn', send: (t, b) => { sent.push([t, b]); return true; }, close() {}, version: '0.4.0', clockOffsetMs: 0 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sdk = {}; armKeepaliveSpawn(sdk, { appSessionId: 'athena-probe', userId: 1, reattach: null, profile: null, node: 'hn' });
const lines = []; const p = sdk.spawnClaudeCodeProcess({ command: '/bin/true', args: [], cwd: '/tmp', env: { PATH: '/bin' }, signal: new AbortController().signal });
p.on('error', (e) => lines.push('ERROR ' + e.message)); p.on('exit', (c, s) => lines.push(`EXIT ${c} ${s}`));
await sleep(100);
const chan = sent.find(([t]) => t === 'session.open')[1].chan;
const env = { id: 'x', seq: null, at: Date.now() };
wardenLinks.handlerFor('session.frame')('hn', { chan, frame: { t: 'out', seq: 1, line: '{"type":"system"}' } }, env);
wardenLinks.handlerFor('session.closed')('hn', { chan, reason: 'A line from host athena-probe-x is 9.0 MiB or more, past the 8 MiB one frame of this link carries — the session cannot go on here' }, env);
await sleep(2500);
console.log('F2 what the SDK saw:', JSON.stringify(lines));
process.exit(0);
JS
CERBERUS_DB_PATH="$D/c.db" DATABASE_PATH="$D/a.db" CLOUDCLI_SESSIONS_DIR="$D/s" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 60 node --import tsx "$D/f2.mjs" 2>&1 | grep '^F2'
EOF
bash "$D/p.sh" "$D"
cd /tmp && case "$D" in /tmp/athena-probe.*) rm -r "$D";; esac
expect: F2 what the SDK saw: ["EXIT null SIGHUP"]   (an `ERROR …9.0 MiB…` entry before the EXIT once cured)
```

measured 2026-10-06 by chain chain-cerberus--sessions--transport-20261006-223106-10a2, finding M2, MEDIUM
probe-key: e36c63bead0694dc9fbd0dd4c665f8dedf19659f

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host-frames.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/node-transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-node-chat.mjs

## INV-7109 — probe — `.verify/cerberus-node-chat.mjs` leaves the scratch project assigned to eis1 and has no way back for the warden it stops

`.verify/cerberus-node-chat.mjs` leaves the scratch project assigned to eis1 and has no way back for the warden it stops

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
sqlite3 -readonly ~/.cloudcli/auth.db "select coalesce(node,'none') from projects where project_path like '%/cerberus-node-probe'" || echo none
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "puts node back to null: $(grep -c 'node: null' .verify/cerberus-node-chat.mjs)  signal handlers: $(grep -c 'SIGINT\|SIGTERM' .verify/cerberus-node-chat.mjs)"
EOF
bash "$D/p.sh"
cd /tmp && case "$D" in /tmp/athena-probe.*) rm -r "$D";; esac
expect: `eis1` then `puts node back to null: 0  signal handlers: 0` while it stands (`none` and non-zero counts once cured)
```

measured 2026-10-06 by chain chain-cerberus--sessions--transport-20261006-223106-10a2, finding L1, LOW
probe-key: fcdfc73190226aed34667a63ddaf9940cad93c93

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-node-chat.mjs

## INV-7110 — probe — A true-then-false sentence left behind (outside the four paths)

A true-then-false sentence left behind (outside the four paths)

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n "does not read the assignment yet" server/modules/projects/projects.routes.ts || echo none
expect: line 244 prints while it stands; `none` once the sentence is purged
```

measured 2026-10-06 by chain chain-cerberus--sessions--transport-20261006-223106-10a2, finding L2, LOW
probe-key: dd622c0046d8af370dd58bf766b1d8994b3da007

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/projects/projects.routes.ts

## INV-7111 — probe — MEDIUM — a `run.start` the warden never received holds its check for ever; only a warden restart frees it

MEDIUM — a `run.start` the warden never received holds its check for ever; only a warden restart frees it

```probe
D=$(mktemp -d /tmp/athena-pin-XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$(dirname "$0")
cat > "$D/body.mjs" <<'BODY'
const db = await import('@/modules/database/index.js');
const Defs = await import('@/modules/cerberus/definitions.service.js');
const Cat = await import('@/modules/cerberus/catalog.service.js');
const Runs = await import('@/modules/cerberus/runs.service.js');
const Auto = await import('@/modules/cerberus/auto-run.js');
const { ingest } = await import('@/modules/cerberus/ingest.service.js');
const { wardenLinks } = await import('@/modules/cerberus/warden-links.js');
const conn = db.getCerberusConnection();
setInterval(() => {}, 1000);
const sent = [];
db.cerberusNodesDb.insert({ id: 'probe-node', desc: null, public_key: 'k', cert_fingerprint: 'f', warden_version: '0.4.0', machine_id: null, facts: null, enrolled_at: Date.now() });
Defs.putDefinition('probe-node', { services: [{ service: 'scratch', label: null, probes: [{ key: 'scratch/file.age', kind: 'file_age', every: 10, timeout: 5, path: '/tmp/athena-x', pass: 'age < 1m' }] }] });
wardenLinks.attach({ node: 'probe-node', send(type, body) { sent.push({ type, body }); return true; }, close() {}, version: '0.4.0', clockOffsetMs: 0 });
wardenLinks.heard('probe-node', Date.now());
Cat.registerCatalogHandlers(); Runs.registerRunsService(); Auto.startAutoRun();
const entry = (name, { auto = false, ...o } = {}) => { const id = Cat.writeEntry({ node: 'probe-node', check: 'scratch/file.age', name, when: 'failing', cmd: 'touch /tmp/athena-x', timeout: 30, limit: { runs: 5, per: 3600 }, ...o }, { kind: 'written', by: 'athena', at: Date.now() }).id; if (auto) Cat.setAuto(id, true, 'athena'); return id; };
const ack = () => wardenLinks.handlerFor('catalog.ack')('probe-node', { version: Cat.catalogSetFor('probe-node').version });
const frame = (type, body) => wardenLinks.handlerFor(type)('probe-node', body, { type, id: 'x', node: 'probe-node', seq: null, at: Date.now(), body });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const id = entry('Lost'); ack();
const runId = await Runs.startRun({ entryId: id, by: 'you' });   // the link takes run.start; the socket dies before it is delivered, so no frame ever comes back
const PROC = Date.now() - 3_600_000;                              // the warden process started an hour ago and is still the same one
wardenLinks.announceHello('probe-node', { version: '0.4.0', startedAt: PROC, activeRuns: [], catalogVersion: 1 });  // the reconnect's hello names no run
await sleep(50);
const row = conn.prepare('select result from runs where id = ?').get(runId);
const again = await Runs.startRun({ entryId: id, by: 'you' }).then(() => 'started', (e) => e.code);
console.log('PROBE run.start lost on a dropped link, warden process alive, hello names no run → run is', row.result ?? 'active', '| a new ask on that check:', again);
process.exit(0);
BODY
S=$(mktemp -d /tmp/athena-pins-XXXXXX) || exit 1
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
CERBERUS_DB_PATH="$S/c.db" CERBERUS_KEY_PATH="$S/center.key" DATABASE_PATH="$S/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 120 node --import tsx "$D/body.mjs" 2>&1 | grep -E '^PROBE|Error' | cut -c1-300
case "$S" in /tmp/athena-pins-*) rm -r "$S";; esac
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-pin-*) rm -r "$D";; esac
expect: `run is active | a new ask on that check: CERBERUS_RUN_ACTIVE` while the defect stands; `failed | started` once a hello that names no run frees the check
```

measured 2026-10-06 by chain chain-cerberus--fixes--runs-20261006-222637-4e51, finding M1, MEDIUM
probe-key: 7690f3ebbcf85149bc1c9aa09f3090ed5cec78e3

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/auto-run.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/catalog-ack.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/run-views.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-ending.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-frames.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-reconcile.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/runs.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-runs.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/cerberus-ws-tap.mjs

## INV-7112 — probe — MEDIUM — the auto-run acts on delivery time: a failure replayed from the warden's outbox starts a fix on a check that has been `ok` for hours

MEDIUM — the auto-run acts on delivery time: a failure replayed from the warden's outbox starts a fix on a check that has been `ok` for hours

```probe
D=$(mktemp -d /tmp/athena-pin-XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$(dirname "$0")
cat > "$D/body.mjs" <<'BODY'
const db = await import('@/modules/database/index.js');
const Defs = await import('@/modules/cerberus/definitions.service.js');
const Cat = await import('@/modules/cerberus/catalog.service.js');
const Runs = await import('@/modules/cerberus/runs.service.js');
const Auto = await import('@/modules/cerberus/auto-run.js');
const { ingest } = await import('@/modules/cerberus/ingest.service.js');
const { wardenLinks } = await import('@/modules/cerberus/warden-links.js');
const conn = db.getCerberusConnection();
setInterval(() => {}, 1000);
const sent = [];
db.cerberusNodesDb.insert({ id: 'probe-node', desc: null, public_key: 'k', cert_fingerprint: 'f', warden_version: '0.4.0', machine_id: null, facts: null, enrolled_at: Date.now() });
Defs.putDefinition('probe-node', { services: [{ service: 'scratch', label: null, probes: [{ key: 'scratch/file.age', kind: 'file_age', every: 10, timeout: 5, path: '/tmp/athena-x', pass: 'age < 1m' }] }] });
wardenLinks.attach({ node: 'probe-node', send(type, body) { sent.push({ type, body }); return true; }, close() {}, version: '0.4.0', clockOffsetMs: 0 });
wardenLinks.heard('probe-node', Date.now());
Cat.registerCatalogHandlers(); Runs.registerRunsService(); Auto.startAutoRun();
const entry = (name, { auto = false, ...o } = {}) => { const id = Cat.writeEntry({ node: 'probe-node', check: 'scratch/file.age', name, when: 'failing', cmd: 'touch /tmp/athena-x', timeout: 30, limit: { runs: 5, per: 3600 }, ...o }, { kind: 'written', by: 'athena', at: Date.now() }).id; if (auto) Cat.setAuto(id, true, 'athena'); return id; };
const ack = () => wardenLinks.handlerFor('catalog.ack')('probe-node', { version: Cat.catalogSetFor('probe-node').version });
const frame = (type, body) => wardenLinks.handlerFor(type)('probe-node', body, { type, id: 'x', node: 'probe-node', seq: null, at: Date.now(), body });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = 'scratch/file.age', now = Date.now();
entry('Backlog', { auto: true }); ack();
const w = (status, at, prevAt) => ({ check: key, source: key, at, fetchedAt: at, status, docStatus: null, value: status, data: null, tookMs: 1, prevAt });
// the warden was cut off for six hours; its outbox replays on reconnect, one frame per probe batch, oldest first
ingest.ingestResults('probe-node', 1, [w('ok', now - 6 * 3600e3, null)]);
ingest.ingestResults('probe-node', 2, [w('failing', now - 5 * 3600e3, now - 6 * 3600e3 + 10_000)]);
ingest.ingestResults('probe-node', 3, [w('ok', now - 4 * 3600e3, now - 5 * 3600e3)]);
await sleep(50);
const last = conn.prepare('select status from results where check_key = ? order by at desc limit 1').get(key);
console.log('PROBE replayed backlog [ok 6 h ago, failing 5 h ago, ok 4 h ago] → check now', last.status, '| run.start frames sent:', sent.filter((s) => s.type === 'run.start').length);
process.exit(0);
BODY
S=$(mktemp -d /tmp/athena-pins-XXXXXX) || exit 1
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
CERBERUS_DB_PATH="$S/c.db" CERBERUS_KEY_PATH="$S/center.key" DATABASE_PATH="$S/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 120 node --import tsx "$D/body.mjs" 2>&1 | grep -E '^PROBE|Error' | cut -c1-300
case "$S" in /tmp/athena-pins-*) rm -r "$S";; esac
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-pin-*) rm -r "$D";; esac
expect: `check now ok | run.start frames sent: 0` once the rule reads the check's state or the move's age; `run.start frames sent: 1` while it does not
```

measured 2026-10-06 by chain chain-cerberus--fixes--runs-20261006-222637-4e51, finding M2, MEDIUM
probe-key: 8ccb964674a35cc4869eeb76656cfef699d08975

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/auto-run.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/catalog-ack.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/run-views.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-ending.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-frames.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-reconcile.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/runs.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-runs.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/cerberus-ws-tap.mjs

## INV-7113 — probe — LOW — a press or an auto run in the round trip after a catalog write is signed with a version the warden has already moved past

LOW — a press or an auto run in the round trip after a catalog write is signed with a version the warden has already moved past

```probe
D=$(mktemp -d /tmp/athena-pin-XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$(dirname "$0")
cat > "$D/body.mjs" <<'BODY'
const db = await import('@/modules/database/index.js');
const Defs = await import('@/modules/cerberus/definitions.service.js');
const Cat = await import('@/modules/cerberus/catalog.service.js');
const Runs = await import('@/modules/cerberus/runs.service.js');
const Auto = await import('@/modules/cerberus/auto-run.js');
const { ingest } = await import('@/modules/cerberus/ingest.service.js');
const { wardenLinks } = await import('@/modules/cerberus/warden-links.js');
const conn = db.getCerberusConnection();
setInterval(() => {}, 1000);
const sent = [];
db.cerberusNodesDb.insert({ id: 'probe-node', desc: null, public_key: 'k', cert_fingerprint: 'f', warden_version: '0.4.0', machine_id: null, facts: null, enrolled_at: Date.now() });
Defs.putDefinition('probe-node', { services: [{ service: 'scratch', label: null, probes: [{ key: 'scratch/file.age', kind: 'file_age', every: 10, timeout: 5, path: '/tmp/athena-x', pass: 'age < 1m' }] }] });
wardenLinks.attach({ node: 'probe-node', send(type, body) { sent.push({ type, body }); return true; }, close() {}, version: '0.4.0', clockOffsetMs: 0 });
wardenLinks.heard('probe-node', Date.now());
Cat.registerCatalogHandlers(); Runs.registerRunsService(); Auto.startAutoRun();
const entry = (name, { auto = false, ...o } = {}) => { const id = Cat.writeEntry({ node: 'probe-node', check: 'scratch/file.age', name, when: 'failing', cmd: 'touch /tmp/athena-x', timeout: 30, limit: { runs: 5, per: 3600 }, ...o }, { kind: 'written', by: 'athena', at: Date.now() }).id; if (auto) Cat.setAuto(id, true, 'athena'); return id; };
const ack = () => wardenLinks.handlerFor('catalog.ack')('probe-node', { version: Cat.catalogSetFor('probe-node').version });
const frame = (type, body) => wardenLinks.handlerFor(type)('probe-node', body, { type, id: 'x', node: 'probe-node', seq: null, at: Date.now(), body });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const x = entry('X'); ack();                 // catalog v1 holds X and is acked
entry('Y');                                  // v2 is published and sent down the link; the warden has not answered it
await Runs.startRun({ entryId: x, by: 'you' });
const order = sent.filter((s) => s.type === 'catalog.set' || s.type === 'run.start').map((s) => (s.type === 'catalog.set' ? `catalog.set v${s.body.version}` : `run.start v${s.body.catalogVersion}`));
console.log('PROBE frames on the link, in order:', JSON.stringify(order));
process.exit(0);
BODY
S=$(mktemp -d /tmp/athena-pins-XXXXXX) || exit 1
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
CERBERUS_DB_PATH="$S/c.db" CERBERUS_KEY_PATH="$S/center.key" DATABASE_PATH="$S/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 120 node --import tsx "$D/body.mjs" 2>&1 | grep -E '^PROBE|Error' | cut -c1-300
case "$S" in /tmp/athena-pins-*) rm -r "$S";; esac
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-pin-*) rm -r "$D";; esac
expect: `["catalog.set v1","catalog.set v2","run.start v1"]` while the defect stands (a `run.start` naming a version the warden is about to leave); no `run.start` before v2's ack, or `run.start v2`, once cured
```

measured 2026-10-06 by chain chain-cerberus--fixes--runs-20261006-222637-4e51, finding L1, LOW
probe-key: 4b0d2e6aec3dd9297f9d4cb116e9840934c2ce96

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/auto-run.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/catalog-ack.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/run-views.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-ending.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-frames.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-reconcile.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/runs.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-runs.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/cerberus-ws-tap.mjs

## INV-7114 — probe — LOW — a warden's clock is stored verbatim as `started_at` / `ended_at` and then compared with center's

LOW — a warden's clock is stored verbatim as `started_at` / `ended_at` and then compared with center's

```probe
D=$(mktemp -d /tmp/athena-pin-XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$(dirname "$0")
cat > "$D/body.mjs" <<'BODY'
const db = await import('@/modules/database/index.js');
const Defs = await import('@/modules/cerberus/definitions.service.js');
const Cat = await import('@/modules/cerberus/catalog.service.js');
const Runs = await import('@/modules/cerberus/runs.service.js');
const Auto = await import('@/modules/cerberus/auto-run.js');
const { ingest } = await import('@/modules/cerberus/ingest.service.js');
const { wardenLinks } = await import('@/modules/cerberus/warden-links.js');
const conn = db.getCerberusConnection();
setInterval(() => {}, 1000);
const sent = [];
db.cerberusNodesDb.insert({ id: 'probe-node', desc: null, public_key: 'k', cert_fingerprint: 'f', warden_version: '0.4.0', machine_id: null, facts: null, enrolled_at: Date.now() });
Defs.putDefinition('probe-node', { services: [{ service: 'scratch', label: null, probes: [{ key: 'scratch/file.age', kind: 'file_age', every: 10, timeout: 5, path: '/tmp/athena-x', pass: 'age < 1m' }] }] });
wardenLinks.attach({ node: 'probe-node', send(type, body) { sent.push({ type, body }); return true; }, close() {}, version: '0.4.0', clockOffsetMs: 0 });
wardenLinks.heard('probe-node', Date.now());
Cat.registerCatalogHandlers(); Runs.registerRunsService(); Auto.startAutoRun();
const entry = (name, { auto = false, ...o } = {}) => { const id = Cat.writeEntry({ node: 'probe-node', check: 'scratch/file.age', name, when: 'failing', cmd: 'touch /tmp/athena-x', timeout: 30, limit: { runs: 5, per: 3600 }, ...o }, { kind: 'written', by: 'athena', at: Date.now() }).id; if (auto) Cat.setAuto(id, true, 'athena'); return id; };
const ack = () => wardenLinks.handlerFor('catalog.ack')('probe-node', { version: Cat.catalogSetFor('probe-node').version });
const frame = (type, body) => wardenLinks.handlerFor(type)('probe-node', body, { type, id: 'x', node: 'probe-node', seq: null, at: Date.now(), body });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { activity } = await import('@/modules/cerberus/read-model/activity.js');
const id = entry('Skew'); ack();
const runId = await Runs.startRun({ entryId: id, by: 'you' });
const now = Date.now(), behind = 5_000;      // the warden's clock is five seconds behind center's; the run lasts 100 ms
await frame('run.accepted', { runId, startedAt: now - behind });
await frame('run.end', { runId, result: 'ok', exit: 0, endedAt: now - behind + 100 });
const inputs = () => ({ now: Date.now(), links: wardenLinks.states(), gateway: { listen: null, address: null, error: null }, memory: () => ({ lastReceivedAt: null, since: null }) });
const events = (page) => page.filter((a) => a.kind === 'fix').map((a) => a.event);
const whole = events(activity({ before: Date.now() + 1, limit: 50 }, inputs()));
let before = Date.now() + 1; const paged = [];
for (let guard = 0; guard < 10; guard++) { const page = activity({ before, limit: 1 }, inputs()); paged.push(...events(page)); if (page.length === 0) break; before = page[page.length - 1].at; }
console.log('PROBE 5 s skew, 100 ms run → one read:', JSON.stringify(whole), '| paged one event at a time:', JSON.stringify(paged));
const run2 = await Runs.startRun({ entryId: id, by: 'you' });   // a warden whose clock reads far ahead
await frame('run.end', { runId: run2, result: 'ok', exit: 0, endedAt: 9e15 });
console.log('PROBE run.end with endedAt 9e15 → stored ended_at minus now, in days:', Math.round((conn.prepare('select ended_at from runs where id = ?').get(run2).ended_at - Date.now()) / 864e5));
process.exit(0);
BODY
S=$(mktemp -d /tmp/athena-pins-XXXXXX) || exit 1
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
CERBERUS_DB_PATH="$S/c.db" CERBERUS_KEY_PATH="$S/center.key" DATABASE_PATH="$S/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 120 node --import tsx "$D/body.mjs" 2>&1 | grep -E '^PROBE|Error' | cut -c1-300
case "$S" in /tmp/athena-pins-*) rm -r "$S";; esac
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-pin-*) rm -r "$D";; esac
expect: `paged one event at a time: ["started"]` (the `ended` line lost) and `…in days: 104145933` while the defect stands; `["ended","started"]` and a small number of days once cured
```

measured 2026-10-06 by chain chain-cerberus--fixes--runs-20261006-222637-4e51, finding L2, LOW
probe-key: 346f35eacef80ff3af0fc384a53525e8111f3e23

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/auto-run.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/catalog-ack.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/run-views.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-ending.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-frames.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-reconcile.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/runs.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-runs.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/cerberus-ws-tap.mjs

## INV-7115 — probe — a message that starts a turn in the window between a node's link-up and its re-adoption runs a SECOND CLI beside the live host, and the live host is orphaned (S15)

a message that starts a turn in the window between a node's link-up and its re-adoption runs a SECOND CLI beside the live host, and the live host is orphaned (S15)

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/cerberus--sessions--readopt/athena-probes/run.sh p-race.mjs s15
expect: while the defect stands the line shows two hosts for the session ("prov-s15-aaa" and "prov-s15-mux…"), "retires sent: []" and "runs started: 1"; cured, one of the two hosts is gone or the old one is the one the run holds
```

measured 2026-10-07 by chain chain-cerberus--sessions--readopt-20261006-231514-92cf, finding M1, MEDIUM
probe-key: b14d6c6b2e5a5080c1a39e9f8a641f16399513d1

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/colocated-hosts.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/node-readopt.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/readopt-host.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-node-readopt.mjs

## INV-7116 — probe — `watchNodeLinks` is unguarded, so a relay that cannot arm rejects `readoptKeepaliveSessions` BEFORE the local re-adoption loop (S14)

`watchNodeLinks` is unguarded, so a relay that cannot arm rejects `readoptKeepaliveSessions` BEFORE the local re-adoption loop (S14)

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/cerberus--sessions--readopt/athena-probes/run.sh p-race.mjs s14
expect: the line reads RESULT s14: "REJECTED: The node-session relay cannot arm: …" while the defect stands; cured, it prints {"readopted":0,"swept":0}
```

measured 2026-10-07 by chain chain-cerberus--sessions--readopt-20261006-231514-92cf, finding L1, LOW
probe-key: 8ed717340323a3b943724ed7fc52995978a0b193

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/colocated-hosts.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/node-readopt.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/readopt-host.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-node-readopt.mjs

## INV-7117 — probe — a link-up after the process is marked exiting still re-adopts and attaches `hello { fromSeq: "acked" }` (S20, D-10)

a link-up after the process is marked exiting still re-adopts and attaches `hello { fromSeq: "acked" }` (S20, D-10)

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/cerberus--sessions--readopt/athena-probes/run.sh p-ad.mjs s20
expect: "opens: [[\"attach\",{\"t\":\"hello\",\"fromSeq\":\"acked\"}]]" while the defect stands; cured, "opens: []"
```

measured 2026-10-07 by chain chain-cerberus--sessions--readopt-20261006-231514-92cf, finding L2, LOW
probe-key: a34c0c98ebf1787974d6c11a88986d72b88cddae

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/colocated-hosts.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/node-readopt.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/readopt-host.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-node-readopt.mjs

## INV-7127 — probe — step 3's verdict "the recheck passed the check" passes without a recheck

step 3's verdict "the recheck passed the check" passes without a recheck

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) && cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe
grep -n 'the recheck passed the check' .verify/cerberus-fixes-whole-scratch.sh | grep -c 'ended_at' || true
EOF
bash "$D/p.sh"; case "$D" in /tmp/athena-p.?*) rm -r "$D";; esac
expect: 0 while the defect stands (the verdict's SQL never mentions the run's end); 1 once it compares to ended_at
```

measured 2026-10-07 by chain chain-cerberus--fixes--whole-20261007-021025-89aa, finding L1, LOW
probe-key: dd32c416bdbf275f1b2307b54583728ac5004ce4

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-fixes-refused-shot.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-fixes-whole-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-fixes-whole-scratch.sh

## INV-7128 — probe — the narrative line "the rule did not run it again" is printed whatever the data

the narrative line "the rule did not run it again" is printed whatever the data

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) && cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe
grep -c '^echo .*the rule did not run it again' .verify/cerberus-fixes-whole-scratch.sh || true
EOF
bash "$D/p.sh"; case "$D" in /tmp/athena-p.?*) rm -r "$D";; esac
expect: 1 while the line is printed unconditionally; 0 once it is behind a test of $COUNT
```

measured 2026-10-07 by chain chain-cerberus--fixes--whole-20261007-021025-89aa, finding L2, LOW
probe-key: 8fb0a48bce4c8a566f185970ef2a8fcb9c001d38

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-fixes-refused-shot.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-fixes-whole-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-fixes-whole-scratch.sh

## INV-7129 — probe — a refusal's reason is asserted by neither script

a refusal's reason is asserted by neither script

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) && cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe
OUT=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
BODY='{"id":"aaaa1111bbbb2222","entry":"e","diagnosis":null,"name":"Print three lines","node":"probe-node","check":"probe/other.age","by":"you","cmd":"echo changed","requestedAt":1791365065817,"startedAt":null,"endedAt":1791365065819,"result":"refused","exit":null,"note":null,"lastLine":null,"lines":[]}'
URL="data:application/json,$(printf '%s' "$BODY" | jq -sRr @uri)"
SCRATCH_TOKEN=x timeout 120 node .verify/cerberus-fixes-refused-shot.mjs "$URL" "$OUT" Refused 2>&1 | grep -E "^(PASS|FAIL)  the pane shows the run's note" | sort | uniq -c || echo "no verdict line"
case "$OUT" in /tmp/athena-p.?*) rm -r "$OUT";; esac
EOF
bash "$D/p.sh"; case "$D" in /tmp/athena-p.?*) rm -r "$D";; esac
expect: `2 PASS  the pane shows the run's note (a refusal's reason)` while the defect stands (the card shows no reason and the line still passes); FAIL once a refusal with no note fails it
```

measured 2026-10-07 by chain chain-cerberus--fixes--whole-20261007-021025-89aa, finding L3, LOW
probe-key: ecca7ab54eef56e9e79a40c33757207ddbc0a17d

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-fixes-refused-shot.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-fixes-whole-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-fixes-whole-scratch.sh

## INV-7154 — probe — LOW — `inline-flex` makes the hit area depend on the parent: a dead zone right of the words, and a 3px strut, in a block parent

LOW — `inline-flex` makes the hit area depend on the parent: a dead zone right of the words, and a 3px strut, in a block parent

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
#!/bin/bash
H=$(dirname "$0")
cat > "$H/p.mjs" <<'JS'
import { openConsole } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { installReactHarness } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/mountReact.mjs';
const session = await openConsole({ dark: false, viewport: { width: 1440, height: 900 } });
const { page } = session;
try {
  await installReactHarness(page);
  await page.evaluate(async () => {
    const { h, React, mount, importModule, readSpecifier } = window.__mountReact;
    const barrel = await readSpecifier('/src/modules/cerberus/CerberusHeader.tsx', /from ["']([^"']*shared\/ui\/index[^"']*)["']/);
    const { Checkbox } = await importModule(barrel);
    window.__calls = 0;
    await mount('athena-host', h('div', { id: 'card', className: 'rounded-xl border p-5', style: { width: 420 } },
      h('div', { id: 'row' }, h(Checkbox, { checked: false, onChange() { window.__calls += 1; }, label: 'eis1 · warden 0.14.0' }))));
  });
  const m = await page.evaluate(() => ({ display: getComputedStyle(document.querySelector('.vv-checkbox')).display, label: Math.round(document.querySelector('.vv-checkbox').getBoundingClientRect().width), row: Math.round(document.getElementById('row').getBoundingClientRect().width), rowH: Math.round(document.getElementById('row').getBoundingClientRect().height * 10) / 10, labelH: Math.round(document.querySelector('.vv-checkbox').getBoundingClientRect().height * 10) / 10 }));
  const t = await page.locator('.vv-checkbox__label').boundingBox();
  await page.mouse.click(t.x + t.width + 60, t.y + t.height / 2);
  const calls = await page.evaluate(() => window.__calls);
  console.log(`display ${m.display}; label ${m.label}px of a ${m.row}px row; row ${m.rowH}px tall vs label ${m.labelH}px; a press 60px right of the words → onChange calls ${calls} (${calls === 0 ? 'DEAD ZONE' : 'toggles'})`);
} finally { await session.browser.close(); }
JS
node "$H/p.mjs"
EOF
bash "$D/p.sh"
expect: `display inline-flex; label 159px of a 378px row; row 23.3px tall vs label 20.3px; … onChange calls 0 (DEAD ZONE)` while the defect stands; `toggles` (and `display flex`) once cured
```

measured 2026-10-07 by chain chain-cerberus--updates--checkbox-20261007-025711-5258, finding L1, LOW
probe-key: 9cc917134e388f9845e06cc460bd656523c966dc

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/index.css, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Checkbox.tsx

## INV-7155 — probe — LOW — no overflow guard: an unbroken label token widens past its container

LOW — no overflow guard: an unbroken label token widens past its container

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
#!/bin/bash
H=$(dirname "$0")
cat > "$H/p.mjs" <<'JS'
import { openConsole } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { installReactHarness } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/mountReact.mjs';
const session = await openConsole({ dark: false, viewport: { width: 390, height: 844 } });
const { page } = session;
try {
  await installReactHarness(page);
  await page.evaluate(async () => {
    const { h, mount, importModule, readSpecifier } = window.__mountReact;
    const barrel = await readSpecifier('/src/modules/cerberus/CerberusHeader.tsx', /from ["']([^"']*shared\/ui\/index[^"']*)["']/);
    const { Checkbox } = await importModule(barrel);
    await mount('athena-host', h('div', { id: 'card', className: 'rounded-xl border p-5', style: { width: 340 } },
      h(Checkbox, { checked: false, onChange() {}, label: 'snake_case_service_name_that_never_breaks_and_goes_on_and_on_for_seventy_chars' })));
  });
  const m = await page.evaluate(() => ({ label: Math.round(document.querySelector('.vv-checkbox').getBoundingClientRect().width), cardInner: document.getElementById('card').clientWidth, cardScroll: document.getElementById('card').scrollWidth }));
  console.log(`label ${m.label}px in a card ${m.cardInner}px wide; card scrollWidth ${m.cardScroll}; ${m.cardScroll > m.cardInner ? 'OVERFLOWS' : 'fits'}`);
} finally { await session.browser.close(); }
JS
node "$H/p.mjs"
EOF
bash "$D/p.sh"
expect: `label 579px in a card 338px wide; card scrollWidth 599; OVERFLOWS` while the defect stands; `fits` once the label wraps
```

measured 2026-10-07 by chain chain-cerberus--updates--checkbox-20261007-025711-5258, finding L2, LOW
probe-key: c3f435fcb29f93b9951ee753d5ce1ad7183dcb08

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/index.css, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Checkbox.tsx

## INV-7169 — probe — MEDIUM — the evidence rule does not hold on a quiet run, and the proposal invents (`diagnosis-prompt.ts`; the submit gate cannot see it)

MEDIUM — the evidence rule does not hold on a quiet run, and the proposal invents (`diagnosis-prompt.ts`; the submit gate cannot see it)

```probe
D=~/.claude/state/pipeline-reviews/cerberus--diagnosis--agent/probes
bash "$D/p2.sh"
expect: every RUN line reads absence-lines=0 (today 3 of 3 print absence-lines=1 and a restart proposal; three Haiku runs, ~70 s, on a .backup copy)
```

measured 2026-10-07 by chain chain-cerberus--diagnosis--agent-20261007-025958-d301, finding M2, MEDIUM
probe-key: 757b5aecb30d5b4522b45cb6808a0d685dd37c64

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-agent.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-prompt.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-tools.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-diagnosis-agent.mjs

## INV-7171 — probe — LOW — nothing bounds a `callNode` that never answers (`diagnosis-tools.ts` `readFromNode`)

LOW — nothing bounds a `callNode` that never answers (`diagnosis-tools.ts` `readFromNode`)

```probe
D=~/.claude/state/pipeline-reviews/cerberus--diagnosis--agent/probes
bash "$D/p4.sh"
expect: LOG_READ-ANSWERED-WITHIN-15s (callNode never answers): true   (today: false)
```

measured 2026-10-07 by chain chain-cerberus--diagnosis--agent-20261007-025958-d301, finding L2, LOW
probe-key: 46cab8a53d352d6f455aa86ec71ea72f00991db9

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-agent.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-prompt.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-tools.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-diagnosis-agent.mjs

## INV-7172 — probe — LOW — an already-aborted signal still spawns the CLI (`diagnosis-agent.ts`)

LOW — an already-aborted signal still spawns the CLI (`diagnosis-agent.ts`)

```probe
D=~/.claude/state/pipeline-reviews/cerberus--diagnosis--agent/probes
bash "$D/p5.sh" abort-pre
expect: PRE-ABORTED: rejected after <200 ms; a claude CLI child was spawned: false   (today: ~1150 ms, true)
```

measured 2026-10-07 by chain chain-cerberus--diagnosis--agent-20261007-025958-d301, finding L3, LOW
probe-key: e42c8efa973544dbc9dc7e4323d2c2f5ec0fafa8

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-agent.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-prompt.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-tools.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-diagnosis-agent.mjs

## INV-7173 — probe — LOW — the failure sentence ends in a double period and carries CLI jargon (`diagnosis-agent.ts` catch)

LOW — the failure sentence ends in a double period and carries CLI jargon (`diagnosis-agent.ts` catch)

```probe
D=~/.claude/state/pipeline-reviews/cerberus--diagnosis--agent/probes
bash "$D/p5.sh" badmodel
expect: BAD-MODEL: … ends with a double period: false · carries CLI flag jargon ("Run --model"): false   (today: true · true; no model tokens are spent)
```

measured 2026-10-07 by chain chain-cerberus--diagnosis--agent-20261007-025958-d301, finding L4, LOW
probe-key: 97267cec8e8b54f739ed0a3752a15d5c4eff6be4

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-agent.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-prompt.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-tools.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-diagnosis-agent.mjs

## INV-7176 — probe — MEDIUM — a warden that is legitimately `waiting` for a fix is failed at 3:00, then restarts onto the release anyway: the row says `failed`, no `restarting` step or pause is ever stored, and the batch has already moved on

MEDIUM — a warden that is legitimately `waiting` for a fix is failed at 3:00, then restarts onto the release anyway: the row says `failed`, no `restarting` step or pause is ever stored, and the batch has already moved on

```probe
D=$(mktemp -d /tmp/athena-probe-f1.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
REPO=/home/lyphe/.claude/claudecodeui_lyphe; cd "$REPO" || exit 1
export SUNSET_SLOT=3; source scripts/sunset-probe.sh; sunset_paths || exit 1
case "$D" in /tmp/athena-probe-f1.*) ;; *) exit 1;; esac
if curl -sf --max-time 2 "$SUNSET_API/api/auth/status" >/dev/null; then echo "slot 3 is held; nothing touched"; exit 1; fi
mkdir "$D/dist" && export CERBERUS_WARDEN_DIST="$D/dist" || exit 1
H="$D/home"; LP=""
cleanup() { case "$LP" in ''|*[!0123456789]*|0*|1) ;; *) kill -TERM "$LP" 2>/dev/null;; esac; sleep 1; stop_probe_server; }
trap cleanup EXIT
probe_db && boot_probe_server || exit 1
API="$SUNSET_API/api/cerberus"; AUTH="Authorization: Bearer $(mint_token)"
timeout 60 bash -c 'until curl -sf -H "$0" "$1/overview" | jq -e ".gateway.listening" >/dev/null; do sleep 1; done' "$AUTH" "$API" || { echo "gateway never listened"; exit 1; }
mkrelease() { local S; S=$(mktemp -d /tmp/athena-probe-rel.XXXXXX) || return 1; case "$S" in /tmp/athena-probe-rel.*) ;; *) return 1;; esac
  mkdir -p "$S/warden" "$S/server/modules/providers/list/claude" && cp -r "$REPO/warden/." "$S/warden/" &&
  cp -r "$REPO/server/modules/providers/list/claude/session-host" "$S/server/modules/providers/list/claude/" &&
  jq --arg v "$1" '.version=$v | .cerberus.note="probe release"' "$REPO/warden/package.json" > "$S/warden/p.json" && mv "$S/warden/p.json" "$S/warden/package.json" &&
  ( cd "$S" && node warden/build.mjs >/dev/null ) && cp "$S"/dist-warden/cerberus-warden-"$1".tar.gz* "$S/dist-warden/latest.json" "$D/dist/"
  local rc=$?; cd "$REPO"; case "$S" in /tmp/athena-probe-rel.*) rm -rf "$S";; esac; return $rc; }
mkrelease 9.1.0 || exit 1
T=$(curl -sf -X POST "$API/enrollments" -H "$AUTH" -H 'Content-Type: application/json' -d '{"name":"probe-node","desc":"x"}' | jq -r .token)
mkdir -p "$H/releases/9.1.0" && chmod 700 "$H" && tar -xzf "$D/dist/cerberus-warden-9.1.0.tar.gz" -C "$H/releases/9.1.0" && ln -s releases/9.1.0 "$H/current" &&
CERBERUS_WARDEN_HOME="$H" node "$H/current/warden/src/main.mjs" enroll --center "http://$SUNSET_GATEWAY" --name probe-node --token "$T" >/dev/null && cp "$H/current/warden/src/launcher.mjs" "$H/launcher.mjs" || exit 1
CERBERUS_WARDEN_HOME="$H" node "$H/launcher.mjs" >> "$D/launcher.log" 2>&1 < /dev/null &
LP=$!
curl -sf -X PUT "$API/definitions/probe-node" -H "$AUTH" -H 'Content-Type: application/json' -d '{"services":[{"service":"fx","label":"Fixture","probes":[{"key":"fx/bad","kind":"exec","cmd":"false","every":5,"timeout":5}]}]}' >/dev/null
timeout 60 bash -c 'until curl -s "$0/overview" -H "$1" | jq -e ".nodes[]|select(.id==\"probe-node\")|.link==\"reporting\" and .wardenVersion==\"9.1.0\"" >/dev/null; do sleep 1; done' "$API" "$AUTH" || { echo "warden never linked"; exit 1; }
mkrelease 9.2.0 || exit 1
ID=$(curl -s -X POST "$API/catalog" -H "$AUTH" -H 'Content-Type: application/json' -d '{"node":"probe-node","check":"fx/bad","name":"Hold","when":"failing","cmd":"sleep 200","timeout":400,"limit":{"runs":5,"per":3600}}' | jq -r .id)
curl -s -X POST "$API/catalog/$ID/run" -H "$AUTH" >/dev/null; sleep 3          # a fix is running on the node, 200 s long
B=$(curl -s -X POST "$API/updates" -H "$AUTH" -H 'Content-Type: application/json' -d '{"nodes":["probe-node"]}' | jq -r .batch); T0=$(date +%s)
for i in $(seq 1 60); do
  sleep 6; NOW=$(( $(date +%s) - T0 )); V=$(curl -s "$API/wardens" -H "$AUTH" | jq -r '.nodes[0].version')
  R=$(curl -s "$API/updates/$B" -H "$AUTH" | jq -r '.[0]|"\(.result // "live") steps=\([.steps[].step]|join(","))"')
  [ "$NOW" -ge 186 ] && [ -z "$AT186" ] && AT186="t=${NOW}s row: $R"
  [ "$V" = 9.2.0 ] && break
done
echo "row at 3 min:        $AT186"
echo "node when it restarted: t=$(( $(date +%s) - T0 ))s warden version $V"
echo "row at that moment:  $(curl -s "$API/updates/$B" -H "$AUTH" | jq -r '.[0]|"\(.result // "live") steps=\([.steps[].step]|join(","))"')"
echo "restarting step stored: $(sqlite3 -readonly "${SUNSET_PREFIX}cerberus.db" "select count(*) from update_steps where update_id in (select id from updates where batch='$B') and step='restarting'")"
EOF
export D; timeout 560 bash "$D/p.sh"; case "$D" in /tmp/athena-probe-f1.*) rm -rf "$D";; esac
expect: "row at 3 min: t=186s row: failed steps=waiting,failed" then "node when it restarted: t≈200s warden version 9.2.0" and "restarting step stored: 0" (cured: the row is still `live` at t=186 s and ends `updated` with `restarting` stored, so the last line reads 1; ~4 min run, slot 3, answers "slot 3 is held; nothing touched" when the slot is in use)
```

measured 2026-10-07 by chain chain-cerberus--updates--center-updates-20261007-032122-138a, finding M1, MEDIUM
probe-key: 7b3bf3b08ce5b9c73f3cbf395b0410345fd3bc27

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/hello-update.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/update-driver.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/updates.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/warden-release.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-updates.sh

## INV-7190 — probe — LOW — the one irreversible press is not gated by its own precondition

LOW — the one irreversible press is not gated by its own precondition

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe
awk '/the dialog lists/ {on=1} on && /throw|process\.exit/ {n++} on && /\.click\(\);/ && !done {done=1; print "throws or exits between the dialog check and the press: " n+0}' .verify/cerberus-updates-whole-live.mjs
EOF
bash "$D/p.sh"
expect: throws or exits between the dialog check and the press: 0
```

measured 2026-10-07 by chain chain-cerberus--updates--whole-20261007-060811-0c47, finding L1, LOW
probe-key: 41d0d5094826ce0635c39f1bffc55be46725794e

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-updates-whole-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/browser-frames.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/update-run-kit.mjs

## INV-7191 — probe — LOW — a legitimate `waiting` first step makes the proof FAIL

LOW — a legitimate `waiting` first step makes the proof FAIL

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe
grep -n "uploading,verified,swapping,restarting" .verify/cerberus-updates-whole-live.mjs | cut -c1-90
echo "lines that allow a 'waiting' step: $(grep -c "'waiting'" .verify/cerberus-updates-whole-live.mjs)"
EOF
bash "$D/p.sh"
expect: line 189 compares to the bare four-step string, and "lines that allow a 'waiting' step: 0"
```

measured 2026-10-07 by chain chain-cerberus--updates--whole-20261007-060811-0c47, finding L2, LOW
probe-key: 935a9a650f41dedff1907912fd46f6db0eafa635

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-updates-whole-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/browser-frames.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/update-run-kit.mjs

## INV-7192 — probe — LOW — "ms from the press" is anchored before the click, so the quoted timings are inflated by ~174 ms (and two runs of one batch disagree under one label)

LOW — "ms from the press" is anchored before the click, so the quoted timings are inflated by ~174 ms (and two runs of one batch disagree under one label)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe/.verify/artifacts/updates-whole-live
grep -h '^restart:' steps.txt after/steps.txt | sed 's/.*; steps //' || echo none
sqlite3 -readonly ~/.cloudcli/cerberus.db "select 'batch started_at ms after the logged press 06:35:57.460: ' || (started_at - 1791380157460) from updates where batch='d6860ca4810a60f6'"
EOF
bash "$D/p.sh"
expect: two different step-offset lines for one batch ("+184, +352, +352, +353 ms from the press" and "+10, +178, +178, +179 ms from the press") and 174
```

measured 2026-10-07 by chain chain-cerberus--updates--whole-20261007-060811-0c47, finding L3, LOW
probe-key: aac04051ca82b926c222ee9a87f69a3fce22ee84

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-updates-whole-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/browser-frames.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/update-run-kit.mjs

## INV-7193 — probe — LOW — the wait for "heard N s ago" has a 7–10 s margin and misses the line's first wording

LOW — the wait for "heard N s ago" has a 7–10 s margin and misses the line's first wording

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe
grep -h -E '^  \+ *(1812|21317) ms' .verify/artifacts/updates-whole-live/steps.txt | cut -c1-110 || echo none
grep -n 'heard \\\\d+ s ago' .verify/cerberus-updates-whole-live.mjs | grep -o 'timeout: [0-9]*' | head -1
EOF
bash "$D/p.sh"
expect: "+1812 ms … heard just now …", "+21317 ms … heard 2 s ago …" (19.5 s apart) and "timeout: 30000"
```

measured 2026-10-07 by chain chain-cerberus--updates--whole-20261007-060811-0c47, finding L4, LOW
probe-key: 87a0f49389ee2e5e781d114458bba2d6bf8ba116

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-updates-whole-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/browser-frames.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/update-run-kit.mjs

## INV-7194 — probe — LOW — two of the live shots do not show their captions, and the fix for them was never tried at the live page's size

LOW — two of the live shots do not show their captions, and the fix for them was never tried at the live page's size

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
python3 -E -P - <<'PY' 2>/dev/null
from PIL import Image
base = '/home/lyphe/.claude/claudecodeui_lyphe/.verify/artifacts/updates-whole-live/'
def dark(name, box):
    im = Image.open(base + name).convert('L').crop(box)
    return sum(1 for p in im.getdata() if p < 110)
for n in ('04-header-updating-1440x900.png', '05-card-updating-restarting-1440x900.png'):
    print(n, 'dark pixels where the header button sits:', dark(n, (1100, 80, 1290, 116)))
im = Image.open(base + '07-card-updated-1440x900.png').convert('RGB').crop((620, 690, 850, 750))
print('07-card-updated: distinct colours in the box over the Shadow connector row:', len(set(im.getdata())))
PY
EOF
bash "$D/p.sh"
expect: 04 → 0, 05 → 382 (a few hundred), 07 → 1
```

measured 2026-10-07 by chain chain-cerberus--updates--whole-20261007-060811-0c47, finding L5, LOW
probe-key: c54903aecfb9f34f6eb2930df672268dde32134f

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-updates-whole-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/browser-frames.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/update-run-kit.mjs

## INV-7195 — probe — LOW — `recordFrames` is dead code

LOW — `recordFrames` is dead code

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe
grep -rn 'recordFrames' .verify --include=*.mjs --include=*.sh | cut -c1-110
EOF
bash "$D/p.sh"
expect: exactly one line, the definition at .verify/lib/update-run-kit.mjs:47, and no caller
```

measured 2026-10-07 by chain chain-cerberus--updates--whole-20261007-060811-0c47, finding L6, LOW
probe-key: 57a645ad30914ee338ed5bebbf9339405cfca991

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-updates-whole-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/browser-frames.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/update-run-kit.mjs

## INV-7196 — probe — LOW — `--after` has a one-hour life that its header does not say

LOW — `--after` has a one-hour life that its header does not say

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
R=/home/lyphe/.claude/claudecodeui_lyphe
TOKEN=$(node --input-type=module -e "import('$R/.verify/lib/whole-check-kit.mjs').then(k=>process.stdout.write(k.loginToken()??''))")
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3011/api/cerberus/checks/eis1/archpulse/http.ok \
  | jq -c '{cells:(.cells|length), pausedCellsAtTheRestart:([.cells[]|select(.status=="paused" and .from<=1791380157813 and 1791380157813<.to)]|length)}'
date +%H:%M
EOF
bash "$D/p.sh"
expect: {"cells":60,"pausedCellsAtTheRestart":1} before 07:36 PDT today, pausedCellsAtTheRestart 0 after
```

measured 2026-10-07 by chain chain-cerberus--updates--whole-20261007-060811-0c47, finding L7, LOW
probe-key: 6b47ab4e81bdcd96287ff61a5a581d95218cd255

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-updates-whole-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/browser-frames.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/update-run-kit.mjs

## INV-7197 — probe — LOW — the frame listener's loss is silent

LOW — the frame listener's loss is silent

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/server.mjs" <<'EOF'
import { WebSocketServer } from '/home/lyphe/.claude/claudecodeui_lyphe/node_modules/ws/wrapper.mjs';
const wss = new WebSocketServer({ port: 7997, host: '127.0.0.1' });
wss.on('connection', (s) => { s.send(JSON.stringify({ kind: 'cerberus_changed', nodes: ['eis1'] })); setTimeout(() => s.close(), 500); });
setTimeout(() => process.exit(0), 8000);
EOF
cat > "$D/p.sh" <<'EOF'
D="$1"
node "$D/server.mjs" & SERVER=$!
sleep 1
( cd /home/lyphe/.claude/claudecodeui_lyphe && node .verify/lib/browser-frames.mjs ws://127.0.0.1:7997/ws FAKE-TOKEN > "$D/out.txt" 2> "$D/err.txt" ) & LISTENER=$!
sleep 4
if kill -0 "$LISTENER" 2>/dev/null; then echo "listener still running 3.5 s after the server closed the socket"; else echo "listener ended"; fi
echo "its output: $(tr '\n' '|' < "$D/out.txt" | sed 's/[0-9]\{13\}/<ms>/g")   its stderr: $(head -c 100 "$D/err.txt")"
kill "$LISTENER" 2>/dev/null; wait "$LISTENER" 2>/dev/null
kill "$SERVER" 2>/dev/null; wait "$SERVER" 2>/dev/null
exit 0
EOF
bash "$D/p.sh" "$D"
expect: "listener ended", output "<ms> open|<ms> eis1|", empty stderr — no line saying the socket closed
```

measured 2026-10-07 by chain chain-cerberus--updates--whole-20261007-060811-0c47, finding L8, LOW
probe-key: e8431ccc062b18e34f106e85de7b0be09b3a53c8

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-updates-whole-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/browser-frames.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/update-run-kit.mjs

## INV-7198 — probe — MEDIUM — the figure check is not "digit for digit": a changed count passes in three common ways, and the MANUAL, the script header and the verdict text say it does not

MEDIUM — the figure check is not "digit for digit": a changed count passes in three common ways, and the MANUAL, the script header and the verdict text say it does not

```probe
D=$(mktemp -d) || exit 1
cat > "$D/p.sh" <<'EOF'
printf '%s\n' '2026-10-07T07:12:30 eis1 uvicorn[2071371]: [xa-detail] Notes JSON for 06Q0MK7: 123 notes parsed' '2026-10-07T07:12:31 eis1 uvicorn[2071372]: pid 41250 started, 3 workers, port 8125' > "$1/log.txt"
cat > "$1/p.mjs" <<'JS'
import { pairEvidence } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/diagnosis-evidence.mjs';
const file = process.argv[2];
const body = '[xa-detail] Notes JSON for 06Q0MK7: ';
const variants = [
  ['the real count, 123            ', `${body}123 notes parsed`],
  ['changed to 125 (inside 8125)   ', `${body}125 notes parsed`],
  ['changed to 9 (one digit)       ', `${body}9 notes parsed`],
  ["changed to '777' (in quote marks)", `${body}'777' notes parsed`],
  ['changed to 777 (unquoted)      ', `${body}777 notes parsed`],
];
const pairs = pairEvidence({ steps: [{ n: 1, t: 0, text: `Reading ${file}` }], startedAt: Date.now(), store: process.env.HOME + '/.cloudcli/cerberus.db', evidence: variants.map((v) => v[1]), prompt: [] });
pairs.forEach((pair, i) => console.log(pair.ok ? 'PAIRED  ' : 'REJECTED', variants[i][0], '::', variants[i][1].slice(-26)));
JS
node "$1/p.mjs" "$1/log.txt"
EOF
bash "$D/p.sh" "$D"
case "$D" in /tmp/tmp.*) rm -rf "$D";; esac
```

measured 2026-10-07 by chain chain-cerberus--diagnosis--whole-20261007-070743-39f2, finding M1, MEDIUM
probe-key: f93ff060d09f6fd2b7334f1a95024215cdc43a71

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-quotes.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-diagnosis-whole-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/diagnosis-evidence.mjs

## INV-7200 — probe — LOW. A NUL only in the 4 KiB lookahead turns a text head into "is a binary file"

LOW. A NUL only in the 4 KiB lookahead turns a text head into "is a binary file"

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$(dirname "$0")
cat > "$D/p.mjs" <<'JS'
import fs from 'node:fs';
const { createDiagTools } = await import('/home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-tools.mjs');
const handlers = new Map(); const sent = [];
createDiagTools({ link: { on: (t, h) => handlers.set(t, h), send: (t, b) => sent.push(b) }, home: `${process.env.D}/wh` });
handlers.get('diag.open')({ diagId: 'a', check: 'x/y' });
const call = async (tool, args) => { await handlers.get('diag.call')({ diagId: 'a', callId: 'c1', tool, args }); return sent.find((b) => b.callId === 'c1'); };
const buf = Buffer.from('ordinary line\n'.repeat(5000)); buf[65600] = 0; // past maxBytes (65536), inside the 4 KiB the mask reads ahead
fs.writeFileSync(`${process.env.D}/nul.txt`, buf);
const r = await call('file.read', { path: `${process.env.D}/nul.txt`, maxBytes: 65536 });
console.log(`NUL at byte 65600, maxBytes 65536: ok=${r.ok} text=${JSON.stringify(r.text.slice(0, 12))}`);
process.exit(0);
JS
D="$D" node "$D/p.mjs" 2>&1 | grep -v '^\[warden\]'
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.??????) rm -rf -- "$D";; esac
expect: ok=true and text starting "ordinary line" once the binary check looks at the returned head only; today ok=false text "Refused: …"
```

measured 2026-10-07 by chain chain-cerberus--judgment--diag-reads-20261007-093440-3572, finding L1, LOW
probe-key: 75d7f88189f798bf802639ad730c8063e2e6ef09

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-text.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-diag-tools.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-argv.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-guard.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-reads.mjs

## INV-7201 — probe — LOW. The new END-without-BEGIN rule is not idempotent, so the header's promise is false and a text with 3 or more orphan END lines leaks body lines

LOW. The new END-without-BEGIN rule is not idempotent, so the header's promise is false and a text with 3 or more orphan END lines leaks body lines

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$(dirname "$0")
cat > "$D/p.mjs" <<'JS'
import fs from 'node:fs';
const { createDiagTools } = await import('/home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-tools.mjs');
const { maskSecrets } = await import('/home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-guard.mjs');
const handlers = new Map(); const sent = [];
createDiagTools({ link: { on: (t, h) => handlers.set(t, h), send: (t, b) => sent.push(b) }, home: `${process.env.D}/wh` });
handlers.get('diag.open')({ diagId: 'a', check: 'x/y' });
const call = async (tool, args) => { await handlers.get('diag.call')({ diagId: 'a', callId: 'c1', tool, args }); return sent.find((b) => b.callId === 'c1'); };
const E = '-----END PRIVATE KEY-----';
const body = (i) => `KEYBODYLINE${i}${'Zq8'.repeat(20)}`;
const text = `${body(1)}\n${E}\nmid1\n${body(2)}\n${E}\nmid2\n${body(3)}\n${E}\nafter\n`;
const once = maskSecrets(text);
console.log(`maskSecrets idempotent: ${once === maskSecrets(once)}`);
fs.writeFileSync(`${process.env.D}/three.log`, text);
const r = await call('log.read', { path: `${process.env.D}/three.log` });
console.log(`log.read, three END lines with no BEGIN: key body line returned = ${/KEYBODYLINE/.test(r.text)}`);
process.exit(0);
JS
D="$D" node "$D/p.mjs" 2>&1 | grep -v '^\[warden\]'
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.??????) rm -rf -- "$D";; esac
expect: "maskSecrets idempotent: true" and "key body line returned = false" once the rule takes the text through its LAST END; today false and true
```

measured 2026-10-07 by chain chain-cerberus--judgment--diag-reads-20261007-093440-3572, finding L2, LOW
probe-key: ef45c7f6f41a301eca9002166f8ab5ec6923497b

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-text.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-diag-tools.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-argv.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-guard.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-reads.mjs

## INV-7202 — probe — LOW. Two header lines say what the code does not

LOW. Two header lines say what the code does not

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "bullets listed after 'Beyond the key words': $(sed -n '/Beyond the key words/,/^ \*\//p' warden/src/diag-guard.mjs | grep -c -- '^ \*   `' || true)"
echo "count word in that sentence: $(sed -n '/Beyond the key words/p' warden/src/diag-guard.mjs | grep -o 'four shapes\|five shapes' || echo none)"
echo "literal backslash-u2014 in diag-reads.mjs: $(grep -c 'u2014' warden/src/diag-reads.mjs || true)"
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.??????) rm -rf -- "$D";; esac
expect: bullets 5 with "five shapes" and a literal-u2014 count of 0; today 5, "four shapes", 2
```

measured 2026-10-07 by chain chain-cerberus--judgment--diag-reads-20261007-093440-3572, finding L3, LOW
probe-key: 3694f29c9cd84c9912973929d19d715f36ff1cea

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-text.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-diag-tools.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-argv.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-guard.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-reads.mjs

## INV-7203 — probe — LOW (pre-existing, named because the new header claims coverage). An armored PGP private key block passes both key rules

LOW (pre-existing, named because the new header claims coverage). An armored PGP private key block passes both key rules

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$(dirname "$0")
cat > "$D/p.mjs" <<'JS'
const { maskSecrets } = await import('/home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-guard.mjs');
const body = (i) => `KEYBODYLINE${i}${'Zq8'.repeat(20)}`;
const whole = ['-----BEGIN PGP PRIVATE KEY BLOCK-----', body(1), body(2), '-----END PGP PRIVATE KEY BLOCK-----', 'after'].join('\n');
const tail = [body(1), body(2), '-----END PGP PRIVATE KEY BLOCK-----', 'after'].join('\n');
console.log(`PGP private key block whole: body survives = ${/KEYBODYLINE/.test(maskSecrets(whole))}; as a tail window: body survives = ${/KEYBODYLINE/.test(maskSecrets(tail))}`);
JS
node "$D/p.mjs"
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.??????) rm -rf -- "$D";; esac
expect: "body survives = false" both times once the rules take `PRIVATE KEY BLOCK`; today true, true
```

measured 2026-10-07 by chain chain-cerberus--judgment--diag-reads-20261007-093440-3572, finding L4, LOW
probe-key: 27caf01895d1a58ed115ff61ad48c963ee604d18

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-text.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-diag-tools.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-argv.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-guard.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-reads.mjs

## INV-7204 — probe — LOW. `log.read` of a file whose newest line is longer than 64 KB answers a fragment that starts mid-line

LOW. `log.read` of a file whose newest line is longer than 64 KB answers a fragment that starts mid-line

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$(dirname "$0")
cat > "$D/p.mjs" <<'JS'
import fs from 'node:fs';
const { createDiagTools } = await import('/home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-tools.mjs');
const handlers = new Map(); const sent = [];
createDiagTools({ link: { on: (t, h) => handlers.set(t, h), send: (t, b) => sent.push(b) }, home: `${process.env.D}/wh` });
handlers.get('diag.open')({ diagId: 'a', check: 'x/y' });
const call = async (tool, args) => { await handlers.get('diag.call')({ diagId: 'a', callId: 'c1', tool, args }); return sent.find((b) => b.callId === 'c1'); };
fs.writeFileSync(`${process.env.D}/long.log`, `short first line\nSTART-OF-THE-LONG-LINE ${'q'.repeat(300000)}`);
const g = await call('log.read', { path: `${process.env.D}/long.log`, lines: 5 });
console.log(`log.read, newest line 300 KB: answer starts mid-line = ${/^q{50}/.test(g.text)} (begins ${JSON.stringify(g.text.slice(0, 12))}, ${Buffer.byteLength(g.text)} bytes, truncated=${g.truncated})`);
process.exit(0);
JS
D="$D" node "$D/p.mjs" 2>&1 | grep -v '^\[warden\]'
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.??????) rm -rf -- "$D";; esac
expect: "answer starts mid-line = false" (a sentence or an empty answer, like file.read's); today true, 65536 bytes of q
```

measured 2026-10-07 by chain chain-cerberus--judgment--diag-reads-20261007-093440-3572, finding L5, LOW
probe-key: 1b87ffe3235bbdd78e7ec491e01307e4bf6554a5

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-text.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-diag-tools.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-argv.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-guard.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-reads.mjs

## INV-7205 — probe — LOW. A failing read whose stderr is one line longer than 4 KiB loses its reason with nothing saying so

LOW. A failing read whose stderr is one line longer than 4 KiB loses its reason with nothing saying so

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
mkdir -p "$D/bin" "$D/wh" || exit 1
cat > "$D/p.sh" <<'EOF'
D=$(dirname "$0")
cat > "$D/p.mjs" <<'JS'
import fs from 'node:fs';
const { createDiagTools } = await import('/home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-tools.mjs');
const handlers = new Map(); const sent = [];
createDiagTools({ link: { on: (t, h) => handlers.set(t, h), send: (t, b) => sent.push(b) }, home: `${process.env.D}/wh` });
handlers.get('diag.open')({ diagId: 'a', check: 'x/y' });
const call = async (tool, args) => { await handlers.get('diag.call')({ diagId: 'a', callId: 'c1', tool, args }); return sent.find((b) => b.callId === 'c1'); };
fs.writeFileSync(`${process.env.D}/bin/ss`, `#!/bin/sh\nhead -c 6000 /dev/zero | tr '\\0' e >&2\nexit 3\n`); fs.chmodSync(`${process.env.D}/bin/ss`, 0o755);
process.env.PATH = `${process.env.D}/bin:${process.env.PATH}`;
const s = await call('status.read', { what: 'listening' });
console.log(`status.read, stderr one 6000-byte line: ok=${s.ok} text=${JSON.stringify(s.text)}`);
process.exit(0);
JS
D="$D" node "$D/p.mjs" 2>&1 | grep -v '^\[warden\]'
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.??????) rm -rf -- "$D";; esac
expect: a text that says the stderr line ran past the cap (like the stdout sentence); today text is "[exit 3]" alone
```

measured 2026-10-07 by chain chain-cerberus--judgment--diag-reads-20261007-093440-3572, finding L6, LOW
probe-key: 1d2a6eaede6b784526a4b3c030f70001ac20c692

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-text.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-diag-tools.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-argv.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-guard.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-reads.mjs

## INV-7206 — probe — LOW (the operator's call: the denylist is a named list, and the design says "the rest of `~/.claude/state` stays readable"). Two more stores of the same class are still readable

LOW (the operator's call: the denylist is a named list, and the design says "the rest of `~/.claude/state` stays readable"). Two more stores of the same class are still readable

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$(dirname "$0")
cat > "$D/p.mjs" <<'JS'
import fs from 'node:fs';
import os from 'node:os';
const { resolveReadable } = await import('/home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-guard.mjs');
const state = `${os.homedir()}/.claude/state`;
for (const [label, rel] of [['kanban-metis soul transcript', 'kanban-metis'], ['inline-briefs brief', 'inline-briefs']]) {
  const dir = `${state}/${rel}`;
  if (!fs.existsSync(dir)) { console.log(`${label}: not on this machine`); continue; }
  const sub = rel === 'kanban-metis' ? `${dir}/${fs.readdirSync(dir)[0]}/child.log` : `${dir}/${fs.readdirSync(dir).find((f) => f.endsWith('.md'))}`;
  const x = resolveReadable(sub, `${process.env.D}/wh`);
  console.log(`${label}: ${x.refusal ? 'REFUSED' : 'readable by file.read'}`);
}
JS
D="$D" node "$D/p.mjs" 2>&1 | grep -v '^\[warden\]'
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.??????) rm -rf -- "$D";; esac
expect: "REFUSED" for both once the operator names them; today both "readable by file.read"
```

measured 2026-10-07 by chain chain-cerberus--judgment--diag-reads-20261007-093440-3572, finding L7, LOW
probe-key: c8f4ef6f1a66da4bdc6f26d1eca064d8f052bcce

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-text.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/warden-diag-tools.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-argv.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-guard.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/diag-reads.mjs

## INV-7207 — probe — [MEDIUM] — The claim replaced the eight guards' bound-port and leftover-file refusals; a claim-less listener that does not answer 2xx on `/api/auth/status` is no longer refused, and `probe_db` overwrites its database

[MEDIUM] — The claim replaced the eight guards' bound-port and leftover-file refusals; a claim-less listener that does not answer 2xx on `/api/auth/status` is no longer refused, and `probe_db` overwrites its database

```probe
D=$(mktemp -d /tmp/athena-p1.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
#!/usr/bin/env bash
# A claim-less listener on slot 5's API port that answers 404, with a stand-in database of "another plan" beside it.
D="$1"
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
if ss -ltn | grep -qE ':(7903|7904) ' || ls -d /tmp/sunset5-* > /dev/null 2>&1; then echo "slot 5 is busy; try later"; exit 0; fi
cat > "$D/squat404.mjs" <<'JS'
import http from 'node:http';
http.createServer((q, r) => { r.statusCode = 404; r.end('Not found'); }).listen(7903, '127.0.0.1');
setTimeout(() => process.exit(0), 30000);
JS
node "$D/squat404.mjs" & SQ=$!
sleep 1
echo "other plan's db" > /tmp/sunset5-probe.db
( export SUNSET_SLOT=5; source scripts/sunset-probe.sh; trap stop_probe_server EXIT
  probe_db; echo "probe_db rc=$? claimed=${SUNSET_CLAIMED:-no}; the stand-in db now starts: $(head -c 15 /tmp/sunset5-probe.db | tr -d '\0\n')" ) 2>&1 | cut -c1-200
case "$SQ" in ''|*[!0123456789]*|0*|1) ;; *) kill "$SQ" 2>/dev/null ;; esac
rm -f /tmp/sunset5-probe.db; rmdir /tmp/sunset5-claim 2>/dev/null
ls -d /tmp/sunset5-* 2>&1 | head -2
EOF
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-p1.?*) rm -rf -- "$D" ;; esac
expect: "probe_db rc=0 claimed=yes; the stand-in db now starts: SQLite format 3" while the defect stands; "probe_db rc=1 claimed=no; the stand-in db now starts: other plan's db" once a bound listener is refused
```

measured 2026-10-07 by chain chain-cerberus--judgment--probe-harness-20261007-095700-2c80, finding M1, MEDIUM
probe-key: e32cc36946202c9afa0ed4b37d947507aa5916a6

governs: /home/lyphe/.claude/claudecodeui_lyphe/scripts/sunset-probe.sh

## INV-7208 — probe — [LOW] — A shell holds one claim in a single-prefix flag: claiming a second slot in the same shell silently orphans the first

[LOW] — A shell holds one claim in a single-prefix flag: claiming a second slot in the same shell silently orphans the first

```probe
D=$(mktemp -d /tmp/athena-p2.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
#!/usr/bin/env bash
# One shell claims slot 5, then names slot 4 and claims it too. Does its exit-trap stop still release slot 5?
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
if ls -d /tmp/sunset4-* /tmp/sunset5-* > /dev/null 2>&1; then echo "slot 4 or 5 is busy; try later"; exit 0; fi
( export SUNSET_SLOT=5; source scripts/sunset-probe.sh; trap stop_probe_server EXIT
  probe_db; echo "slot 5 probe_db rc=$?"
  SUNSET_SLOT=4 probe_db; echo "slot 4 probe_db in the same shell rc=$?" ) 2>&1 | cut -c1-160
echo "after the shell's trap stop: $(ls -d /tmp/sunset5-claim /tmp/sunset5-probe.db /tmp/sunset4-claim /tmp/sunset4-probe.db 2>/dev/null | tr '\n' ' ')"
rm -f /tmp/sunset4-probe.db /tmp/sunset5-probe.db; rmdir /tmp/sunset4-claim /tmp/sunset5-claim 2>/dev/null
echo "cleaned: $(ls -d /tmp/sunset4-* /tmp/sunset5-* 2>/dev/null | wc -l) left"
EOF
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-p2.?*) rm -rf -- "$D" ;; esac
expect: "slot 4 probe_db in the same shell rc=0" and four paths listed after the trap stop while the defect stands; "rc=1" and an empty list once a second claim in one shell is refused
```

measured 2026-10-07 by chain chain-cerberus--judgment--probe-harness-20261007-095700-2c80, finding L1, LOW
probe-key: 1381484630834460ac701489850090e601c5ebc3

governs: /home/lyphe/.claude/claudecodeui_lyphe/scripts/sunset-probe.sh

## INV-7209 — probe — [LOW] — The claim has no identity: a stop in a subshell leaves the parent's flag set, and the parent's later trap stop removes a successor's claim and roots

[LOW] — The claim has no identity: a stop in a subshell leaves the parent's flag set, and the parent's later trap stop removes a successor's claim and roots

```probe
D=$(mktemp -d /tmp/athena-p2.XXXXXX) || exit 1
cat > "$D/q.sh" <<'EOF'
#!/usr/bin/env bash
# A shell stops its server in a subshell, another probe takes the slot, then the first shell's exit trap runs its stop.
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
if ls -d /tmp/sunset5-* > /dev/null 2>&1; then echo "slot 5 is busy; try later"; exit 0; fi
( export SUNSET_SLOT=5; source scripts/sunset-probe.sh; trap stop_probe_server EXIT
  probe_db; ( stop_probe_server )
  mkdir /tmp/sunset5-claim; echo "next probe's db" > /tmp/sunset5-probe.db     # the successor holds the slot now
  echo "before the trap: $(ls -d /tmp/sunset5-claim /tmp/sunset5-probe.db 2>/dev/null | tr '\n' ' ')" )
echo "after the first shell's trap stop: $(ls -d /tmp/sunset5-claim /tmp/sunset5-probe.db 2>/dev/null | tr '\n' ' ' | grep . || echo 'the successor claim and db are GONE')"
rm -f /tmp/sunset5-probe.db; rmdir /tmp/sunset5-claim 2>/dev/null
echo "cleaned: $(ls -d /tmp/sunset5-* 2>/dev/null | wc -l) left"
EOF
bash "$D/q.sh" "$D"
case "$D" in /tmp/athena-p2.?*) rm -rf -- "$D" ;; esac
expect: "after the first shell's trap stop: the successor claim and db are GONE" while the defect stands; the two paths listed once a stop cannot touch a claim its shell no longer holds
```

measured 2026-10-07 by chain chain-cerberus--judgment--probe-harness-20261007-095700-2c80, finding L2, LOW
probe-key: e936c3887e47189e062628425536d7e69da3d5a6

governs: /home/lyphe/.claude/claudecodeui_lyphe/scripts/sunset-probe.sh

## INV-7210 — probe — MEDIUM — the diagnosis prompt tells the model the old storage rule (outside the target file)

MEDIUM — the diagnosis prompt tells the model the old storage rule (outside the target file)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
grep -nE "differed from the one before it|carry the moves of the value|repeats stored every five minutes while nothing moved" server/modules/cerberus/diagnosis/diagnosis-prompt.ts || echo none
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -r "$D";; esac
expect: two lines (64 and 66) while the old rule is still in the prompt; `none` once it states what a change is now
```

measured 2026-10-07 by chain chain-cerberus--judgment--store-growth-20261007-101639-2a53, finding M1, MEDIUM
probe-key: 63e210f500716464beecc07471da0022950a56dd

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts

## INV-7211 — probe — LOW — `CerberusLookup`'s doc says `resultAt` is a stored row's `at`; it can now be an unstored result's (ON THE TARGET, and its browser mirror)

LOW — `CerberusLookup`'s doc says `resultAt` is a stored row's `at`; it can now be an unstored result's (ON THE TARGET, and its browser mirror)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
grep -n "resultAt. is the .at. of the stored row the$" server/shared/cerberus-types.ts src/shared/cerberus-types.ts || echo none
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -r "$D";; esac
expect: one line in each contract file while the sentence stands; `none` once it names a stored row or the newest received result
```

measured 2026-10-07 by chain chain-cerberus--judgment--store-growth-20261007-101639-2a53, finding L1, LOW
probe-key: 760431ed42676a298fa96a1e546b144aa5f21f2d

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts

## INV-7212 — probe — LOW — the results repository header says no read counts the pre-landing value rows; `recentChanges` does (file of this phase)

LOW — the results repository header says no read counts the pre-landing value rows; `recentChanges` does (file of this phase)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
grep -c "so no read below counts them" server/modules/database/repositories/cerberus-results.db.ts || true
sqlite3 -readonly ~/.cloudcli/cerberus.db "SELECT count(*) FROM results WHERE kind='change' AND prev_status IS NOT NULL AND prev_status = COALESCE(status,'not_enabled') AND prev_at IS NOT NULL AND at < 1791394000000;"
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -r "$D";; esac
expect: `1` then a large count (18867 on 2026-10-07) while the sentence stands; `0` once it names `transitions` and `transitionsSince` alone
```

measured 2026-10-07 by chain chain-cerberus--judgment--store-growth-20261007-101639-2a53, finding L2, LOW
probe-key: cb3c82425bc28a123e456615be3f6df8941c6885

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts

## INV-7213 — probe — MEDIUM — `needRuns` hides a going run whenever the check's `since` is newer than the run's request, so the card offers Run into the 409 the phase set out to remove

MEDIUM — `needRuns` hides a going run whenever the check's `since` is newer than the run's request, so the card offers Run into the 409 the phase set out to remove

```probe
D=$(mktemp -d /tmp/athena-probe-XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D="$1"
S=$(mktemp -d /tmp/athena-probe-XXXXXX) || exit 1
cat > "$D/body.mjs" <<'JS'
const db = await import('@/modules/database/index.js');
const Defs = await import('@/modules/cerberus/definitions.service.js');
const Cat = await import('@/modules/cerberus/catalog.service.js');
const Runs = await import('@/modules/cerberus/runs.service.js');
const Views = await import('@/modules/cerberus/read-model/run-views.js');
const { wardenLinks } = await import('@/modules/cerberus/warden-links.js');
db.getCerberusConnection();
setInterval(() => {}, 1000);
const KEY = 'scratch/file.age';
db.cerberusNodesDb.insert({ id: 'probe-node', desc: null, public_key: 'k', cert_fingerprint: 'f', warden_version: '0.4.0', machine_id: null, facts: null, enrolled_at: Date.now() });
Defs.putDefinition('probe-node', { services: [{ service: 'scratch', label: null, probes: [{ key: KEY, kind: 'file_age', every: 10, timeout: 5, path: '/tmp/athena-x', pass: 'age < 1m' }] }] });
wardenLinks.attach({ node: 'probe-node', send() { return true; }, close() {}, version: '0.4.0', clockOffsetMs: 0 });
wardenLinks.heard('probe-node', Date.now());
Cat.registerCatalogHandlers(); Runs.registerRunsService();
const id = Cat.writeEntry({ node: 'probe-node', check: KEY, name: 'Going fix', when: 'warn', cmd: 'touch /tmp/athena-x', timeout: 30, limit: { runs: 5, per: 3600 } }, { kind: 'written', by: 'athena', at: Date.now() }).id;
wardenLinks.handlerFor('catalog.ack')('probe-node', { version: Cat.catalogSetFor('probe-node').version });
const runId = await Runs.startRun({ entryId: id, by: 'you' });
await wardenLinks.handlerFor('run.accepted')('probe-node', { runId, startedAt: Date.now() }, { type: 'run.accepted', id: 'x', node: 'probe-node', seq: null, at: Date.now(), body: {} });
const inputs = { now: Date.now(), links: wardenLinks.states() };
const shows = (since) => (Views.needRuns([{ node: 'probe-node', key: KEY, since }], inputs).get('probe-node/' + KEY)?.id === runId ? 'shows the running run' : 'shows nothing');
const press = await Runs.startRun({ entryId: id, by: 'you' }).then(() => 'started', (e) => e.code);
console.log('RESULT since=null:', shows(null), '| since 30 s after the request (check moved mid-run):', shows(Date.now() + 30000), '| a press meanwhile:', press);
process.exit(0);
JS
( cd /home/lyphe/.claude/claudecodeui_lyphe && CERBERUS_DB_PATH="$S/c.db" CERBERUS_KEY_PATH="$S/center.key" DATABASE_PATH="$S/auth.db" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 90 node --import tsx "$D/body.mjs" 2>&1 | grep -E '^RESULT|Error' | cut -c1-300 )
cd /tmp && case "$S" in /tmp/athena-probe-??????) rm -r "$S";; esac
EOF
bash "$D/p.sh" "$D"
cd /tmp && case "$D" in /tmp/athena-probe-??????) rm -r "$D";; esac
expect: while the defect stands `RESULT since=null: shows the running run | since 30 s after the request (check moved mid-run): shows nothing | a press meanwhile: CERBERUS_RUN_ACTIVE`; cured when the second clause also reads `shows the running run`
```

measured 2026-10-07 by chain chain-cerberus--judgment--runs-20261007-104859-6246, finding M1, MEDIUM
probe-key: 7506118ab348ffa83e06e6ce4aa15b444dda9764

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/auto-run.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/run-views.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-frames.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/runs.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-run-output-quiet.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/signed-results.mjs

## INV-7214 — probe — LOW — two consumer comments say what the diff made false or left incomplete

LOW — two consumer comments say what the diff made false or left incomplete

```probe
D=$(mktemp -d /tmp/athena-probe-XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
grep -n 'hintRun. for each write' server/modules/cerberus/run-ending.ts || echo "run-ending: none"
echo "read model names activeForCheck: $(sed -n 33,41p server/modules/database/repositories/cerberus-runs.db.ts | tr '\n' ' ' | grep -o 'read model ([^)]*)' | grep -c activeForCheck)"
EOF
bash "$D/p.sh"
cd /tmp && case "$D" in /tmp/athena-probe-??????) rm -r "$D";; esac
expect: while stale one `run-ending.ts:15` line and `read model names activeForCheck: 0`; cured when it prints `run-ending: none` and `1`
```

measured 2026-10-07 by chain chain-cerberus--judgment--runs-20261007-104859-6246, finding L1, LOW
probe-key: 22f07763e0cfb842d6677cd71297d753cf96ac5d

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/auto-run.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/read-model/run-views.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/run-frames.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/runs.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-run-output-quiet.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/signed-results.mjs

## INV-7215 — probe — LOW — the amended row's `step` column stays at the last progress word; a live rollback leaves `failed`

LOW — the amended row's `step` column stays at the last progress word; a live rollback leaves `failed`

```probe
D=$(mktemp -d /tmp/athena-probe-XXXXXX) || exit 1
cat > "$D/p.mjs" <<'MJS'
const db = await import('@/modules/database/index.js');
db.getCerberusConnection();
const U = db.cerberusUpdatesDb;
const t = Date.now();
U.insert({ id: 'u1', batch: 'b', node: 'na', from_version: '0.10.0', to_version: '0.11.0', started_at: t - 5000, step: 'queued' });
U.insertStep('u1', t - 3000, 'restarting', 'Restarting the warden'); U.setStep('u1', 'restarting');
U.end('u1', 'updated', t - 1000, null);
const amended = typeof U.rolledBackAfterUpdated === 'function' ? U.rolledBackAfterUpdated('u1', t, 'Rolled back to 0.10.0 · r', t - 120000, 'r') : 'no such method';
const row = U.get('u1'); const last = U.steps('u1').at(-1);
console.log('result', row.result, '| step column', row.step, '| newest step', last ? last.step : 'none', '| amended', amended);
process.exit(0);
MJS
cat > "$D/p.sh" <<'SH'
D="$1"
( cd /home/lyphe/.claude/claudecodeui_lyphe && CERBERUS_DB_PATH="$D/c.db" CERBERUS_KEY_PATH="$D/k" DATABASE_PATH="$D/a.db" TSX_TSCONFIG_PATH=server/tsconfig.json timeout 120 node --import tsx "$D/p.mjs" 2>&1 | tail -1 )
SH
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-probe-*) rm -r "$D";; esac
expect: `result rolled_back | step column restarting | newest step failed | amended true` while the defect stands; `step column failed` once cured
```

measured 2026-10-07 by chain chain-cerberus--judgment--updating-node-20261007-104201-c29c, finding L1, LOW
probe-key: 9c541009ccddd097565c49db9bb797abc98176ad

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-prompt.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-updates.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-node-updating.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/signed-hello.mjs

## INV-7216 — probe — LOW — the repository's own header still states two absolutes the new method breaks

LOW — the repository's own header still states two absolutes the new method breaks

```probe
grep -n "late hello cannot move a finished update\|history does not grow" /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-updates.db.ts || echo none
expect: two lines (`:11` and `:22`) while the defect stands; `none` or lines that name the amendment once healed
```

measured 2026-10-07 by chain chain-cerberus--judgment--updating-node-20261007-104201-c29c, finding L2, LOW
probe-key: bcb7dde84418e0f0b433ad4d2116aa469f21f725

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-prompt.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-updates.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-node-updating.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/signed-hello.mjs

## INV-7217 — probe — LOW — MAN-7934 still says `CerberusStartedBatch` lives in `src/shared/types.ts`

LOW — MAN-7934 still says `CerberusStartedBatch` lives in `src/shared/types.ts`

```probe
D=$(mktemp -d /tmp/athena-pin-XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
grep -n 'CerberusStartedBatch` in `src/shared/types.ts`' src/modules/cerberus/MANUAL.md | cut -c1-80 || echo none
grep -c 'CerberusStartedBatch' src/shared/types.ts || true
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-pin-?*) rm -rf -- "$D" ;; esac
expect: no line naming `CerberusStartedBatch` in `src/shared/types.ts` (prints `none`, then `0` for the type's own count in that file); today the first command prints line 1278
```

measured 2026-10-07 by chain chain-cerberus--judgment--batch-and-labels-20261007-111336-3677, finding L1, LOW
probe-key: b4bd2dc651d18101d2e3d36aff8cbf6dea590018

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-7218 — probe — the shot script's write guard lets a DELETE through on one URL (the claim in its header and its verdict is false)

the shot script's write guard lets a DELETE through on one URL (the claim in its header and its verdict is false)

```probe
D=~/.claude/state/pipeline-reviews/cerberus--judgment--diag-words/probes
bash "$D/p1.sh"
expect: SERVER SAW lists "DELETE /api/cerberus/checks/eis1/shadow-connector/approval_engine" (cured: SERVER SAW: [])
```

measured 2026-10-07 by chain chain-cerberus--judgment--diag-words-20261007-105655-477a, finding L1, LOW
probe-key: 32bd1d35e7eeab0b6b3b52da6f312b1ddb5d5ce5

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-tools.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-diagnosis-words-shot.mjs

## INV-7225 — probe — MEDIUM — Run now in the sheet, then a press on a sibling row: the sibling blanks to "Reading this check…" for ~27 s

MEDIUM — Run now in the sheet, then a press on a sibling row: the sibling blanks to "Reading this check…" for ~27 s

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'EOF'
import { openConsole, PROJECT_ROW } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { openCerberusTab } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/node-card.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const A = 'eis1/docstore/backup.age', B = 'eis1/docstore/tcp.up', CHK = 'docstore/backup.age';
const s = await openConsole(); const { page } = s;
const prime = async (p) => (await s.api(`/api/cerberus/${p}`)).body;
const base = await prime('overview'); const dA = await prime(`checks/${A}`); const dB = await prime(`checks/${B}`);
const handlers = {}; const sockets = []; const reads = {};
await page.route(/\/api\/cerberus\//, async (route) => {
  const req = route.request(); const { pathname } = new URL(req.url()); const p = pathname.replace('/api/cerberus/', '');
  if (req.method() !== 'GET') return handlers[`${req.method()} ${p}`] ? handlers[`${req.method()} ${p}`](route) : route.abort();
  if (p === 'overview') { const o = structuredClone(base); o.now = Date.now(); const real = o.nodes.find((n) => n.id === 'eis1').services.find((x) => x.service === 'docstore').checks.find((c) => c.key === CHK); o.needsYou = [{ check: { ...real, status: 'failing', since: real.since ?? Date.now() - 3.6e6 }, fix: null, run: globalThis.NEED_RUN ?? null, diagnosis: null }]; return route.fulfill(json(200, o)); }
  if (handlers[p]) { reads[p] = (reads[p] ?? 0) + 1; return handlers[p](reads[p], route); }
  return route.fallback();
});
await page.routeWebSocket(/\/ws(\?|$)/, (ws) => { sockets.push(ws); ws.connectToServer(); });
const good = (d, over = {}) => json(200, { ...structuredClone(d), fixes: [], diagnosis: null, run: null, ...over });
const open = async () => { await page.reload({ waitUntil: 'domcontentloaded' }); await (await page.waitForSelector(PROJECT_ROW, { timeout: 20000 })).click(); await sleep(600); await openCerberusTab(page); await page.getByText('Needs you').first().waitFor({ timeout: 20000 }); await page.getByRole('button', { name: /backup\.age/ }).first().click(); return page.locator('[role="dialog"]').first(); };
const status = async (sheet) => JSON.stringify(await sheet.locator('p[role=status]').innerText());
const ENTRY = { id: 'fixture-fix', node: 'eis1', check: CHK, checkLabel: null, serviceLabel: null, name: 'Restart fixture', when: 'failing', cmd: 'x', timeout: 30, auto: false, limit: { runs: 2, per: 3600 }, capped: null, recheck: false, origin: { kind: 'written', by: 'verve', at: Date.now() - 8.64e7 }, createdAt: Date.now() - 8.64e7, stats: { runs: 2, ok: 2, lastRunAt: Date.now() - 6e5 } };
handlers['checks/' + A] = async (n, route) => route.fulfill(good(dA, { fixes: [ENTRY] }));
handlers['checks/' + B] = async (n, route) => route.fulfill(good(dB));
handlers['POST catalog/fixture-fix/run'] = async (route) => { await sleep(3000); return route.fulfill(json(200, { runId: 'runN' })); };
try {
  const sheet = await open();
  for (let i = 0; i < 80 && !(await sheet.getByRole('button', { name: 'Run now' }).count()); i++) await sleep(100);
  await sheet.getByRole('button', { name: 'Run now' }).first().click(); await sleep(500);
  await sheet.getByRole('button', { name: /tcp\.up/ }).first().click(); await sleep(1200);
  console.log(`tcp.up before the press lands: cells=${await sheet.getByRole('option').count()} status=${await status(sheet)}`);
  await sleep(4500);
  console.log(`tcp.up after the press landed: cells=${await sheet.getByRole('option').count()} status=${await status(sheet)}`);
} finally { await s.browser.close(); }
EOF
cat > "$D/p.sh" <<'EOF'
node "$1/p.mjs" 2>&1 | tail -4
EOF
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: cells=60 status="" after the press landed (held); a defect prints cells=0 status="Reading this check…"
```

measured 2026-10-07 by chain chain-cerberus--judgment--tab-rules-20261007-112613-6d0e, finding M1, MEDIUM
probe-key: 91c6202b510d545e8045fae5a819a47d37ef1b28

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-tab-rules.mjs

## INV-7226 — probe — LOW — A late outcome of the row just left replaces the failure of the row now shown (S13)

LOW — A late outcome of the row just left replaces the failure of the row now shown (S13)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'EOF'
import { openConsole, PROJECT_ROW } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { openCerberusTab } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/node-card.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const A = 'eis1/docstore/backup.age', B = 'eis1/docstore/tcp.up', CHK = 'docstore/backup.age';
const s = await openConsole(); const { page } = s;
const prime = async (p) => (await s.api(`/api/cerberus/${p}`)).body;
const base = await prime('overview'); const dA = await prime(`checks/${A}`); const dB = await prime(`checks/${B}`);
const handlers = {}; const sockets = []; const reads = {};
await page.route(/\/api\/cerberus\//, async (route) => {
  const req = route.request(); const { pathname } = new URL(req.url()); const p = pathname.replace('/api/cerberus/', '');
  if (req.method() !== 'GET') return handlers[`${req.method()} ${p}`] ? handlers[`${req.method()} ${p}`](route) : route.abort();
  if (p === 'overview') { const o = structuredClone(base); o.now = Date.now(); const real = o.nodes.find((n) => n.id === 'eis1').services.find((x) => x.service === 'docstore').checks.find((c) => c.key === CHK); o.needsYou = [{ check: { ...real, status: 'failing', since: real.since ?? Date.now() - 3.6e6 }, fix: null, run: globalThis.NEED_RUN ?? null, diagnosis: null }]; return route.fulfill(json(200, o)); }
  if (handlers[p]) { reads[p] = (reads[p] ?? 0) + 1; return handlers[p](reads[p], route); }
  return route.fallback();
});
await page.routeWebSocket(/\/ws(\?|$)/, (ws) => { sockets.push(ws); ws.connectToServer(); });
const good = (d, over = {}) => json(200, { ...structuredClone(d), fixes: [], diagnosis: null, run: null, ...over });
const open = async () => { await page.reload({ waitUntil: 'domcontentloaded' }); await (await page.waitForSelector(PROJECT_ROW, { timeout: 20000 })).click(); await sleep(600); await openCerberusTab(page); await page.getByText('Needs you').first().waitFor({ timeout: 20000 }); await page.getByRole('button', { name: /backup\.age/ }).first().click(); return page.locator('[role="dialog"]').first(); };
const status = async (sheet) => JSON.stringify(await sheet.locator('p[role=status]').innerText());
// A held read of backup.age answers 500 after the person pressed tcp.up, whose own read already answered 500.
const fail = () => json(500, { success: false, error: { code: 'X', message: 'x' } });
handlers['checks/' + A] = async (n, route) => { if (n === 1) { await sleep(2500); } return route.fulfill(fail()); };
handlers['checks/' + B] = async (n, route) => route.fulfill(fail());
try {
  const sheet = await open(); await sleep(500);
  await sheet.getByRole('button', { name: /tcp\.up/ }).first().click(); await sleep(3500);
  console.log(`tcp.up read answered 500; late 500 of backup.age landed: status=${await status(sheet)} tryAgain=${await sheet.getByRole('button', { name: /try again/i }).count()} banner=${await sheet.getByText("Cerberus can't be reached").count()}`);
} finally { await s.browser.close(); }
EOF
cat > "$D/p.sh" <<'EOF'
node "$1/p.mjs" 2>&1 | tail -4
EOF
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: tcp.up draws banner=1 tryAgain=1 and status="" (held); a defect prints status="Reading this check…" tryAgain=0 banner=0
```

measured 2026-10-07 by chain chain-cerberus--judgment--tab-rules-20261007-112613-6d0e, finding L1, LOW
probe-key: c9467916997a1fdac35447a8f8dea7178cb58a5f

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-tab-rules.mjs

## INV-7227 — probe — LOW — An older 500 landing late turns a newer 404 ("gone") into "can't be reached" with a Try again that cannot succeed (S12)

LOW — An older 500 landing late turns a newer 404 ("gone") into "can't be reached" with a Try again that cannot succeed (S12)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'EOF'
import { openConsole, PROJECT_ROW } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { openCerberusTab } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/node-card.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const A = 'eis1/docstore/backup.age', B = 'eis1/docstore/tcp.up', CHK = 'docstore/backup.age';
const s = await openConsole(); const { page } = s;
const prime = async (p) => (await s.api(`/api/cerberus/${p}`)).body;
const base = await prime('overview'); const dA = await prime(`checks/${A}`); const dB = await prime(`checks/${B}`);
const handlers = {}; const sockets = []; const reads = {};
await page.route(/\/api\/cerberus\//, async (route) => {
  const req = route.request(); const { pathname } = new URL(req.url()); const p = pathname.replace('/api/cerberus/', '');
  if (req.method() !== 'GET') return handlers[`${req.method()} ${p}`] ? handlers[`${req.method()} ${p}`](route) : route.abort();
  if (p === 'overview') { const o = structuredClone(base); o.now = Date.now(); const real = o.nodes.find((n) => n.id === 'eis1').services.find((x) => x.service === 'docstore').checks.find((c) => c.key === CHK); o.needsYou = [{ check: { ...real, status: 'failing', since: real.since ?? Date.now() - 3.6e6 }, fix: null, run: globalThis.NEED_RUN ?? null, diagnosis: null }]; return route.fulfill(json(200, o)); }
  if (handlers[p]) { reads[p] = (reads[p] ?? 0) + 1; return handlers[p](reads[p], route); }
  return route.fallback();
});
await page.routeWebSocket(/\/ws(\?|$)/, (ws) => { sockets.push(ws); ws.connectToServer(); });
const good = (d, over = {}) => json(200, { ...structuredClone(d), fixes: [], diagnosis: null, run: null, ...over });
const open = async () => { await page.reload({ waitUntil: 'domcontentloaded' }); await (await page.waitForSelector(PROJECT_ROW, { timeout: 20000 })).click(); await sleep(600); await openCerberusTab(page); await page.getByText('Needs you').first().waitFor({ timeout: 20000 }); await page.getByRole('button', { name: /backup\.age/ }).first().click(); return page.locator('[role="dialog"]').first(); };
const status = async (sheet) => JSON.stringify(await sheet.locator('p[role=status]').innerText());
// Two overlapping reads of backup.age: the first held 2 s then 500, the second answers 404 (the check was retired) at once.
let seen = 0;
handlers['checks/' + A] = async (n, route) => { const mine = ++seen; if (mine === 1) { await sleep(2000); return route.fulfill(json(500, {})); } return route.fulfill(json(404, { success: false, error: { code: 'NOT_FOUND', message: 'gone' } })); };
try {
  const sheet = await open(); await sleep(600);
  console.log(`0.6 s (404 landed):   status=${await status(sheet)} tryAgain=${await sheet.getByRole('button', { name: /try again/i }).count()}`);
  await sleep(3000);
  console.log(`3.6 s (late 500 landed): status=${await status(sheet)} tryAgain=${await sheet.getByRole('button', { name: /try again/i }).count()}`);
} finally { await s.browser.close(); }
EOF
cat > "$D/p.sh" <<'EOF'
node "$1/p.mjs" 2>&1 | tail -4
EOF
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: status="Cerberus no longer watches this check." tryAgain=0 at 3.6 s (held); a defect prints status="" tryAgain=1
```

measured 2026-10-07 by chain chain-cerberus--judgment--tab-rules-20261007-112613-6d0e, finding L2, LOW
probe-key: 54ba4708732e73f6f4aeeba4216661c0e7cb6cf2

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-tab-rules.mjs

## INV-7228 — probe — LOW — A good answer for another moment lands over a failed read of the moment now typed, with no banner (S14-adjacent; the builder's report names it)

LOW — A good answer for another moment lands over a failed read of the moment now typed, with no banner (S14-adjacent; the builder's report names it)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'EOF'
import { openConsole, PROJECT_ROW } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { openCerberusTab } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/node-card.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const A = 'eis1/docstore/backup.age', B = 'eis1/docstore/tcp.up', CHK = 'docstore/backup.age';
const s = await openConsole(); const { page } = s;
const prime = async (p) => (await s.api(`/api/cerberus/${p}`)).body;
const base = await prime('overview'); const dA = await prime(`checks/${A}`); const dB = await prime(`checks/${B}`);
const handlers = {}; const sockets = []; const reads = {};
await page.route(/\/api\/cerberus\//, async (route) => {
  const req = route.request(); const { pathname } = new URL(req.url()); const p = pathname.replace('/api/cerberus/', '');
  if (req.method() !== 'GET') return handlers[`${req.method()} ${p}`] ? handlers[`${req.method()} ${p}`](route) : route.abort();
  if (p === 'overview') { const o = structuredClone(base); o.now = Date.now(); const real = o.nodes.find((n) => n.id === 'eis1').services.find((x) => x.service === 'docstore').checks.find((c) => c.key === CHK); o.needsYou = [{ check: { ...real, status: 'failing', since: real.since ?? Date.now() - 3.6e6 }, fix: null, run: globalThis.NEED_RUN ?? null, diagnosis: null }]; return route.fulfill(json(200, o)); }
  if (handlers[p]) { reads[p] = (reads[p] ?? 0) + 1; return handlers[p](reads[p], route); }
  return route.fallback();
});
await page.routeWebSocket(/\/ws(\?|$)/, (ws) => { sockets.push(ws); ws.connectToServer(); });
const good = (d, over = {}) => json(200, { ...structuredClone(d), fixes: [], diagnosis: null, run: null, ...over });
const open = async () => { await page.reload({ waitUntil: 'domcontentloaded' }); await (await page.waitForSelector(PROJECT_ROW, { timeout: 20000 })).click(); await sleep(600); await openCerberusTab(page); await page.getByText('Needs you').first().waitFor({ timeout: 20000 }); await page.getByRole('button', { name: /backup\.age/ }).first().click(); return page.locator('[role="dialog"]').first(); };
const status = async (sheet) => JSON.stringify(await sheet.locator('p[role=status]').innerText());
// The person types a time; that moment's read answers 500 while an older live read, held 3 s, answers good.
let hold = false;
handlers['checks/' + A] = async (n, route) => {
  if (new URL(route.request().url()).searchParams.get('lookup')) return route.fulfill(json(500, {}));
  if (hold) { hold = false; await sleep(3000); }
  return route.fulfill(good(dA));
};
try {
  const sheet = await open();
  for (let i = 0; i < 80 && !(await sheet.locator('input').count()); i++) await sleep(100);
  hold = true; sockets.forEach((w) => w.send(JSON.stringify({ kind: 'cerberus_changed', at: Date.now(), nodes: [], checks: [A] }))); await sleep(300);
  const input = sheet.locator('input').first(); await input.fill('03:15:00'); await sleep(3600);
  const sentence = (await sheet.getByRole('heading', { name: 'Look up a moment', exact: false }).locator('xpath=..').innerText()).replace(/\s+/g, ' ');
  console.log(`typed 03:15:00; banner=${await sheet.getByText("Cerberus can't be reached").count()}; ${sentence.slice(0, 120)}`);
} finally { await s.browser.close(); }
EOF
cat > "$D/p.sh" <<'EOF'
node "$1/p.mjs" 2>&1 | tail -4
EOF
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: a banner (banner=1) or the 03:15 moment named in the sentence (held); a defect prints banner=0 with "At <now> it was passing"
```

measured 2026-10-07 by chain chain-cerberus--judgment--tab-rules-20261007-112613-6d0e, finding L3, LOW
probe-key: 395b6a3bb7bdeb5ae420ca37967c3cad690db78b

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-tab-rules.mjs

## INV-7229 — probe — LOW — After Run now, Fix output follows "the check's newest run", not "that run" (S23, S24; the builder's report names it)

LOW — After Run now, Fix output follows "the check's newest run", not "that run" (S23, S24; the builder's report names it)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'EOF'
import { openConsole, PROJECT_ROW } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { openCerberusTab } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/node-card.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const A = 'eis1/docstore/backup.age', B = 'eis1/docstore/tcp.up', CHK = 'docstore/backup.age';
const s = await openConsole(); const { page } = s;
const prime = async (p) => (await s.api(`/api/cerberus/${p}`)).body;
const base = await prime('overview'); const dA = await prime(`checks/${A}`); const dB = await prime(`checks/${B}`);
const handlers = {}; const sockets = []; const reads = {};
await page.route(/\/api\/cerberus\//, async (route) => {
  const req = route.request(); const { pathname } = new URL(req.url()); const p = pathname.replace('/api/cerberus/', '');
  if (req.method() !== 'GET') return handlers[`${req.method()} ${p}`] ? handlers[`${req.method()} ${p}`](route) : route.abort();
  if (p === 'overview') { const o = structuredClone(base); o.now = Date.now(); const real = o.nodes.find((n) => n.id === 'eis1').services.find((x) => x.service === 'docstore').checks.find((c) => c.key === CHK); o.needsYou = [{ check: { ...real, status: 'failing', since: real.since ?? Date.now() - 3.6e6 }, fix: null, run: globalThis.NEED_RUN ?? null, diagnosis: null }]; return route.fulfill(json(200, o)); }
  if (handlers[p]) { reads[p] = (reads[p] ?? 0) + 1; return handlers[p](reads[p], route); }
  return route.fallback();
});
await page.routeWebSocket(/\/ws(\?|$)/, (ws) => { sockets.push(ws); ws.connectToServer(); });
const good = (d, over = {}) => json(200, { ...structuredClone(d), fixes: [], diagnosis: null, run: null, ...over });
const open = async () => { await page.reload({ waitUntil: 'domcontentloaded' }); await (await page.waitForSelector(PROJECT_ROW, { timeout: 20000 })).click(); await sleep(600); await openCerberusTab(page); await page.getByText('Needs you').first().waitFor({ timeout: 20000 }); await page.getByRole('button', { name: /backup\.age/ }).first().click(); return page.locator('[role="dialog"]').first(); };
const status = async (sheet) => JSON.stringify(await sheet.locator('p[role=status]').innerText());
// Opened on run A from a Needs-you strip; Run now pressed in the sheet starts N; then another run M of the same check begins.
const run = (id, name, ago, ended) => ({ id, entry: 'fixture-fix', diagnosis: null, name, node: 'eis1', check: CHK, by: 'you', cmd: 'x', requestedAt: Date.now() - ago, startedAt: Date.now() - ago, endedAt: ended ? Date.now() - ago + 4000 : null, result: ended ? 'ok' : null, exit: ended ? 0 : null, note: `${name} note`, lastLine: name, lastN: 1, lines: [{ n: 1, t: 0.4, stream: 'out', line: `${name}-LINE` }] });
const RA = run('runA', 'RunA', 1.2e6, true), RB = run('runB', 'RunB', 3e5, true), RN = run('runN', 'RunN', 1000, false), RM = run('runM', 'RunM', 500, false);
globalThis.NEED_RUN = RA;
const ENTRY = { id: 'fixture-fix', node: 'eis1', check: CHK, checkLabel: null, serviceLabel: null, name: 'Restart fixture', when: 'failing', cmd: 'x', timeout: 30, auto: false, limit: { runs: 2, per: 3600 }, capped: null, recheck: false, origin: { kind: 'written', by: 'verve', at: Date.now() - 8.64e7 }, createdAt: Date.now() - 8.64e7, stats: { runs: 2, ok: 2, lastRunAt: Date.now() - 6e5 } };
let stage = 'opened';
for (const r of [RA, RB, RN, RM]) handlers[`runs/${r.id}`] = async (n, route) => route.fulfill(json(200, r));
handlers['checks/' + A] = async (n, route) => route.fulfill(good(dA, { fixes: [ENTRY], run: { opened: RB, pressed: RN, newer: RM }[stage] }));
handlers['POST catalog/fixture-fix/run'] = async (route) => { stage = 'pressed'; return route.fulfill(json(200, { runId: 'runN' })); };
const pane = async (sheet) => (await sheet.locator('section:has(h4:text-is("Fix output"))').first().innerText({ timeout: 400 }).catch(() => 'ABSENT')).replace(/\s+/g, ' ').slice(0, 60);
try {
  await page.reload({ waitUntil: 'domcontentloaded' }); await (await page.waitForSelector(PROJECT_ROW, { timeout: 20000 })).click(); await sleep(600); await openCerberusTab(page);
  await page.getByRole('button', { name: /RunA note/ }).first().click(); const sheet = page.locator('[role="dialog"]').first();
  for (let i = 0; i < 80 && !(await sheet.getByRole('button', { name: 'Run now' }).count()); i++) await sleep(100); await sleep(500);
  console.log(`opened on RunA, check names RunB: ${await pane(sheet)}`);
  await sheet.getByRole('button', { name: 'Run now' }).first().click(); await sleep(1500);
  console.log(`after Run now (started RunN):     ${await pane(sheet)}`);
  stage = 'newer'; sockets.forEach((w) => w.send(JSON.stringify({ kind: 'cerberus_changed', at: Date.now(), nodes: [], checks: [A] }))); await sleep(1500);
  console.log(`a newer run RunM of the check:    ${await pane(sheet)}`);
} finally { await s.browser.close(); }
EOF
cat > "$D/p.sh" <<'EOF'
node "$1/p.mjs" 2>&1 | tail -4
EOF
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: the last line shows RunN (held: that run); a defect prints RunM
```

measured 2026-10-07 by chain chain-cerberus--judgment--tab-rules-20261007-112613-6d0e, finding L4, LOW
probe-key: 970adbae942c086a0c1f099923dc3f31a4135a75

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-tab-rules.mjs

## INV-7230 — probe — LOW — The cerberus MANUAL still states the three old rules, though the report says it rewrote them

LOW — The cerberus MANUAL still states the three old rules, though the report says it rewrote them

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
M=/home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/MANUAL.md
echo "newest-read-only rule lines: $(grep -c "Only the newest read's outcome is published" "$M")"
echo "old Fix output precedence lines: $(grep -c "until the check's own read has answered; then the check's newest run" "$M")"
echo "startUpdate null-means-refusal lines: $(grep -c 'null` on a refusal after its toast' "$M")"
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: all three counts 0 once the rows say the new rules (today 1, 1, 1)
```

measured 2026-10-07 by chain chain-cerberus--judgment--tab-rules-20261007-112613-6d0e, finding L5, LOW
probe-key: 381276e8ef4976a5207a1c4352600fcf3a40f611

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/modals/EnrollDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-tab-rules.mjs

## INV-7246 — probe — the summary is still outside the gate, and the new prompt sentence did not hold in either fresh Haiku run (round 1's L1, still open as the builder says)

the summary is still outside the gate, and the new prompt sentence did not hold in either fresh Haiku run (round 1's L1, still open as the builder says)

```probe
export D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
API=http://127.0.0.1:3011
TOKEN=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{"username":"verve","password":"verve-dev-2026"}' | jq -r .token)
curl -s "$API/api/cerberus/diagnoses/eec87b9cd9972ca2" -H "Authorization: Bearer $TOKEN" | jq -r 'if .summary then "evidence lines: \(.evidence|length)", ((.summary | capture("(?<c>The constant is defined in the module[^.]*)\\.") | .c) // "clause gone") else "row gone" end'
EOF
bash "$D/p.sh"
rm -f "$D/p.sh"; rmdir "$D"
expect: `evidence lines: 1` then `The constant is defined in the module, suggesting a Python module reloading or bytecode caching issue in the long-running service process` while the clause stands unquoted; `row gone` or `clause gone` when it is cured
```

measured 2026-10-07 by chain chain-cerberus--judgment--whole-20261007-132555-0967, finding L3, LOW
probe-key: db4aa1dda93573693e2d4b5ca8cb6ba35197bffa

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-absence.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-deps.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-prompt.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-quotes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-tools.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-judgment-diagnosis.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-judgment-handover.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-judgment-tab.mjs

## INV-7351 — probe — LOW — a census missing `choices.dactyl_models` blanks the whole Agent Chains window

LOW — a census missing `choices.dactyl_models` blanks the whole Agent Chains window

```probe
node /home/lyphe/.claude/state/pipeline-reviews/dactyls--defaults-fill/athena-probes/old-census.mjs
expect: `panel ready: false | pageerrors: 2 Cannot read properties of undefined (reading 'map')` while the defect stands; `panel ready: true | pageerrors: 0` (or the "did not answer with a census" card with a retry) once cured
```

measured 2026-10-08 by chain chain-dactyls--defaults-fill-20261008-073023-1ba3, finding L1, LOW
probe-key: f6ef3619f2163f2d70736d9c1d3bef81ae19e2e0

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/AgentLaunchDefaults.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/agent-launch-types.ts

## INV-7366 — probe — LOW — three places still state "an epic's books are the sum of its plan cards, to the digit"; the diff made that false and edited the row that says it without touching the sentence

LOW — three places still state "an epic's books are the sum of its plan cards, to the digit"; the diff made that false and edited the row that says it without touching the sentence

```probe
cd /home/lyphe/.claude && echo "arc=sum-of-cards claims — manual: $(grep -c 'row is therefore the sum of the plan cards under it, to the digit' hooks/dispatcher/MANUAL.md) | types.ts copies: $(cat claudecodeui_lyphe/server/shared/types.ts claudecodeui_lyphe/src/shared/types.ts | grep -c 'so an arc and its plans never disagree about what the arc has cost')"
echo "[probe exit $?]"
expect: manual: 0 | types.ts copies: 0 (the sentences say the epic is cut at each feature's join); the defect reads manual: 1 | types.ts copies: 2
```

measured 2026-10-08 by chain chain-epic-books-since-joined-20261008-085600-800f, finding L1, LOW
probe-key: a1965ef1bd5249d4a281e0d068098ca9b59270d3

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-arc.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/hooks/dispatcher/store_joined.py, /home/lyphe/.claude/hooks/dispatcher/store.py

## INV-7367 — probe — LOW — a read queued before a flip is issued after the write began, and its answer redraws the old side while the write is out

LOW — a read queued before a flip is issued after the write began, and its answer redraws the old side while the write is out

```probe
cd /tmp && node /home/lyphe/.claude/state/pipeline-reviews/dactyls--row-fill/athena-probes/s16b-requeued-read.mjs 2>&1 | tail -3
expect: a line `S16b trace (ms, side): [[1,"on"],[<~700>,"off"],[<~1500>,"on"]] flicker-to-off-while-write-out=true` while the defect stands; cured when it prints `flicker-to-off-while-write-out=false` (a trace that never reads "off")
```

measured 2026-10-08 by chain chain-dactyls--row-fill-20261008-082830-10e9, finding L1, LOW
probe-key: 5062ae8aa28b65d79d0e9a44cb0e2feb63f59b58

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/dactyls-switch.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/settings.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useDactylsSwitch.ts

## INV-7380 — probe — LOW — doc comments in `server/shared/types.ts` that the code contradicts

LOW — doc comments in `server/shared/types.ts` that the code contradicts

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/custom-compaction--seams/probes/stale-docs.sh
expect: types.ts quotes "1 background calls have not and names keepalive 0 times while the seams file writes 'background call has' and strips keepalive (1); after the fix the quote reads (not the plural form) and keepalive count is 1
```

measured 2026-10-08 by chain chain-custom-compaction--seams-20261008-095144-d30e, finding L2, LOW
probe-key: a63d4f381d3df722c616b1847a936414c325e493

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts

## INV-7385 — probe — LOW — a comment still points at the button that is gone

LOW — a comment still points at the button that is gone

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n -i "second button\|to add one" src/modules/accounts/AccountPopover.tsx src/modules/accounts/AccountFooterRow.tsx || echo none
echo "[probe exit $?]"
expect: `src/modules/accounts/AccountPopover.tsx:221:` prints while the defect stands; `none` once the comment stops referring to a second button
```

measured 2026-10-08 by chain chain-remove-add-account-button-20261008-103333-20a8, finding L1, LOW
probe-key: a5b8e01c128691f28b87f61510fb05747010377d

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/AccountFooterRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/AccountPopover.tsx

## INV-7416 — probe — a stray that ran and a stray the fence refused print the same report; nothing notices a fence that never ran

a stray that ran and a stray the fence refused print the same report; nothing notices a fence that never ran

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/dactyls-fence-opus/athena-probes/fence-canary.sh
echo "[probe exit $?]"
expect: the two `✓ … strays: ./other.txt` reports are identical but for the stub's own words (`… identical …: yes`) while one sibling reads `keep` and the other `hacked`; cured: the unfenced run is not `✓`
```

measured 2026-10-08 by chain chain-dactyls-fence-opus-20261008-165918-f181, finding L1, LOW
probe-key: d6478009936123d53f81aec57039cca46bb23fc1

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/AgentLaunchDactylField.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/AgentLaunchDefaults.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/hooks/plan_runner/dactyls/child.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/fence.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/refuse.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/switch.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/verb.py, /home/lyphe/.claude/hooks/plan_runner/solo/launch.py

## INV-7417 — probe — a RESUME keeps the dactyl mode, but its spawn model follows the table: a fix-pass resumed after Hephaestus is re-pinned to Sonnet runs dactyls on Sonnet

a RESUME keeps the dactyl mode, but its spawn model follows the table: a fix-pass resumed after Hephaestus is re-pinned to Sonnet runs dactyls on Sonnet

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/dactyls-fence-opus/athena-probes/resume-repin.sh
echo "[probe exit $?]"
expect: `resumed fix-pass: dactyls = True … spawns on = sonnet` while the defect stands; cured: `dactyls = False` there (or the model recorded)
```

measured 2026-10-08 by chain chain-dactyls-fence-opus-20261008-165918-f181, finding L2, LOW
probe-key: c6250f4570d626d8b2732a10b745d8e07972a5aa

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/AgentLaunchDactylField.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/AgentLaunchDefaults.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/hooks/plan_runner/dactyls/child.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/fence.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/refuse.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/switch.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/verb.py, /home/lyphe/.claude/hooks/plan_runner/solo/launch.py

## INV-7418 — probe — `dactyl --status` says `ready: true` for a Hephaestus whose launches go to Flash; its docstring says it answers "would the next Hephaestus launch carry dactyls?"

`dactyl --status` says `ready: true` for a Hephaestus whose launches go to Flash; its docstring says it answers "would the next Hephaestus launch carry dactyls?"

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/dactyls-fence-opus/athena-probes/status-deepseek.sh
echo "[probe exit $?]"
expect: `provider … 'deepseek'` beside `ready = True | why = ''` while the defect stands; cured: ready False with a sentence naming DeepSeek
```

measured 2026-10-08 by chain chain-dactyls-fence-opus-20261008-165918-f181, finding L3, LOW
probe-key: 06b193858221d0b32897bf6ef28d81bbc2da3239

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/AgentLaunchDactylField.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/AgentLaunchDefaults.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/hooks/plan_runner/dactyls/child.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/fence.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/refuse.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/switch.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/verb.py, /home/lyphe/.claude/hooks/plan_runner/solo/launch.py

## INV-7419 — probe — a name the CLI itself cannot read (`\` in it) is no longer refused before a token is spent

a name the CLI itself cannot read (`\` in it) is no longer refused before a token is spent

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/dactyls-fence-opus/athena-probes/backslash-name.sh
echo "[probe exit $?]"
expect: `✗ dactyl D/v\w.py — I couldn't make the change: …symlink resolution…`, three turns, `file now: alpha` while the defect stands (spends one Haiku call); cured: a refusal sentence before any turn
```

measured 2026-10-08 by chain chain-dactyls-fence-opus-20261008-165918-f181, finding L4, LOW
probe-key: d073893646d95c20c3a8f1991f14e7ed313838d9

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/AgentLaunchDactylField.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/AgentLaunchDefaults.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/hooks/plan_runner/dactyls/child.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/fence.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/refuse.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/switch.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/verb.py, /home/lyphe/.claude/hooks/plan_runner/solo/launch.py

## INV-7421 — probe — two comments say what the old design did

two comments say what the old design did

```probe
grep -n 'The CLI refuses those calls' /home/lyphe/.claude/hooks/plan_runner/dactyls/child.py; grep -n '`child.argv` backs the same rule' /home/lyphe/.claude/hooks/plan_runner/dactyls/fence.py
echo "[probe exit $?]"
expect: one hit in each file while the defect stands; cured: no output
```

measured 2026-10-08 by chain chain-dactyls-fence-opus-20261008-165918-f181, finding L6, LOW
probe-key: a0a68ca40038309f50117130b0b2a908f145f46c

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/AgentLaunchDactylField.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/AgentLaunchDefaults.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/hooks/plan_runner/dactyls/child.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/fence.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/refuse.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/switch.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/verb.py, /home/lyphe/.claude/hooks/plan_runner/solo/launch.py

## INV-7422 — probe — the "On" line names Sonnet and Flash as by-hand cases and leaves out Fable, which the table can pin and `rides` refuses

the "On" line names Sonnet and Flash as by-hand cases and leaves out Fable, which the table can pin and `rides` refuses

```probe
cd /home/lyphe/.claude && python3 -c "
import json,sys; sys.path.insert(0,'hooks')
from plan_runner.dactyls import switch
c=json.load(open('claudecodeui_lyphe/src/modules/i18n/locales/en/common.json'))['agentLaunch']['defaults']['dactylOn']
print('rides(fable):', switch.rides('fable'), '| copy names Fable:', 'Fable' in c, '| copy names Sonnet:', 'Sonnet' in c)"
echo "[probe exit $?]"
expect: `rides(fable): False | copy names Fable: False | copy names Sonnet: True` while the defect stands; cured: the copy names Fable or says "any other model"
```

measured 2026-10-08 by chain chain-dactyls-fence-opus-20261008-165918-f181, finding L7, LOW
probe-key: e199fb55a5375a4d20bbc42ca3bb16ba5c1a3c24

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/AgentLaunchDactylField.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/agent-launch/AgentLaunchDefaults.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/hooks/plan_runner/dactyls/child.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/fence.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/refuse.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/switch.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/verb.py, /home/lyphe/.claude/hooks/plan_runner/solo/launch.py

## INV-7423 — probe — MEDIUM — the "Claude Code" group is offered in every provider's composer; in Codex/Cursor/OpenCode, picking one sends an engine command to the wrong engine

MEDIUM — the "Claude Code" group is offered in every provider's composer; in Codex/Cursor/OpenCode, picking one sends an engine command to the wrong engine

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/codex-groups.mjs" <<'EOF'
import { openConsole, PROJECT_ROW } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
const session = await openConsole({ dark: false, viewport: { width: 1440, height: 900 } });
const { page } = session;
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector(PROJECT_ROW, { timeout: 20000 });
await page.locator(PROJECT_ROW).first().click();
await page.waitForSelector('textarea', { timeout: 20000 });
await page.locator('text=Click to change model').first().click();
await page.waitForTimeout(600);
await page.getByText('gpt-5.5', { exact: true }).first().click();
await page.waitForTimeout(800);
const card = await page.locator('text=Click to change model').first().evaluate((e) => e.parentElement.textContent);
const ta = page.locator('textarea').first();
await ta.click(); await ta.fill(''); await page.waitForTimeout(250); await ta.fill('/');
await page.waitForSelector('.command-menu .command-group', { timeout: 15000 }); await page.waitForTimeout(700);
const groups = await page.evaluate(() => [...document.querySelectorAll('.command-menu .command-group')].map((g) => g.firstElementChild?.querySelector('span')?.textContent));
console.log('composer provider card:', JSON.stringify(card.slice(0, 60)));
console.log('palette groups:', JSON.stringify(groups));
await ta.fill(''); await page.waitForTimeout(1300);
await session.browser.close();
EOF
(cd /home/lyphe/.claude/claudecodeui_lyphe && timeout 120 node "$D/codex-groups.mjs" 2>&1 | tail -4)
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
echo "[probe exit $?]"
expect: `composer provider card: "Codex·GPT-5.5…"` and a `palette groups:` list with no "Claude Code" entry (today: ["CloudCLI Commands","Claude Code","Skills","User Commands"])
```

measured 2026-10-08 by chain chain-cloudcli-palette-engine-commands-20261008-171107-6488, finding M1, MEDIUM
probe-key: cf43d7a9db20f49150c81af60af1dedc4e968c2b

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-command-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-engine-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-model-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useSlashCommands.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/palette-claude-code-group.mjs

## INV-7424 — probe — LOW — the proof script's "terminal badge after the turn" leg cannot fail on a hand-off fault

LOW — the proof script's "terminal badge after the turn" leg cannot fail on a hand-off fault

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
TOK=$(curl -s -X POST http://127.0.0.1:3011/api/auth/login -H 'content-type: application/json' -d '{"username":"verve","password":"verve-dev-2026"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
curl -s -X POST http://127.0.0.1:3011/api/commands/list -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d '{}' | python3 -c "
import sys,json
b={e['name']:e['metadata']['type'] for e in json.load(sys.stdin)['engine']}
print('doctor badge, no turn sent by this probe:', b.get('/doctor'))"
python3 -c "
import json,os
d=json.load(open(os.path.expanduser('~/.cloudcli/claude-command-catalog.json')))
print('disk terminalCommands for', d['cliVersion'], '=', d.get('terminalCommands'))"
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
echo "[probe exit $?]"
expect: `doctor badge, no turn sent by this probe: terminal` — the script's last leg passes with no turn; the defect stands while the set is already on disk, cured when the leg proves the frame itself (or says it cannot)
```

measured 2026-10-08 by chain chain-cloudcli-palette-engine-commands-20261008-171107-6488, finding L1, LOW
probe-key: 3b9b808cdeed4b0dbf229c057fd7a0b5b2909656

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-command-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-engine-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-model-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useSlashCommands.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/palette-claude-code-group.mjs

## INV-7425 — probe — LOW — the proof script hard-codes today's engine strings, so the next CLI update fails it on a healthy system

LOW — the proof script hard-codes today's engine strings, so the next CLI update fails it on a healthy system

```probe
grep -n "prompt-audit" /home/lyphe/.claude/claudecodeui_lyphe/.verify/palette-claude-code-group.mjs | cut -c1-120 || echo none
echo "[probe exit $?]"
expect: no `prompt-audit` literal (today: lines 130 and 157)
```

measured 2026-10-08 by chain chain-cloudcli-palette-engine-commands-20261008-171107-6488, finding L2, LOW
probe-key: d53b46dda68f9723445247c3357ce2ceeb1fd7e7

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-command-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-engine-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-model-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useSlashCommands.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/palette-claude-code-group.mjs

## INV-7426 — probe — LOW — `grep -rn reload-plugins server/ src/` is not empty

LOW — `grep -rn reload-plugins server/ src/` is not empty

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -rn reload-plugins server/ src/ | cut -c1-100 || echo none
echo "[probe exit $?]"
expect: `none` (today: server/modules/providers/MANUAL.md:632)
```

measured 2026-10-08 by chain chain-cloudcli-palette-engine-commands-20261008-171107-6488, finding L3, LOW
probe-key: 5e035b9db7b75d00a3916c504b051b45967a8416

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-command-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-engine-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-model-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useSlashCommands.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/palette-claude-code-group.mjs

## INV-7427 — probe — LOW — `EngineCatalogSpec` is exported and nothing imports it

LOW — `EngineCatalogSpec` is exported and nothing imports it

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -rln "EngineCatalogSpec" server src --include=*.ts --include=*.js --include=*.tsx
echo "[probe exit $?]"
expect: no file other than claude-engine-catalog.ts listed once the export is dropped (today: only that file, which is the same file that exports it)
```

measured 2026-10-08 by chain chain-cloudcli-palette-engine-commands-20261008-171107-6488, finding L4, LOW
probe-key: c0ff9bddf6f1b9eea323c0b6aa8e3bcb2d41a2c2

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-command-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-engine-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-model-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useSlashCommands.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/palette-claude-code-group.mjs

## INV-7428 — The composer's provider is a stored preference a probe must pin

`selectedProvider` is stored per user in `auth.db`; opening any conversation rewrites it to that conversation's provider. The dev account `verve` carries whatever the last run or chat left.

- Follows it: the slash palette's `Claude Code` group (a Claude composer only, MAN-8069) and the model picker's list.
- 2026-10-08: `node .verify/palette-claude-code-group.mjs` on an account stored on `codex`: 25 FAIL, the app correct (no group, GPT models).

| when | do |
|---|---|
| a probe needs the composer on Claude and must not write the account | `pinPreferences(context, { ...HARNESS_PREFERENCES, selectedProvider: 'claude' }, { writes: 'drop' })` from `lib/prefs-pin.mjs`, registered AFTER `openConsole` returns (earlier, it swallows `ensureTheme`'s theme write); pass the same overlay as `openConsole({ preferences })` |
| a probe needs a given provider | `putComposerOnProvider(page, id)` from `lib/composer-provider.mjs`: picks through the new-chat card's picker (Claude on Haiku, others their first model) and awaits that provider's `/skills` reply |
| a probe needs to know the provider | `readComposerProvider(page)` → `claude` `codex` `cursor` `opencode` or `null` |

- `putComposerOnProvider` answers `true` once on the provider, `false` when the picker offers none or offers it with no enabled model (caller tries the next of `NON_CLAUDE_PROVIDERS`), and throws when the new-chat card is absent (an open conversation has none) or the pick did not land.
- A pick writes `selectedProvider` like any pick; only the drop pin keeps it off the shared account.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/composer-provider.mjs

## INV-7429 — probe — `putComposerOnProvider` writes the shared dev account, and a failure between its two writes strands it on Codex

`putComposerOnProvider` writes the shared dev account, and a failure between its two writes strands it on Codex

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/stored.mjs" <<'EOF'
import { openConsole, PROJECT_ROW } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { putComposerOnProvider } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/composer-provider.mjs';
const session = await openConsole({ viewport: { width: 1440, height: 900 } });
const { page } = session;
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector(PROJECT_ROW, { timeout: 20000 });
await page.locator(PROJECT_ROW).first().click();
await page.waitForSelector('textarea', { timeout: 20000 });
const stored = async () => (await session.api('/api/user/preferences')).body?.preferences?.selectedProvider ?? null;
const before = await stored();
const switched = await putComposerOnProvider(page, 'codex');
await page.waitForTimeout(800);
const afterSwitch = await stored();
await putComposerOnProvider(page, 'claude');
await page.waitForTimeout(800);
const restored = await stored();
console.log(JSON.stringify({ before, switchedToCodex: switched, storedWhileOnCodex: afterSwitch, storedAfterSwitchBack: restored }));
await session.browser.close();
EOF
(cd /home/lyphe/.claude/claudecodeui_lyphe && timeout 150 node "$D/stored.mjs" 2>&1 | tail -4)
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
echo "[probe exit $?]"
expect: {"before":"claude","switchedToCodex":true,"storedWhileOnCodex":"codex","storedAfterSwitchBack":"claude"} — the defect stands while storedWhileOnCodex is "codex" (the helper wrote the shared account); cured when it stays "claude" (the switch is pinned per session, writes dropped)
```

measured 2026-10-08 by chain chain-cloudcli-palette-engine-commands-proof-20261008-175347-965e, finding L1, LOW
probe-key: 77c09ecd74dcbf23984eee9a6fd22a7903c624ed

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/composer-provider.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/palette-claude-code-group.mjs

## INV-7430 — probe — a provider that is offered but has no models crashes the whole run, raw, instead of skipping to the next candidate

a provider that is offered but has no models crashes the whole run, raw, instead of skipping to the next candidate

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/empty-catalog.mjs" <<'EOF'
import { openConsole, PROJECT_ROW } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { putComposerOnProvider } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/composer-provider.mjs';
process.on('unhandledRejection', (error) => console.log('UNHANDLED REJECTION:', String(error?.message ?? error).split('\n')[0]));
const session = await openConsole({ viewport: { width: 1440, height: 900 } });
const { page } = session;
await page.route('**/api/providers/codex/models*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { provider: 'codex', models: { OPTIONS: [] } } }) }));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector(PROJECT_ROW, { timeout: 20000 });
await page.locator(PROJECT_ROW).first().click();
await page.waitForSelector('textarea', { timeout: 20000 });
const t0 = Date.now();
try {
  console.log('codex offered with no models: putComposerOnProvider ->', await putComposerOnProvider(page, 'codex'));
} catch (error) {
  console.log(`codex offered with no models: threw after ${Date.now() - t0} ms:`, String(error.message).split('\n')[0]);
}
await session.browser.close().catch(() => {});
EOF
(cd /home/lyphe/.claude/claudecodeui_lyphe && timeout 150 node "$D/empty-catalog.mjs" 2>&1 | tail -4)
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
echo "[probe exit $?]"
expect: `UNHANDLED REJECTION: page.waitForResponse: Timeout 15000ms exceeded…` then `threw after ~30000 ms: locator.click: Timeout 30000ms exceeded.` — the defect stands while the UNHANDLED line prints; cured when it is absent and the answer is `-> false` (or a clear throw naming the empty group)
```

measured 2026-10-08 by chain chain-cloudcli-palette-engine-commands-proof-20261008-175347-965e, finding L2, LOW
probe-key: bc779b4bbb12580f350f0bb5025c91cbab0b88f2

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/composer-provider.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/palette-claude-code-group.mjs

## INV-7431 — probe — the manual's Proof line for this script omits the leg this build added and the account write

the manual's Proof line for this script omits the leg this build added and the account write

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep '^- \*\*Proof\.\*\*.*palette-claude-code-group' server/modules/providers/MANUAL.md | grep -c -i -E 'provider gate|another provider|codex|non-claude|forces? the composer|onto claude'
echo "[probe exit $?]"
expect: prints 0 (and `[probe exit 1]`, grep -c's own status for a zero count) — the defect stands while the count is 0; cured when it is 1 or more
```

measured 2026-10-08 by chain chain-cloudcli-palette-engine-commands-proof-20261008-175347-965e, finding L3, LOW
probe-key: 719996f3f8bf59915cd820f36484ed81614ce343

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/composer-provider.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/palette-claude-code-group.mjs

## INV-7516 — probe — (MEDIUM): `MAN-6224` still tells the reader the purple dot lights for a plan's chat, the exact opposite of the new rule

(MEDIUM): `MAN-6224` still tells the reader the purple dot lights for a plan's chat, the exact opposite of the new rule

```probe
~/.claude/scripts/docstore get MAN-6224 --text | grep -c 'still lights for the chat' || true
echo "[probe exit $?]"
expect: prints `1` while the defect stands (the sentence at docs/architecture/MANUAL.md:4097); `0` once MAN-6224 says the dot skips the dispatcher's own work
```

measured 2026-10-09 by chain chain-subagent-dot-skips-dispatcher-work-20261009-090852-7001, finding M1, MEDIUM
probe-key: 73b80fb5dd85f00bf1868f3a7e0c5ccf373adabe

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/dispatcher-work.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/running-launchers.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/session-subagent-runs.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/subagent-dot-dispatcher.mjs

## INV-7532 — probe — MEDIUM — after every supervised handover the first snapshot is empty, so every live row blinks gray

MEDIUM — after every supervised handover the first snapshot is empty, so every live row blinks gray

```probe
node /home/lyphe/.claude/state/pipeline-reviews/simple-list-gray-when-no-live-session/athena-probes/handover-flash.mjs
echo "[probe exit $?]"
expect: `first snapshot after the handover: 3 hosts` (tmux's own count) and `peak 0 of 3` (today: `0 hosts` and `peak 3 of 3, for ~0.5 s`). The probe touches (mtime only) server/shared/cerberus-types.ts, so it starts one real dev handover; it prints in both states.
```

measured 2026-10-09 by chain chain-simple-list-gray-when-no-live-session-20261009-095512-677b, finding M1, MEDIUM
probe-key: 31f78478ed1e1e4add41ee04939d0b58bfe3cc85

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host-liveness.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/websocket/services/chat-websocket.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/App.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/context/SessionHostLivenessContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/live-gray-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-live-gray-event.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-live-gray-gate.mjs

## INV-7533 — probe — LOW — the open chat's row, when asleep, falls under AA in the light theme, and the row's comment says it does not

LOW — the open chat's row, when asleep, falls under AA in the light theme, and the row's comment says it does not

```probe
node /home/lyphe/.claude/state/pipeline-reviews/simple-list-gray-when-no-live-session/athena-probes/asleep-contrast.mjs
echo "[probe exit $?]"
expect: every title ratio >= 4.50 and every glyph ratio >= 3.00 in the six lines (today: `light selected title 4.30 … glyph 2.83`)
```

measured 2026-10-09 by chain chain-simple-list-gray-when-no-live-session-20261009-095512-677b, finding L1, LOW
probe-key: c704fa0f7cedb15aa574b7c5150266901c1d47f0

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host-liveness.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/websocket/services/chat-websocket.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/App.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/context/SessionHostLivenessContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/live-gray-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-live-gray-event.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-live-gray-gate.mjs

## INV-7544 — probe — turning follow-sun OFF over a stale stored theme jumps the page to that theme (pre-existing; builder disclosed; operator's call)

turning follow-sun OFF over a stale stored theme jumps the page to that theme (pre-existing; builder disclosed; operator's call)

```probe
node /home/lyphe/.claude/state/pipeline-reviews/follow-sun-dark-on-button-press/athena-probes/probe-followsun-off.mjs
expect: prints `before=light after-OFF=DARK (stored theme dark, follows false)` while the defect stands; cured when it prints `after-OFF=light`
```

measured 2026-10-09 by chain chain-follow-sun-dark-on-button-press-20261009-104453-19b1, finding L1, LOW
probe-key: ccfe98489193346d940f4f312af41e912efb69e2

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/context/ThemeContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/follow-sun-press.mjs

## INV-7545 — probe — `toggleDarkMode` writes a preference inside a `setState` updater: React warns on the non-eager path (pre-existing; builder disclosed)

`toggleDarkMode` writes a preference inside a `setState` updater: React warns on the non-eager path (pre-existing; builder disclosed)

```probe
node /home/lyphe/.claude/state/pipeline-reviews/follow-sun-dark-on-button-press/athena-probes/updater-warning.mjs
expect: the last line prints `total "Cannot update a component" warnings: 1` while the defect stands (the four press lines above it show the page alternating dark/light correctly); cured when it prints `: 0`
```

measured 2026-10-09 by chain chain-follow-sun-dark-on-button-press-20261009-104453-19b1, finding L2, LOW
probe-key: ffac819c6bf0eccb1da41af7b7ec44d0e0e036f4

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/context/ThemeContext.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/follow-sun-press.mjs

## INV-7554 — probe — the seed append's context count (`detail: 'summary'`) overstates "after" by a constant ~5.4K tokens in the app, 8.3K in a bare session

the seed append's context count (`detail: 'summary'`) overstates "after" by a constant ~5.4K tokens in the app, 8.3K in a bare session

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) && cat > "$D/p.sh" <<'EOF'
#!/bin/bash
H=$(dirname "$0")
mkdir -p /tmp/cloudcli-probe-chat
cat > "$H/ctx.mjs" <<'EOT'
import crypto from 'node:crypto';
const { query } = await import('/home/lyphe/.claude/claudecodeui_lyphe/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs');
const msg = (text, append) => ({ type: 'user', message: { role: 'user', content: append ? [{ type: 'text', text }] : text }, parent_tool_use_id: null, ...(append ? { shouldQuery: false } : {}), uuid: crypto.randomUUID(), timestamp: new Date().toISOString() });
const inbox = []; let wake; const next = () => new Promise((r) => { wake = r; });
async function* input() { for (;;) { while (inbox.length) yield inbox.shift(); await next(); } }
const q = query({ prompt: input(), options: { model: 'claude-haiku-4-5-20251001', cwd: '/tmp/cloudcli-probe-chat', permissionMode: 'default', maxTurns: 1 } });
const push = (m) => { inbox.push(m); wake?.(); };
push(msg('The secret word is HELIOTROPE.', true));
let step = 0; let summary = null; let full = null; let real = null; const ms = {};
for await (const m of q) {
  if (m.type === 'result' && step === 0) {
    step = 1;
    let t0 = Date.now(); summary = (await q.getContextUsage({ detail: 'summary' })).totalTokens; ms.summary = Date.now() - t0;
    t0 = Date.now(); full = (await q.getContextUsage({ detail: 'full' })).totalTokens; ms.full = Date.now() - t0;
    push(msg('What is the secret word? One word.', false));
  } else if (m.type === 'assistant' && real === null) {
    const u = m.message.usage; real = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  } else if (m.type === 'result' && step === 1) break;
}
console.log(JSON.stringify({ summary, full, realFirstRequest: real, summaryOver: summary - real, fullOver: full - real, ms }));
process.exit(0);
EOT
cd /tmp/cloudcli-probe-chat && timeout 120 node "$H/ctx.mjs"
EOF
timeout 150 bash "$D/p.sh" 2>&1 | tail -3
expect: `summaryOver` in the thousands (8351 measured; 5.4K in the app) and `fullOver` under 400 (335 measured) — once the runtime asks for `full` or the summary is corrected, the app's marker "after" matches the next request's first count within a few hundred tokens
```

measured 2026-10-09 by chain chain-compaction-handover--append-20261009-133059-4418, finding M1, MEDIUM
probe-key: c345b05142750c555b1aa3d179b5ce5e7bac344b

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts

## INV-7555 — probe — `askContextTokens` accepts `totalTokens: 0` and publishes a `token_budget` of `used: 0`

`askContextTokens` accepts `totalTokens: 0` and publishes a `token_budget` of `used: 0`

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) && cat > "$D/p.sh" <<'EOF'
#!/bin/bash
H=$(dirname "$0")
cat > "$H/z.mts" <<'EOT'
const { askContextTokens } = await import('/home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-compaction-seams.ts') as any;
console.warn = () => {};
console.log('answer {totalTokens:0} -> ' + JSON.stringify(await askContextTokens(async () => ({ totalTokens: 0 }), 'k')));
EOT
cd /home/lyphe/.claude/claudecodeui_lyphe && node_modules/.bin/tsx --tsconfig tsconfig.json "$H/z.mts"
EOF
bash "$D/p.sh" 2>&1 | tail -2
expect: `answer {totalTokens:0} -> 0` today; `null` once an empty count is refused
```

measured 2026-10-09 by chain chain-compaction-handover--append-20261009-133059-4418, finding L1, LOW
probe-key: 66fda36f06e3b6d74fa8a640749ceed216af1c6a

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts

## INV-7556 — probe — one stale sentence about "the new session's first turn"

one stale sentence about "the new session's first turn"

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && grep -n "first turn has reported" server/modules/compaction/compaction-frames.ts || echo none
expect: one line (41) today; `none` once the sentence names the seed append's count
```

measured 2026-10-09 by chain chain-compaction-handover--append-20261009-133059-4418, finding L2, LOW
probe-key: 3d1206d19b52d3edbaaf6e5387204f1cda045657

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts

## INV-7558 — probe — A project folder that is gone still reaches the client as `spawn <claude> ENOENT` wherever the pre-flight does not run (a Cerberus node's project; a folder removed after the stat), and MAN-693 says it never does

A project folder that is gone still reaches the client as `spawn <claude> ENOENT` wherever the pre-flight does not run (a Cerberus node's project; a folder removed after the stat), and MAN-693 says it never does

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D=$1
H=/home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host.js
cat > "$D/c.mjs" <<'JS'
import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [,, D, H] = process.argv;
const hostId = 'athena-probe-cwd';
const host = spawn('node', [H, hostId, D], { stdio: 'ignore' });
const sock = `${D}/${hostId}.sock`;
for (let i = 0; i < 50 && !fs.existsSync(sock); i++) await new Promise((r) => setTimeout(r, 100));
const c = net.connect(sock);
let buf = '';
c.on('data', (d) => { buf += d; });
c.on('connect', () => c.write(JSON.stringify({ t: 'spawn', command: '/bin/true', args: [], cwd: `${D}/gone`, env: { PATH: '/usr/bin:/bin' }, appSessionId: 'athena-probe', userId: 1, profile: null }) + '\n'));
await new Promise((r) => host.on('exit', r));
const exit = buf.trim().split('\n').map((l) => JSON.parse(l)).find((f) => f.t === 'exit');
console.log('exit frame error:', exit?.error ?? 'none', '| names the missing folder:', String(exit?.error).includes('/gone'));
process.exit(0);
JS
node "$D/c.mjs" "$D" "$H"
EOF
bash "$D/p.sh" "$D"
cd /tmp && case "$D" in /tmp/athena-probe.*) rm -r "$D";; esac
echo "[probe exit $?]"
expect: `exit frame error: spawn /bin/true ENOENT | names the missing folder: false` while the defect stands (the binary exists; the folder does not); `… names the missing folder: true` once the host says which folder
```

measured 2026-10-09 by chain chain-cloudcli-missing-project-folder-20261009-143553-aa0c, finding M1, MEDIUM
probe-key: d0a4ea7092246c408b6aa5f19c28da2a485ad19e

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-project-folder.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host-frames.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host-journal.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host.js

## INV-7559 — probe — The new paragraph sits in a row that governs neither file it describes, so the house's file-to-row lookup never shows it

The new paragraph sits in a row that governs neither file it describes, so the house's file-to-row lookup never shows it

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
for f in claude-project-folder.ts claude-runtime.provider.js; do
  docstore govern server/modules/providers/list/claude/$f | python3 -I -c "
import sys, json
rows = json.load(sys.stdin)['rows']
hit = sorted(r['token'] for r in rows if 'A chat whose project folder is gone' in r['body'])
print('$f', 'surfaces the folder paragraph in', hit or 'NO row')"
done
docstore get MAN-699 | python3 -I -c "
import sys, json
r = json.load(sys.stdin)['row']
print('MAN-699 governs the two files:', any(g.endswith('claude-project-folder.ts') for g in r['governs']), any(g.endswith('claude-runtime.provider.js') for g in r['governs']))"
EOF
bash "$D/p.sh"
cd /tmp && case "$D" in /tmp/athena-probe.*) rm -r "$D";; esac
echo "[probe exit $?]"
expect: both files print `NO row` and `governs the two files: False False` while the defect stands; each file names MAN-699 (or the row it moved to) once cured
```

measured 2026-10-09 by chain chain-cloudcli-missing-project-folder-20261009-143553-aa0c, finding L1, LOW
probe-key: 199ac784e11a840797805a4886e7b1c0ae697fac

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-project-folder.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host-frames.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host-journal.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/session-host/host.js

## INV-7560 — probe — the composer has two token readers; the history answers `post_tokens`, the route answers 0 on the same transcript, and the docs say nothing of it

the composer has two token readers; the history answers `post_tokens`, the route answers 0 on the same transcript, and the docs say nothing of it

```probe
D=$(mktemp -d /tmp/athp-m1.XXXXXX) || exit 1
cat > "$D/m1.mts" <<'EOF'
import fs from 'node:fs';
import { sessionCompactionsDb } from '@/modules/database/index.js';
import { stitchCompactedHistory, withOpeningContext } from '/home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-compacted-history.ts';
import { createProviderTokenUsageService, summarizeClaudeTokenUsage } from '@/modules/providers/services/provider-token-usage.service.js';
const file = process.argv[2] + '/P.jsonl';
const rows = [
  { type: 'queue-operation', sessionId: 'P' },
  { type: 'attachment', uuid: 'a1', parentUuid: null, sessionId: 'P' },
  { type: 'user', uuid: 'seed', parentUuid: 'a1', sessionId: 'P', queueTranscriptOnly: true, message: { role: 'user', content: [{ type: 'text', text: 'SUMMARY' }, { type: 'text', text: 'HANDOVER' }] } },
];
fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
(sessionCompactionsDb as any).listCompactions = () => [{ oldProviderSessionId: 'OLD', oldJsonlPath: '/nowhere.jsonl', sessionId: 'CHAT', createdAt: '2026-10-09T10:00:00.000Z', postTokens: 36057 }];
const read = async (p: string, sid: string) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.sessionId === sid);
const stitched = await stitchCompactedHistory({ sessionId: 'CHAT', liveTranscriptPath: file, liveProviderSessionId: 'P', readTranscriptRows: async (p, sid) => (p === file ? read(p, sid) : []) });
const history = withOpeningContext(summarizeClaudeTokenUsage(stitched.liveRows), stitched.openingContextTokens);
const route = await createProviderTokenUsageService({ getSessionById: () => ({ session_id: 'CHAT', provider: 'claude', provider_session_id: 'P', jsonl_path: file }) as any, isProviderSessionSuperseded: () => false }).getSessionTokenUsage('CHAT');
console.log(`history used=${history.used} route used=${route.used} ${history.used === route.used ? 'AGREE' : 'DISAGREE'}`);
process.exit(0);
EOF
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
TSX_TSCONFIG_PATH=server/tsconfig.json timeout 120 node --import tsx "$1/m1.mts" "$1" 2>&1 | tail -3
EOF
bash "$D/p.sh" "$D"
```

measured 2026-10-09 by chain chain-compaction-handover--history-20261009-141900-ed06, finding M1, MEDIUM
probe-key: 7c1e71a9cf4f1f29129a048ccbaeba155e2a6177

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/compaction-opening-history.sh

## INV-7561 — probe — the runtime bullet says `full` is "within ~300" of the next request; in the app's append it is 1,758 high, on every chat I measured

the runtime bullet says `full` is "within ~300" of the next request; in the app's append it is 1,758 high, on every chat I measured

```probe
D=$(mktemp -d /tmp/athp-l1.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
bash .verify/compaction-opening-history.sh > "$1/out" 2>&1
post=$(sed -n "s/^the record's post_tokens: //p" "$1/out" | head -1)
next=$(grep -o "turn-end contextTokens=[0-9]*" "$1/out" | tail -1 | cut -d= -f2)
echo "post_tokens=${post:-none} first_request_after=${next:-none} gap=$(( ${post:-0} - ${next:-0} ))"
EOF
bash "$D/p.sh" "$D"
```

measured 2026-10-09 by chain chain-compaction-handover--history-20261009-141900-ed06, finding L1, LOW
probe-key: c526eabd62fb908ea9267a5175f93aa466a7a38f

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/compaction-opening-history.sh

## INV-7562 — probe — MAN-8068 still says "the second block is not drawn"; the seed the app writes now has four

MAN-8068 still says "the second block is not drawn"; the seed the app writes now has four

```probe
grep -n "the second block is not drawn" /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/MANUAL.md || echo gone
```

measured 2026-10-09 by chain chain-compaction-handover--history-20261009-141900-ed06, finding L2, LOW
probe-key: 643fa2ca0dbc52ff21916e516b7e2b3a7fa5c18b

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/compaction-opening-history.sh

## INV-7563 — probe — the script can pass while the placeholder is drawn, and its one check treats two empty strings as equal

the script can pass while the placeholder is drawn, and its one check treats two empty strings as equal

```probe
sed -n '/^banner "3\./,$p' /home/lyphe/.claude/claudecodeui_lyphe/.verify/compaction-opening-history.sh | grep -c 'fail "'
```

measured 2026-10-09 by chain chain-compaction-handover--history-20261009-141900-ed06, finding L3, LOW
probe-key: 9c228e38bd2843920904bb1618ef41ac6cd396f9

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/compaction-opening-history.sh

## INV-7566 — probe — MEDIUM — the "no acknowledgement" check cannot see the seed's own words, and was never shown able to fail

MEDIUM — the "no acknowledgement" check cannot see the seed's own words, and was never shown able to fail

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
D2=$(dirname "$0")
{
  grep -m1 '^const ACKNOWLEDGES' .verify/lib/handover-whole.mjs
  cat <<'JS'
const cases = [
  ['control: got compacted', 'Okay I got compacted. The code word is zorblax-1.'],
  ['preamble echo: ran out of context', 'Continuing from a conversation that ran out of context, the code word is zorblax-1.'],
  ['preamble echo: previous conversation', 'From our previous conversation, the code word is zorblax-1.'],
  ['continuing from where we left off', 'Continuing from where we left off, the code word is zorblax-1.'],
];
for (const [label, text] of cases) console.log(String(ACKNOWLEDGES.test(text)).padEnd(6), label);
JS
} > "$D2/t.mjs"
node "$D2/t.mjs"
EOF
bash "$D/p.sh"
expect: the control prints true and the three phrases of the seed's own preamble print false (cured when they print true)
```

measured 2026-10-09 by chain chain-compaction-handover--whole-20261009-154527-c396, finding M1, MEDIUM
probe-key: 87cb891f3dfdf0af75d0d73ddce35ac42eea7764

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/compaction-handover-whole.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/custom-compaction-chat.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/custom-compaction-whole.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/handover-whole.mjs

## INV-7567 — probe — MEDIUM — the planted skill has one fixed name, and any `--leg delete` removes it: a concurrent edit run kills a live whole run

MEDIUM — the planted skill has one fixed name, and any `--leg delete` removes it: a concurrent edit run kills a live whole run

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "skill name : $(grep -m1 '^const COMMAND_NAME' .verify/lib/handover-whole.mjs)"
echo "delete leg : $(grep -n 'removeCommand()' .verify/compaction-handover-chat.mjs | head -2 | tr '\n' ' ')"
echo "edit script: $(grep -c -- '--leg delete' .verify/compaction-handover.sh) delete-leg call(s), $(grep -m1 -o 'PROBE_PORT:-[0-9]*' .verify/compaction-handover.sh)"
EOF
bash "$D/p.sh"
expect: COMMAND_NAME is the literal 'handover-recall', deleteLeg calls removeCommand() with no owner check, and compaction-handover.sh (default port 7895, beside this script's 7893) runs --leg delete twice (cured: a per-run name, or delete removes only what its own run planted)
```

measured 2026-10-09 by chain chain-compaction-handover--whole-20261009-154527-c396, finding M2, MEDIUM
probe-key: 9989ab9aebd8cd69f9cde6f88bc49fd1920c540c

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/compaction-handover-whole.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/custom-compaction-chat.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/custom-compaction-whole.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/handover-whole.mjs

## INV-7568 — probe — LOW — the time check cannot tell "each under its own time" from "all under one time", and its bound admits a minute-early stamp

LOW — the time check cannot tell "each under its own time" from "all under one time", and its bound admits a minute-early stamp

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "time bound : $(grep -m1 -o 'delta > -20 && delta < 80' .verify/lib/handover-whole.mjs || echo none)"
node -e 'const delta = 10 + 60; console.log("a stamp one minute before a send made 10 s into its minute: delta =", delta, "accepted =", delta > -20 && delta < 80)'
EOF
bash "$D/p.sh"
expect: the bound line prints and a minute-early stamp is accepted (accepted = true); cured when the upper bound is 60 or less
```

measured 2026-10-09 by chain chain-compaction-handover--whole-20261009-154527-c396, finding L1, LOW
probe-key: 3c251b3b02cfa48bc3c04dc94b12fcfb4800b894

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/compaction-handover-whole.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/custom-compaction-chat.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/custom-compaction-whole.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/handover-whole.mjs

## INV-7569 — probe — LOW — MAN-8134 says the whole takes "about six minutes"; it takes about two

LOW — MAN-8134 says the whole takes "about six minutes"; it takes about two

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
docstore get MAN-8134 | grep -o 'about [a-z]* minutes' | head -1 || echo none
EOF
bash "$D/p.sh"
expect: prints "about six minutes" while the doc is wrong; measured runs are 109 s and 116 s (cured when it names about two minutes)
```

measured 2026-10-09 by chain chain-compaction-handover--whole-20261009-154527-c396, finding L2, LOW
probe-key: 46ca1f0fa5f867ffa0557fe71633e6c998b59da2

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/compaction-handover-whole.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/custom-compaction-chat.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/custom-compaction-whole.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/handover-whole.mjs

## INV-7570 — probe — LOW — `custom-compaction-whole.sh` has no port guard, though MAN-8134 now says the two scripts "never run together"

LOW — `custom-compaction-whole.sh` has no port guard, though MAN-8134 now says the two scripts "never run together"

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "port guard (ss -ltnH): custom-compaction-whole.sh $(grep -c 'ss -ltnH' .verify/custom-compaction-whole.sh), compaction-handover-whole.sh $(grep -c 'ss -ltnH' .verify/compaction-handover-whole.sh)"
EOF
bash "$D/p.sh"
expect: custom-compaction-whole.sh 0, compaction-handover-whole.sh 1 (cured when the first is 1 or more)
```

measured 2026-10-09 by chain chain-compaction-handover--whole-20261009-154527-c396, finding L3, LOW
probe-key: d0c74069b7795613603099d1b2cf9fea0cf1b92b

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/compaction-handover-whole.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/custom-compaction-chat.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/custom-compaction-whole.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/handover-whole.mjs

## INV-7571 — probe — LOW — the whole leg prints the appended row's blocks but never compares them with the stored seed

LOW — the whole leg prints the appended row's blocks but never compares them with the stored seed

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "append==seed comparison: whole leg $(grep -c 'textsOf(append)' .verify/lib/handover-whole.mjs), edit leg $(grep -c 'textsOf(append)' .verify/compaction-handover-chat.mjs)"
EOF
bash "$D/p.sh"
expect: whole leg 0, edit leg 1 (cured when the whole leg is 1 or more)
```

measured 2026-10-09 by chain chain-compaction-handover--whole-20261009-154527-c396, finding L4, LOW
probe-key: 7047ebc9addb3fe0369620cf8abf71daffd3700d

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/compaction-handover-whole.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/custom-compaction-chat.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/custom-compaction-whole.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/handover-whole.mjs

## INV-7572 — probe — MAN-8046 says the table is "Empty today"; it holds five rows

MAN-8046 says the table is "Empty today"; it holds five rows

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
echo "rows in superseded_provider_sessions: $(sqlite3 ~/.cloudcli/auth.db 'select count(*) from superseded_provider_sessions')"
echo "MAN-8046 lines saying 'Empty today': $(~/.claude/scripts/docstore get MAN-8046 --text | grep -c 'Empty today')"
EOF
bash "$D/p.sh"
cd /tmp; case "$D" in /tmp/athena-p.??????) rm -r "$D";; esac
expect: `rows … : 5` and `lines saying 'Empty today': 1` while the row is wrong; cured when that count is 0 (or the row states the count it holds)
```

measured 2026-10-09 by chain chain-compaction-handover--docs-20261009-165748-35f0, finding L1, LOW
probe-key: 3b2ca4e099ad72cf02279383bb42ce324930dd53

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/migrations.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/session-compactions.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts

## INV-7573 — probe — a comment in the runtime says `full` counts "to within ~300"; the row it sits under, and 9 of 9 measurements, say otherwise

a comment in the runtime says `full` counts "to within ~300"; the row it sits under, and 9 of 9 measurements, say otherwise

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "comment says 'counts it to within ~300': $(grep -c 'counts it to within ~300' server/modules/providers/list/claude/claude-runtime.provider.js)"
E=/tmp/compaction-handover-whole.RmHm0M
[ -f "$E/whole/whole.txt" ] || { echo "evidence directory gone"; exit 0; }
python3 -I - "$E" <<'PY'
import json, re, sys
base = sys.argv[1] + "/whole/"
posts = [int(x) for x in re.findall(r"post_tokens=(\d+)", open(base + "whole.txt").read())[:2]]
def first_request(path):
    for line in open(path):
        try: r = json.loads(line)
        except ValueError: continue
        u = (r.get("message") or {}).get("usage") if r.get("type") == "assistant" else None
        if u and r["message"].get("model") != "<synthetic>":
            return u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0) + u.get("cache_read_input_tokens", 0)
for name, post in zip(["stretch-2.jsonl", "stretch-3.jsonl"], posts):
    first = first_request(base + name)
    print(name, "post_tokens", post, "first request", first, "gap", post - first)
PY
EOF
bash "$D/p.sh"
cd /tmp; case "$D" in /tmp/athena-p.??????) rm -r "$D";; esac
expect: `comment says … : 1` and gaps 2075 and 2141 while the comment says ~300; cured when the comment names the measured offset (count 0) — `evidence directory gone` means /tmp was swept, re-measure on a fresh whole run
```

measured 2026-10-09 by chain chain-compaction-handover--docs-20261009-165748-35f0, finding L2, LOW
probe-key: 76f8639a8315ad3934e306bfa88f8208f5594039

governs: /home/lyphe/.claude/claudecodeui_lyphe/

## INV-7574 — probe — `compaction-runtime.ts:69` still points at the retired "reply to the seed"; the row that governs it dropped the same sentence

`compaction-runtime.ts:69` still points at the retired "reply to the seed"; the row that governs it dropped the same sentence

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
grep -n "reply to the seed" server/modules/compaction/compaction-runtime.ts || echo none
EOF
bash "$D/p.sh"
cd /tmp; case "$D" in /tmp/athena-p.??????) rm -r "$D";; esac
expect: `69: * reply to the seed, so it never starts over.` while it stands; `none` once the comment and MAN-8067 say the same thing about a record with no stored seed
```

measured 2026-10-09 by chain chain-compaction-handover--docs-20261009-165748-35f0, finding L3, LOW
probe-key: 933db6d0dd228f1703edca566df2af9f9a029a6d

governs: /home/lyphe/.claude/claudecodeui_lyphe/

## INV-7575 — probe — the report says none of the three earlier-shape messages appears verbatim anywhere in the new `84a97950` seed; one appears whole, in block 0

the report says none of the three earlier-shape messages appears verbatim anywhere in the new `84a97950` seed; one appears whole, in block 0

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
python3 -I - <<'PY'
import sys, json, os, re
sys.path.insert(0, "/home/lyphe/.claude/hooks")
from plan_runner.summarize import render, rows
P = os.path.expanduser("~/.claude/projects/-home-lyphe--claude/")
sid = "84a97950-c636-4d29-a72d-a054226a9f15"
seed = json.load(open("/home/lyphe/.claude/state/summarize/summarize-1791579024310-3393540/result.json"))["seed"]
old = next(render.row_seed(r) for r in rows.live_rows(P + sid + ".jsonl", sid) if render.row_seed(r) is not None)
for piece in re.split(r"\n\n(?=### )", old.earlier):
    lines = piece.splitlines()
    if lines[0] == "### User" and not lines[1].startswith("<task-notification>"):
        body = "\n".join(lines[1:]).strip()
        print(len(body), "chars; whole text in the new seed's blocks:", [i for i, b in enumerate(seed) if body in b] or "none")
PY
EOF
bash "$D/p.sh"
cd /tmp; case "$D" in /tmp/athena-p.??????) rm -r "$D";; esac
expect: `198 … none`, `1217 … none`, `151 … [0]`
```

measured 2026-10-09 by chain chain-compaction-handover--docs-20261009-165748-35f0, finding L4, LOW
probe-key: e6852f37a3718584776643cb3876c453c74c9664

governs: /home/lyphe/.claude/claudecodeui_lyphe/

## INV-7576 — probe — two same-named projects in the same parent folder get the SAME hint

two same-named projects in the same parent folder get the SAME hint

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/h.mts" <<'EOF'
import { projectNameHints } from '/home/lyphe/.claude/claudecodeui_lyphe/src/shared/projectNameHints.ts';
const list = [
  { projectId: 'a', displayName: 'repo', fullPath: '/home/me/foo' },
  { projectId: 'b', displayName: 'repo', fullPath: '/home/me/repo' },
];
const hints = projectNameHints(list);
console.log('hints:', JSON.stringify([...hints.values()]), 'distinct:', new Set(hints.values()).size === list.length);
EOF
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
node_modules/.bin/tsx "$1/h.mts"
EOF
bash "$D/p.sh" "$D"
cd /tmp; case "$D" in /tmp/athena-p.??????) rm -r "$D";; esac
echo "[probe exit $?]"
expect: `hints: ["home/me","home/me"] distinct: false` while the defect stands; cured when it prints `distinct: true`
```

measured 2026-10-09 by chain chain-project-name-hints-20261009-205007-0d30, finding H1, HIGH
probe-key: a9cf1905094868acdff61654c16d04316014adb0

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/projectNameHints.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/project-name-hints.mjs

## INV-7577 — probe — a folder that vanishes while the page is open is never marked or withdrawn until a full reload

a folder that vanishes while the page is open is never marked or withdrawn until a full reload

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "isFolderMissing mentions in useProjectsState.ts (the file whose projectsHaveChanges decides whether a refreshed list replaces the held one): $(grep -c 'isFolderMissing' src/modules/project-workspace/hooks/useProjectsState.ts)"
echo "[probe exit $?]"
expect: `…: 0` while the defect stands (measured in the browser, see athena-1-evidence/stale.mjs and stale2.mjs); cured when it is at least 1 and the refresh click in stale.mjs shows the note on `vanishing`
```

measured 2026-10-09 by chain chain-project-name-hints-20261009-205007-0d30, finding H2, HIGH
probe-key: 551665cde7e4a960fe6532a7caf8b061505c4bc5

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/projectNameHints.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/project-name-hints.mjs

## INV-7578 — probe — a long hint wraps and hard-clips in the dropdown row, with no ellipsis

a long hint wraps and hard-clips in the dropdown row, with no ellipsis

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "overflow/ellipsis rules on .vv-select__hint or .vv-select__option in controls.css: $(grep -E 'vv-select__(hint|option)\b' src/shared/ui/verve/controls.css | grep -c -E 'ellipsis|overflow|word-break|overflow-wrap')"
echo "[probe exit $?]"
expect: `…: 0` while the defect stands (measured: option scrollWidth 543 > clientWidth 242 at 320 px); cured when the hint or the row has an overflow rule and the long-hint dropdown shows an ellipsis
```

measured 2026-10-09 by chain chain-project-name-hints-20261009-205007-0d30, finding L1, LOW
probe-key: ba083d2d48a6c36e8edd91bf04f16d9ec16df41b

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/projectNameHints.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/project-name-hints.mjs

## INV-7579 — probe — Settings' "default project for new chats" picker still names projects by bare name and lists gone folders

Settings' "default project for new chats" picker still names projects by bare name and lists gone folders

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "hint/mark uses in AppearanceSettingsTab.tsx: $(grep -c -E 'nameHint|projectNameHints|isFolderMissing' src/modules/settings/tabs/AppearanceSettingsTab.tsx)"
echo "[probe exit $?]"
expect: `…: 0` while the picker names projects bare; cured when it is at least 1
```

measured 2026-10-09 by chain chain-project-name-hints-20261009-205007-0d30, finding L2, LOW
probe-key: ad28409cfb495d8ccfcadaa15a1b52ee41166f85

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/projectNameHints.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/project-name-hints.mjs

## INV-7586 — probe — MEDIUM — a lifted row cannot reach any row beyond the pane: the pane is frozen and nothing scrolls it

MEDIUM — a lifted row cannot reach any row beyond the pane: the pane is frozen and nothing scrolls it

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/simple-list-hold-to-drag/athena-probes/run.sh edge.mjs
echo "[probe exit $?]"
expect: the second line reads `scrollTop = 0` while the defect stands (the pane never moves under a parked, lifted finger); `scrollTop` above 0 once a carry scrolls the pane at its edge
```

measured 2026-10-10 by chain chain-simple-list-hold-to-drag-20261009-233125-3a36, finding M1, MEDIUM
probe-key: ab3f220eaa510899af539351207eb41ffafa5884

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useCarryEdgeScroll.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleListRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/touchLift.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/touch-input.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-hold-to-drag.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-hold-to-drag-scratch.sh

## INV-7587 — probe — MEDIUM — a hold on a status icon inside a `Tooltip` opens the tooltip AND lifts the row

MEDIUM — a hold on a status icon inside a `Tooltip` opens the tooltip AND lifts the row

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/simple-list-hold-to-drag/athena-probes/run.sh tooltip.mjs
echo "[probe exit $?]"
expect: `at 700 ms lifted=["run"] tooltip=true` while the defect stands; `lifted=[]` once a press on a status icon is turned away (the tooltip may still open)
```

measured 2026-10-10 by chain chain-simple-list-hold-to-drag-20261009-233125-3a36, finding M2, MEDIUM
probe-key: adb6fcab46efd5858d0eac70b40475b0e12c99eb

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useCarryEdgeScroll.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleListRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/touchLift.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/touch-input.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-hold-to-drag.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-hold-to-drag-scratch.sh

## INV-7588 — probe — LOW — a press on the blank part of the row's open action menu lifts the row behind it

LOW — a press on the blank part of the row's open action menu lifts the row behind it

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/simple-list-hold-to-drag/athena-probes/run.sh menu.mjs
echo "[probe exit $?]"
expect: `lifted=["<session id>"] body="vv-dragging vv-drag-sort"` while the defect stands; `lifted=[]` once a press from a portal is refused
```

measured 2026-10-10 by chain chain-simple-list-hold-to-drag-20261009-233125-3a36, finding L1, LOW
probe-key: a3dcd5ff76dbd62c5cefe14a38e6b802bff396fb

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useCarryEdgeScroll.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/SidebarSimpleListRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/touchLift.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/touch-input.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-hold-to-drag.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/simple-list-hold-to-drag-scratch.sh

## INV-7979 — probe — a follow-up turn's result releases the OLDEST hold even when a notification already released the call that woke it

a follow-up turn's result releases the OLDEST hold even when a notification already released the call that woke it

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
F=server/modules/providers/list/claude/claude-runtime.provider.js
sed -n '/A result no client is waiting on/,/for (const id of launchedThisTurn)/p' "$F" | grep -n "oldest\|abortPending\|notified\|released" || echo "block not found"
EOF
bash "$D/p.sh"
cd /tmp; case "$D" in /tmp/athena-p.??????) rm -r "$D";; esac
echo "[probe exit $?]"
expect: lines 11-13 show `release it: its own follow-up turn does, oldest first.`, `const oldest = deferredTools.values().next();` and `if (!oldest.done) deferredTools.delete(oldest.value);` with no test of whether a task_notification already released the call that woke this turn; cured when a guard of that kind appears. Dynamic shape (scratch stack, 2026-10-12): two background Bash calls (`sleep 110`, `sleep 5`) in one turn → after the short one's follow-up turn the idle closer logs `tasks=1, deferred=0` while the long one runs.
```

measured 2026-10-12 by chain chain-chat-busy-ledger-20261012-105339-80e5, finding M1, MEDIUM
probe-key: 7ca27a952a6523848a29ee5fcb33608395a31d37

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-busy-ledger.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-busy-ledger.sh

## INV-7981 — probe — MAN-8066 says the retry runs "once" in one place and repeatedly in another

MAN-8066 says the retry runs "once" in one place and repeatedly in another

```probe
~/.claude/scripts/docstore get MAN-8066 --text | grep -c "decided again once"
echo "[probe exit $?]"
expect: `1` while the table row says "decided again once"; cured when it says the decision is made again at each quiet (the start still at most once).
```

measured 2026-10-12 by chain chain-chat-busy-ledger-20261012-105339-80e5, finding L2, LOW
probe-key: 71755261c477faa21fbb80d19f2755c501d8be96

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-busy-ledger.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-busy-ledger.sh

## INV-7982 — probe — MAN-687 carries a history pointer

MAN-687 carries a history pointer

```probe
~/.claude/scripts/docstore get MAN-687 --text | grep -c "used to move into the list anyway"
echo "[probe exit $?]"
expect: `1` while the pointer stands; cured at 0.
```

measured 2026-10-12 by chain chain-chat-busy-ledger-20261012-105339-80e5, finding L3, LOW
probe-key: a84fe822dd68800e6363c527052331b18aef6aa7

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-busy-ledger.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-busy-ledger.sh

## INV-8001 — probe — a restored deadline compacts a chat whose background subagent is running, and kills it

a restored deadline compacts a chat whose background subagent is running, and kills it

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/idle-deadline-restart/athena-probe-agent-midwork.sh
echo "[probe exit $?]"
expect: `decision line seen: … activity=idle decision=idle, starting the compaction`, `python sleep alive at the decision: 2` and `alive 20 s after the decision: 0` while the defect stands; cured when the decision reads `left alone: the process is busy` (and the command stays alive). ~100 s, one Haiku chat plus one Haiku subagent, scratch server on :7934.
```

measured 2026-10-12 by chain chain-idle-deadline-restart-20261012-125005-5a74, finding H1, HIGH
probe-key: 686d8d713d46ca559fe30c94b79c96f4bb32fd2a

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/idle-restore.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-idle-restore.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-idle-restore.sh

## INV-8002 — probe — several overdue chats start their compactions at the same instant

several overdue chats start their compactions at the same instant

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/idle-deadline-restart/athena-probe-stampede.sh
echo "[probe exit $?]"
expect: `start #1 at +15.0 s after boot`, `start #2 at +15.0 s after boot`, `start #3 at +15.0 s after boot` (three within the same second) while the defect stands; cured when the starts are spread or limited. ~110 s, three Haiku chats, scratch server on :7936.
```

measured 2026-10-12 by chain chain-idle-deadline-restart-20261012-125005-5a74, finding M1, MEDIUM
probe-key: 15316bddcc490e87384d99b3d2dff7d551e45e14

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/idle-restore.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-idle-restore.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-idle-restore.sh

## INV-8003 — probe — a refusal or failure is forgotten at every restart, so the chat is retried at every boot

a refusal or failure is forgotten at every restart, so the chat is retried at every boot

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/idle-deadline-restart/athena-probe-refusal-per-boot.sh
echo "[probe exit $?]"
expect: `boot 2: starts=1 refusals=1` and `boot 3: starts=1 refusals=1` while the defect stands (the refusal is forgotten at the restart); cured when boot 3 reads `starts=0`. ~100 s, one Haiku chat, scratch server on :7935.
```

measured 2026-10-12 by chain chain-idle-deadline-restart-20261012-125005-5a74, finding M2, MEDIUM
probe-key: e9bd2e0811e379e7c1981b7c36c857cfe6e804c4

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/idle-restore.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-idle-restore.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/chat-idle-restore.sh

## INV-8053 — probe — a node on a warden older than 0.12.0 is taken over with an empty live-task ledger; a running CLI task can be compacted over

a node on a warden older than 0.12.0 is taken over with an empty live-task ledger; a running CLI task can be compacted over

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) && cat > "$D/p.sh" <<'EOF'
#!/usr/bin/env bash
# A host whose journal shows a CLI task running (task_started, no task_notification), listed by the warden release the node had before
# 0.12.0 and by the repo's, each read the way center reads a listing (`readNodeHost`). A node on 0.11.0 lists no `liveTasks`.
set -u
REPO=/home/lyphe/.claude/claudecodeui_lyphe
S=$(mktemp -d /tmp/athena-probe-mixed.XXXXXX) || exit 1
tmux -L athena-probe-tmux -f /dev/null new-session -d -s athena-probe-mixed sleep 120 || { rmdir "$S"; exit 1; }
cat > "$S/run.mts" <<'TS'
const { readNodeHost } = await import(`${process.env.REPO}/server/modules/cerberus/node-host-reading.ts`);
for (const [label, root] of [['warden 0.11.0', `${process.env.HOME}/.cerberus-warden/releases/0.11.0`], ['warden 0.12.0', process.env.REPO!]] as const) {
  const { createHostRegistry } = await import(`${root}/server/modules/providers/list/claude/session-host/host-registry.js`);
  const registry = createHostRegistry({ tmuxSocketName: 'athena-probe-tmux', keepaliveSession: '_keepalive', sessionsDir: process.env.SESS! });
  const read = registry.listLiveHosts().map((h: object) => readNodeHost(JSON.parse(JSON.stringify(h))));
  console.log(`${label}: the task the journal shows running reads at center as liveTasks=${JSON.stringify(read[0]?.liveTasks)}`);
}
TS
python3 -I - "$S" <<'PY'
import json, sys
s = sys.argv[1]; h = 'athena-probe-mixed'
line = lambda seq, o: json.dumps({'t': 'out', 'seq': seq, 'at': 1791900000000 + seq, 'line': json.dumps(o, separators=(',', ':'))}, separators=(',', ':'))
open(f'{s}/{h}.ndjson', 'w').write('\n'.join([line(1, {'type': 'result', 'subtype': 'success', 'modelUsage': {}}), line(2, {'type': 'system', 'subtype': 'task_started', 'task_id': 'bg-watch-1'})]) + '\n')
json.dump({'hostId': h, 'appSessionId': 'athena-probe', 'userId': 1, 'cwd': '/tmp', 'startedAt': 1, 'turnCompleteSent': True, 'heldForBackgroundWork': False, 'deferredTools': [], 'exited': None, 'pid': 1, 'profile': None, 'deliveredSeq': 1, 'pendingResults': [], 'pendingControl': []}, open(f'{s}/{h}.json', 'w'))
PY
(cd /tmp && REPO="$REPO" SESS="$S" "$REPO/node_modules/.bin/tsx" --tsconfig "$REPO/server/tsconfig.json" "$S/run.mts" 2>&1 | tail -3)
tmux -L athena-probe-tmux kill-server 2>/dev/null
case "$S" in /tmp/athena-probe-mixed.*) rm -rf "$S";; esac
EOF
bash "$D/p.sh"; case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
echo "[probe exit $?]"
expect: `warden 0.11.0: … liveTasks=[]` and `warden 0.12.0: … liveTasks=["bg-watch-1"]` while the defect stands; cured when center no longer reads a listing with no `liveTasks` as an empty ledger (the 0.11.0 line prints something other than `[]`, e.g. `null`) or a node whose warden does not list it is refused the takeover
```

measured 2026-10-13 by chain chain-node-chat-compaction-20261013-103559-d5e3, finding M1, MEDIUM
probe-key: 0bdc44559e3715d4f93811a0f9774114efa5770b

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/node-host-reading.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/node-sessions.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-mode.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/node-task-ledger.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-node-compaction.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/package.json, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/last-turn.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/sessions.mjs

## INV-8054 — probe — the warden's choice of "the turn's request" differs from the server's for a request that reports zero tokens

the warden's choice of "the turn's request" differs from the server's for a request that reports zero tokens

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) && cat > "$D/p.sh" <<'EOF'
#!/usr/bin/env bash
# The warden lists a host's last main-thread request with its own selection (warden/src/last-turn.mjs); the server's reading of a
# local host's journal also drops a request that reports no tokens. Same journal, newest request reporting zero tokens and not synthetic.
set -u
S=$(mktemp -d /tmp/athena-probe-last.XXXXXX) || exit 1
cat > "$S/run.mjs" <<'JS'
import fs from 'node:fs';
const REPO = '/home/lyphe/.claude/claudecodeui_lyphe';
const { createHostRegistry } = await import(`${REPO}/server/modules/providers/list/claude/session-host/host-registry.js`);
const { listedLastTurn } = await import(`${REPO}/warden/src/last-turn.mjs`);
const dir = process.argv[2];
const out = (seq, o) => JSON.stringify({ t: 'out', seq, at: 1791900000000 + seq, line: JSON.stringify(o) });
const asst = (usage) => ({ type: 'assistant', parent_tool_use_id: null, message: { model: 'claude-opus-5-5', usage, content: [] } });
const lines = [
  out(1, asst({ input_tokens: 5, cache_read_input_tokens: 141000, output_tokens: 317 })),
  out(2, asst({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 })),
  out(3, { type: 'result', subtype: 'success', modelUsage: {} }),
];
fs.writeFileSync(`${dir}/h.ndjson`, lines.join('\n') + '\n');
const registry = createHostRegistry({ tmuxSocketName: 'athena-no-such-server', keepaliveSession: '_keepalive', sessionsDir: dir });
const used = (u) => ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'].reduce((n, k) => n + (Number(u?.[k]) || 0), 0);
// the server's reading of a LOCAL host's journal (mainThreadBudgetOf + extractTokenBudget): a request with used <= 0 is skipped
const local = registry.lastTurnRecord('h', (m) => (m.type === 'assistant' && !m.parent_tool_use_id && m.message?.model !== '<synthetic>' && used(m.message?.usage) > 0 ? { used: used(m.message.usage) } : null));
const listed = listedLastTurn(registry, 'h');
console.log(`local host's context: ${local?.budget?.used ?? 'none'} | node host's request as listed: ${listed?.request ? used(listed.request.message.usage) : 'none'} tokens`);
JS
node "$S/run.mjs" "$S" 2>&1 | tail -3
case "$S" in /tmp/athena-probe-last.*) rm -rf "$S";; esac
EOF
bash "$D/p.sh"; case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
echo "[probe exit $?]"
expect: `local host's context: 141322 | node host's request as listed: 0 tokens` while the defect stands; cured when the listed request is the earlier one (`… listed: 141322 tokens`)
```

measured 2026-10-13 by chain chain-node-chat-compaction-20261013-103559-d5e3, finding L1, LOW
probe-key: e0158dd192bf472df4aca9f1bc38a81aade8407e

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/node-host-reading.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/node-sessions.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-mode.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/node-task-ledger.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-node-compaction.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/package.json, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/last-turn.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/sessions.mjs

## INV-8055 — probe — the 0.12.0 note does not name the third change that ships with it

the 0.12.0 note does not name the third change that ships with it

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) && cat > "$D/p.sh" <<'EOF'
#!/usr/bin/env bash
# What the delivered 0.12.0 carries that 0.11.0 did not, against what its one-line note says it carries.
R=$HOME/.cerberus-warden/releases
H=server/modules/providers/list/claude/session-host/host.js
echo "host.js lines naming the spawn-failure explanation, 0.11.0 -> 0.12.0: $(grep -c explainSpawnError "$R/0.11.0/$H") -> $(grep -c explainSpawnError "$R/0.12.0/$H")"
python3 -I - "$R/0.12.0/warden/package.json" <<'PY'
import json, sys
note = json.load(open(sys.argv[1]))["cerberus"]["note"]
print("the 0.12.0 note names it:", any(w in note.lower() for w in ("spawn", "cannot start", "could not start", "working folder", "never ran")))
PY
EOF
bash "$D/p.sh"; case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
echo "[probe exit $?]"
expect: `0 -> 2` and `the 0.12.0 note names it: False`; this stands for 0.12.0 for good (a delivered version is never re-noted); the probe is for the next release's note, which must name what its diff against 0.12.0 carries
```

measured 2026-10-13 by chain chain-node-chat-compaction-20261013-103559-d5e3, finding L2, LOW
probe-key: a680e7e83e035a83fe9590a12b22259cc353bcaa

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/node-host-reading.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/node-sessions.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-mode.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/node-task-ledger.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-node-compaction.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/package.json, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/last-turn.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/sessions.mjs

## INV-8056 — probe — the phases file still carries the removed `node` input of `takesOver`

the phases file still carries the removed `node` input of `takesOver`

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) && cat > "$D/p.sh" <<'EOF'
#!/usr/bin/env bash
grep -n 'takesOver({ appSessionId: sessionId ?? null, node' "$HOME/.claude/plans/custom-compaction.phases.toml" | cut -c1-140 || echo none
EOF
bash "$D/p.sh"; case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
echo "[probe exit $?]"
expect: a line starting `276:` while it stands; `none` once the line reads `takesOver({ appSessionId: sessionId ?? null })`
```

measured 2026-10-13 by chain chain-node-chat-compaction-20261013-103559-d5e3, finding L3, LOW
probe-key: c390a95442059689d1b4f24f9348ef92fc15d5ea

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/node-host-reading.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/node-sessions.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/compaction-mode.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/compaction/node-task-ledger.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/cerberus-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/cerberus-node-compaction.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/package.json, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/last-turn.mjs, /home/lyphe/.claude/claudecodeui_lyphe/warden/src/sessions.mjs

## INV-8336 — probe — a non-queue card dropped in the gutter takes its rank from a queue deck's, so the drop can be undone and queue decks get saved ranks

a non-queue card dropped in the gutter takes its rank from a queue deck's, so the drop can be undone and queue decks get saved ranks

```probe
D=$(mktemp -d /tmp/athena-probe-s21.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
cat > "$1/s21.mts" <<'EOT'
import { byArc } from '@/modules/dispatcher/dispatcherState';
import { ranksForMove, rankOf } from '@/modules/dispatcher/cardOrder';
const plan = (name: string, arc: string | null, created_at: string) => ({ name, arc, created_at }) as any;
const arc = (name: string, plans: string[], created_at: string, queue: any) => ({ name, plans, created_at, queue }) as any;
const arcs = [arc('Q1', ['q1p'], '2026-10-01T00:00:00Z', { position: 1, turn: 'now' }), arc('Q2', ['q2p'], '2026-10-02T00:00:00Z', { position: 2, turn: 'waiting' }), arc('D1', ['d1p'], '2026-10-07T00:00:00Z', null)];
const plans = [plan('q1p', 'Q1', '2026-10-01T00:00:00Z'), plan('q2p', 'Q2', '2026-10-02T00:00:00Z'), plan('d1p', 'D1', '2026-10-07T00:00:00Z'), plan('P1', null, '2026-10-06T00:00:00Z'), plan('P2', null, '2026-10-05T00:00:00Z')];
const nameOf = (c: any) => (c.kind === 'arc' ? c.group.arc.name : c.plan.name);
const ranks = new Map<string, number>();
const split = byArc(plans, arcs, ranks);
const cards = split.cards as any[];
const lineNames = new Set(split.line.map((g) => g.arc.name));
console.log('column:', cards.map(nameOf).join(' '));
for (const [label, at] of [['very top', 0], ['head of the non-queue region', 2]] as const) {
  const carried = 'P2';
  const rest = cards.map(nameOf).filter((n) => n !== carried);
  const order = [...rest.slice(0, at), carried, ...rest.slice(at)];
  const rankedOf = (n: string) => { const c = cards.find((x) => nameOf(x) === n); return rankOf(c.kind === 'arc' ? c.group.arc : c.plan, ranks); };
  const written = ranksForMove(carried, order, rankedOf);
  const after = byArc(plans, arcs, new Map(written.map((e) => [e.name, e.rank]))).cards.map(nameOf).filter((n: string) => !lineNames.has(n));
  console.log(`${label}: P2 lands first among the non-queue cards = ${after[0] === carried} (column below the queue: ${after.join(' ')}) | queue decks given a saved rank = ${written.filter((e) => lineNames.has(e.name)).length}`);
}
EOT
timeout 120 npx tsx --tsconfig tsconfig.json "$1/s21.mts" 2>&1 | tail -6
EOF
bash "$D/p.sh" "$D"; cd /tmp; case "$D" in /tmp/athena-probe-s21.*) rm -r "$D";; esac
expect: the "very top" line reads `P2 lands first … = false (column below the queue: D1 P1 P2)` and the "head of the non-queue region" line reads `… = true … | queue decks given a saved rank = 2` while the defect stands; cured, both read `= true` and `queue decks given a saved rank = 0`
```

measured 2026-10-15 by chain chain-epic-queue--fill-20261015-005844-c25e, finding M1, MEDIUM
probe-key: 871f731035c0aedcb504a14dc1bc6b46e127605b

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useVerbSend.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-epic-queue.mjs

## INV-8337 — probe — the probe's gutter leg cannot see the rank of a non-queue drop

the probe's gutter leg cannot see the rank of a non-queue drop

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe/.verify && grep -n "onRefuse" probe-epic-queue.mjs; grep -c "cardOrder" probe-epic-queue.mjs || echo none
expect: one `onRefuse: () => { session.preferenceWrites += 1; }` that reads no body, and `cardOrder` count 0 (the probe never reads a rank it wrote); cured, the probe names the written entry
```

measured 2026-10-15 by chain chain-epic-queue--fill-20261015-005844-c25e, finding L1, LOW
probe-key: d0f6fd8a3b390136c69b740eba5a358a1590e20b

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useVerbSend.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-epic-queue.mjs

## INV-8338 — probe — "a press in flight refuses a second (both steppers …)" proves `+` and the press, not `−`

"a press in flight refuses a second (both steppers …)" proves `+` and the press, not `−`

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe/.verify && sed -n '146p;307p' probe-epic-queue.mjs | cut -c1-200; grep -n "^  one: " lib/queue-lane.mjs | cut -c1-80
expect: `state: 'one'` at 146, the check reading `downOff === true && out.dial.upOff === true` at 307, and `one: { epics: { limit: '1' …` in queue-lane; cured, the in-flight check runs on a state whose `−` is enabled
```

measured 2026-10-15 by chain chain-epic-queue--fill-20261015-005844-c25e, finding L2, LOW
probe-key: a4d28acd07b9e5e291d3376f5377685df4b9f8c7

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useVerbSend.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-epic-queue.mjs

## INV-8339 — probe — `useVerbSend` says its options are read "when an answer lands"; they are read when the press starts

`useVerbSend` says its options are read "when an answer lands"; they are read when the press starts

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && awk '/latest.current;/{print "options read at line " NR} /await call\(\)/{print "await call() at line " NR}' src/modules/dispatcher/hooks/useVerbSend.ts; sed -n 20p src/modules/dispatcher/hooks/useVerbSend.ts | grep -o "Read at the moment an answer lands" || echo "doc corrected"
expect: `options read at line 89`, then `await call() at line 93`, then `Read at the moment an answer lands` while the doc stands; cured, the doc says the options are read when the press starts
```

measured 2026-10-15 by chain chain-epic-queue--fill-20261015-005844-c25e, finding L3, LOW
probe-key: 38aaa73018dcb21c5b7fbf1c8df885afab5c0d96

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useVerbSend.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-epic-queue.mjs

## INV-8344 — probe — the probe's key-presence checks cannot fail, and three checks name more than they test

the probe's key-presence checks cannot fail, and three checks name more than they test

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D="$1"
~/.claude/scripts/dispatcher status --json > "$D/doc.json"
python3 -I -c '
import json, sys
d = sys.argv[1]
doc = json.load(open(d + "/doc.json"))
for arc in doc["arcs"]: arc.pop("queue", None)
for plan in doc["plans"]: plan.pop("queue_hold", None)
doc["route"].pop("epics", None)
json.dump(doc, open(d + "/stripped.json", "w"))
' "$D"
cd ~/.claude/claudecodeui_lyphe && node_modules/.bin/tsx --tsconfig server/tsconfig.json .verify/lib/lane-picture.ts "$D/stripped.json" "$D/pic.json" > /dev/null
node -e '
const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
console.log("arcs with a `queue` key:", p.arcs.every((a) => "queue" in a), "| plans with a `queue_hold` key:", p.plans.every((a) => "queue_hold" in a), "| route.epics:", JSON.stringify(p.route.epics));
' "$D/pic.json" || echo none
EOF
bash "$D/p.sh" "$D"
cd /tmp && case "$D" in /tmp/athena-probe.*) rm -r "$D";; esac
```

measured 2026-10-15 by chain chain-epic-queue--whole-20261015-023028-6e9f, finding L1, LOW
probe-key: 22b343b5352702547ac0a19c38974dfc1d66eb92

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/epic-queue-live.mjs

## INV-8345 — probe — the "live" before/after witness reads whatever dial the caller's environment names

the "live" before/after witness reads whatever dial the caller's environment names

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D="$1"
printf 'limit 3\npaused yes\n' > "$D/epics.flag"
cd ~/.claude/claudecodeui_lyphe
DISPATCHER_EPICS_FLAG_PATH="$D/epics.flag" timeout 240 node .verify/epic-queue-live.mjs > "$D/out.txt" 2>&1
grep -E "^  live  |ALL CHECKS PASS|FAILED" "$D/out.txt" || echo none
echo "the real dial: $(~/.claude/scripts/dispatcher epics)"
EOF
bash "$D/p.sh" "$D"
cd /tmp && case "$D" in /tmp/athena-probe.*) rm -r "$D";; esac
```

measured 2026-10-15 by chain chain-epic-queue--whole-20261015-023028-6e9f, finding L2, LOW
probe-key: a3f7d6ec9e4cecb93108f63fdec0296380e7ad2c

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/epic-queue-live.mjs

## INV-8346 — probe — a door that prints `MOVED` when the move does not count

a door that prints `MOVED` when the move does not count

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D="$1"
mkdir "$D/home" || exit 1
export DISPATCHER_HOME="$D/home" DISPATCHER_EPICS_FLAG_PATH="$D/epics.flag"
unset DISPATCHER_SCRATCH_DAEMON
cat > "$D/build.py" <<'PY'
import sys, datetime
D = sys.argv[1]
sys.path.insert(0, "/home/lyphe/.claude/hooks")
from dispatcher import store, store_arcs
conn = store.connect()
base = datetime.datetime.now(datetime.timezone.utc)
def stamp(minutes): return (base + datetime.timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")
for epic, minutes in (("qb", 1), ("qc", 2)):
    arc = store_arcs.open_arc(conn, epic, repo=D, goal="walk", architecture="", delivers="", session=None)
    when = stamp(minutes)
    plan = conn.execute("INSERT INTO plans (name, state, repo, model, arc_id, approved_at, approved_by, created_at, updated_at, paused) VALUES (?,?,?,?,?,?,?,?,?,0)",
        (epic + "-f", "approved", D, "claude", arc, when, "athena", when, when)).lastrowid
    conn.execute("INSERT INTO phases (plan_id, key, position, title, goal, assignee, status) VALUES (?,?,?,?,?,?,?)", (plan, "p1", 1, "phase 1", "walk", "hephaestus", "not started"))
conn.commit()
PY
python3 -I "$D/build.py" "$D"
~/.claude/scripts/dispatcher queue qc --before qb 2>&1 | grep -v "started no daemon"
~/.claude/scripts/dispatcher queue | grep -E "qb.arc|qc.arc"
EOF
bash "$D/p.sh" "$D"
cd /tmp && case "$D" in /tmp/athena-probe.*) rm -r "$D";; esac
```

measured 2026-10-15 by chain chain-epic-queue--whole-20261015-023028-6e9f, finding L3, LOW
probe-key: 41784687b4cd5da66e3458b5b00607076f275b92

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/epic-queue-live.mjs

## INV-8347 — probe — the probe opens the live store read-write

the probe opens the live store read-write

```probe
grep -c -- "-readonly" ~/.claude/claudecodeui_lyphe/.verify/epic-queue-live.mjs || true
```

measured 2026-10-15 by chain chain-epic-queue--whole-20261015-023028-6e9f, finding L4, LOW
probe-key: 8f8a9727fa6574fca1521fbe96f7305ac007520e

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/epic-queue-live.mjs

## INV-8354 — probe — MEDIUM — four docstore rows still state or write All for the epic dial, or call a retired function; the intent names them

MEDIUM — four docstore rows still state or write All for the epic dial, or call a retired function; the intent names them

```probe
cd /home/lyphe/.claude && for t in INV-6329 INV-8330 INV-8316 MAN-8432; do printf '%s ' "$t"; docstore get "$t" --text | grep -c -E "model\.clean|Dial\(\"all\"|Dial\('all'|Dial\(limit='all'|limit all|dial reads All"; done
echo "[probe exit $?]"
expect: `1` after each of the four tokens while they are stale; `0` for each once corrected
```

measured 2026-10-15 by chain chain-in-flight-master-controller-20261015-073906-ff48, finding M1, MEDIUM
probe-key: cb98f12deb6ca252bb8e01a0042e3c5733a9db80

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ScheduleControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-folds.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-scratch.py, /home/lyphe/.claude/hooks/dispatcher/line_gate.py, /home/lyphe/.claude/hooks/dispatcher/model.py, /home/lyphe/.claude/hooks/dispatcher/release.py, /home/lyphe/.claude/hooks/plan_runner/run_model.py

## INV-8356 — probe — LOW — two Starts at once do not "start each plan once and kick once": `held` is read outside the write

LOW — two Starts at once do not "start each plan once and kick once": `held` is read outside the write

```probe
D=$(mktemp -d /tmp/athena-p4.XXXXXX) || exit 1
cat > "$D/p.py" <<'EOF'
import os, sys, time
D, which, go = sys.argv[1], sys.argv[2], float(sys.argv[3])
os.environ["DISPATCHER_HOME"] = f"{D}/home"
os.environ.pop("DISPATCHER_SCRATCH_DAEMON", None)
sys.path.insert(0, os.path.expanduser("~/.claude/hooks"))
from dispatcher import first_start, store, store_arcs, wake
from dispatcher.cmd import start as cmd_start
import types
if which == "seed":
    c = store.connect()
    for i, name in enumerate(("ea", "eb"), start=1):
        st = f"2026-10-15T06:0{i}:00Z"
        with c:
            aid = store_arcs.open_arc(c, name, repo=D, goal="g", architecture="", delivers="", session=None)
            pid = c.execute("INSERT INTO plans (name, state, repo, model, arc_id, approved_at, approved_by, paused, created_at, updated_at) VALUES (?, 'loaded', ?, NULL, ?, ?, 'x', 1, ?, ?)", (name + "-f", D, aid, st, st, st)).lastrowid
            c.execute("INSERT INTO phases (plan_id, key, position, title, goal, assignee, status) VALUES (?, 'p1', 1, 'p1', 'g', 'hephaestus', 'not started')", (pid,))
            store.event(c, name + "-f", "approved", detail="probe")
    sys.exit(0)
real = first_start.held                      # both presses read the waiting set, then wait for the same instant, then write
def held(conn):
    names = real(conn); time.sleep(max(0, go - time.time())); return names
first_start.held = held
wake.kick = lambda *a, **k: open(f"{D}/kicks", "a").write("k\n")
cmd_start.start(types.SimpleNamespace())
EOF
cat > "$D/p.sh" <<'EOF'
D=$1
cd /tmp && python3 -B "$D/p.py" "$D" seed 0 || exit 1
GO=$(python3 -c "import time;print(time.time()+2.5)")
python3 -B "$D/p.py" "$D" a "$GO" > "$D/a.out" 2>&1 &
python3 -B "$D/p.py" "$D" b "$GO" > "$D/b.out" 2>&1 &
wait
echo "press A said: $(cat "$D/a.out")  | press B said: $(cat "$D/b.out")"
echo "kicks: $(wc -l < "$D/kicks")"
echo "resumed events: $(sqlite3 "$D/home/dispatcher.db" "select count(*) from events where kind='resumed'") for 2 plans"
EOF
bash "$D/p.sh" "$D" 2>&1 | tail -6
cd /tmp; case "$D" in /tmp/athena-p4.??????) rm -r "$D";; esac
echo "[probe exit $?]"
expect: `STARTED 2 plan(s)` from BOTH presses, `kicks: 2`, `resumed events: 4 for 2 plans` while it stands; once cured one press says `REFUSED start: …` (or `STARTED 0`), `kicks: 1`, `resumed events: 2 for 2 plans`
```

measured 2026-10-15 by chain chain-in-flight-master-controller-20261015-073906-ff48, finding L1, LOW
probe-key: 6138ae320e212c5162a3c0ac634c48df77dd461d

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ScheduleControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-folds.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-scratch.py, /home/lyphe/.claude/hooks/dispatcher/line_gate.py, /home/lyphe/.claude/hooks/dispatcher/model.py, /home/lyphe/.claude/hooks/dispatcher/release.py, /home/lyphe/.claude/hooks/plan_runner/run_model.py

## INV-8357 — probe — LOW — `model.effective` is dead code beside the rule that replaced it

LOW — `model.effective` is dead code beside the rule that replaced it

```probe
cd ~/.claude/hooks && echo "def effective in model.py: $(grep -c '^def effective' dispatcher/model.py)"; echo "callers of effective(): $(grep -rn --include=*.py -E '(^|[^_a-zA-Z])effective\(' dispatcher plan_runner ../scripts | grep -v 'def effective' | wc -l)"
echo "[probe exit $?]"
expect: `def effective in model.py: 1` and `callers of effective(): 0` while it stands; `0` and `0` once removed
```

measured 2026-10-15 by chain chain-in-flight-master-controller-20261015-073906-ff48, finding L2, LOW
probe-key: a6d793827f5888c4b744e263bb0b364ddc365f81

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ScheduleControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-folds.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-scratch.py, /home/lyphe/.claude/hooks/dispatcher/line_gate.py, /home/lyphe/.claude/hooks/dispatcher/model.py, /home/lyphe/.claude/hooks/dispatcher/release.py, /home/lyphe/.claude/hooks/plan_runner/run_model.py

## INV-8358 — probe — LOW — comments, type docs and rows still state what the build removed

LOW — comments, type docs and rows still state what the build removed

```probe
cd /home/lyphe/.claude && { grep -c "a dial at All" claudecodeui_lyphe/server/shared/types.ts claudecodeui_lyphe/src/shared/types.ts; grep -c "a queued plan's Start at a time" claudecodeui_lyphe/server/shared/types.ts claudecodeui_lyphe/src/shared/types.ts; grep -c "arc's Start\|Start lets the stopped\|header's \`Schedule start\`" hooks/dispatcher/arc_verbs.py hooks/dispatcher/cmd/run.py hooks/dispatcher/cmd/schedule.py hooks/dispatcher/judgment_accept.py; docstore get MAN-6796 | python3 -c "import sys,json; print(json.load(sys.stdin)['row']['section_path'][:90])"; echo "MAN-7774: $(docstore get MAN-7774 --text | grep -c 'what its Start and its')"; }
echo "[probe exit $?]"
expect: every count `1` (or more) and MAN-6796's path naming `RunModelControl` while it stands; all `0` and the path corrected once healed
```

measured 2026-10-15 by chain chain-in-flight-master-controller-20261015-073906-ff48, finding L3, LOW
probe-key: 36eafe5a038bf5f5bb8fde98d4ebeffd15f55d80

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ScheduleControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-folds.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-scratch.py, /home/lyphe/.claude/hooks/dispatcher/line_gate.py, /home/lyphe/.claude/hooks/dispatcher/model.py, /home/lyphe/.claude/hooks/dispatcher/release.py, /home/lyphe/.claude/hooks/plan_runner/run_model.py

## INV-8359 — probe — LOW — at his text scale a header list leaves the viewport 5 px before the builder's "under about 340 px"

LOW — at his text scale a header list leaves the viewport 5 px before the builder's "under about 340 px"

```probe
D=$(mktemp -d /tmp/athena-probe-narrow.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'EOF'
// READ-ONLY: every non-GET to /api is aborted; a dropdown is opened and closed with Escape, never chosen.
import pw from '/opt/shadow-connector/node_modules/playwright/index.js';
import { DEV_USER } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { pinPreferences } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/prefs-pin.mjs';
import { answerThirdParties } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/wip-stub.mjs';
const API = 'http://127.0.0.1:3011', APP = 'http://127.0.0.1:5183';
const call = async (token, path, init = {}) => (await fetch(API + path, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } })).json();
const token = (await call(null, '/api/auth/login', { method: 'POST', body: JSON.stringify(DEV_USER) })).token;
const project = (await call(token, '/api/projects')).find((p) => String(p.fullPath ?? p.path ?? '').endsWith('claudecodeui_lyphe'));
const chat = (await call(token, `/api/projects/${encodeURIComponent(project.projectId)}/sessions?limit=8`)).sessions.at(-1).id;
const browser = await pw.chromium.launch();
for (const [width, scale] of [[360, 1.072], [344, 1], [344, 1.072]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: 'light', locale: 'en-US', serviceWorkers: 'block' });
  await ctx.addInitScript(([v]) => { localStorage.setItem('auth-token', v); localStorage.setItem('activeTab', 'runner'); }, [token]);
  await pinPreferences(ctx, { theme: 'light' }, { writes: 'drop' }); await answerThirdParties(ctx);
  await ctx.route(/\/api\//, (r) => (['GET', 'HEAD'].includes(r.request().method()) || /\/api\/(auth\/refresh|commands\/list)/.test(r.request().url()) ? r.fallback() : r.abort()));
  const page = await ctx.newPage();
  await page.goto(`${APP}/session/${chat}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-master-controller]', { timeout: 30000 });
  await page.evaluate((s) => { document.documentElement.style.fontSize = `${16 * s}px`; }, scale); await page.waitForTimeout(900);
  const out = [];
  for (const h of ['data-master-epics']) {
    await page.locator(`[${h}] button[aria-haspopup="listbox"]`).click(); await page.waitForTimeout(300);
    out.push(`${h.replace('data-master-', '')}: ${await page.evaluate(() => { const r = document.querySelector('[role="listbox"]').getBoundingClientRect(); return `${Math.round(r.left)}..${Math.round(r.right)}`; })}`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  }
  console.log(`viewport ${width}px, text x${scale}: list spans ${out.join(' · ')}  (clipped when a span leaves 0..${width})`);
  await ctx.close();
}
await browser.close();
EOF
printf 'cd /tmp && timeout 150 node "$1/p.mjs"\n' > "$D/p.sh"
bash "$D/p.sh" "$D"
cd /tmp; case "$D" in /tmp/athena-probe-narrow.??????) rm -r "$D";; esac
echo "[probe exit $?]"
expect: every line's span inside `0..<width>` — the 344 px line at text ×1.072 is the narrowest; a span outside it means the list is clipped
```

measured 2026-10-15 by chain chain-in-flight-master-controller-20261015-073906-ff48, finding L4, LOW
probe-key: 92c34bda5fd69485ede6e4b9d762f71d8c27fd7f

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ScheduleControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-folds.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-scratch.py, /home/lyphe/.claude/hooks/dispatcher/line_gate.py, /home/lyphe/.claude/hooks/dispatcher/model.py, /home/lyphe/.claude/hooks/dispatcher/release.py, /home/lyphe/.claude/hooks/plan_runner/run_model.py

## INV-8360 — probe — MEDIUM — the gate's last check, "the live box is as found", fails whenever the dispatcher writes one event during the run

MEDIUM — the gate's last check, "the live box is as found", fails whenever the dispatcher writes one event during the run

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "gate lines reading the events table into its live-box comparison: $(grep -c 'eventsTotal' .verify/master-controller-widget.mjs)"
sqlite3 -readonly ~/.claude/state/dispatcher/dispatcher.db "select at from events where at > datetime('now','-1 day') order by at" | python3 -I -c "
import sys, datetime as dt
ts = [dt.datetime.fromisoformat(l.strip().replace('Z', '+00:00')) for l in sys.stdin if l.strip()]
if len(ts) < 2: print('fewer than 2 events in 24h'); raise SystemExit
w = dt.timedelta(minutes=3.5); t = ts[0]; hit = total = 0
while t + w <= ts[-1]:
    total += 1; hit += any(t <= x < t + w for x in ts); t += dt.timedelta(minutes=1)
print(f'{len(ts)} dispatcher events in 24h; a gate run (~3.5 min) would have seen one in {hit} of {total} windows = {100 * hit // total}%')"
EOF
bash "$D/p.sh"
cd /tmp; case "$D" in /tmp/athena-p.??????) rm -r "$D";; esac
echo "[probe exit $?]"
expect: line 1 prints `1` and line 2 prints a percentage above 0 (measured 18% on 2026-10-15) while the defect stands; cured when line 1 prints `0`
```

measured 2026-10-15 by chain chain-runs-widget-master-controller-20261015-085947-0a41, finding M1, MEDIUM
probe-key: 83b1064e8f507ae451aac3ed398dc93131ca34c4

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/MasterController.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Select.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-widget.mjs

## INV-8361 — probe — LOW — a list left open while the widget scrolls floats loose over the next widget, its trigger half hidden

LOW — a list left open while the widget scrolls floats loose over the next widget, its trigger half hidden

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'EOF'
import pw from "/opt/shadow-connector/node_modules/playwright/index.js";
const V = "/home/lyphe/.claude/claudecodeui_lyphe/.verify", API = "http://127.0.0.1:3011", APP = "http://127.0.0.1:5183";
const { DEV_USER } = await import(`${V}/lib/console.mjs`); const { pinPreferences } = await import(`${V}/lib/prefs-pin.mjs`); const { answerThirdParties, waitUntil } = await import(`${V}/lib/wip-stub.mjs`);
const call = async (p, i = {}, t) => JSON.parse(await (await fetch(API + p, { ...i, headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) } })).text());
const token = (await call("/api/auth/login", { method: "POST", body: JSON.stringify(DEV_USER) })).token;
const project = (await call("/api/projects", {}, token)).find((e) => String(e.fullPath ?? e.path ?? "").endsWith("claudecodeui_lyphe"));
const chat = (await call(`/api/projects/${encodeURIComponent(project.projectId)}/sessions?limit=8`, {}, token)).sessions.at(-1).id;
const CARD = "[data-testid=gutter-widget][data-widget=runner]", W = "[data-runner-widget]";
const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1830, height: 1000 }, colorScheme: "light", locale: "en-US", serviceWorkers: "block" });
await ctx.addInitScript((v) => { try { localStorage.setItem("auth-token", v); localStorage.setItem("activeTab", "chat"); } catch {} }, token);
await answerThirdParties(ctx);
const refused = [];
await ctx.route(/\/api\//, (r) => { const q = r.request(); if (["GET", "HEAD"].includes(q.method())) return r.fallback(); const { pathname } = new URL(q.url()); if (pathname === "/api/user/preferences") return r.fallback(); if (/^\/api\/(dispatcher|user|settings)\//.test(pathname)) { refused.push(pathname); return r.abort(); } return r.fallback(); });
await pinPreferences(ctx, { userLanguage: "en", uiPreferences: { sidebarVisible: true }, theme: "light", themeFollowsSun: false }, { writes: "drop" });
let SWITCH = null; await ctx.route("**/api/settings/deepseek-features", (r) => (r.request().method() === "GET" && SWITCH !== null ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: SWITCH }) }) : r.fallback()));
const page = await ctx.newPage();
await page.goto(`${APP}/session/${chat}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(CARD, { timeout: 30000 });
if ((await page.locator(CARD).getAttribute("data-open")) !== "true") await page.locator(`${CARD} [data-testid=gutter-widget-header]`).click();
await waitUntil(async () => page.$(`${W} [data-master-controller]`), 20000); await page.waitForTimeout(1200);
const SCROLLER = () => { const w = document.querySelector("[data-runner-widget]"); return [...document.querySelectorAll("[data-testid=gutter-widget][data-widget=runner] *")].find((n) => /(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.contains(w)); };
await page.locator(`${W} [data-master-epics] button[aria-haspopup=listbox]`).click(); await page.waitForTimeout(450);
const o = await page.evaluate(() => { const s = [...document.querySelectorAll("[data-testid=gutter-widget][data-widget=runner] *")].find((n) => /(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.contains(document.querySelector("[data-runner-widget]"))).getBoundingClientRect(); return { x: s.left + 280, y: s.top + 40 }; });
await page.mouse.move(o.x, o.y); await page.mouse.wheel(0, 90); await page.waitForTimeout(500);
const r = await page.evaluate(() => { const w = document.querySelector("[data-runner-widget]"); const sc = [...document.querySelectorAll("[data-testid=gutter-widget][data-widget=runner] *")].find((n) => /(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.contains(w)); const s = sc.getBoundingClientRect(), t = w.querySelector("[data-master-epics] button[aria-haspopup=listbox]").getBoundingClientRect(), p = document.querySelector(".vv-select__panel")?.getBoundingClientRect(); return { listboxes: document.querySelectorAll("[role=listbox]").length, triggerTop: Math.round(t.top), scrollerTop: Math.round(s.top), scrollerBottom: Math.round(s.bottom), panelBottom: p ? Math.round(p.bottom) : null }; });
console.log(`widget scrolled 90px, Epics list open: listboxes=${r.listboxes} triggerTop=${r.triggerTop} scrollerTop=${r.scrollerTop} panelBottom=${r.panelBottom} scrollerBottom=${r.scrollerBottom} -> ${r.listboxes === 1 && r.triggerTop < r.scrollerTop && r.panelBottom > r.scrollerBottom ? "DETACHED" : "not detached"} (writes refused: ${refused.length})`);
await browser.close();
EOF
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe/.verify || exit 1
node "$1" 2>&1 | tail -4
EOF
bash "$D/p.sh" "$D/p.mjs"
cd /tmp; case "$D" in /tmp/athena-p.??????) rm -r "$D";; esac
echo "[probe exit $?]"
expect: the last line ends `-> DETACHED (writes refused: 0)` with `listboxes=1 triggerTop=31 scrollerTop=59 panelBottom=245 scrollerBottom=225` while the defect stands; cured when it reads `not detached` (the list closed, `listboxes=0`, or was held inside the scroller)
```

measured 2026-10-15 by chain chain-runs-widget-master-controller-20261015-085947-0a41, finding L1, LOW
probe-key: 9ab9493d7034bd03a724a60b2590ad6568337a30

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/MasterController.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Select.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-widget.mjs

## INV-8362 — probe — LOW — a `Select` disabled while open hides its list but stays open, and the list comes back by itself

LOW — a `Select` disabled while open hides its list but stays open, and the list comes back by itself

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'EOF'
import pw from "/opt/shadow-connector/node_modules/playwright/index.js";
const V = "/home/lyphe/.claude/claudecodeui_lyphe/.verify", API = "http://127.0.0.1:3011", APP = "http://127.0.0.1:5183";
const { DEV_USER } = await import(`${V}/lib/console.mjs`); const { pinPreferences } = await import(`${V}/lib/prefs-pin.mjs`); const { answerThirdParties, waitUntil } = await import(`${V}/lib/wip-stub.mjs`);
const call = async (p, i = {}, t) => JSON.parse(await (await fetch(API + p, { ...i, headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) } })).text());
const token = (await call("/api/auth/login", { method: "POST", body: JSON.stringify(DEV_USER) })).token;
const project = (await call("/api/projects", {}, token)).find((e) => String(e.fullPath ?? e.path ?? "").endsWith("claudecodeui_lyphe"));
const chat = (await call(`/api/projects/${encodeURIComponent(project.projectId)}/sessions?limit=8`, {}, token)).sessions.at(-1).id;
const CARD = "[data-testid=gutter-widget][data-widget=runner]", W = "[data-runner-widget]";
const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1830, height: 1000 }, colorScheme: "light", locale: "en-US", serviceWorkers: "block" });
await ctx.addInitScript((v) => { try { localStorage.setItem("auth-token", v); localStorage.setItem("activeTab", "chat"); } catch {} }, token);
await answerThirdParties(ctx);
const refused = [];
await ctx.route(/\/api\//, (r) => { const q = r.request(); if (["GET", "HEAD"].includes(q.method())) return r.fallback(); const { pathname } = new URL(q.url()); if (pathname === "/api/user/preferences") return r.fallback(); if (/^\/api\/(dispatcher|user|settings)\//.test(pathname)) { refused.push(pathname); return r.abort(); } return r.fallback(); });
await pinPreferences(ctx, { userLanguage: "en", uiPreferences: { sidebarVisible: true }, theme: "light", themeFollowsSun: false }, { writes: "drop" });
let SWITCH = null; await ctx.route("**/api/settings/deepseek-features", (r) => (r.request().method() === "GET" && SWITCH !== null ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: SWITCH }) }) : r.fallback()));
const page = await ctx.newPage();
await page.goto(`${APP}/session/${chat}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(CARD, { timeout: 30000 });
if ((await page.locator(CARD).getAttribute("data-open")) !== "true") await page.locator(`${CARD} [data-testid=gutter-widget-header]`).click();
await waitUntil(async () => page.$(`${W} [data-master-controller]`), 20000); await page.waitForTimeout(1200);
const SCROLLER = () => { const w = document.querySelector("[data-runner-widget]"); return [...document.querySelectorAll("[data-testid=gutter-widget][data-widget=runner] *")].find((n) => /(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.contains(w)); };
const trig = page.locator(`${W} [data-master-epics] button[aria-haspopup=listbox]`);
const read = () => page.evaluate(() => { const b = document.querySelector("[data-runner-widget] [data-master-epics] button[aria-haspopup=listbox]"); return `expanded=${b.getAttribute("aria-expanded")} disabled=${b.disabled} listboxes=${document.querySelectorAll("[role=listbox]").length}`; });
await trig.click(); await page.waitForTimeout(400);
console.log("list open:                       ", await read());
SWITCH = true; await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await page.waitForTimeout(800);
console.log("switch re-read as DeepSeek (focus):", await read());
SWITCH = false; await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await page.waitForTimeout(800);
console.log("switch re-read as Claude, no press:", await read(), `(writes refused: ${refused.length})`);
await browser.close();
EOF
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe/.verify || exit 1
node "$1" 2>&1 | tail -4
EOF
bash "$D/p.sh" "$D/p.mjs"
cd /tmp; case "$D" in /tmp/athena-p.??????) rm -r "$D";; esac
echo "[probe exit $?]"
expect: line 2 reads `expanded=true disabled=true listboxes=0` and line 3 `expanded=true disabled=false listboxes=1` while the defect stands; cured when line 2 reads `expanded=false` and line 3 `listboxes=0`
```

measured 2026-10-15 by chain chain-runs-widget-master-controller-20261015-085947-0a41, finding L2, LOW
probe-key: 22efde869e8df151e1dacb90291e14d5cab03246

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/MasterController.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Select.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-widget.mjs

## INV-8363 — probe — LOW — the gate's negative control passes only in the operator's present four-widget arrangement

LOW — the gate's negative control passes only in the operator's present four-widget arrangement

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'EOF'
import pw from "/opt/shadow-connector/node_modules/playwright/index.js";
const V = "/home/lyphe/.claude/claudecodeui_lyphe/.verify", API = "http://127.0.0.1:3011", APP = "http://127.0.0.1:5183";
const { DEV_USER } = await import(`${V}/lib/console.mjs`); const { pinPreferences } = await import(`${V}/lib/prefs-pin.mjs`); const { answerThirdParties, waitUntil } = await import(`${V}/lib/wip-stub.mjs`);
const call = async (p, i = {}, t) => JSON.parse(await (await fetch(API + p, { ...i, headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) } })).text());
const token = (await call("/api/auth/login", { method: "POST", body: JSON.stringify(DEV_USER) })).token;
const project = (await call("/api/projects", {}, token)).find((e) => String(e.fullPath ?? e.path ?? "").endsWith("claudecodeui_lyphe"));
const chat = (await call(`/api/projects/${encodeURIComponent(project.projectId)}/sessions?limit=8`, {}, token)).sessions.at(-1).id;
const CARD = "[data-testid=gutter-widget][data-widget=runner]", W = "[data-runner-widget]";
const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1830, height: 1000 }, colorScheme: "light", locale: "en-US", serviceWorkers: "block" });
await ctx.addInitScript((v) => { try { localStorage.setItem("auth-token", v); localStorage.setItem("activeTab", "chat"); } catch {} }, token);
await answerThirdParties(ctx);
const refused = [];
await ctx.route(/\/api\//, (r) => { const q = r.request(); if (["GET", "HEAD"].includes(q.method())) return r.fallback(); const { pathname } = new URL(q.url()); if (pathname === "/api/user/preferences") return r.fallback(); if (/^\/api\/(dispatcher|user|settings)\//.test(pathname)) { refused.push(pathname); return r.abort(); } return r.fallback(); });
await pinPreferences(ctx, { userLanguage: "en", uiPreferences: { sidebarVisible: true }, theme: "light", themeFollowsSun: false }, { writes: "drop" });
let SWITCH = null; await ctx.route("**/api/settings/deepseek-features", (r) => (r.request().method() === "GET" && SWITCH !== null ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: SWITCH }) }) : r.fallback()));
const page = await ctx.newPage();
await page.goto(`${APP}/session/${chat}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(CARD, { timeout: 30000 });
if ((await page.locator(CARD).getAttribute("data-open")) !== "true") await page.locator(`${CARD} [data-testid=gutter-widget-header]`).click();
await waitUntil(async () => page.$(`${W} [data-master-controller]`), 20000); await page.waitForTimeout(1200);
const SCROLLER = () => { const w = document.querySelector("[data-runner-widget]"); return [...document.querySelectorAll("[data-testid=gutter-widget][data-widget=runner] *")].find((n) => /(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.contains(w)); };
const measure = async (label) => {
  const r = await page.evaluate((fn) => {
    const w = document.querySelector("[data-runner-widget]"); const sc = [...document.querySelectorAll("[data-testid=gutter-widget][data-widget=runner] *")].find((n) => /(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.contains(w));
    for (let n = sc; n; n = n.parentElement) n.scrollTop = 0;
    const select = w.querySelector("[data-master-epics] .vv-select"); const trigger = select.querySelector("button[aria-haspopup=listbox]");
    const panel = document.createElement("div"); panel.className = "vv-select__panel"; Object.assign(panel.style, { position: "absolute", top: "calc(100% + 6px)", left: "0", right: "0", width: "auto", zIndex: "20" });
    panel.innerHTML = "<ul class=\"vv-select__list\" role=\"listbox\">" + ["1", "2", "3", "4", "5"].map((x) => `<li class="vv-select__option" role="option">${x}</li>`).join("") + "</ul>";
    select.appendChild(panel); trigger.setAttribute("aria-expanded", "true");
    return new Promise((done) => setTimeout(() => { const hits = [...panel.querySelectorAll("[role=option]")].filter((o) => { const b = o.getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return e !== null && o.contains(e); }).length; panel.remove(); trigger.setAttribute("aria-expanded", "false"); done({ windowPx: sc.clientHeight, hits }); }, 450));
  });
  console.log(`${label}: the widget's window is ${r.windowPx}px; an in-place list (the control the gate uses) answers a hit on ${r.hits} of 5 options -> the gate's control would ${r.hits < 5 ? "PASS" : "FAIL (it can no longer fail)"}`);
};
await measure("the operator's arrangement (four widgets open)");
for (const id of ["roadmap", "memory", "subagents"]) { const c = page.locator(`[data-testid=gutter-widget][data-widget=${id}]`); if (await c.count() && (await c.getAttribute("data-open")) === "true") await c.locator("[data-testid=gutter-widget-header]").click(); }
await page.waitForTimeout(700);
await measure("the other three widgets collapsed        ");
console.log(`gate pins the column's arrangement: ${(await import("node:fs")).readFileSync(V + "/master-controller-widget.mjs", "utf8").match(/placements|collapse|gutterPlacements/gi)?.length ?? 0} mentions (writes refused: ${refused.length})`);
await browser.close();
EOF
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe/.verify || exit 1
node "$1" 2>&1 | tail -4
EOF
bash "$D/p.sh" "$D/p.mjs"
cd /tmp; case "$D" in /tmp/athena-p.??????) rm -r "$D";; esac
echo "[probe exit $?]"
expect: line 1 says the window is 166px and the in-place control would PASS (2 of 5 hit), line 2 says 734px and `FAIL (it can no longer fail)` (5 of 5), line 3 `0 mentions` while the defect stands; cured when line 3 counts a pin of the arrangement (or line 2 also says PASS). The window height reads whatever his arrangement holds today: the contrast between lines 1 and 2 is the measurement
```

measured 2026-10-15 by chain chain-runs-widget-master-controller-20261015-085947-0a41, finding L3, LOW
probe-key: 0c261c9afa0bf6d245ba443f0397f2051f460e5a

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/MasterController.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Select.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-widget.mjs

## INV-8364 — probe — LOW — the gate's own bookkeeping: two checks that pass on `null`, a dead field, a wrong figure

LOW — the gate's own bookkeeping: two checks that pass on `null`, a dead field, a wrong figure

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "sideways checks that pass when the scroller is not found (null <= 0 is $(node -p 'null <= 0')): $(grep -c 'scrollerSideways <= 0\|cards.sideways <= 0' .verify/master-controller-widget.mjs)"
echo "fields computed and never read (plannerReadoutAbove): $(grep -c 'plannerReadoutAbove' .verify/master-controller-widget.mjs) mention(s)"
echo "'lines' counts distinct tops, not rows: $(grep -c 'new Set(children.map((child) => Math.round(child.top))).size' .verify/master-controller-widget.mjs) site(s); the cards' alignment is items-end: $(grep -c 'items-end' src/modules/dispatcher/MasterController.tsx)"
EOF
bash "$D/p.sh"
cd /tmp; case "$D" in /tmp/athena-p.??????) rm -r "$D";; esac
echo "[probe exit $?]"
expect: line 1 `…(null <= 0 is true): 2`, line 2 `1 mention(s)`, line 3 `1 site(s)` … `1` while the defect stands; cured when line 1 ends `: 0`, line 2 prints `0 mention(s)`
```

measured 2026-10-15 by chain chain-runs-widget-master-controller-20261015-085947-0a41, finding L4, LOW
probe-key: 4330da8486d795daa7695f6864601bbbc8a4d934

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/MasterController.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Select.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-widget.mjs

## INV-8440 — `loopbackApiOrigin()` reads `SERVER_PORT` only — never `PORT`

An origin for a child of this box that calls back into the API is `loopbackApiOrigin()` (`server/shared/utils.ts`), never a port expression written at the call site. It is `SERVER_PORT || '3001'`, the expression the listener reads (`server/index.ts`, `const SERVER_PORT`).

- why no `PORT`: the server never listens on `PORT`. The `cloudcli` CLI is the one place that accepts it, and copies it into `SERVER_PORT` before the server starts (`server/modules/cli/cli.service.ts`: `else if (!SERVER_PORT && PORT) SERVER_PORT = PORT`). An origin built from `PORT` is right only where `SERVER_PORT` is already set, and wrong for a server started directly with `PORT=4000`: it listens on 3001 and the origin answers `:4000`.
- symptom: a child's call back into the API (`CLOUDCLI_TOOLSET_URL`, the Metis board origin, the browser-use MCP URL) refuses to connect or reaches a different server.
- fix: call `loopbackApiOrigin()`; if the listener learns another port variable, change the helper with it.
- `KANBAN_PM_API_URL` stays the one explicit override, in `resolveApiOrigin` (`kanban-metis.module.ts`).
- measured 2026-10-16: `grep -rn "process.env.PORT" server/` prints nothing.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/browser-use/browser-use.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-metis/kanban-metis.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/utils.ts

## INV-8441 — probe — `loopbackApiOrigin`'s comment promises the running process's port, but with only `PORT` set the listener is on 3001

`loopbackApiOrigin`'s comment promises the running process's port, but with only `PORT` set the listener is on 3001

```probe
D=$(mktemp -d /tmp/athena-probe-port.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D="$(cd "$(dirname "$0")" && pwd)"
cat > "$D/o.mjs" <<'JS'
const { loopbackApiOrigin } = await import('/home/lyphe/.claude/claudecodeui_lyphe/server/shared/utils.ts');
console.log('origin with only PORT=4000 set:', loopbackApiOrigin());
JS
cd /home/lyphe/.claude/claudecodeui_lyphe
env -u SERVER_PORT PORT=4000 TSX_TSCONFIG_PATH=server/tsconfig.json timeout 60 node --import tsx "$D/o.mjs" 2>&1 | tail -1
echo "listener: $(grep -n '^const SERVER_PORT = ' server/index.ts | cut -c1-120)"
echo "server entry files reading process.env.PORT: $(grep -l 'process.env.PORT' server/index.ts server/load-env.ts server/supervised-boot.ts 2>/dev/null | wc -l)"
EOF
bash "$D/p.sh"; cd /tmp && case "$D" in /tmp/athena-probe-port.*) rm -r "$D";; esac
expect: the origin ends :4000, the listener line reads only SERVER_PORT with default 3001, and the count of entry files reading PORT is 0 (the defect stands); once cured the origin ends :3001 or the listener reads PORT
```

measured 2026-10-16 by chain chain-toolset-skeleton--contracts-20261016-054640-9dd2, finding L1, LOW
probe-key: b6a677af8c070e438275dfa9aed3e1be1e8cbb7a

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/auth/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/interfaces.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/toolset-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/toolset-types.ts

## INV-8443 — ChatComposer's footer is a query container — the model pill's tool-set count depends on it

- `PromptInputFooter` in `ChatComposer.tsx` carries `[container-type:inline-size]`. Keep it.
- why: the pill's count in `ComposerModelMenu.tsx` (`data-toolset-count`) is `hidden … [@container(min-width:45rem)]:inline`; with no query container above it the count never shows.
- The query follows the composer's own width — page, floating panel and PiP window alike — not the viewport. The count shows at ≥45rem (720px) and gives way before the model's name and the send button below it. At 1440 with the sidebar open the footer is ~842px.
- Inline-size containment is safe on this footer: its width comes from the form, tooltips and menus are portalled, the voice error bubble is positioned against its own wrapper. Anything added to the footer that sizes the footer from its content breaks the query.
- Section contract: MAN-8490.

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ChatComposer.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ComposerModelMenu.tsx

## INV-8452 — probe — a view that is not a view, or a switch answer with no data, takes the chat pane down (S35/S18) — MEDIUM

a view that is not a view, or a switch answer with no data, takes the chat pane down (S35/S18) — MEDIUM

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'EOF2'
const L = "/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib";
const { openConsole } = await import(`${L}/console.mjs`);
const sc = await import(`${L}/scratch-chat.mjs`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const s = await openConsole();
const json = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const id = (await s.api("/api/providers/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "claude", projectPath: "/tmp/cloudcli-probe-chat", initialMessage: "" }) })).body.data.sessionId;
const errs = [];
s.page.on("pageerror", (e) => errs.push(e.message));
await s.page.route("**/api/toolsets/sessions/**", (r) => (r.request().method() === "GET" ? r.fulfill(json(200, { success: true, data: {} })) : r.continue()));
await s.page.goto(`${s.appUrl}/session/${id}`, { waitUntil: "networkidle" });
await sleep(2000);
console.log("composer textareas:", await s.page.locator("textarea").count(), "| pageerrors:", errs.length, "|", errs[0] ?? "none");
await sc.deleteScratchChat(s, id);
await s.browser.close();
EOF2
printf 'node "$1/p.mjs"\n' > "$D/p.sh"
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: prints `composer textareas: 0 | pageerrors: 2 | Cannot read properties of undefined (reading 'filter')` while the defect stands; cured when it prints `composer textareas: 1 | pageerrors: 0 | none`
```

measured 2026-10-16 by chain chain-toolset-skeleton--menu-fill-20261016-071936-654e, finding M1, MEDIUM
probe-key: 8c199dea72bce1fe48fd5696839b8d0a01edeb87

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ComposerModelMenu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ComposerToolsetSection.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useSessionToolsets.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-8453 — probe — a chat of another provider is asked the toolsets door, and refused (S7) — MEDIUM

a chat of another provider is asked the toolsets door, and refused (S7) — MEDIUM

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'EOF2'
const L = "/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib";
const { openConsole } = await import(`${L}/console.mjs`);
const sc = await import(`${L}/scratch-chat.mjs`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const s = await openConsole();
const id = (await s.api("/api/providers/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "codex", projectPath: "/tmp/cloudcli-probe-chat", initialMessage: "" }) })).body.data.sessionId;
const seen = [];
s.page.on("response", (x) => { if (x.url().includes("/api/toolsets/")) seen.push(x.status()); });
await s.page.evaluate(() => localStorage.setItem("selected-provider", "claude"));
await s.page.goto(`${s.appUrl}/session/${id}`, { waitUntil: "networkidle" });
await sleep(1500);
console.log("tool-set reads answered for a codex chat opened from a claude-state UI:", JSON.stringify(seen));
await sc.deleteScratchChat(s, id);
await s.browser.close();
EOF2
printf 'node "$1/p.mjs"\n' > "$D/p.sh"
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: prints `[400,400]` in the dev build (`[400]` in a production build) while the defect stands; cured when it prints `[]`
```

measured 2026-10-16 by chain chain-toolset-skeleton--menu-fill-20261016-071936-654e, finding M2, MEDIUM
probe-key: c8e933d2ceca1dd4992536495d5990b4d1705099

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ComposerModelMenu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ComposerToolsetSection.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useSessionToolsets.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-8454 — probe — a switch that outlives the client's 30 s deadline is reported "Not updated: signal timed out" though it landed (S20) — MEDIUM

a switch that outlives the client's 30 s deadline is reported "Not updated: signal timed out" though it landed (S20) — MEDIUM

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'EOF2'
const L = "/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib";
const { openConsole } = await import(`${L}/console.mjs`);
const sc = await import(`${L}/scratch-chat.mjs`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const s = await openConsole();
const json = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const id = (await s.api("/api/providers/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "claude", projectPath: "/tmp/cloudcli-probe-chat", initialMessage: "" }) })).body.data.sessionId;
const view = (on) => ({ sessionId: id, availability: "available", node: null, strays: [], registryError: null, registryFile: "/x/toolsets.local.json", sets: [{ name: "probe", description: "Echo probe", servers: ["probe"], on }] });
await s.page.route("**/api/toolsets/sessions/**", async (route) => {
  if (route.request().method() === "GET") return route.fulfill(json(200, { success: true, data: view(false) }));
  await sleep(33000);
  return route.fulfill(json(200, { success: true, data: { set: "probe", on: true, changed: true, live: "unconfirmed", servers: [{ name: "probe", outcome: "unconfirmed", detail: "no answer" }], view: view(true) } })).catch(() => {});
});
await s.page.goto(`${s.appUrl}/session/${id}`, { waitUntil: "networkidle" });
await s.page.click(sc.MODEL_CHIP);
await s.page.waitForSelector("[data-toolset-section]");
const t0 = Date.now();
await s.page.locator('[data-toolset-section] [role="menuitemcheckbox"]').first().click();
await sleep(31500);
const line = await s.page.locator('[data-toolset-line="error"]').allInnerTexts();
console.log(`after ${Math.round((Date.now() - t0) / 1000)} s the section says:`, JSON.stringify(line));
await sc.deleteScratchChat(s, id);
await s.browser.close();
EOF2
printf 'node "$1/p.mjs"\n' > "$D/p.sh"
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: prints `after 32 s the section says: ["▲\nNot updated: signal timed out"]` while the defect stands; cured when the line is absent or is the answer's own `unconfirmed` sentence (the PUT deadline passes the server's 30 s bound)
```

measured 2026-10-16 by chain chain-toolset-skeleton--menu-fill-20261016-071936-654e, finding M3, MEDIUM
probe-key: dc87c579bbc4d956142d19971149453b69350eb6

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ComposerModelMenu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ComposerToolsetSection.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useSessionToolsets.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-8455 — probe — a failure that is not the server's envelope reaches the screen as the engine's own text (S18) — LOW

a failure that is not the server's envelope reaches the screen as the engine's own text (S18) — LOW

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'EOF2'
const L = "/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib";
const { openConsole } = await import(`${L}/console.mjs`);
const sc = await import(`${L}/scratch-chat.mjs`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const s = await openConsole();
const json = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const id = (await s.api("/api/providers/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "claude", projectPath: "/tmp/cloudcli-probe-chat", initialMessage: "" }) })).body.data.sessionId;
const view = { sessionId: id, availability: "available", node: null, strays: [], registryError: null, registryFile: "/x/toolsets.local.json", sets: [{ name: "probe", description: "Echo probe", servers: ["probe"], on: false }] };
await s.page.route("**/api/toolsets/sessions/**", (route) => (route.request().method() === "GET" ? route.fulfill(json(200, { success: true, data: view })) : route.fulfill({ status: 502, contentType: "text/html", body: "<html><body><h1>502 Bad Gateway</h1></body></html>" })));
await s.page.goto(`${s.appUrl}/session/${id}`, { waitUntil: "networkidle" });
await s.page.click(sc.MODEL_CHIP);
await s.page.waitForSelector("[data-toolset-section]");
await s.page.locator('[data-toolset-section] [role="menuitemcheckbox"]').first().click();
await sleep(900);
console.log("error line:", JSON.stringify(await s.page.locator('[data-toolset-line="error"]').allInnerTexts()));
await sc.deleteScratchChat(s, id);
await s.browser.close();
EOF2
printf 'node "$1/p.mjs"\n' > "$D/p.sh"
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: prints `error line: ["▲\nNot updated: Unexpected token '<', \"<html><bod\"... is not valid JSON"]` while the defect stands; cured when the line has no `Unexpected token` text
```

measured 2026-10-16 by chain chain-toolset-skeleton--menu-fill-20261016-071936-654e, finding L1, LOW
probe-key: ca13a72d9d4b58cc28fec1b04a428798e3e29ca4

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ComposerModelMenu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ComposerToolsetSection.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useSessionToolsets.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-8456 — probe — a press in chat B is silently dropped while chat A's switch is still out (S14) — LOW

a press in chat B is silently dropped while chat A's switch is still out (S14) — LOW

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'EOF2'
const L = "/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib";
const { openConsole } = await import(`${L}/console.mjs`);
const sc = await import(`${L}/scratch-chat.mjs`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const s = await openConsole();
const mk = async () => (await s.api("/api/providers/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "claude", projectPath: "/tmp/cloudcli-probe-chat", initialMessage: "" }) })).body.data.sessionId;
const json = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const A = await mk();
const B = await mk();
const view = (id, on = false) => ({ sessionId: id, availability: "available", node: null, strays: [], registryError: null, registryFile: "/x/toolsets.local.json", sets: [{ name: "probe", description: "Echo probe", servers: ["probe"], on }] });
const puts = [];
await s.page.route("**/api/toolsets/sessions/**", async (route) => {
  const req = route.request();
  const who = req.url().includes(A) ? "A" : "B";
  const id = who === "A" ? A : B;
  if (req.method() === "GET") return route.fulfill(json(200, { success: true, data: view(id) }));
  puts.push(who);
  if (who === "A") await sleep(6000);
  return route.fulfill(json(200, { success: true, data: { set: "probe", on: true, changed: true, live: "applied", servers: [{ name: "probe", outcome: "connected" }], view: view(id, true) } })).catch(() => {});
});
await s.page.goto(`${s.appUrl}/session/${A}`, { waitUntil: "networkidle" });
await s.page.click(sc.MODEL_CHIP);
await s.page.waitForSelector("[data-toolset-section]");
await s.page.locator('[data-toolset-section] [role="menuitemcheckbox"]').first().click();
await sleep(500);
await s.page.evaluate((id) => { history.pushState(null, "", `/session/${id}`); window.dispatchEvent(new PopStateEvent("popstate")); }, B);
await sleep(1500);
if ((await s.page.locator("div[role=menu]").count()) === 0) await s.page.click(sc.MODEL_CHIP);
await s.page.waitForSelector("[data-toolset-section]");
await s.page.locator('[data-toolset-section] [role="menuitemcheckbox"]').first().click();
await sleep(1500);
console.log("PUTs sent (A's press, then B's press while A's is out):", JSON.stringify(puts));
await sleep(5000);
for (const id of [A, B]) await sc.deleteScratchChat(s, id);
await s.browser.close();
EOF2
printf 'node "$1/p.mjs"\n' > "$D/p.sh"
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
expect: prints `["A"]` while the defect stands (B's press sent nothing); cured when it prints `["A","B"]`
```

measured 2026-10-16 by chain chain-toolset-skeleton--menu-fill-20261016-071936-654e, finding L2, LOW
probe-key: e2b4820ffa01388a3f5c7ef7dc25286fa874110f

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ComposerModelMenu.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/composer/ComposerToolsetSection.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useSessionToolsets.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-8463 — probe — LOW — an epic deck of finished plans and one parked plan cannot be put away from its corner

LOW — an epic deck of finished plans and one parked plan cannot be put away from its corner

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/approve-queues-hide-holds/athena-probes/parked_deck.sh
expect: `hide ez.arc -> exit 2 | REFUSED hide ez.arc: every plan of it is finished or set aside …` while it stands; cured, exit 0 (or the board offers Dismiss for such a deck)
```

measured 2026-10-16 by chain chain-approve-queues-hide-holds-20261016-063302-f463, finding L2, LOW
probe-key: e5b3e69b031c00a62d68078d266a51687b64141b

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/hide-holds-board.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/hide-holds-scratch.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hide.py, /home/lyphe/.claude/hooks/dispatcher/epic_line.py, /home/lyphe/.claude/hooks/dispatcher/line_gate.py, /home/lyphe/.claude/hooks/dispatcher/store_hidden.py, /home/lyphe/.claude/hooks/intent_lock.py, /home/lyphe/.claude/scripts/runner_fixtures/dispatch_arc_start.py

## INV-8464 — probe — LOW — a typed "do not queue it" now approves the plan into the queue and starts it

LOW — a typed "do not queue it" now approves the plan into the queue and starts it

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/approve-queues-hide-holds/athena-probes/typed_not_queue.sh
expect: `'do not queue it' -> hide=False (Queue: approved into the queue)` while it stands; cured, `hide=None` (Rework) or `hide=True`
```

measured 2026-10-16 by chain chain-approve-queues-hide-holds-20261016-063302-f463, finding L3, LOW
probe-key: 5951e86a010d7ce9234d1e837fbb947694e661df

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/hide-holds-board.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/hide-holds-scratch.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hide.py, /home/lyphe/.claude/hooks/dispatcher/epic_line.py, /home/lyphe/.claude/hooks/dispatcher/line_gate.py, /home/lyphe/.claude/hooks/dispatcher/store_hidden.py, /home/lyphe/.claude/hooks/intent_lock.py, /home/lyphe/.claude/scripts/runner_fixtures/dispatch_arc_start.py

## INV-8465 — probe — LOW — a fixture comment still names `approve --paused`

LOW — a fixture comment still names `approve --paused`

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/approve-queues-hide-holds/athena-probes/fixture_comment.sh
expect: `lines naming approve --paused in the fixture: 1` while it stands; cured, `0`
```

measured 2026-10-16 by chain chain-approve-queues-hide-holds-20261016-063302-f463, finding L4, LOW
probe-key: be1db4d5ca5a9bfc00f530f295213ec8d816eb13

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/hide-holds-board.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/hide-holds-scratch.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hide.py, /home/lyphe/.claude/hooks/dispatcher/epic_line.py, /home/lyphe/.claude/hooks/dispatcher/line_gate.py, /home/lyphe/.claude/hooks/dispatcher/store_hidden.py, /home/lyphe/.claude/hooks/intent_lock.py, /home/lyphe/.claude/scripts/runner_fixtures/dispatch_arc_start.py

## INV-8466 — probe — The hold check cannot fail when the hold is broken

The hold check cannot fail when the hold is broken

```probe
D=/tmp/athena-probe-m1; mkdir -p "$D" || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe
echo "ordering asserted: $(grep -n 'holdLines\[0\].at < firstCall.at' .verify/toolset-whole.mjs | cut -c1-90 || echo none)"
echo "queue-operation referenced in driver/kit: $(cat .verify/toolset-whole.mjs .verify/lib/toolset-whole-kit.mjs | grep -c queue-operation || true)"
echo "line count asserted for the hold: $(grep -c 'holdLines.length === 1' .verify/toolset-whole.mjs || true)"
EOF
bash "$D/p.sh"; rm -f "$D/p.sh"; rmdir "$D"
```

measured 2026-10-16 by chain chain-toolset-skeleton--proof-20261016-080025-6387, finding M1, MEDIUM
probe-key: 4373fe03c23a30841e4ae3b30e2348b6da3f45af

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/toolset-whole-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/toolset-whole.mjs

## INV-8467 — probe — An aborted run prints `SUMMARY n/n checks ok`, and its evidence file stops without the summary

An aborted run prints `SUMMARY n/n checks ok`, and its evidence file stops without the summary

```probe
D=/tmp/athena-probe-abort; mkdir -p "$D" || exit 1
cat > "$D/p.sh" <<'EOF'
D=/tmp/athena-probe-abort
R=$D/root
mkdir -p "$R/.verify" "$R/evid" || exit 1
REAL=/home/lyphe/.claude/claudecodeui_lyphe
cp "$REAL/.verify/toolset-whole.mjs" "$R/.verify/toolset-whole.mjs"
ln -s "$REAL/.verify/keepalive-lib.mjs" "$R/.verify/keepalive-lib.mjs"
ln -s "$REAL/.verify/lib" "$R/.verify/lib"
ln -s "$REAL/node_modules" "$R/node_modules"
printf '{}\n' > "$R/toolsets.local.json"
( cd "$R" && PLAYWRIGHT_BROWSERS_PATH=/nonexistent timeout 60 node .verify/toolset-whole.mjs --evidence "$R/evid" > "$D/out.txt" 2> "$D/err.txt"; echo "exit=$?" )
echo "stdout summary: $(grep -h SUMMARY "$D/out.txt" || echo none)"
echo "run.log summary: $(grep -h SUMMARY "$R/evid/run.log" || echo none)"
echo "stderr carries the error: $(grep -c 'Executable' "$D/err.txt")"
rm -f "$R/node_modules" "$R/.verify/lib" "$R/.verify/keepalive-lib.mjs" "$R/.verify/toolset-whole.mjs" "$R/toolsets.local.json" "$R/evid/run.log" "$R/evid/toolsets.local.json.before" "$D/out.txt" "$D/err.txt"
rmdir "$R/evid" "$R/.verify" "$R"
EOF
bash "$D/p.sh"; rm -f "$D/p.sh"; rmdir "$D"
```

measured 2026-10-16 by chain chain-toolset-skeleton--proof-20261016-080025-6387, finding L1, LOW
probe-key: 73c9f79e6ab28b883ad6f3dbe950db093acf172e

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/toolset-whole-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/toolset-whole.mjs

## INV-8468 — probe — SIGINT/SIGTERM restores the box and leaks everything else

SIGINT/SIGTERM restores the box and leaks everything else

```probe
D=/tmp/athena-probe-l2; mkdir -p "$D" || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe
grep -n "process.on(signal" .verify/toolset-whole.mjs
echo "cleanup calls in that handler: $(grep -n "process.on(signal" .verify/toolset-whole.mjs | grep -c 'endHosts\|deleteScratchChat')"
EOF
bash "$D/p.sh"; rm -f "$D/p.sh"; rmdir "$D"
```

measured 2026-10-16 by chain chain-toolset-skeleton--proof-20261016-080025-6387, finding L2, LOW
probe-key: 540af512f9321d5c2e73557c05454c4b6fc74651

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/toolset-whole-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/toolset-whole.mjs

## INV-8469 — probe — Several claims are shown in the output but asserted by no check

Several claims are shown in the output but asserted by no check

```probe
D=/tmp/athena-probe-l3; mkdir -p "$D" || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe
echo "checks that count A's sync lines: $(grep -c "check(.*\(readoptedSyncLines.length\|holdLines.length\)" .verify/toolset-whole.mjs)"
echo "checks that read server.log: $(grep -c "check(.*serverLogSince\|check(.*SERVER_LOG" .verify/toolset-whole.mjs || true)"
echo "B null read: $(grep -n "lastRows\[chats.B\]" .verify/toolset-whole.mjs | cut -c1-110)"
EOF
bash "$D/p.sh"; rm -f "$D/p.sh"; rmdir "$D"
```

measured 2026-10-16 by chain chain-toolset-skeleton--proof-20261016-080025-6387, finding L3, LOW
probe-key: 48544ccece43c9bab0c6053fb8f037ec3657c3b8

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/toolset-whole-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/toolset-whole.mjs

## INV-8470 — probe — The header's cost line is stale

The header's cost line is stale

```probe
D=/tmp/athena-probe-l4; mkdir -p "$D" || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe
echo "header says: $(grep -o 'Spends ~[0-9]* Haiku turns' .verify/toolset-whole.mjs)"
echo "turns in the closing run: $(grep -c '^  -> \[' .verify/artifacts/toolset-whole-closing/run.log)"
EOF
bash "$D/p.sh"; rm -f "$D/p.sh"; rmdir "$D"
```

measured 2026-10-16 by chain chain-toolset-skeleton--proof-20261016-080025-6387, finding L4, LOW
probe-key: 9fa0de82839fdcfa0f3efc352c23672f55a6a42e

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/toolset-whole-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/toolset-whole.mjs

## INV-8473 — probe — The seam manual and the command manual never reach an editor of their files; the report's claim about `chat-process.ts` is false at the hook's limit

The seam manual and the command manual never reach an editor of their files; the report's claim about `chat-process.ts` is false at the hook's limit

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
for f in server/modules/providers/list/claude/claude-toolset-seams.ts bin/toolset.mjs server/modules/providers/list/claude/chat-process.ts; do
  echo "$(basename "$f"): $(~/.claude/scripts/docstore govern "/home/lyphe/.claude/claudecodeui_lyphe/$f" --touch write --limit 3 --text | cut -d' ' -f1 | tr '\n' ' ')"
done
expect: while the defect stands the seams file prints `INV-8445 INV-8446 INV-8444`, `toolset.mjs` prints `INV-8449 INV-8450 INV-8451`, and `chat-process.ts` prints `INV-8471 MAN-8055 MAN-699`; cured when MAN-8495/8502/8503 appear for the first, MAN-8501 for the second and MAN-8502 for the third
```

measured 2026-10-16 by chain chain-toolset-skeleton--docs-20261016-092338-5af2, finding M1, MEDIUM
probe-key: e9897634edc005783765ab5ebad0b8e0091eac47

governs: /home/lyphe/.claude/claudecodeui_lyphe/

## INV-8474 — probe — `src/shared/api.ts:865` points at the wrong file for MAN-8490 (outside TARGET; from the menu-fill phase)

`src/shared/api.ts:865` points at the wrong file for MAN-8490 (outside TARGET; from the menu-fill phase)

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "docs/MANUAL.md: $(grep -c '^## MAN-8490' docs/MANUAL.md) | MANUAL.md: $(grep -c '^## MAN-8490' MANUAL.md) | pointer: $(grep -c 'docs/MANUAL.md MAN-8490' src/shared/api.ts)"
expect: `docs/MANUAL.md: 0 | MANUAL.md: 1 | pointer: 1` while the defect stands; cured when the pointer count is 0 or the first number is 1
```

measured 2026-10-16 by chain chain-toolset-skeleton--docs-20261016-092338-5af2, finding L1, LOW
probe-key: 98d5e8e19815eea0fe50ec6523a01fa6c0d9adf9

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-8475 — probe — INV-8471 is not governed on the files four of its six clauses name

INV-8471 is not governed on the files four of its six clauses name

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
for f in bin/toolset.mjs server/modules/toolsets/toolsets.credential.ts server/modules/toolsets/toolsets.module.ts; do
  echo "$f: $(~/.claude/scripts/docstore govern "/home/lyphe/.claude/claudecodeui_lyphe/$f" --limit 200 --text | grep -c INV-8471)"
done
expect: `0` for all three while the defect stands; cured when each prints 1
```

measured 2026-10-16 by chain chain-toolset-skeleton--docs-20261016-092338-5af2, finding L2, LOW
probe-key: 17be1484daa8bef0412d51d93e7a170876d36963

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/chat-process.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-toolset-seams.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/toolsets/toolsets.registry.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/toolsets/toolsets.service.ts

## INV-8476 — probe — INV-8471 says "the FULL map, every call" and leaves out the base-name landmine

INV-8471 says "the FULL map, every call" and leaves out the base-name landmine

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "INV-8471 says FULL map: $(~/.claude/scripts/docstore get INV-8471 --text | grep -c 'FULL map') | names base server: $(~/.claude/scripts/docstore get INV-8471 --text | grep -c -i 'base server') | code calls with a reduced map: $(grep -c 'setMcpServers(without)' server/modules/providers/list/claude/claude-toolset-seams.ts)"
expect: `INV-8471 says FULL map: 1 | names base server: 0 | code calls with a reduced map: 1` while the defect stands; cured when the base-server count is ≥1 and the "FULL map" wording names the retry exception
```

measured 2026-10-16 by chain chain-toolset-skeleton--docs-20261016-092338-5af2, finding L3, LOW
probe-key: 8630d7e8083fad6623cb74b878dd30d01f924a5c

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/chat-process.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-toolset-seams.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/toolsets/toolsets.registry.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/toolsets/toolsets.service.ts

## INV-8477 — probe — Two refusal texts the rows state do not match what the code prints

Two refusal texts the rows state do not match what the code prints

```probe
D=$(mktemp -d /tmp/athena-probe-f4.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
D="$1"
cat > "$D/sse.mts" <<'TS'
import { writeFileSync } from 'node:fs';
import { readToolsetRegistry } from '/home/lyphe/.claude/claudecodeui_lyphe/server/modules/toolsets/toolsets.registry.ts';
process.env.TOOLSETS_FILE = process.argv[2] + '/r.json';
writeFileSync(process.env.TOOLSETS_FILE, '{"a":{"mcpServers":{"s":{"type":"sse"}}}}');
try { readToolsetRegistry(); } catch (e: any) { console.log(e.message); }
TS
TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx "$D/sse.mts" "$D" 2>&1 | tail -1
echo "MAN-8498 lines with the sse text: $(~/.claude/scripts/docstore get MAN-8498 --text | grep -c 'an sse server needs a url')"
cat > "$D/stub.mjs" <<'JS'
import http from 'node:http';
http.createServer((q, r) => { r.writeHead(401, { 'content-type': 'application/json' }); r.end('{"error":"Invalid API key"}'); })
  .listen(0, '127.0.0.1', function () { console.log(this.address().port); });
JS
node "$D/stub.mjs" > "$D/port" &
SP=$!
for i in 1 2 3 4 5 6 7 8 9 10; do [ -s "$D/port" ] && break; sleep 0.3; done
env -i PATH=/usr/bin:/bin CLAUDE_SURFACE=cloudcli CLAUDE_CODE_SESSION_ID=s CLOUDCLI_TOOLSET_TOKEN=T CLOUDCLI_TOOLSET_URL="http://127.0.0.1:$(cat "$D/port")" node bin/toolset.mjs list 2>&1 | sed 's/:[0-9]\{4,5\}/:<port>/'
case "$SP" in ''|*[!0-9]*|0|1) echo "bad pid";; *) kill "$SP";; esac
EOF
bash "$D/p.sh" "$D"
cd /tmp && case "$D" in /tmp/athena-probe-f4.*) rm -r "$D";; esac
expect: while the defect stands: `…an sse server needs a url`, then `MAN-8498 lines with the sse text: 0`, then `toolset: unavailable — http://127.0.0.1:<port> answered HTTP 401, which is not a CloudCLI answer`; cured when the MAN-8498 count is ≥1 and MAN-8501 says a non-envelope 401 reads "not a CloudCLI answer"
```

measured 2026-10-16 by chain chain-toolset-skeleton--docs-20261016-092338-5af2, finding L4, LOW
probe-key: 260b5ea30b0024e181f0d4d58a9a3c5db11acbea

governs: /home/lyphe/.claude/claudecodeui_lyphe/.gitignore, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/migrations.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/session-user-state.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/toolsets/toolsets.registry.ts

## INV-8478 — probe — Two measured facts dropped from the retired MAN-8491 without a stated reason

Two measured facts dropped from the retired MAN-8491 without a stated reason

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "retired MAN-8491 had: $(~/.claude/scripts/docstore history MAN-8491 --json | grep -o -E 'shell-snapshots|well under a second' | sort -u | tr '\n' '+') | MAN-8501 has: $(~/.claude/scripts/docstore get MAN-8501 --text | grep -c -E 'shell-snapshots|under a second')"
expect: `retired MAN-8491 had: shell-snapshots+well under a second+ | MAN-8501 has: 0` while the defect stands; cured when the second number is ≥1
```

measured 2026-10-16 by chain chain-toolset-skeleton--docs-20261016-092338-5af2, finding L5, LOW
probe-key: d11c501bcd2456dd0b141441eca51f4e4c61f776

governs: /home/lyphe/.claude/claudecodeui_lyphe/bin/toolset.mjs, /home/lyphe/.claude/claudecodeui_lyphe/deploy/systemd/cloudcli-server-dev.service, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/toolsets/toolsets.command-link.ts

## INV-8499 — usage-hold-account probes — a scratch chain that names its own HEAL_LEDGER_PATH launches a Chiron judge on the default model

A scratch chain that sets `HEAL_LEDGER_PATH` files friction rows and opens the heal worker's door (`chain_walk._friction_ending`); the worker's cycle launches a Chiron judge on `claude-sonnet-5-5`, not Haiku.

- Measured 2026-10-16: 7 judges in 4 scratch dirs, 46k–81k tokens each.
- `usage-hold-account-scratch.py` therefore sets `HEAL_REFLEX_DISABLE=1` and `QUIET_CHECKPOINT_DISABLE=1`, pops `HEAL_LEDGER_PATH`, and ends both modes with a reading that fails when any heal cycle or Chiron judge appears.
- Any probe added to this file keeps all four.
- Proof commands and what they cover: MAN-8514.

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/usage-hold-account-scratch.py

## INV-8514 — probe — MEDIUM — a message sent with an image is drawn twice, and stays twice until the page reloads (plain mode on)

MEDIUM — a message sent with an image is drawn twice, and stays twice until the page reloads (plain mode on)

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/img.mts" <<'TS'
import { ClaudeSessionsProvider } from '/home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-sessions.provider.ts';
import { removeOptimisticUserEchoes } from '/home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/utils/sessionMessageReconciliation.ts';
const provider = new ClaudeSessionsProvider();
const png = 'iVBORw0KGgo=';
const saved = (text: string) => ({ type: 'user', uuid: '11111111-2222-4333-8444-555555555555', sessionId: 's', timestamp: '2026-10-17T02:09:19.596Z',
  message: { role: 'user', content: [{ type: 'text', text }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }] } });
const typed = 'In one word, what colour is the attached image?';
const local: any = { id: 'local_1', kind: 'text', role: 'user', content: typed, timestamp: '2026-10-17T02:09:19.556Z', images: [{ data: `data:image/png;base64,${png}` }] };
for (const [label, wire] of [['plain mode ON  (wire text "/plain …")', `/plain ${typed}`], ['plain mode OFF (wire text as typed)', typed]] as const) {
  const server = provider.normalizeMessage(saved(wire), 'sess') as any[];
  const kept = removeOptimisticUserEchoes(server, [local]);
  console.log(`${label}: server rows ${server.length}, images ${server[0]?.images?.length}; optimistic echoes left on screen: ${kept.length}`);
}
process.exit(0);
TS
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
TSX_TSCONFIG_PATH=server/tsconfig.json timeout 120 node --import tsx "$1/img.mts" 2>&1 | tail -6
EOF
bash "$D/p.sh" "$D"
cd /tmp; case "$D" in /tmp/athena-p.??????) rm -r "$D";; esac
echo "[probe exit $?]"
expect: `plain mode ON … optimistic echoes left on screen: 1` and `plain mode OFF … left on screen: 0` while the defect stands; cured when the ON line also prints 0
```

measured 2026-10-16 by chain chain-trailing-old-message-20261016-182307-9d20, finding M1, MEDIUM
probe-key: 56916b9e81696df2b5a4ea20069f4e98df53b9c8

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-sessions.provider.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/session-conversations-search.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/claude-transcript-rows.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/local-commands.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/trailing-message-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/trailing-old-message-before.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/trailing-old-message-proof.mjs

## INV-8515 — probe — LOW — the proof can pass without ever meeting the defect it is the proof of

LOW — the proof can pass without ever meeting the defect it is the proof of

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
echo "report.ok lines about blobs in the proof: $(grep -c 'report.ok(.*[Bb]lob' .verify/trailing-old-message-proof.mjs)"
grep -n 'blobsPerPrompt' .verify/trailing-old-message-proof.mjs | cut -c1-150
echo "[probe exit $?]"
expect: `report.ok lines about blobs in the proof: 0` and one `[NOTE]` line that only prints the count, while the defect stands; cured when a report.ok line asserts blobsPerPrompt
```

measured 2026-10-16 by chain chain-trailing-old-message-20261016-182307-9d20, finding L1, LOW
probe-key: a4738a37326b696e2545993f2a47495e6c5433e4

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-sessions.provider.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/services/session-conversations-search.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/claude-transcript-rows.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/local-commands.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/trailing-message-kit.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/trailing-old-message-before.sh, /home/lyphe/.claude/claudecodeui_lyphe/.verify/trailing-old-message-proof.mjs

## INV-8633 — The lanes to shadow-connector read the secret from its env file at call time and copy it nowhere; an allowlist is the only door

Rules for the two lanes to shadow-connector — `server/modules/affected-areas/` (manual: MAN-8559) and `server/modules/carrier-bulletins/` (manual: MAN-8909) — the forwarder they share, `server/shared/shadow-connector-lane.ts` (manual: MAN-8863), and the allowlist router beside it, `server/shared/shadow-connector-lane-router.ts` (manual: MAN-8908):

1. `EIS_INTERNAL_SECRET` is read in `server/shared/shadow-connector-lane.ts` and nowhere else, and is never written to `process.env`, this server's `.env`, a log line or an error message. why: a copy drifts on rotation, and the agent sessions this server spawns inherit its environment. A lane imports the forwarder; it does not parse the env file itself.
2. `describeFailure` uses only an error's NAME and its cause's CODE, never its message. why: a transport error can quote the request, and the request carries the secret.
3. Only a lane's own module (`affected-areas.module.ts`, `carrier-bulletins.module.ts`) reads `SHADOW_CONNECTOR_URL` / `SHADOW_CONNECTOR_ENV_FILE` for its lane, and passes the values to `createShadowConnectorLane` with its own distinct `label`. why: a scratch engine or an empty env file is proven by setting the variable before `createAffectedAreasModule()` / `createCarrierBulletinsModule()`; a shared label would make two lanes' journal lines indistinguishable.
4. A new engine route reaches the browser only as a row of its lane's `ALLOWLIST` with its id rules, query rules and body kind, answered by `createLaneRouter`. why: an unlisted path is the lane's own 404 and a bad id a 422 before any byte leaves; the lane never forwards a caller-invented path or query key. The bulletins lane's table is GET rows only, because its surface is read-only (INV-9382 in shadow-connector).
5. The lane never reshapes an upstream body: status and JSON pass through whole; only lane faults carry `{ error }`. An upstream response header travels only when the lane names it (`passHeaders`); the Tours lane names none, the bulletins lane `x-left-out` and `cache-control`. An image is relayed only if its bytes begin with the lane's format signature as well as carrying its Content-Type.
6. `fetch` keeps `redirect: 'manual'`. why: the secret header must not follow a `Location`.
7. A lane's routes do not copy the router's loop, its tails or its fault-to-status map: a lane that needs different behaviour changes `LaneRouterDefinition`. why: two copies of the checks drift, and a check that is weaker in one lane is an id the engine sees.

Trap: a unit that exports `EIS_INTERNAL_SECRET` in its own environment overrides `.env` for the engine (`main.py` calls `load_dotenv()` with its default `override=False`, so the process environment wins) but not for the lanes, which read only the file: the two then disagree and every forward is the engine's 403. Read from the code 2026-10-17; not reproduced.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/affected-areas/affected-areas.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/affected-areas/affected-areas.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/carrier-bulletins/carrier-bulletins.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/carrier-bulletins/carrier-bulletins.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/shadow-connector-lane-router.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/shadow-connector-lane.ts

## INV-8644 — probe — LOW — The gallery tag is 3.55:1 over a white photo, and neither the sheet nor the report says so

LOW — The gallery tag is 3.55:1 over a white photo, and neither the sheet nor the report says so

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.mjs" <<'EOF'
import { open } from '/home/lyphe/.claude/state/pipeline-reviews/tour-affected-areas--viewer--library/athena-kit.mjs';
const { page, browser } = await open();
try {
  await page.evaluate(() => { const k = document.createElement('canvas'); k.width = k.height = 100; const g = k.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 100, 100); window.__white = k.toDataURL('image/png'); });
  await page.evaluate(() => { const m = window.__mountReact, ui = window.__ui; return m.mount('t', m.h('div', { style: { width: 240 } }, m.h(ui.Gallery, { items: [{ id: 'x', src: window.__white, tag: 'Ceiling' }], label: 'L' }))); });
  await page.waitForTimeout(1000);
  const at = await page.evaluate(() => { const r = document.querySelector('#t .vv-gallery__tag').getBoundingClientRect(); return [r.left + 2, r.top + r.height / 2]; });
  const png = await page.screenshot({ clip: { x: Math.round(at[0]), y: Math.round(at[1]), width: 1, height: 1 } });
  const px = await page.evaluate(async (d) => { const im = new Image(); im.src = d; await im.decode(); const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3); }, 'data:image/png;base64,' + png.toString('base64'));
  const lum = (a) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(a[0]) + .7152 * f(a[1]) + .0722 * f(a[2]); };
  console.log('white tag ink over its scrim on an all-white photo: scrim pixel', JSON.stringify(px), '-> contrast', (1.05 / (lum(px) + .05)).toFixed(2) + ':1 (AA small text is 4.5:1)');
} finally { await browser.close(); }
EOF
node "$D/p.mjs"
expect: today contrast 3.55:1; cured (a darker scrim) 4.5:1 or more
```

measured 2026-10-17 by chain chain-tour-affected-areas--viewer--library-20261017-115408-9359, finding L5, LOW
probe-key: 2890e8a5da79b7b74745bd594f6024f790079fdb

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Gallery.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/PhotoFill.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/RegionImage.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/media.css

## INV-8665 — probe — LOW — MAN-8573's "19 of 60 recent tours … 8 of those" drops the population that makes it true

LOW — MAN-8573's "19 of 60 recent tours … 8 of those" drops the population that makes it true

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.py" <<'EOF'
import asyncio, logging, sys
sys.path.insert(0, "/opt/shadow-connector")
logging.disable(logging.CRITICAL)
from core import db
from extractors.docusketch.panoramas import fetch_tour
from core.field_monitoring_engine.room_matcher import canonical_key
async def measure(where):
    rows = await db.fetch(f"select tour_id from docusketch_tours {where} order by created_by_user desc nulls last limit 60")
    multi = rep = 0
    for r in rows:
        got = await fetch_tour(r["tour_id"])
        if not got: continue
        panos = got[1]
        if len({p.floor for p in panos if p.floor is not None}) > 1:
            multi += 1
            kf = {}
            for p in panos:
                if p.floor is not None and p.room: kf.setdefault(canonical_key(p.room), set()).add(p.floor)
            rep += any(len(v) > 1 for v in kf.values())
    return multi, rep
async def main():
    print("newest 60 tours:", await measure(""), "| newest 60 with panorama_count >= 12:", await measure("where panorama_count >= 12"))
    print("MAN-8573 says:", [l for l in open("/opt/shadow-connector/core/affected_areas/judgment/MANUAL.md") if "recent tours" in l][0][:120].strip())
asyncio.run(main())
EOF
cat > "$D/p.sh" <<'EOF'
cd /opt/shadow-connector && venv/bin/python -I "$1/p.py" 2>&1 | tail -3
EOF
bash "$D/p.sh" "$D"
expect: "newest 60 tours: (14, 7) | newest 60 with panorama_count >= 12: (19, 8)" and a row line that says "19 of 60 recent tours" without "12+ panos" while the qualifier is missing (the tallies drift as tours arrive; the point is that the unfiltered sample does not give 19)
```

measured 2026-10-17 by chain chain-tour-affected-areas--rooms--docs-20261017-151147-c858, finding L1, LOW
probe-key: be1b37f55a36ab3354dd33564c06a8dd7ff5db6f

governs: /opt/shadow-connector/core/affected_areas/judgment/rooms.py

## INV-8669 — probe — LOW — MAN-3035 states that `water_remediation.txt` carries no `{room_list}` but not what that means: a Water narrative never sees the marked areas

LOW — MAN-3035 states that `water_remediation.txt` carries no `{room_list}` but not what that means: a Water narrative never sees the marked areas

```probe
cd /opt/shadow-connector && grep -c "{room_list}" core/preliminary_estimator/prompts/water_remediation.txt core/preliminary_estimator/prompts/room_discovery.txt; docstore get MAN-3035 --text | grep -c "Water"
expect: "water_remediation.txt:0", "room_discovery.txt:1" and a "Water" count of 0 for MAN-3035 while the row is silent about the Water narrative
```

measured 2026-10-17 by chain chain-tour-affected-areas--rooms--docs-20261017-151147-c858, finding L5, LOW
probe-key: 3cb83b06247521d690c82ed1ae10ba6b77ad6115

governs: /opt/shadow-connector/core/estimator/fire_smoke_breakdown.py

## INV-8670 — probe — LOW — "the one home of the repeat-shot rule" in MAN-3037 and INV-2337 is unscoped; `_pano_seed` strips ` #N` by its own regex

LOW — "the one home of the repeat-shot rule" in MAN-3037 and INV-2337 is unscoped; `_pano_seed` strips ` #N` by its own regex

```probe
cd /opt/shadow-connector && grep -n "_SHOT_SUFFIX" extractors/docusketch/panoramas.py core/sketch_forge/_pano_seed.py | head -4; docstore get MAN-3037 --text | grep -c "the one home of the repeat-shot rule"
expect: two `_SHOT_SUFFIX…` definitions (panoramas.py:67 and _pano_seed.py:54) and a count of 1 while MAN-3037 says "the one home" unscoped
```

measured 2026-10-17 by chain chain-tour-affected-areas--rooms--docs-20261017-151147-c858, finding L6, LOW
probe-key: 02fcf21b7c1ab10735441ae3b9a45d241ecaa80c

governs: /opt/shadow-connector/cerberus/preliminary_editor_v2_SHIP_HISTORY.md, /opt/shadow-connector/core/estimator/extract_docusketch.py, /opt/shadow-connector/core/estimator/fire_smoke_breakdown.py, /opt/shadow-connector/core/estimator/SHIP_HISTORY.md, /opt/shadow-connector/core/preliminary_estimator/photo_areas.py, /opt/shadow-connector/core/preliminary_estimator/room_list.py, /opt/shadow-connector/extractors/docusketch/docusketch.md, /opt/shadow-connector/extractors/docusketch/panoramas.py, /opt/shadow-connector/installation_guides/preliminary_estimator_schema.sql, /opt/shadow-connector/installation_guides/preliminary_estimator_v2_schema.sql, /opt/shadow-connector/plans/predictive-estimator.md, /opt/shadow-connector/plans/preliminary-editor-v2.md, /opt/shadow-connector/scripts/migrate_preliminary_estimates.py

## INV-8671 — probe — LOW — two of the five seam runs the brief asked for are not in the report, and the required search does not print two of its three subjects

LOW — two of the five seam runs the brief asked for are not in the report, and the required search does not print two of its three subjects

```probe
cd /opt/shadow-connector && docstore search "affected rooms marked areas preliminary estimator authority" --text | cut -c1-60
expect: two lines (MAN-8574, MAN-8573) while the Architecture row and the Tours-view room-list row are not findable by the brief's own words; four once MAN-3035 and MAN-8578 carry them in their titles
```

measured 2026-10-17 by chain chain-tour-affected-areas--rooms--docs-20261017-151147-c858, finding L7, LOW
probe-key: a67a6cb79a3c89a42d0addefb4d99d5900d04af5

governs: /home/lyphe/.claude/claudecodeui_lyphe/

## INV-8673 — probe — (LOW) — still open (builder-acknowledged): the tour screen fetches every cut pano's photo, not the 24 it draws

(LOW) — still open (builder-acknowledged): the tour screen fetches every cut pano's photo, not the 24 it draws

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node /home/lyphe/.claude/state/pipeline-reviews/tour-affected-areas--viewer--fill/athena-probes/tile-overfetch.mjs
expect: "image requests after the tour opens: 30 | unique shas: 30 | tiles drawn: 24" (cured: ≤ 24)
```

measured 2026-10-17 by chain chain-tour-affected-areas--viewer--fill-20261017-140745-860f, finding L1, LOW
probe-key: a7177ed89906e14a4ad694f7ee445c78b126b296

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useImageUrl.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/usePano.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/utils/laneTrouble.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/CerberusPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useLaneRead.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-view.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-walk.mjs

## INV-8675 — probe — (LOW) — A never-cut pano whose cut failed to answer has no Try again

(LOW) — A never-cut pano whose cut failed to answer has no Try again

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node /home/lyphe/.claude/state/pipeline-reviews/tour-affected-areas--viewer--fill/athena-probes/uncut-503.mjs
expect: "alerts":["shadow-connector can't be reached"] and "buttons":["Israel Serrano","Read this pano","Read the rest of this tour"] with no Try again (cured: a Try again button); if Israel Serrano has no never-cut pano left it prints that
```

measured 2026-10-17 by chain chain-tour-affected-areas--viewer--fill-20261017-140745-860f, finding L3, LOW
probe-key: 3ea2d1ac777ea3fde8a56e570c07c5ed9a6b6555

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useImageUrl.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/usePano.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/utils/laneTrouble.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/CerberusPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useLaneRead.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-view.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-walk.mjs

## INV-8676 — probe — (LOW) — An in-flight press is forgotten when another pano is opened and the first one comes back

(LOW) — An in-flight press is forgotten when another pano is opened and the first one comes back

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && node /home/lyphe/.claude/state/pipeline-reviews/tour-affected-areas--viewer--fill/athena-probes/inflight.mjs
expect: line "back on A, A still in flight" reads btn ["Read this pano"], busy 0, armedSoFar 1 (cured: ["Reading this pano…"], busy 1)
```

measured 2026-10-17 by chain chain-tour-affected-areas--viewer--fill-20261017-140745-860f, finding L4, LOW
probe-key: 5aae3c8d51a81dfcf76a3b9748aec062a3a61077

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useImageUrl.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/usePano.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/utils/laneTrouble.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/cerberus/CerberusPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useLaneRead.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-view.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-walk.mjs

## INV-8687 — probe — LOW — Skip on the last area of a batch while its mark is out reads a batch that serves the marked area again, offered with its presses on; a second press writes a second row

LOW — Skip on the last area of a batch while its mark is out reads a batch that serves the marked area again, offered with its presses on; a second press writes a second row

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd "$HOME/.claude/state/pipeline-reviews/tour-affected-areas--marking--fill/athena-probes" && timeout 200 node p10-onlyone.mjs 2>&1 | grep -E 'RESULT|CLEANUP|PROBE ERROR'
EOF
bash "$D/p.sh"
expect: while it stands `RESULT queue of one: left 1 | after Y then S the next batch head is the area just marked = true | its Confirm is offered in the window = true … | pressed Y on it | mark POSTs sent for it = 2 | rows for it = 2`; cured: Confirm offered = false (or the skip refused), `mark POSTs sent for it = 1 | rows for it = 1`. Both end with `CLEANUP … EQUAL`; if the Water stain unsure queue no longer holds exactly one area the probe prints what it saw instead.
```

measured 2026-10-17 by chain chain-tour-affected-areas--marking--fill-20261017-200005-ba7f, finding L8, LOW
probe-key: 5b421fcf604f06bcb83fc47bcf981801d718f3be

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useMarkedRegions.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useProving.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useQueue.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-marking.mjs

## INV-8690 — probe — MEDIUM — MAN-8558's "Not yet measured" says `/queue` and `/proving` answered 404 and orders a correction this plan was to make

MEDIUM — MAN-8558's "Not yet measured" says `/queue` and `/proving` answered 404 and orders a correction this plan was to make

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/q.mjs" <<'EOS'
import { curlJson, loginToken } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-kit.mjs';
const t = loginToken();
console.log('live: /queue', curlJson('GET', '/api/affected-areas/queue?mode=unsure&limit=1', undefined, t).status, '/proving', curlJson('GET', '/api/affected-areas/proving', undefined, t).status);
EOS
node "$D/q.mjs"
printf 'MAN-8558 stale lines: '; docstore get MAN-8558 --text | sed -n '/## Not yet measured/,$p' | grep -c -E "answered 404|Correct the comments when the marks routes land"
EOF
bash "$D/p.sh"
expect: today "live: /queue 200 /proving 200" and "MAN-8558 stale lines: 2"; cured: the section says what was measured (dated), or is gone, and the count is 0
```

measured 2026-10-17 by chain chain-tour-affected-areas--marking--docs-20261017-212539-905c, finding M2, MEDIUM
probe-key: 58ab8943b27ec1be62b9c8d97d1521213ca98c18

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/affected-areas-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts

## INV-8691 — probe — LOW — The intent's one required search does not print the Tables row

LOW — The intent's one required search does not print the Tables row

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
printf 'intent search : '; docstore search "affected areas marking mark screen tables SegmentedControl DataTable" --text | cut -d' ' -f1 | tr '\n' ' '; echo
EOF
bash "$D/p.sh"
expect: today "intent search : MAN-8580 MAN-8582 MAN-8574"; cured: MAN-8581 is printed and no row of another package (MAN-8574) is
```

measured 2026-10-17 by chain chain-tour-affected-areas--marking--docs-20261017-212539-905c, finding L1, LOW
probe-key: 2e792927f2b8fe5ce5970d65f4f97f50a4fc00a1

governs: /home/lyphe/.claude/claudecodeui_lyphe/

## INV-8692 — probe — LOW — The package the intent names does not exist; the rows sit in `cloudcli:.` and the report does not say why

LOW — The package the intent names does not exist; the rows sit in `cloudcli:.` and the report does not say why

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
printf 'package            : '; docstore list cloudcli:src/modules/affected-areas --text 2>&1 | cut -c1-40 | head -1
printf 'rows in cloudcli:. : '; docstore list cloudcli:. --text | grep -c -E '^(MAN-8581|MAN-8582|MAN-8583) '
EOF
bash "$D/p.sh"
expect: today "no package cloudcli:src/modules/affected" and 3; cured: the package lists the rows (and the second count is 0), or the report says the rows stay in cloudcli:. and why
```

measured 2026-10-17 by chain chain-tour-affected-areas--marking--docs-20261017-212539-905c, finding L2, LOW
probe-key: 3ae8ff3ee16afc49ec8edc2c24b7c8f79f109f1e

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/AffectedAreasView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/FacePhoto.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useMarkedRegions.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useProving.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useQueue.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/LayerSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkBar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPresses.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPress.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkQueue.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MissedDraw.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/NoteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/PanoScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/ProvingDetail.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/ProvingTable.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/RegionList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/TablesScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/ThresholdControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/ToursSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingMark.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingVerdict.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/utils/provingModel.ts

## INV-8693 — probe — LOW — MAN-8582/8583 state rules for files they do not govern

LOW — MAN-8582/8583 state rules for files they do not govern

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
printf 'PanoScreen.tsx shows : '; docstore govern /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/PanoScreen.tsx --touch write --limit 40 --text | cut -d' ' -f1 | tr '\n' ' '; echo
EOF
bash "$D/p.sh"
expect: today "PanoScreen.tsx shows : MAN-8575"; cured: MAN-8582 or MAN-8583 is among the tokens printed
```

measured 2026-10-17 by chain chain-tour-affected-areas--marking--docs-20261017-212539-905c, finding L3, LOW
probe-key: 4282175df918793d83267ea6fe2e9f1545204388

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/AffectedAreasView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/FacePhoto.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useMarkedRegions.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useQueue.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/LayerSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkBar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPresses.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPress.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkQueue.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MissedDraw.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/NoteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/PanoScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/RegionList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/ToursSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingMark.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingVerdict.tsx

## INV-8694 — probe — LOW — MAN-8582 says less than the screen does in two places

LOW — MAN-8582 says less than the screen does in two places

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas || exit 1
printf 'MarkQueue facts block names the mode: '; sed -n '/const facts = \[/,/\.join/p' MarkQueue.tsx | grep -c "mode"
printf 'MAN-8582 random row mentions the confidence line: '; docstore get MAN-8582 --text | grep -F '| `random` |' | grep -c "% sure"
printf 'MAN-8582 MarkBar line carries MarkQueue (type and component): '; docstore get MAN-8582 --text | grep '^| `MarkBar.tsx`' | grep -o '`MarkQueue`' | wc -l
printf 'MarkQueue is both (type, component): '; grep -c "export type MarkQueue" /home/lyphe/.claude/claudecodeui_lyphe/src/shared/affected-areas-types.ts; grep -c "export function MarkQueue" MarkQueue.tsx
EOF
bash "$D/p.sh"
expect: today 0 (facts block has no mode), 0 (random row silent), 2, then 1 and 1; cured: the second is 1 or the row says both modes show it, and the MarkBar line tells the type from the component
```

measured 2026-10-17 by chain chain-tour-affected-areas--marking--docs-20261017-212539-905c, finding L4, LOW
probe-key: 2a9c0a4b425d43c4a463fd3d0e01811f86a73542

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/AffectedAreasView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/FacePhoto.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useMarkedRegions.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useQueue.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/LayerSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkBar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPresses.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPress.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkQueue.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MissedDraw.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/NoteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/PanoScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/RegionList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/ToursSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingMark.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingVerdict.tsx

## INV-8695 — probe — LOW — MAN-8583 says the library ignores a small box "with no word"; the screen says one

LOW — MAN-8583 says the library ignores a small box "with no word"; the screen says one

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
printf 'MAN-8583 "with no word": '; docstore get MAN-8583 --text | grep -c "with no word"
printf 'FacePhoto draws missed.floor: '; grep -c "affectedAreas.missed.floor" src/modules/affected-areas/FacePhoto.tsx
printf 'MAN-8583 names missed.floor: '; docstore get MAN-8583 --text | grep -c "missed.floor"
EOF
bash "$D/p.sh"
expect: today 1, 1, 0; cured: the row says the screen speaks (missed.floor) and the third count is 1
```

measured 2026-10-17 by chain chain-tour-affected-areas--marking--docs-20261017-212539-905c, finding L5, LOW
probe-key: 6498027f456d8a487ea2c7e3a0ad11417f2b3026

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/AffectedAreasView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/FacePhoto.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/LayerSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkBar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPresses.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPress.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkQueue.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MissedDraw.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/NoteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/PanoScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/RegionList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingMark.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingVerdict.tsx

## INV-8696 — probe — LOW — Two lines narrate the review instead of stating a fact

LOW — Two lines narrate the review instead of stating a fact

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
for t in MAN-8583 MAN-8577; do printf '%s: ' $t; docstore get $t --text | grep -c -E "the review's own probes|run end to end at the review"; done
EOF
bash "$D/p.sh"
expect: today MAN-8583: 1 and MAN-8577: 1; cured: 0 for both
```

measured 2026-10-17 by chain chain-tour-affected-areas--marking--docs-20261017-212539-905c, finding L6, LOW
probe-key: 6e704d3884496d92ade2c6896bbe469b59fc3389

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/AffectedAreasView.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/FacePhoto.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/LayerSwitch.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkBar.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPresses.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkPress.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkQueue.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MissedDraw.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/NoteDialog.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/PanoScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/RegionList.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingMark.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/UnderstandingVerdict.tsx

## INV-8697 — probe — LOW — "1,183 px" is a measurement of one corpus, stated as the table's width

LOW — "1,183 px" is a measurement of one corpus, stated as the table's width

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/q.mjs" <<'EOS'
import { openConsole } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
import { openCerberusTab } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/node-card.mjs';
const { page, browser } = await openConsole({ viewport: { width: 1280, height: 900 } });
try {
  await openCerberusTab(page);
  await page.getByRole('tab', { name: 'Tours', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'What Tours shows' }).getByRole('radio', { name: 'Tables', exact: true }).click();
  await page.locator('table[aria-label^="Each kind"] tbody tr').first().waitFor({ timeout: 30000 });
  await new Promise((r) => setTimeout(r, 600));
  const w = await page.evaluate(() => { const f = document.querySelector('.vv-datatable'); return [f.clientWidth, f.scrollWidth]; });
  console.log('live frame shows', w[0], 'of', w[1], 'px');
} finally { await browser.close(); }
EOS
(cd /home/lyphe/.claude/claudecodeui_lyphe && timeout 100 node "$D/q.mjs")
printf 'rows say 1,183 (MAN-8580, MAN-8581): '; for t in MAN-8580 MAN-8581; do docstore get $t --text | grep -c "1,183"; done | tr '\n' ' '; echo
EOF
bash "$D/p.sh"
expect: today "live frame shows 885 of 1169 px" and "rows say 1,183 (MAN-8580, MAN-8581): 1 1" (corpus-dependent: the width follows the lines set); cured: the rows name what the figure was measured with, or the live width and the rows agree
```

measured 2026-10-17 by chain chain-tour-affected-areas--marking--docs-20261017-212539-905c, finding L7, LOW
probe-key: cdf71bac1fe2ac9e8487ccdf2fa460c333543a66

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/hooks/useProving.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/ProvingDetail.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/ProvingTable.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/TablesScreen.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/ThresholdControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/utils/provingModel.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/DataTable.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/SegmentedControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/data.css

## INV-8698 — probe — LOW — `SegmentedControl`'s `count` has no site, and the row never says so

LOW — `SegmentedControl`'s `count` has no site, and the row never says so

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
printf 'callers passing count: '; grep -n "count:" src/modules/affected-areas/ToursSwitch.tsx src/modules/affected-areas/LayerSwitch.tsx src/modules/affected-areas/MarkQueue.tsx | grep -vc "walk.left"
printf 'MAN-8580 says no caller passes count: '; docstore get MAN-8580 --text | grep -c -i -E "no caller passes .?count|nobody passes .?count"
EOF
bash "$D/p.sh"
expect: today 0 and 0; cured: the second is 1 (the row says no caller passes `count` today), or the first is non-zero and the row's site column names that caller
```

measured 2026-10-17 by chain chain-tour-affected-areas--marking--docs-20261017-212539-905c, finding L8, LOW
probe-key: e214705f08e46ac68956e239ecbfeadf86156da8

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/DataTable.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/SegmentedControl.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/verve/data.css

## INV-8734 — probe — before the pano answers, `faceCounts` (listing branch) calls every area of a pano that has none standing "proposed", including areas the operator set aside; the tile and the tour line read "N found" for the same pano.

before the pano answers, `faceCounts` (listing branch) calls every area of a pano that has none standing "proposed", including areas the operator set aside; the tile and the tour line read "N found" for the same pano.

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'INNER'
D="$1"; SRC=/home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/utils
cp "$SRC/tourModel.ts" "$SRC/regionLook.ts" "$D/"
sed -i "s#'@/modules/affected-areas/utils/regionLook'#'./regionLook.ts'#; s#'@/shared/utils'#'./stubutils.ts'#" "$D/tourModel.ts"
sed -i "s#from '@/shared/types'#from './stubutils.ts'#" "$D/regionLook.ts"
cat > "$D/stubutils.ts" <<'EOF'
export const formatRelativeTime = (x: any) => 'ago';
export const formatShortDate = (x: any) => (x === null ? null : 'Oct 12');
export type Tone = any;
EOF
cat > "$D/run.mts" <<'EOF'
import { faceCounts } from './tourModel.ts';
const away = (id: string) => ({ regionId: id, source: 'model', mark: { verdict: 'not_a_change', newClass: null }, standing: false, threshold: null }) as any;
const read = { status: 'read', regionsCount: 2, standingCount: 0 };
console.log('pano listing, both areas marked not-a-change:', JSON.stringify(faceCounts({ read } as any)));
console.log('pano answered, same two areas              :', JSON.stringify(faceCounts({ read, regions: [away('a'), away('b')] } as any)));
EOF
node "$D/run.mts" 2>&1 | head -5
INNER
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-probe.*) cd /tmp && rm -r "$D";; esac
expect: the listing line {"areas":0,"setAside":0,"proposed":2} and the answered line {"areas":0,"setAside":2,"proposed":0} while the listing cannot tell the two apart
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--lines-20261017-234250-2ce4, finding L2, LOW
probe-key: ab9ae2bf6636232439977e37a278f13eafee898f

governs: /home/lyphe/.claude/claudecodeui_lyphe/

## INV-8752 — probe — LOW — the served regions array is not in badge order once a drawn area's served number passes a model region's

LOW — the served regions array is not in badge order once a drawn area's served number passes a model region's

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
bash "$HOME/.claude/state/pipeline-reviews/tour-affected-areas--judgment--seen-back/probes/served_order.sh"
EOF
bash "$D/p.sh"
cd /tmp && case "$D" in /tmp/athena-p.??????) rm -r "$D";; esac
expect: while it stands `served array (source, badge): [('model', 1), ('human', 3), ('model', 2)] | unique: True | ascending: False | pano_detail sorts: False`; cured: `ascending: True` (a sort in the SQL or in `pano_detail`; if the cure is a sort inside `pano_detail`, `pano_detail sorts: True` is the word, and the first half of the line may still print the SQL's order)
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--seen-back-20261018-034440-f5c2, finding L1, LOW
probe-key: 4b9a50fdf1026d2ee0994e0a406c49a2161edbd7

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-judgments-seen.mjs

## INV-8753 — probe — LOW — INV-8688 stays a live row, though both of its halves now print the cured answer, and its `expect` carries a correction-history note

LOW — INV-8688 stays a live row, though both of its halves now print the cured answer, and its `expect` carries a correction-history note

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
bash "$HOME/.claude/state/pipeline-reviews/tour-affected-areas--judgment--seen-back/probes/inv8688.sh"
EOF
bash "$D/p.sh"
cd /tmp && case "$D" in /tmp/athena-p.??????) rm -r "$D";; esac
expect: while it stands `RESULT place: left on item 3 = true | back on Mark the item is item 3 (place kept)`, `INV-8688 still a live row: 1` and `INV-8688 carries a cured-on-date history note: 1`; cured: the row is retired, both counts print 0
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--seen-back-20261018-034440-f5c2, finding L2, LOW
probe-key: 07e32078077657b8875dddff2f86f1d345f6bbc3

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-judgments-seen.mjs

## INV-8754 — probe — LOW — MAN-8582 still names a script that exits 2 as the whole-run proof, and does not name the one that runs

LOW — MAN-8582 still names a script that exits 2 as the whole-run proof, and does not name the one that runs

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
bash "$HOME/.claude/state/pipeline-reviews/tour-affected-areas--judgment--seen-back/probes/marking_script.sh"
EOF
bash "$D/p.sh"
cd /tmp && case "$D" in /tmp/athena-p.??????) rm -r "$D";; esac
expect: while it stands `rc=2`, `MAN-8582 still names it as the whole-run proof: 1` and `MAN-8582 names the script that runs: 0`; cured: `rc=0` (or the row names the script that runs)
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--seen-back-20261018-034440-f5c2, finding L3, LOW
probe-key: 1f07ec948062d56d53b4ed47a3684d06372d5edf

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-judgments-seen.mjs

## INV-8755 — probe — LOW — the new verify script's drawn-area check cannot tell the served rule from the stored one

LOW — the new verify script's drawn-area check cannot tell the served rule from the stored one

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
bash "$HOME/.claude/state/pipeline-reviews/tour-affected-areas--judgment--seen-back/probes/script_discriminates.sh"
EOF
bash "$D/p.sh"
cd /tmp && case "$D" in /tmp/athena-p.??????) rm -r "$D";; esac
expect: while it stands `7 of 7` (every re-read view: stored next == shown count + 1) and `verdicts in the script that compare against the stored ordinal: 0`; cured: a verdict that compares the served badge against a stored one that differs (the second count ≥ 1)
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--seen-back-20261018-034440-f5c2, finding L4, LOW
probe-key: e4a998811a5bb10d9585f475491755d013471d85

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-judgments-seen.mjs

## INV-8756 — probe — LOW — "skips are reset on a mode or kind change" is not what the screen does: they come back on the return

LOW — "skips are reset on a mode or kind change" is not what the screen does: they come back on the return

```probe
D=$(mktemp -d /tmp/athena-p.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
bash "$HOME/.claude/state/pipeline-reviews/tour-affected-areas--judgment--seen-back/probes/skip_switch.sh"
EOF
bash "$D/p.sh"
cd /tmp && case "$D" in /tmp/athena-p.??????) rm -r "$D";; esac
expect: while it stands `… => SKIPS KEPT` and `MAN-8583 says the skips are reset on a mode or kind change: 1`; cured: the words say they are kept per queue (count 0), or the behaviour is reset (`=> SKIPS RESET`). The probe writes nothing and ends `CLEANUP … EQUAL`
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--seen-back-20261018-034440-f5c2, finding L5, LOW
probe-key: 23de0c066dc4d185bb3b3be303ec0435fda03f5e

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-judgments-seen.mjs

## INV-8761 — probe — The tour header says "48 of 48 cut views read" and, in the same block, "1 pano · 6 views not read yet" the moment one read is not current. The picker badge and the gallery's read state do not know `current` at all.

The tour header says "48 of 48 cut views read" and, in the same block, "1 pano · 6 views not read yet" the moment one read is not current. The picker badge and the gallery's read state do not know `current` at all.

```probe
node /home/lyphe/.claude/state/pipeline-reviews/tour-affected-areas--judgment--told/athena-probes/stale-tour-header.mjs
expect: prints "facts line: 48 of 48 cut views read" and "rest line : 1 pano · 6 views not read yet" while the defect stands; "none" for a line means its wording changed
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--told-20261018-035727-4558, finding M1, MEDIUM
probe-key: 428d12a50b1101fb6c8d1de7c7beb63c27df2dde

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-tours-told.mjs

## INV-8762 — probe — The demo line's words are looser than the field. "Demo had begun before the tour" is `first_removed_at <= THIS ROOM's capture`; the reader's own prompt says "before this room was photographed".

The demo line's words are looser than the field. "Demo had begun before the tour" is `first_removed_at <= THIS ROOM's capture`; the reader's own prompt says "before this room was photographed".

```probe
python3 /home/lyphe/.claude/state/pipeline-reviews/tour-affected-areas--judgment--told/athena-probes/demo-mid-tour.py
expect: prints the tour's first pano (2026-09-29…), the latest demo=False room pano (2026-09-29…) and the earliest demo=True pano (2026-10-09…), then "… the tour began before the demo: True"
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--told-20261018-035727-4558, finding L1, LOW
probe-key: dc1fe4ddf573ebf8e688a79b855628a961e8a0cf

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-tours-told.mjs

## INV-8763 — probe — The builder's script picks rows by position and asserts a literal on them; one `.first()` click is unguarded; one measured number is dropped.

The builder's script picks rows by position and asserts a literal on them; one `.first()` click is unguarded; one measured number is dropped.

```probe
python3 /home/lyphe/.claude/state/pipeline-reviews/tour-affected-areas--judgment--told/athena-probes/script-pick.py
expect: lists the unlinked-with-facts tours in list order (water, other, water, water, other, fire), "script picks: ('Martin, Debra - 103', 'water')", and two ids for the label 'Israel Serrano'
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--told-20261018-035727-4558, finding L2, LOW
probe-key: 86ff5ecb74019ef92e7640405abd1e0e31f240b7

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-tours-told.mjs

## INV-8764 — probe — A sentence this phase made false is left in a sibling script ("Healed means deleted").

A sentence this phase made false is left in a sibling script ("Healed means deleted").

```probe
grep -n "picker names it by address" /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-rooms.mjs || echo none
expect: line 48 while the stale wording stands; "none" once healed
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--told-20261018-035727-4558, finding L3, LOW
probe-key: 7ab57ba400cf860f4bfe69c06026ebbf7617bb74

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-tours-told.mjs

## INV-8765 — probe — The Mark screen still names a pre-job tour "Tour with no job or address". Latent.

The Mark screen still names a pre-job tour "Tour with no job or address". Latent.

```probe
grep -n "item.jobLabel ?? t('affectedAreas.tour.unnamed')" /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/MarkQueue.tsx || echo none
expect: line 126 while the Mark screen names a tour by job label alone; "none" once it falls back to the tour's name
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--told-20261018-035727-4558, finding L4, LOW
probe-key: 260959f5d0d4309873f2b46d614e0116e7739745

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-tours-told.mjs

## INV-8766 — probe — `ContextSummary.propertyType` is a dead wire field whose class docstring says it is what the reader is told.

`ContextSummary.propertyType` is a dead wire field whose class docstring says it is what the reader is told.

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/tour-affected-areas--judgment--told/athena-probes/property-type.sh
expect: "wire propertyType: RESIDENTIAL" and "src/modules readers: none" while the field is dead
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--told-20261018-035727-4558, finding L5, LOW
probe-key: 21e487dfc90a652f7e0c90770c3e0842f68292e1

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-tours-told.mjs

## INV-8767 — probe — `is_current` is described as the buy rule's home, and it is a different predicate. The report does not say which one the intent meant (my S8 asked it to).

`is_current` is described as the buy rule's home, and it is a different predicate. The report does not say which one the intent meant (my S8 asked it to).

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/tour-affected-areas--judgment--told/athena-probes/predicates.sh
expect: three lines — is_current's pair test (shown.py), lookup's "ORDER BY read_seq DESC LIMIT 1" per (sha, contract, model) (seat/store.py), and the shown view's "created_at DESC, read_seq DESC" over ANY contract (schema); the first and the third judge the newest read, the second any read
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--told-20261018-035727-4558, finding L6, LOW
probe-key: 470e0358931a895df7f56622a35c36b3a44439e0

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-tours-told.mjs

## INV-8768 — probe — (MEDIUM) — the refusal says "drag a bigger one" in the one stage where the photo takes no drag

(MEDIUM) — the refusal says "drag a bigger one" in the one stage where the photo takes no drag

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
printf 'layer mounted only while drawing: '; grep -c "drawing={stage.step === 'drawing'" src/modules/affected-areas/FacePhoto.tsx
printf 'refusal set at release, in the drawn stage: '; grep -c "setRefusal(underAreaFloor(box)" src/modules/affected-areas/MissedDraw.tsx
printf 'the sentence: '; jq -r '.affectedAreas.mark.refused.bad_box' src/modules/i18n/locales/en/common.json
EOF
bash "$D/p.sh"
expect: today 1, 1 and "That box is too small to be an area: drag a bigger one"; cured when either count is 0 (the layer stays mounted in the drawn stage, or the refusal is not set at release). Live: `node /home/lyphe/.claude/state/pipeline-reviews/tour-affected-areas--judgment--drawing/athena-slip-probe.mjs <dir>` prints RESULT with `dragBiggerAfterRefusal` equal to `slip3px` while the defect stands (read-only; needs :5183 and a read tour)
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--drawing-20261018-044450-f4c1, finding M1, MEDIUM
probe-key: eacd925bc66394ab536578b32a985b720893911f

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-marking-boxes.mjs

## INV-8770 — probe — (LOW) — MAN-8582's words row names `failed_queue` and not the new `gone_queue`

(LOW) — MAN-8582's words row names `failed_queue` and not the new `gone_queue`

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
printf 'MAN-8582 names gone_queue: '; docstore get MAN-8582 --text | grep -c "gone_queue"
printf 'common.json has gone_queue: '; jq '.affectedAreas.trouble | has("gone_queue")' /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json
EOF
bash "$D/p.sh"
expect: today 0 and true; cured when the first count is 1 or more
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--drawing-20261018-044450-f4c1, finding L2, LOW
probe-key: 5d88c1d8ecaf9af587b203edc68cca29da3eb744

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-marking-boxes.mjs

## INV-8771 — probe — (LOW) — the Mark screen's Rename menu overhangs the 390 window by 10 px; a swipe beside a tall menu closes it

(LOW) — the Mark screen's Rename menu overhangs the 390 window by 10 px; a swipe beside a tall menu closes it

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
node /home/lyphe/.claude/state/pipeline-reviews/tour-affected-areas--judgment--drawing/athena-mark-rename-probe.mjs "$1" 2>&1 | grep RESULT || echo "no result: no read tour or Mark item"
EOF
bash "$D/p.sh" "$D"
expect: today RESULT {"390":{"panelLeft":152,"panelRight":400,"innerWidth":390,"overhangPx":10}}; cured when overhangPx is 0 or less (read-only; needs :5183, a read tour, and one item on the Mark screen)
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--drawing-20261018-044450-f4c1, finding L3, LOW
probe-key: a74295d75344f0cab89abbe822e9445329591bad

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-marking-boxes.mjs

## INV-8791 — probe — LOW — the script's header says a run writes nothing to the shared account; each run writes its stored theme twice

LOW — the script's header says a run writes nothing to the shared account; each run writes its stored theme twice

```probe
D=$(mktemp -d /tmp/aa-theme.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'EOF'
import { openConsole } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
const API = 'http://127.0.0.1:3011';
const login = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'verve', password: 'verve-dev-2026' }) });
const { token } = await login.json();
const stored = async () => (await (await fetch(`${API}/api/user/preferences`, { headers: { Authorization: `Bearer ${token}` } })).json()).preferences?.theme ?? null;
const pass = async (dark) => { const s = await openConsole({ viewport: { width: 1280, height: 900 }, dark }); const t = s.theme.viaToggle; await s.browser.close(); return t; };
const before = await stored();
const lightToggled = await pass(false);
const afterLight = await stored();
await pass(before === 'dark');
console.log(`stored theme before: ${before} | a light pass drove the Dark Mode switch: ${lightToggled} | stored after the light pass: ${afterLight} | restored to: ${await stored()}`);
EOF
cat > "$D/p.sh" <<'EOF'
grep -n "no setting of the shared account" /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-rooms.mjs | cut -c1-200 || echo "header claim: none"
( cd /home/lyphe/.claude/claudecodeui_lyphe && timeout 200 node "$1/p.mjs" 2>&1 | tail -2 )
EOF
bash "$D/p.sh" "$D"
case "$D" in /tmp/aa-theme.*) rm -rf "$D";; esac
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--join-20261018-080148-ae9d, finding L1, LOW
probe-key: f0f85a1eaaf984472d707a2b0996b9bd1ce3a2e6

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-rooms.mjs

## INV-8792 — probe — LOW — the script is green with no affected room on the screen, so its exit code cannot say the join's demonstration happened

LOW — the script is green with no affected room on the screen, so its exit code cannot say the join's demonstration happened

```probe
D=$(mktemp -d /tmp/aa-vacuous.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
D="$1"
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
timeout 300 node .verify/affected-areas-rooms.mjs --tour 6ace5eb736f92c16415baa7e --evidence "$D/ev" > "$D/out.log" 2>&1
echo "script exit=$? | rows whose words say Affected: $(grep -c 'words: "Affected' "$D/out.log") | $(grep -E '^[0-9]+ PASS' "$D/out.log")"
EOF
bash "$D/p.sh" "$D"
case "$D" in /tmp/aa-vacuous.*) rm -rf "$D";; esac
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--join-20261018-080148-ae9d, finding L2, LOW
probe-key: ac6b0f9ce4c9535ca4a117fa7661a2b65b6388fd

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/affected-areas-rooms.mjs

## INV-8793 — probe — INV-2337 says `_download_panoramas` copies every key but `url`; it also drops `mime_type`

INV-2337 says `_download_panoramas` copies every key but `url`; it also drops `mime_type`

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /opt/shadow-connector || exit 1
venv/bin/python -I - <<'PY'
import sys, asyncio; sys.path.insert(0, "/opt/shadow-connector")
from core.estimator import extract_docusketch as E
async def fake(url): return b"x"
E._download_image = fake
r = asyncio.run(E._download_panoramas([{"url": "u", "room_name": "A", "mime_type": "image/jpeg", "floor": 1, "ceiling_height_ft": 8, "is_affected": False, "pano_id": "p"}]))
print("info keys:", sorted(r[0][2]), "| mime_type in info:", "mime_type" in r[0][2])
PY
printf 'INV-2337 lines saying it copies every key but url: '; ~/.claude/scripts/docstore get INV-2337 --text | grep -c "copies every one but .url."
EOF
bash "$D/p.sh"
expect: "info keys: ['ceiling_height_ft', 'floor', 'is_affected', 'pano_id', 'room_name'] | mime_type in info: False" then "INV-2337 lines saying it copies every key but url: 1"   (cured: 0, the row naming `mime_type` as the tuple's second element)
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--docs-20261018-075948-ef11, finding L1, LOW
probe-key: 40e4b4aaf32c59cc202036d7d9ab05f2a25710da

governs: /opt/shadow-connector/core/estimator/extract_docusketch.py, /opt/shadow-connector/core/preliminary_estimator/photo_areas.py, /opt/shadow-connector/core/preliminary_estimator/room_list.py, /opt/shadow-connector/extractors/docusketch/panoramas.py

## INV-8794 — probe — INV-8544's seam-E figures are not the reader's

INV-8544's seam-E figures are not the reader's

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /opt/shadow-connector || exit 1
cat > "$1/e.py" <<'PY'
import asyncio, sys, logging
sys.path.insert(0, '/opt/shadow-connector'); logging.disable(logging.CRITICAL)
from dotenv import load_dotenv; load_dotenv('/opt/shadow-connector/.env')
from core import db
from core.affected_areas.context import build
async def main():
    rows = await db.fetch("select distinct t.tour_id from docusketch_tours t join drying_reports dr on dr.job_id=t.job_id join drying_report_moisture_readings m on m.drying_report_id=dr.id where m.material_removed")
    tours = removed = flags = 0
    for r in rows:
        c = await build(r['tour_id']); tours += 1
        n = sum(1 for rf in c.rooms.values() if rf.drying and any(m.removed for m in rf.drying.materials))
        removed += n > 0; flags += n
    print('fresh: tours with a flag', tours, '| tours showing a removed material', removed, '| room-flags', flags)
asyncio.run(main())
PY
venv/bin/python -I "$1/e.py"
printf 'INV-8544 says: '; ~/.claude/scripts/docstore get INV-8544 --text | grep -o -E "over the [0-9]+ tours whose job carries a flag: [0-9]+ show a removed material, [0-9]+ room-flags"
EOF
bash "$D/p.sh" "$D"
expect: "fresh: tours with a flag 179 | tours showing a removed material 122 | room-flags 321" then "INV-8544 says: over the 179 tours whose job carries a flag: 126 show a removed material, 326 room-flags"   (cured: the two lines agree, or the row carries no count the reader can move)
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--docs-20261018-075948-ef11, finding L2, LOW
probe-key: 4a3e83b618d7407f0b5cc8034130de14e34f7518

governs: /opt/shadow-connector/core/affected_areas/context/rooms.py, /opt/shadow-connector/core/affected_areas/context/sources.py

## INV-8795 — probe — the report's "every file has a row saying what landed" is false for two files seams edited

the report's "every file has a row saying what landed" is false for two files seams edited

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /opt/shadow-connector || exit 1
S=~/.claude/scripts/docstore
for f in cerberus/codex_review.html core/preliminary_estimator/line_item_generator.py; do
  printf '%s: rows governing it that name the landed change: ' "$f"
  for t in $($S govern "$f" --touch write --limit 200 --text | cut -d' ' -f1 | grep -E '^(MAN|INV)-[0-9]+$'); do
    $S get "$t" --text | grep -q -E 'qty fixed|satisfied_by|PHOTO_REASON|READING_MEASURE' && printf '%s ' "$t"
  done
  echo
done
EOF
bash "$D/p.sh"
expect: both lines end after the colon (empty) while the gap stands; cured: MAN-8534 on the first line, MAN-8574 on the second
```

measured 2026-10-18 by chain chain-tour-affected-areas--judgment--docs-20261018-075948-ef11, finding L3, LOW
probe-key: 514e72fcd79a91ee4c5418316f984f6a81e9ce95

governs: /home/lyphe/.claude/claudecodeui_lyphe/

## INV-8819 — capRefusals measures a blank shelf as empty; a heading-carrying restore is accepted only onto a blank shelf

- `capRefusals(caps, display, next, current)` (`memory-caps.ts`): `current` is `''` for a file that is missing or holds only blank space — never the raw whitespace. why: the ratchet compares `next` against `current`, and blank space hides an over-budget write behind its own size; the total-size remedy text also keys on `current === ''`.
- The one caller is `assertIntoTarget` (`memory-assert.ts`); it passes `''` for any step kind when `current.trim() === ''`, the blank test `compose` uses. A new caller does the same.
- A body carrying its own `## Rules` / `## Requirements` heading is a whole-file restore: `compose` accepts it only onto a blank shelf and refuses it on a shelf with content. Do not relax that refusal. Landing table: MAN-8621.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/memory-intake/memory-assert.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/memory-intake/memory-caps.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/memory-intake/memory-compose.ts

## INV-8841 — probe — MAN-8549's corpus sentence does not reproduce as stated, and its characterisation of the remainder is wrong

MAN-8549's corpus sentence does not reproduce as stated, and its characterisation of the remainder is wrong

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.py" <<'PY'
import asyncio, json, os, re, sys
sys.path.insert(0, "/opt/shadow-connector")
import asyncpg
from dotenv import load_dotenv
load_dotenv("/opt/shadow-connector/.env")
TAPE = re.compile(r"tape", re.I)
def walk(v):
    if isinstance(v, str): yield v
    elif isinstance(v, dict):
        for x in v.values(): yield from walk(x)
    elif isinstance(v, list):
        for x in v: yield from walk(x)
async def main():
    c = await asyncpg.connect(host=os.getenv("PG_HOST","192.168.1.95"), port=int(os.getenv("PG_PORT","5433")),
                              database=os.getenv("PG_DB","postgres"), user=os.getenv("PG_USER","postgres"),
                              password=os.getenv("PG_PASS"))
    rows = await c.fetch("select image_sha256, response from affected_area_reads where contract_version='aa.v1' order by id")
    views=set(); occ=0; strings=[]
    for r in rows:
        ss=[s for s in walk(json.loads(r["response"]))]
        n=sum(len(TAPE.findall(s)) for s in ss)
        if n: views.add(r["image_sha256"]); occ+=n
        strings += [s for s in ss if TAPE.search(s)]
    print("distinct views:", len(views), "| occurrences:", occ)
    for label, rx in (("literal protection", r"\b(plastic|sheeting|containment|protection|seal(?:ed|ing)?|poly)\b"),
                      ("protect stem", r"\b(plastic|sheeting|containment|protect\w*|seal\w*|poly)\b")):
        co=0; cl=0
        for s in strings:
            for sent in re.split(r"(?<=[.!?])\s+", s):
                h=len(TAPE.findall(sent))
                if h and re.search(rx, sent, re.I): co+=h; cl+=1
        print(f"{label:20} closure occurrences={co} clauses={cl}")
    rest=[]
    for s in strings:
        for sent in re.split(r"(?<=[.!?])\s+", s):
            if TAPE.search(sent) and not re.search(r"\b(plastic|sheeting|containment|protection|seal(?:ed|ing)?|poly)\b", sent, re.I):
                t=" ".join(sent.split())
                if t not in rest: rest.append(t)
    print("distinct non-closure sentences:", len(rest))
    for t in rest: print(" -", t)
    await c.close()
asyncio.run(main())
PY
cd /opt/shadow-connector && venv/bin/python -I "$D/p.py"
case "$D" in /tmp/athena-probe.*) cd /tmp && rm -r "$D";; esac
expect: "distinct views: 34 | occurrences: 91"; "literal protection closure occurrences=58 clauses=48"; "protect stem closure occurrences=60 clauses=50"; the non-closure list dominated by blue-tape moisture markers — so "50 occurrences" is a clause count and "mostly caution/danger and old repairs" is not supported
```

measured 2026-10-19 by chain chain-blue-tape-kind-20261019-064120-52a9, finding L1, LOW
probe-key: 9a7d3b6a9c99e2a38c9c58aa3587bf4eb5c69d8e

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/ProvingTable.tsx, /opt/shadow-connector/core/affected_areas/routes/read.py, /opt/shadow-connector/core/affected_areas/seat/codebook.py, /opt/shadow-connector/core/affected_areas/seat/contract.py, /opt/shadow-connector/core/affected_areas/seat/__init__.py

## INV-8842 — probe — the first tape_marked read outlines the tape strip alone on 2 of its 3 regions

the first tape_marked read outlines the tape strip alone on 2 of its 3 regions

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.py" <<'PY'
import asyncio, json, os, sys
sys.path.insert(0, "/opt/shadow-connector")
import asyncpg
from dotenv import load_dotenv
load_dotenv("/opt/shadow-connector/.env")
async def main():
    c = await asyncpg.connect(host=os.getenv("PG_HOST","192.168.1.95"), port=int(os.getenv("PG_PORT","5433")),
                              database=os.getenv("PG_DB","postgres"), user=os.getenv("PG_USER","postgres"),
                              password=os.getenv("PG_PASS"))
    rows = await c.fetch("""
        select i.face, rg.confidence, rg.area_frac, rg.polygon, rg.evidence
        from affected_area_regions rg
        join affected_area_reads r on r.id = rg.read_id
        join affected_area_images i on i.image_sha256 = rg.image_sha256
        where i.pano_id = '6ad29b4e12f14e4d72c81907' and rg.class = 'tape_marked' and r.contract_version='aa.v2'
        order by rg.ordinal""")
    for x in rows:
        poly = json.loads(x["polygon"]) if isinstance(x["polygon"], str) else x["polygon"]
        xs=[p[0] for p in poly]; ys=[p[1] for p in poly]
        print(f'face={x["face"]} conf={x["confidence"]} area_frac={x["area_frac"]} '
              f'bbox={max(xs)-min(xs):.3f}x{max(ys)-min(ys):.3f} evidence={x["evidence"]!r}')
    print("tape_marked regions:", len(rows))
    await c.close()
asyncio.run(main())
PY
cd /opt/shadow-connector && venv/bin/python -I "$D/p.py"
case "$D" in /tmp/athena-probe.*) cd /tmp && rm -r "$D";; esac
expect: three tape_marked regions at 0.95; two report bbox 0.036x0.212 and 0.048x0.238 (area_frac 0.001624, 0.001213) with evidence naming the tape line/strip itself — the tape strip, not the marked area
```

measured 2026-10-19 by chain chain-blue-tape-kind-20261019-064120-52a9, finding L2, LOW
probe-key: 106e3e097ad7f20bb85b428d40f7a030c8f6760f

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/ProvingTable.tsx, /opt/shadow-connector/core/affected_areas/routes/read.py, /opt/shadow-connector/core/affected_areas/seat/codebook.py, /opt/shadow-connector/core/affected_areas/seat/contract.py, /opt/shadow-connector/core/affected_areas/seat/__init__.py

## INV-8852 — probe — (LOW). The report's "nothing else buys a read" is true now and omits that the bump makes 156 old views buyable by the next press or event

(LOW). The report's "nothing else buys a read" is true now and omits that the bump makes 156 old views buyable by the next press or event

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.py" <<'PY'
import asyncio, os, sys
sys.path.insert(0, "/opt/shadow-connector")
import asyncpg
from dotenv import load_dotenv
load_dotenv("/opt/shadow-connector/.env")
async def main():
    c = await asyncpg.connect(host=os.getenv("PG_HOST","192.168.1.95"), port=int(os.getenv("PG_PORT","5433")),
        database=os.getenv("PG_DB","postgres"), user=os.getenv("PG_USER","postgres"), password=os.getenv("PG_PASS"))
    cur = await c.fetchval("select contract_version from affected_area_reads order by created_at desc limit 1")
    rows = await c.fetch("""select i.tour_id, count(distinct i.image_sha256) views
        from affected_area_reads r join affected_area_images i on i.image_sha256=r.image_sha256
        where not exists (select 1 from affected_area_reads n where n.image_sha256=r.image_sha256 and n.contract_version=$1)
        group by 1 order by 2 desc""", cur)
    print("newest read's contract:", cur, "| views read only under an older contract, by tour:", [(r["tour_id"][:8], r["views"]) for r in rows], "| total:", sum(r["views"] for r in rows))
    await c.close()
asyncio.run(main())
PY
cd /opt/shadow-connector && venv/bin/python -I "$D/p.py"
case "$D" in /tmp/athena-probe.*) cd /tmp && rm -r "$D";; esac
echo "[probe exit $?]"
expect: aa.v3 and total 156 across 5 tours while those tours are not re-read; the total falls as tours are pressed
```

measured 2026-10-19 by chain chain-doubtful-areas-20261019-082056-6ef4, finding L1, LOW
probe-key: b7de67ccfd48038ab0e7e7110c84abec8045990f

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/affected-areas/ProvingTable.tsx, /opt/shadow-connector/core/affected_areas/seat/contract.py, /opt/shadow-connector/core/affected_areas/seat/__init__.py

## INV-8893 — probe — LOW — the gate's chat "pane did not move during the carry" check passes with the freeze undone

LOW — the gate's chat "pane did not move during the carry" check passes with the freeze undone

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/native-scroll-drag-lists/athena-probes/run.sh vacuous.mjs
echo "[probe exit $?]"
expect: `pane unfrozen by the page   : [pane overflow at rest auto → at the hold auto → …] the leg's "pane did not move during the carry" check PASSED` then `VACUOUS: the check passes with the freeze undone` while the defect stands; the unfrozen line reads FAILED and the last line `SOUND: …` once the chat leg starts mid-list with the finger moving up
```

measured 2026-10-20 by chain chain-native-scroll-drag-lists-20261020-061555-de67, finding L1, LOW
probe-key: 77e2414782a444f19108a2ef66e8f405c49a0d3d

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/index.css, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/touchCarry.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/usePointerDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/native-scroll-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/native-scroll-surfaces.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/phone-uncancelable.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/simple-list-scratch.mjs

## INV-8894 — probe — LOW — the freeze walks up from the pressed node, so a node replaced before the lift leaves the pane free

LOW — the freeze walks up from the pressed node, so a node replaced before the lift leaves the pane free

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/native-scroll-drag-lists/athena-probes/run.sh detached.mjs
echo "[probe exit $?]"
expect: line 1 `pressed node left alone … pane overflow at the lift=hidden; scrollTop 150 → 150 → 150 (pane held)`; line 2 `pressed node replaced at 150 ms: lifted=1 pane overflow at the lift=auto; scrollTop 150 → 235 → 55 (PANE MOVES under the carry)` while the defect stands; `hidden … pane held` on both once the freeze is rooted at the handle too
```

measured 2026-10-20 by chain chain-native-scroll-drag-lists-20261020-061555-de67, finding L2, LOW
probe-key: 23079e744445beaa0d3a5f9569bc94e5de820023

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/index.css, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/touchCarry.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/usePointerDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/native-scroll-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/native-scroll-surfaces.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/phone-uncancelable.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/simple-list-scratch.mjs

## INV-8895 — probe — LOW — on a touch screen with classic scrollbars the lift widens the rows for the whole carry

LOW — on a touch screen with classic scrollbars the lift widens the rows for the whole carry

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/native-scroll-drag-lists/athena-probes/run.sh gutter.mjs
echo "[probe exit $?]"
expect: `row width at rest 258px (scrollbar 10px) → at the lift 268px (scrollbar 0px): the rows shift by 10px for the carry` while the defect stands; `hold their width` once the gutter is kept
```

measured 2026-10-20 by chain chain-native-scroll-drag-lists-20261020-061555-de67, finding L3, LOW
probe-key: 4dd1211538d59332f41749d858a0130ed9c63a93

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/index.css, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/touchCarry.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/usePointerDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/native-scroll-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/native-scroll-surfaces.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/phone-uncancelable.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/simple-list-scratch.mjs

## INV-8896 — probe — LOW — the retired one-motion gate still asserts the mechanism this change deleted

LOW — the retired one-motion gate still asserts the mechanism this change deleted

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
grep -c -E 'touchPan|scrollsPane|data-touch-pan' .verify/lib/one-motion-reads.mjs .verify/lib/one-motion-others.mjs .verify/lib/one-motion-legs.mjs
echo "[probe exit $?]"
expect: reads 1, others 4, legs 2 while the retired gate stands; all 0 once its pan legs are removed or the gate is deleted
```

measured 2026-10-20 by chain chain-native-scroll-drag-lists-20261020-061555-de67, finding L4, LOW
probe-key: 914a2b5b6529c95514796fbabbba9417a7a07868

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/index.css, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/sidebar/hooks/useSimpleChatDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/sortable/touchCarry.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/usePointerDrag.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/native-scroll-legs.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/native-scroll-surfaces.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/phone-uncancelable.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/simple-list-scratch.mjs

## INV-8910 — probe — a pacer **fault** is attached as `usage.pace` (S5)

a pacer **fault** is attached as `usage.pace` (S5)

```probe
D=$(mktemp -d /tmp/pacer-fault.XXXXXX)
printf 'not a directory\n' > "$D/home"
cat > "$D/p.mts" <<'TS'
import { status, paceOf } from '/home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/pacer-door.ts';
console.log(JSON.stringify(paceOf(await status('8b907ae7'))));
TS
cd /home/lyphe/.claude/claudecodeui_lyphe && PLAN_RUNNER_PACER_HOME="$D/home" node_modules/.bin/tsx "$D/p.mts"
printf 'raw why/probe: '; PLAN_RUNNER_PACER_HOME="$D/home" ~/.claude/scripts/pacer status --json | jq -c '{why, probe, reading, five, week}'
expect: {"used5":null,"projected5":null,"ceiling5":null,"used7":null,"projected7":null,"ceiling7":null,"words":"pace: the 5-hour window is unknown"} beside a raw body with `"probe":true` and `"why":"pacer faulted: FileExistsError"` — a pace attached to a diagnostic, so `/api/usage` serves the key and the panel captions it; cured, the first line prints `null`
```

measured 2026-10-20 by chain chain-usage-pacer--meters-fill-20261020-094703-5ca9, finding L1, LOW
probe-key: 62b6fe60ceae9142a9a79f5a53c7dbe201697dd9

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/pacer-door.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/usage.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-epics.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-pace.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-plan.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-state.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/UsageMeters.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/MasterController.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/pacer-fill-live.mjs

## INV-8911 — probe — the docs say an explicit `null` `pace_hold` is **refused**; it reads `""` (MAN-7775, MAN-8680)

the docs say an explicit `null` `pace_hold` is **refused**; it reads `""` (MAN-7775, MAN-8680)

```probe
D=$(mktemp -d /tmp/pacer-nullhold.XXXXXX)
cd /home/lyphe/.claude/claudecodeui_lyphe
~/.claude/scripts/dispatcher status --json > "$D/doc.json"
jq '.plans[0].pace_hold = null' "$D/doc.json" > "$D/null.json"
node_modules/.bin/tsx --tsconfig server/tsconfig.json .verify/lib/lane-picture.ts "$D/null.json" "$D/pic.json" >/dev/null
jq -c '.plans[0] | {name, pace_hold}' "$D/pic.json"
for t in MAN-7775 MAN-8680; do printf '%s: ' "$t"; docstore get "$t" | jq -r '.row.body' | grep -c 'explicit `null` is refused'; done
expect: {"name":"<plan>","pace_hold":""} and `MAN-7775: 1` / `MAN-8680: 1` — a present null reads as the empty clause, not a refusal; cured, the lane-picture run fails naming `plan.pace_hold`, or both counts are `0`
```

measured 2026-10-20 by chain chain-usage-pacer--meters-fill-20261020-094703-5ca9, finding L2, LOW
probe-key: b83645a711ca587550ee912fda6c1fec74bae5d1

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/pacer-door.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/usage.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-epics.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-pace.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-plan.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-state.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/UsageMeters.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/MasterController.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/pacer-fill-live.mjs

## INV-8913 — probe — GROUND: a broken pacer home prints the fault line twice per status read

GROUND: a broken pacer home prints the fault line twice per status read

```probe
D=$(mktemp -d /tmp/pacer-dup.XXXXXX)
printf 'not a directory\n' > "$D/home"
PLAN_RUNNER_PACER_HOME="$D/home" ~/.claude/scripts/pacer status --json >/dev/null 2>"$D/err"
printf 'fault lines: '; grep -c 'pacer rates: home failed' "$D/err" || true
expect: `fault lines: 2` — the same FileExistsError printed twice per status read (`door_status.py:26` and `project.py:103`), so the operator sees one fault as two; cured, `1`
```

measured 2026-10-20 by chain chain-usage-pacer--meters-fill-20261020-094703-5ca9, finding L4, LOW
probe-key: e2e4d0827298bb3378169664643f459bf6e622e4

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/pacer-door.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/usage.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-epics.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-pace.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-plan.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-state.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/UsageMeters.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/MasterController.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/pacer-fill-live.mjs

## INV-8914 — probe — The route census was decremented nowhere correctly (code comment + MAN-5638)

The route census was decremented nowhere correctly (code comment + MAN-5638)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
printf 'arc POSTs   : '; grep -c "router.post('/arcs/:name" server/modules/dispatcher/dispatcher.routes.ts
printf 'lanes header: '; grep -o "twenty-four routes[^*]*" server/modules/dispatcher/dispatcher.routes.ts | cut -c1-100
printf 'row title   : '; docstore get MAN-5638 | jq -r '.row.title'
printf 'row opens   : '; docstore get MAN-5638 | jq -r '.row.body' | head -1 | cut -c1-120
EOF
bash "$D/p.sh"
expect: today `arc POSTs : 6`, header `twenty-four routes: three reads of the plan list, ten presses on a plan, seven on …`, title `SEVEN ROUTES NAME AN ARC`, and a first body line naming `schedule`; cured the header reads `twenty-three routes … six on an arc`, the title `SIX ROUTES NAME AN ARC`, and no `schedule` stands among the arc posts
```

measured 2026-10-20 by chain chain-usage-pacer--wip-ui-20261020-092337-aaa3, finding M1, MEDIUM
probe-key: 4e1df7bdebe18b2e171debd84c7d37bb90466b81

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-arc.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-plan.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-state.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-state.transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-verb.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/park-at-peak-switch.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/planner-lanes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/settings.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/settings.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/document-fields.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useDispatcherVerbs.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/LabeledPick.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/MasterController.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/OverrideFold.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/pace-fake.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PaceLine.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanFace.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/workingTime.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/runner-tab/RunnerPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/RunnerModelContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/RunnerPlannerLanesRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/constants.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Select.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/order-lane.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/queue-lane.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-folds.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-widget.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-order.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-epic-queue.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/session-picker-scaffold.mjs

## INV-8917 — probe — Three more target probes are red from pre-existing staleness (not this diff)

Three more target probes are red from pre-existing staleness (not this diff)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
printf 'tab label in probe : '; grep -o 'aria-label="Runner"' .verify/probe-card-order.mjs | head -1
printf 'tab label in app   : '; jq -r '.tabs.runner' src/modules/i18n/locales/en/common.json
printf 'dial uses in probe : '; grep -c "data-epic-dial" .verify/probe-epic-queue.mjs
printf 'dial file deleted  : '; git log --all --diff-filter=D --format='%ci %h' -- src/modules/dispatcher/EpicDial.tsx | head -1
for p in probe-card-order probe-epic-queue session-picker-scaffold; do timeout 300 node .verify/$p.mjs >/dev/null 2>&1; echo "$p exit=$?"; done
EOF
bash "$D/p.sh"
expect: today the app label is `Roadmap` while the probe still clicks `Runner`, the probe still uses `data-epic-dial`, the dial file is gone since 2026-10-15, and all three print `exit=1`; cured no stale label or attribute remains and all three print `exit=0`
```

measured 2026-10-20 by chain chain-usage-pacer--wip-ui-20261020-092337-aaa3, finding L1, LOW
probe-key: e6dae15bcf091fdb0a65285fa9968add3e12f1e8

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-arc.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-plan.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-state.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-state.transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-verb.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/park-at-peak-switch.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/planner-lanes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/settings.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/settings.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/document-fields.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useDispatcherVerbs.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/LabeledPick.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/MasterController.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/OverrideFold.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/pace-fake.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PaceLine.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanFace.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/workingTime.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/runner-tab/RunnerPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/RunnerModelContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/RunnerPlannerLanesRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/constants.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Select.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/order-lane.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/queue-lane.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-folds.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-widget.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-order.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-epic-queue.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/session-picker-scaffold.mjs

## INV-8918 — probe — MAN-5636 says five verbs reach an arc; the dispatcher says six

MAN-5636 says five verbs reach an arc; the dispatcher says six

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude || exit 1
printf 'schedule on a missing name: '; dispatcher schedule athena-probe-no-such-plan offpeak; echo " (exit $?)"
printf 'MAN-5636 says: '; docstore get MAN-5636 | jq -r '.row.body' | grep -o "from the five verbs[^)]*)" | head -1
EOF
bash "$D/p.sh"
expect: today `no plan or arc athena-probe-no-such-plan (exit 1)` and `from the five verbs an arc's own name also reaches (stop, resume, model, arm-accept, disarm-accept)`; cured the clause says six and names `schedule` (the dispatcher's own line does not change)
```

measured 2026-10-20 by chain chain-usage-pacer--wip-ui-20261020-092337-aaa3, finding L2, LOW
probe-key: 5553429f7d435682f9db7511df05f48e748c7a5b

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-arc.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-plan.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-state.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-state.transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-verb.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/park-at-peak-switch.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/planner-lanes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/settings.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/settings.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/document-fields.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useDispatcherVerbs.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/LabeledPick.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/MasterController.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/OverrideFold.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/pace-fake.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PaceLine.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanFace.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/workingTime.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/runner-tab/RunnerPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/RunnerModelContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/RunnerPlannerLanesRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/constants.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Select.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/order-lane.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/queue-lane.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-folds.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-widget.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-order.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-epic-queue.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/session-picker-scaffold.mjs

## INV-8919 — probe — The builder's report miscounts the verb union

The builder's report miscounts the verb union

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX)
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
printf 'verbs before: '; git show 8e9e807a^:server/shared/types.ts | grep -m1 "DispatcherVerb =" | grep -o "'[a-z-]*'" | wc -l
printf 'verbs after : '; git show 8e9e807a:server/shared/types.ts | grep -m1 "DispatcherVerb =" | grep -o "'[a-z-]*'" | wc -l
EOF
bash "$D/p.sh"
expect: today `verbs before: 16`, `verbs after : 15`; cured the same (this probe answers the report's claim, not a code defect)
```

measured 2026-10-20 by chain chain-usage-pacer--wip-ui-20261020-092337-aaa3, finding L3, LOW
probe-key: 82c1eb57dce3e0914bdb548a8b5bbe217ae6500b

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-arc.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-plan.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-state.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-state.transport.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-verb.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/park-at-peak-switch.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/planner-lanes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/settings.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/settings.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/document-fields.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/ArcControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useDispatcherVerbs.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/LabeledPick.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/MasterController.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/OverrideFold.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/pace-fake.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PaceLine.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanCard.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanControls.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/PlanFace.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/workingTime.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/common.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/runner-tab/RunnerPanel.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/RunnerModelContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/RunnerPlannerLanesRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/constants.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Select.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/utils.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/order-lane.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/queue-lane.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-folds.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-live.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/master-controller-widget.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-card-order.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-epic-queue.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/session-picker-scaffold.mjs

## INV-8928 — probe — (LOW) — both type mirrors still say `width.reason` asks three clauses; this phase's teardown left two

(LOW) — both type mirrors still say `width.reason` asks three clauses; this phase's teardown left two

```probe
D=$(mktemp -d /tmp/athena-probe-threeasks.XXXXXX) || exit 1
export D
cat > "$D/p.sh" <<'INNER'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
printf 'stale lines: '; grep -h -o 'the first of the three `width.reason` asks' server/shared/types.ts src/shared/types.ts | wc -l
printf 'clauses: '; grep -c 'TWO CLAUSES, IN THIS ORDER' /home/lyphe/.claude/hooks/dispatcher/width.py
INNER
bash "$D/p.sh"
expect: `stale lines: 2` beside `clauses: 1` — both mirrors still say three asks while the gate's code names two (measured today; cured, `stale lines: 0`).
```

measured 2026-10-20 by chain chain-usage-pacer--whole-20261020-105717-7799, finding L1, LOW
probe-key: 8b04ce45dc555fce1f9dfc6b39b6f267f6ec1c91

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher-pace.reader.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/pacer-fill-live.mjs, /home/lyphe/.claude/hooks/dispatcher/pace.py, /home/lyphe/.claude/scripts/heal_cycle_pace.py, /home/lyphe/.claude/scripts/prune_sweep_pace.py

## INV-8936 — The Claude API keys card — what an editor of the card must not break

Reference: MAN-8695 (files, the read contract and the strings).
1. **Unreadable draws no form.** `unknown` is a state, not an empty slot: fields over unseen settings let a reader overwrite a credit or label. The row says `Unknown` in words; the retry lives on the card header only.
2. **`unreadable` is never "not set".** `standingOf(null, true, t)` and the `Unknown` badge say so in words.
3. **`rides.why` is the door's data.** The card never paraphrases or reformats it, and never prefixes a payer sentence of its own (INV-8937; INV-76: no id, no digest in it). Dates in the card's own lines (the reader's zone) and in `why` (the door's) can differ in zone.
4. **Cycle money is two-decimal always.** `usd()` = `$${moneyText(amount, 1)}`; scale `1` is pinned, never derived from the amount or the credit (scale `0` falls into `moneyText`'s four-decimal branch and draws a fresh key as `$0.0000`). Any later card figure that is a cycle total uses it; the sub-cent branch is for per-launch cost text.
5. **The standing line's separator is a real space.** `{' '}` between base and clause, then the interpunct (neutral) or the tone dot (toned). A margin-only gap leaves `$200.00out of credit` in the text layer. The dot is `aria-hidden` decoration; a state is never carried by the dot alone.
6. **Remove's ink is `data-tone="danger"` + `text-tone-ink`.** `text-destructive` is `--danger` in both modes and reads 2.88:1 on the dark card; the ink pairing swaps in `--danger-ink` (6.83:1).
7. **The credit input is `step="any"`.** The door stores a float and validates only `>= 0`; a whole-number step makes the browser refuse the save of a stored `150.5`. The renewal day stays `step={1}` (the door types it int, 1–31).
8. **One submit, `renewsDay` always sent.** A cleared renewal field sends `renewsDay: null` and clears the day. `key` travels only when typed; `label` and `creditUsd` only when non-empty and valid.
9. **The key field is controlled by the card** (`drafts[slot]`), `type="password"`, `autoComplete="off"`, `spellCheck={false}`. It is emptied on SAVED and on nothing else; nothing reads a key back.
10. **Helper ids.** `aria-describedby` points at `${id}-helper` (the id `Field` renders) on the key field while no refusal shows, the name field and the renewal-day field. A refusal reaches assistive tech through `Field`'s `role="alert"`, which has no id.
11. **The type block is byte-identical in both mirrors.** `ClaudeApiWall`, `ClaudeApiKeyPicture`, `ClaudeApiPicture`, `ClaudeApiUnreadable` with their two comments: 2298 bytes, 32 lines in `src/shared/types.ts` and `server/shared/types.ts`. A change to one lands in the other in the same edit.
12. **Every control on a key row takes `blocked`.** `ClaudeApiKeysContent` passes `blocked={savingSlot !== null}`; `Save`/`Replace` and `Remove` carry `aria-disabled` (the `Button`'s refusing path; focus stays) and `submit` returns early while `blocked`. A new button or submit path refuses the same way.
13. **A refusal is the mounting hook's state, never the module's.** Every save returns `SaveOutcome` `{saved, refusal}`; `KeysState` is `picture` + `savingSlot` only. A refusal published into module `known` redraws on a remount a sentence about a press nobody made on that screen.
14. **A page return is one ask, merged by timestamp.** `focus` + `visibilitychange` inside `PAGE_ASK_WINDOW_MS` (600, `lastPageAsk`) are one read; never a debounce timer.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/ClaudeApiKeyRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/ClaudeApiKeysContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/claude-api-standing.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useClaudeApiKeys.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-8937 — The Claude API keys card draws `rides.why` alone — the door's sentence already names the payer

Reference: MAN-8695.
- `ClaudeApiKeysContent.tsx` draws the door's `rides.why` ALONE as the card's first line, for every `rides.slot` (0, 1, 2 and null); the payer word stays on the badge. When `why` is empty the card draws `agents.claudeApi.ridesNone` and composes no payer sentence of its own.
- `rides.why` already opens with the payer ("Plan runs ride …", `hooks/plan_runner/claude_api/payer.py`, MAN-8625). Prefixing a payer sentence says it twice: `Plan runs ride your Claude subscription. Plan runs ride the Claude subscription.` (live door, 2026-10-20).
- The card never paraphrases `why` (INV-76: no id, no digest in it).

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/ClaudeApiKeysContent.tsx

## INV-8941 — probe — The relayed picture is not redacted, and both the module comment and MAN-8701 say it is

The relayed picture is not redacted, and both the module comment and MAN-8701 say it is

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
set -u
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
export PROBE_PORT=7899
. scripts/apps-probe-env.sh
stop_probe_server
export PLAN_RUNNER_CLAUDE_API_KEYS="$D/keys.json" PLAN_RUNNER_CLAUDE_API_HOME="$D/home" DISPATCHER_HOME="$D/state/dispatcher"
mkdir -p "$DISPATCHER_HOME" "$D/home" || exit 1
export SCRATCHD="$D"
cat > "$D/door" <<'EDOOR'
#!/bin/bash
case "$1" in
  set) IFS= read -r line; printf '%s' "$line" > "$SCRATCHD/echoed-key"; printf 'SAVED key %s\n' "$2"; exit 0;;
  status) k=$(cat "$SCRATCHD/echoed-key" 2>/dev/null || true)
    printf '{"rides":{"slot":1,"why":"x"},"subscription":{"wall":null},"keys":[{"slot":1,"set":true,"label":"%s","credit_usd":200,"renews_day":null,"saved_at":null,"cycle_ends_at":null,"spent_usd":0,"left_usd":null,"window":{"open":false,"opens_at":null},"wall":null}],"pace_usd_per_hour":0,"unpriced":[],"checked_at":1}\n' "$k"; exit 0;;
esac
exit 1
EDOOR
chmod +x "$D/door"
printf '#!/bin/bash\nprintf "no work\\n"\n' > "$D/kick.sh"; chmod +x "$D/kick.sh"
CLAUDE_API_BIN="$D/door" DISPATCHER_BIN="$D/kick.sh" boot_probe_server || exit 1
TOKEN=$(mint_token) || exit 1
API="http://127.0.0.1:$PROBE_PORT/api/settings/claude-api"
K='sk-ant-api03-ATHENAPROBEREDACT000000000'
put=$(curl -s -m 20 -o "$D/put.json" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -X PUT --data-binary "{\"key\":\"$K\",\"label\":\"probe\"}" "$API/1")
get=$(curl -s -m 20 -o "$D/get.json" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$API")
echo "PUT: $put   GET: $get"
echo "full key in PUT answer: $(grep -c "$K" "$D/put.json" || true)"
echo "full key in GET answer: $(grep -c "$K" "$D/get.json" || true)"
stop_probe_server
case "$D" in /tmp/athena-probe.*) rm -rf -- "$D";; esac
EOF
bash "$D/p.sh"
expect: PUT: 200 GET: 200, "full key in PUT answer: 1", "full key in GET answer: 1"; cured: 0 and 0 (the label drawn as [key]).
```

measured 2026-10-20 by chain chain-claude-api-backup--settings-api-20261020-122510-4939, finding L1, LOW
probe-key: 0a4c4029b6179d29800fb7460d5f7fc4d7dba94b

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/claude-api-keys.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/settings.routes.ts

## INV-8942 — probe — A `WallsStand` save has already landed on disk, and MAN-8701 says a failed write wrote nothing and kicks nothing

A `WallsStand` save has already landed on disk, and MAN-8701 says a failed write wrote nothing and kicks nothing

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
set -u
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
export PROBE_PORT=7899
. scripts/apps-probe-env.sh
stop_probe_server
export PLAN_RUNNER_CLAUDE_API_KEYS="$D/keys.json" PLAN_RUNNER_CLAUDE_API_HOME="$D/home" DISPATCHER_HOME="$D/state/dispatcher"
mkdir -p "$DISPATCHER_HOME" "$D/home" || exit 1
printf '%s\n' 'sk-ant-api03-ATHENAPROBEWALLS0000000000' | ~/.claude/scripts/claude-api set 1 --key-stdin --label before >/dev/null || exit 1
export KICK_LOG="$D/kick.log"; : > "$KICK_LOG"
cat > "$D/kick.sh" <<'EK'
#!/bin/bash
[ "${1:-}" = kick ] && printf 'kick\n' >> "$KICK_LOG"
printf 'no work\n'
EK
chmod +x "$D/kick.sh"
printf '{}\n' > "$D/home/walls.json"
mkdir "$D/home/walls.json.lock" || exit 1
DISPATCHER_BIN="$D/kick.sh" boot_probe_server || exit 1
TOKEN=$(mint_token) || exit 1
API="http://127.0.0.1:$PROBE_PORT/api/settings/claude-api"
echo "label on disk before: [$(jq -r '."1".label' "$D/home/slots.json")]"
code=$(curl -s -m 20 -o "$D/answer.json" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -X PUT --data-binary '{"label":"after-wallsstand"}' "$API/1")
echo "WallsStand save answer: $code $(jq -c '.error' "$D/answer.json")"
echo "label on disk after the 502: [$(jq -r '."1".label' "$D/home/slots.json")]"
sleep 3
echo "kick invocations for that write: $(wc -l < "$KICK_LOG")"
rmdir "$D/home/walls.json.lock"
stop_probe_server
case "$D" in /tmp/athena-probe.*) rm -rf -- "$D";; esac
EOF
bash "$D/p.sh"
expect: answer 502 `claude-api set: WallsStand`, label on disk `after-wallsstand`, kick invocations 0; cured: the row no longer claims the write wrote nothing (or the write rolls back / kicks).
```

measured 2026-10-20 by chain chain-claude-api-backup--settings-api-20261020-122510-4939, finding L2, LOW
probe-key: 8d8f779bc5e14165738bd5d69294237d14ad55bc

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/claude-api-keys.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/settings.routes.ts

## INV-8943 — probe — The new `settings` package is registered with no summary

The new `settings` package is registered with no summary

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
out=$(docstore check | jq -c '.findings[] | select(.package=="cloudcli:server/modules/settings")')
printf 'check row: %s\n' "${out:-none}"
grep -n '^cloudcli:server/modules/settings ' ATLAS.md || echo 'atlas line: none'
EOF
bash "$D/p.sh"
expect: `check row: {"class":"no-summary",…,"package":"cloudcli:server/modules/settings",…}` and `9:cloudcli:server/modules/settings [store] (INV 0)`; cured: `check row: none` and the line carries a summary.
```

measured 2026-10-20 by chain chain-claude-api-backup--settings-api-20261020-122510-4939, finding L3, LOW
probe-key: 5a047c9f6e7143a30ad6aca03b764cffcf05259d

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/claude-api-keys.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/settings.routes.ts

## INV-8944 — probe — Dangling reference: "as `browser-use` notes"

Dangling reference: "as `browser-use` notes"

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
grep -n 'browser-use. notes' server/modules/settings/claude-api-keys.ts || echo 'comment gone'
grep -rin 'typings\|narrow\|stdio' server/modules/browser-use/ | grep -i 'note' || echo 'browser-use note: none'
EOF
bash "$D/p.sh"
expect: the comment line prints and `browser-use note: none`; cured: the comment is reworded or gone.
```

measured 2026-10-20 by chain chain-claude-api-backup--settings-api-20261020-122510-4939, finding L4, LOW
probe-key: 6393a3f751c4b946b8e55d0ad7950b084367d3cc

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/claude-api-keys.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/settings.routes.ts

## INV-8945 — probe — MAN-1497's kick census (edited by this build) omits `setDeepseekFeatures`

MAN-1497's kick census (edited by this build) omits `setDeepseekFeatures`

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
grep -n 'void kickDispatcher()' server/modules/settings/settings.service.ts
docstore get MAN-1497 | jq -r '.row.body' | sed -n '47,49p'
EOF
bash "$D/p.sh"
expect: call sites 233, 249, 268, 315; the row's sentence names three switches plus the keys and not `setDeepseekFeatures`; cured: the row names it.
```

measured 2026-10-20 by chain chain-claude-api-backup--settings-api-20261020-122510-4939, finding L5, LOW
probe-key: 27db3d10115792474295403c80ba25edc8c0bac0

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/claude-api-keys.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/settings.routes.ts

## INV-8946 — probe — the second slot's Save is silently dropped while the first slot's write is on the wire

the second slot's Save is silently dropped while the first slot's write is on the wire

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'JS'
import { openConsole, openSettings } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
const base = { rides: { slot: 0, why: 'Plan runs ride the Claude subscription.' }, subscription: { wall: null },
  keys: [1, 2].map((slot) => ({ slot, set: false, label: `Key ${slot}`, credit_usd: 200, renews_day: null,
    saved_at: null, cycle_ends_at: null, spent_usd: 0, left_usd: null, window: { open: false, opens_at: null }, wall: null })),
  pace_usd_per_hour: 0, unpriced: [], checked_at: 1 };
const saved = (slot) => { const p = structuredClone(base); p.keys[slot - 1] = { ...p.keys[slot - 1], set: true, label: 'Probe', saved_at: '2026-10-20T20:00:00Z', left_usd: 200 }; return p; };
const s = await openConsole({ viewport: { width: 1440, height: 900 } });
const page = s.page; const puts = []; let putCount = 0;
page.on('request', (r) => { if (r.method() === 'PUT') puts.push(r.url().split('/').pop()); });
const tab = (n) => page.getByRole('tab', { name: n, exact: true }).first();
const card = () => page.locator('div.rounded-xl.border').filter({ hasText: 'Claude API keys' }).first();
await openSettings(page, 'Agents');
await page.route('**/api/settings/claude-api', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: base }) : r.continue()));
await page.route('**/api/settings/claude-api/*', async (r) => {
  if (r.request().method() !== 'PUT') return r.continue();
  putCount += 1; const slot = Number(r.request().url().split('/').pop());
  if (putCount === 1) await new Promise((x) => setTimeout(x, 4000));
  return r.fulfill({ json: saved(slot) });
});
await tab('Account').click(); await page.waitForTimeout(1200);
await page.locator('#claude-api-key-1').fill('sk-ant-api03-ATHENADROPONE0000000000');
await page.locator('form:has(#claude-api-key-1) button[type=submit]').click();
await page.waitForTimeout(400);
await page.locator('#claude-api-key-2').fill('sk-ant-api03-ATHENADROPTWO0000000000');
const btn2 = page.locator('form:has(#claude-api-key-2) button[type=submit]');
const disabled = await btn2.isDisabled().catch(() => false);
let pressed = false;
if (!disabled) { await btn2.click(); pressed = true; }
await page.waitForTimeout(6500);
console.log('slot2 button disabled while slot1 saves:', disabled);
console.log('slot2 pressed:', pressed);
console.log('PUT slots seen:', JSON.stringify(puts));
console.log('card badges:', JSON.stringify(await card().getByText(/^(Not set|Saved .*)$/).allInnerTexts()));
console.log('slot2 field kept:', JSON.stringify(await page.locator('#claude-api-key-2').inputValue()));
console.log('slot2 alerts:', await page.locator('form:has(#claude-api-key-2) [role=alert]').count());
await s.browser.close();
JS
node "$D/p.mjs"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
```

measured 2026-10-20 by chain chain-claude-api-backup--card-fill-20261020-125408-3e4e, finding M1, MEDIUM
probe-key: 32a531ebfcac847115d782b890266cb2e7e9892b

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/settings.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/AgentCategoryContentSection.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/ClaudeApiKeysContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useClaudeApiKeys.ts

## INV-8947 — probe — INV-8937 still governs the deleted fake and still instructs the cure that has landed

INV-8937 still governs the deleted fake and still instructs the cure that has landed

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
f=src/modules/settings/tabs/agents-settings/sections/content/claude-api-fake.ts
printf 'fake file: %s\n' "$(test -e "$f" && echo present || echo gone)"
out=$(docstore check | jq -c '.findings[] | select(.token=="INV-8937")')
printf 'check row: %s\n' "${out:-none}"
printf 'stale cure line: %s\n' "$(docstore get INV-8937 --text 2>/dev/null | grep -c 'Cure at `card-fill`')"
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
```

measured 2026-10-20 by chain chain-claude-api-backup--card-fill-20261020-125408-3e4e, finding M2, MEDIUM
probe-key: 5994f7cce7fe18b6dba3fa53b4e6203cf7bdaf83

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/settings.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/AgentCategoryContentSection.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/ClaudeApiKeysContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useClaudeApiKeys.ts

## INV-8948 — probe — a 502 whose write failed draws no failure sentence at all

a 502 whose write failed draws no failure sentence at all

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'JS'
import { openConsole, openSettings } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
const base = { rides: { slot: 0, why: 'Plan runs ride the Claude subscription.' }, subscription: { wall: null },
  keys: [1, 2].map((slot) => ({ slot, set: false, label: `Key ${slot}`, credit_usd: 200, renews_day: null,
    saved_at: null, cycle_ends_at: null, spent_usd: 0, left_usd: null, window: { open: false, opens_at: null }, wall: null })),
  pace_usd_per_hour: 0, unpriced: [], checked_at: 1 };
const landed = structuredClone(base); landed.keys[0] = { ...landed.keys[0], set: true, label: 'Landed', saved_at: '2026-10-20T20:00:00Z', left_usd: 200 };
const s = await openConsole({ viewport: { width: 1440, height: 900 } });
const page = s.page;
const tab = (n) => page.getByRole('tab', { name: n, exact: true }).first();
const card = () => page.locator('div.rounded-xl.border').filter({ hasText: 'Claude API keys' }).first();
await openSettings(page, 'Agents');
let land = false;
await page.route('**/api/settings/claude-api', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: land ? landed : base }) : r.continue()));
await page.route('**/api/settings/claude-api/*', (r) => {
  if (r.request().method() !== 'PUT') return r.continue();
  land = true;
  return r.fulfill({ status: 502, json: { success: false, error: { code: 'CLAUDE_API_DOOR_FAILED', message: 'claude-api set: WallsStand' } } });
});
await tab('Account').click(); await page.waitForTimeout(1200);
await page.locator('#claude-api-key-1').fill('sk-ant-api03-ATHENA502PROBE00000000000');
await page.locator('form:has(#claude-api-key-1) button[type=submit]').click();
await page.waitForTimeout(2500);
const text = await card().innerText();
console.log('failure words in card:', /WallsStand|did not answer|could not be saved|failed/i.test(text) ? 'yes' : 'no');
console.log('alerts in card:', await card().locator('[role=alert]').count());
console.log('field1 kept:', JSON.stringify(await page.locator('#claude-api-key-1').inputValue()));
await s.browser.close();
JS
node "$D/p.mjs"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
```

measured 2026-10-20 by chain chain-claude-api-backup--card-fill-20261020-125408-3e4e, finding L1, LOW
probe-key: ecc6e82156e0f1c71c7a87766ba89f41016ee89f

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/settings.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/AgentCategoryContentSection.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/ClaudeApiKeysContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useClaudeApiKeys.ts

## INV-8949 — probe — a refusal outlives its form and is redrawn under an empty field

a refusal outlives its form and is redrawn under an empty field

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'JS'
import { openConsole, openSettings } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
const base = { rides: { slot: 0, why: 'Plan runs ride the Claude subscription.' }, subscription: { wall: null },
  keys: [1, 2].map((slot) => ({ slot, set: false, label: `Key ${slot}`, credit_usd: 200, renews_day: null,
    saved_at: null, cycle_ends_at: null, spent_usd: 0, left_usd: null, window: { open: false, opens_at: null }, wall: null })),
  pace_usd_per_hour: 0, unpriced: [], checked_at: 1 };
const WORDS = 'key 1: an admin key (sk-ant-admin...) cannot pay for plan runs; save a standard API key (sk-ant-api...)';
const s = await openConsole({ viewport: { width: 1440, height: 900 } });
const page = s.page;
const tab = (n) => page.getByRole('tab', { name: n, exact: true }).first();
const card = () => page.locator('div.rounded-xl.border').filter({ hasText: 'Claude API keys' }).first();
await openSettings(page, 'Agents');
await page.route('**/api/settings/claude-api', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: base }) : r.continue()));
await page.route('**/api/settings/claude-api/*', (r) => (r.request().method() === 'PUT'
  ? r.fulfill({ status: 422, json: { success: false, error: { code: 'CLAUDE_API_KEY_REFUSED', message: WORDS } } })
  : r.continue()));
await tab('Account').click(); await page.waitForTimeout(1200);
await page.locator('#claude-api-key-1').fill('sk-ant-admin01-ATHENAADMINPROBE00000000');
await page.locator('form:has(#claude-api-key-1) button[type=submit]').click();
await page.waitForTimeout(1200);
console.log('refusal under the field:', await card().getByText(/an admin key/).count(), '| field kept:', JSON.stringify(await page.locator('#claude-api-key-1').inputValue()));
await tab('Permissions').click(); await page.waitForTimeout(400);
await tab('Account').click(); await page.waitForTimeout(1400);
console.log('refusal after a remount:', await card().getByText(/an admin key/).count(), '| field now:', JSON.stringify(await page.locator('#claude-api-key-1').inputValue()), '| alerts:', await card().locator('[role=alert]').count());
await s.browser.close();
JS
node "$D/p.mjs"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
```

measured 2026-10-20 by chain chain-claude-api-backup--card-fill-20261020-125408-3e4e, finding L2, LOW
probe-key: f385ded19d01457e93249fba721eceab48ef5038

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/settings.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/AgentCategoryContentSection.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/ClaudeApiKeysContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useClaudeApiKeys.ts

## INV-8950 — probe — one return to the page costs two reads

one return to the page costs two reads

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'JS'
import { openConsole, openSettings } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
const s = await openConsole({ viewport: { width: 1440, height: 900 } });
const page = s.page; const at = [];
page.on('request', (r) => { if (r.method() === 'GET' && r.url().endsWith('/api/settings/claude-api')) at.push(Date.now()); });
await openSettings(page, 'Agents');
await page.getByRole('tab', { name: 'Account', exact: true }).first().click();
await page.waitForTimeout(4000);
const mark = at.length; const t0 = Date.now();
await page.evaluate(() => { for (let i = 0; i < 6; i += 1) window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
await page.waitForTimeout(2500);
console.log('GET offsets after one focus+visibility burst (ms):', JSON.stringify(at.slice(mark).map((t) => t - t0)));
await s.browser.close();
JS
node "$D/p.mjs"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
```

measured 2026-10-20 by chain chain-claude-api-backup--card-fill-20261020-125408-3e4e, finding L3, LOW
probe-key: 0e1ce97ce0e3b1ec820c758a5b6117322a7a6702

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/settings.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/AgentCategoryContentSection.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/ClaudeApiKeysContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useClaudeApiKeys.ts

## INV-8951 — probe — MAN-8695 still points at the deleted fake and the removed markers

MAN-8695 still points at the deleted fake and the removed markers

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
out=$(docstore get MAN-8695 --text | grep -c 'claude-api-fake')
printf 'MAN-8695 mentions the deleted fake: %s\n' "$out"
printf 'fake file: %s\n' "$(test -e /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/claude-api-fake.ts && echo present || echo gone)"
EOF
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.*) rm -rf "$D";; esac
```

measured 2026-10-20 by chain chain-claude-api-backup--card-fill-20261020-125408-3e4e, finding L4, LOW
probe-key: 5b62b51d9bcd33723f4315b100e9054927f3ba7c

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/i18n/locales/en/settings.json, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/AgentCategoryContentSection.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/tabs/agents-settings/sections/content/ClaudeApiKeysContent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/hooks/useClaudeApiKeys.ts

## INV-9252 — ClaudeAccountRow, ClaudeAccountSwitch, ClaudeAccountsPicture — identical in both shared/types.ts mirrors

Reference: MAN-8847 (the section that reads them), MAN-8843 (the door face they describe).
1. **Each of the three door-face types is byte-identical in `src/shared/types.ts` and `server/shared/types.ts`**, comment and body: `ClaudeAccountRow`, `ClaudeAccountSwitch`, `ClaudeAccountsPicture`. `ClaudeAccounts`, the lane's answer, is field-for-field identical beside them — `({ reachable: true } & ClaudeAccountsPicture) | { reachable: false; reason: string }` — and carries no `door` member. A change to one mirror lands in the other in the same edit. 2026-10-21: three block checksums equal across the mirrors.
2. **They describe `claude-account status --json` as the door sends it.** Times are epoch SECONDS (`ClaudeUsage.checkedAt`/`staleSince` are seconds too; `resetsAt` is an ISO-8601 string); `reading.five` / `.week` are fractions 0..1 or `null` (a window the pacer could not measure — the pacer files one-window readings), and `null` draws as unknown, never zero (MAN-8862); `token` is a state word (`none` | `saved` | `checking`), never a token or a digest of one; `why` is the rule's sentence (INV-76).
3. **`ClaudeAccounts` is the lane's answer, not the door's raw picture.** `reachable: true` means every field is the door's own, at the TOP LEVEL; `reachable: false` carries the calm reason. There is no `door` member, and no type re-wraps the picture in an envelope.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-9253 — Account launch reads — edits that break them

Behaviour: MAN-8849 (the two reads), MAN-8848 (the launch, the join, the record).

| Edit | Breaks | Why |
|---|---|---|
| Hand the token to the door's child through `stdio: [.., 'pipe']`, or any non-FIFO descriptor | every launch rides the live login | Node puts a socketpair (`0o140777`) on an extra descriptor; the door refuses it (`REFUSED: --fd must name a pipe the caller opened`, exit 2) and the chat answers `account: null` — measured 2026-10-21 |
| Read the FIFO through `createReadStream`, or before the child exits | the token is lost or the read dies | a stream on a non-blocking FIFO surfaces EAGAIN as a fatal read error and closes the fd; the drain is one synchronous read after `close` |
| Put the token in a log line, a thrown error, a route body, a meta, a journal, argv, or the door's environment | the token leaves its one home | its only consumer is the env of the CLI it was read for; the one relayed string is the door's stderr, redacted |
| Let a door fault throw or block | a chat fails because an account door failed | every fault answers all nulls inside the 10 s bound; the chat rides the live login |
| Ask the door at a join (a message to a running process) | an extra door call, a token read, per message | only a spawn reads a credential; a running process keeps its spawn environment |
| Cache `chosenAccount()` | an open conversation stays on the old account until the API restarts | a switch is a click or a rule pass; the file is two short fields |
| Make `chosenAccount()` derive its home differently from the Python store (`record.home()`) | a stack with a moved store reads the operator's own choice | `$PLAN_RUNNER_CLAUDE_ACCOUNT_HOME`, else the parent of `$DISPATCHER_HOME` plus `/claude_account`, else `~/.claude/state/claude_account` |
| Add a usable-account check to `chosenAccount()` | a second copy of the rule | the stale-choice removal lives once, in `auto._decide`, and runs before the fewer-than-two return (MAN-8843) |
| Answer a respawn when either profile `account` is not a string | a hand-edited or missing `chosen.json`, or a re-adopted host with no account in its meta, replaces healthy processes in a loop | `null` is "not heard" |
| Let `recordLaunch` throw or wait on the record | a launch fails on its evidence | the record is never a gate |
| Drop `...account.env` from the catalog read, the diagnosing agent or its audit | those CLIs ride the live login while chats ride the chosen account | each is a Claude launch like any other |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-door.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/chosen-account.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-launch-account.ts

## INV-9256 — probe — a chosen record naming an account with no checked token respawns the chat on EVERY message, to the same place, forever while that state holds (MEASURED)

a chosen record naming an account with no checked token respawns the chat on EVERY message, to the same place, forever while that state holds (MEASURED)

```probe
D=$(mktemp -d /tmp/achurn-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'P'
set -u
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
export PROBE_PORT=7897
. scripts/apps-probe-env.sh
API="http://127.0.0.1:${PROBE_PORT}"
if [ -n "$(ss -ltnH "sport = :$PROBE_PORT" 2>/dev/null)" ]; then echo "FAILED: :$PROBE_PORT busy" >&2; exit 1; fi
D=$(mktemp -d /tmp/achurn.XXXXXX) || exit 1
mkdir -p "$D/state/dispatcher" "$D/state/claude_account"
export DISPATCHER_HOME="$D/state/dispatcher"
export PLAN_RUNNER_CLAUDE_ACCOUNT_HOME="$D/state/claude_account"
export PLAN_RUNNER_CLAUDE_ACCOUNT_TOKENS="$D/state/claude_account/tokens.json"
export PLAN_RUNNER_CLAUDE_IDENTITY_PATH="$D/identity.json"
export CLAUDE_LAUNCHES_PATH="$D/claude-launches.jsonl"
printf '{"oauthAccount":{"accountUuid":"probe-identity-only","emailAddress":"probe-id@example.invalid"}}' > "$D/identity.json"
unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY
CHAT=""; TOKEN=""
cleanup() {
  local status=$?
  if [[ "$CHAT" =~ ^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$ ]] && curl -sf "$APPS_STATUS_URL" > /dev/null && [ -n "$TOKEN" ]; then
    curl -s -o /dev/null -X DELETE -H "Authorization: Bearer $TOKEN" "$API/api/providers/sessions/$CHAT?force=true"
  fi
  local name
  while IFS= read -r name; do case "$name" in "$CHAT"-*) tmux -L cloudcli-sessions kill-session -t "=$name" 2>/dev/null ;; esac; done < <(tmux -L cloudcli-sessions list-sessions -F '#{session_name}' 2>/dev/null)
  stop_probe_server
  cd /tmp || true
  case "$D" in /tmp/achurn.??????) rm -rf "$D" ;; esac
  echo "cleanup done (exit $status)"
}
trap cleanup EXIT
# one account, checked and chosen, then its token cleared: the record now names a tokenless account
PYTHONPATH=/home/lyphe/.claude/hooks python3 - <<'PY' || exit 1
from plan_runner.claude_account import store, tokens
store.add('bbbb0002', 'beta')
store.set_token('bbbb0002', tokens.save('bbbb0002', 'sk-ant-oat01-bbbb0002bbbb0002bbbb0002'), checked=True)
store.choose('bbbb0002', by='operator', why='probe: the churn')
store.clear_token('bbbb0002')
print("  chosen :", store.chosen())
print("  current:", store.current(), "(the door's answer)")
print("  usable :", store.usable())
PY
boot_probe_server || { echo "FAILED: server did not boot" >&2; exit 1; }
TOKEN=$(mint_token) || { echo "FAILED: no token" >&2; exit 1; }
node .verify/account-chat-launch.mjs --api "$API" --token "$TOKEN" --chat-file "$D/chat.txt" --message 'Reply with the single word ok.' > /dev/null || { echo "FAILED: first turn" >&2; exit 1; }
CHAT=$(cat "$D/chat.txt")
for n in 2 3; do
  node .verify/account-chat-launch.mjs --api "$API" --token "$TOKEN" --chat "$CHAT" --chat-file "$D/chat.txt" --message 'Reply with the single word ok.' > /dev/null || { echo "FAILED: turn $n" >&2; exit 1; }
done
echo "-- Replacing lines:"
grep -F "Replacing the process for session $CHAT:" "$APPS_LOG" | sed 's/^/  /'
echo "-- launch rows for this chat:"
python3 - "$CLAUDE_LAUNCHES_PATH" "$CHAT" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
mine = [r for r in rows if r.get('session') == sys.argv[2]]
for r in mine: print("  account=%s slug=%s why=%s" % (r['account'], r['slug'], r['why']))
print("  respawn rows:", sum(1 for r in mine if str(r.get('why','')).startswith('respawn:')))
PY
P
bash "$D/p.sh"
expect: two identical `Replacing the process for session <chat>: account <identity-digest> → beta` lines from two consecutive messages, and every launch row's `account` is the same `<identity-digest>` before and after — the process never moves to beta
```

measured 2026-10-21 by chain chain-usage-limits--account-switch--chats-20261021-173459-f609, finding M1, MEDIUM
probe-key: 8848902645f14494b8b0e0042ed0a8be2a1f673f

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-door.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/chosen-account.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-agent.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-audit.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/chat-process.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-engine-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-launch-account.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/account-chat-launch.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/account-chat-launch.sh

## INV-9257 — probe — one record, two readers: a stack that sets only `DISPATCHER_HOME` has the door riding the scratch store while the client decides respawns from the LIVE record (MEASURED)

one record, two readers: a stack that sets only `DISPATCHER_HOME` has the door riding the scratch store while the client decides respawns from the LIVE record (MEASURED)

```probe
D=$(mktemp -d /tmp/aseam-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'P'
set -u
D=$(mktemp -d /tmp/aseam.XXXXXX) || exit 1
mkdir -p "$D/state/dispatcher" "$D/state/claude_account" || exit 1
printf '{"digest":"aaaaaaaa","slug":"scratch-seam"}' > "$D/state/claude_account/chosen.json"
echo "-- the door's side (Python, <state_root>/claude_account):"
env -u PLAN_RUNNER_CLAUDE_ACCOUNT_HOME DISPATCHER_HOME="$D/state/dispatcher" PYTHONPATH=/home/lyphe/.claude/hooks python3 -c 'from plan_runner.claude_account import store; print("  store.chosen() =", store.chosen())'
cat > "$D/p.mts" <<'M'
import { chosenAccount } from '@/modules/accounts/chosen-account.js';
console.log("  chosenAccount() =", JSON.stringify(chosenAccount()));
M
echo "-- the client's side (chosen-account.ts):"
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
env -u PLAN_RUNNER_CLAUDE_ACCOUNT_HOME DISPATCHER_HOME="$D/state/dispatcher" npx tsx --tsconfig ./server/tsconfig.json "$D/p.mts"
cd /tmp || true
case "$D" in /tmp/aseam.??????) rm -rf "$D" ;; esac
P
bash "$D/p.sh"
expect: the door prints Chosen(digest='aaaaaaaa', slug='scratch-seam', …) while the client prints null (or the live record's digest and slug when one exists) — one record, two readers, two files
```

measured 2026-10-21 by chain chain-usage-limits--account-switch--chats-20261021-173459-f609, finding L1, LOW
probe-key: 16a5577b3803846c5d824a47bd408c050621cbb6

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-door.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/chosen-account.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-agent.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/cerberus/diagnosis/diagnosis-audit.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/chat-process.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-engine-catalog.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-launch-account.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/account-chat-launch.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/account-chat-launch.sh

## INV-9263 — probe — HIGH — the proof pauses the operator's LIVE queue; the pause lives in a house-wide flag the scratch home does not redirect

HIGH — the proof pauses the operator's LIVE queue; the pause lives in a house-wide flag the scratch home does not redirect

```probe
D=$(mktemp -d /tmp/athena-probe-epicflag.XXXXXX) || exit 1
cat > "$D/p.sh" <<'INNER'
D=$(cd "$(dirname "$0")" && pwd)
V=/home/lyphe/.claude/claudecodeui_lyphe/.verify
echo "flag the proof's own env resolves for 'dispatcher epics pause' (DISPATCHER_HOME scratch, no override var): $(env -u DISPATCHER_EPICS_FLAG_PATH DISPATCHER_HOME=/tmp/heph-ovr-sim/dispatcher PYTHONPATH=/home/lyphe/.claude/hooks python3 -c 'from dispatcher import epic_dial; print(epic_dial.flag_path())')"
echo "proof lines that run 'dispatcher epics ...': $(grep -c "dispatcher('epics'" $V/probe-pace-override.mjs) | proof files that point the dial at a scratch file: $(grep -l DISPATCHER_EPICS_FLAG_PATH $V/probe-pace-override.mjs $V/probe-pace-override.sh | wc -l)"
printf 'paused yes\npaused_at 2026-10-22T00:00:00Z\n' > "$D/epics.flag"
for v in pause resume; do env -u CLAUDE_CODE_SESSION_ID DISPATCHER_EPICS_FLAG_PATH="$D/epics.flag" DISPATCHER_HOME="$D/h" /home/lyphe/.claude/scripts/dispatcher epics $v 2>&1 | grep -v 'started no daemon'; done
echo "a /tmp stand-in for an operator who already had Pause all on, after the proof's pause then resume: $(head -1 "$D/epics.flag")"
INNER
bash "$D/p.sh"; case "$D" in /tmp/athena-probe-epicflag.??????) rm -r "$D";; esac
echo "[probe exit $?]"
expect: while the defect stands — the first line ends /home/lyphe/.claude/state/epics.flag, `proof lines … : 2 | … scratch file: 0`, and the stand-in reads `paused no`; # cured — the .sh exports DISPATCHER_EPICS_FLAG_PATH under its scratch (count 1 or 2) and the first line names a /tmp path (a run that sets the var in the shell first).
```

measured 2026-10-21 by chain chain-plan-card-override-20261021-171051-2000, finding H1, HIGH
probe-key: 479625b53c76dcb450b2cb853b3222c42f808d3c

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useDispatcherVerbs.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-pace-override.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-pace-override.sh, /home/lyphe/.claude/hooks/dispatcher/pace_demand.py, /home/lyphe/.claude/hooks/dispatcher/pace_report.py

## INV-9264 — probe — MEDIUM — an outing aimed at the plan's EPIC is held by the pacer, shown nowhere, and no door lifts it

MEDIUM — an outing aimed at the plan's EPIC is held by the pacer, shown nowhere, and no door lifts it

```probe
D=$(mktemp -d /tmp/athena-probe-arccut.XXXXXX) || exit 1
cat > "$D/p.sh" <<'INNER'
D=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$D/disp" "$D/pacer" || exit 1
sqlite3 -readonly ~/.claude/state/dispatcher/dispatcher.db ".backup '$D/disp/dispatcher.db'" || exit 1
sqlite3 -readonly ~/.claude/state/pacer/readings.sqlite ".backup '$D/pacer/readings.sqlite'" || exit 1
cp ~/.claude/state/pacer/rates.json "$D/pacer/"
export DISPATCHER_HOME="$D/disp" PLAN_RUNNER_PACER_HOME="$D/pacer" DISPATCHER_EPICS_FLAG_PATH="$D/epics.flag" PYTHONPATH=/home/lyphe/.claude/hooks
printf 'paused no\n' > "$D/epics.flag"
unset CLAUDE_CODE_SESSION_ID DISPATCHER_SESSION
python3 - <<'PY'
import time
from plan_runner import claude_account
from plan_runner.pacer import readings
from dispatcher import planners, store
now = time.time(); who = claude_account.current()
readings.note(who, {"five": 0.30, "five_resets": (int(now // 3600) + 3) * 3600.0, "week": 0.995, "week_resets": (int(now // 86400) + 4) * 86400.0, "status": "allowed"}, source="athena", at=now)
c = store.connect()
arc = c.execute("select name from arcs order by id desc limit 1").fetchone()[0]
with c: planners.queue_cut(c, arc, session=None, repo="/home/lyphe/.claude")
open("arc.txt", "w").write(arc)
PY
ARC=$(cat arc.txt)
~/.claude/scripts/dispatcher status --json 2>/dev/null > "$D/doc.json"
echo "a cut aimed at the epic $ARC is queued; the pacer's picture says: held $(jq -r '.route.pace.held' "$D/doc.json")"
jq -r --arg a "$ARC" '[.plans[] | select(.arc==$a)] | "plans of that epic: \(length) | showing a pace hold: \([.[]|select(.pace_hold!="")]|length) | showing the queued cut badge: \([.[]|select(.planner.verb=="cut" and .planner.state=="queued")]|length)"' "$D/doc.json"
~/.claude/scripts/dispatcher override "$ARC" --by app:card 2>&1 | grep -v 'started no daemon'
INNER
cd "$D" && bash "$D/p.sh"; cd /tmp; case "$D" in /tmp/athena-probe-arccut.??????) rm -r "$D";; esac
echo "[probe exit $?]"
expect: `held 1` (or more), `showing a pace hold: 0 | showing the queued cut badge: 1`, and `no plan <arc>` while the gap stands; cured when the epic's plan(s) carry the clause and the press reaches the row
```

measured 2026-10-21 by chain chain-plan-card-override-20261021-171051-2000, finding M1, MEDIUM
probe-key: cd6795e3adf079267c3d7e77181f20b3946c2453

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useDispatcherVerbs.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-pace-override.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-pace-override.sh, /home/lyphe/.claude/hooks/dispatcher/pace_demand.py, /home/lyphe/.claude/hooks/dispatcher/pace_report.py

## INV-9265 — probe — MEDIUM — the manuals now state three things this change made false, and carry no row for the new surface

MEDIUM — the manuals now state three things this change made false, and carry no row for the new surface

```probe
cd /home/lyphe/.claude && echo "dispatcher MANUAL: planner_hold=$(grep -c 'planner_hold' hooks/dispatcher/MANUAL.md) overridden-key=$(grep -c 'plan_dict.overridden\|`overridden`' hooks/dispatcher/MANUAL.md) | stale pace_hold sentence=$(grep -c "for the plan's first ready phase, asked only while the plan is" hooks/dispatcher/MANUAL.md)"; echo "CloudCLI docs: override-off=$(grep -c 'override-off' claudecodeui_lyphe/docs/MANUAL.md) data-dispatcher-override=$(grep -c 'data-dispatcher-override' claudecodeui_lyphe/docs/MANUAL.md) PaceOverride=$(grep -c 'PaceOverride' claudecodeui_lyphe/docs/MANUAL.md) | 'NEVER A PRESS'=$(grep -c "THE PACER'S HOLD IS NEVER A PRESS" claudecodeui_lyphe/docs/MANUAL.md) | 'twenty-three routes'=$(grep -c 'twenty-three routes' claudecodeui_lyphe/docs/MANUAL.md)"
echo "[probe exit $?]"
expect: today `planner_hold=0 overridden-key=0 | stale pace_hold sentence=2` (two places state it) and `override-off=0 data-dispatcher-override=0 PaceOverride=0 | 'NEVER A PRESS'=1 | 'twenty-three routes'=1`; cured: the first three > 0 and the last three 0 (stale ones), the stale-sentence count reads 0
```

measured 2026-10-21 by chain chain-plan-card-override-20261021-171051-2000, finding M2, MEDIUM
probe-key: bd0bbfc8200e40beee0dd68d62c64ec254450f88

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useDispatcherVerbs.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-pace-override.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-pace-override.sh, /home/lyphe/.claude/hooks/dispatcher/pace_demand.py, /home/lyphe/.claude/hooks/dispatcher/pace_report.py

## INV-9266 — probe — LOW — the press's toast speaks a terminal command beside a Turn off button, and a refused Turn off is headed "Override"

LOW — the press's toast speaks a terminal command beside a Turn off button, and a refused Turn off is headed "Override"

```probe
D=$(mktemp -d /tmp/athena-probe-toast.XXXXXX) || exit 1
cat > "$D/p.sh" <<'INNER'
D=$(cd "$(dirname "$0")" && pwd)
export DISPATCHER_HOME="$D/h" PLAN_RUNNER_PACER_HOME="$D/pacer" DISPATCHER_EPICS_FLAG_PATH="$D/epics.flag" PYTHONPATH=/home/lyphe/.claude/hooks
mkdir -p "$D/pacer" || exit 1
unset CLAUDE_CODE_SESSION_ID DISPATCHER_SESSION
python3 - <<'PY'
from dispatcher import store, store_write
R = '/tmp'; DS = {'repo': R, 'goal': 'g', 'delivers': 'd', 'architecture': 'a', 'interfaces': 'i', 'constraints': 'c', 'waits_on': [], 'decisions': [], 'questions': []}
c = store.connect()
with c:
    store_write.open_plan(c, 'toastplan', repo=R, session='athena-probe'); store.put_design(c, 'toastplan', DS)
PY
echo "press -> $(~/.claude/scripts/dispatcher override toastplan --by app:card 2>&1 | grep -v 'started no daemon')"
echo "off, then off again -> $(~/.claude/scripts/dispatcher override toastplan --off --by app:card 2>&1 | grep -v 'started no daemon'); $(~/.claude/scripts/dispatcher override toastplan --off --by app:card 2>&1 | grep -v 'started no daemon')"
H=/home/lyphe/.claude/claudecodeui_lyphe
echo "heading source for both doors: $(grep -n "verb === 'override'" $H/src/modules/dispatcher/hooks/useDispatcherVerbs.ts | cut -c1-110)"
INNER
bash "$D/p.sh"; cd /tmp; case "$D" in /tmp/athena-probe-toast.??????) rm -r "$D";; esac
echo "[probe exit $?]"
expect: the press line ends with `dispatcher override toastplan --off`` and one heading source line that returns the press word for every `override` — cured when the toast reads in the card's words and Turn off has its own heading
```

measured 2026-10-21 by chain chain-plan-card-override-20261021-171051-2000, finding L1, LOW
probe-key: eb9714b5e6aa7e8e1ef749f0caab86c36993b30d

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useDispatcherVerbs.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-pace-override.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-pace-override.sh, /home/lyphe/.claude/hooks/dispatcher/pace_demand.py, /home/lyphe/.claude/hooks/dispatcher/pace_report.py

## INV-9267 — probe — LOW — `DispatcherPlan.overridden`'s doc (both mirrors) omits the one thing a reader of `pace_hold` needs: it is `""` while `overridden` is true

LOW — `DispatcherPlan.overridden`'s doc (both mirrors) omits the one thing a reader of `pace_hold` needs: it is `""` while `overridden` is true

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && python3 -I - <<'PY'
for path in ('server/shared/types.ts', 'src/shared/types.ts'):
    s = open(path).read(); i = s.index('export type DispatcherPlan = '); line = s[i:s.index('\n', i)]
    j = line.index('overridden: boolean'); k = line.rfind('/**', 0, j); doc = line[k:j]
    print(path, '| doc says pace_hold is empty while overridden:', 'empty' in doc.lower() or '`""`' in doc)
PY
echo "[probe exit $?]"
expect: `False` for both while the sentence is missing; `True` for both once the doc says it
```

measured 2026-10-21 by chain chain-plan-card-override-20261021-171051-2000, finding L2, LOW
probe-key: dc4beed602d6d014784324f1d583f7f7b1647d30

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/hooks/useDispatcherVerbs.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-pace-override.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/probe-pace-override.sh, /home/lyphe/.claude/hooks/dispatcher/pace_demand.py, /home/lyphe/.claude/hooks/dispatcher/pace_report.py

## INV-9270 — probe — Two accounts' limit notices still collapse in the orchestrator's 20 s dedupe

Two accounts' limit notices still collapse in the orchestrator's 20 s dedupe

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/keys.mts" <<'TS'
import { detectRuntimeSignals, createSignalState } from '/home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime-signals.ts';
const now = Math.floor(Date.now() / 1000);
const e = { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.91, resetsAt: now + 9000 } };
const out: string[] = [];
const emit = (s: any) => out.push(s.dedupeKey);
detectRuntimeSignals(e, createSignalState(), { sessionId: 's1', account: 'aaaa1111', accountSlug: 'alpha', emit });
detectRuntimeSignals(e, createSignalState(), { sessionId: 's2', account: 'bbbb2222', accountSlug: 'beta', emit });
console.log(JSON.stringify(out, null, 1));
TS
CLOUDCLI_LIMIT_MEMORY_PATH="$D/lm.json" PACER_BIN=/bin/true \
  /home/lyphe/.claude/claudecodeui_lyphe/node_modules/.bin/tsx \
  --tsconfig /home/lyphe/.claude/claudecodeui_lyphe/server/tsconfig.json "$D/keys.mts"
case "$D" in /tmp/athena-probe.??????) rm -rf -- "$D" ;; esac
```

measured 2026-10-21 by chain chain-usage-limits--account-switch--chat-readings-20261021-183913-317f, finding M1, MEDIUM
probe-key: 639ca0b35b59fb582c831573742c52a08a382ecd

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/pacer-door.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/usage.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-chat-readings.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-limit-memory.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime-signals.ts, /home/lyphe/.claude/hooks/plan_runner/pacer/door.py

## INV-9271 — probe — A per-account notice cannot say which account it is about

A per-account notice cannot say which account it is about

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/copy.mts" <<'TS'
import { buildNotificationText } from '/home/lyphe/.claude/claudecodeui_lyphe/server/modules/notifications/services/notification-copy.service.ts';
console.log(JSON.stringify(buildNotificationText({ provider: 'claude', sessionId: 's1', kind: 'limit',
  code: 'limit.warning', severity: 'warning', meta: { rateLimitType: 'seven_day', resetsAt: 1793084400, pct: 96 },
  sessionName: 'probe chat' } as any)));
TS
/home/lyphe/.claude/claudecodeui_lyphe/node_modules/.bin/tsx \
  --tsconfig /home/lyphe/.claude/claudecodeui_lyphe/server/tsconfig.json "$D/copy.mts"
case "$D" in /tmp/athena-probe.??????) rm -rf -- "$D" ;; esac
```

measured 2026-10-21 by chain chain-usage-limits--account-switch--chat-readings-20261021-183913-317f, finding L1, LOW
probe-key: 5a170e582c0172a5691c5671e5138f9f02d3446a

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/pacer-door.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/usage.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-chat-readings.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-limit-memory.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-runtime-signals.ts, /home/lyphe/.claude/hooks/plan_runner/pacer/door.py

## INV-9289 — probe — the untrusted-wire rule the fix names was applied to one field, not the root: an absent figure still draws "NaN%", and an absent `at` still takes the whole app down

the untrusted-wire rule the fix names was applied to one field, not the root: an absent figure still draws "NaN%", and an absent `at` still takes the whole app down

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'SH'
#!/usr/bin/env bash
set -u
D=${1:?}
cat > "$D/p.mjs" <<'EOF'
import { openConsole } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowS = () => Math.floor(Date.now() / 1000);
const other = { slug: 'scottdejesus', digest: 'f9caa612', token: 'saved', expires_at: nowS() + 86400, chosen: false, live: true, in_use: false, wall: null,
  reading: { five: 0.81, five_resets: nowS() + 3600, week: 0.16, week_resets: nowS() + 86400, at: nowS() - 60, source: 'meter' }, pace: null, room: true, why: '' };
const accountsWith = (row) => ({ reachable: true, accounts: [row, other], candidates: [], auto: true, held: false,
  chosen: { slug: 'sdjesus89', digest: '8b907ae7', at: nowS() - 60, by: 'operator', why: '' }, last_switch: null });
const usage = { reachable: true, account: 'f9caa612', degraded: false, reason: '', staleSince: null, checkedAt: nowS(), pace: null, windows: [] };
async function run(row, label) {
  const s = await openConsole({ viewport: { width: 1440, height: 900 } });
  const { page } = s;
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e).split('\n')[0]));
  await page.route(/\/api\/accounts(?:[/?#]|$)/, (r) => r.fulfill({ json: accountsWith(row) }));
  await page.route(/\/api\/usage(?:[?#]|$)/, (r) => r.fulfill({ json: usage }));
  await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
  const out = { label, footer: await page.locator('button[data-account-row]').count() };
  await page.locator('button[data-account-row]').click().catch((e) => pageErrors.push(`click-failed: ${e.message.split('\n')[0]}`));
  await sleep(1200);
  out.panel = await page.locator('#account-panel').count();
  out.body = (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 90);
  if (out.panel > 0) {
    out.row = (await page.locator('#account-panel [data-account-slug="sdjesus89"]').innerText()).split('\n').find((l) => /5h/.test(l));
    out.meters = await page.locator('#account-panel [role="meter"]').evaluateAll((els) => els.map((e) => [e.getAttribute('aria-label'), e.getAttribute('aria-valuenow'), e.querySelector('.vv-meter__value')?.textContent]));
  }
  out.pageErrors = pageErrors.slice(-1);
  console.log(`${label} ${JSON.stringify(out)}`);
  await s.browser.close();
}
await run({ slug: 'sdjesus89', digest: '8b907ae7', token: 'saved', expires_at: nowS() + 86400, chosen: true, live: false, in_use: true, wall: null,
  reading: { five_resets: nowS() + 3600, week: 0.6, week_resets: nowS() + 86400, at: nowS() - 60, source: 'meter' }, pace: null, room: true, why: '' }, 'ABSENT-five');
await run({ slug: 'sdjesus89', digest: '8b907ae7', token: 'saved', expires_at: nowS() + 86400, chosen: true, live: false, in_use: true, wall: null,
  reading: { five: 0.4, week: 0.6, source: 'meter' }, pace: null, room: true, why: '' }, 'ABSENT-at');
EOF
cd /home/lyphe/.claude/claudecodeui_lyphe
node "$D/p.mjs"
SH
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-probe.??????) rm -rf "$D";; esac
expect: ABSENT-five {"footer":1,"panel":1,…,"row":"5h NaN% · wk 60%","meters":[["Current 5-hour window","NaN","NaN% used"],["This week","60","60% used"]],"pageErrors":[]}; ABSENT-at {"footer":1,"panel":0,"body":"CloudCLI hit an error | …","pageErrors":["Invalid time value"]}. Cured: ABSENT-five row "5h — · wk 60%" with no aria-valuenow on the 5-hour meter, and ABSENT-at panel 1 with row "5h 40% · wk 60%" and no pageerror.
```

measured 2026-10-21 by chain chain-usage-limits--account-switch--panel-fill-20261021-193921-04ef, finding L1, LOW;
re-pinned to the lane's top-level picture (no `door` envelope, `chosen` a record) 2026-10-21 by the
old-switcher fix-pass, not re-measured (a LOW takes no proof run)
probe-key: e9633bd2babd88258ddd1436d550a5be4b8b76ce

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/AccountFooterRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/AccountPopover.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/ClaudeAccountRows.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/ClaudeAccountRowViews.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/hooks/useAccountSetup.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/hooks/useClaudeAccounts.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/utils/accountInUseUsage.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/panel-fill.mjs

## INV-9290 — probe — `healed means deleted` was not applied to the names of what this phase removed (LOW)

`healed means deleted` was not applied to the names of what this phase removed (LOW)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'SH'
#!/usr/bin/env bash
set -u
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
hits=$(grep -nE "slot summary under .door.|store answers only|account store's slots|the account store reads and documents|for the drift notice|The account store could not be read" \
  server/modules/accounts/account-door-relay.ts server/modules/accounts/accounts.module.ts \
  server/modules/accounts/usage.service.ts src/shared/ui/Banner.tsx src/modules/accounts/ClaudeAccountRows.tsx)
printf '%s\n' "$hits"
[ -n "$hits" ] && echo "stale: removed store / door / drift words on this ground" || echo "clean: no removed mechanism named"
echo "— pointers to the deleted verify file:"
grep -n "phase-12" .verify/phase-14.mjs .verify/phase-19.mjs || echo "none"
SH
bash "$D/p.sh"
case "$D" in /tmp/athena-probe.??????) rm -rf "$D";; esac
```

measured 2026-10-21 by chain chain-usage-limits--account-switch--old-switcher-20261021-211135-37f2, finding L1, LOW
probe-key: b0a33f825002044cc2f16dd32c6ac182a3f72f80

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-digest.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-door-relay.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-identity.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/accounts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/accounts.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-store.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/usage.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-auth.provider.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/AccountFooterRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/AccountPopover.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/ClaudeAccountRows.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/claude-accounts-fake.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/hooks/useClaudeAccounts.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/UsageMeters.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/utils/accountInUseUsage.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/Settings.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Banner.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/panel-fill.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/phase-14.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/phase-19.mjs

## INV-9291 — probe — INV-9252's body still teaches the deleted `door`/slot shape, and the builder's report does not name it for the sweep (LOW)

INV-9252's body still teaches the deleted `door`/slot shape, and the builder's report does not name it for the sweep (LOW)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'SH'
#!/usr/bin/env bash
set -u
docstore get INV-9252 --text > "$1/inv.txt"
grep -nE 'door\?:|ClaudeAccountSlot|ClaudeDoorPicture' "$1/inv.txt" || echo "row describes only the current types"
SH
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-probe.??????) rm -rf "$D";; esac
```

measured 2026-10-21 by chain chain-usage-limits--account-switch--old-switcher-20261021-211135-37f2, finding L2, LOW
probe-key: 32bf18ed906c667a65538dd7dd656af31bc92cc2

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-digest.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-door-relay.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-identity.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/accounts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/accounts.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-store.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/usage.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-auth.provider.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/AccountFooterRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/AccountPopover.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/ClaudeAccountRows.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/claude-accounts-fake.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/hooks/useClaudeAccounts.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/UsageMeters.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/utils/accountInUseUsage.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/Settings.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Banner.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/panel-fill.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/phase-14.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/phase-19.mjs

## INV-9292 — probe — INV-9289's pinned probe stubs the deleted envelope and now crashes on both of its own cases (LOW)

INV-9289's pinned probe stubs the deleted envelope and now crashes on both of its own cases (LOW)

```probe
# ~90 s: the pinned probe opens two browser scenes, each waiting out a 30 s click timeout.
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'SH'
#!/usr/bin/env bash
set -u
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
pin=$(docstore get INV-9289 --text | sed -n '/^```probe/,/^```$/p')
if printf '%s\n' "$pin" | grep -q 'reachable: true, active:'; then
  echo "stale envelope: the pin stubs {reachable,active,slots,door:{…}}; the panel reads the picture at the top level"
else
  echo "current envelope: the pin stubs the picture at the top level"
fi
printf '%s\n' "$pin" | sed '1d;$d' > "$1/pin.sh"
bash "$1/pin.sh" 2>&1 | tail -2
SH
bash "$D/p.sh" "$D"
case "$D" in /tmp/athena-probe.??????) rm -rf "$D";; esac
```

measured 2026-10-21 by chain chain-usage-limits--account-switch--old-switcher-20261021-211135-37f2, finding L3, LOW
probe-key: a8997485737f7eb65016bbc0299f2ed90ce3e162

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-digest.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-door-relay.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-identity.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/accounts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/accounts.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-store.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/usage.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-auth.provider.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/AccountFooterRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/AccountPopover.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/ClaudeAccountRows.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/claude-accounts-fake.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/hooks/useClaudeAccounts.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/UsageMeters.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/utils/accountInUseUsage.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/Settings.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Banner.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/panel-fill.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/phase-14.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/phase-19.mjs

## INV-9293 — probe — an unreadable `last_switch.at` still takes the whole app down (LOW; predates this phase, measured on this ground)

an unreadable `last_switch.at` still takes the whole app down (LOW; predates this phase, measured on this ground)

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.mjs" <<'EOF'
import { openConsole } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowS = () => Math.floor(Date.now() / 1000);
const row = (slug, digest) => ({ slug, digest, token: 'saved', expires_at: nowS() + 86400, chosen: false, live: false, in_use: slug === 'beta', wall: null,
  reading: { five: 0.4, five_resets: nowS() + 3600, week: 0.6, week_resets: nowS() + 86400, at: nowS() - 60, source: 'meter' }, pace: null, room: true, why: '' });
const picture = { reachable: true, accounts: [row('alpha', 'aaaa'), row('beta', 'bbbb')], candidates: [], auto: true, held: false,
  chosen: { slug: 'alpha', digest: 'aaaa', at: nowS() - 30, by: 'auto', why: '' },
  last_switch: { at: 'yesterday', from: 'aaaa', from_slug: 'alpha', to: 'bbbb', to_slug: 'beta', by: 'auto', why: 'the 5-hour window filled' } };
const usage = { reachable: true, account: 'aaaa', degraded: false, reason: '', staleSince: null, checkedAt: nowS(), pace: null, windows: [] };
const s = await openConsole({ viewport: { width: 1440, height: 900 } });
const { page } = s;
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message || e).split('\n')[0]));
await page.route(/\/api\/accounts(?:[/?#]|$)/, (r) => r.fulfill({ json: picture }));
await page.route(/\/api\/usage(?:[?#]|$)/, (r) => r.fulfill({ json: usage }));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('button[data-account-row]').waitFor({ timeout: 20000 });
await sleep(600);
await page.locator('button[data-account-row]').click().catch(() => {});
await sleep(1200);
const body = (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 120);
const panel = await page.locator('#account-panel').count();
console.log(JSON.stringify({ panel, appError: body.includes('CloudCLI hit an error'), body, pageErrors }));
await s.browser.close();
EOF
cd /home/lyphe/.claude/claudecodeui_lyphe || exit 1
node "$D/p.mjs"
case "$D" in /tmp/athena-probe.??????) rm -rf "$D";; esac
```

measured 2026-10-21 by chain chain-usage-limits--account-switch--old-switcher-20261021-211135-37f2, finding L4, LOW
probe-key: bda706a7a70fa1a3de7d7b31e8c4820d226f6238

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-digest.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-door-relay.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-identity.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/accounts.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/accounts.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/account-store.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/accounts/usage.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/providers/list/claude/claude-auth.provider.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/AccountFooterRow.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/AccountPopover.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/ClaudeAccountRows.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/claude-accounts-fake.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/hooks/useClaudeAccounts.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/UsageMeters.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/accounts/utils/accountInUseUsage.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/settings/Settings.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/ui/Banner.tsx, /home/lyphe/.claude/claudecodeui_lyphe/.verify/panel-fill.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/phase-14.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/phase-19.mjs

## INV-9302 — probe — MEDIUM — `said` is typed `VerdictWord` on `JudgedRule` and `PageFailure`, and the owner stores `"(no entry)"` there

MEDIUM — `said` is typed `VerdictWord` on `JudgedRule` and `PageFailure`, and the owner stores `"(no entry)"` there

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /opt/shadow-connector || exit 1
venv/bin/python - <<'PY'
import asyncio, datetime as dt, uuid
from extractors.servpro_bulletins.verify.read import read_page, unsettled_entry
from extractors.servpro_bulletins.verify.prompt import PageContext
from extractors.servpro_bulletins.verify.candidates import Candidate
async def ask(prompt, pdf, mime, **kw):
    return "this is not json"
now = dt.datetime.now(dt.timezone.utc)
cand = Candidate(id=str(uuid.uuid4()), bulletin_id=str(uuid.uuid4()), page=3, subject="x", raw_rule_text="Contact within 24 hours.",
                 fields=dict(requires_pre_approval=False, notification_window_hours=24, window_time_basis='calendar', threshold_value=None,
                             threshold_unit=None, stage=None, deadline_type=None, loss_types=None, cadence_period=None, is_cadence=False),
                 stamps={}, revised_at=now, is_current=True, bulletin_number="1", revision="A", created_at=now)
res = asyncio.run(read_page(PageContext(carrier="Stub", bulletin="#1", total_pages=5, page=3, held=(3,)), b"%PDF", "Contact within 24 hours.", [cand], model="stub", ask=ask))
print("refused:", bool(res.refused))
for e in res.entries:
    print("entry verdict=%r said=%r failures=%d" % (e.verdict, e.said, len(e.failures)))
PY
grep -n "said:" /home/lyphe/.claude/claudecodeui_lyphe/src/shared/carrier-bulletins-types.ts || echo "types: no said member"
grep -n "no entry" /opt/shadow-connector/extractors/servpro_bulletins/verify/views.py 2>/dev/null || echo "views.py: absent or silent on the word"
EOF
bash "$D/p.sh"
expect: while the defect stands: `refused: True`, `entry verdict='unsettled' said='(no entry)' failures=1`, two lines `said: VerdictWord;` (207 and 226), and `views.py: absent or silent on the word`; cured when the types' `said` members admit the word, or `views.py` is shown to map it and the header says so
```

measured 2026-10-21 by chain chain-bulletins-read-by-claude--wire-20261021-220823-7261, finding M1, MEDIUM
probe-key: f43f6eaaefa657324cf3d15a85a9276f920d7b2a

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/carrier-bulletins-types.ts

## INV-9303 — probe — LOW — `MAN-8865` is not served on a touch of `api.ts`, and the row that is served does not name `carrierBulletins`

LOW — `MAN-8865` is not served on a touch of `api.ts`, and the row that is served does not name `carrierBulletins`

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /opt/shadow-connector || exit 1
A=/home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts
printf 'rows served for api.ts: '; docstore govern "$A" --limit 50 --text | grep -cE '^(MAN|INV)-'
printf 'MAN-8865 among them: '; docstore govern "$A" --limit 50 --text | grep -c 'MAN-8865'
printf 'MAN-8558 body names carrierBulletins: '; docstore get MAN-8558 --text | grep -c 'carrierBulletins'
EOF
bash "$D/p.sh"
expect: `rows served for api.ts: 50`, `MAN-8865 among them: 0`, `MAN-8558 body names carrierBulletins: 0` while the defect stands; cured when either of the last two is at least 1
```

measured 2026-10-21 by chain chain-bulletins-read-by-claude--wire-20261021-220823-7261, finding L1, LOW
probe-key: d7a814adeaba567c97e2cc0dea6376274023960d

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/carrier-bulletins-types.ts

## INV-9304 — probe — LOW — the row and the types header name different owners for `scope`

LOW — the row and the types header name different owners for `scope`

```probe
D=$(mktemp -d /tmp/athena-probe.XXXXXX) || exit 1
cat > "$D/p.sh" <<'EOF'
cd /opt/shadow-connector || exit 1
printf 'row names: '; docstore get MAN-8865 --text | grep -o 'scope[^.]*verify/[a-z_]*\.py' | head -1
printf 'types header names: '; sed -n 16,17p /home/lyphe/.claude/claudecodeui_lyphe/src/shared/carrier-bulletins-types.ts | grep -o 'verify/[a-z_]*\.py' | head -1
EOF
bash "$D/p.sh"
expect: `row names: … verify/requirement.py` and `types header names: verify/contract.py` while the defect stands; cured when both name `verify/contract.py`
```

measured 2026-10-21 by chain chain-bulletins-read-by-claude--wire-20261021-220823-7261, finding L2, LOW
probe-key: 1e460b63754d8400f356738036c2683d46266512

governs: /home/lyphe/.claude/claudecodeui_lyphe/.oxlintrc.json, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/api.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/carrier-bulletins-types.ts

## INV-9307 — probe — MEDIUM: the door's text face prints each account's digest, though this phase's brief says digests stay in JSON and files

MEDIUM: the door's text face prints each account's digest, though this phase's brief says digests stay in JSON and files

```probe
D=$(mktemp -d /tmp/athena-probe.M1.XXXXXX) || exit 1
export D
cat > "$D/p.sh" <<'EOF'
#!/bin/bash
set -u
mkdir -p "$D/state/dispatcher" "$D/store" || exit 1
printf '{"oauthAccount":{"accountUuid":"11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa","emailAddress":"alpha@example.invalid"}}' > "$D/claude.json"
export DISPATCHER_HOME="$D/state/dispatcher" PLAN_RUNNER_CLAUDE_ACCOUNT_HOME="$D/store" \
       PLAN_RUNNER_CLAUDE_ACCOUNT_TOKENS="$D/store/tokens.json" \
       PLAN_RUNNER_CLAUDE_IDENTITY_PATH="$D/claude.json" PYTHONPATH=/home/lyphe/.claude/hooks
python3 -B -c "from plan_runner.claude_account import store; store.add('92f3b37e','alpha')" || exit 1
TEXT=$(/home/lyphe/.claude/scripts/claude-account status)
JSON=$(/home/lyphe/.claude/scripts/claude-account status --json)
echo "text-face-digests=$(printf '%s' "$TEXT" | grep -oE '\b[0-9a-f]{8}\b' | wc -l)"
echo "json-digests=$(printf '%s' "$JSON" | grep -oE '\b[0-9a-f]{8}\b' | wc -l)"
echo "text-head=$(printf '%s' "$TEXT" | head -1)"
EOF
bash "$D/p.sh"
cd /tmp; case "$D" in /tmp/athena-probe.M1.??????) rm -rf "$D" ;; *) echo "not its pattern: $D" ;; esac
```

measured 2026-10-21 by chain chain-usage-limits--account-switch--whole-20261021-221412-9c19, finding M1, MEDIUM
probe-key: ebe5ba3d4e22c02a2780ac991700e5c82bbe4e44

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/whole-account-switch-panel.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/whole-account-switch-passes.py, /home/lyphe/.claude/claudecodeui_lyphe/.verify/whole-account-switch.sh, /home/lyphe/.claude/hooks/enforce_claude_api_secret.py, /home/lyphe/.claude/hooks/plan_runner/claude_account/route.py

## INV-9308 — probe — LOW: the status reader's docstring says a string is no status, but a numeric string files a refused wall

LOW: the status reader's docstring says a string is no status, but a numeric string files a refused wall

```probe
D=$(mktemp -d /tmp/athena-probe.L1.XXXXXX) || exit 1
export D
cat > "$D/p.sh" <<'EOF'
#!/bin/bash
set -u
mkdir -p "$D/state/dispatcher" "$D/store" || exit 1
printf '{"oauthAccount":{"accountUuid":"11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}' > "$D/claude.json"
export DISPATCHER_HOME="$D/state/dispatcher" PLAN_RUNNER_CLAUDE_ACCOUNT_HOME="$D/store" \
       PLAN_RUNNER_CLAUDE_ACCOUNT_TOKENS="$D/store/tokens.json" \
       PLAN_RUNNER_CLAUDE_IDENTITY_PATH="$D/claude.json" PYTHONPATH=/home/lyphe/.claude/hooks
python3 -B - <<'PY'
from plan_runner.claude_account import route, store, tokens
digest = '92f3b37e'
store.add(digest, 'alpha')
token = 'sk-ant-oat01-' + 'P' * 24
store.set_token(digest, tokens.save(digest, token), checked=True)
class Outcome:
    def __init__(self, status, api_error_status=None):
        self.status, self.api_error_status = status, api_error_status
print('docstring-claims-a-string-is-no-status', 'a string' in (route._status.__doc__ or ''))
for value in (401, '401', True):
    got = route.refused(Outcome('api_error', value), digest, now=1000.0)
    print(f'status {value!r} ->', 'none' if got is None else got.kind)
PY
EOF
bash "$D/p.sh"
cd /tmp; case "$D" in /tmp/athena-probe.L1.??????) rm -rf "$D" ;; *) echo "not its pattern: $D" ;; esac
```

measured 2026-10-21 by chain chain-usage-limits--account-switch--whole-20261021-221412-9c19, finding L1, LOW
probe-key: cb8206a55904974704a30f22f392a2545bb1a216

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/whole-account-switch-panel.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/whole-account-switch-passes.py, /home/lyphe/.claude/claudecodeui_lyphe/.verify/whole-account-switch.sh, /home/lyphe/.claude/hooks/enforce_claude_api_secret.py, /home/lyphe/.claude/hooks/plan_runner/claude_account/route.py

## INV-9309 — probe — LOW: the unreadable-token raise leaves the role out and a double space in, for an ordinary launch

LOW: the unreadable-token raise leaves the role out and a double space in, for an ordinary launch

```probe
D=$(mktemp -d /tmp/athena-probe.L2.XXXXXX) || exit 1
export D
cat > "$D/p.sh" <<'EOF'
#!/bin/bash
set -u
mkdir -p "$D/state/dispatcher" "$D/store" "$D/liveconfig" || exit 1
printf '{"oauthAccount":{"accountUuid":"11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}' > "$D/claude.json"
printf '{"probe":true}\n' > "$D/liveconfig/settings.json"
export DISPATCHER_HOME="$D/state/dispatcher" PLAN_RUNNER_CLAUDE_ACCOUNT_HOME="$D/store" \
       PLAN_RUNNER_CLAUDE_ACCOUNT_TOKENS="$D/store/tokens.json" \
       PLAN_RUNNER_CLAUDE_IDENTITY_PATH="$D/claude.json" CLAUDE_CONFIG_DIR="$D/liveconfig" \
       PYTHONPATH=/home/lyphe/.claude/hooks
python3 -B - <<'PY'
from plan_runner.claude_account import route, store, tokens
digest = '92f3b37e'
store.add(digest, 'alpha')
token = 'sk-ant-oat01-' + 'P' * 24
store.set_token(digest, tokens.save(digest, token), checked=True)
tokens.remove(digest)
class Spec:
    provider = ''
    payer = 0
    account = digest
    role = ''
try:
    route.route(Spec())
    print('raise-text: NO RAISE')
except Exception as exc:
    text = str(exc)
    print('raise-text:', text.replace(' ', '·'))
    print('double-space:', '  ' in text, 'token-in-words:', token in text)
PY
EOF
bash "$D/p.sh"
cd /tmp; case "$D" in /tmp/athena-probe.L2.??????) rm -rf "$D" ;; *) echo "not its pattern: $D" ;; esac
```

measured 2026-10-21 by chain chain-usage-limits--account-switch--whole-20261021-221412-9c19, finding L2, LOW
probe-key: cea89c710a67633226d57a865016753d0f04adef

governs: /home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/console.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/whole-account-switch-panel.mjs, /home/lyphe/.claude/claudecodeui_lyphe/.verify/whole-account-switch-passes.py, /home/lyphe/.claude/claudecodeui_lyphe/.verify/whole-account-switch.sh, /home/lyphe/.claude/hooks/enforce_claude_api_secret.py, /home/lyphe/.claude/hooks/plan_runner/claude_account/route.py

## INV-9404 — probe — MEDIUM — the lane drops every response header, so the engine's `X-Left-Out` never reaches the browser, and the requirement was deleted instead of met

MEDIUM — the lane drops every response header, so the engine's `X-Left-Out` never reaches the browser, and the requirement was deleted instead of met

```probe
D=$(mktemp -d /tmp/athena-probe-lo.XXXXXX) || exit 1
cat > "$D/p.mts" <<'EOF'
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import express from 'express';
const eng = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store, max-age=0', 'x-left-out': '[{"carrier":"State Farm","reason":"unplannable"}]' }); r.end('[{"carrier":"Hanover Insurance"}]'); });
await new Promise<void>((res) => eng.listen(0, '127.0.0.1', res));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-lo-env-')); const env = path.join(tmp, 'env'); fs.writeFileSync(env, 'EIS_INTERNAL_SECRET=scratch-secret\n');
process.env.SHADOW_CONNECTOR_URL = `http://127.0.0.1:${(eng.address() as any).port}`; process.env.SHADOW_CONNECTOR_ENV_FILE = env;
const { createCarrierBulletinsModule } = await import('/home/lyphe/.claude/claudecodeui_lyphe/server/modules/carrier-bulletins/index.ts');
const app = express(); app.use('/api/carrier-bulletins', createCarrierBulletinsModule().router);
const lane = http.createServer(app); await new Promise<void>((res) => lane.listen(0, '127.0.0.1', res));
const rs = await fetch(`http://127.0.0.1:${(lane.address() as any).port}/api/carrier-bulletins/overview`);
console.log('lane answers', rs.status, '| x-left-out=' + rs.headers.get('x-left-out'), '| cache-control=' + rs.headers.get('cache-control'), '| body=' + (await rs.text()));
process.exit(0);
EOF
cd /home/lyphe/.claude/claudecodeui_lyphe && TSX_TSCONFIG_PATH=server/tsconfig.json timeout 60 node --import tsx "$D/p.mts"
expect: lane answers 200 | x-left-out=null | cache-control=null | body=[{"carrier":"Hanover Insurance"}]
```

measured 2026-10-22 by chain chain-bulletins-read-by-claude--relay-20261022-095239-89c8, finding M1, MEDIUM
probe-key: 48e4e43024f75119b9a380d59beed15149ae8d4f

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/affected-areas/affected-areas.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/carrier-bulletins/carrier-bulletins.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/carrier-bulletins/carrier-bulletins.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/carrier-bulletins/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/shadow-connector-lane-router.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/shadow-connector-lane.ts

## INV-9405 — probe — LOW — "a 2xx that is not a PNG is the lane's unreadable" is held by the Content-Type header alone

LOW — "a 2xx that is not a PNG is the lane's unreadable" is held by the Content-Type header alone

```probe
D=$(mktemp -d /tmp/athena-probe-png.XXXXXX) || exit 1
cat > "$D/p.mts" <<'EOF'
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import express from 'express';
const eng = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'image/png' }); r.end('<html>an error page, not a PNG</html>'); });
await new Promise<void>((res) => eng.listen(0, '127.0.0.1', res));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-png-env-')); const env = path.join(tmp, 'env'); fs.writeFileSync(env, 'EIS_INTERNAL_SECRET=scratch-secret\n');
process.env.SHADOW_CONNECTOR_URL = `http://127.0.0.1:${(eng.address() as any).port}`; process.env.SHADOW_CONNECTOR_ENV_FILE = env;
const { createCarrierBulletinsModule } = await import('/home/lyphe/.claude/claudecodeui_lyphe/server/modules/carrier-bulletins/index.ts');
const app = express(); app.use('/api/carrier-bulletins', createCarrierBulletinsModule().router);
const lane = http.createServer(app); await new Promise<void>((res) => lane.listen(0, '127.0.0.1', res));
const sha = 'a'.repeat(64);
const rs = await fetch(`http://127.0.0.1:${(lane.address() as any).port}/api/carrier-bulletins/files/${sha}/pages/1/image`);
const b = Buffer.from(await rs.arrayBuffer());
console.log('lane answers', rs.status, '| content-type=' + rs.headers.get('content-type'), '| cache-control=' + rs.headers.get('cache-control'), '| PNG signature=' + (b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'), '| first bytes=' + JSON.stringify(b.subarray(0, 12).toString('latin1')));
process.exit(0);
EOF
cd /home/lyphe/.claude/claudecodeui_lyphe && TSX_TSCONFIG_PATH=server/tsconfig.json timeout 60 node --import tsx "$D/p.mts"
expect: lane answers 200 | content-type=image/png | cache-control=private, max-age=31536000, immutable | PNG signature=false | first bytes="<html>an err"   (cured: 502 and no cache-control)
```

measured 2026-10-22 by chain chain-bulletins-read-by-claude--relay-20261022-095239-89c8, finding L1, LOW
probe-key: 34b30e90d6daa6cf7193349afd1df8abc6a3d5b0

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/affected-areas/affected-areas.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/carrier-bulletins/carrier-bulletins.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/carrier-bulletins/carrier-bulletins.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/carrier-bulletins/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/shadow-connector-lane-router.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/shadow-connector-lane.ts

## INV-9406 — probe — LOW — rows lost: the move out of MAN-8559 dropped three facts that no row carries now

LOW — rows lost: the move out of MAN-8559 dropped three facts that no row carries now

```probe
for t in MAN-8863 INV-8633 MAN-8908 MAN-8909 MAN-8559; do echo "$t begins-with-quote=$(docstore get $t --text | grep -c -i 'begins with') next(error)=$(docstore get $t --text | grep -c 'next(error)')"; done; docstore history MAN-8559 --limit 1 --diff --text | grep -c 'really begins with'
expect: every row prints begins-with-quote=0 next(error)=0, and the last line prints 1 (the clause sits in the before-image of MAN-8559's 17:03 write)
```

measured 2026-10-22 by chain chain-bulletins-read-by-claude--relay-20261022-095239-89c8, finding L2, LOW
probe-key: f0bf3cac0de8086c7847e20ea4216170a1db7b88

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/affected-areas/affected-areas.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/carrier-bulletins/carrier-bulletins.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/carrier-bulletins/carrier-bulletins.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/carrier-bulletins/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/shadow-connector-lane-router.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/shadow-connector-lane.ts

## INV-9443 — probe — MEDIUM — the card's Delete is never drawn for a plan whose design is waiting, so "the card's Delete relays this verb, so it withdraws too, with no app change" is false

MEDIUM — the card's Delete is never drawn for a plan whose design is waiting, so "the card's Delete relays this verb, so it withdraws too, with no app change" is false

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/queued-design-amend-withdraw/athena-probes/card.sh
echo "[probe exit $?]"
expect: `card draws Delete with its design queued: true` (today: false; the no-outing line prints true either way)
```

measured 2026-10-22 by chain chain-queued-design-amend-withdraw-20261022-142729-ba02, finding M1, MEDIUM
probe-key: 539be1f68ee680e5b51ad25df18fd80ae1962dfd

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/dispatcherState.ts, /home/lyphe/.claude/hooks/dispatcher/planner_claim.py, /home/lyphe/.claude/hooks/dispatcher/planner_waiting.py, /home/lyphe/.claude/hooks/dispatcher/store.py, /home/lyphe/.claude/skills/feature/SKILL.md

## INV-9444 — probe — MEDIUM — `tell <plan>` can amend the ARC's waiting `tell`, and the appended words name no plan

MEDIUM — `tell <plan>` can amend the ARC's waiting `tell`, and the appended words name no plan

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/queued-design-amend-withdraw/athena-probes/arc_addressee.sh
echo "[probe exit $?]"
expect: `a queued brief names the plan ax--p: True` (today: False; the door prints AMENDED tell ax--p over the arc's row)
```

measured 2026-10-22 by chain chain-queued-design-amend-withdraw-20261022-142729-ba02, finding M2, MEDIUM
probe-key: d3e8fd1e1c7242c96d1d153fc0d8a7c45797dbf4

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/dispatcherState.ts, /home/lyphe/.claude/hooks/dispatcher/planner_claim.py, /home/lyphe/.claude/hooks/dispatcher/planner_waiting.py, /home/lyphe/.claude/hooks/dispatcher/store.py, /home/lyphe/.claude/skills/feature/SKILL.md

## INV-9445 — probe — LOW — an amend skips the Rework's disarm, so an armed Accept-when-cut stands over a design a tell is about to change

LOW — an amend skips the Rework's disarm, so an armed Accept-when-cut stands over a design a tell is about to change

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/queued-design-amend-withdraw/athena-probes/armed_amend.sh
echo "[probe exit $?]"
expect: `Accept still armed after the second tell: False` (today: True)
```

measured 2026-10-22 by chain chain-queued-design-amend-withdraw-20261022-142729-ba02, finding L1, LOW
probe-key: db35e1860cc9a42bfb49a131c15baa02104185cf

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/dispatcherState.ts, /home/lyphe/.claude/hooks/dispatcher/planner_claim.py, /home/lyphe/.claude/hooks/dispatcher/planner_waiting.py, /home/lyphe/.claude/hooks/dispatcher/store.py, /home/lyphe/.claude/skills/feature/SKILL.md

## INV-9446 — probe — LOW — when the claim file cannot be written, a `tell` in the fork window prints AMENDED over a body the fork never reads (a `drop` there would delete the row under a forked child)

LOW — when the claim file cannot be written, a `tell` in the fork window prints AMENDED over a body the fork never reads (a `drop` there would delete the row under a forked child)

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/queued-design-amend-withdraw/athena-probes/claim_unwritable.sh
echo "[probe exit $?]"
expect: the door does not print AMENDED while no claim stands (today: `claim file during the fork window: []`, AMENDED, `the forked outing read the body: False`)
```

measured 2026-10-22 by chain chain-queued-design-amend-withdraw-20261022-142729-ba02, finding L2, LOW
probe-key: 66717b08870e4a1875036280772c03300db8cd8c

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/dispatcherState.ts, /home/lyphe/.claude/hooks/dispatcher/planner_claim.py, /home/lyphe/.claude/hooks/dispatcher/planner_waiting.py, /home/lyphe/.claude/hooks/dispatcher/store.py, /home/lyphe/.claude/skills/feature/SKILL.md

## INV-9447 — probe — LOW — three statements the change made false stay in the docs

LOW — three statements the change made false stay in the docs

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/queued-design-amend-withdraw/athena-probes/docs.sh
echo "[probe exit $?]"
expect: no stale lines (today: 3 lines, MANUAL:96, MANUAL:121, dispatcherState.ts:225)
```

measured 2026-10-22 by chain chain-queued-design-amend-withdraw-20261022-142729-ba02, finding L3, LOW
probe-key: 0e08bed802a9a12261d0c8f9b2f41aadc173706b

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/dispatcherState.ts, /home/lyphe/.claude/hooks/dispatcher/planner_claim.py, /home/lyphe/.claude/hooks/dispatcher/planner_waiting.py, /home/lyphe/.claude/hooks/dispatcher/store.py, /home/lyphe/.claude/skills/feature/SKILL.md

## INV-9448 — probe — LOW — the skill says a waiting design is "withdrawn by `dispatcher drop <name>`", but the feature leaves the roadmap with it

LOW — the skill says a waiting design is "withdrawn by `dispatcher drop <name>`", but the feature leaves the roadmap with it

```probe
bash /home/lyphe/.claude/state/pipeline-reviews/queued-design-amend-withdraw/athena-probes/drop_roadmap.sh
echo "[probe exit $?]"
expect: `f still on the roadmap after the drop: 0` and the skill line names the feature leaving (today: skill count 0)
```

measured 2026-10-22 by chain chain-queued-design-amend-withdraw-20261022-142729-ba02, finding L4, LOW
probe-key: d9abf2728342deb01dd53c852b32c2d3c38fe1ae

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatcher/dispatcher.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/dispatcher/dispatcherState.ts, /home/lyphe/.claude/hooks/dispatcher/planner_claim.py, /home/lyphe/.claude/hooks/dispatcher/planner_waiting.py, /home/lyphe/.claude/hooks/dispatcher/store.py, /home/lyphe/.claude/skills/feature/SKILL.md

## INV-9451 — probe — . The standing proof cannot run on today's data, and its `RequirementWindow` verdict now false-FAILs on a healthy deadline-only or cadence-only page — the H1 cure made `cadence` a mirror member beside three optional ones, and the proof still compares for equality

. The standing proof cannot run on today's data, and its `RequirementWindow` verdict now false-FAILs on a healthy deadline-only or cadence-only page — the H1 cure made `cadence` a mirror member beside three optional ones, and the proof still compares for equality

```probe
D=$(mktemp -d /tmp/athena-probe-rw2-XXXXXX) || exit 1
cat > "$D/p.mjs" <<'JS'
import fs from 'node:fs';
import { curlJson, loginToken } from '/home/lyphe/.claude/claudecodeui_lyphe/.verify/lib/whole-check-kit.mjs';
const mirror = fs.readFileSync('/home/lyphe/.claude/claudecodeui_lyphe/src/shared/carrier-bulletins-types.ts', 'utf8');
// the proof's own member regex and its own equality (.verify/bulletins-view.mjs `membersOf` / `sameList`)
const body = mirror.match(/export type RequirementWindow = \{([\s\S]*?)\n\};/);
const mirrored = body === null ? null : [...body[1].matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]).sort();
console.log('RequirementWindow members as the proof reads them:', JSON.stringify(mirrored));
const token = loginToken();
const get = (r) => { for (let i = 0; i < 6; i++) { try { const a = curlJson('GET', `/api/carrier-bulletins${r}`, undefined, token); if (a.status === 200) return a.body; } catch (e) {} } return null; };
const ov = get('/overview') ?? [];
const sf = ov.find((r) => r.carrier === 'State Farm');
const pagesOfSf = sf ? get(`/bulletins/${sf.bulletin_id}/pages`) ?? [] : [];
const state = (n) => pagesOfSf.find((p) => p.page === n)?.state ?? 'none';
console.log(`the proof's page pick: State Farm p13 is ${state(13)}, p22 is ${state(22)} (it exits 2 unless one is read or settled)`);
let shown = 0;
for (const r of ov) {
  if (shown >= 3) break;
  for (const p of (get(`/bulletins/${r.bulletin_id}/pages`) ?? []).filter((x) => x.state !== 'unread')) {
    const ws = (get(`/bulletins/${r.bulletin_id}/pages/${p.page}`)?.requirements ?? []).map((q) => q.window).filter(Boolean);
    if (ws.length === 0) continue;
    const live = [...new Set(ws.flatMap((w) => Object.keys(w)))].sort();
    console.log(`${r.carrier} p${p.page}: live ${JSON.stringify(live)} → "has exactly the members of RequirementWindow": ${JSON.stringify(live) === JSON.stringify(mirrored) ? 'PASS' : 'FAIL'}`);
    if (++shown >= 3) break;
  }
}
if (shown === 0) console.log('no live requirement window on any read page right now');
JS
(cd "$D" && timeout 200 node p.mjs)
expect: while the defect stands, the mirror line reads ["anchor","basis","cadence","hours"] and every deadline-only page prints FAIL (and while State Farm's p13 and p22 are unread, the pick line says so); once the verdict compares optional members as a subset, no page that carries only known keys prints FAIL
```

measured 2026-10-22 by chain chain-bulletins-read-by-claude--fill-20261022-124505-62e0, finding M1, MEDIUM
probe-key: 383215e821c4c890380f82df64a02fd15c8c755c

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/carrier-bulletins/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/bulletins-view.mjs

## INV-9452 — probe — . Three rows are stale or contradict the cures

. Three rows are stale or contradict the cures

```probe
cd /tmp || exit 1
echo "MAN-8865 lines still stating window is {hours, basis, anchor}: $(docstore get MAN-8865 | python3 -c "import sys,json; print(sum(1 for l in json.load(sys.stdin)['row']['body'].split('\n') if '\`window\` is \`{ hours, basis, anchor }\`' in l))")"
echo "MAN-8928 lines naming the left-out banner: $(docstore get MAN-8928 | python3 -c "import sys,json; print(sum(1 for l in json.load(sys.stdin)['row']['body'].split('\n') if 'left out' in l.lower() or 'X-Left-Out' in l))")"
expect: while the rows are stale, "MAN-8865 lines still stating window is {hours, basis, anchor}: 1" and "MAN-8928 lines naming the left-out banner: 0"; healed, 0 and at least 1
```

measured 2026-10-22 by chain chain-bulletins-read-by-claude--fill-20261022-124505-62e0, finding L1, LOW
probe-key: 6f098e7133465e04a89c24e274c2aebc9b9b00f9

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/carrier-bulletins/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/bulletins-view.mjs

## INV-9453 — probe — . With every carrier left out, the overview says both "13 carriers are left out" and "No carrier has a bulletin on file"

. With every carrier left out, the overview says both "13 carriers are left out" and "No carrier has a bulletin on file"

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe/src/modules/carrier-bulletins || exit 1
echo "empty-state branch: $(grep -n 'rows.length === 0' OverviewScreen.tsx | head -1 | cut -c1-90)"
echo "empty-state words say \"none on file\" while leftOut is in scope: $(awk '/rows.length === 0/{f=1} f&&/emptyMessage/{print (/leftOut/ ? "guarded" : "not guarded"); exit}' OverviewScreen.tsx)"
expect: while the gap stands, "not guarded"; once the empty branch says something true when carriers are left out, "guarded" (or the branch is no longer reached with leftOut non-empty)
```

measured 2026-10-22 by chain chain-bulletins-read-by-claude--fill-20261022-124505-62e0, finding L2, LOW
probe-key: 1b5b2cadb17e992bc2916a5fc77e340789fa16ea

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/carrier-bulletins/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/.verify/bulletins-view.mjs
