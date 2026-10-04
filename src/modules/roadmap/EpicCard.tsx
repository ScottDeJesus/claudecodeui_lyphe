import { Ban, Check, CircleCheck, FolderInput, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useContext, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { FAKE_CELEBRATION_CONTEXT, fakeSortable } from '@/modules/roadmap/fake'; // FILL: fake — import { CelebrationContext } from '@/modules/roadmap/celebrationContext'; import { useRoadmapWrites } from '@/modules/roadmap/hooks/useRoadmapWrites'; import { useSortable } from '@/shared/ui/sortable/useSortable'; and the dialog host's opener
import { FeatureRow } from '@/modules/roadmap/FeatureRow';
import type { RoadmapEpic, RoadmapEpicWord, RoadmapFeature } from '@/shared/roadmap-types';
import type { Tone } from '@/shared/types';
import { ActionMenu, Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** Each epic word's key in the locale. */
const WORD_KEYS: Record<RoadmapEpicWord, string> = {
  empty: 'roadmap.epicWord.empty',
  'not started': 'roadmap.epicWord.notStarted',
  'in progress': 'roadmap.epicWord.inProgress',
  complete: 'roadmap.epicWord.complete',
};

/** The badge each word wears: positive for done, info while moving, neutral before anything moved. */
const WORD_TONES: Record<RoadmapEpicWord, Tone> = {
  empty: 'neutral',
  'not started': 'neutral',
  'in progress': 'info',
  complete: 'positive',
};

/** The ring's radius in its 44-unit box, inside a stroke of 4. */
const RING_R = 19;

/** The three celebration tones a particle is painted in, dealt round in turn. */
const PARTICLE_TONES = ['bg-primary', 'bg-warn-ink', 'bg-accent-ink'] as const;

/**
 * Where each of the epic moment's sixteen particles lands, from the ring's centre: a compass of 22.5°
 * steps at three reaches, so the burst is round without reading as a wheel. Position data only — a
 * particle's colour is its Tailwind tone.
 */
const BURST = Array.from({ length: 16 }, (_, index) => {
  const angle = (index / 16) * 2 * Math.PI - Math.PI / 2;
  const reach = [58, 76, 66][index % 3];
  return {
    dx: `${Math.round(Math.cos(angle) * reach)}px`,
    dy: `${Math.round(Math.sin(angle) * reach)}px`,
    tone: PARTICLE_TONES[index % PARTICLE_TONES.length],
  };
});

/** A point of the ring at `share` of the way round (0 is twelve o'clock once the svg turns −90°). */
function ringPoint(share: number): string {
  const angle = share * 2 * Math.PI;
  return `${(22 + RING_R * Math.cos(angle)).toFixed(3)} ${(22 + RING_R * Math.sin(angle)).toFixed(3)}`;
}

/**
 * The epic's completion ring, shipped over features, read before a word: a track, the share shipped
 * in accent on top of it, and a check at the centre once every feature has shipped. While the epic
 * moment plays, the last feature's share is its OWN arc, drawn on `roadmap-draw` (`pathLength` 1 and a
 * dash of 1, as the animation's comment asks); a one-feature epic's last share is the whole ring. The
 * burst leaves from its centre. Decorative to a screen reader: the head spells the same count.
 */
function CompletionRing({ shipped, features, moment }: { shipped: number; features: number; moment: boolean }) {
  const share = features === 0 ? 0 : shipped / features;
  const before = moment && features > 0 ? Math.max(0, shipped - 1) / features : share;
  const stroke = { cx: 22, cy: 22, r: RING_R, fill: 'none', stroke: 'currentColor', strokeWidth: 4 };
  return (
    <span className="relative grid size-11 shrink-0 place-items-center">
      <svg viewBox="0 0 44 44" aria-hidden="true" className="size-11 -rotate-90">
        <circle {...stroke} className="text-border" />
        {before > 0 && <circle {...stroke} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - before} className="text-primary" />}
        {moment && share > before && (share - before >= 1 ? (
          <circle {...stroke} strokeLinecap="round" pathLength={1} strokeDasharray={1} className="text-primary motion-safe:animate-roadmap-draw" />
        ) : (
          <path
            d={`M ${ringPoint(before)} A ${RING_R} ${RING_R} 0 ${share - before > 0.5 ? 1 : 0} 1 ${ringPoint(share)}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={4}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
            className="text-primary motion-safe:animate-roadmap-draw"
          />
        ))}
      </svg>
      {share === 1 && <Check aria-hidden="true" className="absolute size-4 text-primary" strokeWidth={3} />}
      {moment && BURST.map((particle, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={cn('pointer-events-none absolute left-1/2 top-1/2 z-10 -ml-1 -mt-1 size-2 rounded-full motion-safe:animate-roadmap-burst motion-reduce:hidden', particle.tone)}
          style={{ '--dx': particle.dx, '--dy': particle.dy } as CSSProperties}
        />
      ))}
    </span>
  );
}

/** The epic's goal as one line: a blockquote's `>` markers off and its lines run together, since the dialog holds the whole of it. */
function oneLine(goal: string): string {
  return goal.replace(/^\s*>\s?/gm, '').replace(/\s+/g, ' ').trim();
}

/**
 * One epic as a card: its completion ring, its title, how many of its features have shipped, its word
 * and its menu; under that head why it is blocked, whole; its goal in a line; and its features as rows
 * the operator drags into order, then "Add a feature". Used by `MilestoneFocus`, one card a cell of its grid.
 *
 * THE EPIC MOMENT is the card's own: the ring's last share draws itself, the card lifts 4px onto
 * `shadow-lg` (`.vv-card`'s own transition, cut to 300ms), sixteen particles burst from the ring, and an
 * "Epic complete" ribbon pops onto the card's top edge. Under reduced motion it is still — no lift, no
 * burst, the ring drawn — and the card holds a wash under its ribbon for as long as the moment is named.
 */
export function EpicCard({ epic }: { epic: RoadmapEpic }) {
  const { t } = useTranslation();
  const active = useContext(FAKE_CELEBRATION_CONTEXT); // FILL: active — useContext(CelebrationContext)
  // FILL: writes — const writes = useRoadmapWrites(); Unblock and the rows' drops write through it
  // FILL: dialogs — the dialog host's opener (RoadmapPath provides it): Add a feature, Edit, Move and Mark blocked open a dialog; Delete opens its confirm
  const moment = active.epics.has(epic.name);
  const { features, shipped } = epic.standing;

  const keys = useMemo(() => epic.features.map((item) => item.name), [epic.features]);
  const byName = useMemo(() => new Map(epic.features.map((item) => [item.name, item])), [epic.features]);
  const { order, attachList, itemProps } = fakeSortable(keys); // FILL: sortable — useSortable({ keys, onReorder: (carried, order) => writes.move({ kind: 'plan', name: carried, before: order[i + 1] } or { after: order[i - 1] }, itemTitle) }); this list sits inside one of MilestoneFocus's items — the nested press, and its cure at the source, are in that file's sortable marker
  const rows = order.flatMap((name) => byName.get(name) ?? []);

  const openFeature = (_feature: RoadmapFeature) => {}; // FILL: onOpenFeature — FeatureDialog on this feature

  const items: ActionMenuItem[] = [
    { key: 'add-feature', label: t('roadmap.menu.addFeature'), icon: Plus, onSelect: () => {} }, // FILL: onAddFeature — ItemDialog adding a feature (kind plan, parent epic.name)
    { key: 'edit', label: t('roadmap.menu.edit'), icon: Pencil, onSelect: () => {} }, // FILL: onEdit — ItemDialog editing this epic (kind arc)
    { key: 'move', label: t('roadmap.menu.moveToMilestone'), icon: FolderInput, onSelect: () => {} }, // FILL: onMove — MoveDialog for this epic, its milestones to choose from
    epic.blocked === null
      ? { key: 'block', label: t('roadmap.menu.markBlocked'), icon: Ban, onSelect: () => {} } // FILL: onBlock — BlockDialog for this epic (kind arc)
      : { key: 'unblock', label: t('roadmap.menu.unblock'), icon: CircleCheck, onSelect: () => {} }, // FILL: onUnblock — writes.unblock({ kind: 'arc', name: epic.name, itemTitle: epic.title })
    // An epic is deleted only once it holds no feature: the store refuses the rest, so the menu never offers it.
    ...(epic.features.length === 0
      ? [{ key: 'delete', label: t('roadmap.menu.delete'), icon: Trash2, isDanger: true, showDividerBefore: true, onSelect: () => {} }] // FILL: onDelete — the delete confirm, then writes.remove({ kind: 'arc', name: epic.name, itemTitle: epic.title })
      : []),
  ];

  return (
    <Card
      data-roadmap-epic={epic.name}
      data-celebrating={moment ? 'epic' : undefined}
      className={cn('relative flex h-full min-w-0 flex-col duration-300', moment && 'z-10 motion-safe:-translate-y-1 motion-safe:shadow-lg')}
    >
      {moment && <span aria-hidden="true" className="pointer-events-none absolute inset-0 hidden rounded-[inherit] bg-primary/10 motion-reduce:block" />}
      {moment && (
        <Badge tone="positive" className="absolute inset-x-0 -top-3 z-20 mx-auto w-fit motion-safe:animate-roadmap-pop">
          <Check aria-hidden="true" className="mr-1 size-3" strokeWidth={3} />
          {t('roadmap.celebrate.epicComplete')}
        </Badge>
      )}

      <CardHeader className="flex-row items-start gap-3 space-y-0 pb-2">
        <CompletionRing shipped={shipped} features={features} moment={moment} />
        <div className="min-w-0 flex-1 pt-0.5">
          <CardTitle className="text-base leading-snug">{epic.title}</CardTitle>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
            {features > 0 && <span className="text-xs tabular-nums text-muted-foreground">{t('roadmap.epic.count', { shipped, count: features })}</span>}
            <Badge tone={WORD_TONES[epic.word]}>{t(WORD_KEYS[epic.word])}</Badge>
          </div>
        </div>
        <ActionMenu
          label={t('roadmap.menu.actions', { title: epic.title })}
          items={items}
          icon={MoreHorizontal}
          iconOnly
          variant="ghost"
          size="icon"
          className="-mr-1.5 -mt-1"
          triggerClassName="h-8 w-8"
        />
      </CardHeader>

      {/* Why it is blocked, whole, on a line of its own: nowhere else on the screen shows an epic's reason, and
          the head's middle column is too narrow to hold one. A warn sentence is a soft block that wraps. */}
      {epic.blocked !== null && (
        <div className="px-4 pb-2">
          <Badge tone="warn" title={epic.blocked} className="max-w-full rounded-lg text-left leading-snug">
            <span className="line-clamp-3 break-words">{t('roadmap.blocked', { why: epic.blocked })}</span>
          </Badge>
        </div>
      )}

      {epic.goal && <p className="truncate px-4 pb-2 text-sm text-muted-foreground">{oneLine(epic.goal)}</p>}

      <CardContent className="flex flex-1 flex-col gap-1 pt-1">
        {/* An empty epic lists nothing: its word badge already says "No features yet", and its one press is below. */}
        {rows.length > 0 && (
          <ul ref={attachList} className="-mx-2.5 flex flex-col">
            {rows.map((item) => (
              <li key={item.name} {...itemProps(item.name)}>
                <FeatureRow feature={item} onOpen={openFeature} density="full" />
              </li>
            ))}
          </ul>
        )}
        <Button variant="ghost" size="sm" className="-ml-3 mt-auto self-start" onClick={() => { /* FILL: onAddFeature — ItemDialog adding a feature (kind plan, parent epic.name) */ }}>
          <Plus aria-hidden="true" />
          {t('roadmap.menu.addFeature')}
        </Button>
      </CardContent>
    </Card>
  );
}
