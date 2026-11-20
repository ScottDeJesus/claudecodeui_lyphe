// protects: /home/lyphe/.claude/hooks/session_rails.py, /home/lyphe/.claude/hooks/session_rails_hunt.py, /home/lyphe/.claude/hooks/session_rails_dactyls.py, /home/lyphe/.claude/hooks/plan_runner/souls.py, /home/lyphe/.claude/hooks/plan_runner/solo/launch.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/refuse.py
// writes: none
//
// A hunter changes nothing, and that holds for the writers it can start, not only for its own tools. From a
// process carrying PLAN_RUNNER_HUNT=code, in a scratch git folder whose README.md is tracked:
//   - the dactyl verb on README.md: the PreToolUse hook (`hooks/session_rails.py`) refuses the call, or the
//     verb run for real refuses before it starts a child, or the child it starts holds no Edit and no Write.
//     The real `claude` is never started: PLAN_RUNNER_CLAUDE_BIN is a stand-in that writes its own command
//     line to the scratch folder and exits 1, so nothing is spent and nothing is edited.
//   - `solo.launch.prepare(role="builder", agent="hephaestus")` in that process: refused, or born read-only —
//     the command line `souls.argv(record.spec_for(...))` would start holds no Edit and no Write in its
//     `--tools`, it carries no Dactyls mode (a carrying builder writes through the dactyl verb), and the
//     child's environment carries the hunt (`souls.hunt_env`), so its own shell writes meet the hunt rail.
// Every record (rail rows, dactyl records, launch records, the execute ledger) lands in the case's scratch;
// README.md is never changed.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { python } from "../lib/house_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const HOME = os.homedir();
const HOOK = path.join(HOME, ".claude", "hooks", "session_rails.py");
const DACTYL = path.join(HOME, ".claude", "scripts", "dactyl");
const WRITERS = /(^|,)(Edit|Write|MultiEdit|NotebookEdit)(,|$)/;

const BUILDER = String.raw`
import json, os, sys
os.environ["PLAN_RUNNER_HUNT"] = "code"
from plan_runner import claude_account, souls
claude_account.auto.settle = lambda *a, **k: None
from plan_runner.solo import launch as door, record
door._sweep = lambda *a, **k: []
try:
    L = door.prepare(role="builder", agent="hephaestus", brief="Change nothing.", cwd=sys.argv[1])
except Exception as exc:
    print(json.dumps({"ok": False, "said": f"{type(exc).__name__}: {str(exc)[:200]}"})); sys.exit(0)
spec = record.spec_for(L, "Change nothing.")
command = souls.argv(spec)
tools = command[command.index("--tools") + 1] if "--tools" in command else None
hunted = bool(getattr(souls, "hunt_env", lambda s: {})(spec).get("PLAN_RUNNER_HUNT"))
print(json.dumps({"ok": True, "id": L.id, "under": record.path(L.id), "tools": tools,
                  "dactyls": bool(L.dactyls), "hunted": hunted}))
`;

runCase(async (t) => {
  const dir = await scratchDir(t, "hunter-delegates");
  const repo = path.join(dir, "repo");
  for (const sub of ["repo", "rails", path.join("state", "dispatcher")]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const git = (...args) => spawnSync("git", ["-C", repo, ...args], { timeout: 30000 }).status;
  if (git("init", "-q") !== 0) return broken("git init failed in the scratch folder");
  const readme = path.join(repo, "README.md");
  fs.writeFileSync(readme, "line one\n");
  if (git("add", "README.md") !== 0 || git("-c", "user.email=case@scratch", "-c", "user.name=case", "commit", "-qm", "init") !== 0)
    return broken("could not commit README.md in the scratch folder");
  const before = fs.readFileSync(readme, "utf8");
  const brief = path.join(dir, "brief.txt");
  fs.writeFileSync(brief, 'Append exactly one line reading "line two" to the end of the file.\n');
  const seen = path.join(dir, "stand-in.log");
  // The dactyl verb launches only a binary whose bytes name its model (`dactyls/ready._knows`), so the
  // stand-in carries the launch table's dactyl model as a quoted literal in a comment.
  const model = python("import launch_table; print(launch_table.dactyl_model())", [], { cwd: dir }).stdout.trim();
  if (!model) return broken("the launch table named no dactyl model");
  const standIn = path.join(dir, "claude");
  fs.writeFileSync(standIn, `#!/bin/sh\n# "${model}"\nprintf '%s\\n' "$*" >> '${seen}'\nexit 1\n`, { mode: 0o755 });

  const env = { ...process.env, PLAN_RUNNER_HUNT: "code", PLAN_RUNNER_RUN_ID: "", PLAN_RUNNER_DACTYLS_MODE: "",
                PLAN_RUNNER_CLAUDE_BIN: standIn, SESSION_RAILS_STATE: path.join(dir, "rails"), SESSION_RAILS_DISABLE: "",
                HEAL_LEDGER_PATH: path.join(dir, "heal.db"), DISPATCHER_HOME: path.join(dir, "state", "dispatcher"),
                EXECUTE_LEDGER_STATE_DIR: path.join(dir, "state"), DISPATCHER_WORK_PLAN: "", DISPATCHER_WORK_PHASE: "",
                CLAUDE_CODE_SESSION_ID: "" };
  const wrong = [];

  // The dactyl verb: the rail first, as the harness asks it; then the verb itself, when the rail lets it by.
  const command = `${DACTYL} README.md --brief ${brief}`;
  const payload = { hook_event_name: "PreToolUse", tool_name: "Bash", session_id: "case-hunter-delegates", cwd: repo,
                    tool_input: { command } };
  const rail = spawnSync("python3", [HOOK], { input: JSON.stringify(payload), encoding: "utf8", timeout: 60000,
                                             env: { ...env, PLAN_RUNNER_RUN_ID: "case-hunter-delegates" } });
  let dactyl = `refused at the rail (exit ${rail.status})`;
  if (rail.status !== 2) {
    const ran = spawnSync(DACTYL, ["README.md", "--brief", brief], { cwd: repo, encoding: "utf8", timeout: 120000, env });
    const lines = fs.existsSync(seen) ? fs.readFileSync(seen, "utf8").split("\n").filter(Boolean) : [];
    const armed = lines.filter((line) => { const m = line.match(/--tools (\S+)/); return m && WRITERS.test(m[1]); });
    if (armed.length) wrong.push(`the hunt rail let the dactyl call by (exit ${rail.status}) and the verb started a child holding ${armed[0].match(/--tools (\S+)/)[1]}`);
    const said = String(ran.stdout || ran.stderr || "").split("\n")[0].slice(0, 160);
    if (!lines.length && /does not know|no claude binary|latch/i.test(said))
      return broken(`the stand-in could not stand in for claude: ${said}`);
    dactyl = lines.length ? "a child with no edit tool" : `refused by the verb (exit ${ran.status}: ${said}), no child`;
  }

  // A builder launch asked for by the hunter's process.
  const b = python(BUILDER, [repo], { cwd: dir, env });
  let got;
  try { got = JSON.parse(b.stdout.trim().split("\n").pop() || ""); }
  catch { return broken(`the builder driver printed no answer (exit ${b.status}): ${b.stderr.trim().split("\n").pop()}`); }
  if (got.ok && !String(got.under).startsWith(dir)) wrong.push(`the builder launch's record is outside the scratch home (${got.under})`);
  if (got.ok && (got.tools === null || WRITERS.test(got.tools) || got.dactyls || !got.hunted))
    wrong.push(`a builder launch from the hunt's process was admitted as a writer: --tools ${got.tools}, ` +
               `Dactyls mode ${got.dactyls ? "on" : "off"}, hunt on its environment ${got.hunted ? "yes" : "no"}`);
  const builder = got.ok ? `born read-only (--tools ${got.tools}, the hunt on its environment)` : `refused (${got.said})`;

  if (fs.readFileSync(readme, "utf8") !== before) wrong.push("README.md changed");
  if (wrong.length) return broken(wrong.join("; "));
  return held(`from a hunt process the dactyl was ${dactyl}; a builder launch was ${builder}; README.md unchanged`);
});
