// FILL: imports — the markers' own: react's useState beside useId, and useRoadmapWrites
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { useReturnFocus } from '@/shared/hooks/useReturnFocus';
import { Button, Dialog, DialogContent, DialogTitle, Field, Input } from '@/shared/ui';

// Each fill marker below governs the ONE statement under it, which holds a fake standing in for what the
// fill holds or does; `imports` governs the react import under it and the line the fill adds beside it.
// Every other line is composition and stays as it is.

/** A reason's fence (`roadmap-write.service.ts`): one line of at most this many characters. `maxLength` counts UTF-16 units, never fewer than the lane's code points. */
const WHY_MAX = 1000;

type BlockDialogProps = {
  /** The dispatcher's own word for what is blocked: `arc` is an epic, `plan` a feature. A roadmap is never blocked. */
  kind: 'milestone' | 'arc' | 'plan';
  /** The item: its name for the write, its title under the question. */
  item: { name: string; title: string };
  /** Closes the dialog: `true` once the store took the mark, `false` on Cancel, Escape or the backdrop. */
  onClose: (written: boolean) => void;
};

/**
 * "Why is it blocked?" — one line of reason, then `block`. The reason is the operator's own: the
 * roadmap shows it beside the item in amber until Unblock clears it, and nothing reads it, so it is
 * free words and the one thing asked. The item's title sits under the question, so a press made from a
 * menu three cards away still says which item it marks. Mark blocked waits until there is a reason.
 *
 * Mounted for as long as it is open (`useReturnFocus`). A landed mark closes it; a refusal keeps it open,
 * with the reason as typed, beside the hook's toast.
 *
 * Used by the roadmap module: `FeatureDialog` (Mark blocked…) and the Roadmap face's dialog host (Mark
 * blocked… on a milestone or an epic).
 */
export function BlockDialog({ kind, item, onClose }: BlockDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const fieldId = useId();
  useReturnFocus();

  // FILL: why — component state, with its comment: the reason as typed, empty as the dialog opens
  const why = '';
  // FILL: change — setWhy(next)
  const change = (_next: string) => {};
  // FILL: busy — component state, with its comment: the mark is out, so Mark blocked shows busy and the ways out wait for its answer
  const busy = false;
  // FILL: submit — writes.block({ kind, name: item.name, why: why.trim(), itemTitle: item.title }) with busy held; true → onClose(true); false → it stays open
  const submit = () => {};

  const ready = why.trim() !== '';
  const dismiss = () => {
    if (!busy) onClose(false);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) dismiss(); }}>
      <DialogContent aria-labelledby={titleId} data-roadmap-dialog="block" data-roadmap-kind={kind} className="w-[calc(100vw-2rem)] max-w-md p-0">
        <form
          className="flex flex-col gap-5 p-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && !busy) submit();
          }}
        >
          <header className="min-w-0">
            <DialogTitle id={titleId} className="not-sr-only font-serif text-2xl font-normal leading-tight text-foreground">
              {t('roadmap.dialog.block.title')}
            </DialogTitle>
            <p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">{item.title}</p>
          </header>

          <Field label={t('roadmap.dialog.block.reason')} htmlFor={fieldId} helper={t('roadmap.dialog.block.hint')}>
            <Input
              id={fieldId} value={why} maxLength={WHY_MAX} aria-required="true" aria-describedby={`${fieldId}-helper`} autoComplete="off"
              onChange={(event) => change(event.target.value)}
            />
          </Field>

          <footer className="flex flex-wrap justify-end gap-2.5 pt-1">
            <Button type="button" variant="ghost" className="max-md:h-11" disabled={busy} onClick={dismiss}>
              {t('roadmap.dialog.cancel')}
            </Button>
            <Button type="submit" className="max-md:h-11" disabled={!ready || busy} aria-busy={busy || undefined}>
              {t('roadmap.dialog.block.save')}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
