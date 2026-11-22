// protects: server/modules/dispatcher/dispatcher-plan.reader.ts, server/modules/dispatcher/dispatcher-state.transport.ts, server/shared/types.ts, src/shared/types.ts
// writes: none
// The house's status document of today carries no decided or open_gaps on a plan and no ruling on a phase. CloudCLI's dispatcher
// reader learns those keys before the house says them (walks-decide-themselves, phase 3), so a document without them is still read,
// each absent key reading as an empty list or null. The plans are today's own, read from the live dispatcher status --json (read
// only) with the three keys taken out, so the case holds whichever side lands first.

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
  const folder: string = await scratchDir(t, "plan-without-new-keys");
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  let document: any;
  try { document = await dispatcherJson(["status", "--json"]); } catch (error) { return cannotRun("dispatcher status --json did not answer: " + firstLine(error)); }
  const plans: any[] = Array.isArray(document?.plans) ? document.plans : [];
  if (plans.length === 0) return cannotRun("today's status document holds no plan to read");
  const reader: any = await import("../../server/modules/dispatcher/dispatcher-plan.reader.ts");
  const wrong: string[] = [];
  let read = 0;
  for (const original of plans) {
    const plan = JSON.parse(JSON.stringify(original));
    delete plan.decided;
    delete plan.open_gaps;
    for (const phase of Array.isArray(plan.phases) ? plan.phases : []) delete phase.ruling;
    let got: any = null;
    try { got = reader.planOf(plan); } catch (error) { wrong.push(plan.name + " was refused: " + firstLine(error)); }
    if (got) {
      read += 1;
      if (!Array.isArray(got.decided) || got.decided.length !== 0) wrong.push(plan.name + " reads decided " + JSON.stringify(got.decided));
      if (!Array.isArray(got.open_gaps) || got.open_gaps.length !== 0) wrong.push(plan.name + " reads open_gaps " + JSON.stringify(got.open_gaps));
      const off = (got.phases ?? []).find((phase: any) => phase.ruling !== null);
      if (off) wrong.push(plan.name + " phase " + off.key + " reads ruling " + JSON.stringify(off.ruling));
    }
    if (wrong.length >= 3) break;
  }
  if (wrong.length > 0) return broken(wrong.slice(0, 3).join("; "));
  return held(read + " plans of today's status document, without decided, open_gaps or ruling, read with decided [], open_gaps [] and every phase's ruling null");
});
