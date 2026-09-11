import { useTranslation } from 'react-i18next';

import { ShapeFrame } from '@/modules/chat/transcript/shapes/ShapeFrame';

type FactCardProps = {
  /**
   * The pairs `readFactPairs` parsed, and nothing element-shaped.
   *
   * The props are the PARSED data on purpose: this shape has two callers in two different phases —
   * the list ladder here and Phase 5's paragraph ladder — and the one thing a `p` of facts and a
   * `ul` of facts have in common is the pairs. Taking a node or rendered children instead would
   * make the second caller reshape the component rather than call it.
   */
  pairs: { label: string; value: string }[];
  collapseKey: string;
};

/**
 * `**Label:** value` pairs as a key-value grid.
 *
 * Used by `elements/list.tsx`, and by `elements/paragraph.tsx` from Phase 5.
 *
 * It draws from the parsed TEXT, which everywhere else in this feature would be a regression — and
 * here is safe only because `readFactPairs` is the decline rule for BOTH halves of a pair. It
 * returns `null` unless every value is plain text AND every label is a bold holding plain text and
 * nothing else, so `**[PR 12](url):** merged` and `` **`detect.ts`:** 327 lines `` never reach this
 * component; they fall back to today's list with the link and the code span intact. The only mark
 * that CAN be here is the bare `**Label:**` bold that defines a pair, and it is redrawn as the
 * grid's own label. That — and not the value check alone, which is what this sentence used to rest
 * on — is why this shape cannot render less than the markdown it replaced.
 *
 * The label keeps the author's CASE. No `uppercase` eyebrow here, unlike the table cards' fixed
 * header words: a fact label is whatever the author bolded, often a file or an identifier, and
 * `text-transform` would show `detect.ts` as `DETECT.TS` — a name that does not exist.
 *
 * It is a grid rather than one of the shared card shells because the pairs are a single block of
 * data, not n independent things: aligning every value on one column is the whole reason a reader
 * scans a fact list faster than the sentence it came from.
 */
export function FactCard({ pairs, collapseKey }: FactCardProps) {
  const { t } = useTranslation('chat');

  return (
    <ShapeFrame kind="facts" title={t('shapes.titles.facts')} collapseKey={collapseKey}>
      {/* Two columns when there is room, one when there is not. The breakpoint is the viewport
          rather than the container: `@tailwindcss/container-queries` is not installed and this plan
          adds no dependency, and the transcript is the width of the viewport on the narrow screens
          this collapse exists for. `auto` sizes the label column to the longest label, so the
          values line up on one edge without a fixed width that a long label would overrun. */}
      <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
        {pairs.map((pair, index) => (
          // A fragment per pair, so the two cells stay adjacent in the grid's own flow. Wrapping
          // each pair in a div instead would make it one cell and collapse the alignment.
          <div key={index} className="contents">
            <dt
              data-shape-label
              className="text-xs font-medium text-muted-foreground sm:pt-0.5"
            >
              {pair.label}
            </dt>
            <dd className="m-0 min-w-0 text-sm text-foreground">{pair.value}</dd>
          </div>
        ))}
      </dl>
    </ShapeFrame>
  );
}
