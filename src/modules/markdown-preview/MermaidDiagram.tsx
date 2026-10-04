import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
// Type-only: erased at build time, so it does not pull mermaid into the main chunk.
import type mermaid from 'mermaid';

import { useTheme } from '@/shared/context/ThemeContext';
import { Lightbox } from '@/shared/ui';

// Mermaid is ~1.5MB minified, so it is loaded on demand the first time a
// diagram is rendered and shared by every instance afterwards.
let mermaidPromise: Promise<typeof mermaid> | null = null;
const loadMermaid = () => {
  mermaidPromise ??= import('mermaid').then((module) => module.default);
  return mermaidPromise;
};

type MermaidDiagramProps = {
  /** Raw mermaid source, i.e. the body of a ```mermaid fenced block. */
  code: string;
};

/**
 * Renders a ```mermaid code block as an SVG diagram, GitHub-preview style.
 *
 * Used by the chat module to render mermaid blocks in assistant messages, and
 * by MarkdownCodeBlock inside this module for markdown previews.
 *
 * While mermaid is loading — or when the source doesn't parse (e.g. a block
 * that is still streaming in) — the raw source is shown instead, so the
 * content is never blank or replaced by an error box. A source that FAILED
 * gets one muted line above it saying so, so a reader can tell a broken
 * diagram from one still loading.
 *
 * The line reads the `common` namespace, never `chat`: this component is
 * shared with the PRD editor, and a shared module reaching into one
 * feature's strings would point a dependency the wrong way.
 *
 * A drawn diagram opens in the kit's `Lightbox` on click (or Enter / Space): full screen, fitted,
 * then zoomable. It is opened HERE, on the component both render paths share, so the chat's fence
 * and a markdown preview behave alike. A diagram shown as its source never opens — there is nothing
 * to zoom.
 */
export default function MermaidDiagram({ code }: MermaidDiagramProps) {
  const { t } = useTranslation('common');
  const { isDarkMode } = useTheme();
  const reactId = useId();
  const renderId = `mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const [svg, setSvg] = useState<string | null>(null);
  // Whether the full-screen viewer is open. Local to this diagram: only its own click opens it.
  const [expanded, setExpanded] = useState(false);
  // Whether the LAST render attempt threw. `svg === null` alone cannot tell a failure from a
  // diagram still loading, and only the failure earns the "could not be drawn" line. It starts
  // false, so the first synchronous render — the one a static export keeps — is the bare source.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    loadMermaid()
      .then((mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: isDarkMode ? 'dark' : 'default',
          suppressErrorRendering: true,
        });
        return mermaid.render(renderId, code.trim());
      })
      .then((result) => {
        if (!cancelled) {
          setSvg(result.svg);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSvg(null);
          setFailed(true);
        }
        // suppressErrorRendering still leaves the scratch element behind on
        // parse failures in some mermaid versions; clean it up.
        document.getElementById(`d${renderId}`)?.remove();
      });

    return () => {
      cancelled = true;
    };
  }, [code, isDarkMode, renderId]);

  if (!svg) {
    const source = (
      <pre className="my-3 overflow-x-auto rounded-xl border border-border bg-muted/50 p-4 font-mono text-[0.8125rem] leading-relaxed text-muted-foreground">
        {code.trim()}
      </pre>
    );
    if (!failed) {
      return source;
    }
    // A `div` and not a `p`: inside the chat's `prose` wrapper a paragraph takes prose margins.
    // Its negative bottom margin collapses into the source block's top margin, so the line
    // sits close above the block it describes rather than floating a full block-gap away.
    return (
      <>
        <div data-diagram-failed className="-mb-1.5 mt-3 text-xs text-muted-foreground">
          {t('shapes.diagramFailed')}
        </div>
        {source}
      </>
    );
  }

  const openViewer = () => {
    // A drag that selected some of the diagram's labels ends in a click on the diagram: that is a
    // selection being made, not a request to open.
    if (window.getSelection()?.toString()) return;
    setExpanded(true);
  };

  return (
    <>
      {/* The button carries no paint of its own and the card is its child: on a touch screen
          index.css gives a tapped `[role="button"]` `background-color: inherit !important`, which
          would strip a card's own background until the next tap elsewhere. */}
      <div
        role="button"
        tabIndex={0}
        aria-label={t('shapes.diagramOpen')}
        onClick={openViewer}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openViewer();
          }
        }}
        className="my-3 cursor-zoom-in rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <div
          className="flex justify-center overflow-x-auto rounded-xl border border-border bg-card p-4 [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      {/* A sibling, not a child: the viewer is a portal, and React bubbles its events up the tree
          that opened it — a child would send the backdrop's close click back into this button. */}
      {expanded && <DiagramViewer svg={svg} onClose={() => setExpanded(false)} />}
    </>
  );
}

/** How much larger than its own natural size a small diagram may be blown up to fit the screen. */
const MAX_NATURAL_ENLARGEMENT = 2;

/**
 * The diagram's width and height from the `viewBox` mermaid writes on its root `<svg>`, or null.
 * Taken from the string, not the DOM: the viewer needs the aspect before the copy is laid out.
 */
function readViewBox(svg: string): { width: number; height: number } | null {
  const match = /<svg[^>]*\sviewBox="([^"]+)"/.exec(svg);
  const [, , width, height] = (match?.[1] ?? '').trim().split(/[\s,]+/).map(Number);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** The prefix that makes every id in the viewer's copy of a diagram differ from the inline one's. */
const VIEWER_ID_PREFIX = 'viewer-';

/**
 * `svg` with every element id renamed, and every reference to one renamed with it: the `id="…"`
 * attributes, `url(#…)` paints and markers, `href="#…"` uses, and the `#…` selectors of the
 * stylesheet mermaid embeds.
 *
 * Mermaid scopes its stylesheet and its arrowhead markers to the root id, and the other ids inside a
 * diagram (`actor14`, `root-15`, `arrowhead`) are numbered per diagram, not per page. The inline
 * diagram stays in the page behind the viewer, so the copy would share every one of them: an
 * invalid document, and a marker reference resolves to whichever element comes first.
 *
 * A PREFIX, never a suffix: the same stylesheet picks markers out by the END of their id
 * (`defs [id$="-crosshead"]`, `-barbEnd`, `-arrowhead`), and a suffix would stop those rules
 * matching — a black cross on the dark card. Nothing in mermaid selects by the start of an id.
 */
function withViewerIds(svg: string): string {
  const ids = Array.from(new Set(Array.from(svg.matchAll(/\sid="([^"]+)"/g), (match) => match[1])));
  if (ids.length === 0) return svg;
  // Longest first, so an id that is the prefix of another never wins the alternation.
  const alternation = ids
    .sort((first, second) => second.length - first.length)
    .map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return svg
    .replace(new RegExp(`(\\sid=")(${alternation})(")`, 'g'), `$1${VIEWER_ID_PREFIX}$2$3`)
    .replace(new RegExp(`#(${alternation})(?![\\w-])`, 'g'), `#${VIEWER_ID_PREFIX}$1`);
}

/**
 * A drawn diagram in the kit's viewer: a card (mermaid's `default` theme draws dark ink, which the
 * viewer's dark backdrop would swallow) sized so the WHOLE diagram fits the screen. The viewer
 * scales that card with a CSS transform, so the SVG is re-drawn at every zoom — vector, not a
 * snapshot. The copy carries its own ids (see `withViewerIds`).
 */
function DiagramViewer({ svg, onClose }: { svg: string; onClose: () => void }) {
  const { t } = useTranslation('common');
  const viewerSvg = withViewerIds(svg);
  const box = readViewBox(viewerSvg);
  // 3rem covers the card's padding and border. `dvh`, not `vh`: on a phone the browser bar makes
  // `vh` taller than the space the overlay actually has.
  const fitStyle = box
    ? {
        width: `min(calc(92vw - 3rem), calc((90dvh - 3rem) * ${box.width / box.height}), ${box.width * MAX_NATURAL_ENLARGEMENT}px)`,
        aspectRatio: `${box.width} / ${box.height}`,
      }
    : { width: 'min(calc(92vw - 3rem), 64rem)' };

  return (
    <Lightbox label={t('shapes.diagram')} onClose={onClose}>
      <div className="rounded-xl border border-border bg-card p-4 shadow-2xl">
        <div
          style={fitStyle}
          // Mermaid writes `max-width` and `width="100%"` on the root: overridden so the SVG fills
          // the card exactly, whatever its natural size.
          className={`[&_svg]:!w-full [&_svg]:!max-w-none ${box ? '[&_svg]:!h-full' : '[&_svg]:!h-auto'}`}
          dangerouslySetInnerHTML={{ __html: viewerSvg }}
        />
      </div>
    </Lightbox>
  );
}
