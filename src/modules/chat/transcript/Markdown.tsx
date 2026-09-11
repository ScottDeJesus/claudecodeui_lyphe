import { memo, useMemo } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

import { normalizeInlineCodeFences } from '@/modules/chat/utils/chatFormatting';
import { CodeBlock, CodePre } from '@/modules/chat/transcript/shapes/code';
import { MarkdownLink } from '@/modules/chat/transcript/shapes/MarkdownLink';
import { MarkdownStreamingContext } from '@/modules/chat/transcript/shapes/markdownStreaming';
import { remarkShapeGroups } from '@/modules/chat/transcript/shapes/remarkShapeGroups';
import {
  PlainBlockquote,
  PlainDiv,
  PlainHeading,
  PlainList,
  PlainListItem,
  PlainParagraph,
  PlainRule,
  PlainTable,
  PlainTableCell,
  PlainTableHead,
  PlainTableHeaderCell,
  PlainTableRow,
  ShapeBlockquote,
  ShapeDiv,
  ShapeList,
  ShapeListItem,
  ShapeParagraph,
  ShapeTable,
  ShapeTableCell,
} from '@/modules/chat/transcript/shapes/elements';

type MarkdownProps = {
  children: ReactNode;
  className?: string;
  /** Render single newlines as hard line breaks (for user-typed messages). */
  breaks?: boolean;
};

// The delimiters `remark-math` recognizes with `singleDollarTextMath` off.
const MATH_DELIMITER = /\$\$|\\\(|\\\[/;

const EMPTY_PLUGINS: never[] = [];

/**
 * Today's markup, element for element and class for class. Every entry is a `Plain*` component out
 * of `shapes/elements` or `shapes/code`, and `.verify/probe-shapes-baseline.mjs` holds a serialised
 * DOM that says so.
 */
const PLAIN_COMPONENTS = {
  code: CodeBlock,
  pre: CodePre,
  blockquote: PlainBlockquote,
  hr: PlainRule,
  p: PlainParagraph,
  ul: PlainList,
  ol: PlainList,
  li: PlainListItem,
  table: PlainTable,
  thead: PlainTableHead,
  tr: PlainTableRow,
  th: PlainTableHeaderCell,
  td: PlainTableCell,
  a: MarkdownLink,
  h1: PlainHeading,
  h2: PlainHeading,
  h3: PlainHeading,
  h4: PlainHeading,
  h5: PlainHeading,
  h6: PlainHeading,
  div: PlainDiv,
};

/**
 * The same map with the elements that have a shape swapped for their `Shape*` twin.
 *
 * It is SPREAD from `PLAIN_COMPONENTS` rather than written out, so the two maps cannot disagree
 * about an element neither has a shape for. A `Shape*` that is still an alias of its `Plain*`
 * (`ShapeListItem`, `ShapeTableCell`) is replaced in its own module, never here, so both maps are
 * complete as written.
 */
const SHAPE_COMPONENTS = {
  ...PLAIN_COMPONENTS,
  table: ShapeTable,
  td: ShapeTableCell,
  ul: ShapeList,
  ol: ShapeList,
  li: ShapeListItem,
  blockquote: ShapeBlockquote,
  p: ShapeParagraph,
  div: ShapeDiv,
};

/**
 * Used by chat's MessageComponent, ToolErrorDisplay and MarkdownContent to
 * render model-authored markdown with this module's shared prose styling,
 * code highlighting and table rules.
 *
 * The streaming rule has ONE enforcement site, and it is this component: the ternary below picks
 * the map, and the same flag keeps `remarkShapeGroups` out of `remarkPlugins`. A half-arrived table
 * or list must never be read as a shape, and deciding that here — once, from a flag the body
 * already carries — is what keeps the streaming fallback byte-identical to today by construction
 * rather than by fifteen careful hands.
 */
function MarkdownBodyRenderer({ children, breaks = false, streaming = false }: Omit<MarkdownProps, 'className'> & { streaming?: boolean }) {
  const content = useMemo(
    () => normalizeInlineCodeFences(String(children ?? '')),
    [children],
  );
  // Math support costs a remark tree pass plus a full KaTeX walk on every
  // render, and almost no assistant message contains math. Only wire the two
  // plugins up when the text has a delimiter they could act on.
  const hasMath = useMemo(() => MATH_DELIMITER.test(content), [content]);
  const remarkPlugins = useMemo(
    () => {
      const plugins: unknown[] = [remarkGfm];
      if (hasMath) {
        plugins.push([remarkMath, { singleDollarTextMath: false }]);
      }
      if (breaks) {
        plugins.push(remarkBreaks);
      }
      // Tab groups and heading sections rearrange sibling blocks, so they wait for settled text:
      // on the still-growing half a half-arrived fence would join and leave a group every delta.
      if (!streaming) {
        plugins.push(remarkShapeGroups);
      }
      return plugins as any;
    },
    [breaks, hasMath, streaming],
  );
  const rehypePlugins = useMemo(() => (hasMath ? [rehypeKatex] : EMPTY_PLUGINS), [hasMath]);
  // Both maps are module constants — nothing in either closes over a hook, now that MarkdownLink
  // calls usePaletteOps itself — so the choice is free and needs no useMemo of its own.
  const components = streaming ? PLAIN_COMPONENTS : SHAPE_COMPONENTS;

  return (
    <MarkdownStreamingContext.Provider value={streaming}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components as any}>
        {content}
      </ReactMarkdown>
    </MarkdownStreamingContext.Provider>
  );
}

/**
 * Markdown blocks without the prose wrapper. Used by StreamingMarkdown so a
 * streamed reply's settled and pending halves render as siblings inside ONE
 * prose container — Tailwind Typography's `> :first-child`/`> :last-child`
 * margin rules are per-container, so two containers would zero the gap at the
 * seam and make it pop back when the boundary moves.
 *
 * Memoized so a re-render does not re-run remark, rehype, KaTeX and Prism over
 * text that has not changed.
 */
export const MarkdownBody = memo(MarkdownBodyRenderer);

/**
 * The reading size of the transcript itself — every message body, user and assistant, in one
 * string so the size is decided once rather than in four class attributes that drift apart.
 *
 * The size is the reader's own, carried in `--chat-font-size` (see `useChatFontSize`), which
 * ChatMessagesPane sets on the scroller around every message. It used to read
 * `prose-base sm:prose-sm`, which shrank the body to 14px from 640px UP — the wide screen,
 * where the measure is longest and a display serif (Instrument Serif) sits optically smallest,
 * got the smallest type in the app, and nobody could say otherwise.
 *
 * The size lands as a Tailwind arbitrary utility rather than a rule of our own: `.prose` sets
 * its root font-size in the components layer, and a utility is emitted after that layer, so
 * this wins on order without an `!important` or a specificity contest. Everything inside a
 * prose container is sized in `em`, so the whole block scales from this one number.
 *
 * Callers that need a tone (`prose-gray`) append it; nobody re-states the size.
 */
export const TRANSCRIPT_PROSE = 'prose prose-base max-w-none font-serif text-[length:var(--chat-font-size,1rem)] dark:prose-invert';

/** Markdown in its own prose container. The form every non-streaming caller uses. */
export const Markdown = memo(function Markdown({ children, className, breaks }: MarkdownProps) {
  return (
    <div className={className}>
      <MarkdownBody breaks={breaks}>{children}</MarkdownBody>
    </div>
  );
});
