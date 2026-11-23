// protects: server/shared/analytics-types.ts, src/shared/analytics-types.ts, /home/lyphe/.claude/hooks/web_walk/answer.py, /home/lyphe/.claude/hooks/web_walk/settled.py
// writes: none
// The web-walk seam's types: WebWalkAnalytics is typed in server/shared/analytics-types.ts and src/shared/analytics-types.ts,
// edited together, matching the reading object field for field. The route carries the reader's narrowed object, so a
// route-vs-command comparison never sees a key the types forgot; this case reads the command's keys against both files.
// The objects always printed (the answer, settled, its bars, totals, doors, a series day) are judged both ways; the rows
// that may be empty on a quiet box (a check, an app, a screen) carry at least the keys the design names and every key
// the command prints today. The two files must declare the same fields on each of those types.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const BIN = path.join(os.homedir(), ".claude", "scripts", "web-walk");
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SIDES = ["server/shared/analytics-types.ts", "src/shared/analytics-types.ts"];
const NAMED = { WebWalkCheck: ["check", "ran", "false"], WebWalkApp: ["app", "walks", "screens"], screen: ["screen", "opened", "unreached"] };

function verb() {
  return new Promise((resolve) => {
    execFile(BIN, ["reading", "--days", "30"], { cwd: os.homedir(), timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve({ error: String(error.message).split("\n")[0] });
      const last = String(stdout).trim().split("\n").pop() || "";
      try { resolve({ data: JSON.parse(last) }); } catch { resolve({ error: "its last line is not JSON" }); }
    });
  });
}

function bodyOf(text, name) {
  const m = new RegExp("export (?:type|interface) " + name + "\\b[^{;]*\\{").exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  for (; i < text.length && depth > 0; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") depth -= 1;
  }
  return depth === 0 ? text.slice(start, i - 1) : null;
}

function fields(body) {
  return new Set([...body.matchAll(/(?:^|[;{])\s*(?:readonly\s+)?(\w+)\??\s*:/gm)].map((m) => m[1]));
}

function keysOf(rows) {
  const out = new Set();
  for (const r of rows) if (r && typeof r === "object") for (const k of Object.keys(r)) out.add(k);
  return out;
}

runCase(async () => {
  const v = await verb();
  if (v.error) return cannotRun("web-walk reading --days 30 did not answer: " + v.error);
  const d = v.data;
  if (!d || typeof d !== "object" || !d.settled || !d.totals) return cannotRun("web-walk reading printed no answer object with settled and totals");
  const apps = Array.isArray(d.apps) ? d.apps : [];
  const judged = {
    WebWalkAnalytics: { keys: keysOf([d]), exact: true },
    WebWalkSettled: { keys: keysOf([d.settled]), exact: true },
    WebWalkBars: { keys: keysOf([d.settled.bars || {}]), exact: true },
    WebWalkTotals: { keys: keysOf([d.totals]), exact: true },
    WebWalkDoors: { keys: keysOf([d.doors || {}]), exact: true },
    WebWalkDay: { keys: keysOf(d.series || []), exact: true },
    WebWalkCheck: { keys: new Set([...NAMED.WebWalkCheck, ...keysOf(d.checks || [])]), exact: false },
    WebWalkApp: { keys: new Set([...NAMED.WebWalkApp, ...keysOf(apps)]), exact: false },
  };
  const screenKeys = new Set([...NAMED.screen, ...keysOf(apps.flatMap((a) => (Array.isArray(a.screens) ? a.screens : [])))]);
  const wrong = [];
  const seen = {};
  let types = 0;
  for (const side of SIDES) {
    let text;
    try { text = readFileSync(path.join(REPO, side), "utf8"); } catch { wrong.push(side + " is not on disk"); continue; }
    const app = bodyOf(text, "WebWalkApp");
    const named = app ? (app.match(/\bscreens\??\s*:\s*(?:(\w+)\[\]|Array<(\w+)>)/) || []).slice(1).find(Boolean) : undefined;
    const table = { ...judged };
    if (named) table[named] = { keys: screenKeys, exact: false };
    else if (app) wrong.push(side + " WebWalkApp names no row type for its screens");
    seen[side] = {};
    for (const [name, want] of Object.entries(table)) {
      const body = bodyOf(text, name);
      if (body === null) { wrong.push(side + " declares no " + name); continue; }
      types += 1;
      const have = fields(body);
      seen[side][name] = [...have].sort().join(",");
      const lacks = [...want.keys].filter((k) => !have.has(k));
      if (lacks.length) wrong.push(side + " " + name + " lacks " + JSON.stringify(lacks));
      if (want.exact && want.keys.size) {
        const extra = [...have].filter((k) => !want.keys.has(k));
        if (extra.length) wrong.push(side + " " + name + " declares " + JSON.stringify(extra) + ", which the command does not print");
      }
    }
  }
  const [a, b] = SIDES;
  if (seen[a] && seen[b]) {
    for (const name of Object.keys(seen[a])) {
      if (seen[b][name] !== undefined && seen[a][name] !== seen[b][name]) wrong.push("the two files differ on " + name + ": " + seen[a][name] + " | " + seen[b][name]);
    }
  }
  if (wrong.length) return broken(wrong.slice(0, 6).join("; "));
  return held("both analytics-types.ts declare " + types / 2 + " WebWalk types field for field as web-walk reading prints them (" + judged.WebWalkAnalytics.keys.size + " answer keys, " + judged.WebWalkTotals.keys.size + " totals, " + judged.WebWalkBars.keys.size + " bars), the same fields on each side");
});
