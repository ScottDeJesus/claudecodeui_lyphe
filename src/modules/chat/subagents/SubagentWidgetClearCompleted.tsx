import { CheckCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useSubagentWidgetRows } from '@/modules/chat/hooks/useSubagentWidgetRows';
import { rowId, rowRunning } from '@/modules/chat/subagents/subagentRow';

/**
 * The Subagents widget's "Clear completed", worn in the widget's HEADER.
 *
 * IN THE CHROME BECAUSE IT ACTS ON THE WHOLE CARD. The rows below it each carry their own dismissal,
 * which is the right act for one row and a chore for eight; this is the same act over every row that
 * has finished, in one store write. A control over the list belongs where the list's title is — with
 * the fold and the fullscreen switch, out of the column a reader's eye runs down looking for a row —
 * and it is the frame's business only as a SLOT: `GutterWidgetFrame` is handed this node as
 * `headerAction` and knows nothing about rows, dismissals or chats.
 *
 * A SIBLING OF THE TOGGLE, NEVER INSIDE IT. The header is a real `<button>` and it is also the drag
 * handle, so a control drawn within it could not be pressed without folding the card; this is its
 * own button beside that one. Nothing has to stop the press from travelling: the toggle is a sibling
 * that the click never enters, and the drag lives on the toggle's own `draggable`, so a press and a
 * pull here fold nothing and carry nothing.
 *
 * DRAWN ONLY WHILE A PRESS WOULD DO SOMETHING, and the rule is unchanged from the body it moved out
 * of: with every row still running there is nothing to clear, and an offer to clear nothing is a
 * control a reader has to press to learn it does nothing. Its LENGTH is the whole of the condition.
 *
 * IT SHOWS IN BOTH FOLDS — collapsed and open alike. The header is the same header either way, and
 * "a finished row is waiting" is a fact about the chat rather than about the fold: the count badge
 * beside the title already reports it, and a reader who has tidied up has the same reason to tidy up
 * from a shut card as from an open one. Hiding it while collapsed would also move the fullscreen
 * switch every time the card was folded, since both share the trailing edge of one row.
 *
 * The label is the whole of the button: there is no room for the word beside the title in a 300px
 * column, so `gutters.subagents.clearCompleted` is the accessible name and the hover title rather
 * than drawn text. The mark itself is `CheckCheck`, the sign the body's button wore.
 *
 * Used by `src/modules/chat-gutters/ChatGutterLayout.tsx`, as the Subagents widget's `HeaderAction`.
 */
export function SubagentWidgetClearCompleted({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation();
  // The rows the body below draws, from the same derivation: this component is the second reader of
  // one answer, never a second opinion about it. Reading them costs no fetch — the hook is a store
  // subscription and a filter over arrays the chat already published (`useSubagentWidgetRows`).
  const { rows, dismissMany } = useSubagentWidgetRows(sessionId);

  const finished = rows.filter((row) => !rowRunning(row));
  if (finished.length === 0) return null;

  const label = t('gutters.subagents.clearCompleted');

  return (
    <button
      type="button"
      data-testid="subagent-widget-clear-completed"
      onClick={() => dismissMany(finished.map(rowId))}
      aria-label={label}
      title={label}
      // The fullscreen switch's own measurements, so the header's trailing controls are one row of
      // one size; the action carries its own margin because the frame hands it the row's edge.
      className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <CheckCheck aria-hidden="true" className="h-4 w-4 forced-colors:text-[CanvasText]" />
    </button>
  );
}
