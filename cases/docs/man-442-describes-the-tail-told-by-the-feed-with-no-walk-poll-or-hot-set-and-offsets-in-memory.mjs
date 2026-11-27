// protects: server/modules/universe/universe-transcript-tail.ts, server/modules/universe/universe-transcript.tap.ts
// writes: none
//
// MAN-442, the transcript tail's row, describes the tail that stands after the poll was removed (pollers-hooks--sessions-watcher,
// phase 3): it names the transcript feed and previousSize, keeps the offsets in memory and never on disk, and names no timed
// walk, no timed poll, no running hot set, no two-minute window, no deleted constant and not the poll's journal line. Every
// universe-transcript-tail.ts:<line> it cites lies inside the file. Read through the docstore verbs, never written.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TAIL = path.join(REPO, "server/modules/universe/universe-transcript-tail.ts");
const DOCSTORE = path.join(os.homedir(), ".claude/scripts/docstore");
const FORBIDDEN = [
  [/\b\d+\s?s walk\b/i, "a timed walk"],
  [/\b\d+\s?ms poll\b/i, "a timed poll"],
  [/\b(?:the|a)\s+(?:hot set|poll|walk)\b/i, "the poll, the walk or the hot set as a thing that runs"],
  [/two-minute window/i, "the hot set's window"],
  [/statting|four times a second/i, "the poll's stat beat"],
  [/poll read what the feed had not delivered/i, "the poll's journal line"],
  [/\b(?:DISCOVER_INTERVAL_MS|POLL_INTERVAL_MS|HOT_WINDOW_MS|MAX_WALK_DEPTH|FEED_MISS_AGE_MS|walkJsonl)\b/, "a deleted constant"],
];
const REQUIRED = [
  [/subscribeTranscriptFeed|transcript feed/i, "the transcript feed"],
  [/previousSize/, "previousSize"],
  [/never on disk/i, "offsets in memory and never on disk"],
];

runCase(async () => {
  const answer = spawnSync(DOCSTORE, ["get", "MAN-442", "--text"], { encoding: "utf8", timeout: 30000 });
  if (answer.error) return cannotRun("docstore would not run: " + String(answer.error.message ?? answer.error));
  if (answer.status !== 0) return broken("MAN-442 is retired or unknown (docstore get exit " + answer.status + ")");
  const faults = [];
  answer.stdout.split("\n").forEach((text, index) => {
    for (const [pattern, what] of FORBIDDEN) {
      const hit = pattern.exec(text);
      if (hit) faults.push("line " + (index + 1) + " names " + what + ": " + JSON.stringify(hit[0]));
    }
  });
  for (const [pattern, what] of REQUIRED) if (!pattern.test(answer.stdout)) faults.push("it does not name " + what);
  let lines = 0;
  try { lines = fs.readFileSync(TAIL, "utf8").split("\n").length; } catch { return broken("universe-transcript-tail.ts is not there"); }
  for (const cite of answer.stdout.matchAll(/universe-transcript-tail\.ts:(\d+)(?:-(\d+))?/g)) {
    const last = Number(cite[2] ?? cite[1]);
    if (last > lines) faults.push("it cites " + cite[0] + " past the file's " + lines + " lines");
  }
  if (faults.length) return broken("MAN-442: " + faults.slice(0, 8).join("; ").slice(0, 380));
  return held("MAN-442 names the feed, previousSize and in-memory offsets, no timed walk or poll, no hot set, no deleted constant or the poll's line, and cites only lines inside the tail");
});
