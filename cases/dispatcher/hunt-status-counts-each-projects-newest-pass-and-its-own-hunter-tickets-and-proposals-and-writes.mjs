// `dispatcher hunt status --json` counts every figure at the read (INV-172), of the NEWEST pass of each hunt over each
// project, and gives a ticket or a proposal to the project whose folder holds its path — the innermost listed one,
// as hunt_config.project_of decides. The scratch store holds code/Outer's done pass 1 (9 covered) and open pass 2
// (3 covered, 1 skipped, 4 open), code/Inner's open pass 1 (1 covered, 2 open) where Inner sits inside Outer's
// folder, and no security pass. Tickets: two code ones under Outer (one closed, still a row), one under Inner, one
// under `outer-two` (a sibling whose path only shares Outer's prefix), one security one under Outer, one chat ticket
// under Outer (no hunt). Proposals: one code under Outer, one code under Inner, one chat. Reading the status writes
// no row of any hunt, proposal or ticket table.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_report.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py, /home/lyphe/.claude/hooks/dispatcher/store_hunts.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/store_proposals.py
// writes: none

import { exec, said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { snapshot } from "../lib/hunt_brief_house.mjs";
import { proposal, row, status, statusHouse, ticket, units } from "../lib/hunt_status_house.mjs";

const KINDS = ["security", "behaviour", "ui", "data", "code"];

runCase(async (t) => {
  const house = await statusHouse(t, "hunt-status-counts", [
    { name: "Outer", dir: "outer" }, { name: "Inner", dir: "outer/inner" }, { name: "Two", dir: "outer-two" }],
  ["security", "code"]);
  const { Outer: outer, Inner: inner, Two: two } = house.paths;
  await exec(house, `
    INSERT INTO hunt_nights (night, opened_at, minutes, state, closed_at, why) VALUES
      ('2026-11-18', '2026-11-18T08:00:00Z', 120, 'closed', '2026-11-18T10:00:00Z', 'time spent');
    INSERT INTO hunt_passes (id, hunt, project, number, state, mapped_at, done_at) VALUES
      (1, 'code', '${outer}', 1, 'done', '2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z'),
      (2, 'code', '${outer}', 2, 'open', '2026-11-18T08:00:00Z', NULL),
      (3, 'code', '${inner}', 1, 'open', '2026-11-18T08:00:00Z', NULL);
    INSERT INTO hunt_sittings (id, night, hunt, project, pass_id, soul, model, state, outcome, started_at, ended_at) VALUES
      (1, '2026-11-18', 'code', '${outer}', 2, 'hephaestus', 'sonnet', 'ended', 'wound down', '2026-11-18T08:00:00Z', '2026-11-18T09:00:00Z');
    ${units(1, [["covered", 9, { prefix: "p1" }]])}
    ${units(2, [["covered", 3, { sitting: 1, marked: "2026-11-18T08:30:00Z" }], ["skipped", 1, { sitting: 1, marked: "2026-11-18T08:40:00Z" }], ["open", 4]])}
    ${units(3, [["covered", 1, { sitting: 1 }], ["open", 2]])}
    ${ticket(1, { hunt: "code", at: `${outer}/src` })}
    ${ticket(2, { hunt: "code", at: outer, state: "closed" })}
    ${ticket(3, { hunt: "code", at: `${inner}/lib` })}
    ${ticket(4, { hunt: "code", at: two })}
    ${ticket(5, { hunt: "security", at: outer })}
    ${ticket(6, { at: outer, source: "chat" })}
    ${proposal(1, { hunt: "code", at: outer })}
    ${proposal(2, { hunt: "code", at: inner })}
    ${proposal(3, { at: outer })}`);
  const before = await snapshot(house);
  const { ran, value } = await status(house);
  const after = await snapshot(house);
  if (ran.code !== 0 || value === null) return broken(`hunt status --json answered ${said(ran)}`);
  const wrong = [];
  const want = (label, got, expected) => {
    if (JSON.stringify(got) !== JSON.stringify(expected)) wrong.push(`${label} is ${JSON.stringify(got)}, not ${JSON.stringify(expected)}`);
  };
  const co = row(value, "code", "Outer");
  const ci = row(value, "code", "Inner");
  const so = row(value, "security", "Outer");
  if (!co || !ci || !so) return broken(`no row for code/Outer, code/Inner or security/Outer: ${JSON.stringify(value.hunts ?? null).slice(0, 300)}`);
  const figures = (p) => ({ pass: p.pass, total: p.total, covered: p.covered, skipped: p.skipped, open: p.open, tickets: p.tickets, proposals: p.proposals });
  want("code/Outer", figures(co), { pass: 2, total: 8, covered: 3, skipped: 1, open: 4, tickets: 2, proposals: 1 });
  want("code/Outer state", co.state, "hunting");
  want("code/Outer project", co.project, outer);
  want("code/Outer unit_word", co.unit_word, "files");
  want("code/Inner", figures(ci), { pass: 1, total: 3, covered: 1, skipped: 0, open: 2, tickets: 1, proposals: 1 });
  want("security/Outer state", so.state, "not started");
  want("security/Outer pass", so.pass, null);
  want("security/Outer tickets", so.tickets, 1);
  want("code/Two tickets", row(value, "code", "Two")?.tickets, 1);
  want("kinds listed", (value.hunts ?? []).map((h) => h.hunt).sort(), [...KINDS].sort());
  for (const h of value.hunts ?? []) {
    want(`${h.hunt} runs`, h.runs, ["security", "code"].includes(h.hunt));
    if (typeof h.soul !== "string" || !h.soul) wrong.push(`${h.hunt} has no soul`);
  }
  want("code soul", (value.hunts ?? []).find((h) => h.hunt === "code")?.soul, "hephaestus");
  want("night", value.night && { night: value.night.night, state: value.night.state }, { night: "2026-11-18", state: "closed" });
  want("sitting", value.sitting, null);
  want("switch", { nightly: value.nightly, order: value.order, turns: value.turns }, { nightly: false, order: ["security", "code"], turns: "project" });
  if (before !== after) wrong.push("reading the status changed a hunt, proposal or ticket row");
  if (wrong.length) return broken(wrong.join("; "));
  return held("code/Outer pass 2: 8 = 3 covered + 1 skipped + 4 open, 2 tickets, 1 proposal; Inner and the prefix sibling counted apart; nothing written");
});
