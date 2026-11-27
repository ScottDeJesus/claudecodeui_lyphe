// THE ROWS SAY THE MOMENT, NOT THE INTERVAL. The red watch plans on hints and at one computed instant, and a node goes
// silent on its own timer; the rows that document them (MAN-9205, MAN-10047, INV-10187 for the red watch, MAN-7814 for
// the link registry) say so, and nothing of the 60-second tick or the 5-second silence look is left in them.
//
// Read only, through the docstore door; nothing is written.
//
// protects: server/modules/cerberus/red-watch.service.ts, server/modules/cerberus/red-watch-plan.ts, server/modules/cerberus/warden-links.ts
// writes: none

import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const DOCSTORE = path.join(os.homedir(), ".claude/scripts/docstore");
const RED_WATCH = ["MAN-9205", "MAN-10047", "INV-10187"];
const REGISTRY = "MAN-7814";
const OLD = [
  /TICK_INTERVAL_MS/, /SILENCE_CHECK_INTERVAL_MS/, /ensureSilenceTimer/, /\bsilenceTimer\b/, /\btickTimer\b/,
  /\b(a|one) tick a minute\b/i, /\bonce a minute\b/i, /\bevery minute\b(?! for nothing)/i, /\bone a minute\b/i,
  /\bevery (5|five) ?s(econds?)?\b/i, /\b(5|five)[- ]second (interval|look|check|timer|sweep)/i,
  /\b(60|sixty)[- ]second (tick|interval|clock|timer)/i, /\b60 ?s tick\b/i, /\bminute(ly)? tick\b/i,
];

runCase(async () => {
  const text = {};
  for (const token of [...RED_WATCH, REGISTRY]) {
    try {
      text[token] = execFileSync(DOCSTORE, ["get", token, "--text"], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      if (error?.code === "ENOENT") return cannotRun("the docstore door is not at " + DOCSTORE);
      if (error?.status === 2) return broken(token + " is refused by the door (retired or unknown): " + String(error.stderr ?? "").split("\n")[0]);
      return cannotRun("docstore get " + token + " would not answer: " + String(error?.message ?? error).split("\n")[0]);
    }
  }
  const wrong = [];
  for (const [token, body] of Object.entries(text)) {
    for (const re of OLD) {
      const m = body.match(re);
      if (m) wrong.push(token + " still says " + JSON.stringify(body.slice(Math.max(0, m.index - 40), m.index + m[0].length + 30).replace(/\s+/g, " ")));
    }
  }
  if (!RED_WATCH.some((token) => text[token].includes("next plan at"))) wrong.push("no red-watch row names the '[red-watch] next plan at' line");
  if (!text[REGISTRY].includes("armSilence")) wrong.push(REGISTRY + " does not name armSilence");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("the four rows name no tick or interval; a red-watch row names '[red-watch] next plan at'; MAN-7814 names armSilence");
});
