import { Children } from 'react';
import type { ReactNode } from 'react';

import { shapeKey } from '@/modules/chat/transcript/shapes/collapseState';
import { parseAlertKind } from '@/modules/chat/transcript/shapes/detect';
import type { HastNode } from '@/modules/chat/transcript/shapes/hast';
import { textOf } from '@/modules/chat/transcript/shapes/hast';
import { liftLeadingToken } from '@/modules/chat/transcript/shapes/listItems';
import { Callout } from '@/modules/chat/transcript/shapes/Callout';

/** See `elements/table.tsx` for why this shape is declared per module rather than shared. */
type PlainElementProps = { node?: HastNode; children?: ReactNode };

/**
 * The `blockquote` override, moved out of `Markdown.tsx` unchanged. Used through
 * `elements/index.ts`.
 */
export function PlainBlockquote({ children }: PlainElementProps) {
  return (
    <blockquote className="my-3 border-l-2 border-primary/50 pl-4 italic text-muted-foreground">
      {children}
    </blockquote>
  );
}

/**
 * How much of the first line the `[!KIND]` marker occupies, including the newline that ends it.
 *
 * This is NOT a second trigger and it decides nothing: `parseAlertKind` has already read the first
 * line and said yes before this runs. All it does is measure how many characters to lift out of the
 * rendered text, so the marker is not printed twice — once as the frame's title and once again at
 * the top of the banner.
 */
const markerLength = (text: string): number => {
  const match = /^[ \t]*\[![A-Za-z]+\][ \t]*\n?/.exec(text);
  return match ? match[0].length : 0;
};

/**
 * The `blockquote` entry of `SHAPE_COMPONENTS`: a GitHub alert becomes a `Callout`, and every other
 * quotation stays exactly the blockquote this app renders today.
 *
 * Used through `elements/index.ts` by `Markdown.tsx`'s shape map, and reached only on a settled
 * body — the streaming half renders through `PLAIN_COMPONENTS`, decided once by the ternary in
 * `Markdown.tsx`, which this phase does not touch. Nothing here reads `MarkdownStreamingContext`,
 * and a half-arrived `> [!WARN` is never a callout because it never reaches this component at all.
 *
 * The first line is read off the WHOLE subtree's text and must be the marker and nothing else.
 * `> [!NOTE] see below` is a sentence the author wrote and stays a quotation, because folding the
 * words after the marker into a banner title would drop "see below"; and a quote that merely OPENS
 * with the word NOTE or WARNING is prose — the trigger is the bracket-bang syntax and only that.
 * Both of those are `parseAlertKind`'s rules rather than this file's, and there are exactly five
 * kinds: the five the operator named, whatever else GitHub grows.
 *
 * When the marker cannot be lifted back out of the rendered children — a shape the walk does not
 * open — the quote is returned plain rather than drawn as a callout still showing `[!NOTE]` inside
 * it. When in doubt, return the fallback.
 */
export function ShapeBlockquote({ node, children }: PlainElementProps) {
  const fallback = <PlainBlockquote>{children}</PlainBlockquote>;
  if (!node) return fallback;

  const text = textOf(node).trim();
  const kind = parseAlertKind(text.split('\n')[0] ?? '');
  if (!kind) return fallback;

  const lifted = liftLeadingToken(children, markerLength);
  if (!lifted) return fallback;
  // A quote holding the marker and NOTHING else has no body to put in a banner — it would draw a
  // titled, coloured band with nothing in it. It stays the quote the author wrote, `[!NOTE]` and
  // all. Measured on what is left to RENDER, not on text: an alert whose body is only an image has
  // no text and is still a body.
  const leftToRender = Children.toArray(lifted.rest).filter(
    (child) => !(typeof child === 'string' && !child.trim())
  );
  if (leftToRender.length === 0) return fallback;

  // The plan's payload for a callout: the kind word, then the quote's whole text. Two alerts
  // carrying the same words fold together; an alert and a plain quotation never share a key.
  return (
    <Callout kind={kind} collapseKey={shapeKey('callout', `${kind}\n${textOf(node)}`)}>
      {lifted.rest}
    </Callout>
  );
}
