import { useState } from 'react';
import type { KeyboardEvent } from 'react';

import { useFlowTrack } from '@/modules/dispatcher/hooks/useFlowTrack';
import { badgeVariants } from '@/shared/ui';
import type { LaneFlowNode } from '@/shared/types';
import { cn } from '@/shared/utils';

/** A node's width and height, in rem — Tailwind's `w-6` on the node, and what the row's minimum width counts. */
const NODE_REM = 1.5;

/**
 * The track's edge fade: opaque between two ends whose widths `useFlowTrack` writes as
 * `--fade-before` and `--fade-after` (nothing until it has scrolled, nothing at an end). A mask, so it
 * fades the nodes into whatever surface the card sits on rather than painting a colour over it.
 */
const FADE_MASK = 'linear-gradient(to right, transparent, black var(--fade-before, 0px), black calc(100% - var(--fade-after, 0px)), transparent)';

/**
 * Verve's StatusFlow, horizontal (`_ds_bundle.js`, `components/domain/StatusFlow.jsx`), in this
 * module's terms: every node on ONE track, the track filled as far as the work has got.
 *
 * ONE ROW AT EVERY WIDTH, NEVER SQUEEZED. A node is its natural size, `NODE_REM`, at every width, and
 * the row is at least as wide as all of them side by side. Where that fits, the nodes share the row in
 * equal columns, as the bundle draws it; where it does not, the row scrolls sideways instead of
 * shrinking the nodes — a two-digit label at 11px bold is about 13px wide, so a node squeezed under
 * that (twenty-three phases in a 332px row are 14px columns) crowds its own ring and collides with its
 * neighbours'. A phone swipe, a trackpad and the keyboard scroll it (`useFlowTrack`, which also opens it
 * on `current`, keeps the selected node in view and paints the edge fade that says which side has more).
 *
 * THE TRACK'S SCROLL IS ITS OWN. A swipe that reaches its end does not carry on into whatever scrolls
 * behind it (`useFlowTrack` holds it, while the row overflows): a plan card in an arc deck sits inside
 * the deck's swipeable strip, so a swipe on the flow moves the flow and a swipe anywhere else on the
 * card pages the strip.
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
  current,
  onSelect,
  ariaLabel,
}: {
  nodes: LaneFlowNode[];
  doneCount: number;
  selected: string | null;
  /** The key of the node the track opens on when it scrolls: the one walking, else the first not done, else the last. */
  current: string | null;
  onSelect: (key: string) => void;
  ariaLabel: string;
}) {
  // The node holding the track's one tab stop, once the reader has focused one; until then the stop
  // is the selected node's, else the current node's — Tab lands where the track already opened, and
  // never throws it back to the first node — else the first node's.
  const [stop, setStop] = useState<string | null>(null);
  const { trackRef, buttons, trackProps, reveal } = useFlowTrack({ hasNodes: nodes.length > 0, current, selected });

  if (nodes.length === 0) return null;
  const has = (key: string | null) => key !== null && nodes.some((node) => node.key === key);
  const stopKey = has(stop) ? stop : has(selected) ? selected : has(current) ? current : nodes[0].key;
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
    // The page and the arc's strip stay where they are; only the TRACK moves. A keystroke is known
    // keyboard intent, so the reveal is asked for here and does not lean on the browser's
    // `:focus-visible` heuristic (`onFocus` below).
    buttons.current.get(key)?.focus({ preventScroll: true });
    reveal(key);
  };

  // The scroller's padding and negative margins cancel: the row lies exactly where a scroll-free row
  // did. What they leave is room INSIDE the scroller's clip for what a node draws outside its own box
  // — the live halo (9px), the focus ring and the hover lift — which a scroll container would
  // otherwise cut flat at the row's edge. The room at the START and above and below is the scroller's
  // own padding, which every engine keeps. The room at the END is a spacer (`flex-none`) after the
  // row, because Chromium counts a scroller's end padding as scrollable overflow and WebKit does not:
  // there the last node — the one walking, on a plan's final phase — sat flush with the edge and its
  // halo and focus ring were cut. Content is scrollable overflow in every engine.
  return (
    <div
      ref={trackRef}
      role="toolbar"
      aria-label={ariaLabel}
      className="scrollbar-thin relative -mx-2.5 -my-1.5 flex min-w-0 overflow-x-auto overflow-y-hidden py-2.5 pl-2.5"
      style={{ maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK }}
      {...trackProps}
      data-status-flow
    >
      <div
        className="relative grid flex-1 items-center"
        style={{ gridTemplateColumns: `repeat(${nodes.length}, minmax(0, 1fr))`, minWidth: `${nodes.length * NODE_REM}rem` }}
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
              onFocus={(event) => {
                setStop(node.key);
                // KEYBOARD FOCUS ONLY (Tab). A mouse press focuses its node on mousedown, and a smooth
                // scroll begun then moves the node out from under the pointer before mouseup — the
                // browser then clicks the common ancestor and the press is lost (measured on a node in
                // the edge fade: every hold past 60ms). A press reveals through what it selects instead.
                if (event.currentTarget.matches(':focus-visible')) reveal(node.key);
              }}
              onKeyDown={(event) => walk(event, index)}
              className={cn(
                badgeVariants(),
                'relative aspect-square w-6 cursor-pointer justify-center justify-self-center rounded-full p-0',
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
      <span aria-hidden="true" className="w-2.5 flex-none" />
    </div>
  );
}
