import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { useStation } from '@/modules/station/context/StationContext';
import { StationBar } from '@/modules/station/StationBar';
import { StationStage } from '@/modules/station/StationStage';
import { STATION_REGIONS } from '@/modules/station/stationRegions';
import { backToCloudcli } from '@/shared/cloudcliDoors';
import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import type { StationSlot, StationTier } from '@/shared/types';
import { ScrollArea } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** What the layout holds in each slot: a region, drawn. A slot left out (or null) draws nothing. */
type StationSlots = Partial<Record<StationSlot, ReactNode>>;

/** The slots the body stacks; `strip` is the bar's. */
type BodySlot = Exclude<StationSlot, 'strip'>;

type StationShellViewProps = {
  /** The arrangement: `wide` (≥ 1360 px), `laptop` (1024–1359 px) or `narrow` (below, a phone included). */
  tier: StationTier;
  /** Each slot's region, drawn for this tier. */
  slots: StationSlots;
  /** The stage, drawn: `StationStage` on the page, `StationStageView` on a fixture. */
  stage: ReactNode;
  /** The bar's "CloudCLI", the way back to the workspace. */
  onBackToCloudcli: () => void;
};

/**
 * How each slot stands in its column. The lists take the room (sessions, the conversation, needs) and scroll inside
 * themselves; the rest are their own height. The conversation keeps a floor of 3.5rem whatever else stands in her
 * column, so her newest line stays in sight (her panel's own rule); the dock gives way before it does. Below laptop
 * the column is a stack, where these read as their own heights.
 *
 * The corner is the rail's foot whatever stands above it (`mt-auto`, its hairline its own), so it never rises to the
 * rail's head while the sessions are not drawn; under the sessions, which take the room, the margin is nothing.
 */
const SLOT_BOX: Record<BodySlot, string> = {
  sessions: 'min-h-0 flex-1',
  corner: 'mt-auto shrink-0 border-t border-border',
  head: 'shrink-0',
  conversation: 'min-h-14 flex-1',
  dock: 'min-h-0 flex-[0_1_auto]',
  talk: 'shrink-0',
  needs: 'min-h-0 flex-1',
};

/**
 * The stage in her column on a laptop, beside her regions: its own height up to 55% of the column, and the first to
 * give way when the column runs short — a guest there, as her panel's notes are — down to a floor that keeps its head
 * and a line of what it holds.
 */
const LAPTOP_STAGE_BESIDE_HER = 'max-h-[55%] min-h-[7.5rem] flex-[0_10000_auto]';

/** The left rail, top to bottom: the sessions over the memory corner. */
const LEFT: readonly BodySlot[] = ['sessions', 'corner'];
/** Her column, top to bottom. On a laptop the stage stands between `head` and `conversation`, never over her face. */
const HER: readonly BodySlot[] = ['head', 'conversation', 'dock', 'talk'];
/** The narrow stack after her head and the stage, in reading order: hers, then what needs him, then where things stand. */
const STACK_REST: readonly BodySlot[] = ['conversation', 'dock', 'talk', 'needs', 'sessions', 'corner'];

/** The body's grid per arrangement, its areas named, its one row the body's whole height (columns scroll inside). */
const BODY: Record<StationTier, string> = {
  wide: "grid grid-cols-[288px_minmax(360px,420px)_minmax(0,1fr)_336px] grid-rows-[minmax(0,1fr)] [grid-template-areas:'left_her_stage_right']",
  laptop: "grid grid-cols-[256px_minmax(0,1fr)_296px] grid-rows-[minmax(0,1fr)] [grid-template-areas:'left_her_right']",
  narrow: 'flex flex-col',
};

/** One piece of a column: a drawn slot, or the stage. */
type Piece = { key: string; node: ReactNode; box: string; slot: BodySlot | null };

/** Whether a slot's region is drawn. */
function drawn(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false;
}

/** The drawn slots of a list, in its order, as pieces. A slot with no region is left out: it draws nothing. */
function piecesOf(names: readonly BodySlot[], slots: StationSlots): Piece[] {
  return names.filter((name) => drawn(slots[name])).map((name) => ({ key: name, node: slots[name], box: SLOT_BOX[name], slot: name }));
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
 * THE STATION'S LAYOUT: a bar over a body, the body arranged by the tier.
 *
 * THE ROOT IS THE WORKSPACE FRAME'S OWN BOX (`WorkspaceFrame`): `pwa-status-clear fixed inset-0`, its bottom riding
 * `--keyboard-height`, so in the home-screen app it clears the status bar and the notch and its foot lifts over the
 * on-screen keyboard; the body pads by `--safe-area-inset-bottom`, clearing the home indicator. The page never
 * scrolls as a document: its regions scroll inside it. Sheets, dialogs and menus the station opens never take
 * `pwa-status-clear`: an overlay covers the whole screen and pads its own content.
 *
 * - WIDE (≥ 1360 px): four columns under the bar — the left rail (288 px: sessions over the corner), her column
 *   (360–420 px: head, conversation, dock, talk), the stage (the rest), the right rail (336 px: needs).
 * - LAPTOP (1024–1359 px): three columns (256 px, the rest, 296 px), the stage inside her column between her head and
 *   her conversation, up to 55% of it, so it never stands over her face (the whole column while none of her regions
 *   is drawn: there is nothing yet to leave room for).
 * - NARROW (below, a phone included): one scrolling column — her head, the stage, then the rest in reading order.
 *
 * A slot with no region draws nothing, and an empty stage folds away wherever her column (or the stack) holds a region
 * of its own, all but her cards' shelf while it has cards; with none it stays, so a frame with nothing in it still says
 * why. Each is a data condition — what is drawn — never a mode. Hairlines part the columns and the pieces inside a
 * column; the regions paint themselves.
 *
 * A tier change re-parents what moves (the stage between wide and laptop, everything into the narrow stack), so a
 * region keeps its state in the station's context or its scroll memory, never only in itself.
 *
 * A pure view: `StationShell` below binds it to the station, and `.verify/kaylee-station-shots.mjs` draws it on the
 * fixtures' pictures (`station-fake.ts`) at 1440×900, 1280×800 and 390×844.
 */
export function StationShellView({ tier, slots, stage, onBackToCloudcli }: StationShellViewProps) {
  // An empty stage gives way to her own regions: in her column on a laptop, in the stack below laptop. While her cards'
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
  if (tier === 'narrow') {
    const head = piecesOf(['head'], slots);
    const rest = piecesOf(STACK_REST, slots);
    // Among regions the stage is its own height in the stack; alone, it takes the screen's height (the stack is at
    // least the screen's), so an empty stage stands where the eye lands, as it does in the columns.
    const stackDrawn = head.length + rest.length > 0;
    body = (
      <ScrollArea className="min-h-0 flex-1">
        <Column
          name="stack"
          className="mx-auto min-h-full w-full max-w-3xl"
          pieces={[...head, stageCell(stackDrawn, stackDrawn ? '' : 'flex-1'), ...rest]}
        />
      </ScrollArea>
    );
  } else {
    // Keyed, so a change between wide and laptop keeps the rails where they are: unkeyed, laptop's right rail lands at
    // the index wide's stage held and is rebuilt.
    const left = <Column key="left" name="left" className="border-r border-border [grid-area:left]" pieces={piecesOf(LEFT, slots)} />;
    const right = <Column key="right" name="right" className="border-l border-border [grid-area:right]" pieces={piecesOf(['needs'], slots)} />;
    if (tier === 'wide') {
      body = (
        <>
          {left}
          <Column key="her" name="her" className="border-r border-border [grid-area:her]" pieces={piecesOf(HER, slots)} />
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
            className="[grid-area:her]"
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
      data-station-tier={tier}
      className="pwa-status-clear fixed inset-0 flex flex-col bg-background"
      style={{ bottom: 'var(--keyboard-height, 0px)' }}
    >
      <StationBar tier={tier} strip={slots.strip} onBackToCloudcli={onBackToCloudcli} />
      <main data-station-body="" className={cn('min-h-0 flex-1 pb-[var(--safe-area-inset-bottom)]', BODY[tier])}>
        {body}
      </main>
    </div>
  );
}

/**
 * The station on the page: what `StationRoute` renders inside the station's provider. It reads the tier, the
 * registered regions and the way back, and hands them, with the live stage, to `StationShellView`.
 */
export function StationShell() {
  const { tier, phone } = useStation();
  const navigate = useNavigate();
  const { isPWA } = useDeviceSettings({ trackMobile: false });

  // Each slot with a registered region, drawn for this tier; a slot with none is left out, so it draws nothing.
  const slots: StationSlots = {};
  for (const slot of Object.keys(STATION_REGIONS) as StationSlot[]) {
    const Region = STATION_REGIONS[slot];
    if (Region !== undefined) slots[slot] = <Region tier={tier} />;
  }

  return (
    <StationShellView
      tier={tier}
      slots={slots}
      stage={<StationStage />}
      // The bar is a pure view drawn by this pure layout, so the way back is bound here and handed down.
      onBackToCloudcli={() => backToCloudcli(navigate, { phone, pwa: isPWA })}
    />
  );
}
