// card_queue.mjs — a scratch dispatcher store of queued cards, and the two reads of it a case judges:
// the order the card sweep's take-up launches them in, and the card feed `dispatcher status --json` prints.
//
//   import { scratchStore, seed, takeUpOrder, feed, dispatcher } from "../lib/card_queue.mjs";
//   const store = await scratchStore(t, "ageing", HOOKS);   // DISPATCHER_HOME, PLAN_RUNNER_STATE_DIR, CARDS_CONFIG_PATH
//   await seed(store, [{ card: "c-low", priority: "low", daysAgo: 7 }]);
//   const order = await takeUpOrder(store);                  // ["c-low", ...] in launch order
//
// Every path the dispatcher writes is under the case's scratch folder, so the operator's store and his
// charters/cards.toml are never read or written. `hooks` is the list of folders put before the dispatcher's
// import path (the house's hooks, or a copy of them to show a case failing against an older file).
//
// THE TAKE-UP IS THE REAL SWEEP (`card_rule.sweep`) with its two doors to the world stood in for: no hold
// (`card_hold.reason` answers "") and no walk (`card_chain.launch` answers a stand-in chain id and starts nothing).
// What remains is the order the sweep walks the queue in, read off its `card launched` lines.

import { spawn } from "node:child_process";
import path from "node:path";

import { scratchDir } from "./scratch.mjs";

const RUN_TIMEOUT_MS = 60000;
const DAY_S = 86400;

/** A scratch dispatcher home, its plan-runner state and its cards.toml, all under one scratch folder. */
export async function scratchStore(t, label, hooks) {
  const dir = await scratchDir(t, label);
  return {
    dir,
    hooks,
    env: {
      ...process.env,
      DISPATCHER_HOME: path.join(dir, "home"),
      PLAN_RUNNER_STATE_DIR: path.join(dir, "state"),
      CARDS_CONFIG_PATH: path.join(dir, "cards.toml"),
      PYTHONPATH: hooks.join(":"),
    },
  };
}

function run(args, { env, cwd, input = "" }) {
  return new Promise((resolve) => {
    const child = spawn("python3", args, { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), RUN_TIMEOUT_MS);
    child.stdout.on("data", (b) => { stdout += b; });
    child.stderr.on("data", (b) => { stderr += b; });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end(input);
  });
}

/** `dispatcher <args>` against the scratch store: { code, stdout, stderr }. */
export function dispatcher(store, args) {
  return run(["-m", "dispatcher", ...args], { env: store.env, cwd: store.dir });
}

const SEED = `
import json, sys, time
from dispatcher import store, store_cards
rows = json.load(sys.stdin)
conn = store.connect()
now = time.time()
with conn:
    for r in rows:
        rid = store_cards.add_told(conn, board="b-case", card=r["card"], board_name="Case board", title=r["card"],
                                   words="w", priority=r["priority"], actor="operator", repos=["/tmp"], teller_pid=0)
        store_cards.set_card(conn, rid, state=r.get("state", "queued"), flow="bug")
        told = r.get("toldAt")
        if told is None:
            told = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now - r.get("daysAgo", 0) * ${DAY_S} - (3600 if r.get("daysAgo", 0) > 0 else 0)))
        conn.execute("UPDATE cards SET told_at = ? WHERE id = ?", (told, rid))
print("seeded", len(rows))
`;

/** Write one told-then-set row per entry: { card, priority, state = "queued", daysAgo = 0 | toldAt }. A positive
 *  daysAgo is stamped an hour past that many days, so it reads exactly that many whole days; a negative one is ahead. */
export async function seed(store, rows) {
  const out = await run(["-c", SEED], { env: store.env, cwd: store.dir, input: JSON.stringify(rows) });
  if (out.code !== 0) throw new Error(`seeding the scratch store failed: ${out.stderr.trim().split("\n").pop()}`);
}

const TAKE_UP = `
import json
from dispatcher import card_chain, card_hold, card_rule, store
card_hold.reason = lambda conn, row, pace_ctx=None: ""
card_chain.launch = lambda conn, row: "stand-in"
lines = card_rule.sweep(store.connect())
print(json.dumps(lines))
`;

/** The cards the real sweep launches, in the order it launches them, and its lines. */
export async function takeUpOrder(store) {
  const out = await run(["-c", TAKE_UP], { env: store.env, cwd: store.dir });
  if (out.code !== 0) throw new Error(`the card sweep exited ${out.code}: ${out.stderr.trim().split("\n").pop()}`);
  const lines = JSON.parse(out.stdout.trim().split("\n").pop());
  const order = lines.map((line) => /^card launched b-case\/(\S+)/.exec(line)?.[1]).filter(Boolean);
  return { order, lines };
}

/** The `cards` list of `dispatcher status --json`, keyed by card. */
export async function feed(store) {
  const out = await dispatcher(store, ["status", "--json"]);
  if (out.code !== 0) throw new Error(`dispatcher status --json exited ${out.code}: ${out.stderr.trim().split("\n").pop()}`);
  const cards = JSON.parse(out.stdout).cards ?? [];
  return Object.fromEntries(cards.map((c) => [c.card, c]));
}
