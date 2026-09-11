import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

import { copyTextToClipboard } from '@/shared/utils';
import { SyntaxHighlighter } from '@/shared/syntaxHighlighter';
import { MermaidDiagram } from '@/modules/markdown-preview';
import { buildSyntaxTheme } from '@/modules/chat/utils/syntaxHighlightTheme';
import type { PrismStyleSheet } from '@/modules/chat/utils/syntaxHighlightTheme';
import { shapeKey } from '@/modules/chat/transcript/shapes/collapseState';
import { parseStatsFence } from '@/modules/chat/transcript/shapes/detect';
import { ShapeFrame } from '@/modules/chat/transcript/shapes/ShapeFrame';
import { useShapeInteractive } from '@/modules/chat/transcript/shapes/useShapeCollapse';
import { StatTiles } from '@/modules/chat/transcript/shapes/StatTiles';
import { DiffBlock } from '@/modules/chat/transcript/shapes/DiffBlock';
import { LongOutput } from '@/modules/chat/transcript/shapes/LongOutput';
import type { OutputClamp } from '@/modules/chat/transcript/shapes/LongOutput';

type CodeFenceProps = {
  /** The fence body, already stripped of its trailing newline by the dispatcher. */
  raw: string;
  /** The `language-*` token, or `text`. Feeds both the label and the highlighter. */
  language: string;
  /**
   * True while this fence is the still-growing half of a streamed reply.
   *
   * It arrives as a PLAIN PROP, never from context: `shapes/code/index.tsx` is the only consumer
   * of `MarkdownStreamingContext` left in the tree, and this component reads no context at all.
   */
  streaming?: boolean;
};

/**
 * The fence shapes, tried in the plan's precedence: mermaid → stats → diff → long output → plain.
 * The widget fence is decided before this, in the dispatcher, and never arrives here.
 *
 * Its only consumer is the `shapes/code` dispatcher, which routes a block fence here once it has
 * ruled out the inline span and the widget frame.
 *
 * **Streaming comes first, and ends the question.** A fence in the still-growing half of a reply is
 * today's highlighted block whatever its language — a half-arrived stats fence would draw tiles
 * that lose a line on the next delta, a half-arrived mermaid fence would re-run the diagram parser
 * on source that cannot parse yet, every 100 ms. The flag is read HERE, as a prop, where the
 * dispatcher already decides the widget branch off the same value — never inside a shape.
 *
 * Every branch that declines — a stats fence with one malformed line, a short fence — ends in
 * `FenceBlock` with no clamp, which is today's markup byte for byte.
 */
export function CodeFence({ raw, language, streaming = false }: CodeFenceProps) {
  const { t } = useTranslation('chat');
  // False only inside a transcript export. Read BEFORE the streaming return so every render calls
  // the same hooks in the same order, whether this fence is still growing or has settled.
  const interactive = useShapeInteractive();

  if (streaming) {
    return <FenceBlock raw={raw} language={language} />;
  }

  if (language === 'mermaid') {
    // A diagram wears the frame every shape wears. Its colours are mermaid's own — it themes itself
    // from `mermaid.initialize({ theme })` — and a failed parse shows its source, never an error box.
    // Settled only: the streaming return above already sent a half-arrived one to the plain block.
    //
    // An export draws the SOURCE inside the same frame. It renders through `renderToStaticMarkup`,
    // where no effect runs to draw a diagram and no `ThemeProvider` sits above `MermaidDiagram`'s
    // `useTheme()` — mounting it there throws and the download never happens. The frame stays so
    // an exported transcript counts the same shapes the live one does.
    return (
      <ShapeFrame kind="diagram" title={t('shapes.titles.diagram')} collapseKey={shapeKey('diagram', raw)}>
        {interactive ? <MermaidDiagram code={raw} /> : <FenceBlock raw={raw} language={language} />}
      </ShapeFrame>
    );
  }

  // All or nothing: `parseStatsFence` returns null if ANY line is malformed, and then this is not a
  // stats fence at all — drawing the lines that did parse would drop the one that did not.
  const tiles = language === 'stats' ? parseStatsFence(raw) : null;
  if (tiles) {
    return <StatTiles tiles={tiles} collapseKey={shapeKey('stats', raw)} />;
  }

  if (language === 'diff') {
    return <DiffBlock raw={raw} collapseKey={shapeKey('diff', raw)} />;
  }

  // The last rung and the fallback in one: `LongOutput` decides whether the block is long, and hands
  // a short one back with no clamp — which is `FenceBlock` exactly as it has always rendered.
  return (
    <LongOutput raw={raw} collapseKey={shapeKey('output', raw)}>
      {(clamp) => <FenceBlock raw={raw} language={language} clamp={clamp} />}
    </LongOutput>
  );
}

type FenceBlockProps = {
  raw: string;
  language: string;
  /** Set only by `LongOutput`: the lines to draw, the fade over them and the control beneath. */
  clamp?: OutputClamp;
};

/**
 * The ordinary highlighted block: the old `CodeBlock`'s fenced half, moved out of `Markdown.tsx`.
 *
 * With no `clamp` its markup is today's, byte for byte — `probe-shapes-baseline.mjs` pins it. The
 * copy button ALWAYS copies `raw`, the whole fence, even while a clamp is drawing only the first
 * lines of it: a reader copying a log wants the log, not the preview of it.
 */
function FenceBlock({ raw, language, clamp }: FenceBlockProps) {
  const { t } = useTranslation('chat');
  // Whether the last copy landed, so the button can show a tick for a moment.
  const [copied, setCopied] = useState(false);
  const languageLabel = language.charAt(0).toUpperCase() + language.slice(1);

  return (
    <div className="group my-3 overflow-hidden rounded-xl border border-border bg-muted/50 shadow-sm dark:bg-zinc-900">
      {/* Label row shares the block's background — no divider, ChatGPT-style */}
      <div className="flex items-center justify-between px-4 pt-2">
        <span className="select-none text-xs text-muted-foreground">{languageLabel}</span>
        <button
          type="button"
          onClick={() =>
            copyTextToClipboard(raw).then((success) => {
              if (success) {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            })
          }
          className={`rounded-md p-1 transition-opacity focus-visible:opacity-100 ${copied
            ? 'text-green-600 opacity-100 dark:text-green-500'
            : 'text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100'
            }`}
          title={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
          aria-label={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
        >
          {copied ? (
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
            </svg>
          )}
        </button>
      </div>

      {clamp ? (
        <>
          <div className={clamp.bodyClassName}>{highlight(language, clamp.shown)}</div>
          {clamp.control}
        </>
      ) : (
        highlight(language, raw)
      )}
    </div>
  );
}

/** The highlighter as the block has always configured it, over whichever text the block draws. */
function highlight(language: string, text: string) {
  return (
    <SyntaxHighlighter
      language={language}
      style={syntaxTheme.style}
      customStyle={{
        margin: 0,
        borderRadius: 0,
        fontSize: '0.8125rem',
        lineHeight: 1.6,
        padding: '0.5rem 1rem 1rem',
        // The container owns the background so the label row and code read as one panel.
        background: 'transparent',
      }}
      codeTagProps={{
        style: {
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          background: 'transparent',
        },
      }}
    >
      {text}
    </SyntaxHighlighter>
  );
}

/**
 * One style object for both themes: switching between the two Prism objects
 * re-tokenized every mounted code block, so the theme-dependent values are CSS
 * variables and the toggle is a style recalculation instead.
 */
const syntaxTheme = buildSyntaxTheme(oneLight as PrismStyleSheet, oneDark as PrismStyleSheet);

// The `:root`/`.dark` declarations backing syntaxTheme.style. Injected once
// because the values are derived from the Prism theme objects at runtime and so
// cannot live in index.css. ThemeContext toggles `.dark` on <html>, which is
// what repaints the tokens.
//
// It stays at MODULE SCOPE behind its `getElementById` guard, exactly where it was: moved into a
// component body it would run on every mounted fence, and moved out of the module graph entirely
// it would never run at all. `Markdown.tsx` statically imports the dispatcher, which statically
// imports this file, so it still executes at the same point in the load it always did.
const SYNTAX_THEME_STYLE_ELEMENT_ID = 'cc-syntax-theme';
if (!document.getElementById(SYNTAX_THEME_STYLE_ELEMENT_ID)) {
  const styleElement = document.createElement('style');
  styleElement.id = SYNTAX_THEME_STYLE_ELEMENT_ID;
  styleElement.textContent = syntaxTheme.css;
  document.head.appendChild(styleElement);
}
