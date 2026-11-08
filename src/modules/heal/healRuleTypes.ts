/**
 * The Rules section's wire shapes — the heal summary's `rules` and `rules_more`, as the worker's
 * `heal_corrections.summary()` writes them.
 *
 * A RULE is one correction the operator made again in another chat, kept in HIS OWN QUOTED WORDS and
 * queued in Inbox → Memory for his press. The section reviews it — his words, where it would land, its
 * state, every row it came from — and nothing here decides anything: the decision is the memory queue's,
 * read where it lives when the summary is written.
 *
 * Its own file because `healTypes.ts` stands at its ceiling: that file imports `HealRule` from here and defines none of the three.
 */

/** One row a rule came from: the friction row's own sentence, kept even after the row leaves the ledger. */
export type HealRuleRow = {
  id: number;
  /** Epoch seconds. */
  ts: number;
  session: string | null;
  /** The transcript's folder slug, never a name: the page names the project the way CloudCLI does. */
  project: string | null;
  /**
   * How this row joined the rule: the first time he said it, said again in another chat or past the
   * hour (`returned`), said again in the same chat within the hour (`repeat`, the session not acting on
   * the first), or a row whose rule was already on a shelf (`shelf`).
   */
  how: 'first' | 'returned' | 'repeat' | 'shelf';
  /** The sentence THIS row said it in. */
  quote: string | null;
  /** The friction row is no longer in the ledger; its citation keeps its own words. */
  gone: boolean;
};

/**
 * Where a rule stands in the memory queue: staged and waiting (`pending`), filed or discarded by his
 * press, a spill file not yet swept in (`unstaged`), refused by the door (`refused`, with its words in
 * `refusal` when it gave any), nowhere to be found (`missing`), or a store that could not be opened.
 */
export type HealRuleDecision = {
  status: 'pending' | 'approved' | 'rejected' | 'unstaged' | 'refused' | 'missing' | 'unreadable';
  /** The staged candidate's id (`mc-<n>`) — what the Memory door's two presses act on. */
  candidate: string | null;
  refusal: string | null;
  /** When his press decided it: an ISO stamp. */
  decided_at: string | null;
};

/** One rule, whole: his words, where it lands, its state and every row it came from. */
export type HealRule = {
  id: number;
  /** His sentence, verbatim. A rule found already on a shelf carries that entry's own text. */
  quote: string;
  shelf: 'rules' | 'requirements' | 'memory';
  /** The project slug of a `memory` rule; null for the two house shelves. */
  project: string | null;
  /** Lifted by the heal into the queue, or found already on a shelf (or in a chat's own queued candidate). */
  state: 'queued' | 'shelf';
  /** Null for a rule bound to a shelf entry: there is no queue decision to read. */
  decision: HealRuleDecision | null;
  /** Epoch seconds the heal queued it; null for a shelf rule. */
  queued_at: number | null;
  /** Returned citations newer than the approval: he said it again after filing it. */
  returned_after_filing: number;
  rows: HealRuleRow[];
};
