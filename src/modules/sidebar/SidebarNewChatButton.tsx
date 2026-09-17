import { Plus } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '@/shared/utils';
import type { Project } from '@/shared/types';
import { useCompactSidebar } from '@/modules/sidebar/hooks/useCompactSidebar';

type SidebarNewChatButtonProps = {
  /** The project the new chat starts in; none disables the row. */
  project: Project | null;
  onNewSession: (project: Project) => void;
  t: TFunction;
};

/**
 * The simple list's New chat, drawn as one more chat row: the same pill, width, height and
 * corners as `SidebarSimpleListRow`, with a centred plus where a chat's icon and title would be,
 * and a dashed edge so an empty slot reads as a place to add rather than a chat. It sits right
 * after the last chat. The project the chat starts in is chosen on the new-chat screen, beside
 * the model.
 *
 * Its height copies the row's own: on desktop a row is `py-2` around a two-line title (16px +
 * 2px + 12px), 46px in all; on a compact sidebar it is the 44px touch floor.
 *
 * Rendered by SidebarSimpleList.
 */
export default function SidebarNewChatButton({ project, onNewSession, t }: SidebarNewChatButtonProps) {
  const isCompact = useCompactSidebar();

  return (
    <button
      type="button"
      data-testid="simple-chat-new"
      onClick={() => project && onNewSession(project)}
      disabled={!project}
      aria-label={t('simpleList.newChat')}
      title={t('simpleList.newChat')}
      className={cn(
        'flex w-full min-w-0 items-center justify-center rounded-lg border border-dashed border-border/70 px-2 text-muted-foreground transition-colors hover:border-border hover:bg-accent/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
        isCompact ? 'min-h-11' : 'h-[46px]',
      )}
    >
      <Plus className="h-4 w-4" />
    </button>
  );
}
