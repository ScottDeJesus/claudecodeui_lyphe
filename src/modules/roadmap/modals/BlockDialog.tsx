import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRoadmapWrites } from '@/modules/roadmap/hooks/useRoadmapWrites';
import { useReturnFocus } from '@/shared/hooks/useReturnFocus';
import { Button, Dialog, DialogContent, DialogTitle, Field, Input } from '@/shared/ui';
import { roadmapTextBreak } from '@/shared/utils';

/** A reason's fence (`roadmap-write.service.ts`): one line of at most this many characters. `maxLength` counts UTF-16 units, so it can stop an emoji-heavy reason short of the lane's limit but never lets one past it; a line break it cannot see is `whyBreak`'s. */
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
  const writes = useRoadmapWrites();
  useReturnFocus();

  // The reason as typed. Local to the form: nothing outside needs it until Mark blocked sends it, and a refusal must leave it as typed.
  const [why, setWhy] = useState('');
  // The mark is out, so Mark blocked shows busy and the ways out wait for its answer: the write is already at the dispatcher.
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const landed = await writes.block({ kind, name: item.name, why: why.trim(), itemTitle: item.title });
    // A landed mark closes the dialog, so the busy flag has no later reader; a refusal keeps the form open, with the reason as typed, for another try.
    if (landed) onClose(true);
    else setBusy(false);
  };

  // The lane's other fence, met before anything is sent: a reason holding a line break an `<input>` lets through (U+2028…)
  // is marked invalid with its sentence, and Mark blocked waits, instead of the lane's 400 being the first word on it.
  const whyBreak = roadmapTextBreak(why.trim(), WHY_MAX, true);
  const ready = why.trim() !== '' && whyBreak === null;
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

          <Field
            label={t('roadmap.dialog.block.reason')} htmlFor={fieldId} helper={t('roadmap.dialog.block.hint')}
            error={whyBreak === null ? undefined : t(`roadmap.dialog.fence.${whyBreak}`, { max: WHY_MAX })}
          >
            <Input
              id={fieldId} value={why} maxLength={WHY_MAX} invalid={whyBreak !== null} aria-required="true" aria-describedby={`${fieldId}-helper`} autoComplete="off"
              onChange={(event) => setWhy(event.target.value)}
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
