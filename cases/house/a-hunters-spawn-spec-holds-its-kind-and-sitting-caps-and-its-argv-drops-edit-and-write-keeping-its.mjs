// protects: /home/lyphe/.claude/hooks/plan_runner/solo/record.py, /home/lyphe/.claude/hooks/plan_runner/souls.py, /home/lyphe/.claude/hooks/soul_routing.py
// writes: none
//
// A hunter's launch record becomes a spawn spec and an argv with no file written. `record.spec_for` of a
// Launch with role hunter, hunt {kind code, sitting 7, seconds 600} and model "sonnet" hands the spec
// `hunt = "code"`, the launch's word as its model, `idle_s = souls.IDLE_S["hunter"]` (1200), and an
// `expected_s` whose stale cap (× STALE_FACTOR, where `souls.spawn` kills) falls at or past the sitting's
// 600 s plus 15 minutes of grace. `souls.argv` of that spec, worn by each of the five hunt souls, carries a
// `--tools` naming none of `switch.EDIT_TOOLS` and the same MCP flags the soul's routing row gives without
// the drop. A builder's record keeps the hour (`HOUR_S // STALE_FACTOR`), `idle_s` 0 and its Edit and Write.

import { broken, held, runCase } from "../lib/case.mjs";
import { python } from "../lib/house_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const DRIVE = String.raw`
import json, sys
from plan_runner import souls
from plan_runner.dactyls import switch
from plan_runner.solo import record
from plan_runner import state as runstate
import soul_routing
cwd = sys.argv[1]
def launch(role, agent, **extra):
    return runstate.from_dict(record.Launch, {"id": "case-hunter-spec", "role": role, "agent": agent, "cwd": cwd,
        "add_dirs": [], "provider": "", "agent_id": "", "brief_path": cwd + "/brief.md", **extra})
def tools_of(argv):
    return argv[argv.index("--tools") + 1].split(",") if "--tools" in argv else None
def mcp_of(argv):
    return [argv[i + 1] if not argv[i + 1].startswith("--") else "" for i, a in enumerate(argv) if a == "--mcp-config"] + \
           [a for a in argv if a == "--strict-mcp-config"]
out = {"idle_table": souls.IDLE_S.get("hunter"), "stale": record.STALE_FACTOR, "hour": record.HOUR_S,
       "edit": list(switch.EDIT_TOOLS), "souls": {}}
try:
    spec = record.spec_for(launch("hunter", "hephaestus", model="sonnet",
                                  hunt={"kind": "code", "sitting": 7, "seconds": 600}), "")
    out["hunter"] = {"hunt": getattr(spec, "hunt", "<no field>"), "model": spec.model, "idle_s": spec.idle_s,
                     "expected_s": spec.expected_s}
    for agent in ("argus", "athena", "iris", "sherlock", "hephaestus"):
        spec.agent = agent
        argv = souls.argv(spec)
        plain = soul_routing.flags(agent, cwd=cwd)
        out["souls"][agent] = {"tools": tools_of(argv), "mcp": mcp_of(argv), "row_mcp": mcp_of(plain),
                               "model": argv[argv.index("--model") + 1] if "--model" in argv else None}
except Exception as exc:
    out["hunter_raised"] = f"{type(exc).__name__}: {exc}"
b = record.spec_for(launch("builder", "hephaestus"), "")
out["builder"] = {"hunt": getattr(b, "hunt", None), "idle_s": b.idle_s, "expected_s": b.expected_s,
                  "tools": tools_of(souls.argv(b))}
print(json.dumps(out))
`;

runCase(async (t) => {
  const dir = await scratchDir(t, "hunter-spec");
  const ran = python(DRIVE, [dir], { cwd: dir, env: { PLAN_RUNNER_DACTYLS_MODE: "" } });
  let got;
  try { got = JSON.parse(ran.stdout.trim().split("\n").pop() || ""); }
  catch { return broken(`the driver printed no answer (exit ${ran.status}): ${ran.stderr.trim().split("\n").pop()}`); }
  const wrong = [];
  if (got.idle_table !== 1200) wrong.push(`souls.IDLE_S["hunter"] is ${got.idle_table}`);
  if (got.hunter_raised) wrong.push(`the hunter's spec or argv raised ${got.hunter_raised}`);
  const h = got.hunter;
  if (h) {
    if (h.hunt !== "code") wrong.push(`SpawnSpec.hunt is ${JSON.stringify(h.hunt)}`);
    if (h.model !== "sonnet") wrong.push(`the spec's model is ${JSON.stringify(h.model)}, not the launch's word`);
    if (h.idle_s !== 1200) wrong.push(`the spec's idle_s is ${h.idle_s}`);
    if (h.expected_s * got.stale < 600 + 15 * 60) wrong.push(`the stale cap ${h.expected_s * got.stale} s falls before 600 s + 15 minutes`);
  }
  for (const [agent, s] of Object.entries(got.souls)) {
    if (!s.tools) { wrong.push(`${agent}: no --tools at all`); continue; }
    const kept = s.tools.filter((name) => got.edit.includes(name));
    if (kept.length) wrong.push(`${agent}: --tools keeps ${kept.join(",")}`);
    if (!s.tools.includes("Bash") || !s.tools.includes("Read")) wrong.push(`${agent}: --tools lost Bash or Read (${s.tools.join(",")})`);
    if (JSON.stringify(s.mcp) !== JSON.stringify(s.row_mcp)) wrong.push(`${agent}: MCP flags ${JSON.stringify(s.mcp)} differ from its row's ${JSON.stringify(s.row_mcp)}`);
    if (s.model !== "sonnet") wrong.push(`${agent}: --model ${s.model}`);
  }
  if (h && Object.keys(got.souls).length !== 5) wrong.push(`only ${Object.keys(got.souls).length} of five souls answered`);
  const b = got.builder;
  if (b.hunt) wrong.push(`a builder's spec carries hunt ${JSON.stringify(b.hunt)}`);
  if (b.idle_s !== 0 || b.expected_s !== Math.floor(got.hour / got.stale)) wrong.push(`a builder's caps moved: idle_s ${b.idle_s}, expected_s ${b.expected_s}`);
  if (!b.tools?.includes("Edit") || !b.tools?.includes("Write")) wrong.push(`a builder's --tools lost Edit or Write (${b.tools})`);
  if (wrong.length) return broken(wrong.join("; "));
  return held(`hunter spec: hunt code, model sonnet, idle 1200, stale cap ${h.expected_s * got.stale} s; five souls' --tools drop Edit and Write and keep their MCP; a builder unchanged`);
});
