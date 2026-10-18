import type { LucideIcon } from 'lucide-react';
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
 * Colour is never the whole signal (MAN-578). A round glyph carries its status's icon, a pill carries the
 * icon and the word, and a cell or square, too small for an icon, carries its shape and gives its word to
 * the tooltip and to assistive tech. Colour does not animate between statuses (MAN-739 rule 5). The
 * only motion is the failing glyph's ring, and the pulse of a fix running.
 */

/**
 * A look's icon as every mark draws it: decorative, since the word beside it or the mark's own name says
 * the status, at the one stroke that still reads at 12 px. The caller gives it its size, its flow and any
 * motion.
 *
 * Used here by `StatusGlyph` and `StatusPill`, and by every other mark drawn from a look: the rings' hub and
 * labels (`fleet/RingMarks`, `fleet/FleetRings`), a Needs-you card's run strip (`fleet/NeedFix`), Fix
 * output's pill (`sheet/FixOutput`) and the diagnosis panel's Failed pill (`sheet/DiagnosisPanel`).
 */
export function MarkIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return <Icon aria-hidden strokeWidth={2.25} className={cn('flex-none', className)} />;
}

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
 * The round glyph's three sizes, from the prototype, and the icon each holds: `sm` (a 20px round, a 12px
 * icon) a collapsed node card, `md` (24px, 14px) a Needs-you card, a check row, the lookup sentence, `lg`
 * (32px, 18px) the quiet "Nothing needs you".
 */
const GLYPH_SIZE = {
  sm: { round: 'size-5', icon: 'size-3' },
  md: { round: 'size-6', icon: 'size-3.5' },
  lg: { round: 'size-8', icon: 'size-[18px]' },
} as const;

/**
 * A status as a round glyph: the table's icon in the tone's ink, on its soft fill. While a check is
 * failing it rings with `cerberus-ring-warn`, the halo that says it needs you now; a fix running (the
 * wrench) pulses instead, since one is already on it. With reduced
 * motion it is still. It names its word to assistive tech and on hover. Pass `decorative` when the
 * word is already written beside it, so it isn't read twice. Pass `still` for the status at an
 * asked moment rather than now (a lookup), which never rings: the moment may be long past, and
 * the ring means now. Pass `label` when the mark stands for more than one word: a node updating draws
 * the fixing wrench, and says "Updating its warden", never "Fix running".
 *
 * Used by `SentenceRow` in `sheet/LookupMoment.tsx` (the status at an asked moment: `LookupSentence` and
 * `LookupMoment`), `sheet/CheckRows`, `fleet/NodeCard` and `fleet/NeedsYouCard`.
 */
export function StatusGlyph({ status, size = 'md', decorative = false, still = false, label }: {
  status: CerberusMark;
  size?: keyof typeof GLYPH_SIZE;
  decorative?: boolean;
  still?: boolean;
  label?: string;
}) {
  const { t } = useTranslation();
  const look = markLook(status);
  const word = label ?? t(look.wordKey);
  return (
    <span
      data-tone={look.tone}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': word, title: word })}
      className={cn(
        'inline-flex flex-none select-none items-center justify-center rounded-full bg-tone-soft text-tone-ink',
        GLYPH_SIZE[size].round,
        status === 'failing' && !still && 'motion-safe:animate-cerberus-ring-warn',
        status === 'fixing' && !still && FLEET_FIXING_LOOK.glyphMotion,
      )}
    >
      <MarkIcon icon={look.icon} className={GLYPH_SIZE[size].icon} />
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
 * Used by `sheet/MinuteCells` (the sheet and History), `fleet/ServiceRow` and `fleet/FleetStatusBar`
 * (its segments and the legend's key cells, drawn the same way).
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
 * Used by `fleet/NodeCard` (a collapsed card's services).
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
 * A status as a pill: its icon, then its word or the caller's own text ("2 checks need you"),
 * which is cut with an ellipsis when the pill runs out of room. It composes the library's `Badge`,
 * whose `tone` lands as `data-tone`, so a status pill and every other tone pill in the app share one
 * paint.
 *
 * Used by `sheet/RecordedResults` (the sheet and History), `sheet/SelectedCheck` (the check header)
 * and `fleet/ServiceRow`.
 */
export function StatusPill({ status, text }: { status: CerberusMark; text?: string }) {
  const { t } = useTranslation();
  const look = markLook(status);
  return (
    <Badge as="span" tone={look.tone} className="max-w-full gap-1.5 whitespace-nowrap">
      <MarkIcon icon={look.icon} className={cn('size-3.5', status === 'fixing' && FLEET_FIXING_LOOK.glyphMotion)} />
      <span className="truncate">{text ?? t(look.wordKey)}</span>
    </Badge>
  );
}
