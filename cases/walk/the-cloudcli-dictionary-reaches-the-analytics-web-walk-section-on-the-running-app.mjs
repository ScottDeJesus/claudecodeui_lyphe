// protects: walk/screens.toml, walk/app.mjs, src/modules/analytics/sections/registry.ts, src/modules/analytics/sections/web-walk/WebWalkSection.tsx
// writes: none
//
// The section is a screen of CloudCLI's walk dictionary: ~/.claude/scripts/web-walk screens cloudcli lists
// analytics-web-walk, and web-walk reach cloudcli analytics-web-walk opens it on the running dev app and answers it
// reached, its landmark seen. reach tells nothing (no uses line, no outbox), and every picture and report it writes is
// put under this case's scratch folder, removed at the end.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const WEB = path.join(os.homedir(), ".claude", "scripts", "web-walk");
const SCREEN = "analytics-web-walk";
const SCRATCH_PREFIX = "case-web-walk-reach-";

function run(args, env, timeout) {
  return new Promise((resolve) => {
    execFile(WEB, args, { cwd: os.homedir(), env, timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === "number" ? error.code : String(error.code)) : 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

const firstLine = (s) => String(s || "").trim().split("\n")[0].slice(0, 240);

runCase(async () => {
  const out = mkdtempSync(path.join(os.tmpdir(), SCRATCH_PREFIX));
  try {
    const env = { ...process.env, WEB_WALK_OUT: out };
    const listed = await run(["screens", "cloudcli"], env, 30000);
    if (listed.code === "ENOENT") return cannotRun("the web-walk command is not at " + WEB);
    if (listed.code !== 0) return broken("web-walk screens cloudcli exited " + listed.code + ": " + firstLine(listed.stderr || listed.stdout));
    const entry = listed.stdout.split("\n").find((l) => l.trim().split(/\s+/)[0] === SCREEN || new RegExp("(^|\\s)" + SCREEN + "(\\s|:|$)").test(l));
    if (!entry) return broken("the cloudcli dictionary lists no " + SCREEN + " (" + listed.stdout.split("\n").filter((l) => l.includes("analytics")).length + " analytics lines)");
    const reached = await run(["reach", "cloudcli", SCREEN], env, 110000);
    const said = (reached.stdout + "\n" + reached.stderr).split("\n").filter((l) => l.includes(SCREEN));
    if (!said.length) {
      const all = (reached.stdout + " " + reached.stderr).trim();
      if (/app-down|ECONNREFUSED|not answering/i.test(all)) return cannotRun("the dev app is not up for reach: " + all.slice(-240));
      return broken("reach printed no line for " + SCREEN + " (exit " + reached.code + "): " + all.slice(-240));
    }
    const line = said[0].trim();
    if (/\bnot\b|unreached|fail/i.test(line) || !/reached/i.test(line)) {
      if (/app-down|sign-in/i.test(line)) return cannotRun("the dev app could not be opened: " + line.slice(0, 240));
      return broken("reach: " + line.slice(0, 300));
    }
    return held("the dictionary lists " + SCREEN + " and reach answered: " + line.slice(0, 200));
  } finally {
    if (path.basename(out).startsWith(SCRATCH_PREFIX)) rmSync(out, { recursive: true, force: true });
  }
});
