// A RED CHECK IS A TICKET. Cerberus's red watch opens an incident for a check failing or denied for an hour, and from
// this task on it also files that check on the house's bug line (`red-watch-tickets.ts` through the kanban-dispatch door,
// `dispatcher bug file`): source `cerberus`, priority high, key `check:<node>/<key>`, against the folder the bugs charter
// names for the key's service (its part before the first `/`), titled `<label> on <node> is red`, its words the reason
// and how long it has been red in the push's own units. Pages are halted today (`PAGES_HALTED`): a halted phone must
// never halt a ticket, so the filing has to happen before that return. A reminder of the same check (6 h on) meets the
// open ticket and answers ALREADY FILED — that is how a red is filed once and never twice.
//
// A second check carries a 300-character label: the bug line refuses a title over 200, so the watch cuts it and the red
// is still filed.
//
// Scratch Cerberus store and scratch dispatcher home (`lib/red_watch_house.mjs`); nothing of the operator's is touched.
//
// protects: server/modules/cerberus/red-watch-tickets.ts, server/modules/cerberus/red-watch.service.ts, server/modules/kanban-dispatch/kanban-dispatch.door.ts, server/modules/kanban-dispatch/index.ts, /home/lyphe/.claude/hooks/dispatcher/bug_file.py, /home/lyphe/.claude/charters/bugs.toml
// writes: none

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bug, said } from "../lib/bug_house.mjs";
import { HOUR, MINUTE, NODE, check, overviewOf, redWatchHouse, ticketLines } from "../lib/red_watch_house.mjs";

const KEY = "shadow-connector/gemini-key";
const LONG_KEY = "shadow-connector/long-label";
const LONG_LABEL = `Gemini ${"x".repeat(293)}`;

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  let w: any;
  try {
    w = await redWatchHouse(t, "red-filed");
  } catch (error) {
    return cannotRun(`the scratch red watch would not start: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
  }
  const T = Date.now();
  const red = check({ key: KEY, label: "Gemini key", status: "failing", since: T - 61 * MINUTE, value: "401 from the Gemini API" });
  const long = check({ key: LONG_KEY, label: LONG_LABEL, status: "failing", since: T - 61 * MINUTE, value: "down" });

  try {
    w.tick(overviewOf(T, [red, long]));
  } catch (error) {
    return broken(`tickRedWatch threw on a tick that opens two incidents: ${String((error as Error)?.message ?? error)}`);
  }
  if (w.alerts().length !== 2) return cannotRun(`the tick opened ${w.alerts().length} incidents, not 2: the watch's own plan moved`);
  const first = await ticketLines(w, 2);
  const wrong: string[] = [];
  if (first.length !== 2 || !first.every((l: string) => l.startsWith("[red-watch] ticket: FILED ticket"))) {
    wrong.push(`the opening tick logged ${JSON.stringify(first)}, not two '[red-watch] ticket: FILED ticket' lines`);
  }

  const listed = await bug(w.house, ["list", "--json"]);
  if (listed.code !== 0) return cannotRun(`bug list would not answer — ${said(listed)}`);
  const tickets: any[] = JSON.parse(listed.out || "[]");
  const mine = tickets.find((x) => (x.keys ?? []).includes(`check:${NODE}/${KEY}`));
  const longOne = tickets.find((x) => (x.keys ?? []).includes(`check:${NODE}/${LONG_KEY}`));
  if (tickets.length !== 2) wrong.push(`bug list holds ${tickets.length} tickets, not 2`);
  if (!mine) {
    wrong.push(`no ticket holds the key check:${NODE}/${KEY} (keys: ${JSON.stringify(tickets.map((x) => x.keys))})`);
  } else {
    if (mine.source !== "cerberus") wrong.push(`its source is ${mine.source}, not cerberus`);
    if (mine.priority !== "high") wrong.push(`its priority is ${mine.priority}, not high`);
    if (mine.path !== w.house.svc) wrong.push(`it is filed for ${mine.path}, not the folder the charter names for shadow-connector`);
    if (mine.title !== `Gemini key on ${NODE} is red`) wrong.push(`its title is ${JSON.stringify(mine.title)}`);
    if (!mine.words.includes("401 from the Gemini API")) wrong.push(`its words do not hold the reason: ${JSON.stringify(mine.words)}`);
    if (!mine.words.includes("1 h 01 m")) wrong.push(`its words do not say how long it has been red (1 h 01 m): ${JSON.stringify(mine.words)}`);
  }
  if (!longOne) wrong.push("the check with a 300-character label was never filed");
  else if (longOne.title.length > 200) wrong.push(`the long label's title is ${longOne.title.length} characters, over the bug line's 200`);

  // Six hours and a minute on, both still red: a reminder each. The open tickets answer ALREADY FILED.
  const later = T + 6 * HOUR + MINUTE;
  w.tick(overviewOf(later, [red, long]));
  const after = await ticketLines(w, 4);
  const reminded = after.slice(2);
  if (reminded.length !== 2 || !reminded.every((l: string) => l.startsWith("[red-watch] ticket: ALREADY FILED"))) {
    wrong.push(`the reminder tick logged ${JSON.stringify(reminded)}, not two '[red-watch] ticket: ALREADY FILED' lines`);
  }
  const again = await bug(w.house, ["list", "--all", "--json"]);
  const count = JSON.parse(again.out || "[]").length;
  if (count !== 2) wrong.push(`after the reminder the line holds ${count} tickets, not the same 2`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`one check red 61 minutes filed FILED as cerberus/high under check:${NODE}/${KEY} for the service's folder, the 300-character label cut to ${longOne.title.length}, and the 6 h reminder answered ALREADY FILED twice with still 2 tickets`);
});
