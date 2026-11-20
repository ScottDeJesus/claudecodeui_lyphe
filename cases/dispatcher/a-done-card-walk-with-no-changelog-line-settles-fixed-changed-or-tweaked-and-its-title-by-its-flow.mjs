// A missing CHANGELOG line never refuses a round and never leaves a finished card without its line: a walk whose
// record carries no `changelog` settles with the line its flow and the card's title make — `Fixed: <title>` for a
// bug, `Changed: <title>` for a change, `Tweaked: <title>` for a tweak — as the `changelog` text note. A card with no
// ticket ends no ticket.
//
// A scratch dispatcher home and plan-runner state; three walking card rows with no ticket, one per flow, each with a
// chain record that ended `done` carrying no `changelog` (and the tweak's an edited file); then `card_settle.settle`
// on each, as the daemon's sweep calls it when the walker's pidfd fires.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/card_settle.py, /home/lyphe/.claude/hooks/dispatcher/card_notes.py, /home/lyphe/.claude/hooks/plan_runner/solo/chain_card_changelog.py
// writes: none

import { spawn } from "node:child_process";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bugHouse } from "../lib/bug_house.mjs";

const CARDS = [
  { id: 1, flow: "bug", title: "Search box loses focus", want: "Fixed: Search box loses focus" },
  { id: 2, flow: "change", title: "Show the archive count", want: "Changed: Show the archive count" },
  { id: 3, flow: "tweak", title: "Make the save button bigger", want: "Tweaked: Make the save button bigger" },
];

const PY = String.raw`
import json, os, sys, time
sys.path.insert(0, os.path.expanduser("~/.claude/hooks"))
from dispatcher import store, card_settle
from plan_runner.solo import chain_state
repo, cards = sys.argv[1], json.loads(sys.argv[2])
conn = store.connect()
out = []
for card in cards:
    chain_id = f"chain-case-changelog-fallback-{card['id']}"
    record = chain_state.blank(chain_id, f"case-changelog-fallback-{card['id']}", agent="hephaestus", cwd=repo,
                               add_dirs=[], docs=False, pause=False, brief="b")
    record.update({"status": "done", "flow": card["flow"], "ended_at": time.time()})
    if card["flow"] == "tweak":
        record["tweak"] = {"result": "DONE", "edited": [os.path.join(repo, "a.css")], "docs": [], "shots": []}
    record.pop("changelog", None)
    os.makedirs(chain_state.dir_for(chain_id), exist_ok=True)
    with open(chain_state.path_for(chain_id, "chain.json"), "w", encoding="utf-8") as fh:
        json.dump(record, fh)
    with conn:
        conn.execute("INSERT INTO cards (id, board, card, board_name, title, words, priority, actor, repos, state, flow, "
                     "sorted_by, chain_id, told_at, launched_at) VALUES (?, 'b-1', ?, 'Case board', ?, 'w', 'medium', "
                     "'operator', ?, 'walking', ?, 'model', ?, '2026-11-19T10:00:00Z', '2026-11-19T10:01:00Z')",
                     (card["id"], f"c-{card['id']}", card["title"], json.dumps([repo]), card["flow"], chain_id))
    row = conn.execute("SELECT * FROM cards WHERE id = ?", (card["id"],)).fetchone()
    settled = card_settle.settle(conn, row)
    notes = [json.loads(n["payload"]) for n in
             conn.execute("SELECT payload FROM card_notes WHERE card_id = ? AND kind = 'text' AND key = 'changelog'", (card["id"],))]
    state = conn.execute("SELECT state FROM cards WHERE id = ?", (card["id"],)).fetchone()["state"]
    out.append({"id": card["id"], "settled": settled.state, "row": state, "notes": notes})
tickets = conn.execute("SELECT count(*) FROM tickets").fetchone()[0]
print(json.dumps({"cards": out, "tickets": tickets}))
`;

function python(house) {
  return new Promise((resolve) => {
    const child = spawn("python3", ["-I", "-c", PY, house.repo, JSON.stringify(CARDS)], { env: house.env, cwd: house.dir, stdio: ["ignore", "pipe", "pipe"] });
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
  const house = await bugHouse(t, "changelog-fallback");
  const ran = await python(house);
  const last = ran.out.trim().split("\n").pop() || "";
  let got;
  try { got = JSON.parse(last); } catch { got = null; }
  if (ran.code !== 0 || !got) return cannotRun(`the settles could not be driven: exit ${ran.code}: ${(ran.err.trim().split("\n").pop() || last).slice(0, 240)}`);

  const wrong = [];
  for (const card of CARDS) {
    const seen = got.cards.find((c) => c.id === card.id);
    if (!seen) { wrong.push(`the ${card.flow} card was not settled`); continue; }
    if (seen.settled !== "done" || seen.row !== "done") wrong.push(`the ${card.flow} card settled ${seen.settled}, row ${seen.row}, not done`);
    const lines = seen.notes.map((p) => p.changelog);
    if (lines.length !== 1 || lines[0] !== card.want) wrong.push(`the ${card.flow} card's changelog notes read ${JSON.stringify(lines)}, not [${JSON.stringify(card.want)}]`);
  }
  if (got.tickets !== 0) wrong.push(`${got.tickets} tickets exist after settling cards that had none`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`with no CHANGELOG line the three walks settled ${CARDS.map((c) => JSON.stringify(c.want)).join(", ")}, and no ticket was written`);
});
