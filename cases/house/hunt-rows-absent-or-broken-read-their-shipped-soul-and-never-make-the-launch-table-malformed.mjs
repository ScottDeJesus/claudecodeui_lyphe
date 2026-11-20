// The launch table's five `[hunt.<kind>]` rows are optional and never break the table. A scratch table with
// no hunt section, then one whose hunt rows are broken five ways (a planner soul, a soul that is not a slug, a
// model outside MODELS, a row that is not a table, an unknown kind) beside one good row, are each read by
// `launch_table.hunt_of` for every kind: an absent or broken row answers its shipped soul (security=argus,
// behaviour=athena, ui=iris, data=sherlock, code=hephaestus) on the model the table gives that soul, with a
// sentence in `problems` naming the row; the good row answers its own soul and model; `state` stays `file`
// and the scratch's soul pins still read. Whether a shim carries a well-formed soul is not the leaf's to know
// (it is read on every spawn and scans no ~/.claude/agents): the census says that one, in its own case.
//
// protects: /home/lyphe/.claude/hooks/launch_table/table.py, /home/lyphe/.claude/hooks/launch_table/__init__.py
// writes: none

import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { HOOKS, python } from "../lib/house_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const PYPATH = HOOKS;
const KINDS = ["security", "behaviour", "ui", "data", "code"];
const SHIPPED = { security: "argus", behaviour: "athena", ui: "iris", data: "sherlock", code: "hephaestus" };

const SPINE = `version = 1

[default]
model = "sonnet"

[default.effort]
opus = "medium"
sonnet = "high"

[deepseek]
effort = "max"

[tweak]
model = "sonnet"

[soul.argus]
model = "opus"
effort = "max"

[soul.iris]
model = "fable"

[soul.sherlock]
model = "fable"
`;

const BROKEN_ROWS = `
[hunt.security]
soul = "eupalinos"

[hunt.behaviour]
soul = "Not A Slug"

[hunt.ui]
soul = "iris"
model = "gpt"

[hunt]
data = "not a table"
code = { soul = "daedalus", model = "sonnet" }
nope = { soul = "athena" }
`;

const READ = String.raw`
import json, sys
try:
    import launch_table
    from launch_table import table as leaf
    t = launch_table.load()
    out = {"state": t.state, "problems": list(t.problems), "argus_pin": dict(t.souls.get("argus", {})),
           "kinds": list(getattr(leaf, "HUNT_KINDS", ())), "hunts": {}}
    for kind in ("security", "behaviour", "ui", "data", "code"):
        out["hunts"][kind] = list(launch_table.hunt_of(kind, t))
    print(json.dumps(out))
except Exception as exc:
    print(json.dumps({"raised": f"{type(exc).__name__}: {exc}"}))
`;

function read(file, dir) {
  const ran = python(READ, [], { cwd: dir, env: { PYTHONPATH: PYPATH, LAUNCH_TABLE_PATH: file } });
  const last = ran.stdout.trim().split("\n").pop() || "";
  try { return JSON.parse(last); } catch { return { raised: `printed no answer (exit ${ran.status}: ${ran.stderr.trim().split("\n").pop()})` }; }
}

const names = (problems, kind) => problems.filter((p) => p.includes(`hunt.${kind}`)).length;

runCase(async (t) => {
  const dir = await scratchDir(t, "hunt-rows-read");
  const absent = path.join(dir, "absent.toml");
  const bad = path.join(dir, "broken.toml");
  fs.writeFileSync(absent, SPINE);
  fs.writeFileSync(bad, SPINE + BROKEN_ROWS);
  const wrong = [];

  const a = read(absent, dir);
  if (a.raised) return broken(`hunt_of on a table with no hunt rows raised: ${a.raised}`);
  if (JSON.stringify(a.kinds) !== JSON.stringify(KINDS)) wrong.push(`table.HUNT_KINDS is ${JSON.stringify(a.kinds)}`);
  if (a.state !== "file") wrong.push(`no hunt rows made the table ${a.state}`);
  const ownModel = { argus: "opus", athena: "sonnet", iris: "fable", sherlock: "fable", hephaestus: "sonnet" };
  for (const kind of KINDS) {
    const want = [SHIPPED[kind], ownModel[SHIPPED[kind]]];
    if (JSON.stringify(a.hunts[kind]) !== JSON.stringify(want)) wrong.push(`absent hunt.${kind} answered ${JSON.stringify(a.hunts[kind])}, not ${JSON.stringify(want)}`);
    if (names(a.problems, kind) !== 1) wrong.push(`absent hunt.${kind} has ${names(a.problems, kind)} sentences in problems, not one`);
  }

  const b = read(bad, dir);
  if (b.raised) return broken(`hunt_of on a table with broken hunt rows raised: ${b.raised}`);
  if (b.state !== "file") wrong.push(`broken hunt rows made the table ${b.state}: ${b.problems.join(" | ")}`);
  if (b.argus_pin.model !== "opus" || b.argus_pin.effort !== "max") wrong.push(`broken hunt rows lost soul.argus's pin: ${JSON.stringify(b.argus_pin)}`);
  const wantBroken = {
    security: ["argus", "opus"], behaviour: ["athena", "sonnet"], ui: ["iris", "fable"],
    data: ["sherlock", "fable"], code: ["daedalus", "sonnet"],
  };
  for (const kind of KINDS) {
    if (JSON.stringify(b.hunts[kind]) !== JSON.stringify(wantBroken[kind])) wrong.push(`hunt.${kind} answered ${JSON.stringify(b.hunts[kind])}, not ${JSON.stringify(wantBroken[kind])}`);
    if (kind !== "code" && names(b.problems, kind) < 1) wrong.push(`broken hunt.${kind} said no sentence in problems`);
  }
  if (names(b.problems, "code") !== 0) wrong.push(`the good hunt.code row drew a sentence: ${b.problems.filter((p) => p.includes("hunt.code")).join(" | ")}`);
  if (!b.problems.some((p) => p.includes("nope"))) wrong.push("the unknown hunt kind `nope` drew no sentence");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`absent rows read the five shipped souls with one sentence each; broken rows read shipped souls with a sentence, hunt.code read daedalus on sonnet, state file`);
});
