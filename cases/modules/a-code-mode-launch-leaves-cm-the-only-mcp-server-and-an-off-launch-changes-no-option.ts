// protects: server/modules/providers/list/claude/claude-code-mode-seams.ts
// writes: none
//
// "You only have access to two tools" (operator, 2026-11-20): a chat launched in Code Mode names `cm` alone as an MCP
// server, with strictMcpConfig so a settings file's servers do not load beside it, and its built-in tools are the
// house's list in place of the claude_code preset. Everything the launch already carried for the chat (its env, the
// surface's system prompt append, its allowed list) stays, with Code Mode's added after it. An off launch is today's
// launch: not one option moves (INV-8471, INV-78).
//
// Pure: applyCodeModeLaunch on plain objects.

import { broken, held, runCase } from "../lib/case.mjs";

const SEAM = "../../server/modules/providers/list/claude/claude-code-mode-seams.ts";

const chatOptions = () => ({
  tools: { type: "preset", preset: "claude_code" },
  mcpServers: { mine: { command: "my-server", args: [] }, other: { type: "http", url: "http://127.0.0.1:1/mcp" } },
  env: { PATH: "/usr/bin:/bin", CLOUDCLI_TOOLSET_TOKEN: "tok", CODE_MODE_KIND: "stale" },
  systemPrompt: { type: "preset", preset: "claude_code", append: "THE SURFACE APPEND" },
  allowedTools: ["Read", "Bash(git status)"],
  permissionMode: "default",
});

const launch = {
  on: true,
  tools: [
    "AskUserQuestion", "Agent", "Skill", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate",
    "EnterPlanMode", "ExitPlanMode", "WebSearch", "WebFetch",
  ],
  server: { command: "/usr/bin/node", args: ["--no-node-snapshot", "/x/server.mjs", "--config", "/x/server.json"] },
  prompt: "CODE MODE WORDS",
  env: { CODE_MODE_KIND: "chats", MCP_TOOL_TIMEOUT: "960000" },
};

runCase(async () => {
  let apply: (options: Record<string, any>, launch: Record<string, unknown>) => void;
  try {
    apply = (await import(SEAM)).applyCodeModeLaunch;
  } catch (error) {
    return broken(`the Code Mode seam will not load: ${String((error as Error)?.message ?? error).split("\n")[0]}`);
  }
  if (typeof apply !== "function") return broken("claude-code-mode-seams.ts exports no applyCodeModeLaunch");

  const wrong: string[] = [];

  const offOptions = chatOptions();
  apply(offOptions, { on: false });
  if (JSON.stringify(offOptions) !== JSON.stringify(chatOptions())) wrong.push(`an off launch changed the options to ${JSON.stringify(offOptions)}`);

  const on: Record<string, any> = chatOptions();
  apply(on, structuredClone(launch));
  if (JSON.stringify(on.tools) !== JSON.stringify(launch.tools)) wrong.push(`tools are ${JSON.stringify(on.tools)}, not the launch's list`);
  const servers = Object.keys(on.mcpServers ?? {});
  if (servers.join(",") !== "cm") wrong.push(`the MCP servers are [${servers.join(", ")}], not cm alone`);
  else if (JSON.stringify(on.mcpServers.cm) !== JSON.stringify(launch.server)) wrong.push(`cm is ${JSON.stringify(on.mcpServers.cm)}, not the launch's server`);
  if (on.strictMcpConfig !== true) wrong.push(`strictMcpConfig is ${JSON.stringify(on.strictMcpConfig)}`);
  if (on.env?.PATH !== "/usr/bin:/bin" || on.env?.CLOUDCLI_TOOLSET_TOKEN !== "tok") wrong.push(`the chat's own env was not kept: ${JSON.stringify(on.env)}`);
  if (on.env?.CODE_MODE_KIND !== "chats" || on.env?.MCP_TOOL_TIMEOUT !== "960000") wrong.push(`the launch's env did not land over the chat's: ${JSON.stringify(on.env)}`);
  const append = String(on.systemPrompt?.append ?? "");
  if (!append.startsWith("THE SURFACE APPEND") || !append.endsWith("CODE MODE WORDS")) wrong.push(`the append is ${JSON.stringify(append)}: not the old text followed by the launch's`);
  if (on.systemPrompt?.type !== "preset" || on.systemPrompt?.preset !== "claude_code") wrong.push("the system prompt preset changed");
  const allowed: string[] = on.allowedTools ?? [];
  if (!allowed.includes("Read") || !allowed.includes("Bash(git status)")) wrong.push(`the chat's allowed list lost an entry: ${JSON.stringify(allowed)}`);
  if (allowed.filter((tool) => tool === "mcp__cm__search").length !== 1) wrong.push(`mcp__cm__search is in the allowed list ${allowed.filter((tool) => tool === "mcp__cm__search").length} time(s)`);
  if (allowed.includes("mcp__cm__execute")) wrong.push("mcp__cm__execute was pre-allowed: a script must still reach the permission check");
  if (on.permissionMode !== "default") wrong.push(`the permission mode moved to ${on.permissionMode}`);

  if (wrong.length > 0) return broken(wrong.join("; "));
  return held("off changed no option; on left cm the only MCP server under strictMcpConfig, the house's eleven tools for the preset, the chat's env and append kept with Code Mode's after, and mcp__cm__search allowed once");
});
