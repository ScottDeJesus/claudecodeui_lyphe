// THE SHARED DEADLINE TIMER. server/shared/deadline-timer.ts answers createDeadlineTimer(onDue) -> { arm(at), armedAt(), clear() }:
// at is epoch ms, arm replaces whatever was armed, null clears, a delay past 2,147,483,647 ms is waited out in steps of
// that size (a bare setTimeout past it fires at once), and the timer is unref'd. The red watch's and the warden links'
// clocks stand on it.
//
// One timer armed 200 ms out, twice in a row, with null, cleared, and twice the longest delay out; then a child process
// holding only an armed timer, which must end by itself. Nothing is written but the child's file in the case's scratch.
//
// protects: server/shared/deadline-timer.ts
// writes: none

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const TIMER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/shared/deadline-timer.ts");
const LONGEST_MS = 2_147_483_647;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const firstLine = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0];

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  if (!fs.existsSync(TIMER)) return broken("server/shared/deadline-timer.ts is not on disk");
  let mod: any;
  try {
    mod = await import(TIMER);
  } catch (error) {
    return broken("server/shared/deadline-timer.ts would not load: " + firstLine(error));
  }
  if (typeof mod.createDeadlineTimer !== "function") return broken("server/shared/deadline-timer.ts exports no createDeadlineTimer");

  const fired: number[] = [];
  const timer = mod.createDeadlineTimer(() => fired.push(Date.now()));
  t.defer(() => timer.clear());
  const wrong: string[] = [];
  if (timer.armedAt() !== null) wrong.push("armedAt() before any arm read " + timer.armedAt() + ", not null");

  const at = Date.now() + 200;
  timer.arm(at);
  const armedBefore = timer.armedAt();
  await sleep(450);
  const armedAfter = timer.armedAt();
  if (armedBefore !== at) wrong.push("armedAt() after arm(at) read " + armedBefore + ", not at");
  if (fired.length !== 1) wrong.push("one instant 200 ms out fired " + fired.length + " times in 450 ms");
  else if (fired[0] < at - 1) wrong.push("it fired " + (at - fired[0]) + " ms before its instant");
  if (armedAfter !== null) wrong.push("armedAt() after the firing read " + armedAfter + ", not null");
  const firstSaw = "fired " + fired.length + "x" + (fired.length ? " " + (fired[0] - at) + " ms after its instant" : "") +
    ", armedAt() " + (armedBefore === at ? "the instant" : armedBefore) + " before and " + armedAfter + " after";

  fired.length = 0;
  const earlier = Date.now() + 120;
  const later = Date.now() + 300;
  timer.arm(earlier);
  timer.arm(later);
  if (timer.armedAt() !== later) wrong.push("after two arms armedAt() read " + timer.armedAt() + ", not the second instant");
  await sleep(550);
  if (fired.length !== 1 || fired[0] < later - 1) {
    wrong.push("two arms in a row fired " + fired.length + " times (" + fired.map((f) => f - later).join(", ") + " ms against the second instant), not once at the second");
  }

  fired.length = 0;
  timer.arm(Date.now() + 120);
  timer.arm(null);
  const nulled = timer.armedAt();
  timer.arm(Date.now() + 120);
  timer.clear();
  const cleared = timer.armedAt();
  await sleep(350);
  if (nulled !== null) wrong.push("arm(null) left armedAt() " + nulled);
  if (cleared !== null) wrong.push("clear() left armedAt() " + cleared);
  if (fired.length !== 0) wrong.push("an instant armed then cleared fired " + fired.length + " times");

  fired.length = 0;
  const far = Date.now() + 2 * LONGEST_MS + 5000;
  timer.arm(far);
  await sleep(150);
  if (fired.length !== 0) wrong.push("an instant twice 2,147,483,647 ms out fired at once");
  if (timer.armedAt() !== far) wrong.push("armedAt() for the far instant read " + timer.armedAt());
  timer.clear();

  const dir = await scratchDir(t, "deadline-unref");
  const file = path.join(dir, "hold.ts");
  fs.writeFileSync(file, "const { createDeadlineTimer } = await import(" + JSON.stringify(TIMER) + ");\n" +
    "const kept = createDeadlineTimer(() => console.log('fired'));\nkept.arm(Date.now() + 60_000);\n" +
    "console.log('armed ' + (kept.armedAt() !== null));\n");
  const started = Date.now();
  let out = "";
  try {
    out = execFileSync("cloudcli-tsx", [file], { cwd: dir, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error: any) {
    if (error?.code === "ENOENT") return cannotRun("cloudcli-tsx is not on PATH");
    wrong.push("a process holding only a timer armed a minute out did not end by itself within 30 s: " + firstLine(error));
  }
  const took = Date.now() - started;
  if (out && !out.includes("armed true")) wrong.push("the child said " + JSON.stringify(out.trim()) + ", not armed true");
  if (out.includes("fired")) wrong.push("the child's timer fired");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(firstSaw + "; of two arms only the second fired; null and clear() left nothing to fire; the far instant waited; a process holding only an armed timer ended in " + took + " ms");
});
