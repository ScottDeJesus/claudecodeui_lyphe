// protects: server/modules/code-mode/code-mode.service.ts, server/modules/code-mode/code-mode.module.ts
// writes: none
//
// Chats on a node are not changed by Code Mode, and a launch with no app session id has no row to keep a word on.
// The module answers both `{ on: false }` without asking the house verb, so it stores nothing: the chat's code_mode
// stays NULL, and no chat folder is written for it under the house's state.
//
// The scratch chats switch is ON (lib/code_mode_chat.mjs), so a module that asked the verb would be answered on (a
// ready box) or off-and-stored (a box that is not), and the row would no longer be NULL either way.

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { broken, held, runCase } from "../lib/case.mjs";
import { chatConfigOf, codeModeRow, contextOf, launchInput, newChat, openCodeModeGround, setChatsSwitch } from "../lib/code_mode_chat.mjs";

type Hooks = { launchFor(input: Record<string, unknown>): Promise<{ on: boolean }> };

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const ground = await openCodeModeGround(t, "code-mode-node");
  setChatsSwitch(ground, true);

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
  const wrong: string[] = [];

  const onNode = await codeMode.launchFor(launchInput(ground, id, true));
  if (JSON.stringify(onNode) !== '{"on":false}') wrong.push(`a node's chat answered ${JSON.stringify(onNode).slice(0, 160)}`);
  if (codeModeRow(ground, id) !== null) wrong.push(`a node's chat's code_mode became ${String(codeModeRow(ground, id))}`);

  const noId = await codeMode.launchFor(launchInput(ground, null));
  if (JSON.stringify(noId) !== '{"on":false}') wrong.push(`a launch with no chat id answered ${JSON.stringify(noId).slice(0, 160)}`);

  for (const folder of [path.join(os.homedir(), ".claude", "state", "code_mode", "chats", id), path.join(ground.flags, "chats", id)]) {
    if (existsSync(folder)) wrong.push(`a chat folder was written for the node's chat: ${folder}`);
  }
  chatConfigOf(t, onNode, id); // checked above first; a wrong on answer's folder is then removed at the end

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("with the chats switch on, a node's chat and a launch with no chat id each answered exactly { on: false }; the chat's code_mode stayed NULL and no chat folder was written");
});
