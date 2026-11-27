// protects: server/modules/dispatch-souls/launch-watch.service.ts, server/modules/dispatch-souls/soul-launch.transport.ts
// writes: none
//
// A launch's child.log is written on every turn the soul takes; the lane reads it only for the model the child
// announces on its first event, so the watch lets it count only while the lane does not hold that model and the log is
// shorter than CHILD_LOG_HEAD_BYTES, the head the reader reads. This case starts the real launch watch on scratch roots
// and holds it to that: lines while the model is unknown count, a line once it is known does not, the write that takes
// the log past the head is the last that counts for that launch, and the launch's result.json and another launch's
// log still count. Both names come from soul-launch.transport.ts, which reads them.
import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const LAUNCH_WATCH = "/home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/launch-watch.service.ts";
const TRANSPORT = "/home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/soul-launch.transport.ts";
const QUIET_MS = 150;
const SETTLE_WAIT_MS = 300;
const TWO_DAYS_S = 2 * 24 * 3600;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const firstLine = (error: any) => String(error && error.message ? error.message : error).split("\n")[0];

/** A file put in place the way the launcher and the walker put theirs: a scratch name, then a rename. */
function putAtomically(file: string, body: string): void {
  const scratch = path.join(path.dirname(file), "." + path.basename(file) + ".tmp");
  fs.writeFileSync(scratch, body);
  fs.renameSync(scratch, file);
}

/** onMove counted across one act: quiet first, then the act, then a settle's worth of waiting. */
function judge(counter: { moves: number }, wrong: string[]) {
  return async (label: string, act: () => void, counts: boolean): Promise<void> => {
    await wait(QUIET_MS);
    counter.moves = 0;
    act();
    await wait(SETTLE_WAIT_MS);
    if (counts && counter.moves === 0) wrong.push(label + " called no onMove");
    if (!counts && counter.moves > 0) wrong.push(label + " called onMove " + counter.moves + " time(s)");
  };
}

runCase(async (t: any) => {
  let watchModule: any;
  let transport: any;
  try {
    watchModule = await import(LAUNCH_WATCH);
    transport = await import(TRANSPORT);
  } catch (error) {
    return broken("the launch watch or its transport does not load: " + firstLine(error));
  }
  const head = transport.CHILD_LOG_HEAD_BYTES;
  const logName = transport.CHILD_LOG_FILE;
  if (typeof head !== "number" || typeof logName !== "string") return broken("soul-launch.transport.ts does not export CHILD_LOG_HEAD_BYTES and CHILD_LOG_FILE");
  if (typeof watchModule.createLaunchWatch !== "function") return broken(LAUNCH_WATCH + " exports no createLaunchWatch");

  const root = await scratchDir(t, "launch-watch-log");
  const souls = path.join(root, "dispatch-souls");
  const chains = path.join(root, "dispatch-chains");
  const cpuWait = path.join(root, "pacer", "cpu-wait");
  for (const dir of [souls, chains, cpuWait]) fs.mkdirSync(dir, { recursive: true });
  const first = path.join(souls, "dispatch-athena-20261127-080000-cccc");
  const second = path.join(souls, "dispatch-hermes-20261127-080000-dddd");
  fs.mkdirSync(first);
  fs.mkdirSync(second);
  const firstLog = path.join(first, logName);
  const line = (bytes: number) => "x".repeat(bytes - 1) + "\n";

  let firstKnown = false;
  const counter = { moves: 0 };
  const errors: string[] = [];
  const wrong: string[] = [];
  const expectMove = judge(counter, wrong);
  const watch = watchModule.createLaunchWatch({
    soulsRoot: souls,
    chainsRoot: chains,
    cpuWaitDir: cpuWait,
    modelKnown: (launchId: string) => (launchId === path.basename(first) ? firstKnown : false),
    onMove: () => { counter.moves += 1; },
    logError: (message: string) => { errors.push(message); },
  });

  watch.start();
  try {
    await expectMove("a first line in child.log while the model is unknown", () => fs.appendFileSync(firstLog, line(200)), true);
    await expectMove("a second line while the model is still unknown", () => fs.appendFileSync(firstLog, line(200)), true);
    firstKnown = true;
    await expectMove("a line once the lane holds the model", () => fs.appendFileSync(firstLog, line(200)), false);
    firstKnown = false;
    await expectMove("the write that takes child.log past CHILD_LOG_HEAD_BYTES", () => fs.appendFileSync(firstLog, line(head)), true);
    await expectMove("a line after the log passed its head, the model still unknown", () => fs.appendFileSync(firstLog, line(200)), false);
    await expectMove("result.json written in that launch", () => fs.writeFileSync(path.join(first, "result.json"), "{}"), true);
    await expectMove("a line in another launch's child.log under its head", () => fs.appendFileSync(path.join(second, logName), line(200)), true);
  } finally {
    watch.stop();
  }
  if (errors.length > 0) wrong.push("logError said: " + errors.slice(0, 2).join(" | "));
  if (wrong.length > 0) return broken("launch-watch.service.ts: " + wrong.join("; "));
  return held("launch-watch.service.ts: child.log counted while the model was unknown and under its " + head + "-byte head, not once known, not after the write that crossed the head; result.json and another launch's log still counted");
});
