import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** The two widths the tab's dialogs come in, the prototype's own: 520 for Mute, 600 for Enroll. */
const WIDTH = { md: 'max-w-[520px]', lg: 'max-w-[600px]' } as const;

type DialogFrameProps = {
  size: keyof typeof WIDTH;
  /** The serif heading's first words: "Mute", "Enroll a". */
  title: string;
  /**
   * What the dialog is about, after the title: words in the accent's italic ("*session is valid*",
   * "*node*"), or a check's raw key in mono while it has no name, the way every view of the tab names it.
   */
  accent: { words: string } | { key: string };
  /** A write is out: the ✕ waits with the dialog's own buttons. */
  busy?: boolean;
  /** Escape, the backdrop and the ✕. The dialog decides whether that closes it. */
  onDismiss: () => void;
  /** Which dialog this is, as `data-cerberus-dialog` on the panel: what a verify script finds it by. */
  marker: 'mute' | 'enroll';
  children: ReactNode;
};

/**
 * Verve's `Modal` (`_ds_bundle.js`, components/overlays/Modal.jsx), composed on the house `Dialog`: a
 * panel 520 or 600 wide, never wider than the screen less a margin, with the serif title and its accent
 * word at the top and the round ✕ in the top right corner. The panel scrolls as a whole on a screen too
 * short for it, so a step never hides its own buttons.
 *
 * Mounted only while its dialog is open, so the dialog opens clean every time and the house Dialog's own
 * Escape, backdrop, focus trap and first focus all hold. The ✕ comes LAST in the panel's order though it
 * is drawn first: the first focus then lands on the dialog's first field or chip, not on the way out, and
 * Escape still closes from anywhere.
 *
 * Used by the cerberus module's `MuteDialog` and `EnrollDialog`.
 */
export function DialogFrame({ size, title, accent, busy = false, onDismiss, marker, children }: DialogFrameProps) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onDismiss(); }}>
      <DialogContent
        aria-labelledby={titleId}
        data-cerberus-dialog={marker}
        className={cn('max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain p-0', WIDTH[size])}
      >
        <div className="relative px-[clamp(18px,5vw,32px)] py-[clamp(20px,5vw,30px)]">
          {/* Instrument Serif is never bold, so the accent is the italic and the green ink — accent TEXT,
              the readable half of the pair. A raw key is not a phrase: it keeps mono and stands upright. */}
          <DialogTitle
            id={titleId}
            className="not-sr-only mb-3 pr-12 font-serif text-[28px] font-normal leading-[1.1] text-foreground [overflow-wrap:anywhere] max-sm:text-[25px]"
          >
            {title}{' '}
            {'words' in accent
              ? <em className="italic text-accent-ink">{accent.words}</em>
              : <span className="font-mono text-[0.62em] text-accent-ink">{accent.key}</span>}
          </DialogTitle>
          {children}
          {/* 32 px at a desk; 44 px below md, Verve's touch minimum, grown 6 px each way about its own centre so
              the ✕ stays where it was and the title's 48 px of room still clears it. */}
          <button
            type="button"
            aria-label={t('buttons.close')}
            disabled={busy}
            onClick={onDismiss}
            className="absolute right-[clamp(18px,5vw,32px)] top-[clamp(19px,5vw,29px)] flex size-8 items-center justify-center rounded-full bg-muted text-base leading-none text-muted-foreground hover:bg-border disabled:pointer-events-none disabled:opacity-50 max-md:right-[calc(clamp(18px,5vw,32px)_-_6px)] max-md:top-[calc(clamp(19px,5vw,29px)_-_6px)] max-md:size-11"
          >
            ✕
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
