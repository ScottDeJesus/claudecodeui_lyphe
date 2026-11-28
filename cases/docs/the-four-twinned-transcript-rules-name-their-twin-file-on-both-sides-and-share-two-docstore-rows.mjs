// The four rules twinned between the TypeScript readers and the engine (rust-transcript-engine, interfaces 2 and 7):
// isClaudeTurnLookalike and isResumePlaceholderRow (server/shared/claude-transcript-rows.ts), stripTransparentWrapperPrefix
// and localCommandDisplayText (server/shared/local-commands.ts). Each TypeScript rule's comment names its twin's file,
// rust/transcript-engine/src/search/claude_row.rs; claude_row.rs names each TypeScript file at least twice (one twin
// comment per rule); and docstore govern names both MAN-8054 and the engine's manual row MAN-10329 for all three files,
// so whoever edits one side is shown the other.
//
// protects: server/shared/claude-transcript-rows.ts, server/shared/local-commands.ts, rust/transcript-engine/src/search/claude_row.rs
// writes: none

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOCSTORE = path.join(os.homedir(), ".claude/scripts/docstore");
const RUST = "rust/transcript-engine/src/search/claude_row.rs";
const TWINS = [
  ["server/shared/claude-transcript-rows.ts", ["isClaudeTurnLookalike", "isResumePlaceholderRow"]],
  ["server/shared/local-commands.ts", ["stripTransparentWrapperPrefix", "localCommandDisplayText"]],
];
const ROWS = ["MAN-8054", "MAN-10329"];

/** The lines between the previous declaration (or a closing brace) and the rule's export line. */
function commentAbove(source, name) {
  const lines = source.split("\n");
  const at = lines.findIndex((line) => line.startsWith("export function " + name + "("));
  if (at < 0) return null;
  let from = at - 1;
  while (from >= 0 && lines[from].trim() !== "}" && !/^(export |const |import |type )/.test(lines[from])) from -= 1;
  return lines.slice(from + 1, at).join("\n");
}

function governing(relative) {
  const out = spawnSync(DOCSTORE, ["govern", path.join(REPO, relative), "--touch", "write", "--limit", "200", "--text"], { encoding: "utf8", timeout: 60000 });
  if (out.error || out.status !== 0) return { why: "docstore govern " + relative + " exited " + (out.status ?? out.error?.code) };
  return { tokens: new Set(String(out.stdout).split("\n").map((line) => (/^((?:MAN|INV)-\d+)/.exec(line) || [])[1]).filter(Boolean)) };
}

runCase(async () => {
  const wrong = [];
  for (const [file, rules] of TWINS) {
    const source = fs.readFileSync(path.join(REPO, file), "utf8");
    for (const rule of rules) {
      const comment = commentAbove(source, rule);
      if (comment === null) wrong.push(file + " exports no " + rule);
      else if (!comment.includes("claude_row.rs")) wrong.push(rule + "'s comment in " + file + " does not name claude_row.rs");
    }
  }
  const rustPath = path.join(REPO, RUST);
  if (!fs.existsSync(rustPath)) wrong.push(RUST + " is not on disk");
  else {
    const rust = fs.readFileSync(rustPath, "utf8");
    for (const [file] of TWINS) {
      const name = path.basename(file);
      const count = rust.split(name).length - 1;
      if (count < 2) wrong.push(RUST + " names " + name + " " + count + " times, not once per twinned rule");
    }
  }
  const seen = [];
  for (const file of [TWINS[0][0], TWINS[1][0], RUST]) {
    const answer = governing(file);
    if (answer.why) { wrong.push(answer.why); continue; }
    const absent = ROWS.filter((token) => !answer.tokens.has(token));
    if (absent.length) wrong.push("docstore govern " + file + " does not name " + absent.join(" and "));
    seen.push(path.basename(file) + ": " + ROWS.filter((token) => answer.tokens.has(token)).join("+"));
  }
  if (wrong.length) return broken(wrong.join("; "));
  return held("each of the four TypeScript rules names claude_row.rs, claude_row.rs names both TypeScript files per rule, and govern names " + ROWS.join(" and ") + " for all three (" + seen.join(", ") + ")");
});
