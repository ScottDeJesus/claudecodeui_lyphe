// A card walk that finished leaves three things the board and the reporter read: the CHANGELOG line as its own
// `text` note (key `changelog`, payload `{"changelog": <the line>}`), the closing remarks with one `Live:` line said
// from the LAST round's `chain["live"]` and one `Owed:` line per owed entry, and the card's ticket ended `fixed` with
// the word `Fixed: "<title>" — <the line>`, owed back to the reporter (no `word_told_at`).
//
// A scratch dispatcher home and plan-runner state; a walking bug card row with a placed ticket written straight into
// the store, and a chain record that ended `done` carrying `changelog` and `live` for rounds "9" and "10" (so a
// reader that takes the newest round by string order reads round 9's unit); then `card_settle.settle` on that row,
// as the daemon's sweep calls it when the walker's pidfd fires. The unit names are made up: nothing is restarted.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/card_settle.py, /home/lyphe/.claude/hooks/dispatcher/card_notes.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/plan_runner/solo/chain_live.py
// writes: none

import { spawn } from "node:child_process";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bugHouse } from "../lib/bug_house.mjs";

const TITLE = "Search box loses focus";
const LINE = "Typing in the search box keeps the cursor in it while results load.";
const OWED = "The built app changes at your next deploy; the dev server already serves this.";

const PY = String.raw`
import json, os, sys, time
sys.path.insert(0, os.path.expanduser("~/.claude/hooks"))
from dispatcher import store, card_settle
from plan_runner.solo import chain_state
repo, title, line, owed = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
chain_id = "chain-case-changelog-done-1"
record = chain_state.blank(chain_id, "case-changelog-done", agent="hephaestus", cwd=repo, add_dirs=[], docs=False,
                           pause=False, brief="b")
live = {
    "9": [{"repo": repo, "unit": "gamma-round-nine", "action": "restarted", "at": "2026-11-19T21:40:00Z", "detail": "ready"}],
    "10": [
        {"repo": repo, "unit": "alpha-svc", "action": "restarted", "at": "2026-11-19T22:02:00Z", "detail": "ready"},
        {"repo": repo, "unit": "beta-svc", "action": "fresh", "at": "2026-11-19T21:58:00Z", "detail": "started after the last edit"},
        {"repo": "/opt/case-app", "unit": "", "action": "owed", "at": "2026-11-19T22:02:00Z", "detail": owed},
    ],
}
record.update({"status": "done", "flow": "bug", "ended_at": time.time(), "changelog": line, "live": live})
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
notes = [{"kind": n["kind"], "key": n["key"], "payload": json.loads(n["payload"])}
         for n in conn.execute("SELECT kind, key, payload FROM card_notes WHERE card_id = 1 ORDER BY id")]
t = conn.execute("SELECT state, ended_at, word, word_told_at FROM tickets WHERE id = 1").fetchone()
c = conn.execute("SELECT state FROM cards WHERE id = 1").fetchone()
print(json.dumps({"settled": settled.state, "row": c["state"], "notes": notes, "ticket": dict(t)}))
`;

function python(house) {
  return new Promise((resolve) => {
    const child = spawn("python3", ["-I", "-c", PY, house.repo, TITLE, LINE, OWED], { env: house.env, cwd: house.dir, stdio: ["ignore", "pipe", "pipe"] });
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
  const house = await bugHouse(t, "changelog-done");
  const ran = await python(house);
  const last = ran.out.trim().split("\n").pop() || "";
  let got;
  try { got = JSON.parse(last); } catch { got = null; }
  if (ran.code !== 0 || !got) return cannotRun(`the settle could not be driven: exit ${ran.code}: ${(ran.err.trim().split("\n").pop() || last).slice(0, 240)}`);

  const wrong = [];
  if (got.settled !== "done" || got.row !== "done") wrong.push(`the walk settled ${got.settled} and its row reads ${got.row}, not done`);

  const changelogs = got.notes.filter((n) => n.kind === "text" && n.key === "changelog");
  if (changelogs.length !== 1) wrong.push(`${changelogs.length} text notes keyed changelog, not one`);
  else if (JSON.stringify(changelogs[0].payload) !== JSON.stringify({ changelog: LINE })) wrong.push(`the changelog note carries ${JSON.stringify(changelogs[0].payload).slice(0, 160)}`);

  const closing = got.notes.filter((n) => n.kind === "text" && n.key === "closing_remarks");
  const remarks = closing.length === 1 ? String(closing[0].payload.closing_remarks || "") : "";
  if (closing.length !== 1) wrong.push(`${closing.length} closing_remarks notes, not one`);
  const lines = remarks.split("\n").map((l) => l.trim());
  const liveLines = lines.filter((l) => l.startsWith("Live:"));
  const owedLines = lines.filter((l) => l.startsWith("Owed:"));
  if (liveLines.length !== 1) wrong.push(`the closing remarks hold ${liveLines.length} Live: lines, not one`);
  else {
    const live = liveLines[0];
    if (!/alpha-svc/.test(live) || !/restarted/.test(live)) wrong.push(`the Live: line does not say alpha-svc restarted: ${live.slice(0, 160)}`);
    if (!/beta-svc/.test(live)) wrong.push(`the Live: line does not name the fresh unit beta-svc: ${live.slice(0, 160)}`);
    if (/gamma-round-nine/.test(live)) wrong.push(`the Live: line names round 9's unit, not the last round's: ${live.slice(0, 160)}`);
  }
  if (owedLines.length !== 1 || !owedLines[0].includes(OWED)) wrong.push(`the closing remarks hold ${owedLines.length} Owed: lines${owedLines.length ? ` (${owedLines[0].slice(0, 120)})` : ""}, not one holding the owed words`);

  const word = `Fixed: "${TITLE}" — ${LINE}`;
  const tk = got.ticket;
  if (tk.state !== "fixed" || !tk.ended_at) wrong.push(`the card's ticket reads ${tk.state} (ended_at ${tk.ended_at}), not fixed`);
  if (tk.word !== word) wrong.push(`the ticket's word is ${JSON.stringify(tk.word)}, not ${JSON.stringify(word)}`);
  if (tk.word_told_at !== null) wrong.push(`the ticket's word is stamped told (${tk.word_told_at}) before any chat read it`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`the done walk left its changelog note, ${liveLines[0]} and ${owedLines[0].slice(0, 60)}…, and its ticket fixed with ${word}`);
});
