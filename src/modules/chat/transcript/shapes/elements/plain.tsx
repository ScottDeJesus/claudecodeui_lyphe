import type { ComponentPropsWithoutRef } from 'react';

import type { HastNode } from '@/modules/chat/transcript/shapes/hast';
import { ShapeSection } from '@/modules/chat/transcript/shapes/ShapeSection';
import { TabbedCode } from '@/modules/chat/transcript/shapes/TabbedCode';

/**
 * An element that had NO override before this phase, so its props were whatever react-markdown's
 * default forwarded. `node` is destructured out; everything else must reach the tag, or the
 * override silently renders LESS than the default it replaced.
 */
type HeadingProps = { node?: HastNode } & ComponentPropsWithoutRef<'h2'>;
/** `data-shape` is named so `ShapeDiv` can read it; a `data-*` attribute is otherwise untyped. */
type DivProps = { node?: HastNode; 'data-shape'?: string } & ComponentPropsWithoutRef<'div'>;

/** The `hr` override, moved out of `Markdown.tsx` unchanged. Used through `elements/index.ts`. */
export function PlainRule() {
  return <hr className="my-4 border-t border-border" />;
}

const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
type HeadingTag = (typeof HEADING_TAGS)[number];
const isHeadingTag = (tagName: string | undefined): tagName is HeadingTag =>
  (HEADING_TAGS as readonly string[]).includes(tagName ?? '');

/**
 * The `h1`–`h6` overrides, all six of them. Used through `elements/index.ts`.
 *
 * It adds NOTHING of its own — no className, no wrapper — because Tailwind Typography dresses
 * headings from the prose container and a class here would be a second opinion.
 *
 * But it FORWARDS the properties the tree gave it, because that is what the default it replaced
 * did. Almost every heading carries none, which is why the baseline document records `<h1>…</h1>`
 * with no attribute at all. GFM's footnote section is the exception: it emits
 * `<h2 class="sr-only" id="footnote-label">Footnotes</h2>` (`mdast-util-to-hast/lib/footer.js`),
 * and dropping that className turns a screen-reader-only label into a visible 1392x23 px heading
 * in every reply that uses `[^1]`. Forwarding rather than naming `className`/`id` keeps this right
 * for whatever a future plugin decides a heading should carry.
 *
 * The six share a component because the level, read from `node`, is the only thing that
 * distinguishes them. A heading never learns it can fold: the section wrapper `remarkShapeGroups`
 * builds around it is what `ShapeSection` draws, and that component makes this heading's words the
 * toggle from outside.
 */
export function PlainHeading({ node, children, ...props }: HeadingProps) {
  const tagName = node?.tagName;
  // react-markdown always passes `node`, so the fallback is unreachable in this tree; it exists so
  // the tag is a checked literal rather than a cast.
  const Tag: HeadingTag = isHeadingTag(tagName) ? tagName : 'h2';
  return <Tag {...props}>{children}</Tag>;
}

/**
 * The `div` override. Used through `elements/index.ts`.
 *
 * A plain `div` carrying whatever properties the tree gave it — react-markdown's own default
 * behaviour, restated here only because the element now needs a NAMED entry for `ShapeDiv` to
 * replace. No markdown construct reaches it today (rehype-katex renders display math as a
 * `span.katex-display`, and without `rehype-raw` a raw `<div>` the author typed never becomes an
 * element: react-markdown, with `skipHtml` unset, turns every raw HTML node into a text node and it
 * renders as escaped text), and `remarkShapeGroups`' wrappers never do either: the plugin runs only
 * for the shape map, where `ShapeDiv` routes them.
 */
export function PlainDiv({ node: _node, children, ...props }: DivProps) {
  return <div {...props}>{children}</div>;
}

/**
 * The `div` entry of `SHAPE_COMPONENTS`. Used through `elements/index.ts`.
 *
 * `remarkShapeGroups` is the only thing that puts a `div` into this tree, and it marks each one
 * with the shape it groups: a run of fences in different languages reaches `TabbedCode`, a heading
 * and its body reach `ShapeSection`. Every other `div` — none today, but whatever a future plugin
 * emits — is `PlainDiv`, exactly as the plain map draws it.
 *
 * It routes on the RENDERED prop and passes `node` through untouched: each shape decides from the
 * hast subtree and renders from `children`, and this dispatcher decides nothing else.
 */
export function ShapeDiv(props: DivProps) {
  const shape = props['data-shape'];
  if (shape === 'tabbed-code') return <TabbedCode node={props.node}>{props.children}</TabbedCode>;
  if (shape === 'section') return <ShapeSection node={props.node}>{props.children}</ShapeSection>;
  return <PlainDiv {...props} />;
}
