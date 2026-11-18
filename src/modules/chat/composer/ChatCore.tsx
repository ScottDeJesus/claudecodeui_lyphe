import '@/modules/chat/composer/chatLine.css';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { AccountWeekRing } from '@/modules/accounts';
import { CoreRings } from '@/modules/chat/composer/CoreRings';
import type { CoreRing } from '@/modules/chat/composer/CoreRings';
import { replyMaterialOf } from '@/modules/chat/transcript/replyMark';
import { CORE_BODY_SHARE, DEFAULT_EFFORT_VALUE } from '@/shared/constants';
import { useChatCorePlace } from '@/shared/context/ChatCorePlaceContext';
import { useCoreDrawing } from '@/shared/context/CoreDrawingContext';
import type { CoreDrawingInput } from '@/shared/context/CoreDrawingContext';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import { resolveModelLabel, resolveModelOption } from '@/shared/modelLabels';
import type { ProviderModelOption } from '@/shared/types';
import { SignalLoop } from '@/shared/ui';
import { OWNS_ESCAPE, overlayInFrontHoldsEscape } from '@/shared/ui/overlayEscape';
import { cn } from '@/shared/utils';

/** The side of the square the chat's core is drawn in, in px: the size of the companion's own core docked on the sessions home. */
const CORE_PX = 56;

/** In its disc the core is drawn larger, where it is the thing being set: this share of the disc's side. */
const CORE_SHARE_OF_DISC = 0.36;

/**
 * The side of the core's square where the page keeps a place for it apart from the line (`useChatCorePlace`), in px: the size it has in
 * its disc, so the rings open round it where it stands and it neither moves nor grows.
 */
const CORE_APART_PX = 96;

/** The ring that reads the context: how far outside the core's BODY it runs (`CORE_BODY_SHARE` of the square), and how thick it is drawn, in px. */
const CONTEXT_GAP = 6;
const RING_WIDTH = 2.5;

/** The account's week, the ring outside the context's: how far outside the context's it runs, in px. Far enough that the two read apart and take separate presses. */
const ACCOUNT_GAP = 7;

/** From this share of the context window the ring takes the warn ink: the window is nearly full. */
const CONTEXT_WARN = 0.8;

/** The disc the rings open in: its side at most, its side at least, and the air it keeps from the chat column's edges, in px. */
const DISC_PX = 250;
const DISC_MIN_PX = 200;
const DISC_EDGE = 12;

/** What counts as the settings' own surface for a press: the row the core opens, a menu or dialog opened from it, the account switcher. */
const OWN_SURFACE = '[data-chat-settings], [role="menu"], [role="dialog"], [data-owns-escape]';

/**
 * What the chat is doing, as its core draws it: at rest; while a turn runs, thinking, reading, writing or speaking (its reply
 * arriving); and waiting on the reader.
 */
export type ChatCoreState = 'idle' | 'thinking' | 'reading' | 'writing' | 'speaking' | 'waiting';

/** The body's form for each: its own, and the dish turned to the reader (listening) while it waits on them. */
const FORM: Record<ChatCoreState, CoreDrawingInput['state']> = { idle: 'idle', thinking: 'thinking', reading: 'reading', writing: 'writing', speaking: 'speaking', waiting: 'listening' };

/**
 * Where what the chat reads and writes to lies from its core, in degrees counter-clockwise from three o'clock: the talk. Docked
 * beside the line the talk is over it and across; in a place of its own (a desk's side column) the talk is beside it.
 */
const TALK_FROM_DOCK = 58;
const TALK_FROM_PLACE = 14;

/** The word for each thing it does, as its name and title say it. */
const DOING_WORD: Record<Exclude<ChatCoreState, 'idle'>, string> = { thinking: 'Thinking', reading: 'Reading', writing: 'Writing', speaking: 'Answering', waiting: 'Waiting on you' };

type EffortOption = NonNullable<ProviderModelOption['effort']>['values'][number];

type ChatCoreProps = {
  /** The model the chat runs on, by the catalog's alias or by the id a stored chat carries: the core is made of it. */
  model: string;
  /** Every model the chat can be set to: the stops of the model ring. */
  modelOptions: ProviderModelOption[];
  /** The picker's name for each concrete model id the catalog lists, for a stored chat's id. */
  modelLabelsById?: Record<string, string>;
  onSelectModel: (model: string) => void;
  /** How hard the chat thinks, by the catalog's own word, or the app's word for the model's own default. */
  effort: string;
  /** The efforts the model accepts: the stops of the effort ring after "Default". Empty draws no effort ring. */
  effortOptions: EffortOption[];
  onSelectEffort: (effort: string) => void;
  /** What the chat is doing. */
  state: ChatCoreState;
  /** How full the context window is, 0 to 1, or null while it is not known: the hairline round the core. */
  context: number | null;
  /** Whether the chat's settings stand open under the core's press. */
  open: boolean;
  /** The id of the row the press opens, for `aria-controls`. */
  controls: string;
  /** The chat's helpers, drawn round the core at rest (its subagents' dots), given the radius of the core's outer ring in px; nothing while the settings are open. */
  helpers?: (ringRadius: number) => ReactNode;
  /** The core, pressed: the chat's settings open or close. */
  onToggle: () => void;
  /** Escape, or a press anywhere else: the settings close. */
  onClose: () => void;
  className?: string;
};

/**
 * THE CHAT'S OWN CORE, beside the line the reader types in: the same instrument the companion is drawn with, one for each chat. The drawing
 * is the page's to give (`useCoreDrawing`): the instrument is the companion module's, which the chat cannot import without a cycle.
 *
 * IT SAYS FIVE THINGS WITHOUT A WORD. WHAT IT IS MADE OF is the model the chat runs on (`replyMaterialOf`). HOW RESTLESS ITS SURFACE IS is the
 * effort it is driven at. ITS FORM is what the chat is doing, and it is the whole of how a running turn is said (no line of words
 * stands over the box for it): a tide at rest; a polyhedron that holds and re-cuts while it thinks; a mouth opened toward the talk
 * while it reads; a tendril out toward the talk while it changes a file or sends an agent; lobes and spikes while its reply arrives;
 * and a dish turned to the reader while it waits on them. What it is doing is also in its name for a reader and its title for a
 * pointer. THE HAIRLINE ROUND IT is how full the context window is, in the warn ink once it is nearly full. THE HAIRLINE OUTSIDE THAT is the
 * account's week (`AccountWeekRing`), and a press on its band opens the account switcher. THE DOTS ON AN ARC OVER IT are the chat's
 * subagents (`helpers`, drawn by `transcript/PinnedSubagents`), one each, in its model's colour.
 *
 * PRESS THE CORE AND IT IS SET BY TURNING. The core rises out of its dock into a disc over the talk, with two flat rings round it
 * (`CoreRings`): the effort inside, lit as far as it is set, and the model outside, lit whole in the model's own colour. Turn one and
 * the core changes as it turns, before the stop is chosen. The rest of the chat's settings (tool sets, the count of tokens, the commands, export) open with it, in a row over the
 * line; they are the composer's own controls, unchanged. Escape, a press anywhere else or a second press on the core puts it all away.
 *
 * WHERE IT STANDS is the stylesheet's (`chatLine.css`): docked in the margin beside the line where the chat's column has one, so the line
 * and the talk above it keep one left edge, and at the line's start where it has none. Either way it stays level with the line's middle
 * as the line grows. Open, its disc stands over the talk at the column's start, clear of the line, so the line stays in use.
 *
 * AT A DESK THE PAGE KEEPS A PLACE FOR IT BESIDE THE TALK (`useChatCorePlace`, project-workspace's `ChatDesk`): the core is drawn into
 * that box, larger, and its disc opens round it where it stands. It is still this one component under the composer, so what it reads
 * and what its presses do are the same in either place.
 *
 * `data-chat-core` reads the state and `data-chat-core-material` the material. Each ring is `data-chat-ring` ("model", "effort") with
 * its stops as `data-ring-stop`, so a script can set one by pressing the core and then a stop. Used by `ChatComposer`.
 */
export function ChatCore({
  model, modelOptions, modelLabelsById, onSelectModel, effort, effortOptions, onSelectEffort, state, context, open, controls, helpers, onToggle, onClose, className,
}: ChatCoreProps) {
  const { t } = useTranslation('chat');
  const draw = useCoreDrawing();
  const hostWindow = useHostWindow();
  // The box the page keeps for the core apart from the line, or null: the core then stands in the line's own row.
  const place = useChatCorePlace();
  const dockRef = useRef<HTMLDivElement>(null);
  const ringsRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<HTMLButtonElement>(null);
  // Where the open disc stands from the dock, and its side: measured from the chat's own column each time it opens or its room changes.
  // Null while shut, when the core sits in its dock.
  const [lift, setLift] = useState<{ dx: number; dy: number; size: number } | null>(null);
  // A stop a ring is being turned past, before it is chosen: the core wears it at once. Null while no ring is held.
  const [preview, setPreview] = useState<{ ring: string; value: string } | null>(null);

  // The model ring's stops are the catalog's. A stored chat carries the id the SDK ran (`claude-opus-5-5`), not the catalog's alias, so
  // it stands on the stop of its family (`modelAt`), which then wears the name of the model the chat is really on. A model the catalog
  // has no family for (a custom one that was removed) is a stop of its own after the rest, so the ring never shows a model the chat is
  // not on.
  const { modelStops, modelAt } = useMemo(() => {
    const own = resolveModelLabel(modelOptions, model, modelLabelsById) || model;
    const at = resolveModelOption(modelOptions, model);
    const stops = modelOptions.map((option) => ({ value: option.value, label: option === at ? own : option.label || option.value }));
    return at === null ? { modelStops: [...stops, { value: model, label: own }], modelAt: model } : { modelStops: stops, modelAt: at.value };
  }, [model, modelOptions, modelLabelsById]);
  // The effort ring's: the model's own default first, as the app's menu has it, then each level the model accepts.
  const effortStops = useMemo(() => (effortOptions.length === 0 ? [] : [
    { value: DEFAULT_EFFORT_VALUE, label: t('composer.effortDefault', { defaultValue: 'Default' }) },
    ...effortOptions.map((option) => ({ value: option.value, label: option.value })),
  ]), [effortOptions, t]);

  const rings = useMemo<CoreRing[]>(() => [
    ...(effortStops.length > 0 ? [{ id: 'effort', label: t('core.effort', { defaultValue: 'Effort' }), stops: effortStops, value: effort, onSelect: onSelectEffort, scale: true }] : []),
    { id: 'model', label: t('core.model', { defaultValue: 'Model' }), stops: modelStops, value: modelAt, onSelect: onSelectModel, scale: false },
  ], [effort, effortStops, modelAt, modelStops, onSelectEffort, onSelectModel, t]);

  const onPreview = useCallback((ring: string, value: string | null) => {
    setPreview(value === null ? null : { ring, value });
  }, []);

  // What the core wears: the stop a held ring is passing, else what the chat is set to. A model is read by its value and its name
  // together, since either may carry the family ("opus", "Opus 5.5").
  const shownModel = preview?.ring === 'model' ? preview.value : modelAt;
  const shownEffort = preview?.ring === 'effort' ? preview.value : effort;
  const modelLabel = modelStops.find((stop) => stop.value === shownModel)?.label ?? shownModel;
  const material = replyMaterialOf(`${shownModel} ${modelLabel}`);
  // How hard it is driven, 0 to 1: where the effort stands among the model's levels. The model's own default is driven at the middle.
  const effortAt = effortOptions.findIndex((option) => option.value === shownEffort);
  const drive = effortOptions.length === 0 ? 0 : effortAt < 0 ? 0.5 : effortOptions.length === 1 ? 1 : effortAt / (effortOptions.length - 1);

  // The open disc's place: at the column's start (its middle on a narrow one), its foot clear of everything the composer holds, never
  // over the column's top.
  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (!open || dock === null) {
      setLift(null);
      return undefined;
    }
    if (place !== null) {
      // Apart from the line the core has its own place, with the room for its disc round it: it opens where it stands.
      const settleInPlace = () => {
        const size = Math.round(Math.max(DISC_MIN_PX, Math.min(DISC_PX, place.getBoundingClientRect().width - 2 * DISC_EDGE)));
        setLift((current) => (current !== null && current.dx === 0 && current.dy === 0 && current.size === size ? current : { dx: 0, dy: 0, size }));
      };
      settleInPlace();
      const placeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(settleInPlace);
      placeObserver?.observe(place);
      return () => placeObserver?.disconnect();
    }
    const column = dock.closest('.chat-column') ?? hostWindow.document.documentElement;
    const shell = dock.closest('.chat-composer-shell') ?? dock;
    const settle = () => {
      const docked = dock.getBoundingClientRect();
      const room = column.getBoundingClientRect();
      const size = Math.round(Math.max(DISC_MIN_PX, Math.min(DISC_PX, room.width - 2 * DISC_EDGE)));
      // At the column's start where the column is wide; in its middle where the disc takes most of it (a phone).
      const middleX = room.width < 2 * size ? room.left + room.width / 2 : room.left + DISC_EDGE + size / 2;
      const middleY = Math.max(room.top + DISC_EDGE + size / 2, shell.getBoundingClientRect().top - DISC_EDGE - size / 2);
      const next = { dx: Math.round(middleX - (docked.left + docked.width / 2)), dy: Math.round(middleY - (docked.top + docked.height / 2)), size };
      setLift((current) => (current !== null && current.dx === next.dx && current.dy === next.dy && current.size === next.size ? current : next));
    };
    settle();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(settle);
    observer?.observe(column);
    observer?.observe(shell);
    return () => observer?.disconnect();
  }, [open, hostWindow, place]);

  // Open, the settings let go on Escape or on a press anywhere else. Escape is taken on the window's capture phase and marked handled,
  // so the chat's running turn is not stopped by it (`useEscapeToAbortSession` reads the mark), and a panel opened in front of the rings
  // (a menu from the row, the account switcher) keeps the key until it has shut.
  useEffect(() => {
    if (!open) return undefined;
    const doc = hostWindow.document;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target === null || dockRef.current?.contains(target) || target.closest(OWN_SURFACE)) return;
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || overlayInFrontHoldsEscape(ringsRef.current, doc)) return;
      event.preventDefault();
      onClose();
      pressRef.current?.focus({ preventScroll: true });
    };
    doc.addEventListener('pointerdown', closeOnOutsidePointer);
    hostWindow.addEventListener('keydown', closeOnEscape, { capture: true });
    return () => {
      doc.removeEventListener('pointerdown', closeOnOutsidePointer);
      hostWindow.removeEventListener('keydown', closeOnEscape, { capture: true });
    };
  }, [open, hostWindow, onClose]);

  const effortLabel = effortStops.find((stop) => stop.value === effort)?.label ?? null;
  const settingsLabel = effortLabel === null || effort === DEFAULT_EFFORT_VALUE
    ? t('core.settings', { defaultValue: 'Chat settings · {{model}}', model: modelLabel })
    : t('core.settingsWithEffort', { defaultValue: 'Chat settings · {{model}}, {{effort}} effort', model: modelLabel, effort: effortLabel });
  // What it is doing, in a word, ahead of what the press opens: the form says it to the eye, this to a reader and a resting pointer.
  const label = state === 'idle' ? settingsLabel : `${t(`core.doing.${state}`, { defaultValue: DOING_WORD[state] })} · ${settingsLabel}`;
  const filled = context === null ? 0 : Math.min(1, Math.max(0, context));
  const up = open && lift !== null;
  // The core's square: its dock's, and larger in the disc; in a place of its own, the larger one always. Its two hairlines keep their
  // distance from its edge at any size.
  const restPx = place !== null ? CORE_APART_PX : CORE_PX;
  const corePx = place !== null ? CORE_APART_PX : up ? Math.round(lift.size * CORE_SHARE_OF_DISC) : CORE_PX;
  // The two rings sit close on the body, not on the square's edge: the body is `CORE_BODY_SHARE` of its square at any size.
  const contextRadius = Math.round(corePx * CORE_BODY_SHARE) + CONTEXT_GAP;
  const accountRadius = contextRadius + ACCOUNT_GAP;
  const contextLength = 2 * Math.PI * contextRadius;
  const contextBox = contextRadius + RING_WIDTH;

  const dock = (
    // The dock: the core's place beside the line. Its position is the stylesheet's (`chatLine.css`): in the line's row, or in the strip.
    // In a place of its own it is that place's to position, and only the instrument's own rules apply.
    <div
      ref={dockRef}
      data-chat-core-dock={up ? 'open' : 'docked'}
      data-chat-core-apart={place !== null ? '' : undefined}
      data-chat-core-material={material}
      className={cn(place !== null ? 'chat-inst relative' : 'chat-line__core chat-inst flex-none', className)}
      style={{ width: restPx, height: restPx }}
    >
      {/* What rises: a point at the dock's middle that everything is centred on, carried to the disc's middle while the settings are open. */}
      <div
        className="chat-inst__lift"
        style={(up ? { transform: `translate(${lift.dx}px, ${lift.dy}px)`, '--chat-inst-disc': `${lift.size}px` } : undefined) as CSSProperties | undefined}
      >
        <span aria-hidden="true" className="chat-inst__ground" />
        {up && (
          <div ref={ringsRef} {...OWNS_ESCAPE} role="group" aria-label={t('core.rings', { defaultValue: 'How this chat is set' })} className="chat-inst__rings">
            <CoreRings rings={rings} size={lift.size} onPreview={onPreview} />
          </div>
        )}
        <div className="chat-inst__heart">
          {/* The account's week, outside the context's hairline. A chat standing in a window of its own has no switcher to open beside
              it, so there the ring only reads. */}
          <AccountWeekRing radius={accountRadius} pressable={hostWindow === window} />
          {/* Its helpers, on an arc over it: out of the way while its own rings are open round it. */}
          {!up && helpers?.(accountRadius)}
          <button
            ref={pressRef}
            type="button"
            data-chat-core={state}
            aria-label={label}
            title={label}
            aria-expanded={open}
            aria-controls={controls}
            onClick={onToggle}
            className="chat-inst__press grid place-items-center rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
            style={{ width: corePx, height: corePx }}
          >
            {/* The core's own accessible name is the companion's; here the button speaks for it. */}
            <span aria-hidden="true" className="pointer-events-none grid size-full place-items-center">
              {draw !== null
                ? draw({ material, state: FORM[state], drive, size: corePx, azimuth: place !== null ? TALK_FROM_PLACE : TALK_FROM_DOCK })
                // No page gave the instrument (a surface that mounts the chat alone): the app's small loop stands in.
                : <SignalLoop state={state === 'idle' || state === 'waiting' ? 'idle' : 'thinking'} size={28} />}
            </span>
            {context !== null && (
              <svg
                aria-hidden="true"
                data-chat-core-context={Math.round(filled * 100)}
                data-tone={filled >= CONTEXT_WARN ? 'warn' : undefined}
                viewBox={`${-contextBox} ${-contextBox} ${2 * contextBox} ${2 * contextBox}`}
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90"
                style={{ width: 2 * contextBox, height: 2 * contextBox }}
              >
                <circle r={contextRadius} fill="none" strokeWidth={RING_WIDTH} style={{ stroke: 'var(--border)' }} />
                <circle
                  r={contextRadius}
                  fill="none"
                  strokeWidth={RING_WIDTH}
                  strokeLinecap="butt"
                  strokeDasharray={`${filled * contextLength} ${contextLength}`}
                  style={{ stroke: filled >= CONTEXT_WARN ? 'var(--warn-ink)' : 'var(--ink-muted)' }}
                  className="transition-[stroke-dasharray] duration-500 motion-reduce:transition-none"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
  return place !== null ? createPortal(dock, place) : dock;
}
