import { NotesList } from '@/modules/notes/NotesList';
import { ScrollArea } from '@/shared/ui';

/**
 * The Notes tab's pane: the wall of notes, under the screen's own head (`ScreenHead`, which names it), with no header of its own:
 * the name it carried is the head's, and the wall shows how many notes there are by itself.
 *
 * Used by `src/modules/project-workspace` (`WorkspaceMain`), which mounts it as the Notes tab's
 * pane.
 *
 * ONE INSET FOR THE WHOLE BODY: what is in the pane is a wall of cards.
 */
export function NotesPanel() {
  return (
    <div data-notes-panel className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="px-4 py-5 lg:px-6">
          <NotesList />
        </div>
      </ScrollArea>
    </div>
  );
}
