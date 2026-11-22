import type { TFunction } from 'i18next';

import type { BugProposal, HoopSlot, HoopSlotState } from '@/shared/types';

/**
 * THE PROPOSED FEATURES AS SLOTS ON THE HOOP: the second set the bug board's instrument turns through (`BugInstrument`), beside its
 * lanes. One run for each thing a proposal can be, in this order round the hoop: Open (waiting for your call), then Promoted, Sent back
 * as a ticket and Dismissed, each absent while it holds nothing (the design system's "empty means absent"). Each proposal says, with no
 * word on screen:
 *
 * - WHERE IT STANDS by its run.
 * - WHETHER IT IS OWED A WORD by its square: an open proposal is the accent, breathing (a word is owed); a promoted one is green
 *   (finished is green); one sent back or dismissed is the frame alone.
 * - HOW MUCH IT MATTERS by how tall it stands: an open high one the band's full height, a low one the shortest. An ended one's urgency
 *   is spent: it stands short.
 *
 * Its words are read out under the hoop when it faces you: its run and its title, then its kind and its priority (and its board, when
 * every board is shown). The server's order is kept in each run: high priority first, then the oldest.
 *
 * A RUN SHOWS AT MOST `RUN_MOST` SLOTS, as the board's lanes do; past that, one more slot (`proposalMoreId`, the board's own shape)
 * whose Opening lists the rest.
 */

/** The most slots a run stands on the hoop, the "more" slot among them. */
const RUN_MOST = 24;

/** The runs in their order round the hoop, the word each is named by, and how its proposals stand. */
const RUNS: { state: BugProposal['state']; titleKey: string; drawn: HoopSlotState }[] = [
  { state: 'open', titleKey: 'kanban.proposed.state.open', drawn: 'waiting' },
  { state: 'promoted', titleKey: 'kanban.proposed.stateWord.promoted', drawn: 'done' },
  { state: 'sent-back', titleKey: 'kanban.proposed.stateWord.sent-back', drawn: 'asleep' },
  { state: 'dismissed', titleKey: 'kanban.proposed.stateWord.dismissed', drawn: 'asleep' },
];

/** How tall an open proposal stands by its priority, as a share of the band; an ended one stands as low does. */
const HEIGHT = { high: 1, medium: 0.8, low: 0.62 } as const;

/** A proposal's slot, by the proposal's id. */
export const proposalItemId = (id: number) => `proposal:${id}`;
/** The proposal a slot stands for, or null for a "more" slot. */
export const proposalIdOf = (slotId: string) => (slotId.startsWith('proposal:') ? Number(slotId.slice('proposal:'.length)) : null);
/** The slot that stands for a run's further proposals, by its run (the board's lanes use the same shape). */
export const proposalMoreId = (groupId: string) => `more:${groupId}`;

/** The proposals as the instrument draws them, and the proposals each run holds in full. */
export type ProposalHoop = {
  slots: HoopSlot[];
  /** Every proposal each run holds, in the server's order, the ones past its slots included. */
  proposalsOf: Record<string, BugProposal[]>;
  /** The run a proposal stands in, by its id, or null for one no run holds. */
  groupOf: (proposalId: number) => string | null;
};

/**
 * The proposals, as slots. `allBoards` adds each one's board to its words. `most` is the most slots a run stands, its "more" slot
 * among them: `RUN_MOST` when absent, and no end for the proposals as a list (`HoopList`).
 */
export function proposalHoop(proposals: BugProposal[], allBoards: boolean, t: TFunction, most = RUN_MOST): ProposalHoop {
  const slots: HoopSlot[] = [];
  const proposalsOf: Record<string, BugProposal[]> = {};
  const where = new Map<number, string>();
  for (const run of RUNS) {
    const held = proposals.filter((proposal) => proposal.state === run.state);
    proposalsOf[run.state] = held;
    held.forEach((proposal) => where.set(proposal.id, run.state));
    if (held.length === 0) continue;
    const groupName = t(run.titleKey);
    const overflows = held.length > most;
    const shown = overflows ? held.slice(0, most - 1) : held;
    for (const proposal of shown) {
      slots.push({
        id: proposalItemId(proposal.id),
        group: run.state,
        groupName,
        title: proposal.title,
        words: [
          t(`kanban.proposed.kind.${proposal.kind}`),
          run.state === 'open' && proposal.priority !== 'medium' ? t(`kanban.priority.${proposal.priority}`) : null,
          allBoards ? proposal.boardName : null,
        ].filter((word): word is string => word !== null).join(' · '),
        state: run.drawn,
        edge: 0,
        beads: [],
        height: run.state === 'open' ? HEIGHT[proposal.priority] : HEIGHT.low,
      });
    }
    if (overflows) {
      slots.push({
        id: proposalMoreId(run.state),
        group: run.state,
        groupName,
        title: t('kanban.ring.more', { count: held.length - shown.length, defaultValue: '{{count}} more' }),
        words: '',
        state: 'more',
        edge: 0,
        beads: [],
        height: HEIGHT.low,
      });
    }
  }
  return { slots, proposalsOf, groupOf: (proposalId) => where.get(proposalId) ?? null };
}
