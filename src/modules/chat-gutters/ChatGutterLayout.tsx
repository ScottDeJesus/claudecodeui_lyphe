import { ActivityIcon, BotIcon, BrainIcon, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { SubagentWidgetBody, useClaimSubagentStrip, useSubagentWidgetCount } from '@/modules/chat';
import { GUTTER_WIDGET_ORDER, useGutterPlacements } from '@/modules/chat-gutters/hooks/useGutterPlacements';
import { GutterSlot } from '@/modules/chat-gutters/GutterSlot';
import { GutterWidgetFrame } from '@/modules/chat-gutters/GutterWidgetFrame';
import { MemoryWidgetBody, useMemoryIntake } from '@/modules/memory-intake';
import { RunnerWidgetBody, useRunnerRuns } from '@/modules/plan-runner';
import type { GutterSlotId, GutterWidgetId } from '@/shared/types';
import { cn } from '@/shared/utils';

/**
 * The three columns' measurements, in px. The grid below spells them out as literals — `868px`,
 * `1fr`, `gap-4`, `max-w-[1860px]` — because Tailwind's arbitrary values are literal; these
 * constants are the arithmetic those literals answer to, so a column that changes width changes
 * here first.
 */
const GUTTER_GAP_PX = 16;

/** The chat column's own cap, `max-w-[54.25rem]`, which the transcript and the composer share. */
const CHAT_COLUMN_PX = 868;

/** The narrowest a widget column may be drawn — its width at the threshold, and its floor above it. */
const GUTTER_MIN_PX = 300;

/**
 * The narrowest region that can hold the chat column AND both gutters: 868 + 2 * (300 + 16) = 1500.
 *
 * Below it the gutters would take width from the transcript, and the transcript is the thing being
 * read — so the chat goes alone and the widgets wait for a wider region, which a collapsed sidebar
 * or a taller window restores without a reload.
 */
const MIN_REGION_PX = CHAT_COLUMN_PX + 2 * (GUTTER_MIN_PX + GUTTER_GAP_PX);

/**
 * The desktop chat's side gutters: the runner, memory and subagents widgets beside the transcript,
 * each of them draggable between the four corners.
 *
 * MOUNTED AROUND THE CHAT, NEVER OVER IT. The chat cell is the grid's first child at every width —
 * the grid is drawn whether or not the gutters are — so crossing the threshold adds and removes the
 * two asides rather than remounting the chat: a half-typed draft and a scroll position survive the
 * window being narrowed. That is also why the three tracks are drawn at every width: the chat's
 * column is the chat's own column at every width, and only the widgets and the gap between them
 * come and go.
 *
 * THE WIDTH IS MEASURED, NOT QUERIED. The sidebar's collapse changes the chat's width at one
 * window size, so the question "is there room for the gutters?" is about this region and not the
 * viewport, and a media query would answer a question about the wrong box.
 *
 * THE CRASH BOUNDARY IS THE CALLER'S. Each widget body is wrapped on its own inside its frame, so
 * a body that throws costs its own gutter and leaves the chat and the other widgets standing. This
 * module never names a boundary of its own — it is handed the workspace's.
 *
 * Used by `src/modules/project-workspace/WorkspaceMain.tsx`, which wraps the chat in it, outside
 * the transcript and the composer and inside the workspace's own error boundary.
 */
export function ChatGutterLayout({
  enabled,
  sessionId,
  boundary,
  children,
}: {
  enabled: boolean;
  sessionId: string | null;
  boundary: ComponentType<{ children: ReactNode }>;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { placements, moveWidget, toggleWidget } = useGutterPlacements();
  const { count: runnerCount } = useRunnerRuns();
  const { pendingCount } = useMemoryIntake();
  const subagentCount = useSubagentWidgetCount(sessionId);

  const rootRef = useRef<HTMLDivElement | null>(null);

  // Whether the gutters are drawn at all. A BOOLEAN and never the measured width: a width in state
  // would re-render on every frame of a window resize or a sidebar drag, and the only question
  // this component asks of the measurement is whether it clears the threshold.
  const [wide, setWide] = useState(false);

  // While these gutters are drawn, the Subagents widget shows the chat's pinned rows better than
  // the strip above the chat box can, so the strip is CLAIMED and the chat stands it down: the same
  // rows never render twice. The claim follows `wide`, which is the very condition that draws the
  // widget — a region too narrow for the gutters keeps the strip.
  useClaimSubagentStrip(wide);

  // Which widget a drag is carrying, or null when nothing is in flight. It exists so the slots a
  // widget could land in can offer themselves while it is being moved.
  const [dragging, setDragging] = useState<GutterWidgetId | null>(null);

  // Which corner the drag is OVER, or null while it is over none of them. One value for the whole
  // layout, so exactly one corner is ever open, and it is the one the pointer is standing in: a
  // corner that opens only under the pointer cannot take height from a widget nobody is touching —
  // including the widget on the far side of the chat, which a drag used to halve from across the
  // room and re-lay-out under a pointer that never came near it.
  const [hovered, setHovered] = useState<GutterSlotId | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    // A fresh observer reports the region's current width as its first entry, so a change of
    // `enabled` re-answers the question through the same path as a resize — no second measurement
    // to keep in step. Only a FLIP of the answer reaches state.
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      // ZERO IS NOT AN ANSWER about width. The workspace hides the chat tab with `hidden` rather
      // than unmounting it, so this region measures 0 while another tab is open — and a gutters-off
      // reading there would tear down the widgets and the state inside them (a scrolled run list,
      // an expanded phase) on a trip to the Files tab and back. The real width answers when the tab
      // comes back, which is a resize the observer sees.
      if (width === 0) return;
      const next = enabled && width >= MIN_REGION_PX;
      setWide((previous) => (previous === next ? previous : next));
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [enabled]);

  // A capitalised local, because JSX reads a lowercase tag as an intrinsic element: this is what
  // lets the boundary arrive as a prop instead of this module importing the workspace's own.
  const Boundary = boundary;

  // Which widget a corner draws, in the one order the modules agree on. The list is the layout's
  // and the repair's (`useGutterPlacements`), so a slot and a repaired record can never disagree
  // about who holds a corner.
  const widgetIn = (slot: GutterSlotId): GutterWidgetId | null =>
    GUTTER_WIDGET_ORDER.find((widget) => placements[widget].slot === slot) ?? null;

  // A drag ends the same way wherever it ends — dropped, cancelled, or carried off the window —
  // so the invitation closes with it and no corner is left standing open.
  const endDrag = () => {
    setDragging(null);
    setHovered(null);
  };

  const dropWidget = (widget: GutterWidgetId, slot: GutterSlotId) => {
    moveWidget(widget, slot);
    endDrag();
  };

  // Only a CHANGE reaches state: `dragover` fires continuously on the element under the pointer.
  const hoverSlot = (slot: GutterSlotId | null) =>
    setHovered((previous) => (previous === slot ? previous : slot));

  // WHAT A WIDGET IS, in one table: a third widget costs one entry here and nothing else in this
  // file. The hooks stay at the top level — a table cannot call one conditionally — so the entries
  // only read what they returned.
  const widgets: Record<
    GutterWidgetId,
    { title: string; count: number; icon: LucideIcon; Body: ComponentType<{ sessionId: string | null }> }
  > = {
    runner: {
      title: t('gutters.runner.title'),
      count: runnerCount,
      icon: ActivityIcon,
      Body: RunnerWidgetBody,
    },
    memory: {
      title: t('gutters.memory.title'),
      count: pendingCount,
      icon: BrainIcon,
      Body: MemoryWidgetBody,
    },
    subagents: {
      title: t('gutters.subagents.title'),
      count: subagentCount,
      icon: BotIcon,
      Body: SubagentWidgetBody,
    },
  };

  const renderWidget = (widget: GutterWidgetId): ReactNode => {
    const { title, count, icon, Body } = widgets[widget];

    return (
      <GutterWidgetFrame
        widget={widget}
        title={title}
        count={count}
        icon={icon}
        open={placements[widget].open}
        onToggle={() => toggleWidget(widget)}
        onDragStart={setDragging}
        onDragEnd={endDrag}
      >
        {/* Its own boundary, inside its own frame: a body that throws costs this gutter and leaves
            the chat and the other widgets standing. */}
        <Boundary>
          <Body sessionId={sessionId} />
        </Boundary>
      </GutterWidgetFrame>
    );
  };

  const renderSlot = (slot: GutterSlotId) => {
    const widget = widgetIn(slot);
    return (
      <GutterSlot
        key={slot}
        slot={slot}
        widget={widget}
        open={widget === null ? false : placements[widget].open}
        hovered={hovered === slot}
        dragging={dragging}
        onHoverSlot={hoverSlot}
        onDropWidget={dropWidget}
        renderWidget={renderWidget}
      />
    );
  };

  return (
    <div ref={rootRef} className="flex h-full min-h-0 justify-center">
      {/* THE THREE COLUMNS ARE ALWAYS DRAWN, and the chat is this box's first child at every width:
          crossing the threshold adds the two asides and the gap between them, and rebuilds nothing.
          The threshold is not a layout switch — it is only the question "is there room for the
          widgets?", so the chat column below it is still the chat's own column, with the pane and
          its scrollbar on it, instead of a stranded pane running to the region's far edge. */}
      <div
        data-testid={wide ? 'chat-gutter-grid' : undefined}
        className={cn(
          'grid h-full min-h-0 w-full max-w-[1860px] grid-cols-[minmax(0,1fr)_minmax(0,868px)_minmax(0,1fr)]',
          // The gap belongs to the widgets: with no gutters beside the chat there is nothing to
          // separate, and a gap would take 32px off the chat column on a narrow window.
          wide && 'gap-4',
        )}
      >
        {/* THE CHAT COLUMN IS THE CHAT'S OWN COLUMN. The middle track is the transcript's
            `max-w-[54.25rem]` and nothing wider, so the scroll pane — and the scrollbar pinned to
            its right edge — ends where the transcript ends. A `1fr` middle left the pane spanning
            the dead band out to the widgets, which is where the scrollbar used to float. */}
        <div
          data-testid="chat-gutter-chat"
          className="col-start-2 row-start-1 h-full min-h-0 min-w-0"
        >
          {children}
        </div>

        {/* THE WIDGETS TAKE THE SPARE WIDTH, and only the spare: each gutter is a `1fr` track that
            the centred `max-w-[1860px]` above stops at 480px — 1860 is 868 + 2 * (480 + 16), and
            past 480 a run list is a list spread across a screen it does not fill. What is left over
            sits OUTSIDE the three columns, never between a widget and the chat. */}
        {wide && (
          <aside
            data-testid="chat-gutter-left"
            className="col-start-1 row-start-1 flex h-full min-h-0 flex-col gap-4 py-3"
          >
            {renderSlot('top-left')}
            {renderSlot('bottom-left')}
          </aside>
        )}

        {wide && (
          <aside
            data-testid="chat-gutter-right"
            className="col-start-3 row-start-1 flex h-full min-h-0 flex-col gap-4 py-3"
          >
            {renderSlot('top-right')}
            {renderSlot('bottom-right')}
          </aside>
        )}
      </div>
    </div>
  );
}
