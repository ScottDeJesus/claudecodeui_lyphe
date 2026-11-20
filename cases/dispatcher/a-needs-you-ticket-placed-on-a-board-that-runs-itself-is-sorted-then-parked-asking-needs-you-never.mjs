// A security hunter's --needs-you ticket must not walk before the operator answers. `bug placed` of it on a board that
// runs itself sorts it as any soul's ticket is sorted (outside the transaction), then ONE act writes the flow, its
// first notes, a `question` note asking what `bug pending` asks, a `status questions` note after them, and leaves the
// row `asking` with the outcome `needs you`. On a board that does not run itself it is `withdrawn` as any ticket is,
// with no question of the dispatcher's.
//
// The sort never reaches a model: Jev is held off and the Claude CLI is a stand-in answering "bug 0.97"
// (`hunter_tickets.mjs`).
//
// protects: /home/lyphe/.claude/hooks/dispatcher/bug_place.py, /home/lyphe/.claude/hooks/dispatcher/bug_hunter.py, /home/lyphe/.claude/hooks/dispatcher/card_settle.py, /home/lyphe/.claude/hooks/dispatcher/card_notes.py, /home/lyphe/.claude/hooks/dispatcher/store_cards.py
// writes: none

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bug, rows, said } from "../lib/bug_house.mjs";
import { OPTIONS, QUESTION_HEAD, cardOf, huntEnv, hunterHouse, placed } from "../lib/hunter_tickets.mjs";

const FILED = /^FILED ticket (\d+) — /m;
const SENTENCE = "Staff will need to log in again.";

runCase(async (t) => {
  const house = await hunterHouse(t, "needs-you-placed");
  const ids = [];
  for (const title of ["Sessions outlive a password change", "Reset links never expire"]) {
    const ran = await bug(house, ["file", "--title", title, "--needs-you", SENTENCE], { input: "found while hunting", env: huntEnv("security") });
    const m = ran.out.match(FILED);
    if (ran.code !== 0 || !m) return cannotRun(`the needs-you ticket could not be filed — ${said(ran)}`);
    ids.push(Number(m[1]));
  }
  const wrong = [];
  const on = await placed(house, ids[0], { id: "b-on", name: "On board", autonomy: true }, "c-ask");
  if (on.code !== 0 || !/^PLACED ticket \d+ — On board — asking$/m.test(on.out)) wrong.push(`bug placed on the board that runs itself did not print PLACED … — asking — ${said(on)}`);
  const { row, notes } = await cardOf(house, rows, "c-ask");
  if (!row) wrong.push("no card row was written for c-ask");
  else {
    if (row.state !== "asking" || row.outcome !== "needs you") wrong.push(`the row reads state ${row.state}, outcome ${JSON.stringify(row.outcome)}`);
    if (!row.flow) wrong.push("the row carries no flow: it was never sorted");
    const q = notes.findIndex((n) => n.kind === "question");
    const qn = notes[q];
    if (!qn) wrong.push(`no question note: ${JSON.stringify(notes.map((n) => n.kind))}`);
    else if (qn.payload.text !== `${QUESTION_HEAD} ${SENTENCE} Go ahead?` || JSON.stringify(qn.payload.options) !== JSON.stringify(OPTIONS)) wrong.push(`the question note reads ${JSON.stringify(qn.payload)}`);
    if (!notes.some((n) => n.kind === "step" && n.payload.text === "Sort" && n.payload.state === "done")) wrong.push("no done Sort step note");
    const statuses = notes.filter((n) => n.kind === "status");
    if (statuses.at(-1)?.payload.status !== "questions") wrong.push(`the last status note is ${JSON.stringify(statuses.at(-1)?.payload)}, not questions`);
    const lastStatus = notes.lastIndexOf(statuses.at(-1));
    if (qn && lastStatus < q) wrong.push("the questions status is written before the question");
  }
  const off = await placed(house, ids[1], { id: "b-off", name: "Off board", autonomy: false }, "c-off");
  if (off.code !== 0 || !/^PLACED ticket \d+ — Off board — withdrawn$/m.test(off.out)) wrong.push(`bug placed on the board that is off did not print PLACED … — withdrawn — ${said(off)}`);
  const offCard = await cardOf(house, rows, "c-off");
  if (offCard.row?.state !== "withdrawn") wrong.push(`the off board's row reads ${offCard.row?.state}`);
  if (offCard.notes.some((n) => n.kind === "question")) wrong.push("the off board's row was given a question note");
  if (wrong.length) return broken(wrong.join("; "));
  return held(`the needs-you ticket on the board that runs itself was sorted (${row.flow}) and parked asking with outcome needs you, its Sort step, the question and a last questions status, never queued; on the board that is off it was withdrawn with no question`);
});
