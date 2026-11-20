// A Cerberus ticket is a bug by construction: its words are a red check's reason, and no model is ever asked what it
// is (the plan's constraint beside `scripts/jev`: "a Cerberus ticket is never sorted by a model at all"). On a board
// that runs itself the placing stamp writes its row queued as a detector-sorted bug. On a board that is switched off
// the row is written withdrawn, and "a drag into To Do after the switch is turned on queues it" — that drag must queue
// the same detector-sorted bug, not hand the red check's words to Jev and Haiku as an untyped card's sort does.
//
// A scratch dispatcher home; one Cerberus ticket filed through the bug command and stamped onto a board switched off;
// then CloudCLI's drag told as `dispatcher card told --event queued`. Jev is held off (`JEV_FORCE_OFF=1`) and the
// Claude CLI the sort would spawn is a stand-in that only logs its call and answers "tweak 0.95", so no model is
// reached and no text leaves the box; a call in its log is the model sort this case says never happens.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/bug_place.py, /home/lyphe/.claude/hooks/dispatcher/card_tell.py, /home/lyphe/.claude/hooks/dispatcher/card_notes.py, /home/lyphe/.claude/hooks/dispatcher/store_cards.py
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { bug, bugHouse, DISPATCHER, rows, said } from "../lib/bug_house.mjs";
import { spawn } from "node:child_process";

const FILED = /^FILED ticket (\d+) — /m;
const SORT_NOTE = "bug — filed by Cerberus's red watch";
const CARD = "c-red-1";

const STAND_IN = `#!/usr/bin/env python3
import json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "calls.jsonl"), "a") as h:
    h.write(json.dumps(sys.argv[1:]) + "\\n")
try:
    sys.stdin.read()
except Exception:
    pass
answer = "tweak 0.95"
sid = "11111111-2222-4333-8444-555555555555"
usage = {"input_tokens": 40, "output_tokens": 4, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
for line in ({"type": "system", "subtype": "init", "session_id": sid, "model": "claude-haiku-5-5"},
             {"type": "assistant", "session_id": sid, "message": {"id": "msg_1", "model": "claude-haiku-5-5",
              "role": "assistant", "content": [{"type": "text", "text": answer}], "usage": usage}},
             {"type": "result", "subtype": "success", "is_error": False, "result": answer, "num_turns": 1,
              "session_id": sid, "total_cost_usd": 0.0, "usage": usage}):
    print(json.dumps(line), flush=True)
`;

function told(house, record) {
  return new Promise((resolve) => {
    const child = spawn(DISPATCHER, ["card", "told", "--event", "queued", "--by", "operator"],
      { env: house.env, cwd: house.dir, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { err += b; });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, out, err: `${err}${e.message}` }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.end(JSON.stringify(record));
  });
}

runCase(async (t) => {
  const house = await bugHouse(t, "cerberus-drag");
  const cliDir = path.join(house.dir, "cli");
  fs.mkdirSync(cliDir, { recursive: true });
  const cli = path.join(cliDir, "claude");
  fs.writeFileSync(cli, STAND_IN, { mode: 0o755 });
  const calls = path.join(cliDir, "calls.jsonl");
  Object.assign(house.env, { PLAN_RUNNER_CLAUDE_BIN: cli, JEV_FORCE_OFF: "1", XDG_RUNTIME_DIR: path.join(cliDir, "no-runtime") });
  delete house.env.DISPATCHER_SCRATCH_DAEMON;

  const filed = await bug(house, ["file", "--title", "Backups check is red", "--source", "cerberus", "--key", "check:box/backups"],
    { input: "red for 61 minutes: the last backup is 26 hours old\n" });
  const m = filed.out.match(FILED);
  if (filed.code !== 0 || !m) return cannotRun(`the Cerberus ticket could not be filed — ${said(filed)}`);
  const id = Number(m[1]);

  const board = { id: "b-off", name: "Off board", repos: [house.repo] };
  const stamped = await bug(house, ["placed", String(id), "--result", "-"],
    { input: JSON.stringify({ board: { ...board, autonomy: false }, card: { id: CARD } }) });
  if (stamped.code !== 0 || !/^PLACED ticket \d+ — Off board — withdrawn$/m.test(stamped.out)) {
    return cannotRun(`the stamp onto the board switched off did not print PLACED … — withdrawn — ${said(stamped)}`);
  }

  const drag = await told(house, {
    board,
    card: { id: CARD, title: "Backups check is red", description: "red for 61 minutes: the last backup is 26 hours old",
            body: "", tags: [], priority: "high", attachments: [], status: "todo", archived: false },
  });
  const wrong = [];
  if (drag.code !== 0 || !drag.out.includes(`TOLD card b-off/${CARD} — queued`)) {
    wrong.push(`the drag did not print TOLD card b-off/${CARD} — queued — ${said(drag)}`);
  }
  const [row] = await rows(house, "SELECT state, flow, sorted_by FROM cards WHERE card = ?", [CARD]);
  const want = { state: "queued", flow: "bug", sorted_by: "detector" };
  if (!row || JSON.stringify(row) !== JSON.stringify(want)) {
    wrong.push(`the dragged row reads ${JSON.stringify(row)}, not ${JSON.stringify(want)}`);
  }
  const notes = await rows(house, "SELECT n.kind, n.payload FROM card_notes n JOIN cards c ON c.id = n.card_id WHERE c.card = ?", [CARD]);
  const sortNotes = notes.filter((n) => n.kind === "step" && JSON.parse(n.payload).text === "Sort").map((n) => JSON.parse(n.payload).note);
  if (sortNotes.length !== 1 || sortNotes[0] !== SORT_NOTE) {
    wrong.push(`its Sort step notes read ${JSON.stringify(sortNotes)}, not ["${SORT_NOTE}"]`);
  }
  const asked = fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).length : 0;
  if (asked > 0) wrong.push(`the sorting model was asked ${asked} time(s) about a Cerberus ticket`);
  if (wrong.length) return broken(wrong.join("; "));
  return held(`the Cerberus ticket stamped onto a board switched off and dragged into To Do queued as a detector-sorted bug with its Sort note, and no model was asked`);
});
