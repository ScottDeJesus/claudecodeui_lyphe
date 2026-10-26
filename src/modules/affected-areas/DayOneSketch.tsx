import type { TFunction } from 'i18next';
import { DraftingCompass, Ruler } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DayOnePlan } from '@/modules/affected-areas/DayOnePlan';
import { DayOnePress } from '@/modules/affected-areas/DayOnePress';
import { DayOneRooms } from '@/modules/affected-areas/DayOneRooms';
import { listWords } from '@/modules/affected-areas/utils/tourModel';
import type { Codebook, DayOneFloor, Face, LayoutReadResult, LayoutStatus } from '@/shared/affected-areas-types';
import type { AffectedAreasTrouble, TourReaderProgress } from '@/shared/types';
import { EmptyState, SegmentedControl } from '@/shared/ui';
import { formatRelativeTime } from '@/shared/utils';

type DayOneSketchProps = {
  /** The tour's plan, one entry per floor (`TourDetail.dayOne`, or the open's rebuild's answer): empty while no plan is in force. */
  floors: DayOneFloor[];
  /** Where the tour's room-layout reads and its plan stand (`TourDetail.layout`, or the rebuild's answer); null when the engine said nothing. */
  layout: LayoutStatus | null;
  /** Each floor's drawing as a URL an `<img>` loads, by `drawingSha`: a sha absent while its bytes load, null where they did not arrive. */
  drawings: Record<string, string | null>;
  /** The open's one rebuild of a stale plan is out. */
  rebuilding: boolean;
  /** The kinds' labels; null until the codebook answers. */
  codebook: Codebook | null;
  /** The press's dry run on open, its lane fault, the walk, and what is left to read: `DayOnePress`'s own props. */
  dryRun: LayoutReadResult | null;
  pressTrouble: AffectedAreasTrouble | null;
  walk: TourReaderProgress;
  unreadPanos: number;
  unreadViews: number;
  onOpenPanoAt: (panoId: string, face: Face, regionId: string | null) => void;
  onOpenPano: (panoId: string) => void;
  onReadLayout: () => void;
  onStopLayout: () => void;
};

/** The house's section eyebrow (MAN-742): it names the section, and no state is said in it alone. */
const EYEBROW = 'text-xs uppercase tracking-[0.14em] text-ink-faint';

/** The drawing beside the room list from 720 px of panel, as the pano screen sets its photo beside its list (`PanoScreen`'s `COLUMNS`). */
const COLUMNS = 'grid items-start gap-5 [@container(min-width:720px)]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]';

/**
 * What the section's body draws: `plan` whenever a plan is in force (partial, built, or stale while it is redrawn);
 * `none` when no view has a layout read; `unavailable` when reads exist and no plan could be drawn; `pending` when reads
 * exist and no plan is in force yet (a run that ended before its rebuild, which the open's rebuild draws); `unknown` when
 * the engine said nothing, which is not "nothing read".
 */
function sketchState(layout: LayoutStatus | null, floors: DayOneFloor[]): 'plan' | 'none' | 'unavailable' | 'pending' | 'unknown' {
  if (floors.length > 0) return 'plan';
  if (layout === null) return 'unknown';
  if (layout.status === 'none' || layout.status === 'unavailable') return layout.status;
  return 'pending';
}

/** "5 of 8 panos read · drawn 2h ago · from layout.cal0 reads", and while stale "· not from the newest reads · redrawing…". */
function statusWords(layout: LayoutStatus, drawn: boolean, rebuilding: boolean, t: TFunction): string {
  const stale = layout.status === 'stale';
  return [
    t('affectedAreas.dayOne.status.read', { read: layout.panosRead, count: layout.panosTotal }),
    drawn && layout.builtAt !== null ? t('affectedAreas.dayOne.status.drawn', { when: formatRelativeTime(layout.builtAt) }) : null,
    drawn && layout.contractVersions.length > 0 ? t('affectedAreas.dayOne.status.from', { versions: listWords(layout.contractVersions, t) }) : null,
    stale && drawn ? t('affectedAreas.dayOne.status.stale') : null,
    stale && rebuilding ? t('affectedAreas.dayOne.status.redrawing') : null,
  ].filter((part) => part !== null).join(' · ');
}

/**
 * THE DAY-ONE SKETCH, the tour screen's rough floor plan drawn from the tour's own panos: each room measured from its own
 * camera, its scale checked against door slabs, the floor tile and appliance widths, the rooms pinned together through the
 * doorways both cameras see. The plan is the engine's; the screen lays nothing out and computes no position.
 *
 * Read top to bottom: "DAY-ONE SKETCH" and how far the layout is read ("5 of 8 panos read · drawn 2h ago · from
 * layout.cal0 reads"), with Read the room layout at the top right, where the tour's own press stands (`DayOnePress`); a floor
 * switch when the plan has several floors; then the drawing (`DayOnePlan`) beside the rooms (`DayOneRooms`), under it on a
 * phone.
 *
 * States: no layout read yet (an empty state pointing at the press above); partial (the plan of the panos read, and the press
 * offering the rest); built (every pano read, no press); stale (the plan in force drawn while the open's one rebuild redraws
 * it); reads but no plan in force yet (the drawing's waiting surface while the rebuild draws it); unavailable (its sentence);
 * the drawing loading (its own waiting surface, in its box); the walk running and a refusal (both the press's own).
 *
 * Handle: `data-day-one` on the section, its state.
 *
 * Used by the affected-areas module's `TourScreen`, between the room list and the panos.
 */
export function DayOneSketch({
  floors, layout, drawings, rebuilding, codebook, dryRun, pressTrouble, walk, unreadPanos, unreadViews, onOpenPanoAt, onOpenPano, onReadLayout, onStopLayout,
}: DayOneSketchProps) {
  const { t } = useTranslation();
  const headingId = useId();
  // Which floor is shown, by its place in `floors`: the floor switch's choice, which no prop carries. A list that shrinks
  // under it shows its last floor rather than none.
  const [floorAt, setFloorAt] = useState('0');
  const state = sketchState(layout, floors);
  const floor = floors.length === 0 ? null : floors[Math.min(Number(floorAt), floors.length - 1)];

  let body;
  if (state === 'plan' && floor !== null) {
    body = (
      <>
        {floors.length > 1 && (
          <SegmentedControl
            label={t('affectedAreas.dayOne.floorSwitch')}
            value={String(floors.indexOf(floor))}
            onChange={setFloorAt}
            options={floors.map((each, index) => ({
              value: String(index),
              label: each.floor === null ? t('affectedAreas.dayOne.floorNone') : t('affectedAreas.rooms.floor', { floor: each.floor }),
            }))}
          />
        )}
        <div className={COLUMNS}>
          {/* Keyed by the floor's drawing, so an enlarged drawing or a scroll of one floor never rides to another. */}
          <DayOnePlan key={floor.drawingSha} floor={floor} drawing={drawings[floor.drawingSha]} codebook={codebook} onOpenPanoAt={onOpenPanoAt} onOpenPano={onOpenPano} />
          <DayOneRooms floor={floor} codebook={codebook} onOpenPanoAt={onOpenPanoAt} />
        </div>
      </>
    );
  } else if (state === 'pending' && rebuilding) {
    // FILL: rebuild — when `layout.status` is `stale`, the open sends `api.affectedAreas.buildPlan(tourId)` ONCE (no model,
    // nothing bought) with `rebuilding` true while it is out; its answer's `layout` and `dayOne` are then this section's.
    body = (
      <div aria-busy="true" className="flex min-w-0 flex-col gap-2">
        <div aria-hidden="true" className="vv-skeleton aspect-[4/3] w-full rounded-none [@container(min-width:720px)]:w-3/5" />
        <p role="status" className="text-[12.5px] text-muted-foreground">{t('affectedAreas.dayOne.pending.drawing')}</p>
      </div>
    );
  } else {
    const empty = state === 'plan' ? 'pending' : state;
    body = (
      <EmptyState
        icon={state === 'unavailable' ? Ruler : DraftingCompass}
        title={t(`affectedAreas.dayOne.empty.${empty}Title`)}
        message={t(`affectedAreas.dayOne.empty.${empty}Message`)}
      />
    );
  }

  return (
    <section aria-labelledby={headingId} data-day-one={state} className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
          <h3 id={headingId} className={EYEBROW}>{t('affectedAreas.dayOne.title')}</h3>
          {layout !== null && layout.status !== 'none' && (
            <p className="text-[13.5px] text-foreground">{statusWords(layout, state === 'plan', rebuilding, t)}</p>
          )}
        </div>
        {/* The press stands where the tour's own does: top right, beside what it reads. */}
        <div className="min-w-0 max-w-[420px] flex-[0_1_auto]">
          <DayOnePress
            // FILL: dryRun — on open, ONE unarmed `api.affectedAreas.readLayout(tourId, firstPanoNeedingARead, { armed: false, force: false })`:
            // it buys nothing, and its `budget` and refusal make the press's line. No dry run when nothing is left to read.
            dryRun={dryRun}
            // FILL: pressTrouble — the lane's fault when the dry run brought no answer.
            trouble={pressTrouble}
            // FILL: walk — `hooks/useLayoutWalk.ts`, shaped as `useTourReader`; each answer's `layout` replaces this section's.
            walk={walk}
            // FILL: unreadPanos / unreadViews — counted off each view's `layout` (unread, or `current` false), beside `tourUnread`.
            unreadPanos={unreadPanos}
            unreadViews={unreadViews}
            onRead={onReadLayout}
            onStop={onStopLayout}
          />
        </div>
      </header>
      {body}
    </section>
  );
}
