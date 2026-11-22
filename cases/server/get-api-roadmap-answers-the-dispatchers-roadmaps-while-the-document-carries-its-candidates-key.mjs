// protects: server/modules/roadmap/roadmap-state.service.ts, server/modules/roadmap/roadmap.routes.ts, /home/lyphe/.claude/hooks/dispatcher/report_roadmap.py, /home/lyphe/.claude/hooks/dispatcher/store_rnd.py
// writes: none
// The roadmap's readers after the document gained its key (report_roadmap.document's candidates): CloudCLI's lane reads the
// document whole, so a reader that refused a key it does not know would answer no roadmap at all. The route answers the
// same roadmaps and milestones the verb prints, read again (three times at most) before a difference is a break.
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { api } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const BIN = path.join(os.homedir(), ".claude", "scripts", "dispatcher");

function verb(args) {
  return new Promise((resolve) => {
    execFile(BIN, args, { cwd: os.homedir(), timeout: 60000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => resolve({ error: error, out: String(stdout || "") }));
  });
}
const nameOf = (x) => (x && (x.name || x.title)) || "?";
function shape(d) {
  const list = Array.isArray(d && d.roadmaps) ? d.roadmaps : [];
  return list.map((r) => nameOf(r) + "[" + (Array.isArray(r.milestones) ? r.milestones.map(nameOf).join(",") : "") + "]").join(" ");
}

runCase(async () => {
  let last = "";
  for (let turn = 0; turn < 3; turn += 1) {
    const v = await verb(["roadmap", "show", "--json"]);
    if (v.error) return cannotRun("dispatcher roadmap show --json did not answer: " + String(v.error.message).split("\n")[0]);
    let doc;
    try { doc = JSON.parse(v.out); } catch (e) { return cannotRun("dispatcher roadmap show --json printed no JSON"); }
    if (!doc.candidates || typeof doc.candidates !== "object") return broken("the roadmap document carries no candidates key");
    const r = await api("/api/roadmap");
    if (r.status !== 200) return broken("GET /api/roadmap answered " + r.status + ": " + String(r.text || "").slice(0, 200));
    const a = shape(r.json);
    const b = shape(doc);
    if (!b) return cannotRun("the dispatcher's document holds no roadmap to compare");
    if (a === b) return held("GET /api/roadmap answered the document's " + doc.roadmaps.length + " roadmaps and their milestones while it carries candidates " + JSON.stringify(doc.candidates));
    last = "route " + a.slice(0, 250) + " | verb " + b.slice(0, 250);
  }
  return broken("three reads in a row disagree: " + last);
});
