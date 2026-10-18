import { Check, ChevronDown, PenLine, SquareDashed } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { JudgmentPress, MarkRefusal } from '@/modules/affected-areas/MarkPress';
import { REGION_LOOK } from '@/modules/affected-areas/utils/regionLook';
import { kindName } from '@/modules/affected-areas/utils/tourModel';
import type { Codebook, ViewEntry } from '@/shared/affected-areas-types';
import type { MissedStage, RegionShape } from '@/shared/types';
import { Badge, Button, buttonVariants, Menu, RegionImage } from '@/shared/ui';
import { cn } from '@/shared/utils';

type FacePhotoProps = {
  /** The shown face: its size is the photo's box. */
  view: ViewEntry;
  /** The face's photo as an object URL; null while it loads or when it failed (the neutral tile). */
  photo: string | null;
  alt: string;
  /** The face's regions in their looks, as the layer switch leaves them. */
  shapes: RegionShape[];
  /** The number the drawn area will take: one after the view's last region, as the engine numbers it. */
  nextOrdinal: number;
  selectedId: string | null;
  onSelect: (regionId: string) => void;
  /** The kinds the new area may take; null until the codebook answers. */
  codebook: Codebook | null;
  /** What sits at the start of the photo's tool row: the face's layer switch. */
  tools?: ReactNode;
  /** The chosen area's presses (`MarkBar`), shown under the photo while Missed one is idle and hidden while a box is
   *  drawn or held: no press of another area may stand beside the box. Hidden, not unmounted, so they come back after
   *  Save or Cancel as they were — a kept note, a mark still out and its answer or refusal. */
  bar?: ReactNode;
  stage: MissedStage;
  /** The note kept for Save; '' when there is none. */
  note: string;
  /** Why the last Save was refused; null when it was not. */
  refusal: string | null;
  /** Missed one. */
  onDraw: () => void;
  /** Cancel and Escape: no box, nothing sent. */
  onCancel: () => void;
  /** The box let go on the photo, in 0..1 of the view. */
  onDrawn: (box: [number, number, number, number]) => void;
  onKind: (cls: string) => void;
  /** Add a note (Edit the note once one is kept). */
  onNote: () => void;
  onSave: () => void;
};

/** A drawn box's four corners: the outline the engine stores for it (`add_missed` keeps the box's corners as its polygon). */
function corners([x0, y0, x1, y1]: number[]): number[][] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/**
 * THE FACE'S PHOTO, WHICH MISSED ONE TURNS INTO A BOX TO DRAG. Read top to bottom:
 * 1. The tool row: the layer switch (`tools`) at its start and Missed one at its end. While a box is being drawn it
 *    says "Drag a box around what it missed" with Cancel, the layer switch put away so the row keeps one line at a
 *    phone's width: the photo never moves under the hand that just pressed Missed one.
 * 2. The photo (`RegionImage`): its regions, and while drawing the library's box drag (mouse, pen or one finger;
 *    Escape cancels). A box released stays on the photo, numbered as it will be and in the hand-drawn look it will
 *    take, while its kind is asked; the regions under it are inert until Save or Cancel. While drawing, a line under
 *    the photo says the floor: the library ignores a box narrower or shorter than 2% of the photo, without a word of
 *    its own (`RegionDrawLayer`'s `MIN_DRAWN_SIDE`), which also keeps every box it hands over clear of the engine's
 *    1e-4 floor.
 * 3. Under the photo, ONE group of presses at a time: the chosen area's (`bar`) while Missed one is idle; once a box is
 *    held, "New area", then the kind (a `Menu` of the codebook's fourteen kinds, in its groups' order), Add a note,
 *    Save (in the hand-drawn area's tone) and Cancel. Save waits for a kind.
 * 4. Choosing an area brings this block into view, the photo and its presses together (`blockRef`, below).
 *
 * States: idle (with or without a chosen area's presses); drawing; a box held with no kind; a kind chosen; a note
 * kept; saving (Save's ring turning, the rest refusing); refused (the reason under the presses, the box and kind kept
 * for a second Save).
 *
 * Handles: `data-missed-step` (the stage) on the block, `data-missed-press` on each press (`start`, `cancel`, `kind`,
 * `note`, `save`), `data-missed-form` on the form.
 *
 * Used by the affected-areas module's `MissedDraw`, which holds Missed one's state and sends the new area.
 */
export function FacePhoto({
  view, photo, alt, shapes, nextOrdinal, selectedId, onSelect, codebook, tools, bar, stage, note, refusal, onDraw, onCancel,
  onDrawn, onKind, onNote, onSave,
}: FacePhotoProps) {
  const { t } = useTranslation();
  // The face block — the tool row, the photo and the chosen area's presses — brought into view a frame after an area is
  // chosen, no further than needed. On a phone a choice made in the list below can leave both the photo and the presses
  // off-screen, and the block fits one screen there (620 of the 799 px phone scroller with the caption, measured), so
  // the area chosen and the presses that judge it are seen together. A frame later, because the list brings its chosen
  // row into view in the same commit; at a desk the figure is sticky and this moves nothing. A ref: nothing draws from it.
  const blockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedId === null) return undefined;
    const frame = requestAnimationFrame(() => blockRef.current?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [selectedId]);
  const human = REGION_LOOK.human;
  const idle = stage.step === 'idle';
  const held = stage.step === 'drawn' || stage.step === 'saving' ? stage : null;
  const saving = stage.step === 'saving';
  const newArea = t('affectedAreas.missed.newArea', { number: nextOrdinal });
  const pending: RegionShape[] = held === null
    ? []
    : [{ id: 'missed-pending', ordinal: nextOrdinal, polygon: corners(held.box), box: held.box, tone: human.tone, edge: human.edge, wash: human.wash, label: newArea }];
  const kindWords = held?.kind ? kindName(held.kind, codebook) : t('affectedAreas.missed.chooseKind');

  return (
    <div ref={blockRef} className="flex min-w-0 flex-col gap-2" data-missed-step={stage.step}>
      <div className="flex min-h-9 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 max-md:min-h-11">
        {stage.step === 'drawing' ? (
          <>
            <p role="status" data-tone={human.tone} className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-tone-ink">
              <SquareDashed aria-hidden="true" className="size-4 flex-none" />
              {t('affectedAreas.missed.hint')}
            </p>
            <Button variant="ghost" size="sm" className="flex-none max-md:h-11" data-missed-press="cancel" onClick={onCancel}>
              {t('buttons.cancel')}
            </Button>
          </>
        ) : (
          <>
            <div className="min-w-0">{tools}</div>
            {idle && (
              <Button variant="outline" size="sm" className="flex-none max-md:h-11" data-missed-press="start" onClick={onDraw}>
                <SquareDashed aria-hidden="true" />
                {t('affectedAreas.missed.missedOne')}
              </Button>
            )}
          </>
        )}
      </div>

      <div className="ring-1 ring-border">
        <RegionImage
          src={photo}
          alt={alt}
          width={view.width}
          height={view.height}
          regions={[...shapes, ...pending]}
          selectedId={idle ? selectedId : null}
          onSelect={idle ? onSelect : undefined}
          drawing={stage.step === 'drawing' ? { onDrawn, onCancel } : null}
        />
      </div>

      {stage.step === 'drawing' && <p className="text-xs text-muted-foreground">{t('affectedAreas.missed.floor')}</p>}
      {bar ? <div hidden={!idle} className="min-w-0">{bar}</div> : null}
      {held !== null && (
        <section role="group" aria-label={newArea} data-missed-form="" className="flex min-w-0 flex-col gap-3 border-t border-border pt-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Badge as="span" tone={human.tone} className="min-w-[26px] flex-none justify-center border-dashed border-tone-dot px-1.5 font-bold tabular-nums">
              {nextOrdinal}
            </Badge>
            <span className="text-sm font-semibold text-foreground">{t('affectedAreas.missed.newAreaTitle')}</span>
            <span className="text-xs text-muted-foreground">{t(human.wordKey)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {codebook === null ? (
              <Button variant="outline" size="sm" className="max-md:h-11" disabled data-missed-press="kind">
                {kindWords}
                <ChevronDown aria-hidden="true" />
              </Button>
            ) : (
              <Menu
                trigger={(
                  <span
                    data-missed-press="kind"
                    className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'max-md:h-11', saving && 'cursor-not-allowed opacity-70')}
                  >
                    {kindWords}
                    <ChevronDown aria-hidden="true" />
                  </span>
                )}
                items={codebook.classes.map((kind) => ({ id: kind.key, label: kind.label, selected: kind.key === held.kind }))}
                onSelect={onKind}
                width={248}
              />
            )}
            <Button variant="ghost" size="sm" className="max-md:h-11" busy={saving} data-missed-press="note" onClick={onNote}>
              <PenLine aria-hidden="true" />
              {note === '' ? t('affectedAreas.mark.addNote') : t('affectedAreas.mark.editNote')}
            </Button>
            <JudgmentPress
              tone={human.tone}
              glyph={<Check aria-hidden="true" />}
              out={saving}
              aria-disabled={held.kind === null || undefined}
              data-missed-press="save"
              onClick={onSave}
            >
              {t('buttons.save')}
            </JudgmentPress>
            <Button variant="ghost" size="sm" className="max-md:h-11" busy={saving} data-missed-press="cancel" onClick={onCancel}>
              {t('buttons.cancel')}
            </Button>
          </div>
          {note !== '' && (
            <p className="line-clamp-2 text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]">{t('affectedAreas.missed.noteHeld', { note })}</p>
          )}
          {saving && <p role="status" className="sr-only">{t('affectedAreas.missed.saving')}</p>}
          {refusal !== null && <MarkRefusal reason={refusal} />}
        </section>
      )}
    </div>
  );
}
