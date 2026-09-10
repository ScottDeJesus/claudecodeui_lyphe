import type { TFunction } from 'i18next';

import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';

// File-local: read only by SidebarSimpleList, which owns the
// pendingDelete/confirmDelete/cancelDelete state this dialog is bound to.
type SidebarSimpleDeleteDialogProps = {
  open: boolean;
  /** True when the chat is still running, so the body can say it will be stopped first. */
  isRunning: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  t: TFunction;
};

/**
 * The confirmation SidebarSimpleList opens before deleting a chat off disk.
 *
 * Separate from the stop dialog beside it because they ask different questions. Stopping is
 * recoverable and its dialog is about interrupting a run; this one is about a transcript that
 * will not come back, and it says so whether or not a run is in flight — one dialog for one
 * destructive act, rather than a yes about stopping standing in for a yes about erasing.
 */
export default function SidebarSimpleDeleteDialog({
  open,
  isRunning,
  onConfirm,
  onCancel,
  t,
}: SidebarSimpleDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent
        data-testid="simple-chat-delete-dialog"
        className="w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-border bg-popover p-5 shadow-2xl"
      >
        <DialogTitle>{t('simpleList.deleteTitle', { defaultValue: 'Delete this chat?' })}</DialogTitle>
        <p className="text-sm font-medium text-foreground">
          {t('simpleList.deleteTitle', { defaultValue: 'Delete this chat?' })}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {isRunning
            ? t('simpleList.deleteBodyRunning', {
              defaultValue: 'It is still running. It will be stopped, then its transcript removed from disk. This cannot be undone.',
            })
            : t('simpleList.deleteBody', {
              defaultValue: 'Its transcript is removed from disk. This cannot be undone.',
            })}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button data-testid="simple-chat-delete-cancel" variant="ghost" size="sm" onClick={onCancel}>
            {t('actions.cancel')}
          </Button>
          <Button data-testid="simple-chat-delete-confirm" variant="destructive" size="sm" onClick={onConfirm}>
            {t('simpleList.delete', { defaultValue: 'Delete permanently' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
