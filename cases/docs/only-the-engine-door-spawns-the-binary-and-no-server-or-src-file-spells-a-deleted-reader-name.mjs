// The one door spawns the engine (rust-transcript-engine, phase 4: the join): of server/modules/transcript-engine/,
// engine-process.ts alone starts a process; no other file of server/ names TRANSCRIPT_ENGINE_BIN, the release binary's
// path or the door's engine-process module; no file of server/, src/ or scripts/ spells a reader the engine replaced
// (extractClaudeSearchableMessage, extractSessionTitle); no file of server/modules/providers/services/ spells the search
// service's deleted INTERNAL_CONTENT_PREFIXES or isInternalContent (the history reader's own three-prefix list in
// claude-sessions.provider.ts predates the plan and is not the search's); and the Claude indexer reads no
// transcript of its own (no readFile, createReadStream or readline in claude-session-synchronizer.provider.ts).
//
// protects: server/modules/transcript-engine/, server/modules/providers/list/claude/claude-session-synchronizer.provider.ts, server/modules/providers/services/session-conversations-search.service.ts, server/modules/providers/services/session-conversations-engine.ts
// writes: none

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOOR_DIR = "server/modules/transcript-engine/";
const SPAWNER = DOOR_DIR + "engine-process.ts";
const INDEXER = "server/modules/providers/list/claude/claude-session-synchronizer.provider.ts";
const DELETED = ["extractClaudeSearchableMessage", "extractSessionTitle"];
const SEARCH_DIR = "server/modules/providers/services/";
const SEARCH_ONLY = ["INTERNAL_CONTENT_PREFIXES", "isInternalContent"];
const STARTS_A_PROCESS = "\\b(spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\\(";
const NAMES_THE_ENGINE = "TRANSCRIPT_ENGINE_BIN|release/transcript-engine|engine-process";

/** The files under the given folders holding the pattern (git grep, untracked files included); exit 1 is no match. */
function gitGrep(wrong, args, ...folders) {
  const out = spawnSync("git", ["-C", REPO, "grep", "--untracked", "-l", ...args, "--", ...folders], { encoding: "utf8" });
  if (out.status !== 0 && out.status !== 1) wrong.push("git grep " + args.join(" ") + " failed: " + String(out.stderr || out.error || "").split("\n")[0]);
  return String(out.stdout || "").split("\n").filter(Boolean);
}

runCase(async () => {
  const wrong = [];
  const starters = gitGrep(wrong, ["-E", "-e", STARTS_A_PROCESS], DOOR_DIR);
  if (!starters.includes(SPAWNER)) wrong.push(SPAWNER + " starts no process");
  const others = starters.filter((file) => file !== SPAWNER);
  if (others.length) wrong.push("the door starts a process outside engine-process.ts, in " + others.join(", "));
  const namers = gitGrep(wrong, ["-E", "-e", NAMES_THE_ENGINE], "server").filter((file) => !file.startsWith(DOOR_DIR));
  if (namers.length) wrong.push("the engine is reached outside the door, in " + namers.join(", "));
  for (const name of DELETED) {
    const spellers = gitGrep(wrong, ["-w", "-e", name], "server", "src", "scripts");
    if (spellers.length) wrong.push(name + " is still spelled in " + spellers.join(", "));
  }
  for (const name of SEARCH_ONLY) {
    const spellers = gitGrep(wrong, ["-w", "-e", name], SEARCH_DIR);
    if (spellers.length) wrong.push(name + " is still spelled in " + spellers.join(", "));
  }
  let indexer = "";
  try {
    indexer = fs.readFileSync(path.join(REPO, INDEXER), "utf8");
  } catch (error) {
    wrong.push(INDEXER + " cannot be read (" + (error.code || error.message) + ")");
  }
  const ownRead = /\breadFile(Sync)?\b|createReadStream|\breadline\b/.exec(indexer);
  if (ownRead) wrong.push(INDEXER + " still reads a transcript itself (" + ownRead[0] + ")");
  if (wrong.length) return broken(wrong.join("; "));
  return held("engine-process.ts is the door's one spawner, no other server file reaches the engine, none of " + DELETED.join(", ") +
    " is spelled in server/, src/ or scripts/, none of " + SEARCH_ONLY.join(", ") + " in " + SEARCH_DIR + ", and the indexer reads no transcript itself");
});
