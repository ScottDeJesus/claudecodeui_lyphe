import { useTranslation } from 'react-i18next';

import type { Tone } from '@/shared/types';
import { Banner, Chip } from '@/shared/ui';
import { ShapeFrame } from '@/modules/chat/transcript/shapes/ShapeFrame';

/** The four severity counts a review verdict may carry, as `parseVerdict` read them. */
type VerdictCounts = { b: number; h: number; m: number; l: number };

type VerdictBannerProps = {
  /** The author's own word, drawn verbatim. It is a protocol token, never translated. */
  verdict: 'PASS' | 'FAIL';
  /** The B/H/M/L counts, or null when the line carried none — and then no chip is drawn at all. */
  counts: VerdictCounts | null;
  collapseKey: string;
};

/**
 * The severity ladder, in the order a reviewer reads it: what blocks the merge first.
 *
 * The colour rule is the whole design: a tinted chip is a finding and a grey chip is none. So no
 * rung is `neutral` — a real Low count drawn grey would read as a zero — and Blocking and High
 * share `danger` because both are the "act now" a fix pass exists for; the WORD on each chip is
 * what tells them apart, and it is also the channel a reader in greyscale gets. The tone is only
 * worn by a count ABOVE zero; see `chipTone`.
 */
const SEVERITIES: { key: keyof VerdictCounts; label: 'blocking' | 'high' | 'medium' | 'low'; tone: Tone }[] = [
  { key: 'b', label: 'blocking', tone: 'danger' },
  { key: 'h', label: 'high', tone: 'danger' },
  { key: 'm', label: 'medium', tone: 'warn' },
  { key: 'l', label: 'low', tone: 'info' },
];

/**
 * A count of zero is not a finding, and must not look like one.
 *
 * So a zero wears the neutral ring and NO fill, and a real count wears its severity's ring AND the
 * tone's soft fill (`selected`, which on a toned chip means exactly that). Fill-or-no-fill is what
 * keeps "B:0" and "B:2" apart in greyscale too, where a ring's hue alone would not.
 */
const chipTone = (count: number, tone: Tone): { tone: Tone; selected: boolean } =>
  count > 0 ? { tone, selected: true } : { tone: 'neutral', selected: false };

/**
 * A `VERDICT: PASS` / `VERDICT: FAIL` line as a toned banner, with its B/H/M/L counts beside it.
 *
 * Used by `elements/paragraph.tsx` and nothing else. It draws from PARSED data, which is safe only
 * because the paragraph rung hands it a line whose whole text is the verdict grammar and nothing
 * else — every character the author wrote is on screen: the word in the banner, each number on its
 * chip, and "Verdict" as the frame's title.
 *
 * The strip is the shared `Banner` and the counts are the shared `Chip`, the two primitives the plan
 * names for this shape: a hand-toned div here would be one more spelling of a strip `Banner`'s own
 * contract says nobody should spell twice. PASS is `positive` and FAIL is `danger`, carried as
 * `data-tone`, so the fill, the ink and the banner's mark (✓ or ✕ — the non-colour channel) are one
 * token decision legible in both themes.
 */
export function VerdictBanner({ verdict, counts, collapseKey }: VerdictBannerProps) {
  const { t } = useTranslation('chat');

  const chips = counts ? (
    <div data-verdict-counts className="flex min-w-0 flex-wrap items-center gap-1.5">
      {SEVERITIES.map(({ key, label, tone }) => {
        const count = counts[key];
        const paint = chipTone(count, tone);
        return (
          <Chip key={key} size="sm" tone={paint.tone} selected={paint.selected}>
            {/* The space draws nothing — whitespace between flex items collapses, and `gap` spaces
                them — but it is what a screen reader and a copy-paste get: "Blocking 1", never
                "Blocking1". */}
            <span>{t(`shapes.${label}`)}</span>{' '}
            <span data-verdict-count={key} className="font-semibold tabular-nums">
              {count}
            </span>
          </Chip>
        );
      })}
    </div>
  ) : null;

  return (
    <ShapeFrame kind="verdict" title={t('shapes.titles.verdict')} collapseKey={collapseKey}>
      {/* The chips sit in the banner's MESSAGE, not its `action` slot. `Banner`'s row never wraps
          and `action` is sized for a button or two; four chips beside the word are wider than a
          phone's transcript, and measured at 390px they overlapped the word they qualify. Here
          they share one wrapping row with it: word left and chips right on a wide screen, the
          chips dropping under the word — and wrapping among themselves — on a narrow one. */}
      <Banner tone={verdict === 'PASS' ? 'positive' : 'danger'}>
        {/* `items-baseline`, so the word sits on the chips' text line and level with the banner's
            top-anchored mark, rather than centred on the taller chips and a few pixels below it. */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <span data-verdict-word className="mr-auto text-base font-semibold tracking-wide">
            {verdict}
          </span>
          {chips}
        </div>
      </Banner>
    </ShapeFrame>
  );
}
