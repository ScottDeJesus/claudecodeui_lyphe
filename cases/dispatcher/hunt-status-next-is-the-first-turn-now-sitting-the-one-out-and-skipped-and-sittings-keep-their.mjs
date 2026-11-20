// `next` is the first turn of hunt_turns.order now, with `rehunt` true when that turn's last pass is done; `sitting`
// is the one out; `skipped` holds the newest 200 skipped units and `sittings` the newest 20. Projects Outer and Other,
// order security then code, turns project: every pass 1 is done, security/Other's longest ago (2026-10-01), so the
// first turn is that re-hunt — the status names it and maps nothing. code/Outer's pass 2 is open with one sitting out
// on tonight's open night, its deadline 02:30Z. 24 ended sittings sit on 24 October nights before it, so 25 in all:
// the 20 newest are listed, never the 5 oldest nights'. security/Other's pass 1 holds 205 skipped units marked a
// minute apart: the newest 200 are listed, never the 5 marked first.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_report.py, /home/lyphe/.claude/hooks/dispatcher/hunt_turns.py, /home/lyphe/.claude/hooks/dispatcher/store_hunts.py
// writes: none

import { exec, said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { snapshot } from "../lib/hunt_brief_house.mjs";
import { localDate, status, statusHouse, units } from "../lib/hunt_status_house.mjs";

runCase(async (t) => {
  const house = await statusHouse(t, "hunt-status-next", [{ name: "Outer", dir: "outer" }, { name: "Other", dir: "other" }],
    ["security", "code"]);
  const { Outer: outer, Other: other } = house.paths;
  const tonight = localDate();
  const deadline = `${tonight}T23:59:00Z`;
  await exec(house, `
    WITH RECURSIVE d(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM d WHERE i < 24)
      INSERT INTO hunt_nights (night, opened_at, minutes, state, closed_at, why)
      SELECT date('2026-10-01', '+' || (i - 1) || ' days'), date('2026-10-01', '+' || (i - 1) || ' days') || 'T08:00:00Z',
             120, 'closed', date('2026-10-01', '+' || (i - 1) || ' days') || 'T10:00:00Z', 'time spent' FROM d;
    INSERT INTO hunt_nights (night, opened_at, minutes, state) VALUES ('${tonight}', '${tonight}T08:00:00Z', 120, 'open');
    INSERT INTO hunt_passes (id, hunt, project, number, state, mapped_at, done_at) VALUES
      (1, 'security', '${outer}', 1, 'done', '2026-09-01T00:00:00Z', '2026-10-10T00:00:00Z'),
      (2, 'code', '${outer}', 1, 'done', '2026-09-01T00:00:00Z', '2026-10-12T00:00:00Z'),
      (3, 'security', '${other}', 1, 'done', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z'),
      (4, 'code', '${other}', 1, 'done', '2026-09-01T00:00:00Z', '2026-10-05T00:00:00Z'),
      (5, 'code', '${outer}', 2, 'open', '${tonight}T08:00:00Z', NULL);
    WITH RECURSIVE d(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM d WHERE i < 24)
      INSERT INTO hunt_sittings (id, night, hunt, project, pass_id, soul, model, state, outcome, started_at, ended_at)
      SELECT i, date('2026-10-01', '+' || (i - 1) || ' days'), 'security', '${other}', 3, 'argus', 'sonnet', 'ended',
             'wound down', date('2026-10-01', '+' || (i - 1) || ' days') || 'T08:00:00Z',
             date('2026-10-01', '+' || (i - 1) || ' days') || 'T09:00:00Z' FROM d;
    INSERT INTO hunt_sittings (id, night, hunt, project, pass_id, soul, model, launch_id, state, deadline, started_at) VALUES
      (25, '${tonight}', 'code', '${outer}', 5, 'hephaestus', 'sonnet', 'no-such-launch', 'out', '${deadline}', '${tonight}T08:00:00Z');
    ${units(1, [["covered", 2, { prefix: "so" }]])}
    ${units(2, [["covered", 2, { prefix: "co" }]])}
    ${units(4, [["covered", 2, { prefix: "cx" }]])}
    ${units(5, [["open", 3, { prefix: "co2" }]])}
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 205)
      INSERT INTO hunt_units (pass_id, unit, folder, position, fingerprint, state, note, handed, marked_at)
      SELECT 3, 'src/skip-' || i || '.py', 'src', i, 'fp' || i, 'skipped', 'could not open ' || i, 0,
             strftime('%Y-%m-%dT%H:%M:%SZ', '2026-10-01T00:00:00', '+' || i || ' minutes') FROM n;`);
  const before = await snapshot(house);
  const { ran, value } = await status(house);
  const after = await snapshot(house);
  if (ran.code !== 0 || value === null) return broken(`hunt status --json answered ${said(ran)}`);
  const wrong = [];
  const next = value.next ?? null;
  if (!next || next.hunt !== "security" || ![other, "Other"].includes(next.project) || next.rehunt !== true) {
    wrong.push(`next is ${JSON.stringify(next)}, not security over Other with rehunt true`);
  }
  const s = value.sitting ?? null;
  if (!s || s.hunt !== "code" || s.soul !== "hephaestus" || ![outer, "Outer"].includes(s.project) || s.deadline !== deadline) {
    wrong.push(`sitting is ${JSON.stringify(s)}, not the code sitting out on Outer with deadline ${deadline}`);
  }
  if (value.night?.night !== tonight || value.night?.state !== "open") wrong.push(`night is ${JSON.stringify(value.night)}, not tonight's open one`);
  const skipped = value.skipped ?? [];
  const names = new Set(skipped.map((u) => u.unit));
  if (skipped.length !== 200) wrong.push(`skipped lists ${skipped.length}, not 200`);
  const oldest = [1, 2, 3, 4, 5].map((i) => `src/skip-${i}.py`).filter((u) => names.has(u));
  if (oldest.length) wrong.push(`skipped lists the oldest ${oldest.join(", ")}`);
  if (!names.has("src/skip-205.py")) wrong.push("skipped leaves out the newest skip");
  const one = skipped.find((u) => u.unit === "src/skip-205.py");
  if (one && (one.reason !== "could not open 205" || one.hunt !== "security")) wrong.push(`a skipped row reads ${JSON.stringify(one)}`);
  const sittings = value.sittings ?? [];
  if (sittings.length !== 20) wrong.push(`sittings lists ${sittings.length}, not 20`);
  const old = sittings.filter((x) => x.night >= "2026-10-01" && x.night <= "2026-10-05").map((x) => x.night);
  if (old.length) wrong.push(`sittings lists the oldest nights ${old.join(", ")}`);
  if (!sittings.some((x) => x.night === tonight)) wrong.push("sittings leaves out tonight's sitting");
  if (before !== after) wrong.push("reading the status changed a hunt, proposal or ticket row (did it map the re-hunt?)");
  if (wrong.length) return broken(wrong.join("; "));
  return held(`next ${JSON.stringify(next)}; sitting code/${s.project} until ${s.deadline}; 200 skipped, 20 sittings, nothing written`);
});
