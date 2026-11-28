// protects: server/modules/dispatch-souls/dispatch-souls.module.ts, server/modules/dispatch-souls/launch-watch.service.ts, server/modules/dispatch-souls/launch-clock.service.ts, server/modules/kanban/kanban-spill.service.ts, server/modules/memory-intake/memory-spill.service.ts, server/modules/universe/universe.module.ts, server/modules/universe/universe-heads.watch.ts, server/modules/claude-updates/update-reconciler.ts, server/modules/claude-updates/update-reconciler.wake.ts, server/shared/settled-call.service.ts, deploy/systemd/, scripts/prod-client-build.sh, /home/lyphe/.claude/ArchPulse/server/live/kinds/file.ts
// writes: none
//
// The seven sites the pollers-hooks--file-watches plan cured stay cured: each site's file names none of the interval
// constants it lost, no site file or new watch file calls setInterval, ArchPulse's file kind is a stream with no
// interval, and no file under server/, deploy/ or scripts/ names the prod-build timer or its oneshot. A reading of the
// files as they stand: a name left in a comment counts (a cured cadence is purged, not annotated); setInterval is
// judged on the code with comments stripped. Other modules' own intervals are not this promise's.

import fs from "node:fs";
import path from "node:path";

import { broken, CannotRun, held, runCase } from "../lib/case.mjs";

const REPO = "/home/lyphe/.claude/claudecodeui_lyphe";
const ARCHPULSE_FILE_KIND = "/home/lyphe/.claude/ArchPulse/server/live/kinds/file.ts";

const SITES = [
  ["server/modules/dispatch-souls/dispatch-souls.module.ts", ["POLL_MS"]],
  ["server/modules/dispatch-souls/launch-watch.service.ts", []],
  ["server/modules/dispatch-souls/launch-clock.service.ts", []],
  ["server/modules/kanban/kanban-spill.service.ts", ["SPILL_INTERVAL_MS"]],
  ["server/modules/memory-intake/memory-spill.service.ts", ["SPILL_INTERVAL_MS"]],
  ["server/modules/universe/universe.module.ts", ["HEADS_INTERVAL_MS"]],
  ["server/modules/universe/universe-heads.watch.ts", []],
  ["server/modules/claude-updates/update-reconciler.ts", ["TICK_INTERVAL_MS"]],
  ["server/modules/claude-updates/update-reconciler.wake.ts", []],
  ["server/shared/settled-call.service.ts", []],
];
const GONE_UNITS = /cloudcli-client-prod-build\.(timer|service)\b/;
const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");

function filesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.isFile() && fs.statSync(full).size < 2_000_000) out.push(full);
  }
  return out;
}

runCase(async () => {
  const wrong = [];
  for (const [rel, names] of SITES) {
    const file = path.join(REPO, rel);
    if (!fs.existsSync(file)) { wrong.push(rel + " is not on disk"); continue; }
    const text = fs.readFileSync(file, "utf8");
    for (const name of names) if (new RegExp("\\b" + name + "\\b").test(text)) wrong.push(rel + " still names " + name);
    if (/\bsetInterval\s*\(/.test(codeOf(text))) wrong.push(rel + " calls setInterval");
  }
  if (!fs.existsSync(ARCHPULSE_FILE_KIND)) throw new CannotRun(ARCHPULSE_FILE_KIND + " is not on disk");
  const kind = codeOf(fs.readFileSync(ARCHPULSE_FILE_KIND, "utf8"));
  if (!/\bmode:\s*["']stream["']/.test(kind)) wrong.push("ArchPulse's file kind is not mode \"stream\"");
  if (/\bsetInterval\s*\(/.test(kind)) wrong.push("ArchPulse's file kind calls setInterval");
  for (const top of ["server", "deploy", "scripts"]) {
    for (const file of filesUnder(path.join(REPO, top))) {
      if (GONE_UNITS.test(fs.readFileSync(file, "utf8"))) wrong.push(path.relative(REPO, file) + " names the prod-build timer or its oneshot");
    }
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("the seven cured sites name no interval they lost and call no setInterval; ArchPulse's file kind is a stream; nothing under server, deploy or scripts names the prod-build timer or oneshot");
});
