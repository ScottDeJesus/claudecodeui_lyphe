import type { HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

import { FLEET_FIXING_LOOK, markLook } from '@/modules/cerberus/utils/cerberusStatus';
import type { CerberusCellShape, CerberusMark } from '@/shared/types';
import { Badge } from '@/shared/ui';
import { cn } from '@/shared/utils';

/*
 * THE TAB'S STATUS MARKS. Each one reads the one look table (`markLook`: `STATUS_TABLE`, and a fix running) and nothing else. Tone reaches paint only as
 * `data-tone` plus a `tone-*` Tailwind name, which the `[data-tone]` swap (tokens.css) resolves to
 * the tone's soft, ink or dot. No hex, no `rgba(` and no `var(--` appear here (MAN-739 rules 3-4).
 *
 * Colour is never the whole signal (MAN-578). A glyph carries its ✓ ▲ ✕ — ·, a pill carries the glyph
 * and the word, and a cell or square, too small for a glyph, carries its shape and gives its word to
 * the tooltip and to assistive tech. Colour does not animate between statuses (MAN-739 rule 5). The
 * only motion is the failing glyph's ring, and the pulse of a fix running.
 */

/**
 * Each cell shape's paint. Size and flow belong to the caller.
 *
 * `soft` (passing) is the bare wash, with no edge, and that is deliberate. Passing should recede: in
 * a strip, 60 washed minutes read as one calm band, and the edged, solid and dashed minutes stand
 * out of it. A tone-dot hairline was tried and measured. It made a passing square an OUTLINED
 * square, the same shape as "close to the limit" in another hue, and it turned the strip into 60
 * boxes competing with the warn minutes. A faint passing square is still named by its title and
 * accessible name, so colour is not its only sign (MAN-578).
 *
 * `flat` (not enabled) is the other fill with no edge, so its step from passing has to be LIGHTNESS,
 * not hue. At the neutral dot's 20% the two measured 1.07:1 in light and 1.10:1 in dark: in greyscale
 * a switched-off minute vanished into the passing band, and a switched-off square into its passing
 * neighbours. At 35%, rendered, they measure 1.26:1 and 1.42:1. 45% would also clear passing, but in dark
 * greyscale it sits about 5 levels from the refused red, where 35% sits about 15 clear. Either way a
 * feature that is merely switched off must never look like it needs you.
 */
const CELL_PAINT: Record<CerberusCellShape, string> = {
  soft: 'border border-transparent bg-tone-soft',
  outline: 'border border-tone-dot bg-tone-soft',
  solid: 'border border-tone-dot bg-tone-dot',
  flat: 'border border-transparent bg-tone-dot/35',
  dashed: 'border border-dashed border-tone-dot bg-transparent',
  surface: 'border border-input bg-muted',
};

/**
 * The round glyph's three sizes, from the prototype: `sm` (20px) a collapsed node card, `md` (24px)
 * a Needs-you card, a check row, the lookup sentence, `lg` (32px) the quiet "✓ Nothing needs you".
 */
const GLYPH_SIZE = {
  sm: 'size-5 text-[9px]',
  md: 'size-6 text-[10.5px]',
  lg: 'size-8 text-sm',
} as const;

/**
 * A status as a round glyph: ✓ ▲ ✕ — or · in the tone's ink, on its soft fill. While a check is
 * failing it rings with `cerberus-ring-warn`, the halo that says it needs you now; a fix running (●) pulses
 * instead, since one is already on it. With reduced
 * motion it is still. It names its word to assistive tech and on hover. Pass `decorative` when the
 * word is already written beside it, so it isn't read twice. Pass `still` for the status at an
 * asked moment rather than now (a lookup), which never rings: the moment may be long past, and
 * the ring means now.
 *
 * Used by the sheet's `LookupSentence` today, and by the fleet's cards, the sheet's check rows and
 * History as they are composed.
 */
export function StatusGlyph({ status, size = 'md', decorative = false, still = false }: {
  status: CerberusMark;
  size?: keyof typeof GLYPH_SIZE;
  decorative?: boolean;
  still?: boolean;
}) {
  const { t } = useTranslation();
  const look = markLook(status);
  const word = t(look.wordKey);
  return (
    <span
      data-tone={look.tone}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': word, title: word })}
      className={cn(
        'inline-flex flex-none select-none items-center justify-center rounded-full bg-tone-soft leading-none text-tone-ink',
        GLYPH_SIZE[size],
        status === 'failing' && !still && 'motion-safe:animate-cerberus-ring-warn',
        status === 'fixing' && !still && FLEET_FIXING_LOOK.glyphMotion,
      )}
    >
      {/* A middle dot is optically a fraction of ✓ ▲ ✕ —, and alone in its round it reads as no mark at
          all, so it is drawn larger. The glyph itself still comes from the table. */}
      {look.glyph === '·' ? <span className="text-[1.8em] leading-none">{look.glyph}</span> : look.glyph}
    </span>
  );
}

type StatusCellProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  status: CerberusMark;
  /** Its accessible name. It must say the status in words. Defaults to the bare word ("Failing"). */
  label?: string;
};

/**
 * One minute of a strip, painted in its status's cell shape. The caller gives it its size: the sheet
 * stretches it (`flex-1`), a service row fixes it (7×22). The caller also gives it its role. It is
 * an image named by its word unless the caller makes it an option of a list, as `MinuteCells` does.
 *
 * Used by the sheet's `MinuteCells` (the sheet and History), and by Fleet's service rows as they are
 * composed.
 */
export function StatusCell({ status, label, className, ...spanProps }: StatusCellProps) {
  const { t } = useTranslation();
  const look = markLook(status);
  return (
    <span
      role="img"
      aria-label={label ?? t(look.wordKey)}
      {...spanProps}
      data-tone={look.tone}
      className={cn('block rounded-[2px]', CELL_PAINT[look.cell], className)}
    />
  );
}

/**
 * A service in a collapsed node card: a 10px square in its status's cell shape. It names itself on
 * hover and to assistive tech. `label` is the service and how it stands ("Shadow connector · All 4
 * checks passing"), and defaults to the bare word.
 *
 * Used by Fleet's node cards as they are composed. The fixture sheet draws every status in it.
 */
export function StatusSquare({ status, label }: { status: CerberusMark; label?: string }) {
  const { t } = useTranslation();
  const look = markLook(status);
  const name = label ?? t(look.wordKey);
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      data-tone={look.tone}
      className={cn('block size-2.5 flex-none rounded-[3px]', CELL_PAINT[look.cell])}
    />
  );
}

/**
 * A status as a pill: its glyph, then its word or the caller's own text ("2 checks need you"),
 * which is cut with an ellipsis when the pill runs out of room. It composes the library's `Badge`,
 * whose `tone` lands as `data-tone`, so a status pill and every other tone pill in the app share one
 * paint.
 *
 * Used by the sheet's `RecordedResults` (the sheet and History), and by Fleet's service rows and the
 * sheet's check header as they are composed.
 */
export function StatusPill({ status, text }: { status: CerberusMark; text?: string }) {
  const { t } = useTranslation();
  const look = markLook(status);
  return (
    <Badge as="span" tone={look.tone} className="max-w-full gap-1.5 whitespace-nowrap">
      <span aria-hidden className={cn('flex-none', status === 'fixing' && FLEET_FIXING_LOOK.glyphMotion)}>{look.glyph}</span>
      <span className="truncate">{text ?? t(look.wordKey)}</span>
    </Badge>
  );
}
