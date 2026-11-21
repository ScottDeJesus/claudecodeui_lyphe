// protects: server/modules/code-mode/code-mode.service.ts, server/modules/database/repositories/session-user-state.db.ts
// writes: none
//
// A chat the mode cannot serve launches as it does today, and is asked again next time (INV-78; the brief puts
// "the verb fails" and "the box is not ready" side by side). The house answers such a launch with
// {"on": false, "why": "<sentence>"}: a box that is not ready, or a chat folder that is not a directory. An off with
// a reason is not the chat's birth, so the module must not store it as "born off": a chat opened while the sandbox
// was briefly down, or whose folder was briefly gone, would otherwise stay out of Code Mode for life with the
// switch on. Only the switch's own off (why "") and an on answer are a birth.
//
// Driven with the real verb on a missing folder, because that reason is answered whether or not the box is ready
// (a box that is not ready answers off with its own reason first, which this case judges the same way). The
// second half — the folder now there, the chat asked again with no --born, born on — is judged only on a ready box.
// Everything is scratch (lib/code_mode_chat.mjs).

import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { chatConfigOf, codeModeRow, contextOf, launchInput, newChat, openCodeModeGround, setChatsSwitch, verbAnswers } from "../lib/code_mode_chat.mjs";

type Launch = { on: boolean };
type Hooks = { launchFor(input: Record<string, unknown>): Promise<Launch> };

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const ground = await openCodeModeGround(t, "code-mode-unserved");
  const verb = verbAnswers();
  if (!verb.chatForm) return cannotRun("the house verb has no `code-mode config --chat` form to answer a chat's launch");

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

  setChatsSwitch(ground, true);
  const id = newChat(ground);
  const wrong: string[] = [];

  const gone = { ...launchInput(ground, id), cwd: path.join(ground.repo, "not-there") };
  const first = await codeMode.launchFor(gone);
  chatConfigOf(t, first, id);
  if (first.on !== false) wrong.push(`a launch in a folder that is not there answered ${JSON.stringify(first).slice(0, 160)}`);
  const afterFirst = codeModeRow(ground, id);
  if (afterFirst !== null) wrong.push(`a launch the house could not serve stored code_mode ${String(afterFirst)}; the chat is now born off for life with the switch on`);

  if (verb.ready === true) {
    const second = await codeMode.launchFor(launchInput(ground, id));
    chatConfigOf(t, second, id);
    if (second.on !== true) wrong.push(`with the folder there and the box ready, the next launch answered ${JSON.stringify(second).slice(0, 160)}`);
    if (codeModeRow(ground, id) !== 1) wrong.push(`after the served launch the row holds ${String(codeModeRow(ground, id))}, not 1`);
  }

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held(verb.ready === true
    ? "a launch the house could not serve answered off and stored nothing; the next launch was asked again, answered on and stored 1"
    : `a launch the house could not serve answered off and stored nothing (the box is not ready: ${verb.why.slice(0, 120)})`);
});
