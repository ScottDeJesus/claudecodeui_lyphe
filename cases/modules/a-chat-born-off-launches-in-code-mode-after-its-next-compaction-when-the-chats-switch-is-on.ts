// protects: server/modules/code-mode/code-mode.service.ts, server/modules/database/repositories/session-compactions.db.ts, server/modules/database/repositories/session-user-state.db.ts
// writes: none
//
// A compaction starts a chat's conversation again, so its seed launch reads the chats switch as a new chat's first
// launch does, and the swap moves that answer onto the row. A chat born off, compacted with the switch on, answers on
// from then on; before the swap the row still holds the old conversation's 0.
//
// Everything is scratch (lib/code_mode_chat.mjs): the database, and the flags behind CODE_MODE_FLAG_DIR. The verb is
// the real one. Judged only on a ready box: a box that is not ready answers off for every chat.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { chatConfigOf, codeModeRow, compactChat, contextOf, launchInput, openCodeModeGround, setChatsSwitch, talkedChat, verbAnswers } from "../lib/code_mode_chat.mjs";

type Hooks = { launchFor(input: Record<string, unknown>): Promise<{ on: boolean }> };

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const ground = await openCodeModeGround(t, "code-mode-compacted-on");
  const verb = verbAnswers();
  if (!verb.chatForm) return cannotRun("the house verb has no `code-mode config --chat` form to answer a chat's launch");
  if (verb.ready !== true) return cannotRun(`the box is not ready for Code Mode, so every chat answers off: ${verb.why.slice(0, 160)}`);

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

  const id = talkedChat(ground, 0);
  const wrong: string[] = [];
  setChatsSwitch(ground, true);

  const before = await codeMode.launchFor(launchInput(ground, id));
  chatConfigOf(t, before, id);
  if (before.on !== false) wrong.push(`before the compaction the chat born off answered ${JSON.stringify(before).slice(0, 160)}`);

  const seed = await codeMode.launchFor({ ...launchInput(ground, id), compactionSeed: true });
  chatConfigOf(t, seed, id);
  if (seed.on !== true) wrong.push(`the compaction's seed launch answered ${JSON.stringify(seed).slice(0, 160)}, not the switch's on`);
  if (codeModeRow(ground, id) !== 0) wrong.push(`before the swap the row already reads ${String(codeModeRow(ground, id))}, not the old conversation's 0`);

  compactChat(ground, id);
  if (codeModeRow(ground, id) !== 1) wrong.push(`after the swap the row reads ${String(codeModeRow(ground, id))}, not 1`);

  const after = await codeMode.launchFor(launchInput(ground, id));
  chatConfigOf(t, after, id);
  if (after.on !== true) wrong.push(`the launch after the compaction answered ${JSON.stringify(after).slice(0, 160)}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("a chat born off answered off before its compaction, on at the seed launch with the switch on, and its row read 1 after the swap");
});
