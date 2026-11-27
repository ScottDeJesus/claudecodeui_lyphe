// protects: scripts/prod-client-build.sh
// writes: none
//
// prod-client-build.sh --inputs prints the names in its INPUTS array, one per line and in order, and exits 0 before it
// takes the build lock: a copy in a scratch repo answers so while another process holds that repo's .prod-client/.lock,
// and starts no build.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const SCRIPT = new URL("../../scripts/prod-client-build.sh", import.meta.url).pathname;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t) => {
  const source = fs.readFileSync(SCRIPT, "utf8");
  const declared = /^INPUTS=\(([^)]*)\)/m.exec(source);
  if (!declared) return broken("scripts/prod-client-build.sh declares no INPUTS=( … ) array");
  const expected = declared[1].split(/\s+/).filter(Boolean);
  const repo = await scratchDir(t, "prod-build-inputs");
  fs.mkdirSync(path.join(repo, "scripts"));
  fs.mkdirSync(path.join(repo, ".prod-client", "builds"), { recursive: true });
  const copy = path.join(repo, "scripts", "prod-client-build.sh");
  fs.writeFileSync(copy, source, { mode: 0o755 });
  const lock = path.join(repo, ".prod-client", ".lock");
  const holder = spawn("bash", ["-c", "exec 9>\"$1\"; flock 9; exec sleep 30", "holder", lock], { stdio: "ignore" });
  try {
    let heldLock = false;
    for (let i = 0; i < 30 && !heldLock; i += 1) {
      await sleep(100);
      heldLock = spawnSync("flock", ["-n", lock, "true"]).status === 1;
    }
    if (!heldLock) return cannotRun("the stand-in holder never took " + lock);
    const run = spawnSync(copy, ["--inputs"], { cwd: repo, encoding: "utf8", timeout: 15000 });
    const printed = (run.stdout || "").split("\n").filter((line) => line !== "");
    if (run.status !== 0) return broken("--inputs with the lock held exited " + run.status + " printing " + JSON.stringify(printed.slice(0, 3)));
    if (printed.join(" ") !== expected.join(" ")) return broken("--inputs with the lock held printed " + JSON.stringify(printed.slice(0, 4)) + ", not the " + expected.length + " INPUTS " + JSON.stringify(expected.slice(0, 3)) + "…");
    const builds = fs.readdirSync(path.join(repo, ".prod-client", "builds"));
    if (builds.length) return broken("--inputs left a build directory: " + builds[0]);
    return held("--inputs with the lock held printed the " + expected.length + " INPUTS one per line and exited 0");
  } finally {
    holder.kill();
  }
});
