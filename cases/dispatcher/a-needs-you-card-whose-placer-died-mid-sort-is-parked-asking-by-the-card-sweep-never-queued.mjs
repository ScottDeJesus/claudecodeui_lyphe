// No walk may start on a needs-you card before the operator answers it. `bug placed` commits the card's row `told`
// (its teller this process) BEFORE it sorts, so a placer that dies while its sort waits on the model leaves a `told`
// row with a dead teller — and the card sweep's first step sorts every such row again. That second sort must park a
// needs-you card `asking` on its question, exactly as the placer would have; if it queues it, the take-up walks a
// security fix that changes who can get in with nobody asked.
//
// A real `bug placed` is started under a stand-in sort that waits on a gate; it is killed (its pid checked against the
// row's teller) once the row is committed; then the sweep's orphan step runs over the scratch store, the gate open.
//
// protects: /home/lyphe/.claude/hooks/dispatcher/bug_place.py, /home/lyphe/.claude/hooks/dispatcher/card_rule.py, /home/lyphe/.claude/hooks/dispatcher/card_tell.py, /home/lyphe/.claude/hooks/dispatcher/bug_hunter.py
// writes: none

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { BUG, bug, rows, said } from "../lib/bug_house.mjs";
import { cardOf, huntEnv, hunterHouse, placing } from "../lib/hunter_tickets.mjs";

const FILED = /^FILED ticket (\d+) — /m;
const SWEEP = `
import sys
sys.path.insert(0, sys.argv[1])
from dispatcher import card_rule, store
step = getattr(card_rule, "_sort_orphans", None)
if step is None:
    print("NO STEP"); sys.exit(3)
conn = store.connect()
try:
    print("\\n".join(step(conn)) or "(nothing said)")
finally:
    conn.close()
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sweep(house) {
  return new Promise((resolve) => {
    const child = spawn("python3", ["-I", "-c", SWEEP, path.join(path.dirname(BUG), "..", "hooks")], { env: house.env, cwd: house.dir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { err += b; });
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

runCase(async (t) => {
  const house = await hunterHouse(t, "needs-you-orphan");
  const ran = await bug(house, ["file", "--title", "Admin cookie is not httpOnly", "--needs-you", "Staff will need to log in again."], { input: "found while hunting", env: huntEnv("security") });
  const m = ran.out.match(FILED);
  if (ran.code !== 0 || !m) return cannotRun(`the needs-you ticket could not be filed — ${said(ran)}`);

  fs.writeFileSync(house.gate, "");
  const run = placing(house, Number(m[1]), { id: "b-on", name: "On board", autonomy: true }, "c-orphan");
  let row = null;
  for (let i = 0; i < 300 && !fs.existsSync(`${house.gate}.pid`); i++) await sleep(100);
  if (fs.existsSync(`${house.gate}.pid`)) row = (await cardOf(house, rows, "c-orphan")).row;
  const pid = run.child.pid;
  if (!row || row.state !== "told" || !Number.isInteger(pid) || pid <= 1 || row.teller_pid !== pid) {
    fs.rmSync(house.gate, { force: true });
    await run.done;
    return cannotRun(`the placer was not caught mid-sort with its row told and itself the teller (row ${JSON.stringify(row && { state: row.state, teller: row.teller_pid })}, pid ${pid})`);
  }
  process.kill(pid, "SIGKILL"); // the bug placed process this case started, checked against the row's teller above
  await run.done;
  fs.rmSync(house.gate, { force: true });

  const swept = await sweep(house);
  if (swept.code !== 0) return cannotRun(`the card sweep's orphan step did not run — exit ${swept.code}: ${(swept.out + swept.err).trim().slice(-300)}`);
  const { row: after, notes } = await cardOf(house, rows, "c-orphan");
  const wrong = [];
  if (after.state !== "asking" || after.outcome !== "needs you") wrong.push(`after the sweep the row reads state ${after.state}, outcome ${JSON.stringify(after.outcome)} — ${swept.out.trim()}`);
  if (!notes.some((n) => n.kind === "question")) wrong.push("the swept row carries no question note");
  if (wrong.length) return broken(wrong.join("; "));
  return held("a needs-you card whose placer was killed mid-sort was left told with a dead teller, and the card sweep's orphan step parked it asking with outcome needs you and its question, never queued");
});
