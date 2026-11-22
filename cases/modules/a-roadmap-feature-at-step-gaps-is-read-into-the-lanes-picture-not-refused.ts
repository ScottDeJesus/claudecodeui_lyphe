// protects: server/modules/roadmap/roadmap-state.service.ts, server/shared/roadmap-types.ts, src/shared/roadmap-types.ts
// writes: none
// The house's roadmap document may give a feature whose tasks are done but whose gap tickets are open the step gaps, under its word
// in flight (report_roadmap, walks-decide-themselves). The roadmap lane's reader refuses a step outside FEATURE_STEPS and keeps the
// last good picture, so a reader without gaps would freeze the roadmap. Today's own document (live roadmap show --json, read only)
// is printed by a stand-in in this case's scratch folder with one feature moved to gaps.

import { execFile } from "node:child_process";
import { chmod, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const BIN = path.join(os.homedir(), ".claude", "scripts", "dispatcher");
const firstLine = (error: unknown): string => String((error as Error)?.message ?? error).split("\n")[0];

/** One read-only dispatcher verb whose stdout is JSON. */
function dispatcherJson(args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    execFile(BIN, args, { cwd: os.homedir(), timeout: 60000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      if (error) return reject(error);
      try { resolve(JSON.parse(String(stdout))); } catch { reject(new Error("dispatcher " + args.join(" ") + " printed no JSON")); }
    });
  });
}
// Key order is the reader's own; the promise is the keys and their values.
const canon = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(canon)
    : value !== null && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canon((value as any)[k])]))
      : value;

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "roadmap-step-gaps");
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  let document: any;
  try { document = await dispatcherJson(["roadmap", "show", "--json"]); } catch (error) { return cannotRun("dispatcher roadmap show --json did not answer: " + firstLine(error)); }
  let feature: any = null;
  for (const roadmap of document?.roadmaps ?? []) for (const milestone of roadmap.milestones ?? []) for (const epic of milestone.epics ?? []) {
    for (const each of epic.features ?? []) if (!feature) feature = each;
  }
  if (!feature) return cannotRun("today's roadmap document holds no feature under a milestone");
  feature.step = "gaps";
  feature.word = "in flight";
  if ("waiting_on_you" in feature) feature.waiting_on_you = null;
  const file = path.join(folder, "roadmap.json");
  await writeFile(file, JSON.stringify(document));
  const bin = path.join(folder, "dispatcher");
  await writeFile(bin, "#!/bin/sh\ncat '" + file + "'\n");
  await chmod(bin, 0o755);
  const service: any = await import("../../server/modules/roadmap/roadmap-state.service.ts");
  let picture: any;
  try { picture = await service.readRoadmapState({ bin, timeoutMs: 20000, env: { ...process.env } }); } catch (error) {
    return broken("a feature at step gaps made the roadmap reader refuse the document: " + firstLine(error));
  }
  let got: any = null;
  for (const roadmap of picture?.roadmaps ?? []) for (const milestone of roadmap.milestones ?? []) for (const epic of milestone.epics ?? []) {
    for (const each of epic.features ?? []) if (!got && each.name === feature.name) got = each;
  }
  if (!got) return broken("the picture was read but holds no feature " + feature.name);
  if (got.step !== "gaps" || got.word !== "in flight") return broken(feature.name + " reads step " + JSON.stringify(got.step) + " word " + JSON.stringify(got.word));
  return held(feature.name + " at step gaps under in flight is read into the lane's picture as gaps");
});
