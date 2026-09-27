import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { badgeVariants } from '@/shared/ui';
import type { LaneFlowNode } from '@/shared/types';
import { cn } from '@/shared/utils';

/**
 * Verve's StatusFlow, horizontal (`_ds_bundle.js`, `components/domain/StatusFlow.jsx`), in this
 * module's terms: every node on ONE track, the track filled as far as the work has got.
 *
 * ONE ROW AT EVERY WIDTH. The nodes share a grid of equal columns, so sixteen of them sit on one line
 * at 390px as they do at 1920 — a node is `min(100%, 1.5rem)` of its column, never wider than the
 * column it stands in, and the row never scrolls sideways (the bundle's `overflowX: auto` is the one
 * thing not taken: a card that scrolls inside a card is a second scroll a phone reader has to find).
 *
 * COLOUR REACHES A NODE THROUGH ITS TONE AND NOTHING ELSE. A node wears the badge's own paint
 * (`badgeVariants`, `.vv-badge`) under its `data-tone`, the way the library paints every toned fact,
 * so its classes carry no colour of their own; its selected ring is the badge's own border raised to
 * 2px in `currentColor`, which is that same tone's ink. Every node also carries a mark (`✓`, `▶︎`,
 * `…`, a position) and a label, so no state is colour alone.
 *
 * THREE STATES, THREE CHANNELS, so all three can show on one node at once: SELECTED is the border,
 * keyboard FOCUS is the house focus ring (`outline`, tokens.css), and LIVE is Verve's halo
 * (`box-shadow`, `vv-ring`). Drawn as an outline, the selection was a second 2px ring at the focus
 * ring's own offset — on a done node two greens a shade apart, "what is open" beside "where I am".
 *
 * ONE TAB STOP (roving tabindex): Tab lands on one node and Left, Right, Home and End walk the
 * track. A node is a button, so Enter and Space press it — and pressing is `onSelect(key)`, which
 * the caller decides the meaning of.
 *
 * Used by `PlanFace`, as a plan card's track of its phases, and by `DeckFrame` and `DeckStrip`, as an
 * arc deck's track of its plans.
 */
export function StatusFlow({
  nodes,
  doneCount,
  selected,
  onSelect,
  ariaLabel,
}: {
  nodes: LaneFlowNode[];
  doneCount: number;
  selected: string | null;
  onSelect: (key: string) => void;
  ariaLabel: string;
}) {
  // The node holding the track's one tab stop, once the reader has focused one; until then the stop
  // is the selected node's, else the first node's.
  const [stop, setStop] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  if (nodes.length === 0) return null;
  const has = (key: string | null) => key !== null && nodes.some((node) => node.key === key);
  const stopKey = has(stop) ? stop : has(selected) ? selected : nodes[0].key;
  const last = nodes.length - 1;

  const walk = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const to = event.key === 'ArrowRight' ? Math.min(index + 1, last)
      : event.key === 'ArrowLeft' ? Math.max(index - 1, 0)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? last
            : null;
    if (to === null) return;
    event.preventDefault();
    const key = nodes[to].key;
    setStop(key);
    buttons.current.get(key)?.focus();
  };

  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      className="relative grid min-w-0 items-center py-1"
      style={{ gridTemplateColumns: `repeat(${nodes.length}, minmax(0, 1fr))` }}
      data-status-flow
    >
      {/* The track: a base line across the row, and the accent filled over it to the share done —
          a meter under the nodes, moving on the entry curve when a phase lands. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 overflow-hidden rounded-full bg-border">
        <span
          className="absolute inset-0 origin-left bg-primary motion-safe:transition-transform motion-safe:duration-move motion-safe:ease-enter"
          style={{ transform: `scaleX(${Math.min(doneCount, nodes.length) / nodes.length})` }}
        />
      </span>
      {nodes.map((node, index) => {
        const isSelected = node.key === selected;
        return (
          <button
            key={node.key}
            ref={(element) => {
              if (element) buttons.current.set(node.key, element);
              else buttons.current.delete(node.key);
            }}
            type="button"
            tabIndex={node.key === stopKey ? 0 : -1}
            aria-label={node.label}
            aria-pressed={isSelected}
            title={node.label}
            onClick={() => onSelect(node.key)}
            onFocus={() => setStop(node.key)}
            onKeyDown={(event) => walk(event, index)}
            className={cn(
              badgeVariants(),
              'relative aspect-square w-[min(100%,1.5rem)] cursor-pointer justify-center justify-self-center rounded-full p-0',
              'text-[11px] font-bold leading-none tabular-nums motion-safe:transition-transform motion-safe:duration-quick motion-safe:ease-spring hover:scale-110',
              node.live && 'motion-safe:animate-live-ring',
              isSelected && 'border-2 border-current',
            )}
            data-tone={node.tone}
            data-flow-node={node.key}
            data-selected={String(isSelected)}
            data-live={node.live ? 'true' : undefined}
          >
            <span aria-hidden="true">{node.mark}</span>
          </button>
        );
      })}
    </div>
  );
}
