// protects: server/modules/providers/list/claude/claude-toolset-seams.ts, server/modules/providers/list/claude/claude-code-mode-seams.ts
// writes: none
//
// INV-8471 as this plan corrects it: a set's servers reach a chat that is NOT in Code Mode through
// Query.setMcpServers and nothing else, and reach a Code Mode chat through its bridge (context.codeMode.serversChanged,
// which rewrites the chat's server.json) and never through setMcpServers, whose only launch server is `cm`. Either
// way the switch answers live, with no process replaced. A bridge that fails answers unconfirmed, never a throw.
//
// The sync is driven with stubs on both sides: a toolsets hook answering one on-set's server, a query that records
// every setMcpServers call, and a codeMode hook that records every serversChanged call. Nothing reaches a CLI.

import { broken, held, runCase } from "../lib/case.mjs";

const TOOLSETS = "../../server/modules/providers/list/claude/claude-toolset-seams.ts";
const CODE_MODE = "../../server/modules/providers/list/claude/claude-code-mode-seams.ts";

const SET_SERVER = { command: "set-server", args: ["--x"] };
const BASE_SERVER = { command: "my-own-server", args: [] };

runCase(async () => {
  let createToolsetSync: any;
  let createCodeModeServerSync: any;
  try {
    createToolsetSync = (await import(TOOLSETS)).createToolsetSync;
    createCodeModeServerSync = (await import(CODE_MODE)).createCodeModeServerSync;
  } catch (error) {
    return broken(`a seam will not load: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
  }
  if (typeof createToolsetSync !== "function") return broken("claude-toolset-seams.ts exports no createToolsetSync");
  if (typeof createCodeModeServerSync !== "function") return broken("claude-code-mode-seams.ts exports no createCodeModeServerSync: a Code Mode chat's switch has no path to its bridge");

  const toolsets = { launchFor: async () => ({ env: {}, servers: { "set-one": structuredClone(SET_SERVER) }, promptLine: null }) };
  const run = async (codeModeOn: boolean, serversChanged: (input: any) => Promise<void>) => {
    const setMcpCalls: unknown[] = [];
    const changedCalls: any[] = [];
    const codeMode = { launchFor: async () => ({ on: false }), serversChanged: async (input: any) => { changedCalls.push(structuredClone(input)); return serversChanged(input); } };
    const bridge = codeModeOn
      ? createCodeModeServerSync({ context: { codeMode }, appSessionId: "case-chat", baseServers: { mine: structuredClone(BASE_SERVER) }, initialSetNames: [] })
      : null;
    const sync = createToolsetSync({
      getQuery: () => ({ setMcpServers: async (map: unknown) => { setMcpCalls.push(structuredClone(map)); return { added: Object.keys(map as object), removed: [], errors: {} }; } }),
      isClosing: () => false,
      context: { toolsets, codeMode },
      appSessionId: "case-chat",
      onNode: false,
      setApplied: () => {},
      baseServerNames: () => (codeModeOn ? ["cm"] : ["mine"]),
      codeModeSync: () => bridge,
    });
    let outcome: any;
    try {
      outcome = await sync.sync(3000);
    } catch (error) {
      outcome = { threw: String((error as Error)?.message ?? error) };
    }
    return { outcome, setMcpCalls, changedCalls };
  };

  const wrong: string[] = [];

  const cm = await run(true, async () => {});
  if (cm.setMcpCalls.length !== 0) wrong.push(`in Code Mode setMcpServers was called ${cm.setMcpCalls.length} time(s): ${JSON.stringify(cm.setMcpCalls)}`);
  if (cm.changedCalls.length !== 1) {
    wrong.push(`in Code Mode serversChanged was called ${cm.changedCalls.length} time(s), not once`);
  } else {
    const { appSessionId, servers } = cm.changedCalls[0];
    if (appSessionId !== "case-chat") wrong.push(`serversChanged named chat ${JSON.stringify(appSessionId)}`);
    if (JSON.stringify(servers?.["set-one"]) !== JSON.stringify(SET_SERVER)) wrong.push(`the bridge was not handed the on-set's server: ${JSON.stringify(servers)}`);
    if (JSON.stringify(servers?.mine) !== JSON.stringify(BASE_SERVER)) wrong.push(`the bridge was not handed the chat's own server: ${JSON.stringify(servers)}`);
  }
  if (cm.outcome?.live !== true || cm.outcome?.confirmed !== true) wrong.push(`a Code Mode switch answered ${JSON.stringify(cm.outcome)}, not live and confirmed`);

  const failing = await run(true, async () => { throw new Error("verb exited 2"); });
  if ("threw" in (failing.outcome ?? {})) wrong.push(`a failing bridge made the sync throw: ${failing.outcome.threw}`);
  else if (failing.outcome?.confirmed !== false) wrong.push(`a failing bridge answered ${JSON.stringify(failing.outcome)}, not unconfirmed`);
  if (failing.setMcpCalls.length !== 0) wrong.push("a failing bridge fell back to setMcpServers");

  const today = await run(false, async () => {});
  if (today.changedCalls.length !== 0) wrong.push(`without Code Mode serversChanged was called ${today.changedCalls.length} time(s)`);
  const last = today.setMcpCalls.at(-1) as Record<string, unknown> | undefined;
  if (!last) wrong.push("without Code Mode setMcpServers was never called: today's path is gone");
  else if (Object.keys(last).join(",") !== "set-one") wrong.push(`without Code Mode setMcpServers was handed ${JSON.stringify(last)}, not the on-set's map`);
  if (today.outcome?.live !== true || today.outcome?.confirmed !== true) wrong.push(`without Code Mode the switch answered ${JSON.stringify(today.outcome)}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("in Code Mode the switch reached serversChanged once with the chat's own server and the on-set's, setMcpServers never, and a failing bridge answered unconfirmed; without Code Mode setMcpServers took the on-set's map as today and serversChanged was never called");
});
