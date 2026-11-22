// protects: src/modules/dispatcher/PlanFace.tsx, src/modules/dispatcher/PlanDecided.tsx
// writes: none
//
// The feature card's face mounts the "Decided for you" list once, above its events fold (walks-decide-themselves,
// phase 5): PlanFace.tsx imports PlanDecided from the dispatcher module and draws one <PlanDecided> before the
// Collapsible that carries data-dispatcher-events, so the list sits above the feed wherever the face is drawn.
//
// The files are read as text, comments left out; nothing is imported or run.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FACE = path.join(REPO, "src/modules/dispatcher/PlanFace.tsx");
const PIECE = path.join(REPO, "src/modules/dispatcher/PlanDecided.tsx");
const IMPORT = /import\s*(?:\{[^}]*\bPlanDecided\b[^}]*\}|PlanDecided)\s*from\s*['"](?:@\/modules\/dispatcher\/PlanDecided|\.\/PlanDecided)['"]/;

const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

runCase(async () => {
  let face;
  try {
    face = code(await readFile(FACE, "utf8"));
  } catch {
    return broken("src/modules/dispatcher/PlanFace.tsx is not on disk");
  }
  const wrong = [];
  if (!existsSync(PIECE)) wrong.push("src/modules/dispatcher/PlanDecided.tsx is not on disk");
  if (!IMPORT.test(face)) wrong.push("PlanFace.tsx does not import PlanDecided from the dispatcher module");
  const mounts = [...face.matchAll(/<PlanDecided\b/g)].map((m) => m.index);
  if (mounts.length !== 1) wrong.push("PlanFace.tsx draws <PlanDecided> " + mounts.length + " times, not once");
  const events = face.indexOf("data-dispatcher-events");
  const fold = events === -1 ? -1 : face.lastIndexOf("<Collapsible", events);
  if (fold === -1) wrong.push("PlanFace.tsx has no events fold (a Collapsible carrying data-dispatcher-events)");
  else if (mounts.length === 1 && mounts[0] > fold) wrong.push("<PlanDecided> is drawn after the events fold, not above it");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("PlanFace.tsx imports PlanDecided and draws it once, at offset " + mounts[0] + ", before the events fold at " + fold);
});
