// A candidate's acts go by its word (rnd-area phase 5, interface G): waiting has Spike and Reject; spiking has Open chat,
// Spike again and Reject; proved has Adopt, Spike again and Reject; rejected has Bring back; an adopted one has none, being the
// roadmap's now. Each act is a Button marked data-rnd-act; the shared ones (Reject, Spike again) are named once and placed by
// reference. The English words file says the six labels as the design does.
//
// CandidateOpening.tsx is read as text, comments left out, and cut at each word's branch; nothing is imported or run.
//
// protects: src/modules/rnd/CandidateOpening.tsx, src/modules/i18n/locales/en/common.json
// writes: none

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FILE = path.join(REPO, "src/modules/rnd/CandidateOpening.tsx");
const EN = "src/modules/i18n/locales/en/common.json" === "" ? null : path.join(REPO, "src/modules/i18n/locales/en/common.json");
const WANT = {
  waiting: ["spike", "reject"],
  spiking: ["open-chat", "spike-again", "reject"],
  proved: ["adopt", "spike-again", "reject"],
  rejected: ["reopen"],
};
const LABELS = { spike: "Spike", reject: "Reject", openChat: "Open chat", spikeAgain: "Spike again", adopt: "Adopt", reopen: "Bring back" };

const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function lookup(tree, key) {
  let node = tree;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object" || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

runCase(async () => {
  let text;
  try {
    text = code(await readFile(FILE, "utf8"));
  } catch {
    return broken("src/modules/rnd/CandidateOpening.tsx is not on disk");
  }
  const wrong = [];
  const named = {};
  for (const m of text.matchAll(/const\s+(\w+)\s*=\s*\(\s*<Button\b[^>]*?data-rnd-act="([\w-]+)"/g)) named[m[1]] = m[2];
  const end = text.indexOf("<Opening");
  const marks = Object.keys(WANT).map((word) => [word, text.indexOf("if (candidate.word === '" + word + "')")]);
  for (const [word, at] of marks) if (at < 0) wrong.push("no branch for a " + word + " candidate");
  if (wrong.length > 0) return broken(wrong.join("; "));
  marks.sort((a, b) => a[1] - b[1]);
  marks.forEach(([word, at], i) => {
    const stop = i + 1 < marks.length ? marks[i + 1][1] : (end > at ? end : text.length);
    const seg = text.slice(at, stop);
    const acts = new Set([...seg.matchAll(/data-rnd-act="([\w-]+)"/g)].map((m) => m[1]));
    for (const m of seg.matchAll(/\{(\w+)\}/g)) if (named[m[1]]) acts.add(named[m[1]]);
    const got = [...acts].sort().join(",");
    const want = [...WANT[word]].sort().join(",");
    if (got !== want) wrong.push("a " + word + " candidate offers [" + got + "], not [" + want + "] (the last branch also holds the adopted fall-through)");
  });
  if (EN) {
    let tree = null;
    try {
      tree = JSON.parse(await readFile(EN, "utf8"));
    } catch (error) {
      wrong.push("the English words file would not read: " + String(error.message || error).slice(0, 80));
    }
    if (tree && !("rnd" in tree) && path.basename(EN) === "rnd.json") tree = { rnd: tree };
    if (tree) {
      for (const [key, label] of Object.entries(LABELS)) {
        const got = lookup(tree, "rnd.act." + key);
        if (got !== label) wrong.push("rnd.act." + key + " reads " + JSON.stringify(got) + ", not " + JSON.stringify(label));
      }
    }
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("waiting: Spike, Reject; spiking: Open chat, Spike again, Reject; proved: Adopt, Spike again, Reject; rejected: Bring back; adopted: none" + (EN ? "; the six labels read so in English" : ""));
});
