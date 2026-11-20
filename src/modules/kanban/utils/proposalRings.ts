import type { TFunction } from 'i18next';

import type { AstrolabeRing, AstrolabeRingItem, AstrolabeRingState, BugProposal } from '@/shared/types';

/**
 * THE PROPOSED FEATURES AS MARKS ON RINGS: the second set the bug board's instrument turns through (`BugInstrument`), beside its
 * lanes. One ring for each thing a proposal can be, inside out: Open (waiting for your call), then Promoted, Sent back as a
 * ticket and Dismissed, each absent while it holds nothing (the design system's "empty means absent"). Each proposal says, with
 * no word on screen:
 *
 * - WHERE IT STANDS by its ring.
 * - WHETHER IT IS OWED A WORD by its mark: an open proposal is the accent with a gate held open (a word is owed); a promoted one
 *   rests fully lit, in the green (finished is green); one sent back or dismissed is a quiet hairline.
 * - HOW MUCH IT MATTERS by how tall its mark stands: an open high one taller, a low one shorter. An ended one's urgency is spent:
 *   it stands low.
 *
 * Its words wait for the plate: the ring's name, then its kind and its priority (and its board, when every board is shown), over
 * its title. The server's order is kept on each ring: high priority first, then the oldest.
 *
 * A RING HOLDS AT MOST `RING_MOST` MARKS, as the board's lanes do; past that, one more mark (`moreId`, the board's own) whose
 * Opening lists the rest.
 */

/** The most marks a ring carries, the "more" mark among them (the design system reads a ring of two to twenty-four). */
const RING_MOST = 24;

/** The rings, inside out, and the word each says on its plate. */
const RINGS: { state: BugProposal['state']; titleKey: string; drawn: AstrolabeRingState }[] = [
  { state: 'open', titleKey: 'kanban.proposed.state.open', drawn: 'waiting' },
  { state: 'promoted', titleKey: 'kanban.proposed.stateWord.promoted', drawn: 'done' },
  { state: 'sent-back', titleKey: 'kanban.proposed.stateWord.sent-back', drawn: 'idle' },
  { state: 'dismissed', titleKey: 'kanban.proposed.stateWord.dismissed', drawn: 'idle' },
];

/** How much an open proposal's priority weighs: its mark's height off its ring. */
const WEIGHT = { high: 1, medium: 0.5, low: 0.1 } as const;

/** A proposal's mark, by the proposal's id. */
export const proposalItemId = (id: number) => `proposal:${id}`;
/** The proposal a mark stands for, or null for a "more" mark. */
export const proposalIdOf = (itemId: string) => (itemId.startsWith('proposal:') ? Number(itemId.slice('proposal:'.length)) : null);
/** The mark that stands for a ring's further proposals, by its ring (the board's lanes use the same shape). */
export const proposalMoreId = (ringId: string) => `more:${ringId}`;

/** The proposals as the instrument draws them, and the proposals each ring holds in full. */
export type ProposalRings = {
  rings: AstrolabeRing[];
  /** Every proposal each ring holds, in the server's order, the ones past its marks included. */
  proposalsOf: Record<string, BugProposal[]>;
  /** The ring a proposal stands on, by its id, or null for one no ring holds. */
  ringOf: (proposalId: number) => string | null;
};

/** The proposals, as rings. `selected` is the open one, kept facing on its ring; `allBoards` adds each one's board to its plate. */
export function proposalRings(proposals: BugProposal[], selected: number | null, allBoards: boolean, t: TFunction): ProposalRings {
  const rings: AstrolabeRing[] = [];
  const proposalsOf: Record<string, BugProposal[]> = {};
  const where = new Map<number, string>();
  for (const ring of RINGS) {
    const held = proposals.filter((proposal) => proposal.state === ring.state);
    proposalsOf[ring.state] = held;
    held.forEach((proposal) => where.set(proposal.id, ring.state));
    if (held.length === 0) continue;
    const overflows = held.length > RING_MOST;
    const shown = overflows ? held.slice(0, RING_MOST - 1) : held;
    const items: AstrolabeRingItem[] = shown.map((proposal) => ({
      id: proposalItemId(proposal.id),
      label: proposal.title,
      detail: [
        t(`kanban.proposed.kind.${proposal.kind}`),
        ring.state === 'open' && proposal.priority !== 'medium' ? t(`kanban.priority.${proposal.priority}`) : null,
        allBoards ? proposal.boardName : null,
      ].filter((word): word is string => word !== null).join(' · '),
      state: ring.drawn,
      progress: ring.drawn === 'done' ? 1 : 0,
      weight: ring.state === 'open' ? WEIGHT[proposal.priority] : 0.1,
    }));
    if (overflows) {
      items.push({ id: proposalMoreId(ring.state), label: t('kanban.ring.more', { count: held.length - shown.length, defaultValue: '{{count}} more' }), weight: 0 });
    }
    const open = selected === null || where.get(selected) !== ring.state
      ? undefined
      : shown.some((proposal) => proposal.id === selected) ? proposalItemId(selected) : proposalMoreId(ring.state);
    rings.push({ id: ring.state, label: t(ring.titleKey), items, value: open });
  }
  return { rings, proposalsOf, ringOf: (proposalId) => where.get(proposalId) ?? null };
}
