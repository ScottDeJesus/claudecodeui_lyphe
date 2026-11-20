// protects: /home/lyphe/.claude/hooks/plan_runner/solo/launch.py, /home/lyphe/.claude/hooks/plan_runner/solo/record.py, /home/lyphe/.claude/hooks/plan_runner/deepseek.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/switch.py
// writes: none
//
// Role `hunter` is the third pairing `solo.launch.prepare` admits in process only. In a scratch state home
// (DISPATCHER_HOME = <scratch>/state/dispatcher, so the launch records land in <scratch>/state/dispatch-souls,
// and the execute ledger in <scratch>/state): without a hunt dict it is refused; worn by a planner shim it is
// refused; the athena shim may wear it (the reviewer gate admits it), and its spec.json keeps the hunt dict
// whole, on Claude (provider ""), paid by the subscription (payer 0), with no dactyl mode; and a resume with a
// hunt is refused BY THE HUNT GATE, though the launch it names holds a finished result with a session, so a
// refusal for "no finished launch" does not count. `deepseek.decide("hunter", on=True)` answers Claude.
//
// Nothing is detached: no child runs. The account rule's settle and the launch sweep are stubbed in the child
// process — the first is the live account's, the second would walk the live CPU markers.

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { python } from "../lib/house_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const DRIVE = String.raw`
import json, os, sys
from plan_runner import claude_account, deepseek
claude_account.auto.settle = lambda *a, **k: None
from plan_runner.solo import launch as door
from plan_runner.solo import record
door._sweep = lambda *a, **k: []
repo = sys.argv[1]
H = {"kind": "code", "sitting": 7, "seconds": 600}
out = {}
def tried(label, **kw):
    try:
        got = door.prepare(brief="Try nothing; this launch is never detached.", cwd=repo, **kw)
        out[label] = {"ok": True, "id": got.id}
    except Exception as exc:
        out[label] = {"ok": False, "raised": type(exc).__name__, "said": str(exc)[:300]}
tried("no hunt", role="hunter", agent="hephaestus")
tried("planner shim", role="hunter", agent="eupalinos", hunt=H)
tried("athena", role="hunter", agent="athena", hunt=H)
tried("hephaestus", role="hunter", agent="hephaestus", hunt=H)
if out["hephaestus"].get("ok"):
    lid = out["hephaestus"]["id"]
    with open(record.path(lid, "result.json"), "w") as fh:
        json.dump({"launch": lid, "status": "done", "ok": True, "agent": "hephaestus", "provider": "claude",
                   "session_id": "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e"}, fh)
    tried("resume", role="hunter", agent="hephaestus", hunt=H, resume_of=lid)
for label in ("athena", "hephaestus"):
    if out[label].get("ok"):
        spec = json.load(open(record.path(out[label]["id"], "spec.json")))
        out[label]["spec"] = {k: spec.get(k) for k in ("role", "agent", "hunt", "provider", "payer", "dactyls")}
        out[label]["under"] = record.path(out[label]["id"])
out["decide"] = deepseek.decide("hunter", "hephaestus", on=True)
print(json.dumps(out))
`;

runCase(async (t) => {
  const dir = await scratchDir(t, "hunter-launch");
  const repo = path.join(dir, "repo");
  fs.mkdirSync(path.join(dir, "state", "dispatcher"), { recursive: true });
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "a scratch folder\n");
  const env = { DISPATCHER_HOME: path.join(dir, "state", "dispatcher"), EXECUTE_LEDGER_STATE_DIR: path.join(dir, "state"),
                DISPATCHER_WORK_PLAN: "", DISPATCHER_WORK_PHASE: "", CLAUDE_CODE_SESSION_ID: "" };
  const ran = python(DRIVE, [repo], { cwd: dir, env });
  let got;
  try { got = JSON.parse(ran.stdout.trim().split("\n").pop() || ""); }
  catch { return broken(`the driver printed no answer (exit ${ran.status}): ${ran.stderr.trim().split("\n").pop()}`); }

  const wrong = [];
  const refusedWell = (label) => {
    const one = got[label];
    if (!one) return wrong.push(`${label}: never tried`);
    if (one.ok) return wrong.push(`${label}: admitted (launch ${one.id})`);
    if (one.raised !== "LaunchError") wrong.push(`${label}: raised ${one.raised} (${one.said}), not a LaunchError refusal`);
  };
  refusedWell("no hunt");
  refusedWell("planner shim");
  const H = { kind: "code", sitting: 7, seconds: 600 };
  for (const label of ["athena", "hephaestus"]) {
    const one = got[label];
    if (!one?.ok) { wrong.push(`${label} wearing hunter with a hunt: refused — ${one?.raised}: ${one?.said}`); continue; }
    if (!String(one.under).startsWith(dir)) wrong.push(`${label}: its record is outside the scratch home (${one.under})`);
    const s = one.spec;
    if (JSON.stringify(s.hunt) !== JSON.stringify(H)) wrong.push(`${label}: spec.json hunt is ${JSON.stringify(s.hunt)}`);
    if (s.role !== "hunter") wrong.push(`${label}: spec.json role is ${s.role}`);
    if (s.provider !== "") wrong.push(`${label}: provider ${JSON.stringify(s.provider)}, not Claude`);
    if (s.payer !== 0) wrong.push(`${label}: payer ${s.payer}, not the subscription`);
    if (s.dactyls) wrong.push(`${label}: carries the dactyl mode`);
  }
  if (got.hephaestus?.ok) {
    const r = got.resume;
    if (!r) wrong.push("resume: never tried");
    else if (r.ok) wrong.push(`resume of a hunt: admitted (launch ${r.id})`);
    else if (!/hunt/i.test(r.said) || /no finished launch/.test(r.said)) wrong.push(`resume refused for another reason: ${r.said}`);
  }
  if (got.decide !== "") wrong.push(`deepseek.decide("hunter", on=True) answered ${JSON.stringify(got.decide)}`);
  if (wrong.length) return broken(wrong.join("; "));
  return held("hunter refused without a hunt and on a planner shim, admitted for athena and hephaestus with spec.json keeping the hunt on Claude, payer 0, no dactyl mode; a hunt resume refused by its own gate; decide answers Claude");
});
