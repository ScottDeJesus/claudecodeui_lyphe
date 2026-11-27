// protects: server/modules/universe/universe-transcript-tail.ts, server/modules/universe/universe-transcript.tap.ts
// writes: none
//
// POLL REMOVED (pollers-hooks--sessions-watcher, phase 3). The universe transcript tail is told by the transcript feed and by
// nothing else. Its code arms no interval or timeout, walks no directory, takes no stat of its own and names none of the walk's
// and the poll's parts or the poll's journal line, while it still subscribes through its dependencies. Healed means deleted: no
// comment of the tail or of the tap describes a walk, a poll, a hot set or the 400 ms beat, and no other file of
// server/modules/universe names a retired constant. A reading of the source as it stands, never a write.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TAIL = path.join(REPO, "server/modules/universe/universe-transcript-tail.ts");
const TAP = path.join(REPO, "server/modules/universe/universe-transcript.tap.ts");
const UNIVERSE = path.join(REPO, "server/modules/universe");

const RETIRED_CODE = /\b(?:setInterval|setTimeout|clearInterval|clearTimeout|readdir|readdirSync|opendir|DISCOVER_INTERVAL_MS|POLL_INTERVAL_MS|HOT_WINDOW_MS|MAX_WALK_DEPTH|FEED_MISS_AGE_MS|walkJsonl|discover|poll|seeded|hot|discoverTimer|pollTimer|discovering|polling)\b/g;
const OWN_STAT = /\b(?:stat|lstat|fstat|statSync|lstatSync|fstatSync)\s*\(/g;
const RETIRED_ANYWHERE = /\b(?:DISCOVER_INTERVAL_MS|HOT_WINDOW_MS|MAX_WALK_DEPTH|FEED_MISS_AGE_MS|walkJsonl)\b|the poll read what the feed had not delivered/g;
const POLL_WORDS = /\b(?:walk(?:s|ed|ing)?|poll(?:s|ed|ing)?|hot set|discover(?:y|ed|s|ing)?)\b|\b400\s?ms\b/gi;
const QUOTES = new Set(["'", '"', "\x60"]);

/** The source cut into its code (strings kept) and its comments, so a word is judged where it stands. */
function split(source) {
  let code = "";
  let comments = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (c === "/" && n === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      comments += source.slice(i, stop) + "\n";
      i = stop;
    } else if (c === "/" && n === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      comments += source.slice(i, stop) + "\n";
      code += " ";
      i = stop;
    } else if (QUOTES.has(c)) {
      let j = i + 1;
      while (j < source.length && source[j] !== c) j += source[j] === "\\" ? 2 : 1;
      code += source.slice(i, j + 1);
      i = j + 1;
    } else {
      code += c;
      i += 1;
    }
  }
  return { code, comments };
}

const uniq = (matches) => [...new Set(matches.map((m) => m[0]))];

runCase(async () => {
  let tail;
  let tap;
  try { tail = fs.readFileSync(TAIL, "utf8"); } catch { return broken("server/modules/universe/universe-transcript-tail.ts is not there"); }
  try { tap = fs.readFileSync(TAP, "utf8"); } catch { return broken("server/modules/universe/universe-transcript.tap.ts is not there"); }
  const wrong = [];
  const cut = split(tail);
  const code = uniq([...cut.code.matchAll(RETIRED_CODE)]);
  if (code.length) wrong.push("the tail's code still names " + code.join(", "));
  const stats = uniq([...cut.code.matchAll(OWN_STAT)]);
  if (stats.length) wrong.push("the tail takes a stat of its own: " + stats.join(", "));
  if (!/\.subscribe\s*\(/.test(cut.code)) wrong.push("the tail no longer subscribes through its dependencies");
  for (const [name, source] of [["tail", cut], ["tap", split(tap)]]) {
    const words = uniq([...source.comments.matchAll(POLL_WORDS)]);
    if (words.length) wrong.push("a comment of the " + name + " still says " + words.map((w) => JSON.stringify(w)).join(", "));
  }
  for (const entry of fs.readdirSync(UNIVERSE, { recursive: true })) {
    const file = path.join(UNIVERSE, String(entry));
    if (file === TAIL || !/\.(?:ts|js|mjs|md)$/.test(file) || !fs.statSync(file).isFile()) continue;
    const found = uniq([...fs.readFileSync(file, "utf8").matchAll(RETIRED_ANYWHERE)]);
    if (found.length) wrong.push(path.relative(REPO, file) + " names " + found.join(", "));
  }
  if (wrong.length) return broken(wrong.join("; ").slice(0, 390));
  return held("the tail arms no timer, walks nothing, takes no stat, names no part of the walk or poll and still subscribes; no comment of tail or tap names a walk, poll, hot set or 400 ms; server/modules/universe names no retired constant");
});
