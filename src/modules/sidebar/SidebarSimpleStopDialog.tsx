import type { TFunction } from 'i18next';

import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';

// File-local: read only by SidebarSimpleList, which owns the pendingStop/confirmStop/cancelStop
// state this dialog is bound to.
type SidebarSimpleStopDialogProps = {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  t: TFunction;
};

/** The confirmation SidebarSimpleList opens before archiving a chat that is still running. */
export default function SidebarSimpleStopDialog({ open, onConfirm, onCancel, t }: SidebarSimpleStopDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent
        data-testid="simple-chat-stop-dialog"
        className="w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-border bg-popover p-5 shadow-2xl"
      >
        <DialogTitle>{t('simpleList.stopTitle')}</DialogTitle>
        <p className="text-sm font-medium text-foreground">{t('simpleList.stopTitle')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('simpleList.stopBody')}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button data-testid="simple-chat-stop-cancel" variant="ghost" size="sm" onClick={onCancel}>
            {t('actions.cancel')}
          </Button>
          <Button data-testid="simple-chat-stop-confirm" variant="destructive" size="sm" onClick={onConfirm}>
            {t('simpleList.stopConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
