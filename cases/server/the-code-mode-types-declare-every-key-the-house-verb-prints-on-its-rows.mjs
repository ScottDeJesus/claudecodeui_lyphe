// protects: server/shared/analytics-types.ts, src/shared/analytics-types.ts, /home/lyphe/.claude/hooks/plan_runner/code_mode/analytics.py, /home/lyphe/.claude/hooks/plan_runner/code_mode/faults.py
// writes: none
// The seam between the house verb and the screen's types: interface E says CodeModeAnalytics and its rows are the
// verb's object "key for key as the verb prints it". The route carries the verb's object unchanged, so a route-vs-verb
// comparison can never see a key the types forgot; this case reads the verb's rows against both types files.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const BIN = path.join(os.homedir(), ".claude", "scripts", "code-mode");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SIDES = ["server/shared/analytics-types.ts", "src/shared/analytics-types.ts"];

function verb() {
  return new Promise((resolve) => {
    execFile(BIN, ["analytics", "--days", "30"], { cwd: os.homedir(), timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve({ error: String(error.message).split("\n")[0] });
      const last = String(stdout).trim().split("\n").pop() || "";
      try { resolve({ data: JSON.parse(last) }); } catch { resolve({ error: "its last line is not JSON" }); }
    });
  });
}

function fields(body) {
  return new Set([...body.matchAll(/(?:^|[;{])\s*(?:readonly\s+)?(\w+)\??\s*:/gm)].map((m) => m[1]));
}

function declared(text, name) {
  const m = text.match(new RegExp("export (?:type|interface) " + name + "\\b[^{]*?(\\w+\\s*&\\s*)?\\{([\\s\\S]*?)\\n?\\};?\\s*(?:\\n|$)"));
  if (!m) return null;
  const own = fields(m[2]);
  const base = m[1] ? declared(text, m[1].replace(/[\s&]/g, "")) : null;
  return base ? new Set([...base, ...own]) : own;
}

function keysOf(rows) {
  const out = new Set();
  for (const r of rows) if (r && typeof r === "object") for (const k of Object.keys(r)) out.add(k);
  return out;
}

runCase(async () => {
  const v = await verb();
  if (v.error) return cannotRun("code-mode analytics --days 30 did not answer: " + v.error);
  const d = v.data;
  const printed = {
    CodeModeGroup: keysOf(d.groups || []),
    CodeModeDay: keysOf(d.series || []),
    CodeModeCause: keysOf(d.causes || []),
    CodeModeFaultTotals: keysOf([d.faults || {}]),
  };
  if (!printed.CodeModeGroup.size || !printed.CodeModeDay.size) return cannotRun("the verb printed no groups or series row to judge (empty history)");
  const missing = [];
  for (const side of SIDES) {
    const text = readFileSync(path.join(ROOT, side), "utf8");
    for (const [name, keys] of Object.entries(printed)) {
      const have = declared(text, name);
      if (!have) return cannotRun(side + " declares no " + name + " the case can read");
      const gone = [...keys].filter((k) => !have.has(k));
      if (gone.length) missing.push(side + " " + name + " lacks " + JSON.stringify(gone));
    }
  }
  if (missing.length) return broken("the verb prints keys the screen's types do not declare: " + missing.join("; "));
  return held("both analytics-types.ts declare every key the verb prints on " + d.groups.length + " groups, " + d.series.length + " series rows, " + (d.causes || []).length + " causes and the faults totals");
});
