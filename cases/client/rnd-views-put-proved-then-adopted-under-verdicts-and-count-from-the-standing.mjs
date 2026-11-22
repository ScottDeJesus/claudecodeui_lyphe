// The place's four views (rnd-area phase 5, interface G): a SegmentedControl of Waiting (waiting), Spiking (spiking), Verdicts
// (proved, then adopted) and Rejected (rejected), with their counts. rndWords.ts says it once: RND_VIEWS is the order, rowsOf a
// view's rows in the picture's own order (newest first) with a two-word view's first word first, countOf a view's count read
// from the picture's standing at the view's first word (Verdicts wears the proved alone; the adopted are counted on their own
// rule under them), never counted from the rows the client holds.
//
// rndWords.ts is transpiled with the repo's TypeScript and run with formatRelativeTime stubbed; nothing else is imported.
//
// protects: src/modules/rnd/rndWords.ts
// writes: none

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
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

const cand = (name, word) => ({
  name, title: name, what: "", why: "", question: "", source_url: "https://example.org/" + name, source: null, word,
  filed_at: "2026-11-01T00:00:00Z", filed_by: null, scout: null, spike: null, verdict: null, rejected: null, adopted: null,
});

runCase(async () => {
  let words;
  try {
    words = await loadWords();
  } catch (error) {
    return broken("rndWords.ts would not load: " + String(error.message || error).split("\n")[0].slice(0, 160));
  }
  if (words.other) return cannotRun("rndWords.ts now imports " + words.other + ", which this case does not stub");
  const { RND_VIEWS, rowsOf, countOf } = words;
  if (!Array.isArray(RND_VIEWS) || typeof rowsOf !== "function" || typeof countOf !== "function") return broken("rndWords.ts exports no RND_VIEWS, rowsOf or countOf");
  const picture = {
    generated_at: "2026-11-21T00:00:00Z",
    settings: { web_search: true, weekly: null, sources: [] },
    scout: { out: null, last: null },
    standing: { waiting: 7, spiking: 1, proved: 6, adopted: 3, rejected: 4 },
    candidates: [cand("a", "adopted"), cand("b", "proved"), cand("c", "waiting"), cand("d", "proved"), cand("e", "rejected"), cand("f", "spiking"), cand("g", "adopted")],
  };
  const wrong = [];
  if (RND_VIEWS.join(",") !== "waiting,spiking,verdicts,rejected") wrong.push("the views are " + RND_VIEWS.join(","));
  const rows = { waiting: "c", spiking: "f", verdicts: "b,d,a,g", rejected: "e" };
  const counts = { waiting: 7, spiking: 1, verdicts: 6, rejected: 4 };
  for (const view of Object.keys(rows)) {
    const got = rowsOf(picture, view).map((c) => c.name).join(",");
    if (got !== rows[view]) wrong.push(view + " holds [" + got + "], not [" + rows[view] + "]");
    const n = countOf(picture, view);
    if (n !== counts[view]) wrong.push(view + " counts " + n + ", not " + counts[view] + " from the standing");
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("views waiting, spiking, verdicts, rejected; verdicts holds b,d (proved) then a,g (adopted); counts 7, 1, 6, 4 from the standing, verdicts the proved alone");
});
