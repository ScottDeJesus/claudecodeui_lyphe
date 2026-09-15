import type { NormalizedMessage } from '@/shared/types.js';

/**
 * The launcher souls one conversation STARTED, read from the WHOLE history rather than from the
 * page a client asked for.
 *
 * A launcher soul (`plan-runner soul …`) is a detached child, so it streams nothing into the
 * transcript; the only thing it leaves there is the receipt its launcher printed, `SOUL LAUNCHED
 * launch=<id> …`, captured as the result of the Bash call that started it. The chat's pinned rows
 * (`src/modules/chat/transcript/PinnedSubagents.tsx`) draw that launch beside the `Agent`-tool
 * agents. They are drawn in the strip above the chat box when the desktop chat gutters are not
 * showing and in the gutter's Subagents widget while they are, and they can draw only the ids they
 * know — so this list rides on every latest-page response
 * for the same reason the agent list does (`collectSessionAgents` in
 * `session-agents.service.ts`): a page loads history from the TAIL, and a launch started early in a
 * long turn has left the window long before the soul has finished, which is exactly the moment it
 * most needs pinning. Measured 2026-09-13: at the client's real first page of 20 rows, a session
 * with seven live launches anchored none of them.
 *
 * OWNERSHIP IS THE POINT, and it is why a receipt is read off ITS OWN Bash call and never off the
 * transcript's text. A launch id is a string like any other: a tool result that dumped another
 * conversation carries that conversation's receipts, and anchoring those pins souls this chat never
 * started (found in review, 2026-09-13: one session anchoring seven ids it never launched, every
 * one of them traced to a `python3 - <<'PY'` heredoc printing a sibling session's transcript — and
 * reading another transcript is exactly what a handoff, a review and a `/resume` do). So a receipt
 * counts only when the command that produced its result IS the launcher, the one door that mints an
 * id and prints it. Prose, a pasted transcript fence, a `grep` for the marker and the internal
 * `soul-run` half all fail that test — and failing it is safe: an id this does not anchor is merely
 * not pinned, where an id it anchors wrongly is a confident lie on someone else's wall.
 */

/** The launcher's receipt, as the launcher prints it: the marker, the id, and nothing else of the line. */
const LAUNCHED = /SOUL LAUNCHED launch=([A-Za-z0-9._-]{1,120})/g;

/** The cheap test, so the regex runs only on results that could match at all. */
const MARKER = 'SOUL LAUNCHED launch=';

/**
 * A COMMAND that IS the launcher, not one that mentions it.
 *
 * A conductor writes the call in a chain (`cd /tmp/probe && PLAN_RUNNER_DEEPSEEK_FLAG_PATH=… ~/.claude/scripts/plan-runner soul --role builder …`),
 * so the chain is split and every segment is tested — env assignments and a leading path are part
 * of the segment, and only a segment that opens with the launcher qualifies. `plan-runner soul`
 * itself is the door; `plan-runner soul-run <id>` is the detached half behind it and prints no
 * receipt, so the required space after `soul` excludes it.
 */
const LAUNCH_SEGMENT = /^(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*\S*plan-runner\s+soul(?:\s|$)/;

/** The split of a shell chain into the commands it runs, in order. */
const CHAIN = /&&|\|\||;|\n/;

/** A payload bound: a session with hundreds of launches would otherwise ship every id it ever minted. */
const MAX_LAUNCHES = 40;

/** A tool call's own command, whether the provider wrote the input as an object (Claude) or a JSON string (Codex). */
function readCommand(toolInput: unknown): unknown {
  if (typeof toolInput === 'string') {
    try {
      return readCommand(JSON.parse(toolInput));
    } catch {
      return undefined;
    }
  }
  return toolInput !== null && typeof toolInput === 'object'
    ? (toolInput as Record<string, unknown>).command
    : undefined;
}

/** Whether this command's own text starts one of the calls with the launcher. */
function isLaunchCommand(command: unknown): boolean {
  if (typeof command !== 'string' || !command.includes('plan-runner soul')) {
    return false;
  }
  return command.split(CHAIN).some((segment) => LAUNCH_SEGMENT.test(segment.trim()));
}

/**
 * Every launch id this history's own launcher calls printed, oldest first, each once.
 *
 * Exported for `sessions.service.ts`, which hangs it on a latest page beside the agent list. A
 * caller with no messages, or a history whose launches were all started elsewhere, gets an empty
 * list — which is a real answer and not a missing one.
 */
export function collectSessionSoulLaunches(messages: NormalizedMessage[]): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    if (message.toolName !== 'Bash' || !isLaunchCommand(readCommand(message.toolInput))) {
      continue;
    }
    const content = message.toolResult?.content;
    if (typeof content !== 'string' || !content.includes(MARKER)) {
      continue;
    }
    // `matchAll` clones the pattern, so the module-level `/g` regex is never left mid-string for
    // the next history to start from.
    for (const match of content.matchAll(LAUNCHED)) {
      if (!ids.includes(match[1])) {
        ids.push(match[1]);
      }
    }
  }
  // The newest, when a session has outgrown the bound: the strip draws what is recent.
  return ids.slice(-MAX_LAUNCHES);
}
