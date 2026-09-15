import type { ChatMessage } from '@/shared/types';

/**
 * Which launcher souls belong to THIS conversation.
 *
 * A launcher soul is not an `Agent`-tool call, so it has no row of its own of the shape the pinned
 * strip already reads — the conductor starts it from a Bash call and the launcher forks a detached
 * child. What DOES land in the transcript is the launcher's own receipt line, `SOUL LAUNCHED
 * launch=<id> …`, printed by `plan-runner soul` and captured as that Bash call's result.
 *
 * OWNERSHIP IS TESTED, NEVER ASSUMED. A launch id is a string like any other, so a receipt counts
 * only when the call that produced it IS the launcher. A result that dumped another conversation
 * carries that conversation's receipts, and reading another transcript is exactly what a handoff, a
 * review and a `/resume` do — measured 2026-09-13, a session anchored seven ids it had never
 * launched, every one of them traced to a `python3 - <<'PY'` heredoc printing a sibling session's
 * transcript. Prose, a pasted transcript fence, a `grep` for the marker and the internal `soul-run`
 * half all fail the test, and failing it is safe: an id this does not anchor is merely not pinned,
 * where an id anchored wrongly is a confident lie on someone else's wall.
 *
 * THIS SCAN SEES THE LOADED ROWS ONLY, so it is not the whole answer — the same ids also arrive
 * from the server, which reads the WHOLE history for the session (`collectSessionSoulLaunches`,
 * hung on a latest page as `soulLaunches`). `mergeSoulLaunchIds` joins the two; this half is what
 * makes a soul appear the second it is launched, without waiting for a refetch.
 *
 * The ids are only ever used to LOOK UP a launch in the lane's picture (`useSoulLaunches`), so an
 * id nothing answers for draws nothing at all.
 */

/** The launcher's receipt, as the launcher prints it: the marker, the id, and nothing else of the line. */
const LAUNCHED = /SOUL LAUNCHED launch=([A-Za-z0-9._-]{1,120})/g;

/** The cheap prefix test, so the regex runs only on the few results that could match at all. */
const MARKER = 'SOUL LAUNCHED launch=';

/**
 * A COMMAND that IS the launcher, not one that mentions it.
 *
 * A conductor writes the call inside a chain (`cd /tmp/probe && PLAN_RUNNER_DEEPSEEK_FLAG_PATH=… ~/.claude/scripts/plan-runner soul --role builder …`),
 * so the chain is split and every segment is tested, with env assignments and a leading path read
 * as part of the command they prefix. `plan-runner soul` is the door; `plan-runner soul-run <id>`
 * is the detached half behind it and prints no receipt, so the space required after `soul` excludes
 * it. The rule is the server's too (`session-soul-launches.service.ts`) — the two trees cannot
 * import each other, and they must agree.
 */
const LAUNCH_SEGMENT = /^(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*\S*plan-runner\s+soul(?:\s|$)/;

/** The split of a shell chain into the commands it runs, in order. */
const CHAIN = /&&|\|\||;|\n/;

/**
 * A row's own command. A normalized row carries the tool's input object, but this module reads
 * `ChatMessage`s, where the input has been stringified for display (`useChatMessages.ts`) — so a
 * string is parsed back rather than pattern-matched, since the launcher would otherwise have to
 * match inside quoted, escaped JSON. An input that will not parse yields no command, and no
 * command means no anchor: this fails closed on purpose.
 */
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

/** Whether this command's own text starts one of the calls that goes through the launcher. */
function isLaunchCommand(command: unknown): boolean {
  if (typeof command !== 'string' || !command.includes('plan-runner soul')) {
    return false;
  }
  return command.split(CHAIN).some((segment) => LAUNCH_SEGMENT.test(segment.trim()));
}

/**
 * Every launch id the loaded rows' own launcher calls printed, in the order the rows appear, each
 * once.
 *
 * Read off the TOOL RESULTS and not off the assistant's prose: a model quoting the line back would
 * otherwise anchor a second pin for a launch that is already pinned, and the receipt is the
 * launcher's own word where a quotation is not.
 */
export function readSoulLaunchIds(messages: ChatMessage[]): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    if (message.toolName !== 'Bash' || !isLaunchCommand(readCommand(message.toolInput))) continue;
    const content = message.toolResult?.content;
    if (typeof content !== 'string' || !content.includes(MARKER)) continue;
    // `matchAll` clones the pattern, so the shared `lastIndex` of a module-level `/g` regex is
    // never left mid-string for the next transcript to start from.
    for (const match of content.matchAll(LAUNCHED)) {
      if (!ids.includes(match[1])) ids.push(match[1]);
    }
  }
  return ids;
}

/**
 * The two lists as one: the server's whole-history ids first, then whatever the loaded rows add.
 *
 * Both halves are already deduplicated and ordered oldest-first, so the join is an append with the
 * scanned ids the stored list does not already name — which keeps the array's CONTENT stable while
 * a streamed row lands, and the caller memoizes on exactly that (`useChatSessionState.ts`).
 */
export function mergeSoulLaunchIds(stored: string[], scanned: string[]): string[] {
  if (stored.length === 0) return scanned;
  if (scanned.length === 0) return stored;
  const known = new Set(stored);
  return [...stored, ...scanned.filter((id) => !known.has(id))];
}
