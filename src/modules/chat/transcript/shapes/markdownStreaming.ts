import { createContext } from 'react';

/**
 * True while this markdown is the still-growing half of a streamed reply.
 *
 * `StreamingMarkdown` renders the settled half as `<MarkdownBody>` and the pending half as
 * `<MarkdownBody streaming>`, and the pending body is what sets this.
 *
 * It is NOT how the streaming fallback is decided. That decision is made once, at the top of
 * `Markdown.tsx`, by choosing the plain components map over the shape map — so no shape component
 * reads this context, and a future shape cannot forget the rule because there is no rule for it to
 * forget. Exactly one consumer is left: `CodeBlock`, the `shapes/code` dispatcher, which is in the
 * plain map too and still has to pass `streaming` down to `WidgetFrame` so a half-arrived widget
 * fence stays source instead of mounting a live scripted frame.
 *
 * It lives in its own module for one reason: `Markdown.tsx` imports `CodeBlock` and `CodeBlock`
 * needs the context, so leaving it in `Markdown.tsx` would be an import cycle.
 */
export const MarkdownStreamingContext = createContext(false);
