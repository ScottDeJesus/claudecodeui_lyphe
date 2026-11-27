// protects: src, /home/lyphe/.claude/ArchPulse/src, server/modules/providers/services/session-subagent-runs.service.ts
// writes: none
//
// THE WHOLE IS TOLD, NOT TICKED (pollers-hooks--client-pushes, seam 16). Every reader the plan converted lost the
// constant that named its interval. This reads both client trees whole, CloudCLI's src and ArchPulse's src, and fails
// on any source file that names one of the thirteen retired constants again, and on the subagent-runs service if the
// doc above ANSWER_TTL_MS says its endpoint is polled by every open tab. A reading of the files as they stand.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TREES = [
  { name: "CloudCLI src", dir: path.join(REPO, "src"),
    names: ["JEV_POLL_MS", "DEEPSEEK_USAGE_POLL_MS", "HEAL_POLL_MS", "MEMORY_POLL_MS", "ACCOUNTS_POLL_MS", "TRANSCRIPT_POLL_MS", "CLOCK_READ_MS", "BUSY_POLL_MS"] },
  { name: "ArchPulse src", dir: "/home/lyphe/.claude/ArchPulse/src",
    names: ["LIVE_POLL_MS", "LIST_IDLE_MS", "DOCSPACE_POLL_MS", "VERSION_POLL_MS", "PENDING_POLL_MS"] },
];
const SUBAGENT_RUNS = path.join(REPO, "server/modules/providers/services/session-subagent-runs.service.ts");
const POLLED_SENTENCE = /polled by every open tab|every open tab polls/i;
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const SKIP = new Set(["node_modules", "dist", ".git"]);

function sources(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, found);
    else if (SOURCE.test(entry.name)) found.push(full);
  }
  return found;
}

runCase(async () => {
  const faults = [];
  let read = 0;
  for (const tree of TREES) {
    if (!fs.existsSync(tree.dir)) return cannotRun(tree.name + " is not on disk at " + tree.dir);
    const pattern = new RegExp("\\b(?:" + tree.names.join("|") + ")\\b");
    for (const file of sources(tree.dir)) {
      read += 1;
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        const hit = pattern.exec(line);
        if (hit) faults.push(tree.name + "/" + path.relative(tree.dir, file) + ":" + (index + 1) + " names " + hit[0]);
      });
    }
  }
  let runs;
  try {
    runs = fs.readFileSync(SUBAGENT_RUNS, "utf8");
  } catch (error) {
    return cannotRun("the subagent-runs service could not be read: " + String(error));
  }
  if (POLLED_SENTENCE.test(runs)) faults.push("session-subagent-runs.service.ts still says its endpoint is polled by every open tab");
  if (faults.length > 0) return broken(faults.slice(0, 12).join("; ") + (faults.length > 12 ? " (+" + (faults.length - 12) + " more)" : ""));
  return held(read + " source files under the two trees name none of the thirteen retired poll constants, and the subagent-runs doc says no tab polls it");
});
