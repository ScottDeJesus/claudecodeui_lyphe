// hunt_marks_house.mjs — a scratch hunt sitting for the hunter's four verbs (`dispatcher hunt next|covered|skipped|clock`):
// a git project of six files, the store made, a night open, passes and units and sittings written by plain SQL on the
// store's own schema, and a sitting's `child.log` written where `plan_runner.solo.record` says it lives.
//
//   import { marksHouse, addPass, addSitting, writeLog, handTo, huntAs, unitsOf } from "../lib/hunt_marks_house.mjs";
//   const house = await marksHouse(t, "marks", { batch: 2, tickets: 3 });   // house.repo holds FILES, house.night is open
//   const { passId, ids } = await addPass(house, "code", FILES);           // ids["src/a.py"] is that unit's row id
//   const s = await addSitting(house, { hunt: "code", passId, launchId: "dispatch-hephaestus-case-1" });
//   await handTo(house, s, [ids["src/a.py"]]);                             // as `hunt next` would have handed it
//   await writeLog(house, "dispatch-hephaestus-case-1", [{ use: { name: "Read", input: { file_path: "/x" } } }]);
//   const ran = await huntAs(house, s, ["covered", "src/a.py", "--note", "read it"]);   // { code, out, err }
//
// EVERY PATH IS SCRATCH (huntHouse's): DISPATCHER_HOME is <scratch>/home, so `record`'s state root is <scratch> and a
// child.log is <scratch>/dispatch-souls/<id>/child.log, never a live launch's. The sitting is named to a verb only by
// DISPATCHER_HUNT_SITTING on that one call; the scratch env carries none, nor PLAN_RUNNER_HUNT.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { DISPATCHER, exec, rows } from "./bug_house.mjs";
import { commit, gitInit, lastLine, mapHouse, put, py, setProjects } from "./hunt_map_house.mjs";

export const FILES = ["a.py", "src/a.py", "src/b.py", "lib/c.py", "lib/d.py", "web/e.py"];
export const NIGHT = "2026-11-19";

function run(file, args, { env, cwd }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
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
  });
}

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString().replace(/\.\d{3}Z$/, "Z");

/** The scratch home, a project `Proj` of FILES (committed), the store made and `NIGHT` open; batch and ticket cap set. */
export async function marksHouse(t, label, { batch = 12, tickets = 15, files = FILES } = {}) {
  const house = await mapHouse(t, label);
  for (const name of ["DISPATCHER_HUNT_SITTING", "PLAN_RUNNER_HUNT"]) delete house.env[name];
  house.repo = await gitInit(house, "proj");
  for (const rel of files) put(house.repo, rel, `# ${rel}\nx = 1\n`);
  await commit(house.repo, "six files", { daysAgo: 1 });
  setProjects(house, [{ name: "Proj", path: house.repo }]);
  const text = fs.readFileSync(house.config, "utf8")
    .replace(/^batch = \d+$/m, `batch = ${batch}`).replace(/^tickets_per_night = \d+$/m, `tickets_per_night = ${tickets}`);
  fs.writeFileSync(house.config, text);
  const made = await py(house, "from dispatcher import store\nstore.connect().close()\nprint('{}')");
  if (made.code !== 0) throw new Error(`the scratch store could not be made — ${lastLine(made)}`);
  await exec(house, "INSERT INTO hunt_nights (night, opened_at, minutes, state) VALUES (?, ?, 120, 'open')", [NIGHT, iso(-600000)]);
  house.night = NIGHT;
  return house;
}

/** One open pass of `hunt` over the project holding `units` (in this order, all open); its id and each unit's row id. */
export async function addPass(house, hunt, units, { number } = {}) {
  const n = number ?? ((await rows(house, "SELECT count(*) AS n FROM hunt_passes WHERE hunt = ?", [hunt]))[0].n + 1);
  await exec(house, "INSERT INTO hunt_passes (hunt, project, number, state, mapped_at) VALUES (?, ?, ?, 'open', ?)",
    [hunt, house.repo, n, iso(-600000)]);
  const passId = (await rows(house, "SELECT max(id) AS id FROM hunt_passes"))[0].id;
  for (const [i, unit] of units.entries()) {
    const folder = hunt === "data" ? unit.split(".")[0] : (path.dirname(unit) === "." ? "" : path.dirname(unit));
    await exec(house, "INSERT INTO hunt_units (pass_id, unit, folder, position, fingerprint, state) VALUES (?, ?, ?, ?, ?, 'open')",
      [passId, unit, folder, i + 1, `fp-${unit}`]);
  }
  const ids = {};
  for (const r of await rows(house, "SELECT id, unit FROM hunt_units WHERE pass_id = ?", [passId])) ids[r.unit] = r.id;
  return { passId, ids };
}

/** A sitting row written by hand: out by default, its deadline `minutes` from now (negative: already past). */
export async function addSitting(house, { hunt = "code", passId, launchId = null, minutes = 60, state = "out", night = house.night }) {
  await exec(house,
    "INSERT INTO hunt_sittings (night, hunt, project, pass_id, soul, model, launch_id, state, deadline, started_at, ended_at, outcome) " +
    "VALUES (?, ?, ?, ?, 'hephaestus', 'sonnet', ?, ?, ?, ?, ?, ?)",
    [night, hunt, house.repo, passId, launchId, state, iso(minutes * 60000), iso(-300000),
      state === "ended" ? iso(-60000) : null, state === "ended" ? "failed" : null]);
  return (await rows(house, "SELECT max(id) AS id FROM hunt_sittings"))[0].id;
}

/** Hand these unit rows to a sitting, as `hunt next` would have: sitting_id, handed_at, handed + 1. */
export async function handTo(house, sittingId, unitIds) {
  for (const id of unitIds) {
    await exec(house, "UPDATE hunt_units SET sitting_id = ?, handed_at = ?, handed = handed + 1 WHERE id = ?", [sittingId, iso(-120000), id]);
  }
}

/** Where `plan_runner.solo.record` keeps a launch's child.log in this scratch home. */
export async function logPathOf(house, launchId) {
  const got = await py(house, "import json, sys\nfrom plan_runner.solo import record\nprint(json.dumps(record.path(sys.argv[1], 'child.log')))", [launchId]);
  if (typeof got.json !== "string") throw new Error(`record.path did not answer — ${lastLine(got)}`);
  return got.json;
}

/**
 * Write a launch's child.log as the CLI's stream-json writes it: an init line, then for each event one line —
 * `{ use: { name, input } }` an assistant tool_use, `{ result: text }` the user tool_result fed back, `{ say: text }`
 * an assistant text block. Answers the log's path.
 */
export async function writeLog(house, launchId, events) {
  const file = await logPathOf(house, launchId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const session = "00000000-0000-4000-8000-00000000ca5e";
  const out = [JSON.stringify({ type: "system", subtype: "init", session_id: session, cwd: house.repo, tools: ["Read", "Bash", "Grep"] })];
  let n = 0;
  for (const e of events) {
    n += 1;
    const id = `toolu_case_${n}`;
    if (e.use) {
      out.push(JSON.stringify({ type: "assistant", session_id: session, message: { role: "assistant", model: "claude-sonnet",
        content: [{ type: "tool_use", id, name: e.use.name, input: e.use.input }] } }));
    } else if (e.result !== undefined) {
      out.push(JSON.stringify({ type: "user", session_id: session, message: { role: "user",
        content: [{ type: "tool_result", tool_use_id: `toolu_case_${n - 1}`, content: e.result }] } }));
    } else if (e.say !== undefined) {
      out.push(JSON.stringify({ type: "assistant", session_id: session, message: { role: "assistant", model: "claude-sonnet",
        content: [{ type: "text", text: e.say }] } }));
    }
  }
  fs.writeFileSync(file, `${out.join("\n")}\n`);
  return file;
}

/** `dispatcher hunt <args>` with DISPATCHER_HUNT_SITTING set to `sittingId` (none at all when it is null). */
export function huntAs(house, sittingId, args) {
  const env = { ...house.env };
  if (sittingId !== null && sittingId !== undefined) env.DISPATCHER_HUNT_SITTING = String(sittingId);
  return run(DISPATCHER, ["hunt", ...args], { env, cwd: house.repo });
}

/** Every unit row, keyed `<pass_id>:<unit>`, for before/after comparisons. */
export async function unitsOf(house) {
  const got = {};
  for (const r of await rows(house, "SELECT * FROM hunt_units ORDER BY pass_id, position")) got[`${r.pass_id}:${r.unit}`] = r;
  return got;
}

/** The REFUSED lines a run printed (stdout and stderr together). */
export function refusedLines(ran) {
  return `${ran.out}\n${ran.err}`.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("REFUSED"));
}

/** One ticket row written by hand (filed by a hunter of this house's project unless told otherwise). */
export async function addTicket(house, { title, words = "", state = "filed", sittingId = null, hunt = "code" }) {
  await exec(house,
    "INSERT INTO tickets (source, path, title, words, priority, reporter, state, filed_at, hunt, sitting_id) " +
    "VALUES ('hunter', ?, ?, ?, 'medium', '{}', ?, ?, ?, ?)",
    [house.repo, title, words, state, iso(-60000), hunt, sittingId]);
}

/** One proposal with one finding on `unit`, written by hand. */
export async function addProposal(house, { title, unit, state = "open" }) {
  await exec(house,
    "INSERT INTO proposals (path, title, words, kind, priority, state, reporter, hunt, proposed_at) " +
    "VALUES (?, ?, 'words', 'design', 'medium', ?, '{}', 'code', ?)", [house.repo, title, state, iso(-60000)]);
  const id = (await rows(house, "SELECT max(id) AS id FROM proposals"))[0].id;
  await exec(house, "INSERT INTO proposal_findings (proposal_id, unit, words, reporter, found_at) VALUES (?, ?, 'a finding', '{}', ?)",
    [id, unit, iso(-60000)]);
  return id;
}
