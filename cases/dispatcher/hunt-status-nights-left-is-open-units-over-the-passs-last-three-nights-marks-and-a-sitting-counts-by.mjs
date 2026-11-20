// `nights_left` is a pass's open units over the units marked per night across THAT PASS's last three nights, rounded
// up; null before its first sitting. code/Outer's pass 1 holds 102 units: its four nights' sittings marked 50, 4
// (3 covered, 1 skipped), 6 and 5 (4 covered, 1 skipped), and 37 are open. The last three of its nights marked 15,
// five a night, so 37 / 5 = 7.4 reads 8. A newer night (2026-11-18) held only a security sitting that marked nothing:
// counting the box's last three nights instead of the pass's would read 11, counting every night of the pass 3.
// code/Other's pass has no sitting: null. security/Outer's one night marked nothing: the read must still answer.
// A sitting's figures are counted by its id: the 2026-11-17 sitting (08:00 to 08:45, `tickets filed`) covered 4,
// skipped 1, filed 2 tickets (by sitting_id), and 1 proposal (a proposal holds no sitting id, so it is the code
// hunt's proposal under Outer made inside the sitting's own start and end; one made at 12:00 that day is no one's).
// `last` of code/Outer is that sitting: its night, its 45 minutes, its outcome and its 4 covered.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_report.py, /home/lyphe/.claude/hooks/dispatcher/store_hunts.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/store_proposals.py
// writes: none

import { exec, said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { proposal, row, status, statusHouse, ticket, units } from "../lib/hunt_status_house.mjs";

const NIGHTS = ["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18"];

runCase(async (t) => {
  const house = await statusHouse(t, "hunt-status-nights-left", [{ name: "Outer", dir: "outer" }, { name: "Other", dir: "other" }],
    ["security", "code"]);
  const { Outer: outer, Other: other } = house.paths;
  const nights = NIGHTS.map((n) => `('${n}', '${n}T08:00:00Z', 120, 'closed', '${n}T10:00:00Z', 'time spent')`).join(",\n");
  const sit = (id, night, hunt, proj, pass, end, outcome) =>
    `(${id}, '${night}', '${hunt}', '${proj}', ${pass}, '${hunt === "code" ? "hephaestus" : "argus"}', 'sonnet', 'ended', '${outcome}', '${night}T08:00:00Z', '${night}T${end}:00Z')`;
  await exec(house, `
    INSERT INTO hunt_nights (night, opened_at, minutes, state, closed_at, why) VALUES ${nights};
    INSERT INTO hunt_passes (id, hunt, project, number, state, mapped_at, done_at) VALUES
      (1, 'code', '${outer}', 1, 'open', '2026-11-14T08:00:00Z', NULL),
      (2, 'code', '${other}', 1, 'open', '2026-11-14T08:00:00Z', NULL),
      (3, 'security', '${outer}', 1, 'open', '2026-11-18T08:00:00Z', NULL);
    INSERT INTO hunt_sittings (id, night, hunt, project, pass_id, soul, model, state, outcome, started_at, ended_at) VALUES
      ${sit(1, NIGHTS[0], "code", outer, 1, "09:00", "wound down")},
      ${sit(2, NIGHTS[1], "code", outer, 1, "08:30", "wound down")},
      ${sit(3, NIGHTS[2], "code", outer, 1, "09:00", "wound down")},
      ${sit(4, NIGHTS[3], "code", outer, 1, "08:45", "tickets filed")},
      ${sit(5, NIGHTS[4], "security", outer, 3, "08:20", "wound down")};
    ${units(1, [
      ["covered", 50, { sitting: 1, marked: `${NIGHTS[0]}T08:30:00Z`, prefix: "n1" }],
      ["covered", 3, { sitting: 2, marked: `${NIGHTS[1]}T08:10:00Z`, prefix: "n2c" }],
      ["skipped", 1, { sitting: 2, marked: `${NIGHTS[1]}T08:20:00Z`, prefix: "n2s" }],
      ["covered", 6, { sitting: 3, marked: `${NIGHTS[2]}T08:30:00Z`, prefix: "n3" }],
      ["covered", 4, { sitting: 4, marked: `${NIGHTS[3]}T08:20:00Z`, prefix: "n4c" }],
      ["skipped", 1, { sitting: 4, marked: `${NIGHTS[3]}T08:30:00Z`, prefix: "n4s" }],
      ["open", 37, { prefix: "open" }]])}
    ${units(2, [["open", 3, { prefix: "other" }]])}
    ${units(3, [["open", 5, { prefix: "sec" }]])}
    ${ticket(1, { hunt: "code", at: outer, sitting: 4 })}
    ${ticket(2, { hunt: "code", at: `${outer}/src`, sitting: 4 })}
    ${ticket(3, { hunt: "code", at: outer, sitting: 3 })}
    ${proposal(1, { hunt: "code", at: outer, when: `${NIGHTS[3]}T08:10:00Z` })}
    ${proposal(2, { hunt: "code", at: outer, when: `${NIGHTS[2]}T08:20:00Z` })}
    ${proposal(3, { hunt: "code", at: outer, when: `${NIGHTS[3]}T12:00:00Z` })}`);
  const { ran, value } = await status(house);
  if (ran.code !== 0 || value === null) return broken(`hunt status --json answered ${said(ran)}`);
  const wrong = [];
  const want = (label, got, expected) => {
    if (JSON.stringify(got) !== JSON.stringify(expected)) wrong.push(`${label} is ${JSON.stringify(got)}, not ${JSON.stringify(expected)}`);
  };
  const co = row(value, "code", "Outer");
  if (!co) return broken("no code/Outer row");
  want("code/Outer figures", { total: co.total, covered: co.covered, skipped: co.skipped, open: co.open }, { total: 102, covered: 63, skipped: 2, open: 37 });
  want("code/Outer nights_left", co.nights_left, 8);
  want("code/Other nights_left", row(value, "code", "Other")?.nights_left, null);
  if (!row(value, "security", "Outer")) wrong.push("no security/Outer row");
  const last = co.last ?? {};
  want("code/Outer last", { night: last.night, minutes: last.minutes, outcome: last.outcome, covered: last.covered },
    { night: NIGHTS[3], minutes: 45, outcome: "tickets filed", covered: 4 });
  const s4 = (value.sittings ?? []).find((s) => s.night === NIGHTS[3] && s.hunt === "code");
  if (!s4) wrong.push(`no sitting row for ${NIGHTS[3]} code: ${JSON.stringify(value.sittings ?? null).slice(0, 200)}`);
  else want(`the ${NIGHTS[3]} sitting`, { soul: s4.soul, minutes: s4.minutes, outcome: s4.outcome, covered: s4.covered, skipped: s4.skipped, tickets: s4.tickets, proposals: s4.proposals },
    { soul: "hephaestus", minutes: 45, outcome: "tickets filed", covered: 4, skipped: 1, tickets: 2, proposals: 1 });
  const s3 = (value.sittings ?? []).find((s) => s.night === NIGHTS[2] && s.hunt === "code");
  if (s3) want(`the ${NIGHTS[2]} sitting`, { covered: s3.covered, tickets: s3.tickets, proposals: s3.proposals }, { covered: 6, tickets: 1, proposals: 1 });
  else wrong.push(`no sitting row for ${NIGHTS[2]} code`);
  want("sittings listed", (value.sittings ?? []).length, 5);
  if (wrong.length) return broken(wrong.join("; "));
  return held(`nights_left 8 (37 open over 15 marked in the pass's last three nights), null with no sitting; the ${NIGHTS[3]} sitting: 45 min, 4 covered, 1 skipped, 2 tickets, 1 proposal`);
});
