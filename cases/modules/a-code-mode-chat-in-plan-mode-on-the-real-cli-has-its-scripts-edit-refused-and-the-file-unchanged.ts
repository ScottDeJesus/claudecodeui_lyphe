// protects: server/modules/providers/list/claude/claude-code-mode-seams.ts, server/modules/code-mode/code-mode.service.ts, /home/lyphe/.claude/hooks/code_mode_context.py, /home/lyphe/.claude/hooks/plan_runner/code_mode/node/execute/door.mjs, /home/lyphe/.claude/hooks/plan_runner/code_mode/node/execute/call_context.mjs, /home/lyphe/.claude/hooks/plan_runner/code_mode/config.py
// writes: none
//
// A Code Mode chat has no Edit tool for the CLI's plan mode to withhold: the script's door is the only place plan mode
// holds, and it learns the mode only through a chain no other case runs whole — the CLI hands the call's
// permission_mode to the house's PreToolUse hook code_mode_context.py (loaded from the operator's user settings, which
// a chat's launch keeps), the hook saves it under the ctx folder the chat's server.json names, and cm takes it by the
// CLI's session id and the call's tool-use id. A chat whose CLI does not load the hook, whose server.json names another
// ctx folder, or whose cm child cannot tell its session, runs a plan-mode edit as if approved. So: a real CLI on a Code
// Mode chat's options, in plan mode, answered by a loopback API with one execute call that reads a file and edits it;
// then the same in default mode, where the edit must land (a door that refuses everything is not plan mode either).
//
// Scratch: the database, the flags, the repo (lib/code_mode_chat.mjs); the chat's server.json folder is removed at the
// end; the CLI keeps no transcript and spends nothing (lib/code_mode_cli.mjs). No model, no Gemini.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { EXECUTE, chatOptions, lastResultText, runChat, standInApi, text, toolUse } from "../lib/code_mode_cli.mjs";
import { chatConfigOf, contextOf, launchInput, newChat, openCodeModeGround, setChatsSwitch, verbAnswers } from "../lib/code_mode_chat.mjs";

const SENTENCE = "plan mode: this chat may only read until the operator approves the plan";
const BEFORE = "x = 1\n";
const CODE = [
  "const before = await read('a.txt');",
  "let refused = '';",
  "try { await edit('a.txt', 'x = 1', 'x = 2'); } catch (e) { refused = String(e?.message ?? e); }",
  "return 'READ=' + String(before).includes('x = 1') + ' REFUSED=' + (refused || 'none');",
].join("\n");

type Seams = {
  askCodeModeLaunch: (context: unknown, input: unknown) => Promise<{ on: boolean }>;
  applyCodeModeLaunch: (options: unknown, launch: unknown) => void;
};

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const ground = await openCodeModeGround(t, "code-mode-real-cli-plan");
  const verb = verbAnswers();
  if (!verb.chatForm) return cannotRun("the house verb has no `code-mode config --chat` form to answer a chat's launch");
  if (verb.ready !== true) return cannotRun(`the box is not ready for Code Mode, so every launch answers off: ${verb.why}`);

  let seams: Seams;
  try {
    await (await import("../../server/modules/code-mode/index.ts")).createCodeModeModule();
    seams = await import("../../server/modules/providers/list/claude/claude-code-mode-seams.ts") as unknown as Seams;
  } catch (error) {
    return broken(`the code-mode module or the runtime's seam will not load: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
  }
  const { context } = await contextOf();
  setChatsSwitch(ground, true);
  const target = path.join(ground.repo, "a.txt");

  // One turn: the API calls execute once, then ends; what the script returned comes back in the next request.
  const turn = async (mode: string) => {
    await writeFile(target, BEFORE);
    const id = newChat(ground);
    const launch = await seams.askCodeModeLaunch(context, launchInput(ground, id));
    if (launch.on !== true) return { error: `the chat's launch answered ${JSON.stringify(launch).slice(0, 160)}` };
    chatConfigOf(t, launch, id);
    let result = "";
    const api = await standInApi(t, (step: string, messages: unknown[]) => {
      if (step === "open") return toolUse(EXECUTE, { intent: "Read a.txt and change x to 2.", code: CODE });
      result = lastResultText(messages);
      return text("done");
    });
    const options = chatOptions(ground, api, mode);
    seams.applyCodeModeLaunch(options, launch);
    const run = await runChat(t, options, "Change x to 2 in a.txt.");
    const after = await readFile(target, "utf8");
    return { error: run.error, result, after, turns: api.turns, asks: run.asks.map((a: { toolName: string }) => a.toolName) };
  };

  const plan = await turn("plan");
  if (plan.error && !plan.result) return broken(`the plan-mode turn did not run: ${plan.error}`);
  const wrong: string[] = [];
  if (!plan.turns?.includes(EXECUTE)) wrong.push(`in plan mode the execute call never came back to the API (turns ${JSON.stringify(plan.turns)}, asks ${JSON.stringify(plan.asks)})`);
  else if (!plan.result.includes("READ=true")) wrong.push(`in plan mode the script's read did not answer: ${JSON.stringify(plan.result.slice(0, 300))}`);
  else if (!plan.result.includes(SENTENCE)) wrong.push(`in plan mode the script's edit was not refused with the plan-mode sentence: ${JSON.stringify(plan.result.slice(0, 300))}`);
  if (plan.after !== BEFORE) wrong.push(`in plan mode the file changed to ${JSON.stringify(plan.after)}`);

  const open = await turn("default");
  if (open.error && !open.result) wrong.push(`the default-mode turn did not run: ${open.error}`);
  else if (open.after !== "x = 2\n") wrong.push(`in default mode the edit did not land (file ${JSON.stringify(open.after)}, result ${JSON.stringify(String(open.result).slice(0, 200))})`);

  if (wrong.length) return broken(wrong.join("; "));
  return held("on the real CLI a Code Mode chat in plan mode read a.txt and had its edit refused with the plan-mode sentence, the file unchanged; in default mode the same script's edit landed");
});
