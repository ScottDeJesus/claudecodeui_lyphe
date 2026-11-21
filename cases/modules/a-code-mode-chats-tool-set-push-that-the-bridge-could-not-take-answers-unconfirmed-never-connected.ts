// protects: server/modules/code-mode/code-mode.service.ts, server/modules/providers/list/claude/claude-code-mode-seams.ts, server/modules/providers/list/claude/claude-toolset-seams.ts
// writes: none
//
// In a Code Mode chat a tool-set switch reaches the chat only through the bridge: the module's serversChanged runs
// `code-mode config --chat <id> --servers`, which rewrites the chat's server.json. The switch's answer is the sync's
// outcome, and `confirmed: true` is what lets it read connected. A rewrite that failed (no server.json, the verb exits
// 2, a timeout) must therefore come back unconfirmed with its reason: a hook that swallows the failure and resolves
// makes the sync count the set as added, and the operator sees a tool set connected that the chat will never find.
//
// The chat id is a fresh UUID this case made up, so the house holds no server.json for it and the verb refuses before
// it writes anything. Nothing else is touched: no database, no flag. No model, no Gemini.

import { randomUUID } from "node:crypto";

import { broken, held, runCase } from "../lib/case.mjs";

type Outcome = { live: boolean; confirmed: boolean; reason?: string; added?: string[] };
type Sync = { push(servers: Record<string, unknown>, boundMs: number): Promise<Outcome> };

runCase(async () => {
  let sync: Sync;
  try {
    const { codeModeService } = await import("../../server/modules/code-mode/code-mode.service.ts");
    const { createCodeModeServerSync } = await import("../../server/modules/providers/list/claude/claude-code-mode-seams.ts");
    sync = createCodeModeServerSync({ context: { codeMode: codeModeService }, appSessionId: randomUUID(), baseServers: {}, initialSetNames: [] }) as Sync;
  } catch (error) {
    return broken(`the code-mode module or the runtime's seam will not load: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
  }
  const outcome = await sync.push({ "case-set": { command: "true", args: [] } }, 30_000);
  if (outcome.confirmed !== false) {
    return broken(`a push the bridge could not take answered confirmed ${String(outcome.confirmed)}${outcome.added ? ` with ${JSON.stringify(outcome.added)} counted as added` : ""}: the switch would read connected`);
  }
  if (!outcome.reason) return broken("a push the bridge could not take answered unconfirmed with no reason");
  return held(`a push the bridge could not take answered unconfirmed: ${outcome.reason.slice(0, 160)}`);
});
