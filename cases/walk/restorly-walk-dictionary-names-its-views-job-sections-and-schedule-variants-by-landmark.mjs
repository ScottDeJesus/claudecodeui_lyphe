// Restorly's walk dictionary as it stands: [app] mark is data-screen-label with a light or dark theme; job (needs job,
// seeding eis-selected-job from {job}), no-job and the views each landmarked by a mark; the six job sections from job;
// the schedule variants by #sched= or a seed; no key names a position; and web-walk screens restorly lists every entry.
//
// protects: /opt/eis-app/walk/screens.toml
// writes: none

import fs from "node:fs";

import { broken, held, runCase } from "../lib/case.mjs";
import { webWalk } from "../lib/web_walk.mjs";

const DICTIONARY = "/opt/eis-app/walk/screens.toml";
const VIEWS = ["job", "no-job", "schedule", "control", "vendors", "insurance", "uploads"];
const SECTIONS = ["job-coordination", "job-work", "job-carrier", "job-money", "job-file", "job-activity"];
const VARIANTS = ["day", "agenda", "all", "empty", "subs", "focus", "map"];
const POSITION = /(^|[{,]\s*)(css|xpath|nth|index)\s*=/m;

runCase(async () => {
  const text = fs.readFileSync(DICTIONARY, "utf8");
  const parts = text.split(/^\[screen\.([^\]]+)\]\s*$/m);
  const screens = new Map();
  for (let at = 1; at < parts.length; at += 2) screens.set(parts[at], parts[at + 1]);
  const wrong = [];
  if (!/^mark\s*=\s*"data-screen-label"/m.test(parts[0])) wrong.push("[app] mark is not data-screen-label");
  if (!/^theme\s*=\s*"(light|dark)"/m.test(parts[0])) wrong.push("[app] theme is not light or dark");
  const job = screens.get("job") ?? "";
  if (!/needs\s*=\s*\["job"\]/.test(job) || !/"eis-selected-job"\s*=\s*"\{job\}"/.test(job)) wrong.push("job does not need job and seed eis-selected-job from it");
  for (const name of VIEWS) if (!/^landmark\s*=\s*\{\s*mark\s*=/m.test(screens.get(name) ?? "")) wrong.push(name + " is not landmarked by a mark");
  for (const name of SECTIONS) if (!/^from\s*=\s*"job"/m.test(screens.get(name) ?? "")) wrong.push(name + " is not from job");
  for (const name of VARIANTS) if (!/sched=|^seed\./m.test(screens.get(name) ?? "")) wrong.push(name + " is not a schedule load by #sched= or a seed");
  if (POSITION.test(text)) wrong.push("a key names a position: " + text.match(POSITION)[0]);
  const listed = await webWalk(["screens", "restorly"]);
  const names = listed.stdout.split("\n").filter(Boolean).map((line) => line.split(" — ")[0]);
  const unlisted = [...screens.keys()].filter((name) => !names.includes(name));
  if (listed.status !== 0 || unlisted.length) wrong.push("web-walk screens restorly (exit " + listed.status + ") does not list " + (unlisted.join(", ") || listed.stderr.trim()));
  if (wrong.length) return broken(wrong.join("; "));
  return held(screens.size + " entries: the views by mark, six job sections from job, seven schedule variants by #sched= or a seed, no position; the loader lists every one");
});
