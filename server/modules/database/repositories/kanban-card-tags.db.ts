import { getConnection } from '@/modules/database/connection.js';

/**
 * The card/tag join table — its own repository, because a lane page reads tags for FIFTY cards at
 * once and that read has nothing in common with a card's own row.
 *
 * `kanban_card_tags` is `(card_id, tag)` with a composite primary key and no id of its own, which
 * is what makes both writes idempotent for free: re-adding a tag is a no-op the primary key
 * absorbs, and removing one that is not there is a delete of nothing. Neither write needs to look
 * first, so neither can lose a race by looking.
 *
 * Consumers: `kanban-cards.service.ts` (the tag verbs and the lane page's batch read) and the
 * Descent importer. Reach it through `@/modules/database/index.js`.
 */
export const kanbanCardTagsDb = {
  /**
   * Every tag of every named card, in ONE query, grouped by card id.
   *
   * A lane page asks for fifty cards; a query per card would be fifty round trips for a field the
   * face renders in a single line. Cards with no tags are absent from the map rather than present
   * with an empty array — the caller is reading a page it already has the ids for, so "no entry"
   * and "no tags" are the same answer and one of them is cheaper to build.
   *
   * An empty id list returns an empty map without touching the database: `IN ()` is a syntax
   * error in SQLite, and an empty page is the ordinary case at the end of a lane.
   */
  listTagsForCards(cardIds: string[]): Map<string, string[]> {
    const tagsByCard = new Map<string, string[]>();
    if (cardIds.length === 0) return tagsByCard;

    const db = getConnection();
    const placeholders = cardIds.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT card_id, tag FROM kanban_card_tags
         WHERE card_id IN (${placeholders})
         ORDER BY card_id ASC, tag ASC`
      )
      .all(...cardIds) as { card_id: string; tag: string }[];

    for (const row of rows) {
      const tags = tagsByCard.get(row.card_id);
      if (tags) {
        tags.push(row.tag);
      } else {
        tagsByCard.set(row.card_id, [row.tag]);
      }
    }

    return tagsByCard;
  },

  /**
   * Adds one tag to one card. Already there is not an error — the same tag twice is one tag.
   *
   * `INSERT OR IGNORE` rather than a read-then-branch: the primary key is the arbiter, so two
   * panels tagging the same card at once both come back clean.
   */
  addTag(cardId: string, tag: string): void {
    getConnection()
      .prepare('INSERT OR IGNORE INTO kanban_card_tags (card_id, tag) VALUES (?, ?)')
      .run(cardId, tag);
  },

  /**
   * Removes one tag from one card. A tag that is not there is already the desired state, so this
   * reports nothing and throws nothing.
   */
  removeTag(cardId: string, tag: string): void {
    getConnection()
      .prepare('DELETE FROM kanban_card_tags WHERE card_id = ? AND tag = ?')
      .run(cardId, tag);
  },
};
