import type { TFunction } from 'i18next';
import { Loader2 } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AFFECTED_AREAS_LANE_FAULTS, MARK_NOTE_MAX } from '@/shared/constants';
import type { Tone } from '@/shared/types';
import { Banner, Button } from '@/shared/ui';
import { cn } from '@/shared/utils';

type JudgmentPressProps = Omit<ComponentProps<typeof Button>, 'variant' | 'size'> & {
  /** The look the press gives the area, from the region-look table (`utils/regionLook.ts`): never the button's own paint. */
  tone: Tone;
  /** The press's mark (✓, ✕): it carries the state in greyscale, where the tone cannot. */
  glyph: ReactNode;
  /** This press's own mark is out: its glyph turns into the waiting ring, and it refuses a second press. */
  out?: boolean;
};

/**
 * A JUDGMENT PRESS: a `Button` that wears the look the area takes when it is pressed — Confirm in the confirmed
 * area's green, Not a change in the set-aside grey — so the press and the redraw that answers it speak one colour.
 *
 * The tone is the region-look table's, handed in as `data-tone`, and reaches paint through the tone swap's own names
 * (`bg-tone-soft`, `text-tone-ink`, `ring-tone-dot`; MAN-739 rule 4): the button is drawn without a variant, because
 * every variant carries a colour of its own and an accent hover that would turn a grey press green under the pointer.
 * `busy` (any press of the bar out) dims it and refuses the press while keeping its focus; `out` is the one that went.
 *
 * Used by the affected-areas module's `MarkPresses` (Confirm, Not a change), `FacePhoto` (Save) and
 * `UnderstandingVerdict` (Right, Wrong).
 */
export function JudgmentPress({ tone, glyph, out = false, busy = false, className, children, ...rest }: JudgmentPressProps) {
  return (
    <Button
      {...rest}
      variant={null}
      size="sm"
      data-tone={tone}
      busy={busy || out}
      className={cn('bg-tone-soft text-tone-ink ring-1 ring-inset ring-tone-dot/45 hover:bg-tone-dot/20 max-md:h-11', className)}
    >
      {out ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : glyph}
      {children}
    </Button>
  );
}

/** The engine's refusals the marks routes answer (`judgment/marks.py`), each with its own sentence. */
const ENGINE_REFUSALS: readonly string[] = [
  'not_a_person', 'no_region', 'no_read', 'no_image', 'bad_verdict', 'bad_class', 'same_class', 'bad_box', 'note_too_long',
];


/**
 * A refused press in one plain sentence: the engine's reason (`not_a_person`, `bad_class`, …), the lane's fault, a
 * press that got no usable answer (`failed`), or a reason the screen does not know, named as it came.
 */
function refusalWords(reason: string, t: TFunction): string {
  if (ENGINE_REFUSALS.includes(reason) || reason === 'failed') return t(`affectedAreas.mark.refused.${reason}`, { max: MARK_NOTE_MAX });
  // The lane's own faults are said in the Tours view's words for them, whatever was pressed.
  if (AFFECTED_AREAS_LANE_FAULTS.some((fault) => fault === reason)) return t(`affectedAreas.trouble.${reason}`);
  return t('affectedAreas.mark.refused.other', { reason });
}

/**
 * A press's key on the Mark screen, drawn inside the press it presses ("✓ Confirm  Y"), so no letter has to be mapped
 * to a button. Shown only where a pointer hovers (where a keyboard is to hand); it takes its ink from the press.
 *
 * Used by the affected-areas module's `MarkPresses` (Y, R, N) and `MarkQueue` (S, on Skip).
 */
export function KeyCap({ letter }: { letter: string }) {
  return (
    <kbd className="ml-0.5 hidden min-w-[18px] rounded-[4px] bg-background/70 px-1 text-center font-mono text-[10.5px] font-semibold leading-4 [@media(hover:hover)]:inline-block">
      {letter}
    </kbd>
  );
}

/**
 * WHY A MARK WAS NOT KEPT, under the presses that sent it: "A mark has to come from a person", "That kind is not in
 * the codebook". A warn banner (MAN-739: warn covers errors; red is kept for destructive or denied), an alert heard
 * when it mounts. It has no way out of its own: the next press is the retry, and clears it.
 *
 * Used by the affected-areas module's `MarkPresses`, `FacePhoto` and `UnderstandingVerdict`.
 */
export function MarkRefusal({ reason }: { reason: string }) {
  const { t } = useTranslation();
  return (
    <div role="alert" data-mark-refusal={reason}>
      <Banner tone="warn">
        <p className="text-sm font-medium">{refusalWords(reason, t)}</p>
      </Banner>
    </div>
  );
}
