/**
 * The element overrides `Markdown.tsx` builds its two component maps from.
 *
 * `Markdown.tsx` imports through this barrel and through no other path, which is what lets the
 * package be cut by OWNING PHASE rather than by HTML element: each module below is edited by one
 * phase and by no other, and the phase that gives an element its shape branch replaces that
 * element's `Shape*` alias inside its own module without reopening this file or `Markdown.tsx`.
 *
 *   table.tsx       Phase 3      list.tsx / blockquote.tsx   Phase 4
 *   paragraph.tsx   Phase 5      plain.tsx                   Phase 7
 *   inlineText.tsx  Phase 9      this barrel                 Phase 2, then nobody
 */
export {
  PlainTable,
  PlainTableHead,
  PlainTableRow,
  PlainTableHeaderCell,
  PlainTableCell,
  ShapeTable,
  ShapeTableCell,
} from '@/modules/chat/transcript/shapes/elements/table';
export { PlainList, PlainListItem, ShapeList, ShapeListItem } from '@/modules/chat/transcript/shapes/elements/list';
export { PlainBlockquote, ShapeBlockquote } from '@/modules/chat/transcript/shapes/elements/blockquote';
export { PlainParagraph, ShapeParagraph } from '@/modules/chat/transcript/shapes/elements/paragraph';
export { PlainRule, PlainHeading, PlainDiv, ShapeDiv } from '@/modules/chat/transcript/shapes/elements/plain';

/**
 * The one name here that `Markdown.tsx` does not use: the three overrides that apply the seam
 * import `elements/inlineText` directly, because a component reaching its own package through the
 * barrel is a cycle waiting to be written. It is re-exported because the plan makes this barrel
 * "the barrel re-exporting every name above", and because a reader listing the package's surface
 * should see the seam rather than have to find it.
 */
export { renderInline } from '@/modules/chat/transcript/shapes/elements/inlineText';
