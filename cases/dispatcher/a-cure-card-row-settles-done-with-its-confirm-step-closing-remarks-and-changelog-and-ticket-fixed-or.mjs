// protects: /home/lyphe/.claude/hooks/dispatcher/card_settle.py, /home/lyphe/.claude/hooks/dispatcher/card_settle_cure.py, /home/lyphe/.claude/hooks/dispatcher/card_notes.py, /home/lyphe/.claude/hooks/dispatcher/store_tickets.py, /home/lyphe/.claude/hooks/dispatcher/store_cards.py
// writes: none
//
// A card row walking the night's cure (flow `cure`) is settled by the cure's own rules when its walker ends
// (`card_settle.settle` hands it to `card_settle_cure`). A walk that ended `done`: the confirm step `Confirm: each case
// holds` done with each case's word as it reads now, closing remarks `Cured by the night's walk. Changed: <targets>.`
// and a line per case, the changelog note `Holds again: <the first case's sentence>`, `status done`, the row `done`, its
// ticket `fixed`. Any other ending: the plan `The night's cure walk ended <status> and <n> of its cases still break.
// The next night's triage looks again.`, `status not_ready`, the row `handed-back` with outcome `cure ended`, and the
// ticket still open, so the next night's triage can look again.
//
// A scratch dispatcher home over a scratch suite with two cases, each broken and triaged a regression naming its own
// walk; `cured-one` has held since, `still-one` has not. One walking cure row and one placed ticket per case written
// straight into the store, and one chain record per walk (`done`, `failed`); then `card_settle.settle` on each row, as
// the daemon's sweep calls it when the walker's pidfd fires.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { cureHouse, py, PRELUDE, seedBreak } from "../lib/cure_house.mjs";

const W_DONE = "chain-cure-case-settle-20261119-000000-0001";
const W_FAIL = "chain-cure-case-settle-20261119-000000-0002";

const SETTLE = PRELUDE + String.raw`
from dispatcher import store, card_settle
from plan_runner.solo import chain_state
repo, culprit, w_done, w_fail = sys.argv[1:5]
def record(chain_id, status):
    r = chain_state.blank(chain_id, chain_id[6:40], agent="asclepius", cwd=repo, add_dirs=[], docs=False, pause=False, brief="b")
    r.update({"status": status, "ended_at": time.time(), "until_pass": True,
              "stages": [{"name": "builder", "status": "done"}, {"name": "athena-1", "status": "done"}],
              "targets": [{"path": culprit, "rel": "culprit.py", "repo": repo}]})
    if status != "done":
        r["failed_stage"] = "athena-1"
    os.makedirs(chain_state.dir_for(chain_id), exist_ok=True)
    with open(chain_state.path_for(chain_id, "chain.json"), "w", encoding="utf-8") as fh:
        json.dump(r, fh)
conn = store.connect()
out = {}
for n, (name, walk, status) in enumerate((("cured-one", w_done, "done"), ("still-one", w_fail, "failed")), start=1):
    record(walk, status)
    key = "case:" + repo + ":" + name
    with conn:
        conn.execute("INSERT INTO cards (id, board, card, board_name, title, words, priority, actor, repos, state, flow, "
                     "sorted_by, chain_id, told_at, launched_at) VALUES (?, 'b-1', ?, 'Case board', ?, 'w', 'high', "
                     "'nightly', ?, 'walking', 'cure', 'detector', ?, '2026-11-19T04:00:00Z', '2026-11-19T04:00:00Z')",
                     (n, "c-" + name, "Cure — " + name, json.dumps([repo]), walk))
        conn.execute("INSERT INTO tickets (id, source, path, title, words, priority, reporter, session, walk, state, board, card, "
                     "card_row, times, filed_at, placed_at) VALUES (?, 'nightly', ?, ?, 'w', 'high', '{}', NULL, ?, 'placed', "
                     "'b-1', ?, ?, 1, '2026-11-19T04:00:00Z', '2026-11-19T04:00:01Z')", (n, repo, "Cure — " + name, walk, "c-" + name, n))
        conn.execute("INSERT INTO ticket_keys (ticket_id, key) VALUES (?, ?)", (n, key))
    row = conn.execute("SELECT * FROM cards WHERE id = ?", (n,)).fetchone()
    settled = card_settle.settle(conn, row)
    c = conn.execute("SELECT state, outcome FROM cards WHERE id = ?", (n,)).fetchone()
    t = conn.execute("SELECT state FROM tickets WHERE id = ?", (n,)).fetchone()
    notes = [{"kind": x["kind"], "key": x["key"], "payload": json.loads(x["payload"])}
             for x in conn.execute("SELECT kind, key, payload FROM card_notes WHERE card_id = ? ORDER BY id", (n,))]
    out[name] = {"settled": getattr(settled, "state", str(settled)), "row": c["state"], "outcome": c["outcome"],
                 "ticket": t["state"], "notes": notes}
print(json.dumps(out))
`;

const FAIL_PLAN = "The night's cure walk ended failed and 1 of its cases still break. The next night's triage looks again.";

runCase(async (t) => {
  const h = await cureHouse(t, "cure-settle", ["cured-one", "still-one"]);
  await seedBreak(h, "cured-one", { walk: W_DONE, heldAfter: true });
  await seedBreak(h, "still-one", { walk: W_FAIL, heldAfter: false });
  const ran = await py(h, SETTLE, [h.repo, h.culprit, W_DONE, W_FAIL]);
  if (ran.code !== 0 || !ran.json) return cannotRun(`the settle could not be driven: ${(ran.err.trim().split("\n").pop() || ran.out).slice(0, 300)}`);
  const { "cured-one": done, "still-one": fail } = ran.json;
  const wrong = [];
  const of = (rec, kind, field) => rec.notes.filter((n) => n.kind === kind && field in n.payload).map((n) => n.payload[field]);

  // the walk that cured
  if (done.row !== "done" || done.ticket !== "fixed") wrong.push(`the done walk left its row ${done.row} and its ticket ${done.ticket}, not done and fixed`);
  const confirm = done.notes.filter((n) => n.kind === "step" && n.payload.text === "Confirm: each case holds" && n.payload.state === "done");
  if (confirm.length !== 1 || !/holding/.test(String(confirm[0].payload.note))) wrong.push(`its confirm steps done read ${JSON.stringify(confirm.map((n) => n.payload.note))}, not one naming the case's word holding`);
  const closing = of(done, "text", "closing_remarks");
  if (closing.length !== 1 || !closing[0].startsWith("Cured by the night's walk. Changed: ") || !closing[0].includes("culprit.py") || !closing[0].includes("cured-one")) {
    wrong.push(`its closing remarks read ${JSON.stringify(closing)}, not one opening "Cured by the night's walk. Changed: " naming culprit.py and a line for cured-one`);
  }
  const changelog = done.notes.filter((n) => n.kind === "text" && n.key === "changelog").map((n) => n.payload.changelog);
  const line = `Holds again: ${h.sentence("cured-one")}`;
  if (JSON.stringify(changelog) !== JSON.stringify([line])) wrong.push(`its changelog notes read ${JSON.stringify(changelog)}, not [${JSON.stringify(line)}]`);
  if (!of(done, "status", "status").includes("done")) wrong.push(`its status notes read ${JSON.stringify(of(done, "status", "status"))}, with no done`);

  // the walk that did not cure
  if (fail.row !== "handed-back" || fail.outcome !== "cure ended") wrong.push(`the failed walk left its row ${fail.row} (outcome ${fail.outcome}), not handed-back with cure ended`);
  if (fail.ticket !== "placed") wrong.push(`the failed walk's ticket reads ${fail.ticket}, not still open`);
  if (!of(fail, "text", "plan").includes(FAIL_PLAN)) wrong.push(`its plan notes read ${JSON.stringify(of(fail, "text", "plan"))}, not ${JSON.stringify(FAIL_PLAN)}`);
  if (!of(fail, "status", "status").includes("not_ready")) wrong.push(`its status notes read ${JSON.stringify(of(fail, "status", "status"))}, with no not_ready`);
  if (of(fail, "status", "status").includes("done") || of(fail, "question", "text").length) wrong.push("the failed cure was marked done or asked a question");

  if (wrong.length) return broken(wrong.join("; "));
  return held("the done cure settled its confirm step, closing remarks, changelog and status done with its ticket fixed; the failed one went to Not ready with its plan, handed-back, its ticket open");
});
