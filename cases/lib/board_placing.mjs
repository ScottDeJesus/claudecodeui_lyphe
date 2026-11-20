// board_placing.mjs — the board-dispatch module mounted over a scratch board database, against a stand-in dispatcher.
//
//   import { placingRig, mountBoardDispatch } from "../lib/board_placing.mjs";
//   const rig = await placingRig(t, "placing", { tickets: [...], notes: [...] });   // before any server import
//   const { kanban } = await rig.open();          // the scratch database made, the kanban barrel loaded
//   const mounted = await mountBoardDispatch(t);  // createKanbanDispatchModule(stand-in store watch), started
//   mounted.poke();                               // every callback the module attached to the store watch, called
//   await rig.settle();                           // waits until the stand-in has heard nothing new for a while
//
// The stand-in is a script in the case's scratch folder (DISPATCHER_BIN). It keeps a small store of its own in
// state.json — the tickets `bug pending` lists and the notes `card notes` lists — and records every call it hears in
// calls.jsonl, with stdin for the verbs that read it. It answers as the house does, only as much as the board reads:
//   bug pending [--unplaced] --json   {"place": [...]} — tickets `filed`, plus `unplaced` ones under --unplaced; a
//                                     ticket seeded with `question` (a needs-you ticket's) lists it, as the house does
//   bug placed ID --result -          stamps the ticket placed (or unplaced); a ticket carrying failStamps > 0 fails
//                                     that many stamps first (exit 1, a stderr line), as a locked store would
//   card notes --json                 the notes not yet applied, as a JSON list
//   card applied ID [--result -]      marks the note applied and keeps the stamp it was given
//   card told / card config / other   recorded; told answers one line, config the defaults
// Nothing reaches the real dispatcher, and every write lands in the case's own database.

import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";

import { scratchDir } from "./scratch.mjs";

const STAND_IN = `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
const home = path.dirname(process.argv[1]); const argv = process.argv.slice(2);
const stateFile = path.join(home, "state.json");
const load = () => JSON.parse(fs.readFileSync(stateFile, "utf8"));
const save = (s) => { fs.writeFileSync(stateFile + ".tmp", JSON.stringify(s)); fs.renameSync(stateFile + ".tmp", stateFile); };
const log = (o) => fs.appendFileSync(path.join(home, "calls.jsonl"), JSON.stringify({ ...o, at: Date.now() }) + "\\n");
const stdin = () => { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } };
const [a, b] = argv;
if (a === "bug" && b === "pending") {
  log({ argv });
  const s = load(); const unplaced = argv.includes("--unplaced");
  const place = s.tickets.filter((t) => t.state === "filed" || (unplaced && t.state === "unplaced"))
    .map(({ id, source, path, title, description, priority, shots, tags, lane, question }) => ({ id, source, path, title, description, priority, shots, tags, lane, question }));
  console.log(JSON.stringify({ place }));
} else if (a === "bug" && b === "placed") {
  const input = stdin(); log({ argv, stdin: input });
  const s = load(); const t = s.tickets.find((x) => String(x.id) === argv[2]);
  if (!t) { console.log("REFUSED bug placed: no ticket " + argv[2]); process.exit(2); }
  if ((t.failStamps || 0) > 0) { t.failStamps -= 1; save(s); console.error("sqlite3.OperationalError: database is locked"); process.exit(1); }
  if (t.state === "placed") { console.log("PLACED ticket " + t.id + " — already placed; nothing changed"); process.exit(0); }
  const r = JSON.parse(input);
  if (r.unplaced) { t.state = "unplaced"; t.why = r.unplaced; console.log("UNPLACED ticket " + t.id + " — " + r.unplaced); }
  else { t.state = "placed"; t.board = r.board; t.card = r.card; console.log("PLACED ticket " + t.id + " — " + r.board.name + " — withdrawn"); }
  save(s);
} else if (a === "card" && b === "notes") {
  log({ argv });
  const s = load(); console.log(JSON.stringify(s.notes.filter((n) => !s.applied.includes(n.id))));
} else if (a === "card" && b === "applied") {
  const input = argv.includes("--result") ? stdin() : null; log({ argv, stdin: input });
  const s = load(); const id = Number(argv[2]); if (!s.applied.includes(id)) s.applied.push(id); s.results[id] = input; save(s);
  console.log("APPLIED note " + id);
} else if (a === "card" && b === "told") {
  const input = stdin(); log({ argv, stdin: input }); console.log("TOLD card");
} else if (a === "card" && b === "config") {
  log({ argv }); console.log(JSON.stringify({ width: 1, threshold: 0.8, age_days: 3, path: "/nowhere/cards.toml" }));
} else {
  log({ argv }); console.log("{}");
}
`;

/** The value after `--name` in an argv, or undefined. */
export const flag = (argv, name) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};

/**
 * A scratch folder holding the board's database, its attachments root and the stand-in dispatcher seeded with
 * `tickets` and `notes`. Sets DATABASE_PATH, KANBAN_ATTACHMENTS_ROOT and DISPATCHER_BIN, so it must run before any
 * server module is imported.
 */
export async function placingRig(t, label, { tickets = [], notes = [] } = {}) {
  const folder = await scratchDir(t, label);
  process.env.DATABASE_PATH = path.join(folder, "auth.db");
  process.env.KANBAN_ATTACHMENTS_ROOT = path.join(folder, "attachments");
  const bin = path.join(folder, "dispatcher");
  await writeFile(bin, STAND_IN);
  await chmod(bin, 0o755);
  process.env.DISPATCHER_BIN = bin;
  const stateFile = path.join(folder, "state.json");
  const seeded = { tickets: tickets.map((x) => ({ state: "filed", shots: [], tags: [], lane: "todo", ...x })), notes, applied: [], results: {} };
  await writeFile(stateFile, JSON.stringify(seeded));
  const callsFile = path.join(folder, "calls.jsonl");
  const calls = async () =>
    fs.existsSync(callsFile)
      ? (await readFile(callsFile, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line))
      : [];
  return {
    folder,
    calls,
    state: async () => JSON.parse(await readFile(stateFile, "utf8")),
    /** Adds notes to the stand-in's store, as a dispatcher walk writing them would. */
    addNotes: async (more) => {
      const s = JSON.parse(await readFile(stateFile, "utf8"));
      s.notes.push(...more);
      await writeFile(stateFile, JSON.stringify(s));
    },
    /** Makes the scratch database and loads the kanban barrel over it. */
    open: async () => {
      const database = await import("../../server/modules/database/index.ts");
      await database.initializeDatabase();
      const kanban = await import("../../server/modules/kanban/index.ts");
      return { database, kanban };
    },
    /**
     * Waits until the stand-in has heard no new call for `quietMs` (a pass spawns one process per verb, and a
     * loaded box makes each spawn slow), giving up after `maxMs`.
     */
    settle: async ({ quietMs = 2500, maxMs = 45000 } = {}) => {
      const end = Date.now() + maxMs;
      let seen = -1;
      let since = Date.now();
      while (Date.now() < end) {
        const now = (await calls()).length;
        if (now !== seen) {
          seen = now;
          since = Date.now();
        } else if (Date.now() - since >= quietMs) {
          return;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    },
  };
}

/**
 * Mounts the board-dispatch module the way the server does, `createKanbanDispatchModule(storeWatch)` then `start()`,
 * with a stand-in store watch that keeps every callback attached to it. `poke()` calls them all, as a store write
 * waking the watch would. Answers a sentence instead when the barrel will not load or has no factory.
 */
export async function mountBoardDispatch(t) {
  let mod;
  try {
    mod = await import("../../server/modules/kanban-dispatch/index.ts");
  } catch (error) {
    return { unmounted: `server/modules/kanban-dispatch/index.ts would not load: ${String(error?.message ?? error).split("\n")[0]}` };
  }
  if (typeof mod.createKanbanDispatchModule !== "function") return { unmounted: "the kanban-dispatch barrel exports no createKanbanDispatchModule" };
  const attached = [];
  const storeWatch = {
    attach: (_lane, callback) => {
      attached.push(callback);
      return () => {};
    },
    followChains: () => {},
    start: () => {},
    stop: () => {},
  };
  const made = mod.createKanbanDispatchModule(storeWatch);
  made.start();
  t.defer(() => made.stop());
  return { unmounted: null, poke: () => attached.forEach((callback) => callback()), attached };
}

/** Silences the module's journal for the case, keeping each line for a verdict that needs to quote one. */
export function quietJournal(t) {
  const heard = [];
  const { log, error } = console;
  console.log = (...args) => heard.push(args.map(String).join(" "));
  console.error = (...args) => heard.push(args.map(String).join(" "));
  t.defer(() => {
    console.log = log;
    console.error = error;
  });
  return heard;
}

/** Makes `folder` (and its parents) a git work tree's root: a board names only folders inside one. */
export async function gitFolder(folder) {
  await mkdir(folder, { recursive: true });
  execFileSync("git", ["init", "-q", folder], { stdio: "ignore" });
  return folder;
}

/** A one-pixel PNG, for a ticket's shot. */
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("0000000d49484452000000010000000108060000001f15c489", "hex"),
]);
