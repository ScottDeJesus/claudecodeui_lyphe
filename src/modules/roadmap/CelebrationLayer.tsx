import { Check } from 'lucide-react';
// FILL: imports — the markers' own: react's useState, useEffect and useLayoutEffect beside these two, and useRoadmap
import { Fragment, useRef } from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

import type { Moment } from '@/modules/roadmap/celebrationContext';
import { Button, Card } from '@/shared/ui';
import { cn, formatShortDate } from '@/shared/utils';

// The milestone's moment, drawn over its scope, and the one line that says every moment in words.
//
// Each fill marker below governs the ONE statement under it, which holds a fake standing in for what
// the fill reads or does; `imports` governs the react import under it and the one line the fill adds
// beside it, `useRoadmap`'s. Every other line is composition and stays as it is.

/** Where the burst is born: the reached station's centre, as fractions of the layer's own box, each clamped to [0, 1]. */
type BurstOrigin = { x: number; y: number };

/** The reached milestone's size, the banner's figures: how many epics and features it took. */
type MilestoneTally = { epics: number; features: number };

type CelebrationLayerProps = {
  /** What is playing on this surface right now, or `null` when nothing is. */
  moment: Moment | null;
  /** Ends the moment early. */
  onSkip: () => void;
  /** `face`, the Roadmap tab's face; `frame`, a gutter widget's body. */
  scope: 'face' | 'frame';
};

/** What changes with the scope: the stage's inset, the banner's width and padding, the title's type, the burst's reach in px. */
type ScopeFrame = { inset: string; width: string; banner: string; title: string; reach: number };

/**
 * `face` is a wide stage, so the title reaches 3rem from md up and the burst throws up to 320px.
 * `frame` is a column about 360px wide, so the banner takes the column, the title is 2rem, and the burst
 * throws about half as far. The banner's foot is shallower than its head because the ghost Skip carries
 * its own inner space.
 *
 * A TITLE'S SIZE AND LEADING ARE ONE CLASS (`text-[2rem]/[1.1]`). `cn` hands a later font size the
 * leading spelled before it, so a separate `leading-*` is dropped and the display serif sets at the
 * body's 1.5. Clamped, it sets at 1.1, because at 1.05 the clamp's `overflow: hidden` shears the last
 * line's descenders. The face clamps below md, four lines inside a 16px inset, so the store's
 * 120-character title still leaves Skip on an SE-sized face; from md up it runs whole at 1.05.
 */
const SCOPE_FRAME: Record<CelebrationLayerProps['scope'], ScopeFrame> = {
  face: {
    inset: 'p-4 md:p-10',
    width: 'max-w-xl',
    banner: 'px-8 pb-5 pt-8 md:px-12 md:pb-6 md:pt-10',
    title: 'text-[2.5rem]/[1.1] max-md:line-clamp-4 md:text-5xl/[1.05]',
    reach: 320,
  },
  frame: {
    inset: 'p-3',
    width: '',
    banner: 'px-5 pb-3 pt-6',
    title: 'line-clamp-3 text-[2rem]/[1.1]',
    reach: 150,
  },
};

/**
 * The milestone's timeline from the moment's arrival, in ms. The layer waits out `entrance` first, the
 * rail's own draw to the station (`animate-roadmap-draw`, 900 ms), invisible and inert; then it enters,
 * and holds until `entrance + hold`, when it leaves over 300 ms. The `hold` fill keeps these times.
 */
const MILESTONE_TIMELINE = { entrance: 900, hold: 2200 } as const;

/** The entrance's wait on every animation it starts: the layer's fade, each particle's flight, the banner's rise. Timing data, inline. */
const ENTRANCE_DELAY: CSSProperties = { animationDelay: `${MILESTONE_TIMELINE.entrance}ms` };

/** Where the layer stands in that timeline: waiting out the path's travel, holding, or leaving. */
type LayerPhase = 'arriving' | 'holding' | 'leaving';

/** What each phase does to the layer's paint: it fades as it leaves. */
const PHASE_LAYER: Record<LayerPhase, string> = { arriving: '', holding: '', leaving: 'opacity-0' };

/**
 * `inert`, as React 18 can carry it: its JSX types lack the attribute, so it travels through a typed
 * cast, and its presence is the whole signal (`CardFold.tsx`, `RoundAnswer.tsx`).
 */
const OUT_OF_REACH = { inert: '' } as unknown as HTMLAttributes<HTMLDivElement>;

/**
 * Who may reach the layer in each phase: only while it holds. Invisible as it arrives and fading as it
 * leaves, it is inert, so neither the pointer, the keyboard nor assistive technology can press a Skip
 * the reader cannot see and end a moment unseen.
 */
const PHASE_REACH: Record<LayerPhase, HTMLAttributes<HTMLDivElement>> = {
  arriving: OUT_OF_REACH,
  holding: {},
  leaving: OUT_OF_REACH,
};

/** What each phase does to the banner: it dissolves as the layer leaves, quicker than the scrim. */
const PHASE_BANNER: Record<LayerPhase, string> = { arriving: '', holding: '', leaving: 'opacity-0 blur-sm' };

/** The three inks a particle may take: the accent fill, the warm gold and the deep green of the accent's word. */
const PARTICLE_TONES = ['bg-primary', 'bg-warn-ink', 'bg-accent-ink'] as const;

/** Three particle shapes, each centred on the origin by its own negative margin (the burst owns `transform`). */
const PARTICLE_SHAPES = ['-m-1 size-2 rounded-full', '-m-[5px] size-2.5 rounded-sm', '-m-1.5 size-3 rounded-full'] as const;

/** The golden angle, in radians: successive particles step by it, so 48 of them cover the circle evenly. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * The 48 particles, fixed at load so every burst is the same burst and a render draws no randomness.
 * `dx`/`dy` are unit directions times a reach between 0.55 and 1, scrambled so neighbours in angle land
 * at different distances; the scope's `reach` turns them into pixels. Tone and shape step on different
 * strides, so no colour keeps to one ring or one shape.
 */
const PARTICLES = Array.from({ length: 48 }, (_, index) => {
  const angle = index * GOLDEN_ANGLE;
  const reach = 0.55 + 0.045 * ((index * 7) % 11);
  return {
    dx: Math.cos(angle) * reach,
    dy: Math.sin(angle) * reach,
    tone: PARTICLE_TONES[index % PARTICLE_TONES.length],
    shape: PARTICLE_SHAPES[Math.floor(index / 4) % PARTICLE_SHAPES.length],
  };
});

/**
 * Used by `RoadmapPath` (the Roadmap tab's face, at `face` scope) and `RoadmapWidgetBody` (the chat
 * gutter's roadmap widget, at `frame` scope). Each hands it `useCelebrations`' `moment` and `skip` and
 * draws it as the LAST child of the `relative` box that frames its scope on screen, outside any scroll
 * container: the layer covers that box (`absolute inset-0`), centres its banner in what the reader
 * sees, and finds the reached station inside it.
 *
 * EVERY MOMENT IS SAID. The polite live line is always mounted, empty while nothing plays, so a screen
 * reader hears each moment of every level the instant its words land. A task, a feature or an epic
 * draws that line and nothing more here: those three play on their own row and card.
 *
 * THE MILESTONE TAKES THE WHOLE SCOPE, the one moment bigger than its element, and it comes LAST. For
 * the timeline's first `entrance` (900 ms) the layer is invisible and inert, out of reach of pointer,
 * keyboard and assistive technology, so `MilestonePath`'s own part plays undimmed: the rail fills to the
 * station (`animate-roadmap-draw`, 900 ms) and the station blooms. Whatever of the path's motion runs
 * past `entrance` plays under the scrim. Then the scope dims under a `bg-background/70` scrim
 * (`vv-fade`, 250 ms, on the layer, so the banner fades with it), 48 particles burst from the reached
 * station's centre above the scrim (from the layer's edge nearest it, when the station is scrolled out
 * of view), and a centred banner rises over them. It holds until `entrance + hold` (3.1 s), then goes
 * inert again as the banner dissolves (200 ms) inside the layer's own fade (300 ms). That is about 3.4 s
 * in all, so `useCelebrations` keeps a milestone moment up at least that long. A click anywhere on it,
 * its Skip, or Escape ends it early.
 *
 * UNDER REDUCED MOTION IT IS STILL: no particles and no rise. The banner fades in on the same
 * timeline, holds and fades out, because opacity (and the exit's blur, which moves nothing) is all the
 * layer changes there.
 */
export function CelebrationLayer({ moment, onSkip, scope }: CelebrationLayerProps) {
  const { t } = useTranslation();
  const frame = SCOPE_FRAME[scope];
  // The layer's own box: the reached station is found inside its parent and measured against it.
  const layerRef = useRef<HTMLDivElement>(null);

  // A station scrolled out of the layer's box bursts from the box's edge nearest it, so a reader watching
  // the epics still sees the burst leave.
  // FILL: origin — the centre of `[data-roadmap-milestone=<moment.name>]` in the scope, as fractions of layerRef's box, clamped to [0, 1] on each axis
  const origin: BurstOrigin = { x: 0.5, y: 0.2 };
  // Where the layer stands in its timeline, which decides whether it can be reached and when it fades.
  // When the moment goes (the hold's leave or a Skip) with focus inside the layer, focus is handed on the
  // next frame to the reached station, `[data-roadmap-milestone=<moment.name>]`, the one control the
  // moment is about, so a keyboard reader never drops to `<body>` (`putAwayFocus.ts`'s rule).
  // FILL: hold — 'arriving' as each milestone moment arrives, 'holding' at MILESTONE_TIMELINE.entrance, 'leaving' at entrance + hold, handing focus on as it leaves
  const phase: LayerPhase = 'holding';
  // Escape skips while the layer holds, heard by a bubble-phase `keydown` on `window` that never stops
  // or prevents the key: a dialog over the face takes Escape at capture before it (`overlayEscape.ts`,
  // MAN-741), and the chat beside the widget keeps its own.
  // FILL: onSkip — calls onSkip, on a click on the layer and on that Escape, handing focus on as the layer goes
  const skip: typeof onSkip = () => {};
  // FILL: tally — the reached milestone's standing.epics and .features, off useRoadmap().selected by moment.name
  const tally: MilestoneTally | null = { epics: 4, features: 8 };

  const figures = moment
    ? [
        tally ? t('roadmap.celebrate.epics', { count: tally.epics }) : '',
        tally ? t('roadmap.celebrate.features', { count: tally.features }) : '',
        // The roadmap's one spelling of a day (`formatShortDate`), so the banner and the path name it alike; an unreadable stamp drops out.
        formatShortDate(moment.at) ?? '',
      ].filter(Boolean)
    : [];

  return (
    <>
      <p aria-live="polite" aria-atomic="true" className="sr-only" data-roadmap-announce>
        {moment && (
          <>
            <span className="block">{t(`roadmap.celebrate.announce.${moment.level}`, { title: moment.title })}</span>
            {moment.summary && <span className="block">{moment.summary}</span>}
          </>
        )}
      </p>

      {moment?.level === 'milestone' && (
        <div
          ref={layerRef}
          data-roadmap-moment={moment.name}
          data-roadmap-scope={scope}
          data-roadmap-phase={phase}
          {...PHASE_REACH[phase]}
          // The fade fills `backwards`: it holds the layer at 0 through the entrance's wait and lets go at
          // its end, so the leave's opacity transition still runs. `src/index.css` cuts every animation and
          // transition to 0.01ms under reduced motion; the fade is the one change this layer keeps there,
          // so its durations are restated, `!`, under `motion-reduce:`.
          className={cn(
            'absolute inset-0 z-30 grid animate-[vv-fade_250ms_ease_backwards] cursor-pointer place-items-center overflow-hidden transition-opacity duration-300 motion-reduce:![animation-duration:250ms] motion-reduce:!duration-300',
            frame.inset,
            PHASE_LAYER[phase],
          )}
          style={ENTRANCE_DELAY}
          onClick={skip}
        >
          <div aria-hidden="true" className="absolute inset-0 bg-background/70" />

          <div
            aria-hidden="true"
            className="pointer-events-none absolute size-0 motion-reduce:hidden"
            style={{ left: `${origin.x * 100}%`, top: `${origin.y * 100}%` }}
          >
            {PARTICLES.map((particle, index) => (
              <span
                // The particles never reorder or change count, so the index IS their identity.
                key={index}
                data-roadmap-particle
                className={cn('absolute left-0 top-0 motion-safe:animate-roadmap-burst', particle.tone, particle.shape)}
                style={{ ...ENTRANCE_DELAY, '--dx': `${particle.dx * frame.reach}px`, '--dy': `${particle.dy * frame.reach}px` } as CSSProperties}
              />
            ))}
          </div>

          {/* The banner leaves on its own wrapper, quicker than the scrim and with a soft blur, so its
              words dissolve instead of ghosting over the face. Not on the card: the card's rise holds
              its opacity and transform for as long as that animation stands. */}
          <div
            className={cn(
              'relative w-full transition-[opacity,filter] duration-200 motion-reduce:!duration-200',
              frame.width,
              PHASE_BANNER[phase],
            )}
          >
            <Card
              data-roadmap-banner
              className={cn('flex flex-col items-center text-center shadow-lg motion-safe:animate-shape-rise', frame.banner)}
              style={ENTRANCE_DELAY}
            >
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-accent-ink">
                <span aria-hidden="true" className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3" strokeWidth={3} />
                </span>
                {t('roadmap.celebrate.milestoneReached')}
              </p>
              <h2 className={cn('mt-3 text-balance font-serif text-foreground', frame.title)}>{moment.title}</h2>
              {figures.length > 0 && (
                <p className="mt-4 flex flex-wrap items-center justify-center gap-x-2 text-sm text-muted-foreground">
                  {figures.map((figure, index) => (
                    <Fragment key={figure}>
                      {index > 0 && <span aria-hidden="true">·</span>}
                      <span>{figure}</span>
                    </Fragment>
                  ))}
                </p>
              )}
              {moment.summary && <p className="mt-2 max-w-prose text-balance text-sm text-foreground">{moment.summary}</p>}
              {/* No handler of its own: its click bubbles to the layer's, which skips once. */}
              <Button type="button" variant="ghost" size="sm" className="mt-5 text-muted-foreground">
                {t('roadmap.celebrate.skip')}
              </Button>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
