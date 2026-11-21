// protects: server/modules/providers/list/claude/claude-runtime.provider.js, server/modules/providers/list/claude/claude-code-mode-seams.ts, server/modules/providers/list/claude/claude-toolset-seams.ts, server/modules/providers/list/claude/chat-process.ts
// writes: none
//
// A chat keeps the mode it was born in, and a process keeps the mode it was LAUNCHED in. A process re-adopted after a
// server restart is already running: its host recorded its launch profile (`codeMode` included), and nothing the
// re-adopting server asks can change what that CLI holds. So where a tool-set sync sends a set's servers must follow
// the process's recorded mode, not the house's answer at re-adoption: a Code Mode CLI's only MCP server is `cm`, and
// a set handed to its setMcpServers loads beside `cm` in a chat promised two tools (INV-8471's second path); a CLI
// launched without Code Mode has no `cm`, so a set pushed only to the bridge never reaches it.
//
// The real Claude runtime runs on a scratch database, with the SDK's `query` replaced (for that one importer) by a
// stand-in that records every setMcpServers and never spawns a CLI. Three re-adoptions, each driven through the
// runtime's own run (keepalive reattach, its turn already complete), then one plain message, then a switch's sync:
//   control: recorded off, re-ask off  → setMcpServers carries the set (proves the rig sees the call)
//   on→off:  recorded on,  re-ask off  → setMcpServers is never called
//   off→on:  recorded off, re-ask on   → setMcpServers carries the set (the CLI holds no `cm`)

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { broken, held, runCase } from "../lib/case.mjs";
import { contextOf, openCodeModeGround } from "../lib/code_mode_chat.mjs";
import { scratchDir } from "../lib/scratch.mjs";

const RUNTIME = "../../server/modules/providers/list/claude/claude-runtime.provider.js";
const CHAT_PROCESS = "../../server/modules/providers/list/claude/chat-process.ts";
const SET_SERVER = "case-set-server";
const CM = { cm: { command: "/usr/bin/node", args: ["/case/server.mjs", "--config", "/case/server.json"] } };
const ON_LAUNCH = { on: true, tools: ["AskUserQuestion", "Skill"], server: CM.cm, prompt: "case prompt", env: { CODE_MODE_KIND: "chats" } };

const SDK_STUB = `
export function query({ options }) {
  const calls = (globalThis.__caseSdk ??= []);
  const cwd = options.cwd;
  const target = {
    setMcpServers: async (map) => { calls.push({ cwd, names: Object.keys(map) }); return { added: Object.keys(map), removed: [], errors: {} }; },
    [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}), return: async () => ({ done: true }) }; },
  };
  return new Proxy(target, { get: (t, k) => (k in t ? t[k] : k === "then" ? undefined : async () => undefined) });
}
`;

const hooksSource = (stubUrl: string) => `
export async function resolve(specifier, context, next) {
  if (specifier === "@anthropic-ai/claude-agent-sdk" && String(context.parentURL ?? "").includes("claude-runtime.provider")) {
    return { url: ${JSON.stringify(stubUrl)}, shortCircuit: true };
  }
  return next(specifier, context);
}
`;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const rig = await scratchDir(t, "readopt-sdk");
  await writeFile(path.join(rig, "sdk-stub.mjs"), SDK_STUB);
  await writeFile(path.join(rig, "hooks.mjs"), hooksSource(pathToFileURL(path.join(rig, "sdk-stub.mjs")).href));
  register(pathToFileURL(path.join(rig, "hooks.mjs")).href);

  const ground = await openCodeModeGround(t, "readopt-mode");
  const { context: captured, providerRuntimeService } = await contextOf();
  const answers = new Map<string, unknown>();
  const bridge: Array<{ id: string; names: string[] }> = [];
  providerRuntimeService.useChatCodeMode({
    launchFor: async (input: { appSessionId: string | null }) => answers.get(input.appSessionId ?? "") ?? { on: false },
    serversChanged: async (input: { appSessionId: string; servers: Record<string, unknown> }) => {
      bridge.push({ id: input.appSessionId, names: Object.keys(input.servers) });
    },
  });
  providerRuntimeService.useChatToolsets({
    launchFor: async () => ({ servers: { [SET_SERVER]: { command: "true", args: [] } }, env: {} }),
  });

  let claudeRuntime: any;
  let launchProfileOf: any;
  try {
    ({ claudeRuntime } = await import(RUNTIME));
    ({ launchProfileOf } = await import(CHAT_PROCESS));
  } catch (error) {
    return broken(`the runtime will not load: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
  }
  const context = { ...captured, getProviderModels: async () => [], resolveResumeModel: async () => null, resolveProviderSessionId: () => randomUUID() };
  const ws = { send() {}, userId: 1, setSessionId() {} };
  const calls = () => ((globalThis as any).__caseSdk ?? []) as Array<{ cwd: string; names: string[] }>;

  // One re-adoption: the host recorded `recordedOn`, the house now answers `askOn`. Returns the setMcpServers names
  // the process was sent after a plain message and after a switch's sync, and what the bridge was handed.
  const readopt = async (label: string, recordedOn: boolean, askOn: boolean) => {
    const repo = path.join(ground.folder, label);
    await mkdir(repo);
    const id = randomUUID();
    ground.database.sessionsDb.createAppSession(id, "claude", repo, `readopt ${label}`);
    answers.set(id, askOn ? ON_LAUNCH : { on: false });
    const recorded = { cwd: repo, mcpServers: recordedOn ? CM : {}, permissionMode: "default", model: "opus", allowedTools: recordedOn ? ["mcp__cm__search"] : [], disallowedTools: [] };
    const profile = launchProfileOf(recorded, false, false, null, "", null, null, recordedOn);
    const keepalive = { hostId: `case-host-${label}`, turnCompleteSent: true, heldForBackgroundWork: false, profile, cliVersion: null, deferredTools: [], liveTasks: [], node: null };
    await Promise.race([claudeRuntime.run("", { sessionId: id, cwd: repo, keepalive }, ws, context), pause(8000)]);
    // A plain message joins the re-adopted process; its turn never ends (the stand-in answers nothing), so it is not awaited.
    void claudeRuntime.run("one more message", { sessionId: id, cwd: repo }, ws, context);
    await pause(1500);
    const afterJoin = calls().filter((call) => call.cwd === repo).flatMap((call) => call.names);
    const outcome = await claudeRuntime.syncToolsets(id);
    const afterSwitch = calls().filter((call) => call.cwd === repo).flatMap((call) => call.names);
    return { afterJoin, afterSwitch, bridged: bridge.filter((push) => push.id === id).length, outcome };
  };

  const control = await readopt("control", false, false);
  if (!control.afterSwitch.includes(SET_SERVER)) {
    return broken(`the rig did not see setMcpServers on a re-adopted off process (sync answered ${JSON.stringify(control.outcome)}), so it cannot judge the others`);
  }
  const onOff = await readopt("on-off", true, false);
  const offOn = await readopt("off-on", false, true);

  const wrong: string[] = [];
  if (onOff.afterSwitch.length > 0) {
    wrong.push(`a process its host recorded in Code Mode, re-adopted while the house answered off, was sent setMcpServers ${JSON.stringify(onOff.afterSwitch)} (${onOff.afterJoin.length} of them by a plain message) beside its cm, and the bridge was told ${onOff.bridged} time(s)`);
  }
  if (!offOn.afterSwitch.includes(SET_SERVER)) {
    wrong.push(`a process its host recorded without Code Mode, re-adopted while the house answered on, was never sent setMcpServers: its set went to a bridge it has no cm for (${offOn.bridged} push(es)), answered ${JSON.stringify(offOn.outcome)}`);
  }
  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`a re-adopted process kept its recorded mode: the Code Mode one was sent no setMcpServers (bridge told ${onOff.bridged} time(s)), the off one re-asked on still took its set through setMcpServers, and the control synced as today`);
});
