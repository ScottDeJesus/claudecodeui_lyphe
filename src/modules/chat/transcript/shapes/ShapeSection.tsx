import { Children, cloneElement, isValidElement, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDownIcon } from 'lucide-react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { ChipsSuppressedContext } from '@/modules/chat/transcript/shapes/chipContext';
import { shapeKey } from '@/modules/chat/transcript/shapes/collapseState';
import type { HastNode } from '@/modules/chat/transcript/shapes/hast';
import { textOf } from '@/modules/chat/transcript/shapes/hast';
import { useShapeCollapse } from '@/modules/chat/transcript/shapes/useShapeCollapse';

type ShapeSectionProps = {
  /** The `data-shape="section"` wrapper `remarkShapeGroups` built: the heading, then its body. */
  node?: HastNode;
  /** The same blocks, already rendered — the heading through `PlainHeading`, the body as ever. */
  children?: ReactNode;
};

type HeadingElement = ReactElement<{ className?: string; children?: ReactNode }>;

/**
 * The wrapper must not move a single block. Tailwind Typography spaces a reply with rules that read
 * DOM POSITION — `> :first-child`, `> :last-child`, `h2 + *`, `hr + *` — and this wrapper changes
 * every one of those positions: the heading stops being the reply's first child, the body's first
 * block stops following the heading, its last block becomes a last child it never was. Unanswered,
 * a reply that opens with `## Summary` opens with a 48 px gap, and one that ends in a section ends
 * with a trailing margin. So each rule is restated here at the position the wrapper moved it to.
 *
 * Only margins TYPOGRAPHY set are restated. Its rules are `.prose :where(…)` in the components
 * layer, so every block that carries a margin UTILITY of its own — a fence, a table, a blockquote,
 * a rule, any shape frame (`my-3`, `my-4`) — already outranks them and is never zeroed by them in
 * the flat reply either; zeroing one here would be a new gap, not an old one kept. What typography
 * alone spaces in this renderer is the headings, the lists' top margin, and KaTeX's display block.
 * `probe-shapes-groups.mjs` holds every block of a sectioned reply to its unsectioned position.
 *
 * `[data-section-body] > div` is `CollapsibleContent`'s own inner div, where the body blocks sit.
 */
const SECTION_FLOW = [
  // `.prose > :first-child`: the reply's first block has no top margin. That block is this heading.
  '[.prose>&:first-child>:first-child]:mt-0',
  // `h2 + *`, `h3 + *`, `h4 + *`, `hr + *`: a heading straight after one of those has none either.
  '[:is(h2,h3,h4,hr)+&>:first-child]:mt-0',
  // …including when this section is the first thing in an h2–h4 section's body (`## A` then `### B`).
  '[:is(h2,h3,h4)+[data-section-body]>div>&:first-child>:first-child]:mt-0',
  // …and reaching OUT of this section: when its last block, read flat, is a bare h2–h4 (`## Step 1`,
  // text, `### Result: PASS`, `## Step 2`), the heading after this section — bare, or opening one —
  // is what `h3 + *` zeroed. `data-ends-in-heading` is decided from `node`, at any depth, below.
  // Open only: folded, that h3 is hidden and the next heading would sit flush against this one.
  // Any section folded inside falls back to the full margin — a larger gap, never a touching one.
  '[&[data-ends-in-heading][data-collapsed=false]:not(:has([data-shape=section][data-collapsed=true]))+:is(h1,h2,h3,h4,h5,h6)]:mt-0',
  '[&[data-ends-in-heading][data-collapsed=false]:not(:has([data-shape=section][data-collapsed=true]))+[data-shape=section]>:first-child]:mt-0',
  // The same rule for this section's own first body block, where typography set its margin.
  '[&>:is(h2,h3,h4)+[data-section-body]>div>:is(ul,ol,h1,h2,h3,h4,h5,h6,.katex-display):first-child]:mt-0',
  // A paragraph or list ending a body is a `:last-child` here and nowhere in the reply, so its own
  // `last:mb-0` (`elements/paragraph.tsx`, `elements/list.tsx`) would drop the `mb-2` it keeps there.
  '[&_[data-section-body]>div>[class~="last:mb-0"]:last-child]:mb-2',
  // `.prose > :last-child`: unless it IS the reply's last block — every section around it the last
  // of its parent — which ends the reply with no bottom margin, as it always did.
  '[.prose>&:last-child_[data-section-body]>div>:is(h1,h2,h3,h4,h5,h6,.katex-display,[class~="last:mb-0"]):last-child:not([data-shape=section]:not(:last-child)_*)]:mb-0',
].join(' ');

/**
 * Open, the body is a plain block: `CollapsibleContent`'s grid and its `overflow-hidden` inner div
 * are both formatting-context roots, and margins do not collapse across one — every body's first
 * and last margins would stack onto the heading and onto the next section instead of merging. The
 * grid is only needed to animate a close, so it is used for exactly that. `visibility` rides the
 * same transition, so the folded body leaves the tab order and find-in-page once the close ends.
 */
const OPEN_BODY = 'block transition-[grid-template-rows,visibility] [&>div]:overflow-visible';
const FOLDED_BODY = 'invisible transition-[grid-template-rows,visibility]';

const containsLink = (node: HastNode | undefined): boolean =>
  (node?.children ?? []).some((child) => (child.type === 'element' && child.tagName === 'a') || containsLink(child));

/** The headings whose `+ *` rule typography writes — the ones a following heading loses its margin to. */
const ZEROING_HEADINGS = new Set(['h2', 'h3', 'h4']);

/**
 * Is this section's last block, read flat, a bare h2–h4? Descends through nested sections, since a
 * section that ends in a section ends where that one ends. A trailing `---` never qualifies here:
 * `remarkShapeGroups` leaves one outside the section, where `hr + *` still reads it directly.
 */
const endsInHeading = (node: HastNode | undefined): boolean => {
  const last = (node?.children ?? []).filter((child) => child.type === 'element').at(-1);
  if (!last) return false;
  if (last.properties?.['data-shape'] === 'section') return endsInHeading(last);
  return ZEROING_HEADINGS.has(last.tagName ?? '');
};

/**
 * A heading and everything under it, folded by clicking the heading.
 *
 * Used by `elements/plain.tsx`'s `ShapeDiv`, for the `section` wrapper `remarkShapeGroups` builds —
 * never by the heading component itself, which stays `PlainHeading` and never learns it can fold.
 *
 * **The heading stays the heading.** It is still the `h2` react-markdown rendered, and its words
 * become the disclosure button inside it — the WAI-ARIA accordion shape, `<h2><button
 * aria-expanded>` — with a chevron after the last word. A heading carrying a LINK cannot put its
 * words in a button (a link inside a button is two controls in one), so there the chevron alone is
 * the button and the link keeps working.
 *
 * **The fold key is the heading AND the body.** This app's replies say "Findings", "Summary" and
 * "Next steps" many times in one message; keyed on the heading alone, folding any one would fold
 * every one. Two sections with the same title are distinct unless their whole text also matches.
 *
 * **Expanded by default, and whole in an export.** `useShapeCollapse` reads the export context and
 * the page-lifetime fold memory; inside `renderToStaticMarkup` it answers expanded and not
 * interactive, and then the heading is drawn untouched and nothing can be folded.
 *
 * Every shape root carries `data-shape` and `data-collapsed`; this one adds `data-depth`, the level
 * of the heading it opens with, and its toggle carries `data-shape-toggle`.
 */
export function ShapeSection({ node, children }: ShapeSectionProps) {
  const { t } = useTranslation('chat');
  // Ties the toggle to the region it shows and hides, for `aria-controls`.
  const bodyId = useId();

  const hastChildren = node?.children ?? [];
  const headingIndex = hastChildren.findIndex((child) => child.type === 'element');
  const headingNode = headingIndex === -1 ? undefined : hastChildren[headingIndex];
  // The `section` payload the plan fixes: the heading's text, a newline, and the body's whole text.
  const bodyText = hastChildren.slice(headingIndex + 1).map(textOf).join('');
  const { collapsed, toggle, interactive } = useShapeCollapse(
    shapeKey('section', `${textOf(headingNode)}\n${bodyText}`)
  );

  const [heading, ...body] = Children.toArray(children);
  const depth = Number(/^h([1-6])$/.exec(headingNode?.tagName ?? '')?.[1] ?? 0);
  // The plugin puts a heading first in every wrapper it builds. If the tree ever says otherwise,
  // the blocks are drawn exactly as they would be ungrouped.
  if (!depth || !isValidElement(heading)) {
    return <>{children}</>;
  }

  const headingElement = heading as HeadingElement;
  const toggleLabel = collapsed ? t('shapes.expand') : t('shapes.collapse');
  // Sized in `em` so it scales with the heading it sits in, from an h1 down to an h6.
  const chevron = (
    <ChevronDownIcon
      aria-hidden="true"
      className={cn(
        'ml-[0.3em] inline-block size-[0.7em] align-middle text-muted-foreground transition-[transform,opacity] duration-200',
        collapsed ? '-rotate-90' : 'opacity-40 group-hover/section:opacity-100 group-focus-visible/section:opacity-100'
      )}
    />
  );
  const triggerClass =
    'group/section cursor-pointer rounded-sm text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60';

  const toggleHeading = cloneElement(headingElement, {
    // Folded, the heading's bottom margin would stack on the next heading's top across the empty
    // body, leaving a gap the height of a missing paragraph.
    className: cn(headingElement.props.className, collapsed && 'mb-0') || undefined,
    children: containsLink(headingNode) ? (
      <>
        {headingElement.props.children}
        <CollapsibleTrigger
          data-shape-toggle
          aria-controls={bodyId}
          aria-label={toggleLabel}
          title={toggleLabel}
          className={triggerClass}
        >
          {chevron}
        </CollapsibleTrigger>
      </>
    ) : (
      <CollapsibleTrigger data-shape-toggle aria-controls={bodyId} title={toggleLabel} className={triggerClass}>
        {headingElement.props.children}
        {chevron}
      </CollapsibleTrigger>
    ),
  });

  return (
    <Collapsible
      open={!collapsed}
      onOpenChange={toggle}
      data-shape="section"
      data-depth={depth}
      data-collapsed={String(collapsed)}
      data-ends-in-heading={endsInHeading(node) || undefined}
      className={SECTION_FLOW}
    >
      {/* A heading is a label and, here, the fold button too: an inline code path in it stays a
          code span rather than a chip, which would be a second control inside the toggle. */}
      <ChipsSuppressedContext.Provider value={true}>{interactive ? toggleHeading : heading}</ChipsSuppressedContext.Provider>
      <CollapsibleContent id={bodyId} data-section-body className={collapsed ? FOLDED_BODY : OPEN_BODY}>
        {body}
      </CollapsibleContent>
    </Collapsible>
  );
}
