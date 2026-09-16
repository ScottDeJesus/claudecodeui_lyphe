import { kanbanBoardsDb, kanbanImportDb } from '@/modules/database/index.js';
import type { KanbanImportCounts, KanbanImportResult } from '@/shared/kanban-types.js';

import {
  importTable,
  isoOrNull,
  lookup,
  skipDangling,
  stamp,
  tallyRow,
  type ImportPass,
} from './kanban-import-pass.js';
import { mapCardSatellites } from './kanban-import-satellites.js';
import type { DescentSourceRows } from './kanban-import.transport.js';

/**
 * What a Descent row BECOMES — the boards, the one setting, the cards and the tags, in order.
 *
 * It is called from inside the write seam's single transaction, which is what makes an import
 * atomic — a failure anywhere below rolls the whole thing back, and there is no such thing as a
 * half-imported board. The tables are mapped in dependency order: boards, then the one setting
 * that names a board, then cards, tags, and the card's satellites, which are their own file
 * because they translate one parent and none of them is timestamp-guarded.
 *
 * IDS ARE MINTED IN THE PASS RUNNER AND DESCENT'S OWN ARE NEVER REUSED. A source id goes to
 * `descent_id` and the row is given a LypheCLI id from the local mint — writing `f-82` as a
 * primary key would collide with a locally created card the first time one was made. Before
 * minting, the row is looked up by `descent_id`: one that is already here keeps the id it has, so
 * every question, tag and event imported beside it still points at it, and a re-import updates
 * rather than duplicates. That same lookup is what tells an insert from a refresh in the counts.
 */

/**
 * The one settings key that crosses over.
 *
 * Its twin is the private constant in `kanban-boards.service.ts`, which selects a board with it.
 * One key spelled in two files is one more home than the house wants; they move together.
 */
const CURRENT_BOARD_KEY = 'current_board';

/** The whole mapping, in dependency order. `payload` is filled with the counts; see the seam. */
export function mapDescentRows(
  source: DescentSourceRows,
  payload: Record<string, unknown>
): KanbanImportResult {
  const boards = importTable({
    table: 'kanban_boards',
    prefix: 'b',
    rows: source.boards,
    descentId: (row) => row.id,
    write: (row, id) =>
      kanbanImportDb.upsertBoard({
        id,
        name: row.name,
        sortOrder: row.sort_order,
        archived: row.archived === 1,
        // Descent's board carries no `updated_at` of its own, so its creation is the only
        // timestamp there is and stands for both. A board renamed here therefore outranks the
        // source for good, which is the same rule the cards' guard states.
        createdAt: stamp(row.created_at),
        updatedAt: stamp(row.created_at),
        descentId: row.id,
      }),
  });

  // Exactly one settings row crosses over. The other eighteen in the live source are Descent
  // daemon state — a pid, a capacity governor, a schema version, a theme — and mean nothing here.
  const sourceCurrentBoard =
    source.settings.find((row) => row.key === CURRENT_BOARD_KEY)?.value ?? null;
  const currentBoardId =
    sourceCurrentBoard === null ? null : lookup(boards.ids, sourceCurrentBoard) || null;
  const settingExisted = kanbanBoardsDb.getSetting(CURRENT_BOARD_KEY) !== null;
  if (currentBoardId !== null) kanbanBoardsDb.setSetting(CURRENT_BOARD_KEY, currentBoardId);
  const settings: ImportPass = {
    written: currentBoardId === null ? 0 : 1,
    inserted: currentBoardId !== null && !settingExisted ? 1 : 0,
    updated: currentBoardId !== null && settingExisted ? 1 : 0,
  };

  const cards = importTable({
    table: 'kanban_cards',
    prefix: 'c',
    rows: source.features,
    descentId: (row) => row.id,
    // `kanban_cards.board_id` is a real foreign key, so a feature naming a board that is not in
    // the source has nowhere to stand and is left behind with a warning.
    canLand: (row) => lookup(boards.ids, row.board_id) !== '',
    write: (row, id) =>
      kanbanImportDb.upsertCard({
        id,
        boardId: lookup(boards.ids, row.board_id),
        title: row.title,
        status: row.status,
        priority: row.priority,
        description: row.description,
        closingRemarks: row.closing_remarks,
        plan: row.plan,
        body: row.body,
        approved: row.approved === 1,
        approvedAt: isoOrNull(row.approved_at),
        archived: row.archived === 1,
        sortOrder: row.sort_order,
        buildTokensIn: row.build_tokens_in,
        buildTokensOut: row.build_tokens_out,
        buildTokensCacheRead: row.build_tokens_cache_read,
        buildTokensCacheCreate: row.build_tokens_cache_create,
        buildLeaseAt: isoOrNull(row.build_lease_at),
        buildOwner: row.build_owner,
        planLeaseAt: isoOrNull(row.plan_lease_at),
        planOwner: row.plan_owner,
        createdAt: stamp(row.created_at),
        updatedAt: stamp(row.updated_at),
        descentId: row.id,
      }),
  });

  // Descent's tags ARE its join table: the pair is the key, there is no id to mint and no third
  // column to refresh, so the statement is an ignore and a second run writes nothing at all.
  const tags: ImportPass = { written: 0, inserted: 0, updated: 0 };
  for (const row of source.tags) {
    const cardId = lookup(cards.ids, row.feature_id);
    if (cardId === '') {
      skipDangling('ov_tags', row.feature_id);
      continue;
    }
    const changes = kanbanImportDb.insertCardTag(cardId, row.tag);
    tallyRow(tags, changes > 0, changes);
  }

  // The board this run is about — the one the frame names, and the one the satellites file files
  // a card-less audit row under, because Descent's log is the install's and the install has one
  // board. `boardOfCard` is where each source card landed, for the same purpose.
  const importBoardId = currentBoardId ?? [...boards.ids.values()][0] ?? '';
  const boardOfCard = new Map(
    source.features.map((row) => [row.id, lookup(boards.ids, row.board_id)])
  );
  const satellites = mapCardSatellites({
    source,
    cards: cards.ids,
    boardOfCard,
    importBoardId,
  });

  const passes: ImportPass[] = [
    boards.pass,
    cards.pass,
    tags,
    satellites.questions.pass,
    satellites.issues.pass,
    satellites.decisions.pass,
    satellites.checklist.pass,
    satellites.attachments.pass,
    satellites.events.pass,
    settings,
  ];
  const imported: KanbanImportCounts = {
    boards: boards.pass.written,
    cards: cards.pass.written,
    tags: tags.written,
    questions: satellites.questions.pass.written,
    issues: satellites.issues.pass.written,
    decisions: satellites.decisions.pass.written,
    checklist: satellites.checklist.pass.written,
    attachments: satellites.attachments.pass.written,
    events: satellites.events.pass.written,
    settings: settings.written,
  };
  const sourceCounts: KanbanImportCounts = {
    boards: source.boards.length,
    cards: source.features.length,
    tags: source.tags.length,
    questions: source.questions.length,
    issues: source.issues.length,
    decisions: source.decisions.length,
    checklist: source.checklist.length,
    attachments: source.attachments.length,
    events: source.events.length,
    // All nineteen, against the one above: the difference is the daemon state left behind.
    settings: source.settings.length,
  };
  const result: KanbanImportResult = {
    source: sourceCounts,
    imported,
    inserted: passes.reduce((total, pass) => total + pass.inserted, 0),
    updated: passes.reduce((total, pass) => total + pass.updated, 0),
    boardIdMap: Object.fromEntries(boards.ids),
    currentBoardId,
  };

  // The seam reads `spec.payload` by reference and puts the audit row on the event AFTER `mutate`
  // returns, so the counts are written here, where they exist, rather than declared before the
  // write, where they do not.
  Object.assign(payload, {
    source: sourceCounts,
    imported,
    inserted: result.inserted,
    updated: result.updated,
  });

  return result;
}
