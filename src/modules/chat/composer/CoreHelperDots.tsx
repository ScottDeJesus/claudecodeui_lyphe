import { useState } from 'react';
import type { CSSProperties } from 'react';

import { useChatCorePlace } from '@/shared/context/ChatCorePlaceContext';
import type { CompanionMaterial } from '@/shared/types';

/** How a helper stands, as its dot says it: at work, held back (waiting for the CPU), or ended one of three ways. */
export type CoreHelperState = 'running' | 'held' | 'finished' | 'failed' | 'stopped';

/** One helper as its dot: what it is made of (its model), how it stands, and its name for a reader. */
export type CoreHelperDot = { id: string; material: CompanionMaterial; state: CoreHelperState; label: string };

type CoreHelperDotsProps = {
  /** The helpers, in the order they stand round the core: the running first. */
  dots: readonly CoreHelperDot[];
  /** The core's square, in px: the orbit is measured from its edge. */
  corePx: number;
  /** The helper whose card is open, or null. */
  picked: string | null;
  /** A dot was pressed. */
  onPick: (id: string) => void;
  /** The group's name for a reader. */
  label: string;
  /** The name of the mark that stands for the helpers there is no room for, given how many. */
  moreLabel: (count: number) => string;
};

/** From the core's edge to the orbit, in px: past the two hairlines the core wears (the context's, then the account's week). */
const ORBIT_GAP = 18;
/** From one dot's middle to the next along the orbit, in px: a dot's own press, so two never overlap. */
const PITCH = 16;

/** The arc the dots stand on, in degrees counter-clockwise from three o'clock: [where it is centred, how wide it is]. */
const ARC_APART: readonly [number, number] = [90, 150];
/** Beside the line the core has the screen's edge at its start and the line at its end, so its arc is narrower and leans to the line. */
const ARC_DOCKED: readonly [number, number] = [84, 108];

/**
 * THE CHAT'S HELPERS, AS DOTS ROUND ITS CORE: one for each subagent the chat has out or has had out, on an arc over the core, in
 * its model's colour (the app's one colour coding). No window stands over the line for them. A dot filled and breathing is a
 * helper at work; filled and still, one held back; a ring, one that has finished, in the danger colour when it failed and the
 * warn colour when it was stopped. The dot whose card is open wears a ring of its own.
 *
 * THE CORE THROWS THEM OUT. A dot that appears while the chat is on screen starts at the core's middle and goes out to its place
 * (`.core-helper--out`, `chatLine.css`); the ones already there when the chat was opened simply stand. The core itself is in its
 * writing form at that moment, reaching: sending an agent out is one of the things that form says (`coreDoingOf`).
 *
 * ONE ORBIT. It holds as many dots as its arc has room for at `PITCH`; past that, the last place is a count of the rest, which
 * opens the first of them (the card pages through them all).
 *
 * Drawn inside the core's own heart, so it is centred on the core wherever the core stands. Used by `transcript/PinnedSubagents`.
 */
export function CoreHelperDots({ dots, corePx, picked, onPick, label, moreLabel }: CoreHelperDotsProps) {
  const apart = useChatCorePlace() !== null;
  // The dots this orbit has drawn before: one not among them was just sent out. Seeded with the ones there at first, which stand.
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set(dots.map((dot) => dot.id)));
  const [sent, setSent] = useState<ReadonlySet<string>>(() => new Set());
  const fresh = dots.filter((dot) => !seen.has(dot.id)).map((dot) => dot.id);
  if (fresh.length > 0) {
    setSeen(new Set([...seen, ...fresh]));
    setSent(new Set([...sent, ...fresh]));
  }

  const radius = corePx / 2 + ORBIT_GAP;
  const [centre, span] = apart ? ARC_APART : ARC_DOCKED;
  const room = Math.max(1, Math.floor(((span * Math.PI) / 180) * radius / PITCH) + 1);
  const over = dots.length > room;
  const shown = over ? dots.slice(0, room - 1) : dots;
  const places = shown.length + (over ? 1 : 0);
  const step = PITCH / radius;
  // Centred on the arc's middle, running anticlockwise to clockwise as the list runs: the first helper at the arc's start side.
  const at = (index: number): CSSProperties => {
    const angle = (centre * Math.PI) / 180 + (((places - 1) / 2) - index) * step;
    const x = Math.round(radius * Math.cos(angle) * 10) / 10;
    const y = Math.round(-radius * Math.sin(angle) * 10) / 10;
    return { left: x, top: y, '--hx': `${x}px`, '--hy': `${y}px` } as CSSProperties;
  };

  return (
    <div role="group" aria-label={label} data-core-helpers={dots.length} className="core-helpers">
      {shown.map((dot, index) => (
        <button
          key={dot.id}
          type="button"
          data-core-helper={dot.state}
          data-core-helper-id={dot.id}
          data-material={dot.material}
          data-picked={picked === dot.id ? '' : undefined}
          aria-label={dot.label}
          title={dot.label}
          aria-haspopup="dialog"
          aria-expanded={picked === dot.id}
          onClick={() => onPick(dot.id)}
          className={sent.has(dot.id) ? 'core-helper core-helper--out' : 'core-helper'}
          style={at(index)}
        >
          <span aria-hidden="true" className="core-helper__dot" />
        </button>
      ))}
      {over && (
        <button
          type="button"
          data-core-helper="more"
          data-core-helper-id={dots[room - 1].id}
          aria-label={moreLabel(dots.length - shown.length)}
          title={moreLabel(dots.length - shown.length)}
          onClick={() => onPick(dots[room - 1].id)}
          className="core-helper core-helper--more"
          style={at(shown.length)}
        >
          <span aria-hidden="true">+{dots.length - shown.length}</span>
        </button>
      )}
    </div>
  );
}
