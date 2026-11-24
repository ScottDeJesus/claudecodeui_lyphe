// A real job read from Restorly's own API (the adapter's provide), given as the default of a scratch registry that
// copies the live restorly row: web-walk reach restorly reaches every entry of the dictionary, the job screen and its six
// sections included.
//
// protects: /opt/eis-app/walk/screens.toml, /opt/eis-app/walk/app.mjs, /home/lyphe/.claude/hooks/web_walk/apps.toml, /home/lyphe/.claude/hooks/web_walk/node/
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";
import { webWalk } from "../lib/web_walk.mjs";

const REGISTRY = "/home/lyphe/.claude/hooks/web_walk/apps.toml";
const ADAPTER = "/opt/eis-app/walk/app.mjs";
const DEFAULTS = "[app.restorly.defaults]\n";
const MUST_REACH = ["job", "job-coordination", "job-work", "job-carrier", "job-money", "job-file", "job-activity"];

runCase(async (t) => {
  const text = fs.readFileSync(REGISTRY, "utf8");
  const api = (text.split("[app.restorly]")[1] ?? "").match(/^api\s*=\s*"([^"]+)"/m)?.[1];
  if (!api || !text.includes(DEFAULTS)) return broken("the house registry's restorly row names no api or no defaults table");
  const { provide } = await import(ADAPTER);
  let job;
  try {
    job = await provide("job", { api });
  } catch (error) {
    return cannotRun("no real job could be read from Restorly's own API: " + error.message);
  }
  if (!job) return cannotRun("Restorly's job list holds no job");
  const registry = path.join(await scratchDir(t, "reach-registry"), "apps.toml");
  fs.writeFileSync(registry, text.replace(DEFAULTS, DEFAULTS + 'job = "' + job.value + '"\n'));
  const env = { WEB_WALK_APPS: registry };
  const listed = await webWalk(["screens", "restorly"], { env });
  const names = listed.stdout.split("\n").filter(Boolean).map((line) => line.split(" — ")[0]);
  const ran = await webWalk(["reach", "restorly"], { env });
  if (ran.error) return cannotRun("web-walk reach restorly did not end: " + ran.error.message);
  if (/did not answer at/.test(ran.stderr)) return cannotRun("Restorly is down: " + ran.stderr.trim().split("\n").pop());
  const lines = ran.stdout.split("\n").filter((line) => line.trim());
  const reached = lines.filter((line) => line.startsWith("reached ")).map((line) => line.split(/\s+/)[1]);
  const others = lines.filter((line) => !line.startsWith("reached "));
  const unreached = [...new Set([...names, ...MUST_REACH])].filter((name) => !reached.includes(name));
  if (ran.status !== 0 || others.length || unreached.length) {
    return broken("exit " + ran.status + "; not reached: " + (unreached.join(", ") || "none") + "; " + others.slice(0, 3).join(" | ").slice(0, 600));
  }
  return held("all " + reached.length + " screens reached with job " + job.value + ", the job screen and its six sections included");
});
