import * as React from 'react';

import type { Tone } from '@/shared/types';
import { cn } from '@/shared/utils';

type ChipProps = {
  selected?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  size?: 'sm' | 'md';
  /**
   * Paints the chip's OUTLINE with a tone instead of the default border — for a chip whose
   * state is a level rather than a name, where the ring says in one glance what the words
   * would spend the whole pill saying. `selected` keeps its meaning beside it and becomes the
   * second channel: the tone's soft fill arrives, so two chips of the same hue still differ in
   * greyscale (the same trick the accent-selected chip already plays).
   */
  tone?: Tone;
};

/**
 * A pill that reads as one selectable token — a filter, a tag, a mode.
 * Used by settings (Phase 4) for the appearance and permission filters and by the chat
 * composer (Phase 6) for its model and permission tokens; both need the same pill and
 * neither should spell it a second time.
 *
 * With `onClick` it renders a real `<button>` so it is reachable by keyboard and announces
 * its pressed state; without one it is a `<span>`, because a static tag that takes focus
 * sends the reader somewhere nothing happens.
 */
export function Chip({ selected = false, onClick, children, size = 'md', tone }: ChipProps) {
  const className = cn(
    'vv-chip inline-flex items-center gap-1.5',
    size === 'sm' && 'vv-chip--sm',
    tone && 'vv-chip--toned'
  );

  if (!onClick) {
    return (
      <span className={className} data-selected={selected} data-tone={tone}>
        {children}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={className}
      data-selected={selected}
      data-tone={tone}
      aria-pressed={selected}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
