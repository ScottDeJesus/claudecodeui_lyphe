import { useContext } from 'react';
import type { ReactNode } from 'react';

import { shapeKey } from '@/modules/chat/transcript/shapes/collapseState';
import { checkGlyph, isTimeToken } from '@/modules/chat/transcript/shapes/detect';
import type { HastNode } from '@/modules/chat/transcript/shapes/hast';
import { hasInlineFormatting, readFactPairs, readListItems, textOf } from '@/modules/chat/transcript/shapes/hast';
import { InsideListContext } from '@/modules/chat/transcript/shapes/listNesting';
import { renderInline } from '@/modules/chat/transcript/shapes/elements/inlineText';
import { CheckResults } from '@/modules/chat/transcript/shapes/CheckResults';
import { FactCard } from '@/modules/chat/transcript/shapes/FactCard';
import { TaskProgress } from '@/modules/chat/transcript/shapes/TaskProgress';
import { Timeline } from '@/modules/chat/transcript/shapes/Timeline';

/** See `elements/table.tsx` for why this shape is declared per module rather than shared. */
type PlainElementProps = { node?: HastNode; children?: ReactNode };

/**
 * The `ul` AND `ol` overrides, moved out of `Markdown.tsx` unchanged. Used through
 * `elements/index.ts`.
 *
 * One component for both, because `SHAPE_COMPONENTS` points `ul` and `ol` at one `ShapeList` and a
 * list shape reads the same items either way. Which tag to emit is read from `node`, which is the
 * only thing that distinguishes them — the two class strings are today's, byte for byte.
 */
export function PlainList({ node, children }: PlainElementProps) {
  if (node?.tagName === 'ol') {
    return (
      <ol className="mb-2 list-outside list-decimal space-y-1 pl-5 marker:text-current last:mb-0">{children}</ol>
    );
  }
  return (
    <ul className="mb-2 list-outside list-disc space-y-1 pl-5 marker:text-current last:mb-0">{children}</ul>
  );
}

/** The `li` override, moved out of `Markdown.tsx` unchanged. Used through `elements/index.ts`. */
export function PlainListItem({ children }: PlainElementProps) {
  return <li className="[&>div:last-child]:mb-0 [&>div]:mb-1">{renderInline(children)}</li>;
}

/**
 * The fact rung's decline: did the author mark up anything the grid would have to flatten?
 *
 * The rule is that a shape which re-lays-out its cells declines when the author marked those cells
 * up, because it cannot carry rendered children across the move — and the grid re-lays-out BOTH
 * halves of a pair, drawing the label and the value from text. Asking `hasInlineFormatting` of the
 * item as it stands would decline every fact list that could ever exist: a pair is DEFINED by a
 * `**Label:**` bold, `strong` is exactly what that function counts, and `li` is transparent to it,
 * so the answer would be `true` for every input and the rung dead code.
 *
 * So each label bold is UNWRAPPED — its element removed, its children kept in its place — and the
 * question is asked of the result. Unwrapping, not deleting: a first draft dropped the label bold
 * WITH its contents, so `**[PR 12](url):**` passed, the link inside the label was never looked at,
 * and the grid drew `PR 12` with its target silently gone. `readFactPairs` now rejects that label on
 * its own (a bold holding any element), which is the rule Phase 5's paragraph rung relies on; this
 * is a second lock on the same door, and the two agree on every input.
 */
const factItemIsFormatted = (item: HastNode): boolean =>
  hasInlineFormatting({
    type: 'element',
    tagName: 'li',
    children: (item.children ?? []).flatMap((child) =>
      child.type === 'element' && child.tagName === 'strong' && textOf(child).trim().endsWith(':')
        ? (child.children ?? [])
        : [child]
    ),
  });

/**
 * Every `li` of a list, flattened into ONE subtree for `readFactPairs` to walk.
 *
 * A fact list writes one pair per bullet — `- **Owner:** ana` — and `readFactPairs` wants two pairs
 * before it will believe any of them. Concatenating the items is what lets this rung and Phase 5's
 * paragraph rung share one reader and one grammar, instead of growing a second, looser copy for
 * bullets. Every rejection survives the concatenation: an item holding prose, a nested list, or a
 * value that is not plain text still returns `null` for the ENTIRE list, because the reader walks
 * one flat sequence and a single stray child ends the walk.
 *
 * The one thing it relaxes, stated rather than discovered later: a pair may span two bullets, so
 * `- **A:**` followed by `- one` reads as the pair `A: one`. It is an odd way to write a list and
 * the grid still shows both the label and the value, so nothing is lost when it happens — which is
 * why it is accepted here rather than fenced off with a per-item walk that would need its own
 * grammar.
 */
const factPairsOfList = (items: HastNode[]) =>
  readFactPairs({ type: 'element', tagName: 'ul', children: items.flatMap((item) => item.children ?? []) });

/** The direct `li` children of a list — the same walk, in the same order, `readListItems` uses. */
const listItemNodes = (node: HastNode): HastNode[] =>
  (node.children ?? []).filter((child) => child.type === 'element' && child.tagName === 'li');

/**
 * Is THIS item a task — does it carry a checkbox of its very own?
 *
 * `readListItems` answers `checked` from the first checkbox ANYWHERE beneath the item
 * (`hast.ts`'s `findCheckbox` recurses, and the plan fixes that reader's contract as
 * "a first-descendant `input[type=checkbox]`"), which is the right answer for the shape that owns
 * an item and the wrong one for the rung that decides whether the item is a task at all. A plain
 * bullet that merely CONTAINS a task sub-list would inherit the sub-task's state:
 *
 *     - Setup
 *       - [x] a
 *       - [ ] b
 *     - [ ] Deploy
 *
 * read as two tasks, one of them done — "1 of 2 done" over a list where nothing at the top level
 * is done at all, and "Setup" drawn with neither a bullet nor a box.
 *
 * So this walk descends only where the item's own first line can be: through a `p`, which is where
 * a LOOSE list puts it. It never enters a `ul` or an `ol`, which is exactly the boundary the
 * shared reader cannot draw without breaking its own sealed contract.
 */
const ownCheckbox = (item: HastNode): boolean | null => {
  for (const child of item.children ?? []) {
    if (child.type !== 'element') continue;
    if (child.tagName === 'input' && child.properties?.type === 'checkbox') {
      return child.properties?.checked === true;
    }
    if (child.tagName === 'p') {
      const inParagraph = ownCheckbox(child);
      if (inParagraph !== null) return inParagraph;
    }
  }
  return null;
};

/**
 * The `ul`/`ol` entry of `SHAPE_COMPONENTS`: the whole list ladder, in the plan's precedence.
 *
 * Used through `elements/index.ts` by `Markdown.tsx`'s shape map, and reached only on a settled
 * body — the streaming half renders through `PLAIN_COMPONENTS`, decided once by the ternary in
 * `Markdown.tsx`. Nothing here reads the streaming context, so a half-arrived list cannot become a
 * timeline for a frame and then change its mind.
 *
 * **Task list, then check results, then timeline, then fact list, then today's list.** The order is
 * load-bearing rather than arbitrary. A task list whose items ALSO open with ✓ is still a task
 * list: swapping those two rungs would take the reader's checkboxes away and hand them a static
 * pass/fail read-out of the list they were using to track work.
 *
 * Every rung demands its trigger of EVERY item, which is what keeps a near-miss plain:
 *   * one ordinary bullet among the checkboxes and the progress line would be counting something
 *     that is not there, so the whole list stays a list;
 *   * one item without a glyph and it is not a check list — and two is the floor, because a single
 *     ✓ line is a sentence and not a result set;
 *   * one item without a leading time and it is not a timeline, again with two as the floor;
 *   * `isTimeToken` is what keeps `3:2`, `1.2` and `4 items changed` out. A ratio, a version and a
 *     bare count are not times, and that grammar lives in `detect.ts`, gated on its own.
 *
 * An empty list falls through to the plain rendering before any rung runs, which is also what stops
 * `every()` answering `true` for a list with nothing in it and handing `TaskProgress` a zero total.
 */
export function ShapeList({ node, children }: PlainElementProps) {
  // Depth, and the only thing in this module that is not a pure function of `node` and `children`
  // — because depth is the one fact about a list that neither of them carries. See `listNesting`.
  const insideList = useContext(InsideListContext);
  const fallback = <PlainList node={node}>{children}</PlainList>;
  // Set around EVERYTHING this override renders, the plain fallback included: a list nested inside
  // a list that itself declined is still a list inside a list, and a Tasks card indented under a
  // bare bullet is the same bad shape as one indented under a Tasks card.
  const inList = (body: ReactNode) => (
    <InsideListContext.Provider value={true}>{body}</InsideListContext.Provider>
  );

  if (!node || insideList) return inList(fallback);

  const items = readListItems(node);
  // `every()` is vacuously true of an empty list, so this guard is the one thing standing between
  // an empty `<ul>` and a progress bar dividing zero by zero above nothing at all.
  if (items.length === 0) return inList(fallback);

  const texts = items.map((item) => item.text);
  // The plan's payload for all four list kinds: the item texts joined by newlines.
  const payload = texts.join('\n');
  const itemNodes = listItemNodes(node);
  // The author's own element, carried into every shape below. A shape replaces the MARKER with its
  // glyph or its time — that is what it is for — but the element the author chose is structure, and
  // an `<ol>` re-emitted as a `<ul>` tells a screen reader the sequence was never ordered.
  const ordered = node.tagName === 'ol';

  // 1 — a task list: every item carries a checkbox OF ITS OWN, not one borrowed from a sub-list.
  const boxes = itemNodes.map(ownCheckbox);
  if (boxes.length === items.length && boxes.every((box) => box !== null)) {
    const done = boxes.filter((box) => box === true).length;
    // The list itself is handed down as the body, already wrapped in today's `PlainList`, so the
    // shape adds a header and changes not one byte of the list under it — checkboxes included.
    return inList(
      <TaskProgress done={done} total={boxes.length} collapseKey={shapeKey('tasks', payload)}>
        {fallback}
      </TaskProgress>
    );
  }

  // 2 — check results: a pass/fail glyph on every item, and at least two of them.
  const glyphs = texts.map(checkGlyph);
  if (items.length >= 2 && glyphs.every((glyph) => glyph !== null)) {
    return inList(
      <CheckResults
        glyphs={glyphs as ('pass' | 'fail')[]}
        ordered={ordered}
        collapseKey={shapeKey('checks', payload)}
      >
        {children}
      </CheckResults>
    );
  }

  // 3 — a timeline: a leading time on every item, and at least two of them.
  if (items.length >= 2 && texts.every(isTimeToken)) {
    return inList(
      <Timeline ordered={ordered} collapseKey={shapeKey('timeline', payload)}>
        {children}
      </Timeline>
    );
  }

  // 4 — a fact list: `**Label:** value` on every bullet, two pairs at the least.
  const pairs = factPairsOfList(itemNodes);
  if (pairs && !itemNodes.some(factItemIsFormatted)) {
    return inList(<FactCard pairs={pairs} collapseKey={shapeKey('facts', payload)} />);
  }

  return inList(fallback);
}

/**
 * The `li` entry of `SHAPE_COMPONENTS`.
 *
 * It is still `PlainListItem` and gains nothing in this phase, which is what the plan asks of it:
 * the list shapes above re-lay-out their own items, and the one rung that keeps the list whole —
 * `TaskProgress` — wants each item drawn exactly as it is today, checkbox included. The
 * `renderInline` call inside it is the Phase 9 seam and stays the only thing in it.
 */
export const ShapeListItem = PlainListItem;
