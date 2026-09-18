import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Maximize2, Minimize2 } from 'lucide-react';

import type { WidgetEmbed } from '@/shared/types';
import { shapeKey } from '@/modules/chat/transcript/shapes/collapseState';
import { ShapeFrame } from '@/modules/chat/transcript/shapes/ShapeFrame';

/**
 * A live embed's card: the one header every other shape wears, drawn over a frame this app did not
 * build.
 *
 * Passed BY `CodeBlock` (`shapes/code/index.tsx`) to `WidgetFrame` as its `frame`, and called by
 * `WidgetFrame` once its mount and streaming gates have both passed — so this never wraps the
 * source `<pre>` an export or a still-streaming fence carries, and nothing here has to know either
 * rule. The embed's identity arrives as the `WidgetEmbed` argument; this file imports nothing from
 * `@/modules/widgets` and never classifies a body, because classifying is the widgets module's one
 * job and a second classifier in the chat would be a second answer to the same question.
 *
 * `flush`, because the content IS a frame that reaches its own edges: a body inset here would put
 * two borders and two paddings between the reader and the block.
 *
 * FULLSCREEN IS DRAWN HERE AND DECIDED THERE. The switch is this card's — only the card can become
 * the screen — but the state behind it belongs to `WidgetFrame`, which owns the live element and is
 * the only component that can tell it to fill the box. That split is what keeps the toggle from
 * reloading the frame: nothing moves in the tree, a class changes. See `WidgetFrame`'s header.
 */
export function EmbedFrame({
  kind,
  openUrl,
  title,
  fullscreen,
  onToggleFullscreen,
  code,
  children,
}: WidgetEmbed & { code: string; children: ReactNode }) {
  const { t } = useTranslation('chat');

  // The three kinds and the three cards, mapped once. `html` is drawn as `widget` because that is
  // what the reader was told the fence is called everywhere else in the app.
  const shapeKind = kind === 'html' ? 'widget' : kind;
  // An embed's heading is the model's own words when it gave any: "Grafana — CPU" is worth a header
  // row and "Embed" is not. The other two kinds name themselves, so their titles are fixed.
  const cardTitle = (kind === 'embed' ? title : null) ?? t(`shapes.titles.${shapeKind}`);
  const toggleLabel = fullscreen ? t('shapes.exitFullscreen') : t('shapes.fullscreen');

  // A DocSpace block is a real page on ArchPulse and an embed is a real page somewhere else, so both
  // have somewhere outside this app to be opened and both say where in their own words. An HTML
  // widget is model output this app composed, so `openUrl` is null there and the header carries no
  // action at all rather than a dead one. For the embed kind the link is doing more than convenience:
  // a page that refuses to be framed renders as an empty box that nothing in this page can detect,
  // and this is the reader's only way through to it. `noopener noreferrer` on the new tab: the target
  // gets none of this page's window handle and none of its referrer.
  const openLink = openUrl ? (
    <a
      data-docspace-open={kind === 'docspace' ? '' : undefined}
      data-embed-open={kind === 'embed' ? '' : undefined}
      href={openUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-accent-ink hover:underline"
    >
      <ExternalLink aria-hidden="true" className="h-[1em] w-[1em]" />
      {kind === 'docspace' ? t('shapes.openInArchPulse') : t('shapes.openExternal')}
    </a>
  ) : null;

  // Offered on every live embed, not just the new kind: a DocSpace block being edited and a widget
  // drawing a chart both outgrow a card in a chat column, and the switch is the same one verb over
  // whichever frame is inside. Sized in `em` like every other glyph in this header, so it follows
  // the chat text size the reader set.
  const fullscreenToggle = (
    <button
      type="button"
      data-embed-fullscreen-toggle
      aria-pressed={fullscreen}
      aria-label={toggleLabel}
      title={toggleLabel}
      onClick={onToggleFullscreen}
      className="inline-flex items-center rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
    >
      {fullscreen ? (
        <Minimize2 aria-hidden="true" className="h-[1.125em] w-[1.125em]" />
      ) : (
        <Maximize2 aria-hidden="true" className="h-[1.125em] w-[1.125em]" />
      )}
    </button>
  );

  // The collapse key is the same content-addressed one every other shape uses, over the body this
  // frame's own embed was built from: folding a DocSpace card on one screen reopens it folded on the
  // next render of the same block. `CollapsibleContent` keeps its children mounted when closed, so
  // the fold never reloads the iframe and never discards an unsaved edit inside the block.
  return (
    <ShapeFrame
      kind={shapeKind}
      title={cardTitle}
      collapseKey={shapeKey(shapeKind, code)}
      actions={
        <>
          {openLink}
          {fullscreenToggle}
        </>
      }
      fullscreen={fullscreen}
      flush
    >
      {children}
    </ShapeFrame>
  );
}
