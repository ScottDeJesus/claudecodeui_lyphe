// The header's line about the scout (rnd-area phase 5, interface G: its last run, what it filed, the weekly time, a SignalLoop
// while one is out). scoutLine says the first that holds: one is out; there is nothing for one to read; none has gone out; the
// last one ended without an answer (lost or failed, said as a word for a badge); the last one filed something (with the count);
// the last one found nothing new. The out line says how many of the run's source scouts are read (rnd.scout.outRun, read of
// total); every run carries its source scouts and its ranker (the run shape since the scouts-run choice, 1f5ca56f).
// Its weekly line says the installed expression through the caller's words, or that none is.
// Every key it hands to t() is in the English words file.
//
// rndWords.ts is transpiled with the repo's TypeScript and run with formatRelativeTime stubbed and t() echoing its key.
//
// protects: src/modules/rnd/rndWords.ts, src/modules/i18n/locales/en/common.json, src/shared/rnd-types.ts
// writes: none

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EN = "src/modules/i18n/locales/en/common.json" === "" ? null : path.join(REPO, "src/modules/i18n/locales/en/common.json");
const require = createRequire(path.join(REPO, "package.json"));

async function loadWords() {
  const ts = require("typescript");
  const text = await readFile(path.join(REPO, "src/modules/rnd/rndWords.ts"), "utf8");
  const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const stubbed = "const formatRelativeTime = (at) => 'ago(' + at + ')';\n" + js.replace(/^import\s[^;]*from\s*['"]@\/shared\/utils['"];?\s*$/gm, "");
  const other = /^import\s[^;]*from\s*['"]([^'"]+)['"]/m.exec(stubbed);
  if (other) return { other: other[1] };
  return await import("data:text/javascript;base64," + Buffer.from(stubbed).toString("base64"));
}

const said = [];
const t = (key, options) => { said.push(key); return options ? key + JSON.stringify(options) : key; };
const weeklyWords = (expression) => "W(" + expression + ")";
const SOURCE = { url: "https://example.org/feed", label: "feed", added_at: "2026-11-01T00:00:00Z" };
const OUT = {
  id: 9, launch: "L9", trigger: "now", started_at: "2026-11-21T06:30:00Z",
  scouts: [
    { source: "https://example.org/feed", state: "ended", outcome: "done" },
    { source: "https://www.example.com/news", state: "waiting", outcome: null },
  ],
  ranker: { state: "waiting", outcome: null },
};
const last = (outcome, filed) => ({ id: 8, launch: "L8", trigger: "weekly", started_at: "2026-11-17T06:30:00Z", ended_at: "2026-11-17T06:50:00Z", scouts: [], ranker: { state: "ended", outcome }, outcome, filed });
const picture = (out, sources, lastRun, weekly) => ({
  generated_at: "2026-11-21T07:00:00Z",
  settings: { web_search: true, weekly, sources },
  scout: { out, last: lastRun },
  standing: { waiting: 0, spiking: 0, proved: 0, adopted: 0, rejected: 0 },
  candidates: [],
});

function lookup(tree, key) {
  let node = tree;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object" || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

runCase(async () => {
  let words;
  try {
    words = await loadWords();
  } catch (error) {
    return broken("rndWords.ts would not load: " + String(error.message || error).split("\n")[0].slice(0, 160));
  }
  if (words.other) return cannotRun("rndWords.ts now imports " + words.other + ", which this case does not stub");
  if (typeof words.scoutLine !== "function") return broken("rndWords.ts exports no scoutLine");
  const wrong = [];
  const cases = [
    ["one out", picture(OUT, [], last("done", 2), "30 6 * * 1"), "rnd.scout.outRun", true, null],
    ["no sources", picture(null, [], last("done", 2), "30 6 * * 1"), "rnd.scout.noSources", false, null],
    ["never run", picture(null, [SOURCE], null, null), "rnd.scout.never", false, null],
    ["last lost", picture(null, [SOURCE], last("lost", 0), null), "rnd.scout.lastTrouble", false, "rnd.scout.outcome.lost"],
    ["last failed", picture(null, [SOURCE], last("failed", 0), null), "rnd.scout.lastTrouble", false, "rnd.scout.outcome.failed"],
    ["filed three", picture(null, [SOURCE], last("done", 3), "30 6 * * 1"), "rnd.scout.lastFiled", false, null],
    ["found nothing", picture(null, [SOURCE], last("done", 0), null), "rnd.scout.lastNothing", false, null],
  ];
  for (const [label, pic, line, out, trouble] of cases) {
    const got = words.scoutLine(pic, t, weeklyWords);
    if (!String(got.line).startsWith(line)) wrong.push(label + " says " + got.line + ", not " + line);
    if (got.out !== out) wrong.push(label + " has out " + got.out);
    if (got.trouble !== trouble) wrong.push(label + " has trouble " + got.trouble);
    if (label === "filed three" && !String(got.line).includes('"filed":3')) wrong.push("the filed line carries no count of 3: " + got.line);
    if (label === "one out" && !(String(got.line).includes('"read":1') && String(got.line).includes('"total":2'))) wrong.push("the out line does not say 1 of 2 sources read: " + got.line);
    if (label === "one out" && typeof got.scouts !== "string") wrong.push("the out run's scouts are not said: " + got.scouts);
    if (label !== "one out" && got.scouts !== null) wrong.push(label + " says scouts for a run with none: " + got.scouts);
    const weekly = pic.settings.weekly === null ? "rnd.scout.noWeekly" : 'rnd.scout.weekly{"when":"W(30 6 * * 1)"}';
    if (got.weekly !== weekly) wrong.push(label + " says the weekly as " + got.weekly);
  }
  if (EN) {
    let tree = null;
    try {
      tree = JSON.parse(await readFile(EN, "utf8"));
    } catch (error) {
      wrong.push("the English words file would not read");
    }
    if (tree && !("rnd" in tree) && path.basename(EN) === "rnd.json") tree = { rnd: tree };
    if (tree) for (const key of new Set(said)) if (lookup(tree, key) === undefined && lookup(tree, key + "_other") === undefined) wrong.push(key + " is not in the English words file");
  }
  if (wrong.length > 0) return broken(wrong.slice(0, 8).join("; "));
  return held("out (1 of 2 sources read), no sources, never, lost/failed, filed 3, nothing new each said first in turn; the loop only while out; weekly said or none" + (EN ? "; " + new Set(said).size + " keys all in English" : ""));
});
