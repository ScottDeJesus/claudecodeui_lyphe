// protects: /home/lyphe/.claude/hooks/plan_runner/solo/launch.py, /home/lyphe/.claude/hooks/plan_runner/solo/record.py
// writes: none
//
// A hunt is never resumed — not as a hunter, and not as a writer either. In a scratch state home
// (DISPATCHER_HOME = <scratch>/state/dispatcher, so the records land in <scratch>/state/dispatch-souls and the
// execute ledger in <scratch>/state), a hunter launch is prepared (role hunter, agent hephaestus, a hunt dict)
// and given a finished result.json holding a session id, as a sitting that ended leaves it. Then
// `solo.launch.prepare(role=<builder|fix-pass>, agent="hephaestus", resume_of=<that launch>)` must be refused,
// and the refusal must be about the hunt (a refusal for a missing record or session does not count, because the
// record and the session are there). Admitted, the hunter's session would continue with Edit and Write.
//
// Nothing is detached: no child runs. The account rule's settle and the launch sweep are stubbed in the child
// process — the first is the live account's, the second would walk the live CPU markers.

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { python } from "../lib/house_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const DRIVE = String.raw`
import json, sys
from plan_runner import claude_account
claude_account.auto.settle = lambda *a, **k: None
from plan_runner.solo import launch as door, record
door._sweep = lambda *a, **k: []
repo = sys.argv[1]
out = {}
try:
    L = door.prepare(role="hunter", agent="hephaestus", brief="Change nothing.", cwd=repo,
                     hunt={"kind": "code", "sitting": 0, "seconds": 600})
except Exception as exc:
    print(json.dumps({"hunter": f"{type(exc).__name__}: {exc}"})); sys.exit(0)
out["under"] = record.path(L.id)
with open(record.path(L.id, "result.json"), "w") as fh:
    json.dump({"launch": L.id, "status": "done", "ok": True, "agent": "hephaestus", "provider": "claude",
               "session_id": "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e"}, fh)
for role in ("builder", "fix-pass"):
    try:
        got = door.prepare(role=role, agent="hephaestus", brief="Change nothing.", cwd=repo, resume_of=L.id)
        out[role] = {"ok": True, "id": got.id, "resume_sid": got.resume_sid}
    except Exception as exc:
        out[role] = {"ok": False, "raised": type(exc).__name__, "said": str(exc)[:300]}
print(json.dumps(out))
`;

runCase(async (t) => {
  const dir = await scratchDir(t, "hunt-resume");
  const repo = path.join(dir, "repo");
  fs.mkdirSync(path.join(dir, "state", "dispatcher"), { recursive: true });
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "a scratch folder\n");
  const env = { DISPATCHER_HOME: path.join(dir, "state", "dispatcher"), EXECUTE_LEDGER_STATE_DIR: path.join(dir, "state"),
                DISPATCHER_WORK_PLAN: "", DISPATCHER_WORK_PHASE: "", CLAUDE_CODE_SESSION_ID: "", PLAN_RUNNER_HUNT: "" };
  const ran = python(DRIVE, [repo], { cwd: dir, env });
  let got;
  try { got = JSON.parse(ran.stdout.trim().split("\n").pop() || ""); }
  catch { return broken(`the driver printed no answer (exit ${ran.status}): ${ran.stderr.trim().split("\n").pop()}`); }
  if (got.hunter) return broken(`the hunter launch itself was refused: ${got.hunter}`);
  if (!String(got.under).startsWith(dir)) return broken(`the hunter's record is outside the scratch home (${got.under})`);

  const wrong = [];
  for (const role of ["builder", "fix-pass"]) {
    const r = got[role];
    if (!r) wrong.push(`${role}: never tried`);
    else if (r.ok) wrong.push(`${role} resuming a finished hunt: admitted, resume_sid ${r.resume_sid}`);
    else if (!/hunt/i.test(r.said) || /no finished launch|recorded no session/.test(r.said))
      wrong.push(`${role}: refused for another reason — ${r.raised}: ${r.said}`);
  }
  if (wrong.length) return broken(wrong.join("; "));
  return held("a finished hunt's session refused as a builder's and a fix-pass's resume, each by the hunt");
});
