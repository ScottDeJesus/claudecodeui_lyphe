// `skipped` is every skip still standing in each hunt and project's newest pass. A `hunt reopen` of one skip over a DONE
// pass makes a new pass holding that one unit alone, so a reading of "the newest pass's skips" loses every other skip of
// the done pass, though each still stands and `hunt reopen` still acts on it. Project Outer, order code: pass 1 done with
// two covered and three skipped units (a, b, c). `dispatcher hunt reopen code Outer src/skip-a.py`, then `hunt status
// --json`: `skipped` must still list skip-b and skip-c (never skip-a), and `hunt reopen` of skip-b must still be taken.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_report.py, /home/lyphe/.claude/hooks/dispatcher/store_hunts.py
// writes: none

import { dispatcher, exec, said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { status, statusHouse, units } from "../lib/hunt_status_house.mjs";

runCase(async (t) => {
  const house = await statusHouse(t, "hunt-status-reopen-skips", [{ name: "Outer", dir: "outer" }], ["code"]);
  const outer = house.paths.Outer;
  await exec(house, `
    INSERT INTO hunt_passes (id, hunt, project, number, state, mapped_at, done_at) VALUES
      (1, 'code', '${outer}', 1, 'done', '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z');
    ${units(1, [["covered", 2, { prefix: "cov" }]])}
    INSERT INTO hunt_units (pass_id, unit, folder, position, fingerprint, state, note, handed, marked_at) VALUES
      (1, 'src/skip-a.py', 'src', 3, 'fa', 'skipped', 'binary a', 0, '2026-11-01T10:00:00Z'),
      (1, 'src/skip-b.py', 'src', 4, 'fb', 'skipped', 'binary b', 0, '2026-11-01T10:01:00Z'),
      (1, 'src/skip-c.py', 'src', 5, 'fc', 'skipped', 'binary c', 0, '2026-11-01T10:02:00Z');`);
  const before = await status(house);
  if (before.ran.code !== 0 || before.value === null) return broken(`hunt status --json answered ${said(before.ran)}`);
  const listedBefore = (before.value.skipped ?? []).map((u) => u.unit).sort();
  if (listedBefore.join(",") !== "src/skip-a.py,src/skip-b.py,src/skip-c.py") {
    return broken(`before the reopen skipped lists [${listedBefore.join(", ")}], not the three skips`);
  }
  const reopened = await dispatcher(house, ["hunt", "reopen", "code", "Outer", "src/skip-a.py"]);
  if (reopened.code !== 0) return broken(`hunt reopen of skip-a answered ${said(reopened)}`);
  const after = await status(house);
  if (after.ran.code !== 0 || after.value === null) return broken(`hunt status --json after the reopen answered ${said(after.ran)}`);
  const listed = (after.value.skipped ?? []).map((u) => u.unit).sort();
  const wrong = [];
  for (const u of ["src/skip-b.py", "src/skip-c.py"]) if (!listed.includes(u)) wrong.push(`${u} is gone from skipped`);
  if (listed.includes("src/skip-a.py")) wrong.push("the reopened skip-a is still listed as skipped");
  const again = await dispatcher(house, ["hunt", "reopen", "code", "Outer", "src/skip-b.py"]);
  if (again.code !== 0) wrong.push(`hunt reopen of skip-b answered ${said(again)}`);
  if (wrong.length) {
    return broken(`after reopening skip-a skipped lists [${listed.join(", ")}]: ${wrong.join("; ")}${again.code === 0 ? " (though hunt reopen still takes skip-b)" : ""}`);
  }
  return held(`after reopening skip-a skipped lists [${listed.join(", ")}] and hunt reopen still takes skip-b`);
});
