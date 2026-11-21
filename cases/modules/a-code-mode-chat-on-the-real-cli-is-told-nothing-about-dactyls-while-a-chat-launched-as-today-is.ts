// protects: server/modules/providers/list/claude/claude-code-mode-seams.ts, server/modules/code-mode/code-mode.service.ts, /home/lyphe/.claude/hooks/main_session_dactyls.py, /home/lyphe/.claude/hooks/plan_runner/dactyls/main_session.py, /home/lyphe/.claude/hooks/plan_runner/code_mode/switch.py
// writes: none
//
// "For the Dactyls we can just have those automatically turn off if our code mode switches on": a chat in Code Mode is
// told nothing about dactyls. The house answers that in main_session.wanted(), asked first by CODE_MODE_KIND in the
// session's environment, and the launch puts that name in the env it hands the CLI. Only a real CLI shows the two
// meet: its SessionStart and UserPromptSubmit hooks (main_session_dactyls.py, from the operator's user settings) run in
// the CLI's environment and put their words into the conversation the model reads. So the same prompt runs twice on
// the real CLI against a loopback API, both under a scratch Dactyls switch reading on: once on a chat's options as
// today (the control: it must be told DACTYLS ARE ON, or the case cannot judge this box), once in Code Mode, whose
// requests must carry no Dactyls telling at all.
//
// Scratch: the flags, the database (lib/code_mode_chat.mjs), the Dactyls switch file, and the state root the CLI's
// hooks write under (DISPATCHER_HOME on a scratch folder, so the told marker lands there); the on chat's server.json
// folder under the house's code_mode/chats is removed at the end. No model, no Gemini.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { chatOptions, runChat, standInApi, text } from "../lib/code_mode_cli.mjs";
import { chatConfigOf, contextOf, launchInput, newChat, openCodeModeGround, setChatsSwitch, verbAnswers } from "../lib/code_mode_chat.mjs";

const TOLD = /DACTYLS ARE (ON|OFF)/;
const ON = "DACTYLS ARE ON";

type Seams = {
  askCodeModeLaunch: (context: unknown, input: unknown) => Promise<{ on: boolean }>;
  applyCodeModeLaunch: (options: unknown, launch: unknown) => void;
};

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const ground = await openCodeModeGround(t, "code-mode-real-cli-dactyls");
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

  const dactylsFlag = path.join(ground.folder, "main_session_dactyls.flag");
  await writeFile(dactylsFlag, "on\n");
  const home = path.join(ground.folder, "state", "dispatcher");
  await mkdir(home, { recursive: true });

  const told = async (codeMode: boolean) => {
    const api = await standInApi(t, () => text("ok"));
    const options = chatOptions(ground, api, "default") as { env: Record<string, string | undefined> };
    options.env.MAIN_SESSION_DACTYLS_FLAG_PATH = dactylsFlag;
    options.env.DISPATCHER_HOME = home;
    if (codeMode) {
      const id = newChat(ground);
      const launch = await seams.askCodeModeLaunch(context, launchInput(ground, id));
      if (launch.on !== true) return { error: `the chat's launch answered ${JSON.stringify(launch).slice(0, 160)}` };
      chatConfigOf(t, launch, id);
      seams.applyCodeModeLaunch(options, launch);
    }
    const run = await runChat(t, options, "Say ok.");
    const said = api.bodies.map((body: unknown) => JSON.stringify(body)).join("\n");
    return { error: run.error, requests: api.bodies.length, match: said.match(TOLD)?.[0] ?? "" };
  };

  const today = await told(false);
  if (!today.requests) return broken(`the chat launched as today never reached the API${today.error ? `: ${today.error}` : ""}`);
  if (today.match !== ON) return cannotRun(`a chat launched as today under the scratch Dactyls switch was not told ${ON} (${today.match || "told nothing"}): this box's dactyls are not ready, so the Code Mode chat's silence would prove nothing`);

  const carried = await told(true);
  if (carried.error && !carried.requests) return broken(`the Code Mode chat did not run: ${carried.error}`);
  if (!carried.requests) return broken("the Code Mode chat never reached the API");
  if (carried.match) return broken(`the Code Mode chat was told about dactyls: its requests carry ${JSON.stringify(carried.match)}`);
  return held(`under the same Dactyls switch the chat launched as today was told ${ON} and the Code Mode chat's ${carried.requests} request(s) carried no Dactyls telling`);
});
