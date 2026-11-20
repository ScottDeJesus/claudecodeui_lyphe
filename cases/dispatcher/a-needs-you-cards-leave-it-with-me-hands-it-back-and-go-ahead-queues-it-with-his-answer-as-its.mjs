// The operator answers a needs-you card through the `answered` telling that already exists. "Leave it with me" is the
// dispatcher's own answer (`card_settle.OWN_ASKS` holds `needs you`): the card is handed back to him — `handed-back`,
// outcome `left with him`, a `not_ready` status note, no rulings. "Go ahead" is any other answer: the card is `queued`
// with a rulings file holding the question and his answer, the ruling its walk reads.
//
// Two needs-you tickets placed on a self-running scratch board (stand-in sort), then each answered as CloudCLI's board
// listener tells it: `dispatcher card told --event answered --by operator`.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/card_settle.py, /home/lyphe/.claude/hooks/dispatcher/card_tell.py, /home/lyphe/.claude/hooks/dispatcher/card_told.py, /home/lyphe/.claude/hooks/dispatcher/bug_place.py, /home/lyphe/.claude/hooks/dispatcher/bug_hunter.py
// writes: none

import fs from "node:fs";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bug, rows, said } from "../lib/bug_house.mjs";
import { QUESTION_HEAD, cardOf, huntEnv, hunterHouse, placed, told } from "../lib/hunter_tickets.mjs";

const FILED = /^FILED ticket (\d+) — /m;
const SENTENCE = "Every till will ask for its pin again.";
const QUESTION = `${QUESTION_HEAD} ${SENTENCE} Go ahead?`;
const BOARD = { id: "b-on", name: "On board", autonomy: true };

function answer(house, card, choice) {
  return told(house, "answered", {
    board: { id: BOARD.id, name: BOARD.name, repos: [house.repo] },
    card: { id: card, title: card, description: "", body: "", tags: ["needs-you"], priority: "medium", attachments: [], status: "questions", archived: false },
    answers: [{ question: QUESTION, selected: [choice], other: "" }],
  });
}

runCase(async (t) => {
  const house = await hunterHouse(t, "needs-you-answered");
  for (const card of ["c-leave", "c-go"]) {
    const ran = await bug(house, ["file", "--title", `Pins are shared (${card})`, "--needs-you", SENTENCE], { input: "found while hunting", env: huntEnv("security") });
    const m = ran.out.match(FILED);
    if (ran.code !== 0 || !m) return cannotRun(`the needs-you ticket could not be filed — ${said(ran)}`);
    const p = await placed(house, Number(m[1]), BOARD, card);
    const { row } = await cardOf(house, rows, card);
    if (p.code !== 0 || row?.state !== "asking") return cannotRun(`${card} was not parked asking (state ${row?.state}) — ${said(p)}`);
  }
  const wrong = [];
  const left = await answer(house, "c-leave", "Leave it with me");
  if (left.code !== 0 || !left.out.includes("handed-back")) wrong.push(`Leave it with me did not answer handed-back — ${said(left)}`);
  const l = await cardOf(house, rows, "c-leave");
  if (l.row.state !== "handed-back" || l.row.outcome !== "left with him") wrong.push(`after Leave it with me the row reads ${l.row.state}, outcome ${JSON.stringify(l.row.outcome)}`);
  if (l.row.rulings) wrong.push(`Leave it with me wrote rulings: ${l.row.rulings}`);
  if (l.notes.filter((n) => n.kind === "status").at(-1)?.payload.status !== "not_ready") wrong.push("Leave it with me owed no not_ready status note last");

  const go = await answer(house, "c-go", "Go ahead");
  if (go.code !== 0 || !go.out.includes("queued")) wrong.push(`Go ahead did not answer queued — ${said(go)}`);
  const g = await cardOf(house, rows, "c-go");
  if (g.row.state !== "queued") wrong.push(`after Go ahead the row reads ${g.row.state}`);
  const ruling = g.row.rulings && fs.existsSync(g.row.rulings) ? fs.readFileSync(g.row.rulings, "utf8") : "";
  if (!ruling.includes(`Question: ${QUESTION}`) || !ruling.includes("Answer: Go ahead")) wrong.push(`the Go ahead card's rulings read ${JSON.stringify(ruling.slice(0, 200))}`);
  if (wrong.length) return broken(wrong.join("; "));
  return held("Leave it with me handed the needs-you card back (left with him, not_ready, no rulings); Go ahead queued the other with a rulings file holding its question and 'Answer: Go ahead'");
});
