import os from 'node:os';
import path from 'node:path';

/**
 * Where Claude Code keeps its settings and its logins: the `CLAUDE_CONFIG_DIR` of the environment
 * the CLI is launched with, else `~/.claude`.
 *
 * Takes the environment as an argument because a chat process runs under the environment CloudCLI
 * hands it (`sdkOptions.env`), which is the one its CLI reads — not necessarily the server's own.
 * A blank value counts as unset, as it does for the CLI.
 *
 * consumers: claude-auth.provider.ts (settings and login status), claude/mcp-sign-in.ts (the MCP
 * sign-in store a chat process is launched against)
 */
export function resolveClaudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude');
}
