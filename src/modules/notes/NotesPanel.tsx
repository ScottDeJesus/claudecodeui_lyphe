import { StickyNoteIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useNotes } from '@/modules/notes/context/NotesContext';
import { NotesList } from '@/modules/notes/NotesList';
import { Badge, ScrollArea } from '@/shared/ui';

/**
 * The Notes tab's pane: the header the Runner and Memory panes wear, and under it the wall.
 *
 * Used by `src/modules/project-workspace` (`WorkspaceMain`), which mounts it as the Notes tab's
 * pane — the tab's first home; the second is the chat gutter's Notes widget, which draws the same
 * list through `NotesWidgetBody`.
 *
 * THE COUNT IS THE LIST'S, DRAWN BESIDE ITS NAME. A badge at zero is not drawn: the list's own
 * empty state says "nothing" in words, and a "0" over it would say it a second time in a shape that
 * reads like a count worth checking. While the list has never been read there is no count either —
 * the pane is showing a spinner, and a zero would be a claim the read has not made yet.
 *
 * ONE INSET FOR THE WHOLE BODY, and it matches the header's: what is in the pane is a wall of
 * cards, and an inset that changed between the header and the wall would read as two panes.
 */
export function NotesPanel() {
  const { t } = useTranslation();
  const { notes } = useNotes();

  const count = notes?.length ?? 0;

  return (
    <div data-notes-panel className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-4 py-3 lg:px-6">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
          <StickyNoteIcon className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 className="text-sm font-medium">{t('notes.title')}</h2>
        {count > 0 && <Badge tone="neutral">{count}</Badge>}
      </div>
      <ScrollArea className="flex-1">
        <div className="px-4 py-5 lg:px-6">
          <NotesList />
        </div>
      </ScrollArea>
    </div>
  );
}
