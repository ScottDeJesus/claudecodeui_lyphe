// protects: src/modules/project-workspace/places/PlacesWheel.tsx, src/shared/types.ts
// writes: none
//
// The wheel's outer ring with R&D on it (rnd-area phase 6, interface G): the SLOT map reads home 0, station 1, roadmap 2, bugs 3,
// chat 4 on the inner ring and rnd 0, cerberus 1, inbox 2, api 3, universe 4, schedules 5, settings 6 on the outer; the outer
// bearings are 0, 51.4, 102.9, 154.3, 205.7, 257.1, 308.6 at the desk and 0, 22.3, 44.6, 66.9, -66.9, -44.6, -22.3 on the fan,
// and the outer ring's half is 25.7 at the desk and 11.1 on the fan, so seven sectors fit and none overlaps its neighbour.
//
// Read as source, each piece by the shape it is written in today; a reshaped declaration is a change to how this case finds
// it, never to what it checks.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);

const body = (text, pattern) => {
  const found = text.match(pattern);
  return found ? found[1] : null;
};
const literals = (text) => Array.from(text.matchAll(/'([^']+)'/g), (m) => m[1]);
const numbers = (text) => (text ?? "").split(",").map((part) => part.trim()).filter((part) => part !== "").map(Number);
const SLOT = { home: 0, station: 1, roadmap: 2, bugs: 3, chat: 4, rnd: 0, cerberus: 1, inbox: 2, api: 3, universe: 4, schedules: 5, settings: 6 };
const DESK = [0, 51.4, 102.9, 154.3, 205.7, 257.1, 308.6];
const FAN = [0, 22.3, 44.6, 66.9, -66.9, -44.6, -22.3];

runCase(async () => {
  let wheel;
  let types;
  try {
    [wheel, types] = await Promise.all([W("places/PlacesWheel.tsx"), readFile(path.join(REPO, "src/shared/types.ts"), "utf8")]);
  } catch (error) {
    return broken("a file of the wheel is not on disk: " + String(error.message).split("\n")[0]);
  }
  const wrong = [];
  const slotText = body(wheel, /const SLOT[^=]*=\s*\{([^}]*)\}/);
  if (slotText === null) return broken("PlacesWheel.tsx declares no SLOT map");
  const slot = Object.fromEntries(Array.from(slotText.matchAll(/([\w$]+):\s*(\d+)/g), (m) => [m[1], Number(m[2])]));
  for (const [id, n] of Object.entries(SLOT)) if (slot[id] !== n) wrong.push("SLOT." + id + " is " + slot[id] + ", not " + n);
  for (const id of Object.keys(slot)) if (!(id in SLOT)) wrong.push("SLOT names " + id + ", no place of the wheel");
  const placeIds = literals(body(types, /export type PlaceId =([^;]+);/) ?? "").sort();
  if (placeIds.join(",") !== Object.keys(SLOT).sort().join(",")) wrong.push("PlaceId is [" + placeIds.join(",") + "], not the wheel's twelve");
  const desk = numbers(body(wheel, /const DESK_OUTER\s*=\s*\[([^\]]*)\]/));
  const fan = numbers(body(wheel, /const FAN_OUTER\s*=\s*\[([^\]]*)\]/));
  if (desk.join(",") !== DESK.join(",")) wrong.push("DESK_OUTER is [" + desk.join(", ") + "]");
  if (fan.join(",") !== FAN.join(",")) wrong.push("FAN_OUTER is [" + fan.join(", ") + "]");
  const halves = Object.fromEntries(Array.from(wheel.matchAll(/outer:\s*\{[^}]*?half:\s*([\d.]+)[^}]*?mids:\s*(\w+)/g), (m) => [m[2], Number(m[1])]));
  if (halves.DESK_OUTER !== 25.7) wrong.push("the desk's outer half is " + halves.DESK_OUTER + ", not 25.7");
  if (halves.FAN_OUTER !== 11.1) wrong.push("the fan's outer half is " + halves.FAN_OUTER + ", not 11.1");
  for (const [label, mids, half] of [["desk", desk, halves.DESK_OUTER], ["fan", fan, halves.FAN_OUTER]]) {
    if (typeof half !== "number" || mids.length === 0) continue;
    const round = mids.map((a) => ((a % 360) + 360) % 360).sort((a, b) => a - b);
    for (let i = 0; i < round.length; i += 1) {
      const gap = i + 1 < round.length ? round[i + 1] - round[i] : round[0] + 360 - round[i];
      if (gap < 2 * half - 0.05) wrong.push("on the " + label + " the outer sectors at " + round[i] + " and the next overlap (gap " + gap.toFixed(1) + " < " + (2 * half).toFixed(1) + ")");
    }
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("outer ring rnd 0 … settings 6 at desk " + DESK.join("/") + " (half 25.7) and fan " + FAN.join("/") + " (half 11.1), no overlap; SLOT names the twelve PlaceIds");
});

function W(rel) {
  return readFile(path.join(REPO, "src/modules/project-workspace/" + rel), "utf8");
}
