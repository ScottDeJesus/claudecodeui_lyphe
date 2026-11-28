// THE RED WATCH'S PLAN NAMES ITS NEXT INSTANT. RedWatchPlan.nextAt is the least instant after now among: redSince +
// RED_AFTER_MS for a paging, unmuted check on a reporting link whose red has not lasted the hour; lastPushAt(row) +
// REMINDER_EVERY_MS for an open incident still red; lastPushAt(previous) + REMINDER_EVERY_MS for a candidate held by an
// earlier incident; mute.until for a paging check under a mute; null when none. The plan's other rules do not move. An
// incident this plan opens is open once the plan is applied, so its first reminder (now + REMINDER_EVERY_MS) is an instant
// too: without it a red that never moves again would never be reminded. The mute's end may be read up to a second after
// until (the mute still holds at until itself).
//
// Eight plans over one node at T, each with its expected nextAt. Pure: planRedWatch reads only what it is handed.
//
// protects: server/modules/cerberus/red-watch-plan.ts
// writes: none

import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { HOUR, MINUTE, NODE, check, overviewOf } from "../lib/red_watch_house.mjs";

const PLAN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/modules/cerberus/red-watch-plan.ts");

runCase(async () => {
  let P: any;
  try {
    P = await import(PLAN);
  } catch (error) {
    return cannotRun("red-watch-plan.ts would not load: " + String((error as Error)?.message ?? error).split("\n")[0]);
  }
  const T = Date.now();
  const red = (key: string, since: number, mute: unknown = null) => check({ key, label: key, status: "failing", since, value: "down", mute });
  const plan = (checks: any[], opts: { open?: any[]; lastClosed?: (n: string, k: string) => any; link?: string } = {}) => {
    const o: any = overviewOf(T, checks);
    o.muted = checks.filter((c) => c.mute !== null).map((c) => ({ check: c, fix: null, run: null, diagnosis: null }));
    o.counts.muted = o.muted.length;
    if (opts.link) o.nodes[0].link = opts.link;
    return P.planRedWatch({ overview: o, open: opts.open ?? [], lastClosed: opts.lastClosed ?? (() => null), clockOffsetMs: () => 0 });
  };
  const row = (id: number, key: string, o: Record<string, unknown>) => ({
    id, node: NODE, key, red_since: T - 2 * HOUR, opened_at: T - HOUR, notified_at: T - HOUR, last_reminder_at: null,
    closed_at: null, closed_by: null, ...o,
  });
  const mute = { id: "m1", from: T - HOUR, until: T + 20 * MINUTE, reason: "case", by: "case" };

  const probe = plan([red("svc/a", T - 30 * MINUTE)]);
  if (!("nextAt" in probe)) return broken("RedWatchPlan carries no nextAt: its keys are " + Object.keys(probe).join(", "));

  const wants: Array<[string, any, number | null, (p: any) => string | null]> = [
    ["a check failing 30 min", probe, T + 30 * MINUTE, () => null],
    ["the same beside a paging check muted until T+20m", plan([red("svc/a", T - 30 * MINUTE), red("svc/m", T - 2 * HOUR, mute)]), T + 20 * MINUTE, () => null],
    ["an open incident paged 1 h ago, still red", plan([red("svc/c", T - 2 * HOUR)], { open: [row(1, "svc/c", {})] }), T + 5 * HOUR,
      (p) => (p.reminders.length !== 0 ? "it reminded inside the 6 h cadence" : null)],
    ["an open incident reminded 2 h ago", plan([red("svc/c", T - 8 * HOUR)], { open: [row(1, "svc/c", { red_since: T - 8 * HOUR, opened_at: T - 7 * HOUR, notified_at: T - 7 * HOUR, last_reminder_at: T - 2 * HOUR })] }), T + 4 * HOUR,
      (p) => (p.reminders.length !== 0 ? "it reminded inside the 6 h cadence" : null)],
    ["a candidate held by an incident a mute closed, paged 90 min ago", plan([red("svc/h", T - 2 * HOUR)], {
      lastClosed: (n, k) => (k === "svc/h" ? row(2, "svc/h", { opened_at: T - 90 * MINUTE, notified_at: T - 90 * MINUTE, closed_at: T - 30 * MINUTE, closed_by: "mute" }) : null),
    }), T + 270 * MINUTE, (p) => (p.opens.length !== 0 ? "it opened the held candidate" : null)],
    ["a check red 2 h with nothing open", plan([red("svc/d", T - 2 * HOUR)]), T + 6 * HOUR, (p) => (p.opens.length !== 1 ? "it opened " + p.opens.length + ", not 1" : null)],
    ["nothing red", plan([]), null, () => null],
    ["a check red 30 min on a node not reporting", plan([red("svc/a", T - 30 * MINUTE)], { link: "silent" }), null, () => null],
  ];
  const wrong: string[] = [];
  const saw: string[] = [];
  for (const [label, p, want, extra] of wants) {
    const got = p.nextAt;
    const said = got === null ? "null" : got === undefined ? "undefined" : "T" + (got - T >= 0 ? "+" : "") + Math.round((got - T) / MINUTE) + "m" + ((got - T) % MINUTE !== 0 ? " " + ((got - T) % MINUTE) + " ms" : "");
    saw.push(label + ": " + said);
    const slack = label.includes("muted until") && typeof got === "number" && want !== null && got >= want && got - want <= 1000;
    if (got !== want && !slack) wrong.push(label + " planned nextAt " + said + ", not " + (want === null ? "null" : "T+" + Math.round((want - T) / MINUTE) + "m"));
    const other = extra(p);
    if (other) wrong.push(label + ": " + other);
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(saw.join("; "));
});
