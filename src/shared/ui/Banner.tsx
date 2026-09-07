import type { ReactNode } from 'react';

import type { Tone } from '@/shared/types';

type BannerProps = {
  tone: Tone;
  children: ReactNode;
  /** Buttons or links that answer the banner, rendered after the message on the same row. */
  action?: ReactNode;
  onClose?: () => void;
};

/**
 * A full-width line the app uses to say something about the surface it sits on.
 *
 * Used by the chat module (Phase 6) for the tool-permission prompt and by the accounts module
 * (Phase 13) for the drift notice, whose "Save it" is the `action`, and for a write Descent
 * refused — every caller needs a toned strip carrying a sentence and at most one or two buttons,
 * and none should spell a second one.
 *
 * The tone arrives as `data-tone`, so the fill, the ink and the mark all come from the one
 * `[data-tone]` block in tokens.css. The mark is not decoration: it is what makes the tone
 * readable when the colour is not (doctrine §6).
 */
export function Banner({ tone, children, action, onClose }: BannerProps) {
  return (
    <div className="vv-banner flex items-start" data-tone={tone}>
      <span className="vv-banner__mark flex-none" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
      {onClose && (
        <button type="button" className="vv-banner__close flex-none" onClick={onClose} aria-label="Close">
          ✕
        </button>
      )}
    </div>
  );
}
