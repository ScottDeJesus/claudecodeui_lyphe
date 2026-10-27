/**
 * The "remember" entry of a tool permission: the one string a stored rule is written as, so that the next ask of
 * the same kind matches it and is never asked.
 *
 * THE GRAMMAR is the runtime's own (`matchesToolPermission` in `claude-runtime.provider.js`): an entry is either a
 * tool's exact name, or `Bash(<prefix>:*)`, which matches a Bash command that starts with `<prefix>`. This builder
 * is the other half of that matcher: given an ask, it names the narrowest entry the matcher accepts for it — the
 * tool's name for any tool but Bash, and for Bash the command's first word (`Bash(uname:*)`), or its first two
 * for `git` (`Bash(git commit:*)`), because granting `Bash(git:*)` would grant `git push --force` along with it.
 *
 * A PORT. The chat page builds the same entry for its "Allow and remember" button
 * (`src/modules/chat/utils/chatPermissions.ts`, `buildClaudeToolPermissionEntry`), and a server file cannot import
 * across the client/server line, so the rule is written here a second time. The two must stay one rule: a stored
 * entry the page wrote and one the companion wrote have to be the same string for the same ask, or a remembered
 * answer would be asked again. A change to either is a change to both.
 *
 * Consumed (through the providers barrel) by the companion module's `answer_session`, which answers "always" with
 * this entry in the decision and in the account's `claudePermissions`.
 */

/** The command of a Bash ask's input, trimmed, or `''` when the input has none or cannot be read. A provider that stores the arguments as a JSON string is read through it. */
function bashCommandOf(toolInput: unknown): string {
  let parsed: unknown = toolInput;
  if (typeof toolInput === 'string') {
    try {
      parsed = JSON.parse(toolInput);
    } catch {
      // Not JSON: the ask carries no readable command, so the entry falls back to the whole tool.
      return '';
    }
  }
  if (parsed !== null && typeof parsed === 'object' && 'command' in parsed && typeof parsed.command === 'string') {
    return parsed.command.trim();
  }
  return '';
}

/**
 * The entry that remembers an ask of `toolName` with `toolInput`, or `null` when there is no tool to name.
 * Every tool but Bash is its own name; Bash is `Bash(<first word>:*)`, `Bash(git <subcommand>:*)` for git, and plain
 * `Bash` when the command cannot be read — the same answers as the page's builder, for the same inputs.
 */
export function buildClaudeToolPermissionEntry(toolName: string | undefined, toolInput: unknown): string | null {
  if (!toolName) return null;
  if (toolName !== 'Bash') return toolName;

  const command = bashCommandOf(toolInput);
  if (!command) return toolName;

  const tokens = command.split(/\s+/);
  if (tokens[0] === 'git' && tokens[1]) return `Bash(${tokens[0]} ${tokens[1]}:*)`;
  return `Bash(${tokens[0]}:*)`;
}
