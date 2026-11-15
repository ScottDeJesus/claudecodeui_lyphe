// suite_helper.mjs — another suite's cases/lib/case.mjs, judged from outside that suite.
//
// Every suite on this box holds the kit's door as its cases/lib/case.mjs. Whether a suite's copy IS the door
// cannot be judged from inside a case of that suite, which ends by whatever its copy says. So a case of THIS
// suite writes a small script that imports the other suite's helper by its path, runs it as a child process,
// and reads what the child printed, how it exited, and what it held while it ran.
//
// Usage (cases/suites/<name>.mjs):
//   import { helperOf, repoOf, OWN_HELPER, KIT_DOOR, writeScript, runScript, startScript, runnerEnv, handEnv, describe } from "../lib/suite_helper.mjs";
//   const helper = await helperOf("eis-app");                       // <its repo>/cases/lib/case.mjs, as `cases suites` names the repo
//   const file = writeScript(dir, "ending.mjs", { header: ["// writes: none"], helper, source: `runCase(async () => held("x"));` });
//   const out = await runScript(file, { env: runnerEnv() });         // → { code, signal, stdout, stderr, last, timedOut }
//   const live = startScript(file, { env: runnerEnv() });  await live.saw("in-body");  live.say("go\n");  const out = await live.ended;
//
// CASE_SUITE_HELPER=<a file> judges that file in place of the suite's own helper. A case author uses it to
// see a case fail (the helper as it stood before it became the door). Never set in a runner.

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CannotRun, KIT } from "./case.mjs";

/** This suite's own helper: the door as the chat app's suite holds it. */
export const OWN_HELPER = fileURLToPath(new URL("./case.mjs", import.meta.url));
/** The kit's door, the bytes every suite's cases/lib/case.mjs is meant to be. */
export const KIT_DOOR = path.join(KIT, "node", "door.mjs");
/** The module URL of one of the kit's Node files (`case`, `http`, `scratch`). */
export const kitUrl = (name) => pathToFileURL(path.join(KIT, "node", `${name}.mjs`)).href;

const HANDED_ON = "{ runCase, held, broken, cannotRun, CannotRun }";
const SYSTEM_PATH = "/usr/bin:/bin"; // cron's PATH: no `cases` on it
const ASK_TIMEOUT_MS = 30000;
const RUN_TIMEOUT_MS = 30000;
const SAW_TIMEOUT_MS = 15000;

const firstLine = (error) => String(error?.message ?? error).split(/\r\n|\r|\n/)[0];

let asking = null;

/** What `cases suites --json` says, asked once per process. No answer is CANNOT RUN: nothing was judged. */
function suitesOnThisBox() {
  asking ??= new Promise((resolve, reject) => {
    execFile("cases", ["suites", "--json"], { timeout: ASK_TIMEOUT_MS, maxBuffer: 4 << 20 }, (error, stdout) => {
      if (error) return reject(new CannotRun(`cases suites did not answer — ${error.code ?? firstLine(error)}`));
      try {
        resolve(JSON.parse(stdout).suites);
      } catch (parseError) {
        if (!(parseError instanceof SyntaxError)) throw parseError;
        reject(new CannotRun("cases suites --json printed no JSON"));
      }
    });
  });
  return asking;
}

/** The repo of the suite named `name`. A box that holds no such suite is CANNOT RUN: there is nothing to judge. */
export async function repoOf(name) {
  const suite = (await suitesOnThisBox())?.find((one) => one.name === name);
  if (!suite) throw new CannotRun(`cases suites names no suite ${name} on this box`);
  return suite.repo;
}

/** The helper of the suite named `name`: `<its repo>/cases/lib/case.mjs` (or the file CASE_SUITE_HELPER names, see the header). */
export async function helperOf(name) {
  return process.env.CASE_SUITE_HELPER || path.join(await repoOf(name), "cases", "lib", "case.mjs");
}

/** Write `<dir>/<name>`: the header lines (a case's `// writes:` and `// lock:`), the five names from `helper`, then `source`. → the file's path. */
export function writeScript(dir, name, { header = ["// writes: none"], helper, source }) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, [...header, `import ${HANDED_ON} from ${JSON.stringify(pathToFileURL(helper).href)};`, source, ""].join("\n"));
  return file;
}

/** The environment the runner starts a case in, as far as a helper reads it: this process's PATH, and the kit by name. */
export const runnerEnv = (extra = {}) => ({ PATH: process.env.PATH ?? SYSTEM_PATH, HOME: os.homedir(), LANG: "C.UTF-8", CASES_KIT: KIT, ...extra });
/** A hand's shell: the same PATH (the house's scripts are on it, `cases` among them) and no CASES_KIT. */
export const handEnv = (extra = {}) => ({ PATH: process.env.PATH ?? SYSTEM_PATH, HOME: os.homedir(), LANG: "C.UTF-8", ...extra });
/** Cron's own environment: a PATH with no `cases` on it, and no CASES_KIT. */
export const bareEnv = (extra = {}) => ({ PATH: SYSTEM_PATH, HOME: os.homedir(), LANG: "C.UTF-8", ...extra });

const lastLine = (stdout) => stdout.trimEnd().split("\n").pop() ?? "";

/** Run a script to its end. → { code, signal, stdout, stderr, last (its last stdout line), timedOut }. */
export function runScript(file, { env, cwd = os.tmpdir(), timeoutMs = RUN_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [file], { env, cwd, timeout: timeoutMs, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
      resolve({
        code: error ? (typeof error.code === "number" ? error.code : null) : 0,
        signal: error?.signal ?? null,
        stdout,
        stderr,
        last: lastLine(stdout),
        timedOut: Boolean(error?.killed),
      });
    });
  });
}

/**
 * Start a script and keep it: `saw(text)` is true once its stderr has shown `text` (false when it ended or
 * `waitMs` passed first), `say(text)` writes to its stdin, `ended` is what `runScript` answers. A script
 * still running after RUN_TIMEOUT_MS is stopped, so a case never leaves one behind.
 */
export function startScript(file, { env, cwd = os.tmpdir() } = {}) {
  const child = spawn(process.execPath, [file], { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const waiting = new Set();
  const recheck = () => waiting.forEach((check) => check());
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    recheck();
  });
  child.stdin.on("error", () => {}); // a script that ended before it was told to: `ended` says how
  const stop = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, RUN_TIMEOUT_MS);
  let isOver = false;
  const ended = new Promise((resolve) => {
    child.on("close", (code, signal) => {
      clearTimeout(stop);
      isOver = true;
      recheck();
      resolve({ code, signal, stdout, stderr, last: lastLine(stdout), timedOut });
    });
  });
  return {
    ended,
    say: (text) => void child.stdin.write(text),
    saw: (text, waitMs = SAW_TIMEOUT_MS) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => finish(false), waitMs);
        const finish = (answer) => {
          clearTimeout(timer);
          waiting.delete(check);
          resolve(answer);
        };
        const check = () => {
          if (stderr.includes(text)) finish(true);
          else if (isOver) finish(false);
        };
        waiting.add(check);
        check();
      }),
  };
}

/** How a script ended, in a few words, for a saw. */
export function describe(out) {
  const how = out.timedOut ? "was stopped after the wait ran out" : out.signal ? `died of ${out.signal}` : `exited ${out.code}`;
  const said = out.last ? `its last stdout line: ${out.last.slice(0, 160)}` : `no stdout; stderr: ${out.stderr.trim().split("\n").pop()?.slice(0, 160) || "(nothing)"}`;
  return `${how}, ${said}`;
}
