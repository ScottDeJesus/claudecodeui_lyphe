// protects: server/modules/providers/list/claude/chat-process.ts
// writes: none
//
// A chat keeps its mode until its next compaction, so the launch profile records codeMode and planLiveChanges never replaces a
// process over it: a Code Mode process whose next message could not ask the house (and so resolved off, with the
// chat's real MCP map and no mcp__cm__search) keeps running in Code Mode, and the reverse holds too. A chat that is
// not in Code Mode plans exactly as today (INV-8471): a changed MCP map respawns, a tool-set difference is a live
// change. A profile recorded before the field existed reads as not in Code Mode.
//
// Pure: launchProfileOf and planLiveChanges on plain options.

import { broken, held, runCase } from "../lib/case.mjs";

const CHAT_PROCESS = "../../server/modules/providers/list/claude/chat-process.ts";

const base = (mcpServers: Record<string, unknown>, allowedTools: string[]) => ({
  cwd: "/tmp/case-chat",
  mcpServers,
  permissionMode: "default",
  model: "opus",
  allowedTools,
  disallowedTools: [],
});
const OWN = { mine: { command: "my-own-server", args: [] } };
const CM = { cm: { command: "/usr/bin/node", args: ["/x/server.mjs", "--config", "/x/server.json"] } };

runCase(async () => {
  let launchProfileOf: any;
  let planLiveChanges: any;
  try {
    ({ launchProfileOf, planLiveChanges } = await import(CHAT_PROCESS));
  } catch (error) {
    return broken(`chat-process.ts will not load: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
  }
  const profile = (options: any, toolsets: string | null, codeMode: boolean) =>
    launchProfileOf(options, false, false, null, toolsets, null, null, codeMode);
  const turn = { resumeFromScratch: false };
  const wrong: string[] = [];

  const cmLive = profile(base(CM, ["Read", "mcp__cm__search"]), "", true);
  const offLive = profile(base(OWN, ["Read"]), "", false);
  if (cmLive.codeMode !== true) wrong.push(`launchProfileOf(..., codeMode true) recorded codeMode ${JSON.stringify(cmLive.codeMode)}`);
  if (offLive.codeMode !== false) wrong.push(`launchProfileOf(..., codeMode false) recorded codeMode ${JSON.stringify(offLive.codeMode)}`);
  const defaulted = launchProfileOf(base(OWN, ["Read"]));
  if (defaulted.codeMode !== false) wrong.push(`a profile made without the argument recorded codeMode ${JSON.stringify(defaulted.codeMode)}`);

  const pairs: Array<[string, any, any]> = [
    ["a Code Mode process whose next message resolved off", cmLive, profile(base(OWN, ["Read"]), null, false)],
    ["a process born off whose next message resolved Code Mode", offLive, profile(base(CM, ["Read", "mcp__cm__search"]), null, true)],
    ["a Code Mode process whose next message is Code Mode again", cmLive, profile(base(CM, ["Read", "mcp__cm__search"]), null, true)],
  ];
  for (const [label, live, next] of pairs) {
    const plan = planLiveChanges(live, next, turn);
    if (plan.respawn) wrong.push(`${label} was replaced: "${plan.respawn}"`);
  }

  const { codeMode: _dropped, ...oldShape } = offLive;
  const oldPlan = planLiveChanges(oldShape, profile(base(OWN, ["Read"]), "", false), turn);
  if (oldPlan.respawn) wrong.push(`a profile recorded before codeMode existed was replaced against an off message: "${oldPlan.respawn}"`);

  const mcpChanged = planLiveChanges(offLive, profile(base({ ...OWN, added: { command: "new" } }, ["Read"]), "", false), turn);
  if (mcpChanged.respawn !== "the MCP server configuration changed") wrong.push(`an off chat whose MCP map changed planned ${JSON.stringify(mcpChanged)}, not today's respawn`);
  const removed = planLiveChanges(profile(base(OWN, ["Read", "Grep"]), "", false), profile(base(OWN, ["Read"]), "", false), turn);
  if (removed.respawn !== "a tool was removed from the allowed list") wrong.push(`an off chat that lost an allowed tool planned ${JSON.stringify(removed.respawn)}`);
  const setSwitched = planLiveChanges(offLive, profile(base(OWN, ["Read"]), "abc123", false), turn);
  if (setSwitched.respawn || setSwitched.changes?.toolsets !== true) wrong.push(`an off chat whose tool sets changed planned ${JSON.stringify(setSwitched)}, not a live sync`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("codeMode is recorded (off by default) and replaced no process in either direction; an off chat still respawns for a changed MCP map or a removed tool and syncs a tool-set change live");
});
