// protects: server/shared/analytics-types.ts, src/shared/analytics-types.ts, /home/lyphe/.claude/hooks/heal_repeats/answer.py
// writes: none
// The repeats seam's types: RepeatsAnalytics is typed in server/shared/analytics-types.ts and src/shared/analytics-types.ts,
// edited together, matching the reading object field for field. This case reads the live heal-repeats reading --days 30
// answer against RepeatsAnalytics and every Repeats* type it names, recursing through totals, steps, series, families and
// each family's rows: a key the command prints that the types lack, or a required key a printed row lacks, is a break;
// and every Repeats* declaration must read the same on both sides. A shape with no row in the window is named, not judged.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const BIN = path.join(os.homedir(), ".claude", "scripts", "heal-repeats");
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SIDES = ["server/shared/analytics-types.ts", "src/shared/analytics-types.ts"];
const OPEN = "{[(<";
const CLOSE = "}])>";

function verb() {
  return new Promise((resolve) => {
    execFile(BIN, ["reading", "--days", "30"], { cwd: os.homedir(), timeout: 120000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve({ error: String(error.message).split("\n")[0] });
      const last = String(stdout).trim().split("\n").pop() || "";
      try { resolve({ data: JSON.parse(last) }); } catch { resolve({ error: "its last line is not JSON" }); }
    });
  });
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function declarations(text) {
  const out = {};
  const clean = stripComments(text);
  const re = /export\s+type\s+(Repeats\w*)\s*=\s*/g;
  let m;
  while ((m = re.exec(clean))) {
    let depth = 0;
    let j = re.lastIndex;
    for (; j < clean.length; j += 1) {
      const c = clean[j];
      if (OPEN.includes(c)) depth += 1;
      else if (CLOSE.includes(c)) depth -= 1;
      else if (c === ";" && depth === 0) break;
    }
    out[m[1]] = clean.slice(re.lastIndex, j).trim();
  }
  return out;
}

function members(body) {
  const inner = body.trim().replace(/^\{/, "").replace(/\}$/, "");
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let j = 0; j < inner.length; j += 1) {
    const c = inner[j];
    if (OPEN.includes(c)) depth += 1;
    else if (CLOSE.includes(c)) depth -= 1;
    else if ((c === ";" || c === ",") && depth === 0) { parts.push(inner.slice(from, j)); from = j + 1; }
  }
  parts.push(inner.slice(from));
  const out = {};
  for (const part of parts) {
    const m = /^\s*(\w+)(\?)?\s*:\s*([\s\S]*)$/.exec(part);
    if (m) out[m[1]] = { optional: Boolean(m[2]), type: m[3].trim() };
  }
  return out;
}

function judge(values, type, where, decls, found, seen) {
  let t = type.replace(/\|\s*null\b/g, "").replace(/\bnull\s*\|/g, "").trim();
  if (t.startsWith("(") && t.endsWith(")")) t = t.slice(1, -1).trim();
  if (t.endsWith("[]")) return judge(values.flatMap((v) => (Array.isArray(v) ? v : [])), t.slice(0, -2), where + "[]", decls, found, seen);
  if (decls[t]) return judge(values, decls[t], t, decls, found, seen);
  if (!t.startsWith("{")) return;
  const objects = values.filter((v) => v && typeof v === "object" && !Array.isArray(v));
  if (!objects.length) { seen.unjudged.push(where); return; }
  seen.judged += 1;
  const declared = members(t);
  const printed = new Set(objects.flatMap((o) => Object.keys(o)));
  for (const key of printed) if (!(key in declared)) found.push(where + " lacks " + key + ", which the command prints");
  for (const [key, m] of Object.entries(declared)) {
    if (!m.optional && objects.some((o) => !(key in o))) found.push(where + " requires " + key + ", which a printed row lacks");
    judge(objects.map((o) => o[key]), m.type, where + "." + key, decls, found, seen);
  }
}

runCase(async () => {
  const decls = [];
  for (const side of SIDES) {
    let text;
    try { text = readFileSync(path.join(REPO, side), "utf8"); } catch { return broken(side + " is not on disk"); }
    const d = declarations(text);
    if (!d.RepeatsAnalytics) return broken(side + " declares no RepeatsAnalytics");
    decls.push(d);
  }
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const names = [...new Set([...Object.keys(decls[0]), ...Object.keys(decls[1])])].sort();
  const differ = names.filter((n) => norm(decls[0][n]) !== norm(decls[1][n]));
  if (differ.length) return broken("the two analytics-types.ts files differ on " + differ.join(", "));
  const v = await verb();
  if (v.error) return cannotRun("heal-repeats reading --days 30 did not answer: " + v.error);
  const found = [];
  const seen = { judged: 0, unjudged: [] };
  judge([v.data], "RepeatsAnalytics", "RepeatsAnalytics", decls[0], found, seen);
  if (found.length) return broken(found.length + " differences between the types and the command: " + found.slice(0, 6).join("; "));
  const families = Array.isArray(v.data.families) ? v.data.families.length : 0;
  return held("both sides declare the same " + names.length + " Repeats types; " + seen.judged + " shapes of the live 30-day answer (" + families + " families) match them key for key" + (seen.unjudged.length ? "; no row to judge for " + seen.unjudged.join(", ") : ""));
});
