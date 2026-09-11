import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { timeTokenLength } from '@/modules/chat/transcript/shapes/detect';
import { renderInline } from '@/modules/chat/transcript/shapes/elements/inlineText';
import { liftLeadingToken, renderedListItems } from '@/modules/chat/transcript/shapes/listItems';
import { ShapeFrame } from '@/modules/chat/transcript/shapes/ShapeFrame';

type TimelineProps = {
  /** True when the author wrote an `ol`. The shape re-emits the element they chose. */
  ordered: boolean;
  collapseKey: string;
  /** The rendered `li` elements. Every one of them opens with a time — that is the rung's trigger. */
  children: ReactNode;
};

/**
 * A list whose every item opens with a time, drawn as a vertical rail with one dot per entry.
 *
 * Used by `elements/list.tsx` and nothing else. The leading token is lifted out of the item's FIRST
 * text node and set above the entry as a muted label; everything after it is the item's own
 * rendered children, so an entry naming a `code` span or a link keeps it. An item this walk cannot
 * open is drawn whole, with no label above it — its time is still on screen, in the author's own
 * sentence, which is the only outcome the no-swallow promise allows.
 *
 * **The label is the operator's own text, verbatim.** Nothing here parses a token into a `Date` and
 * reformats it: `4:12 PM`, `14:05` and `Sep 10` are three things a person wrote and three things a
 * person should read back. A `Date` round-trip would also have to invent a timezone and a year that
 * the text never carried, and it would silently normalise away the one detail — a bare clock with
 * no date — that tells the reader these entries are all from the same day.
 *
 * The rail and the dot are painted from `border-border` and `bg-muted-foreground`, which are the
 * Tailwind names mapped to the Verve tokens: a timeline is one of the two shapes `src/shared/ui/`
 * has not built yet, so it is drawn from tokens here and moves the day a second module wants one.
 */
export function Timeline({ ordered, collapseKey, children }: TimelineProps) {
  const { t } = useTranslation('chat');
  const items = renderedListItems(children);
  // The author's own element, not the one a timeline "ought" to be. A `-` list read as a timeline
  // is still the unordered list they wrote, and silently promoting it to an `ol` announces a
  // sequence they never claimed — the same loss in the other direction as demoting an `ol`.
  const List = ordered ? 'ol' : 'ul';

  return (
    <ShapeFrame kind="timeline" title={t('shapes.titles.timeline')} collapseKey={collapseKey}>
      {/* The rail is the list's own left border, so it can never fall out of step with the entries
          it runs beside — no absolute track to measure, and it grows with the content. */}
      <List data-timeline-rail className="m-0 ml-1 list-none border-l border-border p-0 pl-4">
        {items.map((item, index) => {
          const lifted = liftLeadingToken(item.props.children, timeTokenLength);
          return (
            <li key={index} className="relative pb-2.5 last:pb-0">
              {/* `ring-card` is what lets the dot sit ON the rail rather than beside it: the ring
                  paints the frame's own background over the line behind the dot. */}
              <span
                data-timeline-dot
                aria-hidden="true"
                className="absolute -left-[1.3125rem] top-1.5 h-2 w-2 rounded-full bg-muted-foreground ring-2 ring-card"
              />
              {lifted ? (
                <div className="text-xs font-medium tabular-nums text-muted-foreground">{lifted.token}</div>
              ) : null}
              {/* Through `renderInline` for the reason `CheckResults` gives: this shape draws its
                  own entry instead of letting `ShapeListItem` draw the `li`, so the Phase 9 seam
                  would otherwise never run on a timeline entry. */}
              <div className="text-sm text-foreground">
                {renderInline(lifted ? lifted.rest : item.props.children)}
              </div>
            </li>
          );
        })}
      </List>
    </ShapeFrame>
  );
}
