import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';

import { useStepPhrase } from '@/modules/roadmap/hooks/useStepPhrase';
import { createStackPainter } from '@/modules/roadmap/utils/stackPainter';
import { ROADMAP_FEATURE_WORD_KEYS, ROADMAP_MILESTONE_WORD_KEYS } from '@/shared/constants';
import type { Roadmap } from '@/shared/roadmap-types';
import type { RoadmapStackHandle, RoadmapStackTarget, RoadmapStackTier, RoadmapStackWall } from '@/shared/types';
import { cn } from '@/shared/utils';

type RoadmapStackProps = {
  roadmap: Roadmap;
  /** The roadmap laid out (`layoutStack`): one ring per milestone. */
  tiers: RoadmapStackTier[];
  /** The ring a first picture opens on (`arrivalTier`). */
  arrival: number;
  /** The card that is open, so the stack can hang it from its wall or its thread; `null` for none. */
  open: RoadmapStackTarget | null;
  /** A press that opens a card, or `null` for a press that opens nothing (which closes the one that is open). */
  onOpen: (target: RoadmapStackTarget | null) => void;
  /** The open card itself, drawn by the owner: the stack only places it. */
  card: ReactNode;
  handleRef?: Ref<RoadmapStackHandle>;
};

/** What the words under the stack say: the ring in front and the wall that faces the pointer there, or the ring pointed at. */
type Reading = { tier: number; facing: string | null; shown: number; top: number };

const NO_READING: Reading = { tier: 0, facing: null, shown: -1, top: 0 };

/** The colour behind an element: the first painted background on the way up, so the stack's floors match what they stand on. */
function groundBehind(element: HTMLElement): string {
  for (let at: HTMLElement | null = element; at !== null; at = at.parentElement) {
    const color = getComputedStyle(at).backgroundColor;
    // Clear reads `rgba(0, 0, 0, 0)` or, in a wide-gamut space, `… / 0)`.
    if (color && color !== 'transparent' && !/[,/]\s*0\)$/.test(color)) return color;
  }
  return '';
}

const EYEBROW = 'text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground';

/** One line of the reading: it never wraps, so the three lines keep the room the painter leaves them; the card says a long title whole. */
const LINE = 'block max-w-full truncate';

/** The facing wall in words: where it lives, its title, and where it stands, in the roadmap's own words. */
function WallReading({ tier, wall }: { tier: RoadmapStackTier; wall: RoadmapStackWall }) {
  const { t } = useTranslation();
  const { feature } = wall;
  const phrase = useStepPhrase(feature);
  const done = feature.tasks.filter((task) => task.status === 'done').length;
  const tone = wall.tone === 'danger' ? 'danger' : wall.tone === 'warn' ? 'warn' : wall.unseen ? 'positive' : null;
  return (
    <>
      <span className={cn(EYEBROW, LINE)}>{`${tier.n} · ${tier.milestone.title} › ${wall.epic.title}`}</span>
      <span className={cn('font-mono text-sm uppercase tracking-wide text-foreground', LINE)}>{feature.title}</span>
      <span data-tone={tone ?? undefined} data-roadmap-stack-words className={cn(EYEBROW, LINE, tone !== null && 'text-tone-ink')}>
        {[
          t('roadmap.stateLine', { word: t(ROADMAP_FEATURE_WORD_KEYS[feature.word]), phrase }),
          feature.tasks.length > 0 ? t('roadmap.panel.tasksDone', { done, count: feature.tasks.length }) : null,
        ].filter(Boolean).join(' · ')}
      </span>
    </>
  );
}

/** A ring he is pointing at, or has chosen with a first tap, in words: its place, its title, and how it stands. */
function TierReading({ roadmap, tier }: { roadmap: Roadmap; tier: RoadmapStackTier }) {
  const { t } = useTranslation();
  const { milestone } = tier;
  const asks = tier.walls.some((wall) => wall.attention >= 2);
  const word = t(ROADMAP_MILESTONE_WORD_KEYS[milestone.word]);
  return (
    <>
      <span className={cn(EYEBROW, LINE)}>{roadmap.title}</span>
      <span className={cn('font-mono text-sm uppercase tracking-wide text-foreground', LINE)}>{`${tier.n} · ${milestone.title}`}</span>
      <span data-tone={asks ? 'warn' : undefined} data-roadmap-stack-words className={cn(EYEBROW, LINE, asks && 'text-tone-ink')}>
        {t('roadmap.tree.milestoneLine', { shipped: milestone.standing.shipped, count: milestone.standing.features, word })}
      </span>
    </>
  );
}

/**
 * THE ROADMAP AS A STACK, on its canvas: one ring per milestone, the one in front standing open with a wall for each of
 * its features, what is reached closed under it and what is to come hanging over it (`utils/stackPainter` says how each
 * is drawn). Under it, in words, is what faces the pointer — or the ring being pointed at.
 *
 * IT TURNS AND IT IS WALKED. A drag, a flick, the wheel or the left and right keys turn the ring in front; a press on a
 * wall brings it round, and a press on the wall that already faces opens its card. Up and down, or a press on a band
 * below or a hoop above, change the ring in front; under a finger the first press on another ring only chooses it and
 * the second goes. Space goes to the next thing that asks for the operator.
 *
 * THE OPEN CARD HANGS FROM WHAT IT IS ABOUT. The owner draws the card (`card`); this places it each frame over the wall
 * or the thread it belongs to, inside the stack's own box, and at the foot of the box where the box is too narrow for
 * a card beside anything. No second panel, and nothing is dimmed. Turning the stack puts the card away.
 *
 * It is one focusable thing: a slider whose value is the wall in front, said as its words.
 *
 * Used by `RoadmapStackFace`, as the Roadmap tab's Stack face.
 */
export function RoadmapStack({ roadmap, tiers, arrival, open, onOpen, card, handleRef }: RoadmapStackProps) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const painterRef = useRef<ReturnType<typeof createStackPainter> | null>(null);
  // Read by the frame loop, which outlives any one render: the card it places and the press it reports are the latest.
  const openRef = useRef(open);
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    openRef.current = open;
    onOpenRef.current = onOpen;
  }, [open, onOpen]);

  // What the words under the stack say. The painter decides it each frame; it is state only so the words re-render
  // when the wall in front, the ring in front or the ring pointed at actually changes.
  const [reading, setReading] = useState<Reading>(NO_READING);
  // Whether a mouse is over a ring it could go to: the cursor says so.
  const [overTier, setOverTier] = useState(false);

  useImperativeHandle(handleRef, () => ({ face: (name: string) => painterRef.current?.face(name) }), []);

  // The painter, the canvas's size, the theme, and the frame loop: set up once, for the life of the canvas.
  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return undefined;
    const painter = createStackPainter(canvas);
    painterRef.current = painter;

    const measure = () => painter.resize(box.clientWidth, box.clientHeight, Math.min(2, window.devicePixelRatio || 1));
    const theme = () => painter.readTheme(canvas, groundBehind(box));
    measure();
    theme();
    const sized = new ResizeObserver(measure);
    sized.observe(box);
    // The theme is a class and a few properties on the document's root: re-read the colours whenever it changes.
    const themed = new MutationObserver(theme);
    themed.observe(document.documentElement, { attributes: true });
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stillness = () => painter.setStill(calm.matches);
    stillness();
    calm.addEventListener('change', stillness);

    let frame = 0;
    // The open card's place as last written, so a still frame writes nothing to the page.
    let placed = '';
    const place = (holder: HTMLElement, css: string) => {
      if (css === placed && holder.style.cssText !== '') return;
      placed = css;
      holder.style.cssText = css;
    };
    const loop = (now: number) => {
      const shown = painter.frame(now);
      const facing = shown.facing?.feature.name ?? null;
      setReading((held) => (
        held.tier === shown.tier && held.facing === facing && held.shown === shown.shown && held.top === shown.readingTop
          ? held
          : { tier: shown.tier, facing, shown: shown.shown, top: shown.readingTop }
      ));
      // The open card follows its wall: over it where there is room, at the foot of a narrow box.
      const holder = cardRef.current;
      const target = openRef.current;
      if (holder && target) {
        const anchor = painter.anchorOf(target);
        const narrow = box.clientWidth < 640;
        if (anchor === null) onOpenRef.current(null);
        else if (narrow) place(holder, 'left:8px;right:8px;bottom:8px;max-height:72%;');
        else {
          const width = Math.min(560, box.clientWidth - 24);
          const left = Math.round(Math.min(Math.max(12, anchor[0] - width / 2), box.clientWidth - width - 12));
          const top = Math.round(Math.max(8, anchor[1] - 14 - holder.offsetHeight));
          place(holder, `left:${left}px;top:${top}px;width:${width}px;max-height:${box.clientHeight - 16}px;`);
        }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      sized.disconnect();
      themed.disconnect();
      calm.removeEventListener('change', stillness);
      painterRef.current = null;
    };
  }, []);

  // Each new picture is handed to the painter, which keeps the ring in front and every wall's eased figures across it.
  useEffect(() => {
    painterRef.current?.setTiers(tiers, arrival);
  }, [tiers, arrival]);

  const at = (event: { clientX: number; clientY: number }): [number, number] => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? [event.clientX - rect.left, event.clientY - rect.top] : [0, 0];
  };

  const tier = tiers[reading.tier];
  const facing = tier?.walls.find((wall) => wall.feature.name === reading.facing) ?? null;
  const pointed = reading.shown >= 0 ? tiers[reading.shown] ?? null : null;

  return (
    <div ref={boxRef} data-roadmap-stack={tier?.milestone.name ?? ''} className="relative h-full min-h-0 w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="slider"
        aria-orientation="horizontal"
        aria-label={t('roadmap.stack.label')}
        aria-valuemin={1}
        aria-valuemax={Math.max(1, tier?.walls.length ?? 1)}
        aria-valuenow={facing && tier ? tier.walls.indexOf(facing) + 1 : 1}
        aria-valuetext={facing && tier ? t('roadmap.stack.value', { feature: facing.feature.title, epic: facing.epic.title, n: tier.n, milestone: tier.milestone.title }) : undefined}
        data-roadmap-stack-facing={reading.facing ?? ''}
        className={cn(
          'absolute inset-0 block h-full w-full touch-none select-none font-mono outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
          overTier ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
        )}
        onPointerDown={(event) => {
          const [x, y] = at(event);
          if (painterRef.current?.pointerDown(x, y, event.pointerType !== 'mouse')) event.currentTarget.setPointerCapture(event.pointerId);
          else onOpen(null);
        }}
        onPointerMove={(event) => {
          const [x, y] = at(event);
          setOverTier(painterRef.current?.pointerMove(x, y, event.pointerType === 'mouse') ?? false);
        }}
        onPointerUp={() => {
          // A press on the facing wall or a thread opens its card; a turn, or a press on anything else, closes the one that is open.
          onOpen(painterRef.current?.pointerUp() ?? null);
        }}
        onPointerCancel={() => { painterRef.current?.pointerUp(); }}
        onPointerLeave={() => {
          painterRef.current?.pointerLeave();
          setOverTier(false);
        }}
        onWheel={(event) => {
          painterRef.current?.wheel((event.deltaY || event.deltaX) > 0);
          onOpen(null);
        }}
        onKeyDown={(event) => {
          const answer = painterRef.current?.key(event.key, event.shiftKey) ?? false;
          if (answer === false) return;
          event.preventDefault();
          onOpen(answer === true ? null : answer);
        }}
      />

      {/* What faces the pointer, in words; or the ring he is pointing at. Hidden from assistive tech: the slider's value says it. */}
      {tier && (
        <div
          aria-hidden="true"
          data-roadmap-stack-reading
          // Three lines, where it is, what it is and how it stands; put away while a card is open, which says all three.
          className={cn('pointer-events-none absolute inset-x-0 flex flex-col items-center gap-0.5 px-4 text-center', open !== null && 'invisible')}
          style={{ top: reading.top }}
        >
          {pointed ? <TierReading roadmap={roadmap} tier={pointed} /> : facing ? <WallReading tier={tier} wall={facing} /> : null}
        </div>
      )}

      {open !== null && (
        <div ref={cardRef} data-roadmap-stack-card={open.kind} className="scrollbar-thin absolute z-10 overflow-y-auto overscroll-contain">
          {card}
        </div>
      )}
    </div>
  );
}
