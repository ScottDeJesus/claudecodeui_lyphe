// protects: /home/lyphe/.claude/hooks/dispatcher/card_tell.py, /home/lyphe/.claude/hooks/dispatcher/card_settle.py, /home/lyphe/.claude/hooks/dispatcher/store_cards.py
// writes: none
//
// The board's design: a card moved into To Do is sent in again, and a card whose walk finished (row `done`) walks
// afresh (`card_tell._SEND_AGAIN`). The board learns where the card stands only from the notes the dispatcher owes it:
// a card moves lanes only on a `status` note (kanban-dispatch.apply.ts), and the closing remarks and changelog are
// `text` notes. A note is written once per (card, kind, key) (`store_cards.put_note`), so a second walk that settles
// under the first walk's keys owes the board nothing: the card would sit in To Do, counted "waiting to start", with
// its row `done`. The promise: when the second walk settles done, the board is owed a Done status, closing remarks
// and a changelog line again.
//
// A scratch dispatcher home; one tweak card written straight into the store, settled done once through the real
// `card_settle._done` and its notes stamped applied (as CloudCLI stamps them); then told `queued` through
// `dispatcher card told`; then walked and settled done a second time. No chain runs and no model is asked.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bugHouse, exec, said } from "../lib/bug_house.mjs";
import { dispatch, py, PRELUDE } from "../lib/cure_house.mjs";

const CARD = "c-again";

const SETTLE = PRELUDE + String.raw`
from dispatcher import card_settle, store, store_cards
conn = store.connect()
row = conn.execute("SELECT * FROM cards WHERE card = ?", (sys.argv[1],)).fetchone()
walk = sys.argv[2]
with conn:
    store_cards.set_card(conn, row["id"], state="walking", chain_id=walk)
row = store_cards.card_by_id(conn, row["id"])
card_settle._done(conn, row, {"id": walk, "flow": "tweak", "flags": [f"the quick tweak held: {walk}"]}, walk)
owed = conn.execute("SELECT kind, key, payload FROM card_notes WHERE card_id = ? AND applied_at IS NULL ORDER BY id",
                    (row["id"],)).fetchall()
with conn:
    conn.execute("UPDATE card_notes SET applied_at = ? WHERE card_id = ? AND applied_at IS NULL", (store.now(), row["id"]))
state = store_cards.card_by_id(conn, row["id"])["state"]
print(json.dumps({"state": state, "owed": [[k, key, json.loads(p)] for k, key, p in owed]}))
`;

const wants = (owed) => ({
  done: owed.some(([kind, , payload]) => kind === "status" && payload.status === "done"),
  closing: owed.some(([kind, , payload]) => kind === "text" && typeof payload.closing_remarks === "string"),
  changelog: owed.some(([kind, , payload]) => kind === "text" && typeof payload.changelog === "string"),
});

runCase(async (t) => {
  const h = await bugHouse(t, "walk-again-notes");
  Object.assign(h.env, { JEV_FORCE_OFF: "1" });
  delete h.env.DISPATCHER_SCRATCH_DAEMON;
  const opened = await py(h, PRELUDE + "from dispatcher import store\nstore.connect().close()\nprint('{}')");
  if (opened.code !== 0) return cannotRun(`the scratch store would not open: ${said(opened)}`);
  await exec(h, "INSERT INTO cards (id, board, card, board_name, title, words, priority, actor, repos, state, flow, sorted_by, " +
    "told_at, queued_at) VALUES (1, 'b-on', ?, 'Case board', 'Rename the switch', 'Say it plainly.', 'medium', 'operator', ?, " +
    "'queued', 'tweak', 'model', '2026-11-19T04:00:00Z', '2026-11-19T04:00:00Z')", [CARD, JSON.stringify([h.repo])]);

  const first = await py(h, SETTLE, [CARD, "chain-case-walk-one-20261120-000000-0001"]);
  if (first.code !== 0 || !first.json) return cannotRun(`the first walk would not settle: ${said(first)}`);
  const one = wants(first.json.owed);
  if (!(one.done && one.closing && one.changelog)) {
    return cannotRun(`the first walk's settle owed ${JSON.stringify(first.json.owed.map(([k, key]) => `${k}:${key}`))}, not a Done status, closing remarks and a changelog`);
  }

  const drag = await dispatch(h, ["card", "told", "--event", "queued", "--by", "operator"], {
    input: JSON.stringify({
      board: { id: "b-on", name: "Case board", repos: [h.repo] },
      card: { id: CARD, title: "Rename the switch", description: "Say it plainly.", body: "", tags: [], priority: "medium",
              attachments: [], status: "todo", archived: false },
    }),
  });
  const told = drag.out.trim().split("\n").pop() ?? "";
  if (drag.code !== 0 || !told.endsWith("— queued")) return broken(`the done card dragged into To Do answered "${told || said(drag)}", not queued`);

  const second = await py(h, SETTLE, [CARD, "chain-case-walk-two-20261120-000000-0002"]);
  if (second.code !== 0 || !second.json) return cannotRun(`the second walk would not settle: ${said(second)}`);
  const two = wants(second.json.owed);
  const missing = Object.entries(two).filter(([, ok]) => !ok).map(([name]) => name);
  if (missing.length) {
    return broken(`the second walk settled ${second.json.state} and owes the board ${second.json.owed.length} note(s) ` +
      `(${JSON.stringify(second.json.owed.map(([k, key]) => `${k}:${key}`))}): no ${missing.join(", no ")} — the card stays in To Do on the board`);
  }
  return held("the second walk of a card dragged back into To Do owes the board its own Done status, closing remarks and changelog");
});
