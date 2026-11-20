// protects: /home/lyphe/.claude/hooks/dispatcher/card_tell.py, /home/lyphe/.claude/hooks/dispatcher/card_rule.py
// writes: none
//
// The board's design: a card moved into To Do is sent in, or sent in again. CloudCLI tells `queued` for every drag
// into To Do (kanban-dispatch.tell.ts). A card whose walk finished (row `done`) or was handed back to Backlog (row
// `handed-back`) must then be queued again, its ending and outcome cleared, and be a row the card line's take-up walks
// (a launch, or a resume of its walk) — never left answering its old state with nothing queued. A card already walking
// or asking is not sent in twice: its state stands.
//
// A scratch dispatcher home; four bug rows written straight into the store, each finished-or-handed-back one naming a
// walk whose chain record exists in the scratch state home (so a kept walk id is a walk the take-up would resume);
// each row told `queued` through `dispatcher card told`; then `card_rule._take_up_row` asked what it would do with each
// row left queued, the hold and the two chain doors stood in for so nothing runs and no model is asked.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bugHouse, exec, rows, said } from "../lib/bug_house.mjs";
import { dispatch, py, PRELUDE } from "../lib/cure_house.mjs";

const WALKS = {
  "c-done": "chain-case-done-20261119-000000-0001",
  "c-handed": "chain-case-handed-20261119-000000-0002",
  "c-walking": "chain-case-walking-20261119-000000-0003",
  "c-asking": "chain-case-asking-20261119-000000-0004",
};
const CARDS = [
  ["c-done", "done", "done"],
  ["c-handed", "handed-back", "handed back"],
  ["c-walking", "walking", null],
  ["c-asking", "asking", null],
];

const RECORDS = PRELUDE + String.raw`
from plan_runner.solo import chain_state
for chain_id in json.loads(sys.argv[1]):
    path = chain_state.path_for(chain_id, "chain.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump({"id": chain_id, "status": "done", "flow": "bug"}, f)
print(json.dumps({"ok": True}))
`;

const TAKE_UP = PRELUDE + String.raw`
from dispatcher import card_chain, card_hold, card_rule, store
card_hold.reason = lambda conn, row, pace_ctx: ""
card_chain.launch = lambda conn, row: "stand-in-launch"
card_chain.resume = lambda conn, row: "stand-in-resume"
conn = store.connect()
row = conn.execute("SELECT * FROM cards WHERE card = ?", (sys.argv[1],)).fetchone()
try:
    answer = card_rule._take_up_row(conn, row, None)
except Exception as exc:
    answer = "raised " + type(exc).__name__ + ": " + str(exc)
print(json.dumps({"answer": answer}))
`;

runCase(async (t) => {
  const h = await bugHouse(t, "drag-again");
  Object.assign(h.env, { JEV_FORCE_OFF: "1" });
  delete h.env.DISPATCHER_SCRATCH_DAEMON;
  const opened = await py(h, PRELUDE + "from dispatcher import store\nstore.connect().close()\nprint('{}')");
  if (opened.code !== 0) return cannotRun(`the scratch store would not open: ${said(opened)}`);
  const recorded = await py(h, RECORDS, [JSON.stringify(Object.values(WALKS))]);
  if (recorded.code !== 0) return cannotRun(`the scratch chain records would not be written: ${said(recorded)}`);
  for (const [i, [card, state, outcome]] of CARDS.entries()) {
    const ended = outcome === null ? null : "2026-11-19T05:00:00Z";
    await exec(h, "INSERT INTO cards (id, board, card, board_name, title, words, priority, actor, repos, state, flow, sorted_by, " +
      "chain_id, outcome, told_at, launched_at, ended_at) VALUES (?, 'b-on', ?, 'Case board', ?, 'Something is wrong.', 'medium', " +
      "'operator', ?, ?, 'bug', 'model', ?, ?, '2026-11-19T04:00:00Z', '2026-11-19T04:00:00Z', ?)",
      [i + 1, card, `Card ${card}`, JSON.stringify([h.repo]), state, WALKS[card], outcome, ended]);
  }

  const wrong = [];
  for (const [card, state] of CARDS) {
    const drag = await dispatch(h, ["card", "told", "--event", "queued", "--by", "operator"], {
      input: JSON.stringify({
        board: { id: "b-on", name: "Case board", repos: [h.repo] },
        card: { id: card, title: `Card ${card}`, description: "Something is wrong.", body: "", tags: ["bug"], priority: "medium",
                attachments: [], status: "todo", archived: false },
      }),
    });
    if (drag.code !== 0) { wrong.push(`the drag of the ${state} card failed: ${said(drag)}`); continue; }
    const told = drag.out.trim().split("\n").pop() ?? "";
    const [row] = await rows(h, "SELECT state, outcome, ended_at, flow FROM cards WHERE card = ?", [card]);
    if (state === "walking" || state === "asking") {
      if (row.state !== state) wrong.push(`the ${state} card dragged into To Do now reads ${row.state}, not ${state}`);
      continue;
    }
    if (!told.endsWith("— queued") || row.state !== "queued") {
      wrong.push(`the ${state} card dragged into To Do answered "${told}" and its row reads ${row.state}`);
      continue;
    }
    if (row.outcome !== null || row.ended_at !== null) {
      wrong.push(`the ${state} card queued again keeps outcome ${JSON.stringify(row.outcome)} and ended_at ${JSON.stringify(row.ended_at)}`);
    }
    const took = await py(h, TAKE_UP, [card]);
    const answer = took.json?.answer ?? said(took);
    if (!/^card (launched|resumed) /.test(String(answer))) {
      wrong.push(`the take-up of the ${state} card queued again answers ${JSON.stringify(answer)}, not a launch or a resume`);
    }
  }

  if (wrong.length) return broken(wrong.join("; "));
  return held("a finished and a handed-back card dragged into To Do were queued again and taken up; a walking and an asking card kept their state");
});
