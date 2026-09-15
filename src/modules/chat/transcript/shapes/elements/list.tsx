import { useContext } from 'react';
import type { ReactNode } from 'react';

import { shapeKey } from '@/modules/chat/transcript/shapes/collapseState';
import { checkGlyph } from '@/modules/chat/transcript/shapes/detect';
import type { HastNode } from '@/modules/chat/transcript/shapes/hast';
import { readListItems } from '@/modules/chat/transcript/shapes/hast';
import { listItemNodes, listRung, listStart, ownCheckbox } from '@/modules/chat/transcript/shapes/listItems';
import { InsideListContext } from '@/modules/chat/transcript/shapes/listNesting';
import { renderInline } from '@/modules/chat/transcript/shapes/elements/inlineText';
import { CheckResults } from '@/modules/chat/transcript/shapes/CheckResults';
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
 * only thing that distinguishes them — the two class strings are today's, byte for byte. An `ol`
 * carries the author's first number through `listStart`, which is absent for a list that opens at 1.
 *
 * On a surface carrying MARKDOWN_CARDS_CLASS, markdownCards.css overrides this list's padding,
 * list style and marker colour; see 08-rendered-shapes.md §Element cards.
 */
export function PlainList({ node, children }: PlainElementProps) {
  if (node?.tagName === 'ol') {
    return (
      <ol start={listStart(node)} className="mb-2 list-outside list-decimal space-y-1 pl-5 marker:text-current last:mb-0">{children}</ol>
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
 * The `ul`/`ol` entry of `SHAPE_COMPONENTS`: the whole list ladder.
 *
 * Used through `elements/index.ts` by `Markdown.tsx`'s shape map, and reached only on a settled
 * body — the streaming half renders through `PLAIN_COMPONENTS`, decided once by the ternary in
 * `Markdown.tsx`. Nothing here reads the streaming context, so a half-arrived list cannot become a
 * timeline for a frame and then change its mind.
 *
 * **Task list, then check results, then timeline, then today's list.** The order is load-bearing
 * rather than arbitrary. A task list whose items ALSO open with ✓ is still a task list: swapping
 * those two rungs would take the reader's checkboxes away and hand them a static pass/fail read-out
 * of the list they were using to track work.
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
 * The rungs themselves are `listRung`, in `shapes/listItems.ts`, because `LeadIn` has to ask the
 * same question of the list it is titling — one predicate, called by both, cannot disagree with
 * itself.
 *
 * **A list of `**Label:** value` bullets is a list.** The author wrote bullets, and those are the
 * commonest lists this app's replies carry; a label-value grid in their place takes the bullets
 * away, shrinks the bold labels to muted captions and drops their colons, so the reader sees their
 * list replaced by a card. Label-value LINES in a paragraph are what `FactCard` draws, from
 * `elements/paragraph.tsx`.
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
  // The plan's payload for every list kind: the item texts joined by newlines.
  const payload = texts.join('\n');
  // The author's own element and first number, carried into every shape below. A shape replaces the
  // MARKER with its glyph or its time — that is what it is for — but the element the author chose is
  // structure, and an `<ol>` re-emitted as a `<ul>` tells a screen reader the sequence was never
  // ordered.
  const ordered = node.tagName === 'ol';
  const start = listStart(node);
  const rung = listRung(node);

  // 1 — a task list: every item carries a checkbox OF ITS OWN, not one borrowed from a sub-list.
  // `listRung` has already read every item that way; this walk repeats it only for the COUNT, and
  // it is the same `ownCheckbox`, so the two can never disagree.
  if (rung === 'tasks') {
    const boxes = listItemNodes(node).map(ownCheckbox);
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
  if (rung === 'checks') {
    return inList(
      <CheckResults
        glyphs={texts.map(checkGlyph) as ('pass' | 'fail')[]}
        ordered={ordered}
        start={start}
        collapseKey={shapeKey('checks', payload)}
      >
        {children}
      </CheckResults>
    );
  }

  // 3 — a timeline: a leading time on every item, and at least two of them.
  if (rung === 'timeline') {
    return inList(
      <Timeline ordered={ordered} start={start} collapseKey={shapeKey('timeline', payload)}>
        {children}
      </Timeline>
    );
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
