import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { Tone } from '@/shared/types';
import { Chip } from '@/shared/ui';
import { checkGlyphLength } from '@/modules/chat/transcript/shapes/detect';
import { renderInline } from '@/modules/chat/transcript/shapes/elements/inlineText';
import { liftLeadingToken, renderedListItems } from '@/modules/chat/transcript/shapes/listItems';
import { ShapeFrame } from '@/modules/chat/transcript/shapes/ShapeFrame';

type CheckResultsProps = {
  /** One verdict per item, in document order, as `checkGlyph` read it off the parsed text. */
  glyphs: ('pass' | 'fail')[];
  /** True when the author wrote an `ol`. The shape re-emits the element they chose. */
  ordered: boolean;
  collapseKey: string;
  /** The rendered `li` elements. Their words are what gets drawn; `glyphs` only decides the tone. */
  children: ReactNode;
};

const TONE_BY_GLYPH: Record<'pass' | 'fail', Tone> = { pass: 'positive', fail: 'danger' };

/**
 * A list of pass/fail lines as a toned checklist with its counts on top.
 *
 * Used by `elements/list.tsx` and nothing else. The glyph the author wrote is KEPT — lifted out of
 * the item's first text node by `checkGlyphLength` and redrawn as the row's mark, in that row's
 * tone — and everything after it is the item's own rendered children, so a check line naming a
 * `code` span or a link keeps it. When the glyph cannot be lifted (a list item whose text lives
 * inside something the walk does not open) the item is drawn whole and no mark is added beside it,
 * because the alternative is showing the reader the same ✓ twice.
 *
 * **The mark is announced, not hidden.** Before this shape existed the glyph was part of the item's
 * text and every screen reader read it; hiding it here would leave the row's tone as the only
 * channel carrying pass or fail, which is the single-channel failure the tone doctrine's own
 * second-channel rule exists to prevent. So the mark keeps the author's character and keeps its
 * voice, and `data-tone` only paints it.
 *
 * The counts are the shared `Chip` with a `tone`, not a hand-rolled pill: `data-tone` is what
 * paints them and what a verify script reads to prove they painted.
 */
export function CheckResults({ glyphs, ordered, collapseKey, children }: CheckResultsProps) {
  const { t } = useTranslation('chat');
  const items = renderedListItems(children);
  const passed = glyphs.filter((glyph) => glyph === 'pass').length;
  const failed = glyphs.length - passed;
  const List = ordered ? 'ol' : 'ul';

  return (
    <ShapeFrame kind="checks" title={t('shapes.titles.checks')} collapseKey={collapseKey}>
      {/* Failures first. A reader scanning a check list is looking for what broke, and the thing
          they came for should not sit behind the good news. */}
      <div data-check-counts className="mb-2 flex flex-wrap items-center gap-1.5">
        {failed > 0 ? (
          <Chip size="sm" tone="danger">
            {t('shapes.checksFailed', { count: failed })}
          </Chip>
        ) : null}
        <Chip size="sm" tone="positive">
          {t('shapes.checksPassed', { count: passed })}
        </Chip>
      </div>
      {/* The author's own element. A check list written `1) ✓ …` is an ordered sequence, and
          re-emitting it as a `ul` tells assistive tech it never was one. The visible marker is
          replaced by the glyph either way — that is what this shape is for. */}
      <List className="m-0 flex list-none flex-col gap-1 p-0">
        {items.map((item, index) => {
          // Fails CLOSED. A row the parsed walk and the rendered walk could not pair has no
          // verdict, and no tone is the only harmless default on a list whose whole job is naming
          // failures: defaulting to `pass` would paint an unknown row green.
          const glyph = glyphs[index] ?? null;
          const lifted = glyph ? liftLeadingToken(item.props.children, checkGlyphLength) : null;
          return (
            // `data-tone` on the ROW, so the mark below inherits `--tone-ink` through the custom
            // property rather than through a colour class of its own — the tone doctrine's own
            // mechanism, and the attribute a probe queries to prove the row painted.
            <li
              key={index}
              data-check={glyph ?? undefined}
              data-tone={glyph ? TONE_BY_GLYPH[glyph] : undefined}
              className="flex items-start gap-2"
            >
              {lifted ? (
                <span data-check-mark className="flex-none pt-px text-[color:var(--tone-ink)]">
                  {lifted.token}
                </span>
              ) : null}
              {/* Through `renderInline`, never around it. This shape draws its own row instead of
                  letting `ShapeListItem` draw the `li`, so the seam that Phase 9 turns into
                  `linkifyChildren` would simply not run on a check line — and a check line naming
                  a file is the commonest one there is. One site, reached from here too. */}
              <span className="min-w-0 flex-1">
                {renderInline(lifted ? lifted.rest : item.props.children)}
              </span>
            </li>
          );
        })}
      </List>
    </ShapeFrame>
  );
}
