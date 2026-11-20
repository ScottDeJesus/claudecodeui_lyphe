// `hooks/dispatcher/store_hunts.py`'s `open_pass(conn, hunt, project, units)` is seam 4's rule for passes and re-hunts,
// and like every helper of a store module it commits nothing (INV-170): the caller's one `with conn:` closes the act.
// Pass 1 holds every unit of the map, `open`, at the map's positions; a map with no unit makes pass 1 `done` with no
// unit. A later pass holds the units whose (unit, fingerprint) no earlier pass covered: a unit skipped earlier at the
// same fingerprint comes in `skipped` with its reason, a changed or new one comes in `open`, one covered at the same
// fingerprint stays out. A later pass with no open unit is not made, and `None` is answered.
// `project` is the project's path, as hunt_passes.project holds it. The marks between passes are written here by plain
// SQL on the schema the store already holds, so this case judges `open_pass` alone and leans on no marking verb.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/store_hunts.py
// writes: none

import { broken, held, runCase } from "../lib/case.mjs";
import { lastLine, mapHouse, py } from "../lib/hunt_map_house.mjs";

const SCRIPT = String.raw`
import json, sqlite3
from collections import namedtuple
from dispatcher import store, store_hunts
try:
    from dispatcher.hunt_map import Unit
except Exception:
    Unit = namedtuple("Unit", "unit folder fingerprint")
P = "/scratch/project"
out = {}
conn = store.connect()

def units(pid):
    return [dict(r) for r in conn.execute(
        "SELECT unit, position, fingerprint, state, note FROM hunt_units WHERE pass_id = ? ORDER BY position", (pid,))]

M1 = [Unit("src/d.py", "src", "f1"), Unit("src/a.py", "src", "f1"), Unit("src/b.py", "src", "f1"), Unit("lib/c.py", "lib", "f1")]
M2 = [Unit("src/d.py", "src", "f2"), Unit("src/a.py", "src", "f1"), Unit("src/b.py", "src", "f1"),
      Unit("lib/c.py", "lib", "f2"), Unit("lib/e.py", "lib", "f1")]

def commits_nothing():
    store_hunts.open_pass(conn, "code", P, M1)
    other = sqlite3.connect(store.db_path())
    out["seen_by_another_before_commit"] = other.execute("SELECT count(*) FROM hunt_passes").fetchone()[0]
    other.close()
    conn.rollback()
    out["after_rollback"] = conn.execute("SELECT count(*) FROM hunt_passes").fetchone()[0]

def passes_and_rehunts():
    with conn:
        p1 = store_hunts.open_pass(conn, "code", P, M1)
    out["p1"] = units(p1)
    with conn:
        conn.execute("UPDATE hunt_units SET state='covered', note='read it' WHERE pass_id=? AND unit IN ('src/a.py','src/d.py')", (p1,))
        conn.execute("UPDATE hunt_units SET state='skipped', note='binary blob' WHERE pass_id=? AND unit='src/b.py'", (p1,))
        conn.execute("UPDATE hunt_units SET state='skipped', note='too big' WHERE pass_id=? AND unit='lib/c.py'", (p1,))
        conn.execute("UPDATE hunt_passes SET state='done', done_at='2026-11-19T00:00:00Z' WHERE id=?", (p1,))
    with conn:
        p2 = store_hunts.open_pass(conn, "code", P, M2)
    out["p2_number"] = conn.execute("SELECT number FROM hunt_passes WHERE id=?", (p2,)).fetchone()[0] if p2 else None
    out["p2"] = units(p2) if p2 else None
    with conn:
        conn.execute("UPDATE hunt_units SET state='covered', note='read it' WHERE pass_id=? AND state='open'", (p2,))
        conn.execute("UPDATE hunt_passes SET state='done', done_at='2026-11-19T01:00:00Z' WHERE id=?", (p2,))
    with conn:
        out["p3"] = store_hunts.open_pass(conn, "code", P, M2)
    with conn:
        pe = store_hunts.open_pass(conn, "ui", P, [])
    row = conn.execute("SELECT state FROM hunt_passes WHERE id=?", (pe,)).fetchone() if pe else None
    out["empty"] = {"state": row["state"] if row else None, "units": len(units(pe)) if pe else None}
    out["code_passes"] = conn.execute("SELECT count(*) FROM hunt_passes WHERE hunt='code'").fetchone()[0]

# A commit inside open_pass would leave the first step's pass behind; it is cleared so the second step still judges
# the pass rule on its own, and the first step's counts already name the commit.
for step in (commits_nothing, passes_and_rehunts):
    try:
        step()
    except Exception as e:
        out.setdefault("error", f"{step.__name__}: {type(e).__name__}: {e}")
        conn.rollback()
    if step is commits_nothing:
        with conn:
            conn.execute("DELETE FROM hunt_units")
            conn.execute("DELETE FROM hunt_passes")
print(json.dumps(out))
`;

runCase(async (t) => {
  const house = await mapHouse(t, "hunt-open-pass");
  const got = await py(house, SCRIPT);
  if (!got.json) return broken(`store_hunts.open_pass could not be run — ${lastLine(got)}`);
  const j = got.json;
  const wrong = [];
  if (j.seen_by_another_before_commit !== 0) wrong.push(`another connection saw ${j.seen_by_another_before_commit} pass before the caller committed — open_pass commits`);
  if (j.after_rollback !== 0) wrong.push(`a rollback left ${j.after_rollback} pass`);
  if (j.error) wrong.push(`it raised in ${j.error}`);
  const p1 = (j.p1 ?? []).map((u) => `${u.unit}:${u.state}`);
  if (JSON.stringify(p1) !== JSON.stringify(["src/d.py:open", "src/a.py:open", "src/b.py:open", "lib/c.py:open"])) wrong.push(`pass 1 reads ${JSON.stringify(p1)}, not the four units open in the map's order`);
  const p2 = Object.fromEntries((j.p2 ?? []).map((u) => [u.unit, u]));
  if (j.p2_number !== 2) wrong.push(`the second pass is number ${j.p2_number}`);
  if (p2["src/a.py"]) wrong.push("src/a.py, covered at the same fingerprint, came into pass 2");
  if (p2["src/b.py"]?.state !== "skipped" || p2["src/b.py"]?.note !== "binary blob") wrong.push(`src/b.py, skipped at the same fingerprint, came in as ${JSON.stringify(p2["src/b.py"])}, not skipped with "binary blob"`);
  for (const unit of ["src/d.py", "lib/c.py", "lib/e.py"]) if (p2[unit]?.state !== "open") wrong.push(`${unit} (changed or new) came in as ${JSON.stringify(p2[unit])}, not open`);
  if (p2["src/d.py"] && p2["src/d.py"].fingerprint !== "f2") wrong.push(`src/d.py carries fingerprint ${p2["src/d.py"].fingerprint}, not the new map's f2`);
  if (j.p3 !== null) wrong.push(`a third pass with nothing open answered ${JSON.stringify(j.p3)}, not None`);
  if (j.code_passes !== 2) wrong.push(`the store holds ${j.code_passes} code passes, not 2`);
  if (j.empty?.state !== "done" || j.empty?.units !== 0) wrong.push(`an empty map's pass 1 reads ${JSON.stringify(j.empty)}, not done with no unit`);
  if (wrong.length) return broken(wrong.join("; "));
  return held("open_pass committed nothing; pass 1 held four units open in the map's order; pass 2 left out the covered one, brought the same-fingerprint skip in skipped with its reason and the changed and new ones open; a third pass with nothing open answered None; an empty map made pass 1 done with no unit");
});
