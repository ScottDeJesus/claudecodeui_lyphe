// The R&D sheet saves the scout's and the spike's model and effort as rows of the launch table (INV-5703): one home, read at
// each launch. A row with no words rides the table's default model and that model's default effort; a set writes the row;
// a later save of the other row keeps it; show (the census the sheet reads) lists both.
//
// protects: /home/lyphe/.claude/hooks/launch_table/rnd.py, /home/lyphe/.claude/hooks/launch_table/change.py, /home/lyphe/.claude/hooks/launch_table/write.py, /home/lyphe/.claude/hooks/launch_table/table.py, /home/lyphe/.claude/hooks/launch_table/census.py, /home/lyphe/.claude/hooks/launch_table/__main__.py
// writes: none

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { HOOKS } from "../lib/house_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const TABLE = [
  "version = 1", "", "[default]", 'model = "sonnet"', "", "[default.effort]", 'opus = "medium"', 'fable = "high"', 'sonnet = "high"', "",
  "[deepseek]", 'effort = "max"', "", "[tweak]", 'model = "opus"', "", "[soul.argus]", 'model = "opus"', 'effort = "max"', "",
].join("\n");
const WANT_BARE = { name: "rnd.scout", side: "claude", model: "sonnet", effort: "high" };
const WANT_SCOUT = { name: "rnd.scout", side: "claude", model: "opus", effort: "low" };
const WANT_SPIKE = { name: "rnd.spike", side: "claude", model: "fable", effort: "high" };

function cli(file, dir, args) {
  const ran = spawnSync("python3", ["-m", "launch_table"].concat(args), {
    cwd: dir, encoding: "utf8", timeout: 60000, maxBuffer: 64 * 1024 * 1024,
    env: Object.assign({}, process.env, { PYTHONPATH: HOOKS, LAUNCH_TABLE_PATH: file }),
  });
  let json = null;
  try { json = JSON.parse(String(ran.stdout || "").trim().split("\n").pop()); } catch (e) { /* judged by the caller */ }
  return { status: ran.status, json: json, stderr: String(ran.stderr || "").trim().split("\n").pop() };
}
function body(text, section) {
  const lines = text.split("\n");
  const at = lines.indexOf("[" + section + "]");
  if (at === -1) return null;
  const out = {};
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith("[")) break;
    const m = line.match(/^(\w+) = "([^"]*)"$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

runCase(async (t) => {
  const dir = await scratchDir(t, "rnd-launch-rows");
  const file = path.join(dir, "launch.toml");
  fs.writeFileSync(file, TABLE);
  const wrong = [];
  const resolve = (name) => cli(file, dir, ["resolve", name, "--side", "claude"]);

  const bare = resolve("rnd.scout");
  if (bare.status !== 0 || !same(bare.json, WANT_BARE)) wrong.push("the bare rnd.scout resolved exit " + bare.status + " " + (JSON.stringify(bare.json) || bare.stderr) + ", not " + JSON.stringify(WANT_BARE));

  const s1 = cli(file, dir, ["set", "rnd.scout", "--model", "opus", "--effort", "low"]);
  if (s1.status !== 0 || (s1.json && s1.json.error)) return broken("set rnd.scout --model opus --effort low answered exit " + s1.status + ": " + (JSON.stringify(s1.json) || s1.stderr));
  const s2 = cli(file, dir, ["set", "rnd.spike", "--model", "fable"]);
  if (s2.status !== 0 || (s2.json && s2.json.error)) return broken("set rnd.spike --model fable answered exit " + s2.status + ": " + (JSON.stringify(s2.json) || s2.stderr));

  const scout = resolve("rnd.scout");
  if (scout.status !== 0 || !same(scout.json, WANT_SCOUT)) wrong.push("after the spike's save rnd.scout resolved " + (JSON.stringify(scout.json) || scout.stderr) + ", not " + JSON.stringify(WANT_SCOUT));
  const spike = resolve("rnd.spike");
  if (spike.status !== 0 || !same(spike.json, WANT_SPIKE)) wrong.push("rnd.spike resolved " + (JSON.stringify(spike.json) || spike.stderr) + ", not " + JSON.stringify(WANT_SPIKE));

  const text = fs.readFileSync(file, "utf8");
  if (!body(text, "rnd.scout")) wrong.push("the saved file holds no [rnd.scout] section");
  if (!body(text, "rnd.spike")) wrong.push("the saved file holds no [rnd.spike] section");
  if (!same(body(text, "tweak"), { model: "opus" })) wrong.push("[tweak] became " + JSON.stringify(body(text, "tweak")));
  if (!same(body(text, "soul.argus"), { model: "opus", effort: "max" })) wrong.push("[soul.argus] became " + JSON.stringify(body(text, "soul.argus")));

  const shown = cli(file, dir, ["show"]);
  const names = shown.json && Array.isArray(shown.json.rows) ? shown.json.rows.map((r) => r.name) : [];
  for (const name of ["rnd.scout", "rnd.spike"]) if (names.indexOf(name) === -1) wrong.push("launch-table show lists no " + name + " row (exit " + shown.status + ")");

  if (wrong.length) return broken(wrong.join("; "));
  return held("bare rnd.scout rode sonnet/high; after two saves rnd.scout answered opus/low and rnd.spike fable/high; both sections written beside [tweak] and [soul.argus] unchanged; show lists both rows");
});
