import { Check, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import type { SessionPickerRow } from '@/shared/types';
import { SimpleChatIconGlyph } from '@/modules/sidebar/SidebarSessionIcon';
import { chatMarks } from '@/modules/sidebar/utils/simpleChatMarks';

// File-local: read only by SidebarSessionPickerMenu, which renders one of these per conversation.
type SidebarSessionPickerRowProps = {
  row: SessionPickerRow;
  /**
   * The row stands alone (the simple list): it draws its own icon and names its project under the
   * title. Under a project heading (the tree) it is one line, because the heading already says it.
   */
  standalone: boolean;
  isCurrent: boolean;
  onPick: () => void;
};

/**
 * One conversation in the session picker, in the sidebar's own row vocabulary: the simple list's
 * icon, 13px title and 10px project line (`SidebarSimpleListRow`), the tree's single line
 * (`SidebarSessionItem`), and the same four marks — a yellow dot for a question waiting, a spinner
 * for a run, a purple dot for subagents, a blue dot for a reply not read yet — in the same order
 * and the same inks. The open conversation is filled with the sidebar's selected wash AND ticked,
 * so it survives greyscale.
 *
 * The whole row is the link (`/session/<id>`, as in the sidebar), so a plain press picks it and a
 * modified press opens it in a tab. Its ink is pinned on hover and focus: the global `a:hover` turns a
 * link the accent's green, which is this app's word for "healthy", and a hovered row is not that. It carries no rename, delete, star or reorder: those stay in
 * the sidebar. A row is 32px in a heading's block and 38px alone, and 44px under a finger.
 *
 * Used by SidebarSessionPickerMenu.
 */
export default function SidebarSessionPickerRow({ row, standalone, isCurrent, onPick }: SidebarSessionPickerRowProps) {
  const { t } = useTranslation('sidebar');
  // Which of the four marks this conversation draws, from the row's own facts — the simple list's
  // rule (`chatMarks`), with the open conversation standing in for "selected", so a row the reader
  // is looking at is never dotted unread.
  const marks = chatMarks({
    unread: row.unread,
    isSelected: isCurrent,
    isRunning: row.isRunning,
    isAwaitingInput: row.isAwaitingInput,
    isSubagentRunning: row.isSubagentRunning,
  });

  return (
    <a
      href={`/session/${row.sessionId}`}
      data-picker-item=""
      // The browser's own link drag has nothing to carry here, and would fight a press on a touch screen.
      draggable={false}
      aria-current={isCurrent ? 'true' : undefined}
      data-testid="session-picker-row"
      data-session-id={row.sessionId}
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-lg px-2 text-left text-foreground transition-colors hover:text-foreground focus-visible:text-foreground [@media(pointer:coarse)]:min-h-11',
        standalone ? 'min-h-[38px] py-1' : 'min-h-8 py-1.5',
        isCurrent ? 'bg-primary/10' : 'hover:bg-accent/60 focus-visible:bg-accent/60',
      )}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onPick();
      }}
      onKeyDown={(event) => {
        // A link answers Enter on its own; a list of choices also answers Space.
        if (event.key !== ' ') return;
        event.preventDefault();
        event.currentTarget.click();
      }}
    >
      {standalone && (
        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center text-muted-foreground">
          <SimpleChatIconGlyph icon={row.icon} className="h-4 w-4" />
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[13px] leading-4', isCurrent ? 'font-medium' : 'font-normal')}>
          {row.title}
        </span>
        {standalone && row.projectName && (
          <span className="mt-0.5 block truncate text-[10px] leading-3 text-muted-foreground">{row.projectName}</span>
        )}
      </span>

      {marks.awaitingInput && (
        <span
          role="img"
          aria-label={t('simpleList.awaitingInput')}
          title={t('simpleList.awaitingInput')}
          className="vv-pulse flex h-5 w-5 flex-shrink-0 items-center justify-center"
        >
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-warn-ink" />
        </span>
      )}

      {marks.running && (
        <span
          role="img"
          aria-label={t('simpleList.running')}
          title={t('simpleList.running')}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-muted-foreground"
        >
          <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
        </span>
      )}

      {marks.subagents && (
        <span
          role="img"
          aria-label={t('simpleList.subagentsRunning')}
          title={t('simpleList.subagentsRunning')}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center"
        >
          <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-purple-500 dark:bg-purple-400" />
        </span>
      )}

      {marks.unread && (
        <span
          role="img"
          aria-label={t('simpleList.unread')}
          title={t('simpleList.unread')}
          className="mx-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-primary"
        />
      )}

      {isCurrent && <Check aria-hidden="true" className="h-3.5 w-3.5 flex-shrink-0 text-primary" />}
    </a>
  );
}
