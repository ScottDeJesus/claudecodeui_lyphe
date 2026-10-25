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
  /** For a caller that has to line the chip up with the controls beside it — a height, mostly. */
  className?: string;
  /** Native tooltip, for a chip whose one word needs a sentence behind it. */
  title?: string;
  /**
   * The name, for a chip whose visible content is a MARK rather than a word — the composer's
   * DeepSeek chip, whose mark is the whole chip on a phone. The mark carries its own
   * `aria-label` ("DeepSeek" on, "Claude" off), which is a name for the picture and not for the
   * control.
   */
  ariaLabel?: string;
  /**
   * The position is not known — the switch has not been read, or the read came back with nothing.
   * Renders `aria-pressed="mixed"` and a dashed ring, so a third state exists on screen instead of
   * "unknown" being painted as OFF. A two-state control that draws its ignorance as one of its two
   * answers is the one lie it cannot recover from, because the reader has no way to tell.
   */
  indeterminate?: boolean;
  /**
   * Refuses the press without leaving the tab order. The node keeps focus and announces
   * `aria-disabled`, where a real `disabled` attribute blurs the button the moment it is set — so
   * the reader who pressed with Enter would have to Tab from the top of the page to press again.
   * The refusal itself is the caller's, in its own handler.
   */
  busy?: boolean;
  /**
   * The press RUNS something — opens a dialog, adds an entry — instead of setting a position, so
   * the button announces no `aria-pressed`: "toggle button, not pressed" promises a state the press
   * never sets. `selected` and `indeterminate` mean nothing beside it. The Files view's "Pin a
   * folder", which opens the folder browser, is the first.
   */
  action?: boolean;
};

/**
 * A pill that reads as one selectable token — a filter, a tag, a mode.
 * Used by settings for the appearance and permission filters, by the chat composer for its
 * model and permission tokens, by the cerberus module for Fleet's filters and the Mute dialog's
 * durations, by the file-manager module for the Files view's strip of roots, and by the
 * agent-launch, git-panel, heal, jev, kanban, roadmap, sidebar and task-master modules; each
 * needs the same pill and none should spell it a second time.
 *
 * With `onClick` it renders a real `<button>` so it is reachable by keyboard and announces
 * its pressed state (`action` drops that state, for a press that sets none); without one it
 * is a `<span>`, because a static tag that takes focus
 * sends the reader somewhere nothing happens. `busy` and `indeterminate` are for a chip whose
 * state lives somewhere else — a switch read back off the server — where a press cannot always
 * be taken yet and the position is not always known.
 */
export function Chip({
  selected = false,
  onClick,
  children,
  size = 'md',
  tone,
  className: extra,
  title,
  ariaLabel,
  indeterminate = false,
  busy = false,
  action = false,
}: ChipProps) {
  const className = cn(
    'vv-chip inline-flex items-center gap-1.5',
    size === 'sm' && 'vv-chip--sm',
    tone && 'vv-chip--toned',
    extra
  );

  if (!onClick) {
    return (
      <span className={className} data-selected={selected} data-tone={tone} title={title}>
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
      data-state={indeterminate ? 'unknown' : undefined}
      aria-pressed={action ? undefined : indeterminate ? 'mixed' : selected}
      aria-label={ariaLabel}
      aria-disabled={busy || undefined}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}
