import { NotesList } from '@/modules/notes/NotesList';

/**
 * The notes as the desktop chat gutter draws them: the same wall, one column of the gutter's width.
 *
 * Used by `src/modules/chat-gutters` (`ChatGutterLayout`), as the Notes widget's body. It takes no
 * props, because the list is the same in every chat: a note belongs to the account and not to the
 * conversation, so there is nothing here for a session to change. The chrome, the header, the count
 * and the scrolling belong to the frame around it — this body is the list and nothing else.
 */
export function NotesWidgetBody() {
  return (
    <div data-notes-widget className="min-w-0">
      <NotesList />
    </div>
  );
}
