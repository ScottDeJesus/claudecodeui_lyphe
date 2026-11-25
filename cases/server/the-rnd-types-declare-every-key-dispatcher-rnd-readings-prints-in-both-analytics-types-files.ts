// protects: server/shared/analytics-types.ts, src/shared/analytics-types.ts, /home/lyphe/.claude/hooks/dispatcher/cmd/rnd.py, /home/lyphe/.claude/hooks/dispatcher/rnd_readings.py
// writes: none
//
// The R&D section's types (rnd-adopted-measures, phase 5) are written in BOTH analytics-types.ts files, key for key as
// dispatcher rnd readings --json prints. The case reads the four type blocks of each file as text (comments left out):
// they are the same in both files, and each declares exactly the keys of its part of the document. The top level and a
// feature row are judged against the live document; a measure and a reading against the live rows that hold one, and,
// where the live store holds none yet, against the keys the readings document is defined with (says, promised, baseline,
// unit, better, section, set_at, set_by; value, detail, against).
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SERVER_TYPES = path.join(REPO, "server/shared/analytics-types.ts");
const CLIENT_TYPES = path.join(REPO, "src/shared/analytics-types.ts");
const BIN = path.join(os.homedir(), ".claude", "scripts", "dispatcher");
const DEFINED: Record<string, string[]> = {
  RndMeasure: ["says", "promised", "baseline", "unit", "better", "section", "set_at", "set_by"],
  RndReading: ["value", "detail", "against"],
};
const TYPES = ["RndMeasure", "RndReading", "RndFeatureReading", "RndReadingsAnalytics"];

const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function block(text: string, name: string): string | null {
  const start = text.search(new RegExp("export type " + name + "\\s*=\\s*\\{"));
  if (start < 0) return null;
  const open = text.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    if (text[i] === "}") { depth -= 1; if (depth === 0) return text.slice(open + 1, i); }
  }
  return null;
}

const keysOf = (body: string) => [...body.matchAll(/(?:^|[;{,\n])\s*([A-Za-z_]\w*)\??\s*:/g)].map((m) => m[1]).sort();

function verb(): Promise<any> {
  return new Promise((resolve) => {
    execFile(BIN, ["rnd", "readings", "--json"], { cwd: os.homedir(), timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve({ error: String(error.message).split("\n")[0] });
      try { resolve({ data: JSON.parse(String(stdout).trim().split("\n").pop() || "") }); } catch { resolve({ error: "its last line is not JSON" }); }
    });
  });
}

const union = (rows: any[]) => [...new Set(rows.flatMap((r) => Object.keys(r)))].sort();

runCase(async () => {
  const texts: Record<string, string> = {};
  for (const [side, file] of [["server", SERVER_TYPES], ["client", CLIENT_TYPES]]) {
    try { texts[side] = code(await readFile(file, "utf8")); } catch { return broken(file + " is not on disk"); }
  }
  const v = await verb();
  if (v.error) return cannotRun("dispatcher rnd readings --json did not answer: " + v.error);
  const doc = v.data;
  const features: any[] = Array.isArray(doc && doc.features) ? doc.features : [];
  const measures = features.map((f) => f.measure).filter((m) => m && typeof m === "object");
  const readings = features.map((f) => f.reading).filter((r) => r && typeof r === "object");
  const want: Record<string, string[]> = {
    RndReadingsAnalytics: Object.keys(doc || {}).sort(),
    RndFeatureReading: features.length ? union(features) : ["adopted_at", "candidate", "epic", "fault", "measure", "plan", "reading", "state", "title", "word"],
    RndMeasure: measures.length ? union(measures) : [...DEFINED.RndMeasure].sort(),
    RndReading: readings.length ? union(readings) : [...DEFINED.RndReading].sort(),
  };
  const wrong: string[] = [];
  for (const name of TYPES) {
    const server = block(texts.server, name);
    const client = block(texts.client, name);
    if (server === null) { wrong.push("server/shared/analytics-types.ts declares no " + name); continue; }
    if (client === null) { wrong.push("src/shared/analytics-types.ts declares no " + name); continue; }
    if (server.replace(/\s+/g, " ").trim() !== client.replace(/\s+/g, " ").trim()) wrong.push(name + " differs between the two files");
    const got = keysOf(server);
    const missing = want[name].filter((k) => !got.includes(k));
    const extra = got.filter((k) => !want[name].includes(k));
    if (missing.length || extra.length) wrong.push(name + " lacks " + JSON.stringify(missing) + " and adds " + JSON.stringify(extra));
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("the four Rnd types are the same in both files and declare the document's keys: " + TYPES.map((n) => n + " " + want[n].length).join(", ") + " (live rows with a measure " + measures.length + ", with a reading " + readings.length + ")");
});
