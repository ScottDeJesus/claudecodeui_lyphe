// protects: server/modules/dispatch-souls/dispatch-souls.module.ts, server/modules/dispatch-souls/launch-watch.service.ts, server/modules/kanban/kanban-spill.service.ts, server/modules/memory-intake/memory-spill.service.ts, server/modules/universe/universe.module.ts, server/modules/universe/universe-heads.watch.ts, server/modules/universe/universe-heads.service.ts, server/shared/directory-watch.service.ts, server/index.ts
// writes: none
//
// The running dev API is the joined code: its server process (a descendant of cloudcli-server-dev.service's main pid
// whose command runs server/index) holds an inotify watch on every directory the six chat-server sites read — the souls
// root, the chains root beside it, the cpu-wait folder, both spool queues, the universe registry's folder and every
// registered repo's HEAD folders. A wanted folder not on disk is judged at its nearest existing ancestor, the place a
// watch waits for it. Paths follow the server's own environment (/proc/<pid>/environ). The claude-updates job folder is
// not judged: its watch stands only while a job is out. Read only, from /proc and the registry file.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { broken, CannotRun, held, runCase } from "../lib/case.mjs";

const UNIT = "cloudcli-server-dev.service";
const expandHome = (p) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);

function mainPid() {
  const text = execFileSync("systemctl", ["show", UNIT, "-p", "MainPID", "--value"], { encoding: "utf8" }).trim();
  return /^[1-9][0-9]*$/.test(text) ? Number(text) : null;
}

/** The server process under the unit: the descendant whose command runs server/index. */
function findDevApi() {
  const root = mainPid();
  if (root === null) throw new CannotRun(UNIT + " has no main pid: the dev API is not serving");
  const children = new Map();
  for (const name of fs.readdirSync("/proc")) {
    if (!/^[0-9]+$/.test(name)) continue;
    try {
      const stat = fs.readFileSync("/proc/" + name + "/stat", "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(Number(name));
    } catch {}
  }
  const queue = [root];
  while (queue.length > 0) {
    const pid = queue.shift();
    let cmd = "";
    try { cmd = fs.readFileSync("/proc/" + pid + "/cmdline", "utf8").replace(/\0/g, " "); } catch {}
    if (/server\/index\.(ts|js|mjs)\b/.test(cmd)) return pid;
    queue.push(...(children.get(pid) ?? []));
  }
  throw new CannotRun(UNIT + " runs no server/index process under pid " + root + ": the dev API is between boots");
}

function envOf(pid) {
  const env = {};
  for (const line of fs.readFileSync("/proc/" + pid + "/environ", "utf8").split("\0")) {
    const at = line.indexOf("=");
    if (at > 0) env[line.slice(0, at)] = line.slice(at + 1);
  }
  return env;
}

/** Every (device, inode) the process's inotify instances watch, as "sdev:ino" in the kernel's hex. */
function watchedKeys(pid) {
  const keys = new Set();
  const dir = "/proc/" + pid + "/fdinfo";
  for (const fd of fs.readdirSync(dir)) {
    let text = "";
    try { text = fs.readFileSync(dir + "/" + fd, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      const m = /^inotify wd:\S+ ino:([0-9a-f]+) sdev:([0-9a-f]+)/.exec(line);
      if (m) keys.add(parseInt(m[2], 16).toString(16) + ":" + m[1]);
    }
  }
  return keys;
}

/** A stat's (device, inode) in the kernel's encoding: major << 20 | minor. */
function keyOf(dir) {
  const st = fs.statSync(dir, { bigint: true });
  const dev = Number(st.dev);
  const major = (dev >>> 8) & 0xfff;
  const minor = (dev & 0xff) | ((dev >>> 12) & 0xfff00);
  return ((major * 1048576) + minor).toString(16) + ":" + st.ino.toString(16);
}

function nearestExisting(dir) {
  let at = path.resolve(dir);
  while (!fs.existsSync(at) || !fs.statSync(at).isDirectory()) {
    const up = path.dirname(at);
    if (up === at) return at;
    at = up;
  }
  return at;
}

/** The folders one repo's HEAD is read from: the head dir, the ref's folder under it and under the ref dir, the ref dir. */
function headDirsOf(repoPath) {
  const dot = path.join(repoPath, ".git");
  let headDir = dot;
  if (fs.existsSync(dot) && fs.statSync(dot).isFile()) {
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dot, "utf8"));
    if (m) headDir = path.resolve(repoPath, m[1].trim());
  }
  let refDir = headDir;
  try { refDir = path.resolve(headDir, fs.readFileSync(path.join(headDir, "commondir"), "utf8").trim()); } catch {}
  const dirs = [headDir, refDir];
  try {
    const m = /^ref:\s*(\S+)/.exec(fs.readFileSync(path.join(headDir, "HEAD"), "utf8"));
    if (m) {
      dirs.push(path.dirname(path.join(headDir, m[1])));
      if (refDir !== headDir) dirs.push(path.dirname(path.join(refDir, m[1])));
    }
  } catch {}
  return [...new Set(dirs)];
}

runCase(async () => {
  const pid = findDevApi();
  const env = envOf(pid);
  const home = env.HOME || os.homedir();
  const souls = path.resolve(expandHome(env.DISPATCH_SOULS_STATE_DIR || path.join(home, ".claude/state/dispatch-souls")));
  const stateRoot = path.dirname(souls);
  const pacer = (env.PLAN_RUNNER_PACER_HOME ?? "").trim() ? path.resolve(expandHome(env.PLAN_RUNNER_PACER_HOME.trim())) : path.join(stateRoot, "pacer");
  const spill = expandHome(env.CLOUDCLI_SPILL_ROOT || path.join(home, ".cloudcli"));
  const universe = expandHome(env.UNIVERSE_STATE_DIR || path.join(home, ".claude/state/universe"));
  const wanted = [
    ["souls root", souls],
    ["chains root", path.join(stateRoot, "dispatch-chains")],
    ["cpu-wait folder", path.join(pacer, "cpu-wait")],
    ["lesson queue", path.join(spill, "pending-lessons")],
    ["memory queue", path.join(spill, "pending-memories")],
    ["universe registry folder", universe],
  ];
  let registry;
  try { registry = JSON.parse(fs.readFileSync(path.join(universe, "repos.json"), "utf8")); } catch (error) {
    throw new CannotRun("the universe registry would not read — " + String(error?.message ?? error).split("\n")[0]);
  }
  const repos = Array.isArray(registry) ? registry : (registry.repos ?? []);
  for (const repo of repos) {
    if (typeof repo?.path !== "string") continue;
    for (const dir of headDirsOf(expandHome(repo.path))) wanted.push(["HEAD folder of " + (repo.id ?? repo.path), dir]);
  }
  const keys = watchedKeys(pid);
  if (keys.size === 0) return broken("the dev API (pid " + pid + ") holds no inotify watch at all");
  const missing = [];
  for (const [label, dir] of wanted) {
    const at = nearestExisting(dir);
    if (!keys.has(keyOf(at))) missing.push(label + " " + at + (at === path.resolve(dir) ? "" : " (waiting for " + dir + ")"));
  }
  if (missing.length > 0) return broken("the dev API (pid " + pid + ") watches " + keys.size + " folders but not: " + missing.join("; "));
  return held("the dev API (pid " + pid + ") watches all " + wanted.length + " folders the sites read (" + repos.length + " registered repos) among its " + keys.size + " watches");
});
