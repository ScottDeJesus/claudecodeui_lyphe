import type { ReactNode } from 'react';

import { shapeKey } from '@/modules/chat/transcript/shapes/collapseState';
import { parseVerdict } from '@/modules/chat/transcript/shapes/detect';
import type { HastNode } from '@/modules/chat/transcript/shapes/hast';
import { hasInlineFormatting, readFactPairs, textOf } from '@/modules/chat/transcript/shapes/hast';
import { renderInline } from '@/modules/chat/transcript/shapes/elements/inlineText';
import { FactCard } from '@/modules/chat/transcript/shapes/FactCard';
import { VerdictBanner } from '@/modules/chat/transcript/shapes/VerdictBanner';

/** See `elements/table.tsx` for why this shape is declared per module rather than shared. */
type PlainElementProps = { node?: HastNode; children?: ReactNode };

/**
 * The `p` override, moved out of `Markdown.tsx` unchanged. Used through `elements/index.ts`, and
 * by `ShapeParagraph` below as its plain arm.
 *
 * A `div` and not a `p`, as it has always been: a paragraph in this transcript can contain a code
 * block or a table, and nesting either inside a `<p>` makes the browser close the paragraph early.
 */
export function PlainParagraph({ children }: PlainElementProps) {
  return <div className="mb-2 last:mb-0">{renderInline(children)}</div>;
}

/**
 * `node` with every child element `unwrap` accepts replaced by that element's own children, all the
 * way down. An element with no children — a `br` — is thereby simply removed.
 *
 * It exists so `hasInlineFormatting` can be asked a real question. That function counts EVERY
 * inline element as a mark, and both rungs below are defined on elements that are not marks the
 * shape would lose: a fact pair on its `**Label:**` bold and the `<br>` `remark-breaks` puts between
 * pairs (the grid redraws both, as its label column and its rows), a verdict on the bold or italic
 * a model wraps the line in (the banner is itself the emphasis). Asked of the paragraph as it
 * stands, the answer would be `true` for every fact paragraph that can exist and the rung would be
 * dead code. Asked of it with exactly those elements unwrapped, a link or a code span anywhere —
 * value, label or verdict — still reads `true`, and the rung declines.
 *
 * `elements/list.tsx`'s `factItemIsFormatted` asks the list rung's form of the same question.
 */
const unwrapped = (node: HastNode, unwrap: (element: HastNode) => boolean): HastNode => ({
  ...node,
  children: (node.children ?? []).flatMap((child) =>
    child.type === 'element' && unwrap(child) ? (unwrapped(child, unwrap).children ?? []) : [child]
  ),
});

const isFactScaffold = (element: HastNode): boolean =>
  element.tagName === 'br' || (element.tagName === 'strong' && textOf(element).trim().endsWith(':'));

const isEmphasis = (element: HastNode): boolean => element.tagName === 'strong' || element.tagName === 'em';

/**
 * Does every `**Label:**` after the first open a LINE of its own?
 *
 * `readFactPairs` does not ask. It keeps the first line of each value and treats the next bold as
 * the next label whether or not a line ended in between — so the one-line sentence
 * `**Root cause:** the parser dropped the row. **Fix:** keep it and re-run.` reads as two pairs
 * and was drawn as a grid, cutting a sentence into cells. The plan's grammar is that a newline
 * separates pairs, so a label that continues a line is prose, and the paragraph stays today's.
 *
 * Asked only of a paragraph `readFactPairs` already accepted, where every `strong` child is a
 * label and every other child is text or a `<br>`. A label follows a line break when the sibling
 * before it is a `<br>` (`remark-breaks`, or a hard break) or a text node whose last non-blank
 * character is the newline. It lives here rather than in `readFactPairs` because the list rung
 * reads a list's items as one concatenated run with NO newlines between them, and that reader is
 * shared.
 */
const labelsOpenLines = (node: HastNode): boolean => {
  const children = node.children ?? [];
  let labelsSeen = 0;
  for (const [index, child] of children.entries()) {
    if (child.type !== 'element' || child.tagName !== 'strong') continue;
    labelsSeen += 1;
    if (labelsSeen === 1) continue;
    const before = children[index - 1];
    const brokeLine =
      (before?.type === 'element' && before.tagName === 'br') ||
      (before?.type === 'text' && /\n[ \t]*$/.test(before.value ?? ''));
    if (!brokeLine) return false;
  }
  return true;
};

/**
 * The `p` entry of `SHAPE_COMPONENTS`: the paragraph ladder, in the plan's precedence.
 *
 * Used through `elements/index.ts` by `Markdown.tsx`'s shape map, and reached only on a settled
 * body — the streaming half renders `PlainParagraph` through `PLAIN_COMPONENTS`, decided once by the
 * ternary in `Markdown.tsx`. Nothing here reads the streaming context, so a verdict line cannot turn
 * into a banner halfway through arriving.
 *
 * **Verdict, then fact card, then today's paragraph.** Each rung is exact, which is what keeps a
 * near-miss plain:
 *   * a verdict is the WHOLE paragraph matching `parseVerdict`'s grammar, uppercase and all — so a
 *     sentence that merely mentions a verdict, a lowercase `verdict: pass`, and a reviewer's own
 *     `VERDICT: BLOCKING 0 · HIGH 0 · MED 0 · LOW 0` contract line all stay prose;
 *   * a fact card is two complete `**Label:** value` pairs, ONE PER LINE, and nothing else —
 *     `readFactPairs` refuses one pair and a label with words before it, and `labelsOpenLines`
 *     refuses a second label that continues the first one's line, so `**Owner:** ana and
 *     **Status:** ready.` stays the sentence it is;
 *   * both rungs draw from parsed TEXT, so both decline through `hasInlineFormatting` when the
 *     author marked up anything the shape would flatten: a link keeps its target and a code span
 *     keeps its face, in today's paragraph.
 *
 * The plain arm is `PlainParagraph` itself, not a copy of its markup — so it is today's `div`, class
 * for class, and it applies `renderInline`, the seam Phase 9 turns into file chips. Prose is where
 * most file references live; a ladder that skipped the seam would ship chips everywhere but here.
 */
export function ShapeParagraph({ node, children }: PlainElementProps) {
  const plain = <PlainParagraph node={node}>{children}</PlainParagraph>;
  if (!node) return plain;

  // 1 — a verdict: the whole trimmed text is the grammar, and it is also the plan's payload.
  const text = textOf(node).trim();
  const verdict = parseVerdict(text);
  if (verdict && !hasInlineFormatting(unwrapped(node, isEmphasis))) {
    return (
      <VerdictBanner verdict={verdict.verdict} counts={verdict.counts} collapseKey={shapeKey('verdict', text)} />
    );
  }

  // 2 — a fact card: two pairs at the least, one per line, and nothing in the paragraph but them.
  const pairs = readFactPairs(node);
  if (pairs && labelsOpenLines(node) && !hasInlineFormatting(unwrapped(node, isFactScaffold))) {
    // The facts payload is "the item texts joined by newlines"; a paragraph's items are its pairs,
    // spelled the way a fact LIST's items read, so the two keys follow one rule.
    const payload = pairs.map((pair) => `${pair.label}: ${pair.value}`).join('\n');
    return <FactCard pairs={pairs} collapseKey={shapeKey('facts', payload)} />;
  }

  return plain;
}
