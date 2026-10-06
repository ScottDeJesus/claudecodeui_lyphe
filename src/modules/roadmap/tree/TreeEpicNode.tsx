import { useContext, useId } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { CelebrationContext } from '@/modules/roadmap/celebrationContext';
import type { CelebrationActive } from '@/modules/roadmap/celebrationContext';
import { TreeDotCut, TreeHalo } from '@/modules/roadmap/tree/TreeHalo';
import { TreeRing } from '@/modules/roadmap/tree/TreeRing';
import type { TreeEpicSpot } from '@/modules/roadmap/utils/treeLayout';
import { ROADMAP_DOT_PAINT, ROADMAP_EPIC_WORD_KEYS } from '@/shared/constants';
import { cn } from '@/shared/utils';

/** A feature's dot, and the invisible circle round it that takes its presses: r 4 fills the dots' 8-unit pitch. */
const DOT_R = 2.8;
const DOT_HIT_R = 4;

/** The three celebration inks a particle is painted in, dealt round in turn. */
const PARTICLE_TONES = ['fill-primary', 'fill-warn-ink', 'fill-accent-ink'] as const;

/** A particle's radius, in the drawing's units. */
const PARTICLE_R = 3;

/**
 * Where each of the epic moment's twelve particles lands, from the ring's centre: a compass of 30° steps at
 * three reaches, so the burst is round without reading as a wheel. Position data only, set inline as
 * `--dx`/`--dy` for `roadmap-burst`; a particle's colour is its Tailwind fill.
 */
const BURST = Array.from({ length: 12 }, (_, index) => {
  const angle = (index / 12) * 2 * Math.PI;
  const reach = [44, 58, 51][index % 3];
  return {
    dx: `${Math.round(Math.sin(angle) * reach)}px`,
    dy: `${Math.round(-Math.cos(angle) * reach)}px`,
    tone: PARTICLE_TONES[index % PARTICLE_TONES.length],
  };
});

/** The moment a feature's dot plays: its feature shipped, one of its tasks got done, or neither. */
function dotMomentOf(active: CelebrationActive, feature: string): 'feature' | 'task' | undefined {
  if (active.features.has(feature)) return 'feature';
  return active.tasks.has(feature) ? 'task' : undefined;
}

type TreeEpicNodeProps = {
  spot: TreeEpicSpot;
  /** The epic is what the tree has selected. */
  selected: boolean;
  /** The name of the feature the tree has selected, when it is one of this epic's; its dot wears the halo. */
  selectedFeature: string | null;
  /** The words the tip says of the epic, as one line: the node's accessible name. */
  label: string;
};

/**
 * One epic's row on its milestone's spine: its completion ring (r 17, stroke 2.5) with "shipped/total" inside
 * at 10px, or "–" in a dashed ring while it holds no feature; its title to the right in the layout's two
 * lines (11.5px, `--ink`); a dot per feature under the title, wrapping at fourteen, each painted from
 * `ROADMAP_DOT_PAINT` by the state the layout gave it; and its line, "<word> · x of y shipped" (10px), or the
 * word alone while it is empty. The whole row pulses on Verve's `vv-pulse` while a feature of it is in flight.
 *
 * It is a button (`data-tree-key="epic:<name>"`, Enter or Space selects it). Each dot is a group of its own
 * (`data-tree-key="feature:<name>"`), so a press on a dot selects the feature, not this epic: first an invisible
 * hit circle, then the visible dot, which is the topmost element at its own centre. Dots are not tab stops;
 * the keyboard reaches a feature through its epic's panel. The halo of a selected (or reduced-motion
 * celebrating) dot is drawn after every dot, so its neighbours never paint over it, and the dots that wear no
 * halo take its cut-out (`TreeDotCut`) as their mask, so the neighbours it passes over are cut back to the ground.
 *
 * THE EPIC MOMENT: the ring's last share draws itself and the ring blooms, and twelve particles burst from its
 * centre (`roadmap-burst`, in the accent, the gold and the accent's deep green in turn). A FEATURE or TASK moment
 * blooms that feature's dot. Under reduced motion nothing moves (no particle is drawn) and the halo holds a
 * solid accent ring round what the moment names.
 *
 * Used by the roadmap module's tree, `tree/RoadmapTree`, after its milestone's node.
 */
export function TreeEpicNode({ spot, selected, selectedFeature, label }: TreeEpicNodeProps) {
  const { t } = useTranslation();
  const active = useContext(CelebrationContext);
  const { epic, x, y, r, labelX } = spot;
  const moment = active.epics.has(epic.name);
  const { features, shipped, in_flight: inFlight } = epic.standing;
  const word = t(ROADMAP_EPIC_WORD_KEYS[epic.word]);
  // The dots that wear a halo: the selected one, and any a moment names (whose halo shows under reduced motion only).
  const haloed = spot.dots.filter((dot) => dot.feature.name === selectedFeature || dotMomentOf(active, dot.feature.name) !== undefined);
  // The cut-out those halos stand in: the epic's other dots take it as their mask while any dot wears a halo.
  const cutId = useId();
  const cut = haloed.length > 0 ? `url("#${cutId}")` : undefined;

  return (
    <g
      data-tree-key={`epic:${epic.name}`}
      data-roadmap-epic={epic.name}
      data-celebrating={moment ? 'epic' : undefined}
      data-selected={selected || undefined}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={label}
      // `outline-none` alone loses to tokens.css's `[tabindex]:focus-visible` outline (0,2,0); the halo is the ring.
      className={cn('group cursor-pointer outline-none focus-visible:outline-none', inFlight > 0 && 'vv-pulse')}
    >
      <TreeRing cx={x} cy={y} r={r} strokeWidth={2.5} shipped={shipped} total={features} moment={moment} />
      <TreeHalo cx={x} cy={y} r={r} mark="ring" selected={selected} celebrating={moment} />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        className={cn('pointer-events-none text-[10px] tabular-nums', features === 0 ? 'fill-muted-foreground' : 'fill-foreground')}
      >
        {features === 0 ? '–' : `${shipped}/${features}`}
      </text>
      {spot.titleLines.map((line, index) => (
        <text key={index} x={labelX} y={spot.titleBaselines[index]} className="fill-foreground text-[11.5px]">
          {line}
        </text>
      ))}
      {haloed.length > 0 && (
        <TreeDotCut
          id={cutId}
          dots={spot.dots}
          r={DOT_R}
          selected={haloed.find((dot) => dot.feature.name === selectedFeature) ?? null}
          celebrating={haloed.filter((dot) => dot.feature.name !== selectedFeature)}
        />
      )}
      {spot.dots.map((dot) => {
        const dotMoment = dotMomentOf(active, dot.feature.name);
        return (
          <g key={dot.feature.name} data-tree-key={`feature:${dot.feature.name}`}>
            <circle cx={dot.x} cy={dot.y} r={DOT_HIT_R} className="fill-none [pointer-events:all]" />
            <circle
              data-roadmap-feature={dot.feature.name}
              data-roadmap-dot={dot.state}
              data-celebrating={dotMoment}
              data-selected={dot.feature.name === selectedFeature || undefined}
              cx={dot.x}
              cy={dot.y}
              r={DOT_R}
              strokeWidth={1.2}
              mask={haloed.includes(dot) ? undefined : cut}
              style={ROADMAP_DOT_PAINT[dot.state]}
              className={cn('[transform-box:fill-box] origin-center', dotMoment !== undefined && 'motion-safe:animate-roadmap-bloom')}
            />
          </g>
        );
      })}
      <text x={labelX} y={spot.lineY} className="fill-muted-foreground text-[10px] tabular-nums">
        {features === 0 ? word : t('roadmap.tree.epicLine', { word, shipped, count: features })}
      </text>
      {haloed.map((dot) => (
        <TreeHalo
          key={dot.feature.name}
          cx={dot.x}
          cy={dot.y}
          r={DOT_R}
          mark="dot"
          selected={dot.feature.name === selectedFeature}
          celebrating={dotMomentOf(active, dot.feature.name) !== undefined}
        />
      ))}
      {moment && BURST.map((particle, index) => (
        <circle
          key={index}
          aria-hidden="true"
          cx={x}
          cy={y}
          r={PARTICLE_R}
          className={cn('pointer-events-none [transform-box:fill-box] origin-center motion-safe:animate-roadmap-burst motion-reduce:hidden', particle.tone)}
          style={{ '--dx': particle.dx, '--dy': particle.dy } as CSSProperties}
        />
      ))}
    </g>
  );
}
