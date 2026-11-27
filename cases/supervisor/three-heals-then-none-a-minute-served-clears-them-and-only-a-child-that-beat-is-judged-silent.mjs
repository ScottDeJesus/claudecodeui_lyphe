// protects: deploy/dev-supervisor/heal.mjs
// writes: none
// The dev supervisor's heal budget and silence watch, judged on a clock the case moves itself: three heals in a row and then none,
// a server that served a minute clears the count first, clear() starts it again; a child that never beat is never judged, its first
// alive arms one 45 s deadline, any later message sets it again, onSilent fires once when it passes, drop and close forget it.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const HEAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../deploy/dev-supervisor/heal.mjs");

runCase(async () => {
  let heal;
  try {
    heal = await import(pathToFileURL(HEAL).href);
  } catch (error) {
    return broken(HEAL + " does not load: " + String(error?.message ?? error).split("\n")[0]);
  }
  if (typeof heal.createHeals !== "function" || typeof heal.createSilenceWatch !== "function") {
    return broken("heal.mjs exports " + Object.keys(heal).join(", "));
  }
  const wrong = [];
  const want = { MAX_HEALS: 3, STABLE_MS: 60000, RETRY_DELAY_MS: 5000, SILENCE_MS: 45000 };
  for (const [name, value] of Object.entries(want)) if (heal[name] !== value) wrong.push(name + " is " + heal[name] + ", wanted " + value);

  const heals = heal.createHeals();
  const inARow = [heals.next(0), heals.next(59999), heals.next(1), heals.next(0)];
  if (JSON.stringify(inARow) !== "[1,2,3,null]") wrong.push("four heals in a row answered " + JSON.stringify(inARow) + ", wanted [1,2,3,null]");
  const afterStable = [heals.next(60000), heals.next(0)];
  if (JSON.stringify(afterStable) !== "[1,2]") wrong.push("a minute served, then one more, answered " + JSON.stringify(afterStable) + ", wanted [1,2]");
  heals.next(0);
  heals.clear();
  const afterClear = heals.next(0);
  if (afterClear !== 1) wrong.push("after clear() the next heal was " + afterClear + ", wanted 1");

  // A clock the case moves: heal.mjs reads setTimeout and clearTimeout at each call, and nothing below awaits.
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let now = 0;
  let next = 0;
  const timers = new Map();
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      let due = null;
      for (const [id, timer] of timers) if (timer.at <= end && (due === null || timer.at < timers.get(due).at)) due = id;
      if (due === null) break;
      const timer = timers.get(due);
      timers.delete(due);
      now = timer.at;
      timer.fn();
    }
    now = end;
  };
  globalThis.setTimeout = (fn, ms) => { next += 1; timers.set(next, { fn, at: now + ms, ms }); return next; };
  globalThis.clearTimeout = (id) => { timers.delete(id); };
  try {
    const fired = [];
    const watch = heal.createSilenceWatch({ onSilent: (attempt) => fired.push(attempt.name) });
    const A = { name: "A" };
    const B = { name: "B" };
    const C = { name: "C" };
    watch.heard(A, { type: "quiet" });
    watch.heard(A, { type: "busy", reasons: [] });
    advance(200000);
    if (fired.length || timers.size) wrong.push("a child that never beat was judged (" + fired.join(",") + ", " + timers.size + " deadlines)");
    watch.heard(B, { type: "alive" });
    const armed = [...timers.values()].map((timer) => timer.ms);
    if (JSON.stringify(armed) !== "[45000]") wrong.push("B's first alive armed " + JSON.stringify(armed) + ", wanted one deadline of 45000 ms");
    advance(44999);
    watch.heard(B, { type: "quiet" });
    advance(44999);
    if (fired.length) wrong.push("B was judged though a later quiet set its deadline again");
    if (timers.size !== 1) wrong.push("B holds " + timers.size + " deadlines after a reset, wanted 1");
    advance(1);
    if (fired.join(",") !== "B") wrong.push("45 s after B's last message onSilent saw [" + fired.join(",") + "], wanted [B]");
    advance(200000);
    if (fired.join(",") !== "B") wrong.push("B was judged again: [" + fired.join(",") + "]");
    watch.heard(C, { type: "alive" });
    watch.drop(C);
    advance(200000);
    if (fired.includes("C")) wrong.push("a dropped child was judged");
    watch.heard(A, { type: "alive" });
    watch.heard(C, { type: "alive" });
    watch.close();
    advance(200000);
    if (fired.length !== 1 || timers.size) wrong.push("close() left " + timers.size + " deadlines and onSilent saw [" + fired.join(",") + "]");
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
  return wrong.length
    ? broken(wrong.join("; "))
    : held("heals 1,2,3,null; a minute served clears first (1,2); clear() restarts at 1; a never-beating child is never judged; B's alive armed one 45000 ms deadline, a quiet set it again, onSilent(B) once 45 s after; drop and close leave no deadline");
});
