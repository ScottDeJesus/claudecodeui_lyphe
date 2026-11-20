// THE TICKET DOOR. `fileTicket` and `clearTicket` (kanban-dispatch's barrel, `kanban-dispatch.door.ts`) are how a server
// module that detects a defect files it on the house's bug line: each is one `dispatcher bug file` / `bug cleared`, and
// each answers the dispatcher's one line — its FILED, its REFUSED, its `no open ticket holds …` — and never throws, so
// the caller logs one line and goes on. A machine is nobody's chat: the filing carries no session id even when the
// server's own process does, so a chat's per-session cap and its word back never land on Cerberus's tickets.
//
// With the dispatcher absent (`DISPATCHER_BIN` naming no file) each still answers a line, and the red watch's tick still
// records its incident and logs one `[red-watch] ticket:` line: a filing never changes the tick's outcome.
//
// Scratch dispatcher home and Cerberus store (`lib/red_watch_house.mjs`); nothing of the operator's is touched.
//
// protects: server/modules/kanban-dispatch/kanban-dispatch.door.ts, server/modules/kanban-dispatch/index.ts, server/modules/cerberus/red-watch-tickets.ts, server/modules/cerberus/red-watch.service.ts, server/shared/child-env.ts
// writes: none

import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { rows } from "../lib/bug_house.mjs";
import { MINUTE, check, overviewOf, redWatchHouse, ticketLines } from "../lib/red_watch_house.mjs";

const SERVER = path.resolve(import.meta.dirname, "../../server");

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  let w: any;
  try {
    w = await redWatchHouse(t, "ticket-door");
  } catch (error) {
    return cannotRun(`the scratch red watch would not start: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
  }
  let door: any;
  try {
    door = await import(`${SERVER}/modules/kanban-dispatch/index.ts`);
  } catch (error) {
    return broken(`the kanban-dispatch barrel would not load: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
  }
  if (typeof door.fileTicket !== "function" || typeof door.clearTicket !== "function") {
    return broken("the kanban-dispatch barrel exports no fileTicket and clearTicket");
  }
  process.env.CLAUDE_CODE_SESSION_ID = "case-chat-session-door";
  const wrong: string[] = [];
  const filing = (over: Record<string, string> = {}) => ({
    source: "cerberus", key: "check:door-node/shadow-connector/x", service: "shadow-connector",
    title: "X on door-node is red", words: "down for an hour", priority: "high", ...over,
  });

  const filed = await door.fileTicket(filing());
  if (typeof filed !== "string" || !filed.startsWith("FILED ticket")) wrong.push(`a filing answered ${JSON.stringify(filed)}, not the FILED line`);
  const stored = await rows(w.house, "SELECT session, reporter FROM tickets");
  if (stored.length !== 1) wrong.push(`the store holds ${stored.length} tickets after one filing`);
  else if (stored[0].session !== null || JSON.parse(stored[0].reporter).session) {
    wrong.push(`the machine's ticket carries the process's chat session: ${JSON.stringify(stored[0])}`);
  }

  const refused = await door.fileTicket(filing({ key: "check:door-node/system/disk", service: "system", title: "Disk is red" }));
  if (typeof refused !== "string" || !refused.startsWith("REFUSED bug file:") || !refused.includes("system")) {
    wrong.push(`a service with no charter line answered ${JSON.stringify(refused)}, not its REFUSED line naming system`);
  }
  const none = await door.clearTicket("check:door-node/nobody/holds", "green again after 5 m");
  if (none !== "no open ticket holds check:door-node/nobody/holds") wrong.push(`a key no ticket holds answered ${JSON.stringify(none)}`);

  // The dispatcher gone.
  process.env.DISPATCHER_BIN = path.join(w.house.dir, "no-dispatcher-here");
  for (const [name, call] of [
    ["fileTicket", () => door.fileTicket(filing({ key: "check:door-node/shadow-connector/y" }))],
    ["clearTicket", () => door.clearTicket("check:door-node/shadow-connector/x", "n")],
  ] as const) {
    try {
      const answer = await call();
      if (typeof answer !== "string" || answer.trim() === "" || answer.includes("\n")) wrong.push(`${name} with no dispatcher answered ${JSON.stringify(answer)}, not one line`);
    } catch (error) {
      wrong.push(`${name} with no dispatcher threw: ${String((error as Error)?.message ?? error)}`);
    }
  }
  const T = Date.now();
  try {
    w.tick(overviewOf(T, [check({ key: "shadow-connector/z", label: "Z", status: "failing", since: T - 61 * MINUTE, value: "down" })]));
  } catch (error) {
    wrong.push(`tickRedWatch threw with no dispatcher: ${String((error as Error)?.message ?? error)}`);
  }
  if (w.alerts().length !== 1) wrong.push(`with no dispatcher the tick recorded ${w.alerts().length} incidents, not 1`);
  const lines = await ticketLines(w, 1);
  if (lines.length !== 1) wrong.push(`with no dispatcher the tick logged ${JSON.stringify(lines)}, not one '[red-watch] ticket:' line`);
  delete process.env.DISPATCHER_BIN;

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`filed sessionless (${filed}), refused system by name, said no open ticket for a stranger key, and with no dispatcher answered one line each, threw nothing and the tick still recorded its incident (${lines[0]})`);
});
