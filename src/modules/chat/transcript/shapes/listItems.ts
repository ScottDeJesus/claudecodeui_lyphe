import { Children, cloneElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';

import type { HastNode } from '@/modules/chat/transcript/shapes/hast';

/**
 * What the list shapes do to the RENDERED children of a list, once `detect.ts` has decided which
 * shape it is.
 *
 * It exists because `CheckResults` and `Timeline` both have to lift one leading token out of an
 * item and then draw everything that is left — and "everything that is left" has to be the
 * author's own rendered children, marks intact, not a re-render of the parsed text. That is the
 * plan's central rule applied to a list: decide from `node`, render from `children`.
 *
 * It is a `.ts` module rather than a helper hanging off one of its consumers for the reason
 * `tableData.ts` gives: a `.tsx` file that exports a helper beside its component loses Fast
 * Refresh for the component, which oxlint reports and this repo's warning ratchet does not allow
 * to rise. It holds no JSX and imports no shape. Used by `CheckResults.tsx` and `Timeline.tsx`
 * (both helpers), and by `elements/blockquote.tsx`, which lifts an alert's `[!KIND]` marker off
 * the front of the quote with `liftLeadingToken`.
 */

/** What react-markdown hands an override: the hast node beside the already-rendered children. */
type RenderedElement = ReactElement<{ node?: HastNode; children?: ReactNode }>;

/**
 * The tag a rendered child stands for. An element react-markdown routed through one of our own
 * overrides is a FUNCTION whose tag only `props.node` still knows; one it left alone is an
 * intrinsic string. Reading both is what lets this module find an `li` without caring which.
 * Spelled the same way `DataTable` spells it, for the same reason.
 */
const tagOf = (element: ReactElement): string =>
  typeof element.type === 'string'
    ? element.type
    : String((element as RenderedElement).props.node?.tagName ?? '');

/**
 * Every rendered `li` of a list, in document order — the units a list shape re-lays out.
 *
 * `readListItems` reads the same items off the hast node and in the same order, so index `n` here
 * is index `n` there. That pairing is what lets a shape tone a row from parsed text while drawing
 * the author's rendered words, and it is the reason both walks take DIRECT children only.
 */
export const renderedListItems = (children: ReactNode): RenderedElement[] =>
  Children.toArray(children).filter(
    (child): child is RenderedElement => isValidElement(child) && tagOf(child) === 'li'
  );

/** A token lifted off the front of an item, and everything the item still has left to render. */
export type LiftedItem = { token: string; rest: ReactNode };

/** True when a child renders nothing at all — whitespace, or a string the lift emptied. */
const isBlank = (child: ReactNode): boolean => typeof child === 'string' && !child.trim();

/**
 * Drops the line break the lifted token left standing where its line used to end.
 *
 * `remark-breaks` is loaded for user-typed messages, so `[!NOTE]\nbody` does not arrive as one text
 * node there: it arrives as `"[!NOTE]"`, a `<br>`, and a separate `"\n"` text node, because
 * `mdast-util-to-hast`'s break handler emits both. Lifting the marker then leaves an empty first
 * line and the banner opens on blank space. The same is true of any token this module lifts.
 *
 * It only fires when what remains at `from` is blank — a token lifted out of the MIDDLE of a line
 * (`"✓ built"` leaving `" built"`) leaves a real line, and its break belongs to the author.
 */
const withoutOrphanedBreak = (items: ReactNode[], from: number): ReactNode[] => {
  if (!isBlank(items[from])) return items;
  let at = from + 1;
  while (at < items.length && isBlank(items[at])) at += 1;
  const next = items[at];
  if (!(isValidElement(next) && tagOf(next) === 'br')) return items;
  at += 1;
  while (at < items.length && isBlank(items[at])) at += 1;
  return [...items.slice(0, from), ...items.slice(at)];
};

/**
 * Lifts a leading token out of an item's FIRST text-bearing child and returns the rest untouched.
 *
 * `take` is given the raw string and answers how many characters the token occupies, counting any
 * whitespace before it — so the grammar stays in `detect.ts` and only the arithmetic is here.
 *
 * It returns `null` when there is nothing to lift, and every caller treats that as "draw the item
 * whole". That matters: the alternative is drawing the token as a mark AND leaving it in the body,
 * which shows the reader the same glyph twice. A list item whose text sits inside something this
 * walk does not open — a nested list, a blockquote — is simply drawn as the author wrote it.
 *
 * A leading PARAGRAPH is opened, because a LOOSE list (one with blank lines between its items)
 * wraps every item's text in a `p` and is otherwise identical to a tight one. Anything else that
 * is not a string stops the walk rather than being searched past: a token is only a token when it
 * is the first thing in the item, and hunting for one deeper in would lift a word out of the
 * middle of a sentence.
 */
export function liftLeadingToken(
  children: ReactNode,
  take: (text: string) => number
): LiftedItem | null {
  const items = Children.toArray(children);

  for (let index = 0; index < items.length; index += 1) {
    const child = items[index];

    if (typeof child === 'string') {
      // Whitespace between elements is not the item's first word; markdown puts it everywhere.
      if (!child.trim()) continue;
      const length = take(child);
      if (length <= 0) return null;
      const rest = [...items];
      rest[index] = child.slice(length);
      return { token: child.slice(0, length).trim(), rest: withoutOrphanedBreak(rest, index) };
    }

    if (isValidElement(child) && tagOf(child) === 'p') {
      const inner = liftLeadingToken((child as RenderedElement).props.children, take);
      if (!inner) return null;
      const rest = [...items];
      // A paragraph the lift emptied is DROPPED rather than cloned empty. `> [!NOTE]` on its own
      // line above a blank `>` line is two paragraphs, the first of them nothing but the marker,
      // and cloning it back in renders `<div class="mb-2 last:mb-0"></div>` — a stray blank band
      // across the top of the banner, above the words the reader came for.
      const emptied = Children.toArray(inner.rest).every(isBlank);
      rest[index] = emptied ? '' : cloneElement(child as RenderedElement, { children: inner.rest });
      return { token: inner.token, rest: emptied ? withoutOrphanedBreak(rest, index) : rest };
    }

    return null;
  }

  return null;
}
