/** A Bash command that ran the chat's `panel` command to show or update: the word at the start, or after a pipe, a `;`, an `&&` or an opening bracket. */
const SHOWS = /(?:^|[\s;&|(])panel\s+(?:show|update)\b/;

/** The line `panel` prints when a thing landed (`bin/panel.mjs`, `formatShowing`), whose `(id N)` names the version. */
const LANDED = /On the panel: .*\(id (\d+)\)/g;

/**
 * The version a Bash call put on the panel, or null when the call was not a `panel show` or `panel update` that landed. Read off
 * the command and what it printed: the command says it was the panel's, and the printed line carries the version's id, which is
 * never reused. A call that showed twice answers the last.
 *
 * Used by the chat module's transcript (`ChatMessagesPane`), which marks the turn where the chat put the thing there.
 */
export function panelShownIdOf(command: string, printed: string): number | null {
  if (!SHOWS.test(command)) return null;
  let id: number | null = null;
  for (const match of printed.matchAll(LANDED)) id = Number(match[1]);
  return id !== null && Number.isSafeInteger(id) ? id : null;
}
