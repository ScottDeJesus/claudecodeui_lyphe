// Restorly's walk adapter and dictionary hold no address, port, token or job id; and reach under a scratch registry whose
// base sits outside the kit's origin list is refused with the sign-in words naming the kit's own origins, never reached.
//
// protects: /opt/eis-app/walk/app.mjs, /opt/eis-app/walk/screens.toml, /home/lyphe/.claude/hooks/web_walk/apps.toml
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";
import { webWalk } from "../lib/web_walk.mjs";

const REGISTRY = "/home/lyphe/.claude/hooks/web_walk/apps.toml";
const FILES = ["/opt/eis-app/walk/app.mjs", "/opt/eis-app/walk/screens.toml"];
const FORBIDDEN = [
  ["an address", /\bhttps?:\/\/|\b127\.0\.0\.\d+\b|\blocalhost\b/],
  ["a port", /:\d{4,5}\b/],
  ["a token", /\beyJ[\w-]{10,}|\b[A-Za-z0-9_-]{40,}\b/],
  ["a job id", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
];
const OFF_BASE = "http://127.0.0.2:5190";
const REFUSED = /^not reached\s+no-job: .*not one of the kit's origins \(([^)]+)\)/m;

runCase(async (t) => {
  const wrong = [];
  for (const file of FILES) {
    const text = fs.readFileSync(file, "utf8");
    for (const [what, pattern] of FORBIDDEN) {
      const hit = text.match(pattern);
      if (hit) wrong.push(path.basename(file) + " holds " + what + ": " + hit[0]);
    }
  }
  const registry = fs.readFileSync(REGISTRY, "utf8");
  const [head, row = ""] = registry.split("[app.restorly]");
  const moved = row.replace(/^base = "[^"]*"/m, 'base = "' + OFF_BASE + '"');
  if (moved === row) return broken("the house registry's restorly row names no base");
  const scratch = path.join(await scratchDir(t, "off-origin"), "apps.toml");
  fs.writeFileSync(scratch, head + "[app.restorly]" + moved);
  const ran = await webWalk(["reach", "restorly", "no-job"], { env: { WEB_WALK_APPS: scratch } });
  if (ran.error) return broken("web-walk reach did not end: " + ran.error.message);
  if (/did not answer at/.test(ran.stderr)) return cannotRun("nothing answers at " + OFF_BASE + ": " + ran.stderr.trim().split("\n").pop());
  const refused = ran.stdout.match(REFUSED);
  if (!refused) wrong.push("reach at " + OFF_BASE + " was not refused with the kit's origins: " + (ran.stdout.trim() || ran.stderr.trim()).slice(0, 300));
  if (wrong.length) return broken(wrong.join("; "));
  return held("neither file holds an address, port, token or job id; reach at " + OFF_BASE + " refused, naming the kit's origins " + refused[1]);
});
