// `launch-table set hunt.<kind>` and `resolve hunt.<kind> --side claude` against a scratch LAUNCH_TABLE_PATH.
// One save writes all five `[hunt.<kind>]` sections after `[tweak]`, in kind order, and keeps the rest of the
// table. A row with no model rides the model the table gives its soul; a row's model is the hunt's; the effort
// is `souls.effort_for`'s: the soul's own pin on its own model, else the table's default for the model riding.
// `--model default` clears the row's model. `--effort`, a planner soul, a soul with no shim, an unknown kind and
// a model outside MODELS are each one `{"error"}` sentence, exit 2, and leave the file byte for byte.
//
// protects: /home/lyphe/.claude/hooks/launch_table/change.py, /home/lyphe/.claude/hooks/launch_table/write.py, /home/lyphe/.claude/hooks/launch_table/__main__.py, /home/lyphe/.claude/hooks/launch_table/census.py, /home/lyphe/.claude/hooks/launch_table/table.py
// writes: none

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { HOOKS } from "../lib/house_live.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const PYPATH = HOOKS;
const KINDS = ["security", "behaviour", "ui", "data", "code"];
const SHIPPED = { security: "argus", behaviour: "athena", ui: "iris", data: "sherlock", code: "hephaestus" };

const TABLE = `version = 1

[default]
model = "sonnet"

[default.effort]
opus = "medium"
fable = "high"
sonnet = "high"

[deepseek]
effort = "max"

[sorter]
model = "claude-haiku-5-5"
effort = "low"

[tweak]
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

/** `[section]` headers of a TOML text, in order, and the key lines under one of them. */
const headers = (text) => [...text.matchAll(/^\[([^\]]+)\]\s*$/gm)].map((m) => m[1]);
function body(text, section) {
  const lines = text.split("\n");
  const at = lines.indexOf(`[${section}]`);
  if (at === -1) return null;
  const out = {};
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith("[")) break;
    const m = line.match(/^(\w+) = "([^"]*)"$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

runCase(async (t) => {
  const dir = await scratchDir(t, "hunt-set-resolve");
  const file = path.join(dir, "launch.toml");
  fs.writeFileSync(file, TABLE);
  const wrong = [];
  const resolve = (kind) => cli(file, dir, "resolve", `hunt.${kind}`, "--side", "claude");
  const same = (got, want) => JSON.stringify(got) === JSON.stringify(want);

  const set = cli(file, dir, "set", "hunt.data", "--soul", "daedalus", "--model", "sonnet");
  if (set.status !== 0 || !set.json || set.json.error) {
    return broken(`set hunt.data --soul daedalus --model sonnet answered exit ${set.status}: ${JSON.stringify(set.json) || set.stderr}`);
  }
  const text = fs.readFileSync(file, "utf8");
  const order = headers(text);
  const tweakAt = order.indexOf("tweak");
  const huntAt = KINDS.map((kind) => order.indexOf(`hunt.${kind}`));
  if (huntAt.some((at) => at === -1)) wrong.push(`the save wrote sections ${order.join(", ")}: not all five hunt rows`);
  else if (huntAt.some((at, i) => at < tweakAt || (i > 0 && at < huntAt[i - 1]))) wrong.push(`the hunt rows are not after [tweak] in kind order: ${order.join(", ")}`);
  for (const kind of KINDS) {
    const row = body(text, `hunt.${kind}`) || {};
    const want = kind === "data" ? { soul: "daedalus", model: "sonnet" } : { soul: SHIPPED[kind] };
    if (!same(row, want)) wrong.push(`[hunt.${kind}] holds ${JSON.stringify(row)}, not ${JSON.stringify(want)}`);
  }
  if (!same(body(text, "tweak"), { model: "opus" })) wrong.push(`[tweak] became ${JSON.stringify(body(text, "tweak"))}`);
  if (!same(body(text, "soul.argus"), { model: "opus", effort: "max" })) wrong.push(`[soul.argus] became ${JSON.stringify(body(text, "soul.argus"))}`);

  const answers = [
    ["data", { name: "hunt.data", side: "claude", model: "sonnet", effort: "high" }],
    ["security", { name: "hunt.security", side: "claude", model: "opus", effort: "max" }],
    ["behaviour", { name: "hunt.behaviour", side: "claude", model: "sonnet", effort: "high" }],
  ];
  for (const [kind, want] of answers) {
    const got = resolve(kind);
    if (got.status !== 0 || !same(got.json, want)) wrong.push(`resolve hunt.${kind} answered exit ${got.status} ${JSON.stringify(got.json)}, not ${JSON.stringify(want)}`);
  }
  // A model that is not the soul's own takes the table's default effort for it, never the soul's own pin.
  cli(file, dir, "set", "hunt.security", "--model", "sonnet");
  const moved = resolve("security");
  if (!same(moved.json, { name: "hunt.security", side: "claude", model: "sonnet", effort: "high" })) wrong.push(`hunt.security on sonnet resolved ${JSON.stringify(moved.json)}`);
  const cleared = cli(file, dir, "set", "hunt.security", "--model", "default");
  const back = resolve("security");
  if (cleared.status !== 0 || !same(back.json, { name: "hunt.security", side: "claude", model: "opus", effort: "max" })) wrong.push(`--model default left hunt.security resolving ${JSON.stringify(back.json)} (set exit ${cleared.status})`);

  const before = fs.readFileSync(file, "utf8");
  const refusals = [
    ["--effort", ["set", "hunt.data", "--effort", "high"], /hunt/i],
    ["a planner, eupalinos", ["set", "hunt.data", "--soul", "eupalinos"], null],
    ["a planner, odysseus", ["set", "hunt.ui", "--soul", "odysseus"], null],
    ["a soul with no shim", ["set", "hunt.data", "--soul", "no_such_soul"], null],
    ["an unknown kind", ["set", "hunt.nope", "--soul", "athena"], null],
    ["a model outside MODELS", ["set", "hunt.data", "--model", "gpt"], null],
  ];
  for (const [label, args, says] of refusals) {
    const got = cli(file, dir, ...args);
    const sentence = got.json && typeof got.json.error === "string" ? got.json.error : null;
    if (got.status !== 2 || !sentence) wrong.push(`${label} was not refused (exit ${got.status}: ${JSON.stringify(got.json)})`);
    else if (says && !says.test(sentence)) wrong.push(`${label}'s refusal does not speak of a hunt: ${sentence}`);
  }
  if (fs.readFileSync(file, "utf8") !== before) wrong.push("a refused set changed the file");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("one set wrote the five hunt rows after [tweak]; resolve rode the row's model or the soul's own with effort_for's word; six refusals left the file byte for byte");
});
