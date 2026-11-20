// Each hunt over each project reads its state in one of seam 9's six words. A (a git folder with one SQLite database)
// and B (none), order data, ui, code:
//   data/B  — B names no database: `no database named`.
//   data/A  — two sittings ended failed with no pass and the cause `could not be mapped: …`, an older and a newer
//             one: `could not be mapped`, its cause the NEWER fault's.
//   ui/A    — pass 1 done holding no unit (the lens took none of A's files): `nothing of its kind`.
//   code/A  — pass 1 done, every unit covered: `done`.
//   code/B  — pass 1 open, part covered: `hunting`.
//   ui/B    — no pass, no sitting: `not started`.
// The data rows say `tables`; every other row says `files`.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_report.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py
// writes: none

import { exec, said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { row, status, statusHouse, units } from "../lib/hunt_status_house.mjs";

runCase(async (t) => {
  const house = await statusHouse(t, "hunt-status-states", [
    { name: "A", dir: "a", databases: [{ name: "adb", kind: "sqlite", path: "a.sqlite" }] }, { name: "B", dir: "b" }],
  ["data", "ui", "code"]);
  const { A: a, B: b } = house.paths;
  await exec(house, `
    INSERT INTO hunt_nights (night, opened_at, minutes, state, closed_at, why) VALUES
      ('2026-11-17', '2026-11-17T08:00:00Z', 120, 'closed', '2026-11-17T10:00:00Z', 'time spent'),
      ('2026-11-18', '2026-11-18T08:00:00Z', 120, 'closed', '2026-11-18T10:00:00Z', 'nothing left to hunt');
    INSERT INTO hunt_passes (id, hunt, project, number, state, mapped_at, done_at) VALUES
      (1, 'ui', '${a}', 1, 'done', '2026-11-17T08:00:00Z', '2026-11-17T08:00:00Z'),
      (2, 'code', '${a}', 1, 'done', '2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z'),
      (3, 'code', '${b}', 1, 'open', '2026-11-17T08:00:00Z', NULL);
    INSERT INTO hunt_sittings (id, night, hunt, project, pass_id, soul, model, state, outcome, cause, started_at, ended_at) VALUES
      (1, '2026-11-17', 'data', '${a}', NULL, 'sherlock', 'sonnet', 'ended', 'failed', 'could not be mapped: the old fault', '2026-11-17T08:00:00Z', '2026-11-17T08:00:00Z'),
      (2, '2026-11-18', 'data', '${a}', NULL, 'sherlock', 'sonnet', 'ended', 'failed', 'could not be mapped: the new fault', '2026-11-18T08:00:00Z', '2026-11-18T08:00:00Z'),
      (3, '2026-11-17', 'code', '${b}', 3, 'hephaestus', 'sonnet', 'ended', 'wound down', NULL, '2026-11-17T08:05:00Z', '2026-11-17T09:00:00Z');
    ${units(2, [["covered", 4, { prefix: "a" }]])}
    ${units(3, [["covered", 2, { sitting: 3, prefix: "b" }], ["open", 3, { prefix: "bo" }]])}`);
  const { ran, value } = await status(house);
  if (ran.code !== 0 || value === null) return broken(`hunt status --json answered ${said(ran)}`);
  const wrong = [];
  const expect = [
    ["data", "B", "no database named", "tables"],
    ["data", "A", "could not be mapped", "tables"],
    ["ui", "A", "nothing of its kind", "files"],
    ["code", "A", "done", "files"],
    ["code", "B", "hunting", "files"],
    ["ui", "B", "not started", "files"],
  ];
  const seen = [];
  for (const [hunt, name, state, word] of expect) {
    const p = row(value, hunt, name);
    if (!p) { wrong.push(`no ${hunt}/${name} row`); continue; }
    seen.push(`${hunt}/${name} ${p.state}`);
    if (p.state !== state) wrong.push(`${hunt}/${name} reads ${JSON.stringify(p.state)}, not "${state}"`);
    if (p.unit_word !== word) wrong.push(`${hunt}/${name}'s unit word is ${JSON.stringify(p.unit_word)}, not "${word}"`);
  }
  const fault = row(value, "data", "A");
  if (fault && !String(fault.cause ?? "").includes("the new fault")) wrong.push(`data/A's cause ${JSON.stringify(fault.cause)} is not the newer map fault's`);
  const ok = row(value, "code", "A");
  if (ok && ok.cause != null) wrong.push(`code/A carries a cause ${JSON.stringify(ok.cause)}`);
  if (wrong.length) return broken(wrong.join("; "));
  return held(`${seen.join(", ")}; data/A's cause: ${fault.cause}`);
});
