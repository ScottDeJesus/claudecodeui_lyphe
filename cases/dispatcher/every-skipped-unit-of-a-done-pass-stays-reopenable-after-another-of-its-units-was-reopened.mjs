// `dispatcher hunt reopen HUNT PROJECT UNIT` (hooks/dispatcher/cmd/hunt_acts.py → store_hunts.reopen) puts a
// skipped unit back up for hunting. A done pass can hold several skipped units, and the operator may reopen each of
// them (the dashboard's skipped list gives each its own "Hunt it again" press). Reopening one of them must not take
// that way from the others.
//
//   code:     pass 1 done {a.py skipped, b.py skipped, c.py covered}; reopen a.py (it lands in a new open pass),
//             then reopen b.py while that pass is open.
//   security: pass 1 done {a.py skipped, b.py skipped, c.py covered}, pass 2 done {a.py covered} — the state a
//             reopen of a.py leaves once it is hunted; the project is unchanged, so no re-hunt pass will ever be
//             made. Then reopen b.py.
//
// Each reopen of b.py answers REOPENED b.py at exit 0, and b.py is then open in the newest pass of its hunt. The
// passes are written by plain SQL on the store's schema; the project is stored as its path.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/store_hunts.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hunt_acts.py
// writes: none

import { exec, rows, said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { hunt } from "../lib/hunt_house.mjs";
import { commit, gitInit, lastLine, mapHouse, put, py, setProjects } from "../lib/hunt_map_house.mjs";

const NEWEST = (kind) => `SELECT p.number, p.state, u.state AS unit_state FROM hunt_passes p
  LEFT JOIN hunt_units u ON u.pass_id = p.id AND u.unit = 'b.py'
  WHERE p.hunt = '${kind}' ORDER BY p.number DESC LIMIT 1`;

runCase(async (t) => {
  const house = await mapHouse(t, "hunt-reopen-each");
  const repo = await gitInit(house, "proj");
  for (const rel of ["a.py", "b.py", "c.py"]) put(repo, rel, `${rel}\n`);
  await commit(repo, "one", { daysAgo: 2 });
  setProjects(house, [{ name: "Proj", path: repo }]);
  const made = await py(house, "from dispatcher import store\nstore.connect().close()\nprint('{}')");
  if (made.code !== 0) return broken(`the scratch store could not be made — ${lastLine(made)}`);
  await exec(house, `
    INSERT INTO hunt_passes (id, hunt, project, number, state, mapped_at, done_at) VALUES
      (1, 'code', '${repo}', 1, 'done', '2026-11-17T00:00:00Z', '2026-11-18T00:00:00Z'),
      (2, 'security', '${repo}', 1, 'done', '2026-11-17T00:00:00Z', '2026-11-18T00:00:00Z'),
      (3, 'security', '${repo}', 2, 'done', '2026-11-18T01:00:00Z', '2026-11-18T02:00:00Z');
    INSERT INTO hunt_units (pass_id, unit, folder, position, fingerprint, state, note, marked_at) VALUES
      (1, 'a.py', '.', 1, 'f1', 'skipped', 'could not', '2026-11-17T01:00:00Z'),
      (1, 'b.py', '.', 2, 'f1', 'skipped', 'could not', '2026-11-17T01:00:00Z'),
      (1, 'c.py', '.', 3, 'f1', 'covered', 'read it', '2026-11-17T01:00:00Z'),
      (2, 'a.py', '.', 1, 'f1', 'skipped', 'could not', '2026-11-17T01:00:00Z'),
      (2, 'b.py', '.', 2, 'f1', 'skipped', 'could not', '2026-11-17T01:00:00Z'),
      (2, 'c.py', '.', 3, 'f1', 'covered', 'read it', '2026-11-17T01:00:00Z'),
      (3, 'a.py', '.', 1, 'f1', 'covered', 'read it', '2026-11-18T01:30:00Z');`);
  const wrong = [];

  const first = await hunt(house, ["reopen", "code", "Proj", "a.py"]);
  if (first.code !== 0 || !first.out.includes("REOPENED a.py")) wrong.push(`code: the first reopen, of a.py, answered ${said(first)}`);
  const open = await hunt(house, ["reopen", "code", "Proj", "b.py"]);
  const openNewest = (await rows(house, NEWEST("code")))[0];
  if (open.code !== 0 || !open.out.includes("REOPENED b.py") || openNewest?.state !== "open" || openNewest?.unit_state !== "open") {
    wrong.push(`code: reopen of b.py while a.py's pass is open answered ${said(open)}, the newest pass ${JSON.stringify(openNewest)}`);
  }

  const done = await hunt(house, ["reopen", "security", "Proj", "b.py"]);
  const doneNewest = (await rows(house, NEWEST("security")))[0];
  if (done.code !== 0 || !done.out.includes("REOPENED b.py") || doneNewest?.state !== "open" || doneNewest?.unit_state !== "open") {
    wrong.push(`security: reopen of b.py after a.py's reopened pass was done answered ${said(done)}, the newest pass ${JSON.stringify(doneNewest)}`);
  }

  if (wrong.length) return broken(wrong.join("; "));
  return held("b.py, skipped in a done pass, was reopened after a.py of the same pass had been: once while a.py's pass was open, once after it was done, each REOPENED b.py at exit 0 and open in the newest pass");
});
