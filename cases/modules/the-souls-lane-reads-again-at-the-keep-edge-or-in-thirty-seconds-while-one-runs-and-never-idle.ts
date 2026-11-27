// protects: server/modules/dispatch-souls/launch-clock.service.ts, server/shared/polled-lane.service.ts
// writes: none
//
// The souls lane reads on a write, and only two things move its picture with nothing written: a launch leaving the
// six-hour window, and a launcher that died with no receipt. Its backstop is therefore a function of the picture it
// holds (launch-clock.service.ts, nextLaunchReadMs): null with no launches, the milliseconds to the first carried
// launch's (ended_at ?? started_at) + keepS plus one second and never negative, capped at LIVENESS_MS (30 s) only while
// a launch runs. This case holds that function to a table, then builds a polled lane (polled-lane.service.ts) whose
// backstopMs is a function and holds the lane to handing it the picture it holds, reading again after each number and
// arming nothing once it answers null.

import { broken, held, runCase } from "../lib/case.mjs";

const CLOCK = "/home/lyphe/.claude/claudecodeui_lyphe/server/modules/dispatch-souls/launch-clock.service.ts";
const LANE = "/home/lyphe/.claude/claudecodeui_lyphe/server/shared/polled-lane.service.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const firstLine = (error: any) => String(error && error.message ? error.message : error).split("\n")[0];

runCase(async () => {
  let clock: any;
  let laneModule: any;
  try {
    clock = await import(CLOCK);
    laneModule = await import(LANE);
  } catch (error) {
    return broken("the launch clock or the polled lane does not load: " + firstLine(error));
  }
  if (typeof clock.nextLaunchReadMs !== "function") return broken(CLOCK + " exports no nextLaunchReadMs");
  const wrong: string[] = [];
  if (clock.LIVENESS_MS !== 30000) wrong.push("LIVENESS_MS is " + clock.LIVENESS_MS + ", not 30000");

  const nowS = 1800000000;
  const keepS = 1000;
  const launch = (state: string, startedAgoS: number, endedAgoS: number | null) => ({
    launch_id: "dispatch-case-" + state + "-" + startedAgoS,
    state,
    started_at: nowS - startedAgoS,
    ended_at: endedAgoS === null ? null : nowS - endedAgoS,
  });
  const table: Array<[string, any, number | null]> = [
    ["no picture", null, null],
    ["no launches", [], null],
    ["one launch ended 100 s ago", [launch("done", 200, 100)], 901000],
    ["one launch running for 10 s", [launch("running", 10, null)], 30000],
    ["one launch running 5 s short of its keep edge", [launch("running", 995, null)], 6000],
    ["one launch ended past its keep edge", [launch("done", 3000, 2000)], 0],
    ["two ended launches, 100 s and 500 s ago", [launch("done", 200, 100), launch("failed", 600, 500)], 501000],
  ];
  for (const [label, launches, want] of table) {
    const got = clock.nextLaunchReadMs(launches, nowS, keepS);
    if (got !== want) wrong.push(label + ": " + got + ", not " + want);
  }

  let reads = 0;
  const handed: Array<{ held: number | null; reads: number }> = [];
  const errors: string[] = [];
  const lane = laneModule.createPolledLane({
    snapshot: () => {
      reads += 1;
      return { n: reads };
    },
    frame: (picture: any) => ({ kind: "case_lane", picture }),
    broadcast: () => {},
    backstopMs: (picture: any) => {
      handed.push({ held: picture === null ? null : picture.n, reads });
      return reads < 3 ? 40 : null;
    },
    logError: (message: string) => { errors.push(message); },
  });
  lane.start();
  await wait(500);
  const readsThen = reads;
  await wait(500);
  lane.stop();
  if (readsThen < 3) wrong.push("a backstop of 40 ms read the lane " + readsThen + " time(s) in 500 ms, not 3");
  if (reads !== readsThen) wrong.push("the lane read " + (reads - readsThen) + " more time(s) after its backstop answered null");
  if (handed.length === 0) wrong.push("backstopMs as a function was never called");
  const stale = handed.filter((entry) => entry.held !== entry.reads);
  if (stale.length > 0) wrong.push("backstopMs was handed a picture other than the one the lane held: " + JSON.stringify(stale[0]));
  if (errors.length > 0) wrong.push("logError said: " + errors.slice(0, 2).join(" | "));

  if (wrong.length > 0) return broken("the souls lane's clock: " + wrong.join("; "));
  return held("the souls lane's clock: " + table.length + " pictures answered as the design says; a lane with a function backstop read " + reads + " times, each handed the picture it held, and armed nothing after null");
});
