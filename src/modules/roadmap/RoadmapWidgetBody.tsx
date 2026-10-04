import { ArrowRight, Milestone, Plus, Route } from 'lucide-react';
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { CelebrationContext } from '@/modules/roadmap/celebrationContext';
import { CelebrationLayer } from '@/modules/roadmap/CelebrationLayer';
import { RoadmapFaceContext } from '@/modules/roadmap/faceContext';
import type { FaceDialog, RoadmapFace } from '@/modules/roadmap/faceContext';
import { FeatureRow } from '@/modules/roadmap/FeatureRow';
import { useCelebrations } from '@/modules/roadmap/hooks/useCelebrations';
import { useMilestoneMomentInView } from '@/modules/roadmap/hooks/useMilestoneMomentInView';
import { useRevealCard } from '@/modules/roadmap/hooks/useRevealCard';
import { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
import { MilestonePath } from '@/modules/roadmap/MilestonePath';
import { OpenDialog } from '@/modules/roadmap/modals/OpenDialog';
import { railSections } from '@/modules/roadmap/railSections';
import { RoadmapPicker } from '@/modules/roadmap/RoadmapPicker';
import { playingMilestone } from '@/modules/roadmap/utils/celebrationMoments';
import { ROADMAP_LANDING_PARAM, ROADMAP_MILESTONE_WORD_KEYS } from '@/shared/constants';
import type { RoadmapFeature, RoadmapMilestone } from '@/shared/roadmap-types';
import { Badge, Button, EmptyState, Meter, ScrollArea, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** The four sections, in the order they are read: what the operator owes, what is moving, what comes next, what is held. */
type SectionKey = 'waiting' | 'inFlight' | 'next' | 'blocked';

/**
 * Each section's heading (the rail's own words), whether it is the operator's to act on (amber), and how many
 * rows it lists before it counts the rest. What he owes is listed whole, so every Answer stays one press away;
 * of the rest a column glanced at while working holds the next few — five in flight, three up next, and the
 * first of what is blocked, whose row carries its reason.
 */
const SECTIONS: { key: SectionKey; heading: string; warn: boolean; limit: number }[] = [
  { key: 'waiting', heading: 'roadmap.rail.waiting', warn: true, limit: Number.POSITIVE_INFINITY },
  { key: 'inFlight', heading: 'roadmap.rail.inFlight', warn: false, limit: 5 },
  { key: 'next', heading: 'roadmap.rail.next', warn: false, limit: 3 },
  { key: 'blocked', heading: 'roadmap.rail.blocked', warn: true, limit: 1 },
];

/** One section as drawn: the rows within its limit and how many it leaves to its count. */
type DrawnSection = (typeof SECTIONS)[number] & { features: RoadmapFeature[]; more: number };

/**
 * THE ROADMAP AT A COLUMN'S WIDTH: the chat gutter's Roadmap widget, the roadmap the Roadmap tab shows, built
 * from the tab's own pieces. Top to bottom: the picker, the goal in the display serif (two lines at most, or the
 * press that writes it), the stations on the compact path with the current one breathing, the focused
 * milestone's line over a meter of its features shipped, then Waiting on you, In flight, Next up and Blocked —
 * each section hidden when empty, cut at its limit with a count of the rest — and "Open the roadmap" at the foot.
 *
 * ONE ROADMAP ON SCREEN EVERYWHERE. The picker writes the selection the tab's picker writes, so a pick here is a
 * pick on the tab, on every device. A station pressed here puts its milestone in focus HERE only: the tab keeps
 * its own stage. A row opens the feature's dialog over the chat. Its Answer and "Open the roadmap" are landings
 * (`?runner=<plan>`, `?roadmap=<name>`), because the gutter has no hold on which tab the workspace shows.
 *
 * THE WIDGET'S BOX IS THE CELEBRATIONS' BOX, as the face's is on the tab. The root is the box the reader sees:
 * it scrolls its own content, so the gutter draws it `flush`, and `useCelebrations` watches it — a moment plays
 * only while it is on screen, and a moment the tab already played is never played here. `CelebrationLayer`
 * covers it at `frame` scope as its last child, outside the scroller, so the milestone's banner centres in what
 * the reader sees and the burst leaves from the station.
 *
 * The roadmap is the account's and not the chat's, so the chat's id the gutter hands every body is not read.
 * `data-roadmap-widget` is the root's handle; `data-roadmap-widget-goal`, `-focus`, `-section`, `-next`, `-quiet` and
 * `-open` its parts'.
 *
 * Used by `src/modules/chat-gutters` (`ChatGutterLayout`), through the roadmap barrel, as the Roadmap widget's body.
 */
export function RoadmapWidgetBody() {
  const { t } = useTranslation();
  const { picture, selected } = useRoadmap();
  // The box the reader sees: the moments play only while it is on screen, and the milestone's layer covers it.
  const rootRef = useRef<HTMLDivElement>(null);
  // The widget's scroller: a milestone moment brings the path back into it before it plays.
  const scrollRef = useRef<HTMLDivElement>(null);
  const { moment, skip, active } = useCelebrations(selected, rootRef);
  useMilestoneMomentInView(moment, scrollRef);
  // The one dialog open over the chat, or null: a dialog is modal, so never two, and only a press says which.
  // `openDialog` is its setter under the face's name for it; stable, so the face below keeps its identity.
  const [dialog, setDialog] = useState<FaceDialog | null>(null);
  const openDialog = setDialog;
  // The milestone whose station was pressed HERE, null until a press: the tab keeps its own stage, so this is the widget's alone.
  const [pressed, setPressed] = useState<string | null>(null);
  const focus = useCallback((name: string) => setPressed(name), []);
  // Read HERE, above this body's own provider, where no tab is above and `openCard` is null: the module's one `?runner=<plan>` landing.
  const reveal = useRevealCard();
  const openFeature = (feature: RoadmapFeature) => openDialog({ dialog: 'feature', name: feature.name });
  const writeGoal = () => { if (selected !== null) openDialog({ dialog: 'edit', kind: 'roadmap', item: selected, goalFirst: true }); };
  const startRoadmap = () => openDialog({ dialog: 'add', kind: 'roadmap', parent: null });
  const addMilestone = () => { if (selected !== null) openDialog({ dialog: 'add', kind: 'milestone', parent: selected }); };
  const [, setSearchParams] = useSearchParams();
  const openRoadmap = () => { if (selected !== null) setSearchParams({ [ROADMAP_LANDING_PARAM]: selected.name }, { replace: true }); };

  // What every press under the widget reaches: the picker's New roadmap… and the ghost station open their dialog
  // here, and a station focuses this widget's own path. No card opener: no tab is above the gutter, so a row's
  // Answer goes through `useRevealCard` to the workspace's `?runner=` landing, the module's one writer of it.
  const face = useMemo<RoadmapFace>(() => ({ openDialog, openCard: null, focus }), [openDialog, focus]);

  // The focused milestone, outlined on the path and named under it: the one a moment is playing on — the face's
  // own rule, so its feature, epic and milestone moments are told on the milestone they belong to even after
  // `current` has moved past it — else the one pressed here, else the one the roadmap is travelling to, else the
  // last, so a roadmap whose every milestone is reached rests on the one it reached last.
  const milestones = selected?.milestones ?? [];
  const focused = playingMilestone(milestones, active)
    ?? milestones.find((item) => item.name === pressed)
    ?? milestones.find((item) => item.name === selected?.current)
    ?? milestones.at(-1)
    ?? null;
  const loading = picture === null || (picture.roadmaps.length > 0 && selected === null);

  const sections = selected === null ? null : railSections(selected);
  // Each section cut at its limit, in reading order. Blocked lists first what no section above has drawn — the
  // one feature the others never hold twice — so its row is never the row the reader just passed, saying the
  // same reason again; its heading still counts every blocked feature.
  const drawnAbove = new Set<string>();
  const drawn: DrawnSection[] = [];
  for (const section of SECTIONS) {
    const all = sections?.[section.key] ?? [];
    const ordered = section.key === 'blocked' ? [...all].sort((a, b) => Number(drawnAbove.has(a.name)) - Number(drawnAbove.has(b.name))) : all;
    const features = ordered.slice(0, section.limit);
    features.forEach((feature) => drawnAbove.add(feature.name));
    if (features.length > 0) drawn.push({ ...section, features, more: all.length - features.length });
  }

  return (
    <RoadmapFaceContext.Provider value={face}>
      <CelebrationContext.Provider value={active}>
        <div ref={rootRef} data-roadmap-widget className="relative flex h-full min-h-0 flex-col">
          {loading ? (
            <div className="grid flex-1 place-items-center p-6">
              <Spinner size={32} label={t('roadmap.loading')} />
            </div>
          ) : selected === null ? (
            <div className="flex flex-1 items-center p-3">
              <div className="w-full">
                <EmptyState icon={Route} title={t('roadmap.empty.none')} message={t('roadmap.empty.noneMessage')} actionLabel={t('roadmap.picker.new')} onAction={startRoadmap} />
              </div>
            </div>
          ) : (
            <>
              <ScrollArea ref={scrollRef} className="min-h-0 flex-1">
                <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-5 p-3">
                  <div className="flex min-w-0 flex-col gap-3">
                    <RoadmapPicker size="sm" />
                    {/* A size and its leading are ONE class: `cn` drops a `leading-*` spelled before a later size. */}
                    {selected.goal ? (
                      <h2 data-roadmap-widget-goal title={selected.goal} className="line-clamp-2 text-balance break-words font-serif text-xl/tight font-normal text-foreground">
                        {selected.goal}
                      </h2>
                    ) : (
                      <h2 className="font-normal">
                        <button
                          type="button"
                          onClick={writeGoal}
                          className="text-left font-serif text-xl/tight italic text-muted-foreground underline decoration-border decoration-dashed decoration-1 underline-offset-4 hover:text-foreground"
                        >
                          {t('roadmap.goal.missing')}
                        </button>
                      </h2>
                    )}
                  </div>

                  {/* No milestone yet: no path to draw, so the widget says how to start one, as the tab's stage does. */}
                  {focused === null ? (
                    <EmptyState icon={Milestone} title={t('roadmap.empty.noPath')} actionLabel={t('roadmap.menu.addMilestone')} onAction={addMilestone} />
                  ) : (
                    <div className="flex min-w-0 flex-col gap-2.5">
                      <MilestonePath roadmap={selected} focused={focused.name} onFocus={focus} size="compact" />
                      <FocusLine milestone={focused} n={milestones.indexOf(focused) + 1} />
                    </div>
                  )}

                  {drawn.map((section) => <Section key={section.key} section={section} onOpen={openFeature} />)}
                  {/* Nothing in any section: the widget says so rather than end on a meter over blank card. Every
                      milestone reached is the one such state with a way on, so it is said as the press that adds
                      the next, the ghost station's own words beside the ghost's own dashed disc. */}
                  {focused !== null && drawn.length === 0 && (selected.word === 'every milestone reached' ? (
                    <button
                      type="button"
                      data-roadmap-widget-next
                      onClick={addMilestone}
                      className="group -mx-2 flex items-center gap-2.5 self-start rounded-lg px-2 py-1.5 text-left text-sm font-medium text-accent-ink hover:bg-muted/60"
                    >
                      <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full border-2 border-dashed border-input group-hover:border-primary">
                        <Plus className="size-3" strokeWidth={2.5} />
                      </span>
                      {t('roadmap.empty.nextMilestone')}
                    </button>
                  ) : (
                    <p data-roadmap-widget-quiet className="text-sm text-muted-foreground">{t('roadmap.widget.quiet')}</p>
                  ))}
                </div>
              </ScrollArea>

              {/* The way to the whole roadmap, always in view: the foot stays put while the content scrolls. */}
              <div className="shrink-0 border-t border-border">
                <div className="mx-auto max-w-2xl px-1.5 py-1">
                  <Button variant="link" size="sm" data-roadmap-widget-open className="h-8 gap-1.5 px-1.5 text-accent-ink" onClick={openRoadmap}>
                    {t('roadmap.widget.open')}
                    <ArrowRight aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* A feature dialog's Open its card and Answer close it BEFORE they land: this gutter stays mounted behind `hidden` under the tab the landing brings forward, and a dialog is a portal no hidden pane hides. */}
          {dialog !== null && <OpenDialog dialog={dialog} onClose={() => setDialog(null)} onOpenCard={(plan) => { setDialog(null); reveal(plan); }} />}
          <CelebrationLayer moment={moment} onSkip={skip} scope="frame" />
        </div>
      </CelebrationContext.Provider>
    </RoadmapFaceContext.Provider>
  );
}

/**
 * The focused station's caption, right under the rail (the compact path draws discs alone): "Milestone 3 ·
 * <title> · 1 of 3 epics complete", over the meter of its features shipped — the same inline register as a
 * row's meter of its tasks — and why it is held, when it is blocked: whole, in an amber block that wraps,
 * because a station's press only moves focus, so a reason cut to one line would have nothing to open it. A
 * milestone with no epic yet says its word in place of the count and draws no meter: nothing to measure yet.
 */
function FocusLine({ milestone, n }: { milestone: RoadmapMilestone; n: number }) {
  const { t } = useTranslation();
  const { epics, complete, features, shipped } = milestone.standing;
  const line = epics === 0
    ? t('roadmap.widget.focusWord', { n, title: milestone.title, word: t(ROADMAP_MILESTONE_WORD_KEYS[milestone.word]) })
    : t('roadmap.widget.focus', { n, title: milestone.title, complete, count: epics });
  return (
    <div data-roadmap-widget-focus={milestone.name} className="flex min-w-0 flex-col gap-1.5">
      <p className="text-[13px] font-medium leading-snug text-foreground">{line}</p>
      {features > 0 && (
        <Meter
          variant="inline"
          percent={Math.round((shipped / features) * 100)}
          label={t('roadmap.word.shipped')}
          value={t('roadmap.path.features', { shipped, count: features })}
        />
      )}
      {milestone.blocked !== null && (
        <div className="flex min-w-0">
          <Badge tone="warn" className="min-w-0 max-w-full rounded-lg text-left leading-snug">
            {t('roadmap.blocked', { why: milestone.blocked })}
          </Badge>
        </div>
      )}
    </div>
  );
}

/** One section: its heading with its whole count, its rows up to its limit, then how many more it holds. */
function Section({ section, onOpen }: { section: DrawnSection; onOpen: (feature: RoadmapFeature) => void }) {
  const { t } = useTranslation();
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-roadmap-widget-section={section.key}>
      <h3
        id={headingId}
        className={cn('flex items-baseline gap-2 text-xs font-medium uppercase tracking-[0.14em]', section.warn ? 'text-warn-ink' : 'text-muted-foreground')}
      >
        {t(section.heading)}
        <span className="tabular-nums">{section.features.length + section.more}</span>
      </h3>
      <ul className="-mx-2 mt-1.5 flex flex-col gap-0.5">
        {section.features.map((feature) => (
          <li key={feature.name}>
            <FeatureRow feature={feature} onOpen={onOpen} density="compact" />
          </li>
        ))}
      </ul>
      {section.more > 0 && <p className="mt-1 text-xs tabular-nums text-muted-foreground">{t('roadmap.widget.more', { count: section.more })}</p>}
    </section>
  );
}
