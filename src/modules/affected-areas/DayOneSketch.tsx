import type { TFunction } from 'i18next';
import { DraftingCompass, Ruler } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DayOnePlan } from '@/modules/affected-areas/DayOnePlan';
import { DayOnePress } from '@/modules/affected-areas/DayOnePress';
import { DayOneRooms } from '@/modules/affected-areas/DayOneRooms';
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
  /** The press's latest answer (the dry run on open, then each armed answer), its lane fault, the walk, and what is left to read: `DayOnePress`'s own props. */
  lastAnswer: LayoutReadResult | null;
  pressTrouble: AffectedAreasTrouble | null;
  walk: TourReaderProgress;
  unreadPanos: number;
  unreadViews: number;
  onOpenPanoAt: (panoId: string, face: Face, regionId: string | null) => void;
  onOpenPano: (panoId: string) => void;
  /** Try again, on a floor whose drawing's bytes did not arrive. */
  onRetryDrawing: () => void;
  onReadLayout: () => void;
  onStopLayout: () => void;
};

/** The house's section eyebrow (MAN-742): it names the section, and no state is said in it alone. */
const EYEBROW = 'text-xs uppercase tracking-[0.14em] text-ink-faint';

/**
 * The drawing beside the room list from 960 px of panel; under it, the list stands under the drawing. Wider than the pano
 * screen's 720 (`PanoScreen`'s `COLUMNS`): a room's rows are a label column and a run of numbers, which a column under
 * ~370 px breaks one number to a line. `DayOnePlan`'s sticky figure keys on the same width.
 */
const COLUMNS = 'grid items-start gap-5 [@container(min-width:960px)]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]';

/** The contract of the layout reads entered from the operator's calibration session (stored answers, not a press's). */
const CALIBRATION_CONTRACT = 'layout.cal0';

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

/**
 * "5 of 8 panos read · drawn 2h ago · from the calibration reads": how far the layout is read, how old the plan in force is,
 * and, when the calibration's stored reads drew it (all of it, or part), so said in words, never by contract id; a plan from
 * reads of the press alone says nothing more. A stale plan is "drawn 2 days ago from older reads", with "redrawing…" while
 * the open's rebuild is out.
 */
function statusWords(layout: LayoutStatus, drawn: boolean, rebuilding: boolean, t: TFunction): string {
  const stale = layout.status === 'stale';
  const when = drawn && layout.builtAt !== null ? formatRelativeTime(layout.builtAt) : null;
  const calibration = layout.contractVersions.includes(CALIBRATION_CONTRACT);
  const onlyCalibration = layout.contractVersions.every((version) => version === CALIBRATION_CONTRACT);
  return [
    t('affectedAreas.dayOne.status.read', { read: layout.panosRead, count: layout.panosTotal }),
    when === null ? null : t(stale ? 'affectedAreas.dayOne.status.drawnOlder' : 'affectedAreas.dayOne.status.drawn', { when }),
    drawn && !stale && calibration ? t(onlyCalibration ? 'affectedAreas.dayOne.status.calibration' : 'affectedAreas.dayOne.status.partlyCalibration') : null,
    stale && rebuilding ? t('affectedAreas.dayOne.status.redrawing') : null,
  ].filter((part) => part !== null).join(' · ');
}

/**
 * THE DAY-ONE SKETCH, the tour screen's rough floor plan drawn from the tour's own panos: each room measured from its own
 * camera, its scale checked against door slabs, the floor tile and appliance widths, the rooms pinned together through the
 * doorways both cameras see. The plan is the engine's; the screen lays nothing out and computes no position.
 *
 * Read top to bottom: "DAY-ONE SKETCH" and how far the layout is read ("5 of 8 panos read · drawn 2h ago · from the
 * calibration reads"), with Read the room layout at the top right, where the tour's own press stands (`DayOnePress`); a floor
 * switch when the plan has several floors; then the drawing (`DayOnePlan`) beside the rooms (`DayOneRooms`), under it below
 * 960 px of panel.
 *
 * States: no layout read yet (an empty state pointing at the press above, or, while the press says why nothing can be read,
 * pointing at that warning instead); partial (the plan of the panos read, and the press
 * offering the rest); built (every pano read, no press); stale (the plan in force drawn while the open's one rebuild redraws
 * it); reads but no plan in force yet (the drawing's waiting surface while the rebuild draws it); unavailable (its sentence);
 * the drawing loading (its own waiting surface, in its box); the walk running and a refusal (both the press's own).
 *
 * Handle: `data-day-one` on the section, its state.
 *
 * Used by the affected-areas module's `TourScreen`, between the room list and the panos.
 */
export function DayOneSketch({
  floors, layout, drawings, rebuilding, codebook, lastAnswer, pressTrouble, walk, unreadPanos, unreadViews, onOpenPanoAt, onOpenPano, onRetryDrawing, onReadLayout, onStopLayout,
}: DayOneSketchProps) {
  const { t } = useTranslation();
  const headingId = useId();
  // Which floor is shown, by its place in `floors`: the floor switch's choice, which no prop carries. A list that shrinks
  // under it shows its last floor rather than none.
  const [floorAt, setFloorAt] = useState('0');
  const state = sketchState(layout, floors);
  const floor = floors.length === 0 ? null : floors[Math.min(Number(floorAt), floors.length - 1)];
  // The press says why nothing can be read now (a refused answer, the lane's fault, a walk stopped by a refusal): an empty
  // state must then point at that warning, never invite the press it refuses.
  const refused = pressTrouble !== null || lastAnswer?.status === 'refused' || (!walk.running && walk.lastRefusal !== null);

  let body;
  if (state === 'plan' && floor !== null) {
    body = (
      <>
        {/* A block around the tray, so the section's column does not stretch it: it keeps its own width, at the start. */}
        {floors.length > 1 && (
          <div className="min-w-0">
            <SegmentedControl
              label={t('affectedAreas.dayOne.floorSwitch')}
              value={String(floors.indexOf(floor))}
              onChange={setFloorAt}
              options={floors.map((each, index) => ({
                value: String(index),
                label: each.floor === null ? t('affectedAreas.dayOne.floorNone') : t('affectedAreas.rooms.floor', { floor: each.floor }),
              }))}
            />
          </div>
        )}
        <div className={COLUMNS}>
          {/* Keyed by the floor's drawing, so an enlarged drawing or a scroll of one floor never rides to another. */}
          <DayOnePlan
            key={floor.drawingSha}
            floor={floor}
            drawing={drawings[floor.drawingSha]}
            codebook={codebook}
            onOpenPanoAt={onOpenPanoAt}
            onOpenPano={onOpenPano}
            onRetryDrawing={onRetryDrawing}
          />
          <DayOneRooms floor={floor} codebook={codebook} onOpenPanoAt={onOpenPanoAt} />
        </div>
      </>
    );
  } else if (state === 'pending' && rebuilding) {
    // FILL: rebuild — when `layout.status` is `stale`, the open sends `api.affectedAreas.buildPlan(tourId)` ONCE (no model,
    // nothing bought) with `rebuilding` true while it is out; its answer's `layout` and `dayOne` are then this section's. A
    // rebuild that brings no answer says its fault through `pressTrouble` (the press's wall), and the section stays as it was.
    body = (
      <div aria-busy="true" className="flex min-w-0 flex-col gap-2">
        <div aria-hidden="true" className="vv-skeleton aspect-[4/3] w-full rounded-none [@container(min-width:960px)]:w-3/5" />
        <p role="status" className="text-[12.5px] text-muted-foreground">{t('affectedAreas.dayOne.pending.drawing')}</p>
      </div>
    );
  } else {
    const empty = state === 'plan' ? 'pending' : state;
    // The two states whose words invite the press say instead, while it is refused, that the warning above is why.
    const invites = empty === 'none' || empty === 'unknown';
    body = (
      <EmptyState
        icon={state === 'unavailable' ? Ruler : DraftingCompass}
        title={t(`affectedAreas.dayOne.empty.${empty}Title`)}
        message={t(`affectedAreas.dayOne.empty.${empty}${invites && refused ? 'Refused' : ''}Message`)}
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
            // FILL: lastAnswer — on open, ONE unarmed `api.affectedAreas.readLayout(tourId, firstPanoNeedingARead, { armed: false, force: false })`,
            // which buys nothing (no dry run when nothing is left to read); then each armed answer the walk lands. Its `budget` and refusal make the press's lines.
            lastAnswer={lastAnswer}
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
