import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { useStation, useStationPref } from '@/modules/station/context/StationContext';
import { StationBar } from '@/modules/station/StationBar';
import { StationCompact } from '@/modules/station/StationCompact';
import { StationPhone } from '@/modules/station/StationPhone';
import { StationStage } from '@/modules/station/StationStage';
import { STATION_REGIONS } from '@/modules/station/stationRegions';
import { backToCloudcli } from '@/shared/cloudcliDoors';
import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import type { StationArrangement, StationCompactSwitch, StationDensity, StationSlot } from '@/shared/types';
import { cn, isDrawn } from '@/shared/utils';

/** What the layout holds in each slot: a region, drawn. A slot left out (or null) draws nothing. */
type StationSlots = Partial<Record<StationSlot, ReactNode>>;

/** The slots the body stacks; `strip` is the bar's. */
type BodySlot = Exclude<StationSlot, 'strip'>;

type StationShellViewProps = {
  /**
   * The arrangement: `wide` (≥ 1360 px), `laptop` (1024–1359 px), `compact` (below 1024 px, and wherever his switch is on) or
   * `phone` (a phone, upright or on its side).
   */
  arrangement: StationArrangement;
  /** Each slot's region, drawn for the window's tier and the arrangement's density. The columns draw them here; compact draws its own. */
  slots: StationSlots;
  /** The stage, drawn: `StationStage` on the page, `StationStageView` on a fixture. Compact's Stage section holds its own. */
  stage: ReactNode;
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
};

/**
 * How each slot stands in its column. The lists take the room (sessions, the conversation, needs) and scroll inside
 * themselves; the rest are their own height.
 *
 * HER COLUMN'S ONE BUDGET (wide and laptop, read off `data-station-column=her`), in the order things give way as it runs
 * short, each by its shrink: first the stage beside her on a laptop (a guest there, 10000), down to its floor; then the dock's
 * field, down to its 88 px floor — the dock's basis is its card at that floor as the card measures it (its target line, the
 * field's 88 px, its sends, and a notice or a refused send's sentence when one stands), with the dock's padding: the property
 * `--station-dock-floor`, whose one writer is the dock's `useDockFloor`, and 14.25rem until it has written it — and it grows to
 * its words (10000, to its content and no further) only into room
 * her conversation's share leaves; then her conversation (100), from its share of 30% of the column, so her newest lines stay
 * in sight, down to its 3.5rem floor (her panel's own rule); and last the dock (1) below its card's floor, scrolling with the
 * card whole inside it. So his sends and a line of the brief stand whenever her conversation is above its floor. The dock's
 * own cap, 45% of the column wide and 40% on a laptop, is the dock's (`StationDock`, in `cqh` of this column).
 *
 * The corner is the rail's foot whatever stands above it (`mt-auto`, its hairline its own), so it never rises to the
 * rail's head while the sessions are not drawn; under the sessions, which take the room, the margin is nothing.
 */
const SLOT_BOX: Record<BodySlot, string> = {
  sessions: 'min-h-0 flex-1',
  corner: 'mt-auto shrink-0 border-t border-border',
  head: 'shrink-0',
  conversation: 'min-h-14 flex-1 [[data-station-column=her]_&]:flex-[1_100_30%]',
  dock: 'min-h-0 flex-[0_1_auto] [[data-station-column=her]_&]:max-h-max [[data-station-column=her]_&]:flex-[10000_1_var(--station-dock-floor,14.25rem)]',
  talk: 'shrink-0',
  needs: 'min-h-0 flex-1',
};

/**
 * The stage in her column on a laptop, beside her regions: its own height up to 55% of the column, and the first to
 * give way when the column runs short — a guest there, as her panel's notes are — down to a floor that keeps its head
 * and a line of what it holds (7.5rem), and its foot when a kind draws one (her walk's Back and Next, which stand outside the
 * body's scroller so they are never scrolled away): 4rem more, the foot's own height. Measured at 1280×800 with her head,
 * conversation, dock and talk control all drawn: the 7.5rem floor alone stood the walk's foot 23 px over her conversation.
 * Her cards' shelf over the stage takes 4.5rem more: its own height (53 px) and the rest of the first line of what the stage
 * holds, whole under it. Measured at 1280×800 with the dock drawn: the 7.5rem floor alone was all shelf and head, not a word
 * of the chat on it; at 11rem the first line stood cut in half. With the foot too, 16rem. The shelf's two floors hold only in
 * a column tall enough for them and the dock's card both — 45rem, or 48rem where the column is under 38rem across and her
 * head and talk row stand taller (a 1024 px window) — read off her column as a query container (`her`): in a shorter one the
 * stage, a guest, keeps the 7.5rem (11.5rem with the walk's foot), its head and title still saying what it holds, and the
 * dock's sends stay in sight (at 1280×720 the 12rem floor scrolled them away). An empty stage under the shelf lets go of the
 * floor (`stageCell`), so the shelf's rule leaves it alone.
 */
const LAPTOP_STAGE_BESIDE_HER = cn(
  'max-h-[55%] min-h-[7.5rem] flex-[0_10000_auto] [&:has([data-station-stage-foot]:not(:empty))]:min-h-[11.5rem]',
  '[@container_her_(min-height:45rem)_and_(min-width:38rem)]:[&:has([data-station-shelf]):not(:has([data-station-stage=empty]))]:min-h-[12rem]',
  '[@container_her_(min-height:48rem)]:[&:has([data-station-shelf]):not(:has([data-station-stage=empty]))]:min-h-[12rem]',
  '[@container_her_(min-height:45rem)_and_(min-width:38rem)]:[&:has([data-station-shelf]):has([data-station-stage-foot]:not(:empty))]:min-h-[16rem]',
  '[@container_her_(min-height:48rem)]:[&:has([data-station-shelf]):has([data-station-stage-foot]:not(:empty))]:min-h-[16rem]',
);

/**
 * Her column as a query container, `her`, of its own height and width (its grid cell's: nothing it holds sizes it), so her head
 * draws her face over her words only while the column is tall enough (StationHead's wide form).
 */
const HER_CONTAINER = '[container-name:her] [container-type:size]';

/** The left rail, top to bottom: the sessions over the memory corner. */
const LEFT: readonly BodySlot[] = ['sessions', 'corner'];
/** Her column, top to bottom. On a laptop the stage stands between `head` and `conversation`, never over her face. */
const HER: readonly BodySlot[] = ['head', 'conversation', 'dock', 'talk'];
/** The body's grid per arrangement, its areas named, its one row the body's whole height (columns scroll inside); compact is one column. */
const BODY: Record<StationArrangement, string> = {
  wide: "grid grid-cols-[288px_minmax(360px,420px)_minmax(0,1fr)_336px] grid-rows-[minmax(0,1fr)] [grid-template-areas:'left_her_stage_right']",
  laptop: "grid grid-cols-[256px_minmax(0,1fr)_296px] grid-rows-[minmax(0,1fr)] [grid-template-areas:'left_her_right']",
  compact: 'flex flex-col',
  phone: 'flex flex-col',
};

/** One piece of a column: a drawn slot, or the stage. */
type Piece = { key: string; node: ReactNode; box: string; slot: BodySlot | null };

/** The drawn slots of a list, in its order, as pieces. A slot with no region is left out: it draws nothing. */
function piecesOf(names: readonly BodySlot[], slots: StationSlots): Piece[] {
  return names.filter((name) => isDrawn(slots[name])).map((name) => ({ key: name, node: slots[name], box: SLOT_BOX[name], slot: name }));
}

/** One column: its pieces stacked top to bottom, a hairline between each two. */
function Column({ name, pieces, className }: { name: string; pieces: Piece[]; className?: string }) {
  return (
    <div data-station-column={name} className={cn('flex min-h-0 min-w-0 flex-col', className)}>
      {pieces.map((piece, at) => (
        <div
          key={piece.key}
          data-station-slot={piece.slot ?? undefined}
          data-station-stage-cell={piece.slot === null ? '' : undefined}
          className={cn('flex min-w-0 flex-col', piece.box, at > 0 && 'border-t border-border')}
        >
          {piece.node}
        </div>
      ))}
    </div>
  );
}

/**
 * THE STATION'S LAYOUT: a bar over a body, the body arranged by the arrangement.
 *
 * THE ROOT IS THE WORKSPACE FRAME'S OWN BOX (`WorkspaceFrame`): `pwa-status-clear fixed inset-0`, its bottom riding
 * `--keyboard-height`, so in the home-screen app it clears the status bar and the notch and its foot lifts over the
 * on-screen keyboard; the body pads by `--safe-area-inset-bottom`, clearing the home indicator (on a phone its bottom bar
 * pads itself, so the bar's ground runs under the indicator). The page never scrolls as a document: its regions scroll
 * inside it. Sheets, dialogs and menus the station opens never take `pwa-status-clear`: an overlay covers the whole screen
 * and pads its own content.
 *
 * - WIDE (≥ 1360 px): four columns under the bar — the left rail (288 px: sessions over the corner), her column
 *   (360–420 px: head, conversation, dock, talk), the stage (the rest), the right rail (336 px: needs).
 * - LAPTOP (1024–1359 px): three columns (256 px, the rest, 296 px), the stage inside her column between her head and
 *   her conversation, up to 55% of it, so it never stands over her face (the whole column while none of her regions
 *   is drawn: there is nothing yet to leave room for).
 * - COMPACT (below 1024 px, and at any width while his switch is on): one column — her head in view, the strip's line, one
 *   switch, a section (`compact`, the caller's `StationCompactView`); the strip is a row of its own there, never the bar's.
 *   Under 1024 px it is the arrangement of every window that is not a phone's; above it, his switch (the bar's "Compact")
 *   chooses it.
 * - PHONE (a phone, upright or on its side): the station made for the thumb (`phone`, the caller's `StationPhoneView`), the
 *   whole frame: her head as its top row, which is the bar there (no `StationBar` is drawn), the strip's line, the section, and
 *   a bottom bar of the sections round the talk control, which pads itself by the home indicator's inset.
 *
 * A slot with no region draws nothing, and an empty stage folds away on a laptop wherever her column holds a region of its
 * own, all but her cards' shelf while it has cards; with none it stays, so a frame with nothing in it still says why. Each is
 * a data condition — what is drawn — never a mode. Hairlines part the columns and the pieces inside a column; the regions
 * paint themselves.
 *
 * A change of arrangement re-parents what moves (the stage between wide and laptop, everything into compact's sections), so a
 * region keeps its state in the station's context or its scroll memory, never only in itself.
 *
 * A pure view: `StationShell` below binds it to the station, and `.verify/kaylee-station-shots.mjs` draws it on the
 * fixtures' pictures (`station-fake.ts`) at 1440×900 and 1280×800, in compact at 600×900, 1080×1920 and 390×844, and in the
 * phone's arrangement at 390×844 and 844×390 as the home-screen app.
 */
export function StationShellView({ arrangement, slots, stage, compact, phone, compactSwitch, onBackToCloudcli }: StationShellViewProps) {
  // An empty stage gives way to her own regions in her column on a laptop. While her cards'
  // shelf stands on it (she has cards), the shelf stays and only the empty stage's words give way, so a pinned card is one
  // press away there too; the cell then lets go of the stage's floor (the laptop's 7.5rem, kept for a stage's head and a line
  // of what it holds), so it stands at the shelf's own height, and the shelf drops its own hairline for the one the next piece
  // draws. All four are read off what is drawn (`:has`), a data condition and never a mode.
  const stageCell = (regionsBeside: boolean, box: string): Piece => ({
    key: 'stage',
    node: stage,
    slot: null,
    box: cn(
      box,
      regionsBeside && '[&:has([data-station-stage=empty]):not(:has([data-station-shelf]))]:hidden [&_[data-station-stage-empty-message]]:hidden',
      regionsBeside && '[&:has([data-station-stage=empty])]:min-h-0 [&:has([data-station-stage=empty])_[data-station-shelf]]:border-b-0',
    ),
  });

  let body: ReactNode;
  if (arrangement === 'compact') {
    body = compact;
  } else if (arrangement === 'phone') {
    body = phone;
  } else {
    // Keyed, so a change between wide and laptop keeps the rails where they are: unkeyed, laptop's right rail lands at
    // the index wide's stage held and is rebuilt.
    const left = <Column key="left" name="left" className="border-r border-border [grid-area:left]" pieces={piecesOf(LEFT, slots)} />;
    const right = <Column key="right" name="right" className="border-l border-border [grid-area:right]" pieces={piecesOf(['needs'], slots)} />;
    if (arrangement === 'wide') {
      body = (
        <>
          {left}
          <Column key="her" name="her" className={cn('border-r border-border [grid-area:her]', HER_CONTAINER)} pieces={piecesOf(HER, slots)} />
          <div key="stage" data-station-column="stage" className="flex min-h-0 min-w-0 flex-col [grid-area:stage]">{stage}</div>
          {right}
        </>
      );
    } else {
      const head = piecesOf(['head'], slots);
      const below = piecesOf(HER.slice(1), slots);
      // Beside her own regions the stage takes up to 55% of her column and leaves her conversation the rest; with none
      // of hers drawn there is nothing to leave room for, and the stage takes the column.
      const herDrawn = head.length + below.length > 0;
      body = (
        <>
          {left}
          <Column
            key="her"
            name="her"
            className={cn('[grid-area:her]', HER_CONTAINER)}
            pieces={[...head, stageCell(herDrawn, herDrawn ? LAPTOP_STAGE_BESIDE_HER : 'min-h-0 flex-1'), ...below]}
          />
          {right}
        </>
      );
    }
  }

  return (
    <div
      data-station-shell=""
      data-station-arrangement={arrangement}
      className="pwa-status-clear fixed inset-0 flex flex-col bg-background"
      style={{ bottom: 'var(--keyboard-height, 0px)' }}
    >
      {arrangement !== 'phone' && (
        <StationBar strip={arrangement === 'compact' ? null : slots.strip} compactSwitch={compactSwitch} onBackToCloudcli={onBackToCloudcli} />
      )}
      <main data-station-body="" className={cn('min-h-0 flex-1', arrangement !== 'phone' && 'pb-[var(--safe-area-inset-bottom)]', BODY[arrangement])}>
        {body}
      </main>
    </div>
  );
}

/**
 * The station on the page: what `StationRoute` renders inside the station's provider. It reads the tier, his Compact switch,
 * the registered regions and the way back, and hands them, with the live stage, to `StationShellView`.
 *
 * THE ARRANGEMENT is compact below 1024 px (the tier `narrow`: a phone's window, upright or on its side, until the phone's own
 * arrangement picks first) and wherever his switch is on; else the tier's. It follows `resize` (the context reads the tier on
 * it) and his switch, never a timer. His switch is the station pref `compact`, per device, and is drawn from 1024 px up: below,
 * compact is the only arrangement and a switch would change nothing.
 *
 * EVERY REGION'S DENSITY is `compact` in the one-column arrangements (compact's and the phone's) and `full` in the columns,
 * handed to each region with the tier.
 */
export function StationShell() {
  const { tier, phone } = useStation();
  const navigate = useNavigate();
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const [compactOn, setCompactOn] = useStationPref('compact', false);
  // FILL: arrangement — `'phone'` first while `useStation().phone` (a window under 768 px, or a touch window under 500 px tall), then compact.
  const arrangement = (tier === 'narrow' || compactOn ? 'compact' : tier) as StationArrangement;
  const compactSwitch: StationCompactSwitch | null = tier === 'narrow' ? null : { on: compactOn, onChange: setCompactOn };
  const density: StationDensity = arrangement === 'compact' || arrangement === 'phone' ? 'compact' : 'full';
  // The way back, bound here for the bar (a pure view drawn by this pure layout) and for the phone's top row, her menu.
  const onBackToCloudcli = () => backToCloudcli(navigate, { phone, pwa: isPWA });

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
      compact={arrangement === 'compact' ? <StationCompact slots={slots} stage={stage} tier={tier} /> : null}
      phone={arrangement === 'phone' ? <StationPhone slots={slots} stage={stage} onBackToCloudcli={onBackToCloudcli} /> : null}
      compactSwitch={compactSwitch}
      onBackToCloudcli={onBackToCloudcli}
    />
  );
}
