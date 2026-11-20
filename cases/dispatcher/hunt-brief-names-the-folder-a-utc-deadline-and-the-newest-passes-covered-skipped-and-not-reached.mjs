// `dispatcher hunt brief HUNT PROJECT` gives the sitting's facts under the rulebook: the project's folder, the deadline
// in UTC, and the hunt's newest pass of that project with how much of it is covered, skipped and not reached, every
// figure counted from hunt_units at the read (INV-172). The scratch store holds code/Outer's done pass 1 and open
// pass 2 of 8 units (3 covered, 1 skipped, 4 open, two of the open ones already handed to an ended sitting), and
// beside them a security pass of Outer and a code pass of Other, so a count that reads the wrong pass or every pass is
// caught. No night is open, so the deadline is at most the config's 120 minutes from now. Building the brief hands
// out no unit: each unit's sitting_id, handed_at and handed read as they were.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_brief.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hunt_acts.py, /home/lyphe/.claude/hooks/dispatcher/store_hunts.py
// writes: none

import path from "node:path";

import { exec, rows, said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { brief, briefHouse } from "../lib/hunt_brief_house.mjs";
import { setProjects } from "../lib/hunt_map_house.mjs";

const HANDS = "SELECT id, sitting_id, handed_at, handed, state FROM hunt_units ORDER BY id";

/** The deadline a line names, read as UTC, or null when the line names none in UTC. */
function deadlineOf(line) {
  const m = /(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|\+00:00|UTC)(?:\s*UTC)?/.exec(line);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3] ?? "00"}Z`) : null;
}

runCase(async (t) => {
  const house = await briefHouse(t, "hunt-brief-facts", [], { code: "hephaestus" });
  const outer = path.join(house.dir, "outer");
  const other = path.join(house.dir, "other");
  setProjects(house, [{ name: "Outer", path: outer }, { name: "Other", path: other }]);
  const units = (pass, states) => states.map((s, i) => `(${pass}, 'src/f${i}.py', 'src', ${i + 1}, 'fp${i}', '${s}', ${s === "open" ? "NULL" : "'n'"}, ${i >= 6 ? "1, '2026-11-18T08:00:00Z', 1" : "NULL, NULL, 0"})`).join(",\n");
  await exec(house, `
    INSERT INTO hunt_nights (night, opened_at, minutes, state, closed_at, why) VALUES ('2026-11-18', '2026-11-18T08:00:00Z', 120, 'closed', '2026-11-18T10:00:00Z', 'time spent');
    INSERT INTO hunt_passes (id, hunt, project, number, state, mapped_at, done_at) VALUES
      (1, 'code', '${outer}', 1, 'done', '2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z'),
      (2, 'code', '${outer}', 2, 'open', '2026-11-18T08:00:00Z', NULL),
      (3, 'security', '${outer}', 1, 'open', '2026-11-18T08:00:00Z', NULL),
      (4, 'code', '${other}', 1, 'open', '2026-11-18T08:00:00Z', NULL);
    INSERT INTO hunt_sittings (id, night, hunt, project, pass_id, soul, model, state, outcome, started_at, ended_at) VALUES
      (1, '2026-11-18', 'code', '${outer}', 2, 'hephaestus', 'sonnet', 'ended', 'wound down', '2026-11-18T08:00:00Z', '2026-11-18T09:00:00Z');
    INSERT INTO hunt_units (pass_id, unit, folder, position, fingerprint, state, note, sitting_id, handed_at, handed) VALUES
      ${units(1, ["covered", "covered", "covered", "covered", "covered", "covered", "covered", "covered", "covered"])},
      ${units(2, ["covered", "covered", "covered", "skipped", "open", "open", "open", "open"])},
      ${units(3, ["covered", "open", "open"])},
      ${units(4, ["skipped", "skipped", "open"])};`);
  const before = JSON.stringify(await rows(house, HANDS));
  const now = Date.now();
  const ran = await brief(house, "code", "Outer");
  const after = JSON.stringify(await rows(house, HANDS));
  if (ran.code !== 0) return broken(`hunt brief code Outer answered ${said(ran)}`);
  const lines = ran.out.split("\n");
  const wrong = [];
  if (!lines.some((l) => l.includes(outer))) wrong.push(`no line names Outer's folder ${outer}`);
  const dl = lines.find((l) => /deadline/i.test(l));
  const when = dl ? deadlineOf(dl) : null;
  if (when === null) wrong.push(`no deadline line in UTC (${JSON.stringify(dl ?? null)})`);
  else if (when < now - 120000 || when > now + (120 + 2) * 60000) wrong.push(`the deadline ${new Date(when).toISOString()} is not within the night's 120 minutes from now`);
  const pass = lines.find((l) => /\bpass\s*2\b/i.test(l));
  if (!pass) wrong.push("no line names pass 2");
  else {
    if (!/\b3\b[^\n]*covered|covered\D{0,3}3\b/i.test(pass)) wrong.push(`the pass line does not say 3 covered: ${JSON.stringify(pass)}`);
    if (!/\b1 skipped|skipped\D{0,3}1\b/i.test(pass)) wrong.push(`the pass line does not say 1 skipped: ${JSON.stringify(pass)}`);
    if (!/\b4 not reached|not reached\D{0,3}4\b/i.test(pass)) wrong.push(`the pass line does not say 4 not reached: ${JSON.stringify(pass)}`);
  }
  if (lines.some((l) => /\bpass\s*1\b/i.test(l) && /covered/i.test(l))) wrong.push("it reports pass 1, not the newest pass");
  if (before !== after) wrong.push("building the brief moved a unit's sitting_id, handed_at, handed or state");
  if (wrong.length) return broken(wrong.join("; "));
  return held(`folder named, deadline ${new Date(when).toISOString()} UTC, "${pass.trim()}", no unit handed`);
});
