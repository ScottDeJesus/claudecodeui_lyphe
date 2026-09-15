import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Lightbulb, MessageSquareWarning, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { Tone } from '@/shared/types';
import { Banner } from '@/shared/ui';
import type { AlertKind } from '@/modules/chat/transcript/shapes/detect';
import { ShapeFrame } from '@/modules/chat/transcript/shapes/ShapeFrame';

type CalloutProps = {
  /** Which of the five GitHub alert kinds `parseAlertKind` read off the first line. */
  kind: AlertKind;
  collapseKey: string;
  /** The blockquote's rendered children with the `[!KIND]` marker already lifted off the front. */
  children: ReactNode;
};

/**
 * The tone each alert kind is painted in, and the whole of the mapping.
 *
 * It travels as `data-tone` — `Banner` sets that attribute and `tokens.css` swaps `--tone-soft`,
 * `--tone-ink` and `--tone-glyph` behind it — so the fill, the ink and the mark are one token
 * decision that is legible in both themes. A hard-coded colour here would read as amber on white
 * and as amber on near-black, and the second of those is the one nobody can read.
 *
 * `note` and `important` share `info` deliberately: five kinds, five words, and only five tones in
 * the vocabulary. The WORD is what tells them apart, and the word is the frame's title.
 */
const TONE_BY_KIND: Record<AlertKind, Tone> = {
  note: 'info',
  tip: 'positive',
  important: 'info',
  warning: 'warn',
  caution: 'danger',
};

/**
 * The icon each alert kind wears in its frame's header, and the whole of the mapping.
 *
 * `ShapeFrame`'s registry carries one icon per KIND, and all five alerts are the one `callout`
 * kind — so the frame would draw `Info` five times over and the kind's word would become the only
 * channel telling a `tip` from a `caution`. The icon is the kind's own, drawn beside the tone the
 * map above picked, which is what lets an alert be recognised before its word is read.
 */
const ICON_BY_KIND: Record<AlertKind, LucideIcon> = {
  note: Info,
  tip: Lightbulb,
  important: MessageSquareWarning,
  warning: TriangleAlert,
  caution: OctagonAlert,
};

/**
 * A `> [!NOTE]` alert as a titled, toned banner.
 *
 * Used by `elements/blockquote.tsx` and nothing else. The title is the kind's own translated word
 * — `titles.callout` alone cannot say five things — and the body is the blockquote's remaining
 * children, rendered exactly as react-markdown gave them, so every link, code span and bold inside
 * the alert survives becoming a shape.
 *
 * The strip itself is the shared `Banner` rather than a hand-toned blockquote, which is that
 * component's own stated contract: every caller needs a toned strip carrying a sentence, and none
 * should spell a second one. Its mark (`--tone-glyph`) is the second channel the tone doctrine
 * requires — an alert that said "caution" in red alone would say nothing in greyscale.
 */
export function Callout({ kind, collapseKey, children }: CalloutProps) {
  const { t } = useTranslation('chat');

  return (
    <ShapeFrame
      kind="callout"
      title={t(`shapes.alert.${kind}`)}
      collapseKey={collapseKey}
      tone={TONE_BY_KIND[kind]}
      icon={ICON_BY_KIND[kind]}
    >
      {/* The banner keeps the frame's own inset rather than bleeding to the border, so a callout
          sits in the transcript the way `DecisionMatrix`'s cards do — one shape vocabulary, not
          two. `Banner` draws its own 10px radius, which a flush strip would clip against the
          frame's rounded corners. */}
      <Banner tone={TONE_BY_KIND[kind]}>
        {/* `PlainParagraph` is a `div.mb-2`, so the last paragraph in the quote would leave a gap
            inside the band. Closed here, in the caller, rather than by touching the paragraph. */}
        <div className="[&>div:last-child]:mb-0">{children}</div>
      </Banner>
    </ShapeFrame>
  );
}
