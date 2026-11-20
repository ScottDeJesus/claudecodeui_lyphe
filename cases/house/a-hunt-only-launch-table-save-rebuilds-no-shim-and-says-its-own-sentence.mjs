// A save that moves only a hunt row rebuilds no shim: no shim carries a hunt row's words. The writer is run
// in one Python process pointed at a scratch table through `table.path` (LAUNCH_TABLE_PATH unset, so the
// scratch-table short cut is NOT what keeps the generator from running), with its lock and its generator
// replaced by scratch ones; the generator stand-in only leaves a mark. `set hunt.data --soul daedalus`
// must leave no mark and answer a `regen` sentence of its own, never the tweak's; then
// `set athena --effort high`, a soul pin, must run the stand-in, proving the stand-in is the one the writer calls.
//
// protects: /home/lyphe/.claude/hooks/launch_table/write.py, /home/lyphe/.claude/hooks/launch_table/__main__.py
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { HOOKS, python } from "../lib/house_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const PYPATH = HOOKS;

const TABLE = `version = 1

[default]
model = "sonnet"

[deepseek]
effort = "max"

[tweak]
model = "sonnet"
`;

const SAVE = String.raw`
import contextlib, io, json, os, sys
os.environ.pop("LAUNCH_TABLE_PATH", None)
scratch, mark = sys.argv[1], sys.argv[2]
from launch_table import table as leaf, write
from launch_table.__main__ import main
leaf.path = lambda: os.path.join(scratch, "launch.toml")
write.LOCK = os.path.join(scratch, "launch_table.lock")
write.GENERATOR = os.path.join(scratch, "generator.py")
seen = []
for argv in (["set", "hunt.data", "--soul", "daedalus"], ["set", "athena", "--effort", "high"]):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        try:
            code = main(argv)
        except SystemExit as stop:        # the grammar's own refusal exits through argparse
            code = stop.code
    answer = json.loads(out.getvalue().strip().splitlines()[-1])
    seen.append({"argv": argv, "code": code, "regen": answer.get("regen"), "error": answer.get("error"),
                 "marked": os.path.exists(mark)})
    if os.path.exists(mark):
        os.unlink(mark)
print(json.dumps({"seen": seen, "tweak_said": getattr(write, "_NO_SHIM", {}).get("tweak")}))
`;

runCase(async (t) => {
  const dir = await scratchDir(t, "hunt-no-shim");
  const mark = path.join(dir, "generator-ran");
  fs.writeFileSync(path.join(dir, "launch.toml"), TABLE);
  fs.writeFileSync(path.join(dir, "generator.py"), `open(${JSON.stringify(mark)}, "w").write("ran\\n")\nprint("stand-in ran")\n`);
  const ran = python(SAVE, [dir, mark], { cwd: dir, env: { PYTHONPATH: PYPATH } });
  let got;
  try { got = JSON.parse(ran.stdout.trim().split("\n").pop()); } catch {
    return broken(`the writer printed no answer (exit ${ran.status}: ${ran.stderr.trim().split("\n").pop()})`);
  }
  const [hunt, soul] = got.seen;
  const wrong = [];
  if (hunt.code !== 0) wrong.push(`set hunt.data --soul daedalus was refused: ${hunt.error}`);
  else {
    if (hunt.marked) wrong.push("the hunt-only save ran the generator");
    const regen = hunt.regen || {};
    if (regen.ran !== false || typeof regen.said !== "string" || !/hunt/i.test(regen.said)) {
      wrong.push(`the hunt-only save's regen is ${JSON.stringify(hunt.regen)}, not a no-run with a hunt's sentence`);
    }
    if (regen.said && regen.said === got.tweak_said) wrong.push("the hunt-only save said the tweak's sentence");
  }
  if (soul.code !== 0 || !soul.marked) wrong.push(`the soul pin save did not run the stand-in generator (exit ${soul.code}, regen ${JSON.stringify(soul.regen)})`);
  if (!fs.readFileSync(path.join(dir, "launch.toml"), "utf8").includes('soul = "daedalus"')) wrong.push("the scratch table does not hold the saved hunt row");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`the hunt save ran no generator and said "${hunt.regen.said}"; the soul pin save ran it`);
});
