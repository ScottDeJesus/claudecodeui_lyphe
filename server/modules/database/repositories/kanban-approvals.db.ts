import { getConnection } from '@/modules/database/connection.js';
import type { KanbanStatus } from '@/shared/kanban-types.js';

/**
 * A card's approval, in the one statement the approve gate writes.
 *
 * It is a sibling of `kanban-cards.db.ts` rather than another statement in it because that file is
 * at the module's ceiling, and because this statement has a single caller and a single purpose:
 * `kanban-questions.service.ts`'s `approveCard` and `unapproveCard` are the only verbs that touch
 * these columns, and both write them through here.
 *
 * Consumers: `kanban-questions.service.ts` (`approveCard` and `unapproveCard`). Reach it
 * through `@/modules/database/index.js`. The statement runs on the caller's connection, so one
 * issued inside the write seam's transaction joins that transaction rather than opening a second.
 */
export const kanbanApprovalsDb = {
  /**
   * Records a card's approval, and promotes it in the SAME statement when asked.
   *
   * Approving a `not_ready` card passes the gate and moves it to `todo` in one write — one
   * statement, so the promotion cannot land without the approval or the other way round. The
   * promotion deliberately leaves `sort_order` alone: promoting a card is not a move, and a card
   * restacked to the bottom of a lane every time it was approved would lose the place its author
   * put it in.
   *
   * Un-approving clears the stamp with the flag, and clears nothing else: withdrawing an approval
   * does not un-promote the card.
   *
   * The boolean is the usual refusal channel — false means there was no such card.
   */
  setApproved(input: { id: string; approved: boolean; promoteTo?: KanbanStatus }): boolean {
    const now = new Date().toISOString();
    const assignments = ['approved = ?', 'approved_at = ?', 'updated_at = ?'];
    const values: (string | number | null)[] = [
      input.approved ? 1 : 0,
      input.approved ? now : null,
      now,
    ];

    if (input.promoteTo !== undefined) {
      assignments.push('status = ?');
      values.push(input.promoteTo);
    }
    values.push(input.id);

    const result = getConnection()
      .prepare(`UPDATE kanban_cards SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values);

    return result.changes > 0;
  },
};
