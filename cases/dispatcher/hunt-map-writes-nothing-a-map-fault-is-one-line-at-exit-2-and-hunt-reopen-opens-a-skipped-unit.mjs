// `dispatcher hunt map HUNT PROJECT [--json]` (hooks/dispatcher/cmd/hunt.py) prints the map as it would be made now
// and writes nothing: after it the scratch store holds no hunt pass, unit or sitting. A map fault — a project whose
// folder does not exist, one outside git, one whose git tracks no file — is one line naming the fault, exit 2, and
// still writes nothing. `hunt map data` of a project that names no database says `no database named`.
// `dispatcher hunt reopen HUNT PROJECT UNIT` turns a `skipped` unit of the open pass `open` and prints
// `REOPENED <unit>`; when the last pass is done, the unit is open in a new pass and the done pass is left as it was.
// The passes reopen reads are written by plain SQL on the store's schema; the project is named as the config names it
// and stored as its path (hunt_passes.project).
//
// protects: /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py, /home/lyphe/.claude/hooks/dispatcher/hunt_map.py, /home/lyphe/.claude/hooks/dispatcher/store_hunts.py
// writes: none

import fs from "node:fs";
import path from "node:path";

import { exec, lines, rows, said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { hunt, parseJson } from "../lib/hunt_house.mjs";
import { commit, gitInit, lastLine, mapHouse, put, py, setProjects } from "../lib/hunt_map_house.mjs";

const COUNTS = "SELECT (SELECT count(*) FROM hunt_passes) AS passes, (SELECT count(*) FROM hunt_units) AS units, (SELECT count(*) FROM hunt_sittings) AS sittings";

function totalOf(j) {
  for (const v of [j?.total, j?.units, j?.count]) {
    if (typeof v === "number") return v;
    if (Array.isArray(v)) return v.length;
  }
  return undefined;
}

runCase(async (t) => {
  const house = await mapHouse(t, "hunt-map-cli");
  const repo = await gitInit(house, "proj");
  for (const rel of ["src/a.py", "src/b.py", "lib/c.py", "README.md"]) put(repo, rel, `${rel}\n`);
  await commit(repo, "one", { daysAgo: 2 });
  const empty = await gitInit(house, "empty");
  const loose = path.join(house.dir, "loose");
  fs.mkdirSync(loose, { recursive: true });
  put(loose, "x.py", "x\n");
  setProjects(house, [
    { name: "Proj", path: repo },
    { name: "Gone", path: path.join(house.dir, "does-not-exist") },
    { name: "Loose", path: loose },
    { name: "Empty", path: empty },
  ]);
  const counts = async () => (fs.existsSync(house.db) ? (await rows(house, COUNTS))[0] : { passes: 0, units: 0, sittings: 0 });
  const wrong = [];

  const shown = await hunt(house, ["map", "code", "Proj", "--json"]);
  const j = parseJson(shown);
  if (shown.code !== 0 || totalOf(j) !== 3) wrong.push(`hunt map code Proj --json answered ${said(shown)} — not exit 0 with a total of 3 (src/a.py, src/b.py, lib/c.py)`);
  const text = await hunt(house, ["map", "code", "Proj"]);
  if (text.code !== 0 || !/\b3\b/.test(text.out)) wrong.push(`hunt map code Proj answered ${said(text)}, not exit 0 with its total 3`);

  for (const name of ["Gone", "Loose", "Empty"]) {
    const ran = await hunt(house, ["map", "code", name]);
    if (ran.code !== 2 || lines(ran).length !== 1) wrong.push(`hunt map code ${name} answered ${said(ran)}, not one line at exit 2`);
  }
  const data = await hunt(house, ["map", "data", "Proj"]);
  if (!/no database named/.test(`${data.out}${data.err}`)) wrong.push(`hunt map data Proj answered ${said(data)}, not "no database named"`);
  const after = await counts();
  if (after.passes || after.units || after.sittings) wrong.push(`hunt map wrote ${JSON.stringify(after)}`);

  const made = await py(house, "from dispatcher import store\nstore.connect().close()\nprint('{}')");
  if (made.code !== 0) return broken(`the scratch store could not be made — ${lastLine(made)}`);
  await exec(house, `
    INSERT INTO hunt_passes (id, hunt, project, number, state, mapped_at) VALUES (1, 'code', '${repo}', 1, 'open', '2026-11-18T00:00:00Z');
    INSERT INTO hunt_units (pass_id, unit, folder, position, fingerprint, state, note) VALUES
      (1, 'src/a.py', 'src', 1, 'f1', 'skipped', 'could not read it'), (1, 'src/b.py', 'src', 2, 'f1', 'covered', 'read it');
    INSERT INTO hunt_passes (id, hunt, project, number, state, mapped_at, done_at) VALUES (2, 'security', '${repo}', 1, 'done', '2026-11-17T00:00:00Z', '2026-11-18T00:00:00Z');
    INSERT INTO hunt_units (pass_id, unit, folder, position, fingerprint, state, note) VALUES
      (2, 'lib/c.py', 'lib', 1, 'f1', 'skipped', 'too big'), (2, 'src/a.py', 'src', 2, 'f1', 'covered', 'read it');`);

  const open = await hunt(house, ["reopen", "code", "Proj", "src/a.py"]);
  const reopened = (await rows(house, "SELECT state FROM hunt_units WHERE pass_id = 1 AND unit = 'src/a.py'"))[0]?.state;
  if (open.code !== 0 || !open.out.includes("REOPENED src/a.py") || reopened !== "open") wrong.push(`reopen of the open pass's skipped unit answered ${said(open)} and left it ${reopened}`);
  const codePasses = (await rows(house, "SELECT count(*) AS n FROM hunt_passes WHERE hunt = 'code'"))[0].n;
  if (codePasses !== 1) wrong.push(`reopen in an open pass made a pass (${codePasses} code passes)`);

  const fresh = await hunt(house, ["reopen", "security", "Proj", "lib/c.py"]);
  const newest = await rows(house, "SELECT p.number, p.state, u.state AS unit_state FROM hunt_passes p LEFT JOIN hunt_units u ON u.pass_id = p.id AND u.unit = 'lib/c.py' WHERE p.hunt = 'security' ORDER BY p.number DESC LIMIT 1");
  const doneUnit = (await rows(house, "SELECT state FROM hunt_units WHERE pass_id = 2 AND unit = 'lib/c.py'"))[0]?.state;
  const n = newest[0];
  if (fresh.code !== 0 || !fresh.out.includes("REOPENED lib/c.py") || n?.number !== 2 || n?.state !== "open" || n?.unit_state !== "open") wrong.push(`reopen in a done pass answered ${said(fresh)} with the newest security pass ${JSON.stringify(n)}, not pass 2 open holding lib/c.py open`);
  if (doneUnit !== "skipped") wrong.push(`the done pass's unit was moved to ${doneUnit}`);

  if (wrong.length) return broken(wrong.join("; "));
  return held("hunt map printed a total of 3 and wrote no row; Gone, Loose and Empty each faulted in one line at exit 2; data said no database named; reopen opened the open pass's skipped unit, and a done pass's in a new pass 2");
});
