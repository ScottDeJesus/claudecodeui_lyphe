// protects: /home/lyphe/.claude/scripts/legacy-scan, /home/lyphe/.claude/hooks/legacy_scan/measure.py, /home/lyphe/.claude/hooks/legacy_scan/runner.py, /home/lyphe/.claude/hooks/dispatcher/rnd_readings.py
// writes: none
//
// The legacy scan's measure is the run of an adopted feature's [measure] row, and dispatcher rnd readings runs it on every
// read of Analytics → R&D, killing it at MEASURE_TIMEOUT_S = 20. The design's contract for a run: it only reads, ends
// within 20 seconds and is cheap. Measured 2026-11-25 on this 12-core box at load 20–26, it took 14.5, 19.8 (exit 2,
// "ran past 19.4983s" on the CloudCLI tree) and 18.8 s, and one readings run showed the feature failed. The case runs
// it three times, one after the other, and judges each run: exit 0, a last line that is one JSON object holding a finite
// value, and done within 10 s, half the kill, so the reading still lands on a busy box.
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const BIN = path.join(os.homedir(), ".claude", "scripts", "legacy-scan");
const LIMIT_MS = 10000;

function once() {
  return new Promise((resolve) => {
    const start = Date.now();
    execFile(BIN, ["measure", "eis-app"], { cwd: os.homedir(), timeout: 40000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const ms = Date.now() - start;
      if (error && error.code === "ENOENT") return resolve({ missing: true });
      const last = String(stdout).trim().split("\n").pop() || "";
      let value = null;
      try { const o = JSON.parse(last); if (typeof o.value === "number" && Number.isFinite(o.value)) value = o.value; } catch {}
      resolve({ ms, code: error ? (error.code ?? "killed") : 0, value, said: String(stderr).trim().split("\n").pop() || "" });
    });
  });
}

runCase(async () => {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const r = await once();
    if (r.missing) return cannotRun("legacy-scan is not at " + BIN);
    runs.push(r);
  }
  const shown = runs.map((r) => (r.ms / 1000).toFixed(1) + " s exit " + r.code + (r.value === null ? "" : " value " + r.value)).join(", ");
  const bad = runs.filter((r) => r.code !== 0 || r.value === null || r.ms > LIMIT_MS);
  if (bad.length) {
    const said = bad.map((r) => r.said).filter(Boolean)[0];
    return broken(bad.length + " of 3 measure runs failed or ran past 10 s: " + shown + (said ? " — " + said.slice(0, 200) : ""));
  }
  return held("3 measure runs, each exit 0 within 10 s: " + shown);
});
