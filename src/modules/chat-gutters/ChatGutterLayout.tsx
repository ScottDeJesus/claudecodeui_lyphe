import { ActivityIcon, BotIcon, BrainIcon, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { SubagentWidgetBody, useClaimSubagentStrip, useSubagentWidgetCount } from '@/modules/chat';
import { GUTTER_SIDES, useGutterPlacements, widgetsOn } from '@/modules/chat-gutters/hooks/useGutterPlacements';
import { GutterColumn } from '@/modules/chat-gutters/GutterColumn';
import { GutterWidgetFrame } from '@/modules/chat-gutters/GutterWidgetFrame';
import { MemoryWidgetBody, useMemoryIntake } from '@/modules/memory-intake';
import { RunnerWidgetBody, useRunnerRuns } from '@/modules/plan-runner';
import type { GutterSide, GutterWidgetId } from '@/shared/types';
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
 * each of them draggable into either side's stack, at any place in it.
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
  const { placements, moveWidget, toggleWidget } = useGutterPlacements(sessionId);
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

  // Which widget a drag is carrying, or null when nothing is in flight. It exists so the places a
  // widget could land in can offer themselves while it is being moved, and nowhere else.
  const [draggingState, setDragging] = useState<GutterWidgetId | null>(null);

  // The drop place the pointer is in — a side and the rank it would take — or null while it is in
  // none. One value for the whole layout, so exactly one place is ever lit, and it is the one under
  // the pointer: a place that lights anywhere else would promise a landing the drop would not make.
  const [hoveredState, setHovered] = useState<{ side: GutterSide; index: number } | null>(null);

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
      // The gutters going away ends any drag they were carrying — the handle is unmounted and the
      // browser sends no `dragend` — so the state is dropped HERE, with the measurement that caused
      // it. Left standing, it came back with the columns when the region widened again: both lit,
      // both advertising a drop, still holding a widget nobody was dragging.
      if (!next) {
        setDragging(null);
        setHovered(null);
      }
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [enabled]);

  // What the columns are told, which is nothing at all while the gutters are not drawn.
  const dragging = wide ? draggingState : null;
  const hovered = wide ? hoveredState : null;

  // A capitalised local, because JSX reads a lowercase tag as an intrinsic element: this is what
  // lets the boundary arrive as a prop instead of this module importing the workspace's own.
  const Boundary = boundary;

  // A drag ends the same way wherever it ends — dropped, cancelled, or carried off the window —
  // so the invitation closes with it and no place is left standing open.
  const endDrag = useCallback(() => {
    setDragging(null);
    setHovered(null);
  }, []);

  // A drag whose handle is torn out mid-gesture — the region narrowing past the threshold unmounts
  // both asides — never delivers `dragend` to it, so the columns came back still lit, still
  // advertising a drop, and still holding the widget they were carrying. The window hears the end of
  // every drag; the measurement that takes the gutters away drops the state itself (above).
  useEffect(() => {
    if (dragging === null) return undefined;
    window.addEventListener('dragend', endDrag);
    window.addEventListener('drop', endDrag);
    return () => {
      window.removeEventListener('dragend', endDrag);
      window.removeEventListener('drop', endDrag);
    };
  }, [dragging, endDrag]);

  const dropWidget = (widget: GutterWidgetId, side: GutterSide, index: number) => {
    moveWidget(widget, side, index);
    endDrag();
  };

  // Only a CHANGE reaches state: `dragover` fires continuously on the element under the pointer.
  const hoverDrop = (place: { side: GutterSide; index: number } | null) =>
    setHovered((previous) => (
      previous?.side === place?.side && previous?.index === place?.index ? previous : place
    ));

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

  const renderColumn = (side: GutterSide) => (
    <GutterColumn
      key={side}
      side={side}
      widgets={widgetsOn(placements, side)}
      dragging={dragging}
      hovered={hovered}
      onHoverDrop={hoverDrop}
      onDropWidget={dropWidget}
      renderWidget={renderWidget}
    />
  );

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
        {wide && GUTTER_SIDES.map((side) => (
          <div
            key={side}
            className={cn('row-start-1 h-full min-h-0', side === 'left' ? 'col-start-1' : 'col-start-3')}
          >
            {renderColumn(side)}
          </div>
        ))}
      </div>
    </div>
  );
}
