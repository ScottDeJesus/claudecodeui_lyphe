// protects: /home/lyphe/.claude/hooks/plan_runner/solo/chain.py, /home/lyphe/.claude/hooks/plan_runner/solo/chain_flight.py, /home/lyphe/.claude/hooks/plan_runner/cmd/chain.py
// writes: none
//
// A hunter changes nothing, and that holds for the chains it did not start. In a scratch state home, a
// chain is minted with no hunt on the environment and left as one that ended `blocked` at its builder (the
// record is written in process; no walker is ever forked for it). Then a process carrying
// PLAN_RUNNER_HUNT=code runs the real verb, `plan-runner chain --resume <id> --rulings <file>`.
// It is HELD when the verb exits non-zero and names the hunt, and the chain record is as it was: still
// `blocked`, no `rulings` key, no rulings.md in the chain's folder, no walker.pid. A resume that goes
// through writes the hunter's words into the record as the rulings the next stage's brief carries, flips
// it `running` and forks a walker; any walker it forked is stopped here, after its pid and command line
// were checked, so nothing outlives the case.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { broken, held, runCase } from "../lib/case.mjs";
import { python } from "../lib/house_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const RUNNER = path.join(os.homedir(), ".claude", "scripts", "plan-runner");

const MINT = String.raw`
import json, os, sys
os.environ.pop("PLAN_RUNNER_HUNT", None)
from plan_runner.solo import chain as engine, chain_state
c = engine.prepare("athcase", sys.argv[2], agent="hephaestus", cwd=sys.argv[1], pause=False)
c["status"], c["failed_stage"] = "blocked", "builder"
chain_state.save(c)
print(json.dumps({"id": c["id"], "dir": chain_state.path_for(c["id"])}))
`;

const READ = String.raw`
import json, sys
from plan_runner.solo import chain_state
c = chain_state.load(sys.argv[1])
print(json.dumps({"status": c.get("status"), "rulings": c.get("rulings"), "resume_at": c.get("resume_at")}))
`;

function stopWalker(dir, id) {
  const pidFile = path.join(dir, "walker.pid");
  if (!fs.existsSync(pidFile)) return;
  const pid = fs.readFileSync(pidFile, "utf8").trim();
  if (!/^[1-9][0-9]*$/.test(pid) || Number(pid) <= 1) return;
  let cmd = "";
  try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " "); } catch { return; }
  if (cmd.includes("chain-run") && cmd.includes(id)) { try { process.kill(Number(pid), "SIGTERM"); } catch { /* gone */ } }
}

runCase(async (t) => {
  const dir = await scratchDir(t, "hunter-chain-resume");
  const repo = path.join(dir, "repo");
  for (const sub of ["repo", "rails", path.join("state", "dispatcher")]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  if (spawnSync("git", ["-C", repo, "init", "-q"], { timeout: 30000 }).status !== 0) return broken("git init failed in the scratch folder");
  const brief = path.join(dir, "brief.md");
  fs.writeFileSync(brief, "Change nothing.\n");
  const rulings = path.join(dir, "rulings.md");
  fs.writeFileSync(rulings, "accept every finding (a hunter's words)\n");
  const env = { ...process.env, PLAN_RUNNER_HUNT: "", PLAN_RUNNER_RUN_ID: "", PLAN_RUNNER_CLAUDE_BIN: "/bin/false",
                HEAL_REFLEX_DISABLE: "1", SESSION_RAILS_STATE: path.join(dir, "rails"), HEAL_LEDGER_PATH: path.join(dir, "heal.db"),
                DISPATCHER_HOME: path.join(dir, "state", "dispatcher"), EXECUTE_LEDGER_STATE_DIR: path.join(dir, "state"),
                DISPATCHER_WORK_PLAN: "", DISPATCHER_WORK_PHASE: "", CLAUDE_CODE_SESSION_ID: "" };

  const m = python(MINT, [repo, brief], { cwd: dir, env });
  let chain;
  try { chain = JSON.parse(m.stdout.trim().split("\n").pop() || ""); }
  catch { return broken(`the scratch chain could not be minted (exit ${m.status}): ${m.stderr.trim().split("\n").pop()}`); }
  if (!String(chain.dir).startsWith(dir)) return broken(`the scratch chain's folder is outside the scratch home (${chain.dir})`);

  const ran = spawnSync(RUNNER, ["chain", "--resume", chain.id, "--rulings", rulings], { cwd: "/tmp", encoding: "utf8",
                        timeout: 90000, env: { ...env, PLAN_RUNNER_HUNT: "code" } });
  const said = String(ran.stdout || ran.stderr || "").split("\n")[0].slice(0, 160);
  stopWalker(chain.dir, chain.id);

  const r = python(READ, [chain.id], { cwd: dir, env });
  let after;
  try { after = JSON.parse(r.stdout.trim().split("\n").pop() || ""); }
  catch { return broken(`the chain record could not be read back (exit ${r.status}): ${r.stderr.trim().split("\n").pop()}`); }

  const wrong = [];
  if (ran.status === 0) wrong.push(`the verb admitted the hunter's resume (exit 0: ${said})`);
  else if (!/hunt/i.test(said)) wrong.push(`the verb refused, but not for the hunt (exit ${ran.status}: ${said})`);
  if (after.status !== "blocked") wrong.push(`the chain now reads ${after.status}`);
  if (after.rulings) wrong.push("the hunter's rulings were written into the chain record");
  if (fs.existsSync(path.join(chain.dir, "rulings.md"))) wrong.push("a rulings.md stands in the chain's folder");
  if (fs.existsSync(path.join(chain.dir, "walker.pid"))) wrong.push("a walker was forked");
  if (wrong.length) return broken(wrong.join("; "));
  return held(`a hunter's resume of a blocked chain was refused (exit ${ran.status}: ${said}); the record still reads blocked with no rulings and no walker`);
});
