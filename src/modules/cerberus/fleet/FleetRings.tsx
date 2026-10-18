import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ringsLayout } from '@/modules/cerberus/fleet/fleetModel';
import { RingDot, RingHub, RingsKey } from '@/modules/cerberus/fleet/RingMarks';
import { RingsNodePanel } from '@/modules/cerberus/fleet/RingsNodePanel';
import { MarkIcon } from '@/modules/cerberus/StatusMarks';
import { markLook, nodeMark } from '@/modules/cerberus/utils/cerberusStatus';
import { nodeLine } from '@/modules/cerberus/utils/fleetWords';
import type { CerberusNodeView } from '@/shared/cerberus-types';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import type { CerberusSheetTarget, FleetItem, RingSpokeKind, RingsLayout, Tone } from '@/shared/types';
import { Card } from '@/shared/ui';
import { cn, resizeObserverIn } from '@/shared/utils';

/**
 * A spoke by its kind: the neutral dot's dashed line for no result, the warn dot's solid line for a node
 * that needs you (each under its `SPOKE_TONE`), the strong border otherwise. A plain spoke turns the accent
 * while its node is selected, as the prototype has it. A dashed or amber one keeps saying what it says.
 *
 * The amber line is 2 px, where the prototype drew 1.5: Chromium floors a border under 2 px to whole
 * device pixels, so on a 1× screen 1.5 px drew as 1, as thin as a plain spoke, and needs you lost its weight.
 * The dashed line takes the neutral dot because the strong border measured 1.41:1 on the light card, and
 * the line that says no result must be read on its own.
 */
const SPOKE_PAINT: Record<RingSpokeKind, string> = {
  dashed: 'border-t border-dashed border-tone-dot',
  amber: 'border-t-2 border-tone-dot',
  plain: 'border-t border-input',
};
const SPOKE_TONE: Record<RingSpokeKind, Tone | undefined> = { dashed: 'neutral', amber: 'warn', plain: undefined };
const SELECTED_SPOKE = 'border-t-[1.5px] border-primary';

/** A dot's press area, centred on it: never under 24 px, however small the dot (WCAG 2.5.8). */
const MIN_HIT = 24;

/** The gap between a dot's edge and its label. */
const LABEL_GAP = 3;

/**
 * A dot in this share of the box's width from either side runs its label inward from the dot. A label is
 * also capped at 30% of the box (`max-w-[30cqi]`, the box being an inline-size container) and cut with an
 * ellipsis: a name is the operator's own, with no length cap, and the dot's title, its name and the panel
 * carry it whole.
 */
const EDGE_SHARE = 0.2;

/** The beats run in seven phases 0.45 s apart (the prototype's), so the spokes never pulse in step. */
const BEAT_PHASES = 7;
const BEAT_STEP_S = 0.45;

/** A length of the layout as a share of the side it was laid out in, so the rings fill any box alike. */
const percent = (value: number, of: number): string => (of > 0 ? `${(value / of) * 100}%` : '50%');

type FleetRingsProps = {
  /** The nodes to draw: the hub, kept at the centre whatever the filter leaves, and the filter's nodes. */
  items: FleetItem[];
  /** The overview's nodes, for what an item leaves behind: its warden, its services and their minutes. */
  nodes: CerberusNodeView[];
  /** The read's own moment, for the selected node's warden line. */
  now: number;
  /** Opens the check sheet from the selected node's service rows, as Grid and List do. */
  onOpenCell: (target: CerberusSheetTarget) => void;
};

/**
 * FLEET AS RINGS, the third layout: every warden reporting to center.
 *
 * In the ring's card, center is the hub (`RingHub`). Every other node sits on a ring around it, worst
 * first, so the worst sit on the inner ring. Each node is a dot in its word's shape (`RingDot`), with its
 * icon and its name on the side away from the hub: above a node on a ring's upper half, below one on its
 * lower half, so a name never sits on its own spoke or crowds center. A spoke joins each node to the hub:
 * dashed for no result, solid amber for needs you, plain otherwise. A beat travels each live spoke from
 * its node to the hub while the rings name every node on them. Past that, only a node that needs you
 * keeps its beat. Sixty beats would be texture, not signal, and a silent node is told by its dashed spoke
 * and hollow dot, never by a missing beat. Under the ring, a note says how many nodes stand around center,
 * or that the rest are in Grid when the rings run out of room. With motion reduced, no beat travels and no
 * dot rings.
 *
 * Beside the ring, or under it on a phone: the selected node's panel (`RingsNodePanel`), or the key
 * (`RingsKey`) while none is selected. A press on a dot, or on the hub, selects it; the same press again,
 * or ✕, lets it go.
 *
 * The rings own three things: the box they are measured in, the layout laid out for that box, and the
 * selection. A parent can see neither the box nor a press, and a return from Grid or List starts with
 * nothing selected. Positions are the layout's pixels drawn as shares of its box, so the rings stay in
 * place while a resize is being measured. Dots and spokes keep their sizes in pixels.
 *
 * Used by Fleet's `FleetView` while the layout is Rings.
 */
export function FleetRings({ items, nodes, now, onOpenCell }: FleetRingsProps) {
  const { t } = useTranslation();
  // The ring's own box: the square the rings are laid out in, and the element measured below.
  const boxRef = useRef<HTMLDivElement>(null);
  // The box's own size in layout pixels, 0 × 0 until it is measured: what the rings are laid out in. The
  // box, not the window: the side panel shares the ring's row and What happened the fleet's, and both wrap
  // under it as the tab narrows, so the window's width says nothing of the ring's.
  const [size, setSize] = useState({ width: 0, height: 0 });
  // The observer is built by the constructor of the window the rings are drawn in, as the kit's Tabs does,
  // so a ring in a floating window is still measured; a move builds a new one.
  const hostWindow = useHostWindow();
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box === null) return undefined;
    // Layout sizes only (`clientWidth`, `contentRect`), never `getBoundingClientRect`: the card enters on
    // `vv-pop`, which scales it, and a transform moves no observer, so a size read mid-entry would stay.
    const measure = (width: number, height: number) =>
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    measure(box.clientWidth, box.clientHeight);
    const observer = resizeObserverIn(hostWindow, (entries) => {
      const latest = entries[entries.length - 1];
      measure(latest.contentRect.width, latest.contentRect.height);
    });
    observer?.observe(box);
    return () => observer?.disconnect();
  }, [hostWindow]);
  // The rings laid out at that size. Before the first measure (0 × 0) it places nothing: the hub stands
  // alone and no note is written.
  const layout: RingsLayout = useMemo(() => ringsLayout(items, size.width, size.height), [items, size.width, size.height]);
  // The node whose panel stands beside the rings, by id, or null while none does. A press on a dot is the
  // only way to choose one and no parent sees it, so the rings keep it; a return from Grid or List starts
  // with none.
  const [selected, setSelected] = useState<string | null>(null);
  // A dot pressed again lets its node go, and ✕ hands `null`, which lets go whatever is selected.
  const onSelect = (id: string | null) => setSelected((current) => (current === id ? null : id));

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  /** "eis1 · docstore — refused": what a dot says on hover and to assistive tech. */
  const nameOf = (item: FleetItem): string => {
    const node = nodeById.get(item.id);
    return node === undefined ? item.id : t('cerberus.fleet.rings.dotTip', { name: item.id, text: nodeLine(t, item, node) });
  };

  const width = layout.center.x * 2;
  const height = layout.center.y * 2;
  const across = (value: number) => percent(value, width);
  const down = (value: number) => percent(value, height);
  const note = width === 0 || layout.total === 0
    ? null
    : layout.nodes.length < layout.total
      ? t('cerberus.fleet.rings.partial', { shown: layout.nodes.length, total: layout.total })
      : t('cerberus.fleet.rings.note', { count: layout.total });

  // Only a node the rings were handed has a panel, so a filter that leaves it out closes it: the selection is
  // let go with its node, not kept to re-open its panel unasked when the filter clears.
  const chosen = selected === null ? undefined : items.find((item) => item.id === selected);
  if (selected !== null && chosen === undefined) setSelected(null);
  const chosenNode = chosen === undefined ? undefined : nodeById.get(chosen.id);
  const { hub } = layout;
  // Every live spoke beats while the rings name every node on them (twelve or fewer on one ring); past that,
  // only the spokes of the nodes that need you do.
  const everySpokeBeats = layout.nodes.every((placed) => placed.labelled);

  /**
   * ✕ on the panel: focus goes back to the selected node's own dot (the hub when that node is not drawn)
   * before the node is let go. The dot stays mounted and only its `aria-pressed` flips, so the keyboard
   * stays on the ring instead of falling to the page's top with the panel's button.
   */
  const closePanel = () => {
    const box = boxRef.current;
    (box?.querySelector<HTMLElement>('button[aria-pressed="true"]') ?? box?.querySelector<HTMLElement>('button'))?.focus();
    onSelect(null);
  };

  // The ring's card and its side column share one wrapping row: side by side from 616 px (two 300 px bases
  // and the gap), stacked under that. The fleet column never narrows past 620 px while What happened stands
  // beside it, so every laptop pane keeps the panel beside the ring (1037 px on a 1366 screen, 1111 on a
  // 1440). The prototype's 440 + 280 needed 736, and from a 1004 to a 1159 px pane it dropped the panel some
  // 700 px below the ring, out of view. 300 px is what a service row's 30 minutes need, padding included.
  // The ring takes three parts of the rest to the panel's two.
  return (
    <div className="flex flex-wrap items-start gap-4">
      <Card className="min-w-0 max-w-[720px] flex-[3_1_300px] p-[18px] motion-safe:animate-[vv-pop_.5s_theme(transitionTimingFunction.enter)_both]">
        <div ref={boxRef} role="group" aria-label={t('cerberus.fleet.layouts.rings')} className="relative aspect-square w-full [container-type:inline-size]">
          {layout.guides.map(({ radius }) => (
            <div
              key={radius}
              aria-hidden
              style={{ width: across(radius * 2), height: down(radius * 2) }}
              className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-border"
            />
          ))}
          {layout.nodes.map(({ item, length, angleDeg, spoke, live }, index) => (
            <div
              key={item.id}
              aria-hidden
              data-tone={SPOKE_TONE[spoke]}
              style={{ width: across(length), transform: `rotate(${angleDeg}deg)` }}
              className={cn(
                'pointer-events-none absolute left-1/2 top-1/2 h-0 origin-top-left',
                item.id === selected && spoke === 'plain' ? SELECTED_SPOKE : SPOKE_PAINT[spoke],
              )}
            >
              {/* The beat starts at the node's end (`left: 100%`) and rides in to the hub. It stays unseen
                  outside its run, so a beat motion has stilled draws nothing. */}
              {live && (everySpokeBeats || spoke === 'amber') && (
                <span
                  style={{ animationDelay: `${-(index % BEAT_PHASES) * BEAT_STEP_S}s` }}
                  className={cn(
                    'absolute -top-[3.5px] left-full -ml-[3px] size-1.5 rounded-full opacity-0 motion-safe:animate-cerberus-travel',
                    spoke === 'amber' ? 'bg-tone-dot' : 'bg-primary',
                  )}
                />
              )}
            </div>
          ))}
          {hub !== null && <RingHub hub={hub} selected={hub.id === selected} label={nameOf(hub)} onPress={() => onSelect(hub.id)} />}
          {layout.nodes.map(({ item, x, y, angleDeg, dot, labelled }) => {
            const isSelected = item.id === selected;
            const mark = nodeMark(item.status);
            const name = nameOf(item);
            // On a ring's upper half the label stands above its dot, on the lower half it hangs below: away from the hub.
            const above = Math.sin((angleDeg * Math.PI) / 180) < -1e-6;
            // In the box's outer left or right fifth the label runs inward from its dot, so it never leaves the card.
            const share = width > 0 ? x / width : 0.5;
            const runs = share < EDGE_SHARE ? 'right' : share > 1 - EDGE_SHARE ? 'left' : 'both';
            return (
              <div key={item.id} style={{ left: across(x), top: down(y) }} className="absolute z-[1] size-0">
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={name}
                  title={name}
                  onClick={() => onSelect(item.id)}
                  style={{ width: Math.max(dot, MIN_HIT), height: Math.max(dot, MIN_HIT) }}
                  className="group absolute left-0 top-0 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
                >
                  <RingDot status={item.status} size={dot} selected={isSelected} />
                </button>
                {(labelled || isSelected) && (
                  <span
                    aria-hidden
                    style={{ top: (above ? -1 : 1) * (dot / 2 + LABEL_GAP), left: runs === 'right' ? -dot / 2 : runs === 'left' ? dot / 2 : 0 }}
                    className={cn(
                      'pointer-events-none absolute max-w-[30cqi] truncate rounded bg-card px-1 text-[11.5px] font-medium leading-4 text-secondary-foreground',
                      runs === 'both' && '-translate-x-1/2',
                      runs === 'left' && '-translate-x-full',
                      above && '-translate-y-full',
                    )}
                  >
                    {mark !== null && (
                      // On the label's baseline, lowered 2px so the 12px icon centres on the 11.5px name's capitals.
                      <span data-tone={markLook(mark).tone} className="mr-1 inline-block align-[-2px] text-tone-ink">
                        <MarkIcon icon={markLook(mark).icon} className="size-3" />
                      </span>
                    )}
                    {item.id}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {note !== null && <p className="mt-2.5 text-center text-xs text-muted-foreground">{note}</p>}
      </Card>
      <div className="flex min-w-0 flex-[2_1_300px] flex-col gap-3">
        {chosen !== undefined && chosenNode !== undefined ? (
          <RingsNodePanel key={chosen.id} item={chosen} node={chosenNode} now={now} onClose={closePanel} onOpenCell={onOpenCell} />
        ) : (
          <RingsKey />
        )}
      </div>
    </div>
  );
}
