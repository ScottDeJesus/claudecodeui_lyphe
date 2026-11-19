// A card walk its soul handed back does not end the card's ticket: the card goes to Not ready with the reason as its
// plan, and the defect is still there. The ticket stays open, and its word is rewritten to
// `"<title>" was handed back: <the reason's first line>`, the word a reporter is owed while the board decides.
//
// A scratch dispatcher home and a scratch plan-runner state; a walking bug card row with a placed ticket written
// straight into the store, and a chain record that ended `done` with a two-line `handed_back` reason; then
// `card_settle.settle` on that row, as the daemon's sweep calls it when the walker's pidfd fires.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/card_settle.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/store_cards.py
// writes: none

import { spawn } from "node:child_process";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bugHouse } from "../lib/bug_house.mjs";

const TITLE = "Search box loses focus";
const REASON = "The fix belongs to the editor package, not this app\nIt needs a decision on the shared focus trap.";

const PY = String.raw`
import json, os, sys, time
sys.path.insert(0, os.path.expanduser("~/.claude/hooks"))
from dispatcher import store, card_settle
from plan_runner.solo import chain_state
repo, title, reason = sys.argv[1], sys.argv[2], sys.argv[3]
chain_id = "chain-case-handback-1"
record = chain_state.blank(chain_id, "case-handback", agent="hephaestus", cwd=repo, add_dirs=[], docs=False,
                           pause=False, brief="b")
record.update({"status": "done", "handed_back": reason, "flow": "bug", "ended_at": time.time()})
os.makedirs(chain_state.dir_for(chain_id), exist_ok=True)
with open(chain_state.path_for(chain_id, "chain.json"), "w", encoding="utf-8") as fh:
    json.dump(record, fh)
conn = store.connect()
with conn:
    conn.execute("INSERT INTO cards (id, board, card, board_name, title, words, priority, actor, repos, state, flow, "
                 "sorted_by, chain_id, told_at, launched_at) VALUES (1, 'b-1', 'c-1', 'Case board', ?, 'w', 'medium', "
                 "'chat', ?, 'walking', 'bug', 'model', ?, '2026-11-19T10:00:00Z', '2026-11-19T10:01:00Z')",
                 (title, json.dumps([repo]), chain_id))
    conn.execute("INSERT INTO tickets (id, source, path, title, words, priority, reporter, session, state, board, card, "
                 "card_row, times, filed_at, placed_at) VALUES (1, 'chat', ?, ?, 'w', 'medium', '{}', 'case-session', "
                 "'placed', 'b-1', 'c-1', 1, 1, '2026-11-19T09:59:00Z', '2026-11-19T10:00:00Z')", (repo, title))
row = conn.execute("SELECT * FROM cards WHERE id = 1").fetchone()
settled = card_settle.settle(conn, row)
t = conn.execute("SELECT state, ended_at, word FROM tickets WHERE id = 1").fetchone()
c = conn.execute("SELECT state FROM cards WHERE id = 1").fetchone()
print(json.dumps({"settled": settled.state, "row": c["state"], "ticket": t["state"], "ended_at": t["ended_at"], "word": t["word"]}))
`;

function python(house) {
  return new Promise((resolve) => {
    const child = spawn("python3", ["-I", "-c", PY, house.repo, TITLE, REASON], { env: house.env, cwd: house.dir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { err += b; });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, out, err: `${err}${e.message}` }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

runCase(async (t) => {
  const house = await bugHouse(t, "handed-back-word");
  const ran = await python(house);
  const last = ran.out.trim().split("\n").pop() || "";
  let got;
  try { got = JSON.parse(last); } catch { got = null; }
  if (ran.code !== 0 || !got) return cannotRun(`the settle could not be driven: exit ${ran.code}: ${(ran.err.trim().split("\n").pop() || last).slice(0, 240)}`);

  const wrong = [];
  const word = `"${TITLE}" was handed back: ${REASON.split("\n")[0]}`;
  if (got.settled !== "handed-back" || got.row !== "handed-back") wrong.push(`the walk settled ${got.settled} and its row reads ${got.row}, not handed-back`);
  if (got.ticket !== "placed" || got.ended_at !== null) wrong.push(`the handed-back card's ticket reads ${got.ticket} (ended_at ${got.ended_at}), not still placed`);
  if (got.word !== word) wrong.push(`the ticket's word is ${JSON.stringify(got.word)}, not ${JSON.stringify(word)}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`the handed-back walk left its ticket placed, owing ${word}`);
});
