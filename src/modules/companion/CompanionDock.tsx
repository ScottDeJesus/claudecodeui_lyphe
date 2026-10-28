import { AudioLines } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useCompanion } from '@/modules/companion/context/CompanionContext';
import { RAIL_BUTTON_BASE, RAIL_BUTTON_LIT, RAIL_BUTTON_UNLIT } from '@/shared/constants';
import { Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * Where the views rail is docked beside the list: Tailwind's `md`, the width below which the sidebar is a drawer
 * (useDeviceSettings' mobile breakpoint). Below it the rail lives in the drawer, so the cell is no place to rest.
 */
const RAIL_DOCKED_QUERY = '(min-width: 768px)';

type CompanionDoorViewProps = {
  /** Whether her panel is open: the door is lit, and says it is expanded. */
  open: boolean;
  /** Her name as he set it; null while the page has not read it, and the default stands in. */
  name: string | null;
  onPress: () => void;
};

/**
 * Her door in the views rail, drawn: one rail button — RailButton's size and feel from the shared rail constants, a 20px
 * glyph at stroke 1.75 in a 40px square (44px below md) — holding her mark, the same waveform that marks a brief sent
 * "Through Kaylee" in a chat. Lit while her panel is open, in the rail's one lit look (`RAIL_BUTTON_LIT`); the open
 * state reaches a reader as `aria-expanded`, since the door opens a panel and is no page of the rail.
 *
 * Its name is hers, "Kaylee" as he set it, with `aria-expanded`: a door that opens and closes her panel is named for
 * what it shows, as the rail's views are, never for an action ("Talk to Kaylee" is her panel's talk button, which opens
 * the mic). Every word is a `t()` with a default, because the door stands in the rail before anything else of hers
 * loads. The name rides the kit Tooltip on hover and keyboard focus.
 * `data-companion-door` is what her panel hands focus back to when it closes from the keyboard.
 *
 * Used within this module, where the dock below draws it whenever her disc is out of its seat, and exported for
 * `.verify/lib/companion-kit.mjs`, which draws it lit and unlit in the live rail.
 */
export function CompanionDoorView({ open, name, onPress }: CompanionDoorViewProps) {
  const { t } = useTranslation();
  const her = name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });
  const label = t('companion.door.label', { defaultValue: '{{name}}', name: her });

  return (
    <Tooltip position="right" showOnFocus content={label}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        data-companion-door=""
        onClick={onPress}
        className={cn(RAIL_BUTTON_BASE, open ? RAIL_BUTTON_LIT : RAIL_BUTTON_UNLIT)}
      >
        <AudioLines aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </button>
    </Tooltip>
  );
}

type CompanionDockViewProps = {
  /**
   * Her disc rests here: its rest is docked and this dock has measured. The cell then holds only the space the disc is
   * drawn over. A disc out on a look (gliding to a chat row, then home) is still seated: it is a visit, not a move.
   */
  seated: boolean;
  /** A look holds her disc away from this seat (gliding to a chat row, resting beside it, gliding home): the seat shows its mark. */
  away: boolean;
  /** Whether her panel is open: the cell is lit as a lit view is, under the seated disc or as the door. */
  open: boolean;
  /** Her name as he set it; null while the page has not read it. */
  name: string | null;
  /** The door's press, which is the disc's own: it opens or closes her panel. */
  onPress: () => void;
  /**
   * Where the box reports its rect: once on mount, again whenever it may have moved, and null as it leaves the page. Null
   * too below md, where the rail lives in the drawer: a phone keeps her in her own corner while the drawer slides in and
   * out, and the drawer's cell draws her door.
   */
  onRect: (rect: DOMRect | null) => void;
};

/**
 * HER CELL IN THE RAIL, drawn: the place her disc docks, in the rail's foot between the usage rings and the Inbox, where
 * her door stood. Exported for this file's CompanionDock, which binds it to her picture, and for
 * `.verify/kaylee-fab-chrome.mjs`, which seats the disc in it, drags the disc out and drops it back on fixtures.
 *
 * THE CELL IS A RAIL BUTTON'S SIZE (40px, 44px below md), so the foot keeps one rhythm whether the cell holds her disc or
 * her door. In it a 28px box, the disc's own size, centred: the disc is one fixed node over the whole page (the kit's
 * DockableFab, mounted by the workspace frame), drawn centred on this box's rect, so the box paints nothing and only holds
 * the space and says where it is — the pattern of the applications button's dock.
 *
 * THE DOOR IS ALWAYS THERE. Docked, the disc is her door: a press opens or closes her panel. Dragged out, the disc floats
 * wherever he dropped it, and this cell draws her plain door in its place, with the same press, so the rail never loses
 * its way to her. A disc out on a look is still seated, so the door does not blink in and out of the rail each time she
 * glides to a chat and back: the seat shows a quiet dashed ring instead (`away`), in the rail's unlit ink, her place kept,
 * so the cell never reads as a missing glyph. The box goes on reporting beneath the door, so a drag back still docks.
 *
 * LIT WHILE HER PANEL IS OPEN, in the rail's one lit look (`RAIL_BUTTON_LIT`: the soft green ground and the bar on the
 * rail's edge). Out, the door lights itself; seated, the cell lights under the disc, whose own pressed ring is too fine at
 * 28px to carry the state alone. So the rail says "open" in one language, whichever of the two holds the cell.
 *
 * A SEAT ONLY WHERE THE RAIL IS DOCKED (md and up). Below md the rail lives in the sidebar's drawer, and the box reports
 * no rect: her disc rests in its own corner on a phone, the drawer's cell draws her door, and opening or closing the
 * drawer never carries her in or out of it.
 *
 * WHEN THE BOX MOVES: with a window resize, which reflows the rail, and when the rail changes layout at md. From md up the
 * sidebar is docked and nothing slides it (its drawer's transform and fade exist only below md, where the box reports
 * nothing), and the foot holds nothing that changes height beside the cell (the rings always draw, the Inbox always
 * stands). The one move a resize cannot see is the crossing of md itself: the `resize` event fires BEFORE React draws the
 * layout the new width asks for, so growing from a phone to a desktop width reads the drawer's off-screen box and the
 * context rightly refuses it. The browser's own word that the box has come into view, or left it, arrives after that
 * layout (an IntersectionObserver on the box), and reports once more; nothing polls. The rect is reported as measured;
 * the companion's context decides whether it is a place a disc can be sent (non-empty, and on screen).
 *
 * The cell's size and shape are `RAIL_BUTTON_BASE`'s own, so the cell and the door it draws can never part.
 */
export function CompanionDockView({ seated, away, open, name, onPress, onRect }: CompanionDockViewProps) {
  const boxRef = useRef<HTMLDivElement>(null);

  // The latest `onRect`, so a caller that hands a new function each render never re-binds the listeners or re-reports.
  // A layout effect declared before the one that reports, so the report of a commit reads that commit's callback.
  const rectListener = useRef(onRect);
  useLayoutEffect(() => {
    rectListener.current = onRect;
  });

  // A LAYOUT effect, so a docked disc lands in the rail on the first paint instead of flashing in its corner for a frame.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const report = () => rectListener.current(window.matchMedia(RAIL_DOCKED_QUERY).matches ? box.getBoundingClientRect() : null);
    report();
    window.addEventListener('resize', report);
    // Told after the layout that moved the box (see "WHEN THE BOX MOVES"): its first call, on observing, is one more report of the same rect.
    const sight = new IntersectionObserver(report);
    sight.observe(box);
    return () => {
      window.removeEventListener('resize', report);
      sight.disconnect();
      // Gone, so the rect goes with it: a remembered rect is exactly where a disc would be drawn, out of reach.
      rectListener.current(null);
    };
  }, []);

  return (
    <div data-companion-dock-cell="" className={cn(RAIL_BUTTON_BASE, seated && open && RAIL_BUTTON_LIT)}>
      <div
        ref={boxRef}
        aria-hidden="true"
        className={cn('col-start-1 row-start-1 size-7 rounded-full', seated && away && 'border border-dashed border-muted-foreground/70')}
      />
      {!seated && (
        // The disc is out of its seat: her door stands in the cell, over the box, in the rail's own button.
        <div className="col-start-1 row-start-1">
          <CompanionDoorView open={open} name={name} onPress={onPress} />
        </div>
      )}
    </div>
  );
}

/**
 * Her cell on the page: what WorkspaceRail renders in its foot, in the cell her door held. It reads whether her disc rests
 * here, the open state and her name from the companion's provider, reports its box to the provider, and toggles the panel
 * from the door; CompanionDockView draws it.
 */
export function CompanionDock() {
  const { picture, open, setOpen, fabPosition, dockRect, fabAway, registerDock } = useCompanion();
  // Seated: her rest is docked AND the cell is believed (on screen, rail docked). A disc docked on a phone rests in its corner, so the drawer's cell draws her door.
  const seated = fabPosition.docked && dockRect !== null;

  return (
    <CompanionDockView
      seated={seated}
      away={fabAway}
      open={open}
      name={picture?.settings.name ?? null}
      onPress={() => setOpen(!open)}
      onRect={registerDock}
    />
  );
}
