// `bug_end.case_held(conn, repo, name, at, trigger)` is how a run that held closes the night's ticket: the case runner
// calls it right after it records a held run. A ticket keyed on several cases is cleared only once EVERY one of its
// `case:` keys reads holding, as `store.case_word` reads it at that moment (no column holds a case's word, INV-172),
// and it is cleared by the rule of `bug cleared`, with the note `Every case holds again since the <trigger> run of <at>`.
// It never raises: the case runner's run must not fail because a ticket could not be cleared.
//
// A scratch dispatcher home; two active cases of a scratch suite each with a broken run; one placed ticket keyed on
// both, on a queued card row written straight into the store. Then a held run of the first, `case_held`; a held run
// of the second, `case_held`. Driven through the house's own Python, since the case runner is the function's caller.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/bug_end.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/store_case_words.py, /home/lyphe/.claude/hooks/dispatcher/store_cards.py
// writes: none

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bugHouse } from "../lib/bug_house.mjs";

const PY = String.raw`
import json, os, sys
sys.path.insert(0, os.path.expanduser("~/.claude/hooks"))
from dispatcher import store, store_cases
repo = sys.argv[1]
out = {}
conn = store.connect()
with conn:
    ids = {}
    for name in ("case-a", "case-b"):
        ids[name] = store_cases.add_intent(conn, repo=repo, name=name, sentence=f"{name} holds its promise", by="case")[0]
        store_cases.record_run(conn, ids[name], at="2026-11-19T03:00:00Z", trigger="nightly", chain_id=None,
                               word="broken", saw="broke", exit_code=1, duration_ms=1, output=None)
    conn.execute("INSERT INTO cards (id, board, card, board_name, title, words, priority, actor, repos, state, flow, "
                 "sorted_by, told_at, queued_at) VALUES (1, 'b-1', 'c-1', 'Case board', 'Two cases broke', 'w', 'high', "
                 "'nightly', ?, 'queued', 'bug', 'detector', '2026-11-19T03:10:00Z', '2026-11-19T03:10:00Z')",
                 (json.dumps([repo]),))
    conn.execute("INSERT INTO tickets (id, source, path, title, words, priority, reporter, state, board, card, card_row, "
                 "times, filed_at, placed_at) VALUES (1, 'nightly', ?, 'Two cases broke', 'w', 'high', '{}', 'placed', "
                 "'b-1', 'c-1', 1, 1, '2026-11-19T03:05:00Z', '2026-11-19T03:10:00Z')", (repo,))
    for name in ids:
        conn.execute("INSERT INTO ticket_keys (ticket_id, key) VALUES (1, ?)", (f"case:{repo}:{name}",))
try:
    from dispatcher import bug_end
except ImportError as exc:
    print(json.dumps({"no_module": str(exc)})); sys.exit(0)

def state():
    t = conn.execute("SELECT state, ended_at FROM tickets WHERE id = 1").fetchone()
    c = conn.execute("SELECT state, outcome FROM cards WHERE id = 1").fetchone()
    notes = [json.loads(r["payload"]) for r in conn.execute("SELECT payload FROM card_notes WHERE card_id = 1 ORDER BY id")]
    return {"ticket": t["state"], "ended_at": t["ended_at"], "row": c["state"], "outcome": c["outcome"], "notes": notes}

def call(*args, on=None):
    try:
        bug_end.case_held(on or conn, *args)
        return None
    except BaseException as exc:
        return f"{type(exc).__name__}: {exc}"

with conn:
    store_cases.record_run(conn, ids["case-a"], at="2026-11-19T04:00:00Z", trigger="nightly", chain_id=None,
                           word="held", saw="held", exit_code=0, duration_ms=1, output=None)
out["raised_a"] = call(repo, "case-a", "2026-11-19T04:00:00Z", "nightly")
out["after_a"] = state()
with conn:
    store_cases.record_run(conn, ids["case-b"], at="2026-11-19T05:00:00Z", trigger="nightly", chain_id=None,
                           word="held", saw="held", exit_code=0, duration_ms=1, output=None)
out["raised_b"] = call(repo, "case-b", "2026-11-19T05:00:00Z", "nightly")
out["after_b"] = state()
out["raised_unheld"] = call(repo, "case-nobody", "2026-11-19T05:00:00Z", "nightly")
closed = store.connect()
closed.close()
out["raised_closed"] = call(repo, "case-a", "2026-11-19T05:00:00Z", "nightly", on=closed)
conn.close()
print(json.dumps(out))
`;

function python(house) {
  return new Promise((resolve) => {
    const child = spawn("python3", ["-I", "-c", PY, house.repo], { env: house.env, cwd: house.dir, stdio: ["ignore", "pipe", "pipe"] });
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
  const house = await bugHouse(t, "case-held");
  const ran = await python(house);
  const last = ran.out.trim().split("\n").pop() || "";
  let got;
  try { got = JSON.parse(last); } catch { got = null; }
  if (ran.code !== 0 || !got) return cannotRun(`the scratch store could not be set up: exit ${ran.code}: ${(ran.err.trim().split("\n").pop() || last).slice(0, 240)}`);
  if (got.no_module) return broken(`there is no bug_end.case_held to call: ${got.no_module}`);

  const wrong = [];
  const at = "2026-11-19T05:00:00Z";
  const note = `Every case holds again since the nightly run of ${at}`;
  for (const k of ["raised_a", "raised_b", "raised_unheld", "raised_closed"]) {
    if (got[k] !== null) wrong.push(`case_held raised (${k.slice(7)}): ${got[k]}`);
  }
  if (got.after_a.ticket !== "placed" || got.after_a.row !== "queued") {
    wrong.push(`with one case still broken the ticket was moved: ${JSON.stringify({ ticket: got.after_a.ticket, row: got.after_a.row })}`);
  }
  const b = got.after_b;
  if (b.ticket !== "cleared" || !b.ended_at) wrong.push(`with both cases holding the ticket reads ${b.ticket}, not cleared with an ended_at`);
  if (b.row !== "done" || b.outcome !== "cleared") wrong.push(`with both cases holding the row reads ${b.row}/${b.outcome}, not done/cleared`);
  if (!b.notes.some((n) => n.closing_remarks === `Cleared on its own: ${note}`)) {
    wrong.push(`the row's closing remarks are not "Cleared on its own: ${note}" (notes: ${JSON.stringify(b.notes).slice(0, 300)})`);
  }
  if (!b.notes.some((n) => n.question === "Still happening?" && n.choice === note)) wrong.push("the row has no Still happening? decision carrying the note");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("one held case left the ticket placed; both held cleared it, the row done cleared with the night's note; an unheld key and a closed connection raised nothing");
});
