// protects: server/modules/code-mode/code-mode.service.ts, server/modules/code-mode/code-mode.module.ts, server/modules/database/repositories/session-user-state.db.ts
// writes: none
//
// A chat started while the chats switch is on is launched in Code Mode, its word stored as 1, and it keeps that mode
// when the switch is turned off: the module passes `--born on` and the verb obeys it before the switch. Its MCP
// servers reach it through the bridge's server.json, which serversChanged rewrites, never through setMcpServers.
//
// Everything this case decides is scratch: the database and the flags behind CODE_MODE_FLAG_DIR. The verb writes the
// chat's server.json in the house's state for a chat id this case made up (a fresh UUID), and the case removes that
// one folder at the end, after checking its name is that id under a `code_mode/chats` folder. A box whose
// `code-mode --status` says not ready answers every launch off, so the case cannot judge the on path there and says why.

import { readFile } from "node:fs/promises";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { chatConfigOf, codeModeRow, contextOf, launchInput, newChat, openCodeModeGround, setChatsSwitch, verbAnswers } from "../lib/code_mode_chat.mjs";

// `CHAT_TOOLS` in hooks/plan_runner/code_mode/switch.py (house), interface A's list.
const CHAT_TOOLS = ["AskUserQuestion", "Agent", "Skill", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "EnterPlanMode", "ExitPlanMode", "WebSearch", "WebFetch"];


type OnLaunch = { on: true; tools: string[]; server: { command: string; args: string[] }; prompt: string; env: Record<string, string> };
type Hooks = {
  launchFor(input: Record<string, unknown>): Promise<{ on: false } | OnLaunch>;
  serversChanged(input: Record<string, unknown>): Promise<void>;
};


runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const ground = await openCodeModeGround(t, "code-mode-born-on");
  const verb = verbAnswers();
  if (!verb.chatForm) return cannotRun("the house verb has no `code-mode config --chat` form to answer a chat's launch");
  if (verb.ready !== true) return cannotRun(`the box is not ready for Code Mode, so every launch answers off: ${verb.why}`);

  let create: unknown;
  try {
    create = (await import("../../server/modules/code-mode/index.ts")).createCodeModeModule;
  } catch (error) {
    return broken(`the code-mode barrel will not load: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
  }
  if (typeof create !== "function") return broken("the code-mode barrel exports no createCodeModeModule");
  await (create as () => unknown)();
  const codeMode = ((await contextOf()).context as { codeMode?: Hooks } | null)?.codeMode;
  if (!codeMode) return broken("the runtime context carries no codeMode");

  const id = newChat(ground);
  setChatsSwitch(ground, true);
  const first = await codeMode.launchFor(launchInput(ground, id));
  if (first.on !== true) return broken(`with the switch on and a ready box, a new chat answered ${JSON.stringify(first).slice(0, 200)}`);

  const config: string | null = chatConfigOf(t, first, id);

  const wrong: string[] = [];
  if (JSON.stringify([...first.tools].sort()) !== JSON.stringify([...CHAT_TOOLS].sort())) wrong.push(`the launch's tools are ${JSON.stringify(first.tools)}`);
  if (!config) wrong.push(`the launch's server args name no --config file: ${JSON.stringify(first.server.args)}`);
  if (codeModeRow(ground, id) !== 1) wrong.push(`after the first launch the row holds ${String(codeModeRow(ground, id))}, not 1`);

  setChatsSwitch(ground, false);
  const second = await codeMode.launchFor(launchInput(ground, id));
  if (second.on !== true) wrong.push(`after the switch was turned off, the chat born on answered ${JSON.stringify(second).slice(0, 160)}`);
  if (codeModeRow(ground, id) !== 1) wrong.push(`after the second launch the row holds ${String(codeModeRow(ground, id))}, not 1`);

  if (config) {
    await codeMode.serversChanged({ appSessionId: id, servers: { "case-only-server": { command: "true", args: [] } } });
    let names: string[] = [];
    try {
      names = Object.keys(JSON.parse(await readFile(config, "utf8")).servers ?? {});
    } catch (error) {
      wrong.push(`the chat's server.json could not be read after serversChanged: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
    }
    if (names.join(",") !== "case-only-server") wrong.push(`after serversChanged the chat's server.json lists ${JSON.stringify(names)}`);
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("a chat first launched with the switch on answered on with the eleven chat tools and stored 1, stayed on after the switch was turned off, and serversChanged rewrote its server.json to the one server named");
});
