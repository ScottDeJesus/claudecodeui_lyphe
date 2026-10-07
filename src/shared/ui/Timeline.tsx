import * as React from 'react';
import { useTranslation } from 'react-i18next';

import type { TimelineEvent } from '@/shared/types';

type TimelineProps = {
  events: TimelineEvent[];
  /**
   * `dense` is one line per row — no summary, the title cut with an ellipsis — for a card's margin. On
   * a row too narrow for the source and a readable title side by side, the title drops under the
   * source in either density, still one line when dense.
   */
  density?: 'full' | 'dense';
  /**
   * The open row's POSITION, when the caller owns it; `null` is "none open". Left out, the timeline
   * keeps its own position — and a position is all it can keep, because a `TimelineEvent` has no id.
   * So a feed that grows at its head (a newest-first activity list) must own this: an uncontrolled
   * timeline leaves the open position where it was, and the row there is by then a different event.
   * The owner shifts `openIndex` by the number of rows it prepends, or closes the row.
   */
  openIndex?: number | null;
  /** Told which row was pressed. It is the toggle when `openIndex` is given, a notification when not. */
  onToggle?: (index: number) => void;
};

/**
 * Verve's `Timeline` (`_ds_bundle.js`, components/domain/Timeline.jsx): a chronological feed, one row
 * per event — a tone dot, the source pill, the title, the summary when full, the time. Used by the
 * cerberus module: the Fleet tab's "What happened" card (dense) and the History tab's feed (full).
 *
 * Verve's one hard rule is kept: an open row is never empty. A row with no `meta` opens to a quiet
 * "No further detail on file." rather than to nothing, because an empty reveal reads as a broken row.
 *
 * The dot is `data-tone` + `bg-tone-dot` (the tone's own swap, named in tailwind.config.js) so it can
 * never disagree with a status mark drawn the same way elsewhere. Tone is never the whole signal
 * here: the title and the source carry the event in words.
 *
 * Paint is `.vv-timeline*` in verve/panels.css. This is not the transcript's `shapes/Timeline`, which
 * draws an author's own list.
 */
export function Timeline({ events, density = 'full', openIndex, onToggle }: TimelineProps) {
  const { t } = useTranslation('common');
  // The open row when the caller does not own it (`openIndex` left out): which row is showing its
  // detail, `null` for none. Opening a row closes the one before it.
  const [internalOpen, setInternalOpen] = React.useState<number | null>(null);
  const controlled = openIndex !== undefined;
  const open = controlled ? openIndex : internalOpen;
  const dense = density === 'dense';

  const toggle = (index: number) => {
    if (!controlled) setInternalOpen((current) => (current === index ? null : index));
    onToggle?.(index);
  };

  return (
    <div className="vv-timeline flex flex-col" data-density={density}>
      {events.map((event, index) => {
        const isOpen = open === index;
        return (
          // Keyed by position: `openIndex` is a position, and a row's identity is no more than that.
          <div key={index} className="vv-timeline__item">
            <button
              type="button"
              className="vv-timeline__row flex w-full items-start gap-2.5 text-left"
              aria-expanded={isOpen}
              onClick={() => toggle(index)}
            >
              <span data-tone={event.tone} className="vv-timeline__dot bg-tone-dot" aria-hidden />
              {/* The source and the words share one line that wraps: a row with less than 10rem left
                  for the words beside the pill drops them under it at the row's width. Side by side,
                  a phone's row gave "Shadow connector" its pill and the title ~90px. */}
              <span className="flex min-w-0 flex-1 flex-wrap items-start gap-x-2.5 gap-y-1">
                <span className="vv-timeline__source max-w-full truncate">{event.source}</span>
                <span className="min-w-0 flex-[1_1_10rem]">
                  <span className="vv-timeline__title block">{event.title}</span>
                  {!dense && event.summary ? <span className="vv-timeline__summary block">{event.summary}</span> : null}
                </span>
              </span>
              <span className="vv-timeline__when">{event.when}</span>
              <span className="vv-timeline__chevron" aria-hidden>▼</span>
            </button>
            {isOpen ? (
              <div className="vv-timeline__detail">{event.meta?.trim() || t('timeline.noDetail')}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
