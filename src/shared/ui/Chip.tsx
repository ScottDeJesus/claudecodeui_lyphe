import * as React from 'react';

import { cn } from '@/shared/utils';

type ChipProps = {
  selected?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  size?: 'sm' | 'md';
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
export function Chip({ selected = false, onClick, children, size = 'md' }: ChipProps) {
  const className = cn(
    'vv-chip inline-flex items-center gap-1.5',
    size === 'sm' && 'vv-chip--sm'
  );

  if (!onClick) {
    return (
      <span className={className} data-selected={selected}>
        {children}
      </span>
    );
  }

  return (
    <button type="button" className={className} data-selected={selected} aria-pressed={selected} onClick={onClick}>
      {children}
    </button>
  );
}
