// A chat's ticket carries no key, so two chats filing the same bug make two tickets and two cards; the walk's first
// step finds the second card a duplicate, and the done settle closes it (`card_notes_similar.close_duplicates`, row
// `done`, outcome `duplicate`). The second reporter is owed a word as much as the first: its ticket must end, with a
// word naming the card it was fixed with. Left `placed`, it is never told, and it counts against its session's
// open-ticket ceiling for good.
//
// A scratch dispatcher home and plan-runner state; a walking bug card with a placed ticket whose chain record ended
// `done` naming a second, queued card as a duplicate, that card with a placed ticket of its own; `card_settle.settle`
// on the first row.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/card_settle.py, /home/lyphe/.claude/hooks/dispatcher/card_settle_words.py, /home/lyphe/.claude/hooks/dispatcher/card_notes_similar.py
// writes: none

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bugHouse } from "../lib/bug_house.mjs";
import { python } from "../lib/house_live.mjs";

const MAIN = "Search box loses focus";
const DUP = "Cursor jumps out of search";
const LINE = "Typing in the search box keeps the cursor in it while results load.";

const PY = String.raw`
import json, os, sys, time
from dispatcher import store, card_settle
from plan_runner.solo import chain_state
repo, main, dup, line = sys.argv[1:5]
chain_id = "chain-case-dup-ticket"
record = chain_state.blank(chain_id, "case-dup-ticket", agent="hephaestus", cwd=repo, add_dirs=[], docs=False,
                           pause=False, brief="b")
record.update({"status": "done", "flow": "bug", "ended_at": time.time(), "changelog": line,
               "similar": {"duplicates": [{"card": "c-2", "why": "the same focus loss"}]}})
os.makedirs(chain_state.dir_for(chain_id), exist_ok=True)
with open(chain_state.path_for(chain_id, "chain.json"), "w", encoding="utf-8") as fh:
    json.dump(record, fh)
conn = store.connect()
with conn:
    for cid, title, state, chain in ((1, main, "walking", chain_id), (2, dup, "queued", None)):
        conn.execute("INSERT INTO cards (id, board, card, board_name, title, words, priority, actor, repos, state, flow, "
                     "sorted_by, chain_id, told_at, launched_at) VALUES (?, 'b-1', ?, 'Case board', ?, 'w', 'medium', "
                     "'chat', ?, ?, 'bug', 'model', ?, '2026-11-19T10:00:00Z', '2026-11-19T10:01:00Z')",
                     (cid, f"c-{cid}", title, json.dumps([repo]), state, chain))
        conn.execute("INSERT INTO tickets (id, source, path, title, words, priority, reporter, session, state, board, "
                     "card, card_row, times, filed_at, placed_at) VALUES (?, 'chat', ?, ?, 'w', 'medium', '{}', ?, "
                     "'placed', 'b-1', ?, ?, 1, '2026-11-19T09:59:00Z', '2026-11-19T10:00:00Z')",
                     (cid, repo, title, f"case-session-{cid}", f"c-{cid}", cid))
settled = card_settle.settle(conn, conn.execute("SELECT * FROM cards WHERE id = 1").fetchone())
cards = {r["id"]: dict(r) for r in conn.execute("SELECT id, state, outcome FROM cards")}
tickets = {r["id"]: dict(r) for r in conn.execute("SELECT id, state, word, word_told_at FROM tickets")}
print(json.dumps({"settled": settled.state, "cards": cards, "tickets": tickets}))
`;

runCase(async (t) => {
  const house = await bugHouse(t, "dup-ticket");
  const ran = python(PY, [house.repo, MAIN, DUP, LINE], { cwd: house.dir, env: house.env });
  const last = ran.stdout.trim().split("\n").pop() || "";
  let got;
  try { got = JSON.parse(last); } catch { got = null; }
  if (ran.status !== 0 || !got) return cannotRun(`the settle could not be driven: exit ${ran.status}: ${(ran.stderr.trim().split("\n").pop() || last).slice(0, 240)}`);

  const dupCard = got.cards["2"];
  const mainTicket = got.tickets["1"];
  const dupTicket = got.tickets["2"];
  if (got.settled !== "done" || mainTicket.state !== "fixed") return cannotRun(`the main walk did not settle as a done walk does (settled ${got.settled}, its ticket ${mainTicket.state})`);
  if (!dupCard || dupCard.state !== "done") return cannotRun(`the duplicate card was not closed by the walk (it reads ${dupCard ? dupCard.state : "missing"})`);

  const wrong = [];
  if (!["fixed", "closed"].includes(dupTicket.state)) wrong.push(`the closed duplicate's ticket reads ${dupTicket.state}, its reporter never told`);
  else if (!String(dupTicket.word || "").includes(MAIN)) wrong.push(`the duplicate's ticket ended with the word ${JSON.stringify(dupTicket.word)}, which does not name "${MAIN}"`);
  if (dupTicket.word_told_at !== null) wrong.push(`the duplicate's word is stamped told (${dupTicket.word_told_at}) before any chat read it`);
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`the duplicate's ticket ended ${dupTicket.state} with ${JSON.stringify(dupTicket.word)}`);
});
