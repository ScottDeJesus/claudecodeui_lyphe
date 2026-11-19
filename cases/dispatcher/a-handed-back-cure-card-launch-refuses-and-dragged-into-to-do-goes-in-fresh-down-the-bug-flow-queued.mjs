// protects: /home/lyphe/.claude/hooks/dispatcher/card_tell.py, /home/lyphe/.claude/hooks/dispatcher/card_chain.py, /home/lyphe/.claude/hooks/dispatcher/card_notes.py, /home/lyphe/.claude/hooks/dispatcher/store_cards.py
// writes: none
//
// A cure card row is the night's: the card line settles it and never launches it, so `card_chain.launch` refuses a row
// whose flow is `cure` before it writes a brief or runs the chain door. When the operator drags a handed-back cure card
// into To Do on a board that runs itself, the card goes down the board's own bug flow: `card_tell` takes the `queued`
// telling for that row as a card sent in fresh — flow `bug`, sorted by the detector (no model asked), its old walk,
// rulings and outcome cleared, the bug flow's steps and a tags note written, the row `queued`.
//
// A scratch dispatcher home; one handed-back cure row written straight into the store. `card_chain.launch` on it with
// the chain door stood in for (so a launch that is not refused reaches a door that records the call and runs nothing);
// then `dispatcher card told --event queued` for that card, the sorting model's CLI stood in for so a call is counted.

import fs from "node:fs";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bugHouse, exec, rows, said } from "../lib/bug_house.mjs";
import { dispatch, py, PRELUDE } from "../lib/cure_house.mjs";

const W1 = "chain-cure-case-drag-20261119-000000-0001";
const CARD = "c-cure-drag";
const TITLE = "Cure — the scratch case drag-one holds";

const STAND_IN = `#!/usr/bin/env python3
import json, os, sys
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "calls.jsonl"), "a") as h:
    h.write(json.dumps(sys.argv[1:]) + "\\n")
print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "result": "tweak 0.95", "num_turns": 1,
                  "session_id": "11111111-2222-4333-8444-555555555555", "total_cost_usd": 0.0}), flush=True)
`;

const LAUNCH = PRELUDE + String.raw`
import subprocess
from dispatcher import card_chain, store
calls = []
def door(argv, env):
    calls.append(argv)
    return subprocess.CompletedProcess(argv, 2, stdout="REFUSED by the case's stand-in door\n", stderr="")
card_chain._door = door
conn = store.connect()
row = conn.execute("SELECT * FROM cards WHERE card = ?", (sys.argv[1],)).fetchone()
try:
    card_chain.launch(conn, row)
    answer = "returned"
except store.Refused as exc:
    answer = "refused: " + str(exc)
except Exception as exc:
    answer = type(exc).__name__ + ": " + str(exc)
after = conn.execute("SELECT state, chain_id FROM cards WHERE card = ?", (sys.argv[1],)).fetchone()
print(json.dumps({"answer": answer, "door": len(calls), "state": after["state"], "chain_id": after["chain_id"]}))
`;

runCase(async (t) => {
  const h = await bugHouse(t, "cure-drag");
  const cliDir = path.join(h.dir, "cli");
  fs.mkdirSync(cliDir, { recursive: true });
  fs.writeFileSync(path.join(cliDir, "claude"), STAND_IN, { mode: 0o755 });
  const calls = path.join(cliDir, "calls.jsonl");
  Object.assign(h.env, { PLAN_RUNNER_CLAUDE_BIN: path.join(cliDir, "claude"), JEV_FORCE_OFF: "1", XDG_RUNTIME_DIR: path.join(cliDir, "no-runtime") });
  delete h.env.DISPATCHER_SCRATCH_DAEMON;

  const seeded = await py(h, PRELUDE + "from dispatcher import store\nstore.connect().close()\nprint('{}')");
  if (seeded.code !== 0) return cannotRun(`the scratch store would not open: ${said(seeded)}`);
  await exec(h, "INSERT INTO cards (id, board, card, board_name, title, words, priority, actor, repos, state, flow, sorted_by, " +
    "chain_id, rulings, outcome, told_at, launched_at, ended_at) VALUES (1, 'b-on', ?, 'Case board', ?, 'The case drag-one broke.', " +
    "'high', 'nightly', ?, 'handed-back', 'cure', 'detector', ?, 'an old ruling', 'cure ended', '2026-11-19T04:00:00Z', " +
    "'2026-11-19T04:00:00Z', '2026-11-19T05:00:00Z')", [CARD, TITLE, JSON.stringify([h.repo]), W1]);

  const wrong = [];
  const launch = await py(h, LAUNCH, [CARD]);
  if (launch.code !== 0 || !launch.json) return cannotRun(`card_chain.launch could not be driven: ${said(launch)}`);
  if (!launch.json.answer.startsWith("refused") || launch.json.door !== 0) {
    wrong.push(`card_chain.launch on a cure row answered ${JSON.stringify(launch.json.answer)} after ${launch.json.door} chain-door call(s), not a refusal before the door`);
  }
  if (launch.json.state !== "handed-back" || launch.json.chain_id !== W1) wrong.push(`the launch left the row ${launch.json.state} on ${launch.json.chain_id}`);

  const before = (await rows(h, "SELECT COUNT(*) AS n FROM card_notes WHERE card_id = 1"))[0].n;
  const drag = await dispatch(h, ["card", "told", "--event", "queued", "--by", "operator"], {
    input: JSON.stringify({
      board: { id: "b-on", name: "Case board", repos: [h.repo] },
      card: { id: CARD, title: TITLE, description: "The case drag-one broke.", body: "", tags: ["regression"], priority: "high",
              attachments: [], status: "todo", archived: false },
    }),
  });
  if (drag.code !== 0 || !drag.out.includes(`TOLD card b-on/${CARD} — queued`)) wrong.push(`the drag did not print TOLD card b-on/${CARD} — queued — ${said(drag)}`);
  const [row] = await rows(h, "SELECT state, flow, sorted_by, chain_id, rulings, outcome FROM cards WHERE id = 1");
  const want = { state: "queued", flow: "bug", sorted_by: "detector", chain_id: null, rulings: null, outcome: null };
  if (JSON.stringify(row) !== JSON.stringify(want)) wrong.push(`the dragged row reads ${JSON.stringify(row)}, not ${JSON.stringify(want)}`);
  const added = await rows(h, "SELECT kind, key, payload FROM card_notes WHERE card_id = 1 ORDER BY id LIMIT -1 OFFSET ?", [before]);
  const stepsNotes = added.filter((n) => n.kind === "steps").map((n) => n.payload);
  if (!stepsNotes.some((p) => p.includes('"Sort"') && !p.includes("Cure the cause"))) wrong.push(`the drag wrote no bug-flow steps note (steps notes: ${JSON.stringify(stepsNotes)})`);
  if (!added.some((n) => n.kind === "tags" && JSON.parse(n.payload).add?.includes("bug"))) wrong.push(`the drag wrote no tags note adding bug (added: ${JSON.stringify(added.map((n) => `${n.kind}:${n.key}`))})`);
  const asked = fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).length : 0;
  if (asked > 0) wrong.push(`the sorting model was asked ${asked} time(s) about a cure card`);

  if (wrong.length) return broken(wrong.join("; "));
  return held("launch refused the cure row before its door; dragged into To Do it was queued fresh as a detector-sorted bug with the bug steps and a bug tag, no model asked");
});
