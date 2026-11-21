// protects: server/modules/settings/code-mode.ts, server/modules/code-mode/code-mode.service.ts, /home/lyphe/.claude/hooks/plan_runner/code_mode/switch.py, /home/lyphe/.claude/hooks/plan_runner/code_mode/verb.py
// writes: none
//
// The operator turns Code Mode for chats on and off from one place: the Code Mode card, which is drawn from the verb's
// status and moves a kind through `code-mode set … --by app:card`. Nothing in CloudCLI names the chats kind; it reaches
// the card because the verb lists it. So the promise is the whole path the card's switch drives: the card's server door
// lists `chats` as the verb states it, its set answers the position on disk, and a chat started after the switch moved
// launches in the mode the switch now says. The card cases draw a fixed answer and the launch cases move the flag with
// `--by cli`; this one is the card's own door meeting the chat's launch.
//
// Scratch: CODE_MODE_FLAG_DIR and the database (lib/code_mode_chat.mjs), so the operator's real flag is never read or
// written; the on chat's server.json folder under the house's code_mode/chats is removed at the end. No model, no Gemini.

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { chatConfigOf, contextOf, launchInput, newChat, openCodeModeGround, verbAnswers } from "../lib/code_mode_chat.mjs";

// interface A's sentence for the chats kind, word for word.
const SAYS =
  "A chat started after this is on works with one search and one script, and keeps the tools a conversation needs: asking you, launching work, skills, plans, the to-do list and the web. Its own MCP servers and tool sets are called from inside the script. A chat keeps the mode it was started in. Chats on a node, and Kaylee, are not changed.";

type Kind = { kind: string; label: string; says: string; enabled: boolean };
type State = { ready: boolean | null; kinds: Kind[] | null };
type Door = { getCodeModeState(): Promise<State>; setCodeModeState(kind: unknown, enabled: unknown): Promise<State> };
type Hooks = { launchFor(input: Record<string, unknown>): Promise<{ on: boolean }> };

const chatsOf = (state: State) => (state.kinds ?? []).find((k) => k.kind === "chats");

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const ground = await openCodeModeGround(t, "code-mode-card-chats");
  const verb = verbAnswers();
  if (!verb.chatForm) return cannotRun("the house verb has no `code-mode config --chat` form to answer a chat's launch");
  if (verb.ready !== true) return cannotRun(`the box is not ready for Code Mode, so every launch answers off: ${verb.why}`);

  let door: Door;
  let codeMode: Hooks | undefined;
  try {
    door = await import("../../server/modules/settings/code-mode.ts") as unknown as Door;
    await (await import("../../server/modules/code-mode/index.ts")).createCodeModeModule();
    codeMode = ((await contextOf()).context as { codeMode?: Hooks } | null)?.codeMode;
  } catch (error) {
    return broken(`the card's door or the code-mode module will not load: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
  }
  if (!codeMode) return broken("the runtime context carries no codeMode");

  const wrong: string[] = [];
  const first = chatsOf(await door.getCodeModeState());
  if (!first) return broken("the card's door lists no chats kind: the verb's status does not name it");
  if (first.label !== "Chats") wrong.push(`the chats kind is labelled ${JSON.stringify(first.label)}`);
  if (first.says !== SAYS) wrong.push(`the chats kind's sentence is ${JSON.stringify(first.says)}`);
  if (first.enabled !== false) wrong.push("the scratch chats switch reads on before anything set it");

  const on = chatsOf(await door.setCodeModeState("chats", true));
  if (on?.enabled !== true) wrong.push(`setting chats on through the card's door answered ${JSON.stringify(on ?? null)}`);
  const bornOn = newChat(ground);
  const launchOn = await codeMode.launchFor(launchInput(ground, bornOn));
  chatConfigOf(t, launchOn, bornOn);
  if (launchOn.on !== true) wrong.push(`a chat started with the card's switch on launched ${JSON.stringify(launchOn).slice(0, 160)}`);

  const off = chatsOf(await door.setCodeModeState("chats", false));
  if (off?.enabled !== false) wrong.push(`setting chats off through the card's door answered ${JSON.stringify(off ?? null)}`);
  const bornOff = newChat(ground);
  const launchOff = await codeMode.launchFor(launchInput(ground, bornOff));
  chatConfigOf(t, launchOff, bornOff);
  if (launchOff.on !== false) wrong.push("a chat started after the card's switch went off launched in Code Mode");

  if (wrong.length) return broken(wrong.join("; "));
  return held("the card's door listed Chats with its sentence, set it on and off as asked, and a new chat launched in Code Mode while on and as today after off");
});
