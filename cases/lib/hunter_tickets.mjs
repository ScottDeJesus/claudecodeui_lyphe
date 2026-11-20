// hunter_tickets.mjs — a bug hunter's tickets in a scratch dispatcher home: a night and a sitting row, the hunter's
// environment, a stand-in sorting model, and the two tellings a needs-you card meets (`bug placed`, `card told`).
//
//   import { hunterHouse, huntEnv, placed, told, huntSoul } from "../lib/hunter_tickets.mjs";
//   const house = await hunterHouse(t, "needs-you", { perSession: 1 });   // bugHouse + a store, a night, sitting 1
//   await bug(house, ["file", "--title", "T", "--needs-you", "S."], { input: "w", env: huntEnv("security") });
//   const ran = await placed(house, 2, { id: "b-on", name: "On", autonomy: true }, "c-1");   // { code, out, err }
//
// EVERY PATH IS SCRATCH (bugHouse's home, state and charters). The sort never reaches a model: Jev is held off
// (JEV_FORCE_OFF=1) and PLAN_RUNNER_CLAUDE_BIN is a stand-in that logs each call to `house.calls` and answers
// "bug 0.97". With `house.gate` present the stand-in first writes its pid to `house.gate`.pid and waits (up to 60 s)
// until `house.gate` is removed, so a case can catch a placer mid-sort. DISPATCHER_SCRATCH_DAEMON is dropped, so no
// daemon is started by a kick.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { BUG, DISPATCHER, bug, bugHouse, exec } from "./bug_house.mjs";

export const SITTING = 1;
export const QUESTION_HEAD = "This security fix changes who can get in or a key something depends on.";
export const OPTIONS = ["Go ahead", "Leave it with me"];

const STAND_IN = `#!/usr/bin/env python3
import json, os, sys, time
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "calls.jsonl"), "a") as h:
    h.write(json.dumps(sys.argv[1:]) + "\\n")
gate = os.path.join(here, "gate")
if os.path.exists(gate):
    with open(gate + ".pid", "w") as h:
        h.write(str(os.getpid()))
    end = time.time() + 60
    while os.path.exists(gate) and time.time() < end:
        time.sleep(0.1)
try:
    sys.stdin.read()
except Exception:
    pass
answer = "bug 0.97"
sid = "11111111-2222-4333-8444-555555555555"
usage = {"input_tokens": 40, "output_tokens": 4, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
for line in ({"type": "system", "subtype": "init", "session_id": sid, "model": "claude-haiku-5-5"},
             {"type": "assistant", "session_id": sid, "message": {"id": "msg_1", "model": "claude-haiku-5-5",
              "role": "assistant", "content": [{"type": "text", "text": answer}], "usage": usage}},
             {"type": "result", "subtype": "success", "is_error": False, "result": answer, "num_turns": 1,
              "session_id": sid, "total_cost_usd": 0.0, "usage": usage}):
    print(json.dumps(line), flush=True)
`;

/** The environment a hunter's launch carries: its kind and its sitting, in its own session. */
export function huntEnv(kind, sitting = SITTING) {
  return { PLAN_RUNNER_HUNT: kind, DISPATCHER_HUNT_SITTING: String(sitting), CLAUDE_CODE_SESSION_ID: `case-hunter-${kind}` };
}

/** bugHouse, its store made, one open night and sitting SITTING of the security hunt, and the stand-in sort. */
export async function hunterHouse(t, label, opts = {}) {
  const house = await bugHouse(t, label, opts);
  const made = await bug(house, ["list"]);
  if (made.code !== 0) throw new Error(`bug list could not make the scratch store: ${made.err.trim()}`);
  await exec(house, `INSERT INTO hunt_nights (night, opened_at, minutes, state) VALUES ('2026-11-19', '2026-11-19T00:30:00Z', 120, 'open');
INSERT INTO hunt_sittings (id, night, hunt, project, soul, model, state) VALUES (${SITTING}, '2026-11-19', 'security', '${house.repo}', 'argus', 'opus', 'out');`);
  const cli = path.join(house.dir, "cli");
  fs.mkdirSync(cli, { recursive: true });
  fs.writeFileSync(path.join(cli, "claude"), STAND_IN, { mode: 0o755 });
  Object.assign(house.env, { PLAN_RUNNER_CLAUDE_BIN: path.join(cli, "claude"), JEV_FORCE_OFF: "1",
    XDG_RUNTIME_DIR: path.join(cli, "no-runtime") });
  delete house.env.DISPATCHER_SCRATCH_DAEMON;
  return { ...house, calls: path.join(cli, "calls.jsonl"), gate: path.join(cli, "gate") };
}

/** The bug placed record for `board` ({id, name, autonomy}) and `card`. */
export function record(house, board, card) {
  return JSON.stringify({ board: { ...board, repos: [house.repo] }, card: { id: card } });
}

/** `bug placed ID --result -` in the scratch home: { code, out, err }. */
export function placed(house, id, board, card) {
  return bug(house, ["placed", String(id), "--result", "-"], { input: record(house, board, card) });
}

/** `bug placed` started, not awaited: { child, done } where done resolves { code, out, err }. */
export function placing(house, id, board, card) {
  const child = spawn(BUG, ["placed", String(id), "--result", "-"], { env: house.env, cwd: house.repo, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (b) => { out += b; });
  child.stderr.on("data", (b) => { err += b; });
  const done = new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal, out, err })));
  child.stdin.end(record(house, board, card));
  return { child, done };
}

/** `dispatcher card told --event EVENT --by operator` with `body` on stdin: { code, out, err }. */
export function told(house, event, body) {
  return new Promise((resolve) => {
    const child = spawn(DISPATCHER, ["card", "told", "--event", event, "--by", "operator"],
      { env: house.env, cwd: house.dir, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { err += b; });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, out, err: `${err}${e.message}` }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.end(JSON.stringify(body));
  });
}

/** The soul the launch table gives `kind`'s hunt now, as the footer must name it (capitalised), or null. */
export function huntSoul(kind) {
  return new Promise((resolve) => {
    const child = spawn("python3", ["-I", "-c",
      "import sys; sys.path.insert(0, sys.argv[1]); import plan_runner, launch_table; print(launch_table.hunt_of(sys.argv[2])[0])",
      path.join(path.dirname(BUG), "..", "hooks"), kind], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (b) => { out += b; });
    child.on("close", (code) => {
      const soul = out.trim();
      resolve(code === 0 && soul ? soul.charAt(0).toUpperCase() + soul.slice(1) : null);
    });
  });
}

/** The card row and its notes (payloads parsed), in note order. */
export async function cardOf(house, rowsFn, card) {
  const [row] = await rowsFn(house, "SELECT * FROM cards WHERE card = ?", [card]);
  const notes = row ? await rowsFn(house, "SELECT kind, key, payload FROM card_notes WHERE card_id = ? ORDER BY id", [row.id]) : [];
  return { row, notes: notes.map((n) => ({ ...n, payload: JSON.parse(n.payload) })) };
}
