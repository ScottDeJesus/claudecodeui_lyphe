import { Check, Flag, Plus } from 'lucide-react';
import { useContext, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { FAKE_CELEBRATION_CONTEXT } from '@/modules/roadmap/fake'; // FILL: fake — import { CelebrationContext } from '@/modules/roadmap/celebrationContext';
import type { Roadmap, RoadmapMilestone, RoadmapMilestoneWord } from '@/shared/roadmap-types';
import { cn, formatShortDate } from '@/shared/utils';

/** Each milestone word's key in the locale. */
const WORD_KEYS: Record<RoadmapMilestoneWord, string> = {
  empty: 'roadmap.milestoneWord.empty',
  'not started': 'roadmap.milestoneWord.notStarted',
  'in progress': 'roadmap.milestoneWord.inProgress',
  reached: 'roadmap.milestoneWord.reached',
};

/** Where a station stands: reached, the current one (the first not reached), on its way though not current, or not started. */
type Standing = 'reached' | 'current' | 'moving' | 'ahead';

type Size = 'full' | 'compact';

/**
 * Each size's geometry. `column` is a station's least width in rem: the path never squeezes a title under
 * it, and scrolls sideways instead (StatusFlow's rule). `row` is the disc row's height, and `rail` puts the
 * 2px rail through the middle of it — below every station's 1px border — so the line meets each disc at
 * its centre. `box` is a station's own box: a platform under a full station, a ring round a compact one.
 */
const GEOMETRY: Record<Size, { column: number; row: string; rail: string; disc: string; mark: string; box: string }> = {
  full: { column: 8, row: 'h-11', rail: 'top-[22px]', disc: 'size-7', mark: 'size-3.5', box: 'w-full rounded-xl px-2 pb-2.5' },
  compact: { column: 1.75, row: 'h-6', rail: 'top-[12px]', disc: 'size-4', mark: 'size-2.5', box: 'rounded-full px-0.5' },
};

/**
 * The bloom's three rings, each one `vv-ring` going out once from a wider circle a beat after the last.
 * The delays sit inside the path's own 900 ms, so the bloom has played before the layer dims the face.
 */
const BLOOM_RINGS = ['', 'scale-125 [animation-delay:150ms]', 'scale-150 [animation-delay:300ms]'] as const;

type MilestonePathProps = {
  roadmap: Roadmap;
  /** The milestone on the stage below the path, whose station is outlined; `null` while there is none. */
  focused: string | null;
  /** A station pressed: the caller puts that milestone on the stage. */
  onFocus: (name: string) => void;
  /** `full` on the face, every station titled; `compact` in the chat gutter's widget, the focused station's title alone, under the rail. */
  size: Size;
};

/** Where `milestone` stands on its roadmap's path. */
function standingOf(milestone: RoadmapMilestone, current: string | null): Standing {
  if (milestone.word === 'reached') return 'reached';
  if (milestone.name === current) return 'current';
  return milestone.word === 'in progress' ? 'moving' : 'ahead';
}

/**
 * The roadmap as a journey: one station per milestone on a rail that runs to a flag labelled Goal. The
 * rail is solid accent as far as the current station — the way already travelled — and dashed beyond
 * it. A station is a button that puts its milestone on the stage below: reached is a filled disc with a
 * check, the current one an accent ring that breathes on `live-ring`, the rest hollow; under each, its
 * title, then "reached <date>", "<shipped> of <features> features" while it moves, or its word, and an
 * amber "Blocked" when it is. The outlined station is the one on the stage. A roadmap whose every
 * milestone is reached draws a ghost station before the flag, which adds the next milestone (with no
 * milestone at all, it adds the first).
 *
 * THREE STATES, THREE CHANNELS, as StatusFlow keeps them: FOCUSED is the station's outline, keyboard
 * FOCUS the house focus ring, and LIVE the current disc's halo — so the default view, where the
 * current station is also the focused one, shows both at once without either hiding the other.
 *
 * THE MILESTONE MOMENT (`active.milestone`) is the path's own part of it: the rail draws itself from
 * the station before to the reached one (an SVG line on `roadmap-draw`, 900 ms — a `bg-primary` bar
 * cannot draw) and the station blooms (`roadmap-bloom`) while three rings go out from it. It all plays
 * within the layer's 900 ms entrance, undimmed, before `CelebrationLayer` scrims the face and bursts
 * from this station. Under reduced motion the rail is simply drawn and the station holds its bloom's
 * last size, still, for as long as the moment is named.
 *
 * Below 768px the rail scrolls sideways under the thumb, snapping a station to the middle; a wider
 * face scrolls it only when its stations would not fit.
 *
 * Used by `RoadmapHeader` at `full`, and by the chat gutter's roadmap widget at `compact` through the
 * module's barrel.
 */
export function MilestonePath({ roadmap, focused, onFocus, size }: MilestonePathProps) {
  const { t } = useTranslation();
  const active = useContext(FAKE_CELEBRATION_CONTEXT); // FILL: active — useContext(CelebrationContext)
  // FILL: dialogs — the dialog host's opener (RoadmapPath provides it): the ghost station's press opens ItemDialog adding a milestone
  // The track that scrolls sideways: the station the operator is travelling to is brought into it.
  const trackRef = useRef<HTMLDivElement>(null);
  // FILL: scroll the current station into view — below 768px, on mount and on a roadmap switch: trackRef's scrollLeft set so the current station's [data-roadmap-milestone] (the last one when every milestone is reached) sits mid-track, instantly, never smooth; a track that does not overflow is left alone
  useLayoutEffect(() => {}, [roadmap.name]);

  const geometry = GEOMETRY[size];
  const { milestones, current } = roadmap;
  const allReached = milestones.every((milestone) => milestone.word === 'reached');
  // The stations, then the ghost when there is nothing left to travel to, then the flag: even spacing.
  const columns = milestones.length + (allReached ? 1 : 0) + 1;
  const centre = (index: number) => ((index + 0.5) / columns) * 100;
  const ghostLabel = t(milestones.length === 0 ? 'roadmap.empty.noPath' : 'roadmap.empty.nextMilestone');

  // The solid rail runs from the track's left edge — the path comes from somewhere — to the current
  // station, else the last reached one. While a milestone moment plays it stops a station short and
  // the SVG line draws the last leg into the reached station.
  const momentIndex = milestones.findIndex((milestone) => milestone.name === active.milestone);
  const currentIndex = milestones.findIndex((milestone) => milestone.name === current);
  const travelled = currentIndex !== -1 ? centre(currentIndex) : milestones.length > 0 ? centre(milestones.length - 1) : 0;
  const drawFrom = momentIndex > 0 ? centre(momentIndex - 1) : 0;
  const focusedMilestone = milestones.find((milestone) => milestone.name === focused) ?? null;

  return (
    <div className="min-w-0" data-milestone-path={size}>
      {/* The bleed above and at the start is room INSIDE the scroller's clip for what a station draws
          outside its own box — the live halo, the bloom's rings, the focus ring — which a scroll
          container would cut flat; the negative margins give it back, so the path lies where it would. */}
      <div
        ref={trackRef}
        className={cn(
          'scrollbar-thin -mx-1.5 overflow-x-auto overflow-y-hidden px-1.5 max-md:snap-x max-md:snap-mandatory',
          size === 'full' ? '-mt-7 pb-1 pt-7' : '-mt-4 pb-0.5 pt-4',
        )}
      >
        <div className="relative" style={{ minWidth: `${columns * geometry.column}rem` }}>
          {/* The way still to go, dashed, from the track's left edge to the flag; the way travelled laid
              over it. Beside the list, never in it: a list holds stations and nothing else. */}
          <span aria-hidden="true" className={cn('pointer-events-none absolute left-0 border-t-2 border-dashed border-border', geometry.rail)} style={{ width: `${centre(columns - 1)}%` }} />
          <span aria-hidden="true" className={cn('pointer-events-none absolute left-0 h-0.5 bg-primary', geometry.rail)} style={{ width: `${momentIndex === -1 ? travelled : drawFrom}%` }} />
          {momentIndex !== -1 && (
            <svg aria-hidden="true" className={cn('pointer-events-none absolute h-0.5 overflow-visible text-primary', geometry.rail)} style={{ left: `${drawFrom}%`, width: `${centre(momentIndex) - drawFrom}%` }}>
              <line x1="0" y1="1" x2="100%" y2="1" stroke="currentColor" strokeWidth={2} pathLength={1} strokeDasharray={1} className="motion-safe:animate-roadmap-draw" />
            </svg>
          )}

          {/* `relative`, so the stations paint over the rail that runs behind them. */}
          <ol aria-label={t('roadmap.path.label')} className="relative grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {milestones.map((milestone, index) => {
              const standing = standingOf(milestone, current);
              const word = t(WORD_KEYS[milestone.word]);
              return (
                <li key={milestone.name} className="relative flex min-w-0 justify-center max-md:snap-center">
                  <button
                    type="button"
                    data-roadmap-milestone={milestone.name}
                    data-celebrating={index === momentIndex ? 'milestone' : undefined}
                    aria-label={t('roadmap.path.station', {
                      n: index + 1,
                      title: milestone.title,
                      word: milestone.blocked === null ? word : t('roadmap.path.wordBlocked', { word }),
                    })}
                    aria-pressed={milestone.name === focused}
                    aria-current={standing === 'current' ? 'step' : undefined}
                    title={size === 'compact' ? milestone.title : undefined}
                    onClick={() => onFocus(milestone.name)}
                    className={cn(
                      'flex min-w-0 flex-col items-center border text-center',
                      geometry.box,
                      milestone.name === focused ? 'border-primary/50 bg-primary/5' : 'border-transparent hover:bg-muted/60',
                    )}
                  >
                    <span className={cn('flex items-center justify-center', geometry.row)}>
                      <Disc standing={standing} size={size} blooming={index === momentIndex} />
                    </span>
                    {size === 'full' && <StationWords milestone={milestone} word={word} />}
                  </button>
                </li>
              );
            })}
            {allReached && (
              <GhostStation
                size={size}
                label={ghostLabel}
                onAdd={() => {}} // FILL: onAddMilestone — ItemDialog adding a milestone (kind milestone, parent roadmap.name), through the dialog host's opener
              />
            )}
            <GoalFlag size={size} />
          </ol>
        </div>
      </div>

      {/* The compact path names one station: the one on the stage, with its own line beside its title. */}
      {size === 'compact' && (
        <p className="mt-1 flex min-w-0 items-baseline gap-1.5 text-sm">
          {focusedMilestone ? (
            <>
              <span className="truncate font-medium text-foreground">{focusedMilestone.title}</span>
              <StationLine milestone={focusedMilestone} word={t(WORD_KEYS[focusedMilestone.word])} className="shrink-0" />
            </>
          ) : (
            <span className="truncate text-muted-foreground">{ghostLabel}</span>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * A station's mark. Reached is a filled accent disc with a check; current an accent ring with a heart
 * that breathes on `live-ring`; moving (on its way, not current) the ring without the heart; ahead a
 * hollow disc. Each sits on the card's ground, so the rail behind it stops at its edge. A blooming disc
 * swells and settles one size up (`scale-110` holds that size once the keyframe ends), with its rings.
 */
function Disc({ standing, size, blooming }: { standing: Standing; size: Size; blooming: boolean }) {
  const { disc, mark } = GEOMETRY[size];
  return (
    <span aria-hidden="true" className="relative grid place-items-center">
      {blooming && BLOOM_RINGS.map((ring) => (
        <span key={ring} className={cn('pointer-events-none absolute inset-0 rounded-full motion-safe:animate-roadmap-ring', ring)} />
      ))}
      <span
        className={cn(
          'relative grid place-items-center rounded-full motion-safe:transition-transform motion-safe:duration-move',
          disc,
          standing === 'reached' && 'bg-primary text-primary-foreground',
          standing === 'current' && 'border-2 border-primary bg-card motion-safe:animate-live-ring',
          standing === 'moving' && 'border-2 border-primary bg-card',
          standing === 'ahead' && 'border-2 border-input bg-card',
          blooming && 'scale-110 motion-safe:animate-roadmap-bloom',
        )}
      >
        {standing === 'reached' && <Check className={mark} strokeWidth={3} />}
        {standing === 'current' && <span className={cn('rounded-full bg-primary', size === 'full' ? 'size-2.5' : 'size-1.5')} />}
      </span>
    </span>
  );
}

/** A full station's words: its title on two lines at most, then its line, then "Blocked" in amber when it is. */
function StationWords({ milestone, word }: { milestone: RoadmapMilestone; word: string }) {
  const { t } = useTranslation();
  return (
    <>
      <span className="line-clamp-2 break-words text-[13px] font-medium leading-snug text-foreground">{milestone.title}</span>
      <StationLine milestone={milestone} word={word} className="mt-0.5" />
      {milestone.blocked !== null && <span className="mt-0.5 text-xs font-medium text-warn-ink">{t('roadmap.path.blocked')}</span>}
    </>
  );
}

/** "reached <date>" in the accent's ink once reached, "<shipped> of <features> features" while it moves, else its word. */
function StationLine({ milestone, word, className }: { milestone: RoadmapMilestone; word: string; className: string }) {
  const { t } = useTranslation();
  const date = formatShortDate(milestone.reached_at);
  if (milestone.word === 'reached') {
    return <span className={cn('text-xs text-accent-ink', className)}>{date === null ? word : t('roadmap.path.reachedOn', { date })}</span>;
  }
  const { shipped, features } = milestone.standing;
  return (
    <span className={cn('text-xs tabular-nums text-muted-foreground', className)}>
      {milestone.word === 'in progress' ? t('roadmap.path.features', { shipped, count: features }) : word}
    </span>
  );
}

/**
 * The station after the last, while every milestone is reached: a dashed disc with a plus, and the words
 * that say what pressing it does. Compact, the words are its name alone.
 */
function GhostStation({ size, label, onAdd }: { size: Size; label: string; onAdd: () => void }) {
  const geometry = GEOMETRY[size];
  return (
    <li className="relative flex min-w-0 justify-center max-md:snap-center">
      <button
        type="button"
        data-roadmap-ghost
        aria-label={size === 'compact' ? label : undefined}
        onClick={onAdd}
        className={cn('group flex min-w-0 flex-col items-center border border-transparent text-center hover:bg-muted/60', geometry.box)}
      >
        <span className={cn('flex items-center justify-center', geometry.row)}>
          <span className={cn('grid place-items-center rounded-full border-2 border-dashed border-input bg-card text-muted-foreground group-hover:border-primary group-hover:text-accent-ink', geometry.disc)}>
            <Plus aria-hidden="true" className={geometry.mark} strokeWidth={2.5} />
          </span>
        </span>
        {size === 'full' && <span className="text-balance text-[13px] font-medium leading-snug text-accent-ink">{label}</span>}
      </button>
    </li>
  );
}

/**
 * The destination: a flag labelled Goal, in the display serif the goal itself is set in. Not a button —
 * the goal is not a place the stage can show. Its transparent border sits its disc on the stations' line.
 */
function GoalFlag({ size }: { size: Size }) {
  const { t } = useTranslation();
  return (
    <li className={cn('relative flex min-w-0 flex-col items-center border border-transparent text-center', size === 'full' && 'px-2 pb-2.5')} data-roadmap-goal-flag>
      <span className={cn('flex items-center justify-center', GEOMETRY[size].row)}>
        <span className={cn('grid place-items-center rounded-full border-2 border-foreground bg-card text-foreground', size === 'full' ? 'size-8' : 'size-5')}>
          <Flag aria-hidden="true" className={size === 'full' ? 'size-4' : 'size-3'} strokeWidth={2.25} />
        </span>
      </span>
      <span className={cn('font-serif leading-tight text-foreground', size === 'full' ? 'text-lg' : 'sr-only')}>{t('roadmap.path.goalFlag')}</span>
    </li>
  );
}
