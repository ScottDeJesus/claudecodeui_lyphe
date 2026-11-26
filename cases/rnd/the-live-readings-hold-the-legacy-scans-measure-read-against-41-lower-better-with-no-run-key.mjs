// protects: /home/lyphe/.claude/hooks/dispatcher/rnd_readings.py, /home/lyphe/.claude/hooks/dispatcher/store_rnd_measure.py, /home/lyphe/.claude/hooks/dispatcher/rnd_acts_measure.py, /home/lyphe/.claude/hooks/dispatcher/cmd/rnd.py, /home/lyphe/.claude/scripts/legacy-scan, /home/lyphe/.claude/hooks/legacy_scan/measure.py, /home/lyphe/.claude/hooks/legacy_scan/runner.py
// writes: none
//
// The legacy scan's measure, written live through dispatcher rnd measure (rnd-adopted-measures, phase 7), and read whole:
// the live store's row for the candidate CAND is the design's interface-7 table, and dispatcher rnd readings --json
// takes its reading by running legacy-scan measure eis-app: state read, no fault, a finite value, and against said by
// the dispatcher as lower-is-better against 41. The value moves as the frontend changes, so only its kind and its
// against are judged. The command's run line is never in the document. The case runs the verb in the environment it is
// handed (DISPATCHER_HOME included) and writes nothing; a reading runs a command that writes nothing by its contract.
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const BIN = path.join(os.homedir(), ".claude", "scripts", "dispatcher");
const CAND = "modern-web-guidance-legacy-scan-flag-outdated-web-patterns-i";
const WANT = {
  says: "Outdated web patterns still standing in Restorly's frontend",
  promised: "41 findings over /opt/eis-app/src, 40 of them real (spike, 2026-11-25)",
  baseline: 41, unit: "patterns", better: "lower", section: null,
};

function readings() {
  return new Promise((resolve) => {
    execFile(BIN, ["rnd", "readings", "--json"], { cwd: os.homedir(), timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return resolve({ error: String(error.message).split("\n")[0] + " " + String(stderr).trim().split("\n").pop() });
      const last = String(stdout).trim().split("\n").pop() || "";
      try { resolve({ data: JSON.parse(last) }); } catch { resolve({ error: "its last line is not JSON: " + last.slice(0, 120) }); }
    });
  });
}

function hasRunKey(value) {
  if (Array.isArray(value)) return value.some(hasRunKey);
  if (value && typeof value === "object") return Object.keys(value).some((k) => k === "run" || hasRunKey(value[k]));
  return false;
}

runCase(async () => {
  const got = await readings();
  if (got.error) return cannotRun("dispatcher rnd readings --json did not answer: " + got.error);
  const features = Array.isArray(got.data && got.data.features) ? got.data.features : null;
  if (!features) return broken("the readings document holds no features list");
  if (hasRunKey(got.data)) return broken("the readings document carries a run key");
  const f = features.find((x) => x && x.candidate === CAND);
  if (!f) return broken("no feature of candidate " + CAND + " among " + JSON.stringify(features.map((x) => x && x.candidate)));
  const wrong = [];
  const m = f.measure;
  if (!m || typeof m !== "object") return broken("the legacy scan's feature has no measure (state " + JSON.stringify(f.state) + ")");
  for (const [k, v] of Object.entries(WANT)) if (m[k] !== v) wrong.push("measure." + k + " is " + JSON.stringify(m[k]) + ", not " + JSON.stringify(v));
  if (typeof m.set_at !== "string" || typeof m.set_by !== "string" || !m.set_by) wrong.push("measure.set_at/set_by are " + JSON.stringify([m.set_at, m.set_by]));
  if (f.state !== "read") wrong.push("state is " + JSON.stringify(f.state) + " (fault " + JSON.stringify(f.fault) + "), not read");
  const r = f.reading;
  if (f.state === "read") {
    if (f.fault !== null) wrong.push("a read feature carries fault " + JSON.stringify(f.fault));
    if (!r || typeof r.value !== "number" || !Number.isFinite(r.value)) wrong.push("reading.value is " + JSON.stringify(r && r.value));
    else {
      const want = r.value < 41 ? "better" : r.value === 41 ? "level" : "worse";
      if (r.against !== want) wrong.push("value " + r.value + " against 41, lower better, reads " + JSON.stringify(r.against) + ", not " + want);
    }
  }
  if (wrong.length) return broken(wrong.join("; "));
  return held("the legacy scan's measure is the design's table; read " + r.value + " " + m.unit + " against 41: " + r.against + " (" + (r.detail || "no detail") + ")");
});
