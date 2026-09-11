import { isValidElement, useContext } from 'react';
import type { ReactNode } from 'react';

import { WidgetFrame } from '@/modules/widgets';
import { MarkdownStreamingContext } from '@/modules/chat/transcript/shapes/markdownStreaming';
import { CodeFence } from '@/modules/chat/transcript/shapes/code/CodeFence';
import { InlineCode } from '@/modules/chat/transcript/shapes/code/InlineCode';

export type CodeBlockProps = {
  node?: any;
  className?: string;
  children?: ReactNode;
  /** Set by `CodePre`: this code element is a fenced/indented block. */
  forceBlock?: boolean;
};

/**
 * The routing decision `code` has always made, and now nothing else.
 *
 * Used by `Markdown.tsx` as the `code` override in both component maps. `CodeBlock` was two
 * unrelated renderers that react-markdown merely routed through one component; splitting at the
 * decision leaves the decision here and gives each renderer its own file to grow in.
 *
 * This is the ONLY consumer of `MarkdownStreamingContext` left in the tree. It reads the flag once
 * and passes it DOWN as a plain prop, so no shape component can forget the streaming rule — there
 * is no rule left for a shape to forget.
 *
 * `node` is destructured out so react-markdown's hast node never reaches the DOM.
 */
export function CodeBlock({ node: _node, className, children, forceBlock }: CodeBlockProps) {
  const streaming = useContext(MarkdownStreamingContext);
  // Fenced blocks carry a trailing newline in the tree; trim it so the
  // highlighter doesn't render an empty final line.
  const raw = (Array.isArray(children) ? children.join('') : String(children ?? '')).replace(/\n$/, '');
  // react-markdown v9+ dropped the `inline` prop: block code is whatever the
  // `pre` renderer hands us (forceBlock). Multiline is kept as a safety net.
  const shouldInline = !forceBlock && !/[\r\n]/.test(raw);

  if (shouldInline) {
    return <InlineCode raw={raw} />;
  }

  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : 'text';

  // The widget opt-in is the WHOLE info-string word. `language` above is a `\w+` capture, which
  // stops at a hyphen, so a `widget-config` fence sets it to `widget` — and an ordinary
  // documentation label would mount a live scripted frame. That is tolerable for mermaid, where a
  // mis-trigger draws a diagram; it is not tolerable here, where it runs script. `fenceToken` is
  // the same capture without the hyphen boundary, so requiring the two to AGREE is requiring that
  // nothing was cut off the end. `language` is left alone: it also feeds the block's label and
  // the highlighter, where stopping at the hyphen is what makes ```js{1,3} still highlight as js.
  const fenceToken = /language-(\S+)/.exec(className || '')?.[1] ?? '';
  if (language === 'widget' && fenceToken === language) {
    return <WidgetFrame code={raw} streaming={streaming} />;
  }

  return <CodeFence raw={raw} language={language} streaming={streaming} />;
}

/**
 * Used by `Markdown.tsx` as the `pre` override.
 *
 * Fenced/indented code arrives as <pre><code>. Re-render the child CodeBlock
 * with `forceBlock` so it always gets the block treatment (react-markdown v9+
 * no longer passes an `inline` flag), and skip the outer <pre> so Tailwind
 * Typography doesn't wrap the highlighter in a second dark shell.
 */
export function CodePre({ children }: { children?: ReactNode }) {
  const child = Array.isArray(children) ? children.find(isValidElement) : children;
  if (isValidElement(child) && child.type === CodeBlock) {
    return <CodeBlock {...(child.props as CodeBlockProps)} forceBlock />;
  }
  return <>{children}</>;
}
