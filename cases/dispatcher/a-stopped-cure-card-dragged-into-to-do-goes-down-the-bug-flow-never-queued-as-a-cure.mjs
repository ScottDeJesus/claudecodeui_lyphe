// protects: /home/lyphe/.claude/hooks/dispatcher/card_tell.py, /home/lyphe/.claude/hooks/dispatcher/card_chain.py
// writes: none
//
// A walking cure card the operator moves to Not ready or to Done is told `stopped`: its row reads `stopped`, its
// flow still `cure`. When he later drags it into To Do, CloudCLI tells `queued`. The card line never launches or
// resumes a cure (`card_chain._refuse_cure`), so a row queued with flow `cure` fails at every take-up and never
// leaves To Do. The drag must send it in fresh down the bug flow, as it does a handed-back cure card: queued with
// flow `bug`, sorted by the detector, its old walk cleared.
//
// A scratch dispatcher home; one stopped cure row and one withdrawn cure row written straight into the store; each
// told `queued` through `dispatcher card told`, and `card_chain.launch` tried on any row left queued as a cure, the
// chain door stood in for so nothing runs.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bugHouse, exec, rows, said } from "../lib/bug_house.mjs";
import { dispatch, py, PRELUDE } from "../lib/cure_house.mjs";

const W1 = "chain-cure-stopped-20261119-000000-0001";

const LAUNCH = PRELUDE + String.raw`
import subprocess
from dispatcher import card_chain, store
card_chain._door = lambda argv, env: subprocess.CompletedProcess(argv, 2, stdout="REFUSED by the case's stand-in door\n", stderr="")
conn = store.connect()
row = conn.execute("SELECT * FROM cards WHERE card = ?", (sys.argv[1],)).fetchone()
try:
    card_chain.launch(conn, row)
    answer = "returned"
except Exception as exc:
    answer = type(exc).__name__ + ": " + str(exc)
print(json.dumps({"answer": answer}))
`;

runCase(async (t) => {
  const h = await bugHouse(t, "cure-stopped");
  Object.assign(h.env, { JEV_FORCE_OFF: "1" });
  delete h.env.DISPATCHER_SCRATCH_DAEMON;
  const opened = await py(h, PRELUDE + "from dispatcher import store\nstore.connect().close()\nprint('{}')");
  if (opened.code !== 0) return cannotRun(`the scratch store would not open: ${said(opened)}`);
  const cards = [["c-stopped", "stopped"], ["c-withdrawn", "withdrawn"]];
  for (const [i, [card, state]] of cards.entries()) {
    await exec(h, "INSERT INTO cards (id, board, card, board_name, title, words, priority, actor, repos, state, flow, sorted_by, " +
      "chain_id, outcome, told_at, launched_at, ended_at) VALUES (?, 'b-on', ?, 'Case board', ?, 'The case broke.', 'high', " +
      "'nightly', ?, ?, 'cure', 'detector', ?, NULL, '2026-11-19T04:00:00Z', '2026-11-19T04:00:00Z', '2026-11-19T05:00:00Z')",
      [i + 1, card, `Cure — ${card}`, JSON.stringify([h.repo]), state, W1]);
  }

  const wrong = [];
  for (const [card, state] of cards) {
    const drag = await dispatch(h, ["card", "told", "--event", "queued", "--by", "operator"], {
      input: JSON.stringify({
        board: { id: "b-on", name: "Case board", repos: [h.repo] },
        card: { id: card, title: `Cure — ${card}`, description: "The case broke.", body: "", tags: ["regression"], priority: "high",
                attachments: [], status: "todo", archived: false },
      }),
    });
    if (drag.code !== 0) { wrong.push(`the drag of the ${state} cure card failed: ${said(drag)}`); continue; }
    const [row] = await rows(h, "SELECT state, flow, chain_id FROM cards WHERE card = ?", [card]);
    if (row.state === "queued" && row.flow === "cure") {
      const launch = await py(h, LAUNCH, [card]);
      wrong.push(`the ${state} cure card dragged into To Do reads ${JSON.stringify(row)}, and its take-up's launch answers ${JSON.stringify(launch.json?.answer ?? said(launch))}`);
    } else if (row.state === "queued" && (row.flow !== "bug" || row.chain_id !== null)) {
      wrong.push(`the ${state} cure card dragged into To Do reads ${JSON.stringify(row)}, not queued fresh down the bug flow`);
    }
  }

  if (wrong.length) return broken(wrong.join("; "));
  return held("a stopped and a withdrawn cure card dragged into To Do were neither left queued as a cure");
});
