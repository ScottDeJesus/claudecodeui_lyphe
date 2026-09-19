import { useId } from 'react';
import type { ReactNode } from 'react';

import { Button } from '@/shared/ui/Button';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/Dialog';
import type { ConfirmDialogAction } from '@/shared/types';

type ConfirmDialogProps = {
  open: boolean;
  /** The question, drawn as the dialog's visible serif title and announced as its name. */
  title: string;
  /** The sentence that says what is at stake — which file, which work. */
  message: ReactNode;
  /** The answers, drawn left to right in the order given; the caller decides which is which. */
  actions: ConfirmDialogAction[];
  /** Escape and a press on the backdrop both land here, so backing out never needs a button. */
  onDismiss: () => void;
};

/**
 * Verve's ConfirmDialog: a question that stops the reader before work is lost, with every answer
 * spelled out as a button.
 *
 * Used by the file-editor module (closing an editor with unsaved changes) and the file-manager
 * module (opening another file, or editing in another project, while a file has unsaved changes).
 * Verve draws it (`Verve Design System.dc.html`, ConfirmDialog), which is why it lives here rather
 * than being composed at each site.
 *
 * It is `Dialog` and nothing else underneath, so the focus trap, the Escape ownership and the
 * backdrop come from one place: both of the dialog's own ways to close arrive as
 * `onOpenChange(false)`, which is routed to `onDismiss`. The title is VISIBLE — `DialogTitle` is
 * screen-reader-only by default — and names the dialog through `aria-labelledby`.
 *
 * Below `md` each answer is 44px tall (Verve's touch minimum) and the row wraps rather than
 * running off a phone screen when three long labels do not fit on one line.
 */
export function ConfirmDialog({ open, title, message, actions, onDismiss }: ConfirmDialogProps) {
  const titleId = useId();

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onDismiss(); }}>
      <DialogContent aria-labelledby={titleId} className="w-[calc(100vw-2rem)] max-w-[380px] px-7 py-[26px]">
        <DialogTitle id={titleId} className="not-sr-only mb-2.5 font-serif text-2xl font-normal leading-tight">
          {title}
        </DialogTitle>
        <div className="mb-[22px] text-sm leading-relaxed text-muted-foreground">{message}</div>
        <div className="flex flex-wrap justify-end gap-2.5">
          {actions.map((action) => (
            <Button
              key={action.label}
              type="button"
              variant={action.variant}
              disabled={action.busy}
              aria-busy={action.busy || undefined}
              className="max-md:h-11"
              onClick={action.onSelect}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
