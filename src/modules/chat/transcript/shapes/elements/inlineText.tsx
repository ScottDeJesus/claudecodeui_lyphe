import type { ReactNode } from 'react';

import { linkifyChildren } from '@/modules/chat/transcript/shapes/InlineMarks';

/**
 * The one site where a block's already-rendered inline content is post-processed: every
 * `path/to/file.ext:line` run in its plain text becomes a file chip, through `linkifyChildren`.
 *
 * Called by `PlainParagraph`, `PlainListItem` and `PlainTableCell` (which `ShapeParagraph`,
 * `ShapeListItem` and `ShapeTableCell` render or alias), and by `CheckResults` and `Timeline`, which
 * redraw a list's rows themselves and pass each row's remaining children back through here rather
 * than around it. Never a heading, never a table header, and never a fence, which does not reach
 * these overrides at all. A sorted `DataTable` needs nothing of its own: it permutes the rendered
 * rows, and every cell in them already came through `PlainTableCell`.
 *
 * Because the three element overrides are the `Plain*` components, this ALSO runs on the streaming
 * half of a reply — `PLAIN_COMPONENTS` names the same three — so a streaming body draws chips too.
 * That is a divergence from the plan, which says the streaming half never runs this scan: honouring
 * it needs the calls moved into the `Shape*` twins, in `elements/` modules other phases own. What it
 * costs is one regex pass per render over the text being rendered — the pending block on every
 * delta, and the settled half each time the split boundary moves and memo lets it re-render — which
 * `.verify/probe-shapes-inline.mjs` measures at well under a millisecond for forty thousand
 * characters. A reference then looks the same on both sides of the settle boundary, as the same
 * text in an inline code span already did.
 *
 * A block with no reference in it gets its `children` back untouched — the same reference, not a
 * copy — which is what `.verify/probe-shapes-baseline.mjs` holds byte-identical.
 */
export function renderInline(children: ReactNode): ReactNode {
  return linkifyChildren(children);
}
