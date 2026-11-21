// protects: server/modules/code-mode/code-mode.service.ts, server/modules/database/migrations.ts, server/modules/database/repositories/session-user-state.db.ts
// writes: none
//
// "A chat keeps the mode it was started in" (the chats switch's own words on the Settings card). Every chat on this
// box was started before Code Mode for chats existed, and every one reads code_mode NULL (the column was added with
// nothing backfilled: 7,007 rows NULL on 2026-11-21). NULL is read as "undecided", so the first relaunch of such a
// chat after the operator turns the switch on would put a conversation started with the full tool set into Code
// Mode halfway through. A chat that already holds a conversation (its row carries the CLI's session id and its
// transcript path) was born without Code Mode, whatever its cell says.
//
// The row is made the way a chat that has talked is: createAppSession, then the CLI's session id and transcript
// path written by the same SQL the session synchronizer's upsert writes them with. Everything is scratch
// (lib/code_mode_chat.mjs). Judged only on a ready box: a box that is not ready answers off for every chat.

import { randomUUID } from "node:crypto";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { chatConfigOf, codeModeRow, contextOf, launchInput, newChat, openCodeModeGround, setChatsSwitch, verbAnswers } from "../lib/code_mode_chat.mjs";

type Launch = { on: boolean };
type Hooks = { launchFor(input: Record<string, unknown>): Promise<Launch> };

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const ground = await openCodeModeGround(t, "code-mode-old-chat");
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

  const id = newChat(ground);
  const providerSession = randomUUID();
  ground.database.getConnection()
    .prepare("UPDATE sessions SET provider_session_id = ?, jsonl_path = ? WHERE session_id = ?")
    .run(providerSession, path.join(ground.folder, `${providerSession}.jsonl`), id);
  if (codeModeRow(ground, id) !== null) return cannotRun("the scratch chat's code_mode was not NULL to start with");

  setChatsSwitch(ground, true);
  const launch = await codeMode.launchFor(launchInput(ground, id));
  chatConfigOf(t, launch, id);
  const stored = codeModeRow(ground, id);

  const wrong: string[] = [];
  if (launch.on !== false) wrong.push(`a chat that already held a conversation, code_mode NULL, answered on with the switch on: it would change mode halfway through (stored ${String(stored)})`);
  if (stored === 1) wrong.push("its row now reads born on");

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(`a chat that already held a conversation answered off with the switch on (code_mode ${String(stored)})`);
});
