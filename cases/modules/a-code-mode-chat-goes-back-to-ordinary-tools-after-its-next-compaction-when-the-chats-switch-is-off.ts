// protects: server/modules/code-mode/code-mode.service.ts, server/modules/database/repositories/session-compactions.db.ts, server/modules/database/repositories/session-user-state.db.ts
// writes: none
//
// The mirror of the compaction case: a chat born in Code Mode, compacted with the chats switch off, goes back to the
// ordinary tools. Its seed launch reads the switch (no --born), and the swap moves the 0 onto its row.
//
// Everything is scratch (lib/code_mode_chat.mjs): the database, and the flags behind CODE_MODE_FLAG_DIR. The verb is
// the real one. Judged only on a ready box: a box that is not ready answers off for every chat.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { chatConfigOf, codeModeRow, compactChat, contextOf, launchInput, openCodeModeGround, setChatsSwitch, talkedChat, verbAnswers } from "../lib/code_mode_chat.mjs";

type Hooks = { launchFor(input: Record<string, unknown>): Promise<{ on: boolean }> };

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const ground = await openCodeModeGround(t, "code-mode-compacted-off");
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

  const id = talkedChat(ground, 1);
  const wrong: string[] = [];
  setChatsSwitch(ground, false);

  const before = await codeMode.launchFor(launchInput(ground, id));
  chatConfigOf(t, before, id);
  if (before.on !== true) wrong.push(`before the compaction the chat born on answered ${JSON.stringify(before).slice(0, 160)}`);

  const seed = await codeMode.launchFor({ ...launchInput(ground, id), compactionSeed: true });
  chatConfigOf(t, seed, id);
  if (seed.on !== false) wrong.push(`the compaction's seed launch answered ${JSON.stringify(seed).slice(0, 160)}, not the switch's off`);
  if (codeModeRow(ground, id) !== 1) wrong.push(`before the swap the row already reads ${String(codeModeRow(ground, id))}, not the old conversation's 1`);

  compactChat(ground, id);
  if (codeModeRow(ground, id) !== 0) wrong.push(`after the swap the row reads ${String(codeModeRow(ground, id))}, not 0`);

  const after = await codeMode.launchFor(launchInput(ground, id));
  chatConfigOf(t, after, id);
  if (after.on !== false) wrong.push(`the launch after the compaction answered ${JSON.stringify(after).slice(0, 160)}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("a chat born on answered on before its compaction, off at the seed launch with the switch off, and its row read 0 after the swap");
});
