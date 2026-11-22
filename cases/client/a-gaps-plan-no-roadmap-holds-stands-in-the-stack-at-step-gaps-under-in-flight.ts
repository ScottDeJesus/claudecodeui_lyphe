// protects: src/modules/roadmap/utils/stackLayout.ts, src/shared/roadmap-types.ts, server/modules/dispatcher/dispatcher-plan.reader.ts
// writes: none
// The house may call a plan gaps: every task done while a gap ticket one of them finished with stays open (report.status_word,
// walks-decide-themselves). Its roadmap reading keeps the word in flight and gives the step gaps (report_roadmap). A plan no roadmap
// holds is drawn in the stack through featureOfPlan, which reads the roadmap's words off the dispatcher's by that same table, so a
// gaps plan must stand there at in flight / gaps, never fall through to a designing step such as accept. Today's own status document
// (dispatcher status --json, read only) gives a complete, loaded plan; the case moves it to gaps and lays it out alone.

import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const BIN = path.join(os.homedir(), ".claude", "scripts", "dispatcher");
const firstLine = (error: unknown): string => String((error as Error)?.message ?? error).split("\n")[0];

/** One read-only dispatcher verb whose stdout is JSON. */
function dispatcherJson(args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    execFile(BIN, args, { cwd: os.homedir(), timeout: 60000, maxBuffer: 128 * 1024 * 1024 }, (error, stdout) => {
      if (error) return reject(error);
      try { resolve(JSON.parse(String(stdout))); } catch { reject(new Error("dispatcher " + args.join(" ") + " printed no JSON")); }
    });
  });
}

/** Every laid-out feature (an object carrying both a word and a step) under the stack's tiers. */
function featuresIn(value: unknown, seen = new Set<object>(), found: any[] = []): any[] {
  if (value === null || typeof value !== "object" || seen.has(value)) return found;
  seen.add(value);
  if ("word" in value && "step" in value) found.push(value);
  for (const key of Object.keys(value)) featuresIn((value as any)[key], seen, found);
  return found;
}

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const folder: string = await scratchDir(t, "stack-step-gaps");
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  let document: any;
  try { document = await dispatcherJson(["status", "--json"]); } catch (error) { return cannotRun("dispatcher status --json did not answer: " + firstLine(error)); }
  const raw = (document?.plans ?? []).find((plan: any) => plan.status === "complete" && plan.state === "loaded" && (plan.phases ?? []).length > 0);
  if (!raw) return cannotRun("today's status document holds no complete, loaded plan to move to gaps");
  const { planOf } = await import("../../server/modules/dispatcher/dispatcher-plan.reader.ts");
  const { layoutStack } = await import("../../src/modules/roadmap/utils/stackLayout.ts");
  const gap = { task: raw.phases[0].title, title: "a finding that stood at the ceiling", ticket: 1, priority: "high" };
  let plan: any;
  try { plan = { ...planOf({ ...raw, status: "gaps", open_gaps: [gap] }), session_app_id: null }; } catch (error) { return broken("the dispatcher reader refused a gaps plan: " + firstLine(error)); }
  const features = featuresIn(layoutStack([plan], null));
  if (features.length === 0) return cannotRun("layoutStack laid out no feature for " + raw.name);
  const feature = features[0];
  if (feature.word === "in flight" && feature.step === "gaps") return held(raw.name + " as gaps, held by no roadmap, stands in the stack at in flight / gaps");
  return broken(raw.name + " as gaps, held by no roadmap, stands in the stack at " + feature.word + " / " + feature.step + ", not in flight / gaps");
});
