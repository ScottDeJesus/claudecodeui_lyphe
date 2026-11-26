// protects: server/modules/analytics/sections/rnd.ts, server/modules/analytics/sections/verb.ts
// writes: none
//
// The server's R&D reader (rnd-adopted-measures, phase 5) over a scratch dispatcher: a bash script in a scratch folder
// that records the arguments it was run with and prints one readings document on its last stdout line, after a line of
// noise. Handed a whole document (a read row naming a section, a none row, a failed row), the reader runs exactly
// rnd readings --json, whatever days it is asked for, and answers the document key for key, computing nothing. Handed a
// document with a key of the wrong type or a word the dispatcher never prints, it throws one sentence naming that key,
// so a document the screen cannot read never reaches it. The scratch folder is removed at the end.
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const READER = path.join(REPO, "server/modules/analytics/sections/rnd.ts");
const PREFIX = path.join(os.tmpdir(), "case-rnd-reader-");

const measure = (section: string | null) => ({ says: "Outdated patterns standing", promised: "41 findings (spike)", baseline: 41, unit: "patterns", better: "lower", section, set_at: "2026-11-25T10:00:00Z", set_by: "athena" });
const row = (over: Record<string, unknown>) => ({ candidate: "c", plan: "p", title: "T", epic: null, word: "idea", adopted_at: "2026-11-25T09:00:00Z", measure: null, state: "none", reading: null, fault: null, ...over });
const GOOD = {
  generated_at: "2026-11-25T12:00:00Z",
  features: [
    row({ candidate: "a", plan: "a", epic: "e", word: "shipped", measure: measure("web-walk"), state: "read", reading: { value: 12, detail: "cloudcli 3 standing", against: "better" } }),
    row({ candidate: "b", plan: "b" }),
    row({ candidate: "c", plan: "c", word: null, measure: measure(null), state: "failed", fault: "it exited 1: no such frontend" }),
  ],
};
const clone = () => JSON.parse(JSON.stringify(GOOD));
const BAD: [string, string, () => unknown][] = [
  ["a reading value that is a string", "value", () => { const d = clone(); d.features[0].reading.value = "12"; return d; }],
  ["a state the dispatcher never prints", "state", () => { const d = clone(); d.features[1].state = "pending"; return d; }],
  ["a better that is neither lower nor higher", "better", () => { const d = clone(); d.features[0].measure.better = "down"; return d; }],
  ["no features list", "features", () => { const d = clone(); delete d.features; return d; }],
];

function canon(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canon).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canon((value as any)[k])).join(",") + "}";
  return JSON.stringify(value === undefined ? "<absent>" : value);
}

const first = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0];

runCase(async () => {
  let reader: any;
  try { reader = await import(pathToFileURL(READER).href); } catch (e) { return broken("sections/rnd.ts would not load: " + first(e)); }
  if (typeof reader.createRndReader !== "function") return broken("sections/rnd.ts exports no createRndReader");
  const dir = await mkdtemp(PREFIX);
  try {
    const bin = path.join(dir, "dispatcher");
    await writeFile(bin, '#!/bin/bash\nprintf "%s\\n" "$@" > "$(dirname "$0")/argv"\necho "a line before the document"\ncat "$(dirname "$0")/doc.json"\n');
    await chmod(bin, 0o755);
    const read = reader.createRndReader(bin);
    await writeFile(path.join(dir, "doc.json"), JSON.stringify(GOOD) + "\n");
    const wrong: string[] = [];
    let answer: unknown;
    try { answer = await read(7); } catch (e) { return broken("the reader threw on a whole document: " + first(e)); }
    const argv = (await readFile(path.join(dir, "argv"), "utf8")).trim().split("\n");
    if (JSON.stringify(argv) !== JSON.stringify(["rnd", "readings", "--json"])) wrong.push("it ran the dispatcher with " + JSON.stringify(argv) + ", not rnd readings --json");
    if (canon(answer) !== canon(GOOD)) wrong.push("its answer is not the document key for key: " + canon(answer).slice(0, 300));
    for (const [what, key, make] of BAD) {
      await writeFile(path.join(dir, "doc.json"), JSON.stringify(make()) + "\n");
      try {
        const got = await read(7);
        wrong.push("a document with " + what + " was answered, not refused: " + canon(got).slice(0, 120));
      } catch (e) {
        const said = String((e as Error)?.message ?? e);
        if (/\n/.test(said.trim()) || !said.includes(key)) wrong.push("a document with " + what + " threw " + JSON.stringify(said.slice(0, 160)) + ", not one sentence naming " + key);
      }
    }
    if (wrong.length > 0) return broken(wrong.join("; "));
    return held("ran rnd readings --json for days 7, carried 3 rows (read, none, failed) key for key, and refused " + BAD.length + " misshapen documents each with one sentence naming its key");
  } finally {
    if (dir.startsWith(PREFIX)) await rm(dir, { recursive: true, force: true });
  }
});
