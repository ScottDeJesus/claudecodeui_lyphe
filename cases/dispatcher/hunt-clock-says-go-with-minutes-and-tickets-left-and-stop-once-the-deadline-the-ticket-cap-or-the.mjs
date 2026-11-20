// `dispatcher hunt clock` (hooks/dispatcher/hunt_marks.py, cmd/hunt.py) answers `GO <minutes left> · <tickets left
// tonight>` from the sitting's own row: minutes to its deadline, and tickets_per_night less the tickets THIS sitting
// filed (another sitting's do not count). It answers `STOP <reason>` once this sitting has filed tickets_per_night
// tickets, once its deadline has passed, and once its night is closed. Exit 0 every time, and it writes nothing.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/hunt_marks.py, /home/lyphe/.claude/hooks/dispatcher/cmd/hunt.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py
// writes: none

import { exec, rows, said } from "../lib/bug_house.mjs";
import { broken, held, runCase } from "../lib/case.mjs";
import { addPass, addSitting, addTicket, huntAs, FILES, marksHouse } from "../lib/hunt_marks_house.mjs";

const SNAP = "SELECT (SELECT group_concat(id || state || coalesce(outcome, ''), ',') FROM hunt_sittings) AS s, (SELECT group_concat(night || state, ',') FROM hunt_nights) AS n, (SELECT count(*) FROM tickets) AS t";

runCase(async (t) => {
  const house = await marksHouse(t, "hunt-clock", { tickets: 3 });
  const { passId } = await addPass(house, "code", FILES);
  const s = await addSitting(house, { hunt: "code", passId, launchId: null, minutes: 30 });
  const o = await addSitting(house, { hunt: "code", passId, launchId: null, minutes: 30 });
  await addTicket(house, { title: "one", sittingId: s });
  await addTicket(house, { title: "two", sittingId: o });
  await addTicket(house, { title: "three", sittingId: o });
  const wrong = [];

  const snap = (await rows(house, SNAP))[0];
  const go = await huntAs(house, s, ["clock"]);
  const m = go.out.match(/^GO\s+(\d+)\D*·\s*(\d+)/m);
  if (go.code !== 0 || !m || Number(m[1]) < 28 || Number(m[1]) > 30 || Number(m[2]) !== 2) wrong.push(`clock with 30 minutes and one of three tickets filed answered ${said(go)}, not GO about 30 · 2`);
  if (JSON.stringify((await rows(house, SNAP))[0]) !== JSON.stringify(snap)) wrong.push("clock wrote to the store");

  await addTicket(house, { title: "four", sittingId: s, state: "closed" });
  await addTicket(house, { title: "five", sittingId: s });
  const capped = await huntAs(house, s, ["clock"]);
  if (capped.code !== 0 || !/^STOP \S/m.test(capped.out)) wrong.push(`clock with three tickets filed by the sitting answered ${said(capped)}, not STOP at exit 0`);

  const late = await addSitting(house, { hunt: "code", passId, launchId: null, minutes: -5 });
  const past = await huntAs(house, late, ["clock"]);
  if (past.code !== 0 || !/^STOP \S/m.test(past.out)) wrong.push(`clock past the deadline answered ${said(past)}, not STOP at exit 0`);

  const fresh = await addSitting(house, { hunt: "code", passId, launchId: null, minutes: 30 });
  await exec(house, "UPDATE hunt_nights SET state = 'closed', closed_at = '2026-11-19T01:00:00Z', why = 'stopped by the operator' WHERE night = ?", [house.night]);
  const closed = await huntAs(house, fresh, ["clock"]);
  if (closed.code !== 0 || !/^STOP \S/m.test(closed.out)) wrong.push(`clock on a closed night answered ${said(closed)}, not STOP at exit 0`);

  if (wrong.length) return broken(wrong.join("; "));
  return held(`clock said "${go.out.trim()}" and wrote nothing; STOP at the cap (a closed ticket counted), past the deadline and on a closed night, exit 0 each`);
});
