// protects: server/modules/code-mode/code-mode.service.ts, server/modules/code-mode/code-mode.module.ts, server/modules/database/repositories/session-user-state.db.ts
// writes: none
//
// A chat keeps the mode it was started in. The first launch of a chat whose code_mode is NULL asks the house verb
// with no --born, so the chats switch decides, and the module stores that answer; every later launch passes the
// stored word as --born, which the verb obeys before it reads the switch. So a chat started while the switch was off
// stays off when the operator turns it on.
//
// Everything is scratch (lib/code_mode_chat.mjs): the database, and the flags behind CODE_MODE_FLAG_DIR, which the
// verb's own `set ... --by cli` moves. The verb is the real one; an off answer is decided before readiness and
// writes no chat folder. A verb with no `config --chat` form cannot judge the module, and the case says so.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { chatConfigOf, codeModeRow, contextOf, launchInput, newChat, openCodeModeGround, setChatsSwitch, verbAnswers } from "../lib/code_mode_chat.mjs";

type Hooks = { launchFor(input: Record<string, unknown>): Promise<{ on: boolean }> };

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const ground = await openCodeModeGround(t, "code-mode-born-off");
  if (!verbAnswers().chatForm) return cannotRun("the house verb has no `code-mode config --chat` form to answer a chat's launch");

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

  setChatsSwitch(ground, false);
  const first = await codeMode.launchFor(launchInput(ground, id));
  chatConfigOf(t, first, id); // a wrong on answer writes the chat's folder in the house's state; removed at the end
  if (first.on !== false) wrong.push(`with the switch off, the first launch answered ${JSON.stringify(first)}`);
  if (codeModeRow(ground, id) !== 0) wrong.push(`after the first launch with the switch off the row holds ${String(codeModeRow(ground, id))}, not 0`);

  setChatsSwitch(ground, true);
  const second = await codeMode.launchFor(launchInput(ground, id));
  chatConfigOf(t, second, id);
  if (second.on !== false) wrong.push(`after the switch was turned on, the chat born off answered ${JSON.stringify(second).slice(0, 160)}`);
  if (codeModeRow(ground, id) !== 0) wrong.push(`after the second launch the row holds ${String(codeModeRow(ground, id))}, not 0`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("a chat first launched with the chats switch off stored 0 and answered off again after the switch was turned on");
});
