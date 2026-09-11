import { createContext } from 'react';

/**
 * True inside anything that is already a control, or already a label — where a file chip, itself a
 * `<button>`, must not be drawn.
 *
 * The chip is decided from TEXT (`InlineCode` sees one span's words, `linkifyChildren` one string),
 * so it cannot see what it sits in; the wrappers that put rendered markdown inside a control know,
 * and they say so through this. Provided by:
 *   * `MarkdownLink` — a chip inside an `<a>` is two controls in one, and one click would open the
 *     file through the chip AND follow the link;
 *   * `ShapeSection`, around a section's heading — the heading's words are the fold button, and a
 *     heading is a label, never a place for a chip;
 *   * `DataTable`, around its header row — a header's words are the sort button, and a header is a
 *     label too.
 *
 * Read by `FileChip` alone, which then draws the plain form it was handed instead. It lives in its
 * own module because `InlineMarks.tsx` exports components, and a context beside them would cost the
 * file its Fast Refresh.
 */
export const ChipsSuppressedContext = createContext(false);
