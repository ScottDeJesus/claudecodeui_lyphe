// protects: server/modules/rnd/rnd-state.service.ts, src/shared/rnd-types.ts, /home/lyphe/.claude/hooks/dispatcher/rnd_report.py, /home/lyphe/.claude/hooks/dispatcher/store_rnd_measure.py, /home/lyphe/.claude/hooks/dispatcher/rnd_readings.py
// writes: none
//
// The R&D screen's candidates carry their measure (rnd-adopted-measures, phases 7 and 10): what GET /api/rnd says of an
// adopted candidate's measure is the says and promised of the row dispatcher rnd readings --json holds for it, and null
// where that feature has none; the legacy scan's, written live in phase 7, is not null, so its Opening says its measure.
// Both are read from the live store; the case changes nothing.
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { api } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const BIN = path.join(os.homedir(), ".claude", "scripts", "dispatcher");
const CAND = "modern-web-guidance-legacy-scan-flag-outdated-web-patterns-i";

function readings() {
  return new Promise((resolve) => {
    execFile(BIN, ["rnd", "readings", "--json"], { cwd: os.homedir(), timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve({ error: String(error.message).split("\n")[0] });
      const last = String(stdout).trim().split("\n").pop() || "";
      try { resolve({ data: JSON.parse(last) }); } catch { resolve({ error: "its last line is not JSON" }); }
    });
  });
}

runCase(async () => {
  const r = await api("/api/rnd");
  if (r.status !== 200) return broken("GET /api/rnd answered " + r.status + ": " + String(r.text || "").slice(0, 160));
  const doc = r.json && Array.isArray(r.json.candidates) ? r.json : r.json && r.json.data;
  const candidates = doc && Array.isArray(doc.candidates) ? doc.candidates : null;
  if (!candidates) return broken("GET /api/rnd holds no candidates list");
  const v = await readings();
  if (v.error) return cannotRun("dispatcher rnd readings --json did not answer: " + v.error);
  const byName = new Map((v.data.features || []).map((f) => [f.candidate, f]));
  const wrong = [];
  const adopted = candidates.filter((c) => c && c.adopted);
  for (const c of adopted) {
    const f = byName.get(c.name);
    if (!f) { wrong.push(c.name + ": adopted on the screen, absent from the readings"); continue; }
    if (!("measure" in c.adopted)) { wrong.push(c.name + ": adopted carries no measure key"); continue; }
    const want = f.measure ? { says: f.measure.says, promised: f.measure.promised } : null;
    if (JSON.stringify(c.adopted.measure) !== JSON.stringify(want)) wrong.push(c.name + ": adopted.measure " + JSON.stringify(c.adopted.measure) + ", readings " + JSON.stringify(want));
  }
  const legacy = adopted.find((c) => c.name === CAND);
  if (!legacy) wrong.push(CAND + " is not an adopted candidate on the screen");
  else if (!legacy.adopted.measure) wrong.push(CAND + "'s adopted.measure is null");
  if (wrong.length) return broken(wrong.join("; "));
  return held(adopted.length + " adopted candidate(s) agree with the readings; the legacy scan's says " + JSON.stringify(legacy.adopted.measure.says));
});
