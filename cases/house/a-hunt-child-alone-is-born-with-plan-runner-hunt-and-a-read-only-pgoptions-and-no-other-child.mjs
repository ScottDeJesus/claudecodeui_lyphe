// protects: /home/lyphe/.claude/hooks/plan_runner/souls.py, /home/lyphe/.claude/scripts/quiet_checkpoint_message.py
// writes: none
//
// The hunt child's environment is the hunt's, and no other child's. `souls.spawn` is run with its `command`
// door (the one `dactyls/child.py` uses) on a stand-in that reads its prompt and writes only the two names
// this promise is about, PLAN_RUNNER_HUNT and PGOPTIONS, to a scratch file — so nothing is sent to Claude and
// no ledger is opened (`ledger=False`). The parent carries PGOPTIONS="-c statement_timeout=5000" and no
// PLAN_RUNNER_HUNT. A hunt spec (hunt "code") is born with PLAN_RUNNER_HUNT=code and PGOPTIONS holding
// the parent's options followed by `-c default_transaction_read_only=on`; the same spawn of a builder spec is
// born with no PLAN_RUNNER_HUNT and the parent's PGOPTIONS as it was; a hunt spawn under a parent with no
// PGOPTIONS gets the read-only option alone. A parent that carries PLAN_RUNNER_HUNT (it is hunting) spawns
// nothing: a builder and a hunt spec both raise the hunting refusal and the stand-in never runs.
// PLAN_RUNNER_HUNT is in `souls.SCRUB_ENV` and in the literal mirror `scripts/quiet_checkpoint_message.py`
// keeps of it.

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { python } from "../lib/house_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const DRIVE = String.raw`
import json, os, sys
from plan_runner import souls
dir_, label, role = sys.argv[1], sys.argv[2], sys.argv[3]
out_file = os.path.join(dir_, label + ".json")
stand_in = ["python3", "-c", "import os, sys, json; sys.stdin.read(); "
            "json.dump({k: os.environ.get(k) for k in ('PLAN_RUNNER_HUNT', 'PGOPTIONS')}, open(sys.argv[1], 'w'))",
            out_file]
answer = {}
try:
    extra = {"hunt": "code"} if role == "hunter" else {}
    spec = souls.SpawnSpec(role=role, agent="hephaestus", model="sonnet", prompt="nothing", cwd=dir_, add_dirs=[],
                           expected_s=60, idle_s=60, ledger=False, **extra)
    souls.spawn(spec, "case-hunt-env-" + label, os.path.join(dir_, label + ".log"), lambda pid: None, command=stand_in)
    answer["env"] = json.load(open(out_file)) if os.path.exists(out_file) else None
except Exception as exc:
    answer["raised"] = f"{type(exc).__name__}: {exc}"
answer["scrub"] = "PLAN_RUNNER_HUNT" in souls.SCRUB_ENV
sys.path.insert(0, os.path.expanduser("~/.claude/scripts"))
try:
    from load_module import load_file
    mod = load_file(os.path.expanduser("~/.claude/scripts/quiet_checkpoint_message.py"))
    answer["mirror"] = "PLAN_RUNNER_HUNT" in getattr(mod, "SCRUB_ENV", ())
except Exception as exc:
    answer["mirror"] = f"would not load: {type(exc).__name__}"
print(json.dumps(answer))
`;

const RO = "-c default_transaction_read_only=on";

runCase(async (t) => {
  const dir = await scratchDir(t, "hunt-env");
  const runs = {
    hunt: ["hunter", { PGOPTIONS: "-c statement_timeout=5000", PLAN_RUNNER_HUNT: "" }],
    bare: ["hunter", { PGOPTIONS: "", PLAN_RUNNER_HUNT: "" }],
    builder: ["builder", { PGOPTIONS: "-c statement_timeout=5000", PLAN_RUNNER_HUNT: "" }],
  };
  const hunting = {
    huntingBuilder: ["builder", { PGOPTIONS: "", PLAN_RUNNER_HUNT: "code" }],
    huntingHunt: ["hunter", { PGOPTIONS: "", PLAN_RUNNER_HUNT: "code" }],
  };
  const got = {};
  for (const [label, [role, env]] of Object.entries(runs)) {
    const ran = python(DRIVE, [dir, label, role], { cwd: dir, env: { PLAN_RUNNER_DACTYLS_MODE: "", ...env } });
    try { got[label] = JSON.parse(ran.stdout.trim().split("\n").pop() || ""); }
    catch { return broken(`${label}: the driver printed no answer (exit ${ran.status}): ${ran.stderr.trim().split("\n").pop()}`); }
  }
  const wrong = [];
  for (const [label, [role, env]] of Object.entries(hunting)) {
    const ran = python(DRIVE, [dir, label, role], { cwd: dir, env: { PLAN_RUNNER_DACTYLS_MODE: "", ...env } });
    let one;
    try { one = JSON.parse(ran.stdout.trim().split("\n").pop() || ""); }
    catch { return broken(`${label}: the driver printed no answer (exit ${ran.status}): ${ran.stderr.trim().split("\n").pop()}`); }
    if (!String(one.raised || "").includes("this process is hunting")) wrong.push(`${label}: a hunting parent's spawn was not refused (${one.raised || "spawned"})`);
    if (fs.existsSync(path.join(dir, label + ".json"))) wrong.push(`${label}: a child ran under a hunting parent`);
  }
  for (const [label, one] of Object.entries(got)) {
    if (one.raised) wrong.push(`${label}: spawn raised ${one.raised}`);
    else if (!one.env) wrong.push(`${label}: the stand-in never wrote its environment`);
  }
  const h = got.hunt.env, b = got.bare.env, n = got.builder.env;
  if (h) {
    if (h.PLAN_RUNNER_HUNT !== "code") wrong.push(`hunt child: PLAN_RUNNER_HUNT=${JSON.stringify(h.PLAN_RUNNER_HUNT)}`);
    const opts = String(h.PGOPTIONS || "");
    if (!opts.includes("-c statement_timeout=5000") || !opts.includes(RO) || opts.indexOf(RO) < opts.indexOf("statement_timeout"))
      wrong.push(`hunt child: PGOPTIONS=${JSON.stringify(h.PGOPTIONS)}, not the parent's options followed by the read-only one`);
  }
  if (b && (b.PLAN_RUNNER_HUNT !== "code" || String(b.PGOPTIONS || "").trim() !== RO))
    wrong.push(`hunt child with no parent PGOPTIONS: ${JSON.stringify(b)}`);
  if (n) {
    if (n.PLAN_RUNNER_HUNT) wrong.push(`builder child inherited PLAN_RUNNER_HUNT=${n.PLAN_RUNNER_HUNT}`);
    if (n.PGOPTIONS !== "-c statement_timeout=5000") wrong.push(`builder child's PGOPTIONS moved: ${JSON.stringify(n.PGOPTIONS)}`);
  }
  if (got.hunt.scrub !== true) wrong.push("PLAN_RUNNER_HUNT is not in souls.SCRUB_ENV");
  if (got.hunt.mirror !== true) wrong.push(`quiet_checkpoint_message.SCRUB_ENV: ${got.hunt.mirror === false ? "lacks PLAN_RUNNER_HUNT" : got.hunt.mirror}`);
  if (wrong.length) return broken(wrong.join("; "));
  return held(`hunt child PGOPTIONS ${JSON.stringify(h.PGOPTIONS)} and PLAN_RUNNER_HUNT=code; builder child neither; a hunting parent's builder and hunt spawns both refused with no child; both scrub lists name it`);
});
