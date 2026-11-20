// The census (`launch-table show`, what Settings → Agents → Edit Agent Chains draws) over a scratch table
// holding one hunt row with a model and four without: the five rows `hunt.security` … `hunt.code` come
// right after the tweak row, each `kind: "hunt"` with its soul, the model and effort `resolve` answers for it,
// a boolean `model_pinned`, and ONE lane `hunt` whose note is the read-only sentence; `choices.hunt_souls` is
// every generated shim the census draws as a soul row, less the two planners. A second scratch table whose
// `[hunt.behaviour]` names a well-formed soul no shim carries must draw a sentence in `problems` naming that
// row, as a pin with no shim does: the reader cannot know it, so the census is where it is said.
//
// protects: /home/lyphe/.claude/hooks/launch_table/census.py, /home/lyphe/.claude/hooks/launch_table/roster.py, /home/lyphe/.claude/hooks/launch_table/table.py
// writes: none

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { HOOKS } from "../lib/house_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const PYPATH = HOOKS;
const KINDS = ["security", "behaviour", "ui", "data", "code"];
const SOULS = { security: "argus", behaviour: "athena", ui: "iris", data: "sherlock", code: "daedalus" };
const NOTE = "a Claude child launched read-only: the DeepSeek switch does not reach it";
const PLANNERS = ["eupalinos", "odysseus"];

const TABLE = `version = 1

[default]
model = "sonnet"

[default.effort]
opus = "medium"
sonnet = "high"

[deepseek]
effort = "max"

[tweak]
model = "sonnet"

[hunt.code]
soul = "daedalus"
model = "opus"

[soul.argus]
model = "opus"
effort = "max"
`;

function cli(file, dir, ...args) {
  const ran = spawnSync("python3", ["-m", "launch_table", ...args], {
    cwd: dir, encoding: "utf8", timeout: 60000,
    env: { ...process.env, PYTHONPATH: PYPATH, LAUNCH_TABLE_PATH: file },
  });
  let json = null;
  try { json = JSON.parse(String(ran.stdout || "").trim().split("\n").pop()); } catch { /* judged by the caller */ }
  return { status: ran.status, json, stderr: String(ran.stderr || "").trim().split("\n").pop() };
}

runCase(async (t) => {
  const dir = await scratchDir(t, "hunt-census");
  const file = path.join(dir, "launch.toml");
  fs.writeFileSync(file, TABLE);
  const shown = cli(file, dir, "show");
  if (shown.status !== 0 || !shown.json || !Array.isArray(shown.json.rows)) {
    return broken(`launch-table show answered exit ${shown.status}: ${shown.stderr}`);
  }
  const census = shown.json;
  const wrong = [];
  const names = census.rows.map((row) => row.name);
  const tweakAt = names.indexOf("tweak");
  const want = KINDS.map((kind) => `hunt.${kind}`);
  if (tweakAt === -1) wrong.push("the census has no tweak row");
  else if (JSON.stringify(names.slice(tweakAt + 1, tweakAt + 6)) !== JSON.stringify(want)) {
    wrong.push(`the rows after the tweak's are ${JSON.stringify(names.slice(tweakAt + 1, tweakAt + 6))}`);
  }
  for (const kind of KINDS) {
    const row = census.rows.find((each) => each.name === `hunt.${kind}`);
    if (!row) continue;
    const resolved = cli(file, dir, "resolve", `hunt.${kind}`, "--side", "claude").json || {};
    if (row.kind !== "hunt") wrong.push(`hunt.${kind} is kind ${JSON.stringify(row.kind)}`);
    if (row.soul !== SOULS[kind]) wrong.push(`hunt.${kind}'s soul is ${JSON.stringify(row.soul)}, not ${SOULS[kind]}`);
    if (row.model !== resolved.model || row.effort !== resolved.effort) {
      wrong.push(`hunt.${kind} draws ${row.model}/${row.effort} while resolve answers ${resolved.model}/${resolved.effort}`);
    }
    if (typeof row.model_pinned !== "boolean") wrong.push(`hunt.${kind}'s model_pinned is ${JSON.stringify(row.model_pinned)}`);
    const lanes = Array.isArray(row.lanes) ? row.lanes : [];
    if (lanes.length !== 1 || lanes[0].lane !== "hunt" || lanes[0].note !== NOTE) {
      wrong.push(`hunt.${kind}'s lanes are ${JSON.stringify(lanes.map((lane) => [lane.lane, lane.note]))}`);
    }
  }
  const code = census.rows.find((each) => each.name === "hunt.code");
  if (code && code.model !== "opus") wrong.push(`hunt.code's own model opus was drawn as ${code.model}`);

  const shims = census.rows.filter((row) => row.kind === "soul").map((row) => row.name).sort();
  const choices = census.choices && Array.isArray(census.choices.hunt_souls) ? [...census.choices.hunt_souls].sort() : null;
  const expected = shims.filter((name) => !PLANNERS.includes(name));
  if (!choices) wrong.push("choices.hunt_souls is missing");
  else if (JSON.stringify(choices) !== JSON.stringify(expected)) {
    wrong.push(`choices.hunt_souls is ${JSON.stringify(choices)}, not every shim but the planners ${JSON.stringify(expected)}`);
  }
  if (!shims.includes("eupalinos")) wrong.push("the census drew no eupalinos soul row, so the planner check proves nothing");

  const orphan = path.join(dir, "orphan.toml");
  fs.writeFileSync(orphan, `${TABLE}\n[hunt.behaviour]\nsoul = "no_such_soul"\n`);
  const lost = cli(orphan, dir, "show").json || {};
  const said = (lost.problems || []).filter((p) => p.includes("hunt.behaviour") && p.includes("no_such_soul"));
  if (lost.state !== "file") wrong.push(`a hunt row naming no shim made the table ${lost.state}`);
  if (said.length === 0) wrong.push(`a hunt row naming a soul no shim carries drew no sentence: ${JSON.stringify(lost.problems)}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`five hunt rows follow the tweak's with one read-only hunt lane each; hunt_souls holds ${expected.length} shims, no planner`);
});
