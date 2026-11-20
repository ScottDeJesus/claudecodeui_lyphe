// hunt_map_house.mjs — scratch git projects for the bug hunters' map, a hunts.toml naming them, and a child Python
// that imports the house's hooks (`dispatcher.hunt_map`, `dispatcher.hunt_map_tables`, `dispatcher.store_hunts`).
//
//   import { mapHouse, gitInit, git, put, commit, py, huntsToml } from "../lib/hunt_map_house.mjs";
//   const house = await mapHouse(t, "hunt-map", []);            // huntHouse's scratch home, no project yet
//   const repo = await gitInit(house, "proj");                  // <scratch>/proj, a git work tree
//   put(repo, "src/a.py", "x = 1\n");
//   await commit(repo, "one", { daysAgo: 40 });                 // `git add -A` + a commit dated 40 days back
//   setProjects(house, [{ name: "P", path: repo }]);            // rewrites the scratch hunts.toml
//   const got = await py(house, SCRIPT, ["P"]);                 // { code, out, err, json } — json is the last line
//
// EVERY PATH IS SCRATCH: the home, the config, the repos and any SQLite file live under the case's own folder
// (huntHouse); git runs with its own identity and with dates the case chose, so no commit ever reaches a real repo.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { SEAM_TOML, huntHouse } from "./hunt_house.mjs";

const HOOKS = "/home/lyphe/.claude/hooks";
const TIMEOUT_MS = 60000;

function run(file, args, { env = process.env, cwd, input = "" } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      resolve({ code: null, out: "", err: String(error?.message ?? error) });
      return;
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { err += b; });
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: null, out, err: `${err}${error.message}` }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** The seam's globals (everything above its first project), with these projects under them. */
export function huntsToml(projects) {
  const head = SEAM_TOML.split("[[project]]")[0];
  const body = projects.map((p) => {
    let text = `[[project]]\nname = ${JSON.stringify(p.name)}\npath = ${JSON.stringify(p.path)}\n`;
    if (p.exclude) text += `exclude = ${JSON.stringify(p.exclude)}\n`;
    for (const d of p.databases ?? []) {
      text += `  [[project.database]]\n  name = ${JSON.stringify(d.name)}\n  kind = ${JSON.stringify(d.kind)}\n`;
      text += d.kind === "sqlite" ? `  path = ${JSON.stringify(d.path)}\n` : `  env_file = ${JSON.stringify(d.env_file)}\n`;
    }
    return text;
  }).join("");
  return head + body;
}

/** huntHouse's scratch home with a hunts.toml naming `projects` (none by default). */
export async function mapHouse(t, label, projects = []) {
  const house = await huntHouse(t, label, { text: huntsToml(projects) });
  house.env.PYTHONDONTWRITEBYTECODE = "1";
  return house;
}

/** Rewrite the scratch hunts.toml to name these projects. */
export function setProjects(house, projects) {
  fs.writeFileSync(house.config, huntsToml(projects));
}

/** `git <args>` in `repo`, with the case's identity and, when given, one date for author and committer. */
export function git(repo, args, { date } = {}) {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  if (date) Object.assign(env, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return run("git", ["-c", "user.name=case", "-c", "user.email=case@scratch", "-c", "commit.gpgsign=false", ...args], { env, cwd: repo });
}

/** A fresh git work tree at <scratch>/<name>. */
export async function gitInit(house, name) {
  const repo = path.join(house.dir, name);
  fs.mkdirSync(repo, { recursive: true });
  const ran = await git(repo, ["init", "-q", "."]);
  if (ran.code !== 0) throw new Error(`git init ${repo}: ${ran.err.trim()}`);
  return repo;
}

/** Write `text` at `rel` inside `repo`, folders made. */
export function put(repo, rel, text) {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** `git add -A` then one commit, dated `daysAgo` days back (0 is an hour ago). */
export async function commit(repo, message, { daysAgo = 0 } = {}) {
  const when = new Date(Date.now() - (daysAgo * 86400 + 3600) * 1000).toISOString();
  for (const args of [["add", "-A"], ["commit", "-q", "--allow-empty", "-m", message]]) {
    const ran = await git(repo, args, { date: when });
    if (ran.code !== 0) throw new Error(`git ${args.join(" ")}: ${ran.err.trim()}`);
  }
}

/** A child Python with the house's hooks importable, in the scratch home's environment; `json` is its last line. */
export async function py(house, script, args = []) {
  const prelude = `import sys\nsys.path.insert(0, ${JSON.stringify(HOOKS)})\n`;
  const ran = await run("python3", ["-c", prelude + script, ...args], { env: house.env, cwd: house.dir });
  let json = null;
  try { json = JSON.parse(ran.out.trim().split("\n").pop()); } catch { /* left null */ }
  return { ...ran, json };
}

/** The last line of a child that failed, for a verdict. */
export function lastLine(ran) {
  return `exit ${ran.code}: ${(ran.err || ran.out).trim().split("\n").pop()?.slice(0, 220) || "(nothing printed)"}`;
}
