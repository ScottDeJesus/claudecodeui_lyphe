// protects: /home/lyphe/.claude/hooks/session_rails.py, /home/lyphe/.claude/hooks/session_rails_hunt.py, /home/lyphe/.claude/hooks/session_rails_dactyls.py
// writes: none
//
// The hunt's rail, as the harness runs it: `hooks/session_rails.py` is fed a PreToolUse Bash payload on stdin
// for a soul child (PLAN_RUNNER_RUN_ID set) in a scratch git folder whose README.md git does not ignore. With
// PLAN_RUNNER_HUNT=code, an echo append and a python append to README.md each exit 2 with the hunt sentence
// ("⛔ You are hunting — <path> is a repository file, and a hunter changes nothing.", naming `bug file` and
// /tmp) and each is one rail-4 `refused` row with `soul` true; a write to a file outside the repository exits
// 0. With PLAN_RUNNER_HUNT empty the same echo exits 0; under the Dactyls mode word alone it is refused with
// rail 4's own Dactyls sentence, so the judge's default message did not move. The rail's rows and any friction
// row go to the case's scratch (SESSION_RAILS_STATE, HEAL_LEDGER_PATH), and README.md is never written.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const HOOK = path.join(os.homedir(), ".claude", "hooks", "session_rails.py");
const OPENING = "⛔ You are hunting — ";

runCase(async (t) => {
  const dir = await scratchDir(t, "hunt-rail");
  const repo = path.join(dir, "repo");
  const rails = path.join(dir, "rails");
  fs.mkdirSync(repo);
  fs.mkdirSync(rails);
  if (spawnSync("git", ["init", "-q", repo], { timeout: 30000 }).status !== 0) return broken("git init failed in the scratch folder");
  const readme = path.join(repo, "README.md");
  fs.writeFileSync(readme, "a scratch folder\n");
  const before = fs.readFileSync(readme, "utf8");

  const base = { ...process.env, PLAN_RUNNER_RUN_ID: "case-hunt-rail", SESSION_RAILS_STATE: rails,
                 HEAL_LEDGER_PATH: path.join(dir, "heal.db"), SESSION_RAILS_DISABLE: "", PLAN_RUNNER_DACTYLS_MODE: "",
                 PLAN_RUNNER_HUNT: "" };
  const hook = (command, env) => {
    const payload = { hook_event_name: "PreToolUse", tool_name: "Bash", session_id: "case-hunt-rail",
                      cwd: repo, tool_input: { command } };
    const ran = spawnSync("python3", [HOOK], { input: JSON.stringify(payload), encoding: "utf8", timeout: 60000,
                                              env: { ...base, ...env } });
    return { code: ran.status, said: String(ran.stderr || "") };
  };
  const hunt = { PLAN_RUNNER_HUNT: "code" };
  const seen = {
    echo: hook("echo one more line >> README.md", hunt),
    python: hook(`python3 -c "open('README.md', 'a').write('one more line')"`, hunt),
    outside: hook(`echo scratch > ${path.join(dir, "outside.txt")}`, hunt),
    off: hook("echo one more line >> README.md", {}),
    dactyls: hook("echo one more line >> README.md", { PLAN_RUNNER_DACTYLS_MODE: "on" }),
  };
  const wrong = [];
  for (const label of ["echo", "python"]) {
    const s = seen[label];
    if (s.code !== 2) { wrong.push(`${label} append under the hunt: exit ${s.code}`); continue; }
    if (!s.said.startsWith(`${OPENING}${readme} is a repository file, and a hunter changes nothing.`))
      wrong.push(`${label}: refused with ${JSON.stringify(s.said.slice(0, 120))}`);
    else if (!s.said.includes("bug file") || !s.said.includes("/tmp")) wrong.push(`${label}: the sentence names no bug file or /tmp`);
  }
  if (seen.outside.code !== 0) wrong.push(`a write outside the repository under the hunt: exit ${seen.outside.code} (${seen.outside.said.slice(0, 100)})`);
  if (seen.off.code !== 0) wrong.push(`with PLAN_RUNNER_HUNT empty: exit ${seen.off.code} (${seen.off.said.slice(0, 100)})`);
  if (seen.dactyls.code !== 2 || !seen.dactyls.said.startsWith("⛔ Dactyls is on — "))
    wrong.push(`under the Dactyls word alone: exit ${seen.dactyls.code}, ${JSON.stringify(seen.dactyls.said.slice(0, 60))}`);
  const eventsFile = path.join(rails, "events.jsonl");
  const rows = fs.existsSync(eventsFile)
    ? fs.readFileSync(eventsFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  const hunted = rows.filter((r) => r.rail === 4 && r.verdict === "refused" && r.path === readme && r.soul === true);
  const expected = 2 + (seen.dactyls.code === 2 ? 1 : 0);
  if (hunted.length !== expected) wrong.push(`${hunted.length} rail-4 refused rows with soul true for README.md, not ${expected}`);
  if (fs.readFileSync(readme, "utf8") !== before) wrong.push("README.md changed");
  if (wrong.length) return broken(wrong.join("; "));
  return held(`echo and python appends refused with the hunt sentence and ${hunted.length} rail-4 rows (soul true); outside the repo and hunt off allowed; Dactyls sentence unchanged`);
});
