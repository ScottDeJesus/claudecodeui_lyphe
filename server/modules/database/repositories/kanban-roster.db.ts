import { getConnection } from '@/modules/database/connection.js';
import type { KanbanStatus } from '@/shared/kanban-types.js';

import { kanbanCardTagsDb } from './kanban-card-tags.db.js';

/**
 * The board's roster: every card of one board, archived and done ones included, for the
 * dispatcher's duplicate and earlier-fix search when it takes up a card.
 *
 * The lane reads (`kanban-cards.db.ts`'s `listLane`) leave archived cards out, so they cannot
 * answer that question; this read does not filter them.
 *
 * Consumers: `kanban-roster.service.ts`.
 * Reach it through `@/modules/database/index.js`.
 */

/** One card as the board's roster lists it: the fields a reader comparing cards needs, and nothing of the lane's counts. */
export type KanbanRosterCard = {
  id: string;
  title: string;
  status: KanbanStatus;
  description: string;
  closingRemarks: string;
  tags: string[];
  archived: boolean;
  updatedAt: string;
};

export const kanbanRosterDb = {
  /**
   * Every card of the board, archived and done ones included, newest change first
   * (`updated_at` DESC, then `id` DESC).
   *
   * Tags are read in ONE batch query for all of the board's cards, never one per card; a card
   * with no tags comes back with `[]`. An empty board returns `[]`, and the tag batch answers an
   * empty map for an empty id list without touching the database.
   */
  listBoardCards(boardId: string): KanbanRosterCard[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT id, title, status, description, closing_remarks, archived, updated_at
         FROM kanban_cards
         WHERE board_id = ?
         ORDER BY updated_at DESC, id DESC`
      )
      .all(boardId) as {
        id: string;
        title: string;
        status: KanbanStatus;
        description: string;
        closing_remarks: string;
        archived: number;
        updated_at: string;
      }[];

    const tagsByCard = kanbanCardTagsDb.listTagsForCards(rows.map((row) => row.id));

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      description: row.description,
      closingRemarks: row.closing_remarks,
      tags: tagsByCard.get(row.id) ?? [],
      archived: row.archived !== 0,
      updatedAt: row.updated_at,
    }));
  },
};
