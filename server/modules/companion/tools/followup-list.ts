import { listCompletionClosedFollowups, listOpenFollowups } from '@/modules/followups/index.js';
import type { CompanionSessionRef } from '@/shared/companion-types.js';
import { guardedToolResult, textResult, type ToolTextResult } from '@/shared/tool-text-result.js';
import type { Followup } from '@/shared/types.js';

import type { CompanionToolDeps } from './companion-tools.js';
import { stepBrackets } from './followup-plans.js';
import { chatNameOf, resolveChat } from './house-reads.js';

/**
 * `list_followups`, and the one read of "what a chat left for him" that her alerts share with it: the open items, newest first,
 * then the items the house SETTLED when the feature, task or epic they named finished, newest first — each carrying its mark
 * (`done: feature <name> finished`, the words `followups --all` and the widget's Done fold say), so a line she reads is never taken
 * for one that still waits on him. Open items stay first. The settled items have an allowance of their own beside the open cap,
 * never the room the open ones leave: a backlog of a hundred open items would otherwise leave no room for a settled one, ever.
 * The recency is the filing order (`id`), the order her list has always used.
 *
 * Consumers: `read-tools.ts` (the `list_followups` tool) and `feeds/alert-block.ts` (the follow-ups an alert names).
 */

/** One item as she reads it: the chat it belongs to, the item as the widget maps it, and its mark — `null` while the item is open. */
export type ListedFollowup = { sessionId: string; followup: Followup; mark: string | null };

/** How many open follow-ups an all-chats `list_followups` shows: the service is asked for one more, to know whether it cut the list. */
const FOLLOWUPS_SHOWN = 20;

/** How many settled follow-ups an all-chats `list_followups` adds under the open ones. A named chat lists its settled ones whole, as the widget's Done fold does. */
const SETTLED_SHOWN = 5;

/** The most follow-ups of either kind the service answers for one chat (its own ceiling): a named chat is shown whole, as the widget shows it. */
const CHAT_FOLLOWUPS_MAX = 200;

/**
 * Up to `openLimit` of the account's open items, newest first, then up to `settledLimit` of the ones the house settled, newest first
 * (each limit held to the service's 1-200). One chat's when `appSessionId` names it, every chat's when it is `null`.
 * `settledLeftOut` is whether more settled ones exist than `settledLimit` took. Consumed here and by `feeds/alert-block.ts`.
 */
export function followupsOpenFirst(
  userId: number,
  appSessionId: string | null,
  openLimit: number,
  settledLimit: number,
): { entries: ListedFollowup[]; settledLeftOut: boolean } {
  const open: ListedFollowup[] = listOpenFollowups(userId, appSessionId, openLimit).map((entry) => ({ ...entry, mark: null }));
  // The service says whether it cut: asking it for one row more would fail at its own ceiling of 200, where a named chat reads.
  const { items, leftOut } = listCompletionClosedFollowups(userId, appSessionId, settledLimit);
  return { entries: [...open, ...items], settledLeftOut: leftOut };
}

/**
 * The closing note when a list may have been cut, saying which kind the cut took; `''` when nothing was. `open` is the open entries
 * as read (an all-chats read asked for one more than it shows), `settledLeftOut` as `followupsOpenFirst` answers it.
 */
function cutNote(open: ListedFollowup[], settledLeftOut: boolean, chat: CompanionSessionRef | null): string {
  const notes: string[] = [];
  if (chat) {
    if (open.length >= CHAT_FOLLOWUPS_MAX) notes.push(`These are the newest ${CHAT_FOLLOWUPS_MAX}; older open ones are not listed.`);
    if (settledLeftOut) notes.push(`Older settled ones are not listed.`);
  } else {
    if (open.length > FOLLOWUPS_SHOWN) notes.push(`More are open than these ${FOLLOWUPS_SHOWN}; name one chat to see its own.`);
    if (settledLeftOut) notes.push(`Older settled ones are not listed; name one chat to see its own.`);
  }
  return notes.map((note) => `\n${note}`).join('');
}

/**
 * `list_followups`: the follow-ups of one chat, or of every chat — open first, then the settled ones with their mark — one line each:
 * `chat name · next|gap · text [<plan>: <step>] · #<id>`, a settled one `chat name · next|gap · text · #<id> · [done: …]`. The text
 * is the widget's own (`Followup.text`, one plain line by construction), untouched; the id is what `close_followup` takes; and each
 * plan an OPEN item's text names as a whole word is followed by its current step (`followup-plans.ts`), once per plan, so a follow-up
 * that waits on a plan which has since shipped reads stale at a glance (a settled item says so in its mark instead). A named chat is
 * listed whole, as the widget shows it (up to the service's 200 of each kind); every chat together show the newest 20 open and the
 * newest 5 settled, and the last line says what was left out. It names a chat when one is given, but moves neither her focus nor her
 * activity: she looks at what a chat left for him in passing, while the conversation may be about another.
 * Consumed by `read-tools.ts`, which registers the tool.
 */
export function listFollowups(deps: CompanionToolDeps, args: { session?: string }): Promise<ToolTextResult> {
  return guardedToolResult('list_followups', 'read the follow-ups', async () => {
    const wanted = args.session?.trim() ?? '';
    let chat: CompanionSessionRef | null = null;
    if (wanted !== '') {
      const found = resolveChat(wanted);
      if (!found.ok) return deps.refuse(found.sentence);
      chat = found.chat;
    }
    const { entries, settledLeftOut } = followupsOpenFirst(
      deps.userId,
      chat?.sessionId ?? null,
      chat ? CHAT_FOLLOWUPS_MAX : FOLLOWUPS_SHOWN + 1,
      chat ? CHAT_FOLLOWUPS_MAX : SETTLED_SHOWN,
    );
    if (entries.length === 0) return textResult(chat ? `"${chat.name}" has no open follow-ups.` : 'No chat has an open follow-up.');
    const open = entries.filter(({ mark }) => mark === null);
    const settled = entries.filter(({ mark }) => mark !== null);
    const shownOpen = chat ? open : open.slice(0, FOLLOWUPS_SHOWN);
    const steps = await stepBrackets(deps.house, shownOpen.map(({ followup }) => followup.text));
    const nameOf = (sessionId: string): string => chat?.name ?? chatNameOf(sessionId);
    const lines = [
      ...shownOpen.map(({ sessionId, followup }, index) => `${nameOf(sessionId)} · ${followup.kind} · ${followup.text}${steps[index]} · #${followup.id}`),
      ...settled.map(({ sessionId, followup, mark }) => `${nameOf(sessionId)} · ${followup.kind} · ${followup.text} · #${followup.id} · [${mark}]`),
    ];
    const noOpen = open.length === 0 ? `${chat ? `"${chat.name}" has no open follow-ups` : 'No chat has an open follow-up'}; the house settled these:\n` : '';
    return textResult(noOpen + lines.join('\n') + cutNote(open, settledLeftOut, chat));
  });
}
