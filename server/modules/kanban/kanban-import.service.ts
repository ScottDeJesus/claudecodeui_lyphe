import type { KanbanImportResult, KanbanWriteContext } from '@/shared/kanban-types.js';

import { mapDescentRows } from './kanban-import.mapping.js';
import { readDescentSource } from './kanban-import.transport.js';
// Imported as a namespace, deliberately: this file's whole claim is that it reaches the write
// seam EXACTLY ONCE, and `grep -c` over this file is how the phase checks that claim — naming
// the seam's export in an import statement as well would make the count two and prove nothing.
import * as writeSeam from './kanban-write.service.js';

/**
 * The Descent import, as the module's other verbs are written: read, map, and hand ONE write to
 * the seam.
 *
 * The source is read through `kanban-import.transport.ts` and never through a handle opened here
 * — this file imports no database driver at all, which the phase's first verify asserts. The rows
 * then land through the seam's ONE write, whose `mutate` callback is the whole mapping: four
 * hundred cards and twelve thousand events therefore produce ONE `import.descent` event and ONE
 * frame, carrying `card: null` and the board's lane counts, rather than tens of thousands of
 * each. Everything the mapping writes is inside that callback, so a failure anywhere in it rolls
 * the whole import back and there is no such thing as a half-imported board.
 *
 * Consumers: `routes/import.routes.ts`, and the barrel, which is how an in-process adapter calls
 * the same verb without going over HTTP.
 */
export const kanbanImportService = {
  /**
   * Imports a Descent database into this board, and returns what it read against what it wrote.
   *
   * `dbPath` defaults to the operator's own install. Everything about the source file is the
   * transport's business: a path that is not there, or holds no Descent board, is a 404 thrown by
   * the read and never reaches the write below.
   */
  importFromDescent(
    input: { dbPath?: string },
    context?: KanbanWriteContext
  ): KanbanImportResult {
    const source = readDescentSource(input);
    // Filled by the mapping, INSIDE the transaction. The seam reads this object by reference and
    // writes the audit row after `mutate` returns, so the counts land on the `import.descent`
    // event complete — which is why the mapping is handed the payload rather than returning it.
    const payload: Record<string, unknown> = {};

    return writeSeam.writeKanban(
      {
        kind: 'import.descent',
        // Resolved from the result, because which board this run is about is only known once the
        // boards have landed. The frame it broadcasts carries THAT board's fresh lane counts and
        // a null card: one import, one frame.
        boardId: (result: KanbanImportResult) =>
          result.currentBoardId ?? Object.values(result.boardIdMap)[0] ?? '',
        cardId: null,
        actor: context?.actor,
        payload,
      },
      () => mapDescentRows(source, payload)
    );
  },
};

/** What `routes/import.routes.ts` and `kanban.module.ts` take hold of. */
export type KanbanImportService = typeof kanbanImportService;
