import '@/modules/station/stationScene.css';

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useStation, useStationPref, useStationWhere } from '@/modules/station/context/StationContext';
import { StationBar } from '@/modules/station/StationBar';
import { StationCompact } from '@/modules/station/StationCompact';
import { stationArrangementOf } from '@/modules/station/stationArrangement';
import { StationPhone } from '@/modules/station/StationPhone';
import { StationStage } from '@/modules/station/StationStage';
import { STATION_REGIONS } from '@/modules/station/stationRegions';
import { backToCloudcli } from '@/shared/cloudcliDoors';
import { useStationDoors } from '@/shared/context/StationLayerContext';
import type { StationArrangement, StationCompactSwitch, StationDensity, StationSlot } from '@/shared/types';
import { Sheet } from '@/shared/ui';
import { cn, isDrawn } from '@/shared/utils';

/** What the layout holds in each slot: a region, drawn. A slot left out (or null) draws nothing. */
type StationSlots = Partial<Record<StationSlot, ReactNode>>;

/** "Where things stand" over the scene: whether its sheet is open, and the press that opens or shuts it. */
type StationWhereSheet = { open: boolean; onOpen: (open: boolean) => void };

type StationShellViewProps = {
  /**
   * The arrangement: `wide` (≥ 1360 px) and `laptop` (1024–1359 px), the scene; `compact` (below 1024 px, and wherever your switch
   * is on) or `phone` (a phone, upright or on its side).
   */
  arrangement: StationArrangement;
  /** Each slot's region, drawn for the window's tier and the arrangement's density. The scene places them here; compact and the phone draw their own. */
  slots: StationSlots;
  /** The stage, drawn: `StationStage` on the page, `StationStageView` on a fixture. Compact's Stage section holds its own. */
  stage: ReactNode;
  /**
   * Whether the stage holds a thing (the station's focus is set): the scene's center is then the stage, and the companion leaves
   * it for the dock's core; with nothing staged the center is the companion.
   */
  staged: boolean;
  /** Compact, drawn (`StationCompact` on the page, `StationCompactView` on a fixture): the body while `arrangement` is `compact`. */
  compact: ReactNode;
  /**
   * The phone's arrangement, drawn (`StationPhone` on the page, `StationPhoneView` on a fixture): the whole frame while `arrangement`
   * is `phone`, its top row the bar.
   */
  phone: ReactNode;
  /** The bar's "Compact" switch, or null where it changes nothing (below 1024 px): the bar then draws none. */
  compactSwitch: StationCompactSwitch | null;
  /** The bar's "CloudCLI", the way back to the workspace. */
  onBackToCloudcli: () => void;
  /** "Where things stand" over the scene (`useStationWhere` on the page): its sheet, and the bar's press that opens it. */
  where: StationWhereSheet;
};

/**
 * THE SCENE'S BODY (wide and laptop): three places across, over the dock.
 *
 * - THE START RIM (`live`): what is happening elsewhere, the chats running now. It opens only while its region says something in it
 *   is true (`data-station-true`), on the lock spring, and settles shut when nothing is (`stationScene.css`).
 * - THE CENTER: with nothing staged, the companion (`conversation`: its portrait, the face large over its latest answer, or its
 *   whole conversation in the chat view), the stage's cell above it keeping only the shelf of the companion's cards while the shelf
 *   has any. With a thing staged, the stage takes the whole center and the companion moves into the dock's core. Each arrives on
 *   the spring; the stage's cell is never re-parented, so the stage keeps its state across the change. At the center's foot, the
 *   held row: the draft the companion holds out for your Send (`dock`), which opens to the draft's height as it arrives and
 *   closes as it settles, so the work above it moves on the same spring and the rims beside it never move at all.
 * - THE END RIM (`needs`): what asks for you, opened and settled exactly as the start rim is.
 * - THE DOCK across the foot: the companion (`head`: its core while it is not the center, its name and state, Stop while a turn
 *   runs, its controls behind a press) and the talk control (`talk`).
 */
function SceneBody({ slots, stage, staged }: { slots: StationSlots; stage: ReactNode; staged: boolean }) {
  return (
    <div data-station-scene="" className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <div data-station-rim="start">
          <div data-station-rim-body="" data-station-slot="live">{slots.live}</div>
        </div>
        <div data-station-center="" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div data-station-stage-cell="" className={cn('flex min-w-0 flex-col', staged ? 'min-h-0 flex-1' : 'shrink-0')}>{stage}</div>
          {!staged && isDrawn(slots.conversation) && (
            <div data-station-slot="conversation" className="flex min-h-0 min-w-0 flex-1 flex-col">{slots.conversation}</div>
          )}
          <div data-station-held="" data-station-slot="dock" className="shrink-0">{slots.dock}</div>
        </div>
        <div data-station-rim="end">
          <div data-station-rim-body="" data-station-slot="needs">{slots.needs}</div>
        </div>
      </div>
      <div data-station-dock-bar="" className="flex min-w-0 shrink-0 items-center gap-6 border-t border-border bg-background px-4">
        <div data-station-slot="head" className="min-w-0 shrink py-2">{slots.head}</div>
        <div data-station-slot="talk" className="ml-auto min-w-0 max-w-4xl flex-1">{slots.talk}</div>
      </div>
    </div>
  );
}

/**
 * THE STATION'S LAYOUT: a bar over a body, the body arranged by the arrangement.
 *
 * THE ROOT IS THE WORKSPACE FRAME'S OWN BOX (`WorkspaceFrame`): `pwa-status-clear fixed inset-0`, its bottom riding
 * `--keyboard-height`, so in the home-screen app it clears the status bar and the notch and its foot lifts over the on-screen
 * keyboard; the body pads by `--safe-area-inset-bottom`, clearing the home indicator (on a phone its bottom bar pads itself). The
 * page never scrolls as a document: its regions scroll inside it. Sheets, dialogs and menus the station opens never take
 * `pwa-status-clear`: an overlay covers the whole screen and pads its own content.
 *
 * - WIDE AND LAPTOP: THE SCENE (`SceneBody`), Astrolabe's "quiet until it's true". At rest the screen is the companion in the
 *   center and the dock across the foot: nothing else takes room until it is true. The chats running now open the start rim,
 *   what asks for you opens the end rim, a draft held for your Send opens the dock's held row, and each settles away when it stops
 *   being true. What is never happening now — every chat, the roadmap, the companion's memory — is one press away in the bar,
 *   "Where things stand", a sheet from the left (`where`). A laptop's rims are narrower, so the stage between two open rims still
 *   reads at a card's measure.
 * - COMPACT (below 1024 px, and at any width while your switch is on): one column — the companion's head, the strip's line, one
 *   switch, a section (`compact`, the caller's `StationCompactView`); the strip is a row of its own there, never the bar's.
 * - PHONE (a phone, upright or on its side): the station made for the thumb (`phone`, the caller's `StationPhoneView`), the whole
 *   frame: the companion's head as its top row, which is the bar there (no `StationBar` is drawn), the strip's line, the section,
 *   and a bottom bar of the sections round the talk control, which pads itself by the home indicator's inset.
 *
 * Every place's presence is a data condition — what is drawn, what is true — never a mode. A change of arrangement re-parents what
 * moves (everything into compact's sections), so a region keeps its state in the station's context or its scroll memory, never only
 * in itself.
 *
 * A pure view: `StationShell` below binds it to the station, and the fixtures draw it on their pictures (`station-fake.ts`).
 */
export function StationShellView({ arrangement, slots, stage, staged, compact, phone, compactSwitch, onBackToCloudcli, where }: StationShellViewProps) {
  const { t } = useTranslation();
  const scene = arrangement === 'wide' || arrangement === 'laptop';
  const body = arrangement === 'compact' ? compact : arrangement === 'phone' ? phone : <SceneBody slots={slots} stage={stage} staged={staged} />;

  return (
    <div
      data-station-shell=""
      data-station-arrangement={arrangement}
      className="pwa-status-clear fixed inset-0 flex flex-col bg-background"
      style={{ bottom: 'var(--keyboard-height, 0px)' }}
    >
      {arrangement !== 'phone' && (
        <StationBar
          strip={arrangement === 'compact' ? null : slots.strip}
          compactSwitch={compactSwitch}
          onBackToCloudcli={onBackToCloudcli}
          onWhere={scene ? () => where.onOpen(true) : null}
        />
      )}
      <main data-station-body="" className={cn('flex min-h-0 flex-1 flex-col', arrangement !== 'phone' && 'pb-[var(--safe-area-inset-bottom)]')}>
        {body}
      </main>
      {scene && (
        <Sheet
          side="left"
          flush
          open={where.open}
          onClose={() => where.onOpen(false)}
          title={t('station.where.title', { defaultValue: 'Where things stand' })}
          width="min(380px, 100%)"
        >
          <div data-station-where-sheet="" className="flex h-full min-h-0 flex-col">
            {isDrawn(slots.sessions) && <div data-station-slot="sessions" className="flex min-h-0 flex-1 flex-col">{slots.sessions}</div>}
            {isDrawn(slots.corner) && <div data-station-slot="corner" className="shrink-0 border-t border-border">{slots.corner}</div>}
          </div>
        </Sheet>
      )}
    </div>
  );
}

/**
 * The station on the page: what `StationRoute` renders inside the station's provider. It reads the tier, your Compact switch, the
 * registered regions, the stage's focus, "Where things stand" and the way back, and hands them, with the live stage, to
 * `StationShellView`.
 *
 * THE ARRANGEMENT is `phone` first, on a phone (`useStation().phone`: a window under 768 px wide, or a touch window under 500 px
 * tall); else compact below 1024 px (the tier `narrow`: a tablet, the second monitor, a small window) and wherever your switch is
 * on; else the tier's. It follows `resize` and the pointer query's `change` (the context reads both) and your switch, never a
 * timer. The switch is the station pref `compact`, per device, and is drawn from 1024 px up: below, compact is the only
 * arrangement a non-phone has and a switch would change nothing.
 *
 * EVERY REGION'S DENSITY is `compact` in the one-column arrangements (compact's and the phone's) and `full` in the scene, handed to
 * each region with the tier.
 */
export function StationShell() {
  const { tier, phone, focus } = useStation();
  const where = useStationWhere();
  const doors = useStationDoors();
  const [compactOn, setCompactOn] = useStationPref('compact', false);
  const arrangement = stationArrangementOf(tier, phone, compactOn);
  const compactSwitch: StationCompactSwitch | null = tier === 'narrow' ? null : { on: compactOn, onChange: setCompactOn };
  const density: StationDensity = arrangement === 'compact' || arrangement === 'phone' ? 'compact' : 'full';
  // The way back, bound here for the bar (a pure view drawn by this pure layout) and for the phone's top row, its menu: to the workspace as it stood when the station came forward.
  const onBackToCloudcli = () => backToCloudcli(doors.navigate, doors.workspacePath());

  // Each slot with a registered region, drawn for this tier at the arrangement's density; a slot with none is left out, so it
  // draws nothing.
  const slots: StationSlots = {};
  for (const slot of Object.keys(STATION_REGIONS) as StationSlot[]) {
    const Region = STATION_REGIONS[slot];
    if (Region !== undefined) slots[slot] = <Region tier={tier} density={density} />;
  }
  const stage = <StationStage />;
  return (
    <StationShellView
      arrangement={arrangement}
      slots={slots}
      stage={stage}
      staged={focus !== null}
      compact={arrangement === 'compact' ? <StationCompact slots={slots} stage={stage} tier={tier} /> : null}
      phone={arrangement === 'phone' ? <StationPhone slots={slots} stage={stage} onBackToCloudcli={onBackToCloudcli} /> : null}
      compactSwitch={compactSwitch}
      onBackToCloudcli={onBackToCloudcli}
      where={{ open: where.open, onOpen: where.setOpen }}
    />
  );
}
