// protects: server/modules/dispatcher/dispatcher-plan.reader.ts, server/modules/dispatcher/dispatcher-state.transport.ts, server/shared/types.ts, src/shared/types.ts
// writes: none
// The house's status JSON (report.plan_dict, walks-decide-themselves) may say a plan finished with a gap (status gaps), list what was
// decided for the operator (decided) and the gaps still open, each with why it needs him (open_gaps), and mark a phase waiting on the designer (ruling asked).
// CloudCLI's dispatcher reader carries all four through, key for key. The plan is one of today's own (live dispatcher status --json,
// read only) with the four written onto a copy; nothing is written anywhere.

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
  const folder: string = await scratchDir(t, "plan-with-new-keys");
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  let document: any;
  try { document = await dispatcherJson(["status", "--json"]); } catch (error) { return cannotRun("dispatcher status --json did not answer: " + firstLine(error)); }
  const original = (Array.isArray(document?.plans) ? document.plans : []).find((p: any) => Array.isArray(p.phases) && p.phases.length >= 2);
  if (!original) return cannotRun("today's status document holds no plan with two phases");
  const plan = JSON.parse(JSON.stringify(original));
  const title: string = plan.phases[0].title;
  const decided = [
    { id: 7, at: "2026-11-21T10:00:00Z", task: title, by: "builder", what: "which table holds the rows", choice: "a new table", why: "nothing else holds them", undo: "drop the table" },
    { id: 8, at: "2026-11-21T11:00:00Z", task: null, by: "rule", what: "B1 came back unchanged", choice: "the finding stands", why: "it came back unchanged after your answer", undo: "rule it again" },
  ];
  const openGaps = [{ task: title, title: "the card does not refresh after a ruling", ticket: 4242, priority: "high", needs_you: "2 fix rounds did not close this gap; the builder's last report says: the refresh needs the board's event" }];
  plan.status = "gaps";
  plan.decided = decided;
  plan.open_gaps = openGaps;
  plan.phases.forEach((phase: any, index: number) => { if (index === 0) phase.ruling = "asked"; else delete phase.ruling; });
  const reader: any = await import("../../server/modules/dispatcher/dispatcher-plan.reader.ts");
  let got: any;
  try { got = reader.planOf(plan); } catch (error) { return broken("a plan reading gaps with decided, open_gaps and a ruling was refused: " + firstLine(error)); }
  const wrong: string[] = [];
  if (got.status !== "gaps") wrong.push("status reads " + JSON.stringify(got.status));
  if (JSON.stringify(canon(got.decided)) !== JSON.stringify(canon(decided))) wrong.push("decided reads " + JSON.stringify(got.decided).slice(0, 300));
  if (JSON.stringify(canon(got.open_gaps)) !== JSON.stringify(canon(openGaps))) wrong.push("open_gaps reads " + JSON.stringify(got.open_gaps).slice(0, 300));
  if (got.phases?.[0]?.ruling !== "asked") wrong.push("phase " + plan.phases[0].key + " reads ruling " + JSON.stringify(got.phases?.[0]?.ruling));
  const off = (got.phases ?? []).slice(1).find((phase: any) => phase.ruling !== null);
  if (off) wrong.push("phase " + off.key + " (no ruling key) reads ruling " + JSON.stringify(off.ruling));
  if (wrong.length > 0) return broken(plan.name + ": " + wrong.join("; "));
  return held(plan.name + " read as gaps with its two decided rows and one open gap key for key, phase " + plan.phases[0].key + " asked and the other " + (plan.phases.length - 1) + " null");
});
