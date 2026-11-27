// protects: server/modules/dispatch-souls/launch-watch.service.ts, server/shared/directory-watch.service.ts, server/modules/dispatch-souls/soul-launch.transport.ts, server/modules/dispatch-souls/chain-record.transport.ts
// writes: none
//
// What tells the souls lane its picture may have moved is one directory watch per launch and chain directory on both
// roots, and one on the pacer's cpu-wait folder (server/modules/dispatch-souls/launch-watch.service.ts). This case starts
// the real watch on scratch roots and holds it to the design's list of what counts: in a launch directory spec.json,
// result.json, launcher.pid and child.pid (renamed in or written); in a chain directory chain.json; a child made or
// removed in either root; the cpu-wait folder's arrival and a .json marker in it. A brief, notes, walker.pid or a .tmp
// marker never moves the lane, nor does anything after stop(). The launch and chain made two days before start prove
// every directory of a root is watched, not only those inside the lane's six-hour window.
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

function madeLongAgo(dir: string): void {
  fs.mkdirSync(dir);
  const then = Date.now() / 1000 - TWO_DAYS_S;
  fs.utimesSync(dir, then, then);
}

runCase(async (t: any) => {
  let watchModule: any;
  try {
    watchModule = await import(LAUNCH_WATCH);
  } catch (error) {
    return broken(LAUNCH_WATCH + " does not load: " + firstLine(error));
  }
  if (typeof watchModule.createLaunchWatch !== "function") return broken(LAUNCH_WATCH + " exports no createLaunchWatch");

  const root = await scratchDir(t, "launch-watch-names");
  const souls = path.join(root, "dispatch-souls");
  const chains = path.join(root, "dispatch-chains");
  const pacer = path.join(root, "pacer");
  const cpuWait = path.join(pacer, "cpu-wait");
  for (const dir of [souls, chains, pacer]) fs.mkdirSync(dir);
  const oldLaunch = path.join(souls, "dispatch-athena-20261125-010101-aaaa");
  const oldChain = path.join(chains, "chain-old-20261125-010101-aaaa");
  madeLongAgo(oldLaunch);
  madeLongAgo(oldChain);
  const born = path.join(souls, "dispatch-hephaestus-20261127-070000-bbbb");
  const newChain = path.join(chains, "chain-new-20261127-070000-bbbb");

  const counter = { moves: 0 };
  const errors: string[] = [];
  const wrong: string[] = [];
  const expectMove = judge(counter, wrong);
  const watch = watchModule.createLaunchWatch({
    soulsRoot: souls,
    chainsRoot: chains,
    cpuWaitDir: cpuWait,
    modelKnown: () => true,
    onMove: () => { counter.moves += 1; },
    logError: (message: string) => { errors.push(message); },
  });

  watch.start();
  try {
    await expectMove("spec.json renamed into a launch made two days ago", () => putAtomically(path.join(oldLaunch, "spec.json"), "{}"), true);
    await expectMove("result.json renamed into it", () => putAtomically(path.join(oldLaunch, "result.json"), "{}"), true);
    await expectMove("launcher.pid written in it", () => fs.writeFileSync(path.join(oldLaunch, "launcher.pid"), "1"), true);
    await expectMove("child.pid written in it", () => fs.writeFileSync(path.join(oldLaunch, "child.pid"), "1"), true);
    await expectMove("brief.md written in it", () => fs.writeFileSync(path.join(oldLaunch, "brief.md"), "# brief"), false);
    await expectMove("a launch directory made after start", () => fs.mkdirSync(born), true);
    await expectMove("spec.json written in the launch made after start", () => fs.writeFileSync(path.join(born, "spec.json"), "{}"), true);
    await expectMove("notes.txt written in it", () => fs.writeFileSync(path.join(born, "notes.txt"), "x"), false);
    await expectMove("chain.json renamed into a chain made two days ago", () => putAtomically(path.join(oldChain, "chain.json"), "{}"), true);
    await expectMove("walker.pid written in that chain", () => fs.writeFileSync(path.join(oldChain, "walker.pid"), "1"), false);
    await expectMove("a chain directory made after start", () => fs.mkdirSync(newChain), true);
    await expectMove("chain.json renamed into the chain made after start", () => putAtomically(path.join(newChain, "chain.json"), "{}"), true);
    await expectMove("the cpu-wait folder made after start", () => fs.mkdirSync(cpuWait), true);
    await expectMove("a <launch id>.json marker written in cpu-wait", () => fs.writeFileSync(path.join(cpuWait, "dispatch-x.json"), "{}"), true);
    await expectMove("a .tmp file written in cpu-wait", () => fs.writeFileSync(path.join(cpuWait, "dispatch-x.json.tmp"), "{}"), false);
    fs.unlinkSync(path.join(born, "spec.json"));
    fs.unlinkSync(path.join(born, "notes.txt"));
    await expectMove("the emptied launch directory removed", () => fs.rmdirSync(born), true);
    await expectMove("a launch directory made again under that name", () => fs.mkdirSync(born), true);
    await expectMove("spec.json written in the launch made again", () => fs.writeFileSync(path.join(born, "spec.json"), "{}"), true);
  } finally {
    watch.stop();
  }
  await expectMove("spec.json written after stop()", () => fs.writeFileSync(path.join(oldLaunch, "spec.json"), "{\"after\":1}"), false);
  // The cpu-wait folder is made after start on purpose: watchDirectory says once that it cannot watch it yet, and waits at its parent.
  const faults = errors.filter((message) => !(message.includes(cpuWait) && message.includes("ENOENT")));
  if (faults.length > 0) wrong.push("logError said: " + faults.slice(0, 2).join(" | "));
  if (wrong.length > 0) return broken("launch-watch.service.ts: " + wrong.join("; "));
  return held("launch-watch.service.ts: the four record files, chain.json, a root child made, removed and made again, the cpu-wait folder and its marker each moved the lane; brief.md, notes.txt, walker.pid, a .tmp marker and a write after stop() did not");
});
