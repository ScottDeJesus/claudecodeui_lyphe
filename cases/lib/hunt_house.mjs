// hunt_house.mjs — a scratch home for the bug hunters' config: the seam's hunts.toml, a scratch crontab tab and a
// scratch cron registry, and `dispatcher hunt …` run against them.
//
//   import { huntHouse, hunt, configJson, toml, liveCrontab, SEAM_TOML } from "../lib/hunt_house.mjs";
//   const house = await huntHouse(t, "hunt-config");          // bugHouse's scratch home + HUNTS_CONFIG_PATH, DATABASE_PATH, tab
//   const ran = await hunt(house, ["config", "--json"]);       // { code, out, err }
//   const read = await configJson(house);                      // the parsed --json answer, or null
//   const file = await toml(house.config);                     // the file as tomllib reads it, or null
//
// EVERY PATH IS SCRATCH. HUNTS_CONFIG_PATH names the case's own hunts.toml, DATABASE_PATH a scratch cron registry (the
// registry door, `scripts/cron-registry-sync`, otherwise writes the operator's ~/.cloudcli/auth.db even when its
// crontab half is sent to a --tabfile; the process's DATABASE_PATH wins over CloudCLI's .env), and `house.tab` is the
// scratch tab a case passes as --tabfile. A case must pass --tabfile on every act that can reach the door: without it
// the door edits the operator's real crontab. `liveCrontab()` only READS the real table, so a case can show it unmoved.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { bugHouse, dispatcher } from "./bug_house.mjs";

export const NIGHT_COMMAND = "/home/lyphe/.claude/scripts/dispatcher hunt night >> /home/lyphe/.claude/state/dispatcher/hunt.log 2>&1";
export const KINDS = ["security", "behaviour", "ui", "data", "code"];
export const PROJECTS = ["Restorly connector", "Restorly app", "CloudCLI", "The house"];

/** The seam's file, under a header saying its one writer — what the build ships in charters/hunts.toml. */
export const SEAM_TOML = `# charters/hunts.toml: the bug hunters' nights. Its one writer is \`dispatcher hunt config\`.
nightly = false
start = "00:30"
minutes = 120
grace = 15
min_left = 20
tickets_per_night = 15
batch = 12
order = ["security", "behaviour", "ui", "data", "code"]
turns = "project"
exclude = ["**/*.md", "**/*.lock", "**/package-lock.json", "**/node_modules/**", "**/dist/**", "cases/**", "tests/**", "plans/**", "scratchpad/**", "docs/**", "**/*.png", "**/*.jpg", "**/*.webp", "**/*.woff2", "**/*.gz"]
[lens.ui]
include = ["**/*.tsx", "**/*.jsx", "**/*.css", "**/*.html"]
[[project]]
name = "Restorly connector"
path = "/opt/shadow-connector"
exclude = ["installation_guides/**"]
  [[project.database]]
  name = "restorly"
  kind = "postgres"
  env_file = "/opt/shadow-connector/.env"
[[project]]
name = "Restorly app"
path = "/opt/eis-app"
[[project]]
name = "CloudCLI"
path = "/home/lyphe/.claude/claudecodeui_lyphe"
  [[project.database]]
  name = "board"
  kind = "sqlite"
  path = "/home/lyphe/.cloudcli/auth.db"
[[project]]
name = "The house"
path = "/home/lyphe/.claude"
  [[project.database]]
  name = "dispatcher"
  kind = "sqlite"
  path = "/home/lyphe/.claude/state/dispatcher/dispatcher.db"
`;

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
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { err += b; });
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: null, out, err: `${err}${error.message}` }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** bugHouse's scratch home, with the seam's hunts.toml written (`text` overrides it), a scratch registry and a tab path. */
export async function huntHouse(t, label, { text = SEAM_TOML } = {}) {
  const house = await bugHouse(t, label);
  house.config = path.join(house.dir, "hunts.toml");
  house.tab = path.join(house.dir, "crontab.tab");
  house.registry = path.join(house.dir, "registry.db");
  if (text !== null) fs.writeFileSync(house.config, text);
  house.env.HUNTS_CONFIG_PATH = house.config;
  house.env.DATABASE_PATH = house.registry;
  return house;
}

/** `dispatcher hunt <args>` in the scratch home: { code, out, err }. */
export function hunt(house, args) {
  return dispatcher(house, ["hunt", ...args]);
}

/** `scripts/hunt <args>`: the hunters' own wrapper, run as a hunter runs it. */
export function huntScript(house, args) {
  return run("/home/lyphe/.claude/scripts/hunt", args, { env: house.env, cwd: house.dir });
}

/** The answer of a `--json` run, the whole stdout first and then its last line; null when neither is JSON. */
export function parseJson(ran) {
  for (const text of [ran.out.trim(), ran.out.trim().split("\n").pop()]) {
    try { return JSON.parse(text); } catch { /* try the next reading */ }
  }
  return null;
}

/** `dispatcher hunt config --json`, parsed. */
export async function configJson(house) {
  return parseJson(await hunt(house, ["config", "--json"]));
}

/** The names of a read's projects, whether it lists names or objects carrying `name`. */
export function projectNames(read) {
  const list = read?.projects ?? read?.project ?? [];
  return Array.isArray(list) ? list.map((p) => (typeof p === "string" ? p : p?.name)) : [];
}

/** A TOML file as Python's tomllib reads it, or null when it is missing or not TOML. */
export async function toml(file) {
  const ran = await run("python3", ["-I", "-c",
    "import json, sys, tomllib\ntry:\n  print(json.dumps(tomllib.load(open(sys.argv[1], 'rb'))))\nexcept Exception:\n  print('null')",
    file]);
  try { return JSON.parse(ran.out); } catch { return null; }
}

/** The operator's real crontab, READ only (`crontab -l`); "" when he has none. */
export async function liveCrontab() {
  const ran = await run("crontab", ["-l"]);
  return ran.code === 0 ? ran.out : "";
}

/** The tab's lines that run the night's command, each as { minute, hour, rest, command }. */
export function nightLines(tabFile) {
  const text = fs.existsSync(tabFile) && fs.statSync(tabFile).isFile() ? fs.readFileSync(tabFile, "utf8") : "";
  return text.split("\n").filter((l) => l.includes("hunt night")).map((l) => {
    const f = l.trim().split(/\s+/);
    return { minute: Number(f[0]), hour: Number(f[1]), rest: f.slice(2, 5).join(" "), command: f.slice(5).join(" ") };
  });
}

/** The scratch registry's rows named bug-hunters; [] when the registry was never made. */
export async function registryRows(house) {
  if (!fs.existsSync(house.registry)) return [];
  const ran = await run("python3", ["-I", "-c",
    "import json, sqlite3, sys\nc = sqlite3.connect(sys.argv[1])\ntry:\n  print(json.dumps([list(r) for r in c.execute(\"SELECT name, command FROM cron_jobs WHERE name = 'bug-hunters'\")]))\nexcept Exception:\n  print('[]')",
    house.registry]);
  try { return JSON.parse(ran.out); } catch { return []; }
}

/** The lines of a run that start REFUSED, from stdout and stderr together. */
export function refusals(ran) {
  return `${ran.out}\n${ran.err}`.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("REFUSED"));
}
