// protects: /home/lyphe/.claude/hooks/dispatcher/bug_file.py, /home/lyphe/.claude/hooks/dispatcher/card_chain.py, /home/lyphe/.claude/hooks/dispatcher/bug_end.py, /home/lyphe/.claude/hooks/dispatcher/card_settle_cure.py
// writes: none
//
// The night's cure files a ticket keyed on its case, and the ticket is how the board sees the night's walk. A case
// can break, be cured or handed back, hold again (a held run clears its ticket and sets the card row `done`), then
// break again. The next night's cure of that case meets a CLEARED ticket, not an open one. That filing must still put
// the new walk on the board: an open ticket holding the case's key names the new walk, and its card row, when it has
// one, walks that walk as a cure. What must never happen is a card row left `queued` with flow `cure`. The card line
// refuses to launch or resume a cure (`card_chain._refuse_cure`), so such a row fails at every take-up and never
// leaves To Do, and the night's walk ends with no card settling it.
//
// A scratch dispatcher home (bug_house), a board that runs itself. The first night's ticket is filed and placed
// through the bug command, its walk's ending settled through `card_settle_cure._ended`, the ticket cleared with
// `bug cleared`, and the second night's cure filed with a new walk.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, rows, said } from "../lib/bug_house.mjs";
import { py, PRELUDE } from "../lib/cure_house.mjs";

const W1 = "chain-cure-cleared-20261119-000000-0001";
const W2 = "chain-cure-cleared-20261120-000000-0002";
const TITLE = "Cure — the scratch case cleared-one holds";

const HAND_BACK = PRELUDE + String.raw`
from dispatcher import card_settle_cure, store, store_cards
conn = store.connect()
row = store_cards.card_by_id(conn, int(sys.argv[1]))
print(json.dumps({"state": card_settle_cure._ended(conn, row, row["chain_id"], [], "failed")}))
`;

const LAUNCH = PRELUDE + String.raw`
import subprocess
from dispatcher import card_chain, store
card_chain._door = lambda argv, env: subprocess.CompletedProcess(argv, 2, stdout="REFUSED by the case's stand-in door\n", stderr="")
conn = store.connect()
row = conn.execute("SELECT * FROM cards WHERE id = ?", (int(sys.argv[1]),)).fetchone()
try:
    card_chain.launch(conn, row)
    answer = "returned"
except Exception as exc:
    answer = type(exc).__name__ + ": " + str(exc)
print(json.dumps({"answer": answer}))
`;

runCase(async (t) => {
  const h = await bugHouse(t, "cure-cleared");
  Object.assign(h.env, { JEV_FORCE_OFF: "1" });
  delete h.env.DISPATCHER_SCRATCH_DAEMON;
  const key = `case:${h.repo}:cleared-one`;
  const fileCure = (walk) => bug(h, ["file", "--title", TITLE, "--key", key, "--source", "nightly", "--walk", walk, "--path", h.repo],
    { input: "Make these cases hold again by curing the cause at the source.\n" });

  const first = await fileCure(W1);
  if (first.code !== 0 || !first.out.includes("FILED ticket 1")) return cannotRun(`the first night's ticket was not filed: ${said(first)}`);
  const placed = await bug(h, ["placed", "1", "--result", "-"], {
    input: JSON.stringify({ board: { id: "b-on", name: "Case board", repos: [h.repo], autonomy: true }, card: { id: "c-cleared" } }),
  });
  if (placed.code !== 0 || !placed.out.includes("walking")) return cannotRun(`the first night's ticket was not placed walking: ${said(placed)}`);
  const [placedRow] = await rows(h, "SELECT id FROM cards WHERE card = 'c-cleared'");
  const back = await py(h, HAND_BACK, [placedRow.id]);
  if (back.json?.state !== "handed-back") return cannotRun(`the first walk's ending could not be settled: ${said(back)}`);
  const cleared = await bug(h, ["cleared", "--key", key, "--note", "held at the next night's run"]);
  if (!cleared.out.includes("CLEARED ticket 1")) return cannotRun(`the ticket was not cleared: ${said(cleared)}`);

  const second = await fileCure(W2);
  if (second.code !== 0) return cannotRun(`the second night's filing failed: ${said(second)}`);

  const wrong = [];
  const open = await rows(h, "SELECT t.id, t.state, t.walk, t.card_row FROM tickets t JOIN ticket_keys k ON k.ticket_id = t.id " +
    "WHERE k.key = ? AND t.state IN ('filed', 'placed', 'unplaced')", [key]);
  if (open.length !== 1) wrong.push(`${open.length} open tickets hold the case's key after the second cure, not 1`);
  for (const ticket of open) {
    if (ticket.walk !== W2) wrong.push(`the open ticket ${ticket.id} names walk ${ticket.walk}, not the second night's ${W2}`);
    if (ticket.card_row !== null) {
      const [row] = await rows(h, "SELECT state, flow, chain_id FROM cards WHERE id = ?", [ticket.card_row]);
      const want = { state: "walking", flow: "cure", chain_id: W2 };
      if (JSON.stringify(row) !== JSON.stringify(want)) wrong.push(`its card row reads ${JSON.stringify(row)}, not ${JSON.stringify(want)}`);
    }
  }
  const stuck = await rows(h, "SELECT id FROM cards WHERE state = 'queued' AND flow = 'cure'");
  for (const row of stuck) {
    const launch = await py(h, LAUNCH, [row.id]);
    wrong.push(`card row ${row.id} is left queued with flow cure, and its take-up's launch answers ${JSON.stringify(launch.json?.answer ?? said(launch))}`);
  }

  if (wrong.length) return broken(`second filing said ${JSON.stringify(second.out.trim().split("\n").pop())}; ` + wrong.join("; "));
  return held(`the second night's cure of a cleared ticket said ${JSON.stringify(second.out.trim().split("\n").pop())}; the open ticket names ${W2} and no card row is queued as a cure`);
});
