// protects: server/modules/providers/list/claude/claude-code-mode-seams.ts, server/modules/code-mode/code-mode.service.ts, server/modules/providers/list/claude/claude-runtime.provider.js, /home/lyphe/.claude/hooks/plan_runner/code_mode/switch.py, /home/lyphe/.claude/hooks/plan_runner/code_mode/config.py
// writes: none
//
// "You only have access to two tools": a chat launched in Code Mode must reach the REAL CLI with `cm` as its one MCP
// server and, of the built-ins, only the ones a conversation keeps — and every one of those. The other cases judge the
// launch as data (the verb's answer, the options the seam writes); this one hands those options to the Claude CLI
// itself and reads its system/init, so a kept name the CLI does not know (it drops it without a word), a preset that
// survives, or a server of the operator's own ~/.claude.json loading beside `cm` (strictMcpConfig not honoured) shows
// here and nowhere else. The kept list is read from the launch (the house's `CHAT_TOOLS`), not copied here; the one
// name the CLI reports otherwise is the agent tool, `Agent` in a launch and `Task` in system/init. The switch's own
// sentence promises the chat "the to-do list", so a to-do tool (TodoWrite, or the CLI's TaskCreate) must be there too.
//
// Scratch: the database and the flags (lib/code_mode_chat.mjs); the chat's server.json folder under the house's
// code_mode/chats is removed at the end. The CLI talks to a loopback stand-in API and keeps no transcript
// (lib/code_mode_cli.mjs); it stops at system/init. No model is asked, no Gemini.

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { broken, cannotRun, held, runCase } from "../lib/case.mjs";
import { chatOptions, runChat, standInApi, text } from "../lib/code_mode_cli.mjs";
import { chatConfigOf, contextOf, launchInput, newChat, openCodeModeGround, setChatsSwitch, verbAnswers } from "../lib/code_mode_chat.mjs";

const CM_TOOLS = ["mcp__cm__search", "mcp__cm__execute"];
// system/init's name for a launch's tool name, where the two differ (measured on CLI 2.1.330).
const INIT_NAME: Record<string, string> = { Agent: "Task" };
const TODO_TOOLS = ["TodoWrite", "TaskCreate"];
// The built-ins that do work: a chat's launch must hand none of them to the CLI.
const WORK_TOOLS = ["Bash", "Read", "Edit", "Write", "MultiEdit", "NotebookEdit", "Glob", "Grep", "LS"];

function operatorServers(): string[] {
  try {
    return Object.keys(JSON.parse(readFileSync(path.join(os.homedir(), ".claude.json"), "utf8")).mcpServers ?? {});
  } catch {
    return [];
  }
}

runCase(async (t: { defer: (cleanup: () => unknown) => void }) => {
  const ground = await openCodeModeGround(t, "code-mode-real-cli-init");
  const verb = verbAnswers();
  if (!verb.chatForm) return cannotRun("the house verb has no `code-mode config --chat` form to answer a chat's launch");
  if (verb.ready !== true) return cannotRun(`the box is not ready for Code Mode, so every launch answers off: ${verb.why}`);

  let seams: Record<string, unknown>;
  try {
    await (await import("../../server/modules/code-mode/index.ts")).createCodeModeModule();
    seams = await import("../../server/modules/providers/list/claude/claude-code-mode-seams.ts");
  } catch (error) {
    return broken(`the code-mode module or the runtime's seam will not load: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
  }
  const { askCodeModeLaunch, applyCodeModeLaunch } = seams as {
    askCodeModeLaunch: (context: unknown, input: unknown) => Promise<{ on: boolean }>;
    applyCodeModeLaunch: (options: unknown, launch: unknown) => void;
  };
  const { context } = await contextOf();

  const id = newChat(ground);
  setChatsSwitch(ground, true);
  const launch = await askCodeModeLaunch(context, launchInput(ground, id)) as { on: boolean; tools?: string[] };
  if (launch.on !== true) return broken(`with the switch on and a ready box, a new chat's launch answered ${JSON.stringify(launch).slice(0, 200)}`);
  chatConfigOf(t, launch, id);

  const api = await standInApi(t, () => text("ok"));
  const options = chatOptions(ground, api, "default");
  applyCodeModeLaunch(options, launch);
  const run = await runChat(t, options, "Say ok.", { untilInit: true });
  const init = run.init as { tools?: string[]; mcp_servers?: { name: string; status: string }[] } | null;
  if (!init) return broken(`the real CLI printed no system/init on the Code Mode options${run.error ? `: ${run.error}` : ""}`);

  const wrong: string[] = [];
  const tools = [...(init.tools ?? [])].sort();
  const kept = launch.tools ?? [];
  const wanted = [...kept.map((name) => INIT_NAME[name] ?? name), ...CM_TOOLS].sort();
  const extra = tools.filter((name) => !wanted.includes(name));
  const missing = wanted.filter((name) => !tools.includes(name));
  const work = tools.filter((name) => WORK_TOOLS.includes(name));
  if (missing.length) wrong.push(`the CLI dropped ${missing.join(", ")} of the launch's tools (it knows no tool by that name)`);
  if (extra.length) wrong.push(`the CLI's init carries tools the launch did not keep: ${extra.join(", ")}`);
  if (work.length) wrong.push(`the CLI's init carries tools that do work: ${work.join(", ")}`);
  if (!tools.some((name) => TODO_TOOLS.includes(name))) wrong.push(`no to-do tool (${TODO_TOOLS.join(" or ")}) reached the CLI, though the chats switch promises the to-do list`);
  const servers = init.mcp_servers ?? [];
  const names = servers.map((s) => s.name);
  if (names.join(",") !== "cm") {
    const own = operatorServers().filter((name) => names.includes(name));
    wrong.push(`the CLI's MCP servers are ${JSON.stringify(servers)}${own.length ? ` (of the operator's own config: ${own.join(", ")})` : ""}`);
  } else if (servers[0].status !== "connected") {
    wrong.push(`cm is the one MCP server but its status is ${servers[0].status}`);
  }

  if (wrong.length) return broken(wrong.join("; "));
  return held(`the real CLI started on a Code Mode chat's options listed exactly ${wanted.length} tools (cm's two and the ${kept.length} kept, a to-do tool among them, none that does work) with cm connected as its only MCP server`);
});
