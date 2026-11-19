// red_watch_house.mjs — Cerberus's red watch run over a scratch store, filing on a scratch dispatcher home.
//
//   import { redWatchHouse, check, overviewOf, ticketLines, MINUTE } from "../lib/red_watch_house.mjs";
//   const w = await redWatchHouse(t, "red-filed");          // scratch stores + bug home; w.tick, w.watch, w.logs
//   w.tick(overviewOf(T, [check({ key: "shadow-connector/gemini", status: "failing", since: T - 61 * MINUTE })]));
//   const said = await ticketLines(w, 1);                    // the `[red-watch] ticket:` lines, once that many are logged
//
// EVERY PATH IS SCRATCH. `DATABASE_PATH` and `CERBERUS_DB_PATH` name files in the case's own folder (the server builds
// both stores fresh), and the dispatcher home, state dir, bugs charter and cards charter are `bugHouse`'s
// (`bug_house.mjs`), so neither the operator's Cerberus store nor his tickets are read or written. The charter names
// `shadow-connector` (and `cloudcli`) for the scratch git folder `w.house.svc`; `system` has no line, as in the real one.
//
// It must be imported by a `.ts` case run under `cloudcli-tsx`: it loads the server's own TypeScript. The server modules
// are imported AFTER the environment is set, because the stores' paths are read when they are first opened.
// `console.log` / `console.error` are captured into `w.logs` (and given back when the case ends): the tick and its
// background filings speak only there.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bugHouse } from "./bug_house.mjs";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const NODE = "case-node";
const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server");
const SETTLE_MS = 60_000;

/** A scratch red watch: { house, tick, watch, db, logs, alerts }. */
export async function redWatchHouse(t, label) {
  const house = await bugHouse(t, label);
  fs.writeFileSync(house.charter, `per_session = 20\n[services]\nshadow-connector = "${house.svc}"\ncloudcli = "${house.svc}"\n`);
  for (const [name, value] of Object.entries(house.env)) {
    if (/^(DISPATCHER_HOME|PLAN_RUNNER_STATE_DIR|BUGS_CONFIG_PATH|CARDS_CONFIG_PATH)$/.test(name)) process.env[name] = value;
  }
  for (const name of ["PLAN_RUNNER_CHILD", "CLAUDE_CODE_AGENT", "PLAN_RUNNER_RUN_ID", "DISPATCHER_SESSION", "DISPATCHER_BIN"]) {
    delete process.env[name];
  }
  process.env.DATABASE_PATH = path.join(house.dir, "auth.db");
  process.env.CERBERUS_DB_PATH = path.join(house.dir, "cerberus.db");

  const logs = [];
  const saved = { log: console.log, error: console.error, warn: console.warn };
  const keep = (...parts) => logs.push(parts.map((p) => (typeof p === "string" ? p : String(p?.message ?? p))).join(" "));
  console.log = keep;
  console.error = keep;
  console.warn = keep;
  t.defer(() => Object.assign(console, saved));

  const database = await import(`${SERVER}/modules/database/index.ts`);
  await database.initializeDatabase();
  const watch = await import(`${SERVER}/modules/cerberus/red-watch.service.ts`);
  const db = database.getCerberusConnection();
  return {
    house,
    watch,
    db,
    logs,
    tick: (overview) => watch.tickRedWatch(overview),
    alerts: () => database.cerberusRedAlertsDb.listOpen(),
  };
}

/** One check as the overview carries it: `key` is `<service>/<rest>`, the service's part before the first `/`. */
export function check({ key, status, since, label = null, value = "", mute = null, node = NODE }) {
  const service = key.split("/")[0];
  return {
    node, key, service, id: `${node}/${key}`, label, serviceLabel: null, status, stored: status, value,
    at: since, since, every: 60, staleAfter: 300, origin: "probe", kind: "http", mute,
  };
}

/** An overview at `now` with every check on one reporting node; its red, unmuted checks are `needsYou`. */
export function overviewOf(now, checks, node = NODE) {
  const byService = new Map();
  for (const c of checks) byService.set(c.service, [...(byService.get(c.service) ?? []), c]);
  const services = [...byService].map(([service, list]) => ({ node, service, label: null, status: list[0].status, checks: list }));
  const needsYou = checks
    .filter((c) => c.status !== "ok" && c.mute === null)
    .map((c) => ({ check: c, fix: null, run: null, diagnosis: null }));
  return {
    now,
    nodes: [{ id: node, desc: null, role: "node", link: "reporting", wardenVersion: null, lastHeardAt: now, silentSince: null,
      enrolledAt: now, colocated: false, projects: [], sessions: 0, updating: null, services }],
    needsYou,
    muted: [],
    running: [],
    counts: { checks: checks.length, passing: 0, needsYou: needsYou.length, muted: 0, nodes: 1 },
    activity: [],
    lastResultAt: now,
    gateway: { listening: false, address: null },
  };
}

/** The `[red-watch] ticket:` lines logged so far, after waiting (at most a minute) until `count` of them are. */
export async function ticketLines(w, count) {
  const read = () => w.logs.filter((l) => l.startsWith("[red-watch] ticket:"));
  const until = Date.now() + SETTLE_MS;
  while (read().length < count && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
  return read();
}
