// hunt_turns_house.mjs — a scratch home for the bug hunters' turn order (`dispatcher.hunt_turns.order`): scratch git
// projects, a hunts.toml naming them with the case's `order` and `turns`, and a child Python whose prelude seeds the
// four hunt tables by plain SQL and reads `order` under any rule.
//
//   import { turnsHouse, turnsPy } from "../lib/hunt_turns_house.mjs";
//   const house = await turnsHouse(t, "turns-walk", { projects: [{ name: "Zulu" }, { name: "Alpha" }], order: ["code"] });
//   const got = await turnsPy(house, `out["project"] = order("project", "2026-11-20")\nprint(json.dumps(out))`);
//
// The prelude gives the script: `conn` (store.connect() of the scratch home), `P` (project name -> path), `out` (a
// dict), `reset()` (empties the four hunt tables, committed), `night(date, state)`, `sitting(date, hunt, name,
// outcome, state="ended")`, `pass_(hunt, name, number, state, done_at)` (each one committed write), and
// `order(rule, night)` -> ["hunt·Project name", ...], the answer of hunt_turns.order under `rule`. A hunt_turns that
// will not import prints {"import_error": ...} and ends the script, so the case can say so in its verdict.
// A project names a database with `databases: ["name"]`: an empty scratch SQLite file, so the config keeps it.
// EVERY PATH IS SCRATCH (huntHouse): the store, the config and the repos live under the case's own folder.

import fs from "node:fs";
import path from "node:path";

import { gitInit, huntsToml, mapHouse, py } from "./hunt_map_house.mjs";

/** mapHouse's scratch home, one git folder per project (named for it), and a hunts.toml with this order and rule. */
export async function turnsHouse(t, label, { projects, order, turns = "project" }) {
  const house = await mapHouse(t, label, []);
  const specs = [];
  for (const p of projects) {
    const repo = await gitInit(house, p.name);
    const databases = (p.databases ?? []).map((name) => {
      const file = path.join(house.dir, `${name}.sqlite`);
      fs.writeFileSync(file, "");
      return { name, kind: "sqlite", path: file };
    });
    specs.push({ name: p.name, path: repo, databases });
  }
  const text = huntsToml(specs)
    .replace(/^order = .*$/m, `order = ${JSON.stringify(order)}`)
    .replace(/^turns = .*$/m, `turns = ${JSON.stringify(turns)}`);
  fs.writeFileSync(house.config, text);
  house.projects = Object.fromEntries(specs.map((s) => [s.name, s.path]));
  return house;
}

const PRELUDE = String.raw`
import json, sys
from dispatcher import store, hunt_config
try:
    from dispatcher import hunt_turns
except Exception as e:
    print(json.dumps({"import_error": f"{type(e).__name__}: {e}"}))
    sys.exit(0)
P = json.loads(sys.argv[1])
NAME = {v: k for k, v in P.items()}
config = hunt_config.read()
conn = store.connect()
out = {}

def reset():
    with conn:
        for table in ("hunt_units", "hunt_sittings", "hunt_passes", "hunt_nights"):
            conn.execute(f"DELETE FROM {table}")

def night(date, state="closed"):
    with conn:
        conn.execute("INSERT INTO hunt_nights (night, opened_at, minutes, state) VALUES (?, ?, 120, ?)",
                     (date, date + "T08:30:00Z", state))

def sitting(date, hunt, name, outcome, state="ended"):
    with conn:
        conn.execute("INSERT INTO hunt_sittings (night, hunt, project, soul, model, state, outcome, started_at, ended_at) "
                     "VALUES (?, ?, ?, 'hephaestus', 'opus', ?, ?, ?, ?)",
                     (date, hunt, P[name], state, outcome, date + "T08:31:00Z", date + "T08:40:00Z"))

def pass_(hunt, name, number, state, done_at=None):
    with conn:
        conn.execute("INSERT INTO hunt_passes (hunt, project, number, state, mapped_at, done_at) VALUES (?, ?, ?, ?, ?, ?)",
                     (hunt, P[name], number, state, "2026-09-01T00:00:00Z", done_at))

def _name(project):
    if hasattr(project, "name") and hasattr(project, "path"):
        return project.name
    return NAME.get(str(project), str(project))

def order(rule, date):
    turns = hunt_turns.order(conn, config._replace(turns=rule), date)
    return [f"{t[0]}·{_name(t[1])}" for t in turns]
`;

/** Run `body` after the prelude in the scratch home: { code, out, err, json } — json is the last line printed. */
export function turnsPy(house, body) {
  return py(house, PRELUDE + body, [JSON.stringify(house.projects)]);
}

/** Two lists said side by side for a verdict. */
export function sayList(got, want) {
  return `${JSON.stringify(got)}, not ${JSON.stringify(want)}`;
}
