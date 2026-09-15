import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';

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
 */
export function EmbedFrame({
  kind,
  studioUrl,
  code,
  children,
}: WidgetEmbed & { code: string; children: ReactNode }) {
  const { t } = useTranslation('chat');

  const shapeKind = kind === 'docspace' ? 'docspace' : 'widget';
  const title = t(shapeKind === 'docspace' ? 'shapes.titles.docspace' : 'shapes.titles.widget');

  // Only a DocSpace block has somewhere outside this app to be opened: it is a real page on
  // ArchPulse, and its studio route is the deep link for the same two ids the frame was built from.
  // An HTML widget is model output this app composed, so `studioUrl` is null there and the header
  // carries no action at all rather than a dead one. `noopener noreferrer` on the new tab: ArchPulse
  // gets none of this page's window handle and none of its referrer.
  const actions = studioUrl ? (
    <a
      data-docspace-open
      href={studioUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-accent-ink hover:underline"
    >
      <ExternalLink aria-hidden="true" className="h-[1em] w-[1em]" />
      {t('shapes.openInArchPulse')}
    </a>
  ) : null;

  // The collapse key is the same content-addressed one every other shape uses, over the body this
  // frame's own embed was built from: folding a DocSpace card on one screen reopens it folded on the
  // next render of the same block. `CollapsibleContent` keeps its children mounted when closed, so
  // the fold never reloads the iframe and never discards an unsaved edit inside the block.
  return (
    <ShapeFrame
      kind={shapeKind}
      title={title}
      collapseKey={shapeKey(shapeKind, code)}
      actions={actions}
      flush
    >
      {children}
    </ShapeFrame>
  );
}
