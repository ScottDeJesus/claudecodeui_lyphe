// hunt_status_house.mjs — a scratch home for `dispatcher hunt status [--json]`: the brief's scratch home (a made store,
// a scratch launch table, a scratch hunts.toml) naming the projects a case gives, in the hunt order it gives, and the
// status read back as JSON or as its text lines.
//
//   import { statusHouse, status, row, units, localDate } from "../lib/hunt_status_house.mjs";
//   const house = await statusHouse(t, "status", [{ name: "Outer", dir: "outer" }], ["code"]);
//   house.paths.Outer                                     // <scratch>/outer, made
//   await exec(house, units(1, [["covered", 3], ["open", 4]]));   // SQL inserting a pass's units in states
//   const got = await status(house);                       // { ran, value } — value is the parsed JSON or null
//   const p = row(got.value, "code", "Outer");             // that hunt's entry for that project, or null
//
// EVERY PATH IS SCRATCH (briefHouse): DISPATCHER_HOME, HUNTS_CONFIG_PATH and LAUNCH_TABLE_PATH name files under the
// case's own folder, so the operator's store, config and table are never read or written.

import fs from "node:fs";
import path from "node:path";

import { dispatcher } from "./bug_house.mjs";
import { briefHouse } from "./hunt_brief_house.mjs";
import { huntsToml } from "./hunt_map_house.mjs";

export const SOULS = { security: "argus", behaviour: "athena", ui: "iris", data: "sherlock", code: "hephaestus" };

/** briefHouse with `projects` ({ name, dir, databases? }; dir, and a database's relative path, are under the scratch
 *  folder) and `order`. */
export async function statusHouse(t, label, projects, order) {
  const house = await briefHouse(t, label, [], SOULS);
  house.paths = {};
  const listed = projects.map((p) => {
    const where = path.join(house.dir, p.dir);
    fs.mkdirSync(where, { recursive: true });
    house.paths[p.name] = where;
    const databases = (p.databases ?? []).map((d) => (d.path && !d.path.startsWith("/") ? { ...d, path: path.join(house.dir, d.path) } : d));
    return { name: p.name, path: where, databases };
  });
  const text = huntsToml(listed).replace(/^order = .*$/m, `order = ${JSON.stringify(order)}`);
  fs.writeFileSync(house.config, text);
  return house;
}

/** `dispatcher hunt status --json` (or the text form with json: false): { ran, value }. */
export async function status(house, { json = true } = {}) {
  const ran = await dispatcher(house, ["hunt", "status", ...(json ? ["--json"] : [])]);
  let value = null;
  if (json && ran.code === 0) {
    try { value = JSON.parse(ran.out.trim().split("\n").pop()); } catch { /* left null */ }
  }
  return { ran, value };
}

/** The entry of `hunt` for the project named `name` in a status answer, or null. */
export function row(value, hunt, name) {
  const entry = (value?.hunts ?? []).find((h) => h.hunt === hunt);
  return (entry?.projects ?? []).find((p) => p.name === name) ?? null;
}

/**
 * SQL inserting the units of one pass: `groups` is [[state, count, { sitting, marked, prefix }?], …], laid out by
 * position in the order given. A marked unit carries its note, its sitting and its marked_at; an open one none.
 * Counts are made by a recursive CTE, so a pass of a thousand units is one statement.
 */
export function units(passId, groups) {
  let start = 0;
  return groups.map(([state, count, opts = {}], g) => {
    const first = start + 1;
    start += count;
    const prefix = opts.prefix ?? `g${g}`;
    const marked = state !== "open";
    const note = marked ? `'${state} ${prefix}'` : "NULL";
    const sitting = opts.sitting ?? "NULL";
    const markedAt = marked ? `'${opts.marked ?? "2026-11-01T12:00:00Z"}'` : "NULL";
    const handed = opts.sitting ? 1 : 0;
    return `WITH RECURSIVE n(i) AS (SELECT ${first} UNION ALL SELECT i + 1 FROM n WHERE i < ${start})
      INSERT INTO hunt_units (pass_id, unit, folder, position, fingerprint, state, note, sitting_id, handed_at, handed, marked_at)
      SELECT ${passId}, 'src/${prefix}-' || i || '.py', 'src', i, 'fp' || i, '${state}', ${note}, ${sitting},
             ${opts.sitting ? markedAt : "NULL"}, ${handed}, ${markedAt} FROM n;`;
  }).join("\n");
}

/** The box's local date (what a night is named by), as YYYY-MM-DD. */
export function localDate(when = new Date()) {
  return when.toLocaleDateString("en-CA");
}

/** One ticket row by hand: the columns a ticket must hold, with this hunt, path, state and sitting. */
export function ticket(id, { hunt = null, at, state = "filed", sitting = null, source = "hunter" }) {
  const h = hunt === null ? "NULL" : `'${hunt}'`;
  return `INSERT INTO tickets (id, source, path, title, words, priority, reporter, state, filed_at, hunt, sitting_id)
    VALUES (${id}, '${source}', '${at}', 'ticket ${id}', 'w', 'medium', '{}', '${state}', '2026-11-10T00:00:00Z', ${h}, ${sitting ?? "NULL"});`;
}

/** One proposal row by hand: this hunt, path, state and moment it was proposed. */
export function proposal(id, { hunt = null, at, state = "open", when = "2026-11-10T00:00:00Z" }) {
  const h = hunt === null ? "NULL" : `'${hunt}'`;
  return `INSERT INTO proposals (id, path, title, words, kind, priority, state, reporter, hunt, proposed_at)
    VALUES (${id}, '${at}', 'proposal ${id}', 'w', 'design', 'medium', '${state}', '{}', ${h}, '${when}');`;
}
