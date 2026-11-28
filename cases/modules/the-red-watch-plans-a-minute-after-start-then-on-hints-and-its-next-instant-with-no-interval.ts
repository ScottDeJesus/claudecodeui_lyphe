// THE RED WATCH PLANS ON EVENTS AND ONE COMPUTED INSTANT. startRedWatch(overview) plans for the first time 60 s after it
// is armed (NO TICK AT THE MOMENT OF ARMING, INV-10187) and a hint heard before then waits for that plan; after it, each
// closed hint window (onHintSent, cerberus-broadcast.ts) brings one plan, and each plan arms one deadline timer at the
// plan's nextAt; the first plan logs "[red-watch] next plan at <iso>" (or "nothing to wait for"). The red watch starts no
// setInterval (one another module of the server starts is not its).
// stopRedWatch clears the timer and the subscription: a hint after it plans nothing. tickRedWatch answers the nextAt.
//
// One check failing 30 min on a reporting node: its hour ends 30 min on, the instant the first plan must name.
// Scratch Cerberus store and scratch dispatcher home (lib/red_watch_house.mjs); nothing of the operator's is touched.
//
// protects: server/modules/cerberus/red-watch.service.ts, server/modules/cerberus/red-watch-plan.ts, server/shared/deadline-timer.ts, server/modules/cerberus/cerberus-broadcast.ts
// writes: none

import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { MINUTE, NODE, check, overviewOf, redWatchHouse } from "../lib/red_watch_house.mjs";

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server");
const KEY = "shadow-connector/next";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const intervals: unknown[] = [];
  const realSetInterval = globalThis.setInterval;
  (globalThis as any).setInterval = (fn: any, ms?: number, ...rest: any[]) => {
    const caller = (new Error().stack ?? "").split("\n")[2] ?? "";
    if (/red-watch.service|deadline-timer/.test(caller)) intervals.push(ms);
    return realSetInterval(fn, ms, ...rest);
  };
  t.defer(() => {
    (globalThis as any).setInterval = realSetInterval;
  });
  let w: any;
  let broadcast: any;
  try {
    w = await redWatchHouse(t, "red-next");
    broadcast = await import(SERVER + "/modules/cerberus/cerberus-broadcast.ts");
  } catch (error) {
    return cannotRun("the scratch red watch would not start: " + String((error as Error)?.message ?? error).split("\n")[0]);
  }
  const started = Date.now();
  const since = started - 30 * MINUTE;
  const due = since + 60 * MINUTE;
  const red = () => check({ key: KEY, label: "next", status: "failing", since, value: "down" });
  const plans: number[] = [];
  const overview = () => {
    plans.push(Date.now());
    return overviewOf(Date.now(), [red()]);
  };
  const hint = () => broadcast.hintChanged({ nodes: [NODE], checks: [NODE + "/" + KEY] });
  const nextLines = () => w.logs.filter((l: string) => l.startsWith("[red-watch] next plan at") || l.includes("nothing to wait for"));

  w.watch.startRedWatch(overview);
  t.defer(() => w.watch.stopRedWatch());
  await sleep(1500);
  const atArming = plans.length;
  hint();
  await sleep(3000);
  const beforeMinute = plans.length;
  await sleep(Math.max(0, started + 63_000 - Date.now()));
  const afterMinute = plans.length;
  const linesAfterMinute = nextLines().length;
  const firstSaid = nextLines()[0] ?? null;
  hint();
  hint();
  hint();
  await sleep(3000);
  const afterHint = plans.length;
  const linesAfterHint = nextLines().length;
  w.watch.stopRedWatch();
  hint();
  await sleep(3000);
  const afterStop = plans.length;
  const answered = w.watch.tickRedWatch(overviewOf(Date.now(), [red()]));

  const iso = new Date(due).toISOString();
  const wrong: string[] = [];
  if (atArming !== 0) wrong.push("startRedWatch planned " + atArming + " time(s) within 1.5 s of arming");
  if (beforeMinute !== 0) wrong.push("a hint 1.5 s after start planned before the minute (" + beforeMinute + " plans), not waiting for the first plan");
  if (afterMinute < 1) wrong.push("no plan ran in the 63 s after start");
  else if (plans[0] < started + 59_000) wrong.push("the first plan ran " + (plans[0] - started) + " ms after start, not a minute");
  if (firstSaid === null || !firstSaid.includes(iso)) wrong.push("the first plan logged " + JSON.stringify(firstSaid) + ", not [red-watch] next plan at " + iso);
  if (afterHint - afterMinute !== 1) wrong.push("one hint window after the first plan brought " + (afterHint - afterMinute) + " plans, not one");
  if (afterStop !== afterHint) wrong.push("a hint after stopRedWatch brought " + (afterStop - afterHint) + " plan(s)");
  if (answered !== due) wrong.push("tickRedWatch answered " + JSON.stringify(answered) + ", not the check's hour-end " + due);
  if (intervals.length !== 0) wrong.push("setInterval was called " + intervals.length + " time(s), every " + intervals.join(", ") + " ms");
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("first plan " + (plans[0] - started) + " ms after start, none before; it logged " + JSON.stringify(firstSaid) +
    "; one hint window then brought one plan, a hint after stop none; tickRedWatch answered " + iso + "; no setInterval");
});
