import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionControls, CompanionFace, CompanionStatus, CompanionStopButton, useCompanion, useCompanionPresence } from '@/modules/companion';
import { useStation } from '@/modules/station/context/StationContext';
import { HeadRow } from '@/modules/station/HeadRow';
import { HerViewToggle } from '@/modules/station/HerViewToggle';
import { useDrawnSquare } from '@/modules/station/hooks/useDrawnSquare';
import { useHerView } from '@/modules/station/hooks/useHerView';
import { StationArrival } from '@/modules/station/StationArrival';
import type { CompanionPresence, StationDensity, StationHeadRow, StationHerView, StationRegionProps, StationTier } from '@/shared/types';
import { Banner, buttonVariants, Menu } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** The companion's core in the scene's dock: its face at the core's size at rest (`--size-core-rest`), with no disc. */
const CORE_FACE = { px: 56, box: 'size-14' };

/** The face at compact density, at every tier: one column has no height to give a larger one. */
const COMPACT_FACE = { px: 64, box: 'size-16' };

/** The face in the phone's top row (`HeadRow`): 44 px upright, 32 px on its side, where the row is 40 px. */
const ROW_FACE = { upright: { px: 44, box: 'size-11' }, sideways: { px: 32, box: 'size-8' } };

/**
 * The most the panel the controls hang in takes: two lines of `CompanionControls`' line, the model and Live over the voice and
 * Clear, with their 44 px catches below 768 px; given the ears, three. A window narrower than it less 16 px narrows it, and its
 * controls wrap. It opens from the press, so it never covers the companion's face.
 */
const CONTROLS_PANEL_PX = 380;

type StationHeadViewProps = {
  /** The window's tier. A `narrow` tier always draws the compact head. */
  tier: StationTier;
  /** `full` draws the dock's form (wide and laptop: the scene); `compact` draws the one-column head, the same at every tier. */
  density: StationDensity;
  /** The companion's name as you set it, the default while its picture loads. */
  name: string;
  /** What the companion is doing on this page (`useCompanionPresence`): the status line reads it, as its face does. */
  presence: CompanionPresence;
  /** The face at the square its form gives it, in px: `CompanionFace` on the page, `CompanionAvatar` on a fixture's presence. */
  face: (px: number) => ReactNode;
  /**
   * The controls in their station layout, `CompanionControls` with `layout: 'line'`, drawn inside the "Controls" panel while it is
   * open (in the dock and at compact) and in the phone's menu.
   */
  controls: (align: 'start' | 'center') => ReactNode;
  /** While the companion's process has failed, the server's sentence for it (null when it gave none); null while it runs. */
  failure: { sentence: string | null } | null;
  /**
   * How the station draws the companion (`useHerView` on the page): `portrait`, its face large with its latest answer, or `chat`,
   * its whole conversation. At compact density `chat` draws the face in its disc here; `portrait` draws none, the portrait
   * standing in the conversation's place.
   */
  herView: StationHerView;
  /** The toggle's press: the other view. */
  onHerView: (next: StationHerView) => void;
  /**
   * In the dock (full density): whether the companion's core stands beside its name. True while the stage holds a thing (the
   * companion has left the center for the dock) and in the chat view (the center holds the log); at rest in the portrait view the
   * companion's face is the center itself, and the dock draws no second one. The core arrives and settles on the spring.
   */
  core?: boolean;
  /**
   * In the dock: Stop, while a turn runs (`CompanionStopButton`), standing beside the name because the controls there stand behind
   * a press; null while no turn runs. It arrives with the turn and settles when the turn ends.
   */
  stop?: ReactNode;
  /**
   * The head as the phone's top row (`StationHeadRow`, handed by the phone's arrangement over `density: 'compact'`): the face at 44
   * px (32 on its side), the name and state on one line, the arrangement's `trail`, and one menu at the row's end, holding the
   * controls and "CloudCLI". Absent everywhere else.
   */
  row?: StationHeadRow;
};

/**
 * THE COMPANION'S HEAD on Kaylee Station: its name, its one state in words, a failed process's sentence, its controls, the toggle
 * between its two views, and in some forms its face. Everything in it is the companion module's own, drawn through its barrel: the
 * status line is `CompanionStatus` at the station's emphasis (the same words, from the same presence, as the panel's line and the
 * button's label, MAN-9089), the controls are `CompanionControls` in one line (every rule of MAN-9090 with them), Stop is
 * `CompanionStopButton`, and the face is the caller's `face`.
 *
 * - THE DOCK (full density: wide and laptop, the scene): one line at the dock's start. The companion's core (its face at 56 px,
 *   no disc) while `core` holds, arriving from below on the spring as the companion leaves the center and settling as it returns;
 *   its name over its state; Stop while a turn runs (`stop`), the one urgent press, never behind anything; then "Controls", the
 *   kit `Menu` whose panel holds the controls' line; then the view's toggle. A failed process says its sentence in one warn line
 *   under the state. Nothing else of the companion stands here: the model, Live, the voice and Clear are one press away because
 *   they act on nothing that is happening now.
 * - COMPACT DENSITY (the one-column arrangement, at any tier, and always under 1024 px): the face at 64 px beside the name and the
 *   status line, the two on one line where they fit (the status drops under the name, whole, where they do not), and under them
 *   "Controls" (the same panel, with Stop leading its line while a turn runs) and the toggle. A failed process's banner takes the
 *   head's whole width under them. The portrait view draws no face here: the portrait stands large in the conversation's place.
 * - THE PHONE'S TOP ROW (`row`, handed by the phone's arrangement; `HeadRow`): the face at 44 px (32 on its side), the name and
 *   state on one line, the arrangement's `trail`, and ONE menu at the row's end, the controls' line over the toggle and "CloudCLI".
 *
 * While the companion's picture loads the line says Loading… and every control waits. The companion faces you: no look turns
 * its face toward a rim.
 *
 * A pure view: `StationHead` below binds it, and the fixtures draw it on `fake/head.ts`'s pictures.
 */
export function StationHeadView({
  tier, density, name, presence, face, controls, failure, herView, onHerView, row, core = false, stop = null,
}: StationHeadViewProps) {
  const { t } = useTranslation();
  const nameId = useId();
  const portrait = herView === 'portrait';
  // The dock's form: full density on wide and laptop. Under 1024 px the station is one column, so a `narrow` tier draws the compact head.
  const dock = row === undefined && density === 'full' && tier !== 'narrow';
  const { px, box } = row !== undefined ? ROW_FACE[row.sideways ? 'sideways' : 'upright'] : dock ? CORE_FACE : COMPACT_FACE;
  // The px the face's box is drawn at, read off the box: the face is drawn at it, so it fills the square it stands in.
  const [setFaceNode, drawnPx] = useDrawnSquare(px);

  const viewToggle = <HerViewToggle herView={herView} onChange={onHerView} />;
  const controlsLabel = t('station.head.controls', { defaultValue: 'Controls' });
  // The controls behind one press, in the dock and at compact.
  const controlsPress = (
    <Menu
      width={CONTROLS_PANEL_PX}
      label={controlsLabel}
      panel={controls('start')}
      trigger={(
        <span data-station-head-controls="" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'finger:h-11')}>
          <SlidersHorizontal aria-hidden="true" />
          {controlsLabel}
          <ChevronDown aria-hidden="true" />
        </span>
      )}
    />
  );
  const failedSentence = failure === null ? null : (failure.sentence ?? t('companion.panel.failedUnknown', { name }));

  if (dock) {
    return (
      <section data-station-head="dock" aria-labelledby={nameId} className="flex min-w-0 items-center gap-3">
        <StationArrival when={core} from="core" className="shrink-0">
          <div ref={setFaceNode} data-station-head-face="" className={cn('relative shrink-0', box)}>
            {face(drawnPx)}
          </div>
        </StationArrival>
        {/* The name over the state: two short lines beside the core, so the talk control keeps the dock's width. */}
        <div className="flex min-w-0 max-w-[22rem] flex-col">
          <h2 id={nameId} data-station-head-name="" className="max-w-full truncate text-base font-semibold leading-6 text-foreground">
            {name}
          </h2>
          <CompanionStatus presence={presence} emphasis="station" />
          {failedSentence !== null && (
            <p data-station-head-failed="" data-tone="warn" title={failedSentence} className="flex min-w-0 items-start gap-1.5 text-xs leading-snug text-tone-ink">
              <span aria-hidden="true">▲</span>
              <span className="line-clamp-2 min-w-0 break-words">{failedSentence}</span>
            </p>
          )}
        </div>
        <StationArrival when={stop !== null} from="dock" className="shrink-0">{stop}</StationArrival>
        <div className="flex shrink-0 items-center gap-2">
          {controlsPress}
          {viewToggle}
        </div>
      </section>
    );
  }

  // No disc in the portrait view: the face stands in the conversation's place.
  const faceBox = portrait ? null : (
    <div ref={setFaceNode} data-station-head-face="" className={cn('relative shrink-0 rounded-full bg-accent-soft', box)}>
      {face(drawnPx)}
    </div>
  );
  const banner = failedSentence !== null && (
    <div data-station-head-failed="" className="w-full text-left">
      <Banner tone="warn">{failedSentence}</Banner>
    </div>
  );

  if (row !== undefined) {
    return (
      <HeadRow
        row={row}
        face={faceBox}
        name={name}
        nameId={nameId}
        presence={presence}
        controls={controls('start')}
        panelWidth={CONTROLS_PANEL_PX}
        banner={banner}
        herView={herView}
        onHerView={onHerView}
      />
    );
  }

  return (
    <section data-station-head={portrait ? 'portrait' : 'compact'} aria-labelledby={nameId} className="flex min-w-0 flex-col gap-2 px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        {faceBox}
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          {/* The name and the state on one line; the state wraps under the name, whole, where the two do not fit. */}
          <div className="flex min-w-0 max-w-full flex-wrap items-baseline gap-x-2.5">
            <h2 id={nameId} data-station-head-name="" className="max-w-full truncate text-base font-semibold leading-6 text-foreground">
              {name}
            </h2>
            <CompanionStatus presence={presence} emphasis="station" />
          </div>
          <div className="flex flex-wrap items-center gap-2">{controlsPress}{viewToggle}</div>
        </div>
      </div>
      {banner}
    </section>
  );
}

/**
 * The head on the page, the `head` slot's region (`stationRegions.ts`): it hands `StationHeadView` the face bound to this page's
 * provider, the presence, the controls bound to the provider's verbs, the process's failure, and, for the dock, whether the core
 * stands there (the stage holds a thing, or the chat view is drawn) and Stop while a turn runs. It adds no state of the
 * companion's and no frame (MAN-9089). `row` passes through: the phone's arrangement draws this region as its top row.
 */
export function StationHead({ tier, density, row }: StationRegionProps & { row?: StationHeadRow }) {
  const { t } = useTranslation();
  const {
    picture, voice, ears, saveSettings, interrupt, clear,
  } = useCompanion();
  // The one state the face and the status line read, so the two cannot disagree (MAN-9089).
  const presence = useCompanionPresence();
  const [herView, setHerView] = useHerView();
  const { focus } = useStation();
  const name = picture?.settings.name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });
  // In the dock Stop stands beside the name, so the controls' line behind the press draws none of its own.
  const dock = row === undefined && density === 'full' && tier !== 'narrow';
  const turnRunning = picture?.turnId != null;

  return (
    <StationHeadView
      tier={tier}
      density={density}
      name={name}
      presence={presence}
      // The companion faces you: no look turns it toward a rim.
      face={(px) => <CompanionFace size={px} />}
      controls={(align) => (
        <CompanionControls
          name={name}
          picture={picture}
          layout="line"
          align={align}
          stopOutside={dock}
          voice={voice}
          ears={ears}
          onModelChange={(model) => saveSettings({ model })}
          onLiveChange={(live) => saveSettings({ live })}
          onInterrupt={interrupt}
          onClear={clear}
        />
      )}
      failure={picture?.process.state === 'failed' ? { sentence: picture.process.error } : null}
      herView={herView}
      onHerView={setHerView}
      core={focus !== null || herView === 'chat'}
      stop={dock && turnRunning ? <CompanionStopButton name={name} onInterrupt={interrupt} /> : null}
      row={row}
    />
  );
}
