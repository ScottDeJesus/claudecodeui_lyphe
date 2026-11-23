// A screen reached from the app's own navigation is reached from whatever screen the walk stands on: with Settings
// open, a walk that next opens roadmap from the Places menu reaches it, at phone and at desktop, and runs every step.
//
// protects: /home/lyphe/.claude/hooks/web_walk/node/, walk/app.mjs, walk/screens.toml
// writes: none

import { spawnSync } from "node:child_process";
import fs from "node:fs";

import { api } from "../lib/app.mjs";
import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const WEB_WALK = "/home/lyphe/.claude/scripts/web-walk";
const WALK = { app: "cloudcli", sizes: ["phone", "desktop"], timeout_ms: 100000, steps: [{ open: "settings" }, { open: "roadmap" }] };
const lastLine = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";

runCase(async (t) => {
  if (!fs.existsSync(WEB_WALK)) return broken(`${WEB_WALK} is not on disk`);
  await api("/api/user/preferences"); // the server answers, or the case CANNOT RUN
  const out = await scratchDir(t, "walk-settings-then-place");
  const env = { ...process.env };
  delete env.WEB_WALK_OUT; delete env.WEB_WALK_APPS; delete env.WEB_WALK_PICTURE_BYTES;
  const ran = spawnSync(WEB_WALK, ["run", "-", "--out", out], { input: JSON.stringify(WALK), encoding: "utf8", env, timeout: 110000, maxBuffer: 64 << 20 });
  if (ran.error) return broken(`web-walk run did not end: ${ran.error.message}`);
  let answer;
  try { answer = JSON.parse(lastLine(ran.stdout)); } catch { return broken(`exit ${ran.status}, last line not an answer: ${lastLine(ran.stdout).slice(0, 160)}`); }
  if (answer.fault?.kind === "app-down") return cannotRun(`the app is down: ${answer.fault.why}`);
  if (answer.fault) return broken(`fault ${answer.fault.kind}: ${answer.fault.why}`);
  const failed = answer.failed ?? [];
  if (failed.length) return broken(failed.map((f) => `${f.variant} step ${f.step} (${f.kind}): ${f.why}`).join("; ").slice(0, 500));
  if (answer.ok !== true || (answer.variants ?? []).length !== 2) return broken(`ok ${answer.ok}, variants ${JSON.stringify(answer.variants)}`);
  return held(`settings then roadmap reached at ${answer.variants.join(" and ")}`);
});
