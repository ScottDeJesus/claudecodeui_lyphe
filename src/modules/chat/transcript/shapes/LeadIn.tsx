import { Children, isValidElement } from 'react';
import type { ReactNode } from 'react';

import { shapeKey } from '@/modules/chat/transcript/shapes/collapseState';
import type { HastNode } from '@/modules/chat/transcript/shapes/hast';
import { readListItems, textOf } from '@/modules/chat/transcript/shapes/hast';
import { LeadInTitleContext } from '@/modules/chat/transcript/shapes/leadInContext';
import { listRung } from '@/modules/chat/transcript/shapes/listItems';
import { ShapeFrame } from '@/modules/chat/transcript/shapes/ShapeFrame';
import { tableRung } from '@/modules/chat/transcript/shapes/tableData';

/**
 * Does this paragraph hold a link anywhere?
 *
 * Local to this file, and read from the paragraph's own HAST rather than from its rendered
 * children, because by then the link is a `MarkdownLink` element and the fact is hidden inside its
 * props. `ShapeFrame` needs it: the title it is handed sits inside the fold's button, and an anchor
 * inside a button is two controls in one — one click would navigate AND fold. It is the same walk,
 * and the same answer, `ShapeSection` gives a heading carrying a link.
 */
const containsLink = (node: HastNode): boolean =>
  (node.children ?? []).some(
    (child) => (child.type === 'element' && child.tagName === 'a') || containsLink(child)
  );

/**
 * The line above a list or a table, drawn as the header of the block it introduces.
 *
 * Used through `elements/plain.tsx`, which routes the `<div data-shape="lead-in">` that
 * `remarkShapeGroups` builds around a paragraph and the block under it. The plugin only ever groups
 * a pair whose paragraph is a title — see `isLeadInText` — so this component never has to decide
 * whether the author meant a header; it decides only WHO frames the result.
 *
 * The title is the paragraph's OWN rendered children, never its text. `**Summary**` keeps its bold
 * and `` `src/parser.ts:42` `` keeps its code span, which is what "a shape may never render less
 * than the markdown it replaced" asks of a header as much as of a body. `ShapeFrame` suppresses
 * chips inside its title separately, because that title sits inside the fold toggle.
 *
 * A LINK is the one thing that cannot travel into that toggle: an anchor inside a button is two
 * controls in one, and one click would both navigate and fold. So this file reads `containsLink`
 * off the paragraph's own HAST and hands the answer to the frame beside the words, which folds
 * from its chevron alone when the answer is yes — the same answer `ShapeSection` gives a heading
 * carrying a link.
 *
 * **Who frames, and why it is a question.** A list shape and a table shape both wear a `ShapeFrame`
 * of their own, so the title reaches them through `LeadInTitleContext` and the paragraph is not
 * drawn at all. A list that draws NO frame — every list that is not a task list, a check list or a
 * timeline — is framed here instead, with the paragraph's words as the frame's title. And a table
 * that draws no frame stays exactly as it is: the paragraph is left above today's bordered table
 * rather than given a second frame spelling `data-shape="table"`, which would make the table
 * unsortable and the document's shape census wrong.
 *
 * Both questions are asked of the predicates the ladders themselves use — `listRung` and
 * `tableRung` — so this file cannot guess a rung the target disagrees with. Guessing is the failure
 * this design exists to prevent: a declined decision matrix would lose its paragraph entirely.
 */
export function LeadIn({ node, children }: { node?: HastNode; children?: ReactNode }) {
  const elements = Children.toArray(children).filter(isValidElement);
  const hastElements = (node?.children ?? []).filter((child) => child.type === 'element');
  // A pair this component was not built for — a paragraph and a block that did not both survive, or
  // a tree some later plugin reshaped — gets the author's words back untouched. Rendering less than
  // the markdown it replaced is the one thing a shape may never do.
  if (elements.length !== 2 || hastElements.length !== 2) return <>{children}</>;

  const title = (elements[0].props as { children?: ReactNode }).children;
  const titleText = textOf(hastElements[0]).trim();
  const target = hastElements[1];
  const rung = target.tagName === 'table' ? tableRung(target) : listRung(target);
  // The words, and the one fact about them the frame cannot read for itself. Provided to whichever
  // frame ends up drawing this title, so neither arm spells the title twice.
  const titleValue = { title, hasLink: containsLink(hastElements[0]) };

  // A table no rung claimed gets today's markup AND its paragraph back: the line stays where the
  // author put it rather than being given a second frame spelling `data-shape="table"`, which would
  // also make the table unsortable and the document's shape census wrong.
  if (rung === 'none' && target.tagName === 'table') return <>{children}</>;

  // The plan's payload for a list frame: the title's own text and the items, joined by newlines.
  const payload = `${titleText}\n${readListItems(target).map((item) => item.text).join('\n')}`;
  // Two frames can draw this title — the shape's own, off its own collapse key, or the one this
  // component draws for a list that frames itself not at all, whose body is the list's own rendering:
  // markers, numbers and nested items exactly as the element drew them. The words reach either the
  // same way, so the provider is spelled once around them.
  const framed =
    rung !== 'none' ? (
      elements[1]
    ) : (
      <ShapeFrame kind="list" prose collapseKey={shapeKey('list', payload)}>
        {elements[1]}
      </ShapeFrame>
    );

  return <LeadInTitleContext.Provider value={titleValue}>{framed}</LeadInTitleContext.Provider>;
}
