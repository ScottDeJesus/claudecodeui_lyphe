// `hooks/dispatcher/hunt_map_tables.py`'s `tables(project)` is the data hunt's map: every table of every database the
// project names, as `<database>.<table>` in the folder of its database. SQLite is opened read-only (`mode=ro`), so the
// file's bytes are the same after the read and no journal is left beside it. A table's fingerprint is a digest of its
// columns (name, type, nullable) and its row count, so a re-read of unchanged tables gives the same fingerprints, a row
// added moves that table's alone and a column added moves that table's alone. A database that lists no table, and
// one whose file is missing, raise MapFault: a fault is not an empty map. Run over scratch SQLite files.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_map_tables.py
// writes: none

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { lastLine, mapHouse, py, setProjects } from "../lib/hunt_map_house.mjs";

const SQL = String.raw`
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
conn.executescript(sys.argv[2])
conn.commit()
conn.close()
print("{}")
`;

const MAP = String.raw`
import json, sys
from dispatcher import hunt_config, hunt_map, hunt_map_tables
cfg = hunt_config.read()
try:
    units = hunt_map_tables.tables(cfg.project(sys.argv[1]))
    print(json.dumps({"units": [[u.unit, u.folder, u.fingerprint] for u in units]}))
except hunt_map.MapFault as e:
    print(json.dumps({"fault": str(e) or "MapFault"}))
except Exception as e:
    fault = getattr(hunt_map_tables, "MapFault", None)
    if fault is not None and isinstance(e, fault):
        print(json.dumps({"fault": str(e) or "MapFault"}))
    else:
        print(json.dumps({"other": f"{type(e).__name__}: {e}"}))
`;

const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

runCase(async (t) => {
  const house = await mapHouse(t, "hunt-map-tables");
  const db = path.join(house.dir, "scratch.db");
  const empty = path.join(house.dir, "empty.db");
  const seeded = await py(house, SQL, [db, "CREATE TABLE jobs (id INTEGER PRIMARY KEY, name TEXT NOT NULL); CREATE TABLE tags (t TEXT); INSERT INTO jobs (name) VALUES ('a'), ('b'), ('c');"]);
  const made = await py(house, SQL, [empty, "PRAGMA user_version = 1;"]);
  if (seeded.code !== 0 || made.code !== 0) return broken(`the scratch databases could not be made — ${lastLine(seeded.code ? seeded : made)}`);
  setProjects(house, [
    { name: "Data", path: house.repo, databases: [{ name: "scratch", kind: "sqlite", path: db }] },
    { name: "Empty", path: house.repo, databases: [{ name: "nothing", kind: "sqlite", path: empty }] },
    { name: "Missing", path: house.repo, databases: [{ name: "gone", kind: "sqlite", path: path.join(house.dir, "no-such.db") }] },
  ]);
  const map = async (name) => (await py(house, MAP, [name]));

  const before = sha(db);
  const one = await map("Data");
  if (!one.json) return broken(`hunt_map_tables.tables could not be run — ${lastLine(one)}`);
  if (!one.json.units) return broken(`the scratch database did not map: ${JSON.stringify(one.json)}`);
  const wrong = [];
  const fp = (read) => Object.fromEntries((read.json?.units ?? []).map(([unit, , f]) => [unit, f]));
  const names = one.json.units.map((u) => u[0]).sort();
  if (JSON.stringify(names) !== JSON.stringify(["scratch.jobs", "scratch.tags"])) wrong.push(`the units read ${JSON.stringify(names)}, not scratch.jobs and scratch.tags`);
  for (const [unit, folder] of one.json.units) if (folder !== "scratch") wrong.push(`${unit}'s folder reads ${JSON.stringify(folder)}, not "scratch"`);
  if (sha(db) !== before) wrong.push("the read changed the database file's bytes");
  for (const side of ["-journal", "-wal"]) if (fs.existsSync(db + side)) wrong.push(`the read left ${path.basename(db + side)} beside the file`);

  const again = fp(await map("Data"));
  const f1 = fp(one);
  if (again["scratch.jobs"] !== f1["scratch.jobs"] || again["scratch.tags"] !== f1["scratch.tags"]) wrong.push("a re-read of unchanged tables gave other fingerprints");

  await py(house, SQL, [db, "INSERT INTO jobs (name) VALUES ('d');"]);
  const rowsMoved = fp(await map("Data"));
  if (rowsMoved["scratch.jobs"] === f1["scratch.jobs"]) wrong.push("a row added to jobs left its fingerprint the same");
  if (rowsMoved["scratch.tags"] !== f1["scratch.tags"]) wrong.push("a row added to jobs moved tags' fingerprint");

  await py(house, SQL, [db, "ALTER TABLE tags ADD COLUMN weight INTEGER NOT NULL DEFAULT 0;"]);
  const colsMoved = fp(await map("Data"));
  if (colsMoved["scratch.tags"] === rowsMoved["scratch.tags"]) wrong.push("a column added to tags left its fingerprint the same");
  if (colsMoved["scratch.jobs"] !== rowsMoved["scratch.jobs"]) wrong.push("a column added to tags moved jobs' fingerprint");

  for (const name of ["Empty", "Missing"]) {
    const read = await map(name);
    if (!read.json?.fault) wrong.push(`the ${name.toLowerCase()} database answered ${JSON.stringify(read.json) ?? lastLine(read)}, not a MapFault`);
  }
  if (wrong.length) return broken(wrong.join("; "));
  return held("scratch.jobs and scratch.tags mapped in folder scratch with the file's bytes unchanged; the same fingerprints on a re-read, a row moved only jobs', a column only tags'; an empty and a missing database each raised MapFault");
});
