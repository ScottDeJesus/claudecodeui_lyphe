// `dispatcher hunt status` (the text form) prints one line per hunter and project in seam 9's words. code/Outer's
// pass 1 holds 1,256 files: 212 covered and 3 skipped over three nights (all 215 marked in the pass's last three, so
// 71.67 a night) and 1,041 open, which is 14.5 nights, rounded up to 15; 9 code tickets and 1 code proposal sit under
// Outer. Its line reads exactly
//   code · Outer · pass 1 · 212 of 1,256 files covered · 3 skipped · 1,041 not reached · 9 tickets · 1 proposal · about 15 nights left
// and code/Other (one ticket, two proposals) says `1 ticket` and `2 proposals`, never `1 tickets`.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_report.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py
// writes: none

import { exec, said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { proposal, status, statusHouse, ticket, units } from "../lib/hunt_status_house.mjs";

const NIGHTS = ["2026-11-16", "2026-11-17", "2026-11-18"];
const LINE = "code · Outer · pass 1 · 212 of 1,256 files covered · 3 skipped · 1,041 not reached · 9 tickets · 1 proposal · about 15 nights left";

runCase(async (t) => {
  const house = await statusHouse(t, "hunt-status-text", [{ name: "Outer", dir: "outer" }, { name: "Other", dir: "other" }], ["code"]);
  const { Outer: outer, Other: other } = house.paths;
  const nights = NIGHTS.map((n) => `('${n}', '${n}T08:00:00Z', 120, 'closed', '${n}T10:00:00Z', 'time spent')`).join(",\n");
  const sits = NIGHTS.map((n, i) => `(${i + 1}, '${n}', 'code', '${outer}', 1, 'hephaestus', 'sonnet', 'ended', 'wound down', '${n}T08:00:00Z', '${n}T09:00:00Z')`).join(",\n");
  const tickets = Array.from({ length: 9 }, (_, i) => ticket(i + 1, { hunt: "code", at: outer })).join("\n");
  await exec(house, `
    INSERT INTO hunt_nights (night, opened_at, minutes, state, closed_at, why) VALUES ${nights};
    INSERT INTO hunt_passes (id, hunt, project, number, state, mapped_at, done_at) VALUES
      (1, 'code', '${outer}', 1, 'open', '2026-11-16T08:00:00Z', NULL),
      (2, 'code', '${other}', 1, 'open', '2026-11-16T08:00:00Z', NULL);
    INSERT INTO hunt_sittings (id, night, hunt, project, pass_id, soul, model, state, outcome, started_at, ended_at) VALUES
      ${sits},
      (4, '${NIGHTS[2]}', 'code', '${other}', 2, 'hephaestus', 'sonnet', 'ended', 'wound down', '${NIGHTS[2]}T09:10:00Z', '${NIGHTS[2]}T09:40:00Z');
    ${units(1, [
      ["covered", 70, { sitting: 1, marked: `${NIGHTS[0]}T08:30:00Z`, prefix: "a" }],
      ["covered", 71, { sitting: 2, marked: `${NIGHTS[1]}T08:30:00Z`, prefix: "b" }],
      ["covered", 71, { sitting: 3, marked: `${NIGHTS[2]}T08:30:00Z`, prefix: "c" }],
      ["skipped", 3, { sitting: 3, marked: `${NIGHTS[2]}T08:40:00Z`, prefix: "s" }],
      ["open", 1041, { prefix: "o" }]])}
    ${units(2, [["covered", 2, { sitting: 4, marked: `${NIGHTS[2]}T09:20:00Z`, prefix: "x" }], ["open", 4, { prefix: "y" }]])}
    ${tickets}
    ${ticket(10, { hunt: "code", at: other })}
    ${proposal(1, { hunt: "code", at: outer })}
    ${proposal(2, { hunt: "code", at: other })}
    ${proposal(3, { hunt: "code", at: other })}`);
  const { ran } = await status(house, { json: false });
  if (ran.code !== 0) return broken(`hunt status answered ${said(ran)}`);
  const lines = ran.out.split("\n").map((l) => l.trim()).filter(Boolean);
  const wrong = [];
  const outerLine = lines.find((l) => l.startsWith("code · Outer"));
  if (outerLine !== LINE) wrong.push(`code/Outer's line is ${JSON.stringify(outerLine ?? null)}, not ${JSON.stringify(LINE)}`);
  const otherLine = lines.find((l) => l.startsWith("code · Other"));
  if (!otherLine) wrong.push("no line for code · Other");
  else {
    if (!/· 1 ticket ·/.test(otherLine) || /1 tickets/.test(otherLine)) wrong.push(`code/Other's line does not say "1 ticket": ${JSON.stringify(otherLine)}`);
    if (!/· 2 proposals\b/.test(otherLine)) wrong.push(`code/Other's line does not say "2 proposals": ${JSON.stringify(otherLine)}`);
  }
  const first = lines.findIndex((l) => l.startsWith("code · "));
  if (first <= 0) wrong.push("no line above the hunters' lines says the switch and tonight");
  else if (!lines.slice(0, first).some((l) => /\boff\b/i.test(l))) wrong.push(`the lines above the hunters' do not say the switch is off: ${JSON.stringify(lines.slice(0, first))}`);
  if (wrong.length) return broken(wrong.join("; "));
  return held(`"${outerLine}" and "${otherLine}"`);
});
