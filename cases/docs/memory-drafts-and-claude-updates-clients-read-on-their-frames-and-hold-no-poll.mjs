// The three client readers of the server's own writes are told, not on a clock: the memory-intake context
// reads on memory_changed, the Claude-updates hook on claude_updates_changed, the composer's queued-draft
// card on drafts_changed through its sibling hook; none of the three keeps the poll it replaced.
//
// protects: src/modules/memory-intake/context/MemoryIntakeContext.tsx, src/modules/claude-updates/hooks/useClaudeUpdates.ts, src/modules/chat/hooks/useChatComposerState.ts, src/modules/chat/hooks/useDraftsChangedFrame.ts
// writes: none

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const READERS = [
  { file: "src/modules/memory-intake/context/MemoryIntakeContext.tsx",
    must: [/useServerFrame\(/, /['"]memory_changed['"]/], mustNot: [/MEMORY_POLL_MS/, /setInterval\(/] },
  { file: "src/modules/claude-updates/hooks/useClaudeUpdates.ts",
    must: [/useServerFrame\(/, /['"]claude_updates_changed['"]/], mustNot: [/POLL_MS/, /setInterval\(/, /setTimeout\(/] },
  { file: "src/modules/chat/hooks/useChatComposerState.ts",
    must: [/useDraftsChangedFrame\(/], mustNot: [/setInterval\([^;]*reconcile/] },
  { file: "src/modules/chat/hooks/useDraftsChangedFrame.ts",
    must: [/useServerFrame\(/, /['"]drafts_changed['"]/], mustNot: [] },
];

runCase(async () => {
  const faults = [];
  for (const reader of READERS) {
    let text;
    try {
      text = fs.readFileSync(path.join(REPO, reader.file), "utf8");
    } catch (error) {
      return cannotRun(reader.file + " could not be read: " + String(error));
    }
    const name = path.basename(reader.file);
    for (const pattern of reader.must) if (!pattern.test(text)) faults.push(name + " lacks " + pattern.source);
    for (const pattern of reader.mustNot) {
      const line = text.split("\n").findIndex((row) => pattern.test(row));
      if (line >= 0) faults.push(name + ":" + (line + 1) + " still holds " + pattern.source);
    }
  }
  if (faults.length > 0) return broken(faults.join("; "));
  return held("memory, claude-updates and the queued-draft card each read on their frame and none holds its poll");
});
