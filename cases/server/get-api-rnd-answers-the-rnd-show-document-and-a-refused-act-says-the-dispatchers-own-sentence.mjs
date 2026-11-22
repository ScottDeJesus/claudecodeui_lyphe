// protects: server/modules/rnd/rnd-state.service.ts, server/modules/rnd/rnd.routes.ts, server/modules/rnd/rnd.module.ts, /home/lyphe/.claude/hooks/dispatcher/rnd_report.py, /home/lyphe/.claude/hooks/dispatcher/cmd/rnd.py, /home/lyphe/.claude/hooks/dispatcher/rnd_acts.py
// writes: none
// The relay joined to the dispatcher: the lane's picture is the R&D document (generated_at aside), read again (three times at
// most) before a difference is a break, and a write the dispatcher refuses is answered 409 with the dispatcher's own sentence.
// The refused act names a candidate no row holds, so neither door writes anything.
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { api } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const BIN = path.join(os.homedir(), ".claude", "scripts", "dispatcher");
const NOBODY = "no-such-candidate-athena-case";

function verb(args) {
  return new Promise((resolve) => {
    execFile(BIN, args, { cwd: os.homedir(), timeout: 60000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => resolve({ error: error, out: String(stdout || "") }));
  });
}
function picture(d) {
  const s = d.settings || {};
  const scout = d.scout || {};
  return JSON.stringify({
    standing: d.standing,
    rows: (d.candidates || []).map((c) => c.name + "=" + c.word),
    web: s.web_search,
    weekly: s.weekly,
    sources: (s.sources || []).map((x) => x.url),
    out: scout.out ? scout.out.id : null,
    last: scout.last ? scout.last.id + "/" + scout.last.outcome + "/" + scout.last.filed : null,
  });
}

runCase(async () => {
  let last = "";
  let agreed = null;
  for (let turn = 0; turn < 3 && !agreed; turn += 1) {
    const r = await api("/api/rnd");
    if (r.status !== 200 || !r.json || !r.json.standing) return broken("GET /api/rnd answered " + r.status + ": " + String(r.text || "").slice(0, 200));
    const v = await verb(["rnd", "show", "--json"]);
    if (v.error) return cannotRun("dispatcher rnd show --json did not answer: " + String(v.error.message).split("\n")[0]);
    let doc;
    try { doc = JSON.parse(v.out); } catch (e) { return cannotRun("dispatcher rnd show --json printed no JSON"); }
    if (picture(r.json) === picture(doc)) agreed = picture(doc);
    else last = "route " + picture(r.json).slice(0, 300) + " | verb " + picture(doc).slice(0, 300);
  }
  if (!agreed) return broken("three reads in a row, GET /api/rnd and dispatcher rnd show --json disagree: " + last);

  const cli = await verb(["rnd", "reopen", NOBODY]);
  const sentence = cli.out.trim().split("\n").filter(Boolean).pop() || "";
  if (!cli.error || !sentence) return cannotRun("dispatcher rnd reopen " + NOBODY + " did not refuse in a sentence (exit " + (cli.error ? cli.error.code : 0) + ")");
  const route = await api("/api/rnd/candidates/" + NOBODY + "/reopen", { method: "POST", body: {} });
  if (route.status !== 409) return broken("POST /api/rnd/candidates/" + NOBODY + "/reopen answered " + route.status + " (" + String(route.text || "").slice(0, 160) + "), not 409 with the dispatcher's sentence");
  if (String(route.text || "").indexOf(sentence) === -1) return broken("the 409 says " + String(route.text).slice(0, 200) + ", not the dispatcher's own " + JSON.stringify(sentence));
  return held("GET /api/rnd is dispatcher rnd show --json: " + agreed.slice(0, 220) + "; a refused reopen answered 409 with " + JSON.stringify(sentence));
});
