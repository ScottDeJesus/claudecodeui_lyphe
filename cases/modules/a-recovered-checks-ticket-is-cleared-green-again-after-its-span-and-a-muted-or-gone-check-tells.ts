// THE DETECTOR THAT OPENED A TICKET CLOSES IT. When the red watch records a check green again (closed `ok`), it clears
// that check's ticket on the house's bug line (`dispatcher bug cleared --key check:<node>/<key>`) with the note
// `green again after <how long it was red, in the push's units>`. An incident that ends WITHOUT the check being seen
// green — the check gone from the fleet, or muted — tells the bug line nothing: nobody saw it fixed, so its ticket
// stays open. No sweep ever asks whether a ticket is still true; this write is the only one that clears it.
//
// Three checks red an hour, filed at T. At T+30 m: A is ok since T+29 m (red since T-61 m, so 90 minutes red, said
// `1 h 30 m`), B has left the fleet (closed `gone`), C is muted (closed `mute`).
//
// Scratch Cerberus store and scratch dispatcher home (`lib/red_watch_house.mjs`); nothing of the operator's is touched.
//
// protects: server/modules/cerberus/red-watch-tickets.ts, server/modules/cerberus/red-watch.service.ts, server/modules/kanban-dispatch/kanban-dispatch.door.ts, /home/lyphe/.claude/hooks/dispatcher/bug_end.py
// writes: none

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bug, said } from "../lib/bug_house.mjs";
import { MINUTE, NODE, check, overviewOf, redWatchHouse, ticketLines } from "../lib/red_watch_house.mjs";

const KEYS = { ok: "shadow-connector/recovers", gone: "shadow-connector/leaves", muted: "shadow-connector/muted" };

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  let w: any;
  try {
    w = await redWatchHouse(t, "red-cleared");
  } catch (error) {
    return cannotRun(`the scratch red watch would not start: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
  }
  const T = Date.now();
  const since = T - 61 * MINUTE;
  const red = (key: string) => check({ key, label: key.split("/")[1], status: "failing", since, value: "down" });
  w.tick(overviewOf(T, [red(KEYS.ok), red(KEYS.gone), red(KEYS.muted)]));
  const filed = await ticketLines(w, 3);
  if (filed.length !== 3 || !filed.every((l: string) => l.includes("FILED ticket"))) {
    return broken(`the opening tick did not file its three red checks: ${JSON.stringify(filed)}`);
  }
  const ticketOf = async (key: string) => {
    const listed = await bug(w.house, ["list", "--all", "--json"]);
    if (listed.code !== 0) throw new Error(`bug list would not answer — ${said(listed)}`);
    return JSON.parse(listed.out).find((x: any) => (x.keys ?? []).includes(`check:${NODE}/${key}`));
  };

  const later = T + 30 * MINUTE;
  const green = check({ key: KEYS.ok, label: "recovers", status: "ok", since: T + 29 * MINUTE, value: "200" });
  const muted = check({ key: KEYS.muted, label: "muted", status: "failing", since, value: "down",
    mute: { id: "m1", from: T, until: T + 3_600_000, reason: "case", by: "case" } });
  w.tick(overviewOf(later, [green, muted]));
  if (w.alerts().length !== 0) return cannotRun(`the second tick left ${w.alerts().length} incidents open: the watch's own plan moved`);
  const all = await ticketLines(w, 4);
  // Give a wrongful second or third telling its moment to arrive before counting.
  await new Promise((r) => setTimeout(r, 3000));
  const told = w.logs.filter((l: string) => l.startsWith("[red-watch] ticket:")).slice(3);

  const wrong: string[] = [];
  if (told.length !== 1 || !told[0].startsWith("[red-watch] ticket: CLEARED ticket")) {
    wrong.push(`the closing tick logged ${JSON.stringify(told)}, not one '[red-watch] ticket: CLEARED ticket' line`);
  }
  const recovered = await ticketOf(KEYS.ok);
  if (!recovered) wrong.push("the recovered check has no ticket");
  else {
    const shown = await bug(w.house, ["show", String(recovered.id), "--json"]);
    const ticket = JSON.parse(shown.out || "{}");
    if (ticket.state !== "cleared") wrong.push(`bug show reads the recovered check's ticket ${ticket.state}, not cleared`);
    if (!String(ticket.word ?? "").includes("green again after 1 h 30 m")) {
      wrong.push(`its word does not carry the note 'green again after 1 h 30 m': ${JSON.stringify(ticket.word)}`);
    }
  }
  for (const [why, key] of [["gone", KEYS.gone], ["muted", KEYS.muted]]) {
    const ticket = await ticketOf(key);
    if (!ticket || !["filed", "placed", "unplaced"].includes(ticket.state)) {
      wrong.push(`the ${why} check's ticket reads ${ticket?.state ?? "missing"}, not still open`);
    }
  }
  if (all.length < 4) wrong.push("no ticket line followed the closing tick at all");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("the recovered check's ticket read cleared with 'green again after 1 h 30 m' after one CLEARED line; the gone and the muted checks told nothing and their tickets stayed open");
});
