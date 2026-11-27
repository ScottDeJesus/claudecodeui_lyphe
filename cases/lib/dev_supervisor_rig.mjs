// dev_supervisor_rig.mjs — the dev supervisor (deploy/dev-supervisor/) run whole, as a child process, over a stand-in API.
//
//   import { startRig } from "../lib/dev_supervisor_rig.mjs";
//   const rig = await startRig(t, { standIn: "beating" });   // or "failing", "lingering", "hanging"; options silenceMs (2000), stableMs (none), source (the repo's deploy/dev-supervisor)
//   const hit = await rig.waitFor(/serving pid (\d+)/, 15000, from);   // { index, match, at } of the first line from index from on, or null at the bound
//   rig.childPid("1234")   // that number only when it is a plain number above 1 whose parent is this supervisor, else null
//   rig.lines              // [{ at, text }]: everything the supervisor and its children printed
//   rig.tail(from)         // the last lines from index from on, joined, for a verdict
//   rig.silenced           // whether heal.mjs's SILENCE_MS = 45_000 was found and shortened
//
// The scratch repo holds a copy of every .mjs of source, node_modules/tsx linked to the repo's, an empty server/tsconfig.json and a
// stand-in server/index.ts: "beating" says READY at once and beats alive every 300 ms; "failing" dies before READY;
// "lingering" beats, asks for its own reboot 500 ms after a READY given no handover and takes 6 s to go on SIGTERM (a retiring server
// finishing a turn); "hanging" beats, then wedges its event loop for good 1 s after READY. One constant changes in the copy, heal.mjs's
// SILENCE_MS (to silenceMs), so a silence is judged in seconds, and a second when stableMs is given, STABLE_MS. Nothing of the live unit is touched.
// A cleanup deferred on t stops the supervisor through its own handle (SIGTERM, then SIGKILL after 15 s), then kills any stand-in
// still alive whose working directory is this scratch repo (a stopped one is sent SIGCONT first).

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CannotRun } from "./case.mjs";
import { scratchDir } from "./scratch.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STOP_BOUND_MS = 15000;

const STAND_INS = {
  beating: [
    "// A stand-in for server/index.ts: READY at once, then an alive beat every 300 ms; gone with the supervisor's channel.",
    "process.on('SIGTERM', () => process.exit(0));",
    "process.on('disconnect', () => process.exit(0));",
    "console.log('stand-in pid ' + process.pid + ' serving');",
    "process.send?.({ type: 'ready', pid: process.pid });",
    "setInterval(() => { if (process.connected) process.send?.({ type: 'alive' }); }, 300);",
    "",
  ].join("\n"),
  lingering: [
    "// A stand-in for server/index.ts: READY at once and a beat every 300 ms; a first boot asks for its own reboot, and SIGTERM takes 6 s.",
    "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 6000));",
    "process.on('disconnect', () => process.exit(0));",
    "console.log('stand-in pid ' + process.pid + ' serving');",
    "process.send?.({ type: 'ready', pid: process.pid });",
    "setInterval(() => { if (process.connected) process.send?.({ type: 'alive' }); }, 300);",
    "if (process.env.CLOUDCLI_HANDOVER !== '1') setTimeout(() => process.send?.({ type: 'reboot', reason: 'the rig asks for a handover' }), 500);",
    "",
  ].join("\n"),
  hanging: [
    "// A stand-in for server/index.ts: READY at once, a beat every 300 ms, then its event loop wedged for good 1 s after READY.",
    "console.log('stand-in pid ' + process.pid + ' serving');",
    "process.send?.({ type: 'ready', pid: process.pid });",
    "setInterval(() => { if (process.connected) process.send?.({ type: 'alive' }); }, 300);",
    "setTimeout(() => { for (;;) { /* wedged */ } }, 1000);",
    "",
  ].join("\n"),
  failing: [
    "// A stand-in for server/index.ts that dies before READY.",
    "console.error('Error: the stand-in refuses to boot');",
    "process.exit(1);",
    "",
  ].join("\n"),
};

const plainPid = (text) => (/^[1-9][0-9]*$/.test(String(text)) && Number(text) > 1 ? Number(text) : null);

function parentOf(pid) {
  try {
    const stat = fs.readFileSync("/proc/" + pid + "/stat", "utf8");
    return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
  } catch {
    return null;
  }
}

function cwdOf(pid) {
  try {
    return fs.readlinkSync("/proc/" + pid + "/cwd");
  } catch {
    return null;
  }
}

export async function startRig(t, { standIn, silenceMs = 2000, stableMs = null, source = path.join(REPO, "deploy", "dev-supervisor") } = {}) {
  if (!(standIn in STAND_INS)) throw new CannotRun("the rig has no stand-in named " + standIn);
  const tsx = path.join(REPO, "node_modules", "tsx");
  if (!fs.existsSync(path.join(tsx, "dist", "loader.mjs"))) throw new CannotRun("no tsx loader under " + tsx);
  if (!fs.existsSync(path.join(source, "supervisor.mjs"))) throw new CannotRun("no supervisor.mjs under " + source);
  const dir = fs.realpathSync(await scratchDir(t, "dev-supervisor-rig"));
  const own = path.join(dir, "deploy", "dev-supervisor");
  fs.mkdirSync(own, { recursive: true });
  fs.mkdirSync(path.join(dir, "server"), { recursive: true });
  fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  for (const name of fs.readdirSync(source)) if (name.endsWith(".mjs")) fs.copyFileSync(path.join(source, name), path.join(own, name));
  fs.symlinkSync(tsx, path.join(dir, "node_modules", "tsx"));
  fs.writeFileSync(path.join(dir, "server", "tsconfig.json"), "{}\n");
  fs.writeFileSync(path.join(dir, "server", "index.ts"), STAND_INS[standIn]);
  let silenced = false;
  const healFile = path.join(own, "heal.mjs");
  if (fs.existsSync(healFile)) {
    const text = fs.readFileSync(healFile, "utf8");
    const shortened = text.replace("export const SILENCE_MS = 45_000;", "export const SILENCE_MS = " + silenceMs + ";");
    silenced = shortened !== text;
    const stabled = stableMs === null ? shortened : shortened.replace("export const STABLE_MS = 60_000;", "export const STABLE_MS = " + stableMs + ";");
    if (stableMs !== null && stabled === shortened) throw new CannotRun("heal.mjs holds no STABLE_MS = 60_000 for the rig to shorten");
    fs.writeFileSync(healFile, stabled);
  }

  const env = { ...process.env };
  delete env.CLOUDCLI_HANDOVER;
  delete env.CLOUDCLI_SUPERVISED;
  const supervisor = spawn(process.execPath, [path.join(own, "supervisor.mjs")], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise((resolve) => supervisor.once("exit", resolve));
  const lines = [];
  const waiters = new Set();
  const seen = new Set();
  const push = (text) => {
    lines.push({ at: Date.now(), text });
    const boot = text.match(/\[supervisor\] boot: pid (\d+)/);
    if (boot && plainPid(boot[1]) !== null) seen.add(Number(boot[1]));
    for (const waiter of [...waiters]) waiter(lines.length - 1);
  };
  const feed = (stream) => {
    let carry = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      carry += chunk;
      const parts = carry.split("\n");
      carry = parts.pop() ?? "";
      for (const part of parts) if (part.trim()) push(part);
    });
  };
  feed(supervisor.stdout);
  feed(supervisor.stderr);

  t.defer(async () => {
    if (supervisor.exitCode === null && supervisor.signalCode === null) {
      supervisor.kill("SIGTERM");
      let timer;
      const bound = new Promise((resolve) => { timer = setTimeout(resolve, STOP_BOUND_MS); });
      await Promise.race([exited, bound]);
      clearTimeout(timer);
      if (supervisor.exitCode === null && supervisor.signalCode === null) {
        supervisor.kill("SIGKILL");
        await exited;
      }
    }
    for (const pid of seen) {
      const cwd = cwdOf(pid);
      if (plainPid(pid) === null || cwd === null || !cwd.startsWith(dir)) continue;
      try { process.kill(pid, "SIGCONT"); process.kill(pid, "SIGKILL"); } catch { /* gone between the look and the signal */ }
    }
  });

  function waitFor(pattern, ms, from = 0) {
    for (let i = from; i < lines.length; i++) {
      const match = lines[i].text.match(pattern);
      if (match) return Promise.resolve({ index: i, match, at: lines[i].at });
    }
    return new Promise((resolve) => {
      const check = (i) => {
        if (i < from) return;
        const match = lines[i].text.match(pattern);
        if (!match) return;
        clearTimeout(timer);
        waiters.delete(check);
        resolve({ index: i, match, at: lines[i].at });
      };
      const timer = setTimeout(() => { waiters.delete(check); resolve(null); }, ms);
      waiters.add(check);
    });
  }

  function childPid(text) {
    const pid = plainPid(text);
    if (pid === null || parentOf(pid) !== supervisor.pid) return null;
    seen.add(pid);
    return pid;
  }

  const tail = (from = 0) =>
    lines.slice(Math.max(from, lines.length - 8)).map((line) => line.text.trim()).join(" | ").slice(-700) || "(nothing printed)";

  return { lines, waitFor, childPid, tail, silenced, dir };
}
