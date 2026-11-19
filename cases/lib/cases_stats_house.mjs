// cases_stats_house.mjs — a scratch dispatcher home holding one regression suite with a known history, for `cases stats`.
//
//   import { statsHouse, cases, stats, storeDump } from "../lib/cases_stats_house.mjs";
//   const h = await statsHouse(t, "stats-counts");        // a bugHouse (bug_house.mjs) plus the suite, its cases and their runs
//   const ran = await stats(h, ["--days", "30"]);           // { code, out, err, json } — json is null when stdout is no JSON
//   const ran2 = await cases(h, ["suites", "--json"]);      // any `cases` verb in the scratch home
//
// EVERY PATH IS SCRATCH: the home is bug_house's (`DISPATCHER_HOME`, `PLAN_RUNNER_STATE_DIR`, `BUGS_CONFIG_PATH` under the
// case's own folder), so `chains_dir()` is `<dir>/dispatch-chains` and the operator's store, records and charters are
// never read or written.
//
// THE HISTORY, every stamp a UTC day counted back from today (D-k, at 12:00:00Z; today's one run at 00:00:30Z), with the
// numbers it must print written beside it in `h.expect`:
//
//   held-one        held D-1 (nightly) · held D-0 (hand)                                       holding
//   broke-plain     held D-3 (nightly) · broken D-1 (nightly)                                  broken      a break begun D-1
//   regressed-open  held D-5 · broken D-2, regression triage D-2, cure walk W1 (ended failed)  regressed   a break begun D-2;
//                   an OPEN ticket (bug file) holds case:<repo>:regressed-open
//   cured-one       held D-6 · broken D-4, regression triage D-4 · held D-1 (nightly)          holding     begun D-4, ended D-1
//   cant            cannot-run D-1 (nightly), its first run                                    can't run
//   notrun          no run                                                                     not run
//   theirs-one      held D-8 · broken D-7, two regression triages D-7, walks W2 (done) and     regressed   begun D-7; the operator's
//                   W3 (failed), both ended · a CLEARED ticket holds its key (not open)
//   old-ruled       held D-50 · broken D-40, regression triage D-40 · held D-39                holding     outside a 30-day window
//
// A second suite, `gonesuite`, has one case and then loses its cases/cases.toml: a suite the store holds that will not load.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { bug, bugHouse, said } from "./bug_house.mjs";

export const CASES = path.join(os.homedir(), ".claude", "scripts", "cases");
const RUN_TIMEOUT_MS = 90000;

function runFile(file, args, { env, cwd, input = "" }) {
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
    const timer = setTimeout(() => child.kill("SIGKILL"), RUN_TIMEOUT_MS);
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { err += b; });
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: null, out, err: `${err}${error.message}` }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** `cases <args>` in the scratch home. `CASES_BIN` names another door (a copy of the package, to see a case fail). */
export function cases(h, args, { input = "" } = {}) {
  return runFile(process.env.CASES_BIN || CASES, args, { env: h.env, cwd: h.dir, input });
}

/** `cases stats <args> --json`, its stdout parsed: { code, out, err, json }. */
export async function stats(h, args = []) {
  const ran = await cases(h, ["stats", ...args, "--json"]);
  let json = null;
  try { json = JSON.parse(ran.out); } catch { json = null; }
  return { ...ran, json };
}

const DAY_MS = 86400000;
/** The UTC date k days before today, `YYYY-MM-DD`. */
export const dayBack = (k) => new Date(Date.now() - k * DAY_MS).toISOString().slice(0, 10);
const stamp = (k) => (k === 0 ? `${dayBack(0)}T00:00:30Z` : `${dayBack(k)}T12:00:00Z`);

// The seeding, one python process, one transaction: runs in time order, then triage rows naming their runs.
const SEED = `
import json, sqlite3, sys
db, plan = sys.argv[1], json.loads(sys.argv[2])
conn = sqlite3.connect(db)
ids = {r[1]: r[0] for r in conn.execute("SELECT id, name FROM intents")}
made = {}
with conn:
    for run in sorted(plan["runs"], key=lambda r: r["at"]):
        cur = conn.execute("INSERT INTO case_runs (intent_id, at, trigger, chain_id, word, saw, exit_code, duration_ms, output) "
                           "VALUES (?, ?, ?, NULL, ?, ?, ?, 5, '')",
                           (ids[run["case"]], run["at"], run["trigger"], run["word"], run["word"] + " (seeded)",
                            {"held": 0, "broken": 1, "cannot-run": 2}[run["word"]]))
        made[run["tag"]] = cur.lastrowid
    for tri in plan["triage"]:
        conn.execute("INSERT INTO case_triage (intent_id, run_id, cause, note, cure, by, at) VALUES (?, ?, 'regression', 'seeded', ?, 'athena-case', ?)",
                     (ids[tri["case"]], made[tri["run"]], tri["cure"], tri["at"]))
print(json.dumps({"intents": ids, "runs": made}))
`;

const DUMP = `
import hashlib, sqlite3, sys
conn = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)
h = hashlib.sha256()
for line in conn.iterdump():
    h.update(line.encode()); h.update(b"\\n")
print(h.hexdigest(), conn.execute("SELECT COUNT(*) FROM case_runs").fetchone()[0])
`;

/** The store's whole content as one hash, and its run count: `{ hash, runs }`. */
export async function storeDump(h) {
  const ran = await runFile("python3", ["-I", "-c", DUMP, h.db], { env: process.env, cwd: h.dir });
  if (ran.code !== 0) throw new Error(`the store dump failed: ${ran.err.trim().split("\n").pop()}`);
  const [hash, runs] = ran.out.trim().split(" ");
  return { hash, runs: Number(runs) };
}

const CASE_NAMES = ["held-one", "broke-plain", "regressed-open", "cured-one", "cant", "notrun", "theirs-one", "old-ruled"];

function writeWalk(dir, id, status) {
  const folder = path.join(dir, "dispatch-chains", id);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "chain.json"), JSON.stringify({ chain_id: id, status, ended_at: Date.now() / 1000 - 3600 }));
}

async function must(ran, what) {
  if (ran.code !== 0) throw new Error(`${what}: ${said(ran)}`);
  return ran;
}

/** The scratch home with the history above. Throws (CANNOT RUN through runCase's guard) when any setup step fails. */
export async function statsHouse(t, label) {
  const h = await bugHouse(t, label);
  h.suiteRepo = h.repo;
  await must(await cases(h, ["init", h.repo, "--name", "scratchstats", "--command", ".mjs=node"]), "cases init scratchstats");
  for (const name of CASE_NAMES) {
    await must(await cases(h, ["add", name, "--suite", h.repo, "--by", "athena-case", "--sentence", "-"],
      { input: `Seeded case ${name} for the stats history.\n` }), `cases add ${name}`);
  }
  // A second suite the store holds that then will not load.
  const gone = path.join(h.dir, "gone");
  fs.mkdirSync(gone, { recursive: true });
  await must(await runFile("git", ["init", "-q", gone], { env: process.env, cwd: h.dir }), "git init gone");
  await must(await cases(h, ["init", gone, "--name", "gonesuite", "--command", ".mjs=node"]), "cases init gonesuite");
  await must(await cases(h, ["add", "lost-one", "--suite", gone, "--by", "athena-case", "--sentence", "-"],
    { input: "A case of a suite whose file is gone.\n" }), "cases add lost-one");
  fs.rmSync(path.join(gone, "cases", "cases.toml"));

  const W = { w1: "chain-athena-stats-w1-20261101-000000-0001", w2: "chain-athena-stats-w2-20261101-000000-0002",
              w3: "chain-athena-stats-w3-20261101-000000-0003" };
  writeWalk(h.dir, W.w1, "failed");
  writeWalk(h.dir, W.w2, "done");
  writeWalk(h.dir, W.w3, "failed");

  const r = (tag, c, k, word, trigger = "nightly") => ({ tag, case: c, at: stamp(k), word, trigger });
  const plan = {
    runs: [
      r("h1a", "held-one", 1, "held"), r("h1b", "held-one", 0, "held", "hand"),
      r("bpa", "broke-plain", 3, "held"), r("bpb", "broke-plain", 1, "broken"),
      r("roa", "regressed-open", 5, "held"), r("rob", "regressed-open", 2, "broken"),
      r("cua", "cured-one", 6, "held"), r("cub", "cured-one", 4, "broken"), r("cuc", "cured-one", 1, "held"),
      r("ca", "cant", 1, "cannot-run"),
      r("tha", "theirs-one", 8, "held"), r("thb", "theirs-one", 7, "broken"),
      r("ora", "old-ruled", 50, "held"), r("orb", "old-ruled", 40, "broken"), r("orc", "old-ruled", 39, "held"),
    ],
    triage: [
      { case: "regressed-open", run: "rob", cure: W.w1, at: stamp(2) },
      { case: "cured-one", run: "cub", cure: null, at: stamp(4) },
      { case: "theirs-one", run: "thb", cure: W.w2, at: stamp(7) },
      { case: "theirs-one", run: "thb", cure: W.w3, at: stamp(7) },
      { case: "old-ruled", run: "orb", cure: null, at: stamp(40) },
    ],
  };
  await must(await runFile("python3", ["-I", "-c", SEED, h.db, JSON.stringify(plan)], { env: process.env, cwd: h.dir }), "seeding the runs");

  const key = (name) => `case:${h.repo}:${name}`;
  const filed = await must(await bug(h, ["file", "--title", "regressed-open breaks", "--key", key("regressed-open")],
    { input: "seeded\n" }), "bug file regressed-open");
  const ticket = Number(filed.out.match(/ticket (\d+)/)?.[1]);
  if (!ticket) throw new Error(`bug file printed no ticket id: ${said(filed)}`);
  await must(await bug(h, ["file", "--title", "theirs-one breaks", "--key", key("theirs-one")], { input: "seeded\n" }), "bug file theirs-one");
  await must(await bug(h, ["cleared", "--key", key("theirs-one"), "--note", "seeded clearing"]), "bug cleared theirs-one");

  h.walks = W;
  h.ticket = ticket;
  h.at = Object.fromEntries(plan.runs.map((x) => [x.tag, x.at]));
  h.expect = {
    words: { active: 8, holding: 3, broken: 1, regressed: 2, cant_run: 1, not_run: 1 },
    night: { day: dayBack(1), ran: 4, held: 2, broken: 1, cannot_run: 1 },
  };
  return h;
}
