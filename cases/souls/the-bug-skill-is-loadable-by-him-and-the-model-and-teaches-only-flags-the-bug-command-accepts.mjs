// protects: /home/lyphe/.claude/skills/bug/SKILL.md, /home/lyphe/.claude/hooks/dispatcher/cmd/bug.py, /home/lyphe/.claude/scripts/bug
// writes: none
//
// `/bug <words>` is how a chat or a soul files a defect it tripped over. Its skill must stay loadable both ways —
// typed by him (`user-invocable: true`) and picked up by the model (never `disable-model-invocation: true`) — must
// send the filing to `~/.claude/scripts/bug file` run from the defect's folder, must say never to open the board's
// database, and must never teach a verb or a flag the bug command refuses: every `bug <verb> … --flag` the skill
// writes is checked against that verb's own `--help`, and every other `--flag` it names against `bug file --help`.
// The help is asked in a scratch dispatcher home, so the live store is never opened.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const SKILL = path.join(os.homedir(), ".claude", "skills", "bug", "SKILL.md");
const BUG = path.join(os.homedir(), ".claude", "scripts", "bug");

function run(file, args, { env, cwd }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ code: null, out: "", err: String(e?.message ?? e) });
      return;
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { err += b; });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, out, err: `${err}${e.message}` }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

const flagsIn = (text) => new Set([...text.matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)].map((m) => m[1]));

runCase(async (t) => {
  if (!fs.existsSync(SKILL)) return broken(`${SKILL} is not there`);
  const text = fs.readFileSync(SKILL, "utf8");
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) return broken("SKILL.md opens with no --- frontmatter ---");
  const field = (k) => fm[1].match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
  const body = text.slice(fm[0].length);

  const wrong = [];
  if (field("name") !== "bug") wrong.push(`its name is ${JSON.stringify(field("name"))}, not bug`);
  if (field("user-invocable") !== "true") wrong.push(`user-invocable is ${JSON.stringify(field("user-invocable"))}, not true`);
  if (field("disable-model-invocation") === "true") wrong.push("disable-model-invocation: true closes it to the model");
  if (!field("description")) wrong.push("it has no description, so the model has nothing to load it by");
  if (!body.includes("~/.claude/scripts/bug file")) wrong.push("its words never name ~/.claude/scripts/bug file");
  if (!/folder the defect is in/i.test(body)) wrong.push("its words never say to file from the folder the defect is in");
  if (!/never open the board'?s database/i.test(body)) wrong.push("its words never say never to open the board's database");

  const dir = await scratchDir(t, "bug-skill");
  const env = { ...process.env, DISPATCHER_HOME: path.join(dir, "home"), PLAN_RUNNER_STATE_DIR: path.join(dir, "state") };
  const helps = new Map();
  const help = async (verb) => {
    if (!helps.has(verb)) {
      const ran = await run(BUG, [verb, "--help"], { env, cwd: dir });
      helps.set(verb, ran.code === 0 && /usage: bug /.test(ran.out) ? flagsIn(ran.out) : null);
    }
    return helps.get(verb);
  };

  const taught = [...text.matchAll(/\bbug ([a-z]+)\b([^`\n]*)/g)].filter((m) => /^(file|show|list|cleared|pending|placed|stats|words)$/.test(m[1]) || /^--/.test(m[2].trim()));
  let checked = 0;
  for (const [, verb, rest] of taught) {
    const accepts = await help(verb);
    if (!accepts) { wrong.push(`the skill teaches bug ${verb}, which bug ${verb} --help does not answer`); continue; }
    for (const flag of flagsIn(rest)) {
      checked += 1;
      if (!accepts.has(flag)) wrong.push(`the skill teaches bug ${verb} --${flag}, which bug ${verb} refuses`);
    }
  }
  const fileFlags = await help("file");
  for (const flag of flagsIn(body)) {
    const anyVerb = [...helps.values()].some((s) => s?.has(flag));
    if (!anyVerb && !fileFlags?.has(flag)) wrong.push(`the skill names --${flag}, which no bug verb it teaches accepts`);
  }

  if (wrong.length > 0) return broken([...new Set(wrong)].join("; "));
  return held(`frontmatter bug / user-invocable / model-loadable; ${taught.length} bug commands taught, ${checked} flags each accepted by its verb's --help`);
});
