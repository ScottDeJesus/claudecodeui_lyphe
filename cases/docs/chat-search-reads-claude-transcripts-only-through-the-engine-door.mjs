// Chat search reads Claude transcripts only through the engine (rust-transcript-engine, interface 6): the search service
// keeps no Claude read loop and none of the search-only extraction helpers (extractClaudeSearchableMessage,
// extractClaudeText, extractTaggedContent, parseClaudeLocalCommandPayload, stripAnsiFormatting, isInternalContent,
// INTERNAL_CONTENT_PREFIXES); parseClaudeSessionMatches reads through run.forFile; the sibling
// session-conversations-engine.ts exports buildClaudeSearchJob and fileResultsFromRecord and logs its disagreement as a
// [transcript-engine] line; local-commands.ts exports TRANSPARENT_WRAPPER_COMMANDS; Codex still reads through ripgrep;
// no server file but the door names the engine binary; and no file of server/ or src/ spells the deleted extractor.
//
// protects: server/modules/providers/services/session-conversations-search.service.ts, server/modules/providers/services/session-conversations-engine.ts, server/shared/local-commands.ts
// writes: none

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SERVICE = "server/modules/providers/services/session-conversations-search.service.ts";
const SIBLING = "server/modules/providers/services/session-conversations-engine.ts";
const LOCAL = "server/shared/local-commands.ts";
const GONE = [
  ["extractClaudeSearchableMessage", /function extractClaudeSearchableMessage\b/], ["extractClaudeText", /function extractClaudeText\b/],
  ["extractTaggedContent", /function extractTaggedContent\b/], ["parseClaudeLocalCommandPayload", /function parseClaudeLocalCommandPayload\b/],
  ["stripAnsiFormatting", /function stripAnsiFormatting\b/], ["isInternalContent", /function isInternalContent\b/],
  ["INTERNAL_CONTENT_PREFIXES", /(?<![A-Z_])INTERNAL_CONTENT_PREFIXES\b/],
];

const readRepo = (relative) => fs.readFileSync(path.join(REPO, relative), "utf8");
const gitGrep = (pattern, ...where) => {
  const out = spawnSync("git", ["-C", REPO, "grep", "--untracked", "-l", "-e", pattern, "--", ...where], { encoding: "utf8" });
  return String(out.stdout || "").split("\n").filter(Boolean);
};

runCase(async () => {
  const wrong = [];
  const service = readRepo(SERVICE);
  const kept = GONE.filter(([, pattern]) => pattern.test(service)).map(([name]) => name);
  if (kept.length) wrong.push(SERVICE + " still holds " + kept.join(", "));
  const at = service.indexOf("async function parseClaudeSessionMatches(");
  if (at < 0) wrong.push(SERVICE + " has no parseClaudeSessionMatches");
  else {
    const rest = service.slice(at + 10);
    const next = rest.search(/\n(?:export )?(?:async )?function /);
    const body = next < 0 ? rest : rest.slice(0, next);
    if (!body.includes("forFile(")) wrong.push("parseClaudeSessionMatches does not read through run.forFile");
    if (/createReadStream|readline\.createInterface/.test(body)) wrong.push("parseClaudeSessionMatches still reads the transcript itself");
  }
  if (!/\brgPath\b/.test(service)) wrong.push(SERVICE + " no longer reaches ripgrep (Codex reads through it)");
  if (!fs.existsSync(path.join(REPO, SIBLING))) wrong.push(SIBLING + " is not on disk");
  else {
    const sibling = readRepo(SIBLING);
    for (const name of ["buildClaudeSearchJob", "fileResultsFromRecord"]) {
      if (!new RegExp("export (?:async )?(?:function|const) " + name + "\\b").test(sibling)) wrong.push(SIBLING + " exports no " + name);
    }
    if (!sibling.includes("[transcript-engine]")) wrong.push(SIBLING + " logs no [transcript-engine] line");
    if (!/openTranscriptSearch/.test(sibling + service)) wrong.push("neither the service nor its sibling calls openTranscriptSearch");
  }
  if (!/export const TRANSPARENT_WRAPPER_COMMANDS\b/.test(readRepo(LOCAL))) wrong.push(LOCAL + " does not export TRANSPARENT_WRAPPER_COMMANDS");
  const spellers = gitGrep("extractClaudeSearchableMessage", "server", "src");
  if (spellers.length) wrong.push("extractClaudeSearchableMessage is still spelled in " + spellers.join(", "));
  const binaryNamers = gitGrep("release/transcript-engine", "server").filter((file) => !file.startsWith("server/modules/transcript-engine/"));
  if (binaryNamers.length) wrong.push("the engine binary is named outside the door, in " + binaryNamers.join(", "));
  if (wrong.length) return broken(wrong.join("; "));
  return held("the service holds no Claude reader and reads through run.forFile, the sibling exports buildClaudeSearchJob and fileResultsFromRecord, TRANSPARENT_WRAPPER_COMMANDS is exported, ripgrep stays for Codex, and only the door names the binary");
});
