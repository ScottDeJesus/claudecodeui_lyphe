// protects: server/modules/roadmap/roadmap-state.service.ts, server/modules/roadmap/roadmap.routes.ts, /home/lyphe/.claude/hooks/dispatcher/report_roadmap.py, /home/lyphe/.claude/hooks/dispatcher/store_rnd.py, /home/lyphe/.claude/hooks/dispatcher/cmd/roadmap.py
// writes: none
// The roadmap's readers after the document gained its key: CloudCLI's GET /api/roadmap still answers, and the document it
// carries holds the candidates standing the dispatcher prints, the same four counts, read again (three times at most)
// before a difference is a break, since a scout may file between the two reads.
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { api } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const BIN = path.join(os.homedir(), ".claude", "scripts", "dispatcher");
const WORDS = ["waiting", "spiking", "proved", "rejected"];

function verb(args) {
  return new Promise((resolve) => {
    execFile(BIN, args, { cwd: os.homedir(), timeout: 60000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => resolve({ error: error, out: String(stdout || "") }));
  });
}

/** The first candidates standing found in the answer, its own key or under one wrapper. */
function standingIn(value, depth) {
  if (!value || typeof value !== "object" || depth > 4) return null;
  const c = value.candidates;
  if (c && typeof c === "object" && !Array.isArray(c) && WORDS.every((w) => typeof c[w] === "number")) return c;
  for (const v of Object.values(value)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const found = standingIn(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}
const pick = (s) => WORDS.map((w) => w + "=" + s[w]).join(" ");

runCase(async () => {
  let last = "";
  for (let turn = 0; turn < 3; turn += 1) {
    const r = await api("/api/roadmap");
    if (r.status !== 200) return broken("GET /api/roadmap answered " + r.status + ": " + String(r.text || "").slice(0, 200));
    const route = standingIn(r.json, 0);
    if (!route) return broken("GET /api/roadmap answered 200 with no candidates standing {" + WORDS.join(", ") + "}; its keys " + JSON.stringify(Object.keys(r.json || {})).slice(0, 200));
    const v = await verb(["roadmap", "show", "--json"]);
    if (v.error) return cannotRun("dispatcher roadmap show --json did not answer: " + String(v.error.message).split("\n")[0]);
    let doc;
    try { doc = JSON.parse(v.out); } catch (e) { return cannotRun("dispatcher roadmap show --json printed no JSON"); }
    if (!standingIn(doc, 0)) return broken("dispatcher roadmap show --json carries no candidates standing");
    const face = await verb(["roadmap", "show"]);
    const line = face.out.split("\n").find((l) => /dispatcher rnd show/.test(l));
    if (!line) return broken("dispatcher roadmap show prints no line naming dispatcher rnd show");
    const a = pick(route);
    const b = pick(doc.candidates);
    const counted = WORDS.every((w) => new RegExp("\\b" + doc.candidates[w] + " " + w + "\\b").test(line));
    if (a === b && counted) return held("GET /api/roadmap and dispatcher roadmap show agree: " + a + "; the text face says: " + line.trim());
    last = "route " + a + ", verb " + b + ", text line " + JSON.stringify(line.trim());
  }
  return broken("three reads in a row disagree: " + last);
});
