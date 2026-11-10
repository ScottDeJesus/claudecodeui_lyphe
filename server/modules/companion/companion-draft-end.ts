import type { CompanionSessionRef } from '@/shared/companion-types.js';

/**
 * How the draft last ended, kept so a send that finds no draft can say WHY it is gone, and a draft he took down is never mistaken for a
 * fault with a fix (operator ruling, 2026-11-09: his × is his answer, so a draft he takes down stays down). Three ways down:
 *   - `taken_down_by_him`: his × on the draft card (`companion.service.ts`' `clearDraft`);
 *   - `sent`: the brief went out, to `session`, with these `words` (trimmed), so a second send of them would send them twice (`companion-send.ts`' `afterSend`);
 *   - `cleared_by_her`: her own empty `update_draft` (`tools/draft-tools.ts`), which owes nobody an answer.
 * The store keeps it for the account (`companion-store.ts`), in memory.
 *
 * Consumed by `companion-store.ts` (holds it), `companion.service.ts`, `companion-send.ts` and `tools/draft-tools.ts` (each ends the draft one of these ways).
 */
export type CompanionDraftEnd =
  | { kind: 'taken_down_by_him' }
  | { kind: 'sent'; session: CompanionSessionRef; words: string }
  | { kind: 'cleared_by_her' };

/** What a send asked for, as far as its refusal needs it: the words it carries and the chat it names. The panel's Send carries neither. */
type AskedSend = { text?: string; chat?: CompanionSessionRef };

/** The refusal when there is nothing on record to say why no draft is held: it was never written, or she cleared it herself. */
const NO_DRAFT_SENTENCE = 'There is no draft to send. Write the brief with update_draft first, so he sees it on his screen, then send it.';

/** The refusal after his ×: his answer, so she leaves the draft down until he asks for it again (her directive says the same). */
const TAKEN_DOWN_SENTENCE = 'He took the draft down from his screen, so nothing was sent. That is his answer: leave it down unless he asks for it again.';

/**
 * Whether a send that found no draft is asking for the one that went: its words are the words that went (or it carries none, as the panel's Send
 * does) and the chat it names, if any, is the chat they went to. Any other send is a brief that was never drafted, of which "it already went" is untrue.
 */
function asksForSentDraft(sent: Extract<CompanionDraftEnd, { kind: 'sent' }>, asked: AskedSend): boolean {
  const sameWords = asked.text === undefined || asked.text.trim() === sent.words;
  const sameChat = asked.chat === undefined || asked.chat.sessionId === sent.session.sessionId;
  return sameWords && sameChat;
}

/**
 * The sentence a send, as `asked`, is refused with when no draft is held, by how the draft last ended (`null`: nothing is on record). A send of
 * words that never went gets the plain sentence even after a send, because there is no such draft to have gone. Consumed by `companion-send.ts`.
 */
export function noDraftSentence(ended: CompanionDraftEnd | null, asked: AskedSend): string {
  if (ended === null) return NO_DRAFT_SENTENCE;
  switch (ended.kind) {
    case 'taken_down_by_him':
      return TAKEN_DOWN_SENTENCE;
    case 'sent':
      return asksForSentDraft(ended, asked) ? `That draft already went to ${ended.session.name}, so nothing was sent twice.` : NO_DRAFT_SENTENCE;
    case 'cleared_by_her':
      return NO_DRAFT_SENTENCE;
    default: {
      const unhandled: never = ended;
      throw new Error(`A draft ending this build does not know: ${JSON.stringify(unhandled)}`);
    }
  }
}
