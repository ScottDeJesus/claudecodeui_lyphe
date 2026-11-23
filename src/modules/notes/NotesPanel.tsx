import { NotesList } from '@/modules/notes/NotesList';
import { SCREEN_FRAME } from '@/shared/constants';
import { ScrollArea } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * The Notes tab's pane: the wall of notes, under the screen's own head (`ScreenHead`, which names it), with no header of its own:
 * the name it carried is the head's, and the wall shows how many notes there are by itself.
 *
 * Used by `src/modules/project-workspace` (`WorkspaceMain`), which mounts it as the Notes tab's
 * pane.
 *
 * ONE FRAME FOR THE WHOLE BODY: what is in the pane is a wall of cards, built in the page's frame (`SCREEN_FRAME`) its head keeps
 * to, so at a wide desk the wall is as wide as the head over it and its first card stands under the arrow.
 */
export function NotesPanel() {
  return (
    <div data-notes-panel className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className={cn(SCREEN_FRAME, 'pb-5 pt-2 finger:pt-4')}>
          <NotesList />
        </div>
      </ScrollArea>
    </div>
  );
}
