// protects: /home/lyphe/.claude/hooks/dispatcher/card_notes_owed.py, /home/lyphe/.claude/hooks/dispatcher/card_notes.py, /home/lyphe/.claude/hooks/dispatcher/store_cards.py
// writes: none
//
// The night's cure walk is a `plan-runner chain --until-pass` walk: its chain record carries NO `flow`, so a cure card
// row's owed notes read the flow off the ROW. Its builder and every fix-pass mark the cure's step 1, `Cure the cause`;
// its Athena rounds mark step 2, `Confirm: each case holds`; and every note of the walk's progress (all but the card's
// `steps` checklist, which the placing stamp writes once) is keyed on the walk's id, so when a second
// cure is adopted onto the same card (the row re-pointed at the new walk) its notes are NEW notes, not swallowed as the
// first walk's (a note is written once per card, kind and key).
//
// A scratch dispatcher home; one walking cure row on walk W1 whose record (no flow) ran builder, scenarios, athena-1
// and fix-pass; `card_notes_owed.write` on it; the row re-pointed at W2, whose record ran the same; `write` again.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bugHouse } from "../lib/bug_house.mjs";
import { py, PRELUDE } from "../lib/cure_house.mjs";

const W1 = "chain-cure-case-notes-20261119-000000-0001";
const W2 = "chain-cure-case-notes-20261119-000000-0002";
const CURE_STEPS = ["Found by the night's run", "Cure the cause", "Confirm: each case holds"];

const OWED = PRELUDE + String.raw`
from dispatcher import store, card_notes_owed
from plan_runner.solo import chain_state
repo, w1, w2 = sys.argv[1:4]
def record(chain_id):
    r = chain_state.blank(chain_id, chain_id[6:40], agent="asclepius", cwd=repo, add_dirs=[], docs=False, pause=False, brief="b")
    r.pop("flow", None)
    r.update({"status": "walking", "until_pass": True,
              "stages": [{"name": n, "status": "done"} for n in ("builder", "scenarios", "athena-1", "fix-pass")]})
    os.makedirs(chain_state.dir_for(chain_id), exist_ok=True)
    with open(chain_state.path_for(chain_id, "chain.json"), "w", encoding="utf-8") as fh:
        json.dump(r, fh)
    return r
conn = store.connect()
with conn:
    conn.execute("INSERT INTO cards (id, board, card, board_name, title, words, priority, actor, repos, state, flow, "
                 "sorted_by, chain_id, told_at, launched_at) VALUES (1, 'b-1', 'c-1', 'Case board', 'Cure — notes', 'w', 'high', "
                 "'nightly', ?, 'walking', 'cure', 'detector', ?, '2026-11-19T04:00:00Z', '2026-11-19T04:00:00Z')",
                 (json.dumps([repo]), w1))
def notes():
    return [{"id": x["id"], "kind": x["kind"], "key": x["key"], "payload": json.loads(x["payload"])}
            for x in conn.execute("SELECT id, kind, key, payload FROM card_notes WHERE card_id = 1 ORDER BY id")]
out = {}
card_notes_owed.write(conn, conn.execute("SELECT * FROM cards WHERE id = 1").fetchone(), record(w1))
out["w1"] = notes()
with conn:
    conn.execute("UPDATE cards SET chain_id = ? WHERE id = 1", (w2,))
card_notes_owed.write(conn, conn.execute("SELECT * FROM cards WHERE id = 1").fetchone(), record(w2))
out["w2"] = notes()
print(json.dumps(out))
`;

function stepTexts(notes) {
  return notes.filter((n) => n.kind === "step").map((n) => n.payload.text);
}

runCase(async (t) => {
  const h = await bugHouse(t, "cure-notes");
  const ran = await py(h, OWED, [h.repo, W1, W2]);
  if (ran.code !== 0 || !ran.json) return cannotRun(`the owed notes could not be driven: ${(ran.err.trim().split("\n").pop() || ran.out).slice(0, 300)}`);
  const first = ran.json.w1;
  const second = ran.json.w2.slice(first.length);
  const wrong = [];
  for (const [walk, written] of [[W1, first], [W2, second]]) {
    const tag = walk === W1 ? "the first walk" : "the second walk";
    if (!written.length) { wrong.push(`${tag} wrote no notes`); continue; }
    const steps = stepTexts(written);
    for (const want of ["Cure the cause", "Confirm: each case holds"]) {
      if (!steps.includes(want)) wrong.push(`${tag} wrote no "${want}" step (its steps: ${JSON.stringify(steps)})`);
    }
    const foreign = steps.filter((s) => !CURE_STEPS.includes(s));
    if (foreign.length) wrong.push(`${tag} wrote steps of another flow: ${JSON.stringify(foreign)}`);
    // The `steps` checklist is the card's, written once by the placing stamp; every note of the walk's progress is the walk's.
    const unkeyed = written.filter((n) => n.kind !== "steps" && !String(n.key).includes(walk)).map((n) => `${n.kind}:${n.key}`);
    if (unkeyed.length) wrong.push(`${tag} wrote notes not keyed on its id: ${JSON.stringify(unkeyed)}`);
  }
  const kept = ran.json.w2.slice(0, first.length);
  if (JSON.stringify(kept) !== JSON.stringify(first)) wrong.push("the first walk's notes changed when the second walk's were written");

  if (wrong.length) return broken(wrong.join("; "));
  return held(`a cure row with no flow on its record wrote Cure the cause and Confirm steps keyed on its walk (${first.length} notes), and the second walk wrote ${second.length} new notes of its own`);
});
